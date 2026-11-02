/**
 * A linked git worktree's own index, cloned from its main checkout's index.
 *
 * THE GAP. A linked worktree with no `.sweet-search/` of its own is served by the main
 * checkout's index (core/search/worktree-roots.js, the split roots). Reading is correct,
 * but the index follows only the main checkout: an edit made inside the worktree is not
 * searchable, and ss-grep cannot find text that exists only there. Indexing the worktree
 * from scratch fixes that at the price of a full first index (tens of minutes on a large
 * repository), once per worktree, and Claude Code makes one worktree per session.
 *
 * THE FIX. Start the worktree's index from the main checkout's index instead of from
 * nothing. The two checkouts share almost every file, and the index stores only
 * project-relative paths, so a copy of the main index is already right for every file the
 * worktree has not changed. Three steps, all in this background process:
 *
 *   1. Clone `<main>/.sweet-search/` with a copy-on-write clone (`cp -c` on APFS,
 *      `cp --reflink` on btrfs/XFS): milliseconds, and no disk until a file is rewritten.
 *      Without copy-on-write it is a plain copy, and only when the disk has room for it.
 *      The main maintainer is held off the index for the copy (as a full index run holds
 *      it), so the SQLite files and their write-ahead logs are copied at rest.
 *   2. Re-key the per-file records (file-state.db) to the worktree. A record holds the
 *      content hash and the stat the file was indexed at; the worktree's files have other
 *      stats (another inode, the checkout's mtime), so the dirty scan would see every file
 *      as changed. Each file whose content hash still matches gets the worktree's stat;
 *      each file that differs keeps the old stat and goes into the maintainer queue.
 *   3. Publish with one rename, then start the worktree's maintainer. From here on the
 *      worktree is an ordinary indexed checkout: its own maintainer indexes the files that
 *      differ (and every later edit, within seconds), and every tool tier and the native
 *      grep lane serve it with no worktree special case.
 *
 * Until the rename, calls are served by the split roots as before; after it,
 * resolveRoots finds the worktree's own index first. The queued files are grepped from
 * disk until the maintainer has indexed them (grep-corpus.js listPendingReindexFiles), so
 * ss-grep is exact from the first call on the new index.
 *
 * WHERE IT LIVES. In `<main>/.sweet-search/worktrees/<name>-<hash>/`, and the worktree
 * gets a `.sweet-search` symbolic link to it. Not a directory inside the worktree: the
 * worktree's maintainer and daemon write there all the time (and the file watcher answers
 * every deleted file with a queue write), so `git worktree remove` raced them and left a
 * half-deleted worktree behind ("Directory not empty"). git removes a symbolic link in one
 * step and never follows it. Next to the main index, the clone is on the same file
 * system, so it can be copy-on-write. `/.sweet-search` is added to the repository's
 * `info/exclude` when nothing ignores it yet (`.sweet-search/` in a .gitignore matches a
 * directory, not a link), so `git status` stays clean and `git worktree remove` works.
 *
 * CLEAN-UP. When the worktree is gone, its maintainer and daemon stop
 * (index-maintainer.mjs stateDirGone, search-server.js idle check), and the index folder
 * is deleted by gcWorktreeIndexes: when that maintainer stops, when a maintainer starts,
 * and before every bootstrap.
 *
 * Run as: node worktree-index.mjs --main=<main checkout> --worktree=<worktree top>
 */

import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATE_DIR_NAME = '.sweet-search';
const INDEX_FILE = 'codebase.db';
const QUEUE_FILE = 'index-maintainer-queue.jsonl';
// A failed bootstrap is not retried on every call: once per this interval at most.
export const RETRY_AFTER_MS = 10 * 60_000;
// A claim whose holder died, or that is older than this, no longer blocks a bootstrap.
const CLAIM_STALE_MS = 30 * 60_000;
// Without copy-on-write the copy must leave this much room on the disk, besides itself.
const MIN_FREE_AFTER_COPY_BYTES = 2 * 1024 ** 3;

