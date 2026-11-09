/**
 * REAP THE TEST FIXTURES A RUN SPAWNED, EVEN THE ONES A TIMEOUT ORPHANED.
 *
 * WHY. The daemon and maintainer integration tests start real OS processes and
 * kill them in `afterEach`. A test that TIMES OUT never reaches its afterEach,
 * so every such failure leaves a resident process behind — and those processes
 * then load the machine for the rest of the run, which makes the NEXT timing
 * assertion fail, which orphans another process. That feedback loop is why a
 * suite can pass cleanly once and produce ten timing failures on the next run
 * of the identical tree. It is not hypothetical: nine orphaned fixtures, the
 * oldest seven hours old, were resident when this file was wired up, and the
 * suite run they poisoned reported twelve failures that all passed on a quiet
 * machine.
 *
 * WHEN IT RUNS. At the START of a run and again at the END — both points where
 * vitest guarantees no test is executing. Reaping at the start is the half that
 * actually breaks the feedback loop: it means a run cannot inherit the previous
 * run's residue.
 *
 * WHY NOT PER TEST FILE. Tempting, and wrong. With `pool: 'forks'` several test
 * files run at once, so a per-file hook would kill a fixture another worker is
 * still using and manufacture exactly the flakiness it is meant to remove.
 *
 * WHAT IT WILL AND WILL NOT KILL. Only processes whose command line names a
 * file that actually exists in THIS checkout's tests/fixtures/, by absolute
 * path. The list is READ FROM THE DIRECTORY rather than hardcoded — a
 * hardcoded list silently rots in both directions, and this one already had:
 * it named two fixtures that no longer existed while missing
 * `fake-daemon.mjs`, which does.
 *
 * ABSOLUTE, NOT RELATIVE. The marker used to be the relative fragment
 * `tests/fixtures/<name>`, which every checkout of this repository shares:
 * a run in one worktree SIGKILLed the live fixtures of a run in another
 * worktree (or the main checkout), at its start and again at its end, and
 * failed that other run's tests. The tests spawn fixtures by absolute path
 * (join(REPO_ROOT, 'tests', 'fixtures', ...)), so the absolute marker still
 * reaps this checkout's orphans and never another checkout's live ones.
 *
 * ORPHANS AND OUR OWN, NOT A NEIGHBOUR'S. Two vitest runs in the SAME checkout
 * (two agents, or a targeted run beside a full run) name the same fixture
 * paths, so the path alone cannot tell this run's fixtures from the other
 * run's live ones: each run SIGKILLed the other's fixtures at its start and
 * at its end, and the other run's daemon tests failed about one time in
 * three. A fixture is reaped only when its parent is gone (parent pid 1: the
 * run that started it has ended or its spawner died) or when it descends
 * from this vitest process. A fixture with a live parent in another run is
 * left alone.
 *
 * It deliberately does NOT touch `--serve` daemons or real index maintainers,
 * even though a timed-out test can orphan one of those too. A developer's own
 * working daemon has the same command line as a test's, and a teardown hook
 * that could stop the machine's real daemons would be a far worse defect than
 * the leak it fixes. That residual is real and is not closed here.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/**
 * The reapable set, read from disk at call time.
 *
 * Returns absolute paths (`<this checkout>/tests/fixtures/<name>`), not bare
 * filenames or the relative fragment: a bare name could appear in an
 * unrelated process's arguments, and the relative fragment matches every
 * other checkout's fixtures (see the header).
 */
export function fixtureMarkers(fixtureDir = FIXTURE_DIR) {
  try {
    return readdirSync(fixtureDir)
      .filter((name) => name.endsWith('.mjs') || name.endsWith('.js'))
      .map((name) => join(fixtureDir, name));
  } catch {
    return [];
  }
}

/**
 * The pids to reap from a `ps -axo pid=,ppid=,command=` listing. A marker must
 * be a whole command-line argument (followed by a space or the line end), so
 * `<root>/tests/fixtures/a.mjs` never matches `<root>/tests/fixtures/a.mjs.bak`.
 * Only orphans (parent pid 1) and descendants of `selfPid` qualify; see the header.
 */
export function reapablePids(listing, markers, selfPid = process.pid) {
  const procs = new Map();
  for (const line of String(listing).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), command: m[3] });
  }
  const descendsFromSelf = (pid) => {
    for (let p = procs.get(pid)?.ppid, hops = 0; p && p !== 1 && hops < 64; p = procs.get(p)?.ppid, hops++) {
      if (p === selfPid) return true;
    }
    return false;
  };
  const pids = [];
  for (const [pid, { ppid, command }] of procs) {
    if (!markers.some((mk) => command.includes(`${mk} `) || command.endsWith(mk))) continue;
    // Never signal ourselves, and never signal a whole process group: a
    // negative pid would reach the vitest runner itself.
    if (pid <= 0 || pid === selfPid) continue;
    if (ppid === 1 || descendsFromSelf(pid)) pids.push(pid);
  }
  return pids;
}

function reap(phase) {
  if (process.platform === 'win32') return 0;
  const markers = fixtureMarkers();
  if (markers.length === 0) return 0;

  let listing = '';
  try {
    listing = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf-8', timeout: 10_000 });
  } catch {
    return 0;
  }

  let killed = 0;
  for (const pid of reapablePids(listing, markers)) {
    try {
      process.kill(pid, 'SIGKILL');
      killed++;
    } catch { /* already gone */ }
  }
  if (killed > 0) {
    process.stderr.write(`[reap-test-fixtures] ${phase}: killed ${killed} orphaned fixture process(es)\n`);
  }
  return killed;
}

export function setup() {
  reap('pre-run');
}

export function teardown() {
  reap('post-run');
}

export default setup;
