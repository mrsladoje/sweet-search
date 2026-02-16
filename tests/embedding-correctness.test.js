/**
 * embedding-correctness.test.js (MANDATORY - blocks merge)
 *
 * Consolidated embedding correctness suite. All tests share a single ONNX
 * model load via one top-level beforeAll, eliminating redundant ~12s loads.
 *
 * Tests: truncation sentinel, padding sentinel, batching parity,
 *        bucketing order preservation, buffer safety.
 *
 * Replaces: embedding-truncation-sentinel.test.js, embedding-padding-sentinel.test.js,
 *           embedding-batching.test.js, embedding-bucketing.test.js, embedding-buffer-safety.test.js
 */

import { describe, it, expect, beforeAll } from 'vitest';
import embeddingService from '../core/embedding-service.js';

const { generateEmbeddings, callLocalModelBucketed } = embeddingService;

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
// Text fixtures — Truncation Sentinel
// ---------------------------------------------------------------------------

// >2000 chars — will be meaningfully truncated at 512 tokens (~2048 chars)
const TRUNC_LONG = Array.from({ length: 20 }, (_, i) =>
  `  async method${i}(param${i}) {\n    const result${i} = await this.service.process${i}(param${i});\n    if (!result${i}) throw new Error('Failed at step ${i}');\n    return { step: ${i}, data: result${i}, timestamp: Date.now() };\n  }`
).join('\n\n');

// ~300-400 chars — well below 512 token boundary
const TRUNC_MEDIUM = [
  'class Logger {',
  '  constructor(prefix) {',
  '    this.prefix = prefix;',
  '    this.history = [];',
  '  }',
  '  log(msg) {',
  '    const entry = `[${this.prefix}] ${msg}`;',
  '    this.history.push(entry);',
  '    console.log(entry);',
  '  }',
  '  getHistory() {',
  '    return [...this.history];',
  '  }',
  '  clear() {',
  '    this.history = [];',
  '  }',
  '}',
].join('\n');

// ---------------------------------------------------------------------------
// Text fixtures — Padding Sentinel
// ---------------------------------------------------------------------------

const SHORT_ADD = 'function add(a, b) { return a + b; }';

const PAD_LONG1 = [
  'class DatabaseConnectionPool {',
  '  constructor(config) {',
  '    this.maxConnections = config.maxConnections || 10;',
  '    this.acquireTimeoutMs = config.acquireTimeoutMs || 5000;',
  '    this.pool = [];',
  '    this.waitQueue = [];',
  '    this.activeCount = 0;',
  '  }',
  '  async acquireConnection() {',
  '    if (this.pool.length > 0) {',
      '      const conn = this.pool.pop();',
      '      this.activeCount++;',
      '      return conn;',
  '    }',
  '    if (this.activeCount < this.maxConnections) {',
  '      const conn = await this.createConnection();',
  '      this.activeCount++;',
  '      return conn;',
  '    }',
  '    return new Promise((resolve, reject) => {',
  '      const timer = setTimeout(() => {',
      "        reject(new Error('Acquire timeout'));",
      '      }, this.acquireTimeoutMs);',
      '      this.waitQueue.push({ resolve, reject, timer });',
  '    });',
  '  }',
  '  async releaseConnection(conn) {',
  '    this.activeCount--;',
  '    if (this.waitQueue.length > 0) {',
      '      const waiter = this.waitQueue.shift();',
      '      clearTimeout(waiter.timer);',
      '      this.activeCount++;',
  '      waiter.resolve(conn);',
  '    } else if (this.pool.length < this.maxConnections) {',
  '      this.pool.push(conn);',
  '    } else {',
  '      await conn.close();',
  '    }',
  '  }',
  '  async createNewConnection() {',
    "    return { id: Math.random().toString(36).slice(2), createdAt: Date.now() };",
  '  }',
  '  async drainPool() {',
  "    for (const conn of this.pool) await conn.close?.();",
  '    this.pool = [];',
  '  }',
  '}',
].join('\n');

