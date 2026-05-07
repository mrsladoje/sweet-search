/**
 * Importance scoring for structural-trace items.
 *
 * The trace builder computes an `importance` value per caller, callee, and
 * impact path. The formula fuses three classes of signal:
 *
 *   1. Query-time directional Personalized PageRank (PPR) from the target —
 *      dominant graph signal. Backward direction ranks callers; forward
 *      direction ranks callees. This is what makes "fan-in" mean *important*
 *      fan-in: a leaf utility called by many things does not get high PPR
 *      relative to a specific target unless that target itself reaches it.
 *
 *   2. Static index-time PageRank (page_rank column) — a backstop that helps
 *      degenerate subgraphs (small symbols, brand-new code with no incoming
 *      edges yet) where Forward Push has nothing to flow.
 *
 *   3. Structural heuristics — relationship type, depth, exported-API status,
 *      type kind, hint-token overlap, fan-in tiebreaker. Penalties for
 *      test-only paths and unresolved external nodes.
 *
 * Score weights sum to 1.0 over the positive terms; the test/external
 * negatives are intentionally large enough to guarantee production callers
 * beat fixtures.
 */

export const REL_WEIGHT = { calls: 1.0, uses: 0.72, implements: 0.88, extends: 0.84, overrides: 0.78 };
export const TYPE_WEIGHT = {
  class: 0.92, struct: 0.9, trait: 0.88, interface: 0.86, enum: 0.84,
  function: 0.84, method: 0.82, component: 0.78, type: 0.7, typeAlias: 0.68, external: 0.2,
};

export function isTestPath(filePath = '') {
  return /(^|\/)(__tests__|tests?|spec|fixtures|examples?|docs?)(\/|$)|[-_.](test|spec)\.[cm]?[jt]sx?$|_test\.go$/.test(filePath);
}

export function isExported(entity) {
  const name = entity?.name || '';
  const sig = entity?.signature || '';
  if (!name) return false;
  if (/^\w/.test(name) && name[0] === name[0].toUpperCase()) return true;
  return /\b(export|public|pub)\b/.test(sig) || /^[A-Z_][A-Z0-9_]+$/.test(name);
}

export function logNorm(value, maxValue) {
  if (!value || !maxValue) return 0;
  return Math.log1p(value) / Math.log1p(maxValue);
}

export function tokenize(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) || [])];
}

// A/B knobs for ranking ablation. Read once at module load.
//   SWEET_SEARCH_TRACE_NO_PPR=1 → drop the 0.20 directional PPR contribution.
//   SWEET_SEARCH_TRACE_NO_PR=1  → drop the 0.10 static PageRank contribution.
// These let probe runs isolate the marginal contribution of each graph signal
// without rebuilding the index or maintaining a second worktree. Off by default.
const NO_PPR = process.env.SWEET_SEARCH_TRACE_NO_PPR === '1';
const NO_PR = process.env.SWEET_SEARCH_TRACE_NO_PR === '1';

export function getAblationFlags() {
  return { noPpr: NO_PPR, noPr: NO_PR };
}

export function hintScore(entity, hintTokens) {
  if (!hintTokens.length) return 0;
  const hay = `${entity.name} ${entity.type} ${entity.signature} ${entity.summary}`.toLowerCase();
  let hits = 0;
  for (const tok of hintTokens) if (hay.includes(tok)) hits++;
  return hits / hintTokens.length;
}

/**
 * Score a single caller/callee/impact-node entity.
 *
 * Weights (sum to 1.0):
 *   0.20 proximity (1/depth) — prefer direct neighbours of target
 *   0.16 relationship type (calls > implements > uses)
 *   0.20 directional PPR — primary signal
 *   0.10 static PageRank — backstop
 *   0.10 fan-in tiebreaker — keep load-bearing leaves above no-signal nodes
 *   0.08 entity type kind (classes/structs above untyped)
 *   0.06 isExported (public API surface)
 *   0.10 hint-token overlap — caller-supplied query intent
 *
 * Penalties (additive, can drop below positive sum):
 *  -0.38 isTestPath — production callers must beat test fixtures
 *  -0.25 type='external' — unresolved targets are not authoritative
 *
 * @param {object} entity - caller/callee row with relationship, depth, file
 * @param {object} ctx - score context (fan, pageRank, pprScores, max*, hintTokens)
 * @returns {number} importance in (0, 1.5]
 */
export function scoreEntity(entity, ctx) {
  const fan = ctx.fan?.get?.(entity.id) || { fanIn: 0, fanOut: 0 };
  const rel = REL_WEIGHT[entity.relationship] ?? 0.55;
  const proximity = 1 / Math.max(1, entity.depth || 1);
  const ppr = ctx.pprScores?.get?.(entity.id) || 0;
  const pageRank = ctx.pageRank?.get?.(entity.id) || 0;
  const pprTerm = NO_PPR ? 0 : 0.20 * logNorm(ppr, ctx.maxPpr || 1);
  const prTerm = NO_PR ? 0 : 0.10 * logNorm(pageRank, ctx.maxPageRank || 1);
  let score =
    0.20 * proximity +
    0.16 * rel +
    pprTerm +
    prTerm +
    0.10 * logNorm(fan.fanIn, ctx.maxFanIn || 1) +
    0.08 * (TYPE_WEIGHT[entity.type] ?? 0.5) +
    0.06 * (isExported(entity) ? 1 : 0) +
    0.10 * hintScore(entity, ctx.hintTokens || []);
  if (isTestPath(entity.filePath)) score -= 0.38;
  if (entity.type === 'external') score -= 0.25;
  return Math.max(0.01, score);
}

/**
 * Score an impact path using the bottleneck and average node importance.
 *
 * The caller passes in the score context that matches the path's direction:
 * a downstream path's nodes are scored against the forward (callee) PPR run,
 * an upstream path's against the backward (caller) PPR run. This avoids the
 * directional bias where standard global PR over-promotes leaf utilities.
 *
 * @param {object} path - { direction, depth, path: [...nodes] }
 * @param {object} ctx - directional score context
 * @returns {number} importance in (0, 1.5]
 */
export function scoreImpactPath(path, ctx) {
  const nodes = path.direction === 'downstream' ? path.path.slice(1) : path.path.slice(0, -1);
  const scored = nodes.map(node => scoreEntity({ ...node, depth: path.depth }, ctx));
  if (!scored.length) return 0.01;
  const bottleneck = Math.min(...scored);
  const avg = scored.reduce((a, b) => a + b, 0) / scored.length;
  return Math.max(0.01, (0.55 * bottleneck + 0.45 * avg) / Math.sqrt(path.depth));
}

/**
 * Compute normalization constants from a score context.
 * Avoids divide-by-zero in logNorm when the subgraph is degenerate.
 *
 * @param {Iterable<number>} values
 * @returns {number} max value, never below 1e-9
 */
export function safeMax(values) {
  let m = 1e-9;
  for (const v of values) if (Number.isFinite(v) && v > m) m = v;
  return m;
}
