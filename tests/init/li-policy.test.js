/**
 * Tests for the Phase 4 init-side LI policy resolution.
 *
 * Covers the pure surface only — parseInitArgs flag plumbing, the
 * `coerceLiModelChoice` alias mapping, model-key filtering for the chosen
 * LI variant, and the precedence ladder in `resolveLiPolicyChoices`. The
 * wizard itself is tested through a fake `wizardFn` so no readline / TTY
 * is ever touched.
 */

import { describe, it, expect } from 'vitest';

import {
  coerceLiModelChoice,
  filterModelKeysForLiChoice,
  filterModelKeysForAccelerator,
  hasUsableIndexAccelerator,
  parseInitArgs,
  resolveLiPolicyChoices,
} from '../../scripts/init.js';
import {
  LI_MODEL_EDGE,
  LI_MODEL_NONE,
  LI_MODEL_STANDARD,
} from '../../core/ranking/late-interaction-policy.js';

describe('parseInitArgs — Phase 4 flags', () => {
  it('parses --li-model with separate value', () => {
    const r = parseInitArgs(['--li-model', 'edge']);
    expect(r.liModel).toBe('edge');
  });

  it('parses --li-model=value form', () => {
    const r = parseInitArgs(['--li-model=standard']);
    expect(r.liModel).toBe('standard');
  });

  it('parses --search-reranking both forms', () => {
    expect(parseInitArgs(['--search-reranking', 'on']).searchReranking).toBe('on');
    expect(parseInitArgs(['--search-reranking=off']).searchReranking).toBe('off');
  });

  it('parses --wizard as a boolean toggle', () => {
    expect(parseInitArgs([]).wizard).toBe(false);
    expect(parseInitArgs(['--wizard']).wizard).toBe(true);
  });

  it('leaves Phase 4 fields null/false when absent', () => {
    const r = parseInitArgs([]);
    expect(r.liModel).toBeNull();
    expect(r.searchReranking).toBeNull();
    expect(r.wizard).toBe(false);
  });
});

describe('coerceLiModelChoice — alias mapping', () => {
  it('accepts canonical ids', () => {
    expect(coerceLiModelChoice('lateon-code')).toBe(LI_MODEL_STANDARD);
    expect(coerceLiModelChoice('lateon-code-edge')).toBe(LI_MODEL_EDGE);
    expect(coerceLiModelChoice('none')).toBe(LI_MODEL_NONE);
  });

  it('accepts user-friendly aliases', () => {
    expect(coerceLiModelChoice('standard')).toBe(LI_MODEL_STANDARD);
    expect(coerceLiModelChoice('full')).toBe(LI_MODEL_STANDARD);
    expect(coerceLiModelChoice('edge')).toBe(LI_MODEL_EDGE);
    expect(coerceLiModelChoice('small')).toBe(LI_MODEL_EDGE);
    expect(coerceLiModelChoice('off')).toBe(LI_MODEL_NONE);
    expect(coerceLiModelChoice('disable')).toBe(LI_MODEL_NONE);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(coerceLiModelChoice('  EDGE  ')).toBe(LI_MODEL_EDGE);
    expect(coerceLiModelChoice('Standard')).toBe(LI_MODEL_STANDARD);
  });

  it('rejects unknown values', () => {
    expect(coerceLiModelChoice('mediuma')).toBeNull();
    expect(coerceLiModelChoice('')).toBeNull();
    expect(coerceLiModelChoice(undefined)).toBeNull();
    expect(coerceLiModelChoice(42)).toBeNull();
  });
});

