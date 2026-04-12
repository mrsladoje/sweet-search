#!/usr/bin/env node
/**
 * Small LI batch-size microbench.
 *
 * Samples the longest chunks from the project, encodes them on the native
 * Metal GPU path at varying batch sizes, reports per-chunk wall time.
 * Isolates the impact of batch size at max sequence length (N≈2048) — the
 * regime where attention is O(seq²) and activation working set can overflow
 * last-level cache.
 *
 * Usage:
 *   node eval/li-batch-microbench.js [numChunks]    # default 80
 *
 * Reads no env vars for batching — it slices directly, bypassing
 * buildLateInteractionBatches entirely. The point is to measure the
 * encoder at each batch size, not to test the planner.
 */

import { fileURLToPath } from 'url';
import path from 'path';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(PROJECT_ROOT);

const NUM_CHUNKS = parseInt(process.argv[2], 10) || 80;
const BATCH_SIZES = [1, 2, 4, 5, 8, 12, 16];

async function main() {
  const { discoverFiles } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-utils.js'));
  const { chunkFiles } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-build.js'));
  const liMod = await import(path.join(PROJECT_ROOT, 'core/ranking/late-interaction-model.js'));
  const encodeGpu = liMod.encodeDocumentsGpu || liMod.encodeDocuments;
  if (!encodeGpu) throw new Error('No GPU encode fn exported from late-interaction-model.js');

  console.log('LI batch-size microbench');
  console.log('─'.repeat(60));

  // Discover + chunk the project
  const t0 = Date.now();
  const discovered = await discoverFiles();
  const files = Array.isArray(discovered) ? discovered : (discovered?.files || []);
  const preChunked = await chunkFiles(files);
  const allChunks = Array.isArray(preChunked) ? preChunked : (preChunked.allChunks || preChunked);
  console.log(`Discovered ${files.length} files → ${allChunks.length} chunks in ${Date.now() - t0}ms`);

  // Top-N longest chunks (the tail of the distribution)
  const long = [...allChunks]
    .map((c) => c.text || c.content || '')
    .filter((t) => t.length > 4000) // roughly > 1000 tokens
    .sort((a, b) => b.length - a.length)
    .slice(0, NUM_CHUNKS);

  if (long.length === 0) {
    console.error('No long chunks found (>4000 chars). Aborting.');
    process.exit(1);
  }

  const avgLen = Math.round(long.reduce((s, t) => s + t.length, 0) / long.length);
  console.log(`Corpus: ${long.length} chunks, avg ${avgLen} chars (~${Math.round(avgLen / 4)} tokens)`);

  // Warmup — loads model, compiles Metal kernels, populates caches.
  // Two passes to get past first-call effects.
  console.log('\nWarmup (2 passes)...');
  await encodeGpu(long.slice(0, 4), { poolFactor: 1 });
  await encodeGpu(long.slice(0, 4), { poolFactor: 1 });

  // Per batch-size timing
  console.log('\nResults (lower ms/chunk is better):');
  console.log('  batch |  total ms | ms/chunk');
  console.log('  ------|-----------|---------');
  const results = [];
  for (const B of BATCH_SIZES) {
    // Drop any leftover work from prior iteration
    await new Promise((r) => setTimeout(r, 50));
    const tStart = Date.now();
    for (let i = 0; i < long.length; i += B) {
      const batch = long.slice(i, Math.min(i + B, long.length));
      // eslint-disable-next-line no-await-in-loop
      await encodeGpu(batch, { poolFactor: 1 });
    }
    const dt = Date.now() - tStart;
    const perChunk = dt / long.length;
    results.push({ B, dt, perChunk });
    console.log(`  ${String(B).padStart(5)} | ${String(dt).padStart(9)} | ${perChunk.toFixed(1)}`);
  }

  const best = results.reduce((b, r) => (r.dt < b.dt ? r : b));
  const worst = results.reduce((w, r) => (r.dt > w.dt ? r : w));
  console.log('\n' + '─'.repeat(60));
  console.log(`Best:  B=${best.B}  ${best.perChunk.toFixed(1)} ms/chunk`);
  console.log(`Worst: B=${worst.B} ${worst.perChunk.toFixed(1)} ms/chunk (${(worst.dt / best.dt).toFixed(2)}× slower than best)`);
  console.log('─'.repeat(60));
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
