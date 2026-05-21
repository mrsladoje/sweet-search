/**
 * Tick-driven dirty-file producer for the default-on incremental maintainer.
 *
 * The reconcile tick is a *consumer*: it drains `index-maintainer-queue.jsonl`
 * and reindexes whatever paths were enqueued. Something has to PRODUCE those
 * entries. `sweet-search index --add <path>` does it manually, and an editor
 * hook can do it per-edit — but with neither, an ordinary file save is never
 * observed and the index silently goes stale (release-gate finding C1).
 *
 * This module is the missing autonomous producer. Once per tick (before the
 * consume step) it diffs the working tree against the reconciler's own
 * `merkle-state.json` baseline using a cheap stat comparison (size + mtime_ns,
 * no hashing) and appends add / modify / delete hints to the same JSONL queue
 * the reconciler already drains. The reconciler then updates `merkle-state.json`
 * for the files it processes, so the next scan sees them as unchanged — the
 * queue does not grow without bound.
 *
 * Design notes:
 *   - Uses the same path-filter the reconciler uses (deny-dirs/exts + project
 *     ignore rules), matching the polling-backstop semantics in
 *     `file-watcher.mjs`. Non-code files that slip through reconcile to a no-op.
 *   - Stat-only diff keeps it O(files) with no file reads; large trees are
 *     bounded by `maxEnqueue`.
 *   - De-dupes against paths already in the dirty/processing queues so repeated
 *     ticks before a slow reconcile don't pile up duplicates.
 *   - Opt-out: `SWEET_SEARCH_RECONCILE_SCAN=0|false|off` disables just the
 *     producer (the maintainer keeps consuming externally-enqueued hints).
 */

import fs from 'node:fs';
import path from 'node:path';

const DIRTY_QUEUE = 'index-maintainer-queue.jsonl';
const PROCESSING_QUEUE = 'index-maintainer-queue.processing.jsonl';
const MERKLE_STATE = 'merkle-state.json';
const DEFAULT_MAX_ENQUEUE = 5000;

/** Is the autonomous scan producer enabled? Default-on; off-tokens disable it. */
export function dirtyScanEnabled(env = process.env) {
  const raw = env.SWEET_SEARCH_RECONCILE_SCAN;
  if (raw == null || raw === '') return true;
  const n = String(raw).trim().toLowerCase();
  return !(n === '0' || n === 'false' || n === 'off');
}

function readMerkleFiles(stateDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(stateDir, MERKLE_STATE), 'utf8'));
    return parsed && parsed.files && typeof parsed.files === 'object' ? parsed.files : {};
  } catch {
    return {};
  }
}

/** Same shape merkle-state.json stores, so comparisons are apples-to-apples. */
function statTuple(absPath) {
  const stat = fs.statSync(absPath, { bigint: true });
  return { size: stat.size.toString(), mtime_ns: stat.mtimeNs.toString() };
}

/** Project-relative paths already queued (dirty + in-flight), forward-slashed. */
function alreadyQueued(stateDir) {
  const set = new Set();
  for (const name of [DIRTY_QUEUE, PROCESSING_QUEUE]) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(stateDir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const fp = JSON.parse(t).file_path;
        if (fp) set.add(String(fp).replace(/\\/g, '/'));
      } catch {
        /* tolerate a malformed line */
      }
    }
  }
  return set;
}

/**
 * Diff the working tree against merkle-state.json and append dirty hints.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.stateDir
 * @param {(rel:string)=>boolean} [opts.isExcluded]   true ⇒ skip this path
 * @param {number} [opts.maxEnqueue]
 * @returns {{enqueued:number, added:number, modified:number, deleted:number, files:string[]}}
 */
export function scanDirtyAndEnqueue({ projectRoot, stateDir, isExcluded, maxEnqueue = DEFAULT_MAX_ENQUEUE }) {
  const exclude = typeof isExcluded === 'function' ? isExcluded : () => false;
  const merkle = readMerkleFiles(stateDir);
  const queued = alreadyQueued(stateDir);
  const seen = new Set();
  const toEnqueue = [];
  let added = 0;
  let modified = 0;
  let deleted = 0;

  // Never enqueue the maintainer's own state dir — its queues/manifests/db are
  // not source files and must be skipped regardless of the caller's filter.
  const stateDirResolved = path.resolve(stateDir);
  const isStateDir = (abs) => {
    const r = path.resolve(abs);
    return r === stateDirResolved || r.startsWith(stateDirResolved + path.sep);
  };

  // 1. Walk the current tree for new + modified files.
  const stack = [projectRoot];
  while (stack.length && toEnqueue.length < maxEnqueue) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (isStateDir(abs)) continue;
      const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
      if (!rel || exclude(rel)) continue;
      if (ent.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      seen.add(rel);
      const prev = merkle[rel];
      let isNew = false;
      let changed = false;
      if (!prev) {
        isNew = true;
        changed = true;
      } else {
        try {
          const cur = statTuple(abs);
          changed = cur.size !== String(prev.size) || cur.mtime_ns !== String(prev.mtime_ns);
        } catch {
          continue;
        }
      }
      if (changed && !queued.has(rel)) {
        toEnqueue.push(rel);
        queued.add(rel);
        if (isNew) added += 1;
        else modified += 1;
      }
      if (toEnqueue.length >= maxEnqueue) break;
    }
  }

  // 2. Deletions: merkle-known files that no longer exist on disk.
  for (const rel of Object.keys(merkle)) {
    if (toEnqueue.length >= maxEnqueue) break;
    if (seen.has(rel) || queued.has(rel) || exclude(rel)) continue;
    if (!fs.existsSync(path.join(projectRoot, rel))) {
      toEnqueue.push(rel);
      queued.add(rel);
      deleted += 1;
    }
  }

  if (toEnqueue.length === 0) {
    return { enqueued: 0, added: 0, modified: 0, deleted: 0, files: [] };
  }

  fs.mkdirSync(stateDir, { recursive: true });
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const lines = toEnqueue
    .map((rel) => `${JSON.stringify({ file_path: rel, timestamp: now, queued_at: iso, source: 'scan' })}\n`)
    .join('');
  fs.appendFileSync(path.join(stateDir, DIRTY_QUEUE), lines);

  return { enqueued: toEnqueue.length, added, modified, deleted, files: toEnqueue };
}
