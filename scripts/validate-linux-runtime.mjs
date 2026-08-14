/**
 * Validate, ON LINUX, the fixes that macOS cannot exercise.
 *
 * Three of the changes target conditions this project has only ever reasoned
 * about:
 *   - `os.tmpdir()` is `/tmp` on Linux, and `/tmp` is world-writable. That is
 *     the environment in which the old registry location was actually
 *     dangerous; on macOS `os.tmpdir()` is already a private per-user directory,
 *     so the bug could not be reproduced there at all.
 *   - a container whose PID 1 does not reap leaves ZOMBIES, and
 *     `process.kill(pid, 0)` reports a zombie as alive.
 *   - a service account with an unwritable HOME must still get a trustworthy
 *     runtime directory, or the footprint controls switch themselves off while
 *     still looking configured.
 *
 * Pure node builtins only: no npm install, no native modules, no vitest. That is
 * what makes it runnable in any node image against a read-only mount of this
 * repository, which is the whole point — the darwin-arm64 native modules in
 * node_modules cannot be loaded on Linux, so the ordinary suite cannot go there
 * without a full rebuild.
 *
 * HOW TO RUN (colima or any docker):
 *
 *   colima start --cpu 4 --memory 8
 *   docker run --rm --platform linux/arm64 \
 *     --user 1000:1000 -e HOME=/home/node \
 *     -v "$PWD":/repo:ro -e REPO_DIR=/repo \
 *     node:20-slim node /repo/scripts/validate-linux-runtime.mjs
 *
 * Run it UNPRIVILEGED. As root a broken HOME is still writable, so the fallback
 * branch cannot be reached and that check quietly tests nothing (it skips
 * itself rather than pretending). Being PID 1 in the container is also
 * load-bearing: it is what lets an orphaned child become a real zombie.
 *
 * Exits non-zero if any check fails.
 */

import { mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const REPO = process.env.REPO_DIR || '/repo';
const reg = await import(`${REPO}/core/search/daemon-registry.js`);
const launcher = await import(`${REPO}/core/indexing/maintainer-launcher.mjs`);
const rss = await import(`${REPO}/core/indexing/rss-budget.mjs`);
const tiers = await import(`${REPO}/core/incremental-indexing/domain/interval-autotune.mjs`);

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const info = (name, value) => console.log(`      ${name}: ${value}`);

console.log('=== environment ===');
info('platform', `${os.platform()} ${os.release()}`);
info('os.tmpdir()', os.tmpdir());
info('totalmem', `${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`);
info('uid', process.getuid());
info('pid', `${process.pid}${process.pid === 1 ? '  (WE ARE PID 1)' : ''}`);
const tmpMode = statSync('/tmp').mode & 0o7777;
info('/tmp mode', `0${tmpMode.toString(8)}`);
check('/tmp is world-writable on this host (the hazard is real here)', (tmpMode & 0o002) !== 0, true);
check('os.tmpdir() is /tmp on Linux', os.tmpdir(), '/tmp');

console.log('\n=== 1. the old registry location is refused ===');
// Exactly what the code used to do by default: a file at a fixed path in /tmp.
const legacyPath = '/tmp/sweet-search-daemons.json';
writeFileSync(legacyPath, JSON.stringify({
  daemons: { 4242: { pid: 4242, socketPath: '/tmp/attacker.sock', startedAt: Date.now(), lastActivityMs: 1 } },
}), { mode: 0o600 });
check('a 0600 file we own in /tmp is still NOT trusted (the dir is writable by anyone)',
  reg.registryTrustworthy(legacyPath), false);
check('reading it yields nothing, not its entries',
  await reg.readRegistry({ SWEET_SEARCH_DAEMON_REGISTRY: legacyPath }), {});

const signalled = [];
const tick = await rss.runEvictionTick({
  env: { SWEET_SEARCH_RSS_REGISTRY: legacyPath, SWEET_SEARCH_RSS_BUDGET_FRACTION: '0.6' },
  selfPid: 1,
  totalMem: 16 * 1024 ** 3,
  rssReader: async () => 99 * 1024 ** 3,   // wildly over budget
  pressureReader: async () => null,
  aliveProbe: () => true,
  signal: (pid) => signalled.push(pid),
});
check('nobody is SIGTERMed from an untrusted registry even when far over budget', signalled, []);
check('  ...and the tick reports no eviction', tick.evicted, null);
rmSync(legacyPath, { force: true });

console.log('\n=== 2. the new default location is trusted ===');
const defaultPath = reg.registryPath({});
info('registryPath({})', defaultPath);
check('default registry is NOT under /tmp', defaultPath.startsWith('/tmp/'), false);
check('default registry IS trusted', reg.registryTrustworthy(defaultPath), true);
check('writing there works', await reg.upsertSelf(
  { pid: process.pid, projectRoot: '/x', socketPath: '/x.sock', pidFile: '/x.pid', startedAt: Date.now(), lastActivityMs: Date.now() },
  {}), true);

console.log('\n=== 3. unwritable HOME still yields a trustworthy dir ===');
// A service account whose HOME does not exist. Returning an unusable path would
// silently disable the footprint controls while they still looked configured.
if (process.getuid() === 0) {
  // root can create a directory anywhere, so a broken HOME never fails and the
  // fallback cannot be reached. Asserting here would test nothing.
  console.log('SKIP  running as root; a broken HOME is still writable, so the fallback cannot trigger');
} else {
  const savedHome = process.env.HOME;
  process.env.HOME = '/nonexistent-home-for-this-test';
  const fallback = reg.privateRuntimeDir({});
  info('privateRuntimeDir with broken HOME', fallback);
  check('falls back to a per-uid dir inside the temp dir', fallback, `/tmp/sweet-search-${process.getuid()}`);
  if (fallback === `/tmp/sweet-search-${process.getuid()}`) {
    const fbMode = statSync(fallback).mode & 0o7777;
    info('fallback mode', `0${fbMode.toString(8)}`);
    check('fallback is 0700', fbMode, 0o700);
    check('fallback IS trusted, even though its parent /tmp is not',
      reg.registryTrustworthy(path.join(fallback, 'daemons.json')), true);
  }
  process.env.HOME = savedHome;
}

console.log('\n=== 4. zombies: the Linux hazard, and the fix ===');
// This reproduces the REAL scenario rather than a textbook one. The maintainer
// is spawned detached and its launcher exits, so the maintainer is reparented
// to PID 1. Here: `sh` backgrounds a sleep and exits immediately, orphaning it;
// the orphan is reparented to PID 1, which in this container is US. libuv only
// reaps processes IT spawned, so when the orphan exits nobody reaps it — and it
// becomes exactly the zombie that a pid probe would call alive.
//
// (A shell that backgrounds a child and then sleeps does NOT work: dash reaps
// its own background jobs promptly.)
const zombieMaker = spawn('sh', ['-c', 'sleep 2 &'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));

let zombiePid = null;
for (const name of readdirSync('/proc')) {
  if (!/^\d+$/.test(name)) continue;
  try {
    const stat = readFileSync(`/proc/${name}/stat`, 'utf-8');
    // state is the field after the (comm) parenthesis
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
    if (state === 'Z') { zombiePid = Number(name); break; }
  } catch { /* vanished */ }
}

if (zombiePid == null) {
  console.log('FAIL  no zombie could be produced; the zombie assertions did not run');
  failures++;
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf-8');
      const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
      const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
      info(`  /proc/${name}`, `${comm} state=${state}`);
    } catch { /* vanished */ }
  }
} else {
  info('zombie pid', zombiePid);
  let probeSaysAlive = false;
  try { process.kill(zombiePid, 0); probeSaysAlive = true; } catch { probeSaysAlive = false; }
  check('process.kill(zombie, 0) reports it ALIVE (this is why a pid probe alone is unsafe)',
    probeSaysAlive, true);

  const zDir = '/tmp/zombie-state';
  rmSync(zDir, { recursive: true, force: true });
  mkdirSync(zDir, { recursive: true });

  // A lock naming the zombie, whose timestamps stopped advancing when it died.
  writeFileSync(path.join(zDir, 'index-maintainer.lock'), JSON.stringify({
    pid: zombiePid,
    timestamp: Date.now() - 30 * 60 * 1000,
    progressTimestamp: Date.now() - 30 * 60 * 1000,
  }));
  check('maintainerAlive refuses the zombie, so supervision will replace it',
    launcher.maintainerAlive(zDir), false);

  // Not vacuous: the same pid with a fresh heartbeat must still read as alive.
  writeFileSync(path.join(zDir, 'index-maintainer.lock'), JSON.stringify({
    pid: zombiePid, timestamp: Date.now(), progressTimestamp: Date.now(),
  }));
  check('  ...but a fresh heartbeat is still believed (the check is not just "always false")',
    launcher.maintainerAlive(zDir), true);
  rmSync(zDir, { recursive: true, force: true });
}
try { zombieMaker.kill('SIGKILL'); } catch { /* gone */ }

console.log('\n=== 5. boot filter uses Linux uptime correctly ===');
info('os.uptime()', `${Math.round(os.uptime())}s`);
check('an entry stamped now survives', reg.entryPredatesBoot({ startedAt: Date.now() }), false);
check('an entry stamped in 1970 is dropped', reg.entryPredatesBoot({ startedAt: 1 }), true);
check('an entry with no stamp is dropped', reg.entryPredatesBoot({}), true);

console.log('\n=== 6. RAM tier resolves on this host ===');
const prof = tiers.resolveMaintainerMemoryProfile({ totalMemBytes: os.totalmem() });
info('tier', `${prof.tier} (${prof.totalGiB} GiB) idleTtl=${prof.idleTtlMs}ms`);
check('every tier has a finite positive idle TTL',
  [4, 16, 32, 64, 128, 512].every((g) => {
    const p = tiers.resolveMaintainerMemoryProfile({ totalMemBytes: g * 1024 ** 3 });
    return Number.isFinite(p.idleTtlMs) && p.idleTtlMs > 0;
  }), true);

console.log(`\n=== ${failures === 0 ? 'ALL LINUX CHECKS PASSED' : `${failures} LINUX CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
