/**
 * embedding-buffer-safety.test.js (MANDATORY - blocks merge)
 *
 * Verifies that Float32Array subarray views returned by the batched
 * embedding pipeline survive across batches. After L1, each batch
 * allocates its own Float32Array pool and returns subarray views.
 * A subsequent batch must NOT overwrite a previous batch's pool.
 *
 * Rules validated (from Memory / Buffer Lifetime Policy):
 *  1. One pool per batch — pools from different batches are independent.
 *  2. Pool lifetime = max(consumer lifetimes).
 *  3. Views from different generateEmbeddings calls never share a buffer.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import embeddingService from '../core/embedding-service.js';

const { generateEmbedding, generateEmbeddings } = embeddingService;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Embedding Buffer Safety', () => {
  beforeAll(async () => {
    await generateEmbedding('warmup text', 'local');
  }, 120_000);

  it('subarray views from batch A survive after batch B is embedded', async () => {
    // Batch A
    const textsA = [
      'function greet(name) { return "Hello " + name; }',
      'const PI = 3.14159265358979;',
      'class Stack { constructor() { this.items = []; } push(x) { this.items.push(x); } }',
    ];

    const batchA = await generateEmbeddings(textsA, 'local');
    expect(batchA).toHaveLength(3);

    // Save deep copies for bit-exact comparison later
    const batchACopies = batchA.map(v => new Float32Array(v));

    // Batch B (different texts — triggers new pool allocation)
    const textsB = [
      'async function readFile(path) { return fs.readFileSync(path, "utf8"); }',
      'const TIMEOUT_MS = 30000;',
      'export default class Logger { log(msg) { console.log(msg); } }',
    ];

    const batchB = await generateEmbeddings(textsB, 'local');
    expect(batchB).toHaveLength(3);

    // Assert batch A views still hold original values (bit-exact)
    for (let i = 0; i < batchA.length; i++) {
      expect(batchA[i]).toHaveLength(batchACopies[i].length);
      for (let j = 0; j < batchA[i].length; j++) {
        expect(batchA[i][j]).toBe(batchACopies[i][j]);
      }
    }
  }, 120_000);

  it('each embedding view is a Float32Array instance', async () => {
    const results = await generateEmbeddings(
      ['const a = 1;', 'const b = 2;'],
      'local',
    );

    for (const view of results) {
      expect(view).toBeInstanceOf(Float32Array);
    }
  }, 120_000);

  it('views from different batches do not share the same underlying buffer', async () => {
    const batchA = await generateEmbeddings(
      ['let x = 10;', 'let y = 20;'],
      'local',
    );
    const batchB = await generateEmbeddings(
      ['let m = 30;', 'let n = 40;'],
      'local',
    );

    // Every view in batch A must have a different ArrayBuffer than every
    // view in batch B (independent pool allocations).
    for (const viewA of batchA) {
      for (const viewB of batchB) {
        expect(viewA.buffer).not.toBe(viewB.buffer);
      }
    }
  }, 120_000);
});
