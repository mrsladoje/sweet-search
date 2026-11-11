/**
 * A pid read from a file is not a process identity (docs/STATE_MACHINES.md, issue 8).
 *
 * The sequence under test: a maintainer, an index run or a daemon is killed (SIGKILL, OOM,
 * power loss) and leaves its lock, pause or registry entry behind. Later the OS gives its
 * pid to an unrelated program. The code then sent SIGTERM to that program, or took the dead
 * holder for alive for as long as that program ran.
 *
 * "The unrelated program" here is a real `sleep` process. The file names its pid with the
 * start token of another process, which is what a dead holder's file looks like after reuse.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { holdMaintainerForIndexRun, pauseHolds, reconcilePaused } from '../../core/indexing/maintainer-launcher.mjs';
import { acquireStateLock, releaseStateLock } from '../../core/indexing/index-maintainer.mjs';
import { runEvictionTick, registerDaemon, _readRegistryForTest } from '../../core/indexing/rss-budget.mjs';
import { processStartToken, ownStartToken } from '../../core/infrastructure/process-identity.js';

const ANOTHER_TOKEN = process.platform === 'linux' ? 'no-such-boot:1' : 'Mon Jan 1 00:00:00 2001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stateDir;
const children = [];

/** A live process that is no sweet-search process. */
function innocent() {
  const c = spawn('sleep', ['60'], { stdio: 'ignore' });
  children.push(c);
  return c;
}

/** True when the child got no signal and did not exit (after time for a signal to land). */
async function untouched(child) {
  await sleep(300);
  return child.exitCode === null && child.signalCode === null;
}

const lockFile = () => join(stateDir, 'index-maintainer.lock');
const TEN_MIN = 10 * 60_000;

beforeEach(() => { stateDir = mkdtempSync(join(tmpdir(), 'ss-pid-reuse-')); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const c of children.splice(0)) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  rmSync(stateDir, { recursive: true, force: true });
});

describe('holdMaintainerForIndexRun — the maintainer lock names a pid', () => {
  it('sends no signal to a process that got a dead maintainer\'s pid', async () => {
    const child = innocent();
    const old = Date.now() - TEN_MIN;
    writeFileSync(lockFile(), JSON.stringify({ pid: child.pid, timestamp: old, progressTimestamp: old, startToken: ANOTHER_TOKEN }));

    const t0 = Date.now();
    const release = await holdMaintainerForIndexRun(stateDir, { timeoutMs: 5_000 });
    expect(await untouched(child)).toBe(true);
    // It does not wait for that process to end either.
    expect(Date.now() - t0).toBeLessThan(4_000);
    expect(release.ours).toBe(true);
    release();
  });

  it('still stops the maintainer that wrote the lock', async () => {
    const maintainer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    children.push(maintainer);
    const exited = new Promise((r) => maintainer.once('exit', (code, signal) => r(signal)));
    writeFileSync(lockFile(), JSON.stringify({
      pid: maintainer.pid, timestamp: Date.now(), progressTimestamp: Date.now(), startToken: processStartToken(maintainer.pid),
    }));

    const release = await holdMaintainerForIndexRun(stateDir, { timeoutMs: 5_000 });
    expect(await exited).toBe('SIGTERM');
    release();
  });
});

describe('acquireStateLock — a stale lock names a pid', () => {
  it('takes the lock of a dead maintainer and sends no signal to the process that got its pid', async () => {
    const child = innocent();
    const old = Date.now() - TEN_MIN; // both stamps stale: the "wedged" branch, which sends SIGTERM
    writeFileSync(lockFile(), JSON.stringify({ pid: child.pid, timestamp: old, progressTimestamp: old, startToken: ANOTHER_TOKEN }));

    const t0 = Date.now();
    const res = await acquireStateLock(stateDir);
    try {
      expect(res.acquired).toBe(true);
      expect(JSON.parse(readFileSync(lockFile(), 'utf8')).pid).toBe(process.pid);
      expect(await untouched(child)).toBe(true);
      // A dead holder costs no grace period.
      expect(Date.now() - t0).toBeLessThan(3_000);
    } finally {
      releaseStateLock(res.lockFile);
    }
  });

  it('takes a dead maintainer\'s lock when this process itself got that pid', async () => {
    // The old code judged "pid alive" (it is this process), found the stamps stale and sent
    // SIGTERM to the pid in the lock: to itself.
    const realKill = process.kill.bind(process);
    let signalledSelf = false;
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === process.pid && signal === 'SIGTERM') { signalledSelf = true; return true; }
      return realKill(pid, signal);
    });
    const old = Date.now() - TEN_MIN;
    writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, timestamp: old, progressTimestamp: old, startToken: ANOTHER_TOKEN }));

    const res = await acquireStateLock(stateDir);
    try {
      expect(signalledSelf).toBe(false);
      expect(res.acquired).toBe(true);
    } finally {
      releaseStateLock(res.lockFile);
    }
  }, 15_000);

  it('records its own start token in the lock it creates', async () => {
    const res = await acquireStateLock(stateDir);
    try {
      expect(JSON.parse(readFileSync(lockFile(), 'utf8')).startToken).toBe(ownStartToken());
    } finally {
      releaseStateLock(res.lockFile);
    }
  });
});

