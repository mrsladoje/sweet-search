/**
 * Proof-of-life: Rust Objective-C CoreML shim, called via the napi addon.
 *
 * Loads the NomicBERT b32×s512 fp16 mlpackage via the new shim, runs
 * one prediction, reports load+predict timings and the first 8 output
 * floats. Confirms:
 *   1. The build pipeline (build.rs → cc → ObjC → link CoreML framework) works
 *   2. sweet_coreml_load does not crash
 *   3. sweet_coreml_predict produces real output (not zeros, not NaN)
 *   4. sweet_coreml_free does not leak or crash
 */
import { createRequire } from 'module';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ADDON = join(HERE, '..', '..', 'crates', 'sweet-search-native', 'sweet-search-native.darwin-arm64.node');

const addon = require(ADDON);
console.log(`addon loaded: ${ADDON}`);
if (typeof addon.coremlShimSmokeTest !== 'function') {
  console.error('addon.coremlShimSmokeTest not found — make sure the crate was built with --features metal,coreml');
  process.exit(1);
}

const nomicPkg = join(HERE, 'artifacts', 'nomic_bert_b32_s512_fp16.mlpackage');
const liPkg    = join(HERE, 'artifacts', 'li_modernbert_b32_s512_fp16.mlpackage');

console.log('\n──── NomicBERT smoke ────');
console.log(`path: ${nomicPkg}`);
const nomicResult = await addon.coremlShimSmokeTest(
  nomicPkg,
  'embeddings',   // output feature name in our NomicBERT conversion
  32,             // batch
  512,            // seq
  768,            // output_dim0 = hidden_size
  0,              // output_dim1 = 0 for 2D output
);
console.log(`  load:        ${nomicResult.loadMs.toFixed(1)} ms`);
console.log(`  predict:     ${nomicResult.predictMs.toFixed(1)} ms`);
console.log(`  output:      ${nomicResult.outputElements} elements`);
console.log(`  first 8:     [${nomicResult.first8.map(v => v.toFixed(5)).join(', ')}]`);
const nomicOk = nomicResult.first8.some(v => v !== 0 && Number.isFinite(v));
console.log(`  ${nomicOk ? 'PASS — non-zero finite output' : 'FAIL — output looks wrong'}`);

console.log('\n──── ModernBERT LI smoke ────');
console.log(`path: ${liPkg}`);
const liResult = await addon.coremlShimSmokeTest(
  liPkg,
  'token_vectors', // output feature name in our LI conversion
  32,              // batch
  512,             // seq
  512,             // output_dim0 = seq (LI output is [batch, seq, 128])
  128,             // output_dim1 = token_dim
);
console.log(`  load:        ${liResult.loadMs.toFixed(1)} ms`);
console.log(`  predict:     ${liResult.predictMs.toFixed(1)} ms`);
console.log(`  output:      ${liResult.outputElements} elements`);
console.log(`  first 8:     [${liResult.first8.map(v => v.toFixed(5)).join(', ')}]`);
const liOk = liResult.first8.some(v => v !== 0 && Number.isFinite(v));
console.log(`  ${liOk ? 'PASS — non-zero finite output' : 'FAIL — output looks wrong'}`);

if (nomicOk && liOk) {
  console.log('\n✓ Rust CoreML shim proof-of-life PASSED for both models.');
  process.exit(0);
} else {
  console.error('\n✗ Rust CoreML shim proof-of-life FAILED.');
  process.exit(1);
}
