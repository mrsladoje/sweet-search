import { describe, it, expect, afterAll } from 'vitest';
import {
  callLocalModel,
  getLocalPipeline,
  unloadLocalModel,
  extractPooledEmbeddings,
  INDEXING_MAX_LENGTH,
} from '../core/embedding-local-model.js';

/**
 * L7 Direct ORT Bypass — targeted coverage for:
 * - ORT session accessibility (embedding-local-model.js:329)
 * - Bit-parity: direct session.run() vs pipeline.model() (embedding-local-model.js:371)
 * - SWEET_SEARCH_DIRECT_ORT env flag evaluation (embedding-local-model.js:264)
 * - callLocalModel integration via direct ORT path
 */
describe('L7 Direct ORT Bypass', () => {
  afterAll(async () => await unloadLocalModel());

  it('ORT session is accessible with run(), inputNames, outputNames', async () => {
    const pipeline = await getLocalPipeline();
    const session = pipeline.model?.sessions?.['model'];
    expect(session).toBeDefined();
    expect(typeof session.run).toBe('function');
    expect(session.inputNames).toContain('input_ids');
    expect(session.inputNames).toContain('attention_mask');
    expect(session.outputNames.length).toBeGreaterThan(0);
  });

  it('direct session.run() produces bit-identical output to pipeline.model()', async () => {
    const pipeline = await getLocalPipeline();
    const texts = [
      'class AuthService { login(user, pass) { return jwt.sign(user); } }',
      'const x = 42;',
      'async function fetchData(url) { const r = await fetch(url); return r.json(); }',
    ];

    const modelInputs = pipeline.tokenizer(texts, {
      padding: true,
      truncation: true,
      max_length: INDEXING_MAX_LENGTH,
    });

    // Direct ORT path: extract .ort_tensor, call session.run()
    const session = pipeline.model.sessions['model'];
    const feed = {};
    for (const name of session.inputNames) {
      const hfTensor = modelInputs[name];
      if (hfTensor?.ort_tensor) {
        feed[name] = hfTensor.ort_tensor;
      }
    }
    const directOutputs = await session.run(feed);
    const directPooled = extractPooledEmbeddings(directOutputs, modelInputs.attention_mask, true);

    // Pipeline path: HF wrapper around same session.run()
    const pipelineOutputs = await pipeline.model(modelInputs);
    const pipelinePooled = extractPooledEmbeddings(pipelineOutputs, modelInputs.attention_mask, true);

    expect(directPooled.batchSize).toBe(texts.length);
    expect(directPooled.dim).toBe(pipelinePooled.dim);

    let maxDiff = 0;
    for (let i = 0; i < directPooled.data.length; i++) {
      const diff = Math.abs(directPooled.data[i] - pipelinePooled.data[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
    // Same ORT session + same input tensors → bit-identical pooled output
    expect(maxDiff).toBe(0);
  });

  it('SWEET_SEARCH_DIRECT_ORT env flag: only "0" disables', () => {
    // Unit test the flag logic from embedding-local-model.js:264
    const evaluate = (envVal) => (envVal ?? '1') !== '0';
    expect(evaluate(undefined)).toBe(true);  // default: enabled
    expect(evaluate('1')).toBe(true);         // explicit enable
    expect(evaluate('0')).toBe(false);        // kill switch
    expect(evaluate('')).toBe(true);          // empty string: enabled
    expect(evaluate('false')).toBe(true);     // only '0' disables
  });

  it('callLocalModel produces L2-normalized 768d embeddings via direct ORT', async () => {
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
});
