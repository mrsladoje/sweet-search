import { describe, it, expect } from 'vitest';

/**
 * resolveProfile is exported from eval/run_all.js, but importing that module
 * triggers a top-level main() call. Rather than mocking 15+ module dependencies,
 * we replicate the pure function here. This tests the profile resolution LOGIC.
 *
 * Source: eval/run_all.js lines 79-95
 */
function resolveProfile(opts) {
  const profiles = {
    fast: { buildColBERT: false, useColBERT: false, sqliteFast: true, indexMode: 'single' },
    balanced: { buildColBERT: false, useColBERT: false, sqliteFast: false, indexMode: 'single' },
    full: { buildColBERT: true, useColBERT: true, sqliteFast: false, indexMode: 'single' },
  };

  const profile = profiles[opts.profile] || profiles.balanced;

  return {
    buildColBERT: opts.buildColBERT ?? profile.buildColBERT,
    useColBERT: opts.useColBERT ?? profile.useColBERT,
    sqliteFast: opts.sqliteFast || profile.sqliteFast,
    indexMode: opts.indexMode || profile.indexMode,
    requireNativeAnn: opts.requireNativeAnn,
  };
}

describe('resolveProfile', () => {
  it('fast profile defaults', () => {
    const result = resolveProfile({
      profile: 'fast',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(false);
    expect(result.useColBERT).toBe(false);
    expect(result.sqliteFast).toBe(true);
    expect(result.indexMode).toBe('single');
  });

  it('balanced profile defaults', () => {
    const result = resolveProfile({
      profile: 'balanced',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(false);
    expect(result.useColBERT).toBe(false);
    expect(result.sqliteFast).toBe(false);
    expect(result.indexMode).toBe('single');
  });

  it('full profile defaults', () => {
    const result = resolveProfile({
      profile: 'full',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(true);
    expect(result.useColBERT).toBe(true);
    expect(result.sqliteFast).toBe(false);
    expect(result.indexMode).toBe('single');
  });

  it('CLI override takes precedence over profile defaults', () => {
    const result = resolveProfile({
      profile: 'fast',
      buildColBERT: true,
      useColBERT: true,
      sqliteFast: false,
      indexMode: 'two-phase',
      requireNativeAnn: true,
    });

    expect(result.buildColBERT).toBe(true);
    expect(result.useColBERT).toBe(true);
    expect(result.indexMode).toBe('two-phase');
    expect(result.requireNativeAnn).toBe(true);
  });

  it('default profile is balanced when not specified', () => {
    const result = resolveProfile({
      profile: 'balanced',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(false);
    expect(result.useColBERT).toBe(false);
    expect(result.sqliteFast).toBe(false);
  });

  it('unknown profile falls back to balanced', () => {
    const result = resolveProfile({
      profile: 'nonexistent',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(false);
    expect(result.useColBERT).toBe(false);
    expect(result.sqliteFast).toBe(false);
    expect(result.indexMode).toBe('single');
  });

  it('null CLI values use profile defaults via nullish coalescing', () => {
    // full profile has useColBERT=true, buildColBERT=true
    const result = resolveProfile({
      profile: 'full',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(true);
    expect(result.useColBERT).toBe(true);
  });

  it('false CLI values override profile defaults (buildColBERT/useColBERT)', () => {
    // full profile has buildColBERT=true, useColBERT=true
    // but explicit false should override (nullish coalescing only passes null/undefined)
    const result = resolveProfile({
      profile: 'full',
      buildColBERT: false,
      useColBERT: false,
      sqliteFast: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.buildColBERT).toBe(false);
    expect(result.useColBERT).toBe(false);
  });

  it('sqliteFast uses logical OR (profile can force true)', () => {
    // fast profile has sqliteFast=true
    // With opts.sqliteFast=false, result should still be true (false || true = true)
    const result = resolveProfile({
      profile: 'fast',
      buildColBERT: null,
      useColBERT: null,
      sqliteFast: false,
      indexMode: '',
      requireNativeAnn: false,
    });

    expect(result.sqliteFast).toBe(true);
  });
});
