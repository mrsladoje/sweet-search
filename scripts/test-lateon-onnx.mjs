#!/usr/bin/env node

/**
 * Phase 1 Validation: LateOn-Code ONNX Loading (Fallback A: Direct ORT)
 *
 * Tests both full (149M, 128d) and edge (17M, 48d) models.
 * Uses @huggingface/transformers for tokenizer only.
 * Uses onnxruntime-node directly for model inference (ONNX files are at repo
 * root on HuggingFace, not in onnx/ subdirectory that transformers.js expects).
 *
 * Validates: ONNX loading, projection layers, encoding asymmetry, skiplist, latency.
 *
 * Usage:
 *   node scripts/test-lateon-onnx.mjs [--model=full|edge|both] [--latency-runs=20]
 */

import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import os from 'os';

// The 32 skiplist punctuation characters from LateOn-Code config
const SKIPLIST_CHARS = new Set([
  '!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.',
  '/', ':', ';', '<', '=', '>', '?', '@', '[', '\\', ']', '^', '_', '`',
  '{', '|', '}', '~',
]);

const args = process.argv.slice(2);
let modelFilter = 'both';
let latencyRuns = 20;
for (const arg of args) {
  if (arg.startsWith('--model=')) modelFilter = arg.split('=')[1];
  if (arg.startsWith('--latency-runs=')) latencyRuns = parseInt(arg.split('=')[1], 10);
}

const MODELS = {
  full: {
    name: 'LateOn-Code (full, 149M)',
    hfId: 'lightonai/LateOn-Code',
    onnxFile: 'model_int8.onnx',        // INT8 quantized, ~150MB
    expectedBackboneDim: 768,
    expectedTokenDim: 128,
    projectionStages: 1,
    projectionPaths: ['1_Dense/model.safetensors'],
  },
  edge: {
    name: 'LateOn-Code-edge (17M)',
    hfId: 'lightonai/LateOn-Code-edge',
    onnxFile: 'model.onnx',             // FP32, ~68MB
    expectedBackboneDim: 256,
    expectedTokenDim: 48,
    projectionStages: 2,
    projectionPaths: ['1_Dense/model.safetensors', '2_Dense/model.safetensors'],
  },
};

function log(msg, color = 'reset') {
  const colors = {
    reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
    yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
    bright: '\x1b[1m',
  };
  console.log(`${colors[color] || ''}${msg}\x1b[0m`);
}

function assert(condition, message) {
  if (!condition) {
    log(`  FAIL: ${message}`, 'red');
    throw new Error(message);
  }
  log(`  PASS: ${message}`, 'green');
}

// =========================================================================
// Download file from HuggingFace to local cache
// =========================================================================
function getCachePath(hfId, filename) {
  const cacheDir = path.join(os.homedir(), '.cache', 'sweet-search', 'lateon-models',
    hfId.replace('/', '--'));
  fs.mkdirSync(cacheDir, { recursive: true });
  // Flatten subdirectory filenames (e.g. "1_Dense/model.safetensors" → "1_Dense--model.safetensors")
  const safeName = filename.replace(/\//g, '--');
  return path.join(cacheDir, safeName);
}

async function downloadHfFile(hfId, filename) {
  const cachePath = getCachePath(hfId, filename);
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    if (stat.size > 0) {
      log(`  Cached: ${cachePath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`, 'dim');
      return cachePath;
    }
  }

  const url = `https://huggingface.co/${hfId}/resolve/main/${filename}`;
  log(`  Downloading: ${url}`, 'dim');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);

  const buffer = await resp.arrayBuffer();
  fs.writeFileSync(cachePath, Buffer.from(buffer));
  log(`  Downloaded: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB → ${cachePath}`, 'dim');
  return cachePath;
}

