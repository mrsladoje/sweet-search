/**
 * AB bench: load a specific .node addon binary directly via require() and
 * exercise both NomicBERT embedding and ModernBERT LI at indexer-realistic
 * batch shapes. Detects the return-type contract at runtime so the same bench
 * works against both the OLD addon (Vec<Vec<f32>> / Vec<f64> nested napi) and
 * the NEW addon (JSON string return).
 *
 * Shape rationale (matches what the indexer actually does):
 *   Embedding: batch=32, seq=512  — small per-batch output (32 × 768 = 24,576 f32)
 *   LI:        batch=32, seq=2048 — LARGE per-batch output (32 × 2048 × 128 = 8.4M f32)
 *
 * The LI shape is the worst case for JSON encoding because it is what
 * stresses the napi return path the hardest. If JSON loses to nested-vec
 * here it loses everywhere, and the LI fix needs to switch to Float32Array.
 *
 * Usage:
 *   SWEET_SEARCH_ADDON_PATH=/tmp/sweet-search-native-OLD.node node scripts/spike-coreml/bench_ab_napi.js
 *   SWEET_SEARCH_ADDON_PATH=/tmp/sweet-search-native-NEW.node node scripts/spike-coreml/bench_ab_napi.js
 */
import { createRequire } from 'module';
import { join, extname } from 'path';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import os from 'os';
import { createTokenizer } from '../../core/infrastructure/native-tokenizer.js';

const ADDON_PATH = process.env.SWEET_SEARCH_ADDON_PATH;
if (!ADDON_PATH) {
  console.error('Set SWEET_SEARCH_ADDON_PATH to the .node binary path.');
  process.exit(2);
}
if (!existsSync(ADDON_PATH)) {
  console.error(`Addon not found at ${ADDON_PATH}`);
  process.exit(2);
}

const require = createRequire(import.meta.url);
const addon = require(ADDON_PATH);
console.log(`[bench-ab] loaded addon: ${ADDON_PATH}`);
console.log(`[bench-ab] device: ${addon.nativeInferenceDevice?.()} available: ${addon.nativeInferenceAvailable?.()}`);

const ROOT = '/Users/admin/Projects/sweet-search-private';
const EXTS = new Set(['.js', '.mjs', '.ts', '.tsx', '.rs', '.py', '.go', '.java', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', '.venv', 'dist', 'build', '.cache', '.agentic-qe', 'eval', 'data', 'logs', '.sweet-search']);

function walk(dir, out = [], cap = 1000) {
  if (out.length >= cap) return out;
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (out.length >= cap) return out;
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out, cap);
    else if (EXTS.has(extname(e))) out.push(p);
  }
  return out;
}

function loadDocs(targetCount, minChars, maxChars) {
  const files = walk(ROOT, [], 4000);
  const docs = [];
  for (const f of files) {
    if (docs.length >= targetCount) break;
    let content;
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    if (content.length < minChars || content.length > maxChars) continue;
    docs.push(content);
  }
  return docs;
}

function makeBatches(items, batchSize) {
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));
  return batches;
}

function tokenizedToNapi(tokenized, batchSize, seqLen) {
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
  return { inputIds, attentionMask };
}

function summary(label, times, parseTimes, batchInfo) {
  times.sort((a, b) => a - b);
  parseTimes.sort((a, b) => a - b);
  const n = times.length;
  const p50 = times[Math.floor(n / 2)];
  const p10 = times[Math.floor(n * 0.1)];
  const p90 = times[Math.floor(n * 0.9)];
  const min = times[0];
  const max = times[n - 1];
  const totalMs = times.reduce((s, x) => s + x, 0);
  const parseP50 = parseTimes.length ? parseTimes[Math.floor(parseTimes.length / 2)] : 0;
  const parseTotalMs = parseTimes.reduce((s, x) => s + x, 0);
  console.log(`\n=== ${label} ===`);
  console.log(`  shape         : ${batchInfo}`);
  console.log(`  iters         : ${n}`);
  console.log(`  min           : ${min.toFixed(1)} ms`);
  console.log(`  p10           : ${p10.toFixed(1)} ms`);
  console.log(`  p50           : ${p50.toFixed(1)} ms`);
  console.log(`  p90           : ${p90.toFixed(1)} ms`);
  console.log(`  max           : ${max.toFixed(1)} ms`);
  console.log(`  total         : ${totalMs.toFixed(0)} ms across ${n} batches`);
  if (parseTotalMs > 0) {
    console.log(`  post-await p50: ${parseP50.toFixed(1)} ms (parse/slice/iterate, total ${parseTotalMs.toFixed(0)} ms)`);
  } else {
    console.log(`  post-await    : 0 ms`);
  }
}

