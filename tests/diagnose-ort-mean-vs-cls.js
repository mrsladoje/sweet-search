#!/usr/bin/env node
/**
 * Is ORT's mean-pool output close to its CLS pool (sentence_embedding)?
 * If yes, both paths represent roughly the same sentence semantic and we can
 * switch native to CLS without losing compatibility. If they're far apart,
 * only one of them is the "correct" sentence representation.
 */
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;
process.env.SWEET_SEARCH_NATIVE_INFERENCE = '0';
import fs from 'fs';

function cos(a, b) { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); }
function l2(v){ const s=Math.sqrt(v.reduce((a,x)=>a+x*x,0)); return v.map(x=>x/s); }

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { getLocalPipeline, meanPoolWithAttentionMask } = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));
  const ort = await import('onnxruntime-node');

  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));
  const { session } = await getLocalPipeline();

  // Sample 30 real gencodesearchnet docs
  const corpusPath = path.join(PROJECT_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean).slice(0, 30);
  const texts = lines.map(l => { try { return JSON.parse(l).code || ''; } catch { return ''; } }).filter(Boolean);
  console.log(`testing ${texts.length} docs\n`);

  const cosines = [];
  for (const text of texts) {
    const tok = tokenizer([text], { padding: true, truncation: true, max_length: 512 });
    const feed = {
      input_ids: new ort.Tensor('int64', tok.input_ids.data, tok.input_ids.dims),
      attention_mask: new ort.Tensor('int64', tok.attention_mask.data, tok.attention_mask.dims),
    };
    const outs = await session.run(feed);

    const meanPool = meanPoolWithAttentionMask(outs.token_embeddings, tok.attention_mask, true);
    const meanVec = Array.from(meanPool.data);
    const clsVec = l2(Array.from(outs.sentence_embedding.data));

    cosines.push(cos(meanVec, clsVec));
  }
  cosines.sort((a,b)=>a-b);
  const min = cosines[0];
  const avg = cosines.reduce((s,x)=>s+x,0)/cosines.length;
  const p50 = cosines[Math.floor(cosines.length/2)];
  const max = cosines[cosines.length-1];
  console.log(`ORT mean-pool vs ORT CLS-pool (L2-normalized both):`);
  console.log(`  min: ${min.toFixed(6)}  p50: ${p50.toFixed(6)}  avg: ${avg.toFixed(6)}  max: ${max.toFixed(6)}`);
  if (avg > 0.98) console.log('\n  → mean and CLS are essentially the same vector on this model. Safe to switch.');
  else if (avg > 0.9) console.log('\n  → moderate difference. They represent similar-but-distinct directions.');
  else console.log('\n  → MEAN AND CLS ARE DIFFERENT. Only one is the training target.');
}

main().catch(e => { console.error(e); process.exit(1); });
