#!/usr/bin/env node
/**
 * Full-index benchmark runner.
 * Runs index-codebase-v21.js --full with timing and reports results.
 * Usage: node scripts/benchmark-full-index.js [--with-pool] [--label LABEL]
 */
import { execSync } from 'child_process';
import { performance } from 'perf_hooks';
import os from 'os';

const args = process.argv.slice(2);
const withPool = args.includes('--with-pool');
const labelIdx = args.indexOf('--label');
const label = labelIdx >= 0 ? args[labelIdx + 1] : (withPool ? 'with-pool' : 'baseline');

const env = {
  ...process.env,
  SWEET_SEARCH_DISABLE_MEM_GUARD: '1', // 128GB machine
};

if (withPool) {
  env.SWEET_SEARCH_EMBEDDING_WORKERS = '2';
}

console.log(`\n=== Full Index Benchmark: ${label} ===`);
console.log(`  Pool: ${withPool ? 'ENABLED (2 workers)' : 'disabled'}`);
console.log(`  Hardware: ${os.cpus()[0].model} (${os.cpus().length} cores, ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB RAM)`);
console.log(`  Time: ${new Date().toISOString()}\n`);

const t0 = performance.now();
try {
  const output = execSync(
    'node core/indexing/index-codebase-v21.js --full --sqlite-fast 2>&1',
    { env, encoding: 'utf8', timeout: 3600_000, maxBuffer: 50 * 1024 * 1024 }
  );
  const elapsed = performance.now() - t0;

  // Extract key metrics from output
  const embeddingMatch = output.match(/Generated (\d+) embeddings/);
  const vectorDbMatch = output.match(/Saved codebase\.db \(([\d.]+) MB/);
  const hnswMatch = output.match(/HNSW.*?(\d+) vectors/);
  const liMatch = output.match(/LI.*?(\d+) doc/i);
  const durationMatch = output.match(/Duration:\s*([\d.]+)s/);

  console.log(`\n--- Results: ${label} ---`);
  console.log(`  Wall-clock: ${(elapsed / 1000).toFixed(1)}s`);
  if (durationMatch) console.log(`  Reported duration: ${durationMatch[1]}s`);
  if (embeddingMatch) console.log(`  Embeddings: ${embeddingMatch[1]}`);
  if (vectorDbMatch) console.log(`  Vector DB: ${vectorDbMatch[1]} MB`);
  if (hnswMatch) console.log(`  HNSW: ${hnswMatch[1]} vectors`);

  // Save last 30 lines of output for review
  const lines = output.split('\n');
  console.log('\n  Output (last 20 lines):');
  lines.slice(-20).forEach(l => console.log(`    ${l}`));

} catch (err) {
  const elapsed = performance.now() - t0;
  console.error(`Benchmark failed after ${(elapsed / 1000).toFixed(1)}s: ${err.message}`);
  if (err.stdout) {
    const lines = err.stdout.split('\n');
    console.log('\nLast 10 lines:');
    lines.slice(-10).forEach(l => console.log(`  ${l}`));
  }
  process.exit(1);
}
