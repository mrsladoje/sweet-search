/**
 * ONE REAL PROBE PROCESS, for the cross-process spawn-budget barrier test.
 *
 * A sequential in-process test can never reach the race the budget exists to
 * stop: it always runs one probe to completion before starting the next, so the
 * second reads a budget the first has already published. The failure mode is the
 * opposite — several probes on aligned timers reach the claim at the same
 * instant, on the busiest possible machine.
 *
 * So this is a whole separate OS process that: waits on a barrier file until
 * every sibling is up, runs ONE supervision tick against a shared state dir with
 * a launcher that only RECORDS its call, and prints its verdict as JSON. The
 * parent starts N of them at once and asserts that at most one recorded a
 * launch.
 *
 * Usage: node spawn-budget-racer.mjs <stateDir> <barrierFile> <racerCount> <launchLogFile>
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runSupervisionTick, createSupervisionState } from '../../core/indexing/maintainer-launcher.mjs';

const [stateDir, barrierFile, racerCountRaw, launchLog] = process.argv.slice(2);
const racerCount = Number(racerCountRaw);

/** Sleep without yielding to the event loop — the barrier must stay synchronous. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Announce arrival, then wait until everyone has arrived.
 *
 * The poll sleeps rather than spinning. A bare `for(;;)` here would have every
 * racer saturating a core while it waits, so the processes would be fighting
 * for CPU at the exact instant the test wants them to reach the claim together
 * — it would degrade the very simultaneity it is trying to create.
 */
function barrier() {
  appendFileSync(barrierFile, `${process.pid}\n`);
  const deadline = Date.now() + 15_000;
  for (;;) {
    let n = 0;
    try {
      n = readFileSync(barrierFile, 'utf-8').split('\n').filter(Boolean).length;
    } catch { /* not yet */ }
    if (n >= racerCount || Date.now() > deadline) return;
    sleepSync(2);
  }
}

barrier();

const result = runSupervisionTick({
  state: createSupervisionState(),
  env: {
    SWEET_SEARCH_STATE_DIR: stateDir,
    SWEET_SEARCH_PROJECT_ROOT: stateDir,
    SWEET_SEARCH_RECONCILE_V2: '1',
  },
  cwd: stateDir,
  // The launcher never really spawns: it appends one line per call, which is
  // the whole measurement. A real spawn here would make the test's cost the
  // thing it is trying to count.
  launch: () => {
    appendFileSync(launchLog, `${process.pid}\n`);
    return { spawned: true, reason: 'spawned', pid: 999000 + (process.pid % 1000) };
  },
});

process.stdout.write(`${JSON.stringify({ pid: process.pid, ...result })}\n`);
// Touch the state dir reference so an unused-variable linter cannot drop it.
void join;
void existsSync;
void writeFileSync;
