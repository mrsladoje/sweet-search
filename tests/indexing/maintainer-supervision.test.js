/**
 * Supervision: a repository in active use must always have a maintainer.
 *
 * The gap this closes. On hosts of 24 GiB or less the maintainer stops itself
 * after a long idle stretch, and nothing restarted it while the search daemon
 * stayed up — every `launchMaintainer` call site runs at daemon STARTUP. Edit a
 * file after that and the index froze silently: zero hits, no error. These
 * tests pin the decision logic, because the failure is invisible in production
 * by construction.
 *
 * Two things are load-bearing and are asserted directly:
 *   - supervision must NOT respawn when respawning would only churn (paused
 *     repo, opted out, maintainer already alive, inside the rate-limit window);
 *   - concurrent supervisors must not all spawn at once — including from
 *     genuinely separate OS processes, which no in-process test can reach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSupervisionState,
  runSupervisionTick,
  MAINTAINER_SPAWN_CLAIM_FILENAME,
  MAINTAINER_LOCK_FILENAME,
} from '../../core/indexing/maintainer-launcher.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RACER = join(REPO_ROOT, 'tests', 'fixtures', 'spawn-budget-racer.mjs');

let root;
let stateDir;

/** A launcher that records calls instead of starting a process. */
function recordingLaunch(calls, result = { spawned: true, reason: 'spawned', pid: 4242 }) {
  return (opts) => { calls.push(opts); return result; };
}

