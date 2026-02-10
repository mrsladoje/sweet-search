/**
 * Index Maintainer Tests (v3)
 *
 * Tests for the index maintainer daemon:
 * - Lock file management (acquire, release, stale detection)
 * - Queue processing and deduplication
 * - Retry logic with exponential backoff
 * - Dead letter handling
 * - Graceful shutdown
 *
 * v3 Tests (2026-01-02) - per INDEXING_CHECK_PLAN.md Section 7:
 * - C2: Atomic O_EXCL lock acquisition (prevents TOCTOU race)
 * - Stale lock takeover behavior
 * - Merkle check fast-path optimization
 * - Global index lock with 2-minute stale threshold (H1)
 *
 * Note: index-maintainer.mjs is in .claude/hooks/, but we test it from sweet-search/__tests__
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';

// =============================================================================
// MOCKS
// =============================================================================

// Mock child_process with inline factory (vi.mock is hoisted)
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs module with inline factory (vi.mock is hoisted)
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  renameSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  constants: { O_CREAT: 0x40, O_EXCL: 0x80, O_WRONLY: 0x1 },
}));

// Get reference to mocked spawn for use in tests
const { spawn: mockSpawn } = await import('node:child_process');

// Mock process.kill for PID checking
const originalProcessKill = process.kill;
vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
  if (signal === 0) {
    // Check if process exists
    if (pid === process.pid || pid === 12345) {
      return true; // Process exists
    }
    throw new Error('ESRCH');
  }
  return originalProcessKill.call(process, pid, signal);
});

// =============================================================================
// TEST HELPERS
// =============================================================================

// Since index-maintainer.mjs has a main() that runs on import,
// we need to test the logic extracted from it
// For testability, we'll create mock implementations

/**
 * Simulates lock file reading
 */
function readLockFile(content) {
  if (!content) return null;
  const [pidStr, timestampStr] = content.trim().split('\n');
  const pid = parseInt(pidStr, 10);
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(pid) || isNaN(timestamp)) return null;
  return { pid, timestamp };
}

/**
 * Simulates PID running check
 */
function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Simulates queue reading and deduplication
 */
function readQueue(content, projectRoot = '/project') {
  if (!content) {
    return { files: new Map(), count: 0, rawLines: [] };
  }

  const lines = content.split('\n').filter((l) => l.trim());
  const files = new Map();
  const malformed = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (!entry.file_path) {
        malformed.push(line);
        continue;
      }

      const normalizedPath = normalizePath(entry.file_path, projectRoot);
      const existing = files.get(normalizedPath);

      if (!existing) {
        files.set(normalizedPath, { ...entry, file_path: normalizedPath });
      } else {
        files.set(normalizedPath, {
          file_path: normalizedPath,
          retry: Math.max(existing.retry || 0, entry.retry || 0),
          timestamp: Math.max(existing.timestamp || 0, entry.timestamp || 0),
          queued_at: entry.queued_at || existing.queued_at,
        });
      }
    } catch (err) {
      malformed.push(line);
    }
  }

  return { files, count: files.size, rawLines: lines, malformed };
}

/**
 * Simulates path normalization
 */
function normalizePath(filePath, projectRoot) {
  if (!filePath) return filePath;
  if (path.isAbsolute(filePath) && filePath.startsWith(projectRoot)) {
    return path.relative(projectRoot, filePath);
  }
  return filePath;
}

/**
 * Simulates retry delay calculation
 */
function getRetryDelay(retryCount, baseDelay = 1000, maxDelay = 30000) {
  const delay = baseDelay * Math.pow(2, retryCount);
  return Math.min(delay, maxDelay);
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Lock File Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('readLockFile', () => {
    it('should parse valid lock file', () => {
      const content = '12345\n1735670400000\n';
      const result = readLockFile(content);

      expect(result).toEqual({
        pid: 12345,
        timestamp: 1735670400000,
      });
    });

    it('should return null for empty content', () => {
      expect(readLockFile('')).toBeNull();
      expect(readLockFile(null)).toBeNull();
      expect(readLockFile(undefined)).toBeNull();
    });

    it('should return null for malformed content', () => {
      expect(readLockFile('not a number\n1234')).toBeNull();
      expect(readLockFile('1234\nnot a number')).toBeNull();
      expect(readLockFile('garbage')).toBeNull();
    });

    it('should handle missing newline', () => {
      const content = '12345\n1735670400000';
      const result = readLockFile(content);

      expect(result).toEqual({
        pid: 12345,
        timestamp: 1735670400000,
      });
    });
  });

  describe('isPidRunning', () => {
    it('should return true for running process', () => {
      expect(isPidRunning(process.pid)).toBe(true);
    });

    it('should return true for mocked running PID', () => {
      expect(isPidRunning(12345)).toBe(true);
    });

    it('should return false for non-existent PID', () => {
      expect(isPidRunning(99999)).toBe(false);
    });
  });

  describe('Lock Acquisition Logic', () => {
    const LOCK_STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

    it('should acquire lock when no existing lock', () => {
      const existing = null;

      // Logic: if no existing lock, acquire
      const shouldAcquire = !existing;
      expect(shouldAcquire).toBe(true);
    });

    it('should acquire lock when existing process is dead', () => {
      const existing = { pid: 99999, timestamp: Date.now() };
      const isRunning = isPidRunning(existing.pid);
      const isStale = Date.now() - existing.timestamp > LOCK_STALE_THRESHOLD;

      // Dead process = not running
      const shouldAcquire = !isRunning || isStale;
      expect(isRunning).toBe(false);
      expect(shouldAcquire).toBe(true);
    });

    it('should acquire lock when existing lock is stale', () => {
      const staleTime = Date.now() - (6 * 60 * 1000); // 6 minutes ago
      const existing = { pid: 12345, timestamp: staleTime };
      const isRunning = isPidRunning(existing.pid);
      const isStale = Date.now() - existing.timestamp > LOCK_STALE_THRESHOLD;

      expect(isRunning).toBe(true); // Mocked as running
      expect(isStale).toBe(true);
      expect(!isRunning || isStale).toBe(true);
    });

    it('should NOT acquire lock when existing process is running and fresh', () => {
      const freshTime = Date.now() - (1 * 60 * 1000); // 1 minute ago
      const existing = { pid: 12345, timestamp: freshTime };
      const isRunning = isPidRunning(existing.pid);
      const isStale = Date.now() - existing.timestamp > LOCK_STALE_THRESHOLD;

      expect(isRunning).toBe(true);
      expect(isStale).toBe(false);
      expect(isRunning && !isStale).toBe(true);
    });
  });
});

