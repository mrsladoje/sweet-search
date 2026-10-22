/**
 * Event-driven maintainer file watcher (G6, Phase 3, gated).
 *
 * Plan: docs/INDEX_MAINTAINER_EFFICIENCY_IMPLEMENTATION_PLAN.md § "G6".
 * Research: docs/INDEX_MAINTAINER_EFFICIENCY_RESEARCH.md (lever C — event-driven
 * watching + a rare reconcile backstop).
 *
 * This module replaces the per-tick full `stat()` walk as the PRIMARY dirty-set
 * producer with native filesystem events (`@parcel/watcher` — FSEvents on macOS,
 * inotify on Linux, ReadDirectoryChangesW on Windows; the watcher VS Code uses).
 * The full stat-walk is NOT removed: G4 demotes it to a periodic backstop so the
 * correctness guarantee (eventual convergence — e.g. a dir becoming gitignored
 * with no file event still gets retired) is preserved exactly.
 *
 * Ownership boundary (single-writer rule): this file is owned by G6. The three
 * call sites in `index-maintainer.mjs` (start after the lock, early-wake in the
 * sleep loop, teardown in `finally`) are owned by G4 and are NOT edited here —
 * this module matches the exact `startWatcher({stateDir, projectRoot,
 * admissionPolicy, onEvent, onOverflow})` contract G4 wired (and returns a
 * handle with a `.close()` method G4's `finally` calls).
 *
 * On by default (`SWEET_SEARCH_MAINTAINER_WATCH=0` turns it off). When
 * `@parcel/watcher` is unavailable or cannot subscribe, `startWatcher` returns
 * `null`: the maintainer logs it once and the full per-tick walk stays the
 * producer.
 *
 * Highest-severity risk (event-storm guard): the daemon writes its own queue +
 * databases under the `.sweet-search` stateDir. Those writes must NEVER
 * re-trigger the watcher, or each enqueue would feed back into a new enqueue. The
 * resolved stateDir is therefore the first entry in the native `ignore` list, and
 * a redundant in-handler stateDir-prefix guard backs it up (defense in depth).
 *
 * The watcher NEVER touches merkle and NEVER makes the final admit decision: it
 * appends candidate paths to the queue exactly as the dirty-scan producer does
 * (same line shape), and the consumer (`production-reconciler`) re-admits +
 * content-hashes each file. A false-positive enqueue is harmless (the consumer
 * drops it); a missed event is caught by the periodic backstop walk.
 */

import { isGrepCorpusPath } from './grep-corpus.js';
import fs from 'node:fs';
import path from 'node:path';

// The dirty queue file name MUST match the dirty-scan producer + the reconcile
// consumer (`dirty-scan.mjs` DIRTY_QUEUE). Kept as a literal here (rather than
// imported) to avoid a cross-module import cycle through the reconciler.
const DIRTY_QUEUE = 'index-maintainer-queue.jsonl';

// The FSEvents snapshot is written OUTSIDE the watched tree's event surface (it
// lives under stateDir, which is itself ignored) so writing it on shutdown can
// never produce a spurious startup event. `getEventsSince` replays the gap
// between the last clean shutdown and the next startup for gap-free freshness.
const SNAPSHOT_FILE = 'maintainer-watch-snapshot.bin';

// Mirror of `path-filter.mjs` DEFAULT_DENY_DIRS_HARD (module-local there): dirs
// whose files are never admitted. They are scoped OUT of the native watch set so
// the OS never reports events under them (inotify watch budget + event volume).
// The build-output dirs (build/dist/out/target) are NOT here: admission re-admits
// a git-tracked file under them, so their events must reach `keepRel` (which
// drops the untracked ones). Nor are `vendor` and `coverage`: the grep corpus holds
// their git-visible files (grep-corpus.js), and the maintainer keeps those current. The stateDir is prepended dynamically (it is the
// event-storm guard, not a generic deny dir).
const DEFAULT_DENY_DIRS = Object.freeze([
  'node_modules',
  '.git',
  '.sweet-search',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.svelte-kit',
  '.vercel',
]);

// A change to one of these changes what is admitted: the next tick runs the full
// walk, and the watcher rebuilds its admission policy.
const ADMISSION_CONFIG_NAMES = Object.freeze(['.gitignore', '.gitattributes', '.sweet-search-ignore']);
const PROJECT_CONFIG_FILE = '.sweet-search.config.json';

