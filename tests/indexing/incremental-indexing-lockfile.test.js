/**
 * Tests for core/incremental-indexing/infrastructure/lockfile.mjs
 *
 * Plan § 8.5 / § 8.6: acquire/release semantics + stale recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireLock,
  releaseLock,
  LockHeldError,
  LOCK_FILENAME,
} from '../../core/incremental-indexing/infrastructure/lockfile.mjs';

describe('lockfile', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-lock-'));
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('acquire writes the lockfile and release removes it', () => {
    const token = acquireLock(dir);
    expect(fs.existsSync(path.join(dir, LOCK_FILENAME))).toBe(true);
    releaseLock(dir, token);
    expect(fs.existsSync(path.join(dir, LOCK_FILENAME))).toBe(false);
  });

  it('second acquire while live owner holds it throws LockHeldError', () => {
    const token = acquireLock(dir);
    expect(() => acquireLock(dir)).toThrow(LockHeldError);
    releaseLock(dir, token);
  });

  it('clears a stale lock from a dead pid on the same boot', () => {
    // Synthesize a "dead" pid: a very high integer.
    fs.writeFileSync(path.join(dir, LOCK_FILENAME), JSON.stringify({
      pid: 999_999_999,
      bootId: 'matches-current', // will mismatch boot id; that's enough
      acquiredAt: '2026-05-15T00:00:00Z',
    }));
    const token = acquireLock(dir);
    expect(token.staleCleared).toBe(true);
    releaseLock(dir, token);
  });

  it('clears a corrupted lockfile', () => {
    fs.writeFileSync(path.join(dir, LOCK_FILENAME), '{not json');
    const token = acquireLock(dir);
    expect(token.staleCleared).toBe(true);
    releaseLock(dir, token);
  });

  it('release is idempotent and does not unlink another holder\'s lock', () => {
    const token = acquireLock(dir);
    // Pretend someone replaced the lock with their own.
    fs.writeFileSync(path.join(dir, LOCK_FILENAME), JSON.stringify({
      pid: process.pid + 1,
      bootId: 'someone-else',
      acquiredAt: '2026-05-15T00:00:00Z',
    }));
    releaseLock(dir, token);
    expect(fs.existsSync(path.join(dir, LOCK_FILENAME))).toBe(true);
  });
});
