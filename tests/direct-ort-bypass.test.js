import { describe, it, expect, afterAll } from 'vitest';
import {
  callLocalModel,
  getLocalPipeline,
  unloadLocalModel,
  extractPooledEmbeddings,
  INDEXING_MAX_LENGTH,
} from '../core/embedding-local-model.js';
import { buildFeed } from '../core/ort-pipeline.js';

/**
 * Direct ORT Session — targeted coverage for:
 * - ORT session accessibility via getLocalPipeline()
 * - session.run() produces valid embeddings
 * - callLocalModel integration via direct ORT path
 * - Parity: embeddings match golden reference from pre-migration HF pipeline
 */

// Golden reference: first 8 dimensions of embeddings for deterministic test texts.
// Generated from CodeRankEmbed-onnx-int8 via the previous HF pipeline path
// and verified identical from the direct ORT path.
const GOLDEN = {
  texts: [
    'class AuthService { login(user, pass) { return jwt.sign(user); } }',
    'const x = 42;',
    'async function fetchData(url) { const r = await fetch(url); return r.json(); }',
  ],
  // First 8 dims per text (from callLocalModel with mean pooling + L2 norm)
  first8: [
    [-0.046976, -0.036271, 0.012982, 0.057200, -0.063376, 0.002288, -0.016762, -0.037775],
    [0.031663, 0.047074, 0.002133, -0.034742, 0.013492, 0.031180, -0.008112, -0.018610],
    [-0.018675, -0.005275, 0.012325, -0.007378, -0.065971, 0.008447, -0.043976, -0.008633],
  ],
  // Cosine similarities between pairs
  cos01: 0.118781,
  cos02: 0.181010,
};

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe('Direct ORT Session', () => {
  afterAll(async () => await unloadLocalModel());

  it('ORT session is accessible with run(), inputNames, outputNames', async () => {
    const { session } = await getLocalPipeline();
    expect(session).toBeDefined();
    expect(typeof session.run).toBe('function');
    expect(session.inputNames).toContain('input_ids');
    expect(session.inputNames).toContain('attention_mask');
    expect(session.outputNames.length).toBeGreaterThan(0);
  });

  it('session.run() produces valid pooled embeddings', async () => {
    const { session, tokenizer } = await getLocalPipeline();

    const tokenized = tokenizer(GOLDEN.texts, {
      padding: true,
      truncation: true,
      max_length: INDEXING_MAX_LENGTH,
    });

    const feed = buildFeed(tokenized, session.inputNames);
    const outputs = await session.run(feed);
    const pooled = extractPooledEmbeddings(outputs, tokenized.attention_mask, true);

    expect(pooled.batchSize).toBe(GOLDEN.texts.length);
    expect(pooled.dim).toBe(768);

    // Verify L2 normalization
    for (let b = 0; b < pooled.batchSize; b++) {
      let normSq = 0;
      for (let d = 0; d < pooled.dim; d++) {
        normSq += pooled.data[b * pooled.dim + d] ** 2;
      }
      expect(Math.abs(Math.sqrt(normSq) - 1.0)).toBeLessThan(1e-4);
    }
  });

  it('callLocalModel produces L2-normalized 768d embeddings', async () => {
    const embeddings = await callLocalModel([
      'function hello() { return 42; }',
      'import express from "express"; const app = express();',
    ]);
    expect(embeddings).toHaveLength(2);
    for (const emb of embeddings) {
      expect(emb).toBeInstanceOf(Float32Array);
      expect(emb.length).toBe(768);
      let normSq = 0;
      for (let d = 0; d < 768; d++) normSq += emb[d] ** 2;
      expect(Math.abs(Math.sqrt(normSq) - 1.0)).toBeLessThan(1e-4);
    }
  });

  it('parity: embeddings match golden reference from pre-migration pipeline', async () => {
    const embeddings = await callLocalModel(GOLDEN.texts);
    expect(embeddings).toHaveLength(GOLDEN.texts.length);

    // Verify first 8 dimensions match golden reference within FP32 tolerance.
    // INT8 quantized ORT inference is deterministic for the same model + inputs.
    for (let t = 0; t < GOLDEN.texts.length; t++) {
      for (let d = 0; d < 8; d++) {
        expect(embeddings[t][d]).toBeCloseTo(GOLDEN.first8[t][d], 4);
      }
    }

    // Verify cosine similarity relationships are preserved
    const cos01 = cosine(embeddings[0], embeddings[1]);
    const cos02 = cosine(embeddings[0], embeddings[2]);
    expect(cos01).toBeCloseTo(GOLDEN.cos01, 4);
    expect(cos02).toBeCloseTo(GOLDEN.cos02, 4);

    // Semantic sanity: both code snippets (0, 2) should be more similar to each
    // other than either is to the trivial assignment (1)
    expect(cos02).toBeGreaterThan(cos01);
  });
});
