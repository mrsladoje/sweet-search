#!/usr/bin/env node
/**
 * Claude Code SessionStart hook: detached daemon prewarm.
 *
 * Spawns the sweet-search search server in a fully-detached child so this
 * hook exits immediately and the daemon loads its models + indexes in the
 * background while the user reads Claude's first response. By the time the
 * user issues their first `sweet-search <query>`, the daemon is already up
 * and the query hits the warm path (~80ms instead of ~2.5s cold start).
 *
 * Safety properties:
 *   - Socket-probed liveness: PID-alive alone is not enough, because a
 *     daemon stuck mid-init has a live PID but an unresponsive socket.
 *     We only skip spawning when the socket actually accepts a connection.
 *   - Concurrent SessionStart lock: two Claude Code windows opening at the
 *     same time both fire this hook; a tmp lockfile ensures only one spawns.
 *   - Env overrides (SWEET_SEARCH_*_PATH / SWEET_SEARCH_SERVER_ENTRY) make
 *     the hook testable against fake fixtures.
 *
 * Always exits 0 and fast — a failed prewarm must not block Claude Code
 * session start.
 */

import { spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  openSync,
  writeSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchMaintainer } from '../indexing/maintainer-launcher.mjs';
import { projectSocketPath, projectPidFile } from './server-identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_ENTRY = process.env.SWEET_SEARCH_SERVER_ENTRY || join(__dirname, '..', 'start-server.js');
// Per-project socket/pidfile (C3) — honors SWEET_SEARCH_SOCKET_PATH /
// SWEET_SEARCH_PID_FILE overrides, otherwise derives from the canonical root.
const SOCKET_PATH = projectSocketPath();
const PID_FILE = projectPidFile();
const LOCK_PATH = process.env.SWEET_SEARCH_PREWARM_LOCK || '/tmp/sweet-search-prewarm.lock';
const SOCKET_PROBE_TIMEOUT_MS = Number(process.env.SWEET_SEARCH_PREWARM_PROBE_MS ?? 300);

const verbose = !!process.env.SWEET_SEARCH_PREWARM_VERBOSE;
const log = (msg) => {
  if (verbose) process.stderr.write(`[sweet-search prewarm] ${msg}\n`);
};

