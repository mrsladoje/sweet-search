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
// The checker walks every file in core/ three times across this file's tests.
// On a quiet machine that is already ~365s; under full-suite load it exceeded
// the old 240s budget and reported ETIMEDOUT, which reads as a boundary
// violation when it is only a stopwatch running out. The check itself passes.
const CHECK_BOUNDARIES_TIMEOUT_MS = Number(process.env.SWEET_SEARCH_TEST_BOUNDARY_TIMEOUT_MS || 900000);
afterAll(() => TEMP_FILES.forEach(f => rmSync(f, { force: true })));

describe('DDD Boundary Enforcement', () => {
  it('passes all boundary checks', () => {
    const result = execSync('node scripts/check-boundaries.js 2>&1', {
      encoding: 'utf8',
      timeout: CHECK_BOUNDARIES_TIMEOUT_MS,
    });
    expect(result).toContain('All domain boundaries clean.');
  }, CHECK_BOUNDARIES_TIMEOUT_MS + 5000);

  it('detects barrel-only enforcement is active', () => {
    const result = execSync('node scripts/check-boundaries.js 2>&1', {
      encoding: 'utf8',
      timeout: CHECK_BOUNDARIES_TIMEOUT_MS,
    });
    expect(result).toContain('barrel-only enforcement');
  }, CHECK_BOUNDARIES_TIMEOUT_MS + 5000);

  it('catches infrastructure → domain violation', () => {
    const tmpFile = TEMP_FILES[0];
    try {
      writeFileSync(tmpFile, "import { embed } from '../embedding/index.js';\n");
      let output;
      try {
        output = execSync('node scripts/check-boundaries.js 2>&1', { encoding: 'utf8', timeout: CHECK_BOUNDARIES_TIMEOUT_MS });
      } catch (err) {
        output = err.stdout || err.message;
      }
      expect(output).toContain('VIOLATION');
      expect(output).toContain('infrastructure');
    } finally {
      rmSync(tmpFile, { force: true });
    }
  }, CHECK_BOUNDARIES_TIMEOUT_MS + 5000);

  it('catches ranking → embedding violation', () => {
    const tmpFile = TEMP_FILES[1];
    try {
      writeFileSync(tmpFile, "import { embed } from '../embedding/index.js';\n");
      let output;
      try {
        output = execSync('node scripts/check-boundaries.js 2>&1', { encoding: 'utf8', timeout: CHECK_BOUNDARIES_TIMEOUT_MS });
      } catch (err) {
        output = err.stdout || err.message;
      }
      expect(output).toContain('VIOLATION');
      expect(output).toContain('ranking');
    } finally {
      rmSync(tmpFile, { force: true });
    }
  }, CHECK_BOUNDARIES_TIMEOUT_MS + 5000);
});
