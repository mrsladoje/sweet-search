#!/usr/bin/env node

/**
 * MaxSim Microbenchmark
 *
 * Isolates MaxSim scoring from the rest of the pipeline to measure:
 * - Dequantization latency (int8 → float32)
 * - Cosine similarity scoring latency
 * - Total MaxSim latency per candidate
 * - Total scoreWithLateInteraction latency
 *
 * Sweeps across document lengths, query lengths, and candidate counts.
 * Outputs p50/p95/avg plus score snapshots for accuracy verification.
 *
 * Usage:
 *   node scripts/benchmark-maxsim.js [--json] [--iterations N]
 */

import { performance } from 'perf_hooks';
import { LateInteractionIndex } from '../core/ranking/index.js';

// =============================================================================
// CONFIG
// =============================================================================

const DOC_TOKEN_COUNTS = [64, 128, 256, 512, 1024, 2048];
const QUERY_TOKEN_COUNTS = [8, 16, 32, 64];
const CANDIDATE_COUNTS = [10, 20, 50, 100];
const TOKEN_DIM = 128; // Match LateOn-Code full model
const DEFAULT_ITERATIONS = 50;

// =============================================================================
// HELPERS
// =============================================================================

/** Seeded PRNG for reproducible benchmarks */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateTokens(count, dim, rng) {
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const vec = new Array(dim);
    let norm = 0;
    for (let j = 0; j < dim; j++) {
      vec[j] = rng() * 2 - 1;
      norm += vec[j] * vec[j];
    }
    // L2 normalize (realistic for model outputs)
    norm = Math.sqrt(norm);
    for (let j = 0; j < dim; j++) vec[j] /= norm;
    tokens.push(vec);
  }
  return tokens;
}

function percentile(sorted, p) {
  const idx = Math.floor(sorted.length * p / 100);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    n: sorted.length,
  };
}

function fmt(us) {
  if (us < 1) return `${(us * 1000).toFixed(0)}ns`;
  if (us < 1000) return `${us.toFixed(1)}μs`;
  return `${(us / 1000).toFixed(2)}ms`;
}

// =============================================================================
// BENCHMARK: Dequantization isolation
// =============================================================================

async function benchmarkDequantization(iterations) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║          Dequantization Latency (Int8 → Float32)    ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const results = [];
  const rng = mulberry32(42);

  for (const docTokens of DOC_TOKEN_COUNTS) {
    const index = new LateInteractionIndex({ tokenDim: TOKEN_DIM, useInt8: true, maxTokens: Math.max(docTokens, 512) });
    index.initialized = true;

    // Add a document
    const tokens = generateTokens(docTokens, TOKEN_DIM, rng);
    await index.add('bench-doc', tokens);

    // Measure getTokens (which dequantizes)
    const latencies = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      index.getTokens('bench-doc');
      latencies.push((performance.now() - start) * 1000); // μs
    }

    const s = stats(latencies);
    results.push({ docTokens, ...s });
    console.log(`  ${String(docTokens).padStart(5)} tokens: p50=${fmt(s.p50).padStart(8)}  p95=${fmt(s.p95).padStart(8)}  avg=${fmt(s.avg).padStart(8)}`);
  }

  return results;
}

// =============================================================================
// BENCHMARK: MaxSim scoring isolation (pre-dequantized)
// =============================================================================

async function benchmarkMaxSimScoring(iterations) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║          MaxSim Scoring (pre-dequantized)           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const results = [];
  const rng = mulberry32(123);
  const index = new LateInteractionIndex({ tokenDim: TOKEN_DIM });

  for (const qLen of QUERY_TOKEN_COUNTS) {
    const queryTokens = generateTokens(qLen, TOKEN_DIM, rng);

    for (const dLen of DOC_TOKEN_COUNTS) {
      const docTokens = generateTokens(dLen, TOKEN_DIM, rng);

      // Warmup
      index.maxSimScore(queryTokens, docTokens);

      const latencies = [];
      let scoreSnapshot = 0;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const score = index.maxSimScore(queryTokens, docTokens);
        latencies.push((performance.now() - start) * 1000); // μs
        if (i === 0) scoreSnapshot = score;
      }

      const s = stats(latencies);
      const ops = qLen * dLen;
      results.push({ qLen, dLen, ops, score: scoreSnapshot, ...s });

      console.log(
        `  Q=${String(qLen).padStart(3)} × D=${String(dLen).padStart(5)}`
        + ` (${String(ops).padStart(8)} ops):`
        + ` p50=${fmt(s.p50).padStart(8)}`
        + ` p95=${fmt(s.p95).padStart(8)}`
        + ` avg=${fmt(s.avg).padStart(8)}`
        + ` score=${scoreSnapshot.toFixed(4)}`
      );
    }
    console.log();
  }

  return results;
}

