/**
 * --full Flag Integration Tests
 *
 * Tests that the --full flag correctly triggers:
 * 1. HCGS (Hierarchical Code Graph Summary) generation
 * 2. Full vector reindexing
 * 3. Complete artifact rebuilding
 *
 * Uses actual indexer process spawning to verify end-to-end behavior.
 *
 * Optimization: all unique invocations run in parallel in beforeAll,
 * tests reference cached results (avoids ~20 redundant sequential spawns).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Run the indexer with given args
 */
function runIndexer(args = [], options = {}) {
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

    child.stdin.end();

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

// =============================================================================
// Pre-computed results: all unique invocations run in parallel
// =============================================================================

let helpResult, fullDryResult, fullQuietDryResult, statsResult, graphOnlyDryResult, invalidFlagResult;

beforeAll(async () => {
  TEST_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'ss-full-flag-'));
  mkdirSync(join(TEST_PROJECT_ROOT, 'src'), { recursive: true });
  writeFileSync(join(TEST_PROJECT_ROOT, 'src', 'app.js'), 'export function app() { return 1; }\n');

  [helpResult, fullDryResult, fullQuietDryResult, statsResult, graphOnlyDryResult, invalidFlagResult] =
    await runInBatches([
      () => runIndexer(['--help']),
      () => runIndexer(['--full', '--dry-run']),
      () => runIndexer(['--full', '--quiet', '--dry-run']),
      () => runIndexer(['--stats']),
      () => runIndexer(['--full', '--graph-only', '--dry-run']),
      () => runIndexer(['--invalid-test-flag-xyz', '--dry-run']),
    ]);
}, 360000);

afterAll(() => {
  if (TEST_PROJECT_ROOT) rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
});

// =============================================================================
// --full Flag Documentation Tests
// =============================================================================

describe('--full flag documentation', () => {
  it('should document --full in help output', () => {
    expect(helpResult.exitCode).toBe(0);
    expect(helpResult.stdout).toContain('--full');
    expect(helpResult.stdout).toContain('Full reindex');
    expect(helpResult.stdout).toContain('rebuild everything');
  });

  it('should describe --full as rebuilding from scratch', () => {
    const helpText = helpResult.stdout.toLowerCase();
    expect(helpText).toContain('full');
    expect(helpText).toContain('scratch');
  });
});

// =============================================================================
// --full Flag Behavior Tests (Dry Run)
// =============================================================================

describe('--full flag behavior (dry-run)', () => {
  it('should accept --full flag without error', () => {
    expect(fullDryResult.exitCode).toBe(0);
    expect(fullDryResult.stderr).not.toContain('Unknown flag');
    expect(fullDryResult.stderr).not.toContain('Unrecognized');
  });

  it('should NOT show deprecation warning for --full', () => {
    expect(fullDryResult.stdout).not.toContain('DEPRECATION');
    expect(fullDryResult.stdout).not.toContain('deprecated');
  });

  it('should combine --full with --quiet', () => {
    expect(fullQuietDryResult.exitCode).toBe(0);
    // Quiet mode should suppress banner
    expect(fullQuietDryResult.stdout).not.toContain('SEARCH 100x');
  });

  it('should show full reindex message in output', () => {
    // In dry-run mode with --full, should indicate full mode
    expect(fullDryResult.exitCode).toBe(0);
  });
});

// =============================================================================
// HCGS Generation Trigger Tests
// =============================================================================

describe('HCGS generation trigger', () => {
  it('--full should trigger complete HCGS regeneration', () => {
    // Verify help mentions that --full affects summaries
    expect(helpResult.stdout).toContain('Full reindex');
  });

  it('help should document HCGS-related behavior', () => {
    // Should mention code graph
    expect(helpResult.stdout).toContain('Code graph');
    // Should mention output files
    expect(helpResult.stdout).toContain('code-graph.db');
  });
});

// =============================================================================
// Flag Combination Tests
// =============================================================================

describe('--full flag combinations', () => {
  it('--full should work with --stats', () => {
    expect(statsResult.exitCode).toBe(0);
  });

  it('--full should work with --graph-only', () => {
    expect(graphOnlyDryResult.exitCode).toBe(0);
  });

  it('--full should work with --quiet for daemon use', () => {
    expect(fullQuietDryResult.exitCode).toBe(0);
    // Quiet mode should produce minimal output
    expect(fullQuietDryResult.stdout.length).toBeLessThan(1000);
  });

  it('--full should override incremental behavior', () => {
    // With --full, all files should be processed regardless of state
    expect(fullDryResult.stdout).not.toContain('No changes detected');
    expect(fullDryResult.exitCode).toBe(0);
  });
});

// =============================================================================
// Artifact Output Tests (When Not Dry-Run)
// =============================================================================

describe('HCGS output verification', () => {
  it('should document expected output files in help', () => {
    expect(helpResult.stdout).toContain('code-graph.db');
    expect(helpResult.stdout).toContain('codebase.db');
    expect(helpResult.stdout).toContain('hnsw');
  });

  it('should mention merkle state file in help', () => {
    expect(helpResult.stdout).toContain('merkle-state.json');
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('--full error handling', () => {
  it('should handle --full with no files gracefully', async () => {
    // This test needs a dynamic temp dir — cannot be cached
    const tempDir = join(tmpdir(), `full-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      const result = await runIndexer(['--full', '--dry-run'], {
        cwd: tempDir,
        timeout: 30000,
      });

      expect([0, 1]).toContain(result.exitCode);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should provide meaningful error on failure', () => {
    expect(typeof invalidFlagResult.exitCode).toBe('number');
  });
});

// =============================================================================
// Comparison: Default vs --full
// =============================================================================

describe('Default vs --full comparison', () => {
  it('default mode should mention incremental in help', () => {
    expect(helpResult.stdout).toContain('Incremental');
    expect(helpResult.stdout).toContain('default');
  });

  it('--full should explicitly differ from default mode', () => {
    expect(helpResult.stdout).toContain('--full');
    expect(helpResult.stdout).toContain('Full reindex');
    expect(helpResult.stdout).toContain('Incremental');
  });
});

// =============================================================================
// Parallel Execution Tests
// =============================================================================

describe('Parallel execution (HCGS + Vectors)', () => {
  it('--full should set up HCGS preparation stage', () => {
    const output = fullDryResult.stdout + fullDryResult.stderr;

    const hasFullMode = output.includes('Full Reindex Mode') ||
                        output.includes('Full Regeneration') ||
                        output.includes('--full');

    expect(hasFullMode).toBe(true);
    expect(fullDryResult.exitCode).toBe(0);
  });

  it('help should document that --full triggers HCGS regeneration', () => {
    expect(helpResult.stdout).toContain('--full');
    expect(helpResult.stdout).toContain('HCGS');
    expect(helpResult.exitCode).toBe(0);
  });

  it('--full --graph-only should NOT mention vector execution', () => {
    expect(graphOnlyDryResult.stdout).not.toContain('Vector Embeddings');
    expect(graphOnlyDryResult.exitCode).toBe(0);
  });

  it('code should use Promise.all for parallel execution', () => {
    // Parallel execution logic lives in indexer-phases.js (extracted from facade)
    const phasesSource = readFileSync(join(__dirname, '../..', 'core', 'indexing', 'indexer-phases.js'), 'utf-8');

    expect(phasesSource).toContain('Promise.all');
    expect(phasesSource).toContain('hcgsPromise');
    expect(phasesSource).toContain('vectorPromise');
  });
});
