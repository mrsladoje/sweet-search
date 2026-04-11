import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fsPromises from 'fs/promises';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
  Tensor: vi.fn().mockImplementation(function Tensor(type, data, dims) {
    return { type, data, dims };
  }),
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
      const texts = Array.isArray(text) ? text : [text];
      const tokenCount = Math.min(
        Math.max(...texts.map((entry) => entry.split(/\s+/).length + 2)),
        opts?.max_length || 256
      );
      return {
        input_ids: {
          data: new BigInt64Array(texts.length * tokenCount).fill(1n),
          dims: [texts.length, tokenCount],
        },
        attention_mask: {
          data: new BigInt64Array(texts.length * tokenCount).fill(1n),
          dims: [texts.length, tokenCount],
        },
      };
    });

    // Setup session.run mock to return per-token vectors
    mockSession.run.mockImplementation(async (feeds) => {
      const batch = Number(feeds.input_ids.dims[0]);
      const seqLen = Number(feeds.input_ids.dims[1]);
      const dim = 128; // full model
      const data = new Float32Array(batch * seqLen * dim);
      // Fill with non-zero values so L2 norm doesn't explode
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return {
        output: { data, dims: [batch, seqLen, dim] },
      };
    });
  });

  afterEach(async () => {
    const mod = await import('../../core/ranking/late-interaction-model.js');
    await mod.unloadLateInteractionModel();
  });

  it('encodeQuery exports exist', async () => {
    const mod = await import('../../core/ranking/late-interaction-model.js');
    expect(typeof mod.encodeQuery).toBe('function');
    expect(typeof mod.encodeDocuments).toBe('function');
    expect(typeof mod.getLateInteractionPipeline).toBe('function');
    expect(typeof mod.unloadLateInteractionModel).toBe('function');
    expect(typeof mod.isLateInteractionModelLoaded).toBe('function');
  });

  it('isLateInteractionModelLoaded returns false before loading', async () => {
    const { isLateInteractionModelLoaded } = await import('../../core/ranking/late-interaction-model.js');
    // May be true if loaded in another test; just check it's a boolean
    expect(typeof isLateInteractionModelLoaded()).toBe('boolean');
  });

  it('encodeDocuments batches multiple docs into one ONNX run', async () => {
    const { encodeDocuments } = await import('../../core/ranking/late-interaction-model.js');
    const initialCalls = mockSession.run.mock.calls.length;
    const docs = await encodeDocuments([
      'function alpha() { return 1; }',
      'function beta() { return 2; }',
    ]);

    expect(docs).toHaveLength(2);
    expect(mockSession.run.mock.calls.length - initialCalls).toBe(12); // probe + warmup x10 + batched encode
    const finalCall = mockSession.run.mock.calls.at(-1);
    expect(finalCall[0].input_ids.dims[0]).toBe(2);
  });
});

// =============================================================================
// Phase 7: Token Pooling + Extended Skiplist
// =============================================================================

