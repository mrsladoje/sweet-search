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
  extractLiteralClauses, runLiteralPrefilterClauses, querySparseGramCandidates,
  ensureSparseGramIndex,
  sparseDeltaOverlayHasChanges, getSparseGramAllFilesWithOverlay,
  hasCaseInsensitiveRegexFlag, nativeGrepFilesWithMatches,
  nativeGrepFilesWithMatchesFixed, nativeGrepLines, nativeGrepFull,
  queryAndGrepLines, queryAndGrepFull,
  searchLines, searchFull, resolveSparseSymbolMask,
} from './search-pattern-prefilter.js';
import { CODE_FILE_EXTENSIONS } from '../infrastructure/constants.js';
import { resolveSearchSymbolFilter } from './search-pattern-chunks.js';
import { _getRgCapabilities, runRipgrepFilesWithMatches, runRipgrepJson, normalizeSearchPath } from './search-pattern-ripgrep.js';

/**
 * Normalize match file paths from native grep (which returns absolute paths)
 * to relative paths matching the chunk location map keys.
 *
 * The ripgrep JSON parser already calls normalizeSearchPath per match.
 * Native grep bypasses ripgrep, so we must normalize here.
 */
function normalizeNativeMatches(matches, searchDir) {
  const out = [];
  for (const m of matches || []) {
    const file = normalizeSearchPath(searchDir, m.file);
    if (file) out.push({ ...m, file });
  }
  return out;
}

// Cached once at module load — passed to Rust for code extension filtering.
const _codeExtensionsArray = Array.from(CODE_FILE_EXTENSIONS);

// =============================================================================
// Core pipeline — regex candidate generation
// =============================================================================

