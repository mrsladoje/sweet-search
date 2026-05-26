#!/usr/bin/env node
/**
 * cleanup-stale-processes.mjs
 *
 * Reap orphaned sweet-search index-maintainer daemons and warm search-server
 * processes for THIS project. Companion to the lifecycle fixes in
 * core/indexing/index-maintainer.mjs (single-owner state lock, in-loop
 * displacement self-exit) and core/search/search-server.js (idempotent
 * startServer that no longer steals an active socket).
 *
 * Those fixes prevent NEW accumulation. This script cleans up EXISTING
 * orphans left behind by the old behaviour — historically up to 41 immortal
 * maintainers (~3 GB) and 12 zombie warm servers (~15 GB) per host.
 *
 * Default is dry-run. Pass --execute to actually send SIGTERM.
 *
 * Usage:
 *   node scripts/cleanup-stale-processes.mjs                 # dry-run (default)
 *   node scripts/cleanup-stale-processes.mjs --execute       # actually kill
 *   node scripts/cleanup-stale-processes.mjs --kill-all      # kill the legitimate
 *                                                              owners too (full reset)
 *   node scripts/cleanup-stale-processes.mjs --execute --quiet
 *
 * Safety:
 *   - never kills the running shell or this script itself,
 *   - never touches a process whose cmdline does not include this project root,
 *   - never sends SIGKILL — SIGTERM lets the daemon release its lock and
 *     flush in-flight reconcile state cleanly,
 *   - prints a summary of every action so it's auditable.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const STATE_DIR = join(PROJECT_ROOT, '.sweet-search');
const MAINTAINER_LOCK_FILE = join(STATE_DIR, 'index-maintainer.lock');

// Patterns that identify project processes. Matched against the full
// `ps -axo pid,command` line. Anchored to PROJECT_ROOT so this script can
// never reap another project's sweet-search install on the same host.
const MAINTAINER_CMD_FRAGMENT = `${PROJECT_ROOT}/core/indexing/index-maintainer.mjs`;
const SERVE_CLI_CMD_FRAGMENT = `${PROJECT_ROOT}/core/cli.js --serve`;
const START_SERVER_CMD_FRAGMENT = `${PROJECT_ROOT}/core/start-server.js`;

// -----------------------------------------------------------------------------
// CLI args
// -----------------------------------------------------------------------------
const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const KILL_ALL = argv.includes('--kill-all');
const QUIET = argv.includes('--quiet');

function log(level, msg) {
  if (QUIET && level === 'INFO') return;
  const stream = level === 'ERROR' || level === 'WARN' ? process.stderr : process.stdout;
  stream.write(`[cleanup-stale-processes] [${level}] ${msg}\n`);
}

// -----------------------------------------------------------------------------
// Process enumeration
// -----------------------------------------------------------------------------

/**
 * Return parsed { pid, ppid, command } rows for every process whose command
 * line contains one of the project-scoped fragments.
 */
function enumerateProjectProcesses() {
  let raw;
  try {
    raw = execFileSync('ps', ['-axo', 'pid,ppid,command'], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    log('ERROR', `Failed to enumerate processes via ps: ${err?.message ?? err}`);
    return [];
  }
  const out = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('PID')) continue;
    // pid ppid <rest as command>
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3];

    let role = null;
    if (command.includes(MAINTAINER_CMD_FRAGMENT)) role = 'maintainer';
    else if (command.includes(SERVE_CLI_CMD_FRAGMENT)) role = 'serve';
    else if (command.includes(START_SERVER_CMD_FRAGMENT)) role = 'serve';
    if (!role) continue;

    out.push({ pid, ppid, command, role });
  }
  return out;
}

// -----------------------------------------------------------------------------
// "Legitimate owner" discovery
// -----------------------------------------------------------------------------

function readMaintainerLockOwner() {
  try {
    if (!existsSync(MAINTAINER_LOCK_FILE)) return null;
    const parsed = JSON.parse(readFileSync(MAINTAINER_LOCK_FILE, 'utf-8'));
    if (!Number.isInteger(parsed.pid)) return null;
    // Verify alive — a stale lock pid pointing at a dead process is not a
    // "legitimate owner," it's just garbage to delete.
    try {
      process.kill(parsed.pid, 0);
      return parsed.pid;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Probe /health on the per-project Unix socket to discover the warm server
 * that's actually reachable. The other --serve processes (with their socket
 * fds dangling) are unreachable zombies by definition.
 */
async function discoverLiveServerPid() {
  let projectSocketPath;
  try {
    const mod = await import(`${PROJECT_ROOT}/core/search/server-identity.js`);
    projectSocketPath = mod.projectSocketPath;
  } catch (err) {
    log('WARN', `Could not import server-identity (projectSocketPath): ${err?.message ?? err}`);
    return null;
  }
  const socketPath = projectSocketPath();
  return await new Promise((resolveProbe) => {
    const req = http.request({ socketPath, path: '/health', method: 'GET', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (Number.isInteger(parsed?.pid)) resolveProbe(parsed.pid);
          else resolveProbe(null);
        } catch {
          resolveProbe(null);
        }
      });
    });
    req.on('error', () => resolveProbe(null));
    req.on('timeout', () => { req.destroy(); resolveProbe(null); });
    req.end();
  });
}

