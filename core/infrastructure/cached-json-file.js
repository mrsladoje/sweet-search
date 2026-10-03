/**
 * `JSON.parse(readFileSync(path, 'utf8'))` for a small file that is read on every search:
 * reconcile-manifest.json was read again by every code-graph query, ~40 reads per ss-grep call.
 *
 * The parsed value is kept while the file's inode, size and timestamps stay the same (its
 * writer replaces it by rename), so callers share one object and must not modify it. Throws
 * exactly when readFileSync or JSON.parse would.
 */

import { readFileSync, statSync } from 'node:fs';

const MAX_FILES = 64;
const cache = new Map();

export function readJsonFileCached(filePath) {
  const st = statSync(filePath, { bigint: true });
  const signature = `${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  const hit = cache.get(filePath);
  if (hit && hit.signature === signature) return hit.value;
  const value = JSON.parse(readFileSync(filePath, 'utf8'));
  cache.delete(filePath);
  while (cache.size >= MAX_FILES) cache.delete(cache.keys().next().value);
  cache.set(filePath, { signature, value });
  return value;
}
