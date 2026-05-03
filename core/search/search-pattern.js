/**
 * Pattern Search Module — ColGrep-style hybrid regex + semantic ranking.
 *
 * Pipeline:
 *   1. parallel(ripgrep scan, encodeQuery)
 *   2. Map file:line matches → indexed chunk IDs via interval map
 *   3. MaxSim rerank using pre-indexed late interaction token embeddings
 *   4. Assemble results with file content
 *   5. (Agent mode) Post-ranking context packaging via context-expander.js
 *
 * Query planner (generateRegexMatches) is in search-pattern-planner.js.
 *
 * References: docs/COLGREP_PLAN.md, docs/USEFUL_ANSWER_COLGREP_PLAN.md
 */

import { PROJECT_ROOT } from '../infrastructure/config/index.js';
import { generateRegexMatches } from './search-pattern-planner.js';
import { buildBareGrepResults, filterMatchesBySymbolType, resolveSearchSymbolFilter, mapMatchesToChunks, readFileRange } from './search-pattern-chunks.js';
import { isRipgrepAvailable, runRipgrepJson } from './search-pattern-ripgrep.js';
import { packageForAgent } from './context-expander.js';

// =============================================================================
// Ripgrep runner (thin wrapper for external callers)
// =============================================================================

/**
 * Run ripgrep with a regex pattern against a directory or explicit file set.
 * Uses --json output to avoid colon-delimiter parsing issues with
 * paths containing colons (Windows, exotic filenames).
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
 */
