#!/usr/bin/env node
/**
 * Diagnostic: does CUDA F32 candle produce embeddings compatible with
 * ORT CPU INT8 query embeddings? This is THE test we missed.
 *
 * parity-cuda.js compared candle-cpu ↔ candle-cuda — same model, different
 * device. But production uses:
 *   - Indexing:  candle with FP32 safetensors (any device)
 *   - Querying:  ORT with INT8 ONNX (always CPU)
 * These are TWO DIFFERENT MODEL FILES. If their vector spaces diverge by
 * even a rotation, cosine-based retrieval collapses. On Mac Metal this
 * works empirically — but we never verified it programmatically on CUDA.
 *
 * What this script does (≈10 s):
 *   1. Encode 10 texts (5 queries + 5 matching docs) via ORT CPU INT8
 *   2. Encode same 10 texts via CUDA F32 candle
 *   3. Print per-text cosine between the two encodings (same text, two paths)
 *   4. Run 3 synthetic retrievals:
 *        (a) ORT → ORT: baseline, proves harness works
 *        (b) ORT → CUDA: PRODUCTION path (query ORT, docs CUDA) — the one that matters
 *        (c) CUDA → CUDA: internal consistency of CUDA path
 *
 * Exit codes:
 *   0 — production retrieval correct (5/5), CUDA docs compatible with ORT queries
 *   1 — production retrieval broken, vector-space mismatch confirmed
 *   2 — baseline ORT→ORT broken, environment issue
 */

import { detectHardwareCapability } from '../core/infrastructure/hardware-capability.js';
import {
  loadNativeEmbeddingModelWithDevice,
  nativeEmbed,
  unloadNativeModels,
} from '../core/infrastructure/native-inference.js';
import { callLocalModelCpu, unloadLocalModel } from '../core/embedding/embedding-local-model.js';

// 5 query/doc pairs. query[i] should be top-1 match for doc[5+i].
const TEXTS = [
  // Queries
  'how to parse json in python',
  'binary search implementation',
  'react component with state using useState hook',
  'sql inner join three tables users orders products',
  'rust error handling with Result type',
  // Docs
  'import json\ndef parse_json(s):\n    return json.loads(s)\n\ndef to_json(obj):\n    return json.dumps(obj)',
  'def binary_search(arr, target):\n    lo, hi = 0, len(arr) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if arr[mid] == target: return mid\n        elif arr[mid] < target: lo = mid + 1\n        else: hi = mid - 1\n    return -1',
  'function Counter() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;\n}',
  'SELECT u.name, o.id, p.title FROM users u\nINNER JOIN orders o ON o.user_id = u.id\nINNER JOIN products p ON p.id = o.product_id\nWHERE u.active = 1',
  'fn parse(input: &str) -> Result<Config, ParseError> {\n    let value = input.parse::<toml::Value>().map_err(|e| ParseError::Syntax(e))?;\n    Ok(Config::from(value))\n}',
];

const N_QUERIES = 5;

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

function evaluateRetrieval(queryEmbeds, docEmbeds, label) {
  let correct = 0;
  const rows = [];
  for (let q = 0; q < N_QUERIES; q++) {
    const scores = [];
    for (let d = 0; d < N_QUERIES; d++) {
      scores.push({ d, s: cosine(queryEmbeds[q], docEmbeds[N_QUERIES + d]) });
    }
    scores.sort((a, b) => b.s - a.s);
    const top = scores[0];
    const isMatch = top.d === q;
    if (isMatch) correct += 1;
    rows.push({ q, top: top.d, score: top.s, correct: isMatch, runnerUp: scores[1] });
  }
  console.log(`── ${label} ──`);
  for (const r of rows) {
    const mark = r.correct ? '✓' : '✗';
    console.log(`  ${mark} Q${r.q}: top-1=doc${r.top} (${r.score.toFixed(3)})  runner-up=doc${r.runnerUp.d} (${r.runnerUp.s.toFixed(3)})`);
  }
  console.log(`  Score: ${correct}/${N_QUERIES}`);
  console.log();
  return correct;
}

