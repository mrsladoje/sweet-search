/**
 * Diagnostic: measure RAW native embedding time, excluding tokenization.
 *
 * Pre-tokenize ONCE, then call embedBatch N times to measure pure inference.
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

// Build fixed inputs
const texts = Array.from({ length: 32 }, (_, i) =>
  `function test_${i}() { console.log("hello world ${i}"); return ${i} * 42; }`
);

// Pre-tokenize once
const tokenized = tokenizer(texts, { padding: true, truncation: true, max_length: 256 });
const seqLen = tokenized.input_ids.dims[1];
console.log(`Pre-tokenized: batch=${32}, seq_len=${seqLen}`);

// Convert to napi-compatible arrays ONCE
const inputIds = new Array(32);
const attentionMask = new Array(32);
for (let b = 0; b < 32; b++) {
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

console.log('\n=== Raw embedBatch timing (pre-tokenized, no conversion overhead) ===');

// Warmup
console.log('Warmup (5 calls)...');
for (let i = 0; i < 5; i++) model.embedBatch(inputIds, attentionMask);

// Measure
console.log('Measuring 20 calls...');
const times = [];
for (let i = 0; i < 20; i++) {
  const t0 = performance.now();
  model.embedBatch(inputIds, attentionMask);
  times.push(performance.now() - t0);
}

times.sort((a, b) => a - b);
const min = times[0];
const p50 = times[10];
const p95 = times[19];
const max = times[19];
console.log(`\nmin=${min.toFixed(1)}ms p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`);
console.log(`Per-item: ${(p50 / 32).toFixed(2)}ms`);
console.log(`Throughput: ${(32000 / p50).toFixed(0)} items/sec`);

// Also test small batch
console.log('\n=== Batch size scaling ===');
const sizes = [1, 4, 8, 16, 32, 64];
for (const bs of sizes) {
  const ids = inputIds.slice(0, bs);
  const masks = attentionMask.slice(0, bs);
  // Warmup
  for (let i = 0; i < 3; i++) model.embedBatch(ids, masks);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) model.embedBatch(ids, masks);
  const avg = (performance.now() - t0) / 5;
  console.log(`  batch=${bs}: ${avg.toFixed(1)}ms (${(avg / bs).toFixed(2)}ms/item, ${(bs * 1000 / avg).toFixed(0)} items/sec)`);
}
