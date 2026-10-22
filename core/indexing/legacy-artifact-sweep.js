/**
 * Dead legacy artifacts in the state dir.
 *
 * Earlier index formats wrote these files; nothing reads them now (the float
 * USearch HNSW, the JSON binary-HNSW sidecars, the dynamic vocabulary, the
 * reconcile cutoff cache). A full index deletes them so an old state dir does
 * not keep them on disk forever.
 */

import { rmSync } from 'node:fs';
import path from 'node:path';

export const DEAD_LEGACY_ARTIFACTS = Object.freeze([
  'codebase-hnsw.usearch',
  'codebase-hnsw.meta.json',
  'codebase-hnsw.idx.stale.bin',
  'codebase-binary-hnsw.graph.json',
  'codebase-binary-hnsw.int8.json',
  'codebase-binary-hnsw.vectors.json',
  'codebase-binary-hnsw.meta.json',
  'vocab-dynamic.json',
  'reconcile-cutoff-cache.json',
]);

/**
 * Delete the dead legacy artifacts in `stateDir`. Best-effort per file.
 * @param {string} stateDir
 * @returns {string[]} the names it deleted
 */
export function removeDeadLegacyArtifacts(stateDir) {
  const removed = [];
  for (const name of DEAD_LEGACY_ARTIFACTS) {
    const file = path.join(stateDir, name);
    try {
      rmSync(file);
      removed.push(name);
    } catch {
      // absent or not removable — nothing to do
    }
  }
  return removed;
}