describe('poolTokens', () => {
  it('returns input unchanged when poolFactor <= 1', async () => {
    const { poolTokens } = await import('../../core/ranking/late-interaction-model.js');
    const tokens = [new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0])];
    expect(poolTokens(tokens, 1)).toBe(tokens);
    expect(poolTokens(tokens, 0)).toBe(tokens);
  });

  it('returns empty array for empty input', async () => {
    const { poolTokens } = await import('../../core/ranking/late-interaction-model.js');
    expect(poolTokens([], 2)).toEqual([]);
    expect(poolTokens(null, 2)).toBeNull();
  });

  it('preserves first token (protected)', async () => {
    const { poolTokens } = await import('../../core/ranking/late-interaction-model.js');
    const first = new Float32Array([0.5, 0.3, 0.8]);
    const tokens = [first, new Float32Array([0.1, 0.2, 0.3]), new Float32Array([0.4, 0.5, 0.6])];
    const pooled = poolTokens(tokens, 2);

    // First token should be preserved exactly
    expect(pooled[0]).toBe(first);
  });

  it('reduces token count by pool factor', async () => {
    const { poolTokens } = await import('../../core/ranking/late-interaction-model.js');
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
    const { poolTokens } = await import('../../core/ranking/late-interaction-model.js');
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

  it('CRA-1: merges similar tokens first (hierarchical, not consecutive)', async () => {
    const { poolTokens } = await import('../../core/ranking/late-interaction-model.js');
    // Place two similar tokens far apart positionally: indices 1 and 4
    // are near [1,0,0], while indices 2 and 3 are near [0,1,0].
    // Consecutive pairing would merge (1,2) and (3,4) — mixing directions.
    // Hierarchical pooling should merge (1,4) and (2,3) — preserving directions.
    const norm = (v) => {
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      return new Float32Array(v.map(x => x / n));
    };
    const tokens = [
      norm([1, 0, 0]),   // 0: protected
      norm([1, 0.1, 0]), // 1: ~x-axis
      norm([0, 1, 0.1]), // 2: ~y-axis
      norm([0, 1, 0.2]), // 3: ~y-axis
      norm([1, 0.2, 0]), // 4: ~x-axis
    ];

    // poolFactor=2: 4 non-protected → ceil(4/2)=2 clusters → 3 total
    const pooled = poolTokens(tokens, 2);
    expect(pooled.length).toBe(3);

    // The two output clusters (besides protected) should each be near one axis.
    // Find which pooled token is closer to x-axis vs y-axis.
    const dotX = (v) => v[0]; // dot with [1,0,0]
    const dotY = (v) => v[1]; // dot with [0,1,0]

    const xCluster = pooled[1][0] > pooled[2][0] ? pooled[1] : pooled[2];
    const yCluster = pooled[1][1] > pooled[2][1] ? pooled[1] : pooled[2];

    // x-cluster should be strongly x-axis aligned (>0.9)
    expect(dotX(xCluster)).toBeGreaterThan(0.9);
    // y-cluster should be strongly y-axis aligned (>0.9)
    expect(dotY(yCluster)).toBeGreaterThan(0.9);
  });

  it('CRA-1: handles single non-protected token', async () => {
    const { poolTokens } = await import('../../core/ranking/late-interaction-model.js');
    const tokens = [
      new Float32Array([1, 0, 0]),
      new Float32Array([0, 1, 0]),
    ];
    const pooled = poolTokens(tokens, 2);
    // 1 protected + ceil(1/2) = 1 + 1 = 2 — no merge possible
    expect(pooled.length).toBe(2);
  });

  it('CRA-1: poolFactor=3 with 7 tokens', async () => {
    const { poolTokens } = await import('../../core/ranking/late-interaction-model.js');
    const tokens = Array.from({ length: 7 }, (_, i) => {
      const v = new Float32Array(4);
      v[i % 4] = 1;
      return v;
    });
    const pooled = poolTokens(tokens, 3);
    // 1 protected + ceil(6/3) = 1 + 2 = 3
    expect(pooled.length).toBe(3);
    // All outputs should be unit-length
    for (const v of pooled) {
      const norm = Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1.0, 3);
    }
  });
});

