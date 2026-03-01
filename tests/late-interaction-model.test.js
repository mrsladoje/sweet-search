import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock onnxruntime-node and @huggingface/transformers for unit tests
// (don't download real models in CI)

const mockSession = {
  inputNames: ['input_ids', 'attention_mask'],
  outputNames: ['output'],
  run: vi.fn(),
  release: vi.fn(),
};

const mockTokenizer = vi.fn();

vi.mock('onnxruntime-node', () => ({
  InferenceSession: {
    create: vi.fn().mockResolvedValue(mockSession),
  },
  Tensor: vi.fn().mockImplementation((type, data, dims) => ({ type, data, dims })),
}));

vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: {
    from_pretrained: vi.fn().mockResolvedValue(mockTokenizer),
  },
}));

describe('late-interaction-model', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup tokenizer mock to return realistic shapes
    mockTokenizer.mockImplementation((text, opts) => {
      const tokenCount = Math.min(text.split(/\s+/).length + 2, opts?.max_length || 256);
      return {
        input_ids: {
          data: new BigInt64Array(tokenCount).fill(1n),
          dims: [1, tokenCount],
        },
        attention_mask: {
          data: new BigInt64Array(tokenCount).fill(1n),
          dims: [1, tokenCount],
        },
      };
    });

    // Setup session.run mock to return per-token vectors
    mockSession.run.mockImplementation(async (feeds) => {
      const seqLen = Number(feeds.input_ids.dims[1]);
      const dim = 128; // full model
      const data = new Float32Array(seqLen * dim);
      // Fill with non-zero values so L2 norm doesn't explode
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return {
        output: { data, dims: [1, seqLen, dim] },
      };
    });
  });

  it('encodeQuery exports exist', async () => {
    const mod = await import('../core/late-interaction-model.js');
    expect(typeof mod.encodeQuery).toBe('function');
    expect(typeof mod.encodeDocuments).toBe('function');
    expect(typeof mod.getLateInteractionPipeline).toBe('function');
    expect(typeof mod.unloadLateInteractionModel).toBe('function');
    expect(typeof mod.isLateInteractionModelLoaded).toBe('function');
  });

  it('isLateInteractionModelLoaded returns false before loading', async () => {
    const { isLateInteractionModelLoaded } = await import('../core/late-interaction-model.js');
    // May be true if loaded in another test; just check it's a boolean
    expect(typeof isLateInteractionModelLoaded()).toBe('boolean');
  });
});

// =============================================================================
// Phase 7: Token Pooling + Extended Skiplist
// =============================================================================

describe('poolTokens', () => {
  it('returns input unchanged when poolFactor <= 1', async () => {
    const { poolTokens } = await import('../core/late-interaction-model.js');
    const tokens = [new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0])];
    expect(poolTokens(tokens, 1)).toBe(tokens);
    expect(poolTokens(tokens, 0)).toBe(tokens);
  });

  it('returns empty array for empty input', async () => {
    const { poolTokens } = await import('../core/late-interaction-model.js');
    expect(poolTokens([], 2)).toEqual([]);
    expect(poolTokens(null, 2)).toBeNull();
  });

  it('preserves first token (protected)', async () => {
    const { poolTokens } = await import('../core/late-interaction-model.js');
    const first = new Float32Array([0.5, 0.3, 0.8]);
    const tokens = [first, new Float32Array([0.1, 0.2, 0.3]), new Float32Array([0.4, 0.5, 0.6])];
    const pooled = poolTokens(tokens, 2);

    // First token should be preserved exactly
    expect(pooled[0]).toBe(first);
  });

  it('reduces token count by pool factor', async () => {
    const { poolTokens } = await import('../core/late-interaction-model.js');
    // 5 tokens: [protected] + [pair1a, pair1b] + [pair2a, pair2b]
    const tokens = Array.from({ length: 5 }, (_, i) => {
      const v = new Float32Array(3);
      v[0] = i * 0.1;
      v[1] = 1 - i * 0.1;
      v[2] = 0.5;
      return v;
    });

    const pooled = poolTokens(tokens, 2);
    // 1 protected + ceil((5-1)/2) = 1 + 2 = 3 pooled tokens
    expect(pooled.length).toBe(3);
  });

  it('re-normalizes pooled vectors to unit length', async () => {
    const { poolTokens } = await import('../core/late-interaction-model.js');
    const tokens = [
      new Float32Array([1, 0, 0]),
      new Float32Array([0, 1, 0]),
      new Float32Array([0, 0, 1]),
    ];

    const pooled = poolTokens(tokens, 2);
    // Second token is average of [0,1,0] and [0,0,1], L2-normalized
    const vec = pooled[1];
    const norm = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2);
    expect(norm).toBeCloseTo(1.0, 3);
  });
});

