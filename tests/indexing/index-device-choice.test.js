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
  LOCK_HARD_STALE_MS,
  acceleratorProvenanceProblem,
  buildProbeTexts,
  indexDeviceRunShape,
  maintainerIndexerEnv,
  CPU_TTL_MS,
  decideIndexDevice,
  indexDeviceCacheKey,
  indexDeviceOverride,
  isCloseResult,
  isEntryFresh,
  readIndexDeviceChoice,
  splitDeviceSwitches,
  tryAcquireProbeLock,
  writeIndexDeviceChoice,
} from '../../core/indexing/index-device-choice.js';
import {
  ensureIndexDeviceChoice,
  isIndexAcceleratorAvailable,
  measureIndexDevices,
  runProbeChild,
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
  const machine = { cpuModel: 'Apple M3', cores: 8 };
  const key = (over = {}, env = {}, m = machine) => indexDeviceCacheKey({ hw: M3, setup: { ...setup, ...over }, env, version: '1.0.0', machine: m });

  it('changes with every value that changes the comparison', () => {
    const k = key();
    expect(indexDeviceCacheKey({ hw: M1, setup, env: {}, version: '1.0.0', machine })).not.toBe(k);
    expect(key({}, {}, { cpuModel: 'Apple M3', cores: 12 })).not.toBe(k);
    expect(key({}, {}, { cpuModel: 'AMD EPYC', cores: 8 })).not.toBe(k);
    const linux = (cpuModel) => indexDeviceCacheKey({
      hw: { nvidiaGpu: { name: 'H100' }, platform: 'linux', arch: 'x64' }, setup, env: {}, version: '1', machine: { cpuModel, cores: 32 },
    });
    expect(linux('Xeon')).not.toBe(linux('EPYC'));
    expect(key({ cpuLiPool: { workers: 2, threadsPerWorker: 4 } })).not.toBe(k);
    for (const over of [
      { cascadeStatus: 'disabled-by-env' }, { cascadeStatus: 'not-installed' }, { includeLi: false },
      { liModel: 'lateon-code-edge' }, { parallel: false }, { embeddingThreads: 4 }, { lateInteractionThreads: 4 },
      { liBatch: { batchSize: 16 } }, { backgroundProfile: true }, { embeddingModel: 'other' },
    ]) {
      expect(key(over)).not.toBe(k);
    }
    expect(key({ cpuPool: { workers: 3, threadsPerWorker: 2 } })).not.toBe(k);
    for (const env of [
      { SWEET_SEARCH_EMBED_ATTENTION_BUDGET: '1000' }, { SWEET_SEARCH_LI_MAX_DOC_LENGTH: '1024' },
      { SWEET_SEARCH_BATCHING_SAFETY: '1.3' }, { SWEET_SEARCH_EMBEDDING_WORKERS: '2' }, { SWEET_SEARCH_ORT_EXEC_MODE: 'parallel' },
    ]) {
      expect(key({}, env)).not.toBe(k);
    }
    expect(indexDeviceCacheKey({ hw: M3, setup, env: {}, version: '1.0.1', machine })).not.toBe(k);
  });

  it('ignores settings that do not touch the encoders', () => {
    expect(key({}, { SWEET_SEARCH_PROJECT_ROOT: '/x', SWEET_SEARCH_INDEX_DEVICE: 'cpu', HOME: '/h' })).toBe(key());
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

  const lockFile = () => path.join(dir, INDEX_DEVICE_LOCK_FILE);
  const holder = () => JSON.parse(readFileSync(lockFile(), 'utf8'));
  const DEAD = 2 ** 30;

  it('gives the lock to one holder at a time and takes over a dead holder', () => {
    const lock = tryAcquireProbeLock({ cacheDir: dir });
    expect(lock.status).toBe('acquired');
    expect(tryAcquireProbeLock({ cacheDir: dir }).status).toBe('busy');
    lock.release();
    expect(existsSync(lockFile())).toBe(false);

    writeFileSync(lockFile(), JSON.stringify({ pid: DEAD, nonce: 'x' }));
    const again = tryAcquireProbeLock({ cacheDir: dir });
    expect(again.status).toBe('acquired');
    expect(holder().pid).toBe(process.pid);
    expect(existsSync(`${lockFile()}.takeover`)).toBe(false);
    again.release();
  });

  it('never takes over a live holder before the hard limit, nor one whose test child lives', () => {
    writeFileSync(lockFile(), JSON.stringify({ pid: process.ppid, nonce: 'x' }));
    expect(tryAcquireProbeLock({ cacheDir: dir, now: Date.now() + 30 * 60 * 1000 }).status).toBe('busy');
    expect(tryAcquireProbeLock({ cacheDir: dir, now: Date.now() + LOCK_HARD_STALE_MS + 1000 }).status).toBe('acquired');

    writeFileSync(lockFile(), JSON.stringify({ pid: DEAD, childPid: process.ppid, nonce: 'y' }));
    expect(tryAcquireProbeLock({ cacheDir: dir }).status).toBe('busy');
  });

  it('treats a live pid with a different start time as a reused pid (stale)', () => {
    writeFileSync(lockFile(), JSON.stringify({ pid: process.ppid, startedAt: 1_000_000, nonce: 'x' }));
    expect(tryAcquireProbeLock({ cacheDir: dir }).status).toBe('acquired');
  });

  it('records the test child and releases only its own lock', () => {
    const lock = tryAcquireProbeLock({ cacheDir: dir });
    lock.setChildPid(4242);
    expect(holder()).toMatchObject({ pid: process.pid, childPid: 4242 });
    writeFileSync(lockFile(), JSON.stringify({ pid: process.ppid, nonce: 'someone-else' }));
    lock.release();
    expect(holder().nonce).toBe('someone-else');
  });

  it('leaves a takeover in progress to its owner', () => {
    writeFileSync(lockFile(), JSON.stringify({ pid: DEAD, nonce: 'x' }));
    writeFileSync(`${lockFile()}.takeover`, 'm1');
    expect(tryAcquireProbeLock({ cacheDir: dir }).status).toBe('busy');
    expect(holder().nonce).toBe('x');
    // A takeover file left by a killed process is cleared after a short time.
    expect(tryAcquireProbeLock({ cacheDir: dir, now: Date.now() + 60_000 }).status).toBe('busy');
    expect(existsSync(`${lockFile()}.takeover`)).toBe(false);
    expect(tryAcquireProbeLock({ cacheDir: dir }).status).toBe('acquired');
  });

  it('never clears a recent takeover file', () => {
    writeFileSync(lockFile(), JSON.stringify({ pid: DEAD, nonce: 'x' }));
    writeFileSync(`${lockFile()}.takeover`, 'm3');
    expect(tryAcquireProbeLock({ cacheDir: dir }).status).toBe('busy');
    expect(readFileSync(`${lockFile()}.takeover`, 'utf8')).toBe('m3');
  });

  it('reports a cache directory that cannot be written as unavailable, not busy', () => {
    const file = path.join(dir, 'not-a-dir');
    writeFileSync(file, '');
    expect(tryAcquireProbeLock({ cacheDir: path.join(file, 'sub') }).status).toBe('unavailable');
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
  // The labels each production encoder records (inference-provenance.js).
  const m = (dense, li) => ({ vectors: { encoders: { counts: dense } }, lateInteraction: { encoders: { counts: li } } });

  it('flags a tier written by CPU encoders only', () => {
    expect(acceleratorProvenanceProblem(m({ 'ort-q8/cpu': 10 }, { 'ort/cpu': 10 }))).toMatch(/dense.*late interaction.*CPU encoders only/);
    expect(acceleratorProvenanceProblem(m({ 'metal/bf16': 10 }, { 'ort/cpu': 10 }))).toMatch(/^late interaction/);
    expect(acceleratorProvenanceProblem(m({ 'model-server': 10 }, { 'cuda/bf16': 10 }))).toMatch(/^dense/);
    expect(acceleratorProvenanceProblem(m({ 'cpu/f32': 10 }, { 'coreml+metal/bf16': 10 }))).toMatch(/^dense/);
  });

  it('passes accelerator tiers, unknown labels and unrecorded indexes', () => {
    expect(acceleratorProvenanceProblem(m({ 'coreml+metal/bf16': 10 }, { 'metal/bf16': 10 }))).toBe(null);
    expect(acceleratorProvenanceProblem(m({ 'cuda/f32': 10, 'ort-q8/cpu': 2 }, { 'cuda/bf16': 10 }))).toBe(null);
    expect(acceleratorProvenanceProblem(m({ unknown: 10 }, {}))).toBe(null);
    expect(acceleratorProvenanceProblem({})).toBe(null);
  });
});

describe('measureIndexDevices', () => {
  it('runs each device once when the result is clear', async () => {
    const runChild = vi.fn(async (device) => (device === 'cpu' ? 3000 : 1000));
    const onSpawn = vi.fn();
    const r = await measureIndexDevices({}, { runChild, onSpawn });
    expect(r).toMatchObject({ cpuMs: 3000, acceleratorMs: 1000, runs: 1, stable: true });
    expect(runChild.mock.calls[0][2]).toEqual({ onSpawn });
    expect(runChild.mock.calls.map((c) => c[0])).toEqual(['cpu', 'accelerator']);
  });

  it('always measures a CPU win a second time, in the opposite order', async () => {
    const runChild = vi.fn(async (device) => (device === 'cpu' ? 1000 : 5000));
    const r = await measureIndexDevices({}, { runChild });
    expect(runChild.mock.calls.map((c) => c[0])).toEqual(['cpu', 'accelerator', 'accelerator', 'cpu']);
    expect(r).toMatchObject({ runs: 2, stable: true });
  });

  it('marks a one-off CPU win (accelerator slowed by other GPU work) unstable', async () => {
    const times = { cpu: [1000, 1000], accelerator: [5000, 600] };
    const runChild = vi.fn(async (device) => times[device].shift());
    expect((await measureIndexDevices({}, { runChild })).stable).toBe(false);
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

  it('keeps the accelerator when the test throws, and does not retry it for a day', async () => {
    const measure = vi.fn(async () => { throw new Error('boom'); });
    const r = await ensureIndexDeviceChoice(opts({ measure }));
    expect(r).toMatchObject({ device: 'accelerator', source: 'measure-failed' });
    expect(isIndexAcceleratorAvailable()).toBe(true);
    const again = await ensureIndexDeviceChoice(opts({ measure }));
    expect(again).toMatchObject({ device: 'accelerator', source: 'cached-failure', error: 'boom' });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(Date.parse(again.expiresAt) - Date.now()).toBeLessThan(2 * 86400e3);
    expect(isIndexAcceleratorAvailable()).toBe(true);
    expect(existsSync(path.join(dir, INDEX_DEVICE_LOCK_FILE))).toBe(false);
  });

  it('keeps a CPU result for 7 days, not 30', async () => {
    const measure = vi.fn(async () => ({ cpuMs: 1000, acceleratorMs: 2000, runs: 2, stable: true }));
    const r = await ensureIndexDeviceChoice(opts({ measure }));
    expect(r.device).toBe('cpu');
    expect(Math.abs(Date.parse(r.expiresAt) - Date.now() - CPU_TTL_MS)).toBeLessThan(60_000);
  });

  it('removes its exit and signal handlers after the test', async () => {
    const before = ['exit', 'SIGINT', 'SIGTERM'].map((e) => process.listenerCount(e));
    let during;
    const measure = vi.fn(async () => {
      during = process.listenerCount('SIGINT');
      return { cpuMs: 3000, acceleratorMs: 1000, runs: 1, stable: true };
    });
    await ensureIndexDeviceChoice(opts({ measure }));
    expect(during).toBe(before[1] + 1);
    expect(['exit', 'SIGINT', 'SIGTERM'].map((e) => process.listenerCount(e))).toEqual(before);
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

  it('skips the test with a split-device switch set', async () => {
    expect(splitDeviceSwitches({ SWEET_SEARCH_EMBED_USE_CPU: '1', SWEET_SEARCH_LI_USE_CPU: '0' })).toEqual(['SWEET_SEARCH_EMBED_USE_CPU']);
    for (const v of ['1', 'true', 'ON', ' on ']) {
      expect(splitDeviceSwitches({ SWEET_SEARCH_EMBED_HYBRID: v })).toEqual(['SWEET_SEARCH_EMBED_HYBRID']);
    }
    expect(splitDeviceSwitches({ SWEET_SEARCH_EMBED_HYBRID: '0' })).toEqual([]);
    const measure = vi.fn();
    process.env.SWEET_SEARCH_LI_USE_CPU = '1';
    try {
      const r = await ensureIndexDeviceChoice(opts({ measure }));
      expect(r).toMatchObject({ device: 'accelerator', source: 'split-device' });
    } finally {
      delete process.env.SWEET_SEARCH_LI_USE_CPU;
    }
    expect(measure).not.toHaveBeenCalled();
  });

  it('keeps the accelerator at once when the cache directory cannot be written', async () => {
    const file = path.join(dir, 'not-a-dir');
    writeFileSync(file, '');
    const measure = vi.fn();
    const t0 = Date.now();
    const r = await ensureIndexDeviceChoice(opts({ measure, cacheDir: path.join(file, 'sub'), lockWaitMs: 60_000 }));
    expect(r).toMatchObject({ device: 'accelerator', source: 'cache-unwritable' });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(measure).not.toHaveBeenCalled();
  });

  it('records each test child in the lock', async () => {
    const measure = vi.fn(async (setup, { onSpawn }) => {
      onSpawn(4242);
      expect(JSON.parse(readFileSync(path.join(dir, INDEX_DEVICE_LOCK_FILE), 'utf8')).childPid).toBe(4242);
      return { cpuMs: 3000, acceleratorMs: 1000, runs: 1, stable: true };
    });
    expect((await ensureIndexDeviceChoice(opts({ measure }))).source).toBe('measured');
  });

  it('passes the CPU worker pool plan to the test and keys on it', async () => {
    const measure = vi.fn(async () => ({ cpuMs: 3000, acceleratorMs: 1000, runs: 1, stable: true }));
    await ensureIndexDeviceChoice(opts({ measure, cpuPool: { workers: 3, threadsPerWorker: 2 } }));
    expect(measure.mock.calls[0][0].cpuPool).toEqual({ workers: 3, threadsPerWorker: 2 });
    _resetIndexDeviceChoice();
    expect((await ensureIndexDeviceChoice(opts({ measure, cpuPool: null }))).source).toBe('measured');
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

describe('benchIndexDevice (eval/lib/bench-index-device.mjs)', () => {
  it('always pins benchmark indexes to the accelerator and refuses any other setting', async () => {
    const { benchIndexDevice } = await import('../../eval/lib/bench-index-device.mjs');
    expect(benchIndexDevice({})).toBe('accelerator');
    expect(benchIndexDevice({ SWEET_SEARCH_INDEX_DEVICE: 'metal' })).toBe('accelerator');
    expect(() => benchIndexDevice({ SWEET_SEARCH_INDEX_DEVICE: 'cpu' })).toThrow(/not allowed/);
    expect(() => benchIndexDevice({ SWEET_SEARCH_INDEX_DEVICE: 'auto' })).toThrow(/not allowed/);
  });
});

describe('indexDeviceRunShape + maintainerIndexerEnv', () => {
  const plan = { useWorkerPool: true, embeddingWorkers: 3, threadsPerEmbeddingWorker: 2 };

  it('overlaps the models only on the in-memory path', () => {
    expect(indexDeviceRunShape({ shouldParallelLI: true, useStreaming: false, resourcePlan: plan }).parallel).toBe(true);
    expect(indexDeviceRunShape({ shouldParallelLI: true, useStreaming: true, resourcePlan: plan }).parallel).toBe(false);
    expect(indexDeviceRunShape({ shouldParallelLI: false, useStreaming: false, resourcePlan: plan }).parallel).toBe(false);
  });

  it('uses the CPU worker pools only when the models do not run in parallel', () => {
    const serial = indexDeviceRunShape({
      shouldParallelLI: false, useStreaming: false, resourcePlan: plan, lateInteractionWorkers: 2, lateInteractionWorkerThreads: 4,
    });
    expect(serial.cpuPool).toEqual({ workers: 3, threadsPerWorker: 2 });
    expect(serial.cpuLiPool).toEqual({ workers: 2, threadsPerWorker: 4 });
    const par = indexDeviceRunShape({
      shouldParallelLI: true, useStreaming: false, resourcePlan: plan, lateInteractionWorkers: 1, lateInteractionWorkerThreads: 4,
    });
    expect(par.cpuPool).toBe(null);
    expect(par.cpuLiPool).toBe(null);
    expect(indexDeviceRunShape({ shouldParallelLI: false, resourcePlan: { ...plan, useWorkerPool: false } }).cpuPool).toBe(null);
  });

  it('forces ORT CPU for maintainer-started indexers, whatever the environment says', () => {
    expect(maintainerIndexerEnv({ SWEET_SEARCH_INDEX_DEVICE: 'accelerator', X: '1' })).toEqual({ SWEET_SEARCH_INDEX_DEVICE: 'cpu', X: '1' });
  });
});

describe('runProbeChild (fake child scripts)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'idx-child-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const script = (name, body) => {
    const p = path.join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  it('parses the result line and records the child pid', async () => {
    const childPath = script('ok.mjs', 'process.stdout.write("noise\\nINDEX_DEVICE_PROBE {\\"ms\\":123}\\n");');
    const onSpawn = vi.fn();
    const before = process.listenerCount('exit');
    expect(await runProbeChild('cpu', {}, { childPath, onSpawn })).toBe(123);
    expect(onSpawn).toHaveBeenCalledWith(expect.any(Number));
    expect(process.listenerCount('exit')).toBe(before);
  });

  it('rejects a non-zero exit with the end of stderr', async () => {
    const childPath = script('fail.mjs', 'process.stderr.write("bad thing\\n"); process.exit(2);');
    await expect(runProbeChild('cpu', {}, { childPath })).rejects.toThrow(/exited 2: bad thing/);
  });

  it('kills a child that runs past the time limit', async () => {
    const childPath = script('hang.mjs', 'setInterval(() => {}, 1000);');
    const before = process.listenerCount('exit');
    await expect(runProbeChild('cpu', {}, { childPath, timeoutMs: 300 })).rejects.toThrow(/killed \(SIGKILL\)/);
    expect(process.listenerCount('exit')).toBe(before);
  });

  it('a child with the orphan guard exits when its stdin closes, and at its deadline', async () => {
    const guard = new URL('../../core/indexing/index-device-choice.js', import.meta.url).href;
    const hang = script('guard.mjs', [
      `import { exitWhenOrphaned } from '${guard}';`,
      'const { deadlineMs } = JSON.parse(process.argv[2]);',
      'exitWhenOrphaned(deadlineMs);',
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [hang, JSON.stringify({ deadlineMs: 0 })], { stdio: ['pipe', 'ignore', 'ignore'] });
    await new Promise((r) => setTimeout(r, 500));
    child.stdin.end();
    const code = await new Promise((r) => child.on('close', r));
    expect(code).toBe(3);
    const timed = spawn(process.execPath, [hang, JSON.stringify({ deadlineMs: 300 })], { stdio: ['pipe', 'ignore', 'ignore'] });
    expect(await new Promise((r) => timed.on('close', r))).toBe(4); // stdin still open: the deadline ends it
  }, 15_000);
});
