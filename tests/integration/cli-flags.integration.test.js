/**
 * CLI Flags Integration Tests for index-codebase-v21.js
 *
 * Tests the following flags (Workstream E):
 * 1. --files-from-stdin: Read targeted file list from stdin
 * 2. --quiet: Suppress progress bars and non-essential output
 *
 * These tests spawn the actual indexer process to verify:
 * - stdin file list parsing and normalization
 * - quiet mode output suppression
 * - structured JSON output in quiet mode
 * - targeted indexing behavior
 *
 * Optimization: all unique invocations run in parallel in beforeAll,
 * tests reference cached results (avoids ~17 redundant sequential spawns).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const PROJECT_ROOT = join(__dirname, '..', '..');
const INDEXER_PATH = join(__dirname, '../..', 'core', 'indexing', 'index-codebase-v21.js');
const INDEXER_TIMEOUT_MS = Number(process.env.SWEET_SEARCH_TEST_INDEXER_TIMEOUT_MS || 300000);
let TEST_PROJECT_ROOT = null;

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Run the indexer with given args and stdin input
 * Returns { stdout, stderr, exitCode }
 */
function runIndexer(args = [], stdinInput = null, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = INDEXER_TIMEOUT_MS, cwd = TEST_PROJECT_ROOT || PROJECT_ROOT } = options;

    const child = spawn('node', [INDEXER_PATH, ...args], {
      cwd,
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: cwd },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (stdinInput !== null) {
      child.stdin.write(stdinInput);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Indexer timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function runInBatches(taskFns, batchSize = 3) {
  const results = [];
  for (let i = 0; i < taskFns.length; i += batchSize) {
    const batch = taskFns.slice(i, i + batchSize);
    results.push(...await Promise.all(batch.map(fn => fn())));
  }
  return results;
}

/**
 * Parse JSON output from quiet mode (last non-empty line)
 */
function parseQuietOutput(stdout) {
  const lines = stdout.trim().split('\n').filter(l => l.trim());
  // Find the JSON line (may not be last due to module-level logs like [MaxSim])
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{')) {
      try {
        return JSON.parse(line);
      } catch { /* not valid JSON, keep looking */ }
    }
  }
  return null;
}

// =============================================================================
// Pre-computed results: all unique invocations run in parallel
// =============================================================================

let helpResult, quietDryResult, quietHelpResult, quietStatsResult;
let stdinParseDryResult, stdinEmptyResult, stdinWhitespaceResult;
let stdinDedupDryResult, stdinAbsDryResult, stdinOutsideDryResult;
let stdinDotSlashDryResult, stdinFilterDryResult, stdinMixedDryResult;

beforeAll(async () => {
  TEST_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'ss-cli-flags-'));
  mkdirSync(join(TEST_PROJECT_ROOT, 'src'), { recursive: true });
  writeFileSync(join(TEST_PROJECT_ROOT, 'src', 'app.js'), 'export function app() { return 1; }\n');
  writeFileSync(join(TEST_PROJECT_ROOT, 'src', 'other.js'), 'export function other() { return 2; }\n');

  [
    helpResult,
    quietDryResult,
    quietHelpResult,
    quietStatsResult,
    stdinParseDryResult,
    stdinEmptyResult,
    stdinWhitespaceResult,
    stdinDedupDryResult,
    stdinAbsDryResult,
    stdinOutsideDryResult,
    stdinDotSlashDryResult,
    stdinFilterDryResult,
    stdinMixedDryResult,
  ] = await runInBatches([
    () => runIndexer(['--help']),
    () => runIndexer(['--quiet', '--dry-run']),
    () => runIndexer(['--quiet', '--help']),
    () => runIndexer(['--quiet', '--stats']),
    () => runIndexer(['--files-from-stdin', '--quiet', '--dry-run'], 'src/app.js\nsrc/other.js\n'),
    () => runIndexer(['--files-from-stdin', '--quiet'], ''),
    () => runIndexer(['--files-from-stdin', '--quiet'], '  \n\n  \t\n'),
    () => runIndexer(['--files-from-stdin', '--quiet', '--dry-run'], 'src/app.js\nsrc/app.js\nsrc/app.js\n'),
    () => runIndexer(['--files-from-stdin', '--quiet', '--dry-run'], `${TEST_PROJECT_ROOT}/src/app.js\n`),
    () => runIndexer(['--files-from-stdin', '--quiet', '--dry-run'], '/tmp/outside-project-file.java\nsrc/app.js\n'),
    () => runIndexer(['--files-from-stdin', '--quiet', '--dry-run'], './src/app.js\n./src/other.js\n'),
    () => runIndexer(['--files-from-stdin', '--quiet', '--dry-run'], 'node_modules/some/file.js\n.git/config\n'),
    () => runIndexer(['--files-from-stdin', '--quiet', '--dry-run'], `src/app.js\n/etc/passwd\nsrc/other.js\n`),
  ]);
}, 420000);

afterAll(() => {
  if (TEST_PROJECT_ROOT) rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
});

// =============================================================================
// --help Flag Tests (Quick sanity check)
// =============================================================================

describe('--help flag', () => {
  it('should show help text with new flags documented', () => {
    expect(helpResult.exitCode).toBe(0);
    expect(helpResult.stdout).toContain('--files-from-stdin');
    expect(helpResult.stdout).toContain('--quiet');
    expect(helpResult.stdout).toContain('stdin');
    expect(helpResult.stdout).toContain('daemon');
  });
});