export function extractRegexTokens(regex) {
  return regex
    .replace(/\\[sSdDwWbB]/g, ' ')
    .replace(/\\[.*+?^${}()|[\]\\]/g, '')
    .replace(/[.*+?^${}()|[\]\\]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
    .map(t => t.toLowerCase());
}

/**
 * Merge unique regex tokens into the semantic query.
 * Avoids duplicating tokens already present in the query.
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

  // Disable chunk gram for bare grep — bare grep uses file:line matches, not chunk IDs.
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
      grepStrategy: candidateResult.stats.grepStrategy,
      plannerRoute: candidateResult.stats.plannerRoute,
      gramSelectivity: candidateResult.stats.gramSelectivity,
      nativeGrepUsed: candidateResult.stats.nativeGrepUsed,
      symbolType,
      total_ms: Math.round(performance.now() - start),
      stageTiming: candidateResult.stats.stageTiming || null,
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
 */
export async function patternSearch(query, routing, options = {}) {
  const {
    regex,
    k = 10,
    format = 'benchmark',    // 'benchmark' | 'agent' | 'agent_preview' | 'agent_full'
    tokenBudget,             // agent mode: total token budget (default depends on sub-mode)
    ablations,               // agent mode: Set<string> for A/B testing feature ablations
  } = options;

  if (!regex) {
    throw new Error('Pattern search requires a regex. Use --regex or -e to specify one.');
  }

  const start = performance.now();
  const log = this.verbose ? (...args) => console.error('[Pattern]', ...args) : () => {};

  if (!this.hasLateInteractionIndex) {
    throw new Error('Pattern search requires a late interaction index. Re-index with late interaction enabled.');
  }

  if (!await isRipgrepAvailable()) {
    throw new Error('Pattern search requires ripgrep (rg). Install: brew install ripgrep');
  }

  await this.lateInteractionIndex.init();

  const mapStart = performance.now();
  const locationMap = this.getChunkLocationMap();
  const mapTime = performance.now() - mapStart;
  if (this.lateInteractionIndex.documents.size > 0 && locationMap.size === 0) {
    throw new Error(
      'Pattern search requires a late interaction index with line spans. Re-index with late interaction enabled.'
    );
  }
  log(`Chunk location map: ${locationMap.size} files in ${mapTime.toFixed(1)}ms`);

  const { encodeQuery } = await import('../ranking/late-interaction-model.js');
  const searchDir = this.projectRoot || PROJECT_ROOT;

  const enhanceQuery = options.enhanceQuery ?? true;
  const effectiveQuery = enhanceQuery ? mergeRegexIntoQuery(query, regex) : query;
  log(`Query: "${effectiveQuery}"`);

  const parallelStart = performance.now();
  const [candidateResult, encodedQuery] = await Promise.all([
    generateRegexMatches(this, regex, searchDir, { ...options, lightweightParse: true }),
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
    const emptyStats = {
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
    };

    // Agent mode: return proper agent schema even for zero results
    if (format === 'agent' || format === 'agent_preview' || format === 'agent_full' || format === 'agent_full_xl') {
      const agentResponse = packageForAgent([], emptyStats, {
        query, regex, mode: 'pattern', format, tokenBudget, ablations, projectRoot: this.projectRoot || PROJECT_ROOT,
      });
      agentResponse.stats = emptyStats;
      return agentResponse;
    }

    return { results: [], stats: emptyStats };
  }

  // Map matches -> indexed chunk IDs (with grep density counts).
  let chunkIds, chunkMatchCounts, unindexedMatches;

  {
    const mapped = mapMatchesToChunks(grepMatches, locationMap);
    chunkMatchCounts = mapped.chunkMatchCounts;
    chunkIds = mapped.chunkIds;
    unindexedMatches = [...mapped.unindexed, ...overlayMatches];
    log(`Mapped: ${chunkIds.size} indexed chunks, ${unindexedMatches.length} unindexed matches`);
  }

  let available = this.lateInteractionIndex.hasTokens(chunkIds);
  log(`LI index hits: ${available.size}/${chunkIds.size}`);

  const maxCandidates = options.maxCandidates ?? 0;
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

    const GREP_DENSITY_ALPHA = options.grepDensityAlpha ?? 0;
    for (const s of scored) {
      const matchCount = chunkMatchCounts.get(s.id) || 1;
      s.grepDensity = matchCount;
      s.lateInteractionScore = s.lateInteractionScore * (1 + GREP_DENSITY_ALPHA * Math.log(matchCount));
    }
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

  const allCandidateIds = [...available];
  const allMappedChunkIds = [...chunkIds];

  const stats = {
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
    plannerRoute: candidateResult.stats.plannerRoute,
    trackerLastIndex: candidateResult.stats.trackerLastIndex,
    total_ms: Math.round(totalTime),
    allCandidateIds,
    allMappedChunkIds,
  };

  // Agent mode: post-ranking context packaging (Phases 1-5)
  // Ranking is frozen — agent mode only transforms presentation.
  if (format === 'agent' || format === 'agent_preview' || format === 'agent_full' || format === 'agent_full_xl') {
    const searchDir = this.projectRoot || PROJECT_ROOT;
    const agentResponse = packageForAgent(results, stats, {
      query,
      regex,
      mode: 'pattern',
      format,
      tokenBudget,
      codeGraphRepo: this.codeGraphRepo || null,
      locationMap,
      projectRoot: searchDir,
      ablations,
    });
    agentResponse.stats = stats;
    return agentResponse;
  }

  return { results, stats };
}

// =============================================================================
// Re-export sub-modules for backward compatibility
// (barrel export in index.js uses `export * from './search-pattern.js'`)
// =============================================================================

export { generateRegexMatches } from './search-pattern-planner.js';
export { hasCaseInsensitiveRegexFlag, extractRequiredLiteralsHeuristic, extractLiteralClausesHeuristic, extractLiteralClauses, normalizeLiteralClauses, querySparseGramCandidates, ensureSparseGramIndex, nativeGrepFilesWithMatches, nativeGrepLines, getSparseGramAllFiles } from './search-pattern-prefilter.js';
export { buildChunkLocationMap, findChunkForLine, findChunkIntervalForLine, mapMatchesToChunks, readFileRange, getChunkLocationMap, getCodebaseChunkTypeMap, normalizeSearchSymbolType, resolveSearchSymbolFilter, isRipgrepCodePath, buildBareGrepResults, filterMatchesBySymbolType } from './search-pattern-chunks.js';
export { isRipgrepAvailable, _resetRgCache, normalizeSearchPath, chunkRipgrepFiles } from './search-pattern-ripgrep.js';
export { packageForAgent, estimateTokens, computeConfidence, computeSufficiency, allocateBudget, expandToSymbol, expandBySyntax, extractHeaderContext, truncateToTokenCap, findEnclosingEntity, checkStaleness } from './context-expander.js';