async function main() {
  const hw = detectHardwareCapability();
  console.log('═'.repeat(70));
  console.log('CUDA F32 candle ↔ ORT CPU INT8 Vector-Space Diagnostic');
  console.log('═'.repeat(70));
  console.log(`Platform: ${hw.platform}-${hw.arch}`);
  console.log(`GPU: ${hw.nvidiaGpu?.name ?? 'n/a'} (CC ${hw.nvidiaGpu?.computeCapability ?? 'n/a'})`);
  console.log(`CUDA available: ${hw.cudaAvailable}`);
  console.log();

  if (!hw.cudaAvailable) {
    console.log('SKIP — CUDA not available on this host.');
    process.exit(2);
  }

  // Step 1: ORT CPU INT8 (production query path)
  console.log('[1/2] Encoding via ORT CPU INT8 (production QUERY path, the ONNX model)...');
  unloadNativeModels();
  try { await unloadLocalModel(); } catch {}
  const t0 = Date.now();
  const ortRaw = await callLocalModelCpu(TEXTS, { maxLength: 512 });
  console.log(`      done in ${Date.now() - t0}ms`);
  const ortEmbeds = ortRaw.map((v) => Float32Array.from(v));

  // Step 2: CUDA F32 candle (production indexing path)
  console.log('[2/2] Encoding via CUDA F32 candle (production INDEXING path, the safetensors model)...');
  try { await unloadLocalModel(); } catch {}
  unloadNativeModels();
  await loadNativeEmbeddingModelWithDevice('cuda');
  const t1 = Date.now();
  const cudaRaw = await nativeEmbed(TEXTS);
  console.log(`      done in ${Date.now() - t1}ms`);
  const cudaEmbeds = cudaRaw.map((v) => Float32Array.from(v));

  console.log();

  // Sanity: vector dimensionality + L2 norms.
  console.log('── Sanity ──');
  console.log(`  ORT dim: ${ortEmbeds[0].length}, L2 norm[0]=${l2norm(ortEmbeds[0]).toFixed(6)}`);
  console.log(`  CUDA dim: ${cudaEmbeds[0].length}, L2 norm[0]=${l2norm(cudaEmbeds[0]).toFixed(6)}`);
  if (ortEmbeds[0].length !== cudaEmbeds[0].length) {
    console.log(`  ✗ DIMENSION MISMATCH — vector spaces cannot possibly align.`);
    process.exit(1);
  }
  console.log();

  // Pairwise alignment: same text, two paths. This is the signal.
  console.log('── Pairwise alignment: cos(ORT_INT8, CUDA_F32) for identical text ──');
  let okCount = 0;
  for (let i = 0; i < TEXTS.length; i++) {
    const c = cosine(ortEmbeds[i], cudaEmbeds[i]);
    const flag = c >= 0.95 ? '✓' : c >= 0.70 ? '~' : '✗';
    if (c >= 0.95) okCount += 1;
    const preview = TEXTS[i].slice(0, 60).replace(/\n/g, ' ');
    console.log(`  ${flag} cos=${c.toFixed(4)}  "${preview}..."`);
  }
  console.log(`  ${okCount}/${TEXTS.length} texts have cos ≥ 0.95 between the two paths`);
  console.log();

  // Three retrieval evaluations
  const ortOrt = evaluateRetrieval(ortEmbeds, ortEmbeds, 'ORT → ORT (baseline: query ORT, docs ORT)');
  const ortCuda = evaluateRetrieval(ortEmbeds, cudaEmbeds, 'ORT → CUDA (PRODUCTION: query ORT, docs CUDA F32)');
  const cudaCuda = evaluateRetrieval(cudaEmbeds, cudaEmbeds, 'CUDA → CUDA (query CUDA F32, docs CUDA F32)');

  console.log('═'.repeat(70));
  console.log('Verdict');
  console.log('═'.repeat(70));

  if (ortOrt < N_QUERIES) {
    console.log('✗ BASELINE BROKEN — even ORT → ORT fails. This is an environment issue');
    console.log('  (tokenizer mismatch? wrong model cache? corrupt download?).');
    console.log('  Check: ls ~/.cache/sweet-search/models/');
    process.exit(2);
  }

  if (ortCuda === N_QUERIES) {
    console.log('✓ PRODUCTION RETRIEVAL OK — CUDA F32 docs align with ORT INT8 queries.');
    console.log('  The gencodesearchnet failure is NOT a vector-space mismatch.');
    console.log('  Next suspects: HNSW quantization, profile=balanced config, index corruption,');
    console.log('  or a bug in run_benchmark.js that bypassed the CUDA indexing path.');
    process.exit(0);
  }

  console.log(`✗ PRODUCTION RETRIEVAL BROKEN — ORT → CUDA scored ${ortCuda}/${N_QUERIES}.`);
  console.log('  CONFIRMED: CUDA F32 candle embeddings do NOT live in the same vector space');
  console.log('  as ORT CPU INT8 query embeddings.');
  console.log();
  console.log('  Alignment metric (cos of identical text encoded two ways):');
  console.log(`    ${okCount}/${TEXTS.length} texts scored ≥ 0.95`);
  console.log();
  console.log('  Diagnostic clues:');
  if (cudaCuda === N_QUERIES) {
    console.log('    - CUDA → CUDA works (5/5): CUDA embeddings are internally consistent.');
    console.log('    - The issue is specifically in the ORT ↔ candle model alignment.');
    console.log('    - This IS the same issue that must exist on Mac Metal — but it works there.');
    console.log('      → Investigate: what makes Metal/BF16 candle output align with INT8 ONNX');
    console.log('        that CUDA/F32 candle output does not?');
  } else {
    console.log('    - CUDA → CUDA ALSO fails: CUDA embeddings themselves are degenerate.');
    console.log('    - Rule out: forward pass correctness on Blackwell, tokenizer, model load.');
  }

  process.exit(1);
}

main().catch((err) => {
  console.error('diagnostic failed:', err);
  process.exit(1);
});
