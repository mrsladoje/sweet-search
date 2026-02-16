/**
 * embedding-bucketing.test.js
 *
 * Verifies that length-sorted bucketing (L0) preserves input → output order.
 * After internal sorting by estimated token count, the returned embeddings
 * must be aligned to the original `texts[]` indices.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import embeddingService from '../core/embedding-service.js';

const { generateEmbedding, generateEmbeddings } = embeddingService;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function maxAbsDiff(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Embedding Bucketing — Order Preservation', () => {
  beforeAll(async () => {
    await generateEmbedding('warmup text', 'local');
  }, 120_000);

  it('random-length inputs get correct embeddings at correct indices', async () => {
    // Texts of deliberately varied lengths to trigger multiple buckets
    const texts = [
      'const x = 1;',                                             // ~13 chars
      'async function fetchData(url) {\n  const res = await fetch(url);\n  return res.json();\n}', // ~80 chars
      'x',                                                        // ~1 char
      'class EventEmitter {\n  constructor() { this.handlers = new Map(); }\n  on(evt, fn) { if (!this.handlers.has(evt)) this.handlers.set(evt, []); this.handlers.get(evt).push(fn); }\n  emit(evt, ...args) { for (const fn of (this.handlers.get(evt) || [])) fn(...args); }\n}', // ~270 chars
      'return a + b;',                                            // ~13 chars
    ];

    // Embed individually (reference)
    const individual = [];
    for (const text of texts) {
      individual.push(await generateEmbedding(text, 'local'));
    }

    // Embed as a batch (triggers bucketing + un-sort)
    const batched = await generateEmbeddings(texts, 'local');

    expect(batched).toHaveLength(texts.length);

    for (let i = 0; i < texts.length; i++) {
      const cos = cosineSimilarity(individual[i], batched[i]);
      const mad = maxAbsDiff(individual[i], batched[i]);
      expect(mad).toBeLessThan(3e-4);
      expect(cos).toBeGreaterThan(0.999985);
    }
  }, 120_000);

  it('duplicate strings get identical embeddings', async () => {
    const texts = [
      'function hello() { return "world"; }',
      'const pi = 3.14159265;',
      'function hello() { return "world"; }', // duplicate of [0]
    ];

    const results = await generateEmbeddings(texts, 'local');

    expect(results).toHaveLength(3);

    // Duplicates must produce bit-exact identical embeddings
    const mad = maxAbsDiff(results[0], results[2]);
    expect(mad).toBe(0);

    // The non-duplicate should differ
    const cosBetween = cosineSimilarity(results[0], results[1]);
    expect(cosBetween).toBeLessThan(0.9999);
  }, 120_000);

  it('same-length, different-string texts get different embeddings at correct positions', async () => {
    // Crafted to have identical char length but different content
    const textA = 'const add = (a, b) => a + b;'; // 29 chars
    const textB = 'const sub = (x, y) => x - y;'; // 29 chars
    expect(textA.length).toBe(textB.length);

    const texts = [textA, textB];
    const results = await generateEmbeddings(texts, 'local');

    expect(results).toHaveLength(2);

    // They should be at their correct positions
    const refA = await generateEmbedding(textA, 'local');
    const refB = await generateEmbedding(textB, 'local');

    expect(cosineSimilarity(results[0], refA)).toBeGreaterThan(0.999985);
    expect(cosineSimilarity(results[1], refB)).toBeGreaterThan(0.999985);

    // And they should differ from each other
    const cos = cosineSimilarity(results[0], results[1]);
    expect(cos).toBeLessThan(0.9999);
  }, 120_000);

  it('empty array returns empty', async () => {
    const results = await generateEmbeddings([], 'local');
    expect(results).toEqual([]);
  }, 120_000);

  it('single element works', async () => {
    const text = 'module.exports = {};';
    const [result] = await generateEmbeddings([text], 'local');
    const reference = await generateEmbedding(text, 'local');

    const cos = cosineSimilarity(result, reference);
    expect(cos).toBeGreaterThan(0.999985);
  }, 120_000);
});