// A created directory (a rename into the tree, an unpacked archive) is walked and
// its files queued. Past this many files the full walk is cheaper and bounded.
let maxDirWalkFiles = 20_000;

const MERKLE_STATE = 'merkle-state.json';

// `.git` is denied as a watched subtree (above), but a branch switch / commit /
// reset mutates these two files and must force a backstop walk (bursty churn is
// handled by the bounded full walk, not unbounded per-file events). We poll them
// cheaply via mtime rather than carving a second native watch into the denied
// `.git` dir (which @parcel/watcher's `ignore` would otherwise suppress).
const GIT_BACKSTOP_FILES = Object.freeze(['HEAD', 'index']);
const GIT_POLL_INTERVAL_MS = 2000;

/**
 * Normalise an absolute path to a project-relative POSIX path, or `null` if the
 * path is not under `projectRoot`. macOS reports realpaths (`/private/tmp` for
 * `/tmp`), so both sides are compared after the caller resolves realpaths.
 *
 * @param {string} absPath
 * @param {string} rootAbs  Already resolved project root.
 * @returns {string|null}
 */
function toRel(absPath, rootAbs) {
  const rel = path.relative(rootAbs, absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * Append a batch of relative paths to the dirty queue using the EXACT line shape
 * the dirty-scan producer writes (`dirty-scan.mjs:230`):
 *   {file_path, timestamp, queued_at, source}
 * The only difference is `source: 'watch'` (vs `'scan'`) so queue lines are
 * attributable to the event path in diagnostics. The consumer ignores `source`.
 *
 * @param {string} stateDir
 * @param {string[]} rels  Project-relative POSIX paths.
 */
function appendQueueLines(stateDir, rels) {
  if (rels.length === 0) return;
  fs.mkdirSync(stateDir, { recursive: true });
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const lines = rels
    .map((rel) => `${JSON.stringify({ file_path: rel, timestamp: now, queued_at: iso, source: 'watch' })}\n`)
    .join('');
  fs.appendFileSync(path.join(stateDir, DIRTY_QUEUE), lines);
}

/**
 * Build the native `ignore` list: the resolved stateDir FIRST (event-storm
 * guard), then each default-deny dir name. @parcel/watcher accepts directory
 * paths and glob-ish names in `ignore`; we pass absolute stateDir + bare dir
 * names (matched at any depth by the native matcher).
 *
 * @param {string} rootAbs
 * @param {string} stateDirAbs
 * @returns {string[]}
 */
function buildIgnore(rootAbs, stateDirAbs) {
  const ignore = [stateDirAbs];
  for (const name of DEFAULT_DENY_DIRS) ignore.push(name);
  return ignore;
}

/**
 * Lazily load `@parcel/watcher`. Returns `null` if the dependency (or its native
 * binding) is unavailable, so the flag-off / not-installed tree stays green and
 * the daemon silently falls back to the full per-tick walk.
 *
 * @returns {Promise<object|null>}
 */
async function loadParcelWatcher() {
  try {
    const mod = await import('@parcel/watcher');
    const w = mod.default ?? mod;
    if (w && typeof w.subscribe === 'function') return w;
    return null;
  } catch {
    return null;
  }
}

/**
 * Start the event-driven maintainer watcher.
 *
 * Contract (matched verbatim to G4's wiring in `index-maintainer.mjs`):
 *   startWatcher({ stateDir, projectRoot, admissionPolicy, onEvent, onOverflow })
 *     -> Promise<{ close(): Promise<void> } | null>
 *
 * - `onEvent()`  — called after each batch that enqueued ≥1 candidate, so G4 sets
 *   `watcherState.pendingEvents = true` for early-wake out of the sleep loop.
 * - `onOverflow()` — called on (a) watcher overflow / native error, (b) a
 *   `.git/HEAD` or `.git/index` change. G4 maps this to
 *   `watcherState.forceBackstopWalk = true` (+ pendingEvents) so the next tick
 *   runs the bounded full walk.
 *
 * @param {object}   opts
 * @param {string}   opts.stateDir         Resolved `.sweet-search` dir (ignored).
 * @param {string}   opts.projectRoot      Repo root to watch.
 * @param {object}   opts.admissionPolicy  `createAdmissionPolicy(...)` result.
 * @param {Function} [opts.onEvent]        Early-wake signal.
 * @param {Function} [opts.onOverflow]     Force-backstop signal.
 * @returns {Promise<{close: () => Promise<void>} | null>}
 */
export async function startWatcher({ stateDir, projectRoot, admissionPolicy, createAdmissionPolicy = null, onEvent, onOverflow } = {}) {
  if (!projectRoot || !stateDir) return null;

  const watcher = await loadParcelWatcher();
  if (!watcher) return null;

  // Resolve realpaths so toRel() and the stateDir-prefix guard compare like with
  // like on macOS (where /tmp -> /private/tmp). Fall back to resolve() if the
  // path does not yet exist on disk.
  const rootAbs = safeRealpath(path.resolve(projectRoot));
  const stateDirAbs = safeRealpath(path.resolve(stateDir));
  const stateDirPrefix = stateDirAbs.endsWith(path.sep) ? stateDirAbs : stateDirAbs + path.sep;

  const notify = typeof onEvent === 'function' ? onEvent : () => {};
  const overflowSignal = typeof onOverflow === 'function' ? onOverflow : () => {};
  const overflow = () => { try { overflowSignal(); } catch { /* best-effort */ } };

  // The policy memoises git listings (tracked files, ignored dirs) and the project
  // config, so it is rebuilt after a git or config change.
  let policy = admissionPolicy;
  const refreshPolicy = async () => {
    try {
      const create = createAdmissionPolicy
        || (await import('./admission-policy.js')).createAdmissionPolicy;
      policy = create({ projectRoot });
    } catch { /* keep the old policy; the full walk is authoritative */ }
  };
  const eventCtx = () => ({
    rootAbs, stateDirPrefix, stateDir, admissionPolicy: policy, notify,
    onConfigChange: () => { overflow(); void refreshPolicy(); },
  });

  const snapshotPath = path.join(stateDirAbs, SNAPSHOT_FILE);
  const ignore = buildIgnore(rootAbs, stateDirAbs);
  const subscribeOpts = { ignore };

  // Gap-free restart: replay events the OS recorded between our last clean
  // shutdown (writeSnapshot) and now, BEFORE subscribing, so an edit made while
  // the daemon was down still lands in the queue. Best-effort — a missing /
  // stale snapshot just means the first backstop walk catches the gap.
  try {
    if (fs.existsSync(snapshotPath)) {
      const sinceEvents = await watcher.getEventsSince(rootAbs, snapshotPath, subscribeOpts);
      handleEvents(sinceEvents, eventCtx());
    }
  } catch {
    // A failed replay is non-fatal: force a backstop walk to cover the gap.
    overflow();
  }

  let subscription = null;
  try {
    subscription = await watcher.subscribe(rootAbs, (err, events) => {
      // Native error / overflow (IN_Q_OVERFLOW, ERROR_NOTIFY_ENUM_DIR, …): we
      // cannot trust the event stream, so demand a full backstop walk.
      if (err) {
        overflow();
        return;
      }
      try {
        handleEvents(events, eventCtx());
      } catch {
        // A handler fault must never crash the daemon; fall back to backstop.
        overflow();
      }
    }, subscribeOpts);
  } catch {
    // Could not subscribe (e.g. inotify watch-limit on Linux): no watcher; the
    // full per-tick walk stays primary.
    return null;
  }

  // `.git/HEAD` + `.git/index` poll → forceBackstopWalk on branch switch / commit.
  const gitDir = path.join(rootAbs, '.git');
  const gitMtimes = new Map();
  primeGitMtimes(gitDir, gitMtimes);
  const gitTimer = setInterval(() => {
    try {
      if (gitChanged(gitDir, gitMtimes)) {
        overflow();
        void refreshPolicy(); // the tracked set (build-output re-admission) moved
      }
    } catch { /* best-effort */ }
  }, GIT_POLL_INTERVAL_MS);
  if (gitTimer?.unref) gitTimer.unref();

  return {
    async close() {
      clearInterval(gitTimer);
      // Persist the FSEvents snapshot OUTSIDE the watch tree (under the ignored
      // stateDir) for gap-free replay on next startup. Best-effort.
      try {
        fs.mkdirSync(stateDirAbs, { recursive: true });
        await watcher.writeSnapshot(rootAbs, snapshotPath, subscribeOpts);
      } catch { /* best-effort */ }
      try {
        if (subscription && typeof subscription.unsubscribe === 'function') {
          await subscription.unsubscribe();
        }
      } catch { /* best-effort */ }
    },
  };
}

/**
 * Should an event path become a queue candidate? Mirrors the walk's admission
 * shape loosely (the consumer re-admits and hashes every file; over-admitting is
 * harmless, under-admitting loses an edit until the backstop walk):
 *   - drop a path under a directory git ignores as a whole;
 *   - keep a path the deny-list does not exclude;
 *   - keep a git-tracked file under a build-output dir (admission re-admits it).
 * A policy fault keeps the path.
 */
function keepRel(rel, policy) {
  if (!policy) return true;
  try {
    if (typeof policy.underIgnoredDirectory === 'function' && policy.underIgnoredDirectory(rel)) return false;
    if (typeof policy.isExcluded !== 'function' || !policy.isExcluded(rel)) return true;
    if (typeof policy.isBuildOutputOnly === 'function' && policy.isBuildOutputOnly(rel)
      && typeof policy.trackedFiles === 'function' && policy.trackedFiles().has(rel)) return true;
    // Outside embedding admission but in the grep corpus (vendor/, coverage/, ...): the
    // consumer reconciles it through the sparse-gram tier alone. Never under a natively
    // ignored dir (node_modules, caches).
    if (rel.split('/').some((seg) => DEFAULT_DENY_DIRS.includes(seg))) return false;
    return isGrepCorpusPath(rel);
  } catch {
    return true;
  }
}

/** Descend into this directory while walking a created subtree? */
function walkDir(rel, policy) {
  if (DEFAULT_DENY_DIRS.includes(path.posix.basename(rel))) return false;
  if (!policy) return true;
  try {
    if (typeof policy.isIgnoredDirectory === 'function' && policy.isIgnoredDirectory(rel)) return false;
    // An excluded dir may hold tracked build output or grep-corpus files: descend,
    // keepRel decides per file (a directory git ignores as a whole was dropped above).
  } catch { /* descend */ }
  return true;
}

/**
 * Files under a created directory, as project-relative paths, or null when the
 * subtree holds more than maxDirWalkFiles (the caller then asks for the full walk).
 */
function walkCreatedDir(abs, rel, ctx) {
  const out = [];
  const stack = [[abs, rel]];
  while (stack.length > 0) {
    const [dirAbs, dirRel] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const childAbs = path.join(dirAbs, ent.name);
      const childRel = `${dirRel}/${ent.name}`;
      if (childAbs.startsWith(ctx.stateDirPrefix)) continue;
      if (ent.isDirectory()) {
        if (walkDir(childRel, ctx.admissionPolicy)) stack.push([childAbs, childRel]);
      } else if (ent.isFile() && keepRel(childRel, ctx.admissionPolicy)) {
        out.push(childRel);
        if (out.length > maxDirWalkFiles) return null;
      }
    }
  }
  return out;
}

// merkle-state.json keys, re-read only when the file changes (it is MBs on a big
// repo and only a delete event needs it).
let merkleKeysCache = { key: null, keys: [] };
function merkleKeys(stateDir) {
  const file = path.join(stateDir, MERKLE_STATE);
  let st;
  try { st = fs.statSync(file); } catch { return []; }
  const key = `${file}:${st.size}:${st.mtimeMs}`;
  if (merkleKeysCache.key !== key) {
    let keys = [];
    try { keys = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).files || {}); } catch { /* none */ }
    merkleKeysCache = { key, keys };
  }
  return merkleKeysCache.keys;
}

