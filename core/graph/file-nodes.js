/**
 * File nodes of the code graph.
 *
 * Top-level code (imports, module-level calls, decorators, script bodies) has
 * no enclosing function, so the extractor gives those relationships the FILE
 * as their source: `source_id = fileNodeId(relPath)`. Every indexed file gets
 * one node in the `files` table, written by the full build and by the
 * incremental maintainer from the same extractor output — so a fresh index and
 * a maintained index of the same code hold the same file nodes and the same
 * file-sourced edges.
 *
 * File nodes live in their own table, not in `entities`, on purpose:
 *  - `entities` is the symbol table. Search lanes (FTS, trigram, hybrid entity
 *    lane), structural PageRank, communities, graph expansion, the repo map and
 *    embedding enrichment all read it and must only ever see symbols. A file
 *    row there would be a symbol hit named `client.py`, a PageRank hub, and a
 *    scope (lines 1..N) around every chunk of the file.
 *  - Prior art does the same: SCIP keeps Documents apart from symbols, Kythe
 *    has a distinct `file` node kind, the Joern CPG has a FILE node next to its
 *    METHOD nodes, and graphify keeps file nodes in the graph but filters them
 *    out of its centrality rankings ("they accumulate import/contains edges
 *    mechanically").
 *  - Readers that want top-level code as a caller (ss-trace callers, impact
 *    paths, bare and alias callers, the graph `callers`/`impact` queries) join
 *    `files` explicitly through `fileNodeSourceSql()`.
 *
 * The table carries the same epoch columns as `entities`, so readers pinned to
 * an older manifest epoch see the file set of that epoch.
 */

import { createHash } from 'crypto';
import path from 'path';

/** Display name of a file node when it appears as a caller. */
export const TOP_LEVEL_NAME = '(top-level)';

/**
 * Graph id of a file node: GraphExtractor.makeId(relPath, 'file', basename).
 * The extractor uses this id as `source_id` for every file-level edge.
 */
export function fileNodeId(relPath) {
  const p = String(relPath).replace(/\\/g, '/');
  return createHash('sha256').update(`${p}:file:${path.basename(p)}`).digest('hex').slice(0, 16);
}

/** The node row the extractor emits for one file. */
export function fileNodeRow(relPath) {
  const p = String(relPath).replace(/\\/g, '/');
  return { id: fileNodeId(p), file_path: p, name: path.basename(p) };
}

/** Idempotent; called from createGraphSchema (full build and maintainer). */
export function ensureFilesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      name TEXT NOT NULL,
      epoch_written INTEGER NOT NULL DEFAULT 0,
      epoch_retired INTEGER
    )
  `);
  // One LIVE node per id; retired versions stay for pinned readers until GC.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_files_live_id ON files(id) WHERE epoch_retired IS NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_files_id ON files(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_files_retired ON files(epoch_retired) WHERE epoch_retired IS NOT NULL');
}

/** Full build: insert the batch's file nodes (one live row per id). */
export function insertFileNodes(db, files, { epoch = 0 } = {}) {
  if (!files || files.length === 0) return 0;
  ensureFilesSchema(db);
  const live = db.prepare('SELECT 1 FROM files WHERE id = ? AND epoch_retired IS NULL');
  const stmt = db.prepare('INSERT INTO files (id, file_path, name, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, NULL)');
  let n = 0;
  for (const f of files) {
    if (!f?.id || !f.file_path) continue;
    if (live.get(f.id)) continue;
    stmt.run(f.id, f.file_path, f.name || path.basename(f.file_path), epoch);
    n++;
  }
  return n;
}

/**
 * Maintainer: make the live file-node set for `relPath` match the write.
 * A written file has exactly one live node (inserted at `epoch` if it had
 * none); a deleted file has none (its node is retired at `epoch`). The node
 * never changes on edit — path and name are its whole identity — so an edit
 * writes nothing and pinned readers keep seeing the same row.
 */
export function syncFileNode(db, relPath, { epoch, deleted = false, node: emitted = null } = {}) {
  const node = emitted?.id ? emitted : fileNodeRow(relPath);
  if (deleted) {
    return db.prepare('UPDATE files SET epoch_retired = ? WHERE id = ? AND epoch_retired IS NULL').run(epoch, node.id).changes > 0 ? -1 : 0;
  }
  if (db.prepare('SELECT 1 FROM files WHERE id = ? AND epoch_retired IS NULL').get(node.id)) return 0;
  db.prepare('INSERT INTO files (id, file_path, name, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, NULL)')
    .run(node.id, node.file_path, node.name, epoch);
  return 1;
}

const tableMemo = new WeakMap();

/** True when the graph DB has the `files` table (graphs built before it do not). */
export function hasFilesTable(db) {
  if (!db) return false;
  if (tableMemo.has(db)) return tableMemo.get(db);
  let ok = false;
  try {
    ok = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='files'").get();
  } catch { ok = false; }
  tableMemo.set(db, ok);
  return ok;
}

/**
 * A derived table with the entity columns that caller readers select, so a
 * reader can run its caller query once against `entities` and once against
 * this (`JOIN ${fileNodeSourceSql()} e ON e.id = r.source_id`) with the same
 * WHERE clause and visibility SQL. SQLite flattens it, so `files.id` stays
 * indexed. `stale_since` is NULL: file nodes are never "stale", only retired.
 */
export function fileNodeSourceSql() {
  return `(SELECT f.rowid AS rowid, f.id AS id, '${TOP_LEVEL_NAME}' AS name, 'file' AS type,
      f.file_path AS file_path, NULL AS start_line, NULL AS end_line, NULL AS signature,
      NULL AS summary, NULL AS parent_class, NULL AS package, NULL AS stale_since,
      f.epoch_written AS epoch_written, f.epoch_retired AS epoch_retired
    FROM files f)`;
}

/**
 * A top-level caller row shows the call line as its span, so renderers print
 * `(top-level) [file] src/app.js:12 call@12` and read one line of code, never
 * the whole file.
 */
export function asTopLevelCaller(row, contextLine) {
  const line = contextLine ?? row.context_line ?? row.call_line ?? null;
  return { ...row, name: TOP_LEVEL_NAME, type: 'file', start_line: line, end_line: line };
}
