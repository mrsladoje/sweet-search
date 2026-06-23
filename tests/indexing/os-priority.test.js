/**
 * Tests for the background OS-priority helper
 * (core/indexing/os-priority.mjs) — research §4.A A.2/A.3.
 *
 * The helper is best-effort scheduling demotion of a *child* pid: it must emit
 * the correct platform command (macOS taskpolicy, Linux ionice+chrt), be a
 * no-op on other platforms, and NEVER throw — even when the underlying binary
 * is missing or an invalid pid is passed. Output of the index is unaffected;
 * only *when* the kernel grants CPU/IO changes.
 *
 * We mock `node:child_process.spawn` so the platform-dispatch logic and the
 * never-throws contract are verified deterministically without depending on
 * taskpolicy/ionice/chrt actually being installed on the CI host.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock spawn before importing the module under test.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args) => spawnMock(...args),
}));

const { applyBackgroundPriority, loadNativePriorityAddon, setNativeBackgroundMode } =
  await import('../../core/indexing/os-priority.mjs');

/** A fake ChildProcess that records `on`/`unref` and never errors. */
function makeFakeChild() {
  return { on: vi.fn().mockReturnThis(), unref: vi.fn() };
}

const realPlatform = process.platform;
function setPlatform(platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => makeFakeChild());
});

afterEach(() => {
  setPlatform(realPlatform);
});

describe('applyBackgroundPriority — platform dispatch', () => {
  it('macOS → taskpolicy -b -p PID', () => {
    setPlatform('darwin');
    applyBackgroundPriority(4242);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      'taskpolicy',
      ['-b', '-p', '4242'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('Linux → ionice -c 3 -p PID AND chrt -b -p 0 PID', () => {
    setPlatform('linux');
    applyBackgroundPriority(777);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'ionice',
      ['-c', '3', '-p', '777'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'chrt',
      ['-b', '-p', '0', '777'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('other platforms (e.g. win32) → no spawn (no-op)', () => {
    setPlatform('win32');
    applyBackgroundPriority(123);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('detaches and unrefs the helper so it never holds the caller open', () => {
    setPlatform('darwin');
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);
    applyBackgroundPriority(9);
    expect(spawnMock).toHaveBeenCalledWith(
      'taskpolicy',
      expect.any(Array),
      expect.objectContaining({ stdio: 'ignore', detached: true }),
    );
    // an 'error' listener is registered (swallows ENOENT for missing binary)
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(child.unref).toHaveBeenCalled();
  });
});

describe('applyBackgroundPriority — never throws', () => {
  it('does not throw when the binary is missing (spawn throws synchronously)', () => {
    setPlatform('darwin');
    spawnMock.mockImplementation(() => {
      const err = new Error('spawn taskpolicy ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    expect(() => applyBackgroundPriority(55)).not.toThrow();
  });

  it('does not throw when spawn emits an async error (ENOENT event)', () => {
    setPlatform('linux');
    // Child that invokes its error handler immediately — must be swallowed.
    spawnMock.mockImplementation(() => ({
      on: (event, cb) => { if (event === 'error') cb(new Error('ENOENT')); return this; },
      unref: () => {},
    }));
    expect(() => applyBackgroundPriority(55)).not.toThrow();
  });

  it('does not throw and does not spawn for an invalid pid', () => {
    setPlatform('darwin');
    for (const bad of [undefined, null, NaN, 0, -1, 'x']) {
      expect(() => applyBackgroundPriority(bad)).not.toThrow();
    }
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe('loadNativePriorityAddon', () => {
  it('returns null when the optional native addon is not installed', () => {
    // @sweet-search/bg-priority is an optionalDependency that is not built in
    // the test sandbox, so the require fails and the loader returns null
    // (never throws). The spawn-based fallback then covers all platforms.
    expect(loadNativePriorityAddon()).toBeNull();
  });

  it('memoizes the load result (idempotent, same reference across calls)', () => {
    const a = loadNativePriorityAddon();
    const b = loadNativePriorityAddon();
    expect(a).toBe(b);
  });
});

describe('setNativeBackgroundMode — gated self-demotion', () => {
  const realFlag = process.env.SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY;
  afterEach(() => {
    if (realFlag === undefined) delete process.env.SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY;
    else process.env.SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY = realFlag;
  });

  it('returns false (no-op) when the gate flag is unset — default behavior', () => {
    delete process.env.SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY;
    expect(setNativeBackgroundMode(true)).toBe(false);
    expect(setNativeBackgroundMode(false)).toBe(false);
  });

  it('returns false when gated on but the addon is absent (falls back)', () => {
    // Flag on, but @sweet-search/bg-priority is not installed in the sandbox →
    // loadNativePriorityAddon() is null → no native demotion, caller falls back.
    process.env.SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY = '1';
    expect(setNativeBackgroundMode(true)).toBe(false);
  });

  it('never throws for any argument or flag state', () => {
    process.env.SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY = '1';
    for (const v of [true, false, undefined, null, 1, 0, 'x']) {
      expect(() => setNativeBackgroundMode(v)).not.toThrow();
    }
  });
});