describe('filterModelKeysForLiChoice', () => {
  const sample = [
    'embedding-onnx-int8',
    'lateon-code',
    'lateon-code-fp32',
    'lateon-code-edge',
    'lateon-code-edge-fp32',
    'gte-reranker',
  ];

  it('liModel=standard drops every edge-flavoured key', () => {
    const filtered = filterModelKeysForLiChoice(sample, LI_MODEL_STANDARD);
    expect(filtered).toEqual([
      'embedding-onnx-int8',
      'lateon-code',
      'lateon-code-fp32',
      'gte-reranker',
    ]);
  });

  it('liModel=edge drops every standard LI key', () => {
    const filtered = filterModelKeysForLiChoice(sample, LI_MODEL_EDGE);
    expect(filtered).toEqual([
      'embedding-onnx-int8',
      'lateon-code-edge',
      'lateon-code-edge-fp32',
      'gte-reranker',
    ]);
  });

  it('liModel=none drops every lateon-* key', () => {
    const filtered = filterModelKeysForLiChoice(sample, LI_MODEL_NONE);
    expect(filtered).toEqual(['embedding-onnx-int8', 'gte-reranker']);
  });

  it('does not mutate its input', () => {
    const before = [...sample];
    filterModelKeysForLiChoice(sample, LI_MODEL_NONE);
    expect(sample).toEqual(before);
  });
});

describe('filterModelKeysForAccelerator', () => {
  // Real registry keys so the registry-driven classification
  // (isNativeAcceleratedModel) is exercised end-to-end.
  const fullSet = [
    'lateon-code',
    'lateon-code-fp32',
    'lateon-code-edge',
    'lateon-code-edge-fp32',
    'coderankembed-int8',
    'coderankembed-fp32',
    'all-minilm-l6-v2',
  ];

  it('hasAccelerator=true keeps every key (accelerator hosts fetch FP32)', () => {
    expect(filterModelKeysForAccelerator(fullSet, { hasAccelerator: true })).toEqual(fullSet);
  });

  it('hasAccelerator=false drops native FP32 safetensors, keeps ORT/query/cache', () => {
    const filtered = filterModelKeysForAccelerator(fullSet, { hasAccelerator: false });
    expect(filtered).toEqual([
      'lateon-code',
      'lateon-code-edge',
      'coderankembed-int8',
      'all-minilm-l6-v2',
    ]);
    // The three FP32 backbones are gone…
    expect(filtered).not.toContain('coderankembed-fp32');
    expect(filtered).not.toContain('lateon-code-fp32');
    expect(filtered).not.toContain('lateon-code-edge-fp32');
    // …but the ORT INT8 embedding + cache models stay.
    expect(filtered).toContain('coderankembed-int8');
    expect(filtered).toContain('all-minilm-l6-v2');
  });

  it('defaults to keeping everything when hasAccelerator is unspecified', () => {
    expect(filterModelKeysForAccelerator(fullSet)).toEqual(fullSet);
    expect(filterModelKeysForAccelerator(fullSet, {})).toEqual(fullSet);
  });

  it('does not mutate its input', () => {
    const before = [...fullSet];
    filterModelKeysForAccelerator(fullSet, { hasAccelerator: false });
    expect(fullSet).toEqual(before);
  });
});

describe('hasUsableIndexAccelerator', () => {
  it('is true only when hardware has an accelerator and native inference is available', () => {
    expect(hasUsableIndexAccelerator({
      capability: { inferenceBackendPreference: 'candle-metal' },
      nativeInferenceAvailable: true,
    })).toBe(true);
    expect(hasUsableIndexAccelerator({
      capability: { inferenceBackendPreference: 'candle-cuda' },
      nativeInferenceAvailable: true,
    })).toBe(true);
    expect(hasUsableIndexAccelerator({
      capability: { inferenceBackendPreference: 'coreml-cascade' },
      nativeInferenceAvailable: true,
    })).toBe(true);
  });

  it('is false on ORT CPU fallback even when native inference is loadable', () => {
    expect(hasUsableIndexAccelerator({
      capability: { inferenceBackendPreference: 'ort-cpu' },
      nativeInferenceAvailable: true,
    })).toBe(false);
  });

  it('is false for missing or unknown capability values', () => {
    expect(hasUsableIndexAccelerator({
      capability: undefined,
      nativeInferenceAvailable: true,
    })).toBe(false);
    expect(hasUsableIndexAccelerator({
      capability: { inferenceBackendPreference: 'unknown-backend' },
      nativeInferenceAvailable: true,
    })).toBe(false);
  });

  it('is false when native inference is disabled or unavailable even on accelerator hardware', () => {
    expect(hasUsableIndexAccelerator({
      capability: { inferenceBackendPreference: 'candle-metal' },
      nativeInferenceAvailable: false,
    })).toBe(false);
    expect(hasUsableIndexAccelerator({
      capability: { inferenceBackendPreference: 'candle-cuda' },
      nativeInferenceAvailable: null,
    })).toBe(false);
  });
});