// The linked worktrees' indexes, inside the main checkout's state dir.
export const WORKTREES_DIR = 'worktrees';
// Runtime files of the main checkout's processes, and the other worktrees' indexes:
// never carried into a worktree's index.
const RUNTIME_FILES = new Set([
  'index-maintainer.lock', 'maintainer-spawn.claim', 'index-maintainer-queue.jsonl',
  'index-maintainer-queue.processing.jsonl', 'index-maintainer-failures.json', 'maintainer-status.json',
  'maintainer-last-exit.json', 'maintainer-watch-snapshot.bin', 'reconcile-pause.json', 'worktree-stamp.json',
  'daemon-starts.jsonl', 'index-device.lock', 'phase-progress.json', 'readers', WORKTREES_DIR,
]);
const RUNTIME_PREFIXES = ['index-maintainer.log', 'daemon.log', 'query-telemetry.jsonl', 'reconcile-metrics.jsonl', 'worktree-bootstrap'];

export function isRuntimeFile(name) {
  if (RUNTIME_FILES.has(name)) return true;
  if (name.endsWith('-shm')) return true; // SQLite rebuilds the shared-memory index from the WAL
  return RUNTIME_PREFIXES.some((p) => name.startsWith(p));
}

const pathKey = (worktree) => createHash('sha1').update(worktree).digest('hex').slice(0, 16);

/** The main checkout's claim/failure file for one worktree's bootstrap. */
export function bootstrapClaimPath(mainCheckout, worktree) {
  return path.join(mainCheckout, STATE_DIR_NAME, `worktree-bootstrap.${pathKey(worktree)}.json`);
}

/** Where a worktree's index lives: next to the main index, named for people and unique. */
export function worktreeIndexDir(mainCheckout, worktree) {
  const name = path.basename(worktree).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40) || 'worktree';
  return path.join(mainCheckout, STATE_DIR_NAME, WORKTREES_DIR, `${name}-${pathKey(worktree).slice(0, 12)}`);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err?.code === 'EPERM'; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** SWEET_SEARCH_WORKTREE_INDEX=0 keeps every worktree on the main checkout's index. */
export function worktreeIndexEnabled(env = process.env) {
  return env.SWEET_SEARCH_WORKTREE_INDEX !== '0';
}

/**
 * Is a bootstrap for this worktree running, or did one fail recently?
 * @returns {'running'|'failed-recently'|null}
 */
export function bootstrapState(mainCheckout, worktree, nowMs = Date.now()) {
  const claim = readJson(bootstrapClaimPath(mainCheckout, worktree));
  if (!claim) return null;
  const age = nowMs - Number(claim.atMs || 0);
  if (claim.status === 'running' && pidAlive(Number(claim.pid)) && age < CLAIM_STALE_MS) return 'running';
  if (claim.status === 'failed' && age < (Number(claim.retryAfterMs) || RETRY_AFTER_MS)) return 'failed-recently';
  return null;
}

/**
 * Start a background bootstrap for a linked worktree that has no index of its own, unless
 * one is running, failed recently, or is switched off. Never throws, never waits.
 *
 * @returns {{started: boolean, reason: string, pid?: number}}
 */
export function requestWorktreeIndex({ mainCheckout, worktree, env = process.env, entry = fileURLToPath(import.meta.url) }) {
  try {
    if (!worktreeIndexEnabled(env)) return { started: false, reason: 'disabled' };
    if (!mainCheckout || !worktree || mainCheckout === worktree) return { started: false, reason: 'not-linked' };
    if (fs.existsSync(path.join(worktree, STATE_DIR_NAME, INDEX_FILE))) return { started: false, reason: 'indexed' };
    if (!fs.existsSync(path.join(mainCheckout, STATE_DIR_NAME, INDEX_FILE))) return { started: false, reason: 'no-main-index' };
    const state = bootstrapState(mainCheckout, worktree);
    if (state) return { started: false, reason: state };
    const child = spawn(process.execPath, [entry, `--main=${mainCheckout}`, `--worktree=${worktree}`], {
      detached: true,
      stdio: 'ignore',
      cwd: worktree,
      env: { ...env, SWEET_SEARCH_PROJECT_ROOT: worktree },
    });
    child.on('error', () => { /* reported through the claim file */ });
    child.unref();
    return { started: true, reason: 'spawned', pid: child.pid };
  } catch (err) {
    return { started: false, reason: `error: ${err?.message || err}` };
  }
}

