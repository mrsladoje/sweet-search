#!/usr/bin/env node
/**
 * Encoder outputs match FP32 ONNX byte-for-byte (diagnose-fp32-gold.js).
 * But native MRR is 57% and FP32 ONNX MRR is 83%. The bug must be in the
 * native pooling/normalization path (nativeEmbed does it in Rust).
 *
 * Test: call embed_batch (native pooled+L2) and forwardRawFirst (raw hidden,
 * JS-pooled+L2 manually) for the same input. If they differ, the Rust
 * mean_pool + L2 norm path is broken.
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

function jsMeanPoolAndNormalize(flat, seqLen, hidden, mask) {
  const out = new Float32Array(hidden);
  let n = 0;
  for (let t = 0; t < seqLen; t++) {
    if (Number(mask[t]) === 0) continue;
    n++;
    for (let h = 0; h < hidden; h++) out[h] += flat[t*hidden + h];
  }
  if (n > 0) for (let h = 0; h < hidden; h++) out[h] /= n;
  let s = 0; for (let i=0;i<out.length;i++) s += out[i]*out[i];
  const norm = Math.sqrt(s);
  if (norm > 0) for (let i=0;i<out.length;i++) out[i] /= norm;
  return out;
}

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { resolveNativeAddon } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-resolver.js'));

  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));

  const addon = require(resolveNativeAddon());
  const nativeModel = addon.NativeEmbeddingModel.load(
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/model.safetensors'),
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/config.json'),
  );

  const fs = await import('fs');
  const corpusPath = path.join(PROJECT_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean).slice(0, 10);
  const texts = lines.map(l => { try { return JSON.parse(l).code || ''; } catch { return ''; } }).filter(Boolean);

  const cosines = [];
  for (const text of texts) {
    const tok = tokenizer([text], { padding: true, truncation: true, max_length: 512 });
    const [, seqLen] = tok.input_ids.dims;
    const inputIds = [Array.from(tok.input_ids.data.slice(0, seqLen)).map(Number)];
    const attentionMask = [Array.from(tok.attention_mask.data.slice(0, seqLen)).map(Number)];

    // Path A: embed_batch → Rust mean_pool + Rust L2 normalize
    const pooledByRust = await nativeModel.embedBatch(inputIds, attentionMask);
    const rustVec = Array.from(pooledByRust[0]);

    // Path B: forward_raw_first → JS mean_pool + JS L2 normalize
    const rawFlat = new Float32Array(await nativeModel.forwardRawFirst(inputIds, attentionMask));
    const mask = Array.from(tok.attention_mask.data.slice(0, seqLen)).map(Number);
    const jsVec = jsMeanPoolAndNormalize(rawFlat, seqLen, 768, mask);

    const c = cos(rustVec, jsVec);
    cosines.push(c);
    console.log(`seq=${seqLen.toString().padStart(3)}  rust_pool vs js_pool cos: ${c.toFixed(8)}   rust[0:3]=[${rustVec.slice(0,3).map(v=>v.toFixed(4)).join(', ')}]   js[0:3]=[${Array.from(jsVec).slice(0,3).map(v=>v.toFixed(4)).join(', ')}]`);
  }
  const avg = cosines.reduce((s,x)=>s+x,0)/cosines.length;
  console.log(`\navg cosine: ${avg.toFixed(8)}`);
  if (avg > 0.9999) console.log('✓ Rust pool matches JS pool. Bug is elsewhere.');
  else console.log('✗ Rust pool DIFFERS from JS pool. Bug is in nomic_bert::mean_pooling or l2_normalize.');
}

main().catch(e => { console.error(e); process.exit(1); });
