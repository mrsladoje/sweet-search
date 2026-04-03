/**
 * Pattern Search Module — ColGrep-style hybrid regex + semantic ranking.
 *
 * Pipeline:
 *   1. parallel(ripgrep scan, encodeQuery)
 *   2. Map file:line matches → indexed chunk IDs via interval map
 *   3. MaxSim rerank using pre-indexed late interaction token embeddings
 *   4. Assemble results with file content
 *
 * Extracted module — functions using `this` are wired onto SweetSearch.prototype.
 *
 * References: docs/COLGREP_PLAN.md
 */

import { PROJECT_ROOT } from '../infrastructure/config/index.js';

// Sub-module imports (no circular dependency — sub-modules do not import from this file)
import { extractLiteralClauses, runLiteralPrefilterClauses, querySparseGramCandidates, hasCaseInsensitiveRegexFlag } from './search-pattern-prefilter.js';
import { buildBareGrepResults, filterMatchesBySymbolType, resolveSearchSymbolFilter, mapMatchesToChunks, readFileRange } from './search-pattern-chunks.js';
import { isRipgrepAvailable, _getRgCapabilities, runRipgrepFilesWithMatches, runRipgrepJson, normalizeSearchPath, chunkRipgrepFiles } from './search-pattern-ripgrep.js';

// =============================================================================
// Core pipeline — regex candidate generation
// =============================================================================

