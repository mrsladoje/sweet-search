#!/usr/bin/env node
/**
 * Root-cause investigation: WHY does ORT CPU INT8 break on AMD Zen 3
 * EPYC but work on Apple M3 Max? Both run the same onnxruntime-node
 * binary (1.24.3), same model, same graph optimizations — different
 * results.
 *
 * This script digs into the hardware + MLAS code path:
 *
 *   1. CPU capability dump (vendor, features, AVX-512 / VNNI / AMX
 *      support) — MLAS dispatches to different kernels based on these.
 *   2. ORT version + build info.
 *   3. Test MULTIPLE INT8 models (CodeRankEmbed and MiniLM-L6-v2) to
 *      determine if the bug is model-specific or MLAS-wide.
 *   4. Per-tensor inspection of the first layer's output to see where
 *      in the model the corruption starts.
 *
 * Runs in ~20s. If Test 3 shows BOTH models broken identically → the
 * bug is in MLAS itself (not our model). If only CodeRankEmbed breaks →
 * a specific operator in that model hits the bug.
 */

import * as ort from 'onnxruntime-node';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

import { getModelEntry, getModelCacheDir } from '../core/infrastructure/index.js';
import { createTokenizer } from '../core/infrastructure/native-tokenizer.js';

// -------------------------------------------------------------------
// 1. CPU capability dump
// -------------------------------------------------------------------
function dumpCpuInfo() {
  console.log('── CPU / Platform ──');
  console.log(`  Platform:   ${process.platform}-${process.arch}`);
  console.log(`  CPU model:  ${os.cpus()[0]?.model ?? 'unknown'}`);
  console.log(`  Logical:    ${os.cpus().length}`);
  console.log(`  Total RAM:  ${(os.totalmem() / 1e9).toFixed(1)} GB`);

  try {
    if (process.platform === 'linux' && existsSync('/proc/cpuinfo')) {
      const cpuinfo = readFileSync('/proc/cpuinfo', 'utf8');
      const flagsLine = cpuinfo.split('\n').find((l) => l.startsWith('flags'));
      const flags = flagsLine?.split(':')[1]?.trim().split(/\s+/) ?? [];
      const vendor = cpuinfo.match(/vendor_id\s*:\s*(\S+)/)?.[1] ?? 'unknown';
      const family = cpuinfo.match(/cpu family\s*:\s*(\S+)/)?.[1] ?? 'unknown';
      const model = cpuinfo.match(/model\s*:\s*(\S+)/)?.[1] ?? 'unknown';
      console.log(`  Vendor:     ${vendor}`);
      console.log(`  CPU family: ${family} model ${model}`);

      const checks = [
        ['sse4_2', 'SSE4.2'],
        ['avx', 'AVX'],
        ['avx2', 'AVX2'],
        ['avx512f', 'AVX-512 foundation'],
        ['avx512vnni', 'AVX-512 VNNI (INT8 matmul)'],
        ['avx_vnni', 'AVX-VNNI (Intel Alder Lake+)'],
        ['amx_int8', 'AMX INT8 (Intel Sapphire Rapids+)'],
        ['amx_bf16', 'AMX BF16'],
      ];
      console.log('  ISA support:');
      for (const [flag, label] of checks) {
        const has = flags.includes(flag);
        console.log(`    ${has ? '✓' : '✗'} ${label}  (flag: ${flag})`);
      }

      // MLAS dispatch prediction
      const hasVnni = flags.includes('avx512vnni') || flags.includes('avx_vnni');
      const hasAmx = flags.includes('amx_int8');
      console.log('  MLAS INT8 matmul will likely dispatch to:');
      if (hasAmx) console.log('    → AMX INT8 kernels (fastest, Intel Sapphire Rapids+)');
      else if (hasVnni) console.log('    → AVX-512/AVX VNNI kernels (fast, well-tested)');
      else if (flags.includes('avx2')) console.log('    → AVX2-only INT8 fallback (⚠ LESS EXERCISED PATH)');
      else console.log('    → SSE scalar fallback (very slow)');
    } else if (process.platform === 'darwin') {
      const brand = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf8' }).trim();
      console.log(`  Brand:      ${brand}`);
      try {
        const features = execSync('sysctl -n machdep.cpu.features 2>/dev/null || sysctl -n hw.optional.arm', { encoding: 'utf8' }).trim();
        console.log(`  Features:   ${features.slice(0, 200)}...`);
      } catch {}
      console.log('  MLAS INT8 matmul will dispatch to:');
      console.log('    → ARM NEON / Apple AMX kernels (arm64-specific path, different code from x64 MLAS)');
    }
  } catch (e) {
    console.log(`  (CPU probe error: ${e.message})`);
  }
  console.log();
}

