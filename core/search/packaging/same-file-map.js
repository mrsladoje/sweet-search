/**
 * Builds the same-file span map of a result and refills covered summaries.
 */

import { isSummaryOnly, shownCodeSpan } from '../agent-output-fixes.js';
import { estimateTokens } from './budget.js';

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
/**
 * Same-file span map (2026-07, within-file blind-spot fix). When the top-1
 * pack entry is a WINDOWED view of a file (kind chunk/sandwich/syntax — not
 * a fully-shown symbol) and the sufficiency verdict is not a clear YES, one
 * compact line names the sibling symbols immediately above/below the shown
 * window so the agent can sweep the fix surface instead of leaving the file
 * (the fhir/sushi-1175 miss shape: right file, bug 30 lines above the
 * window). Names+kinds+lines only — never bodies; ~25-45 tokens.
 *
 * @param {{ file:string, startLine:number, endLine:number }} top - top-1 agent result
 * @param {{ above:Array, below:Array }} adjacent - findAdjacentEntities() result
 * @returns {{ rendered:string, tokens:number, neighbors:Array }|null}
 */
export function buildSameFileMap(top, adjacent) {
  const above = adjacent?.above || [];
  const below = adjacent?.below || [];
  if (above.length === 0 && below.length === 0) return null;
  const shortType = t => (t === 'function' ? 'fn' : (t || 'sym'));
  const fmt = (e, pos) => `${e.name} (${shortType(e.type)} ${e.startLine}-${e.endLine} ${pos})`;
  const neighbors = [
    ...above.map(e => ({ ...e, position: 'above' })),
    ...below.map(e => ({ ...e, position: 'below' })),
  ];
  const parts = [
    ...above.map(e => fmt(e, 'above')),
    ...below.map(e => fmt(e, 'below')),
  ];
  // Placeholder-style drill-in hint (the v2.6.13 `ss-grep "<regex>" --in
  // <file>` convention, which agents demonstrably follow) — embedding the
  // live query costs ~25-30 tokens per pack for no extra signal.
  const rendered = `# same file: ${parts.join(' · ')} — sweep: ss-semantic ${top.file} "<query>"`;
  return { rendered, tokens: estimateTokens(rendered), neighbors };
}

/**
 * Replace summary entries that an earlier entry already covers with reserve
 * candidates (see the call site in packageForAgent). Kept entries keep their
 * order; replacements go at the end, in reserve order, as summary entries;
 * ranks are renumbered 1..n. A covered entry is kept when the reserve has no
 * usable candidate left (A2 then drops it from the printed text).
 *
 * @param {Array} agentResults packaged entries (rank order)
 * @param {Array} reserve ranked candidates after the final cut
 * @returns {{ results: Array, replaced: number }}
 */
export function refillCoveredSummaries(agentResults, reserve) {
  const seen = [];
  const coveredBy = (file, s, e) => seen.some(x => x.file === file
    && ((x.start === s && x.end === e) || (x.shown && s >= x.shown.start && e <= x.shown.end)));
  const note = (r) => seen.push({ file: r.file, start: r.startLine, end: r.endLine, shown: shownCodeSpan(r) });

  const kept = [];
  const covered = [];
  for (const r of agentResults) {
    if (isSummaryOnly(r) && coveredBy(r.file, r.startLine, r.endLine)) { covered.push(r); continue; }
    kept.push(r);
    note(r);
  }
  if (covered.length === 0) return { results: agentResults, replaced: 0 };

  const replacements = [];
  for (const cand of reserve) {
    if (replacements.length >= covered.length) break;
    const meta = cand?.metadata || {};
    const file = meta.file || cand?.file;
    const s = meta.startLine || cand?.startLine;
    const e = meta.endLine || cand?.endLine;
    if (!file || !Number.isFinite(s) || !Number.isFinite(e) || coveredBy(file, s, e)) continue;
    const name = meta.name || cand.name || null;
    const type = meta.type || cand.type || null;
    const entry = {
      rank: 0,
      file,
      startLine: s,
      endLine: e,
      symbol: name,
      symbolType: type,
      score: cand.score || cand.lateInteractionScore || 0,
      expanded: false,
      presentation: 'summary',
      stale: false,
      indexedAt: null,
      summary: `${file}:${s} — ${name || 'code block'}${type ? ' (' + type + ')' : ''}`,
      code: null,
      codeTokens: 0,
    };
    replacements.push(entry);
    note(entry);
  }
  if (replacements.length === 0) return { results: agentResults, replaced: 0 };
  // Covered entries without a replacement stay (at their rank order) for A2.
  const unreplaced = new Set(covered.slice(replacements.length));
  const results = agentResults.filter(r => !covered.includes(r) || unreplaced.has(r))
    .concat(replacements)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));
  return { results, replaced: replacements.length };
}
