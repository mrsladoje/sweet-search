/**
 * Boundary Enforcement Tests — DDD Fix Plan Phase 3
 *
 * Verifies that domain boundaries are enforced:
 * - No forbidden cross-domain dependency direction violations
 * - Consumers use barrel imports, not internal files
 * - Checker catches known violations (negative test)
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';

// Negative tests write temp files into live source tree (required because the
// checker scans hardcoded core/ paths). Safety cleanup in afterAll.
const TEMP_FILES = [
  join('core', 'infrastructure', '__boundary_test_violation__.js'),
  join('core', 'ranking', '__boundary_test_violation__.js'),
];
afterAll(() => TEMP_FILES.forEach(f => rmSync(f, { force: true })));

describe('DDD Boundary Enforcement', () => {
  it('passes all boundary checks', () => {
    const result = execSync('node scripts/check-boundaries.js 2>&1', {
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(result).toContain('All domain boundaries clean.');
  });

  it('detects barrel-only enforcement is active', () => {
    const result = execSync('node scripts/check-boundaries.js 2>&1', {
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(result).toContain('barrel-only enforcement');
  });

  it('catches infrastructure → domain violation', () => {
    const tmpFile = TEMP_FILES[0];
    try {
      writeFileSync(tmpFile, "import { embed } from '../embedding/index.js';\n");
      let output;
      try {
        output = execSync('node scripts/check-boundaries.js 2>&1', { encoding: 'utf8', timeout: 30000 });
      } catch (err) {
        output = err.stdout || err.message;
      }
      expect(output).toContain('VIOLATION');
      expect(output).toContain('infrastructure');
    } finally {
      rmSync(tmpFile, { force: true });
    }
  });

  it('catches ranking → embedding violation', () => {
    const tmpFile = TEMP_FILES[1];
    try {
      writeFileSync(tmpFile, "import { embed } from '../embedding/index.js';\n");
      let output;
      try {
        output = execSync('node scripts/check-boundaries.js 2>&1', { encoding: 'utf8', timeout: 30000 });
      } catch (err) {
        output = err.stdout || err.message;
      }
      expect(output).toContain('VIOLATION');
      expect(output).toContain('ranking');
    } finally {
      rmSync(tmpFile, { force: true });
    }
  });
});
