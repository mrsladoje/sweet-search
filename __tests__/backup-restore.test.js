/**
 * Summary Backup/Restore Tests
 *
 * Tests for the core fix in INDEXING_PLAN.md:
 * - Always-on backup (no flag needed)
 * - Collision-proof restore with cascading match strategy:
 *   1. ID match (fastest)
 *   2. (file_path, type, name, signature_hash) for overloaded methods
 *   3. (file_path, type, name) only if unique (legacy fallback)
 * - Graceful handling of missing/corrupted databases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';

// Mock better-sqlite3 for unit tests
const mockDb = {
  prepare: vi.fn(),
  close: vi.fn(),
  transaction: vi.fn((fn) => fn),
};

const mockStmt = {
  all: vi.fn(),
  run: vi.fn(),
  get: vi.fn(),
};

// Mock fs.existsSync - only mock what we need, avoid spreading original (hoisting issue)
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn((p) => p.includes('/tmp/test.db')),
  };
});

vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(function MockDatabase() { return mockDb; }),
  };
});

// Import after mocking
import {
  backupSummaries,
  restoreSummaries,
  getSummaryStats,
  markForRegeneration,
  getEntitiesNeedingSummary,
  storeSummary,
  storeSummariesBatch,
} from '../core/summary-manager.js';
import { existsSync } from 'fs';

describe('Summary Backup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('should backup all summaries with id, signature_hash, and embeddings', async () => {
    const mockSummaries = [
      {
        id: 'abc123def456',
        name: 'TestClass',
        file_path: 'src/Test.java',
        type: 'class',
        signature: 'public class TestClass',
        signature_hash: null,  // Classes don't need signature_hash
        summary: 'Test class for unit testing',
        summary_embedding: Buffer.from([1, 2, 3, 4])
      },
      {
        id: 'xyz789ghi012',
        name: 'testMethod',
        file_path: 'src/Test.java',
        type: 'method',
        signature: 'public void testMethod()',
        signature_hash: 'a1b2c3d4',  // 8-char hash of signature
        summary: 'Test method that does testing',
        summary_embedding: Buffer.from([5, 6, 7, 8])
      }
    ];

    mockStmt.all.mockReturnValue(mockSummaries);

    const result = await backupSummaries('/tmp/test.db');

    expect(result.count).toBe(2);
    expect(result.summaries).toHaveLength(2);
    expect(result.summaries[0]).toHaveProperty('id');
    expect(result.summaries[0]).toHaveProperty('name');
    expect(result.summaries[0]).toHaveProperty('file_path');
    expect(result.summaries[0]).toHaveProperty('type');
    expect(result.summaries[0]).toHaveProperty('signature_hash');
    expect(result.summaries[0]).toHaveProperty('summary');
    expect(result.summaries[0]).toHaveProperty('summary_embedding');
  });

  it('should handle missing database gracefully', async () => {
    const result = await backupSummaries('/nonexistent/path.db');

    expect(result.count).toBe(0);
    expect(result.summaries).toEqual([]);
    expect(result.error).toBeUndefined(); // No error for missing file, just empty
  });

  it('should include timestamp in backup', async () => {
    mockStmt.all.mockReturnValue([]);

    const before = Date.now();
    const result = await backupSummaries('/tmp/test.db');
    const after = Date.now();

    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });
});

describe('Summary Restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
    mockStmt.run.mockReturnValue({ changes: 1 });
    mockStmt.get.mockReturnValue({ cnt: 1 });  // For count queries
  });

  it('should restore summaries using cascading match strategy (ID first)', async () => {
    const backup = {
      summaries: [
        {
          id: 'abc123def456',
          name: 'TestClass',
          file_path: 'src/Test.java',
          type: 'class',
          signature_hash: null,
          summary: 'Test class',
          summary_embedding: Buffer.from([1, 2, 3])
        }
      ],
      count: 1
    };

    const result = await restoreSummaries('/tmp/test.db', backup);

    expect(result.restored).toBe(1);
    expect(result.skipped.total).toBe(0);
    expect(result.skipped.idMatch).toBe(1);  // Should match by ID

    // Verify the first update attempt was by ID
    expect(mockStmt.run).toHaveBeenCalledWith(
      backup.summaries[0].summary,
      backup.summaries[0].summary_embedding,
      backup.summaries[0].id
    );
  });

  it('should fall back to signature_hash match for overloaded methods', async () => {
    // ID match fails, signature_hash match succeeds
    mockStmt.run
      .mockReturnValueOnce({ changes: 0 })  // ID match fails
      .mockReturnValueOnce({ changes: 1 }); // signature_hash match succeeds

    const backup = {
      summaries: [
        {
          id: 'old_id_changed',
          name: 'overloadedMethod',
          file_path: 'src/Test.java',
          type: 'method',
          signature_hash: 'a1b2c3d4',
          summary: 'Overloaded method variant',
          summary_embedding: null
        }
      ],
      count: 1
    };

    const result = await restoreSummaries('/tmp/test.db', backup);

    expect(result.restored).toBe(1);
    expect(result.skipped.sigHashMatch).toBe(1);
  });

  it('should fall back to legacy match only if unique', async () => {
    // No ID (null), no signature_hash (null), so only legacy match is attempted
    // Legacy count shows exactly 1 match, so it's safe to restore
    mockStmt.run.mockReturnValueOnce({ changes: 1 }); // legacy match succeeds (only call made)
    mockStmt.get.mockReturnValue({ cnt: 1 });  // Exactly one match

    const backup = {
      summaries: [
        {
          id: null,  // Legacy backup without ID - skips ID match
          name: 'legacyMethod',
          file_path: 'src/Legacy.java',
          type: 'method',
          signature_hash: null,  // No signature hash - skips signature_hash match
          summary: 'Legacy method',
          summary_embedding: null
        }
      ],
      count: 1
    };

    const result = await restoreSummaries('/tmp/test.db', backup);

    expect(result.restored).toBe(1);
    expect(result.skipped.legacyMatch).toBe(1);
  });

  it('should skip ambiguous entities (multiple same-name methods without signature_hash)', async () => {
    // All matches fail, and legacy count shows duplicates
    mockStmt.run.mockReturnValue({ changes: 0 });
    mockStmt.get.mockReturnValue({ cnt: 3 });  // 3 methods with same name!

    const backup = {
      summaries: [
        {
          id: null,
          name: 'duplicateName',
          file_path: 'src/Test.java',
          type: 'method',
          signature_hash: null,
          summary: 'Which one?',
          summary_embedding: null
        }
      ],
      count: 1
    };

    const result = await restoreSummaries('/tmp/test.db', backup);

    expect(result.restored).toBe(0);
    expect(result.skipped.ambiguous).toBe(1);
    expect(result.skipped.total).toBe(1);
  });

  it('should handle empty backup gracefully', async () => {
    const result = await restoreSummaries('/tmp/test.db', { summaries: [], count: 0 });

    expect(result.restored).toBe(0);
    expect(result.skipped.total).toBe(0);
  });

  it('should handle null backup gracefully', async () => {
    const result = await restoreSummaries('/tmp/test.db', null);

    expect(result.restored).toBe(0);
    expect(result.skipped.total).toBe(0);
  });
});

describe('Summary Stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('should return accurate statistics', async () => {
    mockStmt.get.mockReturnValue({
      total: 100,
      with_summary: 80,
      without_summary: 20
    });

    mockStmt.all.mockReturnValue([
      { type: 'class', total: 30, with_summary: 25 },
      { type: 'method', total: 50, with_summary: 40 },
      { type: 'field', total: 20, with_summary: 15 },
    ]);

    const stats = await getSummaryStats('/tmp/test.db');

    expect(stats.total).toBe(100);
    expect(stats.withSummary).toBe(80);
    expect(stats.withoutSummary).toBe(20);
    expect(stats.byType).toHaveProperty('class');
    expect(stats.byType.class.total).toBe(30);
    expect(stats.byType.class.withSummary).toBe(25);
  });
});

describe('Mark for Regeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('should mark entities from changed files', async () => {
    mockStmt.run.mockReturnValue({ changes: 5 });

    const result = await markForRegeneration('/tmp/test.db', ['src/Test.java']);

    expect(result.marked).toBe(5);
  });

  it('should handle empty file list', async () => {
    const result = await markForRegeneration('/tmp/test.db', []);

    expect(result.marked).toBe(0);
    expect(mockStmt.run).not.toHaveBeenCalled();
  });
});

describe('Store Summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
  });

  it('should store single summary', async () => {
    mockStmt.run.mockReturnValue({ changes: 1 });

    const result = await storeSummary('/tmp/test.db', 123, 'Test summary', Buffer.from([1, 2, 3]));

    expect(result.success).toBe(true);
    expect(mockStmt.run).toHaveBeenCalledWith('Test summary', expect.any(Buffer), 123);
  });

  it('should handle missing embedding', async () => {
    mockStmt.run.mockReturnValue({ changes: 1 });

    const result = await storeSummary('/tmp/test.db', 123, 'Test summary');

    expect(result.success).toBe(true);
    expect(mockStmt.run).toHaveBeenCalledWith('Test summary', null, 123);
  });
});

describe('Store Summaries Batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockStmt);
    mockDb.transaction.mockImplementation((fn) => () => fn());
  });

  it('should store multiple summaries in transaction', async () => {
    mockStmt.run.mockReturnValue({ changes: 1 });

    const summaries = [
      { id: 1, summary: 'Summary 1', embedding: Buffer.from([1]) },
      { id: 2, summary: 'Summary 2', embedding: Buffer.from([2]) },
      { id: 3, summary: 'Summary 3' }, // No embedding
    ];

    const result = await storeSummariesBatch('/tmp/test.db', summaries);

    expect(result.stored).toBe(3);
    expect(mockDb.transaction).toHaveBeenCalled();
    expect(mockStmt.run).toHaveBeenCalledTimes(3);
  });

  it('should handle empty batch', async () => {
    const result = await storeSummariesBatch('/tmp/test.db', []);

    expect(result.stored).toBe(0);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
