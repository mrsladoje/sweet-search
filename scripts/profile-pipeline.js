#!/usr/bin/env node
/**
 * Phase 6a profiling harness — measures hot-path timings at public boundaries.
 *
 * Outputs:
 *   - Cold vs warm native CLI dispatch (e2e)
 *   - JS CLI fallback dispatch (e2e)
 *   - Tokenizer time (late-interaction)
 *   - ORT session.run() time (late-interaction)
 *   - MaxSim scoring time
 *   - Reranker time
 *   - Embedding time
 *
 * Usage:
 *   node scripts/profile-pipeline.js [--queries N] [--json]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const QUERIES = [
  'authentication',
  'how does search work',
  'database connection',
  'error handling',
  'middleware',
];

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let numQueries = 5;
let jsonOutput = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--queries' && args[i + 1]) numQueries = parseInt(args[i + 1], 10);
  if (args[i] === '--json') jsonOutput = true;
}
const queries = QUERIES.slice(0, Math.min(numQueries, QUERIES.length));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveNativeBinary() {
  try {
    const result = execFileSync(process.execPath, ['-e', `
      import { resolveNativeBinary } from './core/native-resolver.js';
      const p = resolveNativeBinary();
      process.stdout.write(p || '');
    `], { encoding: 'utf8', cwd: ROOT, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return result || null;
  } catch {
    return null;
  }
}

function timeSpawnMs(cmd, args, options = {}) {
  const start = performance.now();
  const result = spawnSync(cmd, args, { cwd: ROOT, timeout: 60000, encoding: 'utf8', stdio: 'pipe', ...options });
  const elapsed = performance.now() - start;
  return { elapsed, exitCode: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(values) {
  if (!values.length) return { p50: 0, p95: 0, mean: 0, n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    p50: Math.round(percentile(sorted, 50) * 100) / 100,
    p95: Math.round(percentile(sorted, 95) * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    n: values.length,
  };
}

// ---------------------------------------------------------------------------
// 1. CLI dispatch: cold, warm, JS fallback
// ---------------------------------------------------------------------------

async function measureCliDispatch(nativeBin) {
  const results = { cold: [], warm: [], js_fallback: [] };

  if (nativeBin) {
    // Cold: stop server, time the first invocation
    spawnSync(nativeBin, ['--stop'], { cwd: ROOT, stdio: 'pipe', timeout: 10000 });
    try { unlinkSync('/tmp/sweet-search.sock'); } catch { /* ok */ }
    try { unlinkSync('/tmp/search.sock'); } catch { /* ok */ }
    await new Promise(r => setTimeout(r, 1000));

    const cold = timeSpawnMs(nativeBin, [queries[0], '--json']);
    results.cold.push(cold.elapsed);

    // Warm: server should be running now. Measure multiple queries.
    await new Promise(r => setTimeout(r, 2000)); // let server finish loading
    for (const q of queries) {
      const warm = timeSpawnMs(nativeBin, [q, '--json']);
      if (warm.exitCode === 0) results.warm.push(warm.elapsed);
    }
  }

  // JS fallback dispatch
  for (const q of queries) {
    const js = timeSpawnMs(process.execPath, [join(ROOT, 'bin', 'sweet-search.js'), q, '--json']);
    if (js.exitCode === 0) results.js_fallback.push(js.elapsed);
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. Internal pipeline: run queries through SweetSearch and read stats
// ---------------------------------------------------------------------------

async function measurePipelineInternals() {
  const { default: SweetSearch } = await import(join(ROOT, 'core', 'sweet-search.js'));
  const { getLateInteractionTimings } = await import(join(ROOT, 'core', 'late-interaction-model.js'));

  const searcher = new SweetSearch({ verbose: false });
  await searcher.init();

  // Warmup
  await searcher.search('warmup query', { k: 5 });
  getLateInteractionTimings(); // discard warmup timings

  const timings = {
    total_ms: [],
    embed_us: [],
    hnsw_binary_us: [],
    hnsw_int8_us: [],
    float_rescore_us: [],
    li_total_us: [],
    li_tokenize_us: [],
    li_inference_us: [],
    rerank_us: [],
  };

  for (const q of queries) {
    getLateInteractionTimings(); // reset before each query
    const { stats: s } = await searcher.search(q, { k: 10 });

    // Total search time
    timings.total_ms.push(s.total_ms || s.server_ms || 0);

    // Embedding
    if (s.embed_us) timings.embed_us.push(s.embed_us);
    if (s.embedding?.latency_us) timings.embed_us.push(s.embedding.latency_us);

    // HNSW stages
    if (s.stages?.binary?.latency_us) timings.hnsw_binary_us.push(s.stages.binary.latency_us);
    if (s.stages?.int8?.latency_us) timings.hnsw_int8_us.push(s.stages.int8.latency_us);
    if (s.stages?.floatRescore?.latency_us) timings.float_rescore_us.push(s.stages.floatRescore.latency_us);

    // Late interaction total
    if (s.lateInteraction?.latency_us) timings.li_total_us.push(s.lateInteraction.latency_us);

    // Reranker (cross-encoder via cascade stats)
    if (typeof s.cascade?.ceLatencyMs === 'number') timings.rerank_us.push(s.cascade.ceLatencyMs * 1000);
    else if (s.stages?.rerank?.latency_us) timings.rerank_us.push(s.stages.rerank.latency_us);
    else if (typeof s.rerank?.latency_ms === 'number') timings.rerank_us.push(s.rerank.latency_ms * 1000);

    // LI tokenizer/inference split
    const liTiming = getLateInteractionTimings();
    if (liTiming.calls > 0) {
      timings.li_tokenize_us.push(liTiming.tokenize_us);
      timings.li_inference_us.push(liTiming.inference_us);
    }
  }

  searcher.close();
  return timings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Profile pipeline — ${queries.length} queries\n`);

  const nativeBin = resolveNativeBinary();
  console.log(`Native binary: ${nativeBin || 'not found'}`);

  // CLI dispatch
  console.log('\n--- CLI dispatch ---');
  const cli = await measureCliDispatch(nativeBin);

  // Pipeline internals
  console.log('\n--- Pipeline internals (loading...) ---');
  const pipeline = await measurePipelineInternals();

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------

  const report = {
    cli_cold_ms: stats(cli.cold),
    cli_warm_ms: stats(cli.warm),
    cli_js_ms: stats(cli.js_fallback),
    total_search_ms: stats(pipeline.total_ms),
    embedding_us: stats(pipeline.embed_us),
    hnsw_binary_us: stats(pipeline.hnsw_binary_us),
    hnsw_int8_us: stats(pipeline.hnsw_int8_us),
    float_rescore_us: stats(pipeline.float_rescore_us),
    li_total_us: stats(pipeline.li_total_us),
    li_tokenize_us: stats(pipeline.li_tokenize_us),
    li_inference_us: stats(pipeline.li_inference_us),
    rerank_us: stats(pipeline.rerank_us),
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  // Table output
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                 Phase 6 Profiling Results                   ║');
  console.log('╠══════════════════════════════╦═════════╦═════════╦══════════╣');
  console.log('║ Metric                       ║   p50   ║   p95   ║  calls   ║');
  console.log('╠══════════════════════════════╬═════════╬═════════╬══════════╣');

  const rows = [
    ['CLI cold start (ms)', report.cli_cold_ms],
    ['CLI warm (ms)', report.cli_warm_ms],
    ['CLI JS fallback (ms)', report.cli_js_ms],
    ['Total search (ms)', report.total_search_ms],
    ['Embedding (us)', report.embedding_us],
    ['HNSW binary (us)', report.hnsw_binary_us],
    ['HNSW int8 (us)', report.hnsw_int8_us],
    ['Float rescore (us)', report.float_rescore_us],
    ['LI total (us)', report.li_total_us],
    ['  LI tokenize (us)', report.li_tokenize_us],
    ['  LI inference (us)', report.li_inference_us],
    ['Rerank CE (us)', report.rerank_us],
  ];

  for (const [label, s] of rows) {
    if (!s || s.n === 0) continue;
    const p50 = String(s.p50).padStart(7);
    const p95 = String(s.p95).padStart(7);
    const n = String(s.n).padStart(6);
    console.log(`║ ${label.padEnd(28)} ║ ${p50} ║ ${p95} ║ ${n}   ║`);
  }

  console.log('╚══════════════════════════════╩═════════╩═════════╩══════════╝');

  // Percentage breakdown
  const totalMs = report.total_search_ms.p50;
  if (totalMs > 0) {
    console.log('\nPercentage of total search time (p50):');
    const breakdowns = [
      ['Embedding', (report.embedding_us.p50 / 1000) / totalMs * 100],
      ['HNSW binary', (report.hnsw_binary_us.p50 / 1000) / totalMs * 100],
      ['HNSW int8', (report.hnsw_int8_us.p50 / 1000) / totalMs * 100],
      ['Float rescore', (report.float_rescore_us.p50 / 1000) / totalMs * 100],
      ['LI tokenize', (report.li_tokenize_us.p50 / 1000) / totalMs * 100],
      ['LI inference', (report.li_inference_us.p50 / 1000) / totalMs * 100],
      ['Rerank CE', (report.rerank_us.p50 / 1000) / totalMs * 100],
    ];
    for (const [label, pct] of breakdowns) {
      if (pct > 0) {
        const bar = '█'.repeat(Math.round(pct / 2));
        console.log(`  ${label.padEnd(14)} ${pct.toFixed(1).padStart(5)}%  ${bar}`);
      }
    }
  }
}

main().catch(err => {
  console.error('Profile failed:', err);
  process.exit(1);
});