async function benchEmbedding() {
  console.log('\n──── EMBEDDING ────');
  const modelDir = join(os.homedir(), '.cache', 'sweet-search', 'models', 'nomic-ai--CodeRankEmbed');
  const safetensors = join(modelDir, 'model.safetensors');
  const config = join(modelDir, 'config.json');
  const tokenizerPath = join(os.homedir(), '.cache', 'sweet-search', 'models', 'mrsladoje--CodeRankEmbed-onnx-int8', 'tokenizer.json');

  const tLoad = performance.now();
  const model = addon.NativeEmbeddingModel.load(safetensors, config);
  console.log(`  loaded in ${(performance.now() - tLoad).toFixed(0)} ms (dim=${model.dim})`);

  const tokenizer = await createTokenizer(tokenizerPath);

  // 256 medium-sized chunks → 8 FULL batches at b=32 (no partial last batch)
  let docs = loadDocs(320, 600, 6000);
  docs = docs.slice(0, Math.floor(docs.length / 32) * 32);
  console.log(`  using ${docs.length} real docs`);
  const tokenized = tokenizer(docs, { padding: true, truncation: true, max_length: 512 });
  const seqLen = tokenized.input_ids.dims[1];
  const batches = makeBatches(docs.map((_, i) => i), 32);
  console.log(`  ${batches.length} full batches at b32×s${seqLen}`);

  // Pre-build all napi inputs to take tokenization out of the hot loop
  const prepared = batches.map((batchIdx) => {
    const slice = { input_ids: { data: new BigInt64Array(32 * seqLen), dims: [32, seqLen] }, attention_mask: { data: new BigInt64Array(32 * seqLen), dims: [32, seqLen] } };
    for (let b = 0; b < batchIdx.length; b++) {
      const srcBase = batchIdx[b] * seqLen;
      const dstBase = b * seqLen;
      for (let s = 0; s < seqLen; s++) {
        slice.input_ids.data[dstBase + s] = tokenized.input_ids.data[srcBase + s];
        slice.attention_mask.data[dstBase + s] = tokenized.attention_mask.data[srcBase + s];
      }
    }
    return tokenizedToNapi(slice, 32, seqLen);
  });

  // Detect return type on first call
  const probe = await model.embedBatch(prepared[0].inputIds, prepared[0].attentionMask);
  const isString = typeof probe === 'string';
  const isFloat32 = probe instanceof Float32Array;
  let label;
  if (isFloat32) label = 'Float32Array (typed-array, zero-copy)';
  else if (isString) label = 'STRING (JSON.parse needed)';
  else label = 'NESTED ARRAY (direct, OLD per-element napi)';
  console.log(`  return contract: ${label}`);

  // Warmup
  for (let i = 0; i < 3; i++) {
    const r = await model.embedBatch(prepared[0].inputIds, prepared[0].attentionMask);
    if (isString) JSON.parse(r);
  }

  const times = [];
  const parseTimes = [];
  const dim = model.dim;
  for (const p of prepared) {
    const t0 = performance.now();
    const r = await model.embedBatch(p.inputIds, p.attentionMask);
    const tCall = performance.now() - t0;
    let tParse = 0;
    if (isString) {
      const tp = performance.now();
      JSON.parse(r);
      tParse = performance.now() - tp;
    } else if (isFloat32) {
      // Match what nativeEmbed does downstream: slice per batch into
      // independent Float32Arrays. For 32×768 this is 32 × .slice(768) calls
      // = 32 small memcpys. Trivial but include it so the comparison is fair.
      const tp = performance.now();
      const out = new Array(32);
      for (let i = 0; i < 32; i++) out[i] = r.slice(i * dim, (i + 1) * dim);
      tParse = performance.now() - tp;
    }
    times.push(tCall);
    parseTimes.push(tParse);
  }

  summary('Embedding', times, parseTimes, `b=32 × s=${seqLen}`);
  return { times, parseTimes };
}

