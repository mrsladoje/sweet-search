/**
 * Context Expander — transforms ranked pattern search results into
 * self-contained agent context packages.
 *
 * The ranking pipeline is identical between benchmark and agent modes.
 * This module is a post-ranking presentation layer only.
 *
 * All database access goes through infrastructure repositories.
 * This module never queries SQLite directly.
 *
 * References: docs/USEFUL_ANSWER_COLGREP_PLAN.md
 */

import { capToFinalK } from './final-k.js';
import { isTestLikePath } from './agent-output-fixes.js';
import { readFileRange } from './search-pattern-chunks.js';
import { annotateEntrySymbols, applyAgentPackCompletion, buildPackSiblingLine, shownSourceEndLine } from './agent-pack-completion.js';
import path from 'path';
import { resolveSubMode, AGENT_FULL_XL_TOKEN_BUDGET, AGENT_FULL_TOKEN_BUDGET, DEFAULT_TOKEN_BUDGET, computeBudgetSignals, selectAgentBudget, allocateBudget, estimateTokens, truncateToTokenCap, startAtNamedDefinition, compressToPreview } from './packaging/budget.js';
import { computeConfidence, computeSufficiency } from './packaging/sufficiency.js';
import { TEST_QUERY_RE, relatedSubjectEntity, RELATED_DEFAULT_ROWS, annotateContainerRowMembers } from './packaging/related-rows.js';
import { expandToSymbol, assembleSandwichCode } from './packaging/span-expansion.js';
import { checkStaleness } from './packaging/staleness.js';
import { MAX_HEADER_TOKENS, extractHeaderContext, clampTextToTokenCap } from './packaging/header-context.js';
import { graphNeighborsEnabled, renderGraphNeighbors } from './packaging/graph-neighbors.js';
import { refillCoveredSummaries, buildSameFileMap } from './packaging/same-file-map.js';

export { estimateTokens, allocateBudget, POINTER_TAIL_RATIO, truncateToTokenCap, startAtNamedDefinition, compressToPreview, computeBudgetSignals, selectAgentBudget } from './packaging/budget.js';
export { findEnclosingEntity, expandToSymbol, expandBySyntax, expandLeadingTrivia } from './packaging/span-expansion.js';
export { checkStaleness } from './packaging/staleness.js';
export { extractHeaderContext } from './packaging/header-context.js';
export { computeConfidence, computeSufficiency } from './packaging/sufficiency.js';
export { graphNeighborsEnabled, renderGraphNeighbors } from './packaging/graph-neighbors.js';
export { RELATED_DEFAULT_ROWS, shortestUniquePath, relatedRowScore, CONTAINER_ROW_MIN_LINES, containerRowMembers, annotateContainerRowMembers, selectRelatedRows } from './packaging/related-rows.js';
export { buildSameFileMap, refillCoveredSummaries } from './packaging/same-file-map.js';

/**
 * Ablations as a Set. Callers pass a Set (the in-process API) or an array
 * (eval/run_benchmark.js `--ablations=a,b`, JSON callers); the packager and
 * expandToSymbol call `.has()`, which an array does not have, so an array
 * used to throw "ablations.has is not a function" in agent formats.
 * @param {Set<string>|string[]|null|undefined} ablations
 * @returns {Set<string>}
 */
export function toAblationSet(ablations) {
  if (ablations instanceof Set) return ablations;
  if (Array.isArray(ablations)) return new Set(ablations);
  return new Set();
}

