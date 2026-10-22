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
 * indexed-file state (file-state.db) using a cheap stat comparison (size + mtime_ns,
 * no hashing) and appends add / modify / delete hints to the same JSONL queue
 * the reconciler already drains. The reconciler then updates the file state
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
 */

import fs from 'node:fs';
import path from 'node:path';

import { createAdmissionPolicy } from '../../indexing/admission-policy.js';
import { filterGrepCorpusFiles, listGitVisibleFiles } from '../../indexing/grep-corpus.js';
import { grepStatEntry, readGrepCorpusState } from '../infrastructure/grep-corpus-state.mjs';
import { readFileStateObject } from '../infrastructure/file-state-store.mjs';

const DIRTY_QUEUE = 'index-maintainer-queue.jsonl';
const PROCESSING_QUEUE = 'index-maintainer-queue.processing.jsonl';
const DEFAULT_MAX_ENQUEUE = 5000;
// New grep-only files are found through the VCS file list: on an index change (add,
// commit, checkout) or, for new untracked files, at least this often.
const GREP_DISCOVERY_MAX_AGE_MS = 60_000;
const grepDiscoveryMemo = new Map(); // stateDir -> { at, vcsIndex }
const grepRejectedMemo = new Map(); // stateDir -> Map(rel -> "size:mtime_ns")
const minifiedMemoByState = new Map(); // stateDir -> Map(rel -> "size:mtime_ns")

// The VCS index file's stat, or null (not a plain checkout: discovery then runs on age only).
function vcsIndexStamp(projectRoot) {
  try {
    const st = fs.statSync(path.join(projectRoot, '.git', 'index'), { bigint: true });
    return `${st.size}:${st.mtimeNs}`;
  } catch {
    return null;
  }
}

function grepDiscoveryDue(projectRoot, stateDir, now) {
  const stamp = vcsIndexStamp(projectRoot);
  const prev = grepDiscoveryMemo.get(stateDir);
  const due = !prev || now - prev.at >= GREP_DISCOVERY_MAX_AGE_MS || (stamp !== null && stamp !== prev.vcsIndex);
  if (due) grepDiscoveryMemo.set(stateDir, { at: now, vcsIndex: stamp });
  return due;
}

export function _resetGrepDiscoveryMemo() {
  grepDiscoveryMemo.clear();
  grepRejectedMemo.clear();
  minifiedMemoByState.clear();
}

