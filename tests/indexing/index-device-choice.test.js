/**
 * Index-device choice: accelerator vs ORT INT8 CPU by a measured speed test.
 * Pure helpers in core/indexing/index-device-choice.js plus the
 * ensureIndexDeviceChoice() flow in model-pool.js (hardware + native addon
 * mocked; the measurement is injected, the cache lives in a temp dir).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../../core/infrastructure/hardware-capability.js', () => ({
  detectHardwareCapability: vi.fn(),
}));

vi.mock('../../core/infrastructure/native-inference.js', () => ({
  isNativeInferenceAvailable: vi.fn(() => true),
  loadNativeEmbeddingModelWithDevice: vi.fn(async () => ({})),
  loadNativeLiModelWithDevice: vi.fn(async () => ({})),
  warmupNativeEmbeddingModel: vi.fn(async () => {}),
  warmupNativeLiModel: vi.fn(async () => {}),
  unloadNativeModels: vi.fn(),
}));

import {
  CPU_WIN_MARGIN,
  buildProbeTexts,
  decideIndexDevice,
  indexDeviceCacheKey,
  indexDeviceOverride,
  readIndexDeviceChoice,
  writeIndexDeviceChoice,
} from '../../core/indexing/index-device-choice.js';
import {
  ensureIndexDeviceChoice,
  isIndexAcceleratorAvailable,
  _resetIndexDeviceChoice,
} from '../../core/indexing/model-pool.js';
import { detectHardwareCapability } from '../../core/infrastructure/hardware-capability.js';

const M1 = { brandString: 'Apple M1', inferenceBackendPreference: 'candle-metal', platform: 'darwin', arch: 'arm64' };

describe('decideIndexDevice', () => {
  it('keeps the accelerator on a tie or a small CPU lead', () => {
    expect(decideIndexDevice({ cpuMs: 1000, acceleratorMs: 1000 })).toBe('accelerator');
    expect(decideIndexDevice({ cpuMs: 1000, acceleratorMs: 1000 * CPU_WIN_MARGIN })).toBe('accelerator');
  });

  it('picks the CPU only when it is clearly faster', () => {
    expect(decideIndexDevice({ cpuMs: 1000, acceleratorMs: 1300 })).toBe('cpu');
  });

  it('keeps the accelerator when a timing is missing', () => {
    expect(decideIndexDevice({ cpuMs: 0, acceleratorMs: 1000 })).toBe('accelerator');
    expect(decideIndexDevice({ cpuMs: 1000, acceleratorMs: undefined })).toBe('accelerator');
  });
});

describe('indexDeviceOverride', () => {
  it('maps the env values and ignores anything else', () => {
    expect(indexDeviceOverride({ SWEET_SEARCH_INDEX_DEVICE: 'cpu' })).toBe('cpu');
    expect(indexDeviceOverride({ SWEET_SEARCH_INDEX_DEVICE: 'Metal' })).toBe('accelerator');
    expect(indexDeviceOverride({ SWEET_SEARCH_INDEX_DEVICE: 'auto' })).toBe(null);
    expect(indexDeviceOverride({})).toBe(null);
  });
});

describe('indexDeviceCacheKey + cache file', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'idx-device-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('changes with chip, LI model, profile and version', () => {
    const base = { hw: M1, liModel: 'lateon-code', includeLi: true, backgroundProfile: false, version: '1.0.0' };
    const k = indexDeviceCacheKey(base);
    expect(indexDeviceCacheKey({ ...base, hw: { ...M1, brandString: 'Apple M3 Max' } })).not.toBe(k);
    expect(indexDeviceCacheKey({ ...base, includeLi: false })).not.toBe(k);
    expect(indexDeviceCacheKey({ ...base, backgroundProfile: true })).not.toBe(k);
    expect(indexDeviceCacheKey({ ...base, version: '1.0.1' })).not.toBe(k);
  });

  it('round-trips an entry and keeps other keys', () => {
    expect(writeIndexDeviceChoice('a', { device: 'cpu' }, { cacheDir: dir })).toBe(true);
    writeIndexDeviceChoice('b', { device: 'accelerator' }, { cacheDir: dir });
    expect(readIndexDeviceChoice('a', { cacheDir: dir }).device).toBe('cpu');
    expect(readIndexDeviceChoice('b', { cacheDir: dir }).device).toBe('accelerator');
    expect(readIndexDeviceChoice('missing', { cacheDir: dir })).toBe(null);
  });
});

describe('buildProbeTexts', () => {
  it('is deterministic, distinct and chunk-sized', () => {
    const a = buildProbeTexts(8);
    expect(a).toEqual(buildProbeTexts(8));
    expect(new Set(a).size).toBe(8);
    for (const t of a) expect(t.length).toBeGreaterThanOrEqual(1400);
  });
});

describe('ensureIndexDeviceChoice', () => {
  let dir;
  const savedEnv = process.env.SWEET_SEARCH_INDEX_DEVICE;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'idx-device-'));
    delete process.env.SWEET_SEARCH_INDEX_DEVICE;
    _resetIndexDeviceChoice();
    detectHardwareCapability.mockReturnValue(M1);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.SWEET_SEARCH_INDEX_DEVICE;
    else process.env.SWEET_SEARCH_INDEX_DEVICE = savedEnv;
    _resetIndexDeviceChoice();
  });

  it('measures, caches, and moves indexing to the CPU when the CPU clearly wins', async () => {
    const measure = vi.fn(async () => ({ cpuMs: 1000, acceleratorMs: 2000, chunks: 32 }));
    const first = await ensureIndexDeviceChoice({ allowMeasure: true, measure, cacheDir: dir });
    expect(first).toMatchObject({ device: 'cpu', source: 'measured' });
    expect(isIndexAcceleratorAvailable()).toBe(false);

    _resetIndexDeviceChoice();
    const second = await ensureIndexDeviceChoice({ allowMeasure: true, measure, cacheDir: dir });
    expect(second).toMatchObject({ device: 'cpu', source: 'cached' });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(isIndexAcceleratorAvailable()).toBe(false);
  });

  it('keeps the accelerator when it is faster', async () => {
    const measure = vi.fn(async () => ({ cpuMs: 1480, acceleratorMs: 1000, chunks: 32 }));
    const r = await ensureIndexDeviceChoice({ allowMeasure: true, measure, cacheDir: dir });
    expect(r.device).toBe('accelerator');
    expect(isIndexAcceleratorAvailable()).toBe(true);
  });

  it('does not measure on a run that would not arm the accelerator', async () => {
    const measure = vi.fn();
    const r = await ensureIndexDeviceChoice({ allowMeasure: false, measure, cacheDir: dir });
    expect(r).toMatchObject({ device: 'accelerator', source: 'default' });
    expect(measure).not.toHaveBeenCalled();
  });

  it('keeps the accelerator and caches nothing when the test throws', async () => {
    const measure = vi.fn(async () => { throw new Error('boom'); });
    const r = await ensureIndexDeviceChoice({ allowMeasure: true, measure, cacheDir: dir });
    expect(r).toMatchObject({ device: 'accelerator', source: 'measure-failed' });
    expect(isIndexAcceleratorAvailable()).toBe(true);
    const again = await ensureIndexDeviceChoice({ allowMeasure: false, measure, cacheDir: dir });
    expect(again.source).toBe('default');
  });

  it('obeys SWEET_SEARCH_INDEX_DEVICE without measuring', async () => {
    const measure = vi.fn();
    process.env.SWEET_SEARCH_INDEX_DEVICE = 'cpu';
    const r = await ensureIndexDeviceChoice({ allowMeasure: true, measure, cacheDir: dir });
    expect(r).toMatchObject({ device: 'cpu', source: 'env' });
    expect(isIndexAcceleratorAvailable()).toBe(false);
    expect(measure).not.toHaveBeenCalled();
  });

  it('reports cpu with no test on a host with no accelerator', async () => {
    detectHardwareCapability.mockReturnValue({ inferenceBackendPreference: 'ort-cpu' });
    const measure = vi.fn();
    const r = await ensureIndexDeviceChoice({ allowMeasure: true, measure, cacheDir: dir });
    expect(r).toMatchObject({ device: 'cpu', source: 'no-accelerator' });
    expect(measure).not.toHaveBeenCalled();
  });
});
