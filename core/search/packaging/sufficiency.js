/**
 * Scores confidence in a result list and whether the top result answers the query on its own.
 */

import { computeSufficiencyVerdict } from '../query-sufficiency.js';
import { LANG_KEYWORDS } from './header-context.js';

/**
 * Compute confidence level from score distribution, search stats, and regex selectivity.
 *
 * Thresholds (from plan §5):
 *   - high: top-1 score > 2× top-2
 *   - medium: top-1 and top-2 within 20%
 *   - low: many ties or low candidate recall
 *
 * Also factors in regex selectivity (few grep matches = higher confidence).
 *
 * @param {Array<{score: number}>} results - Ranked results
 * @param {object} stats - Search stats (grepMatches, indexedChunks)
 * @returns {{ confidence: 'high'|'medium'|'low', confidenceReason: string }}
 */
export function computeConfidence(results, stats) {
  if (!results || results.length === 0) {
    return { confidence: 'low', confidenceReason: 'no_results' };
  }

  if (results.length === 1) {
    return { confidence: 'high', confidenceReason: 'single_result' };
  }

  const top1 = results[0].score;
  const top2 = results[1].score;

  if (top2 === 0) {
    return { confidence: 'high', confidenceReason: 'clear_winner' };
  }

  const ratio = top1 / top2;

  const grepMatches = stats?.grepMatches || 0;
  const indexedChunks = stats?.indexedChunks || 0;
  if (grepMatches > 0 && indexedChunks === 0) {
    return { confidence: 'low', confidenceReason: 'no_indexed_candidates' };
  }

  let confidence;
  let confidenceReason;

  if (ratio > 2.0) {
    confidence = 'high';
    confidenceReason = 'clear_winner';
  } else if (ratio <= 1.2) {
    // top-1 and top-2 within 20% — ambiguous, agent may want both
    confidence = 'medium';
    confidenceReason = 'close_top2';
  } else {
    // ratio between 1.2 and 2.0 — moderate separation
    confidence = 'medium';
    confidenceReason = 'moderate_gap';
  }

  // Many candidates with similar scores → low
  if (results.length >= 5 && confidence !== 'high') {
    const top5scores = results.slice(0, 5).map(r => r.score);
    const range = top5scores[0] - top5scores[4];
    if (range < top5scores[0] * 0.3) {
      confidence = 'low';
      confidenceReason = 'many_candidates';
    }
  }

  // Low match count = selective regex = more likely correct
  if (grepMatches > 0 && grepMatches <= 10 && confidence === 'medium') {
    confidence = 'high';
    confidenceReason = 'selective_regex';
  }
  // High match count = broad regex = less reliable ranking
  if (grepMatches > 200 && confidence === 'high' && confidenceReason !== 'clear_winner') {
    confidence = 'medium';
    confidenceReason = 'broad_regex';
  }

  return { confidence, confidenceReason };
}

/**
 * Identifiers that look like external references the body uses but does
 * NOT define. We treat anything matching `\b[A-Za-z_][A-Za-z0-9_]{2,}\b`
 * (≥3 chars), excluding language keywords and the symbol's own name.
 * Returns a Set, lower-cased keys plus the original case for diagnostics.
 */
function extractCodeIdentifiers(code, ownSymbolName) {
  const out = new Set();
  if (!code) return out;
  const matches = code.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [];
  const ownLower = (ownSymbolName || '').toLowerCase();
  for (const id of matches) {
    if (LANG_KEYWORDS.has(id)) continue;
    if (id.toLowerCase() === ownLower) continue;
    out.add(id);
  }
  return out;
}

/**
 * Decide whether the body's referenced identifiers are all locally
 * resolvable from headerContext + neighbours + the body itself
 * (i.e. the symbol introduces or imports them all). Used by the
 * stricter `computeSufficiency` rule.
 *
 * Identifiers count as resolved when they are:
 *   - mentioned in `headerContext` (any kind of import/require line)
 *   - mentioned in `neighborsRendered` (callees/imports we surfaced)
 *   - declared inside `code` itself (e.g. const x = ..., function x ...,
 *     parameters in the symbol signature) — detected as identifiers that
 *     appear in lvalue positions (`const X`, `let X`, `function X`,
 *     `class X`, function parameters)
 */
function unresolvedExternalRefs(code, ownSymbolName, headerContext, neighborsRendered) {
  const externals = extractCodeIdentifiers(code, ownSymbolName);
  if (!externals.size) return new Set();
  const resolvedHaystack = (headerContext || '') + '\n' + (neighborsRendered || '');
  // Approximate "declared locally in this code block": any identifier that
  // appears in an lvalue-ish position. We only need a rough check, false
  // positives here just mean "looks self-contained" (which is fine).
  const localDecls = new Set();
  const lvalueRe = /\b(?:const|let|var|function|class|fn|def|struct|enum|trait|impl|type|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = lvalueRe.exec(code))) localDecls.add(m[1]);
  // Function-parameter approximation: capture top-of-block `(...)` after the symbol name.
  const sigRe = new RegExp(`\\b${(ownSymbolName || '').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\(([^)]*)\\)`);
  if (ownSymbolName) {
    const sig = code.match(sigRe);
    if (sig) {
      for (const part of sig[1].split(/[,\s]+/)) {
        const id = part.replace(/[:=\[\]?<>]/g, '').replace(/\.\.\./, '').trim();
        if (id) localDecls.add(id);
      }
    }
  }
  const unresolved = new Set();
  for (const id of externals) {
    if (localDecls.has(id)) continue;
    if (resolvedHaystack.includes(id)) continue;
    unresolved.add(id);
  }
  return unresolved;
}

