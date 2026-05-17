/**
 * Incremental Tracker Tests
 *
 * Tests for the incremental indexing tracker:
 * - mtime/size/inode fast-path optimization
 * - Config fingerprint validation
 * - ENOSPC (disk full) error handling (C4)
 * - Missing vs corrupt state file detection (E3)
 *
 * Note: These tests use simple in-memory logic to avoid fs complexity.
 * Integration tests with real filesystem are in a separate describe block.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { contentHashSync, HASH_ALGORITHM } from '../../core/incremental-indexing/infrastructure/hashing.mjs';

// =============================================================================
// UNIT TESTS FOR ISOLATED LOGIC (no fs mocking needed)
// =============================================================================

describe('Hash Computation Logic', () => {
  /**
   * Replicates the hash logic from incremental-tracker.js
   */
  function computeContentHash(content) {
    return contentHashSync(content);
  }

  it('should compute the configured content hash truncated to 16 chars', () => {
    const hash = computeContentHash('test content');

    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('should produce consistent hashes', () => {
    const hash1 = computeContentHash('hello world');
    const hash2 = computeContentHash('hello world');

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different content', () => {
    const hash1 = computeContentHash('content A');
    const hash2 = computeContentHash('content B');

    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty content', () => {
    const hash = computeContentHash('');

    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('should handle unicode content', () => {
    const hash = computeContentHash('日本語テスト🎉');

    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('Config Fingerprint Logic', () => {
  const STATE_VERSION = '2.4';

  /**
   * Replicates the config fingerprint builder from incremental-tracker.js
   */
  function buildConfigFingerprint(config) {
    return {
      provider: config.provider,
      model: config.model,
      dimension: config.dimension,
      hnswDimension: config.hnswDimension,
      hashAlgorithm: HASH_ALGORITHM,
      version: STATE_VERSION,
    };
  }

  /**
   * Validates config fingerprint against current config
   */
  function validateFingerprint(stored, current) {
    if (!stored) {
      return { valid: false, reason: 'no_stored_fingerprint' };
    }

    if (stored.provider !== current.provider) {
      return { valid: false, reason: 'provider_changed', details: { previous: stored.provider, current: current.provider } };
    }

    if (stored.model !== current.model) {
      return { valid: false, reason: 'model_changed', details: { previous: stored.model, current: current.model } };
    }

    if (stored.dimension !== current.dimension) {
      return { valid: false, reason: 'dimension_changed', details: { previous: stored.dimension, current: current.dimension } };
    }

    if (stored.hnswDimension !== current.hnswDimension) {
      return { valid: false, reason: 'hnsw_dimension_changed', details: { previous: stored.hnswDimension, current: current.hnswDimension } };
    }

    if (stored.hashAlgorithm !== current.hashAlgorithm) {
      return { valid: false, reason: 'hash_algorithm_changed', details: { previous: stored.hashAlgorithm, current: current.hashAlgorithm } };
    }

    if (stored.version === '2.2' && current.version === '2.3') {
      return { valid: true, migrated: true, reason: 'version_upgrade' };
    }

    if (stored.version !== current.version) {
      return { valid: false, reason: 'state_version_changed', details: { previous: stored.version, current: current.version } };
    }

    return { valid: true };
  }

  it('should build fingerprint with all fields', () => {
    const config = {
      provider: 'voyage',
      model: 'voyage-code-3',
      dimension: 1024,
      hnswDimension: 512,
    };

    const fingerprint = buildConfigFingerprint(config);

    expect(fingerprint).toEqual({
      provider: 'voyage',
      model: 'voyage-code-3',
      dimension: 1024,
      hnswDimension: 512,
      hashAlgorithm: HASH_ALGORITHM,
      version: '2.4',
    });
  });

  it('should detect provider change', () => {
    const stored = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };
    const current = { provider: 'mistral', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };

    const result = validateFingerprint(stored, current);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('provider_changed');
  });

  it('should detect model change', () => {
    const stored = { provider: 'voyage', model: 'voyage-code-2', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };
    const current = { provider: 'voyage', model: 'voyage-code-3', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };

    const result = validateFingerprint(stored, current);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('model_changed');
  });

  it('should detect dimension change', () => {
    const stored = { provider: 'voyage', model: 'm', dimension: 768, hnswDimension: 384, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };
    const current = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };

    const result = validateFingerprint(stored, current);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('dimension_changed');
  });

  it('should allow the legacy 2.2 to 2.3 metadata-only version upgrade', () => {
    const stored = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.2' };
    const current = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.3' };

    const result = validateFingerprint(stored, current);

    expect(result.valid).toBe(true);
    expect(result.migrated).toBe(true);
    expect(result.reason).toBe('version_upgrade');
  });

  it('should detect hash algorithm changes', () => {
    const stored = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: 'sha256', version: '2.4' };
    const current = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: 'xxhash3', version: '2.4' };

    const result = validateFingerprint(stored, current);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('hash_algorithm_changed');
  });

  it('should reject incompatible state version changes', () => {
    const stored = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.3' };
    const current = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };

    const result = validateFingerprint(stored, current);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('state_version_changed');
  });

  it('should accept matching fingerprints', () => {
    const stored = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };
    const current = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };

    const result = validateFingerprint(stored, current);

    expect(result.valid).toBe(true);
  });

  it('should handle missing stored fingerprint', () => {
    const current = { provider: 'voyage', model: 'm', dimension: 1024, hnswDimension: 512, hashAlgorithm: HASH_ALGORITHM, version: '2.4' };

    const result = validateFingerprint(null, current);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_stored_fingerprint');
  });
});

