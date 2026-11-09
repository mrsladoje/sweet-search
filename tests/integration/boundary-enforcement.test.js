/**
 * Boundary Enforcement Tests — DDD Fix Plan Phase 3
 *
 * Verifies that domain boundaries are enforced:
 * - No forbidden cross-domain dependency direction violations in the real tree
 * - Checker catches known violations (negative tests)
 *
 * The negative tests run the checker inside a throw-away mini tree (the checker
 * scans `core/` relative to its working directory), so they never write into the
 * live source tree that other test runs and tools read at the same time.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '../..');
const CHECKER = join(ROOT, 'scripts', 'check-boundaries.js');
// The checker reads every source file once in-process and finishes in about a
// second; the budget leaves room for a loaded machine.
const TIMEOUT_MS = Number(process.env.SWEET_SEARCH_TEST_BOUNDARY_TIMEOUT_MS || 60000);

function runChecker(cwd) {
  const r = spawnSync(process.execPath, [CHECKER], { cwd, encoding: 'utf8', timeout: TIMEOUT_MS });
  return { status: r.status, output: `${r.stdout || ''}${r.stderr || ''}` };
}

describe('DDD Boundary Enforcement', () => {
  it('passes all boundary checks on the real tree, with barrel-only enforcement active', () => {
    const { output } = runChecker(ROOT);
    expect(output).toContain('All domain boundaries clean.');
    expect(output).toContain('barrel-only enforcement');
  }, TIMEOUT_MS + 5000);

  describe('negative cases (mini tree)', () => {
    let tree;
    beforeAll(() => {
      tree = mkdtempSync(join(tmpdir(), 'ss-boundary-'));
      for (const d of ['infrastructure', 'embedding', 'ranking', 'vocabulary', 'agent-tools']) {
        mkdirSync(join(tree, 'core', d), { recursive: true });
      }
    });
    afterAll(() => rmSync(tree, { recursive: true, force: true }));

    function violationFor(domain, source) {
      const file = join(tree, 'core', domain, '__boundary_test_violation__.js');
      writeFileSync(file, source);
      try {
        return runChecker(tree).output;
      } finally {
        rmSync(file, { force: true });
      }
    }

    it('a clean mini tree reports no violation', () => {
      expect(runChecker(tree).output).not.toContain('VIOLATION');
    });

    it('catches infrastructure → domain violation', () => {
      const output = violationFor('infrastructure', "import { embed } from '../embedding/index.js';\n");
      expect(output).toContain('VIOLATION');
      expect(output).toContain('infrastructure');
    });

    it('catches ranking → embedding violation', () => {
      const output = violationFor('ranking', "import { embed } from '../embedding/index.js';\n");
      expect(output).toContain('VIOLATION');
      expect(output).toContain('ranking');
    });

    it('catches vocabulary → agent-tools violation', () => {
      const output = violationFor('vocabulary', "import { runTool } from '../agent-tools/tools.js';\n");
      expect(output).toContain('VIOLATION');
      expect(output).toContain('vocabulary');
    });
  });
});
