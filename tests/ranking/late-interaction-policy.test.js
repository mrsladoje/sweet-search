/**
 * Tests for the late-interaction search-rerank policy resolver.
 *
 * The resolver is a pure function; every branch is covered with synthetic
 * inputs — no I/O, no fixtures, no model loading. Mirrors the precedence
 * documented in `core/ranking/late-interaction-policy.js`:
 *
 *   1. per-call optionOverride
 *   2. SWEET_SEARCH_LI_RERANK env var (off / on)
 *   3. persisted searchReranking off / on
 *   4. persisted (or default) auto + manifest inspection
 *   5. fallback to active config model when manifest is unavailable
 */

import { describe, it, expect } from 'vitest';

import {
  LI_MODEL_EDGE,
  LI_MODEL_NONE,
  LI_MODEL_STANDARD,
  VALID_LI_MODELS,
  VALID_RERANK_POLICIES,
  isEdgeManifest,
  manifestUsable,
  normalizeLiModel,
  normalizePolicy,
  recommendInitDefaults,
  resolveSearchRerankPolicy,
} from '../../core/ranking/late-interaction-policy.js';

const stdManifest = { modelId: LI_MODEL_STANDARD, tokenDim: 128, exists: true };
const edgeManifest = { modelId: LI_MODEL_EDGE, tokenDim: 48, exists: true };
const missingManifest = { exists: false };
const mismatchManifest = { modelId: LI_MODEL_STANDARD, tokenDim: 128, modelMismatch: true };

const cleanEnv = {}; // empty env — resolver must not read process.env when env passed

describe('resolveSearchRerankPolicy — exported model id constants', () => {
  it('exposes the three known LI model identifiers', () => {
    expect(VALID_LI_MODELS).toEqual([LI_MODEL_STANDARD, LI_MODEL_EDGE, LI_MODEL_NONE]);
  });

  it('exposes the three rerank policy names', () => {
    expect(VALID_RERANK_POLICIES).toEqual(['auto', 'on', 'off']);
  });
});

describe('normalizePolicy', () => {
  it('returns auto for unknown / missing values', () => {
    expect(normalizePolicy(undefined)).toBe('auto');
    expect(normalizePolicy(null)).toBe('auto');
    expect(normalizePolicy('')).toBe('auto');
    expect(normalizePolicy('garbage')).toBe('auto');
    expect(normalizePolicy(42)).toBe('auto');
  });

  it('lowercases and trims valid values', () => {
    expect(normalizePolicy('ON')).toBe('on');
    expect(normalizePolicy(' Off ')).toBe('off');
    expect(normalizePolicy('Auto')).toBe('auto');
  });
});

describe('normalizeLiModel', () => {
  it('returns null for unknown values', () => {
    expect(normalizeLiModel(undefined)).toBeNull();
    expect(normalizeLiModel('made-up')).toBeNull();
  });

  it('passes through valid model ids verbatim (case-sensitive)', () => {
    expect(normalizeLiModel(LI_MODEL_STANDARD)).toBe(LI_MODEL_STANDARD);
    expect(normalizeLiModel(LI_MODEL_EDGE)).toBe(LI_MODEL_EDGE);
    expect(normalizeLiModel(LI_MODEL_NONE)).toBe(LI_MODEL_NONE);
  });
});

describe('manifestUsable + isEdgeManifest', () => {
  it('treats null/missing/mismatched manifests as unusable', () => {
    expect(manifestUsable(null)).toBe(false);
    expect(manifestUsable(missingManifest)).toBe(false);
    expect(manifestUsable(mismatchManifest)).toBe(false);
    expect(manifestUsable({})).toBe(false);
  });

  it('treats a manifest with modelId + exists != false as usable', () => {
    expect(manifestUsable(stdManifest)).toBe(true);
    expect(manifestUsable(edgeManifest)).toBe(true);
  });

  it('flags edge manifests', () => {
    expect(isEdgeManifest(edgeManifest)).toBe(true);
    expect(isEdgeManifest(stdManifest)).toBe(false);
    expect(isEdgeManifest(null)).toBe(false);
  });
});

