/**
 * Diagnostic: does Metal embedding speed depend on batch shape stability?
 *
 * Hypothesis: each new shape triggers MPS kernel recompilation, causing
 * slowdowns when batches have varying seq_len.
 *
 * Test:
 *   1. Run 20 batches with SAME shape [32, 256] — measure median time
 *   2. Run 20 batches with DIFFERENT shapes [32, 64..512] — measure median time
 *   3. Compare
 */

import { getNativeEmbeddingModel } from '../core/infrastructure/native-inference.js';
import { createTokenizer } from '../core/infrastructure/native-tokenizer.js';
import { getModelCacheDir } from '../core/infrastructure/model-fetcher.js';
import { getModelEntry } from '../core/infrastructure/model-registry.js';
import { join } from 'path';

const model = await getNativeEmbeddingModel();
if (!model) { console.error('Native model not available'); process.exit(1); }

const entry = getModelEntry('coderankembed-int8');
const tokenizer = await createTokenizer(join(getModelCacheDir(entry.hfId), 'tokenizer.json'));

// Build batches of 32 texts each
function makeBatch(texts, targetLen) {
  const tokenized = tokenizer(texts, { padding: true, truncation: true, max_length: targetLen });
  const batchSize = texts.length;
  const seqLen = tokenized.input_ids.dims[1];
  const inputIds = new Array(batchSize);
  const attentionMask = new Array(batchSize);
  for (let b = 0; b < batchSize; b++) {
    const ids = new Array(seqLen);
    const mask = new Array(seqLen);
    const base = b * seqLen;
    for (let s = 0; s < seqLen; s++) {
      ids[s] = Number(tokenized.input_ids.data[base + s]);
      mask[s] = Number(tokenized.attention_mask.data[base + s]);
    }
    inputIds[b] = ids;
    attentionMask[b] = mask;
  }
  return { inputIds, attentionMask, seqLen, batchSize };
}

const shortText = 'function hello() { return 42; }';
const longText = 'class MyClass { constructor(a, b) { this.a = a; this.b = b; } method() { return this.a + this.b; } } ' .repeat(5);
const texts = Array.from({ length: 32 }, (_, i) => i % 2 === 0 ? shortText : longText);

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    min: Math.round(sorted[0]),
    p50: Math.round(sorted[mid]),
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
    max: Math.round(sorted[sorted.length - 1]),
  };
}

console.log('\n=== Metal shape stability diagnostic ===\n');

// Warm up
console.log('Warming up (5 calls at seq_len=256)...');
for (let i = 0; i < 5; i++) {
  const b = makeBatch(texts, 256);
  model.embedBatch(b.inputIds, b.attentionMask);
}

// Test 1: 20 batches all at seq_len=256 (stable shape)
console.log('\nTest 1: 20 batches @ seq_len=256 (stable shape)');
const stableTimes = [];
for (let i = 0; i < 20; i++) {
  const b = makeBatch(texts, 256);
  const t0 = performance.now();
  model.embedBatch(b.inputIds, b.attentionMask);
  stableTimes.push(performance.now() - t0);
}
const stableStats = stats(stableTimes);
console.log(`  stable: min=${stableStats.min}ms p50=${stableStats.p50}ms p95=${stableStats.p95}ms max=${stableStats.max}ms`);

// Test 2: 20 batches with cycling shapes [64, 128, 192, 256, 320, 384, 448, 512]
console.log('\nTest 2: 20 batches @ varying seq_len (64..512)');
const varyingTimes = [];
const shapeSet = [64, 128, 192, 256, 320, 384, 448, 512];
for (let i = 0; i < 20; i++) {
  const targetLen = shapeSet[i % shapeSet.length];
  const b = makeBatch(texts, targetLen);
  const t0 = performance.now();
  model.embedBatch(b.inputIds, b.attentionMask);
  varyingTimes.push(performance.now() - t0);
}
const varyingStats = stats(varyingTimes);
console.log(`  varying: min=${varyingStats.min}ms p50=${varyingStats.p50}ms p95=${varyingStats.p95}ms max=${varyingStats.max}ms`);

// Test 3: 20 batches at seq_len=512 ONLY (stable long shape)
console.log('\nTest 3: 20 batches @ seq_len=512 (stable long shape)');
const stable512Times = [];
for (let i = 0; i < 20; i++) {
  const b = makeBatch(texts, 512);
  const t0 = performance.now();
  model.embedBatch(b.inputIds, b.attentionMask);
  stable512Times.push(performance.now() - t0);
}
const stable512Stats = stats(stable512Times);
console.log(`  stable512: min=${stable512Stats.min}ms p50=${stable512Stats.p50}ms p95=${stable512Stats.p95}ms max=${stable512Stats.max}ms`);

console.log('\n--- Summary ---');
console.log(`Stable 256:   ${stableStats.p50}ms per batch-32`);
console.log(`Varying:      ${varyingStats.p50}ms per batch-32`);
console.log(`Stable 512:   ${stable512Stats.p50}ms per batch-32`);
console.log(`\nVary penalty: ${(varyingStats.p50 / stableStats.p50).toFixed(2)}x vs stable 256`);
console.log(`512 vs 256:   ${(stable512Stats.p50 / stableStats.p50).toFixed(2)}x slower for 2x tokens`);

// First-call vs subsequent calls at varying shape — detects compilation cost
console.log('\nTest 4: First-call vs subsequent (new shape)');
const shapes = [96, 160, 224, 288, 352, 416, 480];
for (const s of shapes) {
  const b = makeBatch(texts, s);
  // First call at this shape
  const t0 = performance.now();
  model.embedBatch(b.inputIds, b.attentionMask);
  const first = performance.now() - t0;
  // Second call
  const t1 = performance.now();
  model.embedBatch(b.inputIds, b.attentionMask);
  const second = performance.now() - t1;
  // Third call
  const t2 = performance.now();
  model.embedBatch(b.inputIds, b.attentionMask);
  const third = performance.now() - t2;
  console.log(`  seq_len=${s}: first=${Math.round(first)}ms second=${Math.round(second)}ms third=${Math.round(third)}ms`);
}
