/**
 * Index maintainer: the operator pause marker. (The legacy queue/merkle maintainer these
 * tests also covered is gone; the reconcile loop is tested under tests/indexing.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isReconcilePaused } from '../../core/indexing/index-maintainer.mjs';

function createTestDir() {
  const testDir = join(tmpdir(), `index-maintainer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

function cleanupTestDir(testDir) {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('isReconcilePaused (Real Implementation)', () => {
  let testDir;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('reads the operator pause marker used by reconcile pause/resume', () => {
    expect(isReconcilePaused(testDir).paused).toBe(false);

    writeFileSync(join(testDir, 'reconcile-pause.json'), JSON.stringify({
      paused: true,
      pausedAt: '2026-05-17T00:00:00.000Z',
      reason: 'test',
    }));

    const state = isReconcilePaused(testDir);
    expect(state.paused).toBe(true);
    expect(state.pausedAt).toBe('2026-05-17T00:00:00.000Z');
    expect(state.reason).toBe('test');
  });
});
