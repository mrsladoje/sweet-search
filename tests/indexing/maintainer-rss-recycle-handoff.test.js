/**
 * Unit tests for the D.5 RSS-recycle successor handoff.
 *
 * Background — the bug this closes. When the maintainer's own resident set
 * crossed the recycle ceiling it shut down cleanly and NOTHING restarted it.
 * All three `launchMaintainer` call sites (search-server startup, the session
 * prewarm hook, MCP server startup) are cold starts, so the index simply
 * stopped converging: files written after the recycle returned zero hits from
 * both search and grep, with no error logged anywhere.
 *
 * The handoff makes the exiting maintainer spawn its own successor. These tests
 * inject the launcher and the liveness probe, so no process is ever spawned and
 * no model is loaded. The real spawn path is covered separately by
 * `maintainer-handoff-spawn.test.js`.
 */

import { describe, it, expect } from 'vitest';

import {
  nextRecycleGeneration,
  handOffAfterRssRecycle,
  shouldHandOffAfterRecycle,
  successorEnv,
} from '../../core/indexing/index-maintainer.mjs';

/** Collect emitted log lines as `LEVEL message` strings. */
function recorder() {
  const lines = [];
  const emit = (level, message) => lines.push(`${level} ${message}`);
  emit.lines = lines;
  emit.matching = (re) => lines.filter((l) => re.test(l));
  return emit;
}

const spawnOk = (pid = 4242) => {
  const calls = [];
  const launch = (opts) => { calls.push(opts); return { spawned: true, reason: 'spawned', pid }; };
  launch.calls = calls;
  return launch;
};

/** Handoff options that skip the real liveness wait — the child is "alive". */
const alive = { confirmDelayMs: 0, confirm: async () => true };

describe('shouldHandOffAfterRecycle', () => {
  it('hands off only for an RSS recycle', () => {
    expect(shouldHandOffAfterRecycle({ recycleForRss: true, stopRequested: false })).toBe(true);
    expect(shouldHandOffAfterRecycle({ recycleForRss: false, stopRequested: false })).toBe(false);
  });

  it('an explicit stop DOMINATES the recycle decision', () => {
    // SIGTERM/SIGINT, idle-TTL, a lost lock and a lifecycle abort all set
    // stopRequested. `kill <pid>` must leave the maintainer gone, not replaced,
    // even when the ceiling already decided to recycle.
    expect(shouldHandOffAfterRecycle({ recycleForRss: true, stopRequested: true })).toBe(false);
  });
});

describe('successorEnv', () => {
  it('pins the ALREADY-RESOLVED absolute paths, overriding relative inherited values', () => {
    // The successor is spawned with a different cwd. Inheriting
    // SWEET_SEARCH_PROJECT_ROOT=repos/app would re-resolve against that new cwd
    // and point the successor at a different index, leaving the real one with
    // zero writers.
    const env = successorEnv(
      { projectRoot: '/srv/repos/app', stateDir: '/srv/state/app' },
      { SWEET_SEARCH_PROJECT_ROOT: 'repos/app', SWEET_SEARCH_STATE_DIR: 'state/app', OTHER: 'kept' },
    );
    expect(env.SWEET_SEARCH_PROJECT_ROOT).toBe('/srv/repos/app');
    expect(env.SWEET_SEARCH_STATE_DIR).toBe('/srv/state/app');
    expect(env.OTHER).toBe('kept');
  });

  it('does not mutate the inherited environment', () => {
    const env = { SWEET_SEARCH_PROJECT_ROOT: 'relative' };
    successorEnv({ projectRoot: '/abs', stateDir: '/abs/.sweet-search' }, env);
    expect(env.SWEET_SEARCH_PROJECT_ROOT).toBe('relative');
  });
});

describe('nextRecycleGeneration', () => {
  it('a cold-started maintainer produces generation 1', () => {
    expect(nextRecycleGeneration({})).toBe(1);
  });

  it('increments an existing generation', () => {
    expect(nextRecycleGeneration({ SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION: '4' })).toBe(5);
  });

  it('treats garbage / negative / empty as a cold start', () => {
    for (const raw of ['abc', '-3', '', '0', 'NaN']) {
      expect(nextRecycleGeneration({ SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION: raw })).toBe(1);
    }
  });
});

