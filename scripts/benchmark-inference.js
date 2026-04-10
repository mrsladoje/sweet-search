#!/usr/bin/env node
/**
 * Inference A/B Benchmark — measures embedding + LI session performance
 * under different ORT session configurations.
 *
 * Usage:
 *   node scripts/benchmark-inference.js                  # Run default A/B
 *   node scripts/benchmark-inference.js --baseline       # Save baseline
 *   node scripts/benchmark-inference.js --embedding-only # Embedding only
 *   node scripts/benchmark-inference.js --li-only        # LI only
 *   node scripts/benchmark-inference.js --runs 5         # Custom run count
 */

import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(PROJECT_ROOT, '.claude', 'benchmarks', 'results');

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const RUNS = parseInt(args.find((_, i, a) => a[i - 1] === '--runs') || '5', 10);
const SAVE_BASELINE = args.includes('--baseline');
const EMBEDDING_ONLY = args.includes('--embedding-only');
const LI_ONLY = args.includes('--li-only');

// ─── Corpus for realistic workload ──────────────────────────────────────────
const EMBEDDING_CORPUS = [
  'export class AuthService { constructor(private jwtProvider: JwtTokenProvider) {} async login(credentials: LoginDto): Promise<AuthResponse> { const user = await this.userRepo.findByEmail(credentials.email); if (!user || !await bcrypt.compare(credentials.password, user.passwordHash)) { throw new UnauthorizedException(); } return { token: this.jwtProvider.sign({ sub: user.id }) }; } }',
  'function buildHNSWIndex(vectors, config) { const index = new HNSWIndex({ dimension: config.dim, M: 16, efConstruction: 200 }); for (const vec of vectors) { index.add(vec.id, vec.embedding, vec.metadata); } return index; }',
  'import { Pool } from "undici"; const pool = new Pool("http://localhost:9876", { connections: 4 }); async function search(query) { const res = await pool.request({ method: "GET", path: `/search?q=${encodeURIComponent(query)}` }); return JSON.parse(await res.body.text()); }',
  'async function encodeDocuments(texts) { const pipeline = await getLateInteractionPipeline(); const results = []; for (const text of texts) { const tokenized = tokenizer("[D] " + text, { padding: true, truncation: true, max_length: 2048 }); const hidden = await session.run(buildFeed(tokenized)); results.push(projectAndNormalize(hidden)); } return results; }',
  'CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, chunk_index INTEGER, embedding BLOB NOT NULL, metadata JSON); CREATE INDEX idx_vectors_file ON vectors(file_path); CREATE VIRTUAL TABLE fts5_content USING fts5(content, file_path);',
  'const SKIPLIST_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?/~`"; function buildSkiplist(tokenizer) { const ids = new Set(); for (const ch of SKIPLIST_CHARS) { const enc = tokenizer(ch); if (enc.length === 1) ids.add(enc[0]); } return ids; }',
  'interface SearchResult { id: string; score: number; file: string; content: string; metadata: { line_start: number; line_end: number; chunk_type: string; symbol?: string; }; highlights: Array<{ start: number; end: number }>; }',
  'pub fn hamming_distance(a: &[u8], b: &[u8]) -> u32 { a.iter().zip(b.iter()).map(|(x, y)| (x ^ y).count_ones() as u32).sum() } pub fn binary_quantize(vector: &[f32]) -> Vec<u8> { vector.chunks(8).map(|chunk| chunk.iter().enumerate().fold(0u8, |acc, (i, &v)| if v > 0.0 { acc | (1 << i) } else { acc })).collect() }',
];

const LI_CORPUS = [
  'export class AuthService {\n  constructor(private jwtProvider) {}\n  async login(credentials) {\n    const user = await this.userRepo.findByEmail(credentials.email);\n    if (!user) throw new UnauthorizedException();\n    return { token: this.jwtProvider.sign({ sub: user.id }) };\n  }\n}',
  'async function buildHNSWIndex(dbPath) {\n  const db = new Database(dbPath, { readonly: true });\n  const totalVectors = db.prepare("SELECT COUNT(*) as c FROM vectors").get().c;\n  const index = new HNSWIndex({ dimension: 256, M: 16 });\n  await index.init();\n  for (const row of db.prepare("SELECT * FROM vectors").iterate()) {\n    await index.add(row.id, new Float32Array(row.embedding.buffer));\n  }\n  await index.save();\n}',
  'function meanPoolWithAttentionMask(tokenEmbeddings, attentionMask) {\n  const [batchSize, seqLength, hiddenSize] = tokenEmbeddings.dims;\n  const pooled = new Float32Array(batchSize * hiddenSize);\n  for (let b = 0; b < batchSize; b++) {\n    let validTokens = 0;\n    for (let t = 0; t < seqLength; t++) {\n      if (attentionMask.data[b * seqLength + t] !== 0n) {\n        validTokens++;\n        for (let h = 0; h < hiddenSize; h++) {\n          pooled[b * hiddenSize + h] += tokenEmbeddings.data[(b * seqLength + t) * hiddenSize + h];\n        }\n      }\n    }\n  }\n  return pooled;\n}',
  'import { spawn } from "child_process";\nfunction runCommand(cmd, args, opts = {}) {\n  return new Promise((resolve) => {\n    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });\n    let stdout = "";\n    child.stdout.on("data", (d) => stdout += d);\n    child.on("close", (code) => resolve({ success: code === 0, stdout }));\n  });\n}',
];

