import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Mock the lock functions (we can't import them directly since they're not exported)
// Instead, test the PATTERN that should be followed

describe('Lock Ownership Security Pattern', () => {
  let testDir;
  let lockFile;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'lock-test-'));
    lockFile = join(testDir, 'test.lock');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('Ownership verification pattern', () => {
    /**
     * This is the CORRECT pattern that all lock operations should follow
     */
    function correctReleaseLock(lockPath, expectedPid) {
      try {
        const content = readFileSync(lockPath, 'utf-8');
        const [pidStr] = content.trim().split('\n');
        const lockPid = parseInt(pidStr, 10);

        if (lockPid === expectedPid) {
          unlinkSync(lockPath);
          return { released: true };
        }
        return { released: false, reason: 'not_owner', actualPid: lockPid };
      } catch (err) {
        if (err.code === 'ENOENT') {
          return { released: false, reason: 'not_found' };
        }
        throw err;
      }
    }

    it('should release lock when PID matches', () => {
      const myPid = process.pid;
      writeFileSync(lockFile, `${myPid}\n${Date.now()}\n`);

      const result = correctReleaseLock(lockFile, myPid);

      expect(result.released).toBe(true);
      expect(existsSync(lockFile)).toBe(false);
    });

    it('should NOT release lock when PID does not match', () => {
      const otherPid = process.pid + 1000;
      writeFileSync(lockFile, `${otherPid}\n${Date.now()}\n`);

      const result = correctReleaseLock(lockFile, process.pid);

      expect(result.released).toBe(false);
      expect(result.reason).toBe('not_owner');
      expect(existsSync(lockFile)).toBe(true);  // Lock still exists!
    });

    it('should handle missing lock file gracefully', () => {
      const result = correctReleaseLock(lockFile, process.pid);

      expect(result.released).toBe(false);
      expect(result.reason).toBe('not_found');
    });
  });

  describe('Refresh with ownership check', () => {
    function correctRefreshLock(lockPath, myPid) {
      try {
        const content = readFileSync(lockPath, 'utf-8');
        const [pidStr] = content.trim().split('\n');
        const lockPid = parseInt(pidStr, 10);

        if (lockPid === myPid) {
          writeFileSync(lockPath, `${myPid}\n${Date.now()}\n`);
          return { refreshed: true };
        }
        return { refreshed: false, reason: 'lost_ownership', actualOwner: lockPid };
      } catch (err) {
        return { refreshed: false, reason: err.message };
      }
    }

    it('should refresh lock when we own it', () => {
      const myPid = process.pid;
      const oldTime = Date.now() - 10000;
      writeFileSync(lockFile, `${myPid}\n${oldTime}\n`);

      const result = correctRefreshLock(lockFile, myPid);

      expect(result.refreshed).toBe(true);

      // Verify timestamp was updated
      const content = readFileSync(lockFile, 'utf-8');
      const [, newTimeStr] = content.trim().split('\n');
      expect(parseInt(newTimeStr, 10)).toBeGreaterThan(oldTime);
    });

    it('should NOT refresh lock when another process owns it', () => {
      const otherPid = process.pid + 1000;
      writeFileSync(lockFile, `${otherPid}\n${Date.now()}\n`);

      const result = correctRefreshLock(lockFile, process.pid);

      expect(result.refreshed).toBe(false);
      expect(result.reason).toBe('lost_ownership');

      // Verify lock was NOT modified
      const content = readFileSync(lockFile, 'utf-8');
      const [pidStr] = content.trim().split('\n');
      expect(parseInt(pidStr, 10)).toBe(otherPid);
    });
  });
});
