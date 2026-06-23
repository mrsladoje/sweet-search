// G3 — ORT background/maintainer profile.
//
// Verifies buildLocalSessionOptions emits the background-profile session
// options (force_spinning_stop + arena-off + clamped 2–4 intra-op threads) ONLY
// when the bg profile is active, and that the foreground/full-index path stays
// byte-identical to the historical default. The bg profile must be a strict
// no-op when the SWEET_SEARCH_ORT_BACKGROUND gate is off and no background flag
// is configured.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import os from 'os';
import {
  buildLocalSessionOptions,
  configureLocalModelRuntime,
  resetLocalModelRuntime,
  isBackgroundOrtProfile,
} from '../../core/embedding/embedding-local-model.js';
import { backgroundIntraOpThreads } from '../../core/infrastructure/onnx-session-utils.js';

function clearEnv() {
  delete process.env.SWEET_SEARCH_ORT_BACKGROUND;
  delete process.env.SWEET_SEARCH_INTRA_OP_THREADS;
  delete process.env.SWEET_SEARCH_ORT_EXEC_MODE;
  delete process.env.SWEET_SEARCH_ORT_INTER_OP_THREADS;
}

describe('backgroundIntraOpThreads', () => {
  afterEach(() => {
    delete process.env.SWEET_SEARCH_INTRA_OP_THREADS;
  });

  it('clamps to the 2–4 range on a wide box', () => {
    const n = backgroundIntraOpThreads({ logicalCores: 64 });
    expect(n).toBe(4);
  });

  it('floors at 2 by default (on a box with >=2 cores)', () => {
    const n = backgroundIntraOpThreads({ logicalCores: 8 });
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(4);
  });

  it('never requests more threads than exist on a tiny box', () => {
    expect(backgroundIntraOpThreads({ logicalCores: 1 })).toBe(1);
    expect(backgroundIntraOpThreads({ logicalCores: 2 })).toBe(2);
  });

  it('honours the SWEET_SEARCH_INTRA_OP_THREADS override but still clamps to 2–4', () => {
    process.env.SWEET_SEARCH_INTRA_OP_THREADS = '3';
    expect(backgroundIntraOpThreads({ logicalCores: 32 })).toBe(3);

    process.env.SWEET_SEARCH_INTRA_OP_THREADS = '16';
    expect(backgroundIntraOpThreads({ logicalCores: 32 })).toBe(4);

    process.env.SWEET_SEARCH_INTRA_OP_THREADS = '1';
    // clamped up to the floor of 2 (box is wide enough)
    expect(backgroundIntraOpThreads({ logicalCores: 32 })).toBe(2);
  });
});

describe('isBackgroundOrtProfile', () => {
  beforeEach(() => {
    clearEnv();
    resetLocalModelRuntime();
  });
  afterEach(() => {
    clearEnv();
    resetLocalModelRuntime();
  });

  it('is OFF by default (no flag, no env)', () => {
    expect(isBackgroundOrtProfile()).toBe(false);
  });

  it('turns ON via SWEET_SEARCH_ORT_BACKGROUND=1', () => {
    process.env.SWEET_SEARCH_ORT_BACKGROUND = '1';
    expect(isBackgroundOrtProfile()).toBe(true);
  });

  it('turns ON via configureLocalModelRuntime({ background: true })', () => {
    configureLocalModelRuntime({ background: true });
    expect(isBackgroundOrtProfile()).toBe(true);
  });

  it('turns ON via per-call runtimeConfig.background', () => {
    expect(isBackgroundOrtProfile({ background: true })).toBe(true);
  });

  it('explicit background:false wins over the env gate', () => {
    process.env.SWEET_SEARCH_ORT_BACKGROUND = '1';
    expect(isBackgroundOrtProfile({ background: false })).toBe(false);
    configureLocalModelRuntime({ background: false });
    expect(isBackgroundOrtProfile()).toBe(false);
  });
});

