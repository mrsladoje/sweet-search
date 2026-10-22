/**
 * Structural PageRank — index-time edge-weighted PageRank for the entity call graph.
 *
 * Distinct from core/graph/repo-map.js (which runs unweighted PR on a deduped
 * adjacency for repo-map rendering). This module:
 *   1. Builds a weighted adjacency directly from `relationships.weight` so that
 *      a function called five times gets five units of mass, not one.
 *   2. Persists the result to a `page_rank REAL` column on `entities`, so the
 *      structural-trace builder can read it as a backstop importance signal at
 *      query time without recomputing.
 *
 * Domain layer: the actual SQL writes happen behind a writable database handle
 * passed in by the index builder; no path or filesystem concerns leak in.
 */
import { TRACE_ONLY_TYPES_SQL } from '../infrastructure/relationship-types.js';

const DEFAULT_DAMPING = 0.85;
const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_CONVERGENCE = 1e-6;
const DEFAULT_BATCH_SIZE = 500;
const RELATIONSHIP_TYPE_WEIGHTS = {
  calls: 1.0,
  uses: 0.6,
  implements: 0.85,
  extends: 0.85,
  overrides: 0.75,
};

/**
 * Run edge-weighted PageRank power iteration over a call/use graph.
 *
 * The iteration handles:
 *   - dangling nodes (no out-edges) via uniform mass redistribution
 *   - weighted edges with per-source weight normalization
 *   - early termination on L1 convergence
 *
 * @param {Map<string, Map<string, number>>} weightedOutEdges - source → (target → weight)
 * @param {Set<string>} allNodes - every entity ID, including dangling
 * @param {object} [opts]
 * @param {number} [opts.damping=0.85]
 * @param {number} [opts.maxIterations=50]
 * @param {number} [opts.convergence=1e-6]
 * @param {Map<string, number>} [opts.initialScores] start from these scores (a previous
 *   run's), renormalised to sum 1; nodes without one start at 1/n. Same fixed point and
 *   tolerance as a cold start, in far fewer iterations after a small graph change.
 * @param {{iterations?: number}} [opts.stats] receives the iteration count
 * @returns {Map<string, number>} entity ID → PageRank score (sums to ~1)
 */
export function pageRankWeighted(weightedOutEdges, allNodes, opts = {}) {
  const damping = opts.damping ?? DEFAULT_DAMPING;
  const maxIter = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const convergence = opts.convergence ?? DEFAULT_CONVERGENCE;
  const n = allNodes.size;
  if (n === 0) return new Map();

  const base = (1 - damping) / n;
  const totalOutWeight = new Map();
  const inEdges = new Map();
  for (const node of allNodes) inEdges.set(node, []);
  for (const [src, targets] of weightedOutEdges) {
    if (!allNodes.has(src)) continue;
    let sum = 0;
    for (const [tgt, w] of targets) {
      if (!allNodes.has(tgt) || tgt === src) continue;
      sum += w;
      inEdges.get(tgt).push([src, w]);
    }
    if (sum > 0) totalOutWeight.set(src, sum);
  }

  const danglingNodes = [];
  for (const node of allNodes) {
    if (!totalOutWeight.has(node)) danglingNodes.push(node);
  }

  let scores = new Map();
  const initScore = 1 / n;
  const warm = opts.initialScores;
  let total = 0;
  for (const node of allNodes) {
    const prior = warm?.get(node);
    const v = prior > 0 ? prior : initScore;
    scores.set(node, v);
    total += v;
  }
  if (warm && total > 0) for (const [node, v] of scores) scores.set(node, v / total);

  let iterations = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    let danglingMass = 0;
    for (const node of danglingNodes) danglingMass += scores.get(node);
    const danglingShare = damping * danglingMass / n;

    const next = new Map();
    let delta = 0;
    for (const node of allNodes) {
      let sum = 0;
      for (const [src, w] of inEdges.get(node)) {
        const out = totalOutWeight.get(src);
        if (out > 0) sum += scores.get(src) * (w / out);
      }
      const newScore = base + damping * sum + danglingShare;
      next.set(node, newScore);
      delta += Math.abs(newScore - scores.get(node));
    }
    scores = next;
    if (delta < convergence) break;
  }
  if (opts.stats) opts.stats.iterations = iterations;
  return scores;
}

