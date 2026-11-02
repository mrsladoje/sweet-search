/**
 * Is a source file newer than the published index? The rule ss-semantic warns on and
 * ss-grep's line classes gate on: a file modified after the reconcile manifest's
 * `publishedAt` is stale.
 */

import fs from 'node:fs';
import path from 'node:path';
import { callStatSync } from '../infrastructure/call-fs.js';

/**
 * @param {string} absPath
 * @param {{publishedAt?: string}|null} manifest - reconcile-manifest.json contents
 * @returns {{known: boolean, stale: boolean, mtime: Date|null}} known = false when the
 *   manifest has no publish time or the file cannot be stat'ed
 */
export function indexFreshness(absPath, manifest) {
  const publishedMs = Date.parse(manifest?.publishedAt || '');
  if (!Number.isFinite(publishedMs)) return { known: false, stale: false, mtime: null };
  const stat = callStatSync(absPath);
  if (!stat) return { known: false, stale: false, mtime: null };
  return { known: true, stale: stat.mtimeMs > publishedMs, mtime: stat.mtime };
}

const QUEUE_FILES = ['index-maintainer-queue.jsonl', 'index-maintainer-queue.processing.jsonl'];
const pendingMemo = new Map(); // stateDir -> { stamp, files }

function queueStamp(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return '-';
  }
}

/**
 * The files the maintainer still has to (re)index: the paths in its queue and in the
 * batch it is working on, project-relative. A queued file is stale whatever its mtime:
 * a publish of an earlier part of the queue dates the index after it (a worktree clone
 * queues every file its branch changed, all with the checkout's mtime). Cached by the
 * two files' stat, so a call costs two stats while the queue does not change.
 *
 * @param {string} stateDir
 * @returns {Set<string>}
 */
export function pendingReindexFiles(stateDir) {
  const files = QUEUE_FILES.map((name) => path.join(stateDir, name));
  const stamp = files.map(queueStamp).join('|');
  const hit = pendingMemo.get(stateDir);
  if (hit && hit.stamp === stamp) return hit.files;
  const set = new Set();
  for (const file of files) {
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const fp = JSON.parse(line).file_path;
        if (typeof fp === 'string' && fp) set.add(fp.replace(/\\/g, '/').replace(/^\.\//, ''));
      } catch { /* a partial last line */ }
    }
  }
  pendingMemo.set(stateDir, { stamp, files: set });
  return set;
}

