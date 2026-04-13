#!/usr/bin/env node
/**
 * Compare the TWO HIGH-LEVEL WRAPPERS (nativeEmbed vs callLocalModelCpu) on
 * short texts where we've already verified the low-level paths match. If the
 * wrappers produce different outputs, the bug is in the wrapper glue.
 */
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

function cos(a, b) { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); }

async function main() {
  const { nativeEmbed } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-inference.js'));
  const { callLocalModelCpu } = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));

  const fs = await import('fs');
  const corpusPath = path.join(PROJECT_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean);
  const stride = Math.floor(lines.length / 20);
  const texts = [];
  for (let i = 0; i < 20 && i*stride < lines.length; i++) {
    try {
      const t = JSON.parse(lines[i*stride]).code || '';
      if (t) texts.push(t);
    } catch {}
  }

  const n = await nativeEmbed(texts, { maxLength: 512 });
  const o = await callLocalModelCpu(texts, { maxLength: 512 });

  for (let i = 0; i < texts.length; i++) {
    const na = Array.from(n[i]);
    const oa = Array.from(o[i]);
    console.log(`text[${i}]  cos: ${cos(na, oa).toFixed(8)}`);
    console.log(`  nat[0:6]: [${na.slice(0,6).map(v=>v.toFixed(6)).join(', ')}]`);
    console.log(`  ort[0:6]: [${oa.slice(0,6).map(v=>v.toFixed(6)).join(', ')}]`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
