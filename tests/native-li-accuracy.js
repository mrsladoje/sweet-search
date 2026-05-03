/**
 * Native LI Accuracy Test — Phase B Verification
 *
 * Compares native candle FP32 late interaction output vs ORT INT8 baseline.
 * Expected: cosine similarity ~0.96 (FP32 vs INT8 quantization gap).
 * Critical: both pipelines must produce L2-normalized per-token 128d vectors.
 *
 * Usage: node tests/native-li-accuracy.js
 */

import { join } from 'path';
import { existsSync } from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { createTokenizer } from '../core/infrastructure/native-tokenizer.js';
import { encodeQuery, getLateInteractionPipeline } from '../core/ranking/late-interaction-model.js';

const require = createRequire(import.meta.url);

const TEST_INPUTS = [
  'function add(a, b) { return a + b; }',
  'binary search implementation in rust',
  'export class AuthService { constructor(private jwtProvider) {} }',
  'SELECT u.name, COUNT(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id',
  'fn main() { let v: Vec<i32> = (0..100).filter(|x| x % 2 == 0).collect(); }',
  'async function fetchData(url) { return await fetch(url).then(r => r.json()); }',
];

function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function loadNativeAddon() {
  const { resolveNativeAddon } = await import('../core/infrastructure/native-resolver.js');
  const addonPath = resolveNativeAddon();
  if (!addonPath) throw new Error('Native addon not found');
  return require(addonPath);
}

async function main() {
  console.log('=== Native LI Accuracy Test (Phase B) ===\n');

  // 1. Load native addon + LI model
  const addon = await loadNativeAddon();
  if (!addon.NativeLateInteractionModel) {
    console.error('ERROR: NativeLateInteractionModel not found in addon.');
    process.exit(1);
  }

  const modelDir = join(os.homedir(), '.cache', 'sweet-search', 'models', 'lightonai--LateOn-Code');
  const backbonePath = join(modelDir, 'model.safetensors');
  const projPath = join(modelDir, '1_Dense', 'model.safetensors');
  const configPath = join(modelDir, 'config.json');

  if (!existsSync(backbonePath)) {
    console.error(`ERROR: FP32 backbone not found at ${backbonePath}`);
    process.exit(1);
  }

  console.log('Loading native LI model (FP32 safetensors)...');
  const t0 = Date.now();
  // Standard lateon-code: single 768→128 stage.
  const nativeModel = addon.NativeLateInteractionModel.load(backbonePath, [projPath], [128], configPath);
  console.log(`  Loaded in ${Date.now() - t0}ms (dim: ${nativeModel.dim})`);

  // 2. Load ORT baseline pipeline
  console.log('\nLoading ORT INT8 LI baseline...');
  const t1 = Date.now();
  await getLateInteractionPipeline();
  console.log(`  Loaded in ${Date.now() - t1}ms`);

  // 3. Load tokenizer (shared for both — LateOn-Code uses ModernBERT tokenizer)
  const tokenizerPath = join(modelDir, 'tokenizer.json');
  const tokenizer = await createTokenizer(tokenizerPath);

  // 4. Compare each test input
  console.log(`\nRunning ${TEST_INPUTS.length} test inputs through both pipelines...\n`);

  const results = [];
  let sumCos = 0, minCos = 1.0, maxCos = 0;

  for (let i = 0; i < TEST_INPUTS.length; i++) {
    const text = TEST_INPUTS[i];

    // ORT path: encodeQuery prepends [Q] prefix
    const ortVectors = await encodeQuery(text);

    // Native path: same tokenization (with [Q] prefix to match)
    const prefixed = '[Q] ' + text;
    const tokenized = tokenizer(prefixed, { padding: true, truncation: true, max_length: 256 });
    const seqLen = tokenized.input_ids.dims[1];

    const inputIds = [];
    const attentionMask = [];
    for (let s = 0; s < seqLen; s++) {
      inputIds.push(Number(tokenized.input_ids.data[s]));
      attentionMask.push(Number(tokenized.attention_mask.data[s]));
    }

    const t2 = performance.now();
    const nativeResult = await nativeModel.encodeBatch([inputIds], [attentionMask]);
    const nativeMs = (performance.now() - t2).toFixed(1);

    const nativeCount = nativeResult.tokenCounts[0];
    const ortCount = ortVectors.length;

    // The native addon returns vectors as a flat Float32Array (zero-copy
    // from the Rust Vec<f32>).
    const nativeVectors = nativeResult.vectors;

    // Compare per-token cosine similarity (aligned tokens)
    const compareCount = Math.min(nativeCount, ortCount);
    let tokenCosSum = 0;
    let tokenCosMin = 1.0;

    for (let t = 0; t < compareCount; t++) {
      const nativeVec = nativeVectors.slice(t * 128, (t + 1) * 128);
      const ortVec = Array.from(ortVectors[t]);
      const cos = cosineSimilarity(nativeVec, ortVec);
      tokenCosSum += cos;
      tokenCosMin = Math.min(tokenCosMin, cos);
    }

    const meanCos = tokenCosSum / compareCount;
    sumCos += meanCos;
    minCos = Math.min(minCos, tokenCosMin);
    maxCos = Math.max(maxCos, meanCos);

    // Check L2 norms
    const firstNorm = Math.sqrt(nativeVectors.slice(0, 128).reduce((s, v) => s + v * v, 0));

    const preview = text.slice(0, 55).replace(/\n/g, '\\n');
    const status = meanCos >= 0.94 ? 'PASS' : meanCos >= 0.90 ? 'WARN' : 'FAIL';
    results.push({ i, meanCos, tokenCosMin, nativeCount, ortCount, nativeMs, firstNorm, status, preview });
  }

  // 5. Report
  console.log('\u2500'.repeat(95));
  console.log(`${'#'.padEnd(3)} ${'St'.padEnd(5)} ${'MeanCos'.padEnd(10)} ${'MinTkCos'.padEnd(10)} ${'Ntv/ORT'.padEnd(10)} ${'Norm'.padEnd(8)} ${'ms'.padEnd(7)} Input`);
  console.log('\u2500'.repeat(95));
  for (const r of results) {
    console.log(
      `${String(r.i).padEnd(3)} ${r.status.padEnd(5)} ${r.meanCos.toFixed(6).padEnd(10)} ${r.tokenCosMin.toFixed(6).padEnd(10)} ` +
      `${(r.nativeCount + '/' + r.ortCount).padEnd(10)} ${r.firstNorm.toFixed(4).padEnd(8)} ${r.nativeMs.padEnd(7)} ${r.preview}`
    );
  }
  console.log('\u2500'.repeat(95));

  const avgCos = sumCos / TEST_INPUTS.length;
  console.log(`\nPer-token cosine — min: ${minCos.toFixed(6)}, max: ${maxCos.toFixed(6)}, mean: ${avgCos.toFixed(6)}`);
  console.log('Note: FP32 vs INT8 quantization gap is expected (~0.94-0.97)');

  // Success if all pass basic sanity (mean cosine > 0.90 for FP32 vs INT8)
  const failCount = results.filter(r => r.status === 'FAIL').length;
  if (failCount === 0) {
    console.log('\n\u2713 ALL PASS — native LI model produces valid per-token vectors');
    process.exit(0);
  } else {
    console.error(`\n\u2717 ${failCount} FAILED — native LI output diverges too far from ORT baseline`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
