#!/usr/bin/env node
/**
 * Bypass sweet-search's ORT session config and test each graph
 * optimization level directly. Tells us if the pod's ORT degeneracy
 * is fixable by dropping graphOptimizationLevel from 'all' to 'extended'
 * or below.
 *
 * Iterates through: disabled → basic → extended → all.
 * For each, encodes 4 texts and reports pairwise cosine spread.
 *
 * Expected on Mac: all four levels healthy (spread > 0.3).
 * Expected on pod: 'all' broken (spread ≈ 0), lower levels may recover.
 */

import * as ort from 'onnxruntime-node';
import { join } from 'path';
import { getModelEntry, getModelCacheDir } from '../core/infrastructure/index.js';
import { createTokenizer } from '../core/infrastructure/native-tokenizer.js';

const TEXTS = [
  'how to parse json in python',
  'binary search implementation',
  'sql inner join three tables',
  'parse json data python',  // similar to texts[0]
];

const LEVELS = ['disabled', 'basic', 'extended', 'all'];

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

async function testLevel(level, modelPath, tokenizer) {
  const session = await ort.InferenceSession.create(modelPath, {
    graphOptimizationLevel: level,
    intraOpNumThreads: 4,
    executionMode: 'sequential',
  });

  const embeddings = [];
  for (const text of TEXTS) {
    const tokens = tokenizer([text], { padding: true, truncation: true, max_length: 512 });
    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(tokens.input_ids.data, BigInt), tokens.input_ids.dims),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(tokens.attention_mask.data, BigInt), tokens.attention_mask.dims),
    };
    const out = await session.run(feeds);
    // sentence_embedding output is pre-pooled. Some models have it as
    // output; otherwise use mean-pooled token_embeddings. The INT8 model
    // we ship has both.
    const vec = out.sentence_embedding?.data ?? out.token_embeddings?.data;
    if (!vec) throw new Error(`No sentence_embedding or token_embeddings in outputs: ${Object.keys(out)}`);
    // Take first batch element, first 768 dims (handle whichever output shape)
    const dim = 768;
    const embedding = Float32Array.from(vec.slice(0, dim));
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) norm += embedding[i] * embedding[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) embedding[i] /= norm;
    }
    embeddings.push(embedding);
  }
  await session.release();

  // Compute off-diagonal spread
  const pairs = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      pairs.push({ i, j, c: cosine(embeddings[i], embeddings[j]) });
    }
  }
  pairs.sort((a, b) => a.c - b.c);
  const min = pairs[0].c;
  const max = pairs[pairs.length - 1].c;
  const spread = max - min;
  const similarPair = cosine(embeddings[0], embeddings[3]); // texts[0] ↔ texts[3]
  const dissimilarPair = cosine(embeddings[0], embeddings[2]); // texts[0] ↔ texts[2]

  return { min, max, spread, similarPair, dissimilarPair };
}

async function main() {
  console.log(`Platform: ${process.platform}-${process.arch}`);
  console.log(`onnxruntime-node: ${ort.env?.versions?.common ?? 'unknown'}`);
  console.log();

  const entry = getModelEntry('coderankembed-int8');
  const modelPath = join(getModelCacheDir(entry.hfId), 'onnx/model.onnx');
  const tokenizerPath = join(getModelCacheDir(entry.hfId), 'tokenizer.json');
  const tokenizer = await createTokenizer(tokenizerPath);

  console.log('Model:', modelPath);
  console.log('Texts:');
  TEXTS.forEach((t, i) => console.log(`  T${i}: ${t}`));
  console.log();
  console.log('Expected: T0 ↔ T3 (similar) should have HIGHER cosine than T0 ↔ T2 (dissimilar).');
  console.log();

  const results = [];
  for (const level of LEVELS) {
    process.stderr.write(`Testing graphOptimizationLevel=${level}... `);
    try {
      const r = await testLevel(level, modelPath, tokenizer);
      process.stderr.write('done\n');
      results.push({ level, ...r });
    } catch (e) {
      process.stderr.write(`FAILED: ${e.message}\n`);
      results.push({ level, error: e.message });
    }
  }

  console.log();
  console.log('Level     | min cos  | max cos  | spread   | T0↔T3 sim | T0↔T2 diff | separation | verdict');
  console.log('----------|----------|----------|----------|-----------|------------|------------|--------');
  for (const r of results) {
    if (r.error) {
      console.log(`${r.level.padEnd(10)}| ERROR: ${r.error}`);
      continue;
    }
    const sep = r.similarPair - r.dissimilarPair;
    const verdict = sep > 0.15 ? 'HEALTHY' : sep > 0.05 ? 'weak' : r.spread < 0.01 ? 'DEGENERATE' : 'broken';
    console.log(
      `${r.level.padEnd(10)}| ${r.min.toFixed(4).padStart(8)} | ${r.max.toFixed(4).padStart(8)} | ${r.spread.toFixed(4).padStart(8)} | ${r.similarPair.toFixed(4).padStart(9)} | ${r.dissimilarPair.toFixed(4).padStart(10)} | ${sep.toFixed(4).padStart(10)} | ${verdict}`
    );
  }

  const healthy = results.filter((r) => !r.error && (r.similarPair - r.dissimilarPair) > 0.15);
  console.log();
  if (healthy.length === 0) {
    console.log('✗ NO optimization level produces healthy output.');
    console.log('  Conclusion: the onnxruntime-node ↔ AMD Zen 3 bug is BELOW the graph-optimizer layer.');
    console.log('  Likely in MLAS quantized kernels themselves. Not fixable via session config.');
    console.log('  Path forward: route queries through candle-cuda on Linux/NVIDIA.');
  } else {
    const best = healthy[0];
    console.log(`✓ FIX AVAILABLE — graphOptimizationLevel='${best.level}' produces healthy embeddings.`);
    console.log(`  Edit core/infrastructure/onnx-session-utils.js::buildSessionOptions`);
    console.log(`  to use '${best.level}' on Linux x64, and queries will work again.`);
  }
}

main().catch((e) => { console.error('optlevel probe failed:', e); process.exit(1); });