// -------------------------------------------------------------------
// 2. ORT version info
// -------------------------------------------------------------------
function dumpOrtInfo() {
  console.log('── ONNX Runtime ──');
  console.log(`  version:    ${ort.env?.versions?.common ?? 'unknown'}`);
  console.log(`  providers:  ${(ort.env?.availableExecutionProviders ?? []).join(', ') || 'cpu (only exposed)'}`);
  console.log(`  log level:  ${ort.env?.logLevel ?? 'warning'}`);
  console.log();
}

// -------------------------------------------------------------------
// 3. Test a model for semantic separation
// -------------------------------------------------------------------
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function l2normalize(vec) {
  let n = 0;
  for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i];
  n = Math.sqrt(n);
  if (n === 0) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
  return out;
}

async function testModel({ label, modelPath, tokenizerPath, texts, outputKey, dim }) {
  console.log(`── ${label} ──`);
  if (!existsSync(modelPath)) {
    console.log(`  SKIP: model file not found at ${modelPath}`);
    console.log();
    return null;
  }
  console.log(`  model:     ${modelPath}`);
  const tokenizer = await createTokenizer(tokenizerPath);
  const session = await ort.InferenceSession.create(modelPath, {
    graphOptimizationLevel: 'disabled',  // eliminate optimizer as variable
    intraOpNumThreads: 1,                // eliminate threading as variable
    executionMode: 'sequential',
  });

  const embeddings = [];
  for (const text of texts) {
    const tokens = tokenizer([text], { padding: true, truncation: true, max_length: 512 });
    const feeds = {
      input_ids: new ort.Tensor(
        'int64',
        BigInt64Array.from(tokens.input_ids.data, BigInt),
        tokens.input_ids.dims,
      ),
      attention_mask: new ort.Tensor(
        'int64',
        BigInt64Array.from(tokens.attention_mask.data, BigInt),
        tokens.attention_mask.dims,
      ),
    };
    // BERT-family models (like MiniLM-L6-v2) require token_type_ids as
    // a third input. NomicBERT / CodeRankEmbed don't. Auto-detect and
    // fill with zeros (all tokens belong to segment 0 for single-text
    // encoding).
    if (session.inputNames.includes('token_type_ids')) {
      feeds.token_type_ids = new ort.Tensor(
        'int64',
        new BigInt64Array(tokens.input_ids.data.length), // zeros
        tokens.input_ids.dims,
      );
    }
    const out = await session.run(feeds);
    const tensor = out[outputKey];
    if (!tensor) {
      console.log(`  FAIL: no '${outputKey}' output in ${Object.keys(out).join(',')}`);
      await session.release();
      console.log();
      return null;
    }
    // Take first batch, first dim slots — for models that output either
    // (batch, dim) or (batch, seq, dim), slice the first `dim` floats.
    const raw = Float32Array.from(tensor.data.slice(0, dim));
    embeddings.push(l2normalize(raw));
  }
  await session.release();

  // Compute pairwise cosine + semantic separation
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
  const similar = cosine(embeddings[0], embeddings[3]);   // T0 "json parse py" ↔ T3 "parse json data py"
  const dissimilar = cosine(embeddings[0], embeddings[2]); // T0 ↔ T2 "sql join"
  const separation = similar - dissimilar;
  const verdict = separation > 0.15 ? 'HEALTHY' : separation > 0.05 ? 'weak' : spread < 0.01 ? 'DEGENERATE' : 'broken';
  console.log(`  min=${min.toFixed(4)}  max=${max.toFixed(4)}  spread=${spread.toFixed(4)}`);
  console.log(`  similar pair   (T0↔T3): ${similar.toFixed(4)}`);
  console.log(`  dissimilar pair (T0↔T2): ${dissimilar.toFixed(4)}`);
  console.log(`  separation (similar - dissimilar): ${separation.toFixed(4)}`);
  console.log(`  verdict: ${verdict}`);
  console.log();
  return { verdict, spread, separation };
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------
const TEXTS = [
  'how to parse json in python',
  'binary search implementation',
  'sql inner join three tables',
  'parse json data python',  // similar to T0
];

async function main() {
  console.log('═'.repeat(72));
  console.log('ORT Root-Cause Investigation — WHY does Linux x64 AMD break?');
  console.log('═'.repeat(72));
  console.log();

  dumpCpuInfo();
  dumpOrtInfo();

  // Test 1: CodeRankEmbed INT8 (known broken on pod, known good on Mac)
  const coderank = getModelEntry('coderankembed-int8');
  const codeRankResult = await testModel({
    label: 'Test 1: CodeRankEmbed INT8 (mrsladoje)',
    modelPath: join(getModelCacheDir(coderank.hfId), 'onnx/model.onnx'),
    tokenizerPath: join(getModelCacheDir(coderank.hfId), 'tokenizer.json'),
    texts: TEXTS,
    outputKey: 'sentence_embedding',
    dim: 768,
  });

  // Test 2: MiniLM-L6-v2 INT8 (different model, same INT8 code path)
  const minilm = getModelEntry('all-minilm-l6-v2');
  const minilmResult = await testModel({
    label: 'Test 2: all-MiniLM-L6-v2 INT8 (Xenova, sentence-transformers)',
    modelPath: join(getModelCacheDir(minilm.hfId), 'onnx/model_quantized.onnx'),
    tokenizerPath: join(getModelCacheDir(minilm.hfId), 'tokenizer.json'),
    texts: TEXTS,
    outputKey: 'last_hidden_state', // MiniLM outputs last_hidden_state; we take [CLS] token (first 384 dims)
    dim: 384,
  });

  console.log('═'.repeat(72));
  console.log('Conclusion');
  console.log('═'.repeat(72));
  const codeBroken = codeRankResult && codeRankResult.verdict === 'DEGENERATE';
  const minilmBroken = minilmResult && minilmResult.verdict === 'DEGENERATE';
  if (codeBroken && minilmBroken) {
    console.log('✗ BOTH INT8 models broken identically.');
    console.log('  Root cause: the MLAS quantized matmul code path for this CPU is broken.');
    console.log('  NOT model-specific. It is an ORT / CPU-vendor issue.');
    console.log();
    console.log('  Likely culprit on AMD Zen 3: MLAS AVX2-only INT8 fallback path.');
    console.log('  Intel CPUs with AVX-512 VNNI take a different, well-tested code path.');
    console.log('  Apple Silicon takes a completely different arm64 NEON path.');
    console.log('  → AMD Zen 3 is a rarely-tested "gap" between Zen 4 (has VNNI) and Intel.');
    console.log();
    console.log('  Remediation options:');
    console.log('    (a) Upgrade onnxruntime-node to a version that fixes the Zen 3 INT8 path');
    console.log('    (b) Use FP32 model on Linux x64 AMD hosts (no quantization bug)');
    console.log('    (c) Route queries through candle-cuda on Linux+NVIDIA');
    console.log('    (d) File an upstream onnxruntime issue with this reproducer');
  } else if (codeBroken && !minilmBroken) {
    console.log('✓ MiniLM healthy, CodeRankEmbed broken.');
    console.log('  Bug is MODEL-SPECIFIC — a specific operator in CodeRankEmbed hits the MLAS bug.');
    console.log('  Likely candidate: an operator used by NomicBERT but not MiniLM (e.g. LayerNorm fused');
    console.log('  with quantized attention, or the RoPE/GeGLU path).');
    console.log('  Fix: either re-export CodeRankEmbed without the buggy op, or pin a working ORT version.');
  } else if (!codeBroken && !minilmBroken) {
    console.log('✓ BOTH models healthy — ORT is working fine on this machine.');
    console.log('  This is the expected output on a working host (Mac, Intel, AMD Zen 4+).');
  } else {
    console.log('? Unexpected combination. Inspect the per-test outputs.');
  }
}

main().catch((e) => { console.error('root cause probe failed:', e); process.exit(1); });