describe('the index-run pause names its holder', () => {
  it('does not hold when another process got the holder\'s pid', () => {
    const child = innocent();
    expect(pauseHolds({ paused: true, holderPid: child.pid, holderStart: ANOTHER_TOKEN })).toBe(false);
    expect(pauseHolds({ paused: true, holderPid: child.pid, holderStart: processStartToken(child.pid) })).toBe(true);
  });

  it('a pause left by a killed index run does not block the next run when its pid is in use', async () => {
    const child = innocent();
    const pauseFile = join(stateDir, 'reconcile-pause.json');
    writeFileSync(pauseFile, JSON.stringify({
      paused: true, pausedAt: new Date(Date.now() - TEN_MIN).toISOString(), reason: 'sweet-search index is running',
      holderPid: child.pid, holderStart: ANOTHER_TOKEN,
    }));
    expect(reconcilePaused(stateDir)).toBe(false);

    // The next index run takes the pause at once (the old code waited `waitForHolderMs`
    // and then gave up with "held by another process").
    const release = await holdMaintainerForIndexRun(stateDir, { waitForHolderMs: 1_500 });
    expect(release.blockedBy).toBeNull();
    expect(release.ours).toBe(true);
    const mine = JSON.parse(readFileSync(pauseFile, 'utf8'));
    expect(mine.holderPid).toBe(process.pid);
    expect(mine.holderStart).toBe(ownStartToken());
    release();
    expect(existsSync(pauseFile)).toBe(false);
  });
});

describe('RSS budget registry — an entry names a pid', () => {
  let registryFile;
  const GiB = 1024 ** 3;
  const env = () => ({ SWEET_SEARCH_RSS_REGISTRY: registryFile, SWEET_SEARCH_RSS_BUDGET_FRACTION: '0.6' });
  const seed = (entries) => {
    const daemons = {};
    for (const e of entries) daemons[String(e.pid)] = e;
    writeFileSync(registryFile, JSON.stringify({ daemons }), 'utf8');
  };
  beforeEach(() => { registryFile = join(stateDir, 'rss-daemons.json'); });

  it('drops the entry of a dead daemon whose pid another process got, and sends that process no signal', async () => {
    const child = innocent();
    const now = Date.now();
    seed([
      // The dead daemon: longest idle, so it is the one the coordinator would stop.
      { pid: child.pid, kind: 'search', startedAt: now - 5_000, lastActivityMs: now - 5_000, rss: 0, startToken: ANOTHER_TOKEN },
      { pid: process.pid, kind: 'maintainer', startedAt: now, lastActivityMs: now, rss: 0, startToken: ownStartToken() },
    ]);

    // The real signal function: over budget (2 x 8 GiB against 9.6 GiB).
    const r = await runEvictionTick({
      env: env(), selfPid: process.pid, totalMem: 16 * GiB, rssReader: async () => 8 * GiB, pressureReader: async () => null,
    });

    expect(await untouched(child)).toBe(true);
    expect(r.evicted).toBeNull();
    expect(r.liveCount).toBe(1);
    // Its memory is not counted as the fleet's.
    expect(r.totalRss).toBe(8 * GiB);
    expect(Object.keys(await _readRegistryForTest(env()))).toEqual([String(process.pid)]);
  });

  it('still stops the longest-idle daemon that is the process in the registry', async () => {
    const daemon = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    children.push(daemon);
    const exited = new Promise((r) => daemon.once('exit', (code, signal) => r(signal)));
    const now = Date.now();
    seed([
      { pid: daemon.pid, kind: 'search', startedAt: now - 5_000, lastActivityMs: now - 5_000, rss: 0, startToken: processStartToken(daemon.pid) },
      { pid: process.pid, kind: 'maintainer', startedAt: now, lastActivityMs: now, rss: 0, startToken: ownStartToken() },
    ]);

    const r = await runEvictionTick({
      env: env(), selfPid: process.pid, totalMem: 16 * GiB, rssReader: async () => 8 * GiB, pressureReader: async () => null,
    });

    expect(r.evicted).toBe(daemon.pid);
    expect(await exited).toBe('SIGTERM');
  });

  it('a registration stores the start token of the registered process', async () => {
    const handle = await registerDaemon({ kind: 'maintainer', env: env() });
    try {
      expect((await _readRegistryForTest(env()))[String(process.pid)].startToken).toBe(ownStartToken());
    } finally {
      await handle.unregister();
    }
  });
});
