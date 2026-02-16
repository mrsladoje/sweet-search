/**
 * embedding-padding-sentinel.test.js (MANDATORY - blocks merge)
 *
 * Verifies that padding/attention_mask is applied correctly in mean pooling.
 * A short text's embedding should NOT change depending on what longer texts
 * appear in the same batch. If it does, the attention mask is not being
 * applied during mean pooling (pooling over padding tokens).
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

// ---------------------------------------------------------------------------
// Test texts
// ---------------------------------------------------------------------------

const SHORT_TEXT = 'function add(a, b) { return a + b; }';

const LONG_TEXT_1 = [
  'class DatabaseConnectionPool {',
  '  constructor(config) {',
  '    this.maxConnections = config.maxConnections || 10;',
  '    this.minConnections = config.minConnections || 2;',
  '    this.idleTimeoutMs = config.idleTimeoutMs || 30000;',
  '    this.acquireTimeoutMs = config.acquireTimeoutMs || 5000;',
  '    this.pool = [];',
  '    this.waitQueue = [];',
  '    this.activeCount = 0;',
  '  }',
  '  async acquire() {',
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
  "        reject(new Error('Connection acquire timeout'));",
  '      }, this.acquireTimeoutMs);',
  '      this.waitQueue.push({ resolve, reject, timer });',
  '    });',
  '  }',
  '  async release(conn) {',
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
  '  async createConnection() {',
  "    return { id: Math.random().toString(36).slice(2), createdAt: Date.now() };",
  '  }',
  '  async drain() {',
  "    for (const conn of this.pool) { await conn.close?.(); }",
  '    this.pool = [];',
  '  }',
  '}',
].join('\n');

const LONG_TEXT_2 = [
  'class EventBus {',
  '  constructor() {',
  '    this.listeners = new Map();',
  '    this.wildcardListeners = [];',
  '    this.maxListeners = 100;',
  '    this.eventHistory = [];',
  '    this.historyLimit = 1000;',
  '  }',
  '  on(event, handler, options = {}) {',
  '    if (!this.listeners.has(event)) {',
  '      this.listeners.set(event, []);',
  '    }',
  '    const handlers = this.listeners.get(event);',
  '    if (handlers.length >= this.maxListeners) {',
  "      console.warn('Max listeners reached for event:', event);",
  '    }',
  '    handlers.push({ handler, once: options.once || false, priority: options.priority || 0 });',
  '    handlers.sort((a, b) => b.priority - a.priority);',
  '    return () => this.off(event, handler);',
  '  }',
  '  once(event, handler, options = {}) {',
  '    return this.on(event, handler, { ...options, once: true });',
  '  }',
  '  off(event, handler) {',
  '    const handlers = this.listeners.get(event);',
  '    if (!handlers) return;',
  '    const idx = handlers.findIndex(h => h.handler === handler);',
  '    if (idx >= 0) handlers.splice(idx, 1);',
  '  }',
  '  async emit(event, payload) {',
  '    this.eventHistory.push({ event, payload, timestamp: Date.now() });',
  '    if (this.eventHistory.length > this.historyLimit) {',
  '      this.eventHistory = this.eventHistory.slice(-this.historyLimit);',
  '    }',
  '    const handlers = this.listeners.get(event) || [];',
  '    const wildcard = this.wildcardListeners;',
  '    const all = [...handlers, ...wildcard];',
  '    const toRemove = [];',
  '    for (const entry of all) {',
  '      await entry.handler(payload, event);',
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
// Tests
// ---------------------------------------------------------------------------

describe('Embedding Padding Sentinel', () => {
  beforeAll(async () => {
    await generateEmbedding('warmup text', 'local');
  }, 120_000);

  it('short text embedding is stable regardless of batch companions', async () => {
    // Embed short text alone
    const embAlone = await generateEmbedding(SHORT_TEXT, 'local');

    // Embed short text with a long companion
    const embWithLong1 = await generateEmbeddings([SHORT_TEXT, LONG_TEXT_1], 'local');

    // Embed short text with a different long companion
    const embWithLong2 = await generateEmbeddings([SHORT_TEXT, LONG_TEXT_2], 'local');

    const sim1 = cosineSimilarity(embAlone, embWithLong1[0]);
    const sim2 = cosineSimilarity(embAlone, embWithLong2[0]);

    // Per plan: cosSim > 0.999985 for the short text across different batch contexts
    expect(
      sim1,
      `Short text shifted with LONG_TEXT_1 companion: cosSim=${sim1.toFixed(8)}`
    ).toBeGreaterThan(0.999985);

    expect(
      sim2,
      `Short text shifted with LONG_TEXT_2 companion: cosSim=${sim2.toFixed(8)}`
    ).toBeGreaterThan(0.999985);
  }, 120_000);
});
