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
 * Gate: `SWEET_SEARCH_MAINTAINER_WATCH === '1'` (checked by G4 before this module
 * is imported). When the flag is off OR `@parcel/watcher` is unavailable,
 * `startWatcher` returns `null` and behavior is EXACTLY today's: G4 sees a falsy
 * handle, `watcherState.active` stays false, and the full per-tick walk remains
 * the sole producer.
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

// Mirror of `path-filter.mjs` DEFAULT_DENY_DIRS (that const is module-local and
// not exported). These are scoped OUT of the native watch set so the OS never
// even reports events under them (inotify-watch-budget + event-volume control on
// Linux; FSEvents is O(1) regardless but the ignore still trims event volume).
// `admissionPolicy.isExcluded` is the authoritative per-event deny check below;
// this list only narrows what the kernel watches. The stateDir is prepended
// dynamically (it is the event-storm guard, not a generic deny dir).
const DEFAULT_DENY_DIRS = Object.freeze([
  'node_modules',
  '.git',
  '.sweet-search',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.turbo',
  'coverage',
  '.parcel-cache',
  '.svelte-kit',
  '.vercel',
]);

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
export async function startWatcher({ stateDir, projectRoot, admissionPolicy, onEvent, onOverflow } = {}) {
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
  const overflow = typeof onOverflow === 'function' ? onOverflow : () => {};

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
      handleEvents(sinceEvents, { rootAbs, stateDirPrefix, stateDir, admissionPolicy, notify });
    }
  } catch {
    // A failed replay is non-fatal: force a backstop walk to cover the gap.
    try { overflow(); } catch { /* best-effort */ }
  }

  let subscription = null;
  try {
    subscription = await watcher.subscribe(rootAbs, (err, events) => {
      // Native error / overflow (IN_Q_OVERFLOW, ERROR_NOTIFY_ENUM_DIR, …): we
      // cannot trust the event stream, so demand a full backstop walk.
      if (err) {
        try { overflow(); } catch { /* best-effort */ }
        return;
      }
      try {
        handleEvents(events, { rootAbs, stateDirPrefix, stateDir, admissionPolicy, notify });
      } catch {
        // A handler fault must never crash the daemon; fall back to backstop.
        try { overflow(); } catch { /* best-effort */ }
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
        try { overflow(); } catch { /* best-effort */ }
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
 * Process a batch of native events into queue lines. Pure of native concerns so
 * it is reused by both the live subscription and the `getEventsSince` replay.
 *
 * Filtering, in order:
 *   1. event-storm guard — drop anything under the stateDir (defense in depth on
 *      top of the native `ignore`);
 *   2. relativise — drop anything outside the project root;
 *   3. directory guard — drop directory events. The dirty-scan producer only
 *      ever enqueues regular files (`ent.isFile()`, `dirty-scan.mjs:145`), so a
 *      bare `create`/`update` on a directory must NOT become a queue line.
 *      Deletes are kept (the path is gone, can't stat) — a deleted directory rel
 *      is harmless: it won't be a merkle-known file, so the consumer drops it,
 *      exactly as dirty-scan's delete branch only retires merkle-known paths;
 *   4. admission deny — drop excluded paths (node_modules, denied dirs/exts,
 *      `.sweet-search-ignore`) via `admissionPolicy.isExcluded`.
 *
 * Note: this is NOT the final admit decision (no include-allowlist / size /
 * gitignore check). The consumer re-admits + content-hashes. We only need to keep
 * obviously-denied churn out of the queue; over-admitting is harmless.
 *
 * @param {Array<{path:string,type:string}>} events
 * @param {object} ctx
 */
function handleEvents(events, { rootAbs, stateDirPrefix, stateDir, admissionPolicy, notify }) {
  if (!Array.isArray(events) || events.length === 0) return;
  const rels = [];
  const seen = new Set();
  for (const ev of events) {
    const abs = ev && ev.path;
    if (typeof abs !== 'string' || abs.length === 0) continue;
    // 1. Event-storm guard: never re-trigger on our own state writes.
    if (abs === stateDirPrefix.slice(0, -1) || abs.startsWith(stateDirPrefix)) continue;
    // 2. Relativise; drop paths outside the project root.
    const rel = toRel(abs, rootAbs);
    if (!rel) continue;
    if (seen.has(rel)) continue;
    // 3. Directory guard: only files become queue lines (match dirty-scan).
    //    `delete` events have no on-disk path to stat; keep them (a deleted dir
    //    rel is a harmless non-merkle no-op for the consumer).
    if (ev.type !== 'delete') {
      try {
        if (fs.statSync(abs).isDirectory()) continue;
      } catch {
        // Vanished between event and stat (rapid churn): let the consumer decide.
      }
    }
    // 4. Admission deny-list (cheap, sync, I/O-free).
    try {
      if (admissionPolicy && typeof admissionPolicy.isExcluded === 'function' && admissionPolicy.isExcluded(rel)) {
        continue;
      }
    } catch {
      // A policy fault should not drop the event — let the consumer re-admit.
    }
    seen.add(rel);
    rels.push(rel);
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
  gitChanged,
  primeGitMtimes,
  DIRTY_QUEUE,
  SNAPSHOT_FILE,
  DEFAULT_DENY_DIRS,
};
