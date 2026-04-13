#!/usr/bin/env node
/**
 * Small embedding batch-size microbench.
 *
 * Mirrors eval/li-batch-microbench.js for the local embedding pipeline.
 * Samples the longest chunks from the project, encodes them on the active
 * embedding path (native Metal if available, else ORT) at varying batch
 * sizes, reports per-chunk wall time. Isolates the impact of batch size at
 * max sequence length (N=INDEXING_MAX_LENGTH, default 512).
 *
 * Usage:
 *   node eval/embed-batch-microbench.js [numChunks]    # default 80
 */

import { fileURLToPath } from 'url';
import path from 'path';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(PROJECT_ROOT);

const NUM_CHUNKS = parseInt(process.argv[2], 10) || 80;
const BATCH_SIZES = [1, 2, 4, 8, 16, 32, 64];

async function main() {
  const { discoverFiles } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-utils.js'));
  const { chunkFiles } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-build.js'));
  const embedMod = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));
  // Prefer the GPU-only path so we measure the active inference path
  // directly without any bucketing layer between us and the encoder.
  const encode = embedMod.callLocalModelGpu || embedMod.callLocalModel;
  if (!encode) throw new Error('No callLocalModelGpu / callLocalModel exported');

  console.log('Embedding batch-size microbench');
  console.log('─'.repeat(60));

  // Discover + chunk the project
  const t0 = Date.now();
  const discovered = await discoverFiles();
  const files = Array.isArray(discovered) ? discovered : (discovered?.files || []);
  const preChunked = await chunkFiles(files);
  const allChunks = Array.isArray(preChunked) ? preChunked : (preChunked.allChunks || preChunked);
  console.log(`Discovered ${files.length} files → ${allChunks.length} chunks in ${Date.now() - t0}ms`);

  // Top-N longest chunks. Embedding maxLength is 512 tokens (~2000 chars),
  // so anything > 2000 chars saturates the seq-len budget after tokenisation.
  const long = [...allChunks]
    .map((c) => c.text || c.content || '')
    .filter((t) => t.length > 2000)
    .sort((a, b) => b.length - a.length)
    .slice(0, NUM_CHUNKS);

  if (long.length === 0) {
    console.error('No long chunks found (>2000 chars). Aborting.');
    process.exit(1);
  }

  const avgLen = Math.round(long.reduce((s, t) => s + t.length, 0) / long.length);
  console.log(`Corpus: ${long.length} chunks, avg ${avgLen} chars (~${Math.round(avgLen / 4)} tokens, capped at 512)`);

  // Warmup — loads model, compiles Metal kernels, populates caches.
  console.log('\nWarmup (2 passes)...');
  await encode(long.slice(0, 4), {});
  await encode(long.slice(0, 4), {});

  // Per batch-size timing
  console.log('\nResults (lower ms/chunk is better):');
  console.log('  batch |  total ms | ms/chunk');
  console.log('  ------|-----------|---------');
  const results = [];
  for (const B of BATCH_SIZES) {
    await new Promise((r) => setTimeout(r, 50));
    const tStart = Date.now();
    for (let i = 0; i < long.length; i += B) {
      const batch = long.slice(i, Math.min(i + B, long.length));
      // eslint-disable-next-line no-await-in-loop
      await encode(batch, {});
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
