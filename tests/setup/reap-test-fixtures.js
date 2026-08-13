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
 * file that actually exists in tests/fixtures/. The list is READ FROM THE
 * DIRECTORY rather than hardcoded — a hardcoded list silently rots in both
 * directions, and this one already had: it named two fixtures that no longer
 * existed while missing `fake-daemon.mjs`, which does.
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
 * Returns path fragments (`tests/fixtures/<name>`) rather than bare filenames
 * on purpose: a bare name like `fake-daemon.mjs` could appear in an unrelated
 * process's arguments, while the directory-qualified fragment cannot plausibly
 * belong to anything but this repository's scaffolding.
 */
function fixtureMarkers() {
  try {
    return readdirSync(FIXTURE_DIR)
      .filter((name) => name.endsWith('.mjs') || name.endsWith('.js'))
      .map((name) => `tests/fixtures/${name}`);
  } catch {
    return [];
  }
}

function reap(phase) {
  if (process.platform === 'win32') return 0;
  const markers = fixtureMarkers();
  if (markers.length === 0) return 0;

  let listing = '';
  try {
    listing = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf-8', timeout: 10_000 });
  } catch {
    return 0;
  }

  let killed = 0;
  for (const line of listing.split('\n')) {
    if (!markers.some((m) => line.includes(m))) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    // Never signal ourselves, and never signal a whole process group: a
    // negative pid would reach the vitest runner itself.
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
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