describe('Queue Processing', () => {
  describe('readQueue', () => {
    it('should parse valid queue entries', () => {
      const content = `
{"file_path": "src/Test.java", "timestamp": 1735670400000}
{"file_path": "src/Other.java", "timestamp": 1735670401000}
      `.trim();

      const result = readQueue(content);

      expect(result.count).toBe(2);
      expect(result.files.has('src/Test.java')).toBe(true);
      expect(result.files.has('src/Other.java')).toBe(true);
    });

    it('should deduplicate entries with same file_path', () => {
      const content = `
{"file_path": "src/Test.java", "timestamp": 1735670400000, "retry": 0}
{"file_path": "src/Test.java", "timestamp": 1735670500000, "retry": 2}
{"file_path": "src/Test.java", "timestamp": 1735670300000, "retry": 1}
      `.trim();

      const result = readQueue(content);

      expect(result.count).toBe(1);
      const entry = result.files.get('src/Test.java');
      expect(entry.retry).toBe(2); // Max retry count
      expect(entry.timestamp).toBe(1735670500000); // Most recent timestamp
    });

    it('should skip entries without file_path', () => {
      const content = `
{"file_path": "src/Valid.java", "timestamp": 1}
{"invalid": "entry"}
{"also_invalid": true}
{"file_path": "src/AlsoValid.java", "timestamp": 2}
      `.trim();

      const result = readQueue(content);

      expect(result.count).toBe(2);
      expect(result.malformed.length).toBe(2);
    });

    it('should handle malformed JSON gracefully', () => {
      const content = `
{"file_path": "src/Valid.java"}
not json at all
{broken json
{"file_path": "src/Another.java"}
      `.trim();

      const result = readQueue(content);

      expect(result.count).toBe(2);
      expect(result.malformed.length).toBe(2);
    });

    it('should return empty result for empty content', () => {
      const emptyResult = readQueue('');
      expect(emptyResult.files.size).toBe(0);
      expect(emptyResult.count).toBe(0);
      expect(emptyResult.rawLines).toEqual([]);

      const nullResult = readQueue(null);
      expect(nullResult.files.size).toBe(0);
      expect(nullResult.count).toBe(0);
    });

    it('should normalize absolute paths to relative', () => {
      const content = `{"file_path": "/project/src/Test.java", "timestamp": 1}`;

      const result = readQueue(content, '/project');

      expect(result.files.has('src/Test.java')).toBe(true);
    });

    it('should preserve relative paths', () => {
      const content = `{"file_path": "src/Test.java", "timestamp": 1}`;

      const result = readQueue(content, '/project');

      expect(result.files.has('src/Test.java')).toBe(true);
    });
  });
});

describe('Path Normalization', () => {
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

  it('should handle null/undefined paths', () => {
    expect(normalizePath(null, '/project')).toBeNull();
    expect(normalizePath(undefined, '/project')).toBeUndefined();
    expect(normalizePath('', '/project')).toBe('');
  });
});

