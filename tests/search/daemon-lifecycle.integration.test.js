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

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../../core/cli.js');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FAKE_MAINTAINER = join(REPO_ROOT, 'tests', 'fixtures', 'fake-maintainer-longlived.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One context per test: its own temp project, socket, pid file and daemon, so tests that wait on
 * TTLs can run side by side (`describe.concurrent`). The fake maintainer is copied into the temp
 * dir: run from the repository path it was killed in about one run in three by something outside
 * the test (the same file elsewhere survived 16 of 16 runs).
 */
function newCtx() {
  const dir = mkdtempSync(join(tmpdir(), 'ss-daemon-life-'));
  const ctx = {
    dir,
    socketPath: join(dir, 'd.sock'),
    pidFile: join(dir, 'd.pid'),
    child: null,
    childExited: null,
    maintainerPids: new Set(),
  };
  return ctx;
}

async function disposeCtx(ctx) {
  for (const pid of ctx.maintainerPids) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  const { child, childExited } = ctx;
  if (child && child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    await Promise.race([childExited, sleep(2000)]);
  }
  try { rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Run `fn(ctx)` with a fresh context and always dispose it (kills any survivor). */
function withCtx(fn) {
  return async () => {
    const ctx = newCtx();
    try { await fn(ctx); } finally { await disposeCtx(ctx); }
  };
}

function spawnDaemon(ctx, extraEnv = {}) {
  const env = {
    ...process.env,
    SWEET_SEARCH_SOCKET_PATH: ctx.socketPath,
    SWEET_SEARCH_PID_FILE: ctx.pidFile,
    SWEET_SEARCH_PROJECT_ROOT: ctx.dir,
    SWEET_SEARCH_RUNTIME_DIR: join(ctx.dir, 'runtime'),
    SWEET_SEARCH_RECONCILE_V2: '0',     // no maintainer for these hermetic tests
    SWEET_SEARCH_TCP_PORT: '',          // unix socket only
    ...extraEnv,
  };
  // Don't let an inherited explicit socket from the parent shell leak in.
  delete env.SWEET_SEARCH_DAEMON_REGISTRY;
  const child = spawn(process.execPath, [CLI, '--serve'], { env, cwd: ctx.dir, stdio: 'ignore' });
  ctx.child = child;
  ctx.childExited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
  return child;
}

function httpGet(ctx, path, { timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath: ctx.socketPath, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function waitForUp(ctx, deadlineMs = 15000) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const r = await httpGet(ctx, '/health', { timeoutMs: 500 });
    if (r && r.status === 200) return true;
    await sleep(100);
  }
  return false;
}

async function waitForExit(ctx, deadlineMs = 6000) {
  const r = await Promise.race([ctx.childExited, sleep(deadlineMs).then(() => 'timeout')]);
  return r !== 'timeout';
}

// The idle-TTL tests run one after another: their TTLs are short (1.5 s) and a daemon starved
// by sibling daemons could time out in the middle of the traffic the test drives.
describe('idle-TTL eviction', () => {
  it('self-stops after the TTL under /health-only traffic and cleans up pid+socket', withCtx(async (ctx) => {
    spawnDaemon(ctx, { SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '2500', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '250' });
    expect(await waitForUp(ctx)).toBe(true);

    // Keep probing /health across the whole TTL window — liveness probes must
    // NOT keep the daemon alive.
    const probeUntil = Date.now() + 2200;
    while (Date.now() < probeUntil) {
      await httpGet(ctx, '/health', { timeoutMs: 300 });
      await sleep(250);
    }

    // Within a bit more than one TTL of the last (non-resetting) /health, the
    // daemon must have self-evicted.
    expect(await waitForExit(ctx, 4000)).toBe(true);
    expect(existsSync(ctx.socketPath)).toBe(false);
    expect(existsSync(ctx.pidFile)).toBe(false);
  }), 20000);

  it('a /search resets the timer (active repo is never evicted) yet idles out once traffic stops', withCtx(async (ctx) => {
    spawnDaemon(ctx, { SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '1500', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '200' });
    expect(await waitForUp(ctx)).toBe(true);

    // Drive /search for ~2.4s (> 1.5x TTL). Even a "starting"/"failed" 503 resets the
    // clock because lastActivityMs is set at the top of the /search branch.
    const driveUntil = Date.now() + 2400;
    while (Date.now() < driveUntil) {
      await httpGet(ctx, '/search?q=anything&k=1', { timeoutMs: 500 });
      await sleep(300);
    }
    // Still alive — activity kept it warm well past the TTL.
    expect(ctx.child.exitCode).toBeNull();
    expect((await httpGet(ctx, '/health', { timeoutMs: 500 }))?.status).toBe(200);

    // Stop driving traffic — now it must idle out.
    expect(await waitForExit(ctx, 4000)).toBe(true);
  }), 20000);
});

describe('idle-TTL eviction — /read-semantic resets the timer', () => {
  it('a /read-semantic resets the timer (mirrors /search) yet idles out once traffic stops', withCtx(async (ctx) => {
    // /read-semantic sets lastActivityMs at the top of its branch exactly like /search, so
    // driving it past the TTL must keep the daemon warm; once it stops, the daemon idles out.
    spawnDaemon(ctx, { SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '1500', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '200' });
    expect(await waitForUp(ctx)).toBe(true);

    const driveUntil = Date.now() + 2400; // > 1.5x TTL
    while (Date.now() < driveUntil) {
      // A 503 "starting"/"failed" still resets the clock — lastActivityMs is set
      // before the readiness check, just like the /search branch.
      await httpGet(ctx, '/read-semantic?path=a.js&q=anything&projectRoot=' + encodeURIComponent(ctx.dir), { timeoutMs: 500 });
      await sleep(300);
    }
    // Still alive — /read-semantic traffic kept it warm past the TTL.
    expect(ctx.child.exitCode).toBeNull();
    expect((await httpGet(ctx, '/health', { timeoutMs: 500 }))?.status).toBe(200);

    // Stop driving traffic → it must now idle out (proves /health probing in
    // waitForExit does NOT reset the timer, only the query routes do).
    expect(await waitForExit(ctx, 4000)).toBe(true);
    expect(existsSync(ctx.socketPath)).toBe(false);
    expect(existsSync(ctx.pidFile)).toBe(false);
  }), 20000);

  it('/health-only traffic does NOT reset the timer (regression guard vs /read-semantic)', withCtx(async (ctx) => {
    // Companion to the above: pure /health pinging must NOT keep the daemon alive.
    spawnDaemon(ctx, { SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '1500', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '200' });
    expect(await waitForUp(ctx)).toBe(true);

    const probeUntil = Date.now() + 1800;
    while (Date.now() < probeUntil) {
      await httpGet(ctx, '/health', { timeoutMs: 300 });
      await sleep(400);
    }
    expect(await waitForExit(ctx, 4000)).toBe(true);
  }), 20000);

  it('a /stop that races the idle-TTL still exits once with code 0', withCtx(async (ctx) => {
    // /stop and an about-to-fire idle-TTL both call the shared gracefulShutdown;
    // the guard ensures only one wins. Short TTL so they genuinely race.
    spawnDaemon(ctx, { SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '800', SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '150' });
    expect(await waitForUp(ctx)).toBe(true);

    // Let the idle window approach, then send /stop right around the TTL edge.
    await sleep(700);
    await httpGet(ctx, '/stop', { timeoutMs: 3000 });

    const exit = await Promise.race([ctx.childExited, sleep(5000).then(() => 'timeout')]);
    expect(exit).not.toBe('timeout');
    expect(exit.code).toBe(0);
    expect(existsSync(ctx.socketPath)).toBe(false);
    expect(existsSync(ctx.pidFile)).toBe(false);
  }), 20000);
});

// The daemons below have the idle TTL off, so nothing here depends on a short clock and the
// tests can run at the same time.
describe.concurrent('daemon stop paths', () => {
  it('sendStopToSocket stops a running daemon on an explicit socket and unlinks its files', withCtx(async (ctx) => {
    spawnDaemon(ctx, { SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0' }); // TTL disabled — only /stop should end it
    expect(await waitForUp(ctx)).toBe(true);

    const { sendStopToSocket } = await import('../../core/search/search-server.js');
    const reached = await sendStopToSocket(ctx.socketPath);
    expect(reached).toBe(true);

    expect(await waitForExit(ctx, 5000)).toBe(true);
    expect(existsSync(ctx.socketPath)).toBe(false);
    expect(existsSync(ctx.pidFile)).toBe(false);
  }), 20000);

  it('two back-to-back /stop requests exit exactly once with code 0, no double-unlink throw', withCtx(async (ctx) => {
    spawnDaemon(ctx, { SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0' }); // only /stop ends it
    expect(await waitForUp(ctx)).toBe(true);

    // Two concurrent /stop requests: the second must be a no-op — the process tears down
    // once, unlinks pid+socket once, and exits 0.
    const [a, b] = await Promise.all([
      httpGet(ctx, '/stop', { timeoutMs: 3000 }),
      httpGet(ctx, '/stop', { timeoutMs: 3000 }),
    ]);
    // At least one /stop got the 200 "Shutting down" ack; the other may race the
    // socket closing (null) or also see 200 — either way no error is thrown.
    expect([a?.status, b?.status].some((st) => st === 200)).toBe(true);

    const exit = await Promise.race([ctx.childExited, sleep(5000).then(() => 'timeout')]);
    expect(exit).not.toBe('timeout');
    expect(exit.code).toBe(0);          // exits exactly once, cleanly
    expect(exit.signal).toBeNull();     // not killed — graceful self-exit
    expect(existsSync(ctx.socketPath)).toBe(false); // unlinked once, no throw
    expect(existsSync(ctx.pidFile)).toBe(false);
  }), 20000);
});

// ---------------------------------------------------------------------------
// FRESHNESS INVARIANT (T6): the detached index maintainer survives a search
// daemon eviction, and a cold daemon restart does not duplicate it.
//
// The maintainer is spawned detached + unref'd by launchMaintainer
// (maintainer-launcher.mjs) from the SAME launcher the search daemon calls at
// startup, so killing/idling the search daemon must NOT take the maintainer
// with it. We use a hermetic long-lived fake maintainer; the real indexer is
// never touched, and we only READ the maintainer's pid/lock.
// ---------------------------------------------------------------------------
describe.concurrent('freshness invariant — maintainer survives daemon eviction', () => {
  function pidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }

  /** A context with a state dir and a private copy of the fake maintainer. */
  function maintainerCtx() {
    const ctx = newCtx();
    ctx.stateDir = join(ctx.dir, '.sweet-search');
    ctx.maintainerMarker = join(ctx.dir, 'maintainer-marker.log');
    ctx.maintainerEntry = join(ctx.dir, 'fake-maintainer.mjs');
    mkdirSync(ctx.stateDir, { recursive: true }); // launcher requires the state dir to exist
    copyFileSync(FAKE_MAINTAINER, ctx.maintainerEntry);
    ctx.lockPath = () => join(ctx.stateDir, 'index-maintainer.lock');
    return ctx;
  }

  function withMaintainerCtx(fn) {
    return async () => {
      const ctx = maintainerCtx();
      try { await fn(ctx); } finally { await disposeCtx(ctx); }
    };
  }

  /** Spawn a daemon WITH the maintainer enabled, pointed at the fake maintainer. */
  function spawnDaemonWithMaintainer(ctx, extraEnv = {}) {
    return spawnDaemon(ctx, {
      SWEET_SEARCH_RECONCILE_V2: '',                 // force default-ON
      SWEET_SEARCH_MAINTAINER_ENTRY: ctx.maintainerEntry,
      SWEET_SEARCH_STATE_DIR: ctx.stateDir,
      FAKE_MAINTAINER_MARKER: ctx.maintainerMarker,
      // No background QoS: `taskpolicy -b` lets macOS starve the spawned child
      // for many seconds under a loaded full-suite run. These tests check
      // supervision decisions; the demotion has its own tests (os-priority).
      SWEET_SEARCH_MAINTAINER_BG_PRIORITY: '0',
      ...extraEnv,
    });
  }

  /** Wait until the fake maintainer has written its lock; return its pid. */
  async function waitForMaintainerPid(ctx, deadlineMs = 12000) {
    const end = Date.now() + deadlineMs;
    while (Date.now() < end) {
      try {
        const { pid } = JSON.parse(readFileSync(ctx.lockPath(), 'utf-8'));
        if (Number.isInteger(pid) && pidAlive(pid)) return pid;
      } catch { /* not written yet */ }
      await sleep(100);
    }
    return null;
  }

  function markerCount(ctx) {
    try { return readFileSync(ctx.maintainerMarker, 'utf-8').split('\n').filter(Boolean).length; }
    catch { return 0; }
  }

  /** Wait until the marker has `n` lines (or timeout); returns the count. */
  async function waitForMarkerCount(ctx, n, deadlineMs = 6000) {
    const end = Date.now() + deadlineMs;
    let c = markerCount(ctx);
    while (c < n && Date.now() < end) {
      await sleep(100);
      c = markerCount(ctx);
    }
    return c;
  }

  it('maintainer outlives an idle-evicted daemon and the lock stays intact', withMaintainerCtx(async (ctx) => {
    // TTL is long enough to confirm the maintainer launched BEFORE we let the
    // daemon idle-evict — otherwise under heavy CPU contention the daemon could
    // self-stop before its detached maintainer finishes starting. We assert the
    // eviction explicitly via waitForExit afterwards, so a generous TTL does not
    // weaken the test.
    spawnDaemonWithMaintainer(ctx, {
      SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '4000',
      SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '250',
    });
    expect(await waitForUp(ctx)).toBe(true);

    const maintPid = await waitForMaintainerPid(ctx);
    expect(maintPid).toBeTruthy();
    ctx.maintainerPids.add(maintPid);
    expect(await waitForMarkerCount(ctx, 1)).toBe(1); // launched exactly once

    // Let the search daemon idle-evict (no query traffic keeps it alive).
    expect(await waitForExit(ctx, 8000)).toBe(true);
    expect(existsSync(ctx.socketPath)).toBe(false); // daemon gone

    // The detached maintainer is STILL alive and its lock is intact.
    expect(pidAlive(maintPid)).toBe(true);
    expect(existsSync(ctx.lockPath())).toBe(true);
    const { pid: lockedPid } = JSON.parse(readFileSync(ctx.lockPath(), 'utf-8'));
    expect(lockedPid).toBe(maintPid);
  }), 25000);

  it('maintainer survives a /stop and a cold daemon restart does not duplicate it', withMaintainerCtx(async (ctx) => {
    spawnDaemonWithMaintainer(ctx, { SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0' }); // only /stop ends it
    expect(await waitForUp(ctx)).toBe(true);

    const maintPid = await waitForMaintainerPid(ctx);
    expect(maintPid).toBeTruthy();
    ctx.maintainerPids.add(maintPid);
    expect(await waitForMarkerCount(ctx, 1)).toBe(1);

    // Tear the search daemon down.
    await httpGet(ctx, '/stop', { timeoutMs: 3000 });
    expect(await waitForExit(ctx, 5000)).toBe(true);
    // Maintainer survived the teardown.
    expect(pidAlive(maintPid)).toBe(true);

    // Cold-restart the search daemon. Its launchMaintainer must see the LIVE
    // lock and skip spawning — the marker count stays at 1 (no duplicate).
    spawnDaemonWithMaintainer(ctx, { SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0' });
    expect(await waitForUp(ctx)).toBe(true);
    // Give the restarted daemon's launcher a beat to (not) spawn a duplicate.
    await sleep(1200);
    expect(markerCount(ctx)).toBe(1);
    expect(pidAlive(maintPid)).toBe(true);

    // The still-live original maintainer is the one the lock points at.
    const { pid: lockedPid } = JSON.parse(readFileSync(ctx.lockPath(), 'utf-8'));
    expect(lockedPid).toBe(maintPid);
  }), 30000);

  it('brings the maintainer back when it stops while this daemon keeps serving', withMaintainerCtx(async (ctx) => {
    // THE BUG THIS PINS. On hosts of 24 GiB or less the maintainer stops itself
    // after a long idle stretch, and every `launchMaintainer` call site runs at
    // daemon STARTUP — so with the daemon still up, nothing ever started it
    // again. Editing a file after that left the index frozen: zero hits from
    // search and from grep, and no error logged anywhere.
    //
    // The daemon's own idle-TTL is off here, so the ONLY thing that can bring
    // the maintainer back is supervision driven by query traffic.
    spawnDaemonWithMaintainer(ctx, {
      SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0',
      SWEET_SEARCH_MAINTAINER_SUPERVISION_INTERVAL_MS: '250',
    });
    expect(await waitForUp(ctx)).toBe(true);

    const firstPid = await waitForMaintainerPid(ctx);
    expect(firstPid).toBeTruthy();
    ctx.maintainerPids.add(firstPid);
    expect(await waitForMarkerCount(ctx, 1)).toBe(1);

    // Stand in for the idle-TTL exit. SIGKILL is the HARSHER case: it leaves the
    // lock behind naming a dead pid, where the real idle exit releases it.
    process.kill(firstPid, 'SIGKILL');
    await sleep(300);
    expect(pidAlive(firstPid)).toBe(false);

    // Querying is what a developer does after coming back to the project, and
    // it is the moment staleness would start being served. Several queries, not
    // one: supervision is driven by responses, and a lone query can land inside
    // the spawn-claim window left by startup. Bounded by time, not by a query
    // count, so it holds under load. Stops as soon as the replacement appears.
    let markers = 1;
    const queryUntil = Date.now() + 25_000;
    while (markers < 2 && Date.now() < queryUntil) {
      const r = await httpGet(ctx, '/search?q=anything', { timeoutMs: 3000 });
      expect(r).toBeTruthy(); // 200 or 503 both count: the route ran
      await sleep(300);
      markers = markerCount(ctx);
    }

    expect(await waitForMarkerCount(ctx, 2)).toBe(2);
    const secondPid = await waitForMaintainerPid(ctx);
    expect(secondPid).toBeTruthy();
    ctx.maintainerPids.add(secondPid);
    expect(secondPid).not.toBe(firstPid);
    expect(pidAlive(secondPid)).toBe(true);
  }), 60000);

  it('does not resurrect a maintainer for a repo nobody is querying', withMaintainerCtx(async (ctx) => {
    // The mirror image of the test above, and the reason supervision is keyed on
    // query traffic rather than on the maintainer simply being absent. A health
    // probe is not use of the repository; if it counted, a monitoring check
    // would keep a model-loaded maintainer resident on a laptop indefinitely and
    // undo the whole point of the idle-TTL.
    spawnDaemonWithMaintainer(ctx, {
      SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0',
      SWEET_SEARCH_MAINTAINER_SUPERVISION_INTERVAL_MS: '250',
    });
    expect(await waitForUp(ctx)).toBe(true);

    const firstPid = await waitForMaintainerPid(ctx);
    ctx.maintainerPids.add(firstPid);
    expect(await waitForMarkerCount(ctx, 1)).toBe(1);

    process.kill(firstPid, 'SIGKILL');
    await sleep(300);

    // Health probes only — no queries. The spawn claim lasts 5 s (SPAWN_CLAIM_TTL_MS in
    // maintainer-launcher.mjs), so 6.5 s of probes outlast it: a passing result means
    // supervision declined, not that it was blocked.
    const probeUntil = Date.now() + 6500;
    while (Date.now() < probeUntil) {
      await httpGet(ctx, '/health', { timeoutMs: 1000 });
      await sleep(500);
    }
    expect(markerCount(ctx)).toBe(1);
  }), 40000);
});

// Layering policy over source text: the registry module must not reach into the indexing
// domain, so the maintainer can never be enumerated through it. scripts/check-boundaries.js
// does not forbid search -> indexing, so no other check covers this one.
describe('static guard — registry never reaches the maintainer', () => {
  const REGISTRY_SRC = join(REPO_ROOT, 'core', 'search', 'daemon-registry.js');

  it('daemon-registry.js imports nothing from the indexing context', () => {
    const regSrc = readFileSync(REGISTRY_SRC, 'utf-8');
    expect(regSrc).not.toMatch(/from\s*['"][^'"]*\/indexing\//);
    expect(regSrc).not.toMatch(/maintainer-launcher/);
  });
});
