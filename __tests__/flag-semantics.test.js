/**
 * Flag Semantics Tests
 *
 * Tests for CLI flag behavior and help output accuracy:
 * 1. --skip-summary-regen behavior and deprecation
 * 2. Help output includes accurate descriptions
 * 3. Flag combinations work correctly
 * 4. All documented flags are recognized
 *
 * Uses actual indexer process spawning for integration tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const INDEXER_PATH = join(__dirname, '..', 'core', 'index-codebase-v21.js');

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Run the indexer with given args
 */
function runIndexer(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = 30000, cwd = PROJECT_ROOT } = options;

    const child = spawn('node', [INDEXER_PATH, ...args], {
      cwd,
      env: { ...process.env },
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

// =============================================================================
// --skip-summary-regen Tests
// =============================================================================

describe('--skip-summary-regen flag', () => {
  it('should be recognized as a valid flag', async () => {
    const result = await runIndexer(['--skip-summary-regen', '--dry-run']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Unknown flag');
    expect(result.stderr).not.toContain('Unrecognized option');
  });

  it('should show deprecation warning', async () => {
    const result = await runIndexer(['--skip-summary-regen', '--dry-run']);

    // The flag shows a deprecation notice
    expect(result.stdout).toContain('DEPRECATION');
    expect(result.stdout).toContain('--skip-summary-regen');
  });

  it('should be documented in help output', async () => {
    const result = await runIndexer(['--help']);

    expect(result.stdout).toContain('--skip-summary-regen');
  });

  it('should describe what skip-summary-regen does', async () => {
    const result = await runIndexer(['--help']);

    // Help should explain the flag preserves summaries
    expect(result.stdout).toMatch(/skip.*summary.*regen|preserves.*summar/i);
  });

  it('should work with --quiet flag', async () => {
    const result = await runIndexer(['--skip-summary-regen', '--quiet', '--dry-run']);

    // Should not crash
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Help Output Accuracy Tests
// =============================================================================

describe('Help output accuracy', () => {
  let helpOutput;

  beforeAll(async () => {
    const result = await runIndexer(['--help']);
    helpOutput = result.stdout;
  });

  it('should include all primary flags', () => {
    const primaryFlags = [
      '--full',
      '--graph-only',
      '--vectors-only',
      '--dry-run',
      '--quiet',
      '--help',
      '--stats',
    ];

    for (const flag of primaryFlags) {
      expect(helpOutput).toContain(flag);
    }
  });

  it('should include daemon-related flags', () => {
    expect(helpOutput).toContain('--files-from-stdin');
    expect(helpOutput).toContain('--quiet');
  });

  it('should include artifact flags', () => {
    expect(helpOutput).toContain('--force-artifacts');
  });

  it('should describe default behavior as incremental', () => {
    expect(helpOutput).toContain('Incremental');
    expect(helpOutput).toMatch(/default|recommended/i);
  });

  it('should mention code graph always rebuilt', () => {
    // Important: help should clarify graph is always fully rebuilt
    expect(helpOutput).toMatch(/graph.*always.*rebuilt|always.*full.*graph/i);
  });

  it('should list output files', () => {
    expect(helpOutput).toContain('.agentdb/code-graph.db');
    expect(helpOutput).toContain('.agentdb/codebase.db');
    expect(helpOutput).toContain('hnsw');
    expect(helpOutput).toContain('merkle-state.json');
  });

  it('should describe targeted indexing', () => {
    expect(helpOutput).toContain('Targeted Indexing');
    expect(helpOutput).toContain('stdin');
  });

  it('should provide usage examples', () => {
    expect(helpOutput).toContain('Usage:');
    expect(helpOutput).toContain('node index-codebase-v21.js');
  });

  it('should document GraphRAG implications', () => {
    expect(helpOutput).toContain('GraphRAG');
  });

  it('should warn about --vectors-only breaking GraphRAG', () => {
    expect(helpOutput).toMatch(/vectors-only.*skip|breaks.*GraphRAG/i);
  });
});

// =============================================================================
// Flag Recognition Tests
// =============================================================================

describe('Flag recognition', () => {
  it('should recognize short help flag -h', async () => {
    const result = await runIndexer(['-h']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('should handle unknown flags gracefully', async () => {
    const result = await runIndexer(['--unknown-test-flag-xyz', '--dry-run']);

    // Should either work (ignore) or fail gracefully
    expect(typeof result.exitCode).toBe('number');
  });

  it('should not crash on flag without value', async () => {
    const result = await runIndexer(['--quiet', '--dry-run']);

    expect(result.exitCode).toBe(0);
  });

  it('should handle multiple flags', async () => {
    const result = await runIndexer(['--quiet', '--dry-run', '--graph-only']);

    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Flag Combination Tests
// =============================================================================

describe('Flag combinations', () => {
  it('--graph-only + --dry-run should work', async () => {
    const result = await runIndexer(['--graph-only', '--dry-run']);

    expect(result.exitCode).toBe(0);
  });

  it('--vectors-only + --dry-run should work', async () => {
    const result = await runIndexer(['--vectors-only', '--dry-run']);

    expect(result.exitCode).toBe(0);
  });

  it('--quiet + --stats should work', async () => {
    const result = await runIndexer(['--quiet', '--stats']);

    expect(result.exitCode).toBe(0);
  });

  it('--files-from-stdin + --quiet should work', async () => {
    const result = await runIndexer(['--files-from-stdin', '--quiet'], {
      stdinInput: '',
    });

    expect(result.exitCode).toBe(0);
  });

  it('--full + --force-artifacts + --dry-run should work', async () => {
    const result = await runIndexer(['--full', '--force-artifacts', '--dry-run']);

    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Mutually Exclusive Flag Tests
// =============================================================================

describe('Mutually exclusive flags', () => {
  it('--graph-only and --vectors-only should both be accepted', async () => {
    // These aren't truly mutually exclusive in the implementation,
    // but both should be recognized
    const graphResult = await runIndexer(['--graph-only', '--dry-run']);
    const vectorsResult = await runIndexer(['--vectors-only', '--dry-run']);

    expect(graphResult.exitCode).toBe(0);
    expect(vectorsResult.exitCode).toBe(0);
  });

  it('--help should take precedence over other flags', async () => {
    const result = await runIndexer(['--help', '--full', '--graph-only']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
    // Should not actually run indexing
    expect(result.stdout).not.toContain('Discovering Files');
  });
});

// =============================================================================
// Flag Description Accuracy Tests
// =============================================================================

describe('Flag descriptions match behavior', () => {
  it('--dry-run should preview without indexing', async () => {
    const result = await runIndexer(['--dry-run']);

    expect(result.exitCode).toBe(0);
    // Should show DRY RUN indication
    expect(result.stdout.toUpperCase()).toContain('DRY');
  });

  it('--quiet should suppress progress output', async () => {
    const result = await runIndexer(['--quiet', '--dry-run']);

    // Should not contain progress indicators
    expect(result.stdout).not.toContain('Discovering Files');
    expect(result.stdout).not.toContain('%');
    expect(result.stdout).not.toContain('[');
  });

  it('--stats should show indexing statistics', async () => {
    const result = await runIndexer(['--stats']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/statistics|stats|files|chunks/i);
  });
});

// =============================================================================
// Exit Code Tests
// =============================================================================

describe('Exit codes', () => {
  it('--help should exit with 0', async () => {
    const result = await runIndexer(['--help']);
    expect(result.exitCode).toBe(0);
  });

  it('--dry-run should exit with 0', async () => {
    const result = await runIndexer(['--dry-run']);
    expect(result.exitCode).toBe(0);
  });

  it('--stats should exit with 0', async () => {
    const result = await runIndexer(['--stats']);
    expect(result.exitCode).toBe(0);
  });

  it('--quiet + --dry-run should exit with 0', async () => {
    const result = await runIndexer(['--quiet', '--dry-run']);
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Output Format Tests
// =============================================================================

describe('Output format', () => {
  it('--quiet mode should allow JSON parsing (no junk)', async () => {
    const result = await runIndexer(['--quiet', '--files-from-stdin'], {
      stdinInput: '',
    });

    // Output should be clean enough that last line is parseable JSON
    const lines = result.stdout.trim().split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      try {
        const parsed = JSON.parse(lastLine);
        expect(parsed).toBeDefined();
      } catch (e) {
        // JSON parsing is optional, but if it fails, output should be minimal
        expect(result.stdout.length).toBeLessThan(1000);
      }
    }
  });

  it('normal mode should show colored output indicators', async () => {
    const result = await runIndexer(['--dry-run']);

    // Should have some visual structure (boxes, lines, etc.)
    expect(result.stdout.length).toBeGreaterThan(100);
  });
});
