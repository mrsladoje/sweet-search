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
import { applyGrepFileDiversity, matchesGrepFileFilter } from './grep-output-shaping.js';
import { isRipgrepAvailable, runRipgrepJson } from './search-pattern-ripgrep.js';
import { ensureSparseGramIndex } from './search-pattern-prefilter.js';
import { packageForAgent } from './context-expander.js';
import { detectBreDialectHint } from './regex-dialect.js';
import { buildIndexedGrepFamilyManifest } from './agent-pack-completion.js';
import { applyFileKindRanking, applyResultDemotions } from '../ranking/file-kind-ranking.js';

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
// Grep engine selection — native in-process grep vs ripgrep fallback
// =============================================================================

/**
 * Whether native in-process grep can serve this request without ripgrep.
 *
 * Native unified/narrowed grep (searchFull/searchLines + nativeGrep*) covers
 * plain-regex queries whenever a sparse-gram index is loaded. The loaded index
 * object only exposes searchFull/searchLines when the native addon built it, so
 * their presence is a reliable signal that native grep is available — and it
 * keeps the check deterministic for tests that supply a mock index.
 *
 * Fixed-string and glob queries are gated off the native path in
 * generateRegexMatches, so they still require ripgrep as the fallback engine.
 */
function nativeGrepCanServe(searcher, options = {}) {
  const fixedString = options.fixedString ?? false;
  const globs = options.globs ?? [];
  if (fixedString || (Array.isArray(globs) && globs.length > 0)) return false;
  const index = ensureSparseGramIndex(searcher, options);
  return !!(index && typeof index.searchFull === 'function' && typeof index.searchLines === 'function');
}

/**
 * Fail fast when no grep engine can serve the request. Native in-process grep
 * is preferred and needs no external binary; ripgrep is an optional fallback
 * (required only for fixed-string/glob queries, or when the native addon/index
 * is absent). Throws a single actionable error naming both engines when neither
 * is available — generateRegexMatches itself prefers native and only reaches a
 * ripgrep call in the fallback branches this guard protects.
 *
 * @returns {Promise<boolean>} true when native grep will serve (ripgrep unused)
 */
async function ensureGrepEngineAvailable(searcher, options, label) {
  if (nativeGrepCanServe(searcher, options)) return true;
  if (await isRipgrepAvailable()) return false;

  const fixedString = options.fixedString ?? false;
  const globs = options.globs ?? [];
  const reason = (fixedString || (Array.isArray(globs) && globs.length > 0))
    ? 'fixed-string and glob queries use the ripgrep fallback, which is not installed'
    : 'native grep is unavailable (no sparse-gram index built, or the native addon is missing) and ripgrep is not installed';
  throw new Error(
    `${label} needs an in-process grep engine, but none is available: ${reason}. ` +
    'Re-index to build the native sparse-gram index, or install ripgrep (brew install ripgrep).'
  );
}

// =============================================================================
// Bare grep (wired onto SweetSearch.prototype)
// =============================================================================