// =============================================================================
// BENCHMARK: End-to-end scoreWithLateInteraction
// =============================================================================

async function benchmarkEndToEnd(iterations) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║    scoreWithLateInteraction (dequant + scoring)     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const results = [];
  const rng = mulberry32(456);

  for (const numCandidates of CANDIDATE_COUNTS) {
    for (const dLen of [128, 512, 2048]) {
      const index = new LateInteractionIndex({ tokenDim: TOKEN_DIM, useInt8: true, maxTokens: Math.max(dLen, 512) });
      index.initialized = true;

      // Add candidates
      const candidates = [];
      for (let c = 0; c < numCandidates; c++) {
        const id = `doc-${c}`;
        const tokens = generateTokens(dLen, TOKEN_DIM, rng);
        await index.add(id, tokens);
        candidates.push({ id, score: rng() });
      }

      // Fixed query (32 tokens — typical code query)
      const queryTokens = generateTokens(32, TOKEN_DIM, rng);

      // Warmup
      await index.scoreWithLateInteraction(queryTokens, candidates);

      const latencies = [];
      let scoreSnapshots = null;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const scored = await index.scoreWithLateInteraction(queryTokens, candidates);
        latencies.push((performance.now() - start) * 1000); // μs

        if (i === 0) {
          scoreSnapshots = scored.slice(0, 3).map(s => ({
            id: s.id,
            score: s.lateInteractionScore,
          }));
        }
      }

      const s = stats(latencies);
      const perCandidate = s.avg / numCandidates;
      results.push({ numCandidates, dLen, perCandidate, scores: scoreSnapshots, ...s });

      console.log(
        `  ${String(numCandidates).padStart(4)} candidates × ${String(dLen).padStart(5)} tokens:`
        + ` p50=${fmt(s.p50).padStart(9)}`
        + ` p95=${fmt(s.p95).padStart(9)}`
        + ` avg=${fmt(s.avg).padStart(9)}`
        + ` per-cand=${fmt(perCandidate).padStart(8)}`
      );
    }
    console.log();
  }

  return results;
}

// =============================================================================
// BENCHMARK: Candidate pruning (maxCandidates cap)
// =============================================================================

async function benchmarkCandidatePruning(iterations) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║    Candidate Pruning: maxCandidates cap             ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const results = [];
  const rng = mulberry32(456); // Same seed as end-to-end for comparison

  const totalCandidates = 100;
  const dLen = 512;
  const maxCandidateCaps = [null, 50, 30, 20, 10]; // null = no cap (baseline)

  const index = new LateInteractionIndex({ tokenDim: TOKEN_DIM, useInt8: true, maxTokens: dLen });
  index.initialized = true;

  const candidates = [];
  for (let c = 0; c < totalCandidates; c++) {
    const id = `doc-${c}`;
    const tokens = generateTokens(dLen, TOKEN_DIM, rng);
    await index.add(id, tokens);
    candidates.push({ id, score: rng() });
  }

  const queryTokens = generateTokens(32, TOKEN_DIM, rng);

  // Get baseline scores (no cap) for accuracy comparison
  const baselineScored = await index.scoreWithLateInteraction(queryTokens, candidates);
  const baselineTop5 = baselineScored.slice(0, 5).map(s => s.id);
  const baselineTop10 = baselineScored.slice(0, 10).map(s => s.id);

  for (const cap of maxCandidateCaps) {
    const label = cap === null ? 'no cap' : `top-${cap}`;
    const opts = cap === null ? {} : { maxCandidates: cap };

    // Warmup
    await index.scoreWithLateInteraction(queryTokens, candidates, opts);

    const latencies = [];
    let scoredResult = null;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const scored = await index.scoreWithLateInteraction(queryTokens, candidates, opts);
      latencies.push((performance.now() - start) * 1000);
      if (i === 0) scoredResult = scored;
    }

    // Accuracy: how many of baseline top-5/top-10 appear in this result's top-5/top-10?
    const thisTop5 = scoredResult.slice(0, 5).map(s => s.id);
    const thisTop10 = scoredResult.slice(0, 10).map(s => s.id);
    const top5Recall = baselineTop5.filter(id => thisTop5.includes(id)).length / 5;
    const top10Recall = baselineTop10.filter(id => thisTop10.includes(id)).length / 10;
    const prunedCount = scoredResult.filter(s => s._pruned).length;

    const s = stats(latencies);
    results.push({ cap, label, prunedCount, top5Recall, top10Recall, ...s });

    console.log(
      `  ${label.padEnd(8)}:`
      + ` p50=${fmt(s.p50).padStart(9)}`
      + ` p95=${fmt(s.p95).padStart(9)}`
      + ` avg=${fmt(s.avg).padStart(9)}`
      + ` top5R=${(top5Recall * 100).toFixed(0)}%`
      + ` top10R=${(top10Recall * 100).toFixed(0)}%`
      + ` pruned=${prunedCount}`
    );
  }

  return results;
}