// The full walk compares every indexed file, so it reads every row of file-state.db.
function readMerkleFiles(stateDir) {
  try {
    return readFileStateObject(stateDir);
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
 * @param {(phase:string)=>void} [opts.onProgress]
 * @returns {Promise<{enqueued:number, added:number, modified:number, deleted:number, retired:number, files:string[]}>}
 */
export async function scanDirtyAndEnqueue({ projectRoot, stateDir, admissionPolicy, isExcluded, maxEnqueue = DEFAULT_MAX_ENQUEUE, onProgress = null }) {
  const policy = admissionPolicy || createAdmissionPolicy({ projectRoot });
  const extraDeny = typeof isExcluded === 'function' ? isExcluded : null;
  const merkle = readMerkleFiles(stateDir);
  const queued = alreadyQueued(stateDir);
  const maxFileSize = BigInt(policy.maxFileSize);
  const progress = typeof onProgress === 'function'
    ? (phase) => { onProgress(phase); }
    : () => {};
  let walked = 0;

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
        // A directory git ignores as a whole holds no admissible file; never
        // stat its contents (see admission-policy `ignoredDirectories`).
        if (typeof policy.isIgnoredDirectory === 'function' && policy.isIgnoredDirectory(rel)) continue;
        stack.push(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      walked += 1;
      if (walked % 1000 === 0) {
        // Let the event loop turn. The walk is synchronous file system work;
        // without a yield a large tree blocks the process for minutes, and a
        // SIGTERM is not even delivered to its handler until the walk ends.
        // The progress callback then sees the shutdown request and aborts.
        await new Promise((resolve) => setImmediate(resolve));
        progress('dirty-scan:walk');
      }
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
      present.set(rel, { isNew, changed, shapeOk: true, sizeOk, statKey: `${stat.size}:${stat.mtimeNs}` });
    }
  }

  // 2. Gitignore: ONE batched check over admissible (shape+size OK) files. This
  //    catches both new files dropped into a gitignored path and previously
  //    indexed files whose `.gitignore` status changed.
  const gitCandidates = [];
  for (const [rel, v] of present) {
    if (v.shapeOk && v.sizeOk) gitCandidates.push(rel);
  }
  progress('dirty-scan:gitignore');
  const gitignored = await policy.gitignoredSet(gitCandidates);
  progress('dirty-scan:decide');

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

  // A new file full discovery would skip as minified or bundled is not queued: the consumer
  // would drop it on every tick. Changed indexed files are queued (the consumer retires one
  // that became minified). A rejected file is read again only when its stat changes.
  const minifiedMemo = minifiedMemoByState.get(stateDir) || new Map();
  const newFiles = [];
  for (const [rel, v] of present) {
    if (!v.isNew || !v.shapeOk || !v.sizeOk || gitignored.has(rel) || queued.has(rel)) continue;
    if (minifiedMemo.get(rel) === v.statKey) { v.minified = true; continue; }
    newFiles.push(rel);
  }
  const minified = typeof policy.minifiedSet === 'function' ? await policy.minifiedSet(newFiles) : new Set();
  for (const rel of minified) {
    present.get(rel).minified = true;
    minifiedMemo.set(rel, present.get(rel).statKey);
  }
  minifiedMemoByState.set(stateDir, minifiedMemo);

  for (const [rel, v] of present) {
    if (toEnqueue.length >= maxEnqueue) break;
    const admitted = v.shapeOk && v.sizeOk && !gitignored.has(rel) && !v.minified;
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

  // 5. Grep-only files: in the sparse-gram corpus, outside embedding admission (vendor/,
  //    LICENSE, *.csv ...), so the walk above never admits them. Known ones are stat'ed;
  //    new ones come from the VCS file list (the walk does not descend denied directories).
  //    The consumer decides grep-only versus embedding (readDirtySet).
  const grepKnown = readGrepCorpusState(stateDir).files;
  for (const [rel, prev] of Object.entries(grepKnown)) {
    if (toEnqueue.length >= maxEnqueue) break;
    if (queued.has(rel)) continue;
    const now = grepStatEntry(path.join(projectRoot, rel));
    if (!now) {
      enqueue(rel);
      deleted += 1;
    } else if (now.size !== String(prev.size) || now.mtime_ns !== String(prev.mtime_ns)) {
      enqueue(rel);
      modified += 1;
    }
  }
  if (toEnqueue.length < maxEnqueue && grepDiscoveryDue(projectRoot, stateDir, Date.now())) {
    progress('dirty-scan:grep-discovery');
    const embeddingAdmitted = (rel) => {
      const v = present.get(rel);
      return !!v && v.shapeOk && v.sizeOk && !gitignored.has(rel);
    };
    // Files the corpus gates rejected (empty, minified, too large, secret) stay rejected
    // until their stat changes: the minified check reads the file.
    const rejected = grepRejectedMemo.get(stateDir) || new Map();
    const candidates = [];
    for (const rel of listGitVisibleFiles(projectRoot) || []) {
      if (grepKnown[rel] || merkle[rel] || queued.has(rel) || embeddingAdmitted(rel)) continue;
      const stat = grepStatEntry(path.join(projectRoot, rel));
      if (!stat) continue;
      const key = `${stat.size}:${stat.mtime_ns}`;
      if (rejected.get(rel) === key) continue;
      candidates.push({ rel, key });
    }
    const kept = new Set(await filterGrepCorpusFiles(candidates.map((c) => c.rel), { projectRoot, policy }));
    const nextRejected = new Map();
    for (const { rel, key } of candidates) {
      if (!kept.has(rel)) { nextRejected.set(rel, key); continue; }
      if (toEnqueue.length >= maxEnqueue) continue;
      enqueue(rel);
      added += 1;
    }
    for (const [rel, key] of rejected) if (!nextRejected.has(rel) && !kept.has(rel)) nextRejected.set(rel, key);
    grepRejectedMemo.set(stateDir, nextRejected);
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
  progress('dirty-scan:queued');

  return { enqueued: toEnqueue.length, added, modified, deleted, retired, files: toEnqueue };
}
