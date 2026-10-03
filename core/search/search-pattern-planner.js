/**
 * Pattern Search Query Planner — regex candidate generation pipeline.
 *
 * Extracted from search-pattern.js for the 500-line-limit rule.
 *
 * Pipeline:
 *   1. Unified search (single NAPI call) when available
 *   2. Fallback: gram narrowing → literal prefilter → cost-model planner
 *   3. Execute chosen strategy (raw_rg, narrowed_json, two_pass, native_grep_all)
 *   4. Return indexed + overlay matches with detailed stats
 */

import {
  extractLiteralClauses, prefilterLiteralClauses, runLiteralPrefilterClauses, querySparseGramCandidates,
  ensureSparseGramIndex,
  sparseDeltaOverlayHasChanges, getSparseGramAllFilesWithOverlay,
  hasCaseInsensitiveRegexFlag, nativeGrepFilesWithMatches,
  nativeGrepFilesWithMatchesFixed, nativeGrepLines, nativeGrepFull, nativeGrepWithFiles,
  queryAndGrepLines, queryAndGrepFull,
  searchLines, searchFull, resolveSparseSymbolMask,
  sparseGramPathFilter, grepUnfilterablePaths, gramsProveNoMatch,
} from './search-pattern-prefilter.js';
import { resolveSearchSymbolFilter } from './search-pattern-chunks.js';
import { _getRgCapabilities, runRipgrepFilesWithMatches, runRipgrepJson, normalizeSearchPath } from './search-pattern-ripgrep.js';
import { isSymlinkedRelUnder } from '../indexing/admission-policy.js';

/**
 * Normalize match file paths from native grep (which returns absolute paths)
 * to relative paths matching the chunk location map keys.
 *
 * The ripgrep JSON parser already calls normalizeSearchPath per match.
 * Native grep bypasses ripgrep, so we must normalize here.
 */
function normalizeNativeMatches(matches, searchDir) {
  const out = [];
  // Matches come grouped by file: each distinct path is normalized once. The addon builds a
  // fresh object per match, so one whose path is already normal is kept as it is.
  const normalized = new Map();
  for (const m of matches || []) {
    let file = normalized.get(m.file);
    if (file === undefined) {
      file = normalizeSearchPath(searchDir, m.file);
      normalized.set(m.file, file);
    }
    if (file) out.push(file === m.file ? m : { ...m, file });
  }
  return out;
}

/**
 * The addon's isSymlinkedRelUnder answers (`aliasVerdicts`) of native results, for the paths
 * that normalizeNativeMatches keeps as they are (a rewritten path is walked again in JS).
 * Null when no result carries them.
 */
function normalizeNativeVerdicts(results, searchDir) {
  let verdicts = null;
  for (const r of results) {
    if (!r?.aliasVerdicts) continue;
    verdicts ??= new Map();
    for (const [raw, alias] of r.aliasVerdicts) {
      if (normalizeSearchPath(searchDir, raw) === raw) verdicts.set(raw, alias);
    }
  }
  return verdicts;
}

/**
 * Per-file match counts of native results, keyed like normalizeNativeMatches keys them: a
 * capped result's `fileTotals`, else a count of its matches.
 */
function normalizeNativeTotals(results, searchDir) {
  const totals = new Map();
  const add = (raw, n) => {
    const file = normalizeSearchPath(searchDir, raw);
    if (file) totals.set(file, (totals.get(file) || 0) + n);
  };
  for (const r of results) {
    if (!r) continue;
    if (r.fileTotals) for (const [raw, n] of r.fileTotals) add(raw, n);
    else for (const m of r.matches || []) add(m.file, 1);
  }
  return totals;
}

/**
 * Drop matches whose path goes through a symlink below `searchDir`. The indexer never admits
 * such a path (admission rule 5), so a hit there is a second name for a file already searched
 * at its real path, or for content outside the repository. Only a gram index that is older than
 * the tree holds such paths: one built before the no-follow rule (GRDB's
 * `Tests/CustomSQLite/GRDB -> ../..` loop put 32 copies of every file in it), or a directory
 * turned into a symlink that the maintainer has not retired yet. The memo makes the cost one
 * lstat per distinct directory prefix, and the walk stops at the first symlink.
 */