/**
 * Build a weighted adjacency map from the relationships table.
 *
 * Multiple rows for the same (source, target) collapse via summed weight:
 *   `r.weight * RELATIONSHIP_TYPE_WEIGHTS[r.type]`
 * so that a hot call site contributes more mass than a single import.
 *
 * Unresolved targets (relationships with no target_id) are dropped because
 * PageRank is only defined over nodes that actually exist in the graph.
 *
 * @param {import('better-sqlite3').Database} db - writable code-graph DB
 * @returns {{ outEdges: Map<string, Map<string, number>>, allNodes: Set<string> }}
 */
export function buildWeightedAdjacency(db) {
  // Live rows only: a maintained graph keeps retired rows until GC.
  const liveEntity = 'AND epoch_retired IS NULL';
  const liveEdge = 'AND epoch_retired IS NULL';
  const allNodes = new Set();
  for (const row of db.prepare(`SELECT id FROM entities WHERE stale_since IS NULL ${liveEntity}`).iterate()) {
    allNodes.add(row.id);
  }
  const outEdges = new Map();
  const stmt = db.prepare(`
    SELECT source_id, target_id, type, COALESCE(weight, 1.0) AS weight
    FROM relationships
    WHERE source_id IS NOT NULL AND target_id IS NOT NULL
      AND type NOT IN ${TRACE_ONLY_TYPES_SQL} ${liveEdge}
  `);
  for (const row of stmt.iterate()) {
    if (!allNodes.has(row.source_id) || !allNodes.has(row.target_id)) continue;
    if (row.source_id === row.target_id) continue;
    const typeWeight = RELATIONSHIP_TYPE_WEIGHTS[row.type] ?? 0.5;
    const w = row.weight * typeWeight;
    if (!(w > 0)) continue;
    let bucket = outEdges.get(row.source_id);
    if (!bucket) {
      bucket = new Map();
      outEdges.set(row.source_id, bucket);
    }
    bucket.set(row.target_id, (bucket.get(row.target_id) || 0) + w);
  }
  return { outEdges, allNodes };
}

/**
 * Compute weighted PageRank and persist it to the `page_rank` column.
 * Index-build calls this once after relationships are fully resolved.
 *
 * @param {import('better-sqlite3').Database} db - writable code-graph DB
 * @param {object} [opts]  onlyChanged: write only scores that moved (relative 1e-6)
 * @returns {{ entities: number, iterations: number, ms: number, written: number }}
 */
export function populatePageRankColumn(db, opts = {}) {
  const started = Date.now();
  const { outEdges, allNodes } = buildWeightedAdjacency(db);
  if (allNodes.size === 0) {
    return { entities: 0, iterations: 0, ms: Date.now() - started, written: 0 };
  }
  // The maintainer's refresh (onlyChanged) starts from the stored scores: after a small
  // graph change the iteration converges in a few rounds instead of up to 50.
  const stored = opts.onlyChanged
    ? new Map(db.prepare('SELECT id, page_rank FROM entities WHERE page_rank IS NOT NULL').raw().all())
    : null;
  const stats = {};
  let scores = pageRankWeighted(outEdges, allNodes, { ...opts, ...(stored ? { initialScores: stored } : {}), stats });
  if (opts.onlyChanged) {
    // Most scores barely move between passes, and rewriting all of them cost a WAL write
    // per entity (7 MB per pass at 18k entities).
    scores = [...scores].filter(([id, score]) => {
      const old = stored.get(id);
      return old == null || Math.abs(score - old) > 1e-6 * Math.max(Math.abs(old), 1e-12);
    });
  }
  const update = db.prepare('UPDATE entities SET page_rank = ? WHERE id = ?');
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const tx = db.transaction((rows) => {
    for (const [id, score] of rows) update.run(score, id);
  });
  let written = 0;
  let buffer = [];
  for (const entry of scores) {
    buffer.push(entry);
    if (buffer.length >= batchSize) {
      tx(buffer);
      written += buffer.length;
      buffer = [];
    }
  }
  if (buffer.length) {
    tx(buffer);
    written += buffer.length;
  }
  return { entities: allNodes.size, iterations: stats.iterations ?? -1, ms: Date.now() - started, written };
}

export const __TEST__ = { RELATIONSHIP_TYPE_WEIGHTS, DEFAULT_DAMPING };
