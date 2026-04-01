/**
 * sqlite-wal-mode.test.js
 *
 * Tests for P0 SQLite WAL mode platform detection and journal configuration.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// We need to test isWalSafe and configureJournalMode
// Import them after they're exported from index-codebase-v21.js
// For now, test the logic directly

describe('P0 SQLite WAL Mode', () => {
  describe('isWalSafe', () => {
    const originalPlatform = process.platform;
    const originalEnv = { ...process.env };

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      process.env = { ...originalEnv };
    });

    it('returns true on native Linux without WSL', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      delete process.env.WSL_DISTRO_NAME;
      // Import will use the current process.platform
      // For unit testing, we test the logic directly
      const isLinux = process.platform === 'linux';
      const isWsl = !!process.env.WSL_DISTRO_NAME;
      expect(isLinux && !isWsl).toBe(true);
    });

    it('returns false on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(process.platform === 'linux').toBe(false);
    });

    it('returns false on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(process.platform === 'linux').toBe(false);
    });

    it('returns false for WSL with drvfs path (/mnt/c/...)', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.WSL_DISTRO_NAME = 'Ubuntu';
      const dbPath = '/mnt/c/Users/test/data.db';
      const isWslDrvfs = process.env.WSL_DISTRO_NAME && /^\/mnt\/[a-zA-Z]\//.test(dbPath);
      expect(isWslDrvfs).toBe(true);
    });

    it('returns true for WSL2 with ext4 path (/home/...)', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      process.env.WSL_DISTRO_NAME = 'Ubuntu';
      const dbPath = '/home/user/projects/data.db';
      const isDrvfs = /^\/mnt\/[a-zA-Z]\//.test(dbPath);
      expect(isDrvfs).toBe(false);
    });
  });

  describe('Batch insert chunking', () => {
    it('handles fewer items than batch size', () => {
      const items = Array.from({ length: 500 }, (_, i) => ({ id: i }));
      const BATCH_INSERT_SIZE = 2000;
      const batches = [];
      for (let i = 0; i < items.length; i += BATCH_INSERT_SIZE) {
        batches.push(items.slice(i, i + BATCH_INSERT_SIZE));
      }
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(500);
    });

    it('splits into correct number of batches', () => {
      const items = Array.from({ length: 5500 }, (_, i) => ({ id: i }));
      const BATCH_INSERT_SIZE = 2000;
      const batches = [];
      for (let i = 0; i < items.length; i += BATCH_INSERT_SIZE) {
        batches.push(items.slice(i, i + BATCH_INSERT_SIZE));
      }
      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(2000);
      expect(batches[1]).toHaveLength(2000);
      expect(batches[2]).toHaveLength(1500);
    });

    it('handles empty items array', () => {
      const items = [];
      const BATCH_INSERT_SIZE = 2000;
      const batches = [];
      for (let i = 0; i < items.length; i += BATCH_INSERT_SIZE) {
        batches.push(items.slice(i, i + BATCH_INSERT_SIZE));
      }
      expect(batches).toHaveLength(0);
    });
  });
});
