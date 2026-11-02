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
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEAD_LEGACY_ARTIFACTS } from './legacy-artifact-sweep.js';
import { projectPidFile, projectSocketPath, resolveProjectRoot } from '../search/server-identity.js';

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
  // Staging temps (`*.tmp.<pid>`, `*.json.tmp`): written and removed by other processes
  // while the clone lists the folder; one that vanishes mid-copy failed the whole copy.
  if (/\.tmp(\.|$)/.test(name)) return true;
  if (name.endsWith('-shm')) return true; // SQLite rebuilds the shared-memory index from the WAL
  return RUNTIME_PREFIXES.some((p) => name.startsWith(p));
}

const LEGACY = new Set(DEAD_LEGACY_ARTIFACTS);
// The directories an index holds (LI segments, sparse-gram deltas, parser grammars).
// Any other directory in a state dir is not index data (benchmark output, notes) and is
// not cloned: on a plain copy it would cost disk for nothing.
const INDEX_DIR = /(\.segments|\.deltas)$|^grammars$/;

/** Is `name` (an entry of a state dir) part of the index a worktree needs? */
export function isClonedEntry(name, isDirectory) {
  if (isRuntimeFile(name) || LEGACY.has(name)) return false;
  return !isDirectory || INDEX_DIR.test(name);
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
export function requestWorktreeIndex({ mainCheckout, worktree, env = process.env, entry = fileURLToPath(import.meta.url), daemonPid = 0 }) {
  try {
    if (!worktreeIndexEnabled(env)) return { started: false, reason: 'disabled' };
    if (!mainCheckout || !worktree || mainCheckout === worktree) return { started: false, reason: 'not-linked' };
    if (fs.existsSync(path.join(worktree, STATE_DIR_NAME, INDEX_FILE))) return { started: false, reason: 'indexed' };
    if (!fs.existsSync(path.join(mainCheckout, STATE_DIR_NAME, INDEX_FILE))) return { started: false, reason: 'no-main-index' };
    // A state dir of the worktree's own with no index in it (an index run that stopped
    // early): the bootstrap leaves it alone, so starting one would only repeat forever.
    if (ownStateDir(worktree)) return { started: false, reason: 'own-state-dir' };
    const state = bootstrapState(mainCheckout, worktree);
    if (state) return { started: false, reason: state };
    const args = [entry, `--main=${mainCheckout}`, `--worktree=${worktree}`];
    if (daemonPid > 0) args.push(`--daemon-pid=${daemonPid}`);
    const child = spawn(process.execPath, args, {
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

/**
 * Create `file` holding `payload`, only if it does not exist. The content is written to a
 * private name first and linked into place, so no reader ever sees the file empty or
 * half-written (a reader that did took a live claim for an abandoned one).
 * @returns {boolean} false when the file exists
 */
export function createExclusive(file, payload) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, payload);
  try {
    fs.linkSync(tmp, file);
    return true;
  } catch (err) {
    if (err?.code === 'EEXIST') return false;
    // A file system without hard links (exFAT, FAT32, some network shares): O_EXCL create,
    // then write. A reader can meet it empty for an instant; readers count a young
    // unreadable file as held (UNREADABLE_HELD_MS), never as abandoned.
    let fd;
    try {
      fd = fs.openSync(file, 'wx');
    } catch (e) {
      if (e?.code === 'EEXIST') return false;
      throw e;
    }
    try { fs.writeSync(fd, payload); } finally { fs.closeSync(fd); }
    return true;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* gone */ }
  }
}

/**
 * Remove `file` only if it is still the stale one. Reading and then unlinking is a race:
 * between the two another process can replace the stale file with its own live one, and
 * the unlink would delete that (two owners). So the file is first moved to a private
 * name, which takes exactly one version; it is judged there, and a live version is put
 * back. `isStale(content, ageMs)` decides on the moved file's text (null when unreadable)
 * and age (a rename keeps the mtime).
 */
export function removeIfStale(file, isStale) {
  const aside = `${file}.${process.pid}.${Date.now()}.stale`;
  try { fs.renameSync(file, aside); } catch { return; } // gone already: nothing to remove
  let text = null;
  try { text = fs.readFileSync(aside, 'utf8'); } catch { text = null; }
  if (isStale(text, fileAgeMs(aside))) {
    try { fs.unlinkSync(aside); } catch { /* gone */ }
    return;
  }
  // Someone else's live file: put it back, unless a newer one is already in place.
  try { fs.linkSync(aside, file); } catch { /* a newer file holds the name */ }
  try { fs.unlinkSync(aside); } catch { /* gone */ }
}

// A lock or claim file that cannot be read is held if it is this young (a file another
// tool wrote by hand, or a disk error): never take over what may be live.
const UNREADABLE_HELD_MS = 60_000;

function fileAgeMs(file) {
  try { return Date.now() - fs.statSync(file).mtimeMs; } catch { return Infinity; }
}

function ownStateDir(worktree) {
  try { return !fs.lstatSync(path.join(worktree, STATE_DIR_NAME)).isSymbolicLink(); } catch { return false; }
}

/** Does a claim (parsed, or null when unreadable) still hold? */
function claimHolds(prev, ageOfFileMs) {
  if (!prev) return ageOfFileMs < UNREADABLE_HELD_MS;
  const age = Date.now() - Number(prev.atMs || 0);
  if (prev.status === 'running') return pidAlive(Number(prev.pid)) && age < CLAIM_STALE_MS;
  if (prev.status === 'failed') return age < (Number(prev.retryAfterMs) || RETRY_AFTER_MS);
  return false;
}

/** Take the claim; a stale or finished claim is replaced. */
function takeClaim(file) {
  const payload = JSON.stringify({ status: 'running', pid: process.pid, atMs: Date.now() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (createExclusive(file, payload)) return true;
    if (claimHolds(readJson(file), fileAgeMs(file))) return false;
    removeIfStale(file, (text, ageMs) => {
      let prev = null;
      try { prev = JSON.parse(text); } catch { prev = null; }
      return !claimHolds(prev, ageMs);
    });
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

const DEFAULT_PLAIN_COPY_MAX_MB = 1024;

/** SWEET_SEARCH_WORKTREE_COPY_MAX_MB: the largest index copied without copy-on-write. */
export function plainCopyMaxBytes(env = process.env) {
  const mb = Number(env.SWEET_SEARCH_WORKTREE_COPY_MAX_MB);
  return (env.SWEET_SEARCH_WORKTREE_COPY_MAX_MB !== undefined && Number.isFinite(mb) && mb >= 0 ? mb : DEFAULT_PLAIN_COPY_MAX_MB) * 1024 * 1024;
}

/** The file system type of the volume holding `p` on macOS ('apfs', 'hfs', ...), or ''. */
function volumeType(p) {
  const df = spawnSync('df', ['-P', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const mountPoint = (df.stdout || '').trim().split('\n').pop()?.split(/\s+/).slice(5).join(' ');
  if (!mountPoint) return '';
  const mounts = spawnSync('mount', [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).stdout || '';
  for (const line of mounts.split('\n')) {
    const m = / on (.+) \(([^,)]+)/.exec(line);
    if (m && m[1] === mountPoint) return m[2];
  }
  return '';
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
export function cloneIndexDir(src, dst, { platform = process.platform, log = () => {}, env = process.env } = {}) {
  const entries = fs.readdirSync(src, { withFileTypes: true })
    .filter((ent) => isClonedEntry(ent.name, ent.isDirectory()))
    .map((ent) => path.join(src, ent.name));
  fs.mkdirSync(dst, { recursive: true });
  const target = `${dst}${path.sep}`;
  // macOS `cp -c` quietly falls back to a full copy where clonefile is not supported, so
  // it is used only on APFS; GNU `cp --reflink=always` fails instead of copying.
  const clone = platform === 'darwin'
    ? (volumeType(src) === 'apfs' ? run('cp', ['-cR', ...entries, target]) : { ok: false, err: 'not an APFS volume' })
    : platform === 'linux' ? run('cp', ['-R', '--reflink=always', ...entries, target])
      : { ok: false, err: 'no copy-on-write clone on this platform' };
  if (clone.ok) return 'clone';
  log(`copy-on-write clone unavailable (${clone.err.split('\n')[0] || 'failed'}); checking a plain copy`);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  let need = 0;
  for (const e of entries) need += fs.statSync(e).isDirectory() ? dirBytes(e) : fs.statSync(e).size;
  // The main maintainer is held off the index for the whole copy, so a plain copy must be
  // short: larger indexes stay on the main checkout's index (the notice says so).
  const maxBytes = plainCopyMaxBytes(env);
  if (need > maxBytes) {
    throw Object.assign(new Error(`index of ${need} bytes is over the plain-copy limit of ${maxBytes} (SWEET_SEARCH_WORKTREE_COPY_MAX_MB) and the volume cannot clone`), { retryAfterMs: 24 * 3600_000 });
  }
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
  let oldestChangedMtimeNs = null;
  const noteChanged = (rel, stat) => {
    changed.push(rel);
    if (stat) {
      const ns = BigInt(stat.mtime_ns);
      if (oldestChangedMtimeNs === null || ns < oldestChangedMtimeNs) oldestChangedMtimeNs = ns;
    }
  };
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
        noteChanged(rel, stat);
      }
    }
    const grepUpdates = [];
    for (const [rel, entry] of store.iterateGrep()) {
      const stat = statOf(path.join(worktree, rel), { follow: false });
      if (!stat) continue;
      let content;
      try { content = fs.readFileSync(path.join(worktree, rel)); } catch { noteChanged(rel, stat); continue; }
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
        noteChanged(rel, stat);
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
  return { same, changed: [...new Set(changed)], publishedAtMs: indexDateMs(newestSameMtimeNs, oldestChangedMtimeNs) };
}

const ceilMs = (ns) => Number((ns + 999_999n) / 1_000_000n);

/**
 * The time to date the clone at (see dateIndexAs), in whole milliseconds as the manifest
 * stores it, or 0 for "leave it". Freshness compares a file's fractional mtimeMs with it
 * (stale when greater), so: at or after the newest unchanged file (rounded up, or that file
 * itself reads stale), and strictly before the oldest changed one, which must read stale
 * until the maintainer has indexed it. When both cannot hold, the changed file wins: an
 * unchanged file that reads stale for a while is safe, a changed one that reads fresh
 * shows the main checkout's chunks as current.
 */
export function indexDateMs(newestSameNs, oldestChangedNs) {
  let t = newestSameNs > 0n ? ceilMs(newestSameNs) : 0;
  if (oldestChangedNs !== null && oldestChangedNs !== undefined) {
    const before = ceilMs(oldestChangedNs) - 1;
    t = t > 0 ? Math.min(t, before) : before;
  }
  return t > 0 ? t : 0;
}

/**
 * Date the cloned index as of the worktree's unchanged files.
 *
 * Freshness is a time rule: a file modified after the index was published is stale
 * (index-freshness.js on the manifest's publishedAt; context-expander.js checkStaleness on
 * code-graph.db's mtime). Every file of a new worktree carries the checkout time, later
 * than the main index, so every result read as stale (and ss-grep's line classes are
 * gated on it). The re-key proved the unchanged files equal to what the index holds, so
 * the index is as new as the newest of them, but never as new as the oldest changed file
 * (indexDateMs): every changed file reads stale until the maintainer has indexed it and
 * published, which dates the index anew.
 */
function dateIndexAs(stateDir, publishedAtMs) {
  if (!(publishedAtMs > 0)) return;
  const manifestPath = path.join(stateDir, 'reconcile-manifest.json');
  const manifest = readJson(manifestPath);
  if (manifest && typeof manifest === 'object') {
    manifest.publishedAt = new Date(publishedAtMs).toISOString();
    const tmp = `${manifestPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(tmp, manifestPath);
  }
  const graph = path.join(stateDir, 'code-graph.db');
  try {
    const st = fs.statSync(graph);
    fs.utimesSync(graph, st.atime, new Date(publishedAtMs));
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

/** Is `dir` a `<checkout>/.sweet-search/worktrees` folder (the only place GC may act)? */
export function isWorktreesDir(dir) {
  return path.basename(dir) === WORKTREES_DIR && path.basename(path.dirname(dir)) === STATE_DIR_NAME;
}

// The names this module gives: `<name>-<12 hex>` and `<that>.bootstrap-<pid>`.
const OWN_INDEX_NAME = /^[A-Za-z0-9._-]{1,40}-[0-9a-f]{12}$/;
const OWN_BOOTSTRAP_NAME = /^[A-Za-z0-9._-]{1,40}-[0-9a-f]{12}\.bootstrap-(\d+)$/;

/**
 * Delete the worktree indexes whose worktree is gone: the stamped checkout no longer
 * exists, or its `.sweet-search` no longer leads here. Acts only inside a
 * `.sweet-search/worktrees` folder and only on folders named the way this module names
 * them; never on an unstamped folder. Keeps an index a live maintainer still holds
 * (`selfPid` is the caller's own lock), and one stamped in the last half hour whose
 * worktree still exists (a bootstrap between publish and link). Also deletes unfinished
 * bootstrap folders of dead processes. Never throws.
 *
 * @returns {string[]} the folders deleted
 */
export function gcWorktreeIndexes(worktreesDir, { selfPid = 0, nowMs = Date.now() } = {}) {
  const removed = [];
  if (!isWorktreesDir(worktreesDir)) return removed;
  let names = [];
  try { names = fs.readdirSync(worktreesDir); } catch { return removed; }
  for (const name of names) {
    const dir = path.join(worktreesDir, name);
    try {
      const tmp = OWN_BOOTSTRAP_NAME.exec(name);
      if (tmp) {
        if (!pidAlive(Number(tmp[1]))) { fs.rmSync(dir, { recursive: true, force: true }); removed.push(dir); }
        continue;
      }
      if (!OWN_INDEX_NAME.test(name)) continue;
      const stamp = readJson(path.join(dir, 'worktree-stamp.json'));
      const root = stamp?.projectRoot;
      if (!root) continue;
      let live = false;
      try { live = fs.realpathSync(path.join(root, STATE_DIR_NAME)) === fs.realpathSync(dir); } catch { live = false; }
      if (live) continue;
      const stampedMs = Date.parse(stamp.stampedAt || '');
      if (fs.existsSync(root) && Number.isFinite(stampedMs) && nowMs - stampedMs < CLAIM_STALE_MS) continue;
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
async function takeCloneLock(mainState, waitMs = CLONE_LOCK_WAIT_MS) {
  const file = path.join(mainState, CLONE_LOCK);
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (createExclusive(file, JSON.stringify({ pid: process.pid, atMs: Date.now() }))) {
      return () => {
        try { if (readJson(file)?.pid === process.pid) fs.unlinkSync(file); } catch { /* gone */ }
      };
    }
    const holder = readJson(file);
    const held = holder ? pidAlive(Number(holder.pid)) : fileAgeMs(file) < UNREADABLE_HELD_MS;
    if (!held) {
      removeIfStale(file, (text, ageMs) => {
        let h = null;
        try { h = JSON.parse(text); } catch { h = null; }
        return h ? !pidAlive(Number(h.pid)) : ageMs >= UNREADABLE_HELD_MS;
      });
      continue;
    }
    if (Date.now() > deadline) throw Object.assign(new Error('another worktree clone holds the lock'), { retryAfterMs: 30_000 });
    await new Promise((r) => setTimeout(r, 100));
  }
}

function pidFileLive(pidFile) {
  try { return pidAlive(Number(fs.readFileSync(pidFile, 'utf8').trim())); } catch { return false; }
}

/**
 * Start a maintainer for `root`, bound like the launches the daemons make: to `daemonPid`
 * when a process asked for one (the MCP server searches in-process and has no pid file),
 * else to the root's search daemon when one is running. With neither it runs unbound,
 * until its idle TTL: bound to a daemon that does not exist it would stop after two
 * minutes, and an MCP-only session has nothing that starts it again.
 */
function launchFor(launchMaintainer, root, { daemonPid = 0 } = {}) {
  const env = { ...process.env, SWEET_SEARCH_PROJECT_ROOT: root };
  delete env.SWEET_SEARCH_PID_FILE;
  delete env.SWEET_SEARCH_STATE_DIR;
  const pidFile = projectPidFile(env, root);
  const binding = daemonPid > 0 && pidAlive(daemonPid) ? { daemonPid }
    : pidFileLive(pidFile) ? { daemonPidFile: pidFile } : {};
  return launchMaintainer({ cwd: root, env, ...binding });
}

/** GET `/stop` on a daemon's socket; resolves true when a daemon answered. */
function stopDaemonAt(socketPath) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path: '/stop', method: 'GET', timeout: 1_000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * A daemon still serving this worktree path is serving an earlier worktree's index (the
 * worktree was removed and added again before that daemon noticed). Ask it to stop over
 * its socket, as daemons are always stopped: a pid file can outlive its daemon and name
 * an unrelated process by then. The next call starts a daemon on the new index.
 */
async function stopStaleDaemon(worktree, log) {
  const env = { ...process.env, SWEET_SEARCH_PROJECT_ROOT: worktree };
  delete env.SWEET_SEARCH_PID_FILE;
  delete env.SWEET_SEARCH_SOCKET_PATH;
  // Only the worktree's own daemon: never a socket the walk resolved to another root.
  let real = worktree;
  try { real = fs.realpathSync(worktree); } catch { /* as given */ }
  if (resolveProjectRoot(env, worktree) !== real) return;
  const socketPath = projectSocketPath(env, worktree);
  if (!fs.existsSync(socketPath)) return;
  if (await stopDaemonAt(socketPath)) log('asked the daemon of an earlier index at this path to stop');
}

/**
 * Can a symbolic link be made in the worktree? (Not on some WSL and Windows volumes.)
 * The probe is the link's own name, which git is told to ignore first, so a bootstrap
 * killed mid-probe leaves nothing `git status` shows (and the next bootstrap replaces it).
 */
function canLink(worktree) {
  const probe = path.join(worktree, STATE_DIR_NAME);
  let st = null;
  try { st = fs.lstatSync(probe); } catch { /* none */ }
  if (st) return st.isSymbolicLink(); // a link made here before (a real folder never gets here)
  try {
    fs.symlinkSync('.', probe, 'dir');
    return true;
  } catch {
    return false;
  } finally {
    try { if (fs.lstatSync(probe).isSymbolicLink()) fs.unlinkSync(probe); } catch { /* none */ }
  }
}

/**
 * Build the worktree's index from the main checkout's and link it in. Throws on failure;
 * leaves nothing behind when it does.
 *
 * @param {object} opts
 * @param {number} [opts.lockWaitMs]  how long to wait for another clone of this main index
 * @returns {Promise<{mode: 'clone'|'copy', same: number, changed: number, ms: number, dir: string}|{skipped: string}>}
 */
export async function bootstrapWorktreeIndex({
  mainCheckout, worktree, log = () => {}, launch = true, lockWaitMs = CLONE_LOCK_WAIT_MS, daemonPid = 0,
}) {
  const t0 = Date.now();
  const mainState = path.join(mainCheckout, STATE_DIR_NAME);
  if (fs.existsSync(path.join(worktree, STATE_DIR_NAME, INDEX_FILE))) return { skipped: 'indexed' };
  if (!fs.existsSync(path.join(mainState, INDEX_FILE))) return { skipped: 'no-main-index' };
  if (ownStateDir(worktree)) return { skipped: 'own-state-dir' };
  // Cheap checks first: a worktree that cannot hold the link must not cost a copy and a
  // stopped main maintainer, again on every retry.
  // git must ignore the link's name before the probe makes it.
  ensureGitIgnoresLink(worktree, log);
  if (!canLink(worktree)) {
    throw Object.assign(new Error('cannot create a symbolic link in the worktree'), { retryAfterMs: 24 * 3600_000 });
  }

  const worktreesDir = path.join(mainState, WORKTREES_DIR);
  for (const dir of gcWorktreeIndexes(worktreesDir)) log(`removed the index of a removed worktree: ${dir}`);

  const { holdMaintainerForIndexRun, reconcilePaused, launchMaintainer, maintainerAlive } = await import('./maintainer-launcher.mjs');
  const finalDir = worktreeIndexDir(mainCheckout, worktree);
  const tmp = `${finalDir}.bootstrap-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  let mode;
  // One clone at a time per main index: several sessions often start their worktrees
  // together, and each clone holds the main maintainer off the index.
  const unlock = await takeCloneLock(mainState, lockWaitMs);
  try {
    // A pause someone else holds (a full index run, a frozen benchmark index): the main
    // index is being rewritten or must not be touched. Try again on a later call.
    const paused = () => Object.assign(new Error('the main checkout\'s index is paused (an index run or a frozen index)'), { retryAfterMs: 60_000 });
    if (reconcilePaused(mainState)) throw paused();
    const mainWasMaintained = maintainerAlive(mainState);
    // The pause is exclusive (maintainer-launcher.mjs): a full index run that starts now
    // waits for this copy, and one that won the race makes this hold not ours.
    const release = await holdMaintainerForIndexRun(mainState, { reason: 'a worktree index is being cloned', waitForHolderMs: 2_000 });
    try {
      if (!release.ours) throw paused();
      mode = cloneIndexDir(mainState, tmp, { log });
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw err;
    } finally {
      release();
      // The hold stopped the main checkout's maintainer. Its daemon would start a new one
      // only on the next query or supervision tick (up to a minute), and edits in the
      // main checkout must not wait that long: start it again now, unless an index run
      // took the index over in the meantime.
      if (mainWasMaintained && launch && !reconcilePaused(mainState)) {
        const r = launchFor(launchMaintainer, mainCheckout);
        log(`main maintainer: ${r.reason}${r.pid ? ` (pid ${r.pid})` : ''}`);
      }
    }
  } finally {
    unlock();
  }
  log(`${mode === 'clone' ? 'cloned' : 'copied'} ${mainState} in ${Date.now() - t0} ms`);

  try {
    const { writeStamp } = await import('../incremental-indexing/infrastructure/worktree-stamp.mjs');
    writeStamp(tmp, worktree);
    const { same, changed, publishedAtMs } = await rekeyFileState({ stateDir: tmp, worktree, mainCheckout });
    writeQueue(tmp, changed);
    dateIndexAs(tmp, publishedAtMs);
    log(`file records: ${same} unchanged, ${changed.length} queued for re-indexing`);
    // A leftover index for this path (its worktree was removed and re-added, and the
    // clean-up has not run) is replaced: it describes other files.
    const old = readJson(path.join(finalDir, 'index-maintainer.lock'));
    if (old?.pid && pidAlive(Number(old.pid))) {
      // The earlier worktree's maintainer is still shutting down: try again soon.
      throw Object.assign(new Error(`a maintainer still runs on ${finalDir}`), { retryAfterMs: 30_000 });
    }
    // Link first, then publish with the rename: a published folder is never without its
    // link, so a clean-up running in between cannot take it for an orphan.
    // The leftover goes before the link exists, so no call is served by it meanwhile.
    fs.rmSync(finalDir, { recursive: true, force: true });
    linkStateDir(worktree, finalDir);
    fs.renameSync(tmp, finalDir);
    // After the link resolves: the daemon pid file is found by walking up to the nearest
    // index, which before the link is the main checkout's (and stopped the main daemon).
    await stopStaleDaemon(worktree, log);
    if (launch) {
      const r = launchFor(launchMaintainer, worktree, { daemonPid });
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
export async function runWorktreeBootstrap({ mainCheckout, worktree, log: extraLog = null, launch = true, lockWaitMs, daemonPid = 0 }) {
  const claim = bootstrapClaimPath(mainCheckout, worktree);
  const logFile = path.join(mainCheckout, STATE_DIR_NAME, 'worktree-bootstrap.log');
  const log = (msg) => {
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} [${process.pid}] ${worktree}: ${msg}\n`); } catch { /* best effort */ }
    extraLog?.(msg);
  };
  let claimed = false;
  try {
    claimed = takeClaim(claim);
  } catch (err) {
    log(`failed: cannot write the claim ${claim}: ${err?.message || err}`);
    return 'failed';
  }
  if (!claimed) return 'busy';
  try {
    const r = await bootstrapWorktreeIndex({ mainCheckout, worktree, log, launch, daemonPid, ...(lockWaitMs ? { lockWaitMs } : {}) });
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
 * Give the linked worktree its own index and wait for it, at most `waitMs` (the MCP
 * server, whose project root is fixed for its whole life and whose client gives it a
 * limited time to answer). The bootstrap runs in its own detached process, as for the
 * ss-* tools: the wait is bounded whatever the copy and the re-key cost, and a client
 * that gives up and kills this process cannot leave the main maintainer stopped.
 * `daemonPid` binds the worktree's maintainer to this process. Never throws.
 *
 * @returns {Promise<boolean>} true when the worktree has an index of its own
 */
export async function ensureWorktreeIndex({ mainCheckout, worktree, env = process.env, waitMs = 20_000, daemonPid = 0 }) {
  const indexed = () => fs.existsSync(path.join(worktree, STATE_DIR_NAME, INDEX_FILE));
  if (indexed()) return true;
  const r = requestWorktreeIndex({ mainCheckout, worktree, env, daemonPid });
  if (!r.started && r.reason !== 'running') return indexed();
  const deadline = Date.now() + waitMs;
  // The child takes its claim a moment after the spawn: give it that moment before a
  // missing claim means "done".
  const graceUntil = Date.now() + 2_000;
  while (!indexed() && Date.now() < deadline) {
    const state = bootstrapState(mainCheckout, worktree);
    if (state === 'failed-recently') break;
    if (state !== 'running' && Date.now() > graceUntil) break;
    await new Promise((res) => setTimeout(res, 100));
  }
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
  const daemonPid = Number(arg('daemon-pid')) || 0;
  const outcome = await runWorktreeBootstrap({ mainCheckout, worktree, daemonPid });
  if (outcome === 'failed') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