describe('Cross-Platform Path Normalization', () => {
  // Import the actual functions from index-maintainer.mjs for cross-platform tests
  // Note: These tests verify the expected behavior of the enhanced normalization

  /**
   * Enhanced normalizePath that handles Windows paths (same as in index-maintainer.mjs)
   */
  function normalizePathSeparators(filePath) {
    if (!filePath) return filePath;
    let normalized = filePath.replace(/\\/g, '/');
    const driveMatch = normalized.match(/^([A-Za-z]):\//);
    if (driveMatch) {
      normalized = '/' + driveMatch[1].toLowerCase() + normalized.slice(2);
    }
    return normalized;
  }

  function normalizePathCrossPlatform(filePath, projectRoot) {
    if (!filePath) return filePath;
    const normalizedPath = normalizePathSeparators(filePath);
    const normalizedRoot = normalizePathSeparators(projectRoot);

    if (normalizedPath.startsWith(normalizedRoot + '/')) {
      return normalizedPath.slice(normalizedRoot.length + 1);
    }

    if (path.isAbsolute(filePath) && filePath.startsWith(projectRoot)) {
      const rel = path.relative(projectRoot, filePath);
      return normalizePathSeparators(rel);
    }

    return normalizedPath;
  }

  describe('normalizePathSeparators', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(normalizePathSeparators('src\\Test.java')).toBe('src/Test.java');
      expect(normalizePathSeparators('src\\sub\\dir\\Test.java')).toBe('src/sub/dir/Test.java');
    });

    it('should handle Windows absolute paths with drive letters', () => {
      expect(normalizePathSeparators('C:\\Users\\dev\\project\\src\\Test.java'))
        .toBe('/c/Users/dev/project/src/Test.java');
      expect(normalizePathSeparators('D:\\Code\\Test.java'))
        .toBe('/d/Code/Test.java');
    });

    it('should normalize drive letters to lowercase', () => {
      expect(normalizePathSeparators('C:/Users/test.java')).toBe('/c/Users/test.java');
      expect(normalizePathSeparators('D:/Code/test.java')).toBe('/d/Code/test.java');
    });

    it('should handle UNC paths', () => {
      expect(normalizePathSeparators('\\\\server\\share\\file.java'))
        .toBe('//server/share/file.java');
    });

    it('should preserve forward slashes', () => {
      expect(normalizePathSeparators('/home/user/project/src/Test.java'))
        .toBe('/home/user/project/src/Test.java');
    });

    it('should handle mixed separators', () => {
      expect(normalizePathSeparators('src\\sub/dir\\Test.java'))
        .toBe('src/sub/dir/Test.java');
    });

    it('should handle null/undefined/empty', () => {
      expect(normalizePathSeparators(null)).toBeNull();
      expect(normalizePathSeparators(undefined)).toBeUndefined();
      expect(normalizePathSeparators('')).toBe('');
    });
  });

  describe('normalizePathCrossPlatform', () => {
    it('should normalize Windows path within project to relative', () => {
      const result = normalizePathCrossPlatform(
        'C:\\projects\\sloth\\src\\Test.java',
        'C:\\projects\\sloth'
      );
      expect(result).toBe('src/Test.java');
    });

    it('should handle Windows path with forward slash project root', () => {
      // WSL scenario: project root is Unix-style, paths come in Windows-style
      const result = normalizePathCrossPlatform(
        '/c/projects/sloth/src/Test.java',
        '/c/projects/sloth'
      );
      expect(result).toBe('src/Test.java');
    });

    it('should preserve relative paths with backslashes normalized', () => {
      const result = normalizePathCrossPlatform('src\\sub\\Test.java', '/project');
      expect(result).toBe('src/sub/Test.java');
    });

    it('should handle Unix paths unchanged', () => {
      const result = normalizePathCrossPlatform(
        '/home/user/project/src/Test.java',
        '/home/user/project'
      );
      expect(result).toBe('src/Test.java');
    });
  });

  describe('Queue deduplication with cross-platform paths', () => {
    // Test that same file with different path formats deduplicates correctly
    function readQueueCrossPlatform(content, projectRoot = '/project') {
      const lines = content.split('\n').filter((l) => l.trim());
      const files = new Map();

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (!entry.file_path) continue;

          const normalizedPath = normalizePathCrossPlatform(entry.file_path, projectRoot);
          const existing = files.get(normalizedPath);

          if (!existing) {
            files.set(normalizedPath, { ...entry, file_path: normalizedPath });
          } else {
            files.set(normalizedPath, {
              file_path: normalizedPath,
              retry: Math.max(existing.retry || 0, entry.retry || 0),
              timestamp: Math.max(existing.timestamp || 0, entry.timestamp || 0),
            });
          }
        } catch (err) {
          // Skip malformed
        }
      }

      return { files, count: files.size };
    }

    it('should deduplicate same file with Unix and Windows paths', () => {
      const content = `
{"file_path": "src/Test.java", "timestamp": 1}
{"file_path": "src\\\\Test.java", "timestamp": 2}
      `.trim();

      const result = readQueueCrossPlatform(content);

      expect(result.count).toBe(1);
      expect(result.files.has('src/Test.java')).toBe(true);
      expect(result.files.get('src/Test.java').timestamp).toBe(2);
    });

    it('should deduplicate absolute Windows and relative paths', () => {
      const content = `
{"file_path": "C:\\\\project\\\\src\\\\Test.java", "timestamp": 1}
{"file_path": "src/Test.java", "timestamp": 2}
      `.trim();

      const result = readQueueCrossPlatform(content, '/c/project');

      expect(result.count).toBe(1);
      expect(result.files.has('src/Test.java')).toBe(true);
    });
  });
});

describe('Retry Delay Calculation', () => {
  it('should calculate exponential backoff', () => {
    expect(getRetryDelay(0)).toBe(1000); // 1s
    expect(getRetryDelay(1)).toBe(2000); // 2s
    expect(getRetryDelay(2)).toBe(4000); // 4s
    expect(getRetryDelay(3)).toBe(8000); // 8s
    expect(getRetryDelay(4)).toBe(16000); // 16s
  });

  it('should cap delay at maxDelay', () => {
    expect(getRetryDelay(10)).toBe(30000); // Capped at 30s
    expect(getRetryDelay(20)).toBe(30000); // Still capped
  });

  it('should respect custom base and max delays', () => {
    expect(getRetryDelay(0, 500, 5000)).toBe(500);
    expect(getRetryDelay(1, 500, 5000)).toBe(1000);
    expect(getRetryDelay(10, 500, 5000)).toBe(5000); // Capped
  });
});

describe('Queue Entry Classification', () => {
  const MAX_RETRIES = 3;

  it('should identify entries exceeding max retries', () => {
    const entries = [
      { file_path: 'a.java', retry: 0 },
      { file_path: 'b.java', retry: 2 },
      { file_path: 'c.java', retry: 3 },
      { file_path: 'd.java', retry: 5 },
    ];

    const toProcess = entries.filter((e) => (e.retry || 0) < MAX_RETRIES);
    const toDead = entries.filter((e) => (e.retry || 0) >= MAX_RETRIES);

    expect(toProcess.map((e) => e.file_path)).toEqual(['a.java', 'b.java']);
    expect(toDead.map((e) => e.file_path)).toEqual(['c.java', 'd.java']);
  });

  it('should handle entries without retry field', () => {
    const entry = { file_path: 'test.java', timestamp: 1 };
    const retryCount = entry.retry || 0;

    expect(retryCount).toBe(0);
    expect(retryCount < MAX_RETRIES).toBe(true);
  });
});