/** Take the claim with O_EXCL; a stale or finished claim is replaced. */
function takeClaim(file) {
  const payload = JSON.stringify({ status: 'running', pid: process.pid, atMs: Date.now() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, payload, { flag: 'wx' });
      return true;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      const prev = readJson(file);
      const age = Date.now() - Number(prev?.atMs || 0);
      const live = prev?.status === 'running' && pidAlive(Number(prev.pid)) && age < CLAIM_STALE_MS;
      if (live || (prev?.status === 'failed' && age < (Number(prev.retryAfterMs) || RETRY_AFTER_MS))) return false;
      try { fs.unlinkSync(file); } catch { /* raced */ }
    }
  }
  return false;
}

function dirBytes(dir) {
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) total += dirBytes(p);
    else if (ent.isFile()) { try { total += fs.statSync(p).size; } catch { /* gone */ } }
  }
  return total;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  return { ok: r.status === 0, err: (r.stderr || r.error?.message || '').trim() };
}

/**
 * Copy the index entries of `src` (all but the runtime files) into the new directory
 * `dst`, copy-on-write when the file system can.
 * @returns {'clone'|'copy'}
 */
export function cloneIndexDir(src, dst, { platform = process.platform, log = () => {} } = {}) {
  const entries = fs.readdirSync(src).filter((name) => !isRuntimeFile(name)).map((name) => path.join(src, name));
  fs.mkdirSync(dst, { recursive: true });
  const target = `${dst}${path.sep}`;
  const clone = platform === 'darwin' ? run('cp', ['-cR', ...entries, target])
    : platform === 'linux' ? run('cp', ['-R', '--reflink=always', ...entries, target])
      : { ok: false, err: 'no copy-on-write clone on this platform' };
  if (clone.ok) return 'clone';
  log(`copy-on-write clone unavailable (${clone.err.split('\n')[0] || 'failed'}); checking room for a plain copy`);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  let need = 0;
  for (const e of entries) need += fs.statSync(e).isDirectory() ? dirBytes(e) : fs.statSync(e).size;
  const st = fs.statfsSync(dst);
  const free = Number(st.bavail) * Number(st.bsize);
  if (free < need + MIN_FREE_AFTER_COPY_BYTES) {
    throw new Error(`not enough disk for a plain copy of the index (${need} bytes, ${free} free)`);
  }
  for (const e of entries) fs.cpSync(e, path.join(dst, path.basename(e)), { recursive: true });
  return 'copy';
}

function statOf(abs, { follow }) {
  try {
    const st = follow ? fs.statSync(abs, { bigint: true }) : fs.lstatSync(abs, { bigint: true });
    if (!st.isFile()) return null;
    return { size: st.size.toString(), mtime_ns: st.mtimeNs.toString(), inode: st.ino.toString() };
  } catch {
    return null;
  }
}

/**
 * Re-key the cloned per-file records to the worktree's files (step 2 above).
 *
 * @returns {{same: number, changed: string[]}}  `changed` are the files to re-index.
 */
