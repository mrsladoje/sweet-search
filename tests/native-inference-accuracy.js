/**
 * Native Inference Accuracy Test — Phase A Verification
 *
 * Compares native candle FP32 embedding output vs ORT INT8 baseline.
 * Success criteria: cosine similarity > 0.995 for all test inputs.
 *
 * Usage: node tests/native-inference-accuracy.js
 */

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { createTokenizer } from '../core/infrastructure/native-tokenizer.js';
import { callLocalModel, getLocalPipeline } from '../core/embedding/embedding-local-model.js';

const require = createRequire(import.meta.url);

// ─── Test inputs: representative code snippets ───
const TEST_INPUTS = [
  'function add(a, b) { return a + b; }',
  'export class AuthService { constructor(private jwtProvider) {} async login(credentials) { const user = await this.userRepo.findByEmail(credentials.email); return { token: this.jwtProvider.sign({ sub: user.id }) }; } }',
  'import numpy as np\ndef cosine_similarity(a, b):\n    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))',
  'SELECT u.name, COUNT(o.id) AS order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id HAVING order_count > 5',
  'Represent this query for searching relevant code: binary search implementation',
  '// Short snippet\nconst x = 42;',
  `/**
 * SearchEngine handles full-text and vector search across indexed code.
 * Pipeline: tokenize → embed → HNSW ANN → rerank → filter.
 */
export class SearchEngine {
  constructor(private hnsw, private liIndex, private reranker) {}
  async search(query, options = {}) {
    const embedding = await this.embed(query);
    const candidates = await this.hnsw.search(embedding, options.topK || 100);
    const reranked = await this.reranker.rerank(query, candidates);
    return reranked.slice(0, options.limit || 10);
  }
}`,
  'fn main() { let v: Vec<i32> = (0..100).filter(|x| x % 2 == 0).collect(); println!("{:?}", v); }',
  '#[derive(Debug, Clone)]\npub struct Config {\n    pub hidden_size: usize,\n    pub num_layers: usize,\n    pub num_heads: usize,\n}',
  'async function fetchData(url: string): Promise<Response> { const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }',
];

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
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
  console.log('=== Native Inference Accuracy Test (Phase A) ===\n');

  // 1. Load native addon
  const addon = await loadNativeAddon();
  if (!addon.NativeEmbeddingModel) {
    console.error('ERROR: NativeEmbeddingModel not found in addon. Build with inference support.');
    process.exit(1);
  }

  console.log(`Native inference available: ${addon.nativeInferenceAvailable()}`);
  console.log(`Native inference device: ${addon.nativeInferenceDevice()}`);

  // 2. Load native embedding model (FP32 safetensors)
  const modelDir = join(os.homedir(), '.cache', 'sweet-search', 'models', 'nomic-ai--CodeRankEmbed');
  const safetensorsPath = join(modelDir, 'model.safetensors');
  const configPath = join(modelDir, 'config.json');

  if (!existsSync(safetensorsPath)) {
    console.error(`ERROR: FP32 model not found at ${safetensorsPath}`);
    console.error('Download with: curl -L "https://huggingface.co/nomic-ai/CodeRankEmbed/resolve/main/model.safetensors" -o ' + safetensorsPath);
    process.exit(1);
  }

  console.log('\nLoading native embedding model...');
  const t0 = Date.now();
  const nativeModel = addon.NativeEmbeddingModel.load(safetensorsPath, configPath);
  console.log(`  Loaded in ${Date.now() - t0}ms (dim: ${nativeModel.dim})`);

  // 3. Load ORT baseline pipeline
  console.log('\nLoading ORT INT8 baseline...');
  const t1 = Date.now();
  await getLocalPipeline();
  console.log(`  Loaded in ${Date.now() - t1}ms`);

  // 4. Tokenize inputs using native tokenizer (shared between both paths)
  const tokenizerPath = join(
    os.homedir(), '.cache', 'sweet-search', 'models',
    'mrsladoje--CodeRankEmbed-onnx-int8', 'tokenizer.json'
  );
  const tokenizer = await createTokenizer(tokenizerPath);

  // 5. Run both pipelines on all test inputs
  console.log(`\nRunning ${TEST_INPUTS.length} test inputs through both pipelines...\n`);

  // ORT baseline: batch inference
  const ortEmbeddings = await callLocalModel(TEST_INPUTS);

  // Native: tokenize → embed_batch
  const tokenized = tokenizer(TEST_INPUTS, { padding: true, truncation: true, max_length: 512 });
  const batchSize = TEST_INPUTS.length;
  const seqLen = tokenized.input_ids.dims[1];

  // Convert BigInt64Array to Vec<Vec<i64>>
  const inputIds = [];
  const attentionMask = [];
  for (let b = 0; b < batchSize; b++) {
    const ids = [];
    const mask = [];
    for (let s = 0; s < seqLen; s++) {
      const idx = b * seqLen + s;
      ids.push(Number(tokenized.input_ids.data[idx]));
      mask.push(Number(tokenized.attention_mask.data[idx]));
    }
    inputIds.push(ids);
    attentionMask.push(mask);
  }

  const t2 = performance.now();
  // The native addon returns a flat Float32Array (length = batch * dim).
  // Slice into per-batch typed arrays to match the old shape.
  const flat = await nativeModel.embedBatch(inputIds, attentionMask);
  const dim = nativeModel.dim;
  const nativeEmbeddings = new Array(batchSize);
  for (let i = 0; i < batchSize; i++) {
    nativeEmbeddings[i] = flat.slice(i * dim, (i + 1) * dim);
  }
  const nativeMs = (performance.now() - t2).toFixed(1);

  // 6. Compare cosine similarity
  let minCos = 1.0;
  let maxCos = 0.0;
  let sumCos = 0.0;
  const results = [];

  for (let i = 0; i < TEST_INPUTS.length; i++) {
    const ortVec = Array.from(ortEmbeddings[i]);
    const nativeVec = nativeEmbeddings[i];
    const cos = cosineSimilarity(ortVec, nativeVec);

    minCos = Math.min(minCos, cos);
    maxCos = Math.max(maxCos, cos);
    sumCos += cos;

    const status = cos >= 0.995 ? 'PASS' : cos >= 0.99 ? 'WARN' : 'FAIL';
    const preview = TEST_INPUTS[i].slice(0, 60).replace(/\n/g, '\\n');
    results.push({ i, cos, status, preview });
  }

  // 7. Report
  console.log('─'.repeat(80));
  console.log(`${'#'.padEnd(4)} ${'Status'.padEnd(6)} ${'Cosine'.padEnd(12)} Input`);
  console.log('─'.repeat(80));
  for (const r of results) {
    console.log(`${String(r.i).padEnd(4)} ${r.status.padEnd(6)} ${r.cos.toFixed(6).padEnd(12)} ${r.preview}`);
  }
  console.log('─'.repeat(80));
  console.log(`\nCosine similarity — min: ${minCos.toFixed(6)}, max: ${maxCos.toFixed(6)}, mean: ${(sumCos / TEST_INPUTS.length).toFixed(6)}`);
  console.log(`Native batch inference: ${nativeMs}ms for ${TEST_INPUTS.length} texts`);

  const threshold = 0.995;
  if (minCos >= threshold) {
    console.log(`\n✓ ALL PASS — minimum cosine ${minCos.toFixed(6)} ≥ ${threshold} threshold`);
    process.exit(0);
  } else {
    const failCount = results.filter(r => r.status === 'FAIL').length;
    console.error(`\n✗ ${failCount} FAILED — minimum cosine ${minCos.toFixed(6)} < ${threshold} threshold`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