/**
 * Package ranked results into agent-mode context blocks.
 *
 * Takes the ranked results from patternSearch (same order, same IDs)
 * and transforms them into self-contained code packages with:
 *   - Loaded code content
 *   - Symbol-complete expansion (via CodeGraphRepository)
 *   - Token budget management
 *   - Header context (top-1 only)
 *   - Confidence + sufficiency signals
 *   - Staleness metadata
 *
 * @param {Array} rankedResults - Results from patternSearch ranking pipeline
 * @param {object} searchStats - Stats from the search pipeline
 * @param {object} opts
 * @param {string} opts.query - Original search query
 * @param {string} opts.regex - Regex pattern used
 * @param {string} [opts.format='agent'] - 'agent' | 'agent_preview' | 'agent_full'
 * @param {number} [opts.tokenBudget] - Total token budget (default depends on sub-mode)
 * @param {number} [opts.k] - Final result cap. When set, rankedResults is cut to k
 *   BEFORE budget signals are computed, so numResults never counts more than k.
 * @param {object} [opts.codeGraphRepo] - CodeGraphRepository for entity lookup (DDD)
 * @param {Map} [opts.locationMap] - Chunk location map
 * @param {string} [opts.projectRoot] - Project root path
 * @param {Set<string>} [opts.ablations] - Feature ablations for A/B testing:
 *   'no-syntax-expansion', 'no-header', 'no-diversity', 'no-adaptive-budget'
 * @returns {object} Agent mode response
 */
