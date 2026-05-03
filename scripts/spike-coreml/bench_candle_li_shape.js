/**
 * Focused LI-only bench of the candle native addon at a fixed (batch, seq).
 *
 * Used to generate the apples-to-apples comparison number against the
 * CoreML LI .mlpackage at the matching shape. The CoreML LI bench
 * (test_coreml_li_parity.py) reported p50 = 1144 ms at b32×s512 on
 * CPU_AND_NE. We need candle LI at the same shape to know the speedup.
 *
 * Usage:
 *   SWEET_SEARCH_ADDON_PATH=/path/to/sweet-search-native-*.node \
 *     node scripts/spike-coreml/bench_candle_li_shape.js <batch> <seq>
 *
 * Defaults to b=32 s=512 if not provided.
 */
import { createRequire } from 'module';
import { join } from 'path';
import { existsSync } from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);

const ADDON_PATH = process.env.SWEET_SEARCH_ADDON_PATH
  || '/Users/admin/Projects/sweet-search-private/crates/sweet-search-native/sweet-search-native.darwin-arm64.node';
const BATCH = parseInt(process.argv[2] || '32', 10);
const SEQ = parseInt(process.argv[3] || '512', 10);
const WARMUP = 3;
const ITERS = 10;

if (!existsSync(ADDON_PATH)) {
  console.error(`Addon not found: ${ADDON_PATH}`);
  process.exit(2);
}

const addon = require(ADDON_PATH);
if (!addon.NativeLateInteractionModel) {
  console.error('NativeLateInteractionModel missing from addon');
  process.exit(2);
}

console.log(`[bench-li-shape] addon: ${ADDON_PATH}`);
console.log(`[bench-li-shape] device: ${addon.nativeInferenceDevice()}  shape: b${BATCH}×s${SEQ}`);

const modelDir = join(os.homedir(), '.cache', 'sweet-search', 'models', 'lightonai--LateOn-Code');
const backbonePath = join(modelDir, 'model.safetensors');
const projPath = join(modelDir, '1_Dense', 'model.safetensors');
const configPath = join(modelDir, 'config.json');

const t0 = performance.now();
// Standard lateon-code: single 768→128 stage.
const model = addon.NativeLateInteractionModel.load(backbonePath, [projPath], [128], configPath);
console.log(`[bench-li-shape] loaded LI model in ${(performance.now() - t0).toFixed(0)} ms (dim=${model.dim})`);

// Random token IDs within the vocab range (50370 for LateOn-Code).
// Attention mask all ones — simulates the worst case where every
// position contributes to attention and output extraction. This matches
// the CoreML bench's load exactly.
const rand = (max) => Math.floor(Math.random() * max);
const inputIds = new Array(BATCH);
const attentionMask = new Array(BATCH);
for (let b = 0; b < BATCH; b++) {
  const ids = new Array(SEQ);
  const mask = new Array(SEQ);
  for (let s = 0; s < SEQ; s++) {
    ids[s] = 100 + rand(50000);
    mask[s] = 1;
  }
  inputIds[b] = ids;
  attentionMask[b] = mask;
}

console.log(`[bench-li-shape] warming up (${WARMUP} iters)…`);
for (let i = 0; i < WARMUP; i++) {
  await model.encodeBatch(inputIds, attentionMask);
}

console.log(`[bench-li-shape] running ${ITERS} timed iterations…`);
const times = [];
for (let i = 0; i < ITERS; i++) {
  const t = performance.now();
  const result = await model.encodeBatch(inputIds, attentionMask);
  times.push(performance.now() - t);
  // Touch the output so V8 can't optimize it away; the Float32Array
  // slice itself is the JS-side cost the indexer pays per batch.
  if (result.vectors.length === 0) console.log('unreachable');
}
times.sort((a, b) => a - b);
const min = times[0];
const p50 = times[Math.floor(ITERS / 2)];
const p90 = times[Math.floor(ITERS * 0.9)];
const max = times[ITERS - 1];

console.log(`\n=== candle LI @ b${BATCH}×s${SEQ} ===`);
console.log(`  iters: ${ITERS}`);
console.log(`  min:   ${min.toFixed(1)} ms`);
console.log(`  p50:   ${p50.toFixed(1)} ms`);
console.log(`  p90:   ${p90.toFixed(1)} ms`);
console.log(`  max:   ${max.toFixed(1)} ms`);
console.log(`  total: ${times.reduce((s, x) => s + x, 0).toFixed(0)} ms`);