function pageCacheSweepEnabled() {
  const v = String(process.env.SWEET_SEARCH_PREWARM_PAGE_CACHE || '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

function readAndDiscard(filePath, deadlineMs) {
  if (!filePath || Date.now() >= deadlineMs || !existsSync(filePath)) return false;
  try {
    readFileSync(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pageCacheSweep() {
  const rawBudgetMs = Number(process.env.SWEET_SEARCH_PREWARM_PAGE_CACHE_MS || 3500);
  const budgetMs = Number.isFinite(rawBudgetMs) ? Math.max(250, rawBudgetMs) : 3500;
  const deadlineMs = Date.now() + budgetMs;
  let warmed = 0;
  try {
    const { DB_PATHS, LATE_INTERACTION_CONFIG } = await import('../infrastructure/config/index.js');
    const files = [
      DB_PATHS.codeGraph,
      DB_PATHS.lateInteraction,
      DB_PATHS.sparseGramIndex,
    ];

    const segmentDir = DB_PATHS.lateInteraction ? `${DB_PATHS.lateInteraction}.segments` : null;
    if (segmentDir && existsSync(segmentDir)) {
      try {
        for (const name of readdirSync(segmentDir)) {
          if (name.endsWith('.bin')) files.push(join(segmentDir, name));
        }
      } catch {
        /* best-effort page-cache prewarm */
      }
    }

    const modelConfig = LATE_INTERACTION_CONFIG.activeModel;
    if (modelConfig?.hfId) {
      try {
        const { getModelCacheDir } = await import('../infrastructure/model-fetcher.js');
        const modelDir = getModelCacheDir(modelConfig.hfId);
        files.push(join(modelDir, modelConfig.onnxFile));
        files.push(join(modelDir, 'tokenizer.json'));
      } catch {
        /* model cache unavailable; do not fetch or load sessions here */
      }
    }

    for (const filePath of files) {
      if (readAndDiscard(filePath, deadlineMs)) warmed++;
    }
    log(`page-cache sweep warmed ${warmed} file(s)`);
  } catch (err) {
    log(`page-cache sweep non-fatal: ${err?.message || err}`);
  }
}

function spawnPageCacheSweep() {
  if (!pageCacheSweepEnabled()) return;
  if (process.env.SWEET_SEARCH_PAGE_CACHE_SWEEP === '1') return;
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
      env: {
        ...process.env,
        SWEET_SEARCH_PAGE_CACHE_SWEEP: '1',
      },
    });
    child.unref();
    log(`page-cache sweep spawned (pid ${child.pid}, detached)`);
  } catch (err) {
    log(`page-cache sweep spawn non-fatal: ${err?.message || err}`);
  }
}

/** Does a process with this PID exist right now? Handles EPERM (alien user) as "alive". */
function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Try to connect to the unix socket. Resolves true if connect succeeds quickly. */
function socketResponsive(socketPath, timeoutMs) {
  return new Promise((resolve) => {
    if (!existsSync(socketPath)) {
      resolve(false);
      return;
    }
    const c = connect(socketPath);
    const timer = setTimeout(() => {
      try { c.destroy(); } catch { /* ignore */ }
      resolve(false);
    }, timeoutMs);
    c.once('connect', () => {
      clearTimeout(timer);
      try { c.destroy(); } catch { /* ignore */ }
      resolve(true);
    });
    c.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Daemon counts as healthy only if its PID is alive AND its socket accepts a connection. */
async function daemonHealthy() {
  let pid = null;
  if (existsSync(PID_FILE)) {
    try { pid = Number(readFileSync(PID_FILE, 'utf-8').trim()); }
    catch { pid = null; }
  }
  if (!pidAlive(pid)) return false;
  return socketResponsive(SOCKET_PATH, SOCKET_PROBE_TIMEOUT_MS);
}

/**
 * Acquire an exclusive lock so only one concurrent SessionStart spawns a
 * daemon. Returns the file descriptor on success, null on failure. Handles
 * stale locks whose holder is dead.
 */
function acquireLock() {
  try {
    const fd = openSync(LOCK_PATH, 'wx');
    writeSync(fd, String(process.pid));
    return fd;
  } catch (err) {
    if (err.code !== 'EEXIST') return null;
    // Another process holds the lock. Read it to see if they're still alive.
    let holderRaw = '';
    try { holderRaw = readFileSync(LOCK_PATH, 'utf-8').trim(); } catch { /* unreadable */ }
    // Empty or unparseable: another process is mid-write between its
    // openSync('wx') success and its writeSync(pid) — do NOT try to steal
    // the lock. Let them finish; we back off.
    if (!holderRaw) return null;
    const holder = Number(holderRaw);
    if (!Number.isFinite(holder)) return null;
    if (pidAlive(holder) && holder !== process.pid) {
      return null; // legitimate live holder
    }
    // Verifiably dead holder — unlink + retry once.
    try { unlinkSync(LOCK_PATH); } catch { /* ignore */ }
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      writeSync(fd, String(process.pid));
      return fd;
    } catch {
      return null;
    }
  }
}

function releaseLock(fd) {
  try { closeSync(fd); } catch { /* ignore */ }
  try { unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

/**
 * Spawn the detached search server unless it is already responsive or another
 * concurrent prewarm hook is mid-spawn. Returns (does not exit) so the
 * maintainer launch below always runs.
 */
async function prewarmServer() {
  if (await daemonHealthy()) {
    log('daemon already responsive on socket');
    return;
  }
  if (!existsSync(SERVER_ENTRY)) {
    log(`server entry missing: ${SERVER_ENTRY}`);
    return;
  }
  const lockFd = acquireLock();
  if (lockFd === null) {
    log('another prewarm hook already holds the lock; skipping');
    return;
  }
  try {
    // Fully detach: new session, no stdio, parent can exit while daemon loads.
    const child = spawn(process.execPath, [SERVER_ENTRY, '--serve'], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
      env: process.env,
    });
    child.unref();
    log(`daemon spawned (pid ${child.pid}, detached)`);
  } finally {
    releaseLock(lockFd);
  }
}

if (process.env.SWEET_SEARCH_PAGE_CACHE_SWEEP === '1') {
  try {
    await pageCacheSweep();
  } catch (err) {
    log(`page-cache sweep non-fatal: ${err?.message || err}`);
  }
  process.exit(0);
}

// The search server and the index maintainer are independent: a stuck/already
// running server must not stop the maintainer from starting, and vice versa.
// Each is isolated in its own try so one failing never blocks the other.
try {
  spawnPageCacheSweep();
} catch (err) {
  log(`page-cache sweep spawn non-fatal: ${err?.message || err}`);
}

try {
  await prewarmServer();
} catch (err) {
  log(`server prewarm non-fatal: ${err?.message || err}`);
}

try {
  // Delegate to the shared launcher (core/indexing/maintainer-launcher.mjs).
  // The hook is a best-effort convenience layer; the durable guarantee lives in
  // the warm search-server startup, which calls this same launcher. Pass our
  // verbose-gated logger so output keeps the prewarm prefix + stays stderr-only.
  launchMaintainer({ log });
} catch (err) {
  log(`maintainer prewarm non-fatal: ${err?.message || err}`);
}

process.exit(0);