export function packageForAgent(rankedResultsIn, searchStats, opts) {
  // Final-k contract: budget-tier signals (numResults, dominance, top-1 size)
  // are computed on the final <= k list, never on an inflated candidate list.
  const rankedResults = capToFinalK(rankedResultsIn, opts?.k);
  const {
    query,
    regex,
    mode: modeOpt = null,
    format: formatOpt = 'agent',
    codeGraphRepo = null,
    locationMap = null,
    projectRoot,
    _isAgentFormat = false,
  } = opts;
  const ablations = toAblationSet(opts.ablations);

  // Auto-tier selection: pick preview / full / xl based on score-distribution
  // signals when format='agent'. Explicit format=='agent_preview|full|full_xl'
  // and explicit numeric tokenBudget remain as overrides. Mirrors trace's
  // adaptive selectBudget (core/graph/structural-context.js:37).
  //
  // Disabled by 'no-auto-budget' ablation — falls back to the legacy
  // resolveSubMode mapping (which treats 'agent' as 'agent_preview').
  let subMode, tokenBudget, budgetReason, budgetSignals;
  if (ablations.has('no-auto-budget')) {
    subMode = resolveSubMode(formatOpt);
    const defaultBudget = subMode === 'agent_full_xl' ? AGENT_FULL_XL_TOKEN_BUDGET
      : subMode === 'agent_full' ? AGENT_FULL_TOKEN_BUDGET
      : DEFAULT_TOKEN_BUDGET;
    tokenBudget = opts.tokenBudget ?? defaultBudget;
    budgetReason = 'ablation_no_auto_budget';
    budgetSignals = null;
  } else {
    budgetSignals = computeBudgetSignals(rankedResults, searchStats);
    const pick = selectAgentBudget(formatOpt, budgetSignals, {
      explicitBudget: opts.tokenBudget,
    });
    subMode = pick.subMode;
    tokenBudget = pick.tokenBudget;
    budgetReason = pick.reason;
  }

  const start = performance.now();
  const fileCache = new Map();

  // Locality clustering: pull up to two non-overlapping companion results
  // from the SAME file as top-1 (when their score is competitive, ≥ top-1/3)
  // ahead of unrelated higher-scoring distractors. This addresses the
  // dominant agent-bench loss pattern where the right helper symbol existed
  // in the ranked list at rank 4 but got demoted to summary because a
  // tangential file scored slightly higher. Top-1 is never moved.
  // Disabled by 'no-locality-cluster' ablation.
  let workingResults = rankedResults;
  if (!ablations.has('no-locality-cluster') && rankedResults.length >= 3) {
    const top = rankedResults[0];
    const topFile = top?.metadata?.file || top?.file;
    const topScore = top?.score || top?.lateInteractionScore || 0;
    if (topFile && topScore > 0) {
      const sameFile = [];
      const other = [];
      for (let i = 1; i < rankedResults.length; i++) {
        const r = rankedResults[i];
        const f = r.metadata?.file || r.file;
        const s = r.score || r.lateInteractionScore || 0;
        // Don't pull up overlapping same-file ranges (those are diversity dups).
        const ts = top.metadata?.startLine || top.startLine;
        const te = top.metadata?.endLine || top.endLine;
        const rs = r.metadata?.startLine || r.startLine;
        const re = r.metadata?.endLine || r.endLine;
        const overlapsTop = (rs != null && re != null && ts != null && te != null)
          && rs <= te + 10 && re >= ts - 10;
        if (f === topFile && s >= topScore / 3 && !overlapsTop) sameFile.push(r);
        else other.push(r);
      }
      // Promote up to 2 companion results into ranks 2 and 3, push the
      // rest behind. We deliberately keep `score` untouched so callers
      // can still inspect the original ranking signal.
      workingResults = [top, ...sameFile.slice(0, 2), ...other, ...sameFile.slice(2)]
        .map((r, idx) => ({ ...r, rank: idx + 1 }));
    }
  }

  // Diversity: demote results that cluster in same file+region as a higher-ranked result.
  // This prevents wasting preview/full budget on near-duplicate chunks from the same symbol.
  const diversityDemotions = new Set();
  if (ablations.has('no-diversity')) { /* skip diversity check */ }
  else for (let i = 0; i < Math.min(workingResults.length, 5); i++) {
    const ri = workingResults[i];
    const fi = ri.metadata?.file || ri.file;
    const si = ri.metadata?.startLine || ri.startLine;
    const ei = ri.metadata?.endLine || ri.endLine;
    for (let j = i + 1; j < Math.min(workingResults.length, 5); j++) {
      if (diversityDemotions.has(j)) continue;
      const rj = workingResults[j];
      const fj = rj.metadata?.file || rj.file;
      if (fi !== fj) continue;
      const sj = rj.metadata?.startLine || rj.startLine;
      const ej = rj.metadata?.endLine || rj.endLine;
      // Overlap: lines intersect or are within 10 lines of each other
      if (sj <= ei + 10 && ej >= si - 10) {
        diversityDemotions.add(j);
      }
    }
  }

  const budgetContext = ablations.has('no-adaptive-budget')
    ? {}
    : {
        ...(searchStats?.grepMatches != null ? { grepMatches: searchStats.grepMatches } : {}),
        ...(searchStats?.candidatePoolSize != null ? { candidatePoolSize: searchStats.candidatePoolSize } : {}),
        results: workingResults,
        agentFormat: _isAgentFormat === true,
      };
  const allocations = allocateBudget(tokenBudget, workingResults.length, subMode,
    opts.firstUnit ? { ...budgetContext, firstUnit: opts.firstUnit } : budgetContext);

  const confidenceInfo = computeConfidence(workingResults, searchStats);

  // Shared staleness cache — db mtime is the same for all results in one search.
  // Avoids repeated statSync calls.
  const stalenessCache = {};

  let tokensUsed = 0;
  const agentResults = [];

  // Test-file hits print as rows, not code (2026-10-05). On the 30 dev questions (6 runs,
  // 175 ss-search/ss-find calls) test-file bodies were 51 of 414 bodies and 10.2% of the
  // output characters, and none of them was a gold file (15 were rank 1). The row keeps the
  // path and span; the code slot it would have used goes to the next non-test hit. Kept when
  // the query asks about tests, or when every hit is a test file (a test framework's own repo).
  const testRowIdx = new Set();
  if (_isAgentFormat === true && !ablations.has('no-test-rows') && !TEST_QUERY_RE.test(String(query || ''))) {
    workingResults.forEach((r, idx) => { if (isTestLikePath(r?.metadata?.file || r?.file)) testRowIdx.add(idx); });
    if (testRowIdx.size === workingResults.length) testRowIdx.clear();
  }
  const SUMMARY_ALLOCATION = { presentation: 'summary', tokenCap: 0 };
  let allocIdx = 0;
  const hitAllocations = workingResults.map((_, idx) => (testRowIdx.has(idx)
    ? SUMMARY_ALLOCATION : (allocations[allocIdx++] || SUMMARY_ALLOCATION)));

  for (let i = 0; i < workingResults.length; i++) {
    const result = workingResults[i];
    const allocation = hitAllocations[i];
    const meta = result.metadata || {};
    const filePath = meta.file || result.file;
    const remainingBudget = Math.max(0, tokenBudget - tokensUsed);

    const budgetExhausted = remainingBudget <= 0;
    const diversityDemoted = diversityDemotions.has(i);

    const summaryEntry = () => ({
      rank: i + 1,
      file: filePath,
      startLine: meta.startLine || result.startLine,
      endLine: meta.endLine || result.endLine,
      symbol: meta.name || result.name || null,
      symbolType: meta.type || result.type || null,
      score: result.score || result.lateInteractionScore || 0,
      expanded: false,
      presentation: 'summary',
      stale: false,
      indexedAt: null,
      summary: `${filePath}:${meta.startLine || result.startLine} — ${meta.name || 'code block'}${meta.type ? ' (' + meta.type + ')' : ''}`,
      code: null,
      codeTokens: 0,
    });

    if (allocation.presentation === 'summary' || budgetExhausted || diversityDemoted) {
      agentResults.push({
        rank: i + 1,
        file: filePath,
        startLine: meta.startLine || result.startLine,
        endLine: meta.endLine || result.endLine,
        symbol: meta.name || result.name || null,
        symbolType: meta.type || result.type || null,
        score: result.score || result.lateInteractionScore || 0,
        expanded: false,
        presentation: 'summary',
        stale: false,
        indexedAt: null,
        summary: `${filePath}:${meta.startLine || result.startLine} — ${meta.name || 'code block'}${meta.type ? ' (' + meta.type + ')' : ''}`,
        code: null,
        codeTokens: 0,
      });
      continue;
    }

    const expansion = expandToSymbol(result, {
      codeGraphRepo,
      locationMap,
      fileCache,
      projectRoot,
      tokenCap: Math.min(allocation.tokenCap, remainingBudget),
      ablations,
    });

    // A first unit (SS_FIX_SEARCH_FIRST_UNIT) whose enclosing symbol is code already printed
    // above would print it twice: it stays a summary line.
    if (allocation.unit && agentResults.some(p => p.code && p.file === filePath
        && expansion.startLine <= p.endLine && expansion.endLine >= p.startLine)) {
      agentResults.push(summaryEntry());
      continue;
    }

    // For sandwich expansions, assemble from parts with explicit elision markers
    // so the gold chunk is preserved even when the enclosing entity is huge.
    let code;
    if (expansion.kind === 'sandwich' && expansion.sandwich) {
      code = assembleSandwichCode(fileCache, filePath, expansion.sandwich, projectRoot);
    } else {
      code = readFileRange(
        fileCache,
        filePath,
        expansion.startLine,
        expansion.endLine,
        projectRoot
      );
    }

    // The ±20-line fallback below prints other lines than the expansion: its header names them.
    let paddedRange = null;
    if (!code) {
      const padStart = Math.max(1, (meta.startLine || result.startLine) - 20);
      const padEnd = (meta.endLine || result.endLine) + 20;
      code = readFileRange(fileCache, filePath, padStart, padEnd, projectRoot);
      if (code) paddedRange = { startLine: padStart, endLine: padStart + code.split('\n').length - 1 };
    }

    const { stale, indexedAt } = checkStaleness(filePath, projectRoot, codeGraphRepo, stalenessCache);

    if (!code) {
      agentResults.push({
        rank: i + 1,
        file: filePath,
        startLine: meta.startLine || result.startLine,
        endLine: meta.endLine || result.endLine,
        symbol: expansion.symbol,
        symbolType: expansion.symbolType,
        score: result.score || result.lateInteractionScore || 0,
        expanded: false,
        expandedFrom: null,
        presentation: allocation.presentation,
        stale,
        indexedAt,
        fallbackReason: 'file_read_failed',
        code: null,
        codeTokens: 0,
      });
      continue;
    }

    const resultTokenCap = Math.min(allocation.tokenCap, remainingBudget);
    let codeTokens;
    let boundaryTruncated = false;
    let goldOnlyRange = null;
    let leadTrimmedStart = null;
    if (resultTokenCap <= 0) {
      code = '';
      codeTokens = 0;
    } else if (expansion.kind === 'sandwich') {
      // Sandwich is pre-sized via 10-tokens/line estimate. If actual content
      // happens to overshoot (very long lines), do NOT call truncateToTokenCap
      // here — that truncates from the start and would drop the gold tail.
      // Instead, fall back to gold-only chunk + truncate (agent keeps the
      // evidence; loses signature, but not the match itself).
      codeTokens = estimateTokens(code);
      if (codeTokens > resultTokenCap) {
        const goldStart = meta.startLine || result.startLine;
        const goldEnd = meta.endLine || result.endLine;
        const goldOnly = readFileRange(fileCache, filePath, goldStart, goldEnd, projectRoot) || '';
        const trunc = truncateToTokenCap(goldOnly, resultTokenCap);
        code = trunc.code;
        codeTokens = estimateTokens(code);
        // The code is the gold chunk now, not the sandwich: its header must name the gold
        // lines (the sandwich span started at the enclosing symbol's signature).
        goldOnlyRange = { startLine: goldStart, endLine: goldEnd };
        boundaryTruncated = trunc.truncated;
      }
    } else if (allocation.presentation === 'full') {
      ({ code, start: leadTrimmedStart } = startAtNamedDefinition(code, expansion, resultTokenCap, codeGraphRepo, filePath, _isAgentFormat === true));
      const truncResult = truncateToTokenCap(code, resultTokenCap);
      code = truncResult.code;
      codeTokens = estimateTokens(code);
      boundaryTruncated = truncResult.truncated;
    } else {
      // The marker is part of the fit (compressToPreview): no clamp after it.
      ({ code, start: leadTrimmedStart } = startAtNamedDefinition(code, expansion, resultTokenCap, codeGraphRepo, filePath, _isAgentFormat === true));
      code = compressToPreview(code, resultTokenCap);
      codeTokens = estimateTokens(code);
    }

    if (!code || codeTokens <= 0) {
      agentResults.push({
        rank: i + 1,
        file: filePath,
        startLine: meta.startLine || result.startLine,
        endLine: meta.endLine || result.endLine,
        symbol: expansion.symbol,
        symbolType: expansion.symbolType,
        score: result.score || result.lateInteractionScore || 0,
        expanded: false,
        presentation: 'summary',
        stale,
        indexedAt,
        summary: `${filePath}:${meta.startLine || result.startLine} — ${expansion.symbol || meta.name || 'code block'}${(expansion.symbolType || meta.type) ? ' (' + (expansion.symbolType || meta.type) + ')' : ''}`,
        code: null,
        codeTokens: 0,
      });
      continue;
    }

    tokensUsed += codeTokens;

    // A sandwich that overshot its cap printed the gold chunk only (above): that chunk is the
    // entry's span and kind from here on.
    const printedRange = goldOnlyRange || paddedRange;
    const shownKind = printedRange ? 'chunk' : (expansion.kind || null);
    const entryStart = printedRange ? printedRange.startLine : (leadTrimmedStart ?? expansion.startLine);
    const entryEnd = printedRange ? printedRange.endLine : expansion.endLine;
    const agentResult = {
      rank: i + 1,
      file: filePath,
      startLine: entryStart,
      endLine: entryEnd,
      symbol: expansion.symbol,
      symbolType: expansion.symbolType,
      score: result.score || result.lateInteractionScore || 0,
      expanded: expansion.expanded,
      expandedFrom: expansion.expandedFrom,
      expansionKind: shownKind,
      ...(shownKind === 'sandwich' && expansion.sandwich
        ? {
            sandwich: {
              partKinds: expansion.sandwich.parts.map(p => p.kind),
              elidedHead: expansion.sandwich.elidedHead,
              elidedTail: expansion.sandwich.elidedTail,
              elisionMarkers: expansion.sandwich.elisionMarkers,
            },
          }
        : {}),
      presentation: allocation.presentation,
      stale,
      indexedAt,
      code,
      codeTokens,
      ...(_isAgentFormat === true
        && allocation.presentation === 'full'
        && shownKind !== 'sandwich'
        ? {
            shownStartLine: entryStart,
            shownEndLine: shownSourceEndLine(entryStart, code, boundaryTruncated),
            ...(boundaryTruncated ? { boundaryTruncated: true } : {}),
          }
        : {}),
    };

    if (i === 0 && !ablations.has('no-header')) {
      const remainingHeaderBudget = Math.min(
        MAX_HEADER_TOKENS,
        Math.max(0, tokenBudget - tokensUsed)
      );
      const { headerContext } = extractHeaderContext(
        code, fileCache, filePath, projectRoot
      );
      if (headerContext && remainingHeaderBudget > 0) {
        const trimmedHeader = clampTextToTokenCap(headerContext, remainingHeaderBudget);
        const trimmedHeaderTokens = estimateTokens(trimmedHeader);
        if (trimmedHeader && trimmedHeaderTokens > 0) {
          agentResult.headerContext = trimmedHeader;
          agentResult.headerTokens = trimmedHeaderTokens;
          tokensUsed += trimmedHeaderTokens;
        }
      }
    }

    // Graph-neighbour reservation (top-1 only). The pack reserves
    // up to 20% of the budget (capped at 1000 tokens, floored at 600 when
    // the budget allows) for a dedicated 1-hop neighbours tier. Surfaced
    // as `agentResult.neighbors`; rendered for the agent by the CLI shim.
    // Disabled by 'no-graph-neighbors' ablation and in pattern (ColGrep /
    // ss-find) mode — see graphNeighborsEnabled(). Skipping happens before
    // any reservation, so tokensUsed stays free for the lower ranks. Never
    // model-specific — the rendering is plain text.
    if (i === 0
        && graphNeighborsEnabled({ mode: modeOpt, ablations })
        && expansion.entityId
        && codeGraphRepo) {
      // Reserve fraction depends on subMode but never above 20% / 1000 toks.
      // Stretches the floor for full+xl so the top-1 actually gets useful
      // neighbour evidence even when the chunk consumed most of the budget.
      const reserveFraction = subMode === 'agent_full_xl' ? 0.20
        : subMode === 'agent_full' ? 0.18
        : 0.15;
      const headroom = Math.max(0, tokenBudget - tokensUsed);
      const desired = Math.min(1000, Math.floor(tokenBudget * reserveFraction));
      const tokenCap = Math.min(headroom, desired);
      if (tokenCap >= 80) {
        // Build skip set from ALL ranked locations that will be shown
        // with code (full / preview tiers). Summary-tier rows are not
        // skipped — they convey no code and the neighbour tier still
        // adds value (edge type + direction). This avoids the
        // pathological case (validation-pipeline) where every caller is
        // already in the pack as a summary row, leaving the agent with
        // file:line refs but no edge attribution.
        const skipKeys = new Set();
        for (let j = 0; j < workingResults.length; j++) {
          const tier = hitAllocations[j]?.presentation;
          if (tier !== 'full' && tier !== 'preview') continue;
          const r = workingResults[j];
          const f = r.metadata?.file || r.file;
          const s = r.metadata?.startLine || r.startLine;
          const e = r.metadata?.endLine || r.endLine;
          if (f && s != null && e != null) {
            skipKeys.add(`${f}|${s}|${e}`);
          }
        }
        skipKeys.add(`${filePath}|${expansion.startLine}|${expansion.endLine}`);
        const neighbours = renderGraphNeighbors({
          codeGraphRepo,
          entity: relatedSubjectEntity(codeGraphRepo, {
            id: expansion.entityId,
            filePath,
            startLine: expansion.startLine,
            endLine: expansion.endLine,
            name: expansion.symbol,
            type: expansion.symbolType,
          }),
          skipKeys,
          tokenCap,
          // Pass the loaded code so the neighbour tier can also surface
          // referenced TYPE definitions (struct/enum/...) discovered by
          // name from the body — fills the gap left by relationship-only
          // edges (e.g. Go method receiver fields with custom types).
          body: code,
          // Rows are selected by relevance to the query (selectRelatedRows); a row whose
          // entity is also a search candidate (the ranked list or the reserve) scores higher.
          query: query || '',
          candidates: [...workingResults, ...(Array.isArray(opts.reserve) ? opts.reserve : [])].map(r => ({
            file: r.metadata?.file || r.file,
            startLine: r.metadata?.startLine || r.startLine,
            endLine: r.metadata?.endLine || r.endLine,
          })),
          maxRows: subMode === 'agent_full_xl' ? RELATED_DEFAULT_ROWS + 2
            : subMode === 'agent_full' ? RELATED_DEFAULT_ROWS + 1 : RELATED_DEFAULT_ROWS,
        });
        if (neighbours) {
          agentResult.neighbors = neighbours;
          tokensUsed += neighbours.tokens;
        }
      }
    }

    agentResults.push(agentResult);
  }

  // Covered-summary refill (agent format, needs opts.reserve). A summary entry
  // whose span an earlier entry already shows in full (or repeats exactly)
  // tells the agent nothing new; Bundle A's A2 drops it from the printed
  // text, but the slot stays lost. When post-retrieval hands over the next
  // candidates after the final cut, swap each such entry for the next reserve
  // candidate that is not itself covered. Same rule as A2 (shownCodeSpan), so
  // A2 stays a no-op on what this step already replaced and keeps catching
  // the rest. Disabled by 'no-covered-refill'.
  if (_isAgentFormat === true && Array.isArray(opts.reserve) && opts.reserve.length > 0
      && !ablations.has('no-covered-refill')) {
    const refilled = refillCoveredSummaries(agentResults, opts.reserve);
    if (refilled.replaced > 0) {
      agentResults.length = 0;
      agentResults.push(...refilled.results);
    }
  }

  const packagingMs = Math.round(performance.now() - start);

  // Sufficiency signal for top-1. Query-conditioned since 2026-07: the
  // 3-valued verdict requires positive query-match evidence; structural
  // packaging facts remain as reasons + the medium-confidence resolution
  // gate. Runs for summary-only top-1 too (verdict can be 'no'/'unknown'
  // there; never 'yes' without code).
  let sufficient = false;
  let sufficiencyVerdict = 'no';
  let sufficiencyReason = 'no_results';
  let sufficiencyReasons = [];
  let unresolvedExternalCount = 0;
  if (agentResults.length > 0) {
    const sufficiency = computeSufficiency(agentResults[0], confidenceInfo, {
      query,
      regex,
      // Code-bearing lower ranks (full/preview) — soften a false 'no' when
      // the pack's answer sits below top-1; never used to grant YES.
      lowerResults: agentResults.slice(1, 4).filter(r => r.code),
    });
    sufficient = sufficiency.sufficient;
    sufficiencyVerdict = sufficiency.verdict;
    sufficiencyReason = sufficiency.sufficiencyReason;
    sufficiencyReasons = sufficiency.reasons;
    unresolvedExternalCount = sufficiency.unresolvedExternalCount || 0;
  }

  // No pointer tail on `sufficient=YES` (removed 2026-10-04): in the final-run replay, 18 of 74
  // YES packs held a gold result at rank 2/3 (14 in another file; 8 under a wrong top-1), and YES
  // was right 58% of the time. The score-ratio trigger in allocateBudget stays.

  // Same-file span map (top-1 only). Emitted ONLY when the verdict
  // is not a clear YES (composes with the query-conditioned verdict: the map
  // supplies the "where to look next" exactly when the engine says "keep
  // looking") AND top-1 is a windowed view (kind != 'full' — fully-shown
  // symbols stay byte-identical) AND the line fits the remaining tier
  // budget (dropped on overflow, never a truncated pack). Its tokens are
  // counted inside tokensUsed. Disabled by 'no-same-file-map' ablation.
  if (!ablations.has('no-same-file-map')
      && agentResults.length > 0
      && sufficiencyVerdict !== 'yes'
      && codeGraphRepo
      && typeof codeGraphRepo.findAdjacentEntities === 'function') {
    const top = agentResults[0];
    const windowed = top.code
      && top.presentation !== 'summary'
      && top.expansionKind
      && top.expansionKind !== 'full'
      && top.file
      && Number.isFinite(top.startLine)
      && Number.isFinite(top.endLine);
    if (windowed) {
      let adjacent = null;
      try {
        adjacent = codeGraphRepo.findAdjacentEntities(top.file, top.startLine, top.endLine, { perSide: 2 });
      } catch { adjacent = null; }
      // Don't name neighbors whose code is ALREADY visible in the pack —
      // locality clustering pulls same-file companions to ranks 2-3; a map
      // entry for a shown span is pure noise.
      if (adjacent) {
        const shownSameFile = agentResults.filter(r =>
          r !== top && r.code && r.file === top.file
          && Number.isFinite(r.startLine) && Number.isFinite(r.endLine));
        const overlapsShown = e => shownSameFile.some(r =>
          e.startLine <= r.endLine && e.endLine >= r.startLine);
        adjacent = {
          above: adjacent.above.filter(e => !overlapsShown(e)),
          below: adjacent.below.filter(e => !overlapsShown(e)),
        };
      }
      const map = adjacent ? buildSameFileMap(top, adjacent) : null;
      if (map && map.tokens <= Math.max(0, tokenBudget - tokensUsed)) {
        top.sameFile = map;
        tokensUsed += map.tokens;
      }
    }
  }

  // Same-file identifier family for a method/function top-1 (2026-09-03,
  // smoke-loss forensics L1a, pack form). The span map above names positional
  // neighbours; this names the declarations that SHARE the symbol's name
  // family plus the fields its body reads, with their code lines. Additive,
  // counted inside tokensUsed, dropped on overflow like the span map.
  if (_isAgentFormat === true && agentResults.length > 0 && !ablations.has('no-sibling-line')
      && opts._siblingLine !== false && codeGraphRepo) { // SS_SIBLING_LINE=0 opts out
    const top = agentResults[0];
    const sibling = buildPackSiblingLine(top, codeGraphRepo, { regex, projectRoot, fileCache, estimateTokens });
    if (sibling && sibling.tokens <= Math.max(0, tokenBudget - tokensUsed)) {
      top.siblingLine = sibling;
      tokensUsed += sibling.tokens;
    }
  }

  if (_isAgentFormat === true) {
    const completion = applyAgentPackCompletion({
      results: agentResults,
      query,
      regex,
      codeGraphRepo,
      fileCache,
      projectRoot,
      tokensUsed,
      tokenBudget,
      estimateTokens,
      isAgentFormat: _isAgentFormat,
    });
    tokensUsed = completion.tokensUsed;
    // Entry labels name every top-level symbol of the span (not only the chunk's first).
    if (codeGraphRepo) annotateEntrySymbols(agentResults, codeGraphRepo);
    // A row naming a large type names the members of it the query names.
    if (codeGraphRepo && !ablations.has('no-container-members')) annotateContainerRowMembers(agentResults, codeGraphRepo, query);
  }

  return {
    query,
    regex,
    mode: modeOpt || searchStats?.path || 'pattern',
    totalResults: workingResults.length,
    latencyMs: searchStats?.total_ms || 0,
    packagingMs,

    format: 'agent',
    subMode,
    tokenBudget,
    budgetReason,
    budgetSignals,
    tokensUsed,
    confidence: confidenceInfo.confidence,
    confidenceReason: confidenceInfo.confidenceReason,
    sufficient,
    sufficiencyVerdict,
    sufficiencyReason,
    sufficiencyReasons,
    unresolvedExternalCount,

    results: agentResults,
  };
}
