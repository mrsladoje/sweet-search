#!/usr/bin/env node
/**
 * Isolate what made Variant A (ORT CPU embed) slow at index time.
 *
 * Hypothesis: callLocalModelBucketed sorts by estimated token count and builds
 * batches subject to BOTH a token budget and an attention budget. Short-seq
 * batches pack many chunks (fast per-chunk). Long-seq batches shrink toward
 * 1 chunk per batch (slow per-chunk due to ORT per-call overhead and wasted
 * padding). The 16k-chunk sweet-search workload has a heavy tail of ≥1500-char
 * chunks that tokenize to seq_len≈512, so the tail dominates wall time.
 *
 * Test design: take real sweet-search chunk texts, encode them all in one
 * callLocalModelBucketed pass while logging per-batch latency + effective
 * seq_len + chunk count. Then compute per-chunk throughput across the length
 * distribution.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;
process.env.SWEET_SEARCH_NATIVE_INFERENCE = '0'; // force ORT CPU path

async function main() {
  // Sample real chunks from the indexer's chunkFiles pipeline
  const { chunkFiles } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-build.js'));
  const { discoverFiles } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-utils.js'));
  const { callLocalModelCpu, getLocalPipeline } = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));

  console.log('Warming up ORT pipeline...');
  await getLocalPipeline();

  console.log('Chunking the project...');
  const files = await discoverFiles({ projectRoot: PROJECT_ROOT, includeHidden: false });
  const { texts } = await chunkFiles(files.slice(0, 1054));
  console.log(`Got ${texts.length} chunks`);

  // Tokenize all texts to get real seq_lens
  const tokPath = path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json');
  const tokenizer = await createTokenizer(tokPath);

  // Classify chunks by seq_len bucket to understand the distribution
  const bucketSizes = { '0-64': 0, '65-128': 0, '129-256': 0, '257-384': 0, '385-512': 0 };
  const lengths = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const tok = tokenizer(batch, { padding: false, truncation: true, max_length: 512 });
    for (let j = 0; j < batch.length; j++) {
      const tokens = tok.input_ids[j] ? tok.input_ids[j].length : (tok.input_ids.dims ? tok.input_ids.dims[1] : 512);
      lengths.push(tokens);
      if (tokens <= 64) bucketSizes['0-64']++;
      else if (tokens <= 128) bucketSizes['65-128']++;
      else if (tokens <= 256) bucketSizes['129-256']++;
      else if (tokens <= 384) bucketSizes['257-384']++;
      else bucketSizes['385-512']++;
    }
  }
  console.log('\n=== Length distribution ===');
  for (const [bucket, n] of Object.entries(bucketSizes)) {
    const pct = (n / texts.length * 100).toFixed(1);
    console.log(`  ${bucket.padStart(8)} tokens: ${n.toString().padStart(5)} chunks (${pct}%)`);
  }
  const sortedLens = [...lengths].sort((a, b) => a - b);
  console.log(`  p50=${sortedLens[Math.floor(sortedLens.length*0.5)]}  p90=${sortedLens[Math.floor(sortedLens.length*0.9)]}  p99=${sortedLens[Math.floor(sortedLens.length*0.99)]}  max=${sortedLens[sortedLens.length-1]}`);

  // Now time ORT CPU encoding of a fixed-size batch at each bucket
  // Each test: 64 chunks at a target seq_len, measure total time
  console.log('\n=== Per-seq-len throughput (ORT INT8 CPU, 64-chunk batches) ===');
  const sampleChunks = { '0-64': [], '65-128': [], '129-256': [], '257-384': [], '385-512': [] };
  for (let i = 0; i < texts.length; i++) {
    const len = lengths[i];
    let bucket;
    if (len <= 64) bucket = '0-64';
    else if (len <= 128) bucket = '65-128';
    else if (len <= 256) bucket = '129-256';
    else if (len <= 384) bucket = '257-384';
    else bucket = '385-512';
    if (sampleChunks[bucket].length < 64) sampleChunks[bucket].push(texts[i]);
  }

  for (const [bucket, chunks] of Object.entries(sampleChunks)) {
    if (chunks.length < 64) { console.log(`  ${bucket}: only ${chunks.length} samples, skipping`); continue; }
    // Warmup
    await callLocalModelCpu(chunks.slice(0, 8), { maxLength: 512 });
    // Measure
    const t0 = Date.now();
    const iters = 3;
    for (let k = 0; k < iters; k++) {
      await callLocalModelCpu(chunks, { maxLength: 512 });
    }
    const ms = (Date.now() - t0) / iters;
    const chunksPerSec = (64 * 1000 / ms).toFixed(1);
    const msPerChunk = (ms / 64).toFixed(1);
    console.log(`  ${bucket.padStart(8)} tokens: ${ms.toFixed(0).padStart(5)}ms/batch, ${msPerChunk.padStart(5)}ms/chunk, ${chunksPerSec.padStart(6)} chunks/s`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