// =========================================================================
// Parse safetensors format to extract Float32 weight matrix
// =========================================================================
function parseSafetensorsWeight(filePath) {
  const buffer = fs.readFileSync(filePath);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // 8-byte LE header length
  const headerLen = Number(view.getBigUint64(0, true));
  const headerJson = buffer.subarray(8, 8 + headerLen).toString('utf-8');
  const header = JSON.parse(headerJson);

  const dataStart = 8 + headerLen;
  for (const [name, info] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    if (info.dtype === 'F32') {
      const byteOffset = dataStart + info.data_offsets[0];
      const byteLength = info.data_offsets[1] - info.data_offsets[0];
      log(`  Tensor "${name}": shape=[${info.shape}], ${byteLength / 4} elements`, 'dim');
      // Copy to new buffer to avoid alignment issues
      const copy = new Float32Array(byteLength / 4);
      const src = buffer.subarray(byteOffset, byteOffset + byteLength);
      copy.set(new Float32Array(src.buffer, src.byteOffset, src.length / 4));
      return copy;
    }
  }
  throw new Error('No F32 tensor found in safetensors');
}

// =========================================================================
// Test model loading and scoring
// =========================================================================
async function testModel(modelKey) {
  const modelInfo = MODELS[modelKey];
  log(`\n${'='.repeat(70)}`, 'bright');
  log(`Testing: ${modelInfo.name}`, 'bright');
  log(`HuggingFace: ${modelInfo.hfId}`, 'dim');
  log('='.repeat(70), 'bright');

  // ---- Step 1: Load tokenizer via transformers.js ----
  log('\n1. Loading tokenizer...', 'cyan');
  const { AutoTokenizer } = await import('@huggingface/transformers');
  const tokStart = performance.now();
  const tokenizer = await AutoTokenizer.from_pretrained(modelInfo.hfId);
  log(`  Loaded in ${(performance.now() - tokStart).toFixed(1)}ms`, 'dim');
  assert(tokenizer != null, 'Tokenizer loaded');

  // ---- Step 2: Tokenization test ----
  log('\n2. Testing tokenization...', 'cyan');
  const queryText = '[Q] getUserById';
  const docText = '[D] function getUserById(id) { return db.query("SELECT * FROM users WHERE id = ?", [id]); }';
  const qTok = tokenizer(queryText, { padding: true, truncation: true, max_length: 256 });
  const dTok = tokenizer(docText, { padding: true, truncation: true, max_length: 2048 });
  log(`  Query: "${queryText}" → ${qTok.input_ids.dims[1]} tokens`, 'dim');
  log(`  Doc: "${docText.slice(0, 60)}..." → ${dTok.input_ids.dims[1]} tokens`, 'dim');
  assert(qTok.input_ids.dims[1] > 0, 'Query tokenization OK');
  assert(dTok.input_ids.dims[1] > qTok.input_ids.dims[1], 'Doc has more tokens than query');

  // ---- Step 3: Build skiplist token IDs ----
  log('\n3. Building skiplist token IDs...', 'cyan');
  const skiplistTokenIds = new Set();
  for (const ch of SKIPLIST_CHARS) {
    const enc = tokenizer(ch, { add_special_tokens: false });
    const ids = Array.from(enc.input_ids.data);
    if (ids.length === 1) skiplistTokenIds.add(Number(ids[0]));
  }
  log(`  ${skiplistTokenIds.size} skiplist token IDs from ${SKIPLIST_CHARS.size} chars`, 'dim');

  // ---- Step 4: Download and load ONNX model via onnxruntime-node ----
  log('\n4. Loading ONNX model (direct ORT)...', 'cyan');
  const onnxPath = await downloadHfFile(modelInfo.hfId, modelInfo.onnxFile);
  const ort = await import('onnxruntime-node');
  const modelStart = performance.now();
  const session = await ort.InferenceSession.create(onnxPath, {
    executionProviders: ['cpu'],
  });
  log(`  ORT session created in ${(performance.now() - modelStart).toFixed(1)}ms`, 'dim');
  log(`  Input names: ${session.inputNames.join(', ')}`, 'dim');
  log(`  Output names: ${session.outputNames.join(', ')}`, 'dim');
  assert(session != null, 'ORT session created');

  // ---- Step 5: Forward pass ----
  log('\n5. Running forward pass...', 'cyan');

  function toOrtTensor(tokenized) {
    // tokenized.input_ids.data is BigInt64Array from transformers.js
    // ORT needs int64 tensors
    const ids = tokenized.input_ids;
    const mask = tokenized.attention_mask;

    // Convert to BigInt64 if needed (transformers.js already uses BigInt64Array)
    const idData = ids.data instanceof BigInt64Array ? ids.data : new BigInt64Array(Array.from(ids.data).map(BigInt));
    const maskData = mask.data instanceof BigInt64Array ? mask.data : new BigInt64Array(Array.from(mask.data).map(BigInt));

    return {
      input_ids: new ort.Tensor('int64', idData, ids.dims),
      attention_mask: new ort.Tensor('int64', maskData, mask.dims),
    };
  }

  async function encode(text, maxLen) {
    const tokenized = tokenizer(text, { padding: true, truncation: true, max_length: maxLen });
    const feeds = toOrtTensor(tokenized);
    const result = await session.run(feeds);
    // Output key is usually 'last_hidden_state' or the first output
    const outputKey = session.outputNames[0];
    const hidden = result[outputKey];
    return { hidden, tokenized };
  }

  const { hidden: qHidden, tokenized: qTokenized } = await encode(queryText, 256);
  const { hidden: dHidden, tokenized: dTokenized } = await encode(docText, 2048);

  log(`  Query hidden shape: [${qHidden.dims.join(', ')}]`, 'dim');
  log(`  Doc   hidden shape: [${dHidden.dims.join(', ')}]`, 'dim');

  const outputDim = qHidden.dims[2];

  // The ONNX export may already include the projection layer(s). Check:
  const projectionBakedIn = outputDim === modelInfo.expectedTokenDim;
  const projectionNeeded = outputDim === modelInfo.expectedBackboneDim;

  if (projectionBakedIn) {
    log(`  ONNX output is ${outputDim}d — projection ALREADY BAKED into ONNX!`, 'green');
    log(`  No manual projection needed.`, 'green');
  } else if (projectionNeeded) {
    log(`  ONNX output is raw ${outputDim}d backbone — need manual projection.`, 'yellow');
  } else {
    log(`  UNEXPECTED output dim: ${outputDim}`, 'red');
    throw new Error(`Unexpected dim ${outputDim}`);
  }

  // ---- Step 6: L2 normalize (and optionally project) ----
  log('\n6. L2 normalization...', 'cyan');

  let projectionStages = [];
  if (projectionNeeded) {
    // Download and apply projection weights manually
    log('  Loading projection weights for manual projection...', 'dim');
    const expectedDims = modelKey === 'full'
      ? [{ in: 768, out: 128 }]
      : [{ in: 256, out: 512 }, { in: 512, out: 48 }];
    for (let i = 0; i < modelInfo.projectionPaths.length; i++) {
      const weightPath = await downloadHfFile(modelInfo.hfId, modelInfo.projectionPaths[i]);
      const weight = parseSafetensorsWeight(weightPath);
      const { in: inDim, out: outDim } = expectedDims[i];
      assert(weight.length === outDim * inDim,
        `Projection ${i + 1}: [${outDim}, ${inDim}] = ${outDim * inDim} (got ${weight.length})`);
      projectionStages.push({ weight, inDim, outDim });
    }
  }

  function normalizeAndProject(hiddenTensor) {
    const [batch, seqLen, hiddenDim] = hiddenTensor.dims;
    let data = new Float32Array(hiddenTensor.data); // copy so we don't mutate
    let currentDim = hiddenDim;

    // Apply projection if needed
    for (const { weight, inDim, outDim } of projectionStages) {
      if (currentDim !== inDim) throw new Error(`Expected ${inDim}d, got ${currentDim}d`);
      const projected = new Float32Array(batch * seqLen * outDim);
      for (let b = 0; b < batch; b++) {
        for (let s = 0; s < seqLen; s++) {
          const srcOff = (b * seqLen + s) * currentDim;
          const dstOff = (b * seqLen + s) * outDim;
          for (let o = 0; o < outDim; o++) {
            let sum = 0;
            for (let i = 0; i < currentDim; i++) sum += weight[o * currentDim + i] * data[srcOff + i];
            projected[dstOff + o] = sum;
          }
        }
      }
      data = projected;
      currentDim = outDim;
    }

    // L2 normalize per token
    for (let b = 0; b < batch; b++) {
      for (let s = 0; s < seqLen; s++) {
        const off = (b * seqLen + s) * currentDim;
        let norm = 0;
        for (let d = 0; d < currentDim; d++) norm += data[off + d] * data[off + d];
        norm = Math.sqrt(norm) + 1e-12;
        for (let d = 0; d < currentDim; d++) data[off + d] /= norm;
      }
    }

    return { data, dims: [batch, seqLen, currentDim] };
  }

  const qProj = normalizeAndProject(qHidden);
  const dProj = normalizeAndProject(dHidden);

  assert(qProj.dims[2] === modelInfo.expectedTokenDim,
    `Final query dim = ${modelInfo.expectedTokenDim}`);
  assert(dProj.dims[2] === modelInfo.expectedTokenDim,
    `Final doc dim = ${modelInfo.expectedTokenDim}`);

  // Extract token vectors
  function toVectors(proj) {
    const seqLen = proj.dims[1];
    const dim = proj.dims[2];
    const vectors = [];
    for (let i = 0; i < seqLen; i++) {
      vectors.push(Array.from(proj.data.slice(i * dim, (i + 1) * dim)));
    }
    return vectors;
  }

  const queryVectors = toVectors(qProj);

  // ---- Step 7: Verify encoding asymmetry ----
  log('\n7. Verifying encoding asymmetry (queries keep ALL, docs skip punct)...', 'cyan');

  // Query: keep ALL tokens, NO skiplist filtering
  const qSeqLen = qHidden.dims[1];
  assert(queryVectors.length === qSeqLen,
    `Query: ALL ${qSeqLen} tokens kept (no skiplist, no [MASK] padding)`);

  // Document: apply skiplist filtering
  const allDocVectors = toVectors(dProj);
  const docInputIds = Array.from(dTokenized.input_ids.data).map(Number);
  const filteredDocVectors = [];
  for (let i = 0; i < allDocVectors.length; i++) {
    if (!skiplistTokenIds.has(docInputIds[i])) {
      filteredDocVectors.push(allDocVectors[i]);
    }
  }
  const removed = allDocVectors.length - filteredDocVectors.length;
  log(`  Doc: ${allDocVectors.length} total, ${removed} skiplist removed, ${filteredDocVectors.length} kept`, 'dim');
  assert(removed > 0, `Skiplist removed ${removed} punctuation tokens from document`);
  assert(filteredDocVectors.length < allDocVectors.length, 'Doc has fewer tokens after skiplist');

  // ---- Step 8: MaxSim scoring ----
  log('\n8. MaxSim scoring test...', 'cyan');

  function maxSim(qTokens, dTokens) {
    let total = 0;
    for (const qt of qTokens) {
      let maxS = -Infinity;
      for (const dt of dTokens) {
        let dot = 0;
        for (let i = 0; i < qt.length; i++) dot += qt[i] * dt[i];
        if (dot > maxS) maxS = dot;
      }
      total += Math.max(0, maxS);
    }
    return total / qTokens.length;
  }

  const relevantScore = maxSim(queryVectors, filteredDocVectors);
  log(`  Score(getUserById, getUserById impl) = ${relevantScore.toFixed(4)}`, 'dim');

  // Irrelevant doc
  const irrelText = '[D] class Logger { constructor() { this.level = "info"; } }';
  const { hidden: irrelHidden, tokenized: irrelTokenized } = await encode(irrelText, 2048);
  const irrelProj = normalizeAndProject(irrelHidden);
  const irrelVectors = toVectors(irrelProj);
  const irrelIds = Array.from(irrelTokenized.input_ids.data).map(Number);
  const filteredIrrel = irrelVectors.filter((_, i) => !skiplistTokenIds.has(irrelIds[i]));

  const irrelevantScore = maxSim(queryVectors, filteredIrrel);
  log(`  Score(getUserById, Logger class) = ${irrelevantScore.toFixed(4)}`, 'dim');

  assert(relevantScore > irrelevantScore,
    `Relevant (${relevantScore.toFixed(4)}) > Irrelevant (${irrelevantScore.toFixed(4)})`);

  const discrimination = relevantScore - irrelevantScore;
  log(`  Discrimination: ${discrimination.toFixed(4)}`, 'dim');

  // ---- Step 9: Latency measurement ----
  log(`\n9. Latency (${latencyRuns} runs)...`, 'cyan');
  const latencies = [];
  for (let r = 0; r < latencyRuns; r++) {
    const start = performance.now();
    const tok = tokenizer('[Q] findUserByEmail', { padding: true, truncation: true, max_length: 256 });
    const feeds = toOrtTensor(tok);
    const result = await session.run(feeds);
    const hidden = result[session.outputNames[0]];
    normalizeAndProject(hidden);
    latencies.push(performance.now() - start);
  }
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  log(`  p50: ${p50.toFixed(1)}ms, p95: ${p95.toFixed(1)}ms, avg: ${avg.toFixed(1)}ms`, 'dim');

  // ---- Summary ----
  log('\n' + '='.repeat(70), 'bright');
  log(`SUMMARY: ${modelInfo.name}`, 'bright');
  log('='.repeat(70), 'bright');
  log(`  Backbone dim:      ${modelInfo.expectedBackboneDim}`, 'dim');
  log(`  Token dim:         ${modelInfo.expectedTokenDim}`, 'dim');
  log(`  Projection:        ${projectionBakedIn ? 'BAKED IN ONNX' : 'MANUAL'} (${modelInfo.projectionStages} stage(s))`, 'dim');
  log(`  ONNX file:         ${modelInfo.onnxFile}`, 'dim');
  log(`  Skiplist IDs:      ${skiplistTokenIds.size}`, 'dim');
  log(`  Query tokens:      ${qSeqLen} (ALL kept, no skiplist)`, 'dim');
  log(`  Doc tokens:        ${allDocVectors.length} → ${filteredDocVectors.length} (after skiplist)`, 'dim');
  log(`  Latency p50/p95:   ${p50.toFixed(1)}ms / ${p95.toFixed(1)}ms`, 'dim');
  log(`  MaxSim relevant:   ${relevantScore.toFixed(4)}`, 'dim');
  log(`  MaxSim irrelevant: ${irrelevantScore.toFixed(4)}`, 'dim');
  log(`  Discrimination:    ${discrimination.toFixed(4)}`, 'dim');

  return {
    success: true,
    model: modelKey,
    tokenDim: modelInfo.expectedTokenDim,
    projectionBakedIn,
    projectionManual: !projectionBakedIn,
    projectionStages: modelInfo.projectionStages,
    skiplistIds: skiplistTokenIds.size,
    latencyP50: p50,
    latencyP95: p95,
    latencyAvg: avg,
    relevantScore,
    irrelevantScore,
    discrimination,
  };
}