// Every native grep in this file passes `indexPaths: true` (no realpath check per directory):
// a path that check would refuse leaves the root through a symlink, and this drops it anyway.
function dropSymlinkAliasMatches(result, searchDir) {
  if (!result) return result;
  const memo = new Map();
  // The addon's answers for the files it read (normalizeNativeVerdicts); isAlias walks the rest.
  const verdict = new Map(result.aliasVerdicts || []);
  const isAlias = (file) => {
    let v = verdict.get(file);
    if (v === undefined) {
      v = isSymlinkedRelUnder(searchDir, file, memo);
      verdict.set(file, v);
    }
    return v;
  };
  const indexed = result.indexedMatches || [];
  const overlay = result.overlayMatches || [];
  const keptIndexed = indexed.filter((m) => !isAlias(m.file));
  const keptOverlay = overlay.filter((m) => !isAlias(m.file));
  let dropped = indexed.length - keptIndexed.length + overlay.length - keptOverlay.length;
  if (dropped === 0) return result;
  // A capped result counts what it dropped from its totals, as the full list would have.
  let fileTotals = result.fileTotals;
  if (fileTotals) {
    fileTotals = new Map();
    dropped = 0;
    for (const [file, n] of result.fileTotals) {
      if (isAlias(file)) dropped += n;
      else fileTotals.set(file, n);
    }
  }
  return {
    ...result,
    indexedMatches: keptIndexed,
    overlayMatches: keptOverlay,
    ...(fileTotals ? { fileTotals } : {}),
    matchingFiles: Array.isArray(result.matchingFiles)
      ? result.matchingFiles.filter((file) => !isAlias(file))
      : result.matchingFiles,
    stats: { ...(result.stats || {}), symlinkAliasMatchesDropped: dropped },
  };
}

// =============================================================================
// Core pipeline — regex candidate generation
// =============================================================================

export async function generateRegexMatches(searcher, regex, searchDir, options = {}) {
  return dropSymlinkAliasMatches(await collectRegexMatches(searcher, regex, searchDir, options), searchDir);
}