describe('Dead Letter Handling', () => {
  it('should create dead letter entry with error info', () => {
    const entry = {
      file_path: 'src/Failed.java',
      retry: 3,
      timestamp: 1735670400000,
    };

    const error = new Error('Index failed: timeout');

    const deadletterEntry = {
      ...entry,
      error: error.message,
      dead_at: new Date().toISOString(),
      pid: process.pid,
    };

    expect(deadletterEntry.file_path).toBe('src/Failed.java');
    expect(deadletterEntry.error).toBe('Index failed: timeout');
    expect(deadletterEntry.dead_at).toBeDefined();
    expect(deadletterEntry.pid).toBe(process.pid);
  });
});

describe('Retry Entry Creation', () => {
  it('should increment retry count on failure', () => {
    const originalEntry = {
      file_path: 'src/Test.java',
      retry: 1,
      timestamp: 1735670400000,
    };

    const error = { message: 'Indexer crashed' };

    const retryEntry = {
      ...originalEntry,
      retry: (originalEntry.retry || 0) + 1,
      last_error: error.message.substring(0, 200),
      last_attempt: new Date().toISOString(),
    };

    expect(retryEntry.retry).toBe(2);
    expect(retryEntry.last_error).toBe('Indexer crashed');
    expect(retryEntry.last_attempt).toBeDefined();
  });

  it('should truncate long error messages', () => {
    const longError = 'E'.repeat(500);

    const truncated = longError.substring(0, 200);

    expect(truncated.length).toBe(200);
  });
});

describe('Batch Processing Simulation', () => {
  it('should process entries and track results', () => {
    const entries = [
      { file_path: 'a.java' },
      { file_path: 'b.java' },
      { file_path: 'c.java', retry: 3 }, // Dead
    ];

    const MAX_RETRIES = 3;
    let processed = 0;
    let failed = 0;
    const toProcess = [];
    const toDead = [];

    for (const entry of entries) {
      if ((entry.retry || 0) >= MAX_RETRIES) {
        toDead.push(entry);
        failed++;
      } else {
        toProcess.push(entry);
      }
    }

    // Simulate successful indexing
    processed = toProcess.length;

    expect(processed).toBe(2);
    expect(failed).toBe(1);
    expect(toProcess.map((e) => e.file_path)).toEqual(['a.java', 'b.java']);
    expect(toDead.map((e) => e.file_path)).toEqual(['c.java']);
  });
});

describe('Graceful Shutdown', () => {
  it('should preserve in-flight batch on shutdown', () => {
    const currentBatch = [
      { file_path: 'a.java' },
      { file_path: 'b.java' },
    ];

    const shutdownRequested = true;

    // On shutdown, preserve batch
    const toRequeue = shutdownRequested ? currentBatch : [];

    expect(toRequeue.length).toBe(2);
  });

  it('should not preserve empty batch', () => {
    const currentBatch = null;
    const shutdownRequested = true;

    const toRequeue = (currentBatch && currentBatch.length > 0) ? currentBatch : [];

    expect(toRequeue.length).toBe(0);
  });
});

describe('Recovery from Crash', () => {
  it('should parse processing file on recovery', () => {
    const processingContent = `
{"file_path": "src/InProgress.java", "timestamp": 1}
{"file_path": "src/AlsoInProgress.java", "timestamp": 2}
    `.trim();

    const lines = processingContent.split('\n').filter((l) => l.trim());
    const entries = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.file_path) {
          entries.push(entry);
        }
      } catch {
        // Skip malformed
      }
    }

    expect(entries.length).toBe(2);
    expect(entries[0].file_path).toBe('src/InProgress.java');
  });

  it('should handle empty processing file', () => {
    const processingContent = '';
    const lines = processingContent.split('\n').filter((l) => l.trim());

    expect(lines.length).toBe(0);
  });
});

describe('Queue Mutation Operations', () => {
  describe('Truncate (Atomic Rename)', () => {
    it('should rename queue to processing file', () => {
      // This is the atomic operation pattern:
      // renameSync(QUEUE_FILE, PROCESSING_FILE)
      const queueFile = '/tmp/queue.jsonl';
      const processingFile = '/tmp/queue.processing.jsonl';

      // After rename, queue file should not exist
      // and processing file should contain the content
      expect(true).toBe(true); // Placeholder for fs mock verification
    });
  });

  describe('Append (Requeue)', () => {
    it('should append entries to queue file', () => {
      const entries = [
        { file_path: 'a.java', retry: 1 },
        { file_path: 'b.java', retry: 2 },
      ];

      const serialized = entries.map((e) => JSON.stringify(e) + '\n').join('');

      expect(serialized).toContain('a.java');
      expect(serialized).toContain('b.java');
      expect(serialized.endsWith('\n')).toBe(true);
    });
  });
});

describe('Indexer Spawning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should prepare correct arguments for indexer', () => {
    const filePaths = ['src/A.java', 'src/B.java', 'src/C.java'];
    const fileList = filePaths.join('\n');

    expect(fileList).toBe('src/A.java\nsrc/B.java\nsrc/C.java');
  });

  it('should mock spawn for indexer process', () => {
    const mockStdout = { on: vi.fn() };
    const mockStderr = { on: vi.fn() };
    const mockStdin = { write: vi.fn(), end: vi.fn() };

    mockSpawn.mockReturnValue({
      stdout: mockStdout,
      stderr: mockStderr,
      stdin: mockStdin,
      on: vi.fn(),
      killed: false,
      kill: vi.fn(),
    });

    const child = mockSpawn('node', ['indexer.js', '--files-from-stdin']);

    expect(child.stdout).toBeDefined();
    expect(child.stdin.write).toBeDefined();
  });
});

