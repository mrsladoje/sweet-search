/**
 * Integration tests for warm-daemon lifecycle bounds (footprint work).
 *
 * Spawns the REAL `node core/cli.js --serve` daemon against a throwaway empty
 * project root (no index load needed — the socket binds before init runs and
 * the idle timer is independent of init), so these stay fast (~5s each). They
 * exercise the actual gracefulShutdown / idle-TTL / activity-tracking paths in
 * search-server.js end-to-end.
 *
 * Byte-identical-result parity and RSS footprint are proven separately on the
 * real eval/corpus/m2crb index (read-semantic parity is locked in
 * read-semantic-daemon-parity.integration.test.js) because they need the heavy
 * corpus + native binary; here we prove the lifecycle state machine itself.
 *
 * The maintainer-FRESHNESS invariant (the detached index maintainer must
 * SURVIVE a search-daemon eviction, and a cold daemon restart must not
 * duplicate it) is automated below with a hermetic long-lived fake maintainer
 * (tests/fixtures/fake-maintainer-longlived.mjs) — no real indexer involved.
 *
 * DAEMON ISOLATION: every daemon here binds a UNIQUE /tmp socket+pidfile and
 * never participates in the shared registry (SWEET_SEARCH_DAEMON_REGISTRY is
 * deleted), so the shared m2crb daemon and the user's working-repo daemons are
 * never enumerated, signalled, or evicted. afterEach SIGKILLs any survivor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../../core/cli.js');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FAKE_MAINTAINER = join(REPO_ROOT, 'tests', 'fixtures', 'fake-maintainer-longlived.mjs');

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

describe('idle-TTL eviction — /read-semantic resets the timer', () => {
  it('a /read-semantic resets the timer (mirrors /search) yet idles out once traffic stops', async () => {
    // /read-semantic sets lastActivityMs at the top of its branch exactly like
    // /search, so driving it past 2× the TTL must keep the daemon warm; once it
    // stops, the daemon idles out. (Lock for search-server.js:573.)
    spawnDaemon({ SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '1500', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '200' });
    expect(await waitForUp()).toBe(true);

    const driveUntil = Date.now() + 3000; // > 2× TTL
    while (Date.now() < driveUntil) {
      // A 503 "starting"/"failed" still resets the clock — lastActivityMs is set
      // before the readiness check, just like the /search branch.
      await httpGet('/read-semantic?path=a.js&q=anything&projectRoot=' + encodeURIComponent(dir), { timeoutMs: 500 });
      await sleep(400);
    }
    // Still alive — /read-semantic traffic kept it warm past the TTL.
    expect(child.exitCode).toBeNull();
    expect((await httpGet('/health', { timeoutMs: 500 }))?.status).toBe(200);

    // Stop driving traffic → it must now idle out (proves /health probing in
    // waitForExit does NOT reset the timer, only the query routes do).
    expect(await waitForExit(4000)).toBe(true);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  }, 20000);

  it('/health-only traffic does NOT reset the timer (regression guard vs /read-semantic)', async () => {
    // Companion to the above: pure /health pinging at the same cadence the
    // /read-semantic test uses must NOT keep the daemon alive.
    spawnDaemon({ SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '1500', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '200' });
    expect(await waitForUp()).toBe(true);

    const probeUntil = Date.now() + 1800;
    while (Date.now() < probeUntil) {
      await httpGet('/health', { timeoutMs: 300 });
      await sleep(400);
    }
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

describe('gracefulShutdown idempotency (shuttingDown guard)', () => {
  it('two back-to-back /stop requests exit exactly once with code 0, no double-unlink throw', async () => {
    spawnDaemon({ SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0' }); // only /stop ends it
    expect(await waitForUp()).toBe(true);

    // Fire two /stop requests concurrently. The shuttingDown guard
    // (search-server.js:377-378) must make the second a no-op: the process
    // tears down once, unlinks pid+socket once, and exits 0 — no second
    // gracefulShutdown body runs, so no double-unlink ENOENT throw escapes.
    const [a, b] = await Promise.all([
      httpGet('/stop', { timeoutMs: 3000 }),
      httpGet('/stop', { timeoutMs: 3000 }),
    ]);
    // At least one /stop got the 200 "Shutting down" ack; the other may race the
    // socket closing (null) or also see 200 — either way no error is thrown.
    const statuses = [a?.status, b?.status];
    expect(statuses.some((s) => s === 200)).toBe(true);

    const exit = await Promise.race([childExited, sleep(5000).then(() => 'timeout')]);
    expect(exit).not.toBe('timeout');
    expect(exit.code).toBe(0);          // exits exactly once, cleanly
    expect(exit.signal).toBeNull();     // not killed — graceful self-exit
    expect(existsSync(socketPath)).toBe(false); // unlinked once, no throw
    expect(existsSync(pidFile)).toBe(false);
  }, 20000);

  it('a /stop that races the idle-TTL still exits once with code 0', async () => {
    // /stop and an about-to-fire idle-TTL both call the shared gracefulShutdown;
    // the guard ensures only one wins. Short TTL so they genuinely race.
    spawnDaemon({ SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '800', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '150' });
    expect(await waitForUp()).toBe(true);

    // Let the idle window approach, then send /stop right around the TTL edge.
    await sleep(700);
    await httpGet('/stop', { timeoutMs: 3000 });

    const exit = await Promise.race([childExited, sleep(5000).then(() => 'timeout')]);
    expect(exit).not.toBe('timeout');
    expect(exit.code).toBe(0);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  }, 20000);
});

// ---------------------------------------------------------------------------
// FRESHNESS INVARIANT (T6): the detached index maintainer survives a search
// daemon eviction, and a cold daemon restart does not duplicate it.
//
// The maintainer is spawned detached + unref'd by launchMaintainer
// (maintainer-launcher.mjs:121-130) from the SAME launcher the search daemon
// calls at startup, so killing/idling the search daemon must NOT take the
// maintainer with it. We use a hermetic long-lived fake maintainer; the real
// indexer is never touched, and we only READ the maintainer's pid/lock.
// ---------------------------------------------------------------------------
describe('freshness invariant — maintainer survives daemon eviction', () => {
  let stateDir;
  let maintainerMarker;
  let maintainerPids; // track for cleanup

  const lockPath = () => join(stateDir, 'index-maintainer.lock');

  function pidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }

  /** Spawn a daemon WITH the maintainer enabled, pointed at the fake maintainer. */
  function spawnDaemonWithMaintainer(extraEnv = {}) {
    return spawnDaemon({
      SWEET_SEARCH_RECONCILE_V2: '',                 // force default-ON
      SWEET_SEARCH_MAINTAINER_ENTRY: FAKE_MAINTAINER,
      SWEET_SEARCH_STATE_DIR: stateDir,
      FAKE_MAINTAINER_MARKER: maintainerMarker,
      ...extraEnv,
    });
  }

  /** Wait until the fake maintainer has written its lock; return its pid. */
  async function waitForMaintainerPid(deadlineMs = 12000) {
    const end = Date.now() + deadlineMs;
    while (Date.now() < end) {
      try {
        const { pid } = JSON.parse(readFileSync(lockPath(), 'utf-8'));
        if (Number.isInteger(pid) && pidAlive(pid)) return pid;
      } catch { /* not written yet */ }
      await sleep(150);
    }
    return null;
  }

  function markerCount() {
    try { return readFileSync(maintainerMarker, 'utf-8').split('\n').filter(Boolean).length; }
    catch { return 0; }
  }

  /** Wait until the marker has exactly `n` lines (or timeout); returns the count. */
  async function waitForMarkerCount(n, deadlineMs = 6000) {
    const end = Date.now() + deadlineMs;
    let c = markerCount();
    while (c < n && Date.now() < end) {
      await sleep(150);
      c = markerCount();
    }
    return c;
  }

  beforeEach(() => {
    // dir/socketPath/pidFile already set by the outer beforeEach.
    stateDir = join(dir, '.sweet-search');
    maintainerMarker = join(dir, 'maintainer-marker.log');
    mkdirSync(stateDir, { recursive: true }); // launcher requires the state dir to exist
    maintainerPids = new Set();
  });

  afterEach(async () => {
    // Kill any fake maintainer we spawned (it is detached and will otherwise
    // outlive the test by design).
    for (const pid of maintainerPids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
  });

  it('maintainer outlives an idle-evicted daemon and the lock stays intact', async () => {
    // TTL is long enough to confirm the maintainer launched BEFORE we let the
    // daemon idle-evict — otherwise under heavy CPU contention the daemon could
    // self-stop before its detached maintainer finishes starting. We assert the
    // eviction explicitly via waitForExit afterwards, so a generous TTL does not
    // weaken the test.
    spawnDaemonWithMaintainer({
      SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '4000',
      SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '250',
    });
    expect(await waitForUp()).toBe(true);

    const maintPid = await waitForMaintainerPid();
    expect(maintPid).toBeTruthy();
    maintainerPids.add(maintPid);
    expect(await waitForMarkerCount(1)).toBe(1); // launched exactly once

    // Let the search daemon idle-evict (no query traffic keeps it alive).
    expect(await waitForExit(8000)).toBe(true);
    expect(existsSync(socketPath)).toBe(false); // daemon gone

    // The detached maintainer is STILL alive and its lock is intact.
    expect(pidAlive(maintPid)).toBe(true);
    expect(existsSync(lockPath())).toBe(true);
    const { pid: lockedPid } = JSON.parse(readFileSync(lockPath(), 'utf-8'));
    expect(lockedPid).toBe(maintPid);
  }, 25000);

  it('maintainer survives a /stop and a cold daemon restart does not duplicate it', async () => {
    spawnDaemonWithMaintainer({ SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0' }); // only /stop ends it
    expect(await waitForUp()).toBe(true);

    const maintPid = await waitForMaintainerPid();
    expect(maintPid).toBeTruthy();
    maintainerPids.add(maintPid);
    expect(await waitForMarkerCount(1)).toBe(1);

    // Tear the search daemon down.
    await httpGet('/stop', { timeoutMs: 3000 });
    expect(await waitForExit(5000)).toBe(true);
    // Maintainer survived the teardown.
    expect(pidAlive(maintPid)).toBe(true);

    // Cold-restart the search daemon. Its launchMaintainer must see the LIVE
    // lock and skip spawning — the marker count stays at 1 (no duplicate).
    spawnDaemonWithMaintainer({ SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0' });
    expect(await waitForUp()).toBe(true);
    // Give the restarted daemon's launcher a beat to (not) spawn a duplicate.
    await sleep(1200);
    expect(markerCount()).toBe(1);
    expect(pidAlive(maintPid)).toBe(true);

    // The still-live original maintainer is the one the lock points at.
    const { pid: lockedPid } = JSON.parse(readFileSync(lockPath(), 'utf-8'));
    expect(lockedPid).toBe(maintPid);
  }, 30000);

  it('brings the maintainer back when it stops while this daemon keeps serving', async () => {
    // THE BUG THIS PINS. On hosts of 24 GiB or less the maintainer stops itself
    // after a long idle stretch, and every `launchMaintainer` call site runs at
    // daemon STARTUP — so with the daemon still up, nothing ever started it
    // again. Editing a file after that left the index frozen: zero hits from
    // search and from grep, and no error logged anywhere.
    //
    // The daemon's own idle-TTL is off here, so the ONLY thing that can bring
    // the maintainer back is supervision driven by query traffic.
    spawnDaemonWithMaintainer({
      SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0',
      SWEET_SEARCH_MAINTAINER_SUPERVISION_INTERVAL_MS: '250',
    });
    expect(await waitForUp()).toBe(true);

    const firstPid = await waitForMaintainerPid();
    expect(firstPid).toBeTruthy();
    maintainerPids.add(firstPid);
    expect(await waitForMarkerCount(1)).toBe(1);

    // Stand in for the idle-TTL exit. SIGKILL is the HARSHER case: it leaves the
    // lock behind naming a dead pid, where the real idle exit releases it.
    process.kill(firstPid, 'SIGKILL');
    await sleep(300);
    expect(pidAlive(firstPid)).toBe(false);

    // Querying is what a developer does after coming back to the project, and
    // it is the moment staleness would start being served. Several queries, not
    // one: supervision is driven by responses, so a developer who issues a
    // single query and walks away is not the case worth pinning, and a lone
    // query can also land inside the spawn-claim window left by startup.
    let markers = 1;
    for (let i = 0; i < 12 && markers < 2; i++) {
      const r = await httpGet('/search?q=anything', { timeoutMs: 3000 });
      expect(r).toBeTruthy(); // 200 or 503 both count: the route ran
      await sleep(500);
      markers = markerCount();
    }

    expect(await waitForMarkerCount(2)).toBe(2);
    const secondPid = await waitForMaintainerPid();
    expect(secondPid).toBeTruthy();
    maintainerPids.add(secondPid);
    expect(secondPid).not.toBe(firstPid);
    expect(pidAlive(secondPid)).toBe(true);
  }, 40000);

  it('does not resurrect a maintainer for a repo nobody is querying', async () => {
    // The mirror image of the test above, and the reason supervision is keyed on
    // query traffic rather than on the maintainer simply being absent. A health
    // probe is not use of the repository; if it counted, a monitoring check
    // would keep a model-loaded maintainer resident on a laptop indefinitely and
    // undo the whole point of the idle-TTL.
    spawnDaemonWithMaintainer({
      SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0',
      SWEET_SEARCH_MAINTAINER_SUPERVISION_INTERVAL_MS: '250',
    });
    expect(await waitForUp()).toBe(true);

    const firstPid = await waitForMaintainerPid();
    maintainerPids.add(firstPid);
    expect(await waitForMarkerCount(1)).toBe(1);

    process.kill(firstPid, 'SIGKILL');
    await sleep(300);

    // Health probes only — no queries. Long enough to outlast the spawn claim,
    // so a passing result means supervision declined, not that it was blocked.
    for (let i = 0; i < 16; i++) {
      await httpGet('/health', { timeoutMs: 1000 });
      await sleep(500);
    }
    expect(markerCount()).toBe(1);
  }, 40000);
});

// ---------------------------------------------------------------------------
// STATIC GUARD (T10): the search-server teardown/cap paths must never import or
// signal the maintainer, and only daemon-registry.js may import the registry.
// Read-only source/import scan — complements the runtime invariant in T6.
// ---------------------------------------------------------------------------
describe('static guard — shutdown/cap never touch the maintainer', () => {
  const SERVER_SRC = join(REPO_ROOT, 'core', 'search', 'search-server.js');
  const REGISTRY_SRC = join(REPO_ROOT, 'core', 'search', 'daemon-registry.js');

  it('search-server.js never kills/signals the maintainer in a teardown/cap path', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    // gracefulShutdown closes the servers, the searcher, unlinks pid/socket, and
    // (only when capEnabled) removes the registry self-entry — it must NOT reach
    // into the maintainer. Assert the shutdown/cap helpers carry no maintainer
    // kill/launch.
    const shutdownStart = src.indexOf('const gracefulShutdown');
    const shutdownEnd = src.indexOf('const handleRequest');
    expect(shutdownStart).toBeGreaterThan(-1);
    expect(shutdownEnd).toBeGreaterThan(shutdownStart);
    const teardownAndCap = src.slice(shutdownStart, shutdownEnd);

    // No maintainer references at all in the teardown/cap region.
    expect(teardownAndCap).not.toMatch(/launchMaintainer/);
    expect(teardownAndCap).not.toMatch(/maintainer/i);
    // And no process-killing of any external pid from teardown/cap.
    expect(teardownAndCap).not.toMatch(/process\.kill\s*\(/);
    expect(teardownAndCap).not.toMatch(/index-maintainer/);
  });

  it('only daemon-registry.js is imported for registry ops; the maintainer is never enumerated', () => {
    const src = readFileSync(SERVER_SRC, 'utf-8');
    // Registry helpers come exclusively from ./daemon-registry.js.
    expect(src).toMatch(/from\s*['"]\.\/daemon-registry\.js['"]/);
    // The registry module itself documents + enforces that the maintainer never
    // registers; assert it imports nothing from the indexing context.
    const regSrc = readFileSync(REGISTRY_SRC, 'utf-8');
    expect(regSrc).not.toMatch(/from\s*['"][^'"]*\/indexing\//);
    expect(regSrc).not.toMatch(/maintainer-launcher/);
  });
});
