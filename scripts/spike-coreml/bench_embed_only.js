/**
 * Embed-only microbench: calls nativeEmbed() repeatedly against real code
 * chunks from this repo, in production-like batch sizes, and measures total
 * embedding time + per-batch p50.
 *
 * The point: isolate the cost of the embedding model from all the other
 * indexer phases (file discovery, summarization, sqlite writes, HNSW build).
 * Whatever speedup we get here is the upper bound on what the full index
 * could possibly improve when we swap the embedding backend — diluted by all
 * the other phases that don't change.
 *
 * Backend selected via SWEET_SEARCH_INFERENCE_BACKEND=candle|coreml (default candle).
 */
import { nativeEmbed, getNativeEmbeddingModel, unloadNativeModels } from '../../core/infrastructure/native-inference.js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = '/Users/admin/Projects/sweet-search-private';
const EXTS = new Set(['.js', '.mjs', '.ts', '.tsx', '.rs', '.py', '.go', '.java', '.c', '.cpp', '.h', '.md', '.json', '.toml', '.yaml', '.yml']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', '.venv', 'dist', 'build', '.cache', 'cache', '.agentic-qe', 'eval', 'data', 'logs']);
const MAX_FILES = parseInt(process.env.BENCH_MAX_FILES ?? '200', 10);
const CHUNK_LINES = 40; // lines per chunk

function walk(dir, out = []) {
  if (out.length >= MAX_FILES) return out;
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return out;
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(e))) out.push(p);
  }
  return out;
}

function chunkFile(content, lines = CHUNK_LINES) {
  const allLines = content.split('\n');
  const chunks = [];
  for (let i = 0; i < allLines.length; i += lines) {
    chunks.push(allLines.slice(i, i + lines).join('\n'));
  }
  return chunks;
}

function makeChunks() {
  console.log(`[chunks] scanning ${ROOT} for source files (max ${MAX_FILES})…`);
  const files = walk(ROOT);
  const chunks = [];
  for (const f of files) {
    let content;
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    if (content.length === 0 || content.length > 200_000) continue;
    for (const c of chunkFile(content)) {
      if (c.trim().length === 0) continue;
      chunks.push(c);
    }
  }
  console.log(`[chunks] ${chunks.length} chunks from ${files.length} files`);
  return chunks;
}

// Production-like batching: ~16384-token batches based on per-chunk seqLen.
// Without re-tokenizing here, we approximate by estimating tokens = length/4
// and packing batches such that estimated tokens × batch ≈ 16384 with cap=128.
function makeBatches(chunks) {
  const batches = [];
  let cur = [];
  let curEstTok = 0;
  const tokenEst = (s) => Math.min(512, Math.ceil(s.length / 4));
  for (const c of chunks) {
    const t = tokenEst(c);
    if (cur.length >= 32 || curEstTok + t > 16384) {
      if (cur.length > 0) batches.push(cur);
      cur = [c];
      curEstTok = t;
    } else {
      cur.push(c);
      curEstTok += t;
    }
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

async function main() {
  const backend = process.env.SWEET_SEARCH_INFERENCE_BACKEND || 'candle';
  console.log(`\n=== embed-only microbench (backend=${backend}) ===`);

  const chunks = makeChunks();
  const batches = makeBatches(chunks);
  console.log(`[batches] ${batches.length} batches, total ${chunks.length} chunks`);

  // Warm up the model
  console.log(`[warmup] loading model …`);
  const t_load_start = performance.now();
  const model = await getNativeEmbeddingModel();
  const t_load = performance.now() - t_load_start;
  console.log(`[warmup] model loaded in ${t_load.toFixed(0)}ms (dim=${model?.dim})`);

  // Warmup embeddings
  for (let i = 0; i < 3; i++) {
    await nativeEmbed(chunks.slice(0, 8));
  }

  // Time the run
  console.log(`[run] embedding ${chunks.length} chunks in ${batches.length} batches…`);
  const perBatchTimes = [];
  const t_emb_start = performance.now();
  let total = 0;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const t = performance.now();
    await nativeEmbed(b);
    perBatchTimes.push(performance.now() - t);
    total += b.length;
    if ((i + 1) % 25 === 0) {
      const elapsed = performance.now() - t_emb_start;
      console.log(`  [${i + 1}/${batches.length}] ${total}/${chunks.length} chunks, ${elapsed.toFixed(0)}ms elapsed (${(total * 1000 / elapsed).toFixed(0)} chunks/s)`);
    }
  }
  const t_emb_total = performance.now() - t_emb_start;

  perBatchTimes.sort((a, b) => a - b);
  const p50 = perBatchTimes[Math.floor(perBatchTimes.length / 2)];
  const p90 = perBatchTimes[Math.floor(perBatchTimes.length * 0.9)];

  console.log(`\n=== Results: ${backend} ===`);
  console.log(`  model load        : ${t_load.toFixed(0)}ms`);
  console.log(`  embedding total   : ${t_emb_total.toFixed(0)}ms (${(t_emb_total / 1000).toFixed(1)}s)`);
  console.log(`  chunks            : ${total}`);
  console.log(`  batches           : ${batches.length}`);
  console.log(`  per-batch p50     : ${p50.toFixed(0)}ms`);
  console.log(`  per-batch p90     : ${p90.toFixed(0)}ms`);
  console.log(`  throughput        : ${(total * 1000 / t_emb_total).toFixed(0)} chunks/s`);
  console.log(`  total wall (incl load): ${((t_load + t_emb_total) / 1000).toFixed(1)}s`);

  unloadNativeModels();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
