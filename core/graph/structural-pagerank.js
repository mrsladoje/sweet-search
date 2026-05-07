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
  for (const node of allNodes) scores.set(node, initScore);

  for (let iter = 0; iter < maxIter; iter++) {
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
  const allNodes = new Set();
  for (const row of db.prepare('SELECT id FROM entities WHERE stale_since IS NULL').iterate()) {
    allNodes.add(row.id);
  }
  const outEdges = new Map();
  const stmt = db.prepare(`
    SELECT source_id, target_id, type, COALESCE(weight, 1.0) AS weight
    FROM relationships
    WHERE source_id IS NOT NULL AND target_id IS NOT NULL
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
 * Ensure the `page_rank` REAL column exists on entities. Idempotent.
 * Older databases predate this column, so existing indexes auto-migrate.
 *
 * @param {import('better-sqlite3').Database} db - writable
 * @returns {boolean} true on success
 */
export function ensurePageRankColumn(db) {
  try {
    const columns = db.prepare('PRAGMA table_info(entities)').all();
    const has = columns.some(col => col.name === 'page_rank');
    if (!has) {
      db.exec('ALTER TABLE entities ADD COLUMN page_rank REAL DEFAULT 0');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_entities_page_rank ON entities(page_rank) WHERE stale_since IS NULL');
    return true;
  } catch (err) {
    if (err && /duplicate column/i.test(err.message)) return true;
    return false;
  }
}

/**
 * Compute weighted PageRank and persist it to the `page_rank` column.
 * Index-build calls this once after relationships are fully resolved.
 *
 * @param {import('better-sqlite3').Database} db - writable code-graph DB
 * @param {object} [opts]
 * @returns {{ entities: number, iterations: number, ms: number, written: number }}
 */
export function populatePageRankColumn(db, opts = {}) {
  const started = Date.now();
  ensurePageRankColumn(db);
  const { outEdges, allNodes } = buildWeightedAdjacency(db);
  if (allNodes.size === 0) {
    return { entities: 0, iterations: 0, ms: Date.now() - started, written: 0 };
  }
  const scores = pageRankWeighted(outEdges, allNodes, opts);
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
  return { entities: allNodes.size, iterations: -1, ms: Date.now() - started, written };
}

export const __TEST__ = { RELATIONSHIP_TYPE_WEIGHTS, DEFAULT_DAMPING };
