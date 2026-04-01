#!/usr/bin/env node
/**
 * CoreML vs CPU A/B Latency Benchmark
 *
 * Measures inference latency for the embedding model (CodeRankEmbed) with
 * CoreML EP enabled vs CPU-only. Optionally extends to late-interaction.
 *
 * Design: Two-pass with interleaved per-query pairing within each pass.
 * Pass 1 loads CPU, Pass 2 loads CoreML. Queries are run in the same order
 * so iteration i uses the same query in both passes. To detect order bias,
 * a third pass re-runs CPU and compares Pass1-CPU vs Pass3-CPU drift.
 *
 * Usage:
 *   node scripts/benchmark-coreml.js [--iterations N] [--warmup N] [--json] [--models embedding,li]
 *
 * Environment:
 *   SWEET_SEARCH_USE_COREML is toggled internally per pass — do not set it externally.
 */

import { performance } from 'node:perf_hooks';
import os from 'os';
import { _resetCoreMLCache, isAppleSilicon, isCoreMLProviderAvailable } from '../core/infrastructure/coreml-provider.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let iterations = 30;
let warmup = 5;
let jsonOutput = false;
let modelSet = new Set(['embedding']);

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--iterations' && args[i + 1]) iterations = parseInt(args[i + 1], 10);
  if (args[i] === '--warmup' && args[i + 1]) warmup = parseInt(args[i + 1], 10);
  if (args[i] === '--json') jsonOutput = true;
  if (args[i] === '--models' && args[i + 1]) modelSet = new Set(args[i + 1].split(','));
}

// ---------------------------------------------------------------------------
// Sample queries (varying length — short identifiers to longer code snippets)
// ---------------------------------------------------------------------------

const QUERIES = [
  'authentication',
  'handleError',
  'database connection pool',
  'async function fetchData',
  'how does the search indexer work',
  'import { useState } from react',
  'class TokenizerWrapper extends BaseTokenizer',
  'const result = await session.run(feeds)',
  'for (let i = 0; i < items.length; i++) { if (items[i].score > threshold) results.push(items[i]); }',
  'export default function middleware(req, res, next) { validateToken(req.headers.authorization); next(); }',
];

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(values) {
  if (!values.length) return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0, n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    mean: round(mean),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    n: values.length,
  };
}

function round(v) { return Math.round(v * 100) / 100; }

function fmtMs(ms) {
  const abs = Math.abs(ms);
  const sign = ms < 0 ? '-' : '';
  if (abs < 0.001) return `${sign}${(abs * 1_000_000).toFixed(0)}ns`;
  if (abs < 1) return `${sign}${(abs * 1000).toFixed(0)}μs`;
  return `${sign}${abs.toFixed(2)}ms`;
}

// ---------------------------------------------------------------------------
// Embedding measurement
// ---------------------------------------------------------------------------

async function measureEmbedding(iterations, warmupCount) {
  const { getLocalPipeline, unloadLocalModel, callLocalModel } = await import('../core/embedding/embedding-local-model.js');

  await getLocalPipeline();

  // Warmup (single-text calls to match query-time behavior)
  for (let i = 0; i < warmupCount; i++) {
    await callLocalModel([QUERIES[i % QUERIES.length]]);
  }

  // Measure — each iteration uses a deterministic query so paired comparison is valid
  const latencies = [];
  for (let i = 0; i < iterations; i++) {
    const query = QUERIES[i % QUERIES.length];
    const t0 = performance.now();
    await callLocalModel([query]);
    latencies.push(performance.now() - t0);
  }

  await unloadLocalModel();
  return latencies;
}

// ---------------------------------------------------------------------------
// Late-interaction measurement
// ---------------------------------------------------------------------------

async function measureLateInteraction(iterations, warmupCount) {
  const { getLateInteractionPipeline, unloadLateInteractionModel, encodeQuery } = await import('../core/ranking/late-interaction-model.js');

  const pipeline = await getLateInteractionPipeline();
  if (!pipeline) {
    console.log('  Late-interaction model not available, skipping.');
    return null;
  }

  // Warmup
  for (let i = 0; i < warmupCount; i++) {
    await encodeQuery(QUERIES[i % QUERIES.length]);
  }

  // Measure
  const latencies = [];
  for (let i = 0; i < iterations; i++) {
    const query = QUERIES[i % QUERIES.length];
    const t0 = performance.now();
    await encodeQuery(query);
    latencies.push(performance.now() - t0);
  }

  await unloadLateInteractionModel();
  return latencies;
}

// ---------------------------------------------------------------------------
// Single pass (load → warmup → measure → unload)
// ---------------------------------------------------------------------------

