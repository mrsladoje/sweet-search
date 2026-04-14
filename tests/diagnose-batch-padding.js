#!/usr/bin/env node
/**
 * Encode the same text once as batch-of-1 and once as part of a mixed-length
 * batch. If native has a bug where padding leaks into valid tokens, the
 * batched output for the same text will differ from the solo output.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;
const require = createRequire(import.meta.url);

function cos(a, b) { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); }

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { resolveNativeAddon } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-resolver.js'));
  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));

  const addon = require(resolveNativeAddon());
  const nativeModel = addon.NativeEmbeddingModel.load(
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/model.safetensors'),
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/config.json'),
  );

  const short = 'def foo(): return 1';
  const long = `def complex_function(a, b, c):\n    result = a + b * c\n    for i in range(100):\n        result += i * (a - b) % 17\n        if result > 1e6:\n            result = result % 1e5\n    return result\n\nclass BigClass:\n    def __init__(self, n):\n        self.data = [i * i for i in range(n)]\n    def process(self):\n        return sum(self.data)`;

  // Solo encoding of short text
  const tokSolo = tokenizer([short], { padding: true, truncation: true, max_length: 512 });
  const [, seqSolo] = tokSolo.input_ids.dims;
  const idsSolo = [Array.from(tokSolo.input_ids.data.slice(0, seqSolo)).map(Number)];
  const maskSolo = [Array.from(tokSolo.attention_mask.data.slice(0, seqSolo)).map(Number)];
  // The native addon returns a flat Float32Array (length = batch * dim).
  const dim = nativeModel.dim;
  const soloFlat = await nativeModel.embedBatch(idsSolo, maskSolo);
  const soloVec = Array.from(soloFlat.slice(0, dim));

  // Batched encoding with short + long (short gets padded to long's length)
  const tokBatch = tokenizer([short, long], { padding: true, truncation: true, max_length: 512 });
  const [B, seqBatch] = tokBatch.input_ids.dims;
  const idsBatch = [];
  const maskBatch = [];
  for (let b = 0; b < B; b++) {
    const base = b * seqBatch;
    idsBatch.push(Array.from(tokBatch.input_ids.data.slice(base, base + seqBatch)).map(Number));
    maskBatch.push(Array.from(tokBatch.attention_mask.data.slice(base, base + seqBatch)).map(Number));
  }
  const batchFlat = await nativeModel.embedBatch(idsBatch, maskBatch);
  const batchedShortVec = Array.from(batchFlat.slice(0, dim));

  const c = cos(soloVec, batchedShortVec);
  console.log(`short text seqLen solo=${seqSolo}  batched padded to=${seqBatch}`);
  console.log(`cos(solo vs batched): ${c.toFixed(8)}`);
  console.log(`solo[0:6]:    [${soloVec.slice(0,6).map(v=>v.toFixed(4)).join(', ')}]`);
  console.log(`batched[0:6]: [${batchedShortVec.slice(0,6).map(v=>v.toFixed(4)).join(', ')}]`);
  if (c > 0.9999) console.log('\n✓ Batch padding is handled correctly.');
  else console.log('\n✗ BATCH PADDING BUG: same text gives different output when padded.');
}

main().catch(e => { console.error(e); process.exit(1); });
