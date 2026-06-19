/**
 * Integration tests for warm-daemon lifecycle bounds (footprint work).
 *
 * Spawns the REAL `node core/cli.js --serve` daemon against a throwaway empty
 * project root (no index load needed — the socket binds before init runs and
 * the idle timer is independent of init), so these stay fast (~5s each). They
 * exercise the actual gracefulShutdown / idle-TTL / activity-tracking paths in
 * search-server.js end-to-end.
 *
 * Byte-identical-result parity, RSS footprint, and maintainer-freshness across
 * eviction are proven separately on the real eval/corpus/m2crb index (manual
 * verification deliverable) because they need the heavy 295 MB corpus + native
 * binary; here we prove the lifecycle state machine itself.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../../core/cli.js');

let dir;
let socketPath;
let pidFile;
let child;
let childExited;

function spawnDaemon(extraEnv = {}) {
  const env = {
    ...process.env,
    SWEET_SEARCH_SOCKET_PATH: socketPath,
    SWEET_SEARCH_PID_FILE: pidFile,
    SWEET_SEARCH_PROJECT_ROOT: dir,
    SWEET_SEARCH_RECONCILE_V2: '0',     // no maintainer for these hermetic tests
    SWEET_SEARCH_TCP_PORT: '',          // unix socket only
    ...extraEnv,
  };
  // Don't let an inherited explicit socket from the parent shell leak in.
  delete env.SWEET_SEARCH_DAEMON_REGISTRY;
  child = spawn(process.execPath, [CLI, '--serve'], { env, cwd: dir, stdio: 'ignore' });
  childExited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
  return child;
}

function httpGet(path, { timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForUp(deadlineMs = 15000) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const r = await httpGet('/health', { timeoutMs: 500 });
    if (r && r.status === 200) return true;
    await sleep(150);
  }
  return false;
}

async function waitForExit(deadlineMs = 6000) {
  const r = await Promise.race([childExited, sleep(deadlineMs).then(() => 'timeout')]);
  return r !== 'timeout';
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ss-daemon-life-'));
  socketPath = join(dir, 'd.sock');
  pidFile = join(dir, 'd.pid');
  child = null;
});

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    await Promise.race([childExited, sleep(2000)]);
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('idle-TTL eviction', () => {
  it('self-stops after the TTL under /health-only traffic and cleans up pid+socket', async () => {
    spawnDaemon({ SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '2500', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '250' });
    expect(await waitForUp()).toBe(true);

    // Keep probing /health across the whole TTL window — liveness probes must
    // NOT keep the daemon alive.
    const probeUntil = Date.now() + 2200;
    while (Date.now() < probeUntil) {
      await httpGet('/health', { timeoutMs: 300 });
      await sleep(250);
    }

    // Within a bit more than one TTL of the last (non-resetting) /health, the
    // daemon must have self-evicted.
    expect(await waitForExit(4000)).toBe(true);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  }, 20000);

  it('a /search resets the timer (active repo is never evicted) yet idles out once traffic stops', async () => {
    spawnDaemon({ SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '1500', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '200' });
    expect(await waitForUp()).toBe(true);

    // Drive /search for ~3s (> 2× TTL). Even a "starting"/"failed" 503 resets the
    // clock because lastActivityMs is set at the top of the /search branch.
    const driveUntil = Date.now() + 3000;
    while (Date.now() < driveUntil) {
      await httpGet('/search?q=anything&k=1', { timeoutMs: 500 });
      await sleep(400);
    }
    // Still alive — activity kept it warm well past the TTL.
    expect(child.exitCode).toBeNull();
    expect((await httpGet('/health', { timeoutMs: 500 }))?.status).toBe(200);

    // Stop driving traffic — now it must idle out.
    expect(await waitForExit(4000)).toBe(true);
  }, 20000);
});

describe('sendStopToSocket (peer eviction / graceful /stop path)', () => {
  it('stops a running daemon on an explicit socket and unlinks its files', async () => {
    spawnDaemon({ SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0' }); // TTL disabled — only /stop should end it
    expect(await waitForUp()).toBe(true);

    const { sendStopToSocket } = await import('../../core/search/search-server.js');
    const reached = await sendStopToSocket(socketPath);
    expect(reached).toBe(true);

    expect(await waitForExit(5000)).toBe(true);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  }, 20000);
});
