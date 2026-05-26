/**
 * Tests for the maintainer lifecycle fix in
 * core/indexing/index-maintainer.mjs.
 *
 * v2 (progress-aware): the lockfile now carries `progressTimestamp` in
 * addition to `timestamp` (heartbeat). acquireStateLock combines both signals
 * so a candidate maintainer can distinguish "busy + progressing" (refuse
 * takeover) from "alive but hung on an await" (SIGTERM + steal) from
 * "fully wedged" (SIGTERM + steal). See the WEDGED_KILL_GRACE_MS block in
 * index-maintainer.mjs for the full decision matrix.
 *
 * What this file covers:
 *
 *   - stillOwnsLock: returns true iff the lockfile names this process.
 *   - acquireStateLock — full 4-case decision matrix on new-schema locks:
 *       heartbeat fresh + progress fresh  → REFUSE
 *       heartbeat fresh + progress stale  → SIGTERM + steal
 *       heartbeat stale + progress fresh  → REFUSE (timer-lag tolerance)
 *       heartbeat stale + progress stale  → SIGTERM + steal
 *     plus dead-pid takeover (crash recovery) and corrupt-lock takeover.
 *   - Backwards-compat: legacy lockfile without progressTimestamp falls back
 *     to heartbeat-only behaviour, with SIGTERM-before-steal preserving
 *     the orphan-free invariant.
 *   - recordProgress: updates progress fields, refuses to clobber a
 *     successor's lock, is a no-op before acquire.
 *
 * These tests touch only the lifecycle/lock layer. They do NOT exercise
 * runReconcileV2Tick, drainMaintenanceInline, or any actual indexing — the
 * reconcile work itself is untouched by the lifecycle fix.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  acquireStateLock,
  releaseStateLock,
  stillOwnsLock,
  recordProgress,
  WEDGED_KILL_GRACE_MS,
} from '../../core/indexing/index-maintainer.mjs';

const LOCK_FILE_NAME = 'index-maintainer.lock';
let stateDir;
const lockFile = () => join(stateDir, LOCK_FILE_NAME);

// 3 min = the LOCK_STALE_THRESHOLD constant inside index-maintainer.mjs. We
// don't export it, but the value is stable and any change there should also
// flip the tests below — declare it here for readability.
const STALE_MS = 180_000;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'ss-lifecycle-'));
});

afterEach(() => {
  // releaseStateLock also clears module-level lockState, preventing pollution
  // between tests when one acquires successfully.
  try { releaseStateLock(lockFile()); } catch { /* ignore */ }
  try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// stillOwnsLock — displacement detection helper
// -----------------------------------------------------------------------------

