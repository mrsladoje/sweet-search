/**
 * Integration test for the SWEET_SEARCH_MAX_DAEMONS resident-daemon LRU cap
 * (enforceDaemonCap at search-server.js:407 → sendStopToSocket peer eviction).
 *
 * Only the registry pure-fns are unit-tested today (daemon-registry.test.js).
 * This drives the cap end-to-end with TWO REAL daemons sharing a THROWAWAY
 * registry, proving:
 *   - with MAX_DAEMONS=1, the surplus daemon is /stopped by a peer,
 *   - the freshest-by-construction newcomer survives,
 *   - the registry file converges to exactly one live entry.
 *
 * It also DOCUMENTS the active-repo-eviction race in flag (E) as the expected
 * default-OFF LRU semantics: a newly-STARTED peer seeds its lastActivityMs from
 * startedAt and is therefore strictly more-recently-active than any existing
 * peer, so it evicts the older peer on startup — even if that older peer was
 * just queried, because the registry only reflects activity as of each
 * daemon's coarse registryTouchSelf tick. The newcomer (not the older,
 * recently-active peer) is the one kept within that one refresh interval.
 *
 * DAEMON ISOLATION: both daemons bind UNIQUE /tmp sockets+pidfiles and share a
 * THROWAWAY SWEET_SEARCH_DAEMON_REGISTRY under /tmp, so the shared m2crb daemon
 * and the user's working-repo daemons are never enumerated or signalled. /stop
 * only ever reaches the agent-owned isolated daemons; afterEach SIGKILLs any
 * survivor. The cap is default-OFF in production.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  mkdtempSync, rmSync, existsSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../../core/cli.js');

let root;
let registryPath;
let daemons; // [{ child, exited, socketPath, pidFile, dir }]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(socketPath, path, { timeoutMs = 1000 } = {}) {
  return new Promise((res) => {
    const req = http.request({ socketPath, path, method: 'GET' }, (r) => {
      let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: b }));
    });
    req.on('error', () => res(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); res(null); });
    req.end();
  });
}

async function waitForUp(socketPath, deadlineMs = 15000) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const r = await httpGet(socketPath, '/health', { timeoutMs: 500 });
    if (r && r.status === 200) return true;
    await sleep(150);
  }
  return false;
}

function startDaemon(extraEnv = {}) {
  const dir = mkdtempSync(join(root, 'd-'));
  const socketPath = join(dir, 'd.sock');
  const pidFile = join(dir, 'd.pid');
  const env = {
    ...process.env,
    SWEET_SEARCH_SOCKET_PATH: socketPath,
    SWEET_SEARCH_PID_FILE: pidFile,
    SWEET_SEARCH_PROJECT_ROOT: dir,
    SWEET_SEARCH_RECONCILE_V2: '0',                 // no maintainer
    SWEET_SEARCH_TCP_PORT: '',                       // unix socket only
    SWEET_SEARCH_MAX_DAEMONS: '1',                   // the cap under test
    SWEET_SEARCH_DAEMON_REGISTRY: registryPath,      // THROWAWAY shared registry
    SWEET_SEARCH_DAEMON_REGISTRY_REFRESH_MS: '500',  // fast re-enforcement
    SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0',            // isolate cap from idle-TTL
    ...extraEnv,
  };
  const child = spawn(process.execPath, [CLI, '--serve'], { env, cwd: dir, stdio: 'ignore' });
  const rec = {
    child, socketPath, pidFile, dir,
    exited: new Promise((r) => child.once('exit', (code, signal) => r({ code, signal }))),
  };
  daemons.push(rec);
  return rec;
}

async function waitForExit(rec, deadlineMs = 8000) {
  const r = await Promise.race([rec.exited, sleep(deadlineMs).then(() => 'timeout')]);
  return r !== 'timeout';
}

function liveRegistryEntries() {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf-8'));
    return parsed?.daemons && typeof parsed.daemons === 'object' ? Object.values(parsed.daemons) : [];
  } catch { return []; }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ss-cap-'));
  registryPath = join(root, 'daemons.json');
  daemons = [];
});

afterEach(async () => {
  for (const d of daemons) {
    if (d.child && d.child.exitCode === null && d.child.signalCode === null) {
      try { d.child.kill('SIGKILL'); } catch { /* ignore */ }
      await Promise.race([d.exited, sleep(1500)]);
    }
  }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('SWEET_SEARCH_MAX_DAEMONS LRU cap (end-to-end)', () => {
  it('a newcomer evicts the surplus older peer; registry converges to exactly 1 live entry', async () => {
    // Start A alone — it registers itself; under cap=1 with no peer, it stays.
    const a = startDaemon();
    expect(await waitForUp(a.socketPath)).toBe(true);

    // Even after A drives some real /search traffic (recently-active), the
    // newcomer B will still evict it: B's lastActivityMs is seeded from
    // startedAt at registration, which is strictly newer than A's last
    // registryTouchSelf tick. This is the flag-(E) race, asserted as the
    // expected default-OFF behaviour — the newcomer wins, not the active peer.
    const warm = Date.now() + 1000;
    while (Date.now() < warm) {
      await httpGet(a.socketPath, '/search?q=recently-active&k=1', { timeoutMs: 400 });
      await sleep(150);
    }

    // Start B (the newcomer). On registration it enforces the cap: live=2 > 1,
    // and A (older) is the eviction target → B sends /stop to A.
    const b = startDaemon();
    expect(await waitForUp(b.socketPath)).toBe(true);

    // A (the surplus, less-recently-active by registry stamp) is evicted via
    // /stop and tears down cleanly (pid+socket unlinked).
    expect(await waitForExit(a)).toBe(true);
    expect(existsSync(a.socketPath)).toBe(false);
    expect(existsSync(a.pidFile)).toBe(false);

    // B (the newcomer) survives and stays healthy.
    expect(b.child.exitCode).toBeNull();
    expect((await httpGet(b.socketPath, '/health', { timeoutMs: 500 }))?.status).toBe(200);

    // The registry self-prunes the dead peer and converges to exactly one live
    // entry — B's. (B re-enforces + prunes on its coarse refresh tick.)
    const deadline = Date.now() + 4000;
    let live = liveRegistryEntries();
    while (live.length !== 1 && Date.now() < deadline) {
      await httpGet(b.socketPath, '/search?q=tick&k=1', { timeoutMs: 300 });
      await sleep(250);
      live = liveRegistryEntries();
    }
    expect(live).toHaveLength(1);
    expect(live[0].socketPath).toBe(b.socketPath);
  }, 30000);
});