describe('handOffAfterRssRecycle', () => {
  it('starts a successor and CONFIRMS it is still alive before reporting success', async () => {
    const launch = spawnOk(777);
    const emit = recorder();
    const out = await handOffAfterRssRecycle({ cwd: '/repo', env: {}, launch, emit, ...alive });

    expect(out).toEqual({ generation: 1, spawned: true, reason: 'spawned', confirmed: true });
    expect(launch.calls).toHaveLength(1);
    expect(launch.calls[0].cwd).toBe('/repo');
    expect(emit.matching(/successor maintainer confirmed running \(pid 777, generation 1\)/)).toHaveLength(1);
  });

  it('retries once when the child dies immediately, and never claims a confirmed handoff', async () => {
    // `spawn()` reports EAGAIN/EMFILE/ENOENT asynchronously, so a synchronous
    // "spawned" says nothing about whether the child survived. Reporting
    // success here would mean logging "successor started", exiting, and leaving
    // ZERO writers — the original bug with extra steps.
    const launch = spawnOk(999);
    const emit = recorder();
    const out = await handOffAfterRssRecycle({
      cwd: '/repo', env: {}, launch, emit, confirmDelayMs: 0, confirm: async () => false,
    });
    expect(out.confirmed).toBe(false);
    expect(out.reason).toBe('died-immediately');
    expect(launch.calls).toHaveLength(2);
    expect(emit.matching(/did not survive its first/)).toHaveLength(2);
    expect(emit.matching(/WARN .*did NOT start a successor \(died-immediately\)/)).toHaveLength(1);
  });

  it('stops retrying as soon as one attempt is confirmed', async () => {
    const launch = spawnOk(5);
    let probes = 0;
    const out = await handOffAfterRssRecycle({
      cwd: '/repo', env: {}, launch, emit: recorder(),
      confirmDelayMs: 0, confirm: async () => { probes += 1; return true; },
    });
    expect(out.confirmed).toBe(true);
    expect(launch.calls).toHaveLength(1);
    expect(probes).toBe(1);
  });

  it('reports spawned-but-unconfirmed when the launcher gives no child handle to watch', async () => {
    // An injected double (and any future launcher variant) may not return a
    // ChildProcess. We must not invent a liveness signal we do not have: report
    // the spawn honestly as unconfirmed rather than claiming it was verified.
    const emit = recorder();
    const out = await handOffAfterRssRecycle({ cwd: '/repo', env: {}, launch: spawnOk(11), emit });
    expect(out).toEqual({ generation: 1, spawned: true, reason: 'spawned', confirmed: false });
    expect(emit.matching(/successor maintainer started \(pid 11, generation 1\)/)).toHaveLength(1);
    expect(emit.matching(/^WARN/)).toHaveLength(0);
  });

  it('abandons the handoff when a stop is already requested, without spawning', async () => {
    const launch = spawnOk();
    const emit = recorder();
    const out = await handOffAfterRssRecycle({
      cwd: '/repo', env: {}, launch, emit, shouldAbort: () => true, ...alive,
    });
    expect(out.reason).toBe('stop-requested');
    expect(out.spawned).toBe(false);
    expect(launch.calls).toHaveLength(0);
  });

  it('stops the successor when a stop arrives DURING the confirmation window', async () => {
    // The confirmation wait is real wall-clock time, so SIGTERM can land inside
    // it — after the child is already running. Leaving it would mean `kill
    // <pid>` silently produced a replacement.
    let killed = null;
    const child = { kill: (sig) => { killed = sig; } };
    const launch = () => ({ spawned: true, reason: 'spawned', pid: 321, child });
    let stopped = false;
    const emit = recorder();
    const out = await handOffAfterRssRecycle({
      cwd: '/repo',
      env: {},
      launch,
      emit,
      confirmDelayMs: 0,
      // Not yet stopping at the pre-spawn check; stopping by the post-confirm one.
      confirm: async () => { stopped = true; return true; },
      shouldAbort: () => stopped,
    });
    expect(out.reason).toBe('stop-requested');
    expect(out.spawned).toBe(false);
    expect(killed).toBe('SIGTERM');
    expect(emit.matching(/stopping the successor \(pid 321\)/)).toHaveLength(1);
  });

  it('passes the incremented generation to the successor so the chain is countable', async () => {
    const launch = spawnOk();
    await handOffAfterRssRecycle({
      cwd: '/repo',
      env: { SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION: '2', SWEET_SEARCH_STATE_DIR: '/s' },
      launch,
      emit: recorder(),
      ...alive,
    });
    expect(launch.calls[0].env.SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION).toBe('3');
    // The rest of the environment must survive — SWEET_SEARCH_STATE_DIR is how
    // the successor finds the same index.
    expect(launch.calls[0].env.SWEET_SEARCH_STATE_DIR).toBe('/s');
  });

  it('does not mutate the caller environment', async () => {
    const env = { SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION: '1' };
    await handOffAfterRssRecycle({ cwd: '/repo', env, launch: spawnOk(), emit: recorder(), ...alive });
    expect(env.SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION).toBe('1');
  });

  it('WARNs loudly when no successor starts — a silent skip is the original bug', async () => {
    const emit = recorder();
    const out = await handOffAfterRssRecycle({
      cwd: '/repo',
      env: {},
      launch: () => ({ spawned: false, reason: 'opted-out' }),
      emit,
      ...alive,
    });
    expect(out.spawned).toBe(false);
    expect(out.reason).toBe('opted-out');
    expect(emit.matching(/WARN .*did NOT start a successor \(opted-out\)/)).toHaveLength(1);
  });

  it('does NOT warn when a maintainer already holds the lock — that is the O_EXCL guarantee working', async () => {
    const emit = recorder();
    const out = await handOffAfterRssRecycle({
      cwd: '/repo',
      env: {},
      launch: () => ({ spawned: false, reason: 'already-running' }),
      emit,
      ...alive,
    });
    expect(out.reason).toBe('already-running');
    expect(emit.matching(/^WARN/)).toHaveLength(0);
    expect(emit.matching(/already holds the lock/)).toHaveLength(1);
  });

  it('never throws when the launcher throws, and says the index will go stale', async () => {
    const emit = recorder();
    const out = await handOffAfterRssRecycle({
      cwd: '/repo',
      env: {},
      launch: () => { throw new Error('spawn EACCES'); },
      emit,
      ...alive,
    });
    expect(out).toEqual({ generation: 1, spawned: false, reason: 'error', confirmed: false });
    expect(emit.matching(/ERROR .*handoff failed: spawn EACCES/)).toHaveLength(1);
    expect(emit.matching(/stops converging/)).toHaveLength(1);
  });

  it('stays quiet about the chain for the first two generations', async () => {
    for (const gen of ['0', '1']) {
      const emit = recorder();
      await handOffAfterRssRecycle({
        cwd: '/repo',
        env: { SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION: gen },
        launch: spawnOk(),
        emit,
        ...alive,
      });
      expect(emit.matching(/times in a row/)).toHaveLength(0);
    }
  });

  it('warns about a repeating chain from the third generation, and still hands off', async () => {
    const launch = spawnOk();
    const emit = recorder();
    const out = await handOffAfterRssRecycle({
      cwd: '/repo',
      env: { SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION: '2' },
      launch,
      emit,
      ...alive,
    });
    // The chain is NEVER capped: a capped chain reintroduces the silent
    // staleness this whole path exists to prevent.
    expect(out.confirmed).toBe(true);
    expect(emit.matching(/recycled for RSS 3 times in a row/)).toHaveLength(1);
    expect(emit.matching(/SWEET_SEARCH_MAINTAINER_RSS_MAX_MB/)).toHaveLength(1);
  });

  it('still hands off at a very long chain', async () => {
    const launch = spawnOk();
    const out = await handOffAfterRssRecycle({
      cwd: '/repo',
      env: { SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION: '99' },
      launch,
      emit: recorder(),
      ...alive,
    });
    expect(out).toEqual({ generation: 100, spawned: true, reason: 'spawned', confirmed: true });
    expect(launch.calls).toHaveLength(1);
  });
});