const baseEnv = () => ({
  SWEET_SEARCH_STATE_DIR: stateDir,
  SWEET_SEARCH_PROJECT_ROOT: root,
  SWEET_SEARCH_RECONCILE_V2: '1',
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ss-supervise-'));
  stateDir = join(root, '.sweet-search');
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('maintainer supervision — when it must act', () => {
  it('starts a replacement when no maintainer holds the lock', () => {
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    expect(result).toMatchObject({ acted: true, reason: 'spawned', pid: 4242 });
    expect(calls).toHaveLength(1);
  });

  it('starts a replacement when the lock names a dead process', () => {
    // A pid that cannot be alive: the reaped fixture case that leaves a lock behind.
    writeFileSync(join(stateDir, MAINTAINER_LOCK_FILENAME), JSON.stringify({ pid: 2147483646, timestamp: Date.now() }));
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    expect(result.acted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('counts launches on the supervisor state', () => {
    const state = createSupervisionState();
    const calls = [];
    runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000 });
    expect(state.launches).toBe(1);
    expect(state.lastReason).toBe('spawned');
  });
});

describe('maintainer supervision — when it must NOT act', () => {
  it('does nothing while a live maintainer holds the lock', () => {
    writeFileSync(join(stateDir, MAINTAINER_LOCK_FILENAME), JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    expect(result).toMatchObject({ acted: false, reason: 'already-running' });
    expect(calls).toHaveLength(0);
  });

  it('does nothing inside the rate-limit window, without touching the disk', () => {
    const state = createSupervisionState();
    const calls = [];
    const first = runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000 });
    expect(first.acted).toBe(true);

    // The claim file from the first tick is removed, so ONLY the in-process
    // rate limit can stop the second tick. That is the point of the assertion:
    // a request inside the window must cost no syscalls at all.
    rmSync(join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME), { force: true });
    const second = runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_100 });
    expect(second).toMatchObject({ acted: false, reason: 'rate-limited' });
    expect(calls).toHaveLength(1);
  });

  it('acts again once the rate-limit window has passed', () => {
    const state = createSupervisionState();
    const calls = [];
    runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000 });
    rmSync(join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME), { force: true });
    const later = runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000 + 60_000 });
    expect(later.acted).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('does nothing when reconcile is opted out', () => {
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(),
      env: { ...baseEnv(), SWEET_SEARCH_RECONCILE_V2: '0' },
      cwd: root,
      launch: recordingLaunch(calls),
    });
    expect(result).toMatchObject({ acted: false, reason: 'opted-out' });
    expect(calls).toHaveLength(0);
  });

  it('does nothing when reconcile work is paused', () => {
    // A paused repo would start a maintainer that finds its work switched off
    // and idles straight back out — respawning it every interval is pure churn.
    writeFileSync(join(stateDir, 'reconcile-pause.json'), JSON.stringify({ paused: true, pausedAt: new Date().toISOString() }));
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    expect(result).toMatchObject({ acted: false, reason: 'paused' });
    expect(calls).toHaveLength(0);
  });

  it('treats an explicit paused:false as not paused', () => {
    writeFileSync(join(stateDir, 'reconcile-pause.json'), JSON.stringify({ paused: false }));
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    expect(result.acted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('does nothing when the state dir does not exist', () => {
    rmSync(stateDir, { recursive: true, force: true });
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    expect(result).toMatchObject({ acted: false, reason: 'no-state-dir' });
    expect(calls).toHaveLength(0);
  });
});

describe('maintainer supervision — the spawn claim', () => {
  it('yields to a supervisor holding a fresh claim', () => {
    writeFileSync(join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME), JSON.stringify({ pid: 999, at: 1_000_000 }));
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_500,
    });
    expect(result).toMatchObject({ acted: false, reason: 'claim-held' });
    expect(calls).toHaveLength(0);
  });

  it('does not spawn a second time while the first spawn has not taken the lock yet', () => {
    // The window that matters in production: `spawn` has returned but the child
    // has not written its lock, so `maintainerAlive` is still false. A second
    // tick landing in that window must be stopped by the claim, or a repository
    // gets two maintainers every time a supervisor ticks twice in a row.
    //
    // A 16-minute churn soak saw concurrency touch 2 once across 219 respawns;
    // this pins whether the in-process path can be the cause. The launcher stub
    // deliberately does NOT write a lock, which IS the unwritten-lock window.
    const state = createSupervisionState();
    const calls = [];
    const launchWithoutLock = () => { calls.push(1); return { spawned: true, reason: 'spawned', pid: 5150 }; };

    const first = runSupervisionTick({
      state, env: baseEnv(), cwd: root, launch: launchWithoutLock, now: 1_000_000, minIntervalMs: 0,
    });
    const second = runSupervisionTick({
      state, env: baseEnv(), cwd: root, launch: launchWithoutLock, now: 1_000_050, minIntervalMs: 0,
    });

    expect(first.acted).toBe(true);
    expect(second).toMatchObject({ acted: false, reason: 'claim-held' });
    expect(calls).toHaveLength(1);
  });

  it('holds off a SEPARATE supervisor in the same unwritten-lock window', () => {
    // Same window, but the second tick carries its own fresh state, which is
    // what a second process (the MCP server, a prewarm hook) looks like. The
    // in-process rate limit cannot help here; only the on-disk claim can.
    const calls = [];
    const launchWithoutLock = () => { calls.push(1); return { spawned: true, reason: 'spawned', pid: 5150 }; };

    runSupervisionTick({ state: createSupervisionState(), env: baseEnv(), cwd: root, launch: launchWithoutLock, now: 1_000_000 });
    const second = runSupervisionTick({ state: createSupervisionState(), env: baseEnv(), cwd: root, launch: launchWithoutLock, now: 1_000_050 });

    expect(second).toMatchObject({ acted: false, reason: 'claim-held' });
    expect(calls).toHaveLength(1);
  });

  it('steals a claim whose holder never followed through', () => {
    writeFileSync(join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME), JSON.stringify({ pid: 999, at: 1_000_000 }));
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000 + 120_000,
    });
    expect(result.acted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('steals a claim stamped in the future rather than wedging on a clock change', () => {
    // A backwards clock step would otherwise park supervision for as long as the
    // skew, which is unbounded — the index would stay frozen the whole time.
    writeFileSync(join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME), JSON.stringify({ pid: 999, at: 9_000_000 }));
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000,
    });
    expect(result.acted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('steals a corrupt claim', () => {
    writeFileSync(join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME), 'not json at all');
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    expect(result.acted).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('maintainer supervision — liveness cannot be forged by a dead process', () => {
  it('does NOT believe a lock whose timestamps have stopped advancing', () => {
    // The zombie case, and the one that turns supervision into the bug it
    // fixes. `process.kill(pid, 0)` succeeds for an unreaped zombie — under a
    // container PID 1 that does not reap, or a stopped parent — so a pid probe
    // alone would answer "already-running" forever and the index would never
    // update again. process.pid is genuinely alive here, so ONLY the stale
    // timestamps can produce the right answer.
    writeFileSync(join(stateDir, MAINTAINER_LOCK_FILENAME), JSON.stringify({
      pid: process.pid,
      timestamp: Date.now() - 30 * 60 * 1000,
      progressTimestamp: Date.now() - 30 * 60 * 1000,
    }));
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    expect(result.acted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('still believes a live holder whose heartbeat is recent', () => {
    // The other direction matters just as much: displacing a healthy maintainer
    // gives the repository two writers.
    writeFileSync(join(stateDir, MAINTAINER_LOCK_FILENAME), JSON.stringify({
      pid: process.pid, timestamp: Date.now(), progressTimestamp: Date.now(),
    }));
    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    expect(result).toMatchObject({ acted: false, reason: 'already-running' });
    expect(calls).toHaveLength(0);
  });

  it('accepts a busy holder whose heartbeat lags but whose progress is fresh', () => {
    // A maintainer inside long work refreshes progress while its heartbeat
    // timer lags. Either signal being fresh is enough.
    writeFileSync(join(stateDir, MAINTAINER_LOCK_FILENAME), JSON.stringify({
      pid: process.pid,
      timestamp: Date.now() - 30 * 60 * 1000,
      progressTimestamp: Date.now(),
    }));
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch([]),
    });
    expect(result.reason).toBe('already-running');
  });
});

describe('maintainer supervision — a maintainer that will not start', () => {
  it('backs off instead of spawning a doomed child on every interval', () => {
    // `launchMaintainer` returns as soon as `spawn` returns, which is before
    // the child takes its lock and before an async EAGAIN/EMFILE surfaces. A
    // child that always crashes on startup therefore looks like a successful
    // launch every time. Without backoff supervision would start another one
    // every interval, forever, while the index stays stale anyway.
    const state = createSupervisionState();
    const calls = [];
    const launchThatNeverLives = () => { calls.push(1); return { spawned: true, reason: 'spawned', pid: 4242 }; };

    let t = 1_000_000;
    const step = 20_000; // comfortably past the 15s base interval
    for (let i = 0; i < 12; i++) {
      rmSync(join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME), { force: true });
      runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: launchThatNeverLives, now: t });
      t += step;
    }

    // Twelve opportunities, but the interval doubles each time a launch fails
    // to produce a live maintainer, so only the first few actually spawn.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(5);
    expect(state.consecutiveFailures).toBeGreaterThan(1);
  });

  it('does not accumulate backoff on ticks that were blocked by the claim', () => {
    // A tick that never attempted a spawn is not a failed spawn. Counting it as
    // one meant that during the few seconds a peer holds the claim, a fast
    // supervisor racked up a dozen "failures" and backed itself off for
    // minutes — supervision switching itself off for no reason at all, which is
    // the staleness bug arriving by a new route. Caught by the end-to-end
    // restore test, pinned here.
    const state = createSupervisionState();
    const calls = [];
    runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000, minIntervalMs: 0 });
    expect(calls).toHaveLength(1);

    // The claim written by that launch now blocks every tick for its TTL.
    for (let i = 1; i <= 12; i++) {
      const r = runSupervisionTick({
        state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000 + i * 100, minIntervalMs: 0,
      });
      expect(r.reason).toBe('claim-held');
    }
    expect(state.consecutiveFailures).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('clears the backoff as soon as a maintainer is actually up', () => {
    const state = createSupervisionState();
    const calls = [];
    runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000 });
    runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_060_000 });
    expect(state.consecutiveFailures).toBe(1);

    // A live maintainer appears.
    writeFileSync(join(stateDir, MAINTAINER_LOCK_FILENAME), JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_120_000 });
    expect(state.consecutiveFailures).toBe(0);
  });

  it('does not treat an ordinary idle exit and respawn as a failure', () => {
    // The normal lifecycle: maintainer runs, is observed alive, retires on its
    // idle TTL, gets replaced. Counting that as failure would make a perfectly
    // healthy machine back off until it was barely maintained at all.
    const state = createSupervisionState();
    const calls = [];
    let t = 1_000_000;

    runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: t });
    for (let cycle = 0; cycle < 5; cycle++) {
      // Observed alive...
      writeFileSync(join(stateDir, MAINTAINER_LOCK_FILENAME), JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
      t += 60_000;
      runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: t });
      // ...then it retires, and supervision replaces it.
      rmSync(join(stateDir, MAINTAINER_LOCK_FILENAME), { force: true });
      rmSync(join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME), { force: true });
      t += 60_000;
      runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: t });
    }

    expect(state.consecutiveFailures).toBe(0);
    expect(calls).toHaveLength(6); // the first launch plus one per cycle
  });
});