/**
 * Process a batch of native events into queue lines. Pure of native concerns so
 * it is reused by both the live subscription and the `getEventsSince` replay.
 *
 * Per event, in order:
 *   1. event-storm guard — drop anything under the stateDir (defense in depth on
 *      top of the native `ignore`);
 *   2. relativise — drop anything outside the project root;
 *   3. admission config — a `.gitignore` / `.gitattributes` /
 *      `.sweet-search-ignore` / project config change calls `onConfigChange`
 *      (full walk next tick + policy rebuild);
 *   4. directories — a created directory (a rename into the tree arrives as a
 *      create of the directory alone) queues every candidate file under it; a
 *      deleted path queues itself plus every merkle file under it (a renamed-away
 *      or deleted directory arrives as one delete);
 *   5. candidate filter — `keepRel` (deny-list, ignored dirs, tracked build output).
 *
 * This is NOT the final admit decision: the consumer re-admits and hashes.
 *
 * @param {Array<{path:string,type:string}>} events
 * @param {object} ctx
 */
function handleEvents(events, ctx) {
  const { rootAbs, stateDirPrefix, stateDir, admissionPolicy, notify } = ctx;
  if (!Array.isArray(events) || events.length === 0) return;
  const rels = [];
  const seen = new Set();
  const push = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    rels.push(rel);
  };
  let fullWalk = false;
  for (const ev of events) {
    const abs = ev && ev.path;
    if (typeof abs !== 'string' || abs.length === 0) continue;
    // 1. Event-storm guard: never re-trigger on our own state writes.
    if (abs === stateDirPrefix.slice(0, -1) || abs.startsWith(stateDirPrefix)) continue;
    // 2. Relativise; drop paths outside the project root.
    const rel = toRel(abs, rootAbs);
    if (!rel) continue;
    // 3. Admission config.
    if (rel === PROJECT_CONFIG_FILE || ADMISSION_CONFIG_NAMES.includes(path.posix.basename(rel))) {
      fullWalk = true;
      continue;
    }
    // 4. Directories.
    if (ev.type === 'delete') {
      const prefix = `${rel}/`;
      for (const key of merkleKeys(stateDir)) if (key.startsWith(prefix)) push(key);
    } else {
      let isDir = false;
      try { isDir = fs.statSync(abs).isDirectory(); } catch { /* vanished: let the consumer decide */ }
      if (isDir) {
        if (!walkDir(rel, admissionPolicy)) continue;
        const files = walkCreatedDir(abs, rel, ctx);
        if (files === null) {
          fullWalk = true; // too large: the full walk covers it
          continue;
        }
        for (const f of files) push(f);
        continue;
      }
    }
    // 5. Candidate filter.
    if (keepRel(rel, admissionPolicy)) push(rel);
  }
  if (fullWalk && typeof ctx.onConfigChange === 'function') {
    try { ctx.onConfigChange(); } catch { /* best-effort */ }
  }
  if (rels.length === 0) return;
  appendQueueLines(stateDir, rels);
  try { notify(); } catch { /* best-effort */ }
}

