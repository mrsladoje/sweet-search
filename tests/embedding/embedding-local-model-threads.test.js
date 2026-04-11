import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import { bestIntraOpThreads, shouldUseOpenVino } from '../../core/embedding/index.js';
import { estimateComputeCores } from '../../core/infrastructure/index.js';

function mockCpus(count, model = 'Mock CPU') {
  return Array.from({ length: count }, () => ({
    model,
    speed: 3000,
    times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
  }));
}

describe('bestIntraOpThreads', () => {
  afterEach(() => {
    delete process.env.SWEET_SEARCH_INTRA_OP_THREADS;
    delete process.env.SWEET_SEARCH_USE_OPENVINO;
    vi.restoreAllMocks();
  });

  it('keeps single-thread mode on tiny machines', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(2));
    expect(bestIntraOpThreads({ arch: 'x64', pCores: null })).toBe(1);
  });

  it('uses at least 2 threads on 4+ logical x64 CPUs', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4));
    expect(bestIntraOpThreads({ arch: 'x64', pCores: null })).toBe(2);
  });

  it('preserves scaling on larger x64 machines (no artificial cap)', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(8));
    // x64: 8 logical → 4 compute, reserveCores=1, requested=3
    expect(bestIntraOpThreads({ arch: 'x64', pCores: null })).toBe(3);

    // 64 logical → 32 compute (SMT), reserveCores=2, requested=30
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(64));
    expect(bestIntraOpThreads({ arch: 'x64', pCores: null })).toBe(30);
  });

  it('supports intra-op override via env and clamps to available CPUs', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4));
    process.env.SWEET_SEARCH_INTRA_OP_THREADS = '3';
    expect(bestIntraOpThreads({ arch: 'x64', pCores: null })).toBe(3);

    process.env.SWEET_SEARCH_INTRA_OP_THREADS = '16';
    expect(bestIntraOpThreads({ arch: 'x64', pCores: null })).toBe(4);
  });

  it('keeps ARM logical cores as compute cores', () => {
    expect(estimateComputeCores({ logicalCores: 10, arch: 'arm64' })).toBe(10);
    expect(estimateComputeCores({ logicalCores: 8, arch: 'x64' })).toBe(4);
  });

  it('lets callers budget threads per phase explicitly', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(16));
    expect(bestIntraOpThreads({ arch: 'arm64', computeCores: 16, targetThreads: 5, reserveCores: 0, pCores: null })).toBe(5);
    // No artificial cap: 16 compute - 1 reserve = 15
    expect(bestIntraOpThreads({ arch: 'arm64', computeCores: 16, reserveCores: 1, pCores: null })).toBe(15);
    // With pCores: uses P-core count instead of computeCores
    expect(bestIntraOpThreads({ arch: 'arm64', computeCores: 16, reserveCores: 1, pCores: 12 })).toBe(11);
  });

  it('auto-enables OpenVINO on Intel when provider is available', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4, '13th Gen Intel(R) Core(TM) i7-1355U'));
    expect(shouldUseOpenVino(true)).toBe(true);

    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4, 'AMD Ryzen 7'));
    expect(shouldUseOpenVino(true)).toBe(false);
  });

  it('allows explicit OpenVINO opt-out even on Intel', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4, '13th Gen Intel(R) Core(TM) i7-1355U'));
    process.env.SWEET_SEARCH_USE_OPENVINO = '0';
    expect(shouldUseOpenVino(true)).toBe(false);
  });

  it('gates explicit OpenVINO opt-in to Intel CPUs only', () => {
    process.env.SWEET_SEARCH_USE_OPENVINO = '1';

    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4, '13th Gen Intel(R) Core(TM) i7-1355U'));
    expect(shouldUseOpenVino(true)).toBe(true);

    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4, 'AMD Ryzen 7'));
    expect(shouldUseOpenVino(true)).toBe(false);
  });

  it('keeps OpenVINO disabled when provider runtime is missing', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4, '13th Gen Intel(R) Core(TM) i7-1355U'));
    expect(shouldUseOpenVino(false)).toBe(false);

    process.env.SWEET_SEARCH_USE_OPENVINO = '1';
    expect(shouldUseOpenVino(false)).toBe(false);
  });
});
