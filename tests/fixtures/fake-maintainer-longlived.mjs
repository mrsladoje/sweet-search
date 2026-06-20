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

function stateDir() {
  if (process.env.SWEET_SEARCH_STATE_DIR) return process.env.SWEET_SEARCH_STATE_DIR;
  const root = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
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

// Stay alive indefinitely; the test kills us explicitly. A bare interval keeps
// the event loop busy without consuming CPU.
setInterval(() => {}, 1 << 30);
// Exit cleanly on termination so the test's afterEach kill is graceful.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