describe('LI + accelerator filtering compose (init fetch order)', () => {
  // Mirrors runInit: getModelsForProfile → filterModelKeysForLiChoice →
  // filterModelKeysForAccelerator. Real registry keys throughout.
  const fullSet = [
    'lateon-code',
    'lateon-code-fp32',
    'lateon-code-edge',
    'lateon-code-edge-fp32',
    'coderankembed-int8',
    'coderankembed-fp32',
    'all-minilm-l6-v2',
  ];
  const compose = (liModel, hasAccelerator) =>
    filterModelKeysForAccelerator(
      filterModelKeysForLiChoice(fullSet, liModel),
      { hasAccelerator },
    );

  it('standard LI, CPU-only host → ORT LI + ORT embed + cache, no FP32', () => {
    expect(compose(LI_MODEL_STANDARD, false)).toEqual([
      'lateon-code',
      'coderankembed-int8',
      'all-minilm-l6-v2',
    ]);
  });

  it('edge LI, CPU-only host → edge ORT LI + ORT embed + cache, no FP32', () => {
    expect(compose(LI_MODEL_EDGE, false)).toEqual([
      'lateon-code-edge',
      'coderankembed-int8',
      'all-minilm-l6-v2',
    ]);
  });

  it('liModel=none, CPU-only host → only ORT embed + cache', () => {
    expect(compose(LI_MODEL_NONE, false)).toEqual([
      'coderankembed-int8',
      'all-minilm-l6-v2',
    ]);
  });

  it('standard LI, accelerator host → keeps standard FP32 backbones, no edge FP32', () => {
    const final = compose(LI_MODEL_STANDARD, true);
    expect(final).toContain('lateon-code-fp32');
    expect(final).toContain('coderankembed-fp32');
    expect(final).not.toContain('lateon-code-edge-fp32'); // dropped by LI filter
  });

  it('edge LI, accelerator host → keeps edge FP32 backbones, no standard FP32', () => {
    const final = compose(LI_MODEL_EDGE, true);
    expect(final).toContain('lateon-code-edge-fp32');
    expect(final).toContain('coderankembed-fp32');
    expect(final).not.toContain('lateon-code-fp32'); // dropped by LI filter
  });
});