/**
 * Resolve a realpath, falling back to the resolved path if it does not exist.
 * @param {string} p
 * @returns {string}
 */
function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Record current mtimes of the git backstop files (best-effort).
 * @param {string} gitDir
 * @param {Map<string, number>} store
 */
function primeGitMtimes(gitDir, store) {
  for (const name of GIT_BACKSTOP_FILES) {
    try {
      store.set(name, fs.statSync(path.join(gitDir, name)).mtimeMs);
    } catch {
      store.set(name, 0);
    }
  }
}

/**
 * Return true (and update `store`) if any git backstop file changed since the
 * last poll. A removed/added file (mtime 0 ↔ present) counts as a change.
 * @param {string} gitDir
 * @param {Map<string, number>} store
 * @returns {boolean}
 */
function gitChanged(gitDir, store) {
  let changed = false;
  for (const name of GIT_BACKSTOP_FILES) {
    let mtime = 0;
    try {
      mtime = fs.statSync(path.join(gitDir, name)).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (store.get(name) !== mtime) {
      changed = true;
      store.set(name, mtime);
    }
  }
  return changed;
}

// Test seam: pure helpers exercised directly by the unit tests so they do not
// need the native watcher to assert queue-line shape / filtering / git logic.
export const __testing = {
  toRel,
  buildIgnore,
  appendQueueLines,
  handleEvents,
  keepRel,
  setMaxDirWalkFiles: (n) => { const prev = maxDirWalkFiles; maxDirWalkFiles = n; return prev; },
  gitChanged,
  primeGitMtimes,
  DIRTY_QUEUE,
  SNAPSHOT_FILE,
  DEFAULT_DENY_DIRS,
};
