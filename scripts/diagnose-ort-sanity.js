#!/usr/bin/env node
/**
 * Diagnostic: does ORT CPU INT8 produce sensible, differentiated
 * embeddings on THIS machine?
 *
 * The test is blunt: encode 10 unrelated texts, compute the pairwise
 * cosine similarity matrix, and check that DIFFERENT texts produce
 * DIFFERENT vectors (most pairwise cosines in [0.2, 0.8] — not all
 * clustered at 1.0).
 *
 * On a working machine:
 *   - Per-text self-cosine = 1.000
 *   - Cross-text cosines spread widely (0.2-0.9 range)
 *   - Similar texts rank higher than dissimilar ones
 *
 * On a broken machine (what we saw on AMD EPYC + NchwcTransformer):
 *   - ALL pairwise cosines ≈ 1.000 (degenerate — embeddings collapse)
 *
 * Also probes: does reducing thread count or disabling ORT graph
 * optimizations recover sanity? That narrows the root cause from
 * "ORT is broken" to "a specific optimizer is broken on this CPU".
 *
 * Works on: Mac, Linux, any CPU. Takes ~15 seconds.
 */

import { callLocalModelCpu, unloadLocalModel } from '../core/embedding/embedding-local-model.js';

const TEXTS = [
  // Semantically VERY different — working ORT should produce low pairwise cosine
  'how to parse json in python',
  'binary search implementation',
  'react component with state using useState hook',
  'sql inner join three tables users orders products',
  'rust error handling with Result type',
  // Semantically SIMILAR pairs — working ORT should show near-duplicate cosines
  'parse json data python',            // similar to texts[0]
  'binary search algorithm in array',  // similar to texts[1]
  'react functional component hook',   // similar to texts[2]
  'join query multiple tables sql',    // similar to texts[3]
  'rust error handling result enum',   // similar to texts[4]
];

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function l2norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

function printMatrix(embeds, labels) {
  // Print header
  const header = ['     '].concat(labels.map((l, i) => `  T${i}  `)).join('');
  console.log(header);
  for (let i = 0; i < embeds.length; i++) {
    const row = [`T${i}:  `];
    for (let j = 0; j < embeds.length; j++) {
      const c = cosine(embeds[i], embeds[j]);
      row.push(c.toFixed(3).padStart(6));
    }
    console.log(row.join(' '));
  }
}

async function run(label) {
  console.log(`\n── ${label} ──`);
  try { await unloadLocalModel(); } catch {}
  const t0 = Date.now();
  const rawVecs = await callLocalModelCpu(TEXTS, { maxLength: 512 });
  const embeds = rawVecs.map((v) => Float32Array.from(v));
  console.log(`Encoded ${TEXTS.length} texts in ${Date.now() - t0}ms`);
  console.log(`Dim: ${embeds[0].length}, L2 norm[0]: ${l2norm(embeds[0]).toFixed(6)}`);

  // Pairwise matrix
  console.log('\nPairwise cosine matrix (should show spread, NOT all 1.000):');
  printMatrix(embeds, TEXTS);

  // Degeneracy check
  const offDiag = [];
  for (let i = 0; i < embeds.length; i++) {
    for (let j = i + 1; j < embeds.length; j++) {
      offDiag.push(cosine(embeds[i], embeds[j]));
    }
  }
  offDiag.sort((a, b) => a - b);
  const min = offDiag[0];
  const max = offDiag[offDiag.length - 1];
  const median = offDiag[Math.floor(offDiag.length / 2)];
  const mean = offDiag.reduce((s, v) => s + v, 0) / offDiag.length;
  const spread = max - min;

  console.log(`\nOff-diagonal cosine distribution (${offDiag.length} pairs):`);
  console.log(`  min=${min.toFixed(4)}  median=${median.toFixed(4)}  mean=${mean.toFixed(4)}  max=${max.toFixed(4)}`);
  console.log(`  spread (max - min) = ${spread.toFixed(4)}`);

  const allHigh = offDiag.every((c) => c > 0.95);
  const goodSpread = spread > 0.15;

  // Expected similar-pair vs dissimilar-pair separation
  // text[0] ↔ text[5], text[1] ↔ text[6], etc are SIMILAR pairs
  // text[0] ↔ text[3] is a DISSIMILAR pair (python json vs sql)
  const similarPair = cosine(embeds[0], embeds[5]);   // similar
  const dissimilarPair = cosine(embeds[0], embeds[3]); // dissimilar
  const separation = similarPair - dissimilarPair;
  console.log(`\nSemantic separation test:`);
  console.log(`  similar   pair (T0 ↔ T5 python-json ↔ parse-json):  cos=${similarPair.toFixed(4)}`);
  console.log(`  dissimilar pair (T0 ↔ T3 python-json ↔ sql-join):   cos=${dissimilarPair.toFixed(4)}`);
  console.log(`  separation (similar - dissimilar) = ${separation.toFixed(4)}  (should be > 0.1 for working ORT)`);

  let verdict;
  if (allHigh) {
    verdict = '✗ DEGENERATE — all pairs cluster near cos=1.0. ORT is broken on this machine.';
  } else if (!goodSpread) {
    verdict = '✗ COLLAPSED — cosines don\'t spread. Partial degeneracy.';
  } else if (separation < 0.05) {
    verdict = '✗ NO SEMANTIC SEPARATION — ORT runs but produces semantically meaningless embeddings.';
  } else if (separation < 0.10) {
    verdict = '~ WEAK — embeddings differentiate weakly. Usable but suspicious.';
  } else {
    verdict = '✓ HEALTHY — embeddings are differentiated and semantically meaningful.';
  }
  console.log(`\nVerdict: ${verdict}`);
  return { allHigh, goodSpread, separation, verdict };
}

async function main() {
  console.log('═'.repeat(70));
  console.log('ORT CPU INT8 Sanity Check');
  console.log('═'.repeat(70));
  console.log(`Platform: ${process.platform}-${process.arch}`);
  console.log(`Node: ${process.version}`);
  console.log(`ORT threads (env): OMP_NUM_THREADS=${process.env.OMP_NUM_THREADS ?? 'not set'}, ORT_NUM_THREADS=${process.env.ORT_NUM_THREADS ?? 'not set'}`);

  const r1 = await run('Default settings');

  // If default is broken, try forcing single-thread to isolate threading/MLAS bugs
  if (r1.allHigh || !r1.goodSpread || r1.separation < 0.05) {
    console.log('\n─────────────────────────────────────────────');
    console.log('Default is broken. Retrying with OMP_NUM_THREADS=1 to isolate');
    console.log('whether the bug is in multithreaded MLAS or in the model itself.');
    console.log('─────────────────────────────────────────────');
    process.env.OMP_NUM_THREADS = '1';
    process.env.ORT_NUM_THREADS = '1';
    const r2 = await run('Single-thread (OMP_NUM_THREADS=1)');

    if (!r2.allHigh && r2.goodSpread && r2.separation > 0.10) {
      console.log('\n🔍 ROOT CAUSE ISOLATED: ORT multithreaded CPU path is broken on this machine.');
      console.log('   Workaround: set OMP_NUM_THREADS=1 for sweet-search queries.');
      console.log('   Better fix: cap ORT thread count via SessionOptions.intraOpNumThreads.');
    } else {
      console.log('\n🔍 Single-thread ALSO broken. Not a threading bug — likely MLAS quantized');
      console.log('   kernels or the model itself. Try a different onnxruntime-node version,');
      console.log('   or route queries through candle-cuda on Linux/NVIDIA.');
    }
  }
}

main().catch((e) => { console.error('sanity check failed:', e); process.exit(1); });