async function runPass(label, coremlEnv) {
  console.log(`\n--- Pass: ${label} (SWEET_SEARCH_USE_COREML=${coremlEnv}) ---`);

  process.env.SWEET_SEARCH_USE_COREML = coremlEnv;
  _resetCoreMLCache();

  const results = {};

  if (modelSet.has('embedding')) {
    console.log('  Measuring embedding (CodeRankEmbed)...');
    results.embedding = await measureEmbedding(iterations, warmup);
    console.log(`  Done: ${results.embedding.length} samples, p50=${fmtMs(stats(results.embedding).p50)}`);
  }

  if (modelSet.has('li')) {
    console.log('  Measuring late-interaction (LateOn-Code)...');
    results.li = await measureLateInteraction(iterations, warmup);
    if (results.li) {
      console.log(`  Done: ${results.li.length} samples, p50=${fmtMs(stats(results.li).p50)}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printComparison(label, cpuArr, treatmentArr, treatmentName) {
  const cpuS = stats(cpuArr);
  const treatS = stats(treatmentArr);

  const deltaP50 = treatS.p50 - cpuS.p50;
  const deltaP95 = treatS.p95 - cpuS.p95;
  const speedupP50 = cpuS.p50 / treatS.p50;

  // Paired win-rate: for each iteration i, same query was used in both passes
  const pairCount = Math.min(cpuArr.length, treatmentArr.length);
  let wins = 0;
  for (let i = 0; i < pairCount; i++) {
    if (treatmentArr[i] < cpuArr[i]) wins++;
  }
  const winRate = ((wins / pairCount) * 100).toFixed(1);

  console.log(`  ${label}`);
  console.log('  ┌────────────┬────────────┬────────────┬────────────┐');
  console.log(`  │ Metric     │ CPU        │ ${treatmentName.padEnd(10)} │ Delta      │`);
  console.log('  ├────────────┼────────────┼────────────┼────────────┤');
  console.log(`  │ p50        │ ${fmtMs(cpuS.p50).padEnd(10)} │ ${fmtMs(treatS.p50).padEnd(10)} │ ${fmtMs(deltaP50).padEnd(10)} │`);
  console.log(`  │ p95        │ ${fmtMs(cpuS.p95).padEnd(10)} │ ${fmtMs(treatS.p95).padEnd(10)} │ ${fmtMs(deltaP95).padEnd(10)} │`);
  console.log(`  │ p99        │ ${fmtMs(cpuS.p99).padEnd(10)} │ ${fmtMs(treatS.p99).padEnd(10)} │            │`);
  console.log(`  │ mean       │ ${fmtMs(cpuS.mean).padEnd(10)} │ ${fmtMs(treatS.mean).padEnd(10)} │            │`);
  console.log('  └────────────┴────────────┴────────────┴────────────┘');
  console.log(`  Speedup (p50): ${speedupP50.toFixed(2)}x | Win rate: ${winRate}% (${wins}/${pairCount})`);

  if (speedupP50 > 1.05) {
    console.log(`  Verdict: ${treatmentName} is faster`);
  } else if (speedupP50 < 0.95) {
    console.log(`  Verdict: CPU is faster`);
  } else {
    console.log('  Verdict: No significant difference');
  }
  console.log('');

  return { speedupP50, winRate: parseFloat(winRate), deltaP50 };
}

function printReport(cpuResults, coremlResults, cpu2Results) {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  CoreML vs CPU A/B Latency Comparison');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const models = Object.keys(cpuResults).filter(k => cpuResults[k] && coremlResults[k]);

  for (const model of models) {
    printComparison(`Model: ${model} (CoreML vs CPU)`, cpuResults[model], coremlResults[model], 'CoreML');

    // Order-bias check: compare CPU Pass 1 vs CPU Pass 3
    if (cpu2Results?.[model]) {
      const drift = printComparison(
        `Model: ${model} (CPU Pass3 vs CPU Pass1 — order-bias check)`,
        cpuResults[model], cpu2Results[model], 'CPU-Pass3'
      );
      if (drift.speedupP50 > 1.05 || drift.speedupP50 < 0.95) {
        console.log('  ⚠ ORDER BIAS DETECTED: CPU-vs-CPU drift exceeds 5%.');
        console.log('  The CoreML comparison may be unreliable.\n');
      } else {
        console.log('  ✓ No significant order bias detected.\n');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!isAppleSilicon()) {
    console.log('CoreML benchmark requires macOS Apple Silicon. Skipping.');
    process.exit(0);
  }

  const available = await isCoreMLProviderAvailable();
  if (!available) {
    console.error('CoreML EP not available in this onnxruntime-node build.');
    process.exit(1);
  }

  console.log('CoreML vs CPU A/B Latency Benchmark');
  console.log(`Platform: ${os.cpus()[0].model}`);
  console.log(`Iterations: ${iterations}, Warmup: ${warmup}`);
  console.log(`Models: ${[...modelSet].join(', ')}`);
  console.log('Design: 3-pass (CPU → CoreML → CPU) to detect order bias');

  // Pass 1: CPU baseline
  const cpu = await runPass('CPU (Pass 1)', 'off');

  // Pass 2: CoreML treatment
  const coreml = await runPass('CoreML (Pass 2)', 'on');

  // Pass 3: CPU again (order-bias control)
  const cpu2 = await runPass('CPU (Pass 3 — bias control)', 'off');

  // Report
  if (jsonOutput) {
    const report = {};
    for (const model of Object.keys(cpu)) {
      if (!cpu[model] || !coreml[model]) continue;
      report[model] = {
        cpu_pass1: stats(cpu[model]),
        coreml: stats(coreml[model]),
        cpu_pass3: cpu2[model] ? stats(cpu2[model]) : null,
      };
    }
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(cpu, coreml, cpu2);
  }

  // Clean up env
  delete process.env.SWEET_SEARCH_USE_COREML;
  _resetCoreMLCache();
}

main().catch(err => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