export async function rekeyFileState({ stateDir, worktree, mainCheckout }) {
  const { openFileState } = await import('../incremental-indexing/infrastructure/file-state-store.mjs');
  const { contentHashSync } = await import('../incremental-indexing/infrastructure/hashing.mjs');
  const store = openFileState(stateDir);
  const changed = [];
  let same = 0;
  let newestSameMtimeNs = 0n;
  try {
    const fileUpdates = [];
    for (const [rel, entry] of store.iterateFiles()) {
      // Stat before the read, as the reconciler does: a write after the stat leaves a
      // newer stat on disk, and the next scan picks the file up again.
      const stat = statOf(path.join(worktree, rel), { follow: true });
      if (!stat) continue; // gone in the worktree: the dirty scan retires it
      let hash = null;
      try { hash = contentHashSync(fs.readFileSync(path.join(worktree, rel))); } catch { /* unreadable */ }
      if (hash !== null && hash === entry.hash) {
        fileUpdates.push([rel, { ...entry, ...stat }]);
        same += 1;
        newestSameMtimeNs = BigInt(stat.mtime_ns) > newestSameMtimeNs ? BigInt(stat.mtime_ns) : newestSameMtimeNs;
      } else {
        changed.push(rel);
      }
    }
    const grepUpdates = [];
    for (const [rel, entry] of store.iterateGrep()) {
      const stat = statOf(path.join(worktree, rel), { follow: false });
      if (!stat) continue;
      let content;
      try { content = fs.readFileSync(path.join(worktree, rel)); } catch { changed.push(rel); continue; }
      const hash = contentHashSync(content);
      // The full build records grep-only files by stat alone (and a binary file with an
      // empty hash). Then the main checkout's file is the reference, if its stat is still
      // the recorded one, that is, the index holds exactly that file.
      let reference = entry.hash || null;
      if (!reference) {
        const mainStat = statOf(path.join(mainCheckout, rel), { follow: false });
        if (mainStat && mainStat.size === entry.size && mainStat.mtime_ns === entry.mtime_ns) {
          try { reference = contentHashSync(fs.readFileSync(path.join(mainCheckout, rel))); } catch { reference = null; }
        }
      }
      if (reference && reference === hash) {
        grepUpdates.push([rel, { size: stat.size, mtime_ns: stat.mtime_ns, hash: typeof entry.hash === 'string' ? entry.hash : hash }]);
        same += 1;
        newestSameMtimeNs = BigInt(stat.mtime_ns) > newestSameMtimeNs ? BigInt(stat.mtime_ns) : newestSameMtimeNs;
      } else {
        changed.push(rel);
      }
    }
    store.transaction(() => {
      for (const [rel, e] of fileUpdates) store.putFile(rel, e);
      for (const [rel, e] of grepUpdates) store.putGrep(rel, e);
    });
    store.db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    store.close();
  }
  return { same, changed: [...new Set(changed)], newestSameMtimeMs: Number(newestSameMtimeNs / 1_000_000n) };
}

/**
 * Date the cloned index as of the worktree's unchanged files.
 *
 * Freshness is a time rule: a file modified after the index was published is stale
 * (index-freshness.js on the manifest's publishedAt; context-expander.js checkStaleness on
 * code-graph.db's mtime). Every file of a new worktree carries the checkout time, later
 * than the main index, so every result read as stale (and ss-grep's line classes are
 * gated on it). The re-key proved the unchanged files equal to what the index holds, so
 * the index is as new as the newest of them. A file edited after the checkout is newer
 * and stays stale until the maintainer indexes it; a file the branch itself changed is
 * queued, grepped from disk until then (grep-corpus.js listPendingReindexFiles), and
 * re-indexed within seconds.
 */
