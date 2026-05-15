/**
 * Synthetic tombstone-injection harness.
 *
 * Plan § 13 Phase 5, § 14.1 measurement 1. The harness picks a random
 * fraction of vectors in `codebase.db::vectors`, marks them tombstoned
 * (sets `epoch_retired`), and lets the search path apply the
 * manifest-epoch predicate so the GCSN dev sweep can measure
 * MRR-vs-tombstone-fraction.
 *
 * Discipline (CLAUDE.md `feedback_heldout_discipline_strict.md`):
 *   - The sweep runs on **dev** GCSN, not held-out.
 *   - Use a fixed seed (`SWEET_SEARCH_TOMBSTONE_SEED`, default 42) so
 *     reruns reproduce.
 *   - The harness restores the original `epoch_retired` values on exit
 *     so the index returns to its pre-experiment state.
 *
 * Output:
 *   - A `restore` function the runner calls at the end of each sweep
 *     point to undo the injection.
 *   - A `report` object with the actual fraction injected (may differ
 *     from the request slightly due to row count rounding).
 *
 * This module is pure infrastructure — the runner script in
 * `scripts/incremental-indexing-tombstone-sensitivity.mjs` ties it to
 * the GCSN benchmark loop.
 */

const DEFAULT_SEED = 42;

/**
 * Deterministic 32-bit PRNG (mulberry32). Seeded with an integer, returns
 * a function producing floats in [0, 1).
 *
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let s = (seed | 0) || 1;
  return function rand() {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Inject tombstones at the requested fraction.
 *
 * @param {object} options
 * @param {import('better-sqlite3').Database} options.db   The `codebase.db` vectors database.
 * @param {number} options.fraction        0 < fraction <= 0.5
 * @param {number} options.epoch           ε+1 to write into epoch_retired
 * @param {number} [options.seed=42]
 * @param {string} [options.sessionFilter]  Restrict to one `session_id` if set.
 * @returns {{injected:number, fraction:number, restore:() => void}}
 */
export function injectTombstones({ db, fraction, epoch, seed = DEFAULT_SEED, sessionFilter }) {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 0.5) {
    throw new Error(`injectTombstones: fraction must be in (0, 0.5], got ${fraction}`);
  }
  if (!Number.isInteger(epoch) || epoch <= 0) {
    throw new Error(`injectTombstones: epoch must be a positive integer, got ${epoch}`);
  }
  const rand = mulberry32(seed);

  const liveRowsQ = sessionFilter
    ? `SELECT id FROM vectors WHERE session_id = ? AND epoch_retired IS NULL`
    : `SELECT id FROM vectors WHERE epoch_retired IS NULL`;
  const rows = sessionFilter
    ? db.prepare(liveRowsQ).all(sessionFilter)
    : db.prepare(liveRowsQ).all();
  const total = rows.length;
  if (total === 0) {
    return { injected: 0, fraction: 0, restore: () => {} };
  }
  const target = Math.floor(total * fraction);

  // Fisher-Yates sample without replacement.
  const indices = new Array(total);
  for (let i = 0; i < total; i++) indices[i] = i;
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
  }
  const picked = indices.slice(0, target).map((i) => rows[i].id);

  const update = db.prepare(`
    UPDATE vectors
       SET epoch_retired = ?
     WHERE id = ? AND epoch_retired IS NULL
  `);
  const transaction = db.transaction((ids) => {
    for (const id of ids) update.run(epoch, id);
  });
  transaction(picked);

  const restore = () => {
    const undo = db.prepare(`
      UPDATE vectors
         SET epoch_retired = NULL
       WHERE id = ? AND epoch_retired = ?
    `);
    const undoTxn = db.transaction((ids) => {
      for (const id of ids) undo.run(id, epoch);
    });
    undoTxn(picked);
  };

  return {
    injected: picked.length,
    fraction: picked.length / total,
    restore,
  };
}

/**
 * Run a sweep across the requested fraction list, calling `runOnce`
 * between injection and restore. The runner is responsible for actually
 * executing the benchmark — this helper is intentionally agnostic.
 *
 * @param {object} options
 * @param {import('better-sqlite3').Database} options.db
 * @param {number[]} options.fractions
 * @param {(meta:{fraction:number, injected:number}) => Promise<object>} options.runOnce
 * @param {number} [options.seed=42]
 * @param {number} [options.epoch=1_000_000]
 * @returns {Promise<Array<{fraction:number, injected:number, result:object}>>}
 */
export async function sweepTombstoneFractions({ db, fractions, runOnce, seed = DEFAULT_SEED, epoch = 1_000_000 }) {
  if (!Array.isArray(fractions) || fractions.length === 0) {
    throw new Error('sweepTombstoneFractions: fractions must be a non-empty array');
  }
  const points = [];
  for (const f of fractions) {
    const inj = injectTombstones({ db, fraction: f, epoch, seed });
    try {
      const result = await runOnce({ fraction: inj.fraction, injected: inj.injected });
      points.push({ fraction: inj.fraction, injected: inj.injected, result });
    } finally {
      inj.restore();
    }
  }
  return points;
}

export const __testing = { mulberry32 };