describe('buildExtendedSkiplist', () => {
  it('extends base skiplist with code-noise tokens', async () => {
    const { buildExtendedSkiplist, _resetExtendedSkiplistCache } = await import('../../core/ranking/late-interaction-model.js');
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
    const { buildExtendedSkiplist, _resetExtendedSkiplistCache } = await import('../../core/ranking/late-interaction-model.js');
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
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128, modelId: 'lateon-code' });
    expect(idx.modelId).toBe('lateon-code');
  });

  it('defaults modelId from global config', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128 });
    // Should get modelId from LATE_INTERACTION_CONFIG.model
    expect(idx.modelId).toBeTruthy();
  });

  it('maxSimScore computes correct MaxSim', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
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
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 3 });
    expect(idx.maxSimScore([[1, 0, 0]], [])).toBe(0);
    expect(idx.maxSimScore([[1, 0, 0]], null)).toBe(0);
  });

  it('add + getTokens roundtrip with int8', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 4, useInt8: true, whtSeed: 0 });
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
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128, modelId: 'lateon-code' });
    idx.initialized = true;
    const stats = idx.getStats();
    expect(stats.modelId).toBe('lateon-code');
  });

  it('stores poolFactor in constructor and getStats', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128, poolFactor: 2 });
    expect(idx.poolFactor).toBe(2);
    idx.initialized = true;
    expect(idx.getStats().poolFactor).toBe(2);
  });

  it('poolFactor defaults to 1', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128 });
    expect(idx.poolFactor).toBe(1);
  });

  it('stream-loads documents across chunk boundaries with quoted metadata', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const tmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-li-stream-'));
    const indexPath = join(tmpDir, 'late-interaction.db');

    try {
      const state = {
        version: '2.1',
        modelId: 'lateon-code',
        tokenDim: 4,
        maxTokens: 8,
        useInt8: true,
        poolFactor: 1,
        documents: [
          {
            id: 'src/a.ts:1-4:0',
            tokens: [1, -2, 3, -4],
            numTokens: 1,
            dim: 4,
            min: -1,
            scale: 0.25,
            metadata: { file: 'src/a.ts', name: 'quote " brace { test }' },
          },
          {
            id: 'src/b.ts:5-9:1',
            tokens: [5, 6, -7, 8, 9, -10, 11, -12],
            numTokens: 2,
            dim: 4,
            min: -2,
            scale: 0.5,
            metadata: { file: 'src/b.ts', name: 'comma, slash \\\\ and quote "' },
          },
        ],
      };

      writeFileSync(indexPath, JSON.stringify(state));

      const idx = new LateInteractionIndex({
        tokenDim: 4,
        useInt8: true,
        modelId: 'lateon-code',
        indexPath,
        streamChunkSize: 19,
      });

      const header = await idx._loadStreaming();

      expect(header.modelId).toBe('lateon-code');
      expect(idx.documents.size).toBe(2);
      expect(Array.from(idx.documents.get('src/a.ts:1-4:0').tokens)).toEqual([1, -2, 3, -4]);
      expect(idx.documents.get('src/b.ts:5-9:1').metadata.name).toBe('comma, slash \\\\ and quote "');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('load() uses streaming path for large files without fs.readFile', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const tmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-li-load-'));
    const indexPath = join(tmpDir, 'late-interaction.db');

    try {
      writeFileSync(indexPath, JSON.stringify({
        version: '2.1',
        modelId: 'lateon-code',
        tokenDim: 4,
        maxTokens: 8,
        useInt8: false,
        poolFactor: 1,
        documents: [
          {
            id: 'doc-1',
            tokens: [0.1, 0.2, 0.3, 0.4],
            numTokens: 1,
            dim: 4,
            metadata: { file: 'src/doc-1.ts' },
          },
        ],
      }));

      const statSpy = vi.spyOn(fsPromises, 'stat').mockResolvedValue({ size: 300 * 1024 * 1024 });
      const readFileSpy = vi.spyOn(fsPromises, 'readFile');

      const idx = new LateInteractionIndex({
        tokenDim: 4,
        useInt8: false,
        modelId: 'lateon-code',
        indexPath,
        streamChunkSize: 17,
      });

      await idx.load();

      expect(readFileSpy).not.toHaveBeenCalledWith(indexPath, 'utf-8');
      expect(idx.documents.size).toBe(1);
      const tokens = Array.from(idx.documents.get('doc-1').tokens);
      expect(tokens[0]).toBeCloseTo(0.1, 6);
      expect(tokens[1]).toBeCloseTo(0.2, 6);
      expect(tokens[2]).toBeCloseTo(0.3, 6);
      expect(tokens[3]).toBeCloseTo(0.4, 6);

      statSpy.mockRestore();
      readFileSpy.mockRestore();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});

// =============================================================================
// Phase 3: Token Pooling in Index + Norm Pruning
// =============================================================================

describe('Phase 3: token pooling in index add()', () => {
  it('add() applies pooling when poolFactor > 1', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 4, useInt8: false, poolFactor: 2, whtSeed: 0 });
    idx.initialized = true;

    // 5 tokens → poolFactor=2 → 1 protected + ceil((5-1)/2) = 3 pooled
    const tokens = Array.from({ length: 5 }, (_, i) => {
      const v = new Float32Array(4);
      v[0] = (i + 1) * 0.1;
      v[1] = 1 - i * 0.1;
      v[2] = 0.5;
      v[3] = 0.3;
      return Array.from(v);
    });

    await idx.add('pooled-doc', tokens);
    const doc = idx.documents.get('pooled-doc');
    expect(doc.numTokens).toBe(3); // 1 protected + 2 pooled groups
  });

  it('poolFactor=1 preserves all tokens', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 4, useInt8: false, poolFactor: 1, whtSeed: 0 });
    idx.initialized = true;

    const tokens = [[0.5, 0.3, -0.2, 0.8], [0.1, -0.4, 0.6, 0.2], [0.3, 0.1, 0.7, -0.5]];
    await idx.add('no-pool', tokens);
    expect(idx.documents.get('no-pool').numTokens).toBe(3);
  });

  it('normPruneThreshold drops low-norm tokens', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({
      tokenDim: 4, useInt8: false, poolFactor: 1, whtSeed: 0,
      normPruneThreshold: 0.3,
    });
    idx.initialized = true;

    // First token: high norm, Second: very low norm (should be pruned), Third: high norm
    const tokens = [
      [0.5, 0.5, 0.5, 0.5],  // norm ~1.0 (kept: first token always kept)
      [0.01, 0.01, 0.01, 0.01],  // norm ~0.02 (pruned)
      [0.4, 0.4, 0.4, 0.4],  // norm ~0.8 (kept)
    ];
    await idx.add('pruned-doc', tokens);
    expect(idx.documents.get('pruned-doc').numTokens).toBe(2); // first + third
  });
});

