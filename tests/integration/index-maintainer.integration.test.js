/**
 * Index Maintainer Integration Tests
 *
 * These tests import REAL functions from index-maintainer.mjs to verify:
 * 1. Atomic rename-before-read pattern prevents race conditions
 * 2. Queue parsing and deduplication logic
 * 3. Crash recovery (processing file requeued)
 * 4. Requeue operations preserve entries
 *
 * Unlike the simulation tests (index-maintainer.test.js), these tests
 * use the actual production code to catch real bugs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import the REAL functions from index-maintainer.mjs
import {
  parseQueueContent,
  normalizePath,
  atomicAcquireQueue,
  cleanupProcessingFile,
  requeueEntries,
  ensureDataDir,
  isReconcilePaused,
  reconcileV2Requested,
  reconcileV2Status,
  assertReconcileV2NotSilentlyIgnored,
  CONFIG,
} from '../../core/indexing/index-maintainer.mjs';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a unique temp directory for each test
 */
function createTestDir() {
  const testDir = join(tmpdir(), `index-maintainer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/**
 * Clean up test directory
 */
function cleanupTestDir(testDir) {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests
  }
}

/**
 * Create a test queue file with given entries
 */
function createQueueFile(queuePath, entries) {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(queuePath, content);
  return content;
}

// =============================================================================
// parseQueueContent Tests (Pure function, no side effects)
// =============================================================================

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

describe('reconcile v2 rollout guard (Real Implementation)', () => {
  it('is enabled by default when the env var is absent or empty (default-on)', () => {
    expect(reconcileV2Requested({})).toBe(true);
    expect(reconcileV2Requested({ SWEET_SEARCH_RECONCILE_V2: '' })).toBe(true);
  });

  it('honours explicit enable values', () => {
    expect(reconcileV2Requested({ SWEET_SEARCH_RECONCILE_V2: '1' })).toBe(true);
    expect(reconcileV2Requested({ SWEET_SEARCH_RECONCILE_V2: 'true' })).toBe(true);
    expect(reconcileV2Requested({ SWEET_SEARCH_RECONCILE_V2: 'on' })).toBe(true);
  });

  it('honours explicit opt-out values', () => {
    expect(reconcileV2Requested({ SWEET_SEARCH_RECONCILE_V2: '0' })).toBe(false);
    expect(reconcileV2Requested({ SWEET_SEARCH_RECONCILE_V2: 'false' })).toBe(false);
    expect(reconcileV2Requested({ SWEET_SEARCH_RECONCILE_V2: 'off' })).toBe(false);
  });

  it('exposes a structured status with the source of the decision', () => {
    expect(reconcileV2Status({})).toMatchObject({ enabled: true, source: 'default-on' });
    expect(reconcileV2Status({ SWEET_SEARCH_RECONCILE_V2: '1' }))
      .toMatchObject({ enabled: true, source: 'env-enabled' });
    expect(reconcileV2Status({ SWEET_SEARCH_RECONCILE_V2: '0' }))
      .toMatchObject({ enabled: false, source: 'env-disabled' });
    expect(reconcileV2Status({ SWEET_SEARCH_RECONCILE_V2: 'bogus' }))
      .toMatchObject({ enabled: true, source: 'env-enabled-permissive' });
  });

  it('assertReconcileV2NotSilentlyIgnored never throws for enabled configs', () => {
    expect(() => assertReconcileV2NotSilentlyIgnored({
      SWEET_SEARCH_RECONCILE_V2: '1',
    })).not.toThrow();
    expect(() => assertReconcileV2NotSilentlyIgnored({})).not.toThrow();
  });
});

describe('parseQueueContent (Real Implementation)', () => {
  it('should parse valid JSONL content', () => {
    const content = `{"file_path": "src/A.java", "timestamp": 1000}
{"file_path": "src/B.java", "timestamp": 2000}`;

    const result = parseQueueContent(content, '/project');

    expect(result.count).toBe(2);
    expect(result.files.has('src/A.java')).toBe(true);
    expect(result.files.has('src/B.java')).toBe(true);
    expect(result.malformedCount).toBe(0);
  });

  it('should deduplicate entries with same file_path (keep max retry/timestamp)', () => {
    const content = `{"file_path": "src/Dup.java", "timestamp": 1000, "retry": 0}
{"file_path": "src/Dup.java", "timestamp": 3000, "retry": 2}
{"file_path": "src/Dup.java", "timestamp": 2000, "retry": 1}`;

    const result = parseQueueContent(content, '/project');

    expect(result.count).toBe(1);
    const entry = result.files.get('src/Dup.java');
    expect(entry.retry).toBe(2);       // Max retry
    expect(entry.timestamp).toBe(3000); // Max timestamp
  });

  it('should count malformed entries', () => {
    const content = `{"file_path": "src/Valid.java"}
not json
{"missing": "file_path"}
{"file_path": "src/AlsoValid.java"}`;

    const result = parseQueueContent(content, '/project');

    expect(result.count).toBe(2);
    expect(result.malformedCount).toBe(2);
  });

  it('should handle empty content', () => {
    const result = parseQueueContent('', '/project');

    expect(result.count).toBe(0);
    expect(result.files.size).toBe(0);
    expect(result.malformedCount).toBe(0);
  });

  it('should handle whitespace-only content', () => {
    const result = parseQueueContent('  \n\n  \t\n  ', '/project');

    expect(result.count).toBe(0);
    expect(result.malformedCount).toBe(0);
  });
});

// =============================================================================
// normalizePath Tests (Pure function)
// =============================================================================

describe('normalizePath (Real Implementation)', () => {
  it('should convert absolute path within project to relative', () => {
    const result = normalizePath('/project/src/Test.java', '/project');
    expect(result).toBe('src/Test.java');
  });

  it('should preserve absolute path outside project', () => {
    const result = normalizePath('/other/src/Test.java', '/project');
    expect(result).toBe('/other/src/Test.java');
  });

  it('should preserve already relative paths', () => {
    const result = normalizePath('src/Test.java', '/project');
    expect(result).toBe('src/Test.java');
  });

  it('should handle null and empty paths', () => {
    expect(normalizePath(null, '/project')).toBeNull();
    expect(normalizePath(undefined, '/project')).toBeUndefined();
    expect(normalizePath('', '/project')).toBe('');
  });
});

// =============================================================================
// atomicAcquireQueue Tests (File operations with temp directory)
// =============================================================================

describe('atomicAcquireQueue (Real Implementation)', () => {
  let testDir;
  let queueFile;
  let processingFile;

  beforeEach(() => {
    testDir = createTestDir();
    queueFile = join(testDir, 'queue.jsonl');
    processingFile = join(testDir, 'queue.processing.jsonl');
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should atomically rename queue to processing, then return content', () => {
    // Create queue file
    const entries = [
      { file_path: 'src/A.java', timestamp: 1000 },
      { file_path: 'src/B.java', timestamp: 2000 },
    ];
    createQueueFile(queueFile, entries);

    // Acquire
    const result = atomicAcquireQueue(queueFile, processingFile);

    // Verify atomic rename happened
    expect(result.success).toBe(true);
    expect(existsSync(queueFile)).toBe(false);        // Queue file GONE
    expect(existsSync(processingFile)).toBe(true);    // Processing file EXISTS
    expect(result.content).toContain('src/A.java');
    expect(result.content).toContain('src/B.java');
  });

  it('should return queue_empty error when queue does not exist', () => {
    const result = atomicAcquireQueue(queueFile, processingFile);

    expect(result.success).toBe(false);
    expect(result.error).toBe('queue_empty');
    expect(result.content).toBeNull();
  });

  it('should prevent race condition: entries appended after rename go to new queue', () => {
    // Step 1: Create queue with entry A
    createQueueFile(queueFile, [{ file_path: 'src/A.java', timestamp: 1000 }]);

    // Step 2: Acquire (rename queue -> processing)
    const result = atomicAcquireQueue(queueFile, processingFile);
    expect(result.success).toBe(true);

    // Step 3: Simulate concurrent append (would happen after rename in race scenario)
    // This goes to a NEW queue file, not the processing file
    appendFileSync(queueFile, JSON.stringify({ file_path: 'src/B.java', timestamp: 2000 }) + '\n');

    // Step 4: Verify separation
    // - Processing file has only A
    const processingContent = readFileSync(processingFile, 'utf-8');
    expect(processingContent).toContain('src/A.java');
    expect(processingContent).not.toContain('src/B.java');

    // - New queue file has only B
    const newQueueContent = readFileSync(queueFile, 'utf-8');
    expect(newQueueContent).not.toContain('src/A.java');
    expect(newQueueContent).toContain('src/B.java');
  });

  it('should handle empty queue file', () => {
    writeFileSync(queueFile, '');

    const result = atomicAcquireQueue(queueFile, processingFile);

    expect(result.success).toBe(true);
    expect(result.content).toBe('');
  });
});

// =============================================================================
// cleanupProcessingFile Tests
// =============================================================================

describe('cleanupProcessingFile (Real Implementation)', () => {
  let testDir;
  let processingFile;

  beforeEach(() => {
    testDir = createTestDir();
    processingFile = join(testDir, 'queue.processing.jsonl');
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should delete processing file if it exists', () => {
    writeFileSync(processingFile, 'test content');
    expect(existsSync(processingFile)).toBe(true);

    cleanupProcessingFile(processingFile);

    expect(existsSync(processingFile)).toBe(false);
  });

  it('should not throw if processing file does not exist', () => {
    expect(existsSync(processingFile)).toBe(false);

    expect(() => cleanupProcessingFile(processingFile)).not.toThrow();
  });
});

// =============================================================================
// requeueEntries Tests
// =============================================================================

describe('requeueEntries (Real Implementation)', () => {
  let testDir;
  let queueFile;

  beforeEach(() => {
    testDir = createTestDir();
    queueFile = join(testDir, 'queue.jsonl');
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should append entries to queue file', () => {
    const entries = [
      { file_path: 'src/A.java', retry: 1 },
      { file_path: 'src/B.java', retry: 2 },
    ];

    requeueEntries(entries, queueFile);

    expect(existsSync(queueFile)).toBe(true);
    const content = readFileSync(queueFile, 'utf-8');
    expect(content).toContain('src/A.java');
    expect(content).toContain('src/B.java');
    expect(content).toContain('"retry":1');
    expect(content).toContain('"retry":2');
  });

  it('should append to existing queue file', () => {
    // Create initial queue
    createQueueFile(queueFile, [{ file_path: 'src/Existing.java' }]);

    // Requeue new entries
    requeueEntries([{ file_path: 'src/New.java' }], queueFile);

    const content = readFileSync(queueFile, 'utf-8');
    expect(content).toContain('src/Existing.java');
    expect(content).toContain('src/New.java');
  });

  it('should do nothing for empty entries array', () => {
    requeueEntries([], queueFile);

    // Should not create file
    expect(existsSync(queueFile)).toBe(false);
  });

  it('should do nothing for null entries', () => {
    expect(() => requeueEntries(null, queueFile)).not.toThrow();
    expect(existsSync(queueFile)).toBe(false);
  });
});

// =============================================================================
// Crash Recovery Scenario Tests
// =============================================================================

describe('Crash Recovery Scenarios (Integration)', () => {
  let testDir;
  let queueFile;
  let processingFile;

  beforeEach(() => {
    testDir = createTestDir();
    queueFile = join(testDir, 'queue.jsonl');
    processingFile = join(testDir, 'queue.processing.jsonl');
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should recover entries from processing file after crash', () => {
    // Simulate crash: processing file left behind
    const crashedEntries = [
      { file_path: 'src/InProgress1.java', timestamp: 1000 },
      { file_path: 'src/InProgress2.java', timestamp: 2000 },
    ];
    createQueueFile(processingFile, crashedEntries);

    // Recovery: read processing file, parse, requeue
    const content = readFileSync(processingFile, 'utf-8');
    const { files, count } = parseQueueContent(content, '/project');

    expect(count).toBe(2);

    // Requeue the entries
    const entriesToRequeue = Array.from(files.values());
    requeueEntries(entriesToRequeue, queueFile);

    // Clean up processing file
    cleanupProcessingFile(processingFile);

    // Verify recovery
    expect(existsSync(processingFile)).toBe(false);
    expect(existsSync(queueFile)).toBe(true);

    const recoveredContent = readFileSync(queueFile, 'utf-8');
    expect(recoveredContent).toContain('src/InProgress1.java');
    expect(recoveredContent).toContain('src/InProgress2.java');
  });

  it('should handle partial processing file (some entries malformed)', () => {
    // Processing file with some corruption
    const content = `{"file_path": "src/Good1.java", "timestamp": 1000}
corrupted line here
{"file_path": "src/Good2.java", "timestamp": 2000}`;
    writeFileSync(processingFile, content);

    // Parse (should skip malformed)
    const fileContent = readFileSync(processingFile, 'utf-8');
    const { files, count, malformedCount } = parseQueueContent(fileContent, '/project');

    expect(count).toBe(2);
    expect(malformedCount).toBe(1);

    // Only valid entries are recovered
    expect(files.has('src/Good1.java')).toBe(true);
    expect(files.has('src/Good2.java')).toBe(true);
  });
});

// =============================================================================
// Full Queue Processing Cycle (End-to-End)
// =============================================================================

describe('Full Queue Processing Cycle (Integration)', () => {
  let testDir;
  let queueFile;
  let processingFile;

  beforeEach(() => {
    testDir = createTestDir();
    queueFile = join(testDir, 'queue.jsonl');
    processingFile = join(testDir, 'queue.processing.jsonl');
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('should process queue with atomic acquire pattern (no lost entries)', () => {
    // Step 1: Create queue with 3 entries
    const entries = [
      { file_path: 'src/A.java', timestamp: 1000 },
      { file_path: 'src/B.java', timestamp: 2000 },
      { file_path: 'src/C.java', timestamp: 3000 },
    ];
    createQueueFile(queueFile, entries);

    // Step 2: Atomically acquire queue
    const acquired = atomicAcquireQueue(queueFile, processingFile);
    expect(acquired.success).toBe(true);

    // Step 3: Parse content
    const { files, count } = parseQueueContent(acquired.content, '/project');
    expect(count).toBe(3);

    // Step 4: Simulate concurrent append (after acquire)
    appendFileSync(queueFile, JSON.stringify({ file_path: 'src/D.java', timestamp: 4000 }) + '\n');

    // Step 5: Process the acquired entries (simulated success)
    const processed = Array.from(files.keys());
    expect(processed).toEqual(['src/A.java', 'src/B.java', 'src/C.java']);

    // Step 6: Cleanup processing file
    cleanupProcessingFile(processingFile);

    // Step 7: Verify the concurrent entry is preserved in new queue
    const newQueueContent = readFileSync(queueFile, 'utf-8');
    expect(newQueueContent).toContain('src/D.java');
    expect(newQueueContent).not.toContain('src/A.java');
  });

  it('should requeue entries on failure', () => {
    // Create queue
    const entries = [
      { file_path: 'src/A.java', retry: 0 },
      { file_path: 'src/B.java', retry: 1 },
    ];
    createQueueFile(queueFile, entries);

    // Acquire
    const acquired = atomicAcquireQueue(queueFile, processingFile);
    expect(acquired.success).toBe(true);

    // Parse
    const { files } = parseQueueContent(acquired.content, '/project');

    // Simulate failure: increment retry and requeue
    const failedEntries = Array.from(files.values()).map(entry => ({
      ...entry,
      retry: (entry.retry || 0) + 1,
      last_error: 'Indexer timeout',
    }));

    // Cleanup processing first
    cleanupProcessingFile(processingFile);

    // Requeue with incremented retries
    requeueEntries(failedEntries, queueFile);

    // Verify requeued entries have incremented retries
    const requeuedContent = readFileSync(queueFile, 'utf-8');
    const { files: requeuedFiles } = parseQueueContent(requeuedContent, '/project');

    expect(requeuedFiles.get('src/A.java').retry).toBe(1);
    expect(requeuedFiles.get('src/B.java').retry).toBe(2);
  });

  it('should deduplicate across multiple requeue cycles', () => {
    // First cycle: queue entry
    createQueueFile(queueFile, [{ file_path: 'src/Flaky.java', retry: 0, timestamp: 1000 }]);

    // Acquire and "fail" - requeue with retry 1
    let acquired = atomicAcquireQueue(queueFile, processingFile);
    let { files } = parseQueueContent(acquired.content, '/project');
    cleanupProcessingFile(processingFile);
    requeueEntries([{ file_path: 'src/Flaky.java', retry: 1, timestamp: 1000 }], queueFile);

    // Second cycle: another append (simulating concurrent edit)
    appendFileSync(queueFile, JSON.stringify({ file_path: 'src/Flaky.java', retry: 0, timestamp: 2000 }) + '\n');

    // Acquire again - should deduplicate
    acquired = atomicAcquireQueue(queueFile, processingFile);
    const parsed = parseQueueContent(acquired.content, '/project');

    // Should have only ONE entry with max retry and max timestamp
    expect(parsed.count).toBe(1);
    const entry = parsed.files.get('src/Flaky.java');
    expect(entry.retry).toBe(1);       // Max retry from first entry
    expect(entry.timestamp).toBe(2000); // Max timestamp from second entry

    cleanupProcessingFile(processingFile);
  });
});

// =============================================================================
// CONFIG Export Tests
// =============================================================================

describe('CONFIG Export', () => {
  it('should export configuration constants', () => {
    expect(CONFIG).toBeDefined();
    expect(CONFIG.PROJECT_ROOT).toBeDefined();
    expect(CONFIG.DATA_DIR).toBeDefined();
    expect(CONFIG.QUEUE_FILE).toBeDefined();
    expect(CONFIG.PROCESSING_FILE).toBeDefined();
    expect(CONFIG.LOCK_FILE).toBeDefined();
    expect(CONFIG.DEADLETTER_FILE).toBeDefined();
  });

  it('should have consistent paths', () => {
    expect(CONFIG.QUEUE_FILE).toContain('.sweet-search');
    expect(CONFIG.PROCESSING_FILE).toContain('.sweet-search');
    expect(CONFIG.DEADLETTER_FILE).toContain('.sweet-search');
  });
});