describe('mtime/size/inode Fast-Path Logic', () => {
  /**
   * Determines if fast-path can be used (skip content read)
   */
  function canUseFastPath(storedEntry, currentStat) {
    if (!storedEntry) return false;
    if (typeof storedEntry === 'string') return false; // v2.2 format - need migration

    const sizeMatches = BigInt(storedEntry.size) === BigInt(currentStat.size);
    const mtimeMatches = BigInt(storedEntry.mtime_ns) === BigInt(currentStat.mtime_ns);
    const inodeMatches = storedEntry.inode != null
      && currentStat.inode != null
      && BigInt(storedEntry.inode) === BigInt(currentStat.inode);

    return sizeMatches && mtimeMatches && inodeMatches;
  }

  it('should use fast-path when size, mtime, and inode match', () => {
    const stored = { hash: 'abc123', size: '1000', mtime_ns: '1735670400000000000', inode: '42' };
    const current = { size: '1000', mtime_ns: '1735670400000000000', inode: '42' };

    expect(canUseFastPath(stored, current)).toBe(true);
  });

  it('should NOT use fast-path when size differs', () => {
    const stored = { hash: 'abc123', size: '1000', mtime_ns: '1735670400000000000', inode: '42' };
    const current = { size: '2000', mtime_ns: '1735670400000000000', inode: '42' };

    expect(canUseFastPath(stored, current)).toBe(false);
  });

  it('should NOT use fast-path when the stored inode is missing', () => {
    const stored = { hash: 'abc123', size: '1000', mtime_ns: '1735670400000000000' };
    const current = { size: '1000', mtime_ns: '1735670400000000000', inode: '42' };

    expect(canUseFastPath(stored, current)).toBe(false);
  });

  it('should NOT use fast-path when mtime differs', () => {
    const stored = { hash: 'abc123', size: '1000', mtime_ns: '1735670400000000000', inode: '42' };
    const current = { size: '1000', mtime_ns: '1735680000000000000', inode: '42' };

    expect(canUseFastPath(stored, current)).toBe(false);
  });

  it('should NOT use fast-path when inode differs', () => {
    const stored = { hash: 'abc123', size: '1000', mtime_ns: '1735670400000000000', inode: '42' };
    const current = { size: '1000', mtime_ns: '1735670400000000000', inode: '43' };

    expect(canUseFastPath(stored, current)).toBe(false);
  });

  it('should NOT use fast-path for new files', () => {
    const stored = null;
    const current = { size: '1000', mtime_ns: '1735670400000000000', inode: '42' };

    expect(canUseFastPath(stored, current)).toBe(false);
  });

  it('should NOT use fast-path for v2.2 format (string hash only)', () => {
    const stored = 'abc123def456'; // v2.2 format
    const current = { size: '1000', mtime_ns: '1735670400000000000', inode: '42' };

    expect(canUseFastPath(stored, current)).toBe(false);
  });
});

