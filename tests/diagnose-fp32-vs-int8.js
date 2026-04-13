#!/usr/bin/env node
/**
 * Compare jalipalo FP32 ONNX vs mrsladoje INT8 ONNX on the same inputs.
 * If cosine is ~1.0, they're the same model modulo quant noise (expected).
 * If cosine is much lower, the INT8 was fine-tuned or quantized from a
 * different checkpoint, and the INT8's 83% MRR is really a different model.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;
process.env.SWEET_SEARCH_NATIVE_INFERENCE = '0';

function cos(a, b) { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); }

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { meanPoolWithAttentionMask } = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));
  const ort = await import('onnxruntime-node');

  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));

  const fp32 = await ort.InferenceSession.create('/tmp/jalipalo_fp32/model.onnx', { graphOptimizationLevel: 'all' });
  const int8 = await ort.InferenceSession.create(
    path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/onnx/model.onnx'),
    { graphOptimizationLevel: 'all' },
  );

  const corpusPath = path.join(PROJECT_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean);
  const stride = Math.floor(lines.length / 30);
  const texts = [];
  for (let i = 0; i < 30 && i * stride < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i * stride]);
      const t = obj.code || obj.text || '';
      if (t) texts.push(t);
    } catch {}
  }
  console.log(`testing ${texts.length} real docs`);

  const cosines = [];
  for (const text of texts) {
    const tok = tokenizer([text], { padding: true, truncation: true, max_length: 512 });
    const feed = {
      input_ids: new ort.Tensor('int64', tok.input_ids.data, tok.input_ids.dims),
      attention_mask: new ort.Tensor('int64', tok.attention_mask.data, tok.attention_mask.dims),
    };
    const fp32out = await fp32.run(feed);
    const int8out = await int8.run(feed);

    const fp32Pooled = Array.from(meanPoolWithAttentionMask(fp32out.token_embeddings, tok.attention_mask, true).data);
    const int8Pooled = Array.from(meanPoolWithAttentionMask(int8out.token_embeddings, tok.attention_mask, true).data);
    cosines.push(cos(fp32Pooled, int8Pooled));
  }
  cosines.sort((a,b)=>a-b);
  console.log(`\nFP32 ONNX mean-pool vs INT8 ONNX mean-pool:`);
  console.log(`  min:  ${cosines[0].toFixed(6)}`);
  console.log(`  p50:  ${cosines[Math.floor(cosines.length/2)].toFixed(6)}`);
  console.log(`  avg:  ${(cosines.reduce((s,x)=>s+x,0)/cosines.length).toFixed(6)}`);
  console.log(`  max:  ${cosines[cosines.length-1].toFixed(6)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