async function generateRegexMatches(searcher, regex, searchDir, options = {}) {
  const start = performance.now();
  const fixedString = options.fixedString ?? false;
  const globs = options.globs ?? [];

  const useLiteralFilter = options.useLiteralFilter ?? options.literalFilter ?? true;
  const caseInsensitive = hasCaseInsensitiveRegexFlag(regex);
  const literalPlan = useLiteralFilter ? extractLiteralClauses(regex, options) : { clauses: [], source: 'none' };
  const symbolTypeFilter = resolveSearchSymbolFilter(options);
  let searchFiles = null;
  let gramLookupTime = 0;
  let gramLookupResult = null;

  // --- Step 1-2: Extract literals + query gram index ---
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

  const candidateFilesBeforeFilter = Array.isArray(searchFiles) ? searchFiles.length : 0;
  let candidateFilesAfterFilter = Array.isArray(searchFiles) ? searchFiles.length : 0;
  let literalFilterTime = 0;
  let filteredFiles = searchFiles;
  const usingGramCandidates = Array.isArray(searchFiles);
  const gramTooBroad = gramLookupResult?.eligible === false && gramLookupResult?.reason === 'too_broad';

  // --- Optimization #4: use gram DF stats to skip literal prefilter when broad ---
  // If the gram index says the query is broad (selectivity > 0.10), skip the
  // literal prefilter entirely — it costs process spawns and the result will
  // be discarded anyway. Go straight to raw rg.
  const gramSaysBroad = gramSelectivity !== null && gramSelectivity > 0.10;
  const skipLiteralPrefilter = gramTooBroad || gramSaysBroad;

  // Literal prefilter: run when the gram index didn't already narrow the set
  // AND the gram stats don't indicate a broad query.
  // After running, discard the file list if it didn't meaningfully narrow —
  // passing thousands of explicit file paths via batched spawns is far slower
  // than a single `rg .` invocation.
  const literalNarrowMaxFiles = options.literalNarrowMaxFiles ?? 500;
  const literalNarrowMaxRatio = options.literalNarrowMaxRatio ?? 0.15;
  let prefilterDiscarded = false;
  let prefilterDiscardedCount = 0;

  if (literalPlan.clauses.length > 0 && !usingGramCandidates && !skipLiteralPrefilter) {
    const literalStart = performance.now();
    // Pass rg functions to avoid circular import in the prefilter sub-module.
    filteredFiles = await runLiteralPrefilterClauses(literalPlan.clauses, searchDir, searchFiles, {
      caseInsensitive,
      globs,
    }, { getRgCapabilities: _getRgCapabilities, runRipgrepFilesWithMatches });
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
  // Optimization #1: Cost-model query planner
  //
  // Chooses between three strategies based on available signals:
  //   Strategy A (raw_rg):       single `rg --json <regex> .` on the whole tree
  //   Strategy B (narrowed_json): single `rg --json <regex> <files...>` on narrowed set
  //   Strategy C (two_pass):     `rg --files-with-matches` then `rg --json` on matches
  //
  // Decision logic:
  //   - No narrowing happened → Strategy A
  //   - Narrowed set ≤ 100 files → Strategy B (skip double-verify, Optimization #2)
  //   - Narrowed set > 100 and ≤ 2048 → Strategy C (two_pass)
  //   - Narrowed set > 2048 → Strategy A (too many files for explicit args)
  //
  // Optimization #3 override: gram selectivity < 0.01 prefers narrowed even if
  // file count is moderate; selectivity > 0.10 forces raw_rg.
  // ==========================================================================

  const narrowedThreshold = options.narrowedJsonThreshold ?? 100;
  const directJsonThreshold = options.directJsonFileThreshold ?? 2048;

  let plannerRoute;
  let grepStrategy;

  const hasNarrowedFiles = Array.isArray(filteredFiles) && filteredFiles.length > 0;

  if (!hasNarrowedFiles) {
    // No narrowing happened (no gram index, no literal prefilter, or prefilter discarded)
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
    // Optimization #2: ≤100 files — skip double-verify, go straight to JSON
    plannerRoute = `narrowed_json:${filteredFiles.length}_files`;
    if (gramSelectivity !== null && gramSelectivity < 0.01) {
      plannerRoute += ':high_selectivity';
    }
    grepStrategy = 'narrowed_json';
  } else if (filteredFiles.length <= directJsonThreshold) {
    // Two-pass: files-with-matches first to reduce JSON output
    plannerRoute = `two_pass:${filteredFiles.length}_files`;
    grepStrategy = 'two_pass';
  } else {
    // Too many files for explicit args — fall back to raw rg
    plannerRoute = `raw_rg:${filteredFiles.length}_files_exceeds_threshold`;
    grepStrategy = 'direct_json';
    filteredFiles = null; // Don't pass explicit file list
  }

  // --- Execute chosen strategy ---

  // TODO: chunk-level secondary index would reduce downstream mapping cost
  // for broad files with many line matches. Currently gram index is per-file only.
  // (Optimization #6 — plan only)

  const grepStart = performance.now();
  let matchingFiles = [];
  let indexedMatches = [];

  if (grepStrategy === 'narrowed_json') {
    // Strategy B: single pass, no double-verify (Optimization #2)
    indexedMatches = await runRipgrepJson(regex, searchDir, {
      files: filteredFiles,
      fixedString,
      globs,
    });
    matchingFiles = [...new Set(indexedMatches.map((match) => match.file))];
  } else if (grepStrategy === 'two_pass') {
    // Strategy C: files-with-matches first, then JSON on matches
    matchingFiles = await runRipgrepFilesWithMatches(regex, searchDir, {
      files: filteredFiles,
      fixedString,
      globs,
    });
    indexedMatches = matchingFiles.length > 0
      ? await runRipgrepJson(regex, searchDir, {
        files: matchingFiles,
        fixedString,
        globs,
      })
      : [];
  } else {
    // Strategy A: raw rg on the whole tree (or too-many-files fallback)
    indexedMatches = await runRipgrepJson(regex, searchDir, {
      files: filteredFiles,
      fixedString,
      globs,
    });
    matchingFiles = [...new Set(indexedMatches.map((match) => match.file))];
  }

  const grepTime = performance.now() - grepStart;
  const totalMatches = indexedMatches.length;

  // Stats: when the prefilter was discarded, report what actually happened —
  // the prefilter ran but its output was too broad to be useful, so grep
  // reverted to a full tree scan. Use null (not 0) to signal "unknown /
  // not applicable" — 0 would silently bias numeric averages downward.
  const effectiveFilesScanned = prefilterDiscarded
    ? null
    : (Array.isArray(filteredFiles) ? filteredFiles.length : null);

  // Optimization #5 note: --vimgrep output mode was considered for lighter
  // parsing (~3x smaller than --json), but colons in file paths break the
  // colon-delimited split. The existing --json output avoids this problem
  // and is used exclusively. See docstring on `runRipgrep`.

  const result = {
    indexedMatches,
    overlayMatches: [],
    stats: {
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
      // Raw planner inputs for threshold tuning (log these in benchmarks):
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
    },
  };

  return result;
}

/**
 * Run ripgrep with a regex pattern against a directory or explicit file set.
 * Uses --json output to avoid colon-delimiter parsing issues with
 * paths containing colons (Windows, exotic filenames).
 *
 * @param {string} regex - The regex pattern to search for
 * @param {string} searchDir - Directory to search in
 * @param {Object} [opts] - Options
 * @param {number} [opts.maxMatches=0] - Optional post-filter line cap (0 disables)
 * @param {number} [opts.timeout=10000] - Timeout in ms
 * @param {string[]|null} [opts.files=null] - Explicit relative file paths to search
 * @returns {Promise<Array<{file: string, line: number, content: string}>>}
 */
export async function runRipgrep(regex, searchDir, opts = {}) {
  const {
    maxMatches = 0,
    fixedString = false,
    globs = [],
    timeout = 10000,
    files = null,
  } = opts;

  const matches = await runRipgrepJson(regex, searchDir, { files, fixedString, globs, timeout });
  return maxMatches > 0 ? matches.slice(0, maxMatches) : matches;
}

// =============================================================================
// Query enhancement — merge regex tokens into semantic query (ColGrep-style)
// =============================================================================

/**
 * Strip regex metacharacters and extract readable tokens from a pattern.
 * E.g., "class\\s+\\w+" -> ["class"], "export async function\\s+\\w+" -> ["export", "async", "function"]
 *
 * @param {string} regex
 * @returns {string[]} Readable tokens
 */
export function extractRegexTokens(regex) {
  return regex
    .replace(/\\[sSdDwWbB]/g, ' ')     // \s, \w, \d, \b -> space
    .replace(/\\[.*+?^${}()|[\]\\]/g, '') // escaped metacharacters -> remove
    .replace(/[.*+?^${}()|[\]\\]/g, ' ') // raw metacharacters -> space
    .split(/\s+/)
    .filter(t => t.length > 1)           // drop single chars
    .map(t => t.toLowerCase());
}

/**
 * Merge unique regex tokens into the semantic query.
 * Avoids duplicating tokens already present in the query.
 *
 * @param {string} query - Semantic query
 * @param {string} regex - Regex pattern
 * @returns {string} Enhanced query
 */
export function mergeRegexIntoQuery(query, regex) {
  const regexTokens = extractRegexTokens(regex);
  if (regexTokens.length === 0) return query;

  const queryLower = query.toLowerCase();
  const novel = regexTokens.filter(t => !queryLower.includes(t));
  if (novel.length === 0) return query;

  return `${query} ${novel.join(' ')}`;
}

// =============================================================================
// Bare grep (wired onto SweetSearch.prototype)
// =============================================================================

export async function bareGrep(query, routing, options = {}) {
  const regex = options.regex || query;
  const searchDir = this?.projectRoot || options.projectRoot || PROJECT_ROOT;
  const maxMatches = options.maxMatches ?? 0;
  const start = performance.now();
  const symbolType = resolveSearchSymbolFilter(options);

  void routing;

  if (!regex) {
    throw new Error('Bare grep requires a regex or fixed-string pattern.');
  }

  if (!await isRipgrepAvailable()) {
    throw new Error('Bare grep requires ripgrep (rg). Install: brew install ripgrep');
  }

  const candidateResult = await generateRegexMatches(this || {}, regex, searchDir, options);
  let matches = [...candidateResult.indexedMatches, ...candidateResult.overlayMatches];
  matches = filterMatchesBySymbolType(matches, symbolType, this);
  matches.sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    (a.column || 0) - (b.column || 0)
  );

  const totalMatches = matches.length;
  if (maxMatches > 0) {
    matches = matches.slice(0, maxMatches);
  }

  const results = buildBareGrepResults(matches, {
    projectRoot: searchDir,
    contextLines: options.contextLines ?? 0,
  });

  return {
    results,
    stats: {
      path: 'grep',
      regex,
      fixedString: options.fixedString ?? false,
      contextLines: options.contextLines ?? 0,
      totalMatches,
      returnedMatches: results.length,
      candidateGenTime_ms: candidateResult.stats.candidateGenTime_ms,
      grepTime_ms: candidateResult.stats.grepTime_ms,
      literalFilterTime_ms: candidateResult.stats.literalFilterTime_ms,
      gramLookupTime_ms: candidateResult.stats.gramLookupTime_ms,
      filesConsidered: candidateResult.stats.filesConsidered,
      filesScanned: candidateResult.stats.filesScanned,
      filesSkipped: candidateResult.stats.filesSkipped,
      dirtyOverlayFiles: candidateResult.stats.dirtyOverlayFiles,
      candidateFilesBeforeFilter: candidateResult.stats.candidateFilesBeforeFilter,
      candidateFilesAfterFilter: candidateResult.stats.candidateFilesAfterFilter,
      candidateReductionRatio: candidateResult.stats.candidateReductionRatio,
      literalExtractionHit: candidateResult.stats.literalExtractionHit,
      literalExtractionSource: candidateResult.stats.literalExtractionSource,
      denseGramsTouched: candidateResult.stats.denseGramsTouched,
      sparseGramsTouched: candidateResult.stats.sparseGramsTouched,
      gramFalsePositiveRatio: candidateResult.stats.gramFalsePositiveRatio,
      symbolType,
      total_ms: Math.round(performance.now() - start),
    },
  };
}