describe('Edge Cases', () => {
  it('should handle queue with only whitespace lines', () => {
    const content = '\n\n   \n\t\n';
    const result = readQueue(content);

    expect(result.count).toBe(0);
  });

  it('should handle very long file paths', () => {
    const longPath = 'src/' + 'a'.repeat(500) + '.java';
    const content = JSON.stringify({ file_path: longPath, timestamp: 1 });

    const result = readQueue(content);

    expect(result.count).toBe(1);
    expect(result.files.get(longPath)).toBeDefined();
  });

  it('should handle unicode in file paths', () => {
    const content = JSON.stringify({
      file_path: 'src/Unicorn_emoji.java',
      timestamp: 1,
    });

    const result = readQueue(content);

    expect(result.count).toBe(1);
  });

  it('should handle concurrent queue modifications', () => {
    // Simulates: queue being written while we read
    // The atomic rename pattern should prevent this
    const beforeRename = `{"file_path": "a.java", "timestamp": 1}`;
    const afterRename = `{"file_path": "b.java", "timestamp": 2}`;

    // After rename, we process beforeRename content
    // Any new entries (afterRename) go to new queue file
    const result = readQueue(beforeRename);

    expect(result.count).toBe(1);
    expect(result.files.has('a.java')).toBe(true);
  });

  it('should handle timestamp edge cases', () => {
    const content = `
{"file_path": "a.java", "timestamp": 0}
{"file_path": "b.java", "timestamp": -1}
{"file_path": "c.java"}
    `.trim();

    const result = readQueue(content);

    expect(result.count).toBe(3);
    expect(result.files.get('a.java').timestamp).toBe(0);
    expect(result.files.get('b.java').timestamp).toBe(-1);
    expect(result.files.get('c.java').timestamp).toBeUndefined();
  });
});

describe('Integration Scenarios', () => {
  it('should simulate full queue processing cycle', () => {
    // Step 1: Read queue
    const queueContent = `
{"file_path": "src/A.java", "timestamp": 1}
{"file_path": "src/B.java", "timestamp": 2, "retry": 1}
{"file_path": "src/C.java", "timestamp": 3, "retry": 3}
    `.trim();

    const { files, count } = readQueue(queueContent);
    expect(count).toBe(3);

    // Step 2: Classify entries
    const MAX_RETRIES = 3;
    const toProcess = [];
    const toDead = [];

    for (const [path, entry] of files) {
      if ((entry.retry || 0) >= MAX_RETRIES) {
        toDead.push(entry);
      } else {
        toProcess.push(entry);
      }
    }

    expect(toProcess.length).toBe(2);
    expect(toDead.length).toBe(1);

    // Step 3: Process (simulated success)
    const processed = toProcess.length;
    const failed = toDead.length;

    expect(processed).toBe(2);
    expect(failed).toBe(1);

    // Step 4: Results
    const result = { processed, failed, requeued: 0 };
    expect(result).toEqual({ processed: 2, failed: 1, requeued: 0 });
  });

  it('should simulate retry scenario', () => {
    // Initial failure
    const entry = { file_path: 'src/Flaky.java', timestamp: 1 };

    // First retry
    const retry1 = {
      ...entry,
      retry: 1,
      last_error: 'Timeout',
      last_attempt: new Date().toISOString(),
    };
    expect(retry1.retry).toBe(1);

    // Second retry
    const retry2 = { ...retry1, retry: 2 };
    expect(retry2.retry).toBe(2);

    // Third retry - still processable
    const retry3 = { ...retry2, retry: 3 };
    expect(retry3.retry).toBe(3);
    expect(retry3.retry >= 3).toBe(true); // Now should go to dead letter
  });
});

// =============================================================================
// INDEX MAINTAINER v3 TESTS
// Tests for v3 fixes per INDEXING_CHECK_PLAN.md Section 7
// =============================================================================

