import { describe, it, expect, vi } from 'vitest';
import { LateInteractionIndex, Reranker } from '../../core/ranking/index.js';
import { SweetSearch } from '../../core/search/index.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('LateInteractionIndex.hasTokens', () => {
  it('returns Set of IDs that exist in the index', async () => {
    const index = new LateInteractionIndex({ tokenDim: 4, useInt8: false });
    // Manually populate (skip init/load)
    index.documents.set('a', { tokens: new Float32Array(4), numTokens: 1, dim: 4 });
    index.documents.set('b', { tokens: new Float32Array(4), numTokens: 1, dim: 4 });

    const result = index.hasTokens(['a', 'b', 'c', 'd']);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(2);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(false);
  });

  it('returns empty Set for empty input', () => {
    const index = new LateInteractionIndex({ tokenDim: 4 });
    expect(index.hasTokens([]).size).toBe(0);
  });

  it('returns empty Set when no documents indexed', () => {
    const index = new LateInteractionIndex({ tokenDim: 4 });
    expect(index.hasTokens(['a', 'b']).size).toBe(0);
  });
});

describe('Reranker.rerankDirect', () => {
  it('is a function on Reranker instances', () => {
    const reranker = new Reranker({
      preferVoyage: false,
      preferJina: false,
      useLocalReranker: false,
    });
    expect(typeof reranker.rerankDirect).toBe('function');
  });

  it('throws when no direct cross-encoder is available', async () => {
    const reranker = new Reranker({
      preferVoyage: false,
      preferJina: false,
      useLocalReranker: false,
    });

    const docs = ['doc1 content', 'doc2 content'];
    await expect(reranker.rerankDirect('test query', docs, 2))
      .rejects.toThrow('No direct cross-encoder available');
  });

  it('rerank() uses the direct cross-encoder path by default', async () => {
    const reranker = new Reranker({
      preferVoyage: false,
      preferJina: false,
      useLocalReranker: true,
    });

    reranker.localReranker.isAvailable = () => true;
    reranker.localReranker.rerank = vi.fn(async () => ({
      results: [{ originalIndex: 0, localRerankerScore: 0.9 }],
      latency_ms: 5,
      model: 'gte-reranker-modernbert-base-int8',
    }));
    reranker.flashRankReranker.rerank = vi.fn(async () => {
      throw new Error('flashrank should not run');
    });

    const docs = ['doc1 content'];
    const result = await reranker.rerank('test query', docs, 1);

    expect(reranker.localReranker.rerank).toHaveBeenCalledOnce();
    expect(reranker.flashRankReranker.rerank).not.toHaveBeenCalled();
    expect(result.model).toBe('gte-reranker-modernbert-base-int8');
  });
});

describe('SweetSearch cascade project config', () => {
  it('defaults cascade to DISABLED when no env or project override is present', () => {
    // Cascade (CE rerank) is off by default — measured MRR-neutral with 3×
    // latency on gencodesearchnet. Opt in via SWEET_SEARCH_CASCADE_ENABLED=true.
    const prevEnabled = process.env.SWEET_SEARCH_CASCADE_ENABLED;
    delete process.env.SWEET_SEARCH_CASCADE_ENABLED;

    try {
      const searcher = new SweetSearch({});
      expect(searcher.cascadeEnabled).toBe(false);
      searcher.close();
    } finally {
      if (prevEnabled !== undefined) process.env.SWEET_SEARCH_CASCADE_ENABLED = prevEnabled;
    }
  });

  it('reads cascade defaults from .sweet-search.config.json when env is unset', () => {
    const prevEnabled = process.env.SWEET_SEARCH_CASCADE_ENABLED;
    const prevGate = process.env.SWEET_SEARCH_CASCADE_GATE_THRESHOLD;
    const prevTopK = process.env.SWEET_SEARCH_CASCADE_CE_TOP_K;
    const prevForce = process.env.SWEET_SEARCH_FORCE_FULL_CE;

    delete process.env.SWEET_SEARCH_CASCADE_ENABLED;
    delete process.env.SWEET_SEARCH_CASCADE_GATE_THRESHOLD;
    delete process.env.SWEET_SEARCH_CASCADE_CE_TOP_K;
    delete process.env.SWEET_SEARCH_FORCE_FULL_CE;

    const tmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-cascade-config-'));
    try {
      writeFileSync(join(tmpDir, '.sweet-search.config.json'), JSON.stringify({
        cascade: {
          enabled: true,
          gateThreshold: 0.2,
          ceTopK: 5,
          forceFullCrossEncoder: true,
        },
      }));

      const searcher = new SweetSearch({ projectRoot: tmpDir });
      expect(searcher.cascadeEnabled).toBe(true);
      expect(searcher.cascadeGateThreshold).toBe(0.2);
      expect(searcher.cascadeCeTopK).toBe(5);
      expect(searcher.cascadeForceFullCE).toBe(true);
      searcher.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      process.env.SWEET_SEARCH_CASCADE_ENABLED = prevEnabled;
      process.env.SWEET_SEARCH_CASCADE_GATE_THRESHOLD = prevGate;
      process.env.SWEET_SEARCH_CASCADE_CE_TOP_K = prevTopK;
      process.env.SWEET_SEARCH_FORCE_FULL_CE = prevForce;
    }
  });
});
