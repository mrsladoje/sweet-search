/**
 * Index-device choice: accelerator vs ORT INT8 CPU by a measured speed test.
 * Pure helpers in core/indexing/index-device-choice.js plus the
 * measureIndexDevices / ensureIndexDeviceChoice flow in model-pool.js
 * (hardware, native addon and CoreML cascade mocked; the child processes and
 * the measurement are injected; the cache lives in a temp dir).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../../core/infrastructure/hardware-capability.js', () => ({
  detectHardwareCapability: vi.fn(),
}));

vi.mock('../../core/infrastructure/coreml-cascade.js', () => ({
  getCoremlCascadeResolvedDirs: vi.fn(() => ({ status: 'armed' })),
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
  INDEX_DEVICE_LOCK_FILE,
  acceleratorProvenanceProblem,
  buildProbeTexts,
  decideIndexDevice,
  indexDeviceCacheKey,
  indexDeviceOverride,
  isCloseResult,
  isEntryFresh,
  readIndexDeviceChoice,
  tryAcquireProbeLock,
  writeIndexDeviceChoice,
} from '../../core/indexing/index-device-choice.js';
import {
  ensureIndexDeviceChoice,
  isIndexAcceleratorAvailable,
  measureIndexDevices,
  _resetIndexDeviceChoice,
} from '../../core/indexing/model-pool.js';
import { LATE_INTERACTION_CONFIG } from '../../core/infrastructure/config/index.js';
import { detectHardwareCapability } from '../../core/infrastructure/hardware-capability.js';
import { getCoremlCascadeResolvedDirs } from '../../core/infrastructure/coreml-cascade.js';
import { unloadNativeModels } from '../../core/infrastructure/native-inference.js';

const M1 = { brandString: 'Apple M1', inferenceBackendPreference: 'candle-metal', platform: 'darwin', arch: 'arm64' };
const M3 = { brandString: 'Apple M3', inferenceBackendPreference: 'coreml-cascade', platform: 'darwin', arch: 'arm64' };
const later = (days) => new Date(Date.now() + days * 86400e3).toISOString();

describe('decideIndexDevice + isCloseResult', () => {
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

  it('flags results near the margin as close', () => {
    expect(isCloseResult({ cpuMs: 1000, acceleratorMs: 1200 })).toBe(true);
    expect(isCloseResult({ cpuMs: 1000, acceleratorMs: 350 })).toBe(false); // M3 Max-like
    expect(isCloseResult({ cpuMs: 1000, acceleratorMs: 3000 })).toBe(false);
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

describe('indexDeviceCacheKey', () => {
  const setup = {
    includeLi: true, liModel: 'lateon-code', parallel: true, embeddingThreads: 6, lateInteractionThreads: 6,
    liBatch: { batchSize: 32 }, backgroundProfile: false, embeddingModel: 'm', cascadeStatus: 'armed',
  };
  const key = (over = {}, env = {}) => indexDeviceCacheKey({ hw: M3, setup: { ...setup, ...over }, env, version: '1.0.0' });

  it('changes with every value that changes the comparison', () => {
    const k = key();
    expect(indexDeviceCacheKey({ hw: M1, setup, env: {}, version: '1.0.0' })).not.toBe(k);
    for (const over of [
      { cascadeStatus: 'disabled-by-env' }, { cascadeStatus: 'not-installed' }, { includeLi: false },
      { liModel: 'lateon-code-edge' }, { parallel: false }, { embeddingThreads: 4 }, { lateInteractionThreads: 4 },
      { liBatch: { batchSize: 16 } }, { backgroundProfile: true }, { embeddingModel: 'other' },
    ]) {
      expect(key(over)).not.toBe(k);
    }
    expect(key({}, { SWEET_SEARCH_EMBED_USE_CPU: '1' })).not.toBe(k);
    expect(key({}, { SWEET_SEARCH_LI_USE_CPU: '1' })).not.toBe(k);
    expect(indexDeviceCacheKey({ hw: M3, setup, env: {}, version: '1.0.1' })).not.toBe(k);
  });
});

describe('cache file, expiry and lock', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'idx-device-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('round-trips entries, keeps other keys, and hides expired ones', () => {
    expect(writeIndexDeviceChoice('a', { device: 'cpu', expiresAt: later(1) }, { cacheDir: dir })).toBe(true);
    writeIndexDeviceChoice('b', { device: 'accelerator', expiresAt: later(1) }, { cacheDir: dir });
    expect(readIndexDeviceChoice('a', { cacheDir: dir }).device).toBe('cpu');
    expect(readIndexDeviceChoice('b', { cacheDir: dir }).device).toBe('accelerator');
    expect(readIndexDeviceChoice('a', { cacheDir: dir, now: Date.now() + 2 * 86400e3 })).toBe(null);
    expect(readIndexDeviceChoice('missing', { cacheDir: dir })).toBe(null);
  });

  it('treats entries without an expiry as stale (written by an older version)', () => {
    expect(isEntryFresh({ device: 'cpu' })).toBe(false);
  });

  it('gives the lock to one holder at a time and takes over a dead holder', () => {
    const release = tryAcquireProbeLock({ cacheDir: dir });
    expect(release).toBeTypeOf('function');
    expect(tryAcquireProbeLock({ cacheDir: dir })).toBe(null);
    release();
    expect(existsSync(path.join(dir, INDEX_DEVICE_LOCK_FILE))).toBe(false);

    writeFileSync(path.join(dir, INDEX_DEVICE_LOCK_FILE), JSON.stringify({ pid: 2 ** 30, at: 'x' }));
    const again = tryAcquireProbeLock({ cacheDir: dir });
    expect(again).toBeTypeOf('function');
    expect(JSON.parse(readFileSync(path.join(dir, INDEX_DEVICE_LOCK_FILE), 'utf8')).pid).toBe(process.pid);
    again();
  });

  it('takes over a lock older than staleMs even when its holder lives', () => {
    writeFileSync(path.join(dir, INDEX_DEVICE_LOCK_FILE), JSON.stringify({ pid: process.ppid }));
    expect(tryAcquireProbeLock({ cacheDir: dir })).toBe(null);
    const release = tryAcquireProbeLock({ cacheDir: dir, now: Date.now() + 11 * 60 * 1000 });
    expect(release).toBeTypeOf('function');
    release();
  });
});

describe('buildProbeTexts', () => {
  it('is deterministic, distinct and has mixed chunk lengths', () => {
    const a = buildProbeTexts(16);
    expect(a).toEqual(buildProbeTexts(16));
    expect(new Set(a).size).toBe(16);
    const lengths = a.map((t) => t.length);
    expect(Math.min(...lengths)).toBeLessThan(800);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(3000);
  });
});

describe('acceleratorProvenanceProblem', () => {
  it('flags an index written by ORT only', () => {
    const m = { vectors: { encoders: { counts: { 'ort-q8/cpu': 10 } } }, lateInteraction: { encoders: { counts: { 'ort-q8/cpu': 10 } } } };
    expect(acceleratorProvenanceProblem(m)).toMatch(/ORT CPU only/);
  });

  it('passes accelerator, split-device and unrecorded indexes', () => {
    expect(acceleratorProvenanceProblem({ vectors: { encoders: { counts: { 'coreml+metal/bf16': 10 } } } })).toBe(null);
    expect(acceleratorProvenanceProblem({
      vectors: { encoders: { counts: { 'ort-q8/cpu': 10 } } },
      lateInteraction: { encoders: { counts: { 'metal/bf16': 10 } } },
    })).toBe(null);
    expect(acceleratorProvenanceProblem({})).toBe(null);
  });
});

describe('measureIndexDevices', () => {
  it('runs each device once when the result is clear', async () => {
    const runChild = vi.fn(async (device) => (device === 'cpu' ? 3000 : 1000));
    const r = await measureIndexDevices({}, { runChild });
    expect(r).toMatchObject({ cpuMs: 3000, acceleratorMs: 1000, runs: 1, stable: true });
    expect(runChild.mock.calls.map((c) => c[0])).toEqual(['cpu', 'accelerator']);
  });

  it('measures a close result again in the opposite order', async () => {
    const runChild = vi.fn(async (device) => (device === 'cpu' ? 1000 : 1300));
    const r = await measureIndexDevices({}, { runChild });
    expect(runChild.mock.calls.map((c) => c[0])).toEqual(['cpu', 'accelerator', 'accelerator', 'cpu']);
    expect(r).toMatchObject({ runs: 2, stable: true });
  });

  it('marks the result unstable when the two runs disagree', async () => {
    const times = { cpu: [1000, 1000], accelerator: [1300, 1100] };
    const runChild = vi.fn(async (device) => times[device].shift());
    const r = await measureIndexDevices({}, { runChild });
    expect(r.stable).toBe(false);
  });
});

describe('ensureIndexDeviceChoice', () => {
  let dir;
  const savedEnv = process.env.SWEET_SEARCH_INDEX_DEVICE;
  const savedLi = LATE_INTERACTION_CONFIG.model;
  const opts = (extra = {}) => ({ allowMeasure: true, cacheDir: dir, lockPollMs: 5, ...extra });
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'idx-device-'));
    delete process.env.SWEET_SEARCH_INDEX_DEVICE;
    _resetIndexDeviceChoice();
    detectHardwareCapability.mockReturnValue(M1);
    vi.clearAllMocks();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.SWEET_SEARCH_INDEX_DEVICE;
    else process.env.SWEET_SEARCH_INDEX_DEVICE = savedEnv;
    LATE_INTERACTION_CONFIG.model = savedLi;
    _resetIndexDeviceChoice();
  });

  it('measures, caches, and moves indexing to the CPU when the CPU clearly wins', async () => {
    const measure = vi.fn(async () => ({ cpuMs: 1000, acceleratorMs: 2000, runs: 1, stable: true }));
    const first = await ensureIndexDeviceChoice(opts({ measure }));
    expect(first).toMatchObject({ device: 'cpu', source: 'measured' });
    expect(isIndexAcceleratorAvailable()).toBe(false);
    expect(unloadNativeModels).toHaveBeenCalled(); // parent models unloaded before the children run

    _resetIndexDeviceChoice();
    const second = await ensureIndexDeviceChoice(opts({ measure }));
    expect(second).toMatchObject({ device: 'cpu', source: 'cached' });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(isIndexAcceleratorAvailable()).toBe(false);
  });

  it('keeps the accelerator when it is faster, or when the runs disagree', async () => {
    const fast = vi.fn(async () => ({ cpuMs: 1480, acceleratorMs: 1000, runs: 1, stable: true }));
    expect((await ensureIndexDeviceChoice(opts({ measure: fast }))).device).toBe('accelerator');
    expect(isIndexAcceleratorAvailable()).toBe(true);

    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(path.join(tmpdir(), 'idx-device-'));
    const unstable = vi.fn(async () => ({ cpuMs: 1000, acceleratorMs: 2000, runs: 2, stable: false }));
    const r = await ensureIndexDeviceChoice(opts({ measure: unstable }));
    expect(r).toMatchObject({ device: 'accelerator', stable: false });
    expect(Date.parse(r.expiresAt) - Date.now()).toBeLessThan(2 * 86400e3);
  });

  it('runs one test for overlapping callers in one process', async () => {
    let finish;
    const measure = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const a = ensureIndexDeviceChoice(opts({ measure }));
    const b = ensureIndexDeviceChoice(opts({ measure }));
    await vi.waitFor(() => expect(measure).toHaveBeenCalledTimes(1));
    finish({ cpuMs: 1000, acceleratorMs: 2000, runs: 1, stable: true });
    expect((await a).device).toBe('cpu');
    expect((await b).device).toBe('cpu');
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('does not test while another process holds the lock, and tests once it is free', async () => {
    writeFileSync(path.join(dir, INDEX_DEVICE_LOCK_FILE), JSON.stringify({ pid: process.ppid }));
    const measure = vi.fn(async () => ({ cpuMs: 3000, acceleratorMs: 1000, runs: 1, stable: true }));
    const pending = ensureIndexDeviceChoice(opts({ measure }));
    await new Promise((r) => setTimeout(r, 30));
    expect(measure).not.toHaveBeenCalled();
    rmSync(path.join(dir, INDEX_DEVICE_LOCK_FILE)); // the other process finishes
    const r = await pending;
    expect(r.source).toBe('measured');
    expect(measure).toHaveBeenCalledTimes(1);
    expect(existsSync(path.join(dir, INDEX_DEVICE_LOCK_FILE))).toBe(false);
  }, 10_000);

  it('keeps the accelerator for this run when the lock stays busy', async () => {
    writeFileSync(path.join(dir, INDEX_DEVICE_LOCK_FILE), JSON.stringify({ pid: process.ppid }));
    const measure = vi.fn();
    const r = await ensureIndexDeviceChoice(opts({ measure, lockWaitMs: 30 }));
    expect(r).toMatchObject({ device: 'accelerator', source: 'lock-busy' });
    expect(measure).not.toHaveBeenCalled();
    expect(isIndexAcceleratorAvailable()).toBe(true);
  });

  it('does not measure on a run that would not arm the accelerator', async () => {
    const measure = vi.fn();
    const r = await ensureIndexDeviceChoice(opts({ allowMeasure: false, measure }));
    expect(r).toMatchObject({ device: 'accelerator', source: 'default' });
    expect(measure).not.toHaveBeenCalled();
  });

  it('keeps the accelerator and caches nothing when the test throws', async () => {
    const measure = vi.fn(async () => { throw new Error('boom'); });
    const r = await ensureIndexDeviceChoice(opts({ measure }));
    expect(r).toMatchObject({ device: 'accelerator', source: 'measure-failed' });
    expect(isIndexAcceleratorAvailable()).toBe(true);
    const again = await ensureIndexDeviceChoice(opts({ allowMeasure: false, measure }));
    expect(again.source).toBe('default');
    expect(existsSync(path.join(dir, INDEX_DEVICE_LOCK_FILE))).toBe(false);
  });

  it('tests without late interaction when the LI model is disabled in config', async () => {
    LATE_INTERACTION_CONFIG.model = 'false';
    const measure = vi.fn(async () => ({ cpuMs: 3000, acceleratorMs: 1000, runs: 1, stable: true }));
    await ensureIndexDeviceChoice(opts({ includeLi: true, parallel: true, measure }));
    expect(measure.mock.calls[0][0]).toMatchObject({ includeLi: false, liModel: null, parallel: false });
  });

  it('measures again when the CoreML cascade state changes', async () => {
    detectHardwareCapability.mockReturnValue(M3);
    const measure = vi.fn(async () => ({ cpuMs: 3000, acceleratorMs: 1000, runs: 1, stable: true }));
    await ensureIndexDeviceChoice(opts({ measure }));
    getCoremlCascadeResolvedDirs.mockReturnValueOnce({ status: 'disabled-by-env' });
    _resetIndexDeviceChoice();
    const r = await ensureIndexDeviceChoice(opts({ measure }));
    expect(r.source).toBe('measured');
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it('obeys SWEET_SEARCH_INDEX_DEVICE without measuring', async () => {
    const measure = vi.fn();
    process.env.SWEET_SEARCH_INDEX_DEVICE = 'cpu';
    const r = await ensureIndexDeviceChoice(opts({ measure }));
    expect(r).toMatchObject({ device: 'cpu', source: 'env' });
    expect(isIndexAcceleratorAvailable()).toBe(false);
    expect(measure).not.toHaveBeenCalled();
  });

  it('reports cpu with no test on a host with no accelerator', async () => {
    detectHardwareCapability.mockReturnValue({ inferenceBackendPreference: 'ort-cpu' });
    const measure = vi.fn();
    const r = await ensureIndexDeviceChoice(opts({ measure }));
    expect(r).toMatchObject({ device: 'cpu', source: 'no-accelerator' });
    expect(measure).not.toHaveBeenCalled();
  });
});
