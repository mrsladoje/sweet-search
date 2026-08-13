/**
 * Takeover against a REAL process that ignores SIGTERM.
 *
 * The rest of the takeover matrix is covered by mocking `process.kill`, which
 * is the right tool for the decision table. But it cannot answer the question
 * that actually matters here: does the grace loop terminate when the signal is
 * genuinely ineffective against a genuinely running process? The existing test
 * for that asserts only that `WEDGED_KILL_GRACE_MS` is a small number, which is
 * a statement about a constant, not about the loop that reads it.
 *
 * This models the case the protocol has to survive and cannot observe from
 * outside: a maintainer blocked inside a long native call — a large re-embed, a
 * stalled network filesystem — for longer than the grace period. It is alive,
 * it is the rightful owner, and it does not answer. If `acquireStateLock` ever
 * waited on such a holder without a bound, a single wedged maintainer would
 * stop the index being maintained for as long as it stayed wedged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquireStateLock, WEDGED_KILL_GRACE_MS } from '../../core/indexing/index-maintainer.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEAF_HOLDER = join(REPO_ROOT, 'tests', 'fixtures', 'sigterm-deaf-holder.mjs');

let stateDir;
let holder;

const lockFile = () => join(stateDir, 'index-maintainer.lock');

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Start the deaf holder and resolve once it says it is ready. */
function startDeafHolder() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DEAF_HOLDER], {
      stdio: ['ignore', 'pipe', 'ignore'],
      // Its own hard TTL is the backstop if this test dies before afterEach.
      env: { ...process.env, DEAF_HOLDER_TTL_MS: '60000' },
    });
    let out = '';
    const onData = (d) => {
      out += d;
      if (out.includes('ready')) { child.stdout.off('data', onData); resolve(child); }
    };
    child.stdout.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`deaf holder exited early (${code})`)));
    setTimeout(() => reject(new Error('deaf holder never became ready')), 15_000);
  });
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'ss-deaf-'));
  mkdirSync(stateDir, { recursive: true });
  holder = null;
});

afterEach(() => {
  // SIGKILL, because by construction it does not answer SIGTERM.
  if (holder?.pid) { try { process.kill(holder.pid, 'SIGKILL'); } catch { /* gone */ } }
  try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('acquireStateLock against a SIGTERM-deaf holder', () => {
  it('steals the lock in bounded time and does not wait for the holder to die', async () => {
    holder = await startDeafHolder();
    expect(pidAlive(holder.pid)).toBe(true);

    // Fully wedged: alive, but no progress for ten minutes. The decision matrix
    // says SIGTERM and steal.
    const ancient = Date.now() - 10 * 60 * 1000;
    writeFileSync(lockFile(), JSON.stringify({
      pid: holder.pid,
      timestamp: ancient,
      startTime: null,
      progressTimestamp: ancient,
      progressCounter: 7,
    }));

    const t0 = Date.now();
    const res = await acquireStateLock(stateDir);
    const elapsed = Date.now() - t0;

    expect(res.acquired).toBe(true);
    // The lock is ours now.
    expect(JSON.parse(readFileSync(lockFile(), 'utf-8')).pid).toBe(process.pid);

    // It really did survive the signal — otherwise this would be the ordinary
    // dead-holder path and would prove nothing about the grace loop.
    expect(pidAlive(holder.pid)).toBe(true);

    // Bounded: it waited out the grace once, and then stopped waiting. The
    // upper bound is what fails if the loop ever becomes unbounded; the lower
    // bound is what fails if the grace is skipped entirely.
    expect(elapsed).toBeGreaterThanOrEqual(WEDGED_KILL_GRACE_MS - 500);
    expect(elapsed).toBeLessThan(WEDGED_KILL_GRACE_MS + 10_000);
  }, 45_000);

  it('leaves a PROGRESSING deaf holder alone', async () => {
    // The mirror image, and the more dangerous direction: a maintainer that is
    // slow to answer signals but IS getting work done must not be displaced,
    // or two writers end up on one index.
    holder = await startDeafHolder();
    const now = Date.now();
    writeFileSync(lockFile(), JSON.stringify({
      pid: holder.pid,
      timestamp: now,
      startTime: null,
      progressTimestamp: now,
      progressCounter: 7,
    }));

    const res = await acquireStateLock(stateDir);
    expect(res.acquired).toBe(false);
    // Untouched: still the holder's lock, not ours.
    expect(JSON.parse(readFileSync(lockFile(), 'utf-8')).pid).toBe(holder.pid);
    expect(pidAlive(holder.pid)).toBe(true);
  }, 45_000);
});
