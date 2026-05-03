/**
 * Unit tests for core/infrastructure/coreml-cascade.js
 *
 * Covers the pure, filesystem-driven surface of the cascade module:
 *   - Shape spec loading + filename formatting
 *   - State inspection against synthetic fixture dirs (empty, partial,
 *     complete, and with malformed variants)
 *   - Resolved-dirs decision with SWEET_SEARCH_COREML_CASCADE=0 opt-out
 *   - Report construction for every state transition
 *
 * The `fetchCoremlCascade` network path is NOT exercised here — it
 * requires HF access and would make the test suite flaky. The
 * roundtrip was validated manually during the 2026-04-14 cascade
 * publish and is exercised end-to-end by scripts/init.js in the
 * integration test suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getCascadeSpec,
  getCoremlCascadeRoot,
  formatVariantFilename,
  formatVariantTarballPath,
  isValidMlpackage,
  getExpectedVariantPaths,
  getCoremlCascadeState,
  getCoremlCascadeResolvedDirs,
  getCoremlCascadeReport,
  resolveFamiliesToFetch,
} from '../../core/infrastructure/coreml-cascade.js';
import { _resetHardwareCapabilityCache } from '../../core/infrastructure/hardware-capability.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Create a synthetic `.mlpackage` directory tree that passes
 * isValidMlpackage(): Manifest.json + Data/foo.bin.
 */
function makeValidMlpackage(path) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'Manifest.json'), '{"version": "1.0"}');
  const dataDir = join(path, 'Data', 'com.apple.CoreML', 'weights');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'weight.bin'), 'synthetic weight data');
}

/**
 * Create a synthetic `.mlpackage` missing Manifest.json — should be
 * treated as INVALID.
 */
function makeMlpackageMissingManifest(path) {
  mkdirSync(path, { recursive: true });
  const dataDir = join(path, 'Data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'weight.bin'), 'synthetic weight data');
}

/**
 * Create a synthetic `.mlpackage` with Manifest.json but empty Data/.
 * Treated as INVALID per isValidMlpackage contract.
 */
function makeMlpackageEmptyData(path) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'Manifest.json'), '{}');
  mkdirSync(join(path, 'Data'), { recursive: true });
}

// ---------------------------------------------------------------------------
// Cascade spec
// ---------------------------------------------------------------------------

