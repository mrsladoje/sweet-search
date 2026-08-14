#!/usr/bin/env node
/**
 * A PROCESS THAT JOINS THE RSS FLEET, so eviction can be tested across real
 * process boundaries.
 *
 * The coordinator is peer-to-peer: every registered daemon runs its own timer,
 * reads the shared registry, and SIGTERMs the longest-idle peer when the fleet
 * is over budget. None of that can be exercised in one process, and none of it
 * can be exercised with the real maintainer either without building a real
 * index and loading a model for every member of the fleet.
 *
 * This registers exactly the way `index-maintainer.mjs` does, and optionally
 * refreshes its activity stamp the way a maintainer that is doing indexing work
 * now does. That difference is the whole point of the test: the member that
 * keeps working must not be the one that gets shed.
 *
 * Usage:
 *   node fleet-member.mjs <label> <markerFile> [touchEveryMs]
 *
 * `touchEveryMs` of 0 (or absent) means "never refresh" — an idle maintainer.
 * Writes `<label> <event>` lines to the marker file so the soak can see who
 * registered, who was signalled, and who exited.
 */

import { appendFileSync } from 'node:fs';

const [label, markerFile, touchEveryRaw] = process.argv.slice(2);
const touchEveryMs = Number(touchEveryRaw) || 0;

const note = (event) => {
  try { appendFileSync(markerFile, `${label} ${event} ${process.pid} ${Date.now()}\n`); } catch { /* ignore */ }
};

const { registerDaemon } = await import(`${process.env.REPO_DIR}/core/indexing/rss-budget.mjs`);

const registration = await registerDaemon({
  pid: process.pid,
  stateDir: `/tmp/fleet-${label}`,
  kind: 'maintainer',
});
note('registered');

// A member that "works": refreshes its stamp, exactly as the maintainer does on
// a tick that had real indexing to do.
let touchTimer = null;
if (touchEveryMs > 0) {
  touchTimer = setInterval(() => {
    Promise.resolve(registration.touch()).catch(() => {});
    note('touched');
  }, touchEveryMs);
}

// Exit cleanly on SIGTERM, like a real daemon being shed. Recording it BEFORE
// unregistering means the soak can tell "was signalled" from "vanished".
const bye = async () => {
  note('sigterm');
  if (touchTimer) clearInterval(touchTimer);
  try { await registration.unregister(); } catch { /* best-effort */ }
  note('exited');
  process.exit(0);
};
process.on('SIGTERM', bye);
process.on('SIGINT', bye);

// Stay resident.
setInterval(() => {}, 1 << 30);
