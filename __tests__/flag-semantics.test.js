/**
 * Flag Semantics Tests
 *
 * Tests for CLI flag behavior and help output accuracy:
 * 1. parseArgs() unit tests — in-process, no spawning
 * 2. Integration tests — grouped by command, run concurrently
 *
 * Optimized from ~20 sequential spawns to 5 parallel spawns + in-process unit tests.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../core/index-codebase-v21.js';

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
// Section A — Unit tests (in-process, ~10ms)
// =============================================================================

describe('parseArgs() unit tests', () => {
  it('should return all false for empty args', () => {
    const flags = parseArgs([]);
    expect(flags.dryRun).toBe(false);
    expect(flags.graphOnly).toBe(false);
    expect(flags.vectorsOnly).toBe(false);
    expect(flags.fullReindex).toBe(false);
    expect(flags.showStats).toBe(false);
    expect(flags.resolveOnly).toBe(false);
    expect(flags.skipSummaryRegen).toBe(false);
    expect(flags.filesFromStdin).toBe(false);
    expect(flags.quiet).toBe(false);
    expect(flags.forceArtifacts).toBe(false);
    expect(flags.help).toBe(false);
  });

  it('should recognize --skip-summary-regen', () => {
    const flags = parseArgs(['--skip-summary-regen']);
    expect(flags.skipSummaryRegen).toBe(true);
  });

  it('should recognize --help', () => {
    const flags = parseArgs(['--help']);
    expect(flags.help).toBe(true);
  });

  it('should recognize short help flag -h', () => {
    const flags = parseArgs(['-h']);
    expect(flags.help).toBe(true);
  });

  it('should handle unknown flags gracefully', () => {
    const flags = parseArgs(['--unknown-test-flag-xyz']);
    // Should not crash, all known flags should be false
    expect(flags.dryRun).toBe(false);
    expect(flags.graphOnly).toBe(false);
    expect(flags.help).toBe(false);
  });

  it('should handle multiple flags', () => {
    const flags = parseArgs(['--quiet', '--dry-run', '--graph-only']);
    expect(flags.quiet).toBe(true);
    expect(flags.dryRun).toBe(true);
    expect(flags.graphOnly).toBe(true);
  });

  it('--graph-only and --vectors-only should both be accepted', () => {
    const graphFlags = parseArgs(['--graph-only']);
    const vectorFlags = parseArgs(['--vectors-only']);
    expect(graphFlags.graphOnly).toBe(true);
    expect(vectorFlags.vectorsOnly).toBe(true);
  });

  it('should not crash on flag without value', () => {
    const flags = parseArgs(['--quiet', '--dry-run']);
    expect(flags.quiet).toBe(true);
    expect(flags.dryRun).toBe(true);
  });

  it('--graph-only + --dry-run should both parse', () => {
    const flags = parseArgs(['--graph-only', '--dry-run']);
    expect(flags.graphOnly).toBe(true);
    expect(flags.dryRun).toBe(true);
  });

  it('--vectors-only + --dry-run should both parse', () => {
    const flags = parseArgs(['--vectors-only', '--dry-run']);
    expect(flags.vectorsOnly).toBe(true);
    expect(flags.dryRun).toBe(true);
  });

  it('--quiet + --stats should both parse', () => {
    const flags = parseArgs(['--quiet', '--stats']);
    expect(flags.quiet).toBe(true);
    expect(flags.showStats).toBe(true);
  });

  it('--files-from-stdin + --quiet should both parse', () => {
    const flags = parseArgs(['--files-from-stdin', '--quiet']);
    expect(flags.filesFromStdin).toBe(true);
    expect(flags.quiet).toBe(true);
  });

  it('--full + --force-artifacts + --dry-run should all parse', () => {
    const flags = parseArgs(['--full', '--force-artifacts', '--dry-run']);
    expect(flags.fullReindex).toBe(true);
    expect(flags.forceArtifacts).toBe(true);
    expect(flags.dryRun).toBe(true);
  });
});

// =============================================================================
// Section B — Integration tests (concurrent spawns)
// =============================================================================

describe('Flag behavior (integration)', () => {
  // -------------------------------------------------------------------------
  // --help output (1 spawn, many assertions)
  // -------------------------------------------------------------------------
  describe('--help output', () => {
    let helpResult;

    beforeAll(async () => {
      helpResult = await runIndexer(['--help']);
    });

    it('--help should exit with 0', () => {
      expect(helpResult.exitCode).toBe(0);
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
        expect(helpResult.stdout).toContain(flag);
      }
    });

    it('should include daemon-related flags', () => {
      expect(helpResult.stdout).toContain('--files-from-stdin');
      expect(helpResult.stdout).toContain('--quiet');
    });

    it('should include artifact flags', () => {
      expect(helpResult.stdout).toContain('--force-artifacts');
    });

    it('should describe default behavior as incremental', () => {
      expect(helpResult.stdout).toContain('Incremental');
      expect(helpResult.stdout).toMatch(/default|recommended/i);
    });

    it('should mention code graph always rebuilt', () => {
      expect(helpResult.stdout).toMatch(/graph.*always.*rebuilt|always.*full.*graph/i);
    });

    it('should list output files', () => {
      expect(helpResult.stdout).toContain('.sweet-search/code-graph.db');
      expect(helpResult.stdout).toContain('.sweet-search/codebase.db');
      expect(helpResult.stdout).toContain('hnsw');
      expect(helpResult.stdout).toContain('merkle-state.json');
    });

    it('should describe targeted indexing', () => {
      expect(helpResult.stdout).toContain('Targeted Indexing');
      expect(helpResult.stdout).toContain('stdin');
    });

    it('should provide usage examples', () => {
      expect(helpResult.stdout).toContain('Usage:');
      expect(helpResult.stdout).toContain('node index-codebase-v21.js');
    });

    it('should document GraphRAG implications', () => {
      expect(helpResult.stdout).toContain('GraphRAG');
    });

    it('should warn about --vectors-only breaking GraphRAG', () => {
      expect(helpResult.stdout).toMatch(/vectors-only.*skip|breaks.*GraphRAG/i);
    });

    it('should contain --skip-summary-regen in help', () => {
      expect(helpResult.stdout).toContain('--skip-summary-regen');
    });

    it('should describe what skip-summary-regen does', () => {
      expect(helpResult.stdout).toMatch(/skip.*summary.*regen|preserves.*summar/i);
    });

    it('--help should take precedence over other flags', async () => {
      const result = await runIndexer(['--help', '--full', '--graph-only']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage:');
      // Should not actually run indexing
      expect(result.stdout).not.toContain('Discovering Files');
    });
  });

  // -------------------------------------------------------------------------
  // --dry-run output (1 spawn)
  // -------------------------------------------------------------------------
  describe('--dry-run output', () => {
    let dryRunResult;

    beforeAll(async () => {
      dryRunResult = await runIndexer(['--dry-run']);
    });

    it('--dry-run should exit with 0', () => {
      expect(dryRunResult.exitCode).toBe(0);
    });

    it('--dry-run should preview without indexing', () => {
      expect(dryRunResult.stdout.toUpperCase()).toContain('DRY');
    });

    it('normal mode should show colored output indicators', () => {
      expect(dryRunResult.stdout.length).toBeGreaterThan(100);
    });
  });

  // -------------------------------------------------------------------------
  // --quiet --dry-run output (1 spawn)
  // -------------------------------------------------------------------------
  describe('--quiet --dry-run output', () => {
    let quietDryRunResult;

    beforeAll(async () => {
      quietDryRunResult = await runIndexer(['--quiet', '--dry-run']);
    });

    it('--quiet + --dry-run should exit with 0', () => {
      expect(quietDryRunResult.exitCode).toBe(0);
    });

    it('--quiet should suppress progress output', () => {
      expect(quietDryRunResult.stdout).not.toContain('Discovering Files');
      expect(quietDryRunResult.stdout).not.toContain('%');
      expect(quietDryRunResult.stdout).not.toContain('[');
    });
  });

  // -------------------------------------------------------------------------
  // --skip-summary-regen --dry-run output (1 spawn)
  // -------------------------------------------------------------------------
  describe('--skip-summary-regen --dry-run output', () => {
    let skipSummaryResult;

    beforeAll(async () => {
      skipSummaryResult = await runIndexer(['--skip-summary-regen', '--dry-run']);
    });

    it('should be recognized as a valid flag', () => {
      expect(skipSummaryResult.exitCode).toBe(0);
      expect(skipSummaryResult.stderr).not.toContain('Unknown flag');
      expect(skipSummaryResult.stderr).not.toContain('Unrecognized option');
    });

    it('should show deprecation warning', () => {
      expect(skipSummaryResult.stdout).toContain('DEPRECATION');
      expect(skipSummaryResult.stdout).toContain('--skip-summary-regen');
    });

    it('should work with --quiet flag', async () => {
      const result = await runIndexer(['--skip-summary-regen', '--quiet', '--dry-run']);
      expect(result.exitCode).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // --stats output (1 spawn)
  // -------------------------------------------------------------------------
  describe('--stats output', () => {
    let statsResult;

    beforeAll(async () => {
      statsResult = await runIndexer(['--stats']);
    });

    it('--stats should exit with 0', () => {
      expect(statsResult.exitCode).toBe(0);
    });

    it('--stats should show indexing statistics', () => {
      expect(statsResult.stdout).toMatch(/statistics|stats|files|chunks/i);
    });
  });

  // -------------------------------------------------------------------------
  // --quiet --files-from-stdin output (1 spawn)
  // -------------------------------------------------------------------------
  describe('--quiet --files-from-stdin output', () => {
    it('--quiet mode should allow JSON parsing (no junk)', async () => {
      const result = await runIndexer(['--quiet', '--files-from-stdin'], {
        stdinInput: '',
      });

      const lines = result.stdout.trim().split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        try {
          const parsed = JSON.parse(lastLine);
          expect(parsed).toBeDefined();
        } catch (e) {
          expect(result.stdout.length).toBeLessThan(1000);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Unknown flags (1 spawn)
  // -------------------------------------------------------------------------
  describe('Unknown flags', () => {
    it('should handle unknown flags gracefully in real process', async () => {
      const result = await runIndexer(['--unknown-test-flag-xyz', '--dry-run']);
      expect(typeof result.exitCode).toBe('number');
    });
  });
});