describe('stillOwnsLock', () => {
  it('returns false when the lockfile is missing', () => {
    expect(stillOwnsLock(lockFile())).toBe(false);
  });

  it('returns false when the lockfile names another pid', () => {
    writeFileSync(lockFile(), JSON.stringify({ pid: 999999, timestamp: Date.now() }));
    expect(stillOwnsLock(lockFile())).toBe(false);
  });

  it('returns true when the lockfile names this process', () => {
    writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    expect(stillOwnsLock(lockFile())).toBe(true);
  });

  it('returns false when the lockfile content is unparseable', () => {
    writeFileSync(lockFile(), 'not-valid-json{');
    expect(stillOwnsLock(lockFile())).toBe(false);
  });

  it('returns false when the lockfile has no pid field', () => {
    writeFileSync(lockFile(), JSON.stringify({ timestamp: Date.now() }));
    expect(stillOwnsLock(lockFile())).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Helpers for the takeover-decision tests
// -----------------------------------------------------------------------------

/**
 * Mock process.kill so the test can use a real-looking "alive" PID that
 * never receives a real signal. signal-0 (alive probe) succeeds for the
 * given pid; SIGTERM is captured by `spy` for assertion; everything else
 * delegates to the real process.kill so the test's own SIGCHLD etc. work.
 */
function mockAlivePid(fakePid, spy) {
  const origKill = process.kill.bind(process);
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === fakePid) {
      if (signal === 0) return true;
      if (signal === 'SIGTERM') { spy(pid, signal); return true; }
      return true;
    }
    return origKill(pid, signal);
  });
}

function writeLock(fields) {
  writeFileSync(lockFile(), JSON.stringify(fields));
}

// -----------------------------------------------------------------------------
// acquireStateLock — fresh acquisition + crash-recovery paths
// -----------------------------------------------------------------------------

describe('acquireStateLock — basic paths', () => {
  it('acquires cleanly when no existing lock', async () => {
    const res = await acquireStateLock(stateDir);
    expect(res.acquired).toBe(true);
    expect(res.lockFile).toBe(lockFile());
    const parsed = JSON.parse(readFileSync(lockFile(), 'utf-8'));
    expect(parsed.pid).toBe(process.pid);
    // New-schema initialisation: both timestamps written; progressCounter starts at 0.
    expect(typeof parsed.timestamp).toBe('number');
    expect(typeof parsed.progressTimestamp).toBe('number');
    expect(parsed.progressCounter).toBe(0);
  });

  it('takes over a lock whose holder PID is dead (crash recovery)', async () => {
    // 2_147_483_600 is past the legal POSIX pid range on macOS/Linux, so
    // process.kill(pid, 0) reliably throws ESRCH → isPidRunning returns false.
    writeLock({
      pid: 2_147_483_600,
      timestamp: Date.now(),
      startTime: null,
      progressTimestamp: Date.now(),
    });
    const res = await acquireStateLock(stateDir);
    expect(res.acquired).toBe(true);
    const parsed = JSON.parse(readFileSync(lockFile(), 'utf-8'));
    expect(parsed.pid).toBe(process.pid);
  });

  it('takes over an unparseable / corrupt lockfile', async () => {
    writeFileSync(lockFile(), 'corruption');
    const res = await acquireStateLock(stateDir);
    expect(res.acquired).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// acquireStateLock — 4-case decision matrix on new-schema locks
// -----------------------------------------------------------------------------

describe('acquireStateLock — progress-aware takeover (new schema)', () => {
  it('REFUSES when heartbeat fresh AND progress fresh (busy + progressing)', async () => {
    const now = Date.now();
    writeLock({
      pid: process.pid, timestamp: now, startTime: null, progressTimestamp: now,
    });
    const res = await acquireStateLock(stateDir);
    expect(res.acquired).toBe(false);
  });

  it('REFUSES when heartbeat stale BUT progress fresh (timer-lag tolerance)', async () => {
    // Heartbeat 5 min old (stale by 3-min threshold), progress only 30 s old
    // (the daemon clearly IS making progress; the setInterval just lagged).
    // Under heartbeat-only logic this would SIGTERM a healthy daemon —
    // the second signal prevents that false positive.
    const now = Date.now();
    writeLock({
      pid: process.pid,
      timestamp: now - 5 * 60 * 1000,
      startTime: null,
      progressTimestamp: now - 30 * 1000,
    });
    const res = await acquireStateLock(stateDir);
    expect(res.acquired).toBe(false);
  });

  it('SIGTERMs and steals when heartbeat fresh BUT progress stale (alive-but-stuck)', async () => {
    // Event loop is running (heartbeat refreshing) but the reconcile loop is
    // hung on a never-resolving await — no progress for 5 min. The signal
    // catches this WITHOUT requiring the event loop itself to be blocked.
    const FAKE_LIVE_PID = 1_234_567;
    const sigTermSpy = vi.fn();
    mockAlivePid(FAKE_LIVE_PID, sigTermSpy);
    const now = Date.now();
    writeLock({
      pid: FAKE_LIVE_PID,
      timestamp: now,
      startTime: null,
      progressTimestamp: now - 5 * 60 * 1000,
    });
    const res = await acquireStateLock(stateDir);
    expect(sigTermSpy).toHaveBeenCalledWith(FAKE_LIVE_PID, 'SIGTERM');
    expect(res.acquired).toBe(true);
    const parsed = JSON.parse(readFileSync(lockFile(), 'utf-8'));
    expect(parsed.pid).toBe(process.pid);
  }, /* per-test timeout */ 10_000);

  it('SIGTERMs and steals when BOTH signals stale (fully wedged)', async () => {
    const FAKE_LIVE_PID = 1_234_568;
    const sigTermSpy = vi.fn();
    mockAlivePid(FAKE_LIVE_PID, sigTermSpy);
    const ancient = Date.now() - 10 * 60 * 1000;  // 10 min ago
    writeLock({
      pid: FAKE_LIVE_PID,
      timestamp: ancient,
      startTime: null,
      progressTimestamp: ancient,
    });
    const res = await acquireStateLock(stateDir);
    expect(sigTermSpy).toHaveBeenCalledWith(FAKE_LIVE_PID, 'SIGTERM');
    expect(res.acquired).toBe(true);
  }, /* per-test timeout */ 10_000);
});

// -----------------------------------------------------------------------------
// Backwards-compatibility with legacy locks (no progressTimestamp field)
// -----------------------------------------------------------------------------

describe('acquireStateLock — legacy lockfile (no progressTimestamp) backwards-compat', () => {
  it('REFUSES when legacy lock has fresh heartbeat (alive owner)', async () => {
    writeLock({
      pid: process.pid,
      timestamp: Date.now(),
      startTime: null,
      // no progressTimestamp — falls back to progressAge := heartbeatAge
    });
    const res = await acquireStateLock(stateDir);
    expect(res.acquired).toBe(false);
  });

  it('SIGTERMs and steals when legacy lock has stale heartbeat (3-min fallback)', async () => {
    const FAKE_LIVE_PID = 1_234_569;
    const sigTermSpy = vi.fn();
    mockAlivePid(FAKE_LIVE_PID, sigTermSpy);
    writeLock({
      pid: FAKE_LIVE_PID,
      timestamp: Date.now() - 5 * 60 * 1000,
      startTime: null,
      // no progressTimestamp — fallback treats heartbeat age as progress age
    });
    const res = await acquireStateLock(stateDir);
    expect(sigTermSpy).toHaveBeenCalledWith(FAKE_LIVE_PID, 'SIGTERM');
    expect(res.acquired).toBe(true);
  }, /* per-test timeout */ 10_000);
});

// -----------------------------------------------------------------------------
// recordProgress — work checkpoint
// -----------------------------------------------------------------------------

describe('recordProgress', () => {
  it('is a no-op when called before acquireStateLock (no module state)', () => {
    // Pre-acquire: lockState is null, so recordProgress writes nothing —
    // and there is no lockfile to read either.
    recordProgress(lockFile());
    expect(existsSync(lockFile())).toBe(false);
  });

  it('updates progressTimestamp and progressCounter on the live lockfile', async () => {
    const acquireRes = await acquireStateLock(stateDir);
    expect(acquireRes.acquired).toBe(true);

    const before = JSON.parse(readFileSync(lockFile(), 'utf-8'));
    expect(before.progressCounter).toBe(0);

    // Sleep 5 ms so progressTimestamp can advance (Date.now() resolution).
    await new Promise((r) => setTimeout(r, 5));
    recordProgress(lockFile());

    const after = JSON.parse(readFileSync(lockFile(), 'utf-8'));
    expect(after.progressCounter).toBe(1);
    expect(after.progressTimestamp).toBeGreaterThan(before.progressTimestamp);
    // Heartbeat fields preserved.
    expect(after.pid).toBe(process.pid);
    expect(after.timestamp).toBe(before.timestamp);
  });

  it('is a no-op when the lockfile has been overwritten by a successor (no clobbering)', async () => {
    const acquireRes = await acquireStateLock(stateDir);
    expect(acquireRes.acquired).toBe(true);

    // Simulate a takeover: rewrite the lock with a different pid.
    const successorPid = process.pid + 1;
    writeFileSync(lockFile(), JSON.stringify({
      pid: successorPid,
      timestamp: Date.now(),
      progressTimestamp: Date.now(),
      progressCounter: 99,
    }));

    recordProgress(lockFile());

    // Successor's lock must be untouched.
    const parsed = JSON.parse(readFileSync(lockFile(), 'utf-8'));
    expect(parsed.pid).toBe(successorPid);
    expect(parsed.progressCounter).toBe(99);
  });
});

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

describe('lifecycle constants', () => {
  it('SIGTERM grace is bounded so acquireStateLock returns promptly even when SIGTERM is ineffective', () => {
    expect(WEDGED_KILL_GRACE_MS).toBeGreaterThan(0);
    expect(WEDGED_KILL_GRACE_MS).toBeLessThanOrEqual(15_000);
  });
});
