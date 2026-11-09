/**
 * Unit tests for scripts/verify-runtime.js
 */

import { describe, it, expect, vi } from 'vitest';
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
  it('passes with no model keys (init --skip-models) and the real package root', async () => {
    const result = await verifyRuntime({
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

  it('remedy text names the Node floor and the reinstall step', () => {
    expect(SQLITE_BINDING_REMEDY).toContain('Node.js 22');
    expect(SQLITE_BINDING_REMEDY).toContain('better-sqlite3');
    expect(SQLITE_BINDING_REMEDY).toContain('npm install');
  });

  // Uses a fixture model cache (sparse files of the registry sizes) so the result
  // does not depend on which models this machine has downloaded. The reranker is
  // opt-in and is absent from a normal init, so the real cache cannot be relied on.
  it('passes with the full model set cached', async () => {
    const { mkdtempSync, mkdirSync, openSync, ftruncateSync, closeSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const cacheRoot = mkdtempSync(join(tmpdir(), 'verify-runtime-models-'));
    const prevCache = process.env.SWEET_SEARCH_MODEL_CACHE;
    process.env.SWEET_SEARCH_MODEL_CACHE = cacheRoot;
    try {
      vi.resetModules();
      const fresh = await import('../../scripts/verify-runtime.js');
      const { getModelEntry } = await import('../../core/infrastructure/index.js');
      const modelKeys = ['lateon-code', 'lateon-code-edge', 'gte-reranker-modernbert-base', 'coderankembed-int8'];
      for (const key of modelKeys) {
        const entry = getModelEntry(key);
        for (const file of entry.files) {
          const dest = join(cacheRoot, entry.hfId.replace('/', '--'), file.path);
          mkdirSync(join(dest, '..'), { recursive: true });
          const fd = openSync(dest, 'w');
          ftruncateSync(fd, file.sizeBytes || 0);
          closeSync(fd);
        }
      }

      const result = await fresh.verifyRuntime({ modelKeys, deep: false, packageRoot: PACKAGE_ROOT });

      expect(result.checks.filter(c => c.status === 'fail')).toEqual([]);
      expect(result.passed).toBe(true);
      const modelChecks = result.checks.filter(c => c.name.startsWith('model:'));
      expect(modelChecks.length).toBeGreaterThan(modelKeys.length);

      // A wrong-size file must be reported, so the pass above is not vacuous.
      const entry = getModelEntry('lateon-code');
      const first = entry.files.find(f => f.sizeBytes);
      const bad = join(cacheRoot, entry.hfId.replace('/', '--'), first.path);
      const fd = openSync(bad, 'w');
      ftruncateSync(fd, first.sizeBytes - 1);
      closeSync(fd);
      const broken = await fresh.verifyRuntime({ modelKeys: ['lateon-code'], deep: false, packageRoot: PACKAGE_ROOT });
      expect(broken.passed).toBe(false);
    } finally {
      if (prevCache === undefined) delete process.env.SWEET_SEARCH_MODEL_CACHE;
      else process.env.SWEET_SEARCH_MODEL_CACHE = prevCache;
      vi.resetModules();
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it('fails for missing manifest', async () => {
    const result = await verifyRuntime({
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
