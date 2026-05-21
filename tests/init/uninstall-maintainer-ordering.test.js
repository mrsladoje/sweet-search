/**
 * End-to-end ordering test for `runUninstall` (B2 regression).
 *
 * The bug: uninstall removed `.sweet-search/` (which holds
 * `index-maintainer.lock`) BEFORE calling `stopRunningMaintainer()`, so the
 * stop step had no pid to signal — the maintainer leaked and, because its tick
 * loop does `mkdirSync(stateDir)`, it RESURRECTED the directory uninstall had
 * just deleted.
 *
 * This exercises the real `runUninstall` flow (not just the `stopRunningMaintainer`
 * unit) against a sandbox project with a stand-in maintainer that recreates
 * `.sweet-search/` + its lock on a fast interval — exactly the resurrection
 * behavior. The discriminating assertion is that the state dir stays GONE:
 *   - new order: maintainer killed BEFORE deletion → dir removed, never recreated.
 *   - old order: dir deleted, then the still-alive child recreates it → dir present.
 *
 * Global daemon pid/socket paths are pointed at throwaway sandbox files BEFORE
 * importing uninstall.js, so this can never touch a real dev server.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate the global daemon stop from any real server. These are read into
// module-level consts when uninstall.js is first imported (below, dynamically),
// so they must be set before that import runs.
process.env.SWEET_SEARCH_PID_FILE = join(tmpdir(), 'ss-uninstall-order-daemon.pid');
process.env.SWEET_SEARCH_SOCKET_PATH = join(tmpdir(), 'ss-uninstall-order-daemon.sock');

const { runUninstall } = await import('../../scripts/uninstall.js');

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('runUninstall ordering — maintainer stopped before .sweet-search removed', () => {
  let sandbox;
  let stateDir;
  let lockFile;
  let child;
  let cwd0;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'ss-uninstall-order-'));
    stateDir = join(sandbox, '.sweet-search');
    lockFile = join(stateDir, 'index-maintainer.lock');
    mkdirSync(stateDir, { recursive: true });
    // package.json keeps detectProjectRoot() pinned to the sandbox.
    writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ name: 'sandbox' }), 'utf-8');
    cwd0 = process.cwd();
  });

  afterEach(() => {
    if (child) { try { child.kill('SIGKILL'); } catch { /* gone */ } child = null; }
    try { process.chdir(cwd0); } catch { /* ignore */ }
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('kills the maintainer and the state dir is not resurrected', async () => {
    // Stand-in maintainer: records its pid in the lock and, every 40ms,
    // recreates .sweet-search/ + the lock (the mkdirSync-per-tick behavior that
    // made the old uninstall order resurrect the deleted dir).
    const standin = `
      const fs = require('fs');
      const dir = ${JSON.stringify(stateDir)};
      const lock = ${JSON.stringify(lockFile)};
      const write = () => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, timestamp: Date.now() })); };
      write();
      setInterval(write, 40);
    `;
    child = spawn(process.execPath, ['-e', standin], { stdio: 'ignore' });
    await sleep(200);
    expect(existsSync(lockFile)).toBe(true);
    expect(pidAlive(child.pid)).toBe(true);

    process.chdir(sandbox);
    await runUninstall(['--force', '--keep-models']);

    // SIGKILL escalation needs a brief grace window.
    await sleep(250);
    expect(pidAlive(child.pid)).toBe(false);

    // Because the maintainer was killed BEFORE deletion, it cannot recreate the
    // state dir. Wait several tick intervals to be sure no resurrection occurs.
    await sleep(250);
    expect(existsSync(stateDir)).toBe(false);
  });
});
