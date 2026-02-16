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
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(false);
    expect(result.useColBERT).toBe(false);
    expect(result.sqliteFast).toBe(true);
    expect(result.indexMode).toBe('single');
  });

  it('balanced profile defaults to sqlite fast', () => {
    const result = resolveProfile({
      profile: 'balanced',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(false);
    expect(result.useColBERT).toBe(false);
    expect(result.sqliteFast).toBe(true);
    expect(result.indexMode).toBe('single');
  });

  it('full profile defaults to sqlite fast', () => {
    const result = resolveProfile({
      profile: 'full',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(true);
    expect(result.useColBERT).toBe(true);
    expect(result.sqliteFast).toBe(true);
    expect(result.indexMode).toBe('single');
  });

  it('CLI override takes precedence over profile defaults', () => {
    const result = resolveProfile({
      profile: 'fast',
      buildColBERT: true,
      useColBERT: true,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: 'two-phase',
      requireNativeAnn: true,
    });

    expect(result.buildColBERT).toBe(true);
    expect(result.useColBERT).toBe(true);
    expect(result.indexMode).toBe('two-phase');
    expect(result.requireNativeAnn).toBe(true);
  });

  it('unknown profile falls back to balanced', () => {
    const result = resolveProfile({
      profile: 'nonexistent',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(false);
    expect(result.useColBERT).toBe(false);
    expect(result.sqliteFast).toBe(true);
    expect(result.indexMode).toBe('single');
  });

  it('null CLI values use profile defaults via nullish coalescing', () => {
    const result = resolveProfile({
      profile: 'full',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(true);
    expect(result.useColBERT).toBe(true);
  });

  it('false CLI values override profile defaults (buildColBERT/useColBERT)', () => {
    const result = resolveProfile({
      profile: 'full',
      buildColBERT: false,
      useColBERT: false,
      sqliteFast: false,
      sqliteSafe: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(false);
    expect(result.useColBERT).toBe(false);
  });

  it('sqliteSafe disables sqliteFast even when profile wants it', () => {
    const result = resolveProfile({
      profile: 'fast',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: true,
      sqliteSafe: true,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.sqliteFast).toBe(false);
  });
});