function dateIndexAs(stateDir, newestSameMtimeMs) {
  if (!(newestSameMtimeMs > 0)) return;
  const manifestPath = path.join(stateDir, 'reconcile-manifest.json');
  const manifest = readJson(manifestPath);
  if (manifest && typeof manifest === 'object') {
    const was = Date.parse(manifest.publishedAt || '');
    if (!Number.isFinite(was) || was < newestSameMtimeMs) {
      manifest.publishedAt = new Date(newestSameMtimeMs).toISOString();
      const tmp = `${manifestPath}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
      fs.renameSync(tmp, manifestPath);
    }
  }
  const graph = path.join(stateDir, 'code-graph.db');
  try {
    const st = fs.statSync(graph);
    if (st.mtimeMs < newestSameMtimeMs) fs.utimesSync(graph, st.atime, new Date(newestSameMtimeMs));
  } catch { /* no code graph */ }
}

function writeQueue(stateDir, files) {
  if (!files.length) return;
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const lines = files.map((rel) => `${JSON.stringify({ file_path: rel, timestamp: now, queued_at: iso, source: 'worktree' })}\n`).join('');
  fs.appendFileSync(path.join(stateDir, QUEUE_FILE), lines);
}

function gitOut(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : '';
}

/**
 * Make `<worktree>/.sweet-search` invisible to git. A `.sweet-search/` pattern in a
 * .gitignore matches only a directory, and the worktree's entry is a link; so unless git
 * already ignores it, `/.sweet-search` goes into the repository's `info/exclude`, which
 * every checkout of the repository reads.
 */
function ensureGitIgnoresLink(worktree, log) {
  const ignored = spawnSync('git', ['check-ignore', '-q', STATE_DIR_NAME], { cwd: worktree, stdio: 'ignore' }).status === 0;
  if (ignored) return;
  const common = gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir'], worktree);
  if (!common) return;
  const exclude = path.join(common, 'info', 'exclude');
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  let text = '';
  try { text = fs.readFileSync(exclude, 'utf8'); } catch { /* none yet */ }
  if (text.split(/\r?\n/).includes(`/${STATE_DIR_NAME}`)) return;
  fs.appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}# Sweet Search index link of a linked worktree\n/${STATE_DIR_NAME}\n`);
  log(`added /${STATE_DIR_NAME} to ${exclude}`);
}

/** Point `<worktree>/.sweet-search` at `target`, replacing only a link (a dangling one). */
function linkStateDir(worktree, target) {
  const link = path.join(worktree, STATE_DIR_NAME);
  let st = null;
  try { st = fs.lstatSync(link); } catch { /* none */ }
  if (st && !st.isSymbolicLink()) throw new Error(`${link} exists and is not a link; leaving it alone`);
  const tmp = `${link}.link-${process.pid}`;
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(target, tmp, 'dir');
  fs.renameSync(tmp, link);
}

/**
 * Delete the worktree indexes whose worktree is gone: the stamped checkout no longer
 * exists, or its `.sweet-search` no longer leads here. An index a live maintainer still
 * holds is left for that maintainer to stop first (`selfPid` is the caller's own lock).
 * Also deletes unfinished bootstrap folders of dead processes. Never throws.
 *
 * @returns {string[]} the folders deleted
 */
export function gcWorktreeIndexes(worktreesDir, { selfPid = 0, nowMs = Date.now() } = {}) {
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(worktreesDir); } catch { return removed; }
  for (const name of names) {
    const dir = path.join(worktreesDir, name);
    try {
      const tmp = /\.bootstrap-(\d+)$/.exec(name);
      if (tmp) {
        if (!pidAlive(Number(tmp[1]))) { fs.rmSync(dir, { recursive: true, force: true }); removed.push(dir); }
        continue;
      }
      const stamp = readJson(path.join(dir, 'worktree-stamp.json'));
      const root = stamp?.projectRoot;
      let live = false;
      if (root) {
        try { live = fs.realpathSync(path.join(root, STATE_DIR_NAME)) === fs.realpathSync(dir); } catch { live = false; }
      }
      // A folder with no stamp is a bootstrap that never published: old enough, it goes.
      if (!root) {
        const age = nowMs - fs.statSync(dir).mtimeMs;
        if (age < CLAIM_STALE_MS) continue;
      }
      if (live) continue;
      const lock = readJson(path.join(dir, 'index-maintainer.lock'));
      const holder = Number(lock?.pid);
      if (holder && holder !== selfPid && pidAlive(holder)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch { /* next one */ }
  }
  return removed;
}

const CLONE_LOCK = 'worktree-bootstrap.lock';
const CLONE_LOCK_WAIT_MS = 120_000;

/** The per-main-index clone lock (O_EXCL; a dead holder's lock is taken over). */
async function takeCloneLock(mainState) {
  const file = path.join(mainState, CLONE_LOCK);
  const deadline = Date.now() + CLONE_LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, atMs: Date.now() }), { flag: 'wx' });
      return () => {
        try { if (readJson(file)?.pid === process.pid) fs.unlinkSync(file); } catch { /* gone */ }
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      const holder = readJson(file);
      if (!holder || !pidAlive(Number(holder.pid))) {
        try { fs.unlinkSync(file); } catch { /* raced */ }
        continue;
      }
      if (Date.now() > deadline) throw Object.assign(new Error('another worktree clone holds the lock'), { retryAfterMs: 30_000 });
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/**
 * Build the worktree's index from the main checkout's and link it in. Throws on failure;
 * leaves nothing behind when it does.
 *
 * @returns {Promise<{mode: 'clone'|'copy', same: number, changed: number, ms: number, dir: string}|{skipped: string}>}
 */
export async function bootstrapWorktreeIndex({ mainCheckout, worktree, log = () => {}, launch = true }) {
  const t0 = Date.now();
  const mainState = path.join(mainCheckout, STATE_DIR_NAME);
  if (fs.existsSync(path.join(worktree, STATE_DIR_NAME, INDEX_FILE))) return { skipped: 'indexed' };
  if (!fs.existsSync(path.join(mainState, INDEX_FILE))) return { skipped: 'no-main-index' };
  try {
    if (!fs.lstatSync(path.join(worktree, STATE_DIR_NAME)).isSymbolicLink()) return { skipped: 'own-state-dir' };
  } catch { /* none: the usual case */ }

  const worktreesDir = path.join(mainState, WORKTREES_DIR);
  for (const dir of gcWorktreeIndexes(worktreesDir)) log(`removed the index of a removed worktree: ${dir}`);

  const { holdMaintainerForIndexRun, reconcilePaused, launchMaintainer } = await import('./maintainer-launcher.mjs');
  const finalDir = worktreeIndexDir(mainCheckout, worktree);
  const tmp = `${finalDir}.bootstrap-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  let mode;
  // One clone at a time per main index: several sessions often start their worktrees
  // together, and each clone holds the main maintainer off the index.
  const unlock = await takeCloneLock(mainState);
  try {
    // A pause someone else holds (a full index run, a frozen benchmark index): the main
    // index is being rewritten or must not be touched. Try again on a later call.
    if (reconcilePaused(mainState)) {
      throw Object.assign(new Error('the main checkout\'s index is paused (an index run or a frozen index)'), { retryAfterMs: 60_000 });
    }
    const release = await holdMaintainerForIndexRun(mainState, { reason: 'a worktree index is being cloned' });
    try {
      mode = cloneIndexDir(mainState, tmp, { log });
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw err;
    } finally {
      release();
    }
  } finally {
    unlock();
  }
  log(`${mode === 'clone' ? 'cloned' : 'copied'} ${mainState} in ${Date.now() - t0} ms`);

  try {
    const { writeStamp } = await import('../incremental-indexing/infrastructure/worktree-stamp.mjs');
    writeStamp(tmp, worktree);
    const { same, changed, newestSameMtimeMs } = await rekeyFileState({ stateDir: tmp, worktree, mainCheckout });
    writeQueue(tmp, changed);
    dateIndexAs(tmp, newestSameMtimeMs);
    log(`file records: ${same} unchanged, ${changed.length} queued for re-indexing`);
    // A leftover index for this path (its worktree was removed and re-added, and the
    // clean-up has not run) is replaced: it describes other files.
    const old = readJson(path.join(finalDir, 'index-maintainer.lock'));
    if (old?.pid && pidAlive(Number(old.pid))) throw new Error(`a maintainer still runs on ${finalDir}`);
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(tmp, finalDir);
    ensureGitIgnoresLink(worktree, log);
    linkStateDir(worktree, finalDir);
    if (launch) {
      const r = launchMaintainer({ cwd: worktree, env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: worktree } });
      log(`maintainer: ${r.reason}${r.pid ? ` (pid ${r.pid})` : ''}`);
    }
    return { mode, same, changed: changed.length, ms: Date.now() - t0, dir: finalDir };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/**
 * One bootstrap for one worktree at a time: take the worktree's claim, build, and record
 * the outcome in the claim file (a failure holds off retries for a while). The background
 * process runs this; so does the MCP server, which waits for it at start.
 *
 * @returns {Promise<'ready'|'skipped'|'busy'|'failed'>}  'busy': another process holds the claim
 */
export async function runWorktreeBootstrap({ mainCheckout, worktree, log: extraLog = null, launch = true }) {
  const claim = bootstrapClaimPath(mainCheckout, worktree);
  const logFile = path.join(mainCheckout, STATE_DIR_NAME, 'worktree-bootstrap.log');
  const log = (msg) => {
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} [${process.pid}] ${worktree}: ${msg}\n`); } catch { /* best effort */ }
    extraLog?.(msg);
  };
  if (!takeClaim(claim)) return 'busy';
  try {
    const r = await bootstrapWorktreeIndex({ mainCheckout, worktree, log, launch });
    log(r.skipped ? `skipped: ${r.skipped}` : `ready in ${r.ms} ms`);
    fs.rmSync(claim, { force: true });
    return r.skipped ? 'skipped' : 'ready';
  } catch (err) {
    log(`failed: ${err?.stack || err}`);
    const retryAfterMs = Number(err?.retryAfterMs) || RETRY_AFTER_MS;
    try { fs.writeFileSync(claim, JSON.stringify({ status: 'failed', pid: process.pid, atMs: Date.now(), retryAfterMs, error: String(err?.message || err) })); } catch { /* best effort */ }
    return 'failed';
  }
}