describe('resolveLiPolicyChoices — precedence ladder', () => {
  // Hardware that recommends standard (RAM > 8 GB, modern Apple Silicon)
  const capableHw = { totalMemGB: 128, appleSilicon: { generation: 3, family: 'M3 Max' } };
  // Hardware that recommends edge (low RAM)
  const constrainedHw = { totalMemGB: 8 };

  it('CLI wins over wizard, persisted, and recommendation', async () => {
    const r = await resolveLiPolicyChoices({
      parsed: { liModel: 'edge', searchReranking: 'off' },
      existingConfig: { runtime: { li: { model: LI_MODEL_STANDARD, searchReranking: 'on' } } },
      capability: capableHw,
      isTTY: true,
      wizardFn: async () => ({ liModel: LI_MODEL_STANDARD, searchReranking: 'on' }),
    });
    expect(r.liModel).toBe(LI_MODEL_EDGE);
    expect(r.searchReranking).toBe('off');
    expect(r.source.liModel).toBe('cli');
    expect(r.source.searchReranking).toBe('cli');
  });

  it('wizard wins over persisted + recommendation when no CLI flag', async () => {
    const r = await resolveLiPolicyChoices({
      parsed: { wizard: true },
      existingConfig: { runtime: { li: { model: LI_MODEL_STANDARD, searchReranking: 'auto' } } },
      capability: capableHw,
      isTTY: true,
      wizardFn: async () => ({ liModel: LI_MODEL_NONE, searchReranking: 'off' }),
    });
    expect(r.liModel).toBe(LI_MODEL_NONE);
    expect(r.searchReranking).toBe('off');
    expect(r.source.liModel).toBe('wizard');
    expect(r.source.searchReranking).toBe('wizard');
  });

  it('persisted wins over recommendation when CLI + wizard absent', async () => {
    const r = await resolveLiPolicyChoices({
      parsed: {},
      existingConfig: { runtime: { li: { model: LI_MODEL_EDGE, searchReranking: 'on' } } },
      capability: capableHw,
      isTTY: false,
    });
    expect(r.liModel).toBe(LI_MODEL_EDGE);
    expect(r.searchReranking).toBe('on');
    expect(r.source.liModel).toBe('persisted');
    expect(r.source.searchReranking).toBe('persisted');
  });

  it('recommendation is the final fallback (capable hardware → standard)', async () => {
    const r = await resolveLiPolicyChoices({
      parsed: {},
      existingConfig: null,
      capability: capableHw,
      isTTY: false,
    });
    expect(r.liModel).toBe(LI_MODEL_STANDARD);
    expect(r.searchReranking).toBe('auto');
    expect(r.source.liModel).toBe('recommendation');
  });

  it('recommendation flips to edge for constrained hardware', async () => {
    const r = await resolveLiPolicyChoices({
      parsed: {},
      existingConfig: null,
      capability: constrainedHw,
      isTTY: false,
    });
    expect(r.liModel).toBe(LI_MODEL_EDGE);
    expect(r.recommendation.reason).toContain('constrained');
  });

  it('--wizard on a non-TTY falls back gracefully without invoking wizardFn', async () => {
    let invoked = false;
    const r = await resolveLiPolicyChoices({
      parsed: { wizard: true },
      existingConfig: { runtime: { li: { model: LI_MODEL_EDGE, searchReranking: 'auto' } } },
      capability: capableHw,
      isTTY: false,
      wizardFn: async () => { invoked = true; return { liModel: LI_MODEL_NONE }; },
    });
    expect(invoked).toBe(false);
    expect(r.liModel).toBe(LI_MODEL_EDGE);    // persisted
    expect(r.source.liModel).toBe('persisted');
  });

  it('throws on invalid --li-model', async () => {
    await expect(
      resolveLiPolicyChoices({
        parsed: { liModel: 'nonsense' },
        existingConfig: null,
        capability: capableHw,
        isTTY: false,
      }),
    ).rejects.toThrow(/Invalid --li-model/);
  });

  it('throws on invalid --search-reranking', async () => {
    await expect(
      resolveLiPolicyChoices({
        parsed: { searchReranking: 'maybe' },
        existingConfig: null,
        capability: capableHw,
        isTTY: false,
      }),
    ).rejects.toThrow(/Invalid --search-reranking/);
  });

  it('mixed sources: CLI for one field, persisted for the other', async () => {
    const r = await resolveLiPolicyChoices({
      parsed: { liModel: 'edge' }, // explicit
      existingConfig: { runtime: { li: { searchReranking: 'on' } } },
      capability: capableHw,
      isTTY: false,
    });
    expect(r.liModel).toBe(LI_MODEL_EDGE);
    expect(r.source.liModel).toBe('cli');
    expect(r.searchReranking).toBe('on');
    expect(r.source.searchReranking).toBe('persisted');
  });

  it('ignores malformed persisted values and falls back to recommendation', async () => {
    const r = await resolveLiPolicyChoices({
      parsed: {},
      existingConfig: { runtime: { li: { model: 'garbage', searchReranking: 'maybe' } } },
      capability: capableHw,
      isTTY: false,
    });
    expect(r.liModel).toBe(LI_MODEL_STANDARD); // recommendation
    expect(r.source.liModel).toBe('recommendation');
    expect(r.searchReranking).toBe('auto');
  });
});
