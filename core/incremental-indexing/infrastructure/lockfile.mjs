/**
 * Single-writer lockfile with stale-owner recovery.
 *
 * Plan § 8.5 + § 8.6. The reconcile daemon, full reindex command, and
 * maintenance worker all coordinate through `.sweet-search/
 * index-maintainer.lock`. Each holder writes `{ pid, bootId, acquiredAt }`
 * into the file; acquirers check whether the owner is still alive and
 * release stale locks automatically.
 *
 * Stale-recovery rules (plan § 8.6 + § 11):
 *   - If `bootId` differs from current → stale; clear.
 *   - If `bootId` matches but `kill -0 pid` returns ESRCH → stale; clear.
 *   - If alive → fail-fast with conflicting pid.
 *
 * Plan § 8.6 "Crash-leak recovery": when a stale lock is cleared, the
 * caller enqueues an immediate Float HNSW background replacement with
 * `reason = "crash_recovery"` so the duplicate-append window from an
 * interrupted tick self-heals within minutes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { bootIdStub } from './reader-heartbeat.mjs';

export const LOCK_FILENAME = 'index-maintainer.lock';

class LockHeldError extends Error {
  constructor(owner) {
    super(`index-maintainer.lock held by pid ${owner.pid} (bootId=${owner.bootId})`);
    this.name = 'LockHeldError';
    this.owner = owner;
  }
}

function lockPath(stateDir) {
  return path.join(stateDir, LOCK_FILENAME);
}

function readLock(stateDir) {
  const p = lockPath(stateDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return { corrupted: true };
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Try to acquire the lockfile. Returns a token the caller passes to
 * `release()` when done. Throws `LockHeldError` when a live holder
 * has it.
 *
 * @param {string} stateDir
 * @returns {{pid:number, bootId:string, acquiredAt:string, staleCleared:boolean}}
 */
export function acquireLock(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const existing = readLock(stateDir);
  let staleCleared = false;
  if (existing && !existing.corrupted) {
    const currentBoot = bootIdStub();
    if (existing.bootId !== currentBoot) {
      // Different boot → owner can't possibly be alive.
      try { fs.unlinkSync(lockPath(stateDir)); } catch {}
      staleCleared = true;
    } else if (!processAlive(existing.pid)) {
      try { fs.unlinkSync(lockPath(stateDir)); } catch {}
      staleCleared = true;
    } else {
      throw new LockHeldError(existing);
    }
  } else if (existing && existing.corrupted) {
    try { fs.unlinkSync(lockPath(stateDir)); } catch {}
    staleCleared = true;
  }
  const token = {
    pid: process.pid,
    bootId: bootIdStub(),
    acquiredAt: new Date().toISOString(),
    staleCleared,
  };
  // O_EXCL semantics via wx flag.
  const fd = fs.openSync(lockPath(stateDir), 'wx');
  try {
    fs.writeSync(fd, JSON.stringify(token));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return token;
}

/**
 * Release the lock. Idempotent; missing files are not an error.
 *
 * @param {string} stateDir
 * @param {{pid:number, bootId:string}} token
 */
export function releaseLock(stateDir, token) {
  const existing = readLock(stateDir);
  if (!existing || existing.corrupted) return;
  if (existing.pid !== token.pid || existing.bootId !== token.bootId) {
    // Someone else has taken the lock; don't unlink theirs.
    return;
  }
  try { fs.unlinkSync(lockPath(stateDir)); } catch {}
}

export { LockHeldError };