describe('resolveSearchRerankPolicy — precedence ladder', () => {
  it('per-call optionOverride wins over everything', () => {
    const onForced = resolveSearchRerankPolicy({
      optionOverride: true,
      env: { SWEET_SEARCH_LI_RERANK: '0' },
      persisted: { searchReranking: 'off' },
      indexManifest: missingManifest,
    });
    expect(onForced.effective).toBe(true);
    expect(onForced.reason).toContain('per-call override');

    const offForced = resolveSearchRerankPolicy({
      optionOverride: false,
      env: { SWEET_SEARCH_LI_RERANK: '1' },
      persisted: { searchReranking: 'on' },
      indexManifest: stdManifest,
    });
    expect(offForced.effective).toBe(false);
    expect(offForced.reason).toContain('per-call override');
  });

  it('env opt-out beats persisted on/auto', () => {
    const result = resolveSearchRerankPolicy({
      env: { SWEET_SEARCH_LI_RERANK: '0' },
      persisted: { searchReranking: 'on' },
      indexManifest: stdManifest,
    });
    expect(result.effective).toBe(false);
    expect(result.reason).toContain('SWEET_SEARCH_LI_RERANK=0');
  });

  it('env opt-in turns rerank on when manifest is usable', () => {
    const result = resolveSearchRerankPolicy({
      env: { SWEET_SEARCH_LI_RERANK: '1' },
      persisted: { searchReranking: 'off' },
      indexManifest: stdManifest,
    });
    expect(result.effective).toBe(true);
    expect(result.reason).toContain('env opt-in');
    expect(result.warning).toBeUndefined();
  });

  it('env opt-in still degrades to off when manifest is missing/mismatched', () => {
    const missing = resolveSearchRerankPolicy({
      env: { SWEET_SEARCH_LI_RERANK: '1' },
      indexManifest: missingManifest,
    });
    expect(missing.effective).toBe(false);
    expect(missing.warning).toContain('no LI index file');

    const mismatch = resolveSearchRerankPolicy({
      env: { SWEET_SEARCH_LI_RERANK: '1' },
      indexManifest: mismatchManifest,
    });
    expect(mismatch.effective).toBe(false);
    expect(mismatch.warning).toContain('re-index');
  });

  it('env opt-in on edge manifest enables rerank but warns', () => {
    const result = resolveSearchRerankPolicy({
      env: { SWEET_SEARCH_LI_RERANK: '1' },
      indexManifest: edgeManifest,
    });
    expect(result.effective).toBe(true);
    expect(result.warning).toContain('benchmarked below no-rerank');
  });
});

describe('resolveSearchRerankPolicy — explicit persisted on/off', () => {
  it('persisted off → effective off (no manifest needed)', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { searchReranking: 'off' },
      indexManifest: stdManifest,
    });
    expect(result.effective).toBe(false);
    expect(result.policy).toBe('off');
    expect(result.reason).toContain('persisted searchReranking=off');
  });

  it('persisted on + standard manifest → on', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { searchReranking: 'on' },
      indexManifest: stdManifest,
    });
    expect(result.effective).toBe(true);
    expect(result.policy).toBe('on');
    expect(result.warning).toBeUndefined();
  });

  it('persisted on + edge manifest → on but with bench warning', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { searchReranking: 'on' },
      indexManifest: edgeManifest,
    });
    expect(result.effective).toBe(true);
    expect(result.policy).toBe('on');
    expect(result.warning).toContain('benchmarked below no-rerank');
  });

  it('persisted on + missing manifest → off + diagnostic', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { searchReranking: 'on' },
      indexManifest: missingManifest,
    });
    expect(result.effective).toBe(false);
    expect(result.policy).toBe('on');
    expect(result.warning).toContain('no LI index file');
  });

  it('persisted on + mismatched manifest → off + re-index diagnostic', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { searchReranking: 'on' },
      indexManifest: mismatchManifest,
    });
    expect(result.effective).toBe(false);
    expect(result.warning).toContain('re-index');
  });
});

