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
      if (r.type === 'arch-check' || r.type === 'rosetta-execution') {
        expect(r.pass, `${r.target} ${r.type}`).toBe(true);
        continue;
      }
      expect(r.failed, `${r.target}/${r.packageManager}/native=${r.nativePresent}`).toBe(0);
    }
  });

  it.skipIf(skip)('full matrix is covered (targets × PMs × native/fallback)', () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
    const quick = !!process.env.CROSS_TARGET_QUICK;

    // darwin-x64 must have a rosetta-execution entry
    expect(results.some(r => r.target === 'darwin-x64'), 'darwin-x64 result').toBe(true);

    // Docker targets: npm with native=true required for both platforms.
    // native=false (fallback) required for arm64; x64 skips it due to
    // Colima QEMU reliability issues (fallback proven by arm64 + host).
    for (const target of ['linux-arm64-gnu', 'linux-x64-gnu']) {
      const withNative = results.find(r =>
        r.target === target && r.packageManager === 'npm' && r.nativePresent === true
      );
      expect(withNative, `${target}/npm/native=true`).toBeDefined();
    }
    if (!quick) {
      const arm64Fallback = results.find(r =>
        r.target === 'linux-arm64-gnu' && r.packageManager === 'npm' && r.nativePresent === false
      );
      expect(arm64Fallback, 'linux-arm64-gnu/npm/native=false').toBeDefined();
    }

    // Host target: all PMs that were run must be present.
    // Default matrix is npm + pnpm + bun (yarn v1 excluded — treats optionalDeps
    // as mandatory and fails with unpublished @sweet-search/native-* packages).
    const hostPMs = [...new Set(
      results.filter(r => r.target === 'darwin-arm64' && r.packageManager).map(r => r.packageManager)
    )];
    expect(hostPMs, 'host must have npm').toContain('npm');
    if (!quick) {
      // Full matrix: npm + at least pnpm or bun (both required when installed)
      expect(hostPMs.length, 'host PM count >= 2 (npm + pnpm/bun)').toBeGreaterThanOrEqual(2);
    }

    // npm must have both native states
    const hostNpm = results.find(r =>
      r.target === 'darwin-arm64' && r.packageManager === 'npm' && r.nativePresent === true
    );
    expect(hostNpm, 'darwin-arm64/npm/native=true').toBeDefined();

    if (!quick) {
      const hostFallback = results.find(r =>
        r.target === 'darwin-arm64' && r.packageManager === 'npm' && r.nativePresent === false
      );
      expect(hostFallback, 'darwin-arm64/npm/native=false').toBeDefined();
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
