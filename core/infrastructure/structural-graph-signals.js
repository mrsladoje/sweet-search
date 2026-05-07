/**
 * Persistence helpers for structural graph importance signals.
 *
 * Extracted from structural-context-repository.js so the repository stays
 * under the 500-line ceiling. These functions all consume an open
 * better-sqlite3 handle plus a list of entity IDs and return primitive
 * values; they hold no state and live in infrastructure/ alongside the
 * repository they support.
 */

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function dropExternalIds(ids) {
  return [...new Set((ids || []).filter(id => id && !String(id).startsWith('external:')))];
}

function clampLimit(value, fallback, max) {
  const n = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(max, n));
}

const DEFAULT_REL_TYPES = ['calls', 'uses', 'implements', 'extends', 'overrides'];

/**
 * Batch-fetch precomputed PageRank values from the entities table.
 *
 * Returns 0 for any ID that's missing, external, or whose row predates the
 * `page_rank` column. Index-build populates this column via
 * core/graph/structural-pagerank.js#populatePageRankColumn.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<string|number>} entityIds
 * @returns {Map<string|number, number>}
 */
export function fetchPageRank(db, entityIds) {
  const ids = dropExternalIds(entityIds);
  const out = new Map(ids.map(id => [id, 0]));
  if (!db || ids.length === 0) return out;
  try {
    const rows = db.prepare(`
      SELECT id, COALESCE(page_rank, 0) AS pr
      FROM entities
      WHERE id IN (${placeholders(ids)}) AND stale_since IS NULL
    `).all(...ids);
    for (const row of rows) {
      if (out.has(row.id)) out.set(row.id, Number.isFinite(row.pr) ? row.pr : 0);
    }
  } catch {
    // Legacy DBs (or test fixtures) lack page_rank — leave zeros.
  }
  return out;
}

/**
 * Load incoming one-hop edges for a frontier of entity IDs ("who calls these").
 *
 * Powers the backward Forward-Push subgraph used to rank callers by their
 * importance relative to the target symbol.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<string|number>} frontierIds
 * @param {object} [opts]
 * @param {string[]} [opts.types]
 * @param {number} [opts.limit=4000]
 * @returns {Array<{ from: string|number, to: string|number, weight: number }>}
 */
export function fetchFrontierBackwardEdges(db, frontierIds, opts = {}) {
  const ids = dropExternalIds(frontierIds);
  if (!db || ids.length === 0) return [];
  const limit = clampLimit(opts.limit, 4000, 20000);
  const types = opts.types?.length ? opts.types : DEFAULT_REL_TYPES;
  const rows = db.prepare(`
    SELECT source_id, target_id, COALESCE(weight, 1.0) AS weight
    FROM relationships
    WHERE target_id IN (${placeholders(ids)})
      AND source_id IS NOT NULL
      AND type IN (${placeholders(types)})
    LIMIT ?
  `).all(...ids, ...types, limit);
  return rows.map(row => ({ from: row.target_id, to: row.source_id, weight: row.weight }));
}

/**
 * Load outgoing one-hop edges for a frontier of entity IDs ("what these call").
 *
 * Powers the forward Forward-Push subgraph used to rank callees by their
 * relevance to the target symbol's downstream flow.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<string|number>} frontierIds
 * @param {object} [opts]
 * @param {string[]} [opts.types]
 * @param {number} [opts.limit=4000]
 * @returns {Array<{ from: string|number, to: string|number, weight: number }>}
 */
export function fetchFrontierForwardEdges(db, frontierIds, opts = {}) {
  const ids = dropExternalIds(frontierIds);
  if (!db || ids.length === 0) return [];
  const limit = clampLimit(opts.limit, 4000, 20000);
  const types = opts.types?.length ? opts.types : DEFAULT_REL_TYPES;
  const rows = db.prepare(`
    SELECT source_id, target_id, COALESCE(weight, 1.0) AS weight
    FROM relationships
    WHERE source_id IN (${placeholders(ids)})
      AND target_id IS NOT NULL
      AND type IN (${placeholders(types)})
    LIMIT ?
  `).all(...ids, ...types, limit);
  return rows.map(row => ({ from: row.source_id, to: row.target_id, weight: row.weight }));
}
