#!/usr/bin/env node
/**
 * Router latency percentile benchmark — JS wrapper inclusive.
 *
 * Measures the **production hot path** (core/query/query-router.js routeQuery),
 * which is what sweet-search.js calls. This includes:
 *   - input validation
 *   - looksLikePath() fast-path
 *   - WASM CatBoost call (when path-fast doesn't fire)
 *   - reject-option logic
 *
 * Emits p50 / p95 / p99 in microseconds. Locally gates p99 < 100µs (the
 * production decision-latency target). Run via:
 *
 *   node scripts/benchmark-router-latency.mjs
 *   node scripts/benchmark-router-latency.mjs --iters 200000
 *   node scripts/benchmark-router-latency.mjs --json
 */

import { performance } from 'node:perf_hooks';
import { routeQuery } from '../core/query/query-router.js';

// -------- query corpus --------
//
// Mix of true file paths (fast-path), natural-language slash queries (must
// fall through to WASM after the path-detector tightening), identifiers,
// and full NL questions. This is the same shape we expect in production.
const CORPUS = [
  // True paths (fast-path lexical)
  'core/query/query-router.js',
  'package.json',
  'README.md',
  'src/server/index.ts',
  'foo/bar',
  'foo\\bar',
  '*.test.js',
  'tests/query/query-router-pathish.test.js',
  './scripts/run.sh',
  '../config/settings.yaml',
  // Ambiguous slash queries (must hit WASM, NOT fast-path)
  'HTTP/2 server setup',
  'file/function relationship',
  'and/or behavior',
  'request/response lifecycle',
  'TCP/IP stack overview',
  'client/server architecture',
  // Identifiers (lexical)
  'AuthService',
  'getUserById',
  'EmployeeController',
  'MAX_CONNECTION_POOL_SIZE',
  // NL questions (semantic)
  'how does authentication work',
  'explain the bot detection algorithm',
  'what is the architecture of the authentication system',
  // Hybrid-ambiguous
  'jwt token',
  'api key filter',
  'AuthService login flow',
  'password reset',
];

function parseArgs() {
  const args = process.argv.slice(2);
  let iters = 50000;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--iters') iters = +args[++i];
    else if (args[i] === '--json') json = true;
  }
  return { iters, json };
}

function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function runBench(iters) {
  // Warmup — make sure WASM is loaded and JIT is warm.
  for (let i = 0; i < 2000; i++) routeQuery(CORPUS[i % CORPUS.length]);

  // Per-call timings (microseconds).
  const all = new Float64Array(iters);
  const byMethod = new Map();
  for (let i = 0; i < iters; i++) {
    const q = CORPUS[i % CORPUS.length];
    const t0 = performance.now();
    const r = routeQuery(q);
    const us = (performance.now() - t0) * 1000;
    all[i] = us;
    const arr = byMethod.get(r.method) || [];
    arr.push(us);
    byMethod.set(r.method, arr);
  }

  const sorted = Array.from(all).sort((a, b) => a - b);
  const overall = {
    samples: iters,
    p50_us: quantile(sorted, 0.50),
    p95_us: quantile(sorted, 0.95),
    p99_us: quantile(sorted, 0.99),
    p999_us: quantile(sorted, 0.999),
    max_us: sorted[sorted.length - 1],
    mean_us: sorted.reduce((a, b) => a + b, 0) / iters,
  };

  const perMethod = {};
  for (const [method, samples] of byMethod) {
    samples.sort((a, b) => a - b);
    perMethod[method] = {
      samples: samples.length,
      p50_us: quantile(samples, 0.50),
      p95_us: quantile(samples, 0.95),
      p99_us: quantile(samples, 0.99),
      max_us: samples[samples.length - 1],
    };
  }

  return { overall, perMethod };
}

function main() {
  const { iters, json } = parseArgs();
  const { overall, perMethod } = runBench(iters);

  const target_us = 100;
  const passes = overall.p99_us < target_us;

  if (json) {
    process.stdout.write(JSON.stringify({
      target_p99_us: target_us,
      passes_p99_gate: passes,
      overall,
      perMethod,
    }, null, 2) + '\n');
    process.exit(passes ? 0 : 1);
  }

  console.log('═'.repeat(72));
  console.log('Router Latency Benchmark — JS wrapper inclusive (production hot path)');
  console.log('═'.repeat(72));
  console.log();
  console.log(`Samples: ${iters.toLocaleString()}  Corpus: ${CORPUS.length} queries`);
  console.log();
  console.log('Overall:');
  console.log(`  p50:  ${overall.p50_us.toFixed(2)} µs`);
  console.log(`  p95:  ${overall.p95_us.toFixed(2)} µs`);
  console.log(`  p99:  ${overall.p99_us.toFixed(2)} µs   (target: < ${target_us} µs)`);
  console.log(`  p999: ${overall.p999_us.toFixed(2)} µs`);
  console.log(`  max:  ${overall.max_us.toFixed(2)} µs`);
  console.log(`  mean: ${overall.mean_us.toFixed(2)} µs`);
  console.log();
  console.log('Per-method:');
  for (const [method, m] of Object.entries(perMethod)) {
    console.log(`  ${method.padEnd(18)} n=${String(m.samples).padStart(6)}  p50=${m.p50_us.toFixed(2).padStart(6)} µs  p95=${m.p95_us.toFixed(2).padStart(6)} µs  p99=${m.p99_us.toFixed(2).padStart(6)} µs  max=${m.max_us.toFixed(2)} µs`);
  }
  console.log();
  console.log(passes
    ? `PASS: p99 ${overall.p99_us.toFixed(2)} µs < ${target_us} µs`
    : `FAIL: p99 ${overall.p99_us.toFixed(2)} µs >= ${target_us} µs`);

  process.exit(passes ? 0 : 1);
}

main();
