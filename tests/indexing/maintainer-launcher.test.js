/**
 * Tests for the shared maintainer launcher
 * (core/indexing/maintainer-launcher.mjs) — the single, idempotent entry point
 * that the warm search-server, the prewarm hook, and (optional) MCP all use to
 * start the default-on reconcile maintainer.
 *
 * These exercise the durable, non-MCP startup contract directly: opt-out, no
 * state dir, live-lock skip, stale-lock proceed, detached spawn, and the
 * stdout-clean guarantee. (The end-to-end "warm server first-use starts it" is
 * covered by the disposable smoke; here we test the logic the server calls.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Spy on the background-priority helper so we can assert the launcher calls it
// with the spawned child's pid (research §4.A A.2/A.3, default-on Tier-1 gate).
const applyBackgroundPriorityMock = vi.fn();
vi.mock('../../core/indexing/os-priority.mjs', () => ({
  applyBackgroundPriority: (...args) => applyBackgroundPriorityMock(...args),
  loadNativePriorityAddon: () => null,
}));

import {
  launchMaintainer,
  resolveStateDir,
  maintainerAlive,
  defaultMaintainerEntry,
} from '../../core/indexing/maintainer-launcher.mjs';

const FAKE_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-daemon.mjs');

let sandbox;
let stateDir;
let marker;

function baseEnv(overrides = {}) {
  return {
    ...process.env,
    SWEET_SEARCH_STATE_DIR: stateDir,
    FAKE_DAEMON_MARKER: marker,
    SWEET_SEARCH_RECONCILE_V2: '', // default-on unless a test overrides
    SWEET_SEARCH_PREWARM_VERBOSE: '',
    ...overrides,
  };
}

async function waitForLines(file, n, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      if (lines.length >= n) return lines;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return existsSync(file) ? readFileSync(file, 'utf-8').split('\n').filter(Boolean) : [];
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'ss-launcher-'));
  stateDir = join(sandbox, '.sweet-search');
  marker = join(sandbox, 'maintainer.log');
  applyBackgroundPriorityMock.mockReset();
});

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('launchMaintainer', () => {
  it('spawns the maintainer when .sweet-search exists and reconcile v2 is default-on', async () => {
    mkdirSync(stateDir, { recursive: true });
    const r = launchMaintainer({ env: baseEnv(), cwd: sandbox, maintainerEntry: FAKE_ENTRY });
    expect(r.reason).toBe('spawned');
    expect(r.spawned).toBe(true);
    expect(typeof r.pid).toBe('number');
    const lines = await waitForLines(marker, 1);
    expect(lines).toHaveLength(1);
    // Spawned as a daemon: no --serve / --once args.
    expect(lines[0]).not.toContain('--serve');
    expect(lines[0]).not.toContain('--once');
  });

  it('does NOT spawn when reconcile v2 is opted out (0 / false / off)', async () => {
    mkdirSync(stateDir, { recursive: true });
    for (const v of ['0', 'false', 'off', 'OFF']) {
      const r = launchMaintainer({ env: baseEnv({ SWEET_SEARCH_RECONCILE_V2: v }), cwd: sandbox, maintainerEntry: FAKE_ENTRY });
      expect(r.spawned).toBe(false);
      expect(r.reason).toBe('opted-out');
    }
    const lines = await waitForLines(marker, 1, 400);
    expect(lines).toHaveLength(0);
  });

  it('does NOT spawn when the project has no .sweet-search state dir', async () => {
    // stateDir intentionally not created.
    const r = launchMaintainer({ env: baseEnv(), cwd: sandbox, maintainerEntry: FAKE_ENTRY });
    expect(r.spawned).toBe(false);
    expect(r.reason).toBe('no-state-dir');
  });

  it('does NOT spawn when the maintainer entry is missing', () => {
    mkdirSync(stateDir, { recursive: true });
    const r = launchMaintainer({ env: baseEnv(), cwd: sandbox, maintainerEntry: join(sandbox, 'nope.mjs') });
    expect(r.spawned).toBe(false);
    expect(r.reason).toBe('entry-missing');
  });

  it('does NOT spawn when a live maintainer already holds the lock (no duplicate)', async () => {
    mkdirSync(stateDir, { recursive: true });
    // This test process's pid is alive → treated as a running maintainer.
    writeFileSync(join(stateDir, 'index-maintainer.lock'), JSON.stringify({ pid: process.pid, timestamp: Date.now() }), 'utf-8');
    const r = launchMaintainer({ env: baseEnv(), cwd: sandbox, maintainerEntry: FAKE_ENTRY });
    expect(r.spawned).toBe(false);
    expect(r.reason).toBe('already-running');
    const lines = await waitForLines(marker, 1, 400);
    expect(lines).toHaveLength(0);
  });

  it('still spawns when the lock is stale (dead pid) — does not permanently block', async () => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'index-maintainer.lock'), JSON.stringify({ pid: 2147483600, timestamp: Date.now() }), 'utf-8');
    const r = launchMaintainer({ env: baseEnv(), cwd: sandbox, maintainerEntry: FAKE_ENTRY });
    expect(r.spawned).toBe(true);
    expect(r.reason).toBe('spawned');
    const lines = await waitForLines(marker, 1);
    expect(lines).toHaveLength(1);
  });

  it('is stdout-clean (writes nothing to stdout), even in verbose mode', () => {
    mkdirSync(stateDir, { recursive: true });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      launchMaintainer({ env: baseEnv(), cwd: sandbox, maintainerEntry: FAKE_ENTRY, verbose: true });
      expect(stdoutSpy).not.toHaveBeenCalled();
      // verbose routes to stderr (acceptable for machine-readable stdout).
      expect(stderrSpy).toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it('is silent on stdout AND stderr when not verbose', () => {
    mkdirSync(stateDir, { recursive: true });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      launchMaintainer({ env: baseEnv(), cwd: sandbox, maintainerEntry: FAKE_ENTRY, verbose: false });
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it('starts the maintainer with no MCP dependency (durable path is MCP-free)', async () => {
    // This module imports nothing from mcp/. A successful spawn here proves the
    // durable startup path works without MCP being installed or configured.
    mkdirSync(stateDir, { recursive: true });
    const r = launchMaintainer({ env: baseEnv(), cwd: sandbox, maintainerEntry: FAKE_ENTRY });
    expect(r.spawned).toBe(true);
    expect((await waitForLines(marker, 1))).toHaveLength(1);
  });
});

describe('launchMaintainer helpers', () => {
  it('resolveStateDir prefers SWEET_SEARCH_STATE_DIR, then PROJECT_ROOT, then cwd', () => {
    expect(resolveStateDir({ SWEET_SEARCH_STATE_DIR: '/x/state' }, '/cwd')).toBe('/x/state');
    expect(resolveStateDir({ SWEET_SEARCH_PROJECT_ROOT: '/proj' }, '/cwd')).toBe(join('/proj', '.sweet-search'));
    expect(resolveStateDir({}, '/cwd')).toBe(join('/cwd', '.sweet-search'));
  });

  it('maintainerAlive is false for absent / dead-pid locks', () => {
    mkdirSync(stateDir, { recursive: true });
    expect(maintainerAlive(stateDir)).toBe(false); // no lock
    writeFileSync(join(stateDir, 'index-maintainer.lock'), JSON.stringify({ pid: 2147483600 }), 'utf-8');
    expect(maintainerAlive(stateDir)).toBe(false); // dead pid
    writeFileSync(join(stateDir, 'index-maintainer.lock'), JSON.stringify({ pid: process.pid }), 'utf-8');
    expect(maintainerAlive(stateDir)).toBe(true); // live pid
  });

  it('defaultMaintainerEntry resolves to the sibling index-maintainer.mjs', () => {
    expect(defaultMaintainerEntry().endsWith(join('indexing', 'index-maintainer.mjs'))).toBe(true);
  });
});

describe('launchMaintainer background-priority demotion (A.2/A.3)', () => {
  it('demotes the spawned child to OS background priority by default (gate on)', () => {
    mkdirSync(stateDir, { recursive: true });
    const r = launchMaintainer({ env: baseEnv(), cwd: sandbox, maintainerEntry: FAKE_ENTRY });
    expect(r.spawned).toBe(true);
    expect(applyBackgroundPriorityMock).toHaveBeenCalledTimes(1);
    // Called with the spawned child's pid — demotes only the child, not the caller.
    expect(applyBackgroundPriorityMock).toHaveBeenCalledWith(r.pid);
  });

  it('does NOT demote when the gate is off (0 / false / off)', () => {
    mkdirSync(stateDir, { recursive: true });
    for (const v of ['0', 'false', 'off', 'OFF']) {
      applyBackgroundPriorityMock.mockReset();
      const r = launchMaintainer({
        env: baseEnv({ SWEET_SEARCH_MAINTAINER_BG_PRIORITY: v }),
        cwd: sandbox,
        maintainerEntry: FAKE_ENTRY,
      });
      expect(r.spawned).toBe(true);
      expect(applyBackgroundPriorityMock).not.toHaveBeenCalled();
    }
  });

  it('does NOT demote when no child is spawned (opted-out path)', () => {
    mkdirSync(stateDir, { recursive: true });
    const r = launchMaintainer({
      env: baseEnv({ SWEET_SEARCH_RECONCILE_V2: '0' }),
      cwd: sandbox,
      maintainerEntry: FAKE_ENTRY,
    });
    expect(r.spawned).toBe(false);
    expect(applyBackgroundPriorityMock).not.toHaveBeenCalled();
  });
});