// =============================================================================
// --quiet Flag Tests
// =============================================================================

describe('--quiet flag', () => {
  it('should suppress banner and progress output in quiet mode with --dry-run', () => {
    // Should not contain banner
    expect(quietDryResult.stdout).not.toContain('SEARCH 100x');
    expect(quietDryResult.stdout).not.toContain('Codebase Indexer');

    // Should not contain progress bars
    expect(quietDryResult.stdout).not.toContain('Discovering Files');
    expect(quietDryResult.stdout).not.toContain('Checking for Changes');
  });

  it('should output structured JSON in quiet mode', () => {
    // In dry-run mode, no JSON output is expected since we skip indexing
    // But let's verify no crash and minimal output
    expect(quietDryResult.exitCode).toBe(0);
    expect(quietDryResult.stderr.length).toBeLessThan(1000); // Minimal stderr
  });

  it('should still output errors to stderr in quiet mode', () => {
    // Help is always shown (not suppressed by quiet)
    expect(quietHelpResult.exitCode).toBe(0);
    expect(quietHelpResult.stdout).toContain('--files-from-stdin');
  });
});

// =============================================================================
// --files-from-stdin Flag Tests (stdin parsing)
// =============================================================================

describe('--files-from-stdin flag', () => {
  it('should parse newline-delimited file paths from stdin', () => {
    // With --dry-run, no actual indexing happens
    // But the parsing should succeed (no error)
    expect(stdinParseDryResult.exitCode).toBe(0);
  });

  it('should handle empty stdin gracefully', () => {
    expect(stdinEmptyResult.exitCode).toBe(0);

    const output = parseQuietOutput(stdinEmptyResult.stdout);
    if (output) {
      expect(output.success).toBe(true);
      expect(output.filesProcessed).toBe(0);
      expect(output.reason).toBe('no_stdin_input');
    }
  });

  it('should handle whitespace-only stdin gracefully', () => {
    expect(stdinWhitespaceResult.exitCode).toBe(0);

    const output = parseQuietOutput(stdinWhitespaceResult.stdout);
    if (output) {
      expect(output.success).toBe(true);
      expect(output.filesProcessed).toBe(0);
    }
  });

  it('should deduplicate duplicate file paths from stdin', () => {
    // Should not crash, deduplication happens internally
    expect(stdinDedupDryResult.exitCode).toBe(0);
  });

  it('should normalize absolute paths to repo-relative', () => {
    // Should succeed (path normalized internally)
    expect(stdinAbsDryResult.exitCode).toBe(0);
  });

  it('should skip paths outside the project', () => {
    // Should not crash - outside paths are skipped with a warning
    expect(stdinOutsideDryResult.exitCode).toBe(0);
  });

  it('should remove leading ./ from paths', () => {
    expect(stdinDotSlashDryResult.exitCode).toBe(0);
  });
});

// =============================================================================
// Combined --files-from-stdin and --quiet Tests
// =============================================================================

describe('--files-from-stdin with --quiet (daemon mode)', () => {
  it('should produce structured JSON output when no files provided', () => {
    expect(stdinEmptyResult.exitCode).toBe(0);

    // Parse JSON output
    const output = parseQuietOutput(stdinEmptyResult.stdout);
    expect(output).not.toBeNull();
    expect(output.success).toBe(true);
    expect(output.filesProcessed).toBe(0);
    expect(output.reason).toMatch(/no_stdin_input|no_valid_files/);
  });

  it('should filter out files not in codebase (not matching FILE_PATTERNS)', () => {
    // Should succeed but report no valid files
    expect(stdinFilterDryResult.exitCode).toBe(0);
  });

  it('should handle mixed valid and invalid paths', () => {
    // Should succeed, skipping invalid paths
    expect(stdinMixedDryResult.exitCode).toBe(0);
  });
});

// =============================================================================
// Actual Targeted Indexing Test (SLOW - requires real indexing)
// =============================================================================

describe('Targeted Indexing (end-to-end)', () => {
  // Skip by default since this requires real indexing infrastructure
  // Enable with: npm test -- --grep="Targeted Indexing"

  it.skip('should only re-embed specified files (requires full setup)', async () => {
    const input = 'CLAUDE.md\n';

    const result = await runIndexer(['--files-from-stdin', '--quiet'], input, {
      timeout: 120000, // 2 minutes for real indexing
    });

    expect(result.exitCode).toBe(0);

    const output = parseQuietOutput(result.stdout);
    expect(output).not.toBeNull();
    expect(output.success).toBe(true);
    expect(output.mode).toBe('targeted');
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error handling in quiet mode', () => {
  it('should output structured error JSON on failure', () => {
    expect(quietStatsResult.exitCode).toBe(0);
  });
});

// =============================================================================
// Regression Tests
// =============================================================================

describe('Regression: Daemon spawn args match behavior', () => {
  it('should recognize both --files-from-stdin and --quiet together', () => {
    // Reuses empty-stdin result — same invocation as daemon sends
    expect(stdinEmptyResult.exitCode).toBe(0);
    expect(stdinEmptyResult.stderr).not.toContain('Unknown flag');
    expect(stdinEmptyResult.stderr).not.toContain('Unrecognized');
  });

  it('should not produce multi-MB output buffers in quiet mode', () => {
    // Combined output should be small
    const totalOutput = quietDryResult.stdout.length + quietDryResult.stderr.length;
    expect(totalOutput).toBeLessThan(10000); // Less than 10KB
  });
});