// ─── Stats helpers ──────────────────────────────────────────────────────────

function stats(values) {
  if (!values.length) return { mean: 0, p50: 0, p95: 0, stddev: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1 || 1);
  return {
    mean: Math.round(mean * 100) / 100,
    p50: sorted[Math.floor(n * 0.5)],
    p95: sorted[Math.floor(n * 0.95)] || sorted[n - 1],
    stddev: Math.round(Math.sqrt(variance) * 100) / 100,
    min: sorted[0],
    max: sorted[n - 1],
    n,
  };
}

function formatMs(ms) { return `${ms.toFixed(1)}ms`; }

// ─── Benchmark: Embedding ───────────────────────────────────────────────────

async function benchmarkEmbedding(runs) {
  console.log(`\n── Embedding Benchmark (${runs} runs, ${EMBEDDING_CORPUS.length} texts/batch) ──`);

  const { callLocalModel, getLocalPipeline, getEmbeddingTimings } = await import('../core/embedding/embedding-local-model.js');

  // Ensure model is loaded (cold start)
  const coldStart = performance.now();
  await getLocalPipeline();
  const loadTime = performance.now() - coldStart;
  console.log(`  Model load: ${formatMs(loadTime)}`);

  // Warmup (2 discarded runs)
  for (let i = 0; i < 2; i++) {
    await callLocalModel(EMBEDDING_CORPUS, { maxLength: 512 });
  }
  getEmbeddingTimings(); // drain warmup timings
  console.log('  Warmup complete (2 runs discarded)');

  // Measurement runs
  const wallTimes = [];
  const batchLatencies = [];
  let peakRSS = 0;

  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const embeddings = await callLocalModel(EMBEDDING_CORPUS, { maxLength: 512 });
    const elapsed = performance.now() - t0;

    wallTimes.push(elapsed);
    batchLatencies.push(elapsed);

    const rss = process.memoryUsage().rss;
    if (rss > peakRSS) peakRSS = rss;

    // Validate output
    if (embeddings.length !== EMBEDDING_CORPUS.length) {
      console.error(`  ERROR: Expected ${EMBEDDING_CORPUS.length} embeddings, got ${embeddings.length}`);
    }
  }

  const timings = getEmbeddingTimings();
  const wallStats = stats(wallTimes);

  console.log(`  Wall-clock: mean=${formatMs(wallStats.mean)} p50=${formatMs(wallStats.p50)} p95=${formatMs(wallStats.p95)} stddev=${formatMs(wallStats.stddev)}`);
  console.log(`  Tokenize: ${(timings.tokenize_us / 1000 / timings.calls).toFixed(1)}ms/batch`);
  console.log(`  Inference: ${(timings.inference_us / 1000 / timings.calls).toFixed(1)}ms/batch`);
  console.log(`  Pooling:   ${(timings.pool_us / 1000 / timings.calls).toFixed(1)}ms/batch`);
  console.log(`  Peak RSS:  ${(peakRSS / 1024 / 1024).toFixed(0)} MB`);
  console.log(`  Batches/sec: ${(1000 / wallStats.mean).toFixed(2)}`);
  console.log(`  Texts/sec:  ${(EMBEDDING_CORPUS.length * 1000 / wallStats.mean).toFixed(1)}`);

  return {
    loadTimeMs: Math.round(loadTime),
    wallClock: wallStats,
    timingBreakdown: {
      tokenize_ms_per_batch: Math.round(timings.tokenize_us / 1000 / timings.calls * 100) / 100,
      inference_ms_per_batch: Math.round(timings.inference_us / 1000 / timings.calls * 100) / 100,
      pool_ms_per_batch: Math.round(timings.pool_us / 1000 / timings.calls * 100) / 100,
    },
    peakRSS_MB: Math.round(peakRSS / 1024 / 1024),
    batchesPerSec: Math.round(1000 / wallStats.mean * 100) / 100,
    textsPerSec: Math.round(EMBEDDING_CORPUS.length * 1000 / wallStats.mean * 10) / 10,
    batchSize: EMBEDDING_CORPUS.length,
  };
}