async function collectRegexMatches(searcher, regex, searchDir, options = {}) {
  const start = performance.now();
  const fixedString = options.fixedString ?? false;
  const globs = options.globs ?? [];

  const useLiteralFilter = options.useLiteralFilter ?? options.literalFilter ?? true;
  // A regex carries its own case flags (`(?i)`). Fixed-string text is not a regex: "(?i" in it is
  // plain text, so its case comes only from the explicit option.
  const caseInsensitive = fixedString ? options.caseInsensitive === true : hasCaseInsensitiveRegexFlag(regex);
  // The final ripgrep calls: a regex keeps its inline flags; fixed-string text needs `-i`.
  const rgCaseInsensitive = fixedString && caseInsensitive;
  const literalExtractStart = performance.now();
  const literalPlan = useLiteralFilter ? extractLiteralClauses(regex, options) : { clauses: [], source: 'none' };
  // The literals each prefilter can use soundly (ripgrep, native fixed-string grep, gram index).
  const prefilterClauses = prefilterLiteralClauses(literalPlan.clauses, { caseInsensitive });
  const literalExtractionTime = performance.now() - literalExtractStart;
  const symbolTypeFilter = resolveSearchSymbolFilter(options);
  const lightweightParse = options.lightweightParse ?? false;
  // bareGrep's per-file cap (`_grepPerFileCap`): the native engine keeps only the first N
  // matches of each file and counts every one into `fileTotals` (see bareGrep). Full matches
  // only; a result without `fileTotals` holds all its matches.
  const perFileCap = !lightweightParse && options._grepPerFileCap > 0 ? options._grepPerFileCap : 0;

  // --- Unified search: single NAPI call handles gram narrowing + all-files fallback ---
  // Eligible when: not fixed-string, no globs, gram index loaded, grams do not prove absence.
  // Rust: gram narrowing → greps candidates if eligible, else all files. One NAPI crossing.
  const useGramIndex = options.useGramIndex ?? options.gramIndex ?? true;
  const hasSparseDeltaOverlay = sparseDeltaOverlayHasChanges(searcher, options);
  // bareGrep's --in scope (`_grepScope`, the predicate it filters matches with afterwards). The
  // unified search cannot take it, so a scoped search reads only in-scope candidates below.
  const scopeIndex = typeof options._grepScope === 'function' ? ensureSparseGramIndex(searcher, options) : null;
  const inScope = typeof scopeIndex?.queryLiterals === 'function' && typeof scopeIndex?.getAllFiles === 'function'
    ? options._grepScope : null;
  const canUseUnifiedSearch = !fixedString && globs.length === 0 && !hasSparseDeltaOverlay && !inScope;
  if (canUseUnifiedSearch) {
    const sparseGramIndex = ensureSparseGramIndex(searcher, options);
    const symbolMask = resolveSparseSymbolMask(symbolTypeFilter);
    const noMatch = gramsProveNoMatch(sparseGramIndex, prefilterClauses.gram, { maxCandidates: options.maxGramCandidates ?? 0, symbolMask: symbolMask || 0 });
    if (sparseGramIndex && !noMatch) {
      const pathFilter = sparseGramPathFilter(sparseGramIndex);
      const gramStart = performance.now();
      const unifiedResult = lightweightParse
        ? searchLines(sparseGramIndex, prefilterClauses.gram, regex, searchDir, {
            maxGramCandidates: options.maxGramCandidates ?? 0,
            symbolMask: symbolMask || 0,
            caseInsensitive,
            codeExtensions: pathFilter.extensions,
            maxCandidateFiles: options.maxGramCandidateFiles ?? 100000,
            maxCandidateRatio: options.maxGramCandidateRatio ?? 1.0,
          })
        : searchFull(sparseGramIndex, prefilterClauses.gram, regex, searchDir, {
            maxGramCandidates: options.maxGramCandidates ?? 0,
            symbolMask: symbolMask || 0,
            caseInsensitive,
            codeExtensions: pathFilter.extensions,
            maxCandidateFiles: options.maxGramCandidateFiles ?? 100000,
            maxCandidateRatio: options.maxGramCandidateRatio ?? 1.0,
            perFileCap,
          });

      if (unifiedResult) {
        const candidateFiles = unifiedResult.candidateFiles;
        const totalFiles = unifiedResult.totalFiles;
        const gramNarrowed = candidateFiles < totalFiles;
        // Narrowing dropped the index paths the extension list cannot express; grep-all did not.
        const residual = gramNarrowed && !symbolMask ? pathFilter.unfilterable : [];
        const residualResult = grepUnfilterablePaths(residual, regex, searchDir, { caseInsensitive, lightweightParse, perFileCap, withTotals: true });
        const gramLookupTime = performance.now() - gramStart;
        const materializeStart = performance.now();
        const indexedMatches = normalizeNativeMatches([...unifiedResult.matches, ...residualResult.matches], searchDir);
        const fileTotals = perFileCap > 0 ? normalizeNativeTotals([unifiedResult, residualResult], searchDir) : null;
        const aliasVerdicts = normalizeNativeVerdicts([unifiedResult, residualResult], searchDir);
        const matchingFiles = [...new Set(indexedMatches.map((m) => m.file))];
        const materializeTime = performance.now() - materializeStart;
        const rustGramMs = (unifiedResult.gramElapsedUs || 0) / 1000;
        const rustRegexBuildMs = (unifiedResult.regexBuildElapsedUs || 0) / 1000;
        const rustGrepMs = (unifiedResult.grepElapsedUs || 0) / 1000;
        const napiOverheadMs = gramLookupTime - rustGramMs - rustRegexBuildMs - rustGrepMs;
        const strategy = gramNarrowed ? 'unified_gram_grep' : 'unified_grep_all';
        return {
          indexedMatches,
          overlayMatches: [],
          matchingFiles,
          ...(fileTotals ? { fileTotals } : {}),
          ...(aliasVerdicts ? { aliasVerdicts } : {}),
          stats: {
            nativeGrepUsed: true,
            candidateGenTime_ms: Math.round(performance.now() - start),
            grepTime_ms: Math.round(rustGrepMs),
            literalFilterTime_ms: 0,
            gramLookupTime_ms: Math.round(gramLookupTime),
            filesConsidered: totalFiles,
            filesScanned: unifiedResult.scannedFiles + residual.length,
            filesSkipped: 0,
            dirtyOverlayFiles: 0,
            candidateFilesBeforeFilter: candidateFiles,
            candidateFilesAfterFilter: candidateFiles,
            candidateReductionRatio: 0,
            literalExtractionHit: literalPlan.clauses.length > 0,
            literalExtractionSource: literalPlan.source,
            gramLookupReason: gramNarrowed ? 'ok' : 'all_files',
            prefilterDiscarded: false,
            prefilterDiscardedCount: 0,
            denseGramsTouched: unifiedResult.denseGramsTouched || 0,
            sparseGramsTouched: unifiedResult.sparseGramsTouched || 0,
            gramFalsePositiveRatio: gramNarrowed && candidateFiles > 0
              ? 1 - (matchingFiles.length / candidateFiles)
              : 0,
            grepStrategy: strategy,
            plannerRoute: `${strategy}:${unifiedResult.scannedFiles}_files`,
            gramSelectivity: totalFiles > 0 ? candidateFiles / totalFiles : null,
            plannerInputs: {
              narrowedFileCount: candidateFiles,
              gramCandidateFiles: candidateFiles,
              gramTotalFiles: totalFiles,
              narrowedThreshold: options.narrowedJsonThreshold ?? 300,
              directJsonThreshold: options.directJsonFileThreshold ?? 4096,
              skipLiteralPrefilter: true,
            },
            symbolTypeFilter,
            trackerLastIndex: null,
            grepMatches: indexedMatches.length,
            stageTiming: {
              literalExtractionTime_ms: +literalExtractionTime.toFixed(3),
              gramQueryTime_ms: +rustGramMs.toFixed(3),
              regexBuildTime_ms: +rustRegexBuildMs.toFixed(3),
              grepVerifyTime_ms: +rustGrepMs.toFixed(3),
              napiOverheadTime_ms: +napiOverheadMs.toFixed(3),
              resultMaterializationTime_ms: +materializeTime.toFixed(3),
            },
          },
        };
      }
      // Unified search returned null (addon unavailable) — fall through.
    }
  }

  // --- Fallback: existing multi-step path ---
  let searchFiles = null;
  let gramLookupTime = 0;
  let gramLookupResult = null;

  if (prefilterClauses.gram.length > 0) {
    const gramStart = performance.now();
    gramLookupResult = querySparseGramCandidates(searcher, prefilterClauses.gram, options);
    gramLookupTime = performance.now() - gramStart;
    if (Array.isArray(gramLookupResult?.files)) {
      searchFiles = inScope ? gramLookupResult.files.filter(inScope) : gramLookupResult.files;
    }
  }

  // --- Optimization #3: compute gram selectivity for planning ---
  const gramCandidateFiles = gramLookupResult?.candidateFiles || 0;
  const gramTotalFiles = gramLookupResult?.totalFiles || 0;
  const gramSelectivity = gramTotalFiles > 0 ? gramCandidateFiles / gramTotalFiles : null;
  const narrowedThreshold = options.narrowedJsonThreshold ?? 300;
  const directJsonThreshold = options.directJsonFileThreshold ?? 4096;

  // No candidate (in scope): no file can match.
  if (gramLookupResult?.eligible === true && Array.isArray(searchFiles) && searchFiles.length === 0) {
    return {
      indexedMatches: [],
      overlayMatches: [],
      matchingFiles: [],
      stats: {
        nativeGrepUsed: false,
        candidateGenTime_ms: Math.round(performance.now() - start),
        grepTime_ms: 0,
        literalFilterTime_ms: 0,
        gramLookupTime_ms: Math.round(gramLookupTime),
        filesConsidered: gramTotalFiles,
        filesScanned: 0,
        filesSkipped: 0,
        dirtyOverlayFiles: 0,
        candidateFilesBeforeFilter: 0,
        candidateFilesAfterFilter: 0,
        candidateReductionRatio: 0,
        literalExtractionHit: literalPlan.clauses.length > 0,
        literalExtractionSource: literalPlan.source,
        gramLookupReason: gramLookupResult.reason || 'ok',
        prefilterDiscarded: false,
        prefilterDiscardedCount: 0,
        denseGramsTouched: gramLookupResult.denseGramsTouched || 0,
        sparseGramsTouched: gramLookupResult.sparseGramsTouched || 0,
        gramFalsePositiveRatio: 0,
        grepStrategy: 'none',
        plannerRoute: 'empty_gram_candidates',
        gramSelectivity,
        plannerInputs: {
          narrowedFileCount: 0,
          gramCandidateFiles,
          gramTotalFiles,
          narrowedThreshold,
          directJsonThreshold,
          skipLiteralPrefilter: true,
        },
        symbolTypeFilter,
        trackerLastIndex: null,
        grepMatches: 0,
        stageTiming: {
          literalExtractionTime_ms: +literalExtractionTime.toFixed(3),
          gramQueryTime_ms: +gramLookupTime.toFixed(3),
          regexBuildTime_ms: 0,
          literalPrefilterTime_ms: 0,
          plannerTime_ms: 0,
          grepVerifyTime_ms: 0,
          napiOverheadTime_ms: 0,
          resultMaterializationTime_ms: 0,
        },
      },
    };
  }

  const fileGramTooBroad = gramLookupResult?.eligible === false && gramLookupResult?.reason === 'too_broad';

  const candidateFilesBeforeFilter = Array.isArray(searchFiles) ? searchFiles.length : 0;
  let candidateFilesAfterFilter = Array.isArray(searchFiles) ? searchFiles.length : 0;
  let literalFilterTime = 0;
  let filteredFiles = searchFiles;
  const usingGramCandidates = Array.isArray(searchFiles);
  const gramTooBroad = fileGramTooBroad;

  // --- Optimization #4: use gram DF stats to skip literal prefilter when broad ---
  const gramSaysBroad = gramSelectivity !== null && gramSelectivity > 0.40;

  // --- Native grep on all indexed files: skip the prefilter entirely ---
  const sparseForAllFiles = (!fixedString && globs.length === 0)
    ? ensureSparseGramIndex(searcher, options)
    : null;
  // Only a search with no gram candidate reads every indexed file; with candidates the list is
  // never used, and building it (and testing a --in scope on each path) cost ~30 ms on 30k files.
  const haveCandidates = Array.isArray(searchFiles) && searchFiles.length > 0;
  let allIndexedFiles = sparseForAllFiles && !haveCandidates
    ? getSparseGramAllFilesWithOverlay(searcher, sparseForAllFiles, options)
    : null;
  if (inScope && Array.isArray(allIndexedFiles) && allIndexedFiles.length > 0) {
    allIndexedFiles = allIndexedFiles.filter(inScope);
    // The scope holds no indexed file: the full native grep would have found nothing in it.
    if (allIndexedFiles.length === 0) {
      return { indexedMatches: [], overlayMatches: [], matchingFiles: [], stats: {
        nativeGrepUsed: true, candidateGenTime_ms: Math.round(performance.now() - start), grepTime_ms: 0,
        literalFilterTime_ms: 0, gramLookupTime_ms: Math.round(gramLookupTime), filesConsidered: 0, filesScanned: 0,
        filesSkipped: 0, dirtyOverlayFiles: 0, candidateFilesBeforeFilter: 0, candidateFilesAfterFilter: 0,
        candidateReductionRatio: 0, literalExtractionHit: literalPlan.clauses.length > 0,
        literalExtractionSource: literalPlan.source, gramLookupReason: 'scope_not_indexed', prefilterDiscarded: false,
        prefilterDiscardedCount: 0, denseGramsTouched: 0, sparseGramsTouched: 0, gramFalsePositiveRatio: 0,
        grepStrategy: 'none', plannerRoute: 'empty_scope', gramSelectivity, symbolTypeFilter, trackerLastIndex: null,
        grepMatches: 0, stageTiming: null,
      } };
    }
  }
  const canNativeGrepAll = Array.isArray(allIndexedFiles) && allIndexedFiles.length > 0;

  const skipLiteralPrefilter = gramTooBroad || gramSaysBroad || canNativeGrepAll;

  // Literal prefilter: only runs when native grep on all files is not available
  const literalNarrowMaxFiles = options.literalNarrowMaxFiles ?? 2048;
  const literalNarrowMaxRatio = options.literalNarrowMaxRatio ?? 0.40;
  let prefilterDiscarded = false;
  let prefilterDiscardedCount = 0;

  const skipInFilesOnly = options.filesOnlyMode ?? false;
  if (literalPlan.clauses.length > 0 && !usingGramCandidates && !skipLiteralPrefilter && !skipInFilesOnly) {
    const literalStart = performance.now();

    const sparseForPrefilter = globs.length === 0 ? ensureSparseGramIndex(searcher, options) : null;
    const prefilterFiles = sparseForPrefilter ? getSparseGramAllFilesWithOverlay(searcher, sparseForPrefilter, options) : null;

    if (prefilterFiles && prefilterFiles.length > 0) {
      const combined = new Set();
      for (const clause of prefilterClauses.ascii) {
        if (!Array.isArray(clause) || clause.length === 0) { combined.clear(); break; }
        const result = nativeGrepFilesWithMatchesFixed(clause, searchDir, prefilterFiles, caseInsensitive);
        if (result) {
          for (const f of result.matchingFiles) combined.add(f);
        } else {
          combined.clear();
          break;
        }
      }
      filteredFiles = combined.size > 0 ? [...combined] : null;
    } else {
      filteredFiles = await runLiteralPrefilterClauses(prefilterClauses.rg, searchDir, searchFiles, {
        caseInsensitive,
        globs,
      }, { getRgCapabilities: _getRgCapabilities, runRipgrepFilesWithMatches });
    }

    literalFilterTime = performance.now() - literalStart;
    candidateFilesAfterFilter = Array.isArray(filteredFiles) ? filteredFiles.length : candidateFilesAfterFilter;

    if (Array.isArray(filteredFiles)) {
      const totalCorpusFiles = gramLookupResult?.totalFiles || 0;
      const exceedsAbsolute = filteredFiles.length > literalNarrowMaxFiles;
      const exceedsRatio = totalCorpusFiles > 0 && (filteredFiles.length / totalCorpusFiles) > literalNarrowMaxRatio;
      if (exceedsAbsolute || exceedsRatio) {
        prefilterDiscardedCount = filteredFiles.length;
        prefilterDiscarded = true;
        filteredFiles = null;
      }
    }
  }

  // ==========================================================================
  // Cost-model query planner
  // ==========================================================================

  let plannerRoute;
  let grepStrategy;

  const hasNarrowedFiles = Array.isArray(filteredFiles) && filteredFiles.length > 0;

  if (!hasNarrowedFiles) {
    plannerRoute = 'raw_rg';
    if (prefilterDiscarded) {
      plannerRoute += ':prefilter_discarded';
      grepStrategy = 'direct_json_prefilter_discarded';
    } else if (gramTooBroad) {
      plannerRoute += ':gram_too_broad';
      grepStrategy = 'direct_json_gram_too_broad';
    } else if (gramSaysBroad) {
      plannerRoute += ':gram_selectivity_broad';
      grepStrategy = 'direct_json_gram_selectivity_broad';
    } else {
      grepStrategy = 'direct_json';
    }
  } else if (filteredFiles.length <= narrowedThreshold) {
    plannerRoute = `narrowed_json:${filteredFiles.length}_files`;
    if (gramSelectivity !== null && gramSelectivity < 0.01) {
      plannerRoute += ':high_selectivity';
    }
    grepStrategy = 'narrowed_json';
  } else if (filteredFiles.length <= directJsonThreshold) {
    plannerRoute = `two_pass:${filteredFiles.length}_files`;
    grepStrategy = 'two_pass';
  } else if (!fixedString && globs.length === 0) {
    // The threshold bounds a ripgrep file list; native grep reads only the candidates, however
    // many (they hold every file that can match), not every indexed file.
    plannerRoute = `two_pass:${filteredFiles.length}_files`;
    grepStrategy = 'two_pass';
  } else {
    plannerRoute = `raw_rg:${filteredFiles.length}_files_exceeds_threshold`;
    grepStrategy = 'direct_json';
    filteredFiles = null;
  }

  // --- Execute chosen strategy ---

  const grepStart = performance.now();
  let matchingFiles = [];
  let indexedMatches = [];
  let fileTotals = null;
  let aliasVerdicts = null;

  const canUseNativeGrep = !fixedString && globs.length === 0 && hasNarrowedFiles;

  if (grepStrategy === 'narrowed_json') {
    let nativeGrepSucceeded = false;
    if (canUseNativeGrep) {
      const nativeResult = lightweightParse
        ? nativeGrepLines(regex, searchDir, filteredFiles, caseInsensitive)
        : nativeGrepFull(regex, searchDir, filteredFiles, caseInsensitive, { perFileCap, indexPaths: true });
      if (nativeResult) {
        indexedMatches = normalizeNativeMatches(nativeResult.matches, searchDir);
        if (perFileCap > 0) fileTotals = normalizeNativeTotals([nativeResult], searchDir);
        aliasVerdicts = normalizeNativeVerdicts([nativeResult], searchDir);
        matchingFiles = [...new Set(indexedMatches.map((m) => m.file))];
        nativeGrepSucceeded = true;
      }
    }
    if (!nativeGrepSucceeded && filteredFiles.length > 0) {
      indexedMatches = await runRipgrepJson(regex, searchDir, {
        files: filteredFiles,
        fixedString,
        caseInsensitive: rgCaseInsensitive,
        globs,
        lightweightParse,
      });
      matchingFiles = [...new Set(indexedMatches.map((match) => match.file))];
    }
  } else if (grepStrategy === 'two_pass') {
    // Both passes from one read of each file; null = the addon cannot, so run them apart.
    const onePass = canUseNativeGrep
      ? nativeGrepWithFiles(regex, searchDir, filteredFiles, caseInsensitive, { linesOnly: lightweightParse, perFileCap, indexPaths: true })
      : null;
    const nativeFilesResult = onePass ?? (canUseNativeGrep
      ? nativeGrepFilesWithMatches(regex, searchDir, filteredFiles, caseInsensitive)
      : null);
    matchingFiles = nativeFilesResult
      ? nativeFilesResult.matchingFiles
      : await runRipgrepFilesWithMatches(regex, searchDir, {
        files: filteredFiles,
        fixedString,
        caseInsensitive: rgCaseInsensitive,
        globs,
      });
    if (onePass) {
      indexedMatches = normalizeNativeMatches(onePass.matches, searchDir);
      if (perFileCap > 0) fileTotals = normalizeNativeTotals([onePass], searchDir);
      aliasVerdicts = normalizeNativeVerdicts([onePass], searchDir);
    } else if (matchingFiles.length > 0) {
      let nativePass2 = false;
      if (canUseNativeGrep) {
        const nativeResult = lightweightParse
          ? nativeGrepLines(regex, searchDir, matchingFiles, caseInsensitive)
          : nativeGrepFull(regex, searchDir, matchingFiles, caseInsensitive, { perFileCap, indexPaths: true });
        if (nativeResult) {
          indexedMatches = normalizeNativeMatches(nativeResult.matches, searchDir);
          if (perFileCap > 0) fileTotals = normalizeNativeTotals([nativeResult], searchDir);
          aliasVerdicts = normalizeNativeVerdicts([nativeResult], searchDir);
          nativePass2 = true;
        }
      }
      if (!nativePass2) {
        indexedMatches = await runRipgrepJson(regex, searchDir, {
          files: matchingFiles,
          fixedString,
          caseInsensitive: rgCaseInsensitive,
          globs,
          lightweightParse,
        });
      }
    }
  } else if (canNativeGrepAll) {
    const nativeResult = lightweightParse
      ? nativeGrepLines(regex, searchDir, allIndexedFiles, caseInsensitive)
      : nativeGrepFull(regex, searchDir, allIndexedFiles, caseInsensitive, { perFileCap, indexPaths: true });
    if (nativeResult) {
      indexedMatches = normalizeNativeMatches(nativeResult.matches, searchDir);
      if (perFileCap > 0) fileTotals = normalizeNativeTotals([nativeResult], searchDir);
      aliasVerdicts = normalizeNativeVerdicts([nativeResult], searchDir);
      matchingFiles = [...new Set(indexedMatches.map((m) => m.file))];
      grepStrategy = 'native_grep_all';
      plannerRoute = `native_grep_all:${allIndexedFiles.length}_files`;
    } else {
      indexedMatches = await runRipgrepJson(regex, searchDir, {
        files: filteredFiles,
        fixedString,
        caseInsensitive: rgCaseInsensitive,
        globs,
        lightweightParse,
      });
      matchingFiles = [...new Set(indexedMatches.map((match) => match.file))];
    }
  } else {
    indexedMatches = await runRipgrepJson(regex, searchDir, {
      files: filteredFiles,
      fixedString,
      caseInsensitive: rgCaseInsensitive,
      globs,
      lightweightParse,
    });
    matchingFiles = [...new Set(indexedMatches.map((match) => match.file))];
  }

  const grepTime = performance.now() - grepStart;
  const totalMatches = indexedMatches.length;

  const effectiveFilesScanned = prefilterDiscarded
    ? null
    : (Array.isArray(filteredFiles) ? filteredFiles.length : null);

  return {
    indexedMatches,
    overlayMatches: [],
    matchingFiles,
    ...(fileTotals ? { fileTotals } : {}),
    ...(aliasVerdicts ? { aliasVerdicts } : {}),
    stats: {
      nativeGrepUsed: canUseNativeGrep || grepStrategy === 'native_grep_all',
      candidateGenTime_ms: Math.round(performance.now() - start),
      grepTime_ms: Math.round(grepTime),
      literalFilterTime_ms: Math.round(literalFilterTime),
      gramLookupTime_ms: Math.round(gramLookupTime),
      filesConsidered: gramLookupResult?.totalFiles ?? (Array.isArray(searchFiles) ? searchFiles.length : 0),
      filesScanned: effectiveFilesScanned,
      filesSkipped: Array.isArray(searchFiles) && Array.isArray(filteredFiles)
        ? Math.max(0, searchFiles.length - filteredFiles.length)
        : 0,
      dirtyOverlayFiles: 0,
      candidateFilesBeforeFilter,
      candidateFilesAfterFilter,
      candidateReductionRatio: candidateFilesBeforeFilter > 0
        ? 1 - (candidateFilesAfterFilter / candidateFilesBeforeFilter)
        : 0,
      literalExtractionHit: literalPlan.clauses.length > 0,
      literalExtractionSource: literalPlan.source,
      gramLookupReason: gramLookupResult?.reason || 'not_run',
      prefilterDiscarded,
      prefilterDiscardedCount,
      denseGramsTouched: gramLookupResult?.denseGramsTouched || 0,
      sparseGramsTouched: gramLookupResult?.sparseGramsTouched || 0,
      gramFalsePositiveRatio: Array.isArray(searchFiles) && searchFiles.length > 0
        ? 1 - (matchingFiles.length / searchFiles.length)
        : 0,
      grepStrategy,
      plannerRoute,
      gramSelectivity,
      plannerInputs: {
        narrowedFileCount: hasNarrowedFiles ? filteredFiles?.length ?? 0 : 0,
        gramCandidateFiles: gramCandidateFiles,
        gramTotalFiles: gramTotalFiles,
        narrowedThreshold,
        directJsonThreshold,
        skipLiteralPrefilter,
      },
      symbolTypeFilter,
      trackerLastIndex: null,
      grepMatches: totalMatches,
      stageTiming: {
        literalExtractionTime_ms: +literalExtractionTime.toFixed(3),
        gramQueryTime_ms: +gramLookupTime.toFixed(3),
        regexBuildTime_ms: 0,
        literalPrefilterTime_ms: +literalFilterTime.toFixed(3),
        plannerTime_ms: 0,
        grepVerifyTime_ms: +grepTime.toFixed(3),
        napiOverheadTime_ms: 0,
        resultMaterializationTime_ms: 0,
      },
    },
  };
}
