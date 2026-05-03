/**
 * Dumps tokenized inputs + candle Metal BF16 reference LI vectors to JSON.
 *
 * Used by test_pytorch_li_parity.py and future CoreML LI parity tests.
 * The native LI model produces per-token 128d vectors; we save the full
 * flat output (vectors: Float32Array) plus tokenCounts per batch item
 * so the Python side can reconstruct per-token vectors for comparison.
 *
 * Usage:
 *   node scripts/spike-coreml/dump_candle_li_reference.js [out.json]
 */

import { join } from 'path';
import { writeFileSync, existsSync } from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { createTokenizer } from '../../core/infrastructure/native-tokenizer.js';

const require = createRequire(import.meta.url);

// Same 10 inputs as dump_candle_reference.js for consistency across
// embedding and LI parity tests.
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
  const outPath = process.argv[2] || join(import.meta.dirname || new URL('.', import.meta.url).pathname, 'candle_li_reference.json');

  const { resolveNativeAddon } = await import('../../core/infrastructure/native-resolver.js');
  const addonPath = resolveNativeAddon();
  if (!addonPath) throw new Error('Native addon not found');
  const addon = require(addonPath);
  if (!addon.NativeLateInteractionModel) throw new Error('NativeLateInteractionModel missing');

  console.log(`device=${addon.nativeInferenceDevice()}  available=${addon.nativeInferenceAvailable()}`);

  const modelDir = join(os.homedir(), '.cache', 'sweet-search', 'models', 'lightonai--LateOn-Code');
  const backbonePath = join(modelDir, 'model.safetensors');
  const projPath = join(modelDir, '1_Dense', 'model.safetensors');
  const configPath = join(modelDir, 'config.json');
  if (!existsSync(backbonePath)) throw new Error(`Missing ${backbonePath}`);

  // Standard lateon-code: single 768→128 stage. For the edge variant, pass
  // [proj1, proj2] + [512, 48] and the edge model's config + tokenizer.
  const nativeModel = addon.NativeLateInteractionModel.load(backbonePath, [projPath], [128], configPath);
  console.log(`Loaded ModernBERT LI (dim=${nativeModel.dim})`);

  // Use the LateOn-Code tokenizer (separate from the embedding tokenizer).
  const tokenizerPath = join(modelDir, 'tokenizer.json');
  const tokenizer = await createTokenizer(tokenizerPath);

  const tokenized = tokenizer(TEST_INPUTS, { padding: true, truncation: true, max_length: 2048 });
  const batchSize = TEST_INPUTS.length;
  const seqLen = tokenized.input_ids.dims[1];
  console.log(`Tokenized: batch=${batchSize}, seq=${seqLen}`);

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
  const result = await nativeModel.encodeBatch(inputIds, attentionMask);
  const ms = (performance.now() - t0).toFixed(1);

  // result.vectors is a flat Float32Array (post Float32Array fix).
  // Length = sum(tokenCounts) * 128.
  const flat = Array.from(result.vectors);
  const tokenCounts = Array.from(result.tokenCounts);
  const totalActive = tokenCounts.reduce((a, b) => a + b, 0);
  console.log(`Inference: ${ms}ms for ${batchSize} inputs, ${totalActive} active tokens total`);

  const out = {
    device: addon.nativeInferenceDevice(),
    inputs: TEST_INPUTS,
    batch_size: batchSize,
    seq_len: seqLen,
    dim: nativeModel.dim,
    input_ids: inputIds,
    attention_mask: attentionMask,
    token_counts: tokenCounts,
    vectors_flat: flat,  // sum(token_counts) * dim floats
  };
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${outPath} (${flat.length} floats across ${totalActive} active tokens)`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