describe('maintainer supervision — hostile and broken files', () => {
  it('acts rather than parking forever when the wall clock jumps BACKWARDS', () => {
    // An NTP correction or a confused VM can move the clock back hours. Treating
    // a negative elapsed time as "inside the rate-limit window" would suspend
    // supervision for the whole skew, and a maintainer exiting during it would
    // never be replaced.
    const state = createSupervisionState();
    const calls = [];
    runSupervisionTick({ state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 5_000_000 });
    rmSync(join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME), { force: true });

    const afterJumpBack = runSupervisionTick({
      state, env: baseEnv(), cwd: root, launch: recordingLaunch(calls), now: 1_000_000,
    });
    expect(afterJumpBack.acted).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('never reads a FIFO left at the claim path', () => {
    // .sweet-search lives inside the repository, so a hostile checkout can ship
    // a named pipe here — and readFileSync on a FIFO with no writer blocks
    // FOREVER. This code runs on the search daemon's event loop, so that single
    // file would hang every query the daemon serves from then on. If this test
    // hangs instead of failing, the guard is gone.
    const claimPath = join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME);
    const mk = spawnSync('mkfifo', [claimPath]);
    if (mk.status !== 0) return; // no mkfifo on this platform; nothing to prove

    const calls = [];
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: recordingLaunch(calls),
    });
    // It must return promptly with a verdict, whatever that verdict is.
    expect(typeof result.reason).toBe('string');
  }, 20_000);
});

