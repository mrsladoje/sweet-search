// spawn-ledger-reap.mjs — stop the sweet-search daemons/maintainers a rollout started.
//
// Root cause this closes (2026-09-29, hc-queue3): run-pilot's macOS teardown found a run's
// daemon/maintainer only by the rundir files they held OPEN (lsof). A daemon still loading
// its index holds none, and a maintainer spawned after the one-shot pgrep snapshot is never
// looked at. The survivor then outlives its deleted rundir as a detached ppid-1 process
// (cwd core/search, from autoSpawnServer) and blocks every later cell's pre-check.
//
// Fix: run-pilot sets SWEET_SEARCH_SPAWN_LEDGER_DIR once; core records every daemon and
// maintainer pid (parent side at spawn, child side at startup) under a per-project-root
// file (core/infrastructure/spawn-ledger.js). Teardown reads that file and SIGKILLs what it
// lists, re-reading until no new pid appears, so a spawn in flight during teardown is
// caught too. Only pids on the ledger are touched: the owner's own daemons never carry the
// env var, so they are never listed. A pid is killed only when its current command name is
// still a sweet-search/node process (pid-reuse guard) and it was recorded in this pid
// namespace (a jail's namespace-local pid means nothing out here; the jail's pid namespace
// ends those processes itself).
import { spawnSync } from 'node:child_process';
import { readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  SPAWN_LEDGER_ENV, currentPidNamespace, readSpawnLedger, spawnLedgerFile,
} from '../../../core/infrastructure/spawn-ledger.js';

export { SPAWN_LEDGER_ENV, spawnLedgerFile };

const OURS = new Set(['node', 'sweet-search-daemon', 'sweet-search-maintainer']);

/** Current command name of a pid (basename), or null when it is gone. */
export function processComm(pid) {
  const r = spawnSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  return out ? path.basename(out) : null;
}

const sleepAsync = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function killPass(files, seen, killed, { ns, kill, comm }) {
  let fresh = 0;
  for (const file of files) {
    for (const e of readSpawnLedger(file)) {
      if (seen.has(e.pid)) continue;
      seen.add(e.pid);
      fresh++;
      if ((e.ns ?? null) !== ns) continue;
      const c = comm(e.pid);
      if (!c || !OURS.has(c)) continue;
      try { kill(e.pid, 'SIGKILL'); killed.push({ pid: e.pid, role: e.role, comm: c }); } catch { /* gone */ }
    }
  }
  return fresh;
}

/**
 * SIGKILL every live process listed in the given ledger files. Re-reads until a pass adds
 * no new pid (bounded by `rounds`). Returns [{pid, role, comm}] of what it killed.
 */
export async function reapSpawnLedger(files, {
  rounds = 5, settleMs = 300, kill = process.kill.bind(process), comm = processComm, sleep = sleepAsync,
} = {}) {
  const list = [].concat(files).filter(Boolean);
  const seen = new Set(); const killed = [];
  const ctx = { ns: currentPidNamespace(), kill, comm };
  for (let i = 0; i < rounds; i++) {
    const fresh = killPass(list, seen, killed, ctx);
    if (i > 0 && fresh === 0) break;
    await sleep(settleMs);
  }
  return killed;
}

/** Synchronous single-pass variant for process-exit handlers. */
export function reapSpawnLedgerSync(files, { kill = process.kill.bind(process), comm = processComm, rounds = 2, settleMs = 200 } = {}) {
  const list = [].concat(files).filter(Boolean);
  const seen = new Set(); const killed = [];
  const ctx = { ns: currentPidNamespace(), kill, comm };
  for (let i = 0; i < rounds; i++) {
    const fresh = killPass(list, seen, killed, ctx);
    if (i > 0 && fresh === 0) break;
    if (i < rounds - 1) sleepSync(settleMs);
  }
  return killed;
}

/** Every ledger file in a ledger dir (all rundirs of one pilot). */
export function allLedgerFiles(dir) {
  try { return readdirSync(dir).filter((f) => f.endsWith('.pids')).map((f) => path.join(dir, f)); }
  catch { return []; }
}

/** End-of-pilot sweep: reap everything this pilot ever recorded, then drop the ledger dir. */
export async function reapLedgerDir(dir, opts = {}) {
  const killed = await reapSpawnLedger(allLedgerFiles(dir), opts);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  return killed;
}

// ─── second net: match by open files (macOS has no /proc/<pid>/environ) ────────────────────
// A daemon or maintainer holds its project's .sweet-search/* files open, and its process title
// hides the root. `lsof -Fn` prints one `n<path>` line per open file.

/** Canonical form of a root (realpath when it exists), without a trailing separator. */
function canonicalDir(d) {
  const r = path.resolve(String(d));
  try { return realpathSync(r); } catch { return r; }
}

/**
 * The first root in `roots` that holds an open file named in `lsofFieldOutput` (`lsof -Fn`),
 * or null. A path matches a root only at a path-component boundary, so `/x/r1` never owns
 * `/x/r10/...`. Pure: no process is touched.
 */
export function rootOwningOpenFiles(lsofFieldOutput, roots) {
  const canon = [].concat(roots).filter(Boolean).map(canonicalDir);
  for (const line of String(lsofFieldOutput || '').split('\n')) {
    if (!line.startsWith('n/')) continue;
    const p = line.slice(1);
    for (const r of canon) if (p === r || p.startsWith(`${r}${path.sep}`)) return r;
  }
  return null;
}

/**
 * SIGKILL every sweet-search daemon/maintainer that holds an open file under one of `roots`.
 * Processes of every other root are left alone. Returns [{pid, comm, root}] of what it killed.
 */
export function reapByOpenFiles(roots, { kill = process.kill.bind(process), list = listOurDaemons, openFiles = lsofOpenFiles } = {}) {
  const killed = [];
  for (const { pid, comm } of list()) {
    const root = rootOwningOpenFiles(openFiles(pid), roots);
    if (!root) continue;
    try { kill(pid, 'SIGKILL'); killed.push({ pid, comm, root }); } catch { /* gone */ }
  }
  return killed;
}

/** Live sweet-search-daemon / sweet-search-maintainer processes as [{pid, comm}]. */
export function listOurDaemons() {
  const out = [];
  for (const comm of ['sweet-search-daemon', 'sweet-search-maintainer']) {
    const r = spawnSync('pgrep', ['-x', comm], { encoding: 'utf8' });
    for (const p of (r.stdout || '').split(/\s+/)) if (/^\d+$/.test(p)) out.push({ pid: +p, comm });
  }
  return out;
}

function lsofOpenFiles(pid) {
  return spawnSync('lsof', ['-p', String(pid), '-Fn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '';
}

/**
 * Full teardown for a set of project roots: the spawn ledger first (catches a daemon that has
 * not opened its index yet, and a process whose root dir is already deleted), then the
 * open-file net (catches a process started without the ledger env). Returns everything killed.
 */
export async function reapRoots({ ledgerDir, roots }, opts = {}) {
  const fromLedger = ledgerDir ? await reapSpawnLedger(allLedgerFiles(ledgerDir), opts) : [];
  const fromFiles = reapByOpenFiles(roots, opts);
  return [...fromLedger, ...fromFiles];
}

/** Synchronous variant of reapRoots for process-exit handlers. */
export function reapRootsSync({ ledgerDir, roots }, opts = {}) {
  const fromLedger = ledgerDir ? reapSpawnLedgerSync(allLedgerFiles(ledgerDir), opts) : [];
  return [...fromLedger, ...reapByOpenFiles(roots, opts)];
}
