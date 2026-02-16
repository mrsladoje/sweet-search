import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import { bestIntraOpThreads, shouldUseOpenVino } from '../core/embedding-local-model.js';

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
    expect(bestIntraOpThreads()).toBe(1);
  });

  it('uses at least 2 threads on 4+ logical CPUs', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4));
    expect(bestIntraOpThreads()).toBe(2);
  });

  it('preserves scaling and upper cap on larger machines', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(8));
    expect(bestIntraOpThreads()).toBe(3);

    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(64));
    expect(bestIntraOpThreads()).toBe(8);
  });

  it('supports intra-op override via env and clamps to available CPUs', () => {
    vi.spyOn(os, 'cpus').mockReturnValue(mockCpus(4));
    process.env.SWEET_SEARCH_INTRA_OP_THREADS = '3';
    expect(bestIntraOpThreads()).toBe(3);

    process.env.SWEET_SEARCH_INTRA_OP_THREADS = '16';
    expect(bestIntraOpThreads()).toBe(4);
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
