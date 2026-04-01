/**
 * Boundary Enforcement Tests — DDD Fix Plan Phase 3
 *
 * Verifies that domain boundaries are enforced:
 * - No forbidden cross-domain dependency direction violations
 * - Consumers use barrel imports, not internal files
 * - Checker catches known violations (negative test)
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
    expect(result).toContain('barrel-only enforcement active');
  });

  it('catches a known forbidden dependency direction violation', () => {
    const tmpFile = join('core', 'infrastructure', '__boundary_test_violation__.js');
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

  it('catches a known cross-domain direction violation (ranking → embedding)', () => {
    const tmpFile = join('core', 'ranking', '__boundary_test_violation__.js');
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