describe('buildLocalSessionOptions — foreground path (default, strict no-op)', () => {
  beforeEach(() => {
    clearEnv();
    resetLocalModelRuntime();
  });
  afterEach(() => {
    clearEnv();
    resetLocalModelRuntime();
  });

  it('emits the historical allow_spinning extra and arena ON', () => {
    const opts = buildLocalSessionOptions('q8', false);
    expect(opts.extra).toEqual({
      session: { intra_op: { allow_spinning: '1' } },
    });
    expect(opts.enableCpuMemArena).toBe(true);
    expect(opts.enableMemPattern).toBe(true);
    // no force_spinning_stop on the foreground path
    expect(opts.extra.session.force_spinning_stop).toBeUndefined();
  });

  it('scales intra-op threads with the hardware (not clamped to 2–4)', () => {
    const opts = buildLocalSessionOptions('q8', false);
    expect(opts.intraOpNumThreads).toBeGreaterThan(0);
    expect(opts.intraOpNumThreads).toBeLessThanOrEqual(os.cpus().length);
  });
});

describe('buildLocalSessionOptions — background path', () => {
  beforeEach(() => {
    clearEnv();
    resetLocalModelRuntime();
  });
  afterEach(() => {
    clearEnv();
    resetLocalModelRuntime();
  });

  function expectBackgroundShape(opts) {
    // force_spinning_stop set, allow_spinning dropped
    expect(opts.extra).toEqual({
      session: { force_spinning_stop: '1' },
    });
    expect(opts.extra.session.intra_op).toBeUndefined();
    // arena OFF
    expect(opts.enableCpuMemArena).toBe(false);
    // intra-op threads clamped into 2–4 (or floored to logical cores on tiny box)
    const upper = Math.min(4, os.cpus().length);
    const lower = Math.min(2, upper);
    expect(opts.intraOpNumThreads).toBeGreaterThanOrEqual(lower);
    expect(opts.intraOpNumThreads).toBeLessThanOrEqual(upper);
    // unaffected fields preserved
    expect(opts.enableMemPattern).toBe(true);
    expect(opts.graphOptimizationLevel).toBe('all');
  }

  it('emits force_spinning_stop + arena-off via the env gate', () => {
    process.env.SWEET_SEARCH_ORT_BACKGROUND = '1';
    expectBackgroundShape(buildLocalSessionOptions('q8', false));
  });

  it('emits force_spinning_stop + arena-off via configureLocalModelRuntime', () => {
    configureLocalModelRuntime({ background: true });
    expectBackgroundShape(buildLocalSessionOptions('q8', false));
  });

  it('emits force_spinning_stop + arena-off via per-call runtimeConfig', () => {
    expectBackgroundShape(buildLocalSessionOptions('q8', false, { background: true }));
  });

  it('an explicit intraOpThreads override still wins on the bg path', () => {
    const opts = buildLocalSessionOptions('q8', false, { background: true, intraOpThreads: 7 });
    expect(opts.intraOpNumThreads).toBe(7);
    expect(opts.enableCpuMemArena).toBe(false);
    expect(opts.extra).toEqual({ session: { force_spinning_stop: '1' } });
  });
});

describe('foreground vs background snapshot divergence', () => {
  beforeEach(() => {
    clearEnv();
    resetLocalModelRuntime();
  });
  afterEach(() => {
    clearEnv();
    resetLocalModelRuntime();
  });

  it('the two profiles differ exactly in extra + arena (everything else identical)', () => {
    const fg = buildLocalSessionOptions('q8', false);
    const bg = buildLocalSessionOptions('q8', false, { background: true });

    // identical everywhere the profile must not change
    expect(bg.graphOptimizationLevel).toBe(fg.graphOptimizationLevel);
    expect(bg.logSeverityLevel).toBe(fg.logSeverityLevel);
    expect(bg.interOpNumThreads).toBe(fg.interOpNumThreads);
    expect(bg.executionMode).toBe(fg.executionMode);
    expect(bg.enableMemPattern).toBe(fg.enableMemPattern);
    expect(bg.optimizedModelFilePath).toBe(fg.optimizedModelFilePath);

    // diverge exactly here
    expect(fg.enableCpuMemArena).toBe(true);
    expect(bg.enableCpuMemArena).toBe(false);
    expect(fg.extra).toEqual({ session: { intra_op: { allow_spinning: '1' } } });
    expect(bg.extra).toEqual({ session: { force_spinning_stop: '1' } });
  });
});
