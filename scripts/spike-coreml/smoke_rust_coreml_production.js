/**
 * Production-path CoreML smoke test.
 *
 * Loads the real NativeEmbeddingModel / NativeLateInteractionModel
 * napi exports with SWEET_SEARCH_COREML_EMBED_MLPACKAGE and
 * SWEET_SEARCH_COREML_LI_MLPACKAGE set. This exercises:
 *   1. The env-var-gated CoreML backend load
 *   2. The startup parity check against candle
 *   3. One embed_batch / encode_batch call through the CoreML fast path
 *   4. Fallback to candle for a batch-size that does not fit (batch=64)
 *
 * Unlike smoke_rust_coreml.js (which called coremlShimSmokeTest), this
 * script hits the exact code path the sweet-search indexer uses.
 */
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ADDON = join(ROOT, 'crates', 'sweet-search-native', 'sweet-search-native.darwin-arm64.node');

const nomicPkg = join(HERE, 'artifacts', 'nomic_bert_b32_s512_fp16.mlpackage');
const liPkg = join(HERE, 'artifacts', 'li_modernbert_b32_s512_fp16.mlpackage');

process.env.SWEET_SEARCH_COREML_EMBED_MLPACKAGE = nomicPkg;
process.env.SWEET_SEARCH_COREML_LI_MLPACKAGE = liPkg;

const addon = require(ADDON);
console.log(`addon loaded: ${ADDON}`);

const embedModelDir = '/Users/admin/.cache/sweet-search/models/nomic-ai--CodeRankEmbed';
const embedSafetensors = join(embedModelDir, 'model.safetensors');
const embedConfig = join(embedModelDir, 'config.json');

const liModelDir = '/Users/admin/.cache/sweet-search/models/lightonai--LateOn-Code';
const liBackbone = join(liModelDir, 'model.safetensors');
const liProjection = join(liModelDir, '1_Dense', 'model.safetensors');
const liConfig = join(liModelDir, 'config.json');

console.log('\n──── NativeEmbeddingModel.load (with CoreML) ────');
const t0 = Date.now();
const embedModel = addon.NativeEmbeddingModel.load(embedSafetensors, embedConfig);
console.log(`  load total: ${Date.now() - t0} ms, dim: ${embedModel.dim}`);

console.log('\n──── NativeLateInteractionModel.load (with CoreML) ────');
const t1 = Date.now();
const liModel = addon.NativeLateInteractionModel.load(liBackbone, liProjection, liConfig);
console.log(`  load total: ${Date.now() - t1} ms, dim: ${liModel.dim}`);

// Build a 4×16 batch (fits b32×s512 → CoreML fast path).
const batch = 4;
const seq = 16;
const inputIds = Array.from({ length: batch }, (_, b) => {
  const row = new Array(seq).fill(0);
  row[0] = 101;
  for (let i = 1; i < seq - 1; i++) row[i] = 100 + i + b * 10;
  row[seq - 1] = 102;
  return row;
});
const attentionMask = Array.from({ length: batch }, () => new Array(seq).fill(1));

console.log('\n──── embed_batch b4×s16 (CoreML fast path) ────');
const tE = Date.now();
const embedFlat = await embedModel.embedBatch(inputIds, attentionMask);
console.log(`  predict: ${Date.now() - tE} ms, length: ${embedFlat.length}`);
console.log(`  expected: ${batch * embedModel.dim}`);
const firstVec = embedFlat.slice(0, 8);
const nonZero = embedFlat.some(v => v !== 0 && Number.isFinite(v));
console.log(`  first 8:  [${Array.from(firstVec).map(v => v.toFixed(5)).join(', ')}]`);
console.log(`  ${nonZero ? 'PASS — non-zero finite embedding output' : 'FAIL — embedding output looks wrong'}`);

console.log('\n──── encode_batch b4×s16 (CoreML fast path) ────');
const tL = Date.now();
const liResult = await liModel.encodeBatch(inputIds, attentionMask);
console.log(`  predict: ${Date.now() - tL} ms`);
console.log(`  vectors: ${liResult.vectors.length}, tokenCounts: [${liResult.tokenCounts.join(', ')}]`);
const expectedLi = batch * seq * liModel.dim;
console.log(`  expected: ${expectedLi} (active = all 16 tokens per row × ${batch} batches × ${liModel.dim} dim)`);
const liFirst = liResult.vectors.slice(0, 8);
const liNonZero = liResult.vectors.some(v => v !== 0 && Number.isFinite(v));
console.log(`  first 8:  [${Array.from(liFirst).map(v => v.toFixed(5)).join(', ')}]`);
console.log(`  ${liNonZero ? 'PASS — non-zero finite LI output' : 'FAIL — LI output looks wrong'}`);

// Oversized batch: b64 > MAX_BATCH=32 → must fall back to candle, not error.
console.log('\n──── embed_batch b64×s16 (candle fallback) ────');
const bigInputs = Array.from({ length: 64 }, () => inputIds[0]);
const bigMask = Array.from({ length: 64 }, () => attentionMask[0]);
const tF = Date.now();
try {
  const fallbackFlat = await embedModel.embedBatch(bigInputs, bigMask);
  console.log(`  predict: ${Date.now() - tF} ms, length: ${fallbackFlat.length}`);
  console.log(`  ${fallbackFlat.length === 64 * embedModel.dim ? 'PASS — candle fallback produced correct shape' : 'FAIL — wrong shape'}`);
} catch (e) {
  console.error(`  FAIL — oversized batch errored: ${e.message}`);
  process.exit(1);
}

if (nonZero && liNonZero) {
  console.log('\n✓ Production CoreML smoke test PASSED.');
  process.exit(0);
} else {
  console.error('\n✗ Production CoreML smoke test FAILED.');
  process.exit(1);
}
