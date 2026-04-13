#!/usr/bin/env node
/**
 * Direct cosine comparison: native Metal F16 embeddings vs ORT INT8 embeddings.
 *
 * The accuracy gate `tests/native-inference-accuracy.js` compares native vs
 * ORT on 10 small synthetic snippets and reports 1.000000 cosine. But the
 * gencodesearchnet benchmark MRR has dropped from 83% (ORT INT8 baseline) to
 * ~58% (native F16). If the inference paths produced truly identical outputs,
 * the MRR shouldn't move at all.
 *
 * This script samples REAL benchmark documents (varied lengths, languages),
 * encodes the same text through both paths, and computes per-doc cosine.
 * If there's drift on long/varied inputs that the simple accuracy gate misses,
 * we'll see it here.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Sweet-search needs to think it's at the project root for native-resolver to find the addon
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  console.log('Loading both inference paths…');
  const { nativeEmbed } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-inference.js'));
  const { callLocalModelCpu } = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));

  // Load the ORT pipeline once (race-gated by the new fix)
  await callLocalModelCpu(['warmup'], { maxLength: 512 });
  await nativeEmbed(['warmup'], { maxLength: 512 });

  // Sample real gencodesearchnet documents
  const corpusPath = path.join(PROJECT_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  if (!fs.existsSync(corpusPath)) {
    console.error('gencodesearchnet corpus not found:', corpusPath);
    process.exit(1);
  }

  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean);
  // Sample 100 documents at varied lengths — first 50, then evenly spread
  const sample = [];
  for (let i = 0; i < 50 && i < lines.length; i++) sample.push(lines[i]);
  const stride = Math.floor(lines.length / 50);
  for (let i = 0; i < 50; i++) sample.push(lines[i * stride] || lines[i]);

  const texts = [];
  for (const line of sample) {
    try {
      const obj = JSON.parse(line);
      const t = obj.code || obj.text || '';
      if (t) texts.push(t);
    } catch {}
  }
  console.log(`Sampled ${texts.length} real documents (avg ${Math.round(texts.reduce((s, t) => s + t.length, 0) / texts.length)} chars)`);

  // Encode through both paths in identical chunks
  console.log('\nEncoding through native Metal F16…');
  const tNat = Date.now();
  const nativeVecs = await nativeEmbed(texts, { maxLength: 512 });
  const natMs = Date.now() - tNat;
  console.log(`  ${texts.length} texts in ${natMs}ms`);

  console.log('Encoding through ORT INT8…');
  const tOrt = Date.now();
  const ortVecs = await callLocalModelCpu(texts, { maxLength: 512 });
  const ortMs = Date.now() - tOrt;
  console.log(`  ${texts.length} texts in ${ortMs}ms`);

  // Compute per-doc cosine
  const cosines = [];
  for (let i = 0; i < texts.length; i++) {
    cosines.push(cosine(nativeVecs[i], ortVecs[i]));
  }
  cosines.sort((a, b) => a - b);

  const min = cosines[0];
  const p1  = cosines[Math.floor(cosines.length * 0.01)];
  const p5  = cosines[Math.floor(cosines.length * 0.05)];
  const p25 = cosines[Math.floor(cosines.length * 0.25)];
  const p50 = cosines[Math.floor(cosines.length * 0.50)];
  const p75 = cosines[Math.floor(cosines.length * 0.75)];
  const p95 = cosines[Math.floor(cosines.length * 0.95)];
  const max = cosines[cosines.length - 1];
  const avg = cosines.reduce((s, v) => s + v, 0) / cosines.length;

  console.log('\n──── Per-document cosine: native F16 vs ORT INT8 ────');
  console.log(`  min:  ${min.toFixed(6)}`);
  console.log(`  p1:   ${p1.toFixed(6)}`);
  console.log(`  p5:   ${p5.toFixed(6)}`);
  console.log(`  p25:  ${p25.toFixed(6)}`);
  console.log(`  p50:  ${p50.toFixed(6)}`);
  console.log(`  p75:  ${p75.toFixed(6)}`);
  console.log(`  p95:  ${p95.toFixed(6)}`);
  console.log(`  max:  ${max.toFixed(6)}`);
  console.log(`  avg:  ${avg.toFixed(6)}`);

  const below99 = cosines.filter(c => c < 0.99).length;
  const below95 = cosines.filter(c => c < 0.95).length;
  console.log(`\n  ${below99}/${cosines.length} (${(below99/cosines.length*100).toFixed(1)}%) below 0.99 cosine`);
  console.log(`  ${below95}/${cosines.length} (${(below95/cosines.length*100).toFixed(1)}%) below 0.95 cosine`);

  if (avg > 0.999) {
    console.log('\n  ✓ Inference paths are EQUIVALENT — regression is from elsewhere');
  } else if (avg > 0.99) {
    console.log('\n  ~ Small drift — could explain a few pp of MRR but not 25pp');
  } else {
    console.log('\n  ✗ Significant drift — likely the source of the regression');
  }

  // Also check L2 norm of each vec — they should both be 1.0 (normalized)
  const ortNorms = ortVecs.map(v => Math.sqrt(v.reduce((s, x) => s + x * x, 0)));
  const natNorms = nativeVecs.map(v => Math.sqrt(v.reduce((s, x) => s + x * x, 0)));
  console.log(`\n  ORT  L2 norm: avg=${(ortNorms.reduce((s,x)=>s+x,0)/ortNorms.length).toFixed(6)} min=${Math.min(...ortNorms).toFixed(6)} max=${Math.max(...ortNorms).toFixed(6)}`);
  console.log(`  Nat  L2 norm: avg=${(natNorms.reduce((s,x)=>s+x,0)/natNorms.length).toFixed(6)} min=${Math.min(...natNorms).toFixed(6)} max=${Math.max(...natNorms).toFixed(6)}`);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