async function benchLi() {
  console.log('\n──── LATE INTERACTION ────');
  const modelDir = join(os.homedir(), '.cache', 'sweet-search', 'models', 'lightonai--LateOn-Code');
  const backbone = join(modelDir, 'model.safetensors');
  const proj = join(modelDir, '1_Dense', 'model.safetensors');
  const config = join(modelDir, 'config.json');
  const tokenizerPath = join(modelDir, 'tokenizer.json');

  const tLoad = performance.now();
  const model = addon.NativeLateInteractionModel.load(backbone, proj, config);
  console.log(`  loaded in ${(performance.now() - tLoad).toFixed(0)} ms (dim=${model.dim})`);

  const tokenizer = await createTokenizer(tokenizerPath);

  // LARGE docs to push LI per-batch output near the worst case
  // 192 large docs → 6 batches at b32 with seq up to 2048
  let docs = loadDocs(192, 3000, 50000);
  docs = docs.slice(0, Math.floor(docs.length / 32) * 32);
  console.log(`  using ${docs.length} real docs (long ones)`);
  const tokenized = tokenizer(docs, { padding: true, truncation: true, max_length: 2048 });
  const seqLen = tokenized.input_ids.dims[1];
  const batches = makeBatches(docs.map((_, i) => i), 32);
  console.log(`  ${batches.length} batches at b32×s${seqLen}`);

  const prepared = batches.map((batchIdx) => {
    const realBatch = batchIdx.length;
    const slice = {
      input_ids: { data: new BigInt64Array(realBatch * seqLen), dims: [realBatch, seqLen] },
      attention_mask: { data: new BigInt64Array(realBatch * seqLen), dims: [realBatch, seqLen] },
    };
    for (let b = 0; b < realBatch; b++) {
      const srcBase = batchIdx[b] * seqLen;
      const dstBase = b * seqLen;
      for (let s = 0; s < seqLen; s++) {
        slice.input_ids.data[dstBase + s] = tokenized.input_ids.data[srcBase + s];
        slice.attention_mask.data[dstBase + s] = tokenized.attention_mask.data[srcBase + s];
      }
    }
    return tokenizedToNapi(slice, realBatch, seqLen);
  });

  // Detect return type on first call. Three contracts possible:
  //  - OLD:    { vectors: number[], tokenCounts: number[] }
  //  - JSON:   { vectorsJson: string, tokenCounts: number[] }
  //  - F32:    { vectors: Float32Array, tokenCounts: number[] }
  const probe = await model.encodeBatch(prepared[0].inputIds, prepared[0].attentionMask);
  const isJsonReturn = typeof probe.vectorsJson === 'string';
  const isFloat32 = probe.vectors instanceof Float32Array;
  let label;
  if (isFloat32) label = 'OBJECT { vectors: Float32Array, ... } (typed-array, zero-copy)';
  else if (isJsonReturn) label = 'OBJECT { vectorsJson: STRING, ... } (JSON.parse needed)';
  else label = 'OBJECT { vectors: number[], ... } (OLD per-element napi)';
  console.log(`  return contract: ${label}`);

  // Warmup
  for (let i = 0; i < 3; i++) {
    const r = await model.encodeBatch(prepared[0].inputIds, prepared[0].attentionMask);
    if (isJsonReturn) JSON.parse(r.vectorsJson);
  }

  const times = [];
  const parseTimes = [];
  let totalActiveTokens = 0;
  const dim = model.dim;
  for (const p of prepared) {
    const t0 = performance.now();
    const r = await model.encodeBatch(p.inputIds, p.attentionMask);
    const tCall = performance.now() - t0;
    let tParse = 0;
    if (isJsonReturn) {
      const tp = performance.now();
      JSON.parse(r.vectorsJson);
      tParse = performance.now() - tp;
    } else if (isFloat32) {
      // Match what nativeLiEncodeTokenized does downstream: slice per token
      // into independent Float32Arrays. Hot inner loop matches production.
      const tp = performance.now();
      let off = 0;
      for (const count of r.tokenCounts) {
        for (let t = 0; t < count; t++) {
          r.vectors.slice(off + t * dim, off + (t + 1) * dim);
        }
        off += count * dim;
      }
      tParse = performance.now() - tp;
    } else {
      // OLD addon: simulate the JS-side per-element iteration cost the
      // indexer pays when reading result.vectors. Without this the OLD path
      // looks artificially good — production code does iterate it.
      const tp = performance.now();
      let _sink = 0;
      for (let i = 0; i < r.vectors.length; i++) _sink += r.vectors[i];
      if (_sink === Infinity) console.log('unreachable'); // prevent dead-code elim
      tParse = performance.now() - tp;
    }
    times.push(tCall);
    parseTimes.push(tParse);
    for (const tc of r.tokenCounts) totalActiveTokens += tc;
  }

  console.log(`  total active tokens across all batches: ${totalActiveTokens}`);
  summary('Late Interaction', times, parseTimes, `b=32 × s=${seqLen}`);
  return { times, parseTimes };
}

async function main() {
  await benchEmbedding();
  await benchLi();
  console.log('\n[bench-ab] done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
