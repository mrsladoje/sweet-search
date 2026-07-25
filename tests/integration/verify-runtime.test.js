/**
 * Unit tests for scripts/verify-runtime.js
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  verifyRuntime,
  getMaxsimTier,
  getRouterType,
  probeSqliteBinding,
  SQLITE_BINDING_REMEDY,
} from '../../scripts/verify-runtime.js';

const PACKAGE_ROOT = join(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Fast verification
// ---------------------------------------------------------------------------

describe('verifyRuntime (fast)', () => {
  it('passes for core profile with real package root', async () => {
    const result = await verifyRuntime({
      profile: 'core',
      modelKeys: [],
      deep: false,
      packageRoot: PACKAGE_ROOT,
    });

    expect(result.passed).toBe(true);
    expect(result.type).toBe('fast');
    expect(result.timestamp).toBeTruthy();

    // All runtime asset checks should pass
    const assetChecks = result.checks.filter(c => c.name.startsWith('asset:'));
    expect(assetChecks.length).toBe(6);
    for (const check of assetChecks) {
      expect(check.status).toBe('pass');
    }
  });

  // Regression: npm >= 11.16 blocks install scripts by default, so
  // better-sqlite3 can land without its prebuilt binding. Fast verification
  // MUST catch that — init previously reported a green 8/8 on a tree that
  // could not index at all.
  it('probes the native SQLite binding during FAST verification', async () => {
    const result = await verifyRuntime({
      profile: 'core',
      modelKeys: [],
      deep: false,
      packageRoot: PACKAGE_ROOT,
    });

    const sqlite = result.checks.find(c => c.name === 'native:sqlite');
    expect(sqlite, 'native:sqlite check must run in fast mode').toBeDefined();
    expect(sqlite.status).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// Native SQLite binding probe
// ---------------------------------------------------------------------------

describe('probeSqliteBinding', () => {
  it('opens a real database rather than only resolving the module', () => {
    // A bare `require('better-sqlite3')` succeeds even when the .node binding
    // is missing (bindings resolve lazily on first Database construction), so
    // the probe must actually open one to be meaningful.
    expect(probeSqliteBinding()).toEqual({ ok: true });
  });

  it('remedy text names the allowScripts fix and the reinstall step', () => {
    expect(SQLITE_BINDING_REMEDY).toContain('allowScripts');
    expect(SQLITE_BINDING_REMEDY).toContain('better-sqlite3');
    expect(SQLITE_BINDING_REMEDY).toContain('npm install');
  });

  // CI-skipped: GitHub runners do not run `sweet-search init` first and can
  // have a partial ~/.cache/sweet-search/models directory from earlier jobs,
  // which makes this full-profile cache assertion nondeterministic. Local runs
  // still exercise the real cached-model verification path when models exist.
  it.skipIf(process.env.CI === 'true')('passes for full profile with cached models', async () => {
    // Skip when model cache does not exist (CI without pre-cached models)
    const { existsSync } = await import('node:fs');
    const { join: pathJoin } = await import('node:path');
    const cacheRoot = pathJoin(process.env.HOME || '', '.cache', 'sweet-search', 'models');
    if (!existsSync(pathJoin(cacheRoot, 'lightonai--LateOn-Code'))) {
      return; // models not cached — skip
    }

    const modelKeys = ['lateon-code', 'lateon-code-edge', 'gte-reranker-modernbert-base', 'coderankembed-int8'];
    const result = await verifyRuntime({
      profile: 'full',
      modelKeys,
      deep: false,
      packageRoot: PACKAGE_ROOT,
    });

    expect(result.passed).toBe(true);
    // Model checks should all pass
    const modelChecks = result.checks.filter(c => c.name.startsWith('model:'));
    expect(modelChecks.length).toBeGreaterThan(0);
    for (const check of modelChecks) {
      expect(check.status).toBe('pass');
    }
  });

  it('fails for missing manifest', async () => {
    const result = await verifyRuntime({
      profile: 'core',
      modelKeys: [],
      deep: false,
      packageRoot: '/tmp/nonexistent',
    });

    expect(result.passed).toBe(false);
    expect(result.checks[0].name).toBe('manifest');
    expect(result.checks[0].status).toBe('fail');
  });

  it('fails for unknown model key', async () => {
    const result = await verifyRuntime({
      profile: 'full',
      modelKeys: ['nonexistent-model'],
      deep: false,
      packageRoot: PACKAGE_ROOT,
    });

    expect(result.passed).toBe(false);
    const modelCheck = result.checks.find(c => c.name === 'model:nonexistent-model');
    expect(modelCheck.status).toBe('fail');
    expect(modelCheck.message).toContain('Unknown');
  });

  it('reports native status as warn when addon/binary missing', async () => {
    const result = await verifyRuntime({
      profile: 'core',
      modelKeys: [],
      deep: false,
      packageRoot: PACKAGE_ROOT,
    });

    // Native checks exist — they may be pass or warn depending on platform
    const nativeChecks = result.checks.filter(c => c.name.startsWith('native:'));
    expect(nativeChecks.length).toBeGreaterThan(0);

    // Warns do not block overall pass
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deep verification
// ---------------------------------------------------------------------------

describe('verifyRuntime (deep)', () => {
  it('includes load checks for wasm-router and catboost-router', async () => {
    const result = await verifyRuntime({
      profile: 'core',
      modelKeys: [],
      deep: true,
      packageRoot: PACKAGE_ROOT,
    });

    const loadChecks = result.checks.filter(c => c.name.startsWith('load:'));
    expect(loadChecks.length).toBe(2);

    const wasmCheck = loadChecks.find(c => c.name === 'load:wasm-router');
    expect(wasmCheck).toBeDefined();

    const catboostCheck = loadChecks.find(c => c.name === 'load:catboost-router');
    expect(catboostCheck).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tier detection helpers
// ---------------------------------------------------------------------------

describe('getMaxsimTier', () => {
  it('returns a valid tier string', () => {
    const tier = getMaxsimTier();
    expect(['native', 'wasm', 'js-fallback']).toContain(tier);
  });
});

describe('getRouterType', () => {
  it('returns wasm when router WASM exists', () => {
    expect(getRouterType()).toBe('wasm');
  });
});
