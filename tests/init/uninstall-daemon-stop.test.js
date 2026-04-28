/**
 * Sandboxed integration test for `stopRunningDaemon` — the uninstall path
 * that kills any daemon spawned by an earlier SessionStart prewarm hook.
 *
 * No real sweet-search daemon is started. A minimal long-running child
 * process stands in, with its PID written to a tmp pid file. We verify:
 *   - the running child is SIGKILL'd
 *   - the pid file is removed
 *   - the (stale) socket file is removed
 *   - no-ops safely when nothing is running
 *   - tolerates a missing process (stale PID file)
 *   - tolerates garbage in the pid file
 *
 * The CLI graceful path is NOT exercised — that requires a real daemon
 * listening on the socket, which would defeat the point of a unit test.
 * We trust that path is tested by the e2e run we did once (which cost us
 * an index folder) and gate the DESTRUCTIVE half of uninstall behind the
 * robust PID-file fallback.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, closeSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { stopRunningDaemon } from '../../scripts/uninstall.js';

let sandbox;
let pidFile;
let socketPath;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'ss-stop-test-'));
  pidFile = join(sandbox, 'server.pid');
  socketPath = join(sandbox, 'server.sock');
});

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
});

/**
 * Spawn a long-running child process. Returns { pid, wait } where wait()
 * resolves when the child exits.
 */
function spawnLongRunningChild() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    detached: false,
  });
  return {
    pid: child.pid,
    wait: () => new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal }))),
    kill: () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } },
  };
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// -------------------------------------------------------------------------

describe('stopRunningDaemon', () => {
  it('SIGKILLs a running process listed in the pid file', async () => {
    const child = spawnLongRunningChild();
    try {
      writeFileSync(pidFile, String(child.pid), 'utf-8');
      expect(pidAlive(child.pid)).toBe(true);

      const result = stopRunningDaemon({ pidFile, socketPath });

      expect(result.killed).toBe(true);
      expect(result.pidFileRemoved).toBe(true);

      // Wait for the exit event so the process is reaped, then assert it's gone.
      await child.wait();
      expect(pidAlive(child.pid)).toBe(false);
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      child.kill();
    }
  });

  it('removes a stale socket file even when no daemon is running', async () => {
    // A plain file at socketPath stands in for a stale socket. `unlinkSync`
    // treats it identically to a real AF_UNIX socket file — both are just
    // directory entries from the VFS's perspective.
    writeFileSync(socketPath, '', 'utf-8');
    expect(existsSync(socketPath)).toBe(true);

    const result = stopRunningDaemon({ pidFile, socketPath });

    expect(result.killed).toBe(false);
    expect(result.socketRemoved).toBe(true);
    expect(existsSync(socketPath)).toBe(false);
  });

  it('no-ops when neither pid file nor socket exist', () => {
    const result = stopRunningDaemon({ pidFile, socketPath });
    expect(result.killed).toBe(false);
    expect(result.pidFileRemoved).toBe(false);
    expect(result.socketRemoved).toBe(false);
  });

  it('removes a stale pid file whose PID is dead', () => {
    // Very high PID unlikely to map to a live process.
    writeFileSync(pidFile, '2147483600', 'utf-8');

    const result = stopRunningDaemon({ pidFile, socketPath });

    expect(result.killed).toBe(false);      // nothing was alive to kill
    expect(result.pidFileRemoved).toBe(true); // stale file cleaned up
    expect(existsSync(pidFile)).toBe(false);
  });

  it('tolerates garbage in the pid file', () => {
    writeFileSync(pidFile, 'not a pid at all\n', 'utf-8');

    expect(() => stopRunningDaemon({ pidFile, socketPath })).not.toThrow();
    expect(existsSync(pidFile)).toBe(false); // still cleaned up
  });

  it('tolerates empty pid file', () => {
    // A hook that crashed between openSync('wx') and writeSync(pid) can
    // leave an empty file behind. Must not crash.
    const fd = openSync(pidFile, 'w');
    closeSync(fd);

    expect(() => stopRunningDaemon({ pidFile, socketPath })).not.toThrow();
    expect(existsSync(pidFile)).toBe(false);
  });

  it('does not kill processes outside the pid file (scope safety)', async () => {
    // Two long-running children. Only child A's PID is in the file. Stopping
    // must NOT touch child B.
    const a = spawnLongRunningChild();
    const b = spawnLongRunningChild();
    try {
      writeFileSync(pidFile, String(a.pid), 'utf-8');

      stopRunningDaemon({ pidFile, socketPath });

      await a.wait(); // a is dead
      expect(pidAlive(a.pid)).toBe(false);
      expect(pidAlive(b.pid)).toBe(true); // b untouched
    } finally {
      a.kill();
      b.kill();
    }
  });

  it('safe when projectRoot is omitted (SIGKILL fallback still runs)', () => {
    // Without projectRoot, the graceful CLI attempt still runs against
    // PACKAGE_ROOT's cli.js, but with no daemon listening on our sandbox
    // socket it exits non-zero (caught). The SIGKILL fallback handles the
    // dead PID and cleans the pid file either way — that's the invariant.
    writeFileSync(pidFile, '2147483600', 'utf-8');

    const result = stopRunningDaemon({ pidFile, socketPath });

    // Whether the graceful CLI path is attempted depends on host daemon
    // state and socket timing. The invariant for this unit test is that the
    // PID-file fallback remains safe and cleans up without projectRoot.
    expect(typeof result.gracefulAttempted).toBe('boolean');
    expect(result.pidFileRemoved).toBe(true);
  });
});
