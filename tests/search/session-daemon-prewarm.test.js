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
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
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
    // Neutralize the maintainer auto-launch for the server-focused tests by
    // pointing it at a non-existent entry (the hook no-ops on a missing
    // entry). The dedicated maintainer suite below overrides this.
    SWEET_SEARCH_MAINTAINER_ENTRY: join(sandbox, 'no-such-maintainer.mjs'),
    SWEET_SEARCH_PID_FILE: pidFile,
    SWEET_SEARCH_SOCKET_PATH: socketPath,
    SWEET_SEARCH_PREWARM_LOCK: lockPath,
    SWEET_SEARCH_PREWARM_PROBE_MS: '100',
    FAKE_DAEMON_MARKER: markerPath,
    ...overrides,
  };
}

/** Wait until a specific file has N non-empty lines, up to timeoutMs. */
async function waitForLines(file, n, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      if (lines.length >= n) return lines;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return existsSync(file)
    ? readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    : [];
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

// ---------------------------------------------------------------------------
// Maintainer auto-launch (default-on incremental indexing)
// ---------------------------------------------------------------------------

describe('session-daemon-prewarm — maintainer auto-launch', () => {
  let stateDir;
  let maintainerMarker;

  /** Env that skips the server spawn so we exercise only the maintainer. */
  function maintainerEnv(overrides = {}) {
    return env({
      // Bogus server entry → server spawn no-ops; isolates the maintainer.
      SWEET_SEARCH_SERVER_ENTRY: join(sandbox, 'no-such-server.mjs'),
      SWEET_SEARCH_MAINTAINER_ENTRY: FAKE_DAEMON,
      SWEET_SEARCH_STATE_DIR: stateDir,
      SWEET_SEARCH_PROJECT_ROOT: sandbox,
      FAKE_DAEMON_MARKER: maintainerMarker,
      // Force default-on regardless of the runner's ambient env.
      SWEET_SEARCH_RECONCILE_V2: '',
      ...overrides,
    });
  }

  function runMaintainerHook(overrides = {}) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const p = spawn(process.execPath, [HOOK], { env: maintainerEnv(overrides), stdio: 'pipe' });
      let stderr = '';
      p.stderr.on('data', (d) => (stderr += d));
      p.on('exit', (code) => resolve({ code, stderr, wallMs: Date.now() - t0 }));
    });
  }

  beforeEach(() => {
    stateDir = join(sandbox, '.sweet-search');
    maintainerMarker = join(sandbox, 'maintainer.log');
    mkdirSync(stateDir, { recursive: true });
  });

  it('spawns the maintainer by default when the state dir exists', async () => {
    const r = await runMaintainerHook();
    expect(r.code).toBe(0);
    expect(r.wallMs).toBeLessThan(FAST_EXIT_TIMEOUT_MS);

    const lines = await waitForLines(maintainerMarker, 1);
    expect(lines).toHaveLength(1);
    // Maintainer is spawned as a daemon (no --serve, no --once).
    expect(lines[0]).not.toContain('--serve');
    expect(lines[0]).not.toContain('--once');
  });

  it('does NOT spawn the maintainer when opted out (SWEET_SEARCH_RECONCILE_V2=0)', async () => {
    const r = await runMaintainerHook({ SWEET_SEARCH_RECONCILE_V2: '0' });
    expect(r.code).toBe(0);
    // Give a doomed spawn a chance to (not) write the marker.
    const lines = await waitForLines(maintainerMarker, 1, 600);
    expect(lines).toHaveLength(0);
    expect(existsSync(maintainerMarker)).toBe(false);
  });

  it('does NOT spawn the maintainer when the project has no index state dir', async () => {
    rmSync(stateDir, { recursive: true, force: true });
    const r = await runMaintainerHook();
    expect(r.code).toBe(0);
    const lines = await waitForLines(maintainerMarker, 1, 600);
    expect(lines).toHaveLength(0);
  });

  it('skips the maintainer when a live lock is already held', async () => {
    // This test process's PID is definitely alive → the hook treats the
    // maintainer as already running and does not spawn a duplicate.
    writeFileSync(
      join(stateDir, 'index-maintainer.lock'),
      JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
      'utf-8',
    );
    const r = await runMaintainerHook();
    expect(r.code).toBe(0);
    const lines = await waitForLines(maintainerMarker, 1, 600);
    expect(lines).toHaveLength(0);
  });

  it('still spawns the maintainer when the lock is stale (dead pid)', async () => {
    writeFileSync(
      join(stateDir, 'index-maintainer.lock'),
      JSON.stringify({ pid: 2147483600, timestamp: Date.now() }),
      'utf-8',
    );
    const r = await runMaintainerHook();
    expect(r.code).toBe(0);
    const lines = await waitForLines(maintainerMarker, 1);
    expect(lines).toHaveLength(1);
  });

  it('starts the server and the maintainer independently on a fresh session', async () => {
    // Both spawn paths active, sharing one marker (server writes --serve,
    // maintainer does not). Proves the two launches are independent.
    const r = await runHook({
      SWEET_SEARCH_SERVER_ENTRY: FAKE_DAEMON,
      SWEET_SEARCH_MAINTAINER_ENTRY: FAKE_DAEMON,
      SWEET_SEARCH_STATE_DIR: stateDir,
      SWEET_SEARCH_PROJECT_ROOT: sandbox,
      SWEET_SEARCH_RECONCILE_V2: '',
    });
    expect(r.code).toBe(0);

    const lines = await waitForLines(markerPath, 2);
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes('--serve'))).toBe(true);
    expect(lines.some((l) => !l.includes('--serve'))).toBe(true);
  });
});
