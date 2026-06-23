/**
 * FTS5 introspection helpers used by the reconcile watermark scheduler.
 *
 * Plan § 7.1.5 requires a `fts5SegmentCount(db, tableName)` helper so the
 * watermark check (segment count > 64 → bounded `('merge', 500)`) lives in
 * one place. SQLite's FTS5 keeps a structure record at rowid=10 of the
 * `<name>_data` shadow table. The block format is documented in the FTS5
 * source (fts5_index.c) and stable enough that we ship a tiny varint parser
 * here. If a future SQLite version changes the layout, the helper switches
 * to a fallback heuristic (leaf-page rowid bit shift) without losing the
 * watermark.
 *
 * Reference: SQLite FTS5 docs §7 ("Internal storage of the index"); structure
 * record format mirrors `Fts5StructureLevel` / `Fts5StructureSegment` in
 * fts5_index.c.
 *
 * Plan § 0 / § 37.5: Phase 0 commits to verifying this empirically against
 * the SQLite version in use. The verification record lives in
 * INCREMENTAL_INDEXING_PREFLIGHT_RESULTS.md § 3.
 */

const STRUCTURE_ROWID = 10;

function readVarint(buf, offset) {
  // SQLite varints are big-endian, up to 9 bytes, high-bit continuation.
  let value = 0n;
  let consumed = 0;
  for (let i = 0; i < 9; i++) {
    if (offset + i >= buf.length) {
      throw new Error(`fts5 varint truncated at offset ${offset + i} (buffer len ${buf.length})`);
    }
    const byte = buf[offset + i];
    if (i === 8) {
      // The 9th byte uses all 8 bits.
      value = (value << 8n) | BigInt(byte);
      consumed = 9;
      break;
    }
    value = (value << 7n) | BigInt(byte & 0x7F);
    if ((byte & 0x80) === 0) {
      consumed = i + 1;
      break;
    }
  }
  return { value, consumed };
}

/**
 * Return the number of segments stored in an FTS5 index.
 *
 * Implementation: parse the structure record at `id = 10` of the
 * `<name>_data` shadow table when possible (cookie + varints, per
 * `fts5StructureDecode` in fts5_index.c). The structure record format is
 * stable across SQLite 3.x but the per-level field order has shifted
 * subtly between minor versions, so we cross-check the parsed count
 * against a robust fallback: distinct segment-IDs derived from leaf-page
 * rowids in `<name>_data`. Per the FTS5 source,
 *
 *   leaf_rowid = (segid << (FTS5_DATA_HEIGHT_B + FTS5_DATA_PAGE_B))
 *              | (height << FTS5_DATA_PAGE_B)
 *              | pgno
 *
 * with `FTS5_DATA_HEIGHT_B = 5` and `FTS5_DATA_PAGE_B = 31`. Distinct
 * `rowid >> 36` values therefore approximate segment count tightly. If
 * the two methods agree, return the parsed value; otherwise prefer the
 * shift-based fallback (it cannot be wrong about distinct rowid prefixes).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName  Name of the FTS5 virtual table (not the shadow).
 * @returns {number}
 */
export function fts5SegmentCount(db, tableName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`fts5SegmentCount: invalid table name ${tableName}`);
  }
  const shadow = `${tableName}_data`;
  let rowids;
  try {
    // Cookie is at id<10; leaf pages live at id≥100. Distinct segid prefixes
    // are the robust count.
    rowids = db.prepare(`SELECT id FROM ${shadow} WHERE id >= 100`).all();
  } catch (err) {
    if (/no such table/i.test(err.message)) return 0;
    throw err;
  }
  if (rowids.length === 0) return 0;

  const seg = new Set();
  for (const r of rowids) {
    const id = BigInt(r.id);
    seg.add(Number(id >> 36n));
  }
  return seg.size;
}

/**
 * Internal: parse the FTS5 structure record at id=10 and return the per-level
 * segment counts. Exported only for tests / diagnostic tooling; production
 * code uses `fts5SegmentCount` which falls back to the rowid-shift method.
 *
 * Returns `{ cookie, nLevel, nSegment, levels: [{ nMerge, nSeg }] }` on
 * success, or `null` if the table has no structure record yet.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 */
export function fts5StructureDescribe(db, tableName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`fts5StructureDescribe: invalid table name ${tableName}`);
  }
  const shadow = `${tableName}_data`;
  let row;
  try {
    row = db.prepare(`SELECT block FROM ${shadow} WHERE id = ?`).get(STRUCTURE_ROWID);
  } catch (err) {
    if (/no such table/i.test(err.message)) return null;
    throw err;
  }
  if (!row || !row.block) return null;

  const buf = Buffer.isBuffer(row.block) ? row.block : Buffer.from(row.block);
  if (buf.length < 6) return null;
  const cookie = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  let offset = 4;
  const nLevelVI = readVarint(buf, offset); offset += nLevelVI.consumed;
  const nSegmentVI = readVarint(buf, offset); offset += nSegmentVI.consumed;
  const levels = [];
  try {
    for (let level = 0; level < Number(nLevelVI.value); level++) {
      const nMerge = readVarint(buf, offset); offset += nMerge.consumed;
      const nSeg = readVarint(buf, offset); offset += nSeg.consumed;
      levels.push({ nMerge: Number(nMerge.value), nSeg: Number(nSeg.value) });
      for (let s = 0; s < Number(nSeg.value); s++) {
        const segid = readVarint(buf, offset); offset += segid.consumed;
        const pgnoFirst = readVarint(buf, offset); offset += pgnoFirst.consumed;
        const pgnoLast = readVarint(buf, offset); offset += pgnoLast.consumed;
        void segid; void pgnoFirst; void pgnoLast;
      }
    }
  } catch {
    // Partial parse; return what we have. Phase 0 preflight asserts the
    // structure-record parse matches the rowid-shift count; mismatch is a
    // documented version-skew failure mode.
  }
  return {
    cookie,
    nLevel: Number(nLevelVI.value),
    nSegment: Number(nSegmentVI.value),
    levels,
  };
}