/**
 * Compute sufficiency signal — does the returned context likely contain
 * enough information to answer the query?
 *
 * Tightened rule (May 2026 — addresses the dominant agent-bench loss
 * pattern): a complete symbol on its own is NOT sufficient. We also
 * require either (a) the symbol's external references are resolved
 * (header imports + 1-hop graph neighbours), or (b) the symbol is
 * provably self-contained (no unresolved external identifiers).
 *
 * Reasons emitted (independent signals, kept for diagnostics):
 *   - complete_symbol     : top-1 is a full, non-truncated symbol
 *   - header_resolved     : top-1 has resolved import/header context
 *   - neighbors_present   : the package surfaced ≥1 1-hop graph neighbour
 *   - self_contained_strict: every external identifier in the body is
 *                            either declared locally, in headerContext,
 *                            or in the surfaced neighbours list
 *   - high_confidence     : score gap puts top-1 well ahead of top-2
 *
 * Query-conditioned rule (July 2026 — full200 bench forensics showed the
 * structural rule mislabels systemically: `confidence=low sufficient=YES`
 * was the modal trailer, 156×, and reasons were structural in ~all cases):
 * the verdict is now 3-valued and REQUIRES positive query-match evidence
 * in top-1 (see core/search/query-sufficiency.js):
 *
 *   yes     := strong query evidence (exact anchor hit or high subtoken
 *              overlap) AND (confidence=high OR (confidence=medium AND
 *              structural resolution))
 *   no      := no results, or a query with real anchors finding nothing
 *              in top-1 (confirmed absence)
 *   unknown := everything ambiguous (incl. the old structural-only YES,
 *              now reported as reason=well_formed_only)
 *
 * Structural facts (complete_symbol / header_resolved / neighbors_present /
 * self_contained_strict) are kept as diagnostic reasons and as the
 * resolution gate for medium-confidence YES — they can no longer produce
 * YES on their own. `sufficient` (boolean) stays = (verdict === 'yes') for
 * every structured consumer (MCP zod schema, bench counters).
 *
 * @param {object} topResult
 * @param {{ confidence: string }} confidenceInfo
 * @param {{ query?: string, regex?: string, lowerResults?: object[] }} [queryContext]
 * @returns {{ sufficient: boolean, verdict: 'yes'|'no'|'unknown',
 *             sufficiencyReason: string, reasons: string[],
 *             unresolvedExternalCount: number, evidence: object|null }}
 */
export function computeSufficiency(topResult, confidenceInfo, queryContext = {}) {
  const reasons = [];

  const isComplete = !!(topResult.symbol &&
    topResult.presentation === 'full' &&
    !topResult.code?.includes('// ... ('));
  if (isComplete) reasons.push('complete_symbol');

  const hasHeader = !!topResult.headerContext;
  if (hasHeader) reasons.push('header_resolved');

  // Pattern mode (ss-find) never carries neighbours (graphNeighborsEnabled), so
  // there resolution rests on header + self-containment: what the agent sees.
  // Resolution only picks the why-token of an 'unknown' verdict
  // (well_formed_only vs partial_query_evidence); it never moves the verdict.
  const hasNeighbors = !!(topResult.neighbors && topResult.neighbors.count > 0);
  if (hasNeighbors) reasons.push('neighbors_present');

  // Strict self-containment: only fires if the body has zero unresolved
  // external identifiers (after considering header + neighbours + locals).
  let unresolvedCount = 0;
  if (isComplete && topResult.code) {
    const unresolved = unresolvedExternalRefs(
      topResult.code,
      topResult.symbol,
      topResult.headerContext || '',
      topResult.neighbors?.rendered || ''
    );
    unresolvedCount = unresolved.size;
    if (unresolvedCount === 0) reasons.push('self_contained_strict');
  }

  if (confidenceInfo?.confidence === 'high') reasons.push('high_confidence');

  const hasResolution = hasHeader || hasNeighbors || reasons.includes('self_contained_strict');

  // Query-conditioned verdict: structural facts are the resolution gate,
  // never the whole answer. See query-sufficiency.js for the fusion rule.
  const { verdict, reason: sufficiencyReason, evidence } = computeSufficiencyVerdict({
    topResult,
    confidenceInfo,
    query: queryContext.query || '',
    regex: queryContext.regex || '',
    structural: { isComplete, hasResolution },
    lowerResults: queryContext.lowerResults || [],
  });

  if (evidence?.exactHit) reasons.push('query_literal_matched');
  else if (evidence?.strength === 'strong') reasons.push('query_token_overlap');
  else if (evidence?.strength === 'none') reasons.push('no_query_evidence');

  return {
    sufficient: verdict === 'yes',
    verdict,
    sufficiencyReason,
    reasons,
    unresolvedExternalCount: unresolvedCount,
    evidence,
  };
}