// =============================================================================
// BENCHMARK: Dequantization vs Scoring breakdown
// =============================================================================

async function benchmarkBreakdown(iterations) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║      Cost Breakdown: Dequantization vs Scoring      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const results = [];
  const rng = mulberry32(789);

  for (const dLen of [128, 512, 2048]) {
    const index = new LateInteractionIndex({ tokenDim: TOKEN_DIM, useInt8: true, maxTokens: Math.max(dLen, 512) });
    index.initialized = true;

    const tokens = generateTokens(dLen, TOKEN_DIM, rng);
    await index.add('bench-doc', tokens);
    const queryTokens = generateTokens(32, TOKEN_DIM, rng);

    // Measure dequantization only
    const dequantLatencies = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      index.getTokens('bench-doc');
      dequantLatencies.push((performance.now() - start) * 1000);
    }

    // Measure scoring only (pre-dequantized)
    const dequantizedTokens = index.getTokens('bench-doc');
    const scoringLatencies = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      index.maxSimScore(queryTokens, dequantizedTokens);
      scoringLatencies.push((performance.now() - start) * 1000);
    }

    // Measure combined (scoreWithLateInteraction for 1 candidate)
    const combinedLatencies = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await index.scoreWithLateInteraction(queryTokens, [{ id: 'bench-doc', score: 0.5 }]);
      combinedLatencies.push((performance.now() - start) * 1000);
    }

    const dq = stats(dequantLatencies);
    const sc = stats(scoringLatencies);
    const cb = stats(combinedLatencies);
    const dqPct = ((dq.avg / cb.avg) * 100).toFixed(1);
    const scPct = ((sc.avg / cb.avg) * 100).toFixed(1);

    results.push({ dLen, dequant: dq, scoring: sc, combined: cb, dqPct, scPct });

    console.log(`  ${dLen} tokens:`);
    console.log(`    Dequantize: p50=${fmt(dq.p50).padStart(8)}  avg=${fmt(dq.avg).padStart(8)}  (${dqPct}% of total)`);
    console.log(`    Scoring:    p50=${fmt(sc.p50).padStart(8)}  avg=${fmt(sc.avg).padStart(8)}  (${scPct}% of total)`);
    console.log(`    Combined:   p50=${fmt(cb.p50).padStart(8)}  avg=${fmt(cb.avg).padStart(8)}`);
    console.log();
  }

  return results;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const iterIdx = args.indexOf('--iterations');
  const iterations = iterIdx >= 0 ? parseInt(args[iterIdx + 1], 10) : DEFAULT_ITERATIONS;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║         MaxSim Microbenchmark Suite                 ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Token dimension: ${TOKEN_DIM}`);
  console.log(`  Iterations per config: ${iterations}`);
  console.log(`  Date: ${new Date().toISOString()}`);

  const allResults = {};

  allResults.dequantization = await benchmarkDequantization(iterations);
  allResults.maxSimScoring = await benchmarkMaxSimScoring(iterations);
  allResults.endToEnd = await benchmarkEndToEnd(iterations);
  allResults.candidatePruning = await benchmarkCandidatePruning(iterations);
  allResults.breakdown = await benchmarkBreakdown(iterations);

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                          ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Find the "typical" case: 32 query tokens, 20 candidates, 512 doc tokens
  const typical = allResults.endToEnd.find(
    r => r.numCandidates === 20 && r.dLen === 512
  );
  if (typical) {
    console.log(`  Typical case (20 candidates × 512 tokens, Q=32):`);
    console.log(`    Total:        p50=${fmt(typical.p50)}, p95=${fmt(typical.p95)}`);
    console.log(`    Per candidate: avg=${fmt(typical.perCandidate)}`);
  }

  // Worst case: 100 candidates, 2048 doc tokens
  const worst = allResults.endToEnd.find(
    r => r.numCandidates === 100 && r.dLen === 2048
  );
  if (worst) {
    console.log(`\n  Worst case (100 candidates × 2048 tokens, Q=32):`);
    console.log(`    Total:        p50=${fmt(worst.p50)}, p95=${fmt(worst.p95)}`);
    console.log(`    Per candidate: avg=${fmt(worst.perCandidate)}`);
  }

  // Breakdown
  const breakdown512 = allResults.breakdown.find(r => r.dLen === 512);
  if (breakdown512) {
    console.log(`\n  Cost breakdown (512 tokens, Q=32):`);
    console.log(`    Dequantization: ${breakdown512.dqPct}%`);
    console.log(`    Scoring:        ${breakdown512.scPct}%`);
  }

  if (jsonMode) {
    console.log('\n--- JSON OUTPUT ---');
    console.log(JSON.stringify(allResults, null, 2));
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