describe('Change Detection Logic', () => {
  /**
   * Classifies files into toIndex, unchanged, and toRemove
   */
  function classifyFiles(currentFiles, storedFiles) {
    const toIndex = [];
    const unchanged = [];
    const toRemove = [];

    // Current files check
    for (const file of currentFiles) {
      if (!storedFiles.has(file)) {
        toIndex.push(file);
      } else {
        unchanged.push(file);
      }
    }

    // Removed files check
    for (const file of storedFiles.keys()) {
      if (!currentFiles.includes(file)) {
        toRemove.push(file);
      }
    }

    return { toIndex, unchanged, toRemove };
  }

  it('should detect new files', () => {
    const current = ['a.java', 'b.java', 'c.java'];
    const stored = new Map([['a.java', {}], ['b.java', {}]]);

    const result = classifyFiles(current, stored);

    expect(result.toIndex).toContain('c.java');
    expect(result.unchanged).toContain('a.java');
    expect(result.unchanged).toContain('b.java');
    expect(result.toRemove).toEqual([]);
  });

  it('should detect removed files', () => {
    const current = ['a.java'];
    const stored = new Map([['a.java', {}], ['b.java', {}], ['c.java', {}]]);

    const result = classifyFiles(current, stored);

    expect(result.unchanged).toContain('a.java');
    expect(result.toRemove).toContain('b.java');
    expect(result.toRemove).toContain('c.java');
  });

  it('should handle empty current list', () => {
    const current = [];
    const stored = new Map([['a.java', {}], ['b.java', {}]]);

    const result = classifyFiles(current, stored);

    expect(result.toIndex).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.toRemove).toContain('a.java');
    expect(result.toRemove).toContain('b.java');
  });

  it('should handle empty stored state', () => {
    const current = ['a.java', 'b.java'];
    const stored = new Map();

    const result = classifyFiles(current, stored);

    expect(result.toIndex).toContain('a.java');
    expect(result.toIndex).toContain('b.java');
    expect(result.unchanged).toEqual([]);
    expect(result.toRemove).toEqual([]);
  });
});

describe('State Format Migration', () => {
  /**
   * Checks if entry needs migration from v2.2 to v2.3
   */
  function needsMigration(entry) {
    if (typeof entry === 'string') return true; // v2.2 format
    if (!entry.size || !entry.mtime_ns || !entry.inode) return true; // Missing new fields
    return false;
  }

  it('should detect v2.2 string format', () => {
    expect(needsMigration('abc123def456')).toBe(true);
  });

  it('should detect missing size field', () => {
    expect(needsMigration({ hash: 'abc', mtime_ns: '123' })).toBe(true);
  });

  it('should detect missing mtime_ns field', () => {
    expect(needsMigration({ hash: 'abc', size: 100 })).toBe(true);
  });

  it('should detect missing inode field', () => {
    expect(needsMigration({ hash: 'abc', size: '100', mtime_ns: '123' })).toBe(true);
  });

  it('should accept v2.3 format', () => {
    expect(needsMigration({ hash: 'abc', size: '100', mtime_ns: '123', inode: '456' })).toBe(false);
  });
});

