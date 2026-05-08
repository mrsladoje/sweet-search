/**
 * Unit tests for core/prompt-optimization/decontamination/* — n-gram,
 * embedding, LLM filters. Embedder + judge are dependency-injected so the
 * tests stay hermetic.
 */

import { describe, it, expect } from 'vitest';
import { nGramDecontaminate } from '../../../core/prompt-optimization/decontamination/n-gram-filter.mjs';
import { embeddingDecontaminate } from '../../../core/prompt-optimization/decontamination/embedding-filter.mjs';
import { llmDecontaminate } from '../../../core/prompt-optimization/decontamination/llm-filter.mjs';

describe('nGramDecontaminate', () => {
  it('flags exact 50-character substring match', () => {
    const probe = { id: 'p1', needle: 'A'.repeat(60) };
    const corpus = [`prefix${'A'.repeat(50)}suffix`];
    const r = nGramDecontaminate({ probes: [probe], corpus });
    expect(r.flagged).toHaveLength(1);
    expect(r.flagged[0].id).toBe('p1');
    expect(r.flagged[0].hit.shardIndex).toBe(0);
    expect(r.clean).toHaveLength(0);
  });

  it('does not flag when match is shorter than the window', () => {
    const probe = { id: 'p1', needle: 'A'.repeat(60) };
    const corpus = [`prefix${'A'.repeat(20)}suffix`];
    const r = nGramDecontaminate({ probes: [probe], corpus });
    expect(r.flagged).toHaveLength(0);
    expect(r.clean).toEqual(['p1']);
  });

  it('skips probes shorter than the window', () => {
    const probe = { id: 'p1', needle: 'short' };
    const corpus = ['short anywhere'];
    const r = nGramDecontaminate({ probes: [probe], corpus });
    expect(r.flagged).toHaveLength(0);
    expect(r.clean).toEqual(['p1']);
  });

  it('honours a smaller windowChars', () => {
    const probe = { id: 'p1', needle: 'thirteen-chars-here' };
    const corpus = ['... thirteen-c ...'];
    const r = nGramDecontaminate({ probes: [probe], corpus, windowChars: 10 });
    expect(r.flagged).toHaveLength(1);
  });

  it('throws on bad windowChars', () => {
    expect(() => nGramDecontaminate({ probes: [], corpus: [], windowChars: 4 })).toThrow(/windowChars/);
  });
});

describe('embeddingDecontaminate', () => {
  // Deterministic ℓ2-normalised embedder: returns a known vector per text.
  function makeEmbedder(map) {
    return async (texts) => texts.map(t => normalize(map[t] ?? [1, 0, 0]));
  }
  function normalize(v) {
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return v.map(x => x / n);
  }

  it('flags probe whose nearest-neighbour cosine >= threshold', async () => {
    const embedder = makeEmbedder({
      'probe-text': [1, 0, 0],
      'corpus-near': [0.95, 0.31, 0],
      'corpus-far': [0, 1, 0],
    });
    const r = await embeddingDecontaminate({
      probes: [{ id: 'p1', needle: 'probe-text' }],
      corpusChunks: ['corpus-near', 'corpus-far'],
      embedder,
      threshold: 0.92,
    });
    expect(r.flagged).toHaveLength(1);
    expect(r.flagged[0].id).toBe('p1');
    expect(r.flagged[0].chunkIndex).toBe(0);
  });

  it('does not flag when no chunk crosses the threshold', async () => {
    const embedder = makeEmbedder({
      'probe-text': [1, 0, 0],
      'corpus-far': [0, 1, 0],
    });
    const r = await embeddingDecontaminate({
      probes: [{ id: 'p1', needle: 'probe-text' }],
      corpusChunks: ['corpus-far'],
      embedder,
      threshold: 0.5,
    });
    expect(r.flagged).toHaveLength(0);
    expect(r.clean).toEqual(['p1']);
  });

  it('throws on shape mismatch from embedder', async () => {
    const embedder = async () => [[1, 0]];
    await expect(
      embeddingDecontaminate({
        probes: [{ id: 'p1', needle: 'q' }, { id: 'p2', needle: 'r' }],
        corpusChunks: ['c1'],
        embedder,
      }),
    ).rejects.toThrow(/wrong-shape/);
  });

  it('returns clean for empty corpus', async () => {
    const r = await embeddingDecontaminate({
      probes: [{ id: 'p1', needle: 'q' }],
      corpusChunks: [],
      embedder: async () => [],
    });
    expect(r.clean).toEqual(['p1']);
  });
});

describe('llmDecontaminate', () => {
  it('flags probe when judge returns memorised=true above floor', async () => {
    const judge = async () => ({ memorised: true, confidence: 0.9 });
    const r = await llmDecontaminate({
      probes: [{ id: 'p1', query: 'q', goldAnswer: 'a' }],
      judge,
    });
    expect(r.flagged).toHaveLength(1);
    expect(r.clean).toHaveLength(0);
  });

  it('does not flag when judge confidence falls below the floor', async () => {
    const judge = async () => ({ memorised: true, confidence: 0.3 });
    const r = await llmDecontaminate({
      probes: [{ id: 'p1', query: 'q', goldAnswer: 'a' }],
      judge,
      confidenceFloor: 0.6,
    });
    expect(r.flagged).toHaveLength(0);
    expect(r.clean).toEqual(['p1']);
  });

  it('parallelises with concurrency cap and preserves stable output ordering', async () => {
    const judge = async (probe) => ({
      memorised: probe.id.startsWith('mem'),
      confidence: 1,
    });
    const probes = [
      { id: 'mem-2', query: 'q', goldAnswer: 'a' },
      { id: 'clean-1', query: 'q', goldAnswer: 'a' },
      { id: 'mem-1', query: 'q', goldAnswer: 'a' },
      { id: 'clean-2', query: 'q', goldAnswer: 'a' },
    ];
    const r = await llmDecontaminate({ probes, judge, concurrency: 2 });
    expect(r.flagged.map(f => f.id)).toEqual(['mem-1', 'mem-2']);
    expect(r.clean).toEqual(['clean-1', 'clean-2']);
  });

  it('throws on malformed judge verdict', async () => {
    const judge = async () => ({ confidence: 0.9 });
    await expect(
      llmDecontaminate({
        probes: [{ id: 'p1', query: 'q', goldAnswer: 'a' }],
        judge,
      }),
    ).rejects.toThrow(/malformed verdict/);
  });
});