export async function generateRegexMatches(searcher, regex, searchDir, options = {}) {
  const start = performance.now();
  const fixedString = options.fixedString ?? false;
  const globs = options.globs ?? [];

  const useLiteralFilter = options.useLiteralFilter ?? options.literalFilter ?? true;
  const caseInsensitive = hasCaseInsensitiveRegexFlag(regex);
  const literalExtractStart = performance.now();
  const literalPlan = useLiteralFilter ? extractLiteralClauses(regex, options) : { clauses: [], source: 'none' };
  const literalExtractionTime = performance.now() - literalExtractStart;
  const symbolTypeFilter = resolveSearchSymbolFilter(options);
  const lightweightParse = options.lightweightParse ?? false;

  // --- Unified search: single NAPI call handles gram narrowing + all-files fallback ---
  // Eligible when: not fixed-string, no globs, gram index loaded.
  // Rust internally: tries gram narrowing → if eligible, greps candidates; if not, greps all files.
  // Eliminates the JS planner, separate getSparseGramAllFiles call, and multiple NAPI crossings.
  const useGramIndex = options.useGramIndex ?? options.gramIndex ?? true;
  const hasSparseDeltaOverlay = sparseDeltaOverlayHasChanges(searcher, options);
  const canUseUnifiedSearch = !fixedString && globs.length === 0 && !hasSparseDeltaOverlay;
  if (canUseUnifiedSearch) {
    const sparseGramIndex = ensureSparseGramIndex(searcher, options);
    if (sparseGramIndex) {
      const symbolMask = resolveSparseSymbolMask(symbolTypeFilter);
      const gramStart = performance.now();
      const unifiedResult = lightweightParse
        ? searchLines(sparseGramIndex, literalPlan.clauses, regex, searchDir, {
            maxGramCandidates: options.maxGramCandidates ?? 0,
            symbolMask: symbolMask || 0,
            caseInsensitive,
            codeExtensions: _codeExtensionsArray,
            maxCandidateFiles: options.maxGramCandidateFiles ?? 100000,
            maxCandidateRatio: options.maxGramCandidateRatio ?? 1.0,
          })
        : searchFull(sparseGramIndex, literalPlan.clauses, regex, searchDir, {
            maxGramCandidates: options.maxGramCandidates ?? 0,
            symbolMask: symbolMask || 0,
            caseInsensitive,
            codeExtensions: _codeExtensionsArray,
            maxCandidateFiles: options.maxGramCandidateFiles ?? 100000,
            maxCandidateRatio: options.maxGramCandidateRatio ?? 1.0,
          });

      if (unifiedResult) {
        const gramLookupTime = performance.now() - gramStart;
        const materializeStart = performance.now();
        const indexedMatches = normalizeNativeMatches(unifiedResult.matches, searchDir);
        const matchingFiles = [...new Set(indexedMatches.map((m) => m.file))];
        const materializeTime = performance.now() - materializeStart;
        const candidateFiles = unifiedResult.candidateFiles;
        const totalFiles = unifiedResult.totalFiles;
        const gramNarrowed = candidateFiles < totalFiles;
        const rustGramMs = (unifiedResult.gramElapsedUs || 0) / 1000;
        const rustRegexBuildMs = (unifiedResult.regexBuildElapsedUs || 0) / 1000;
        const rustGrepMs = (unifiedResult.grepElapsedUs || 0) / 1000;
        const napiOverheadMs = gramLookupTime - rustGramMs - rustRegexBuildMs - rustGrepMs;
        const strategy = gramNarrowed ? 'unified_gram_grep' : 'unified_grep_all';
        return {
          indexedMatches,
          overlayMatches: [],
          matchingFiles,
          stats: {
            nativeGrepUsed: true,
            candidateGenTime_ms: Math.round(performance.now() - start),
            grepTime_ms: Math.round(rustGrepMs),
            literalFilterTime_ms: 0,
            gramLookupTime_ms: Math.round(gramLookupTime),
            filesConsidered: totalFiles,
            filesScanned: unifiedResult.scannedFiles,
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

  if (literalPlan.clauses.length > 0) {
    const gramStart = performance.now();
    gramLookupResult = querySparseGramCandidates(searcher, literalPlan.clauses, options);
    gramLookupTime = performance.now() - gramStart;
    if (Array.isArray(gramLookupResult?.files)) {
      searchFiles = gramLookupResult.files;
    }
  }

  // --- Optimization #3: compute gram selectivity for planning ---
  const gramCandidateFiles = gramLookupResult?.candidateFiles || 0;
  const gramTotalFiles = gramLookupResult?.totalFiles || 0;
  const gramSelectivity = gramTotalFiles > 0 ? gramCandidateFiles / gramTotalFiles : null;
  const narrowedThreshold = options.narrowedJsonThreshold ?? 300;
  const directJsonThreshold = options.directJsonFileThreshold ?? 4096;

  if (gramLookupResult?.eligible === true && Array.isArray(gramLookupResult.files) && gramLookupResult.files.length === 0) {
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
  const allIndexedFiles = sparseForAllFiles
    ? getSparseGramAllFilesWithOverlay(searcher, sparseForAllFiles, options)
    : null;
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
      for (const clause of literalPlan.clauses) {
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
      filteredFiles = await runLiteralPrefilterClauses(literalPlan.clauses, searchDir, searchFiles, {
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
  } else {
    plannerRoute = `raw_rg:${filteredFiles.length}_files_exceeds_threshold`;
    grepStrategy = 'direct_json';
    filteredFiles = null;
  }

  // --- Execute chosen strategy ---

  const grepStart = performance.now();
  let matchingFiles = [];
  let indexedMatches = [];

  const canUseNativeGrep = !fixedString && globs.length === 0 && hasNarrowedFiles;

  if (grepStrategy === 'narrowed_json') {
    let nativeGrepSucceeded = false;
    if (canUseNativeGrep) {
      const nativeResult = lightweightParse
        ? nativeGrepLines(regex, searchDir, filteredFiles, caseInsensitive)
        : nativeGrepFull(regex, searchDir, filteredFiles, caseInsensitive);
      if (nativeResult) {
        indexedMatches = normalizeNativeMatches(nativeResult.matches, searchDir);
        matchingFiles = [...new Set(indexedMatches.map((m) => m.file))];
        nativeGrepSucceeded = true;
      }
    }
    if (!nativeGrepSucceeded && filteredFiles.length > 0) {
      indexedMatches = await runRipgrepJson(regex, searchDir, {
        files: filteredFiles,
        fixedString,
        globs,
        lightweightParse,
      });
      matchingFiles = [...new Set(indexedMatches.map((match) => match.file))];
    }
  } else if (grepStrategy === 'two_pass') {
    const nativeFilesResult = canUseNativeGrep
      ? nativeGrepFilesWithMatches(regex, searchDir, filteredFiles, caseInsensitive)
      : null;
    matchingFiles = nativeFilesResult
      ? nativeFilesResult.matchingFiles
      : await runRipgrepFilesWithMatches(regex, searchDir, {
        files: filteredFiles,
        fixedString,
        globs,
      });
    if (matchingFiles.length > 0) {
      let nativePass2 = false;
      if (canUseNativeGrep) {
        const nativeResult = lightweightParse
          ? nativeGrepLines(regex, searchDir, matchingFiles, caseInsensitive)
          : nativeGrepFull(regex, searchDir, matchingFiles, caseInsensitive);
        if (nativeResult) {
          indexedMatches = normalizeNativeMatches(nativeResult.matches, searchDir);
          nativePass2 = true;
        }
      }
      if (!nativePass2) {
        indexedMatches = await runRipgrepJson(regex, searchDir, {
          files: matchingFiles,
          fixedString,
          globs,
          lightweightParse,
        });
      }
    }
  } else if (canNativeGrepAll) {
    const nativeResult = lightweightParse
      ? nativeGrepLines(regex, searchDir, allIndexedFiles, caseInsensitive)
      : nativeGrepFull(regex, searchDir, allIndexedFiles, caseInsensitive);
    if (nativeResult) {
      indexedMatches = normalizeNativeMatches(nativeResult.matches, searchDir);
      matchingFiles = [...new Set(indexedMatches.map((m) => m.file))];
      grepStrategy = 'native_grep_all';
      plannerRoute = `native_grep_all:${allIndexedFiles.length}_files`;
    } else {
      indexedMatches = await runRipgrepJson(regex, searchDir, {
        files: filteredFiles,
        fixedString,
        globs,
        lightweightParse,
      });
      matchingFiles = [...new Set(indexedMatches.map((match) => match.file))];
    }
  } else {
    indexedMatches = await runRipgrepJson(regex, searchDir, {
      files: filteredFiles,
      fixedString,
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