export async function bareGrep(query, routing, options = {}) {
  await this?._refreshManifestPins?.({ reloadScope: 'grep' });
  const regex = options.regex || query;
  const searchDir = this?.projectRoot || options.projectRoot || PROJECT_ROOT;
  const maxMatches = options.maxMatches ?? 0;
  const start = performance.now();
  const symbolType = resolveSearchSymbolFilter(options);

  void routing;

  if (!regex) {
    throw new Error('Bare grep requires a regex or fixed-string pattern.');
  }

  // Native in-process grep serves this when a sparse-gram index is loaded;
  // ripgrep is only required for fixed-string/glob queries or when native is
  // unavailable. Throws a clear error only when neither engine can run.
  await ensureGrepEngineAvailable(this, options, 'Bare grep');

  // Disable chunk gram for bare grep — bare grep uses file:line matches, not chunk IDs.
  const candidateResult = await generateRegexMatches(this || {}, regex, searchDir, options);
  let matches = [...candidateResult.indexedMatches, ...candidateResult.overlayMatches];
  matches = filterMatchesBySymbolType(matches, symbolType, this);
  // Agent drill-in scope (--in <file>): applied BEFORE sort/cap so a
  // late-alphabet file's matches can never be pre-clipped by maxMatches.
  if (options.fileFilter) {
    matches = matches.filter(m => matchesGrepFileFilter(m.file, options.fileFilter));
  }
  matches.sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    (a.column || 0) - (b.column || 0)
  );

  const totalMatches = matches.length;
  const regexDialectHint = totalMatches === 0 && options._isAgentFormat
    ? detectBreDialectHint(regex, { fixedString: options.fixedString })
    : null;
  // Agent-only k-budget file diversity (option-gated; absent → byte-identical
  // output). Streaming per-file cap: matches beyond the cap are counted, not
  // stored, so memory is bounded by perFileCap*maxFiles, never total matches.
  let fileSummary = null;
  if (options.perFileCap > 0) {
    ({ kept: matches, fileSummary } = applyGrepFileDiversity(matches, {
      perFileCap: options.perFileCap,
      maxFiles: options.maxFiles,
    }));
  }
  if (maxMatches > 0) {
    matches = matches.slice(0, maxMatches);
  }

  const results = buildBareGrepResults(matches, {
    projectRoot: searchDir,
    contextLines: options.contextLines ?? 0,
  });
  const familyManifest = options._isAgentFormat === true && !options.fileFilter
    ? buildIndexedGrepFamilyManifest(results, this?.codeGraphRepo)
    : null;

  return {
    results,
    ...(fileSummary ? { fileSummary } : {}),
    ...(familyManifest ? { familyManifest } : {}),
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
      ...(regexDialectHint && { regexDialectHint }),
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
  await this?._refreshManifestPins?.({ reloadScope: 'all' });
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

  // Native in-process grep serves candidate generation when a sparse-gram index
  // is loaded; ripgrep is only required for fixed-string/glob queries or when
  // native is unavailable. Throws a clear error only when neither engine runs.
  await ensureGrepEngineAvailable(this, options, 'Pattern search');

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
  const regexDialectHint = totalRawMatches === 0 && options._isAgentFormat
    ? detectBreDialectHint(regex, { fixedString: options.fixedString })
    : null;
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
      ...(regexDialectHint && { regexDialectHint }),
      total_ms: Math.round(performance.now() - start),
    };

    // Agent mode: return proper agent schema even for zero results
    if (format === 'agent' || format === 'agent_preview' || format === 'agent_full' || format === 'agent_full_xl') {
      const agentResponse = packageForAgent([], emptyStats, {
        query, regex, mode: 'pattern', format, tokenBudget, ablations,
        projectRoot: this.projectRoot || PROJECT_ROOT, _isAgentFormat: true,
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
    scored.sort((a, b) => b.lateInteractionScore - a.lateInteractionScore);
    log(`MaxSim rerank: ${scored.length} candidates in ${rerankTime.toFixed(1)}ms`);
  }

  const fileCache = new Map();

  let rankedResults = scored.map((s, rank) => {
    const doc = this.lateInteractionIndex.documents.get(s.id);
    const meta = doc?.metadata || this.lateInteractionIndex.aliasPointers?.get(s.id)?.metadata || {};
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
  // Mode E (2026-05-13): for agent-format ss-find queries, apply file-kind
  // demotion before result demotions. The regex+symbol shape of ss-find is
  // implementation-intent by construction (agents using patternSearch are
  // hunting for code, not docs), so we force intent='implementation' rather
  // than inferring it from the NL query — `classifyFileKindIntent` requires
  // explicit "show me the function/class" verbs that ss-find prompts don't
  // always include.
  //
  // CRITICAL — format-gated to agent variants only. Same gate as the BM25F
  // boosts in applyResultDemotions (round-1/2 lessons: -27.57pp GCSN if
  // ungated structural signals fire on benchmark NL traffic). Probes use
  // format='agent', so behaviour matches expectations; GCSN bench uses
  // mode='auto' with no format, so this skip preserves the 86.92% baseline.
  //
  // Targets stage3-taxonomy.md Mode E failures:
  //   - JS-005: index.d.ts: interface AxiosHeaders outranks lib/core/AxiosHeaders.js
  //   - TSL-004/008: packages/docs/content/packages/core.mdx outranks schemas.ts
  // The .d.ts (types kind) and .mdx (docs kind) factors mirror hybrid's
  // tuned defaults (typeFactor 0.70, docFactor 0.35).
  const ssFindIsAgentFormat = options?.format === 'agent'
    || options?.format === 'agent_full'
    || options?.format === 'agent_full_xl'
    || options?.format === 'agent_preview';
  const skipPatternFileKind = Array.isArray(ablations)
    ? ablations.includes('no-pattern-file-kind-ranking')
    : (ablations instanceof Set ? ablations.has('no-pattern-file-kind-ranking') : false);
  if (ssFindIsAgentFormat && !skipPatternFileKind) {
    rankedResults = applyFileKindRanking(rankedResults, {
      intent: 'implementation',
      window: options.fileKindWindow ?? 100,
      docFactor: options.patternDocFactor ?? 0.35,
      testFactor: options.patternTestFactor ?? 0.35,
      typeFactor: options.patternTypeFactor ?? 0.70,
      ancillaryFactor: options.patternAncillaryFactor ?? 0.15,
      tinyAncillaryFactor: options.patternTinyAncillaryFactor ?? 0.05,
    });
  }
  rankedResults = applyResultDemotions(rankedResults, {
    query,
    ablations,
    format: options?.format,
    projectRoot: this.projectRoot,
    codeGraphRepo: this.codeGraphRepo,
  }).map((result, rank) => ({
    ...result,
    rank: rank + 1,
    lateInteractionScore: result.score,
  }));

  const results = rankedResults.slice(0, k);

  const remaining = Math.max(0, k - results.length);
  if (remaining > 0 && unindexedMatches.length > 0) {
    const seen = new Set(results.map(r => `${r.file}:${r.startLine}`));
    let added = 0;
    for (const m of unindexedMatches) {
      if (added >= remaining) break;
      const key = `${m.file}:${m.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const content = m.content || readFileRange(fileCache, m.file, m.line, m.line, this.projectRoot) || m.matchText || '';
      results.push({
        id: `unindexed:${m.file}:${m.line}`,
        file: m.file,
        name: null,
        type: 'code',
        startLine: m.line,
        endLine: m.line,
        text: content,
        content,
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
      _isAgentFormat: true,
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
export { packageForAgent, estimateTokens, computeConfidence, computeSufficiency, allocateBudget, expandToSymbol, expandBySyntax, expandLeadingTrivia, extractHeaderContext, truncateToTokenCap, findEnclosingEntity, checkStaleness, renderGraphNeighbors } from './context-expander.js';