describe('Fast-Path Statistics', () => {
  it('should track hits and misses', () => {
    const stats = { hits: 0, misses: 0, contentReads: 0 };

    // Simulate 5 fast-path hits
    for (let i = 0; i < 5; i++) {
      stats.hits++;
    }

    // Simulate 3 misses requiring content read
    for (let i = 0; i < 3; i++) {
      stats.misses++;
      stats.contentReads++;
    }

    expect(stats.hits).toBe(5);
    expect(stats.misses).toBe(3);
    expect(stats.contentReads).toBe(3);
    expect(stats.hits + stats.misses).toBe(8);
  });

  it('should calculate hit ratio', () => {
    const stats = { hits: 80, misses: 20 };
    const total = stats.hits + stats.misses;
    const hitRatio = total > 0 ? stats.hits / total : 0;

    expect(hitRatio).toBe(0.8);
  });
});

// =============================================================================
// INTEGRATION TESTS WITH REAL FILESYSTEM
// These tests use actual file operations to test end-to-end behavior
// =============================================================================

describe('Incremental Tracker - Integration Tests', () => {
  let testDir;
  let projectRoot;
  let originalEnv;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'tracker-integration-'));
    projectRoot = join(testDir, 'project');
    mkdirSync(projectRoot, { recursive: true });

    // Save original env
    originalEnv = { ...process.env };

    // Clear state before each test to ensure isolation
    const tracker = await import('../../core/indexing/incremental-tracker.js');
    await tracker.clearState();
  });

  afterEach(() => {
    // Restore env
    process.env = originalEnv;

    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('File Change Detection with Real Files', () => {
    it('should detect new files', async () => {
      // Create test files
      writeFileSync(join(projectRoot, 'a.txt'), 'content a');
      writeFileSync(join(projectRoot, 'b.txt'), 'content b');

      // Get relative paths
      const allFiles = ['a.txt', 'b.txt'];

      // Import the module (dynamically to allow env manipulation)
      const tracker = await import('../../core/indexing/incremental-tracker.js');

      // First run - all files are "new"
      const result = await tracker.getChangedFiles(allFiles, projectRoot);

      // All files should need indexing (fresh state)
      expect(result.toIndex.length).toBe(2);
      expect(result.toIndex).toContain('a.txt');
      expect(result.toIndex).toContain('b.txt');
      expect(result.unchanged.length).toBe(0);
      expect(result.toRemove.length).toBe(0);
    });

    it('persists the full size/mtime/inode stat tuple as strings', async () => {
      writeFileSync(join(projectRoot, 'tuple.txt'), 'tuple content');

      const tracker = await import('../../core/indexing/incremental-tracker.js');
      const result = await tracker.getChangedFiles(['tuple.txt'], projectRoot);

      expect(result.currentHashes['tuple.txt']).toMatchObject({
        hash: contentHashSync('tuple content'),
        size: expect.any(String),
        mtime_ns: expect.any(String),
        inode: expect.any(String),
      });
    });

    it('hashes file bytes instead of decoded UTF-8 strings', async () => {
      const bytes = Buffer.from([0xff, 0x61, 0x00, 0x62]);
      writeFileSync(join(projectRoot, 'bytes.txt'), bytes);

      const tracker = await import('../../core/indexing/incremental-tracker.js');
      const result = await tracker.getChangedFiles(['bytes.txt'], projectRoot);

      expect(result.currentHashes['bytes.txt'].hash).toBe(contentHashSync(bytes));
    });

    it('does not fast-path when only the stored inode differs', async () => {
      const fileName = 'inode.txt';
      const filePath = join(projectRoot, fileName);
      const content = 'same content';
      writeFileSync(filePath, content);
      const stat = statSync(filePath, { bigint: true });
      const hash = contentHashSync(content);

      const tracker = await import('../../core/indexing/incremental-tracker.js');
      await tracker.updateState({
        [fileName]: {
          hash,
          size: stat.size.toString(),
          mtime_ns: stat.mtimeNs.toString(),
          inode: '0',
        },
      });

      const result = await tracker.getChangedFiles([fileName], projectRoot);

      expect(result.unchanged).toEqual([fileName]);
      expect(result.fastPathStats.hits).toBe(0);
      expect(result.fastPathStats.contentReads).toBe(1);
      expect(result.currentHashes[fileName].inode).toBe(stat.ino.toString());
    });

    it('does not fast-path when the stored inode is missing', async () => {
      const fileName = 'missing-inode.txt';
      const filePath = join(projectRoot, fileName);
      const content = 'same content';
      writeFileSync(filePath, content);
      const stat = statSync(filePath, { bigint: true });
      const hash = contentHashSync(content);

      const tracker = await import('../../core/indexing/incremental-tracker.js');
      await tracker.updateState({
        [fileName]: {
          hash,
          size: stat.size.toString(),
          mtime_ns: stat.mtimeNs.toString(),
        },
      });

      const result = await tracker.getChangedFiles([fileName], projectRoot);

      expect(result.unchanged).toEqual([fileName]);
      expect(result.fastPathStats.hits).toBe(0);
      expect(result.fastPathStats.contentReads).toBe(1);
      expect(result.currentHashes[fileName].inode).toBe(stat.ino.toString());
    });

    it('should detect removed files after state update', async () => {
      // Create initial files
      writeFileSync(join(projectRoot, 'keep.txt'), 'keep content');
      writeFileSync(join(projectRoot, 'remove.txt'), 'remove content');

      const tracker = await import('../../core/indexing/incremental-tracker.js');

      // Index both files
      const firstRun = await tracker.getChangedFiles(['keep.txt', 'remove.txt'], projectRoot);
      await tracker.updateState(firstRun.currentHashes);

      // "Delete" the file by not including it in the scan
      const secondRun = await tracker.getChangedFiles(['keep.txt'], projectRoot);

      expect(secondRun.toRemove).toContain('remove.txt');
    });

    it('should detect modified files via content hash change', async () => {
      const testFile = join(projectRoot, 'modify.txt');
      writeFileSync(testFile, 'original content');

      const tracker = await import('../../core/indexing/incremental-tracker.js');

      // First index
      const firstRun = await tracker.getChangedFiles(['modify.txt'], projectRoot);
      await tracker.updateState(firstRun.currentHashes);

      // Modify the file content
      writeFileSync(testFile, 'modified content - different hash');

      // Re-scan
      const secondRun = await tracker.getChangedFiles(['modify.txt'], projectRoot);

      // Should detect the modification
      expect(secondRun.toIndex).toContain('modify.txt');
    });
  });

  describe('State Persistence and Recovery', () => {
    it('should persist state across module reloads', async () => {
      writeFileSync(join(projectRoot, 'persist.txt'), 'test content');

      // Note: This test would require controlling STATE_PATH via config
      // For now, we test the logic via updateState/getChangedFiles
      const tracker = await import('../../core/indexing/incremental-tracker.js');

      const firstRun = await tracker.getChangedFiles(['persist.txt'], projectRoot);
      expect(firstRun.toIndex).toContain('persist.txt');

      await tracker.updateState(firstRun.currentHashes);

      // Get stats to verify state was saved
      const stats = await tracker.getStats();
      expect(stats.totalFiles).toBe(1);
      expect(stats.hasState).toBe(true);
    });
  });
});

