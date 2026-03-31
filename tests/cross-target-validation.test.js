/**
 * Cross-target validation test — Phase 8.
 *
 * Gated behind CROSS_TARGET_VALIDATION=1 because Docker runs take minutes.
 *
 * Usage:
 *   CROSS_TARGET_VALIDATION=1 npm test -- --run tests/cross-target-validation.test.js
 *
 * Options via env:
 *   CROSS_TARGET_PM=npm         Override package managers (default: all)
 *   CROSS_TARGET_TARGETS=host   Target subset
 *   CROSS_TARGET_QUICK=1        Quick mode (npm only, no fallback)
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RESULTS_PATH = join(ROOT, 'scripts', 'cross-target-results.json');
const RUNNER = join(ROOT, 'scripts', 'cross-target-validation.sh');
const skip = !process.env.CROSS_TARGET_VALIDATION;

describe('cross-target validation (Phase 8)', () => {
  it.skipIf(skip)('runner script completes without error', () => {
    const args = ['--skip-models'];

    if (process.env.CROSS_TARGET_QUICK) {
      args.push('--quick');
    }

    if (process.env.CROSS_TARGET_PM) {
      args.push('--pm', process.env.CROSS_TARGET_PM);
    }

    if (process.env.CROSS_TARGET_TARGETS) {
      args.push('--targets', process.env.CROSS_TARGET_TARGETS);
    }

    const output = execFileSync('bash', [RUNNER, ...args], {
      encoding: 'utf8',
      timeout: 600_000,
      cwd: ROOT,
    });

    expect(output).toContain('ALL CHECKS PASSED');
  }, 600_000);

  it.skipIf(skip)('results JSON exists and is valid', () => {
    expect(existsSync(RESULTS_PATH)).toBe(true);
    const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it.skipIf(skip)('all results report passing', () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));

    for (const r of results) {
      // darwin-x64 emits type: "rosetta-execution" or "arch-check"
      if (r.type === 'arch-check' || r.type === 'rosetta-execution') {
        expect(r.pass, `${r.target} ${r.type}`).toBe(true);
        continue;
      }
      // Docker/host results have a `failed` count
      expect(r.failed, `${r.target}/${r.packageManager}/native=${r.nativePresent}`).toBe(0);
    }
  });

  it.skipIf(skip)('timing data is captured for each target', () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));

    for (const r of results) {
      if (r.type === 'arch-check' || r.type === 'rosetta-execution') continue;
      expect(r.timing, `${r.target} timing`).toBeDefined();
      expect(r.timing.totalSeconds).toBeGreaterThan(0);
    }
  });
});
