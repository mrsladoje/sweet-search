/**
 * Packaging test — validates npm tarball contents against assets/manifest.json.
 *
 * Single source of truth: the manifest defines what must ship.
 * This test reads the manifest and asserts every listed asset appears
 * in `npm pack --dry-run` output.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

let packOutput;
let manifest;

beforeAll(() => {
  execSync('node scripts/generate-asset-manifest.js --check', { cwd: ROOT, stdio: 'pipe' });
  packOutput = execSync('npm pack --dry-run 2>&1', { cwd: ROOT, encoding: 'utf8' });
  manifest = JSON.parse(readFileSync(join(ROOT, 'assets', 'manifest.json'), 'utf8'));
});

describe('npm pack contents', () => {
  it('manifest is well-formed with required top-level keys', () => {
    expect(manifest.version).toBe(1);
    expect(manifest.runtimeAssets).toBeDefined();
    expect(typeof manifest.runtimeAssets).toBe('object');
  });

  it('assets/manifest.json is in the tarball', () => {
    expect(packOutput).toContain('assets/manifest.json');
  });

  it('every runtimeAsset in the manifest is in the tarball', () => {
    const missing = [];
    for (const [key, assetPath] of Object.entries(manifest.runtimeAssets)) {
      if (!packOutput.includes(assetPath)) {
        missing.push(`${key}: ${assetPath}`);
      }
    }
    expect(missing, `Missing assets in npm pack output:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every runtimeAsset path exists on disk', () => {
    const missing = [];
    for (const [key, assetPath] of Object.entries(manifest.runtimeAssets)) {
      if (!existsSync(join(ROOT, assetPath))) {
        missing.push(`${key}: ${assetPath}`);
      }
    }
    expect(missing, `Missing assets on disk:\n${missing.join('\n')}`).toEqual([]);
  });

  it('excludes the old ss binary', () => {
    // Match "ss" as a standalone filename, not as a substring of other paths
    const lines = packOutput.split('\n').filter(l => l.includes('npm notice'));
    const hasBareSSFile = lines.some(l => /\bss$/.test(l.trim()));
    expect(hasBareSSFile).toBe(false);
  });

  it('excludes native addon .node files', () => {
    expect(packOutput).not.toMatch(/\.node\b/);
  });
});
