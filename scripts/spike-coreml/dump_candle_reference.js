/**
 * Dumps tokenized inputs + candle Metal BF16 reference embeddings to JSON.
 *
 * Used by test_pytorch_parity.py and test_coreml_parity.py to compare
 * PyTorch / CoreML outputs against the production Metal BF16 path on
 * identical token streams.
 *
 * Usage:
 *   node scripts/spike-coreml/dump_candle_reference.js [out.json]
 */

import { join } from 'path';
import { writeFileSync, existsSync } from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { createTokenizer } from '../../core/infrastructure/native-tokenizer.js';

const require = createRequire(import.meta.url);

const TEST_INPUTS = [
  'function add(a, b) { return a + b; }',
  'export class AuthService { constructor(private jwtProvider) {} async login(credentials) { const user = await this.userRepo.findByEmail(credentials.email); return { token: this.jwtProvider.sign({ sub: user.id }) }; } }',
  'import numpy as np\ndef cosine_similarity(a, b):\n    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))',
  'SELECT u.name, COUNT(o.id) AS order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id HAVING order_count > 5',
  'Represent this query for searching relevant code: binary search implementation',
  '// Short snippet\nconst x = 42;',
  'fn main() { let v: Vec<i32> = (0..100).filter(|x| x % 2 == 0).collect(); println!("{:?}", v); }',
  '#[derive(Debug, Clone)]\npub struct Config {\n    pub hidden_size: usize,\n    pub num_layers: usize,\n    pub num_heads: usize,\n}',
  'async function fetchData(url: string): Promise<Response> { const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }',
  'def quicksort(arr):\n    if len(arr) <= 1: return arr\n    pivot = arr[len(arr) // 2]\n    return quicksort([x for x in arr if x < pivot]) + [x for x in arr if x == pivot] + quicksort([x for x in arr if x > pivot])',
];

async function main() {
  const outPath = process.argv[2] || join(import.meta.dirname || new URL('.', import.meta.url).pathname, 'candle_reference.json');

  const { resolveNativeAddon } = await import('../../core/infrastructure/native-resolver.js');
  const addonPath = resolveNativeAddon();
  if (!addonPath) throw new Error('Native addon not found');
  const addon = require(addonPath);
  if (!addon.NativeEmbeddingModel) throw new Error('NativeEmbeddingModel missing');

  console.log(`device=${addon.nativeInferenceDevice()}  available=${addon.nativeInferenceAvailable()}`);

  const modelDir = join(os.homedir(), '.cache', 'sweet-search', 'models', 'nomic-ai--CodeRankEmbed');
  const safetensorsPath = join(modelDir, 'model.safetensors');
  const configPath = join(modelDir, 'config.json');
  if (!existsSync(safetensorsPath)) throw new Error(`Missing ${safetensorsPath}`);

  const nativeModel = addon.NativeEmbeddingModel.load(safetensorsPath, configPath);
  console.log(`Loaded NomicBERT (dim=${nativeModel.dim})`);

  const tokenizerPath = join(os.homedir(), '.cache', 'sweet-search', 'models', 'mrsladoje--CodeRankEmbed-onnx-int8', 'tokenizer.json');
  const tokenizer = await createTokenizer(tokenizerPath);
  const tokenized = tokenizer(TEST_INPUTS, { padding: true, truncation: true, max_length: 512 });

  const batchSize = TEST_INPUTS.length;
  const seqLen = tokenized.input_ids.dims[1];
  console.log(`Tokenized: batch=${batchSize}, seq=${seqLen}`);

  // Convert flat BigInt64Array to Vec<Vec<i64>> for napi
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

  const t0 = performance.now();
  // The native addon returns a flat Float32Array (length = batch * dim).
  const flat = await nativeModel.embedBatch(inputIds, attentionMask);
  const dim = nativeModel.dim;
  const embeddings = new Array(batchSize);
  for (let i = 0; i < batchSize; i++) {
    // Convert each per-batch typed array to a plain array so JSON.stringify writes a clean nested structure
    embeddings[i] = Array.from(flat.slice(i * dim, (i + 1) * dim));
  }
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`Inference: ${ms}ms for ${batchSize} inputs`);

  const out = {
    device: addon.nativeInferenceDevice(),
    inputs: TEST_INPUTS,
    batch_size: batchSize,
    seq_len: seqLen,
    input_ids: inputIds,
    attention_mask: attentionMask,
    embeddings,
  };
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${outPath} (${batchSize} embeddings, dim ${embeddings[0].length})`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