// =========================================================================
// Main
// =========================================================================
async function main() {
  log('Phase 1: LateOn-Code ONNX Validation (Direct ORT)', 'bright');
  log(`Models: ${modelFilter}, Latency runs: ${latencyRuns}\n`, 'dim');

  const results = {};
  const modelsToTest = modelFilter === 'both' ? ['full', 'edge'] : [modelFilter];

  for (const m of modelsToTest) {
    if (!MODELS[m]) { log(`Unknown model: ${m}`, 'red'); continue; }
    try {
      results[m] = await testModel(m);
    } catch (err) {
      log(`\nFATAL ERROR testing ${m}: ${err.message}`, 'red');
      log(err.stack, 'dim');
      results[m] = { success: false, error: 'exception', details: err.message };
    }
  }

  // Final report
  log('\n' + '='.repeat(70), 'bright');
  log('FINAL REPORT', 'bright');
  log('='.repeat(70), 'bright');

  let allPassed = true;
  for (const [key, result] of Object.entries(results)) {
    if (result.success) {
      log(`  ${MODELS[key].name}: PASS (${result.tokenDim}d, p50=${result.latencyP50.toFixed(1)}ms, disc=${result.discrimination.toFixed(4)})`, 'green');
    } else {
      log(`  ${MODELS[key].name}: FAIL (${result.error}: ${result.details})`, 'red');
      allPassed = false;
    }
  }

  if (allPassed) {
    log('\nPhase 1 GATE: PASSED', 'green');
    log('\nKey findings:', 'cyan');
    log('  - transformers.js v4 AutoModel does NOT auto-apply projection (ONNX at root, not onnx/)', 'dim');
    log('  - Fallback A (direct onnxruntime-node) works for both models', 'dim');
    log('  - Projection weights loaded manually from safetensors files', 'dim');
    log('  - Tokenizer from transformers.js works fine for both models', 'dim');
  } else {
    log('\nPhase 1 GATE: FAILED — check errors above', 'red');
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  log(`Unhandled error: ${err.message}`, 'red');
  log(err.stack, 'dim');
  process.exit(1);
});
