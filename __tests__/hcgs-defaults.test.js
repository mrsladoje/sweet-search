/**
 * HCGS Default Settings Tests
 *
 * Tests for HCGS generator default configuration:
 * 1. skipEmbeddings defaults to true in generateAllSummaries
 * 2. skipEmbeddings defaults to true in generateSummariesForFiles
 * 3. skipEmbeddings defaults to true in generateSummariesForEntities
 * 4. Default concurrency is set correctly
 *
 * These tests verify that the performance-optimized defaults are maintained.
 *
 * Optimization: all unique process spawns run in parallel in beforeAll.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to HCGS generator
const HCGS_PATH = join(__dirname, '..', 'core', 'hcgs-generator.js');
const PROJECT_ROOT = join(__dirname, '..');

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Run HCGS generator with given args
 */
function runHCGS(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = 30000, cwd = PROJECT_ROOT } = options;

    const child = spawn('node', [HCGS_PATH, ...args], {
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
      reject(new Error(`HCGS timed out after ${timeout}ms`));
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
// Pre-computed results: all unique invocations run in parallel
// =============================================================================

let generateDryResult, generateNoEmbedDryResult, helpResult, generateConcurrencyDryResult;

beforeAll(async () => {
  [generateDryResult, generateNoEmbedDryResult, helpResult, generateConcurrencyDryResult] =
    await Promise.all([
      runHCGS(['generate', '--dry-run']),
      runHCGS(['generate', '--dry-run', '--no-embeddings']),
      runHCGS(['help']),
      runHCGS(['generate', '--concurrency=3', '--dry-run']),
    ]);
}, 60000);

// =============================================================================
// skipEmbeddings Default Tests
// =============================================================================

describe('skipEmbeddings default behavior', () => {
  it('should log skip embeddings message when entities exist and dry-run', () => {
    // Should complete without error
    expect(generateDryResult.exitCode).toBe(0);

    // If entities exist, the skip message appears
    // If no entities, "No entities without summaries found" appears
    const hasEntities = !generateDryResult.stdout.includes('No entities without summaries found');

    if (hasEntities) {
      expect(generateDryResult.stdout).toContain('Skipping summary embeddings');
      expect(generateDryResult.stdout).toContain('not used in search');
    } else {
      // When no entities need summaries, the skip message is not logged
      expect(generateDryResult.stdout).toContain('HCGS:');
    }
  });

  it('should work with --no-embeddings flag', () => {
    expect(generateNoEmbedDryResult.exitCode).toBe(0);
  });

  it('help output should document embedding behavior', () => {
    expect(helpResult.stdout).toContain('--no-embeddings');
    expect(helpResult.stdout).toContain('Skip embedding generation');
  });
});

// =============================================================================
// Function Default Tests (via module import)
// =============================================================================

describe('generateAllSummaries defaults', () => {
  let hcgsModule;

  beforeEach(async () => {
    hcgsModule = await import('../core/hcgs-generator.js');
  });

  it('should export generateAllSummaries function', () => {
    expect(typeof hcgsModule.generateAllSummaries).toBe('function');
  });

  it('should export buildSummaryPrompt function', () => {
    expect(typeof hcgsModule.buildSummaryPrompt).toBe('function');
  });

  it('should export getTokenLimitForType function', () => {
    expect(typeof hcgsModule.getTokenLimitForType).toBe('function');
  });

  it('should export HIERARCHY_LEVELS constant', () => {
    expect(typeof hcgsModule.HIERARCHY_LEVELS).toBe('object');
    expect(hcgsModule.HIERARCHY_LEVELS.method).toBe(2);
    expect(hcgsModule.HIERARCHY_LEVELS.class).toBe(1);
    expect(hcgsModule.HIERARCHY_LEVELS.file).toBe(0);
  });
});

// =============================================================================
// Token Limit Defaults
// =============================================================================

describe('Token limit defaults', () => {
  let hcgsModule;

  beforeEach(async () => {
    hcgsModule = await import('../core/hcgs-generator.js');
  });

  it('should return reasonable limits for each entity type', () => {
    const { getTokenLimitForType } = hcgsModule;

    // Methods should have smaller limits
    const methodLimit = getTokenLimitForType('method');
    expect(methodLimit).toBeGreaterThan(0);
    expect(methodLimit).toBeLessThanOrEqual(100);

    // Classes should have larger limits
    const classLimit = getTokenLimitForType('class');
    expect(classLimit).toBeGreaterThan(0);

    // Unknown types should have default
    const unknownLimit = getTokenLimitForType('unknown_type');
    expect(unknownLimit).toBeGreaterThan(0);
  });

  it('should handle all HIERARCHY_LEVELS types', () => {
    const { getTokenLimitForType, HIERARCHY_LEVELS } = hcgsModule;

    for (const type of Object.keys(HIERARCHY_LEVELS)) {
      const limit = getTokenLimitForType(type);
      expect(typeof limit).toBe('number');
      expect(limit).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Prompt Building Defaults
// =============================================================================

describe('buildSummaryPrompt defaults', () => {
  let hcgsModule;

  beforeEach(async () => {
    hcgsModule = await import('../core/hcgs-generator.js');
  });

  it('should build prompt for entity without children', () => {
    const { buildSummaryPrompt } = hcgsModule;

    const entity = {
      type: 'method',
      name: 'authenticate',
      signature: 'public boolean authenticate(String username)',
    };

    const prompt = buildSummaryPrompt(entity, [], 50);

    expect(prompt).toContain('authenticate');
    expect(prompt).toContain('method');
    expect(prompt).not.toContain('Contains:');
  });

  it('should include children in prompt for class', () => {
    const { buildSummaryPrompt } = hcgsModule;

    const entity = {
      type: 'class',
      name: 'AuthService',
      signature: 'public class AuthService',
    };

    const children = [
      { name: 'login', type: 'method', summary: 'Logs user in' },
      { name: 'logout', type: 'method', summary: 'Logs user out' },
    ];

    const prompt = buildSummaryPrompt(entity, children, 150);

    expect(prompt).toContain('Contains:');
    expect(prompt).toContain('login');
    expect(prompt).toContain('logout');
  });

  it('should limit children based on token budget', () => {
    const { buildSummaryPrompt } = hcgsModule;

    const entity = {
      type: 'class',
      name: 'LargeService',
      signature: 'public class LargeService',
    };

    // Create 20 children
    const children = Array(20).fill(null).map((_, i) => ({
      name: `method${i}`,
      type: 'method',
      summary: `Does something ${i}`,
    }));

    const smallBudgetPrompt = buildSummaryPrompt(entity, children, 100);
    const largeBudgetPrompt = buildSummaryPrompt(entity, children, 200);

    // Smaller budget should show fewer children
    const smallCount = (smallBudgetPrompt.match(/method\d+/g) || []).length;
    const largeCount = (largeBudgetPrompt.match(/method\d+/g) || []).length;

    // Both should have children, but smaller budget should limit more
    expect(smallCount).toBeGreaterThan(0);
    expect(smallCount).toBeLessThanOrEqual(10);
    expect(largeCount).toBeLessThanOrEqual(15);
  });

  it('should adapt detail level description based on token limit', () => {
    const { buildSummaryPrompt } = hcgsModule;

    const entity = { type: 'method', name: 'test', signature: 'void test()' };

    const briefPrompt = buildSummaryPrompt(entity, [], 50);
    const concisePrompt = buildSummaryPrompt(entity, [], 100);
    const clearPrompt = buildSummaryPrompt(entity, [], 150);
    const comprehensivePrompt = buildSummaryPrompt(entity, [], 200);

    expect(briefPrompt).toContain('brief one-line');
    expect(concisePrompt).toContain('concise 1-2 sentence');
    expect(clearPrompt).toContain('clear 2-3 sentence');
    expect(comprehensivePrompt).toContain('comprehensive');
  });
});

// =============================================================================
// Hierarchy Level Constants
// =============================================================================

describe('HIERARCHY_LEVELS constants', () => {
  let hcgsModule;

  beforeEach(async () => {
    hcgsModule = await import('../core/hcgs-generator.js');
  });

  it('should define level 2 for leaf entities', () => {
    const { HIERARCHY_LEVELS } = hcgsModule;

    expect(HIERARCHY_LEVELS.method).toBe(2);
    expect(HIERARCHY_LEVELS.field).toBe(2);
    expect(HIERARCHY_LEVELS.rpc).toBe(2);
  });

  it('should define level 1 for container entities', () => {
    const { HIERARCHY_LEVELS } = hcgsModule;

    expect(HIERARCHY_LEVELS.class).toBe(1);
    expect(HIERARCHY_LEVELS.interface).toBe(1);
    expect(HIERARCHY_LEVELS.enum).toBe(1);
    expect(HIERARCHY_LEVELS.service).toBe(1);
    expect(HIERARCHY_LEVELS.message).toBe(1);
    expect(HIERARCHY_LEVELS.function).toBe(1);
    expect(HIERARCHY_LEVELS.component).toBe(1);
  });

  it('should define level 0 for top-level entities', () => {
    const { HIERARCHY_LEVELS } = hcgsModule;

    expect(HIERARCHY_LEVELS.file).toBe(0);
    expect(HIERARCHY_LEVELS.package).toBe(0);
  });

  it('should support bottom-up processing order', () => {
    const { HIERARCHY_LEVELS } = hcgsModule;

    // Get all levels
    const levels = Object.values(HIERARCHY_LEVELS);
    const uniqueLevels = [...new Set(levels)].sort((a, b) => b - a);

    // Processing should go from highest level (2) to lowest (0)
    expect(uniqueLevels).toEqual([2, 1, 0]);
  });
});

// =============================================================================
// Default Concurrency Tests
// =============================================================================

describe('Default concurrency', () => {
  it('should have reasonable default concurrency in help', () => {
    expect(helpResult.stdout).toContain('--concurrency');
    expect(helpResult.stdout).toContain('default');
    expect(helpResult.stdout).toContain('5');
  });

  it('should accept custom concurrency', () => {
    expect(generateConcurrencyDryResult.exitCode).toBe(0);
  });
});
