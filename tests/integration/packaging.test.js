/**
 * Packaging test — validates npm tarball contents against core/infrastructure/manifest.json.
 *
 * Single source of truth: the manifest defines what must ship.
 * This test reads the manifest and asserts every listed asset appears
 * in `npm pack --dry-run` output.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

let packFiles;
let manifest;

beforeAll(() => {
  execSync('node scripts/generate-asset-manifest.js --check', { cwd: ROOT, stdio: 'pipe' });
  // Parse the machine-readable file list instead of scraping `npm notice` stdout.
  // The human-readable output's ordering/line-wrapping/buffering varies by npm
  // version and platform — on the macOS CI runner it was dropping mid-list
  // entries (e.g. manifest.json), failing deterministically there while passing
  // locally and on Linux. `--json` yields an exact, complete path list.
  const packJson = execSync('npm pack --dry-run --json', {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  packFiles = new Set(JSON.parse(packJson)[0].files.map((f) => f.path));
  manifest = JSON.parse(readFileSync(join(ROOT, 'core', 'infrastructure', 'manifest.json'), 'utf8'));
});

describe('npm pack contents', () => {
  it('manifest is well-formed with required top-level keys', () => {
    expect(manifest.version).toBe(2);
    expect(manifest.runtimeAssets).toBeDefined();
    expect(typeof manifest.runtimeAssets).toBe('object');
  });

  it('core/infrastructure/manifest.json is in the tarball', () => {
    expect(packFiles.has('core/infrastructure/manifest.json')).toBe(true);
  });

  it('ships the shared environment sourced by every ss-* wrapper', () => {
    expect(packFiles.has('eval/agent-read-workflows/bin/_ss-env.sh')).toBe(true);
  });

  it('every runtimeAsset in the manifest is in the tarball', () => {
    const missing = [];
    for (const [key, assetPath] of Object.entries(manifest.runtimeAssets)) {
      if (!packFiles.has(assetPath)) {
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
    // A bare "ss" file at any depth, not "ss" as a substring of other paths.
    const hasBareSSFile = [...packFiles].some((p) => p === 'ss' || p.endsWith('/ss'));
    expect(hasBareSSFile).toBe(false);
  });

  it('excludes native addon .node files', () => {
    expect([...packFiles].some((p) => /\.node$/.test(p))).toBe(false);
  });
});