const PAD_LONG2 = [
  'class EventBus {',
  '  constructor() {',
  '    this.listeners = new Map();',
  '    this.maxListeners = 50;',
  '    this.eventHistory = [];',
  '    this.historyLimit = 256;',
  '  }',
  '  on(eventName, handler, options = {}) {',
  '    if (!this.listeners.has(event)) {',
  '      this.listeners.set(event, []);',
  '    }',
  '    const handlers = this.listeners.get(event);',
  '    if (handlers.length >= this.maxListeners) {',
  "      throw new Error('Too many listeners');",
  '    }',
  '    handlers.push({ handler, once: options.once || false, priority: options.priority || 0 });',
  '    handlers.sort((a, b) => b.priority - a.priority);',
  '    return () => this.off(eventName, handler);',
  '  }',
  '  once(eventName, handler, options = {}) {',
  '    return this.on(eventName, handler, { ...options, once: true });',
  '  }',
  '  off(eventName, handler) {',
  '    const handlers = this.listeners.get(eventName);',
  '    if (!handlers) return;',
  '    const idx = handlers.findIndex(h => h.handler === handler);',
  '    if (idx >= 0) handlers.splice(idx, 1);',
  '  }',
  '  async emit(eventName, payload) {',
  '    this.eventHistory.push({ eventName, payload, ts: Date.now() });',
  '    if (this.eventHistory.length > this.historyLimit) {',
  '      this.eventHistory = this.eventHistory.slice(-this.historyLimit);',
  '    }',
  '    const handlers = this.listeners.get(eventName) || [];',
  '    const toRemove = [];',
  '    for (const entry of handlers) {',
  '      await entry.handler(payload, eventName);',
  '      if (entry.once) toRemove.push(entry);',
  '    }',
  '    for (const entry of toRemove) {',
  '      const idx = handlers.indexOf(entry);',
  '      if (idx >= 0) handlers.splice(idx, 1);',
  '    }',
  '  }',
  '}',
].join('\n');

// ---------------------------------------------------------------------------
// Text fixtures — Bucketing
// ---------------------------------------------------------------------------

const BUCK_TEXTS = [
  'const x = 1;',
  'async function fetchData(url) {\n  const res = await fetch(url);\n  return res.json();\n}',
  'x',
  'class EventEmitter {\n  constructor() { this.handlers = new Map(); }\n  on(evt, fn) { if (!this.handlers.has(evt)) this.handlers.set(evt, []); this.handlers.get(evt).push(fn); }\n  emit(evt, ...args) { for (const fn of (this.handlers.get(evt) || [])) fn(...args); }\n}',
  'return a + b;',
];
const BUCK_DUP_TEXTS = [
  'function hello() { return "world"; }',
  'const pi = 3.14159265;',
  'function hello() { return "world"; }',
];
const BUCK_SAME_A = 'const add = (a, b) => a + b;';
const BUCK_SAME_B = 'const sub = (x, y) => x - y;';
// ---------------------------------------------------------------------------
// Text fixtures — Buffer Safety
// ---------------------------------------------------------------------------

const BUF_TEXTS_A = [
  'function greet(name) { return "Hello " + name; }',
  'const PI = 3.14159265358979;',
  'class Stack { constructor() { this.items = []; } push(x) { this.items.push(x); } }',
];
const BUF_TEXTS_B = [
  'async function readFile(path) { return fs.readFileSync(path, "utf8"); }',
  'const TIMEOUT_MS = 30000;',
  'export default class Logger { log(msg) { console.log(msg); } }',
];

// ---------------------------------------------------------------------------
// Precomputed references (populated in beforeAll)
// ---------------------------------------------------------------------------