describe('getCascadeSpec', () => {
  it('loads coreml-cascade.json with the expected top-level shape', () => {
    const spec = getCascadeSpec();
    expect(spec.version).toBeGreaterThanOrEqual(1);
    expect(spec.hfRepo).toBeTruthy();
    expect(spec).toHaveProperty('embed');
    expect(spec).toHaveProperty('li');
    expect(spec).toHaveProperty('liEdge');
  });

  it('embed section has the expected fields', () => {
    const spec = getCascadeSpec();
    expect(spec.embed.filePattern).toMatch(/nomic_bert_b\{batch\}_s\{seq\}_fp16\.mlpackage/);
    expect(spec.embed.tarballPattern).toMatch(/embed\/nomic_bert_b\{batch\}_s\{seq\}_fp16\.mlpackage\.tar\.gz/);
    expect(spec.embed.hiddenDim).toBe(768);
    expect(Array.isArray(spec.embed.variants)).toBe(true);
    expect(spec.embed.variants.length).toBe(6);
  });

  it('li section (standard 128d) has the expected fields', () => {
    const spec = getCascadeSpec();
    expect(spec.li.filePattern).toMatch(/li_modernbert_b\{batch\}_s\{seq\}_fp16\.mlpackage/);
    expect(spec.li.tarballPattern).toMatch(/li\/li_modernbert_b\{batch\}_s\{seq\}_fp16\.mlpackage\.tar\.gz/);
    expect(spec.li.tokenDim).toBe(128);
    expect(spec.li.backboneDim).toBe(768);
    expect(Array.isArray(spec.li.variants)).toBe(true);
    expect(spec.li.variants.length).toBe(6);
  });

  it('liEdge section (edge 48d) has the expected fields', () => {
    const spec = getCascadeSpec();
    expect(spec.liEdge.filePattern).toMatch(/li_modernbert_edge_b\{batch\}_s\{seq\}_fp16\.mlpackage/);
    expect(spec.liEdge.tarballPattern).toMatch(/li-edge\/li_modernbert_edge_b\{batch\}_s\{seq\}_fp16\.mlpackage\.tar\.gz/);
    expect(spec.liEdge.tokenDim).toBe(48);
    expect(spec.liEdge.backboneDim).toBe(256);
    expect(Array.isArray(spec.liEdge.variants)).toBe(true);
    expect(spec.liEdge.variants.length).toBe(6);
  });

  it('every variant has batch, seq, and rationale', () => {
    const spec = getCascadeSpec();
    for (const v of spec.embed.variants) {
      expect(v).toHaveProperty('batch');
      expect(v).toHaveProperty('seq');
      expect(v).toHaveProperty('rationale');
      expect(typeof v.batch).toBe('number');
      expect(typeof v.seq).toBe('number');
    }
    for (const v of spec.li.variants) {
      expect(v).toHaveProperty('batch');
      expect(v).toHaveProperty('seq');
      expect(v).toHaveProperty('rationale');
    }
    for (const v of spec.liEdge.variants) {
      expect(v).toHaveProperty('batch');
      expect(v).toHaveProperty('seq');
      expect(v).toHaveProperty('rationale');
    }
  });

  it('embed variants match the published cascade shape set', () => {
    const spec = getCascadeSpec();
    const pairs = spec.embed.variants.map(v => [v.batch, v.seq]);
    expect(pairs).toEqual([
      [64, 96],
      [64, 192],
      [32, 384],
      [16, 512],
      [4, 1024],
      [1, 2048],
    ]);
  });

  it('li variants match the published cascade shape set', () => {
    const spec = getCascadeSpec();
    const pairs = spec.li.variants.map(v => [v.batch, v.seq]);
    expect(pairs).toEqual([
      [128, 48],
      [128, 128],
      [64, 256],
      [16, 512],
      [4, 1024],
      [1, 2048],
    ]);
  });

  it('returns a stable reference on repeat calls (cached)', () => {
    const a = getCascadeSpec();
    const b = getCascadeSpec();
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Filename formatting
// ---------------------------------------------------------------------------

describe('formatVariantFilename', () => {
  it('substitutes batch and seq', () => {
    expect(
      formatVariantFilename('nomic_bert_b{batch}_s{seq}_fp16.mlpackage', 64, 96),
    ).toBe('nomic_bert_b64_s96_fp16.mlpackage');
    expect(
      formatVariantFilename('li_modernbert_b{batch}_s{seq}_fp16.mlpackage', 128, 48),
    ).toBe('li_modernbert_b128_s48_fp16.mlpackage');
  });
});

describe('formatVariantTarballPath', () => {
  it('preserves subdirectory prefix in the pattern', () => {
    expect(
      formatVariantTarballPath('embed/nomic_bert_b{batch}_s{seq}_fp16.mlpackage.tar.gz', 4, 1024),
    ).toBe('embed/nomic_bert_b4_s1024_fp16.mlpackage.tar.gz');
    expect(
      formatVariantTarballPath('li/li_modernbert_b{batch}_s{seq}_fp16.mlpackage.tar.gz', 1, 2048),
    ).toBe('li/li_modernbert_b1_s2048_fp16.mlpackage.tar.gz');
  });
});

// ---------------------------------------------------------------------------
// isValidMlpackage
// ---------------------------------------------------------------------------

describe('isValidMlpackage', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ss-cascade-mlp-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false for a non-existent path', () => {
    expect(isValidMlpackage(join(tempDir, 'ghost.mlpackage'))).toBe(false);
  });

  it('returns false for a regular file (not a directory)', () => {
    const f = join(tempDir, 'file.mlpackage');
    writeFileSync(f, 'not a directory');
    expect(isValidMlpackage(f)).toBe(false);
  });

  it('returns false for a directory with no Manifest.json', () => {
    const p = join(tempDir, 'no-manifest.mlpackage');
    makeMlpackageMissingManifest(p);
    expect(isValidMlpackage(p)).toBe(false);
  });

  it('returns false for a directory with empty Data/', () => {
    const p = join(tempDir, 'empty-data.mlpackage');
    makeMlpackageEmptyData(p);
    expect(isValidMlpackage(p)).toBe(false);
  });

  it('returns true for a well-formed .mlpackage', () => {
    const p = join(tempDir, 'good.mlpackage');
    makeValidMlpackage(p);
    expect(isValidMlpackage(p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State + resolved dirs + report — synthetic fixture cache
// ---------------------------------------------------------------------------

describe('cascade state against a synthetic fixture cache', () => {
  let fixtureRoot;
  let originalModelCache;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'ss-cascade-fx-'));
    originalModelCache = process.env.SWEET_SEARCH_MODEL_CACHE;
    process.env.SWEET_SEARCH_MODEL_CACHE = fixtureRoot;
    _resetHardwareCapabilityCache();
    // Force re-import so MODEL_DELIVERY_CONFIG picks up the new env var.
    // Vitest caches module imports — we need to reset so the cascade
    // module sees the new model cache root.
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    if (originalModelCache === undefined) {
      delete process.env.SWEET_SEARCH_MODEL_CACHE;
    } else {
      process.env.SWEET_SEARCH_MODEL_CACHE = originalModelCache;
    }
    _resetHardwareCapabilityCache();
    vi.resetModules();
    delete process.env.SWEET_SEARCH_COREML_CASCADE;
  });

  it('reports empty state when nothing is present', async () => {
    const mod = await import('../../core/infrastructure/coreml-cascade.js?t=' + Date.now());
    const state = mod.getCoremlCascadeState();
    expect(state.root).toBe(join(fixtureRoot, 'coreml-cascade'));
    expect(state.embedPresent).toBe(0);
    expect(state.liPresent).toBe(0);
    expect(state.liEdgePresent).toBe(0);
    expect(state.embedTotal).toBe(6);
    expect(state.liTotal).toBe(6);
    expect(state.liEdgeTotal).toBe(6);
    expect(state.complete).toBe(false);
    expect(state.missing.length).toBe(18);
  });

  it('reports partial state when a subset is installed', async () => {
    // Install exactly 2 embed variants.
    const embedDir = join(fixtureRoot, 'coreml-cascade', 'embed');
    mkdirSync(embedDir, { recursive: true });
    makeValidMlpackage(join(embedDir, 'nomic_bert_b64_s96_fp16.mlpackage'));
    makeValidMlpackage(join(embedDir, 'nomic_bert_b64_s192_fp16.mlpackage'));

    const mod = await import('../../core/infrastructure/coreml-cascade.js?t=' + Date.now());
    const state = mod.getCoremlCascadeState();
    expect(state.embedPresent).toBe(2);
    expect(state.liPresent).toBe(0);
    expect(state.liEdgePresent).toBe(0);
    expect(state.complete).toBe(false);
    expect(state.missing).toHaveLength(16);
    // Confirm the PRESENT variants are no longer in the missing list.
    expect(state.missing.some(m => m.includes('b64_s96'))).toBe(false);
    expect(state.missing.some(m => m.includes('b64_s192'))).toBe(false);
  });

  it('reports complete state when all 18 variants are valid', async () => {
    const embedDir = join(fixtureRoot, 'coreml-cascade', 'embed');
    const liDir = join(fixtureRoot, 'coreml-cascade', 'li');
    const liEdgeDir = join(fixtureRoot, 'coreml-cascade', 'li-edge');
    mkdirSync(embedDir, { recursive: true });
    mkdirSync(liDir, { recursive: true });
    mkdirSync(liEdgeDir, { recursive: true });

    const mod = await import('../../core/infrastructure/coreml-cascade.js?t=' + Date.now());
    const { embedPaths, liPaths, liEdgePaths } = mod.getExpectedVariantPaths();
    for (const v of [...embedPaths, ...liPaths, ...liEdgePaths]) {
      makeValidMlpackage(v.fullPath);
    }

    const state = mod.getCoremlCascadeState();
    expect(state.embedPresent).toBe(6);
    expect(state.liPresent).toBe(6);
    expect(state.liEdgePresent).toBe(6);
    expect(state.complete).toBe(true);
    expect(state.missing).toEqual([]);
  });

  it('routes resolved liDir to li-edge when liVariantKey=lateon-code-edge', async () => {
    // `getCoremlCascadeResolvedDirs` is hardware-gated: on platforms where
    // `isCoremlCascadeApplicable()` returns false (everything except
    // M3+ Apple Silicon — i.e. all Linux CI runners and Intel Macs), it
    // short-circuits with `status: 'hardware-ineligible'` and both dirs
    // null BEFORE ever inspecting the variant key. The variant-routing
    // logic this test covers is therefore only observable on eligible
    // hardware. We split the assertion accordingly so the test exercises
    // the actual production behaviour on every platform without weakening
    // either path or mocking the hardware capability.
    const embedDir = join(fixtureRoot, 'coreml-cascade', 'embed');
    const liDir = join(fixtureRoot, 'coreml-cascade', 'li');
    const liEdgeDir = join(fixtureRoot, 'coreml-cascade', 'li-edge');
    mkdirSync(embedDir, { recursive: true });
    mkdirSync(liDir, { recursive: true });
    mkdirSync(liEdgeDir, { recursive: true });

    const mod = await import('../../core/infrastructure/coreml-cascade.js?t=' + Date.now());
    const { embedPaths, liPaths, liEdgePaths } = mod.getExpectedVariantPaths();
    for (const v of [...embedPaths, ...liPaths, ...liEdgePaths]) {
      makeValidMlpackage(v.fullPath);
    }

    const cascadeApplicable = mod.isCoremlCascadeApplicable();
    const standardResolved = mod.getCoremlCascadeResolvedDirs('lateon-code');
    const edgeResolved = mod.getCoremlCascadeResolvedDirs('lateon-code-edge');

    if (cascadeApplicable) {
      // Eligible hardware — the variant key picks the LI dir.
      expect(standardResolved.liDir).toBe(liDir);
      expect(standardResolved.embedDir).toBe(embedDir);
      expect(edgeResolved.liDir).toBe(liEdgeDir);
      expect(edgeResolved.embedDir).toBe(embedDir);
    } else {
      // Hardware-ineligible — both calls short-circuit identically before
      // reaching the variant dispatch. This is the path Ubuntu CI takes;
      // assert the documented contract so the gate itself stays covered.
      expect(standardResolved.status).toBe('hardware-ineligible');
      expect(standardResolved.liDir).toBeNull();
      expect(standardResolved.embedDir).toBeNull();
      expect(edgeResolved.status).toBe('hardware-ineligible');
      expect(edgeResolved.liDir).toBeNull();
      expect(edgeResolved.embedDir).toBeNull();
    }
  });

  it('treats malformed mlpackage dirs as missing', async () => {
    const embedDir = join(fixtureRoot, 'coreml-cascade', 'embed');
    mkdirSync(embedDir, { recursive: true });
    // Missing Manifest.json — should NOT count as present.
    makeMlpackageMissingManifest(join(embedDir, 'nomic_bert_b64_s96_fp16.mlpackage'));

    const mod = await import('../../core/infrastructure/coreml-cascade.js?t=' + Date.now());
    const state = mod.getCoremlCascadeState();
    expect(state.embedPresent).toBe(0);
    expect(state.missing.some(m => m.includes('b64_s96'))).toBe(true);
  });
});

describe('getCoremlCascadeResolvedDirs opt-out via env', () => {
  let originalFlag;

  beforeEach(() => {
    originalFlag = process.env.SWEET_SEARCH_COREML_CASCADE;
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.SWEET_SEARCH_COREML_CASCADE;
    } else {
      process.env.SWEET_SEARCH_COREML_CASCADE = originalFlag;
    }
  });

  it('returns disabled-by-env when SWEET_SEARCH_COREML_CASCADE=0', () => {
    process.env.SWEET_SEARCH_COREML_CASCADE = '0';
    const resolved = getCoremlCascadeResolvedDirs();
    expect(resolved.status).toBe('disabled-by-env');
    expect(resolved.embedDir).toBeNull();
    expect(resolved.liDir).toBeNull();
  });

  it('returns disabled-by-env for "false" / "off" as well', () => {
    for (const val of ['false', 'FALSE', 'off', 'Off']) {
      process.env.SWEET_SEARCH_COREML_CASCADE = val;
      const resolved = getCoremlCascadeResolvedDirs();
      expect(resolved.status).toBe('disabled-by-env');
    }
  });
});

// ---------------------------------------------------------------------------
// getCoremlCascadeReport
// ---------------------------------------------------------------------------

describe('getCoremlCascadeReport', () => {
  let originalFlag;

  beforeEach(() => {
    originalFlag = process.env.SWEET_SEARCH_COREML_CASCADE;
    delete process.env.SWEET_SEARCH_COREML_CASCADE;
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.SWEET_SEARCH_COREML_CASCADE;
    } else {
      process.env.SWEET_SEARCH_COREML_CASCADE = originalFlag;
    }
  });

  it('returns a well-formed object with required fields', () => {
    const report = getCoremlCascadeReport();
    expect(report).toHaveProperty('status');
    expect(report).toHaveProperty('detail');
    expect(typeof report.status).toBe('string');
    expect(typeof report.detail).toBe('string');
  });

  it('returns disabled when env var is set to 0', () => {
    process.env.SWEET_SEARCH_COREML_CASCADE = '0';
    const report = getCoremlCascadeReport();
    expect(report.status).toBe('disabled');
    expect(report.detail).toMatch(/SWEET_SEARCH_COREML_CASCADE=0/);
  });
});

// ---------------------------------------------------------------------------
// resolveFamiliesToFetch — release-policy gating for fetchCoremlCascade
// ---------------------------------------------------------------------------

describe('resolveFamiliesToFetch', () => {
  it('auto with standard variant returns embed + li (no li-edge)', () => {
    const families = resolveFamiliesToFetch('auto', 'lateon-code');
    expect(Array.from(families).sort()).toEqual(['embed', 'li']);
  });

  it('auto with edge variant returns embed + li-edge (no standard li)', () => {
    const families = resolveFamiliesToFetch('auto', 'lateon-code-edge');
    expect(Array.from(families).sort()).toEqual(['embed', 'li-edge']);
  });

  it('auto with unknown variant defaults to embed + standard li', () => {
    // Defensive: anything other than the known edge key falls through
    // to the standard cascade — accuracy-first default policy.
    const families = resolveFamiliesToFetch('auto', undefined);
    expect(Array.from(families).sort()).toEqual(['embed', 'li']);
  });

  it('all returns every family', () => {
    const families = resolveFamiliesToFetch('all', 'lateon-code');
    expect(Array.from(families).sort()).toEqual(['embed', 'li', 'li-edge']);
  });

  it('explicit list filters to known families', () => {
    expect(Array.from(resolveFamiliesToFetch(['li-edge'], 'lateon-code')).sort())
      .toEqual(['li-edge']);
    expect(Array.from(resolveFamiliesToFetch(['embed', 'li'], 'lateon-code-edge')).sort())
      .toEqual(['embed', 'li']);
  });

  it('explicit list with unknown family entries is ignored', () => {
    // Unknown entries silently dropped; if everything is unknown the
    // resolver falls back to auto-default for the variant.
    expect(Array.from(resolveFamiliesToFetch(['bogus'], 'lateon-code')).sort())
      .toEqual(['embed', 'li']);
    expect(Array.from(resolveFamiliesToFetch(['li', 'bogus'], 'lateon-code-edge')).sort())
      .toEqual(['li']);
  });
});

// ---------------------------------------------------------------------------
// getExpectedVariantPaths
// ---------------------------------------------------------------------------

describe('getExpectedVariantPaths', () => {
  it('returns 6 embed + 6 LI + 6 LI-edge paths', () => {
    const { embedPaths, liPaths, liEdgePaths } = getExpectedVariantPaths();
    expect(embedPaths.length).toBe(6);
    expect(liPaths.length).toBe(6);
    expect(liEdgePaths.length).toBe(6);
  });

  it('embed paths live under the cascade root / embed subdir', () => {
    const { embedPaths } = getExpectedVariantPaths();
    const root = getCoremlCascadeRoot();
    for (const v of embedPaths) {
      expect(v.fullPath.startsWith(join(root, 'embed'))).toBe(true);
      expect(v.filename).toMatch(/^nomic_bert_b\d+_s\d+_fp16\.mlpackage$/);
    }
  });

  it('li paths live under the cascade root / li subdir', () => {
    const { liPaths } = getExpectedVariantPaths();
    const root = getCoremlCascadeRoot();
    for (const v of liPaths) {
      expect(v.fullPath.startsWith(join(root, 'li'))).toBe(true);
      // Standard LI filenames don't include "edge" — the edge variant has its
      // own prefix. Reject any standard path matching the longer prefix.
      expect(v.filename).toMatch(/^li_modernbert_b\d+_s\d+_fp16\.mlpackage$/);
      expect(v.filename.startsWith('li_modernbert_edge_')).toBe(false);
    }
  });

  it('liEdge paths live under the cascade root / li-edge subdir', () => {
    const { liEdgePaths } = getExpectedVariantPaths();
    const root = getCoremlCascadeRoot();
    for (const v of liEdgePaths) {
      expect(v.fullPath.startsWith(join(root, 'li-edge'))).toBe(true);
      expect(v.filename).toMatch(/^li_modernbert_edge_b\d+_s\d+_fp16\.mlpackage$/);
    }
  });
});
