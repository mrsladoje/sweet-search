import { describe, it, expect, vi } from 'vitest';
import { LateInteractionIndex } from '../core/late-interaction-index.js';
import { Reranker } from '../core/flashrank.js';
import { SweetSearch } from '../core/sweet-search.js';
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
});

describe('SweetSearch cascade project config', () => {
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