// -----------------------------------------------------------------------------
// Decision + execution
// -----------------------------------------------------------------------------

function classify(processes, keepMaintainerPid, keepServerPid) {
  const SELF = process.pid;
  const decisions = [];
  for (const p of processes) {
    if (p.pid === SELF) {
      decisions.push({ ...p, action: 'skip', reason: 'self' });
      continue;
    }
    if (p.role === 'maintainer') {
      if (!KILL_ALL && keepMaintainerPid && p.pid === keepMaintainerPid) {
        decisions.push({ ...p, action: 'keep', reason: 'lockfile-owner' });
      } else {
        decisions.push({ ...p, action: 'terminate', reason: KILL_ALL ? 'kill-all' : (keepMaintainerPid ? 'not-lockfile-owner' : 'no-legitimate-owner') });
      }
    } else if (p.role === 'serve') {
      if (!KILL_ALL && keepServerPid && p.pid === keepServerPid) {
        decisions.push({ ...p, action: 'keep', reason: 'live-/health-pid' });
      } else {
        decisions.push({ ...p, action: 'terminate', reason: KILL_ALL ? 'kill-all' : (keepServerPid ? 'not-/health-pid' : 'no-reachable-server') });
      }
    }
  }
  return decisions;
}

function summarizeBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${bytes} B`;
}

function estimateRssBytes(pid) {
  try {
    const raw = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf-8' });
    const kb = Number(raw.trim());
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

async function main() {
  log('INFO', `Project: ${PROJECT_ROOT}`);
  log('INFO', `Mode: ${EXECUTE ? (KILL_ALL ? 'EXECUTE (kill-all)' : 'EXECUTE') : 'dry-run (pass --execute to actually SIGTERM)'}`);

  const processes = enumerateProjectProcesses();
  if (processes.length === 0) {
    log('INFO', 'No sweet-search processes found for this project. Nothing to do.');
    return;
  }
  log('INFO', `Found ${processes.length} project-scoped process(es).`);

  const keepMaintainerPid = readMaintainerLockOwner();
  const keepServerPid = await discoverLiveServerPid();
  log('INFO', `Legitimate maintainer (from lockfile, alive): ${keepMaintainerPid ?? 'none'}`);
  log('INFO', `Legitimate warm server (from /health probe):  ${keepServerPid ?? 'none reachable'}`);

  const decisions = classify(processes, keepMaintainerPid, keepServerPid);

  // Print plan
  let toTerminate = 0;
  let totalReclaimable = 0;
  for (const d of decisions) {
    const rss = estimateRssBytes(d.pid);
    if (d.action === 'terminate' && rss) totalReclaimable += rss;
    if (d.action === 'terminate') toTerminate++;
    const tag = d.action === 'terminate' ? 'WILL-TERMINATE' : (d.action === 'keep' ? 'KEEP         ' : 'SKIP         ');
    log('INFO', `  [${tag}] pid=${String(d.pid).padStart(6)} role=${d.role.padEnd(10)} rss=${summarizeBytes(rss).padStart(9)} reason=${d.reason}`);
  }
  log('INFO', `Plan: terminate ${toTerminate} / keep ${decisions.filter(d => d.action === 'keep').length} / skip ${decisions.filter(d => d.action === 'skip').length}`);
  log('INFO', `Estimated memory to reclaim: ${summarizeBytes(totalReclaimable)}`);

  if (!EXECUTE) {
    log('INFO', 'Dry-run complete. Re-run with --execute to actually SIGTERM the listed processes.');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const d of decisions) {
    if (d.action !== 'terminate') continue;
    try {
      process.kill(d.pid, 'SIGTERM');
      ok++;
      log('INFO', `SIGTERM pid=${d.pid} ok (role=${d.role})`);
    } catch (err) {
      fail++;
      log('WARN', `SIGTERM pid=${d.pid} failed: ${err?.message ?? err}`);
    }
  }
  log('INFO', `Done: ${ok} signalled, ${fail} failed.`);
  log('INFO', 'Run again in ~5s with --dry-run flags to confirm processes are gone (SIGTERM is graceful — daemons release locks and flush state before exiting).');
}

main().catch((err) => {
  log('ERROR', `Fatal: ${err?.stack ?? err}`);
  process.exit(1);
});
