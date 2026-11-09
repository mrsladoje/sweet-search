/**
 * Checks whether a result file changed on disk after it was indexed.
 */

import { pendingReindexFiles } from '../index-freshness.js';
import path from 'path';
import { statSync } from 'fs';

/**
 * Check whether a file has been modified since it was last indexed.
 *
 * Caches the db mtime per search (same for all results) to avoid repeated syscalls.
 *
 * @param {string} filePath - Relative file path
 * @param {{ dbMtime: Date|null|undefined }} cache - Shared cache for db mtime across results
 * @returns {{ stale: boolean, indexedAt: string|null }}
 */
export function checkStaleness(filePath, projectRoot, codeGraphRepo, cache = {}) {
  try {
    const indexInfo = codeGraphRepo?.getFileIndexInfo(filePath);

    if (indexInfo?.staleSince) {
      return { stale: true, indexedAt: null };
    }

    // A file still in the maintainer's queue is stale whatever its mtime says (a publish
    // of an earlier part of the queue dates the index after it).
    if (cache.pending === undefined) {
      try {
        cache.pending = projectRoot ? pendingReindexFiles(path.join(projectRoot, '.sweet-search')) : null;
      } catch { cache.pending = null; }
    }
    const rel = path.isAbsolute(filePath) ? path.relative(projectRoot, filePath).split(path.sep).join('/') : filePath;
    if (cache.pending?.has(rel)) {
      return { stale: true, indexedAt: null };
    }

    if (cache.dbMtime === undefined) {
      cache.dbMtime = codeGraphRepo?.getDbMtime?.() ?? null;
    }

    if (!cache.dbMtime) {
      return { stale: false, indexedAt: null };
    }

    const indexedAt = cache.dbMtime.toISOString();
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
    const fileStat = statSync(absPath, { throwIfNoEntry: false });
    if (!fileStat) {
      return { stale: false, indexedAt };
    }

    const stale = fileStat.mtimeMs > cache.dbMtime.getTime();
    return { stale, indexedAt };
  } catch {
    return { stale: false, indexedAt: null };
  }
}
