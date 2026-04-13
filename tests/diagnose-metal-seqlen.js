/**
 * Measure how embedding time scales with seq_len (batch=32 fixed).
 */

import { getNativeEmbeddingModel } from '../core/infrastructure/native-inference.js';

const model = await getNativeEmbeddingModel();

console.log('\n=== Embedding time vs seq_len (batch=32) ===');
const BATCH = 32;

function makeInputs(seqLen) {
  const inputIds = new Array(BATCH);
  const attentionMask = new Array(BATCH);
  for (let b = 0; b < BATCH; b++) {
    const ids = new Array(seqLen);
    const mask = new Array(seqLen);
    for (let s = 0; s < seqLen; s++) {
      ids[s] = (s + b) % 30000;
      mask[s] = 1;
    }
    inputIds[b] = ids;
    attentionMask[b] = mask;
  }
  return { inputIds, attentionMask };
}

const seqLens = [32, 64, 128, 256, 384, 512];
for (const seqLen of seqLens) {
  const { inputIds, attentionMask } = makeInputs(seqLen);
  // Warmup
  for (let i = 0; i < 3; i++) await model.embedBatch(inputIds, attentionMask);
  // Measure
  const times = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await model.embedBatch(inputIds, attentionMask);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p50 = times[5];
  const totalTokens = BATCH * seqLen;
  const tokPerSec = (totalTokens * 1000 / p50).toFixed(0);
  const msPerItem = (p50 / BATCH).toFixed(2);
  console.log(`  seq_len=${seqLen.toString().padStart(4)}: p50=${p50.toFixed(1).padStart(7)}ms  (${msPerItem}ms/item, ${tokPerSec} tokens/sec)`);
}

// Also: what about the actual batch sizes used in production?
console.log('\n=== Production-like batches (token budget 16384) ===');
// The adaptive batcher uses: items × seqLen ≤ 16384
// So for seqLen=512, batch=32. For seqLen=256, batch=64.
const prodConfigs = [
  { batch: 128, seqLen: 128 },
  { batch: 64, seqLen: 256 },
  { batch: 32, seqLen: 512 },
  { batch: 64, seqLen: 128 },  // 8192 total
  { batch: 32, seqLen: 256 },  // 8192 total
  { batch: 16, seqLen: 512 },  // 8192 total
];
for (const cfg of prodConfigs) {
  const inputIds = new Array(cfg.batch);
  const attentionMask = new Array(cfg.batch);
  for (let b = 0; b < cfg.batch; b++) {
    const ids = new Array(cfg.seqLen);
    const mask = new Array(cfg.seqLen);
    for (let s = 0; s < cfg.seqLen; s++) {
      ids[s] = (s + b) % 30000;
      mask[s] = 1;
    }
    inputIds[b] = ids;
    attentionMask[b] = mask;
  }
  // Warmup
  for (let i = 0; i < 3; i++) await model.embedBatch(inputIds, attentionMask);
  const times = [];
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    await model.embedBatch(inputIds, attentionMask);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p50 = times[4];
  const totalTokens = cfg.batch * cfg.seqLen;
  const itemsPerSec = (cfg.batch * 1000 / p50).toFixed(0);
  console.log(`  batch=${cfg.batch.toString().padStart(3)} × seq=${cfg.seqLen.toString().padStart(4)} (${totalTokens} tok): p50=${p50.toFixed(0).padStart(5)}ms  (${itemsPerSec.padStart(4)} items/sec)`);
}
