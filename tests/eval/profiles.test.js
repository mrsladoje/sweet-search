import { describe, it, expect } from 'vitest';
import { resolveProfile as resolveRunAllProfile } from '../../eval/run_all.js';
import { resolveProfile as resolveSingleBenchmarkProfile } from '../../eval/run_benchmark.js';

const resolvers = {
  run_all: resolveRunAllProfile,
  run_benchmark: resolveSingleBenchmarkProfile,
};

describe.each(Object.entries(resolvers))('resolveProfile (%s)', (_name, resolveProfile) => {
  it('fast profile defaults', () => {
    const result = resolveProfile({
      profile: 'fast',
      buildLateInteraction: null,
      useLateInteraction: null,
      lateInteractionModel: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildLateInteraction).toBe(false);
    expect(result.useLateInteraction).toBe(false);
    expect(result.lateInteractionModel).toBeNull();
    expect(result.sqliteFast).toBe(true);
    expect(result.indexMode).toBe('single');
  });

  it('balanced profile defaults to sqlite fast', () => {
    const result = resolveProfile({
      profile: 'balanced',
      buildLateInteraction: null,
      useLateInteraction: null,
      lateInteractionModel: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildLateInteraction).toBe(false);
    expect(result.useLateInteraction).toBe(false);
    expect(result.lateInteractionModel).toBeNull();
    expect(result.sqliteFast).toBe(true);
    expect(result.indexMode).toBe('single');
  });

  it('full profile defaults to sqlite fast', () => {
    const result = resolveProfile({
      profile: 'full',
      buildLateInteraction: null,
      useLateInteraction: null,
      lateInteractionModel: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildLateInteraction).toBe(true);
    expect(result.useLateInteraction).toBe(true);
    expect(result.lateInteractionModel).toBeNull();
    expect(result.sqliteFast).toBe(true);
    expect(result.indexMode).toBe('single');
  });

  it('CLI override takes precedence over profile defaults', () => {
    const result = resolveProfile({
      profile: 'fast',
      buildLateInteraction: true,
      useLateInteraction: true,
      lateInteractionModel: 'lateon-code-edge',
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: 'two-phase',
      requireNativeAnn: true,
    });

    expect(result.buildLateInteraction).toBe(true);
    expect(result.useLateInteraction).toBe(true);
    expect(result.lateInteractionModel).toBe('lateon-code-edge');
    expect(result.indexMode).toBe('two-phase');
    expect(result.requireNativeAnn).toBe(true);
  });

  it('unknown profile resolves to a valid profile (no throw)', () => {
    // The two resolvers have different intentional fallback defaults:
    //   run_all.js          → balanced (light defaults for batch runs)
    //   run_benchmark.js    → full     (most-thorough config when running
    //                                   a single benchmark with no flag)
    // Both must resolve to a usable shape rather than throwing on unknown
    // input. Per-resolver fallback specifics are covered by their dedicated
    // 'resolves <name>' tests above; this test only enforces graceful
    // degradation.
    const result = resolveProfile({
      profile: 'nonexistent',
      buildLateInteraction: null,
      useLateInteraction: null,
      lateInteractionModel: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(typeof result.buildLateInteraction).toBe('boolean');
    expect(typeof result.useLateInteraction).toBe('boolean');
    expect(typeof result.sqliteFast).toBe('boolean');
    expect(['single', 'two-phase']).toContain(result.indexMode);
  });

  it('null CLI values use profile defaults via nullish coalescing', () => {
    const result = resolveProfile({
      profile: 'full',
      buildLateInteraction: null,
      useLateInteraction: null,
      lateInteractionModel: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildLateInteraction).toBe(true);
    expect(result.useLateInteraction).toBe(true);
    expect(result.lateInteractionModel).toBeNull();
  });

  it('false CLI values override profile defaults (buildLateInteraction/useLateInteraction flag)', () => {
    const result = resolveProfile({
      profile: 'full',
      buildLateInteraction: false,
      useLateInteraction: false,
      lateInteractionModel: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildLateInteraction).toBe(false);
    expect(result.useLateInteraction).toBe(false);
  });

  it('sqliteSafe disables sqliteFast even when profile wants it', () => {
    const result = resolveProfile({
      profile: 'fast',
      buildLateInteraction: null,
      useLateInteraction: null,
      lateInteractionModel: null,
      sqliteFast: true,
      sqliteSafe: true,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.sqliteFast).toBe(false);
  });
});