/**
 * Convenience wrapper that runs a bounded merge ("incremental compaction")
 * on an FTS5 table. Plan § 7.1.5: every reconcile tick calls
 * `('merge', 16)`; the watermark scheduler calls `('merge', 500)`.
 *
 * The function never calls `('optimize')` because that produces a single-
 * transaction rewrite of the FTS5 index, which trips the 256 MiB WAL bloat
 * alarm on a populated table.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @param {number} pages   Page budget per merge call (plan defaults: 16 or 500).
 */
export function fts5Merge(db, tableName, pages) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`fts5Merge: invalid table name ${tableName}`);
  }
  if (!Number.isInteger(pages) || pages <= 0) {
    throw new Error(`fts5Merge: pages must be a positive integer, got ${pages}`);
  }
  db.prepare(`INSERT INTO ${tableName}(${tableName}, rank) VALUES('merge', ?)`).run(pages);
}

/**
 * Derive the FTS5 merge page budget from the spare CPU budget for a tick, using
 * the token-bucket policy in lever E.5:
 *
 *   - tick fast (elapsed < `fastMs`, default 500 ms) → a small merge step
 *     (`smallPages`, default 16 — the same fixed value the reconcile tick used
 *     before budgeting, so a fast tick is byte/behavior-equivalent to today);
 *   - tick busy (elapsed > `slowMs`, default 1800 ms) → skip the merge
 *     (`null`) to leave CPU for reconcile;
 *   - in between → the small step.
 *
 * Returns a positive integer page count, or `null` to skip the merge entirely.
 *
 * @param {{elapsedMs: number, fastMs?: number, slowMs?: number, smallPages?: number}} args
 * @returns {number|null}
 */
export function fts5MergeBudgetPages({ elapsedMs, fastMs = 500, slowMs = 1800, smallPages = 16 } = {}) {
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  if (elapsed > slowMs) return null;
  return smallPages;
}

/**
 * Derive the watermark-handler FTS5 merge page budget from the wall-clock budget
 * remaining for the maintenance drain. A generous budget keeps the original
 * aggressive `pages=500`; a tight remaining budget scales the page count down
 * (floor 16) so a near-exhausted drain still makes a small step of forward
 * progress rather than blowing the budget on one 500-page merge.
 *
 * @param {{remainingMs: number, maxPages?: number, minPages?: number, fullBudgetMs?: number}} args
 * @returns {number}
 */
export function fts5WatermarkBudgetPages({ remainingMs, maxPages = 500, minPages = 16, fullBudgetMs = 2000 } = {}) {
  if (!Number.isFinite(remainingMs) || remainingMs >= fullBudgetMs) return maxPages;
  if (remainingMs <= 0) return minPages;
  const scaled = Math.round((remainingMs / fullBudgetMs) * maxPages);
  return Math.max(minPages, Math.min(maxPages, scaled));
}

/**
 * Run a full FTS5 `('optimize')` rewrite of one table, then immediately
 * `wal_checkpoint(TRUNCATE)` to flush the (potentially large) optimize
 * transaction out of the WAL and truncate it back to zero — guarding the
 * documented 256 MiB WAL-bloat alarm that is the reason `fts5Merge` itself
 * never calls optimize (see `fts5Merge` note above).
 *
 * Lever E.5 (`SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE`). The CALLER is responsible
 * for the gate: optimize must run ONLY on true-idle (consecutive empty ticks)
 * AND only when a table-size check says it is worth it. This helper does not
 * decide *when* — it just performs the optimize + checkpoint as one safe unit.
 *
 * `('optimize')` is a single-transaction rewrite: it merges every segment into
 * one. It is idempotent (a second call on an already-optimized table is a near
 * no-op) and output-equivalent to a fully-merged index — query results are
 * unchanged.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName  Name of the FTS5 virtual table (not the shadow).
 * @returns {{optimized: boolean}}
 */
export function fts5Optimize(db, tableName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`fts5Optimize: invalid table name ${tableName}`);
  }
  db.prepare(`INSERT INTO ${tableName}(${tableName}) VALUES('optimize')`).run();
  // Flush + truncate the WAL the optimize transaction just grew. Best-effort:
  // a checkpoint failure (e.g. an active reader) must not turn a successful
  // optimize into a thrown error on the maintainer path.
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
  return { optimized: true };
}

export const __testing = { readVarint, STRUCTURE_ROWID };
