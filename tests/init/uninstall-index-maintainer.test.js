/**
 * Tests for two release-blocker fixes in `sweet-search uninstall`:
 *
 *   1. `removeIndexMaintainerHook` reverses the
 *      `.claude/hooks/index-maintainer.mjs` copy that
 *      `scripts/init.js` performs, but ONLY when the file's bytes still
 *      match the shipped version (so we never delete a user-modified
 *      hook).
 *
 *   2. `getOptionalNativePackageNames` derives the `--purge` package
 *      list from `package.json::optionalDependencies` so the CUDA
 *      variants (`@sweet-search/native-linux-{x64,arm64}-gnu-cuda`)
 *      that were missing from the prior hand-maintained list are
 *      always included.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  getOptionalNativePackageNames,
  removeIndexMaintainerHook,
} from '../../scripts/uninstall.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SHIPPED_HOOK_PATH = join(REPO_ROOT, 'core', 'indexing', 'index-maintainer.mjs');

let projectRoot;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'ss-uninstall-im-'));
});

afterEach(() => {
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function copyShippedHook() {
  const dest = join(projectRoot, '.claude', 'hooks', 'index-maintainer.mjs');
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(SHIPPED_HOOK_PATH, dest);
  return dest;
}

describe('removeIndexMaintainerHook', () => {
  it('returns not-found when the hook file does not exist', () => {
    const r = removeIndexMaintainerHook(projectRoot);
    expect(r.status).toBe('not-found');
  });

  it('removes the hook when bytes match the shipped version', () => {
    const dest = copyShippedHook();
    expect(existsSync(dest)).toBe(true);

    const r = removeIndexMaintainerHook(projectRoot);

    expect(r.status).toBe('removed');
    expect(existsSync(dest)).toBe(false);
  });

  it('refuses to remove a user-modified copy (different bytes)', () => {
    const dest = copyShippedHook();
    // Append a single byte — bytes no longer match the shipped version.
    const original = readFileSync(dest);
    writeFileSync(dest, Buffer.concat([original, Buffer.from('\n// user edit')]));

    const r = removeIndexMaintainerHook(projectRoot);

    expect(r.status).toBe('skipped');
    expect(r.detail).toMatch(/differs/i);
    // File MUST still exist — refusing to delete is the entire point.
    expect(existsSync(dest)).toBe(true);
  });

  it('dry-run reports the file but never deletes', () => {
    const dest = copyShippedHook();
    const r = removeIndexMaintainerHook(projectRoot, { dryRun: true });
    expect(r.status).toBe('dry-run');
    expect(existsSync(dest)).toBe(true);
  });

  it('prunes empty .claude/hooks/ after removal but leaves .claude/ intact', () => {
    copyShippedHook();
    expect(existsSync(join(projectRoot, '.claude', 'hooks'))).toBe(true);

    const r = removeIndexMaintainerHook(projectRoot);

    expect(r.status).toBe('removed');
    // We own the hook file; the empty .claude/hooks/ directory we leave
    // behind is removed iff it's empty after our delete.
    expect(existsSync(join(projectRoot, '.claude', 'hooks'))).toBe(false);
    // .claude/ itself must NOT be touched — user owns that root.
    expect(existsSync(join(projectRoot, '.claude'))).toBe(true);
  });

  it('does NOT prune .claude/hooks/ when sibling hooks exist', () => {
    const dest = copyShippedHook();
    // Add a sibling hook the user owns.
    writeFileSync(join(dirname(dest), 'user-owned-hook.mjs'), '// not ours', 'utf-8');

    const r = removeIndexMaintainerHook(projectRoot);

    expect(r.status).toBe('removed');
    expect(existsSync(join(projectRoot, '.claude', 'hooks'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude', 'hooks', 'user-owned-hook.mjs'))).toBe(true);
  });
});

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