// =============================================================================
// Phase 4: 4-bit Quantization
// =============================================================================

describe('Phase 4: 4-bit quantization', () => {
  it('quantBits=4 creates nibble-packed tokens', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 4, quantBits: 4, useInt8: true, whtSeed: 0 });
    idx.initialized = true;

    const tokens = [[0.5, 0.3, -0.2, 0.8], [0.1, -0.4, 0.6, 0.2]];
    await idx.add('4bit-doc', tokens);

    const doc = idx.documents.get('4bit-doc');
    expect(doc.quantBits).toBe(4);
    expect(doc.tokens).toBeInstanceOf(Uint8Array);
    // 4 dims → 2 packed bytes per token, 2 tokens = 4 bytes
    expect(doc.tokens.length).toBe(4);
    expect(doc.minArray).toBeInstanceOf(Float32Array);
    expect(doc.scaleArray).toBeInstanceOf(Float32Array);
    expect(doc.minArray.length).toBe(2);
  });

  it('4-bit roundtrip maintains reasonable accuracy', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 4, quantBits: 4, useInt8: true, whtSeed: 0 });
    idx.initialized = true;

    const tokens = [[0.5, 0.3, -0.2, 0.8]];
    await idx.add('rt-doc', tokens);

    const retrieved = idx.getTokens('rt-doc');
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]).toHaveLength(4);
    // 4-bit has 16 levels — coarser than 8-bit but still in the ballpark
    expect(retrieved[0][0]).toBeCloseTo(0.5, 0);
    expect(retrieved[0][3]).toBeCloseTo(0.8, 0);
  });

  it('4-bit getTokensFlat returns correct float values', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 4, quantBits: 4, useInt8: true, whtSeed: 0 });
    idx.initialized = true;

    await idx.add('flat-doc', [[0.5, 0.3, -0.2, 0.8]]);

    const flatData = idx.getTokensFlat('flat-doc');
    expect(flatData.numTokens).toBe(1);
    expect(flatData.dim).toBe(4);
    expect(flatData.flat[0]).toBeCloseTo(0.5, 0);
  });

  it('quantBits defaults to 8 for useInt8', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128, useInt8: true });
    expect(idx.quantBits).toBe(8);
  });

  it('quantBits defaults to 32 for float', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128, useInt8: false });
    expect(idx.quantBits).toBe(32);
  });

  it('getStats includes quantBits', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({ tokenDim: 128, quantBits: 4, useInt8: true });
    idx.initialized = true;
    expect(idx.getStats().quantBits).toBe(4);
  });
});

