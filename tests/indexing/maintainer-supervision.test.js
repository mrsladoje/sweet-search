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
import { spawn } from 'node:child_process';
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