describe('maintainer supervision — failure containment', () => {
  it('never throws when the launcher throws', () => {
    const boom = () => { throw new Error('spawn exploded'); };
    let result;
    expect(() => {
      result = runSupervisionTick({ state: createSupervisionState(), env: baseEnv(), cwd: root, launch: boom });
    }).not.toThrow();
    expect(result).toMatchObject({ acted: false, reason: 'launch-error' });
  });

  it('reports the launcher reason when the launcher declines to spawn', () => {
    const declined = () => ({ spawned: false, reason: 'entry-missing' });
    const result = runSupervisionTick({
      state: createSupervisionState(), env: baseEnv(), cwd: root, launch: declined,
    });
    expect(result).toMatchObject({ acted: false, reason: 'entry-missing' });
  });
});

describe('maintainer supervision — cross-process spawn budget', () => {
  it('lets at most one of four simultaneous supervisor PROCESSES spawn', async () => {
    // A sequential in-process test cannot reach this race: it always finishes
    // one tick before starting the next, so the second reads a claim the first
    // has already published. Here four separate OS processes wait on a barrier
    // and reach the claim in the same instant.
    //
    // They MUST be started concurrently. Running them one after another (the
    // obvious `execFileSync` loop) is not a weaker version of this test, it is a
    // different test: each racer then waits out the barrier timeout alone, and
    // the later ones legitimately steal the by-then-expired claim. That is
    // correct behaviour being reported as a race.
    const barrierFile = join(root, 'barrier');
    const launchLog = join(root, 'launches');
    writeFileSync(barrierFile, '');
    writeFileSync(launchLog, '');

    const runRacer = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [RACER, stateDir, barrierFile, '4', launchLog], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) { reject(new Error(`racer exited ${code}: ${err}`)); return; }
        resolve(out.trim());
      });
    });

    const racers = await Promise.all([runRacer(), runRacer(), runRacer(), runRacer()]);

    // Every racer must have reported a verdict — a crashed racer would make the
    // "at most one" assertion pass for the wrong reason.
    const verdicts = racers.map((out) => JSON.parse(out.trim()));
    expect(verdicts).toHaveLength(4);

    const launched = existsSync(launchLog)
      ? readFileSync(launchLog, 'utf-8').split('\n').filter(Boolean)
      : [];
    expect(launched.length).toBeLessThanOrEqual(1);
    expect(verdicts.filter((v) => v.acted).length).toBe(launched.length);
  }, 90_000);
});
