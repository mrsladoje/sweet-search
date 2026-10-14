/**
 * `getOptionalNativePackageNames` derives the `sweet-search uninstall --purge`
 * package list from `package.json::optionalDependencies`, so the CUDA variants
 * (`@sweet-search/native-linux-{x64,arm64}-gnu-cuda`) that were missing from the
 * prior hand-maintained list are always included.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getOptionalNativePackageNames } from '../../scripts/uninstall.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('getOptionalNativePackageNames — purge list contract', () => {
  it('includes both CUDA variants (release-blocker fix)', () => {
    const names = getOptionalNativePackageNames();
    expect(names).toContain('@sweet-search/native-linux-x64-gnu-cuda');
    expect(names).toContain('@sweet-search/native-linux-arm64-gnu-cuda');
  });

  it('includes the existing non-CUDA variants', () => {
    const names = getOptionalNativePackageNames();
    expect(names).toContain('@sweet-search/native-darwin-arm64');
    expect(names).toContain('@sweet-search/native-darwin-x64');
    expect(names).toContain('@sweet-search/native-linux-x64-gnu');
    expect(names).toContain('@sweet-search/native-linux-arm64-gnu');
  });

  it('all entries scope to the @sweet-search org', () => {
    const names = getOptionalNativePackageNames();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(n.startsWith('@sweet-search/')).toBe(true);
    }
  });

  it('matches package.json::optionalDependencies exactly', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    const fromPkg = Object.keys(pkg.optionalDependencies || {})
      .filter((n) => n.startsWith('@sweet-search/'));
    expect(getOptionalNativePackageNames().sort()).toEqual(fromPkg.sort());
  });
});