// =============================================================================
// Pattern search orchestrator (wired onto SweetSearch.prototype)
// =============================================================================

/**
 * Pattern search: regex candidate generation + MaxSim semantic ranking.
 *
 * Uses `this` — must be wired onto SweetSearch.prototype.
 *
 * @param {string} query - Semantic query for ranking
 * @param {Object} routing - Routing info (unused for pattern, kept for interface parity)
 * @param {Object} options - Search options
 * @param {string} options.regex - Regex pattern for candidate generation (required)
 * @param {number} [options.k=10] - Number of results
 * @returns {Promise<{results: Array, stats: Object}>}
 */
export async function patternSearch(query, routing, options = {}) {
  const {
    regex,
    k = 10,
  } = options;

  if (!regex) {
    throw new Error('Pattern search requires a regex. Use --regex or -e to specify one.');
  }

  const start = performance.now();
  const log = this.verbose ? (...args) => console.error('[Pattern]', ...args) : () => {};

  // Check cheap local prerequisites first, then async external ones
  if (!this.hasLateInteractionIndex) {
    throw new Error('Pattern search requires a late interaction index. Re-index with late interaction enabled.');
  }

  if (!await isRipgrepAvailable()) {
    throw new Error('Pattern search requires ripgrep (rg). Install: brew install ripgrep');
  }

  await this.lateInteractionIndex.init();

  // Get cached chunk location map (built once, reused across queries)
  const mapStart = performance.now();
  const locationMap = this.getChunkLocationMap();
  const mapTime = performance.now() - mapStart;
  if (this.lateInteractionIndex.documents.size > 0 && locationMap.size === 0) {
    throw new Error(
      'Pattern search requires a late interaction index with line spans. Re-index with late interaction enabled.'
    );
  }
  log(`Chunk location map: ${locationMap.size} files in ${mapTime.toFixed(1)}ms`);

  // Parallel: candidate generation + query encode
  const { encodeQuery } = await import('../ranking/late-interaction-model.js');
  const searchDir = this.projectRoot || PROJECT_ROOT;

  // Query enhancement: merge regex tokens into the semantic query (ColGrep-style).
  // Strips regex metacharacters and appends unique tokens to give the embedding
  // model structural context alongside the semantic intent.
  const enhanceQuery = options.enhanceQuery ?? true;
  const effectiveQuery = enhanceQuery ? mergeRegexIntoQuery(query, regex) : query;
  log(`Query: "${effectiveQuery}"`);

  const parallelStart = performance.now();
  const [candidateResult, encodedQuery] = await Promise.all([
    generateRegexMatches(this, regex, searchDir, options),
    (async () => {
      const encodeStart = performance.now();
      const tokens = await encodeQuery(effectiveQuery);
      return {
        tokens,
        encodeTime: performance.now() - encodeStart,
      };
    })(),
  ]);
  const parallelTime = performance.now() - parallelStart;
  const grepMatches = candidateResult.indexedMatches;
  const overlayMatches = candidateResult.overlayMatches;
  const queryTokens = encodedQuery.tokens;
  const encodeTime = encodedQuery.encodeTime;
  const totalRawMatches = grepMatches.length + overlayMatches.length;
  log(
    `Parallel phase: ${totalRawMatches} grep matches ` +
    `(${grepMatches.length} indexed, ${overlayMatches.length} overlay), ` +
    `${queryTokens.length} query tokens in ${parallelTime.toFixed(1)}ms`
  );

  if (totalRawMatches === 0) {
    return {
      results: [],
      stats: {
        path: 'pattern',
        regex,
        grepMatches: 0,
        indexedChunks: 0,
        unindexedMatches: 0,
        candidateGenTime_ms: candidateResult.stats.candidateGenTime_ms,
        grepTime_ms: candidateResult.stats.grepTime_ms,
        literalFilterTime_ms: candidateResult.stats.literalFilterTime_ms,
        gramLookupTime_ms: candidateResult.stats.gramLookupTime_ms,
        encodeTime_ms: Math.round(encodeTime),
        filesConsidered: candidateResult.stats.filesConsidered,
        filesScanned: candidateResult.stats.filesScanned,
        filesSkipped: candidateResult.stats.filesSkipped,
        dirtyOverlayFiles: candidateResult.stats.dirtyOverlayFiles,
        candidateFilesBeforeFilter: candidateResult.stats.candidateFilesBeforeFilter,
        candidateFilesAfterFilter: candidateResult.stats.candidateFilesAfterFilter,
        candidateReductionRatio: candidateResult.stats.candidateReductionRatio,
        literalExtractionHit: candidateResult.stats.literalExtractionHit,
        literalExtractionSource: candidateResult.stats.literalExtractionSource,
        gramLookupReason: candidateResult.stats.gramLookupReason,
        denseGramsTouched: candidateResult.stats.denseGramsTouched,
        sparseGramsTouched: candidateResult.stats.sparseGramsTouched,
        gramFalsePositiveRatio: candidateResult.stats.gramFalsePositiveRatio,
        prefilterDiscarded: candidateResult.stats.prefilterDiscarded,
        prefilterDiscardedCount: candidateResult.stats.prefilterDiscardedCount,
        grepStrategy: candidateResult.stats.grepStrategy,
        parallelTime_ms: Math.round(parallelTime),
        total_ms: Math.round(performance.now() - start),
      },
    };
  }

  // Map file:line matches -> indexed chunk IDs (with grep density counts)
  const { chunkIds, chunkMatchCounts, unindexed } = mapMatchesToChunks(grepMatches, locationMap);
  const unindexedMatches = [...unindexed, ...overlayMatches];
  log(`Mapped: ${chunkIds.size} indexed chunks, ${unindexedMatches.length} unindexed matches`);

  // Filter to chunks with token embeddings in the LI index
  let available = this.lateInteractionIndex.hasTokens(chunkIds);
  log(`LI index hits: ${available.size}/${chunkIds.size}`);

  // Chunk-level candidate cap: if too many candidates after dedup, keep
  // the ones with highest grep density (most regex matches in the chunk).
  const maxCandidates = options.maxCandidates ?? 0;  // 0 = no cap (best quality); safety valve at caller level
  if (maxCandidates > 0 && available.size > maxCandidates) {
    const sorted = [...available]
      .map(id => ({ id, count: chunkMatchCounts.get(id) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxCandidates);
    available = new Set(sorted.map(s => s.id));
    log(`Candidate cap: ${available.size} (from ${chunkIds.size}, top by grep density)`);
  }

  // MaxSim rerank + grep density blending
  let scored = [];
  let rerankTime = 0;
  if (available.size > 0 && queryTokens.length > 0) {
    const candidates = [...available].map(id => ({ id }));
    const rerankStart = performance.now();
    scored = await this.lateInteractionIndex.scoreWithLateInteraction(queryTokens, candidates);
    rerankTime = performance.now() - rerankStart;

    // Blend grep density: finalScore = maxSimScore * (1 + a * log(matchCount))
    // a controls how much structural match density influences ranking.
    // log-scaled so a chunk with 50 hits doesn't dominate one with 5.
    const GREP_DENSITY_ALPHA = options.grepDensityAlpha ?? 0;
    for (const s of scored) {
      const matchCount = chunkMatchCounts.get(s.id) || 1;
      s.grepDensity = matchCount;
      s.lateInteractionScore = s.lateInteractionScore * (1 + GREP_DENSITY_ALPHA * Math.log(matchCount));
    }
    // Test demotion (ColGrep-style): penalize test file chunks when the query
    // doesn't mention testing. Prevents test files from drowning out implementations.
    const TEST_DEMOTION = options.testDemotion ?? 0.05;
    if (TEST_DEMOTION > 0) {
      const queryLower = query.toLowerCase();
      const queryMentionsTest = /\btest|spec|describe|it\b/.test(queryLower);
      if (!queryMentionsTest) {
        for (const s of scored) {
          const doc = this.lateInteractionIndex.documents.get(s.id);
          const file = doc?.metadata?.file || '';
          const name = doc?.metadata?.name || '';
          if (/test|spec|__test__|\.test\.|\.spec\./.test(file) ||
              /test|spec/i.test(name)) {
            s.lateInteractionScore -= TEST_DEMOTION;
          }
        }
      }
    }

    scored.sort((a, b) => b.lateInteractionScore - a.lateInteractionScore);

    log(`MaxSim rerank: ${scored.length} candidates in ${rerankTime.toFixed(1)}ms`);
  }

  // Build result objects with metadata + file content (per-search file cache)
  const fileCache = new Map();

  const results = scored.slice(0, k).map((s, rank) => {
    const doc = this.lateInteractionIndex.documents.get(s.id);
    const meta = doc?.metadata || {};
    const text = readFileRange(fileCache, meta.file, meta.startLine, meta.endLine, this.projectRoot);

    return {
      id: s.id,
      file: meta.file || '',
      name: meta.name || null,
      type: meta.type || 'code',
      startLine: meta.startLine || null,
      endLine: meta.endLine || null,
      text: text || '',
      content: text || '',
      score: s.lateInteractionScore,
      lateInteractionScore: s.lateInteractionScore,
      rank: rank + 1,
      indexed: true,
      searchPath: 'pattern',
      metadata: meta,
    };
  });

  // Append unindexed matches at the bottom (lazy fallback -- Plan Phase 3)
  const remaining = Math.max(0, k - results.length);
  if (remaining > 0 && unindexedMatches.length > 0) {
    const seen = new Set(results.map(r => `${r.file}:${r.startLine}`));
    let added = 0;
    for (const m of unindexedMatches) {
      if (added >= remaining) break;
      const key = `${m.file}:${m.line}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        id: `unindexed:${m.file}:${m.line}`,
        file: m.file,
        name: null,
        type: 'code',
        startLine: m.line,
        endLine: m.line,
        text: m.content,
        content: m.content,
        score: 0,
        lateInteractionScore: 0,
        rank: results.length + 1,
        indexed: false,
        searchPath: 'pattern',
        metadata: { file: m.file, startLine: m.line, endLine: m.line },
      });
      added++;
    }
  }

  const totalTime = performance.now() - start;

  // Expose full candidate pipeline for diagnostic evaluation:
  // - allCandidateIds: every chunk that had LI embeddings (pre-MaxSim)
  // - allMappedChunkIds: every chunk mapped from grep (pre-LI filter)
  const allCandidateIds = [...available];
  const allMappedChunkIds = [...chunkIds];

  return {
    results,
    stats: {
      path: 'pattern',
      regex,
      grepMatches: totalRawMatches,
      indexedChunks: available.size,
      unindexedMatches: unindexedMatches.length,
      maxSimCandidates: scored.length,
      locationMapFiles: locationMap.size,
      candidateGenTime_ms: candidateResult.stats.candidateGenTime_ms,
      grepTime_ms: candidateResult.stats.grepTime_ms,
      literalFilterTime_ms: candidateResult.stats.literalFilterTime_ms,
      gramLookupTime_ms: candidateResult.stats.gramLookupTime_ms,
      encodeTime_ms: Math.round(encodeTime),
      mapTime_ms: Math.round(mapTime),
      parallelTime_ms: Math.round(parallelTime),
      rerankTime_ms: Math.round(rerankTime),
      filesConsidered: candidateResult.stats.filesConsidered,
      filesScanned: candidateResult.stats.filesScanned,
      filesSkipped: candidateResult.stats.filesSkipped,
      dirtyOverlayFiles: candidateResult.stats.dirtyOverlayFiles,
      candidateFilesBeforeFilter: candidateResult.stats.candidateFilesBeforeFilter,
      candidateFilesAfterFilter: candidateResult.stats.candidateFilesAfterFilter,
      candidateReductionRatio: candidateResult.stats.candidateReductionRatio,
      literalExtractionHit: candidateResult.stats.literalExtractionHit,
      literalExtractionSource: candidateResult.stats.literalExtractionSource,
      gramLookupReason: candidateResult.stats.gramLookupReason,
      denseGramsTouched: candidateResult.stats.denseGramsTouched,
      sparseGramsTouched: candidateResult.stats.sparseGramsTouched,
      gramFalsePositiveRatio: candidateResult.stats.gramFalsePositiveRatio,
      prefilterDiscarded: candidateResult.stats.prefilterDiscarded,
      prefilterDiscardedCount: candidateResult.stats.prefilterDiscardedCount,
      grepStrategy: candidateResult.stats.grepStrategy,
      trackerLastIndex: candidateResult.stats.trackerLastIndex,
      total_ms: Math.round(totalTime),
      allCandidateIds,
      allMappedChunkIds,
    },
  };
}

// =============================================================================
// Re-export sub-modules for backward compatibility
// (barrel export in index.js uses `export * from './search-pattern.js'`)
// =============================================================================

export { hasCaseInsensitiveRegexFlag, extractRequiredLiteralsHeuristic, extractLiteralClausesHeuristic, extractLiteralClauses, normalizeLiteralClauses, querySparseGramCandidates, ensureSparseGramIndex } from './search-pattern-prefilter.js';
export { buildChunkLocationMap, findChunkForLine, findChunkIntervalForLine, mapMatchesToChunks, readFileRange, getChunkLocationMap, getCodebaseChunkTypeMap, normalizeSearchSymbolType, resolveSearchSymbolFilter, isRipgrepCodePath, buildBareGrepResults, filterMatchesBySymbolType } from './search-pattern-chunks.js';
export { isRipgrepAvailable, _resetRgCache, normalizeSearchPath, chunkRipgrepFiles } from './search-pattern-ripgrep.js';