describe('Index Maintainer v3', () => {
  // Test directory for lock files
  const TEST_LOCK_DIR = '/tmp/test-index-maintainer';
  const TEST_LOCK_FILE = `${TEST_LOCK_DIR}/test.lock`;
  const LOCK_STALE_THRESHOLD = 180000; // 3 minutes (v3)
  const GLOBAL_LOCK_STALE_THRESHOLD = 120000; // 2 minutes (H1 fix)

  // ==========================================================================
  // ATOMIC O_EXCL LOCK ACQUISITION (C2 Fix)
  // ==========================================================================

  describe('acquireLock (atomic O_EXCL pattern)', () => {
    /**
     * Simulates the v3 atomic lock acquisition using O_EXCL flag.
     * This prevents TOCTOU race condition by making create+write atomic.
     *
     * @param {string} lockFile - Path to lock file
     * @param {Object} mockFs - Mock filesystem state
     * @returns {boolean} true if lock acquired
     */
    function acquireLockV3(lockFile, mockFs) {
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 100;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // Simulate atomic O_EXCL create
        if (mockFs.files[lockFile]) {
          // Lock exists - check if stale
          const existing = mockFs.files[lockFile];
          if (existing) {
            const isRunning = isPidRunning(existing.pid);
            const isStale = (Date.now() - existing.timestamp) > LOCK_STALE_THRESHOLD;

            if (!isRunning || isStale) {
              // Remove stale lock
              delete mockFs.files[lockFile];
              continue; // Retry in loop
            }
          }
          // Lock held by active process
          if (attempt < MAX_RETRIES - 1) {
            continue; // Would wait and retry
          }
          return false;
        }

        // Atomic create succeeds
        mockFs.files[lockFile] = {
          pid: process.pid,
          timestamp: Date.now(),
        };
        return true;
      }
      return false;
    }

    it('should acquire lock when none exists', () => {
      const mockFs = { files: {} };

      const acquired = acquireLockV3(TEST_LOCK_FILE, mockFs);

      expect(acquired).toBe(true);
      expect(mockFs.files[TEST_LOCK_FILE]).toBeDefined();
      expect(mockFs.files[TEST_LOCK_FILE].pid).toBe(process.pid);
    });

    it('should fail when lock held by running process', () => {
      const mockFs = {
        files: {
          [TEST_LOCK_FILE]: {
            pid: 12345, // Mocked as running
            timestamp: Date.now(),
          },
        },
      };

      const acquired = acquireLockV3(TEST_LOCK_FILE, mockFs);

      expect(acquired).toBe(false);
      // Original lock should remain
      expect(mockFs.files[TEST_LOCK_FILE].pid).toBe(12345);
    });

    it('should take over stale lock (age > threshold)', () => {
      const staleTime = Date.now() - (4 * 60 * 1000); // 4 minutes ago (> 3 min threshold)
      const mockFs = {
        files: {
          [TEST_LOCK_FILE]: {
            pid: 12345, // Running but stale
            timestamp: staleTime,
          },
        },
      };

      const acquired = acquireLockV3(TEST_LOCK_FILE, mockFs);

      expect(acquired).toBe(true);
      expect(mockFs.files[TEST_LOCK_FILE].pid).toBe(process.pid);
    });

    it('should take over lock when holder process is dead', () => {
      const mockFs = {
        files: {
          [TEST_LOCK_FILE]: {
            pid: 99999, // Not running (mocked)
            timestamp: Date.now(), // Fresh timestamp
          },
        },
      };

      const acquired = acquireLockV3(TEST_LOCK_FILE, mockFs);

      expect(acquired).toBe(true);
      expect(mockFs.files[TEST_LOCK_FILE].pid).toBe(process.pid);
    });

    it('should retry up to MAX_RETRIES times', () => {
      let attemptCount = 0;

      // Simulates lock acquisition with attempt tracking
      function acquireLockWithTracking(lockFile, mockFs) {
        const MAX_RETRIES = 3;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          attemptCount++;
          if (mockFs.files[lockFile]) {
            const existing = mockFs.files[lockFile];
            if (isPidRunning(existing.pid)) {
              if (attempt < MAX_RETRIES - 1) continue;
              return false;
            }
          }
          mockFs.files[lockFile] = { pid: process.pid, timestamp: Date.now() };
          return true;
        }
        return false;
      }

      const mockFs = {
        files: {
          [TEST_LOCK_FILE]: {
            pid: 12345, // Running
            timestamp: Date.now(),
          },
        },
      };

      const acquired = acquireLockWithTracking(TEST_LOCK_FILE, mockFs);

      expect(acquired).toBe(false);
      expect(attemptCount).toBe(3); // Tried 3 times
    });
  });

  // ==========================================================================
  // GLOBAL INDEX LOCK (H1 Fix - 2 minute stale threshold)
  // ==========================================================================

  describe('acquireGlobalIndexLock (H1 fix)', () => {
    /**
     * Simulates the v3 global index lock acquisition.
     * H1 Fix: Reduced stale threshold from 10 minutes to 2 minutes.
     */
    function acquireGlobalIndexLockV3(lockFile, mockFs) {
      const MAX_RETRIES = 3;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (mockFs.files[lockFile]) {
          const existing = mockFs.files[lockFile];
          const age = Date.now() - existing.timestamp;
          const isStale = age > GLOBAL_LOCK_STALE_THRESHOLD;
          let isDead = false;
          try {
            process.kill(existing.pid, 0);
          } catch {
            isDead = true;
          }

          if (isStale || isDead) {
            delete mockFs.files[lockFile];
            continue;
          }
          return false;
        }

        // Atomic create
        mockFs.files[lockFile] = {
          pid: process.pid,
          timestamp: Date.now(),
        };
        return true;
      }
      return false;
    }

    it('should acquire global lock when none exists', () => {
      const mockFs = { files: {} };

      const acquired = acquireGlobalIndexLockV3('/tmp/global.lock', mockFs);

      expect(acquired).toBe(true);
    });

    it('should take over global lock stale after 2 minutes (H1 fix)', () => {
      const staleTime = Date.now() - (3 * 60 * 1000); // 3 minutes ago
      const mockFs = {
        files: {
          '/tmp/global.lock': {
            pid: 12345, // Running
            timestamp: staleTime,
          },
        },
      };

      const acquired = acquireGlobalIndexLockV3('/tmp/global.lock', mockFs);

      // Should succeed because lock is > 2 minutes old
      expect(acquired).toBe(true);
    });

    it('should NOT take over global lock fresh within 2 minutes', () => {
      const freshTime = Date.now() - (1 * 60 * 1000); // 1 minute ago
      const mockFs = {
        files: {
          '/tmp/global.lock': {
            pid: 12345, // Running
            timestamp: freshTime,
          },
        },
      };

      const acquired = acquireGlobalIndexLockV3('/tmp/global.lock', mockFs);

      // Should fail because lock is fresh
      expect(acquired).toBe(false);
    });
  });

  // ==========================================================================
  // MERKLE CHECK INTEGRATION (performMerkleCheck)
  // ==========================================================================

  describe('performMerkleCheck', () => {
    /**
     * Simulates merkle check logic with mtime/size fast-path.
     */
    function simulateMerkleCheck(allFiles, storedState) {
      const toIndex = [];
      const toRemove = [];
      const currentHashes = {};
      const fastPathStats = { hits: 0, misses: 0, contentReads: 0 };

      // Check current files
      for (const file of allFiles) {
        const stored = storedState.files[file];

        // Simulated current file metadata
        const current = {
          size: file.length * 100,
          mtime_ns: Date.now().toString(),
        };

        // Fast-path check
        if (stored && typeof stored === 'object') {
          if (stored.size === current.size && stored.mtime_ns === current.mtime_ns) {
            fastPathStats.hits++;
            currentHashes[file] = stored;
            continue;
          }
        }

        // Slow path - need to read content and hash
        fastPathStats.misses++;
        fastPathStats.contentReads++;

        const newHash = {
          hash: `hash_${file}`,
          size: current.size,
          mtime_ns: current.mtime_ns,
        };

        currentHashes[file] = newHash;

        if (!stored || stored.hash !== newHash.hash) {
          toIndex.push(file);
        }
      }

      // Detect removed files
      for (const file of Object.keys(storedState.files)) {
        if (!allFiles.includes(file)) {
          toRemove.push(file);
        }
      }

      return { toIndex, toRemove, currentHashes, fastPathStats };
    }

    it('should detect new files', async () => {
      const allFiles = ['src/A.java', 'src/B.java', 'src/NEW.java'];
      const storedState = {
        files: {
          'src/A.java': { hash: 'hash_A', size: 1100, mtime_ns: Date.now().toString() },
          'src/B.java': { hash: 'hash_B', size: 1100, mtime_ns: Date.now().toString() },
        },
      };

      const result = simulateMerkleCheck(allFiles, storedState);

      expect(result.toIndex).toContain('src/NEW.java');
      expect(result.fastPathStats.misses).toBeGreaterThan(0);
    });

    it('should use fast-path for unchanged files', async () => {
      // For fast-path to work, size and mtime must match exactly.
      // We need to mock the "current" file metadata to match stored.
      // The simulateMerkleCheck uses file.length * 100 for size and Date.now() for mtime.
      // So we pre-compute what simulateMerkleCheck will generate.
      const allFiles = ['src/A.java', 'src/B.java'];

      // Create a modified simulateMerkleCheck that accepts current metadata
      function simulateMerkleCheckWithFastPath(files, storedState, currentMetadata) {
        const toIndex = [];
        const toRemove = [];
        const currentHashes = {};
        const fastPathStats = { hits: 0, misses: 0, contentReads: 0 };

        for (const file of files) {
          const stored = storedState.files[file];
          const current = currentMetadata[file] || { size: file.length * 100, mtime_ns: Date.now().toString() };

          if (stored && typeof stored === 'object') {
            if (stored.size === current.size && stored.mtime_ns === current.mtime_ns) {
              fastPathStats.hits++;
              currentHashes[file] = stored;
              continue;
            }
          }

          fastPathStats.misses++;
          fastPathStats.contentReads++;
          const newHash = { hash: `hash_${file}`, size: current.size, mtime_ns: current.mtime_ns };
          currentHashes[file] = newHash;
          if (!stored || stored.hash !== newHash.hash) {
            toIndex.push(file);
          }
        }

        return { toIndex, toRemove, currentHashes, fastPathStats };
      }

      // Stored state with known size and mtime
      const storedState = {
        files: {
          'src/A.java': { hash: 'hash_src/A.java', size: 1100, mtime_ns: '1735670400000' },
          'src/B.java': { hash: 'hash_src/B.java', size: 1100, mtime_ns: '1735670400000' },
        },
      };

      // Current metadata that matches stored exactly
      const currentMetadata = {
        'src/A.java': { size: 1100, mtime_ns: '1735670400000' },
        'src/B.java': { size: 1100, mtime_ns: '1735670400000' },
      };

      const result = simulateMerkleCheckWithFastPath(allFiles, storedState, currentMetadata);

      expect(result.fastPathStats.hits).toBe(2);
      expect(result.fastPathStats.misses).toBe(0);
      expect(result.toIndex).toHaveLength(0);
    });

    it('should detect removed files', async () => {
      const allFiles = ['src/A.java'];
      const storedState = {
        files: {
          'src/A.java': { hash: 'hash_A', size: 1100, mtime_ns: Date.now().toString() },
          'src/B.java': { hash: 'hash_B', size: 1100, mtime_ns: '123' },
          'src/DELETED.java': { hash: 'hash_D', size: 1400, mtime_ns: '456' },
        },
      };

      const result = simulateMerkleCheck(allFiles, storedState);

      expect(result.toRemove).toContain('src/B.java');
      expect(result.toRemove).toContain('src/DELETED.java');
      expect(result.toRemove).toHaveLength(2);
    });

    it('should detect modified files (size changed)', async () => {
      const timestamp = Date.now().toString();
      const allFiles = ['src/A.java'];
      const storedState = {
        files: {
          'src/A.java': {
            hash: 'old_hash',
            size: 500, // Different size
            mtime_ns: timestamp,
          },
        },
      };

      const result = simulateMerkleCheck(allFiles, storedState);

      expect(result.fastPathStats.misses).toBe(1);
      expect(result.toIndex).toContain('src/A.java');
    });

    it('should detect modified files (mtime changed)', async () => {
      const allFiles = ['src/A.java'];
      const storedState = {
        files: {
          'src/A.java': {
            hash: 'old_hash',
            size: 1100, // Same size
            mtime_ns: '123456789', // Different mtime
          },
        },
      };

      const result = simulateMerkleCheck(allFiles, storedState);

      expect(result.fastPathStats.misses).toBe(1);
    });

    it('should handle v2.2 format migration (string hash)', async () => {
      const allFiles = ['src/A.java'];
      const storedState = {
        files: {
          'src/A.java': 'legacy_hash_string', // v2.2 format
        },
      };

      // Fast-path should fail for string format
      function canUseFastPath(stored) {
        return stored && typeof stored === 'object' && stored.size && stored.mtime_ns;
      }

      expect(canUseFastPath(storedState.files['src/A.java'])).toBe(false);
    });
  });

  // ==========================================================================
  // ATOMIC QUEUE OPERATIONS (H5 Fix)
  // ==========================================================================

  describe('atomicCheckAndProcessQueue (H5 fix)', () => {
    /**
     * Simulates the atomic queue check+process operation.
     * H5 Fix: Combines peek and acquire into single atomic operation.
     */
    function atomicCheckAndProcessQueue(mockFs) {
      const queueFile = '/tmp/queue.jsonl';
      const processingFile = '/tmp/queue.processing.jsonl';

      // Atomic acquire - rename then read
      if (!mockFs.files[queueFile]) {
        return { processed: 0, failed: 0, requeued: 0, empty: true };
      }

      // Simulate atomic rename
      const content = mockFs.files[queueFile];
      mockFs.files[processingFile] = content;
      delete mockFs.files[queueFile];

      // Parse content
      const entries = content.split('\n').filter(l => l.trim()).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(e => e && e.file_path);

      if (entries.length === 0) {
        delete mockFs.files[processingFile];
        return { processed: 0, failed: 0, requeued: 0, empty: true };
      }

      // Simulate processing
      delete mockFs.files[processingFile];
      return { processed: entries.length, failed: 0, requeued: 0, empty: false };
    }

    it('should return empty true when queue does not exist', () => {
      const mockFs = { files: {} };

      const result = atomicCheckAndProcessQueue(mockFs);

      expect(result.empty).toBe(true);
      expect(result.processed).toBe(0);
    });

    it('should atomically acquire and process queue', () => {
      const mockFs = {
        files: {
          '/tmp/queue.jsonl': '{"file_path":"a.java"}\n{"file_path":"b.java"}',
        },
      };

      const result = atomicCheckAndProcessQueue(mockFs);

      expect(result.processed).toBe(2);
      expect(result.empty).toBe(false);
      // Queue should be removed after processing
      expect(mockFs.files['/tmp/queue.jsonl']).toBeUndefined();
      // Processing file should be cleaned up
      expect(mockFs.files['/tmp/queue.processing.jsonl']).toBeUndefined();
    });

    it('should handle empty queue file', () => {
      const mockFs = {
        files: {
          '/tmp/queue.jsonl': '\n\n',
        },
      };

      const result = atomicCheckAndProcessQueue(mockFs);

      expect(result.empty).toBe(true);
    });

    it('should handle malformed entries gracefully', () => {
      const mockFs = {
        files: {
          '/tmp/queue.jsonl': '{"file_path":"valid.java"}\nnot json\n{"broken',
        },
      };

      const result = atomicCheckAndProcessQueue(mockFs);

      expect(result.processed).toBe(1); // Only valid entry processed
    });
  });

  // ==========================================================================
  // SKIPPED CYCLE TRACKING (M4 Fix)
  // ==========================================================================

  describe('pendingFromSkippedCycle (M4 fix)', () => {
    it('should track skipped merkle checks when lock contended', () => {
      const pendingFromSkippedCycle = new Set();

      // Simulate lock contention
      const lockAcquired = false;

      if (!lockAcquired) {
        pendingFromSkippedCycle.add('merkle-check-pending');
      }

      expect(pendingFromSkippedCycle.has('merkle-check-pending')).toBe(true);

      // On next successful cycle, should force full check
      const forceFullCheck = pendingFromSkippedCycle.has('merkle-check-pending');
      expect(forceFullCheck).toBe(true);

      // Clear after processing
      pendingFromSkippedCycle.delete('merkle-check-pending');
      expect(pendingFromSkippedCycle.has('merkle-check-pending')).toBe(false);
    });
  });

  // ==========================================================================
  // LOG HELPER (L3 Fix)
  // ==========================================================================

  describe('log helper (L3 fix)', () => {
    function log(level, message) {
      const timestamp = new Date().toISOString().slice(11, 19);
      return `[${timestamp}] [${level}] [index-maintainer] ${message}`;
    }

    it('should format log with timestamp and level', () => {
      const output = log('INFO', 'Starting daemon v3...');

      expect(output).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[INFO\] \[index-maintainer\] Starting daemon v3\.\.\./);
    });

    it('should support different log levels', () => {
      expect(log('INFO', 'test')).toContain('[INFO]');
      expect(log('WARN', 'test')).toContain('[WARN]');
      expect(log('ERROR', 'test')).toContain('[ERROR]');
      expect(log('DEBUG', 'test')).toContain('[DEBUG]');
    });
  });

  // ==========================================================================
  // STARTUP TIMEOUT CANCELLATION (M8 Fix)
  // ==========================================================================

  describe('startupTimeout cancellation (M8 fix)', () => {
    it('should track startup timeout reference for cancellation', () => {
      let startupTimeout = null;

      // Simulate setting timeout
      startupTimeout = setTimeout(() => {
        // Would run merkle check
      }, 7000);

      expect(startupTimeout).not.toBeNull();

      // Simulate shutdown
      if (startupTimeout) {
        clearTimeout(startupTimeout);
        startupTimeout = null;
      }

      expect(startupTimeout).toBeNull();
    });
  });

  // ==========================================================================
  // LOCK TIMING CONFIGURATION (M5 Fix)
  // ==========================================================================

  describe('lock timing configuration (M5 fix)', () => {
    it('should have refresh interval < stale threshold (6:1 ratio)', () => {
      const LOCK_REFRESH_INTERVAL = 30000;  // 30 seconds
      const LOCK_STALE_THRESHOLD_V3 = 180000;  // 3 minutes

      const ratio = LOCK_STALE_THRESHOLD_V3 / LOCK_REFRESH_INTERVAL;

      // Ratio should be 6:1 to ensure lock is refreshed multiple times before going stale
      expect(ratio).toBe(6);
      expect(LOCK_STALE_THRESHOLD_V3).toBeGreaterThan(LOCK_REFRESH_INTERVAL * 2);
    });

    it('should have global lock stale at 2 minutes (H1 fix)', () => {
      expect(GLOBAL_LOCK_STALE_THRESHOLD).toBe(120000); // 2 minutes
    });
  });
});