describe('resolveSearchRerankPolicy — auto policy', () => {
  it('auto + standard manifest → on', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { searchReranking: 'auto' },
      indexManifest: stdManifest,
    });
    expect(result.effective).toBe(true);
    expect(result.reason).toContain('auto: standard LI index');
  });

  it('auto + edge manifest → off (bench-driven default)', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { searchReranking: 'auto' },
      indexManifest: edgeManifest,
    });
    expect(result.effective).toBe(false);
    expect(result.reason).toContain('edge LI index');
    expect(result.reason).toContain('Phase 3 bench');
  });

  it('auto + missing manifest → off with diagnostic', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { searchReranking: 'auto' },
      indexManifest: missingManifest,
    });
    expect(result.effective).toBe(false);
    expect(result.reason).toContain('no LI index on disk');
  });

  it('auto + mismatched manifest → off with diagnostic', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { searchReranking: 'auto' },
      indexManifest: mismatchManifest,
    });
    expect(result.effective).toBe(false);
    expect(result.reason).toContain('model mismatch');
  });

  it('auto with no manifest at all + activeConfigModel=standard → on (early-call fallback)', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: {},
      indexManifest: null,
      activeConfigModel: LI_MODEL_STANDARD,
    });
    expect(result.effective).toBe(true);
    expect(result.reason).toContain('manifest not yet loaded');
  });

  it('auto with no manifest + activeConfigModel=edge → off (early-call fallback)', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: {},
      indexManifest: null,
      activeConfigModel: LI_MODEL_EDGE,
    });
    expect(result.effective).toBe(false);
    expect(result.reason).toContain('edge LI active in config');
  });

  it('auto is the default when persisted has no searchReranking field', () => {
    const result = resolveSearchRerankPolicy({
      env: cleanEnv,
      persisted: { liModel: LI_MODEL_STANDARD }, // searchReranking absent
      indexManifest: stdManifest,
    });
    expect(result.policy).toBe('auto');
    expect(result.effective).toBe(true);
  });
});

describe('resolveSearchRerankPolicy — env value coercion', () => {
  it('accepts multiple off forms', () => {
    for (const v of ['0', 'false', 'off', 'no', 'OFF']) {
      const r = resolveSearchRerankPolicy({
        env: { SWEET_SEARCH_LI_RERANK: v },
        persisted: { searchReranking: 'on' },
        indexManifest: stdManifest,
      });
      expect(r.effective).toBe(false);
    }
  });

  it('accepts multiple on forms', () => {
    for (const v of ['1', 'true', 'on', 'yes', 'TRUE']) {
      const r = resolveSearchRerankPolicy({
        env: { SWEET_SEARCH_LI_RERANK: v },
        persisted: { searchReranking: 'off' },
        indexManifest: stdManifest,
      });
      expect(r.effective).toBe(true);
    }
  });

  it('ignores unrecognized env values and falls through to persisted', () => {
    const r = resolveSearchRerankPolicy({
      env: { SWEET_SEARCH_LI_RERANK: 'maybe' },
      persisted: { searchReranking: 'off' },
      indexManifest: stdManifest,
    });
    expect(r.effective).toBe(false);
    expect(r.reason).toContain('persisted searchReranking=off');
  });
});

describe('recommendInitDefaults — hardware-aware defaults', () => {
  it('recommends standard for high-RAM hardware', () => {
    const rec = recommendInitDefaults({ totalMemGB: 128, appleSilicon: { generation: 3 } });
    expect(rec.liModel).toBe(LI_MODEL_STANDARD);
    expect(rec.searchReranking).toBe('auto');
    expect(rec.reason).toContain('capable');
  });

  it('recommends edge for ≤8 GB RAM (low-RAM constrained)', () => {
    const rec = recommendInitDefaults({ totalMemGB: 8 });
    expect(rec.liModel).toBe(LI_MODEL_EDGE);
    expect(rec.searchReranking).toBe('auto');
    expect(rec.reason).toContain('constrained');
  });

  it('recommends edge for M1/M2 + ≤16 GB RAM', () => {
    const rec = recommendInitDefaults({
      totalMemGB: 16,
      appleSilicon: { generation: 1, family: 'M1' },
    });
    expect(rec.liModel).toBe(LI_MODEL_EDGE);

    const rec2 = recommendInitDefaults({
      totalMemGB: 16,
      appleSilicon: { generation: 2, family: 'M2' },
    });
    expect(rec2.liModel).toBe(LI_MODEL_EDGE);
  });

  it('still recommends standard for M1/M2 with 32 GB+ RAM', () => {
    const rec = recommendInitDefaults({
      totalMemGB: 32,
      appleSilicon: { generation: 2, family: 'M2 Max' },
    });
    expect(rec.liModel).toBe(LI_MODEL_STANDARD);
  });

  it('falls through to standard when hardware data is missing', () => {
    const rec = recommendInitDefaults({});
    expect(rec.liModel).toBe(LI_MODEL_STANDARD);
    expect(rec.reason).toContain('default');
  });
});
