/**
 * Tests for the SessionStart daemon-prewarm hook.
 *
 * Covers the hook's own logic — separate from the settings.json install
 * logic covered in tests/init/prewarm-hook.test.js. Uses env overrides
 * (SWEET_SEARCH_SERVER_ENTRY / _PID_FILE / _SOCKET_PATH / _PREWARM_LOCK)
 * so we exercise the real code path against isolated tmp paths and a
 * fake daemon fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const HOOK = join(REPO_ROOT, 'core', 'search', 'session-daemon-prewarm.mjs');
const FAKE_DAEMON = join(REPO_ROOT, 'tests', 'fixtures', 'fake-daemon.mjs');
const FAST_EXIT_TIMEOUT_MS = Number(process.env.SWEET_SEARCH_TEST_PREWARM_FAST_EXIT_MS || 2000);

let sandbox;
let markerPath;
let pidFile;
let socketPath;
let lockPath;

function env(overrides = {}) {
  return {
    ...process.env,
    SWEET_SEARCH_SERVER_ENTRY: FAKE_DAEMON,
    SWEET_SEARCH_PID_FILE: pidFile,
    SWEET_SEARCH_SOCKET_PATH: socketPath,
    SWEET_SEARCH_PREWARM_LOCK: lockPath,
    SWEET_SEARCH_PREWARM_PROBE_MS: '100',
    FAKE_DAEMON_MARKER: markerPath,
    ...overrides,
  };
}

function runHook(envOverrides = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [HOOK], {
      env: env(envOverrides),
      stdio: 'pipe',
    });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d));
    p.on('exit', (code) => resolve({ code, stderr, wallMs: Date.now() - t0 }));
  });
}

/** Wait until the marker file has N lines, up to timeoutMs. Returns the lines. */
async function waitForMarkerLines(n, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) {
      const lines = readFileSync(markerPath, 'utf-8').split('\n').filter(Boolean);
      if (lines.length >= n) return lines;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return existsSync(markerPath)
    ? readFileSync(markerPath, 'utf-8').split('\n').filter(Boolean)
    : [];
}

/** Start a unix socket server that just accepts + immediately drops connections. */
function startDummySocketServer(path) {
  const server = net.createServer((sock) => sock.end());
  return new Promise((resolve) => {
    server.listen(path, () => resolve(server));
  });
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'ss-prewarm-test-'));
  markerPath = join(sandbox, 'marker.log');
  pidFile = join(sandbox, 'server.pid');
  socketPath = join(sandbox, 'server.sock');
  lockPath = join(sandbox, 'prewarm.lock');
});

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------

describe('session-daemon-prewarm', () => {
  it('spawns the daemon when no PID file exists', async () => {
    const r = await runHook();

    expect(r.code).toBe(0);
    expect(r.wallMs).toBeLessThan(FAST_EXIT_TIMEOUT_MS);

    const lines = await waitForMarkerLines(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('--serve');
  });

  it('exits fast even when spawning a daemon', async () => {
    const r = await runHook();
    expect(r.code).toBe(0);
    expect(r.wallMs).toBeLessThan(FAST_EXIT_TIMEOUT_MS);
  });

  it('skips spawn when PID file points at a live process AND socket is responsive', async () => {
    // Use this test process's PID — it's definitely alive.
    writeFileSync(pidFile, String(process.pid), 'utf-8');
    const server = await startDummySocketServer(socketPath);

    try {
      const r = await runHook();
      expect(r.code).toBe(0);
      // No marker means no spawn happened.
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      server.close();
      try { unlinkSync(socketPath); } catch { /* ignore */ }
    }
  });

  it('spawns when PID file points at a live process but socket is unresponsive (stuck daemon)', async () => {
    writeFileSync(pidFile, String(process.pid), 'utf-8');
    // No socket listener → socket probe fails → we spawn anyway.

    const r = await runHook();
    expect(r.code).toBe(0);

    const lines = await waitForMarkerLines(1);
    expect(lines).toHaveLength(1);
  });

  it('spawns when PID file points at a dead process', async () => {
    // A very high PID unlikely to be in use (macOS ceiling is typically 99998).
    writeFileSync(pidFile, '2147483600', 'utf-8');

    const r = await runHook();
    expect(r.code).toBe(0);

    const lines = await waitForMarkerLines(1);
    expect(lines).toHaveLength(1);
  });

  it('spawns when PID file contains non-numeric garbage', async () => {
    writeFileSync(pidFile, 'not a number at all\n', 'utf-8');

    const r = await runHook();
    expect(r.code).toBe(0);

    const lines = await waitForMarkerLines(1);
    expect(lines).toHaveLength(1);
  });

  it('exits 0 without spawning when SERVER_ENTRY is missing', async () => {
    const bogus = join(sandbox, 'does-not-exist.mjs');
    const r = await runHook({ SWEET_SEARCH_SERVER_ENTRY: bogus });
    expect(r.code).toBe(0);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('is idempotent: two hooks run back-to-back, only one daemon spawns', async () => {
    const r1 = await runHook();
    expect(r1.code).toBe(0);
    const firstLines = await waitForMarkerLines(1);
    expect(firstLines).toHaveLength(1);

    // Simulate daemon up: point PID file at us + start a dummy socket server.
    writeFileSync(pidFile, String(process.pid), 'utf-8');
    const server = await startDummySocketServer(socketPath);

    try {
      const r2 = await runHook();
      expect(r2.code).toBe(0);
      // Marker still has exactly 1 line — second hook did not spawn.
      const lines = readFileSync(markerPath, 'utf-8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
    } finally {
      server.close();
      try { unlinkSync(socketPath); } catch { /* ignore */ }
    }
  });

  it('bails out when an active lockfile held by a live process already exists', async () => {
    // A live, foreign "hook" is mid-acquire. Our hook must NOT steal the lock.
    writeFileSync(lockPath, String(process.pid), 'utf-8');

    const r = await runHook();
    expect(r.code).toBe(0);
    // No spawn — the held lock stopped us.
    expect(existsSync(markerPath)).toBe(false);
    // We did not overwrite the lockfile either.
    expect(readFileSync(lockPath, 'utf-8').trim()).toBe(String(process.pid));
  });

  it('steals a stale lockfile whose PID is dead', async () => {
    // Unused high PID → "dead" holder. Lock is stale, we should acquire.
    writeFileSync(lockPath, '2147483600', 'utf-8');

    const r = await runHook();
    expect(r.code).toBe(0);

    const lines = await waitForMarkerLines(1);
    expect(lines).toHaveLength(1);
  });

  it('bails out when the lockfile is empty (holder is mid-write)', async () => {
    // An empty lockfile means another hook did openSync('wx') but hasn't
    // writeSync'd its PID yet. Stealing would race them — we must bail.
    writeFileSync(lockPath, '', 'utf-8');

    const r = await runHook();
    expect(r.code).toBe(0);
    expect(existsSync(markerPath)).toBe(false);
  });
});
