#!/usr/bin/env node
/**
 * Two paths that SHOULD be identical:
 * A. inline tokenize + nativeModel.embedBatch directly
 * B. nativeEmbed(texts) via native-inference.js wrapper
 * If they diverge, the wrapper is buggy.
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
  const { nativeEmbed } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-inference.js'));

  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));
  const addon = require(resolveNativeAddon());
  const nativeModel = addon.NativeEmbeddingModel.load(
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/model.safetensors'),
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/config.json'),
  );

  const texts = [
    'def hello_world():\n    return "Hello, world!"',
    'for i in range(10):\n    print(i)',
    `class Counter:\n    def __init__(self): self.count = 0\n    def increment(self): self.count += 1`,
  ];

  // Path A: inline — BATCH them all together through model.embedBatch
  const tokA = tokenizer(texts, { padding: true, truncation: true, max_length: 512 });
  const [B, seqLen] = tokA.input_ids.dims;
  console.log(`Path A batch B=${B} seqLen=${seqLen}`);
  const idsA = [];
  const maskA = [];
  for (let b = 0; b < B; b++) {
    idsA.push(Array.from(tokA.input_ids.data.slice(b*seqLen, (b+1)*seqLen)).map(Number));
    maskA.push(Array.from(tokA.attention_mask.data.slice(b*seqLen, (b+1)*seqLen)).map(Number));
  }
  // The native addon returns a flat Float32Array — slice into per-batch vectors.
  const aFlat = await nativeModel.embedBatch(idsA, maskA);
  const aDim = nativeModel.dim;
  const aResult = new Array(B);
  for (let i = 0; i < B; i++) aResult[i] = aFlat.slice(i * aDim, (i + 1) * aDim);

  // Path B: nativeEmbed wrapper (also batches)
  const bResult = await nativeEmbed(texts, { maxLength: 512 });

  for (let i = 0; i < texts.length; i++) {
    const a = Array.from(aResult[i]);
    const b = Array.from(bResult[i]);
    const c = cos(a, b);
    console.log(`text[${i}] cos(A,B): ${c.toFixed(8)}  A[0:3]=[${a.slice(0,3).map(v=>v.toFixed(4)).join(', ')}]  B[0:3]=[${b.slice(0,3).map(v=>v.toFixed(4)).join(', ')}]`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