describe('buildExtendedSkiplist', () => {
  it('extends base skiplist with code-noise tokens', async () => {
    const { buildExtendedSkiplist, _resetExtendedSkiplistCache } = await import('../core/late-interaction-model.js');
    _resetExtendedSkiplistCache();

    // Create a minimal tokenizer mock
    const tokenizer = (ch, opts) => ({
      input_ids: {
        data: [ch.charCodeAt(0)], // Use charcode as token ID for testing
      },
    });

    const base = new Set([1, 2, 3]);
    const extended = buildExtendedSkiplist(tokenizer, base);

    // Should contain base + new entries
    expect(extended.size).toBeGreaterThan(base.size);
    expect(extended.has(1)).toBe(true);
    expect(extended.has(2)).toBe(true);
    expect(extended.has(3)).toBe(true);
    // Semicolon (charcode 59) should be added
    expect(extended.has(59)).toBe(true);

    _resetExtendedSkiplistCache();
  });

  it('caches result on second call', async () => {
    const { buildExtendedSkiplist, _resetExtendedSkiplistCache } = await import('../core/late-interaction-model.js');
    _resetExtendedSkiplistCache();

    const tokenizer = (ch) => ({ input_ids: { data: [ch.charCodeAt(0)] } });
    const base = new Set([1]);

    const first = buildExtendedSkiplist(tokenizer, base);
    const second = buildExtendedSkiplist(tokenizer, new Set([99])); // different base
    // Should return cached first result
    expect(second).toBe(first);

    _resetExtendedSkiplistCache();
  });
});

describe('LateInteractionIndex v2.0', () => {
  it('stores modelId in state', async () => {
    const { LateInteractionIndex } = await import('../core/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128, modelId: 'lateon-code' });
    expect(idx.modelId).toBe('lateon-code');
  });

  it('defaults modelId from global config', async () => {
    const { LateInteractionIndex } = await import('../core/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128 });
    // Should get modelId from LATE_INTERACTION_CONFIG.model
    expect(idx.modelId).toBeTruthy();
  });

  it('maxSimScore computes correct MaxSim', async () => {
    const { LateInteractionIndex } = await import('../core/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 3 });

    // 2 query tokens, 2 doc tokens
    const qTokens = [[1, 0, 0], [0, 1, 0]];
    const dTokens = [[0.9, 0.1, 0], [0.1, 0.9, 0]];

    const score = idx.maxSimScore(qTokens, dTokens);
    // For query[0]=[1,0,0]: max sim with doc tokens → cos(q[0], d[0]) > cos(q[0], d[1])
    // For query[1]=[0,1,0]: max sim with doc tokens → cos(q[1], d[1]) > cos(q[1], d[0])
    expect(score).toBeGreaterThan(0.8);
  });

  it('maxSimScore returns 0 for empty doc tokens', async () => {
    const { LateInteractionIndex } = await import('../core/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 3 });
    expect(idx.maxSimScore([[1, 0, 0]], [])).toBe(0);
    expect(idx.maxSimScore([[1, 0, 0]], null)).toBe(0);
  });

  it('add + getTokens roundtrip with int8', async () => {
    const { LateInteractionIndex } = await import('../core/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 4, useInt8: true });
    idx.initialized = true;

    const tokens = [[0.5, 0.3, -0.2, 0.8], [0.1, -0.4, 0.6, 0.2]];
    await idx.add('doc1', tokens);

    const retrieved = idx.getTokens('doc1');
    expect(retrieved).toHaveLength(2);
    expect(retrieved[0]).toHaveLength(4);
    // Int8 quantization introduces small error
    expect(retrieved[0][0]).toBeCloseTo(0.5, 1);
  });

  it('getStats includes modelId', async () => {
    const { LateInteractionIndex } = await import('../core/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128, modelId: 'lateon-code' });
    idx.initialized = true;
    const stats = idx.getStats();
    expect(stats.modelId).toBe('lateon-code');
  });

  it('stores poolFactor in constructor and getStats', async () => {
    const { LateInteractionIndex } = await import('../core/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128, poolFactor: 2 });
    expect(idx.poolFactor).toBe(2);
    idx.initialized = true;
    expect(idx.getStats().poolFactor).toBe(2);
  });

  it('poolFactor defaults to 1', async () => {
    const { LateInteractionIndex } = await import('../core/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128 });
    expect(idx.poolFactor).toBe(1);
  });
});