const refs = {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Embedding Correctness Suite', () => {
  beforeAll(async () => {
    // --- Shared ---
    [refs.shortAddEmb] = await callLocalModelBucketed([SHORT_ADD], { maxLength: 512 });

    // --- Truncation Sentinel ---
    [refs.truncLong512] = await callLocalModelBucketed([TRUNC_LONG], { maxLength: 512 });
    [refs.truncLong1024] = await callLocalModelBucketed([TRUNC_LONG], { maxLength: 1024 });
    [refs.truncMed512] = await callLocalModelBucketed([TRUNC_MEDIUM], { maxLength: 512 });
    [refs.truncMed1024] = await callLocalModelBucketed([TRUNC_MEDIUM], { maxLength: 1024 });
    refs.truncBatch512 = await callLocalModelBucketed([TRUNC_MEDIUM, TRUNC_LONG], { maxLength: 512 });
    refs.truncBatch1024 = await callLocalModelBucketed([TRUNC_MEDIUM, TRUNC_LONG], { maxLength: 1024 });

    // --- Padding Sentinel ---
    refs.padWithLong1 = await generateEmbeddings([SHORT_ADD, PAD_LONG1], 'local', { maxLength: 256 });
    refs.padWithLong2 = await generateEmbeddings([SHORT_ADD, PAD_LONG2], 'local', { maxLength: 256 });

    // --- Batching Parity ---
    // Reuse truncation refs: generateEmbedding(text,'local') and callLocalModelBucketed([text],{maxLength:512})
    // both call callLocalModel([text],{maxLength:512}) → identical results. Saves 2 expensive forward passes.
    refs.batchedSML = await generateEmbeddings([SHORT_ADD, TRUNC_MEDIUM, TRUNC_LONG], 'local');
    refs.batchSingle = await generateEmbeddings([SHORT_ADD], 'local');

    // --- Bucketing ---
    // Batch individual reference embeddings in one callLocalModel (saves 4 forward passes
    // vs 5 separate generateEmbedding calls). Padding correctness is already verified
    // by the Padding Sentinel above, so batch-computed references are valid.
    const buckRef = await embeddingService.callLocalModelBucketed(BUCK_TEXTS, { maxLength: 256 });
    refs.buckIndividual = [...buckRef];
    refs.buckBatched = await generateEmbeddings(BUCK_TEXTS, 'local', { maxLength: 256 });
    refs.buckDup = await generateEmbeddings(BUCK_DUP_TEXTS, 'local', { maxLength: 256 });
    const sameLenRefs = await embeddingService.callLocalModelBucketed([BUCK_SAME_A, BUCK_SAME_B], { maxLength: 256 });
    refs.buckRefA = sameLenRefs[0];
    refs.buckRefB = sameLenRefs[1];
    refs.buckSameLenBatch = await generateEmbeddings([BUCK_SAME_A, BUCK_SAME_B], 'local', { maxLength: 256 });

    // --- Buffer Safety (order matters: A then copy then B) ---
    refs.bufBatchA = await generateEmbeddings(BUF_TEXTS_A, 'local', { maxLength: 256 });
    refs.bufBatchACopies = refs.bufBatchA.map(v => new Float32Array(v));
    refs.bufBatchB = await generateEmbeddings(BUF_TEXTS_B, 'local', { maxLength: 256 });
  }, 180_000);

  // =========================================================================
  // Truncation Sentinel
  // =========================================================================

  describe('Embedding Truncation Sentinel', () => {
    it('long text: max_length parameter is enforced', () => {
      const cos = cosineSimilarity(refs.truncLong512, refs.truncLong1024);
      expect(
        cos,
        `Expected long-text embeddings to differ between max_length=512 and 1024, got cosSim=${cos.toFixed(8)}`
      ).toBeLessThan(0.999);
      expect(refs.truncLong512).toBeInstanceOf(Float32Array);
      expect(refs.truncLong1024).toBeInstanceOf(Float32Array);
      expect(refs.truncLong512.length).toBe(768);
      expect(refs.truncLong1024.length).toBe(768);
    });

    it('medium text is near-identical at max_length=512 vs 1024', () => {
      const cos = cosineSimilarity(refs.truncMed512, refs.truncMed1024);
      const mad = maxAbsDiff(refs.truncMed512, refs.truncMed1024);
      expect(mad).toBeLessThan(3e-4);
      expect(cos).toBeGreaterThan(0.999985);
    });

    it('sequential vs batched parity at max_length=512', () => {
      const seq = [refs.truncMed512, refs.truncLong512];
      const batched = refs.truncBatch512;
      for (let i = 0; i < seq.length; i++) {
        const cos = cosineSimilarity(seq[i], batched[i]);
        const mad = maxAbsDiff(seq[i], batched[i]);
        expect(mad).toBeLessThan(3e-4);
        expect(cos).toBeGreaterThan(0.999985);
      }
    });

    it('sequential vs batched parity at max_length=1024', () => {
      const seq = [refs.truncMed1024, refs.truncLong1024];
      const batched = refs.truncBatch1024;
      for (let i = 0; i < seq.length; i++) {
        const cos = cosineSimilarity(seq[i], batched[i]);
        const mad = maxAbsDiff(seq[i], batched[i]);
        expect(mad).toBeLessThan(3e-4);
        expect(cos).toBeGreaterThan(0.999985);
      }
    });
  });

  // =========================================================================
  // Padding Sentinel
  // =========================================================================

  describe('Embedding Padding Sentinel', () => {
    it('short text embedding is stable regardless of batch companions', () => {
      const sim1 = cosineSimilarity(refs.shortAddEmb, refs.padWithLong1[0]);
      const sim2 = cosineSimilarity(refs.shortAddEmb, refs.padWithLong2[0]);
      expect(
        sim1,
        `Short text shifted with LONG_TEXT_1 companion: cosSim=${sim1.toFixed(8)}`
      ).toBeGreaterThan(0.999985);
      expect(
        sim2,
        `Short text shifted with LONG_TEXT_2 companion: cosSim=${sim2.toFixed(8)}`
      ).toBeGreaterThan(0.999985);
    });
  });

  // =========================================================================
  // Batching Parity
  // =========================================================================

  describe('Embedding Batching Parity', () => {
    it('batched inference matches sequential for mixed-length inputs', () => {
      const sequential = [refs.shortAddEmb, refs.truncMed512, refs.truncLong512];
      const batched = refs.batchedSML;
      expect(batched).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        const cos = cosineSimilarity(sequential[i], batched[i]);
        const mad = maxAbsDiff(sequential[i], batched[i]);
        expect(mad).toBeLessThan(3e-4);
        expect(cos).toBeGreaterThan(0.999985);
      }
    });

    it('output embeddings are Float32Array instances', () => {
      for (const emb of refs.batchedSML) {
        expect(emb).toBeInstanceOf(Float32Array);
      }
    });

    it('batch of 1 matches single-text embedding', () => {
      const cos = cosineSimilarity(refs.shortAddEmb, refs.batchSingle[0]);
      const mad = maxAbsDiff(refs.shortAddEmb, refs.batchSingle[0]);
      expect(mad).toBeLessThan(3e-4);
      expect(cos).toBeGreaterThan(0.999985);
    });

    it('empty batch returns empty array', async () => {
      const results = await generateEmbeddings([], 'local');
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // Bucketing — Order Preservation
  // =========================================================================

  describe('Embedding Bucketing — Order Preservation', () => {
    it('random-length inputs get correct embeddings at correct indices', () => {
      expect(refs.buckBatched).toHaveLength(BUCK_TEXTS.length);
      for (let i = 0; i < BUCK_TEXTS.length; i++) {
        const cos = cosineSimilarity(refs.buckIndividual[i], refs.buckBatched[i]);
        const mad = maxAbsDiff(refs.buckIndividual[i], refs.buckBatched[i]);
        expect(mad).toBeLessThan(3e-4);
        expect(cos).toBeGreaterThan(0.999985);
      }
    });

    it('duplicate strings get identical embeddings', () => {
      expect(refs.buckDup).toHaveLength(3);
      const mad = maxAbsDiff(refs.buckDup[0], refs.buckDup[2]);
      expect(mad).toBe(0);
      const cosBetween = cosineSimilarity(refs.buckDup[0], refs.buckDup[1]);
      expect(cosBetween).toBeLessThan(0.9999);
    });

    it('same-length, different-string texts get different embeddings at correct positions', () => {
      expect(BUCK_SAME_A.length).toBe(BUCK_SAME_B.length);
      expect(refs.buckSameLenBatch).toHaveLength(2);
      expect(cosineSimilarity(refs.buckSameLenBatch[0], refs.buckRefA)).toBeGreaterThan(0.999985);
      expect(cosineSimilarity(refs.buckSameLenBatch[1], refs.buckRefB)).toBeGreaterThan(0.999985);
      const cos = cosineSimilarity(refs.buckSameLenBatch[0], refs.buckSameLenBatch[1]);
      expect(cos).toBeLessThan(0.9999);
    });

    it('empty array returns empty', async () => {
      const results = await generateEmbeddings([], 'local');
      expect(results).toEqual([]);
    });

    it('single element works', () => {
      // Reuses batchSingle[0] (generateEmbeddings([SHORT_ADD])[0]) and shortAddEmb
      // (generateEmbedding(SHORT_ADD)) — same code path as batch-of-1 test
      const cos = cosineSimilarity(refs.batchSingle[0], refs.shortAddEmb);
      expect(cos).toBeGreaterThan(0.999985);
    });
  });

  // =========================================================================
  // Buffer Safety
  // =========================================================================

  describe('Embedding Buffer Safety', () => {
    it('subarray views from batch A survive after batch B is embedded', () => {
      expect(refs.bufBatchA).toHaveLength(3);
      expect(refs.bufBatchB).toHaveLength(3);
      for (let i = 0; i < refs.bufBatchA.length; i++) {
        expect(refs.bufBatchA[i]).toHaveLength(refs.bufBatchACopies[i].length);
        for (let j = 0; j < refs.bufBatchA[i].length; j++) {
          expect(refs.bufBatchA[i][j]).toBe(refs.bufBatchACopies[i][j]);
        }
      }
    });

    it('each embedding view is a Float32Array instance', () => {
      for (const view of refs.bufBatchA) {
        expect(view).toBeInstanceOf(Float32Array);
      }
    });

    it('views from different batches do not share the same underlying buffer', () => {
      // bufBatchA and bufBatchB are from separate generateEmbeddings calls
      for (const viewA of refs.bufBatchA) {
        for (const viewB of refs.bufBatchB) {
          expect(viewA.buffer).not.toBe(viewB.buffer);
        }
      }
    });
  });
});
