/**
 * Is a source file newer than the published index? The rule ss-semantic warns on and
 * ss-grep's line classes gate on: a file modified after the reconcile manifest's
 * `publishedAt` is stale.
 */

import fs from 'node:fs';

/**
 * @param {string} absPath
 * @param {{publishedAt?: string}|null} manifest - reconcile-manifest.json contents
 * @returns {{known: boolean, stale: boolean, mtime: Date|null}} known = false when the
 *   manifest has no publish time or the file cannot be stat'ed
 */
export function indexFreshness(absPath, manifest) {
  const publishedMs = Date.parse(manifest?.publishedAt || '');
  if (!Number.isFinite(publishedMs)) return { known: false, stale: false, mtime: null };
  try {
    const stat = fs.statSync(absPath);
    return { known: true, stale: stat.mtimeMs > publishedMs, mtime: stat.mtime };
  } catch {
    return { known: false, stale: false, mtime: null };
  }
}
