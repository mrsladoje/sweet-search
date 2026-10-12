/**
 * `JSON.parse(readFileSync(path, 'utf8'))` for a small file that is read on every search:
 * reconcile-manifest.json was read again by every code-graph query, ~40 reads per ss-grep call.
 *
 * The parsed value is kept while the file's inode, size and timestamps stay the same (its
 * writer replaces it by rename), so callers share one object and must not modify it. Throws
 * exactly when readFileSync or JSON.parse would.
 */

import { readFileSync, statSync } from 'node:fs';
import { currentCall } from '../agent-tools/virtual-process.js';

const MAX_FILES = 64;
const cache = new Map();
const RECHECK_MS = 5;
const lastChecked = new Map(); // path -> { at: performance.now(), missing }

export function readJsonFileCached(filePath) {
  const value = readJsonFileCachedIfExists(filePath);
  // No file: the read that throws what readFileSync throws.
  return value !== undefined ? value : parseCached(filePath, statSync(filePath, { bigint: true }));
}

/**
 * readJsonFileCached, but undefined (no exception) when the file does not
 * exist. Hot callers that treat a missing file as "none" use this: a thrown
 * ENOENT costs several microseconds (the error and its stack) per call.
 */
export function readJsonFileCachedIfExists(filePath) {
  // During an ss-* call, a file checked in the last RECHECK_MS is not stat'ed again: one call
  // read reconcile-manifest.json ~21 times. The answer is the newest version this process has
  // read (never an older one), at most RECHECK_MS late. Outside a call every read checks.
  const now = currentCall() ? performance.now() : null;
  if (now !== null) {
    const seen = lastChecked.get(filePath);
    if (seen && now - seen.at < RECHECK_MS) {
      if (seen.missing) return undefined;
      const hit = cache.get(filePath);
      if (hit) return hit.value;
    }
  }
  const st = statSync(filePath, { bigint: true, throwIfNoEntry: false });
  const value = st === undefined ? undefined : parseCached(filePath, st);
  if (now !== null) {
    lastChecked.delete(filePath);
    while (lastChecked.size >= MAX_FILES) lastChecked.delete(lastChecked.keys().next().value);
    lastChecked.set(filePath, { at: now, missing: st === undefined });
  }
  return value;
}

function parseCached(filePath, st) {
  const signature = `${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  const hit = cache.get(filePath);
  if (hit && hit.signature === signature) return hit.value;
  const value = JSON.parse(readFileSync(filePath, 'utf8'));
  cache.delete(filePath);
  while (cache.size >= MAX_FILES) cache.delete(cache.keys().next().value);
  cache.set(filePath, { signature, value });
  return value;
}