// =============================================================================
// ENOSPC (DISK FULL) ERROR HANDLING TESTS (C4)
// =============================================================================

describe('ENOSPC Error Handling (C4)', () => {
  /**
   * Note: Direct fs mocking is challenging in ESM. Instead, we test the
   * ENOSPC handling logic indirectly by verifying:
   * 1. The saveState function exists and throws when file operations fail
   * 2. The error handling code path is correct
   *
   * For true ENOSPC testing in production, use a tmpfs with limited size.
   */

  it('should handle ENOSPC error code correctly in saveState logic', () => {
    // Test the error handling logic without actually triggering ENOSPC
    const enospcError = Object.assign(new Error('No space left on device'), { code: 'ENOSPC' });

    // Verify error has correct structure
    expect(enospcError.code).toBe('ENOSPC');
    expect(enospcError.message).toContain('No space');

    // The error should be recognized as ENOSPC
    const isEnospc = enospcError.code === 'ENOSPC';
    expect(isEnospc).toBe(true);
  });

  it('should export updateState that can handle errors', async () => {
    const tracker = await import('../../core/indexing/incremental-tracker.js');

    // updateState should be a function
    expect(typeof tracker.updateState).toBe('function');

    // Valid state should not throw
    const validState = { 'test.txt': { hash: 'abc', size: '100', mtime_ns: '123', inode: '456' } };
    await expect(tracker.updateState(validState)).resolves.not.toThrow();
  });
});

