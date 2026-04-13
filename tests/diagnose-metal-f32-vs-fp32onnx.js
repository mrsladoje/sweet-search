#!/usr/bin/env node
/**
 * Compare native Metal F32 (new default) vs jalipalo FP32 ONNX on real docs.
 * If cosine < 1.0, Metal F32 is producing different outputs than CPU F32.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

function cos(a, b) { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); }

function jsMeanPool(flat, seqLen, hidden, mask) {
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
  const { nativeEmbed } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-inference.js'));
  const ort = await import('onnxruntime-node');

  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));
  const fp32Session = await ort.InferenceSession.create('/tmp/jalipalo_fp32/model.onnx', { graphOptimizationLevel: 'all' });

  const corpusPath = path.join(PROJECT_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean);
  const stride = Math.floor(lines.length / 10);
  const texts = [];
  for (let i = 0; i < 10 && i*stride < lines.length; i++) {
    try {
      const t = JSON.parse(lines[i*stride]).code || '';
      if (t) texts.push(t);
    } catch {}
  }

  // BATCH all texts through native first
  const nativeBatch = await nativeEmbed(texts, { maxLength: 512 });

  for (let idx = 0; idx < texts.length; idx++) {
    const text = texts[idx];
    const natVec = Array.from(nativeBatch[idx]);

    // ORT FP32 with JS mean pool
    const tok = tokenizer([text], { padding: true, truncation: true, max_length: 512 });
    const [, seqLen] = tok.input_ids.dims;
    const feed = {
      input_ids: new ort.Tensor('int64', tok.input_ids.data, tok.input_ids.dims),
      attention_mask: new ort.Tensor('int64', tok.attention_mask.data, tok.attention_mask.dims),
    };
    const outs = await fp32Session.run(feed);
    const mask = Array.from(tok.attention_mask.data.slice(0, seqLen)).map(Number);
    const ortPooled = jsMeanPool(outs.token_embeddings.data, seqLen, 768, mask);
    const c = cos(natVec, ortPooled);
    console.log(`seq=${seqLen.toString().padStart(3)}  cos(native_metal_f32, fp32_onnx): ${c.toFixed(8)}`);
    console.log(`  native[0:6]: [${natVec.slice(0,6).map(v=>v.toFixed(6)).join(', ')}]`);
    console.log(`  ort[0:6]:    [${Array.from(ortPooled).slice(0,6).map(v=>v.toFixed(6)).join(', ')}]`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
