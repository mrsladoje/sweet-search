/**
 * Establish a valid *empty* index baseline.
 *
 * A full or incremental index run over a repository with no indexable files
 * used to early-exit without creating anything, leaving search to throw
 * "No search indexes found" and giving the default-on reconcile maintainer no
 * baseline to grow from. This helper instead writes a coherent zero-row
 * baseline:
 *
 *   - codebase.db            vector schema, 0 rows
 *   - code-graph.db          graph schema, 0 rows
 *   - merkle-state.json      0 files  — so the maintainer's dirty-scan treats
 *                                       the first created file as new
 *   - reconcile-manifest.json         — so readers pin a real epoch
 *
 * With the baseline in place, search returns empty results cleanly (the
 * graph+codebase existence check in SweetSearch.init passes; the tables are
 * simply empty) and the reconcile maintainer can transition the repo from zero
 * files to one file without a prior full index.
 *
 * The schema builders are the same ones the production reconciler uses when it
 * lazily creates these DBs (createVectorSchema / createGraphSchema), so a
 * baseline written here is byte-for-byte compatible with later incremental
 * deltas (epoch columns, FTS5, indexes).
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { DB_PATHS } from '../infrastructure/config/index.js';
import { createVectorSchema } from './indexer-build.js';
import { createGraphSchema } from '../graph/graph-extractor.js';
import { publishIndexerManifest } from './indexer-manifest.js';
import { updateState } from './incremental-tracker.js';
import { log } from './indexer-utils.js';

/**
 * Create `dbPath` with `createSchema` only when it does not already exist.
 * Returns true when a fresh DB was created, false when one was already present.
 */
function ensureSchema(dbPath, createSchema) {
  if (existsSync(dbPath)) return false;
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    createSchema(db);
  } finally {
    db.close();
  }
  return true;
}

/**
 * Write the empty baseline for a genuinely un-indexed empty repo.
 *
 * No-op when `merkle-state.json` already exists: a prior index ran, so an empty
 * working tree means the repo BECAME empty (every tracked file deleted). In that
 * case the existing merkle must be preserved so the maintainer's deletion
 * detection (dirty-scan: merkle-known vs on-disk) retires the now-stale rows —
 * overwriting it with an empty file set here would erase that knowledge and
 * strand the stale rows in codebase.db / code-graph.db forever.
 *
 * @returns {Promise<{createdCodebase:boolean, createdGraph:boolean, skipped?:boolean}>}
 */
export async function establishEmptyBaseline() {
  if (existsSync(DB_PATHS.merkle)) {
    return { createdCodebase: false, createdGraph: false, skipped: true };
  }
  const createdCodebase = ensureSchema(DB_PATHS.codebase, createVectorSchema);
  const createdGraph = ensureSchema(DB_PATHS.codeGraph, createGraphSchema);
  await updateState({}, { totalChunks: 0, entities: 0, relationships: 0 });
  publishIndexerManifest({});
  log(
    `Established empty index baseline (0 files; codebase.db ${createdCodebase ? 'created' : 'present'}, `
    + `code-graph.db ${createdGraph ? 'created' : 'present'})`,
    'green',
  );
  return { createdCodebase, createdGraph };
}
