/**
 * Unit tests for scripts/init.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseInitArgs,
  checkNodeVersion,
  detectProjectRoot,
  ensureDataDir,
  loadInitConfig,
  writeInitConfig,
  resolveProfile,
  verifyRuntimeAssets,
  checkNativeStatus,
  downloadModelsForProfile,
} from '../../scripts/init.js';

// ---------------------------------------------------------------------------
// parseInitArgs
// ---------------------------------------------------------------------------

describe('parseInitArgs', () => {
  it('defaults to profile null, no flags', () => {
    const result = parseInitArgs([]);
    expect(result.profile).toBe(null);
    expect(result.verifyDeep).toBe(false);
    expect(result.force).toBe(false);
    expect(result.verbose).toBe(false);
    expect(result.help).toBe(false);
    expect(result.skipCuda).toBe(false);
  });

  it('parses --skip-cuda', () => {
    expect(parseInitArgs(['--skip-cuda']).skipCuda).toBe(true);
  });

  it('--skip-cuda is false by default', () => {
    expect(parseInitArgs(['--profile', 'full']).skipCuda).toBe(false);
  });

  it('combines --skip-cuda with other flags', () => {
    const result = parseInitArgs(['--skip-cuda', '--skip-coreml-cascade', '--skip-dedup', '-v']);
    expect(result.skipCuda).toBe(true);
    expect(result.skipCoremlCascade).toBe(true);
    expect(result.skipDedup).toBe(true);
    expect(result.verbose).toBe(true);
  });

  it('parses --profile core', () => {
    expect(parseInitArgs(['--profile', 'core']).profile).toBe('core');
  });

  it('parses --profile=full', () => {
    expect(parseInitArgs(['--profile=full']).profile).toBe('full');
  });

  it('parses -p full', () => {
    expect(parseInitArgs(['-p', 'full']).profile).toBe('full');
  });

  it('parses --verify-deep', () => {
    expect(parseInitArgs(['--verify-deep']).verifyDeep).toBe(true);
  });

  it('parses --force', () => {
    expect(parseInitArgs(['--force']).force).toBe(true);
  });

  it('parses --verbose', () => {
    expect(parseInitArgs(['--verbose']).verbose).toBe(true);
  });

  it('parses -v', () => {
    expect(parseInitArgs(['-v']).verbose).toBe(true);
  });

  it('parses --help', () => {
    expect(parseInitArgs(['--help']).help).toBe(true);
  });

  it('parses -h', () => {
    expect(parseInitArgs(['-h']).help).toBe(true);
  });

  it('handles combined flags', () => {
    const result = parseInitArgs(['--profile', 'core', '--force', '--verify-deep', '-v']);
    expect(result.profile).toBe('core');
    expect(result.force).toBe(true);
    expect(result.verifyDeep).toBe(true);
    expect(result.verbose).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkNodeVersion
// ---------------------------------------------------------------------------

describe('checkNodeVersion', () => {
  it('does not throw for Node >= 18', () => {
    // Current runtime is >= 18 or tests would not be running
    expect(() => checkNodeVersion()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// detectProjectRoot
// ---------------------------------------------------------------------------

describe('detectProjectRoot', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ss-init-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds .git directory', () => {
    const nested = join(tempDir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(tempDir, '.git'));
    expect(detectProjectRoot(nested)).toBe(tempDir);
  });

  it('finds package.json when no .git', () => {
    const nested = join(tempDir, 'sub');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(tempDir, 'package.json'), '{}');
    expect(detectProjectRoot(nested)).toBe(tempDir);
  });

  it('falls back to cwd when neither found', () => {
    const isolated = join(tempDir, 'empty');
    mkdirSync(isolated, { recursive: true });
    // detectProjectRoot walks up — tempDir itself has no .git or package.json,
    // so it will eventually reach filesystem root and fall back
    const result = detectProjectRoot(isolated);
    // Should return isolated (cwd fallback) since we can't guarantee
    // nothing exists above tempDir. The important thing is it doesn't throw.
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// ensureDataDir
// ---------------------------------------------------------------------------

describe('ensureDataDir', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ss-init-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates .sweet-search/ directory', () => {
    const dataDir = ensureDataDir(tempDir);
    expect(dataDir).toBe(join(tempDir, '.sweet-search'));
    expect(existsSync(dataDir)).toBe(true);
  });

  it('is idempotent', () => {
    ensureDataDir(tempDir);
    expect(() => ensureDataDir(tempDir)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadInitConfig / writeInitConfig
// ---------------------------------------------------------------------------

describe('loadInitConfig / writeInitConfig', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ss-init-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when config does not exist', () => {
    expect(loadInitConfig(tempDir)).toBe(null);
  });

  it('round-trips config through write and load', () => {
    const config = {
      version: 1,
      profile: 'full',
      initTimestamp: '2026-03-27T00:00:00.000Z',
      runtime: { allowRuntimeModelDownload: false },
    };
    writeInitConfig(tempDir, config);
    const loaded = loadInitConfig(tempDir);
    expect(loaded).toEqual(config);
  });

  it('overwrites existing config', () => {
    writeInitConfig(tempDir, { version: 1, profile: 'core' });
    writeInitConfig(tempDir, { version: 1, profile: 'full' });
    const loaded = loadInitConfig(tempDir);
    expect(loaded.profile).toBe('full');
  });
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe('resolveProfile', () => {
  it('uses CLI flag when provided', () => {
    expect(resolveProfile('core', null)).toBe('core');
    expect(resolveProfile('full', null)).toBe('full');
  });

  it('uses existing config when no CLI flag', () => {
    expect(resolveProfile(null, { profile: 'core' })).toBe('core');
  });

  it('defaults to full when no flag and no config', () => {
    expect(resolveProfile(null, null)).toBe('full');
  });

  it('CLI flag overrides existing config', () => {
    expect(resolveProfile('core', { profile: 'full' })).toBe('core');
  });

  it('throws for unknown profile', () => {
    expect(() => resolveProfile('unknown', null)).toThrow(/Unknown profile/);
  });

  it('ignores invalid profile in existing config', () => {
    expect(resolveProfile(null, { profile: 'invalid' })).toBe('full');
  });
});

// ---------------------------------------------------------------------------
// verifyRuntimeAssets
// ---------------------------------------------------------------------------

describe('verifyRuntimeAssets', () => {
  it('returns ok:true for the actual package root', () => {
    const packageRoot = join(import.meta.dirname, '../..');
    const result = verifyRuntimeAssets(packageRoot);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.present.length).toBeGreaterThan(0);
  });

  it('returns ok:false for a nonexistent root', () => {
    const result = verifyRuntimeAssets('/tmp/nonexistent-package-root');
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// checkNativeStatus
// ---------------------------------------------------------------------------

describe('checkNativeStatus', () => {
  it('returns platform info', () => {
    const status = checkNativeStatus();
    // On macOS or Linux, platform should be defined
    if (process.platform === 'darwin' || process.platform === 'linux') {
      expect(status.platform).not.toBe(null);
      expect(status.platform.packageName).toMatch(/^@sweet-search\/native-/);
    }
  });
});

// ---------------------------------------------------------------------------
// downloadModelsForProfile
// ---------------------------------------------------------------------------

describe('downloadModelsForProfile', () => {
  it('returns empty for core profile', async () => {
    const result = await downloadModelsForProfile('core');
    expect(result.results.size).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it('returns 8 model results for full profile (using cache)', async () => {
    // Skip when model cache does not exist (CI without pre-cached models)
    const cacheRoot = join(process.env.HOME || '', '.cache', 'sweet-search', 'models');
    if (!existsSync(join(cacheRoot, 'lightonai--LateOn-Code'))) {
      return; // models not cached — skip
    }

    const result = await downloadModelsForProfile('full');
    expect(result.results.size).toBe(8);
    expect(result.failures).toEqual([]);
    expect(result.totalCached).toBeGreaterThan(0);
  });
});
