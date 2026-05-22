/**
 * Unit tests for eval/agent-read-workflows/embeddings.js — Gemini Embedding 2
 * client and cosine similarity utilities.
 *
 * All HTTP is injected via `_internal.fetch`; no real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  runGeminiEmbedding2,
  buildEmbedPayload,
  parseEmbedResponse,
  cosineSimilarity,
  _internal,
} from '../../../eval/agent-read-workflows/embeddings.js';

// ─── buildEmbedPayload ───────────────────────────────────────────────────────

describe('buildEmbedPayload', () => {
  it('single=true emits embedContent shape', () => {
    const p = buildEmbedPayload({
      texts: ['hello world'],
      model: 'gemini-embedding-2-preview',
      dim: 768,
      single: true,
    });
    expect(p.model).toBe('models/gemini-embedding-2-preview');
    expect(p.content).toEqual({ parts: [{ text: 'hello world' }] });
    expect(p.outputDimensionality).toBe(768);
    expect('requests' in p).toBe(false);
  });

  it('single=false emits batchEmbedContents requests array', () => {
    const p = buildEmbedPayload({
      texts: ['a', 'b', 'c'],
      model: 'gemini-embedding-2-preview',
      dim: 512,
      single: false,
    });
    expect(Array.isArray(p.requests)).toBe(true);
    expect(p.requests).toHaveLength(3);
    expect(p.requests[0]).toEqual({
      model: 'models/gemini-embedding-2-preview',
      content: { parts: [{ text: 'a' }] },
      outputDimensionality: 512,
    });
    expect(p.requests[2].content.parts[0].text).toBe('c');
    expect('content' in p).toBe(false);
  });

  it('model is prefixed with models/ in both shapes', () => {
    const s = buildEmbedPayload({ texts: ['x'], model: 'my-model', dim: 64, single: true });
    const b = buildEmbedPayload({ texts: ['x', 'y'], model: 'my-model', dim: 64, single: false });
    expect(s.model).toBe('models/my-model');
    expect(b.requests[0].model).toBe('models/my-model');
  });
});

// ─── parseEmbedResponse ──────────────────────────────────────────────────────

describe('parseEmbedResponse', () => {
  it('single=true extracts embedding.values as number[][]', () => {
    const json = { embedding: { values: [0.1, 0.2, 0.3] } };
    expect(parseEmbedResponse(json, true)).toEqual([[0.1, 0.2, 0.3]]);
  });

  it('single=true returns [] on missing embedding', () => {
    expect(parseEmbedResponse({}, true)).toEqual([]);
    expect(parseEmbedResponse(null, true)).toEqual([]);
  });

  it('single=false extracts embeddings array as number[][]', () => {
    const json = {
      embeddings: [
        { values: [0.1, 0.2] },
        { values: [0.3, 0.4] },
      ],
    };
    expect(parseEmbedResponse(json, false)).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('single=false returns [] on missing embeddings key', () => {
    expect(parseEmbedResponse({}, false)).toEqual([]);
    expect(parseEmbedResponse(null, false)).toEqual([]);
  });

  it('single=false handles null/undefined entries gracefully (returns [])', () => {
    const json = { embeddings: [{ values: [1, 2] }, null, { values: [3, 4] }] };
    const r = parseEmbedResponse(json, false);
    expect(r[0]).toEqual([1, 2]);
    expect(r[1]).toEqual([]);   // null entry → empty array, not a crash
    expect(r[2]).toEqual([3, 4]);
  });
});

// ─── cosineSimilarity ────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('identical unit vector → 1', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it('identical non-unit vector → 1', () => {
    const v = [3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('opposite vectors → -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it('general non-trivial vectors produce correct result', () => {
    // [1,1] · [1,1] = 2, |[1,1]| = sqrt(2), cosine = 2/(sqrt(2)*sqrt(2)) = 1
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1, 10);
    // [1,0] · [0.5, 0.866] ≈ 0.5, |a|=1, |b|≈1 → cosine ≈ 0.5
    expect(cosineSimilarity([1, 0], [0.5, 0.866])).toBeCloseTo(0.5, 2);
  });

  it('mismatched lengths → 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1], [])).toBe(0);
  });

  it('zero-length arrays → 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('zero-norm vector → 0 (no NaN)', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('non-array input → 0', () => {
    expect(cosineSimilarity(null, [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], null)).toBe(0);
    expect(cosineSimilarity(undefined, undefined)).toBe(0);
  });
});

// ─── runGeminiEmbedding2 (network injected) ───────────────────────────────────

describe('runGeminiEmbedding2', () => {
  let origFetch;

  beforeEach(() => {
    origFetch = _internal.fetch;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
  });

  afterEach(() => {
    _internal.fetch = origFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  // ── single text ───────────────────────────────────────────────────────────
  it('single text → calls :embedContent and returns vector array', async () => {
    _internal.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }),
    }));
    const r = await runGeminiEmbedding2({ texts: ['hello world'] });
    expect(r.isError).toBe(false);
    expect(r.vectors).toEqual([[0.1, 0.2, 0.3]]);
    expect(typeof r.latencyMs).toBe('number');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(_internal.fetch).toHaveBeenCalledWith(
      expect.stringContaining(':embedContent'),
      expect.anything(),
    );
  });

  // ── multiple texts ────────────────────────────────────────────────────────
  it('two texts → calls :batchEmbedContents and returns two vectors', async () => {
    _internal.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        embeddings: [
          { values: [0.1, 0.2] },
          { values: [0.3, 0.4] },
        ],
      }),
    }));
    const r = await runGeminiEmbedding2({ texts: ['a', 'b'] });
    expect(r.isError).toBe(false);
    expect(r.vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(_internal.fetch).toHaveBeenCalledWith(
      expect.stringContaining(':batchEmbedContents'),
      expect.anything(),
    );
  });

  // ── batching ──────────────────────────────────────────────────────────────
  it('chunks large requests into multiple batches', async () => {
    // 5 texts with batch=3 → 2 fetch calls (3 + 2)
    _internal.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: [{ values: [1] }, { values: [2] }, { values: [3] }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: [{ values: [4] }, { values: [5] }],
        }),
      });

    const texts = Array.from({ length: 5 }, (_, i) => `text-${i}`);
    const r = await runGeminiEmbedding2({ texts, batch: 3 });
    expect(r.isError).toBe(false);
    expect(r.vectors).toHaveLength(5);
    expect(r.vectors[0]).toEqual([1]);
    expect(r.vectors[4]).toEqual([5]);
    expect(_internal.fetch).toHaveBeenCalledTimes(2);
  });

  it('exact batch boundary (6 texts, batch=3) → exactly 2 fetches', async () => {
    _internal.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [{ values: [1] }, { values: [2] }, { values: [3] }],
      }),
    });
    const texts = Array.from({ length: 6 }, (_, i) => `t${i}`);
    const r = await runGeminiEmbedding2({ texts, batch: 3 });
    expect(r.isError).toBe(false);
    expect(_internal.fetch).toHaveBeenCalledTimes(2);
  });

  // ── error handling ────────────────────────────────────────────────────────
  it('non-OK response → isError with status', async () => {
    _internal.fetch = vi.fn(async () => ({
      ok: false, status: 403,
      text: async () => 'forbidden',
    }));
    const r = await runGeminiEmbedding2({ texts: ['x'] });
    expect(r.isError).toBe(true);
    expect(r.raw.status).toBe(403);
    expect(r.vectors).toEqual([]);
  });

  it('non-OK on second batch → isError with batchIndex', async () => {
    _internal.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embeddings: [{ values: [1, 2] }, { values: [3, 4] }] }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 503,
        text: async () => 'service unavailable',
      });
    const texts = Array.from({ length: 4 }, (_, i) => `t${i}`);
    const r = await runGeminiEmbedding2({ texts, batch: 2 });
    expect(r.isError).toBe(true);
    expect(r.raw.batchIndex).toBe(1);
  });

  // ── key resolution ────────────────────────────────────────────────────────
  it('uses GEMINI_API_KEY in the request URL', async () => {
    _internal.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: { values: [0.5] } }),
    }));
    await runGeminiEmbedding2({ texts: ['x'] });
    const url = _internal.fetch.mock.calls[0][0];
    expect(url).toContain('test-gemini-key');
  });

  it('falls back to GOOGLE_API_KEY when GEMINI_API_KEY is absent', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = 'google-fallback-key';
    _internal.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: { values: [1, 2] } }),
    }));
    const r = await runGeminiEmbedding2({ texts: ['x'] });
    expect(r.isError).toBe(false);
    const url = _internal.fetch.mock.calls[0][0];
    expect(url).toContain('google-fallback-key');
  });

  it('errors (isError) when no API key is set at all', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const r = await runGeminiEmbedding2({ texts: ['x'] });
    expect(r.isError).toBe(true);
    expect(r.raw.error).toMatch(/GEMINI_API_KEY/);
  });

  it('errors on empty texts array', async () => {
    const r = await runGeminiEmbedding2({ texts: [] });
    expect(r.isError).toBe(true);
    expect(r.raw.error).toMatch(/non-empty/);
  });

  it('default model is gemini-embedding-2-preview', async () => {
    _internal.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: { values: [0.1] } }),
    }));
    await runGeminiEmbedding2({ texts: ['x'] });
    const url = _internal.fetch.mock.calls[0][0];
    expect(url).toContain('gemini-embedding-2-preview');
  });

  it('passes outputDimensionality from dim option', async () => {
    _internal.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: { values: [0.1] } }),
    }));
    await runGeminiEmbedding2({ texts: ['x'], dim: 512 });
    const body = JSON.parse(_internal.fetch.mock.calls[0][1].body);
    expect(body.outputDimensionality).toBe(512);
  });

  it('result includes latencyMs', async () => {
    _internal.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: { values: [0.5] } }),
    }));
    const r = await runGeminiEmbedding2({ texts: ['x'] });
    expect(typeof r.latencyMs).toBe('number');
  });
});
