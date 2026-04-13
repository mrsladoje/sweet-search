#!/usr/bin/env node
/**
 * Layer-ism hunt: compare the RAW encoder output [seq, hidden] produced by
 * candle vs the ORT graph's `token_embeddings` output, under IDENTICAL
 * tokenization AND identical JS mean-pooling. This isolates divergence to
 * the encoder itself (or upstream) vs anything downstream.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;
const require = createRequire(import.meta.url);

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return d / (Math.sqrt(na)*Math.sqrt(nb));
}

function jsMeanPool(flat, seqLen, hidden, mask) {
  const out = new Float32Array(hidden);
  let n = 0;
  for (let t = 0; t < seqLen; t++) {
    if (Number(mask[t]) === 0) continue;
    n++;
    for (let h = 0; h < hidden; h++) out[h] += flat[t*hidden + h];
  }
  if (n > 0) for (let h = 0; h < hidden; h++) out[h] /= n;
  return out;
}
function l2norm(v) {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i]*v[i];
  const n = Math.sqrt(s);
  const out = new Float32Array(v.length);
  if (n > 0) for (let i = 0; i < v.length; i++) out[i] = v[i]/n;
  return out;
}

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { getLocalPipeline } = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));
  const { resolveNativeAddon } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-resolver.js'));
  const ort = await import('onnxruntime-node');

  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));
  const ortPipeline = await getLocalPipeline();
  const session = ortPipeline.session;

  const addon = require(resolveNativeAddon());
  const nativeModel = addon.NativeEmbeddingModel.load(
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/model.safetensors'),
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/config.json'),
  );

  const texts = [
    'def hello_world():\n    return "Hello, world!"',
    'for i in range(10):\n    print(i)',
    `def quicksort(a):\n    if len(a) <= 1: return a\n    p = a[0]\n    return quicksort([x for x in a[1:] if x < p]) + [p] + quicksort([x for x in a[1:] if x >= p])`,
  ];

  for (let ti = 0; ti < texts.length; ti++) {
    const text = texts[ti];
    const tok = tokenizer([text], { padding: true, truncation: true, max_length: 512 });
    const [_b, seqLen] = tok.input_ids.dims;
    const hidden = 768;

    const feed = {
      input_ids: new ort.Tensor('int64', tok.input_ids.data, tok.input_ids.dims),
      attention_mask: new ort.Tensor('int64', tok.attention_mask.data, tok.attention_mask.dims),
    };
    const outs = await session.run(feed);
    const ortFlat = outs.token_embeddings.data;

    const inputIds = [Array.from(tok.input_ids.data.slice(0, seqLen)).map(Number)];
    const attentionMask = [Array.from(tok.attention_mask.data.slice(0, seqLen)).map(Number)];
    const nativeFlatVec = await nativeModel.forwardRawFirst(inputIds, attentionMask);
    const nativeFlat = new Float32Array(nativeFlatVec);

    const mask = Array.from(tok.attention_mask.data.slice(0, seqLen)).map(Number);

    const cosPerToken = [];
    for (let t = 0; t < seqLen; t++) {
      if (mask[t] === 0) continue;
      const a = ortFlat.slice(t*hidden, (t+1)*hidden);
      const b = nativeFlat.slice(t*hidden, (t+1)*hidden);
      cosPerToken.push(cosine(a, b));
    }
    const minCos = Math.min(...cosPerToken);
    const avgCos = cosPerToken.reduce((s, x) => s + x, 0) / cosPerToken.length;

    const ortPooled = l2norm(jsMeanPool(ortFlat, seqLen, hidden, mask));
    const natPooled = l2norm(jsMeanPool(nativeFlat, seqLen, hidden, mask));
    const pooledCos = cosine(ortPooled, natPooled);

    let ortL2Sum = 0, natL2Sum = 0;
    for (let t = 0; t < seqLen; t++) {
      if (mask[t] === 0) continue;
      let osum = 0, nsum = 0;
      for (let h = 0; h < hidden; h++) {
        osum += ortFlat[t*hidden+h]**2;
        nsum += nativeFlat[t*hidden+h]**2;
      }
      ortL2Sum += Math.sqrt(osum);
      natL2Sum += Math.sqrt(nsum);
    }
    const ortAvgTokL2 = ortL2Sum / cosPerToken.length;
    const natAvgTokL2 = natL2Sum / cosPerToken.length;

    console.log(`\n── text[${ti}] seq=${seqLen} ──`);
    console.log(`  per-token cos: min=${minCos.toFixed(6)} avg=${avgCos.toFixed(6)}`);
    console.log(`  pooled cos (JS mean-pool identical): ${pooledCos.toFixed(6)}`);
    console.log(`  avg per-token L2: ORT=${ortAvgTokL2.toFixed(4)}  native=${natAvgTokL2.toFixed(4)}`);
    console.log(`  first 6 of ORT tok[0]:    [${Array.from(ortFlat.slice(0,6)).map(v=>v.toFixed(4)).join(', ')}]`);
    console.log(`  first 6 of native tok[0]: [${Array.from(nativeFlat.slice(0,6)).map(v=>v.toFixed(4)).join(', ')}]`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