// ─── Benchmark: Late Interaction ────────────────────────────────────────────

async function benchmarkLI(runs) {
  console.log(`\n── Late Interaction Benchmark (${runs} runs, ${LI_CORPUS.length} docs/batch) ──`);

  const { encodeDocuments, getLateInteractionPipeline, getLateInteractionTimings } = await import('../core/ranking/late-interaction-model.js');

  const coldStart = performance.now();
  const pipeline = await getLateInteractionPipeline();
  const loadTime = performance.now() - coldStart;

  if (!pipeline) {
    console.log('  LI model disabled, skipping');
    return null;
  }
  console.log(`  Model load: ${formatMs(loadTime)}`);

  // Warmup
  for (let i = 0; i < 2; i++) {
    await encodeDocuments(LI_CORPUS);
  }
  getLateInteractionTimings(); // drain warmup
  console.log('  Warmup complete (2 runs discarded)');

  const wallTimes = [];
  let peakRSS = 0;
  let totalTokens = 0;

  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const results = await encodeDocuments(LI_CORPUS);
    const elapsed = performance.now() - t0;

    wallTimes.push(elapsed);
    totalTokens += results.reduce((sum, docTokens) => sum + docTokens.length, 0);

    const rss = process.memoryUsage().rss;
    if (rss > peakRSS) peakRSS = rss;
  }

  const timings = getLateInteractionTimings();
  const wallStats = stats(wallTimes);

  console.log(`  Wall-clock: mean=${formatMs(wallStats.mean)} p50=${formatMs(wallStats.p50)} p95=${formatMs(wallStats.p95)} stddev=${formatMs(wallStats.stddev)}`);
  console.log(`  Tokenize: ${(timings.tokenize_us / 1000 / timings.calls).toFixed(1)}ms/doc`);
  console.log(`  Inference: ${(timings.inference_us / 1000 / timings.calls).toFixed(1)}ms/doc`);
  console.log(`  Peak RSS:  ${(peakRSS / 1024 / 1024).toFixed(0)} MB`);
  console.log(`  Docs/sec:  ${(LI_CORPUS.length * 1000 / wallStats.mean).toFixed(2)}`);
  console.log(`  Avg tokens/doc: ${Math.round(totalTokens / runs / LI_CORPUS.length)}`);

  return {
    loadTimeMs: Math.round(loadTime),
    wallClock: wallStats,
    timingBreakdown: {
      tokenize_ms_per_doc: Math.round(timings.tokenize_us / 1000 / timings.calls * 100) / 100,
      inference_ms_per_doc: Math.round(timings.inference_us / 1000 / timings.calls * 100) / 100,
    },
    peakRSS_MB: Math.round(peakRSS / 1024 / 1024),
    docsPerSec: Math.round(LI_CORPUS.length * 1000 / wallStats.mean * 100) / 100,
    avgTokensPerDoc: Math.round(totalTokens / runs / LI_CORPUS.length),
    docsPerBatch: LI_CORPUS.length,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Inference A/B Benchmark');
  console.log('═══════════════════════════════════════════════════');

  const hardware = {
    cpu: os.cpus()[0]?.model || 'unknown',
    cores: os.cpus().length,
    memory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}G`,
    platform: os.platform(),
    arch: os.arch(),
    node: process.version,
  };

  let ortVersion = 'unknown';
  try {
    const ort = await import('onnxruntime-node');
    // Try to get version from package.json
    const pkg = JSON.parse(await fs.readFile(path.resolve('node_modules/onnxruntime-node/package.json'), 'utf8'));
    ortVersion = pkg.version;
  } catch { /* ignore */ }

  console.log(`  Hardware: ${hardware.cpu}`);
  console.log(`  Cores: ${hardware.cores}, Memory: ${hardware.memory}`);
  console.log(`  ORT: ${ortVersion}, Node: ${hardware.node}`);
  console.log(`  Runs: ${RUNS}`);

  const results = {
    timestamp: new Date().toISOString(),
    hardware,
    ortVersion,
    runs: RUNS,
    embedding: null,
    lateInteraction: null,
  };

  if (!LI_ONLY) {
    results.embedding = await benchmarkEmbedding(RUNS);
  }

  if (!EMBEDDING_ONLY) {
    results.lateInteraction = await benchmarkLI(RUNS);
  }

  // Save results
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const label = SAVE_BASELINE ? 'baseline' : `run-${Date.now()}`;
  const outPath = path.join(RESULTS_DIR, `inference-${label}.json`);
  await fs.writeFile(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved: ${outPath}`);

  return results;
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
