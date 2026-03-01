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

  it('unknown profile falls back to balanced', () => {
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

    expect(result.buildLateInteraction).toBe(false);
    expect(result.useLateInteraction).toBe(false);
    expect(result.lateInteractionModel).toBeNull();
    expect(result.sqliteFast).toBe(true);
    expect(result.indexMode).toBe('single');
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
