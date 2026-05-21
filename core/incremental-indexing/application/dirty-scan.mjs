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
 * Admission: it uses the SAME `admission-policy` full indexing uses, so a file a
 * fresh `sweet-search index` would skip (wrong extension, gitignored, excluded,
 * oversized) is never newly enqueued, and a file full indexing would admit is
 * eligible. Gitignore is evaluated in ONE batched `git check-ignore` per tick,
 * never per file.
 *
 * Current-session convergence: a previously-indexed file that is deleted, or
 * that becomes excluded / oversized / gitignored, is enqueued so the consumer
 * retires it — incremental results then match a fresh full rebuild. (The
 * consumer is the authority on admit-vs-retire; this producer only decides what
 * to enqueue.)
 *
 * Design notes:
 *   - Walks the whole tree each tick (pruning denied directories) so the "seen"
 *     set is complete and unchanged-but-now-excluded files are not mistaken for
 *     deletions; only the *enqueue* list is bounded by `maxEnqueue`.
 *   - De-dupes against paths already in the dirty/processing queues so repeated
 *     ticks before a slow reconcile don't pile up duplicates.
 *   - Opt-out: `SWEET_SEARCH_RECONCILE_SCAN=0|false|off` disables just the
 *     producer (the maintainer keeps consuming externally-enqueued hints).
 */

import fs from 'node:fs';
import path from 'node:path';

import { createAdmissionPolicy } from '../../indexing/admission-policy.js';

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
 * @param {object} [opts.admissionPolicy]   Shared admission policy (created from projectRoot if omitted).
 * @param {(rel:string)=>boolean} [opts.isExcluded]   Extra deny predicate layered on the policy.
 * @param {number} [opts.maxEnqueue]
 * @returns {Promise<{enqueued:number, added:number, modified:number, deleted:number, retired:number, files:string[]}>}
 */
export async function scanDirtyAndEnqueue({ projectRoot, stateDir, admissionPolicy, isExcluded, maxEnqueue = DEFAULT_MAX_ENQUEUE }) {
  const policy = admissionPolicy || createAdmissionPolicy({ projectRoot });
  const extraDeny = typeof isExcluded === 'function' ? isExcluded : null;
  const merkle = readMerkleFiles(stateDir);
  const queued = alreadyQueued(stateDir);
  const maxFileSize = BigInt(policy.maxFileSize);

  // Never enqueue the maintainer's own state dir — its queues/manifests/db are
  // not source files and must be skipped regardless of the policy.
  const stateDirResolved = path.resolve(stateDir);
  const isStateDir = (abs) => {
    const r = path.resolve(abs);
    return r === stateDirResolved || r.startsWith(stateDirResolved + path.sep);
  };

  // 1. Full walk: classify every present file; prune denied directories so we
  //    never descend node_modules/.git/etc. `present` keeps shape-rejected
  //    merkle files too (they must be retired).
  const present = new Map(); // rel -> { isNew, changed, shapeOk, sizeOk }
  const stack = [projectRoot];
  while (stack.length) {
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
      if (!rel) continue;
      if (ent.isDirectory()) {
        if (policy.isExcluded(rel) || (extraDeny && extraDeny(rel))) continue; // prune subtree
        stack.push(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const prev = merkle[rel];
      const shapeOk = policy.admitsShape(rel) && !(extraDeny && extraDeny(rel));
      if (!shapeOk) {
        // New rejected files are dropped; previously-indexed ones are retired.
        if (prev) present.set(rel, { isNew: false, changed: false, shapeOk: false, sizeOk: false });
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(abs, { bigint: true });
      } catch {
        if (prev) present.set(rel, { isNew: false, changed: false, shapeOk: false, sizeOk: false });
        continue;
      }
      const sizeOk = stat.size <= maxFileSize;
      const isNew = !prev;
      const changed = isNew
        ? true
        : (stat.size.toString() !== String(prev.size) || stat.mtimeNs.toString() !== String(prev.mtime_ns));
      present.set(rel, { isNew, changed, shapeOk: true, sizeOk });
    }
  }

  // 2. Gitignore: ONE batched check over admissible (shape+size OK) files. This
  //    catches both new files dropped into a gitignored path and previously
  //    indexed files whose `.gitignore` status changed.
  const gitCandidates = [];
  for (const [rel, v] of present) {
    if (v.shapeOk && v.sizeOk) gitCandidates.push(rel);
  }
  const gitignored = await policy.gitignoredSet(gitCandidates);

  // 3. Decide enqueues. Admitted+changed → reindex; previously-indexed but no
  //    longer admitted → retire.
  const toEnqueue = [];
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let retired = 0;
  const enqueue = (rel) => {
    toEnqueue.push(rel);
    queued.add(rel);
  };

  for (const [rel, v] of present) {
    if (toEnqueue.length >= maxEnqueue) break;
    const admitted = v.shapeOk && v.sizeOk && !gitignored.has(rel);
    if (admitted) {
      if (v.changed && !queued.has(rel)) {
        enqueue(rel);
        v.isNew ? (added += 1) : (modified += 1);
      }
    } else if (merkle[rel] && !queued.has(rel)) {
      enqueue(rel);
      retired += 1;
    }
  }

  // 4. Merkle-known files not seen in the walk: deleted (gone) or living under a
  //    directory that just became denied. Either way, retire.
  for (const rel of Object.keys(merkle)) {
    if (toEnqueue.length >= maxEnqueue) break;
    if (present.has(rel) || queued.has(rel)) continue;
    if (!fs.existsSync(path.join(projectRoot, rel))) {
      enqueue(rel);
      deleted += 1;
    } else {
      enqueue(rel);
      retired += 1;
    }
  }

  if (toEnqueue.length === 0) {
    return { enqueued: 0, added: 0, modified: 0, deleted: 0, retired: 0, files: [] };
  }

  fs.mkdirSync(stateDir, { recursive: true });
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const lines = toEnqueue
    .map((rel) => `${JSON.stringify({ file_path: rel, timestamp: now, queued_at: iso, source: 'scan' })}\n`)
    .join('');
  fs.appendFileSync(path.join(stateDir, DIRTY_QUEUE), lines);

  return { enqueued: toEnqueue.length, added, modified, deleted, retired, files: toEnqueue };
}
