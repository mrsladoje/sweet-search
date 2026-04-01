/**
 * embedding-perf.test.js
 *
 * Benchmark harness for embedding throughput measurement.
 * Reports docs/second and estimated tokens/second.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import embeddingService from '../../core/embedding/index.js';

const { generateEmbedding, callLocalModelBucketed } = embeddingService;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTexts(count, avgLength) {
  const texts = [];
  const snippets = [
    'function process(data) { return data.map(x => x * 2).filter(x => x > 0); }',
    'const config = { host: "localhost", port: 3000, debug: true };',
    'class Handler { handle(req) { return { status: 200, body: req.body }; } }',
    'async function load(path) { const fs = require("fs"); return fs.readFileSync(path); }',
    'export default { name: "module", version: "1.0.0", main: "index.js" };',
    'if (err) { console.error(err.message); process.exit(1); }',
    'const result = arr.reduce((acc, val) => acc + val, 0);',
    'try { await db.connect(); } catch (e) { retry(e); }',
  ];
  for (let i = 0; i < count; i++) {
    const base = snippets[i % snippets.length];
    const repeats = Math.max(1, Math.ceil(avgLength / base.length));
    const text = Array(repeats).fill(base).join('\n').slice(0, avgLength + (i % 50));
    texts.push(text);
  }
  return texts;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Embedding Performance Benchmark', () => {
  beforeAll(async () => {
    // Warm up model (don't count load time)
    await generateEmbedding('warmup', 'local');
  }, 120_000);

  it('benchmark: 100 short texts (~50 chars each)', async () => {
    const texts = generateTexts(100, 50);
    const totalChars = texts.reduce((s, t) => s + t.length, 0);
    const estTokens = Math.ceil(totalChars / 4);

    const start = performance.now();
    const results = await callLocalModelBucketed(texts);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(100);

    const docsPerSec = (100 / elapsed) * 1000;
    const tokensPerSec = (estTokens / elapsed) * 1000;

    console.log(`\n  [PERF] 100 short texts (avg ${Math.round(totalChars / 100)} chars):`);
    console.log(`    Elapsed: ${elapsed.toFixed(0)}ms`);
    console.log(`    Throughput: ${docsPerSec.toFixed(1)} docs/sec`);
    console.log(`    Est tokens/sec: ${tokensPerSec.toFixed(0)}`);

    // Sanity: should complete in reasonable time
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);

  it('benchmark: 50 mixed-length texts (50-1200 chars)', async () => {
    const short = generateTexts(17, 50);
    const medium = generateTexts(17, 400);
    const long = generateTexts(16, 1200);
    const texts = [...short, ...medium, ...long];
    const totalChars = texts.reduce((s, t) => s + t.length, 0);
    const estTokens = Math.ceil(totalChars / 4);

    const start = performance.now();
    const results = await callLocalModelBucketed(texts);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(50);

    const docsPerSec = (50 / elapsed) * 1000;
    const tokensPerSec = (estTokens / elapsed) * 1000;

    console.log(`\n  [PERF] 50 mixed-length texts (avg ${Math.round(totalChars / 50)} chars):`);
    console.log(`    Elapsed: ${elapsed.toFixed(0)}ms`);
    console.log(`    Throughput: ${docsPerSec.toFixed(1)} docs/sec`);
    console.log(`    Est tokens/sec: ${tokensPerSec.toFixed(0)}`);

    expect(elapsed).toBeLessThan(300_000);
  }, 300_000);
});