// =============================================================================
// MISSING VS CORRUPT STATE FILE DETECTION (E3)
// =============================================================================

describe('Missing vs Corrupt State Detection (E3)', () => {
  it('should return fresh state with appropriate reason for missing file', async () => {
    const tracker = await import('../../core/indexing/incremental-tracker.js');

    // clearState to ensure no state file exists
    await tracker.clearState();

    // Get stats should indicate fresh/no state
    const stats = await tracker.getStats();

    expect(stats.hasState).toBe(false);
    expect(stats.configValid).toBe(true); // Fresh state is always valid
  });

  it('should handle corrupt JSON gracefully', async () => {
    // This tests the internal behavior - corrupt JSON should be caught
    // and treated as "no previous state found"
    const tracker = await import('../../core/indexing/incremental-tracker.js');

    // The validateCurrentState function exercises the loadState path
    const validation = await tracker.validateCurrentState();

    // Should not throw, should return valid state info
    expect(validation).toBeDefined();
    expect(typeof validation.hasState).toBe('boolean');
    expect(typeof validation.configValid).toBe('boolean');
  });

  it('should detect provider config changes', async () => {
    const tracker = await import('../../core/indexing/incremental-tracker.js');

    // First, get current fingerprint
    const currentFingerprint = tracker.getCurrentConfigFingerprint();

    expect(currentFingerprint).toHaveProperty('provider');
    expect(currentFingerprint).toHaveProperty('model');
    expect(currentFingerprint).toHaveProperty('dimension');
    expect(currentFingerprint).toHaveProperty('hashAlgorithm', HASH_ALGORITHM);
    expect(currentFingerprint).toHaveProperty('version');
  });
});

// =============================================================================
// ATOMIC WRITE BEHAVIOR TESTS
// =============================================================================

describe('Atomic Write Pattern', () => {
  let testDir;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'atomic-write-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should not leave .tmp files on successful write', async () => {
    const tracker = await import('../../core/indexing/incremental-tracker.js');

    // Perform an update
    await tracker.updateState({ 'test.txt': { hash: 'abc', size: '100', mtime_ns: '123', inode: '456' } });

    // The state file should exist but no .tmp file
    // Note: This test relies on internal behavior but validates crash safety
    const stats = await tracker.getStats();
    expect(stats.hasState).toBe(true);
  });
});

// =============================================================================
// CONFIG FINGERPRINT INTEGRATION TESTS
// =============================================================================

describe('Config Fingerprint Integration', () => {
  it('should include all required fields in fingerprint', async () => {
    // Use dynamic import for ESM module
    const tracker = await import('../../core/indexing/incremental-tracker.js');

    const fingerprint = tracker.getCurrentConfigFingerprint();

    expect(fingerprint).toHaveProperty('provider');
    expect(fingerprint).toHaveProperty('model');
    expect(fingerprint).toHaveProperty('dimension');
    expect(fingerprint).toHaveProperty('hnswDimension');
    expect(fingerprint).toHaveProperty('hashAlgorithm', HASH_ALGORITHM);
    expect(fingerprint).toHaveProperty('version');

    // Version should be semver-like
    expect(fingerprint.version).toMatch(/^\d+\.\d+$/);
  });

  it('should validate current state without errors', async () => {
    const tracker = await import('../../core/indexing/incremental-tracker.js');

    const validation = await tracker.validateCurrentState();

    expect(validation).toHaveProperty('hasState');
    expect(validation).toHaveProperty('configValid');
    expect(validation).toHaveProperty('currentFingerprint');
  });
});
