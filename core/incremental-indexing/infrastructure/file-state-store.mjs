/**
 * Per-file index state (`file-state.db`).
 *
 * The full build and the maintainer record, for every indexed file, the content hash and
 * the stat tuple it was indexed at (plus the maintainer's epoch, chunk ids and LI verdict),
 * and for every grep-only file (core/indexing/grep-corpus.js) its stat and hash. These maps
 * lived in merkle-state.json and grep-corpus-state.json, which every working tick parsed
 * and rewrote whole: 58 ms + 52 ms and 55 MB at 100k files. Here a tick reads the rows it
 * needs by key and writes only the rows it changed, in one transaction.
 *
 * merkle-state.json keeps the small header (version, config_fingerprint, epoch, lastIndex,
 * stats) that the baseline gate and search's format check read.
 *
 * Tables (WITHOUT ROWID, keyed by project-relative path):
 *   files       path, hash, size, mtime_ns, inode, epoch, chunk_ids (JSON), li_skip
 *   grep_files  path, size, mtime_ns, hash
 * Stat fields are text: 64-bit inodes and nanosecond mtimes exceed Number's safe range.
 *
 * Entries come back in the shape the merkle map had:
 *   files:      { hash, size, mtime_ns, inode?, epoch?, chunkIds?, liSkip? }
 *   grep_files: { size, mtime_ns, hash? }
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const FILE_STATE_DB = 'file-state.db';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  hash TEXT,
  size TEXT,
  mtime_ns TEXT,
  inode TEXT,
  epoch INTEGER,
  chunk_ids TEXT,
  li_skip INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS grep_files (
  path TEXT PRIMARY KEY,
  size TEXT,
  mtime_ns TEXT,
  hash TEXT
) WITHOUT ROWID;
`;

const text = (v) => (v === null || v === undefined ? null : String(v));

function fileEntry(row) {
  const entry = { hash: row.hash, size: row.size, mtime_ns: row.mtime_ns };
  if (row.inode !== null) entry.inode = row.inode;
  if (row.epoch !== null) entry.epoch = row.epoch;
  if (row.chunk_ids !== null) entry.chunkIds = JSON.parse(row.chunk_ids);
  if (row.li_skip) entry.liSkip = true;
  return entry;
}

function grepEntry(row) {
  const entry = { size: row.size, mtime_ns: row.mtime_ns };
  if (row.hash !== null) entry.hash = row.hash;
  return entry;
}

export function fileStatePath(stateDir) {
  return path.join(stateDir, FILE_STATE_DB);
}

export function fileStateExists(stateDir) {
  return fs.existsSync(fileStatePath(stateDir));
}

/**
 * Open the store. `readonly` opens an existing store only (null when there is none).
 *
 * @param {string} stateDir
 * @param {{readonly?: boolean}} [opts]
 */
export function openFileState(stateDir, { readonly = false } = {}) {
  const file = fileStatePath(stateDir);
  if (readonly && !fs.existsSync(file)) return null;
  if (!readonly) fs.mkdirSync(stateDir, { recursive: true });
  const db = new Database(file, readonly ? { readonly: true, fileMustExist: true } : {});
  db.pragma('busy_timeout = 5000');
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(SCHEMA);
  }
  const stmts = new Map();
  const st = (sql) => {
    let s = stmts.get(sql);
    if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
    return s;
  };
  const putFile = (rel, e) => st(`INSERT OR REPLACE INTO files (path, hash, size, mtime_ns, inode, epoch, chunk_ids, li_skip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(rel, text(e.hash), text(e.size), text(e.mtime_ns), text(e.inode),
    Number.isInteger(e.epoch) ? e.epoch : null, Array.isArray(e.chunkIds) ? JSON.stringify(e.chunkIds) : null, e.liSkip ? 1 : 0);
  const putGrep = (rel, e) => st('INSERT OR REPLACE INTO grep_files (path, size, mtime_ns, hash) VALUES (?, ?, ?, ?)')
    .run(rel, text(e.size), text(e.mtime_ns), text(e.hash));
  return {
    db,
    getFile(rel) {
      const row = st('SELECT * FROM files WHERE path = ?').get(rel);
      return row ? fileEntry(row) : null;
    },
    hasFile(rel) { return !!st('SELECT 1 FROM files WHERE path = ?').get(rel); },
    fileCount() { return st('SELECT COUNT(*) AS n FROM files').get().n; },
    /** Every indexed file as [rel, entry]: the full walk and the full build need them all. */
    *iterateFiles() { for (const row of st('SELECT * FROM files').iterate()) yield [row.path, fileEntry(row)]; },
    filePaths() { return st('SELECT path FROM files').pluck().all(); },
    /** Indexed files under a directory (`prefix` ends with '/'). */
    filePathsUnder(prefix) {
      return st("SELECT path FROM files WHERE path >= ? AND path < ? || char(1114111)").pluck().all(prefix, prefix);
    },
    putFile,
    deleteFile(rel) { st('DELETE FROM files WHERE path = ?').run(rel); },
    getGrep(rel) {
      const row = st('SELECT * FROM grep_files WHERE path = ?').get(rel);
      return row ? grepEntry(row) : null;
    },
    *iterateGrep() { for (const row of st('SELECT * FROM grep_files').iterate()) yield [row.path, grepEntry(row)]; },
    putGrep,
    deleteGrep(rel) { st('DELETE FROM grep_files WHERE path = ?').run(rel); },
    transaction(fn) { return db.transaction(fn)(); },
    close() { try { db.close(); } catch { /* closed */ } },
  };
}

/** All indexed files as an object (the full build loads and diffs them all). */
export function readFileStateObject(stateDir) {
  const store = openFileState(stateDir, { readonly: true });
  if (!store) return {};
  try {
    const out = {};
    for (const [rel, entry] of store.iterateFiles()) out[rel] = entry;
    return out;
  } finally {
    store.close();
  }
}

/** Replace every indexed file's entry (the full build's save). */
export function writeFileStateObject(stateDir, files) {
  const store = openFileState(stateDir);
  try {
    store.transaction(() => {
      store.db.exec('DELETE FROM files');
      for (const [rel, entry] of Object.entries(files || {})) store.putFile(rel, entry);
    });
  } finally {
    store.close();
  }
}

/** All grep-only files as an object. */
export function readGrepStateObject(stateDir) {
  const store = openFileState(stateDir, { readonly: true });
  if (!store) return {};
  try {
    const out = {};
    for (const [rel, entry] of store.iterateGrep()) out[rel] = entry;
    return out;
  } finally {
    store.close();
  }
}

/** Replace every grep-only file's entry (the full build's sparse-gram phase). */
export function writeGrepStateObject(stateDir, files) {
  const store = openFileState(stateDir);
  try {
    store.transaction(() => {
      store.db.exec('DELETE FROM grep_files');
      for (const [rel, entry] of Object.entries(files || {})) store.putGrep(rel, entry);
    });
  } finally {
    store.close();
  }
}
