#!/usr/bin/env node
/**
 * Long-lived fake index maintainer for daemon-lifecycle freshness-invariant
 * tests (T6). It does NOT touch the real indexer; it only:
 *   - writes index-maintainer.lock ({ pid, timestamp }) into the state dir,
 *     mirroring what the real maintainer holds, so launchMaintainer's
 *     maintainerAlive() liveness probe treats it as a running maintainer;
 *   - appends one line to FAKE_MAINTAINER_MARKER per launch so the test can
 *     count how many times the launcher actually spawned a maintainer
 *     (it must stay == 1 across a daemon cold-restart — no duplication);
 *   - stays alive until SIGTERM/SIGKILL so the test can assert it SURVIVES the
 *     search daemon's eviction/teardown (the detached-maintainer invariant).
 *
 * State dir resolution mirrors maintainer-launcher.resolveStateDir:
 *   SWEET_SEARCH_STATE_DIR, else <SWEET_SEARCH_PROJECT_ROOT|cwd>/.sweet-search.
 */

import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolve the state dir, but REFUSE to fall back to the current directory.
 *
 * The original version mirrored `maintainer-launcher.resolveStateDir` exactly,
 * including its `process.cwd()` fallback. That fallback is correct for the real
 * launcher and dangerous here: run this fixture by hand from a checkout and it
 * overwrites the developer's LIVE `index-maintainer.lock` with its own pid,
 * which evicts the real maintainer (it self-exits when the lock stops naming
 * it) and leaves a stale lock behind once the fixture is reaped. That is not
 * hypothetical — it happened while wiring up the reaper.
 *
 * The tests always pass one of these explicitly, so requiring it costs nothing
 * and converts a silent corruption of real state into a loud startup failure.
 */
function stateDir() {
  if (process.env.SWEET_SEARCH_STATE_DIR) return process.env.SWEET_SEARCH_STATE_DIR;
  const root = process.env.SWEET_SEARCH_PROJECT_ROOT;
  if (!root) {
    process.stderr.write(
      'fake-maintainer-longlived: refusing to run without SWEET_SEARCH_STATE_DIR or '
      + 'SWEET_SEARCH_PROJECT_ROOT — a cwd fallback would clobber a real index-maintainer.lock\n',
    );
    process.exit(2);
  }
  return join(root, '.sweet-search');
}

const dir = stateDir();
try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }

// Write the launch MARKER first, then the lock. Tests treat the lock as the
// "maintainer is up" signal; ordering marker-before-lock guarantees that once
// the lock exists the marker is already present, so a test that polls for the
// lock can read an accurate marker count without a startup race (matters under
// heavy CPU contention where these two writes could otherwise be observed
// between each other).
const marker = process.env.FAKE_MAINTAINER_MARKER;
if (marker) {
  try { appendFileSync(marker, `${process.pid}:${Date.now()}\n`); } catch { /* ignore */ }
}

const lockFile = join(dir, 'index-maintainer.lock');
try {
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), 'utf-8');
} catch { /* best-effort */ }

// Keep the heartbeat fresh, like the real maintainer's 30s lock refresh. This
// is load-bearing, not decoration: `maintainerAlive` no longer trusts a pid
// probe alone (an unreaped zombie reports as alive), so a lock whose timestamps
// stop advancing eventually reads as dead. A fixture that wrote its lock once
// and then sat there would drift out of "alive" mid-test and stop modelling the
// thing it stands in for.
setInterval(() => {
  try {
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), 'utf-8');
  } catch { /* best-effort */ }
}, 5000);
// Exit cleanly on termination so the test's afterEach kill is graceful.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