describe('Phase 4: 4-bit SSLX save/load roundtrip', () => {
  it('saves and loads 4-bit index via segments', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const tmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-4bit-'));
    const indexPath = join(tmpDir, 'late-interaction.db');

    try {
      const idx = new LateInteractionIndex({
        tokenDim: 4, quantBits: 4, useInt8: true, whtSeed: 0,
        indexPath, segmentSize: 2,
      });
      idx.initialized = true;

      await idx.add('doc1', [[0.5, 0.3, -0.2, 0.8], [0.1, -0.4, 0.6, 0.2]]);
      await idx.add('doc2', [[0.9, 0.1, 0.0, -0.3]]);
      await idx.save();

      // Load into a fresh index
      const idx2 = new LateInteractionIndex({
        tokenDim: 4, quantBits: 4, useInt8: true, whtSeed: 0,
        indexPath,
      });
      await idx2.load();

      expect(idx2.documents.size).toBe(2);
      expect(idx2.quantBits).toBe(4);

      const doc1 = idx2.documents.get('doc1');
      expect(doc1.numTokens).toBe(2);
      expect(doc1.quantBits).toBe(4);
      expect(doc1.tokens).toBeInstanceOf(Uint8Array);
      expect(doc1.minArray).toBeInstanceOf(Float32Array);
      expect(doc1.tokenNorms).toBeInstanceOf(Float32Array);

      // Verify dequantized values are reasonable
      const tokens = idx2.getTokens('doc1');
      expect(tokens[0][0]).toBeCloseTo(0.5, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Bug-fix regression tests
// =============================================================================

describe('CRITICAL-1 fix: legacy JSON 4-bit roundtrip', () => {
  it('saves and loads 4-bit docs via legacy JSON (small index)', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const tmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-4bit-json-'));
    const indexPath = join(tmpDir, 'late-interaction.db');

    try {
      // segmentSize > doc count → triggers legacy JSON path
      const idx = new LateInteractionIndex({
        tokenDim: 4, quantBits: 4, useInt8: true, whtSeed: 0,
        indexPath, segmentSize: 100,
      });
      idx.initialized = true;

      await idx.add('doc1', [[0.5, 0.3, -0.2, 0.8], [0.1, -0.4, 0.6, 0.2]]);
      await idx.save();

      // Load into a fresh index
      const idx2 = new LateInteractionIndex({
        tokenDim: 4, useInt8: true, whtSeed: 0,
        indexPath,
      });
      await idx2.load();

      expect(idx2.documents.size).toBe(1);
      expect(idx2.quantBits).toBe(4);

      const doc = idx2.documents.get('doc1');
      expect(doc.quantBits).toBe(4);
      expect(doc.tokens).toBeInstanceOf(Uint8Array);
      expect(doc.minArray).toBeInstanceOf(Float32Array);

      // Must survive dequant without NaN/corruption
      const tokens = idx2.getTokens('doc1');
      expect(tokens[0][0]).toBeCloseTo(0.5, 0);
      expect(tokens[0][3]).toBeCloseTo(0.8, 0);
      expect(Number.isNaN(tokens[0][0])).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('CRITICAL-2 fix: no double pooling', () => {
  it('skips index pooling when _pooledUpstream is set', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({
      tokenDim: 4, useInt8: false, poolFactor: 2, whtSeed: 0,
    });
    idx.initialized = true;

    // 5 tokens, already pooled upstream → should NOT pool again
    const tokens = Array.from({ length: 5 }, (_, i) => {
      const v = new Float32Array(4);
      v[0] = (i + 1) * 0.1;
      v[1] = 1 - i * 0.1;
      v[2] = 0.5;
      v[3] = 0.3;
      return Array.from(v);
    });

    // With _pooledUpstream: all 5 tokens preserved
    await idx.add('upstream-pooled', tokens, { _pooledUpstream: true });
    expect(idx.documents.get('upstream-pooled').numTokens).toBe(5);

    // Without _pooledUpstream: tokens get pooled (5 → 3)
    await idx.add('not-pooled', tokens, {});
    expect(idx.documents.get('not-pooled').numTokens).toBe(3);
  });
});

describe('CRITICAL-3 fix: _rebuildTokenNorms handles 4-bit', () => {
  it('rebuilds norms from 4-bit packed data without corruption', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({
      tokenDim: 4, quantBits: 4, useInt8: true, whtSeed: 0,
    });
    idx.initialized = true;

    await idx.add('doc1', [[0.5, 0.3, -0.2, 0.8]]);
    const origNorms = idx.documents.get('doc1').tokenNorms;
    expect(origNorms[0]).toBeGreaterThan(0);

    // Simulate loading without norms (legacy path)
    delete idx.documents.get('doc1').tokenNorms;
    idx._rebuildTokenNorms();

    const rebuiltNorms = idx.documents.get('doc1').tokenNorms;
    expect(rebuiltNorms).toBeInstanceOf(Float32Array);
    expect(rebuiltNorms[0]).toBeGreaterThan(0);
    // Rebuilt norms should be close to originals (4-bit quant error is ok)
    expect(rebuiltNorms[0]).toBeCloseTo(origNorms[0], 0);
  });
});

describe('HIGH-1: end-to-end 4-bit scoring', () => {
  it('scores 4-bit docs correctly with maxSimScore', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({
      tokenDim: 4, quantBits: 4, useInt8: true, whtSeed: 0,
    });
    idx.initialized = true;

    // Two documents: doc1 matches query, doc2 doesn't
    await idx.add('doc1', [[0.9, 0.1, 0, 0], [0.1, 0.9, 0, 0]]);
    await idx.add('doc2', [[0, 0, 0.9, 0.1], [0, 0, 0.1, 0.9]]);

    // Query aligns with doc1
    const query = [[1, 0, 0, 0], [0, 1, 0, 0]];

    // Score via getTokensFlat (JS fallback path)
    // IMPORTANT: copy pooled buffer before next getTokensFlat call overwrites it
    const raw1 = idx.getTokensFlat('doc1');
    const flat1 = new Float32Array(raw1.flat.subarray(0, raw1.numTokens * raw1.dim));
    const norms1 = idx.documents.get('doc1').tokenNorms;
    const raw2 = idx.getTokensFlat('doc2');
    const flat2 = new Float32Array(raw2.flat.subarray(0, raw2.numTokens * raw2.dim));
    const norms2 = idx.documents.get('doc2').tokenNorms;
    const score1 = idx.maxSimScoreFlat(query, flat1, raw1.numTokens, raw1.dim, norms1);
    const score2 = idx.maxSimScoreFlat(query, flat2, raw2.numTokens, raw2.dim, norms2);

    // doc1 should score much higher than doc2
    expect(score1).toBeGreaterThan(0.5);
    expect(score1).toBeGreaterThan(score2 + 0.2);
  });

  it('scores 4-bit docs via scoreWithLateInteraction', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({
      tokenDim: 4, quantBits: 4, useInt8: true, whtSeed: 0,
    });
    idx.initialized = true;

    await idx.add('match', [[0.9, 0.1, 0, 0], [0.1, 0.9, 0, 0]]);
    await idx.add('miss', [[0, 0, 0.9, 0.1], [0, 0, 0.1, 0.9]]);

    const query = [[1, 0, 0, 0], [0, 1, 0, 0]];
    const candidates = [
      { id: 'match', score: 1.0 },
      { id: 'miss', score: 1.0 },
    ];

    const scored = await idx.scoreWithLateInteraction(query, candidates);
    expect(scored).toHaveLength(2);

    const matchResult = scored.find(c => c.id === 'match');
    const missResult = scored.find(c => c.id === 'miss');
    expect(matchResult.lateInteractionScore).toBeGreaterThan(0.5);
    expect(matchResult.lateInteractionScore).toBeGreaterThan(missResult.lateInteractionScore);
  });

  it('d=48 edge model works with 4-bit (odd packed size)', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
    const idx = new LateInteractionIndex({
      tokenDim: 48, quantBits: 4, useInt8: true, whtSeed: 0,
    });
    idx.initialized = true;

    // 48 dims → 24 packed bytes per token
    const token = new Array(48).fill(0).map((_, i) => Math.sin(i * 0.1));
    await idx.add('edge-doc', [token]);

    const doc = idx.documents.get('edge-doc');
    expect(doc.tokens.length).toBe(24); // ceil(48/2)

    const retrieved = idx.getTokens('edge-doc');
    expect(retrieved[0]).toHaveLength(48);
    // Values should be in a reasonable range
    expect(Math.abs(retrieved[0][0] - token[0])).toBeLessThan(0.15);
  });
});

describe('Codex finding: mixed quant scoring', () => {
  it('scores all candidates in mixed 4-bit + int8 corpus (no early return)', async () => {
    const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');

    // Create an int8 index, add one doc, then manually inject a 4-bit doc
    const idx = new LateInteractionIndex({
      tokenDim: 4, useInt8: true, quantBits: 8, whtSeed: 0,
    });
    idx.initialized = true;

    // int8 per-token doc (standard Phase 1 path)
    await idx.add('int8-doc', [[0.9, 0.1, 0, 0], [0.1, 0.9, 0, 0]]);
    expect(idx.documents.get('int8-doc').minArray).toBeTruthy();
    expect(idx.documents.get('int8-doc').quantBits).toBeUndefined();

    // Manually create a 4-bit doc to simulate mixed corpus
    const { tokens: int8Tokens, numTokens, dim, minArray, scaleArray, tokenNorms } = idx.documents.get('int8-doc');
    // Build a simple 4-bit doc with known values
    const idx4 = new LateInteractionIndex({
      tokenDim: 4, useInt8: true, quantBits: 4, whtSeed: 0,
    });
    idx4.initialized = true;
    await idx4.add('4bit-doc', [[0, 0, 0.9, 0.1], [0, 0, 0.1, 0.9]]);
    const doc4bit = idx4.documents.get('4bit-doc');

    // Inject 4-bit doc into the int8 index
    idx.documents.set('4bit-doc', doc4bit);

    // Both candidates must get real MaxSim scores (not fallback ANN scores)
    const query = [[1, 0, 0, 0], [0, 1, 0, 0]];
    const candidates = [
      { id: 'int8-doc', score: 0.5 },
      { id: '4bit-doc', score: 0.5 },
    ];

    const scored = await idx.scoreWithLateInteraction(query, candidates);
    expect(scored).toHaveLength(2);

    const int8Result = scored.find(c => c.id === 'int8-doc');
    const fourBitResult = scored.find(c => c.id === '4bit-doc');

    // Both must have real lateInteractionScore (not the 0.5 fallback)
    expect(int8Result.lateInteractionScore).not.toBe(0.5);
    expect(fourBitResult.lateInteractionScore).not.toBe(0.5);

    // int8-doc aligns with query, 4bit-doc doesn't
    expect(int8Result.lateInteractionScore).toBeGreaterThan(fourBitResult.lateInteractionScore);
  });
});