/**
 * Give the linked worktree its own index now, and wait for it (the MCP server, whose
 * project root is fixed for its whole life). Never throws.
 *
 * @returns {Promise<boolean>} true when the worktree has an index of its own
 */
export async function ensureWorktreeIndex({ mainCheckout, worktree, env = process.env, waitMs = 120_000, log = null }) {
  const indexed = () => fs.existsSync(path.join(worktree, STATE_DIR_NAME, INDEX_FILE));
  if (indexed()) return true;
  if (!worktreeIndexEnabled(env) || !fs.existsSync(path.join(mainCheckout, STATE_DIR_NAME, INDEX_FILE))) return false;
  try {
    const outcome = await runWorktreeBootstrap({ mainCheckout, worktree, log });
    if (outcome === 'busy') {
      // Another process is building it: wait for its link.
      const deadline = Date.now() + waitMs;
      while (!indexed() && bootstrapState(mainCheckout, worktree) === 'running' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  } catch { /* reported in the bootstrap log */ }
  return indexed();
}

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
  const mainCheckout = arg('main');
  const worktree = arg('worktree');
  if (!mainCheckout || !worktree) {
    process.stderr.write('usage: worktree-index.mjs --main=<main checkout> --worktree=<worktree top>\n');
    process.exit(2);
  }
  try {
    const { applyBackgroundPriority } = await import('./os-priority.mjs').catch(() => ({}));
    applyBackgroundPriority?.(process.pid);
  } catch { /* best effort */ }
  const outcome = await runWorktreeBootstrap({ mainCheckout, worktree });
  if (outcome === 'failed') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
