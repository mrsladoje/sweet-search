#!/usr/bin/env node
/**
 * Quick test: do worker_threads give true ORT parallelism?
 */
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

const WORKER_FILE = fileURLToPath(import.meta.url);

if (!isMainThread) {
  const { initOrt, buildFeed } = await import('../core/infrastructure/ort-pipeline.js');
  const { createTokenizer } = await import('../core/infrastructure/native-tokenizer.js');
  const { fetchModel, getModelCacheDir } = await import('../core/infrastructure/model-fetcher.js');
  const { getModelEntry } = await import('../core/infrastructure/model-registry.js');
  const { join } = await import('path');

  await fetchModel('coderankembed-int8');
  const ort = await initOrt();
  const entry = getModelEntry('coderankembed-int8');
  const onnxPath = join(getModelCacheDir(entry.hfId), entry.files.find(f => f.path.endsWith('.onnx')).path);
  const tokenizerPath = join(getModelCacheDir(entry.hfId), 'tokenizer.json');
  const tokenizer = await createTokenizer(tokenizerPath);

  const session = await ort.InferenceSession.create(onnxPath, {
    intraOpNumThreads: workerData.threads,
    executionMode: 'parallel',
    enableCpuMemArena: true,
    enableMemPattern: true,
  });

  // Warmup
  const wTk = tokenizer(['warmup text for kernel init'], { padding: true, truncation: true, max_length: 512 });
  await session.run(buildFeed(wTk, session.inputNames));
  await session.run(buildFeed(wTk, session.inputNames));

  parentPort.postMessage({ type: 'ready' });

  parentPort.on('message', async (msg) => {
    if (msg.type === 'infer') {
      const tk = tokenizer(msg.texts, { padding: true, truncation: true, max_length: 512 });
      await session.run(buildFeed(tk, session.inputNames));
      parentPort.postMessage({ type: 'done', batchId: msg.batchId });
    }
  });
} else {
  const texts = [
    'export class AuthService { constructor(private jwtProvider) {} async login(credentials) { const user = await this.userRepo.findByEmail(credentials.email); if (!user) throw new UnauthorizedException(); return { token: this.jwtProvider.sign({ sub: user.id }) }; } }',
    'function buildHNSWIndex(vectors, config) { const index = new HNSWIndex({ dimension: config.dim, M: 16, efConstruction: 200 }); for (const vec of vectors) { index.add(vec.id, vec.embedding, vec.metadata); } return index; }',
    'import { Pool } from "undici"; const pool = new Pool("http://localhost", { connections: 4 }); async function search(query) { return JSON.parse(await (await pool.request({ method: "GET", path: "/search?q=" + query })).body.text()); }',
    'async function encodeDocuments(texts) { const pipeline = await getPipeline(); const results = []; for (const text of texts) { const tokenized = tokenizer("[D] " + text); const hidden = await session.run(buildFeed(tokenized)); results.push(hidden); } return results; }',
  ];

  function spawnWorker(threads) {
    return new Promise((resolve, reject) => {
      const w = new Worker(WORKER_FILE, { workerData: { threads } });
      w.on('message', (msg) => { if (msg.type === 'ready') resolve(w); });
      w.on('error', reject);
    });
  }

  function runBatch(worker, texts, batchId) {
    return new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.type === 'done' && msg.batchId === batchId) {
          worker.removeListener('message', handler);
          resolve();
        }
      };
      worker.on('message', handler);
      worker.postMessage({ type: 'infer', texts, batchId });
    });
  }

  const N = 20;

  // Test 1: 1 worker, 7 threads (baseline = current behavior)
  console.log('Spawning 1 worker (7 threads)...');
  const w1 = await spawnWorker(7);
  const t0 = performance.now();
  for (let i = 0; i < N; i++) await runBatch(w1, texts, i);
  const baseline = performance.now() - t0;
  console.log(`  1 worker × 7 threads: ${baseline.toFixed(0)}ms for ${N} batches (${(baseline / N).toFixed(1)}ms/batch)`);
  w1.terminate();

  // Test 2: 2 workers, 4 threads each
  console.log('Spawning 2 workers (4 threads each)...');
  const [w2a, w2b] = await Promise.all([spawnWorker(4), spawnWorker(4)]);
  const t1 = performance.now();
  for (let i = 0; i < N / 2; i++) {
    await Promise.all([
      runBatch(w2a, texts, 200 + i * 2),
      runBatch(w2b, texts, 200 + i * 2 + 1),
    ]);
  }
  const twoWorkers = performance.now() - t1;
  console.log(`  2 workers × 4 threads: ${twoWorkers.toFixed(0)}ms for ${N} batches (${(twoWorkers / N).toFixed(1)}ms/batch)`);
  console.log(`  Speedup: ${(baseline / twoWorkers).toFixed(2)}x`);
  w2a.terminate(); w2b.terminate();

  // Test 3: 3 workers, 3 threads each
  console.log('Spawning 3 workers (3 threads each)...');
  const [w3a, w3b, w3c] = await Promise.all([spawnWorker(3), spawnWorker(3), spawnWorker(3)]);
  const workers3 = [w3a, w3b, w3c];
  const t2 = performance.now();
  const promises = [];
  for (let i = 0; i < N; i++) {
    promises.push(runBatch(workers3[i % 3], texts, 300 + i));
  }
  // Process 3 at a time
  for (let i = 0; i < N; i += 3) {
    const batch = [];
    for (let j = i; j < Math.min(i + 3, N); j++) {
      batch.push(runBatch(workers3[j % 3], texts, 400 + j));
    }
    await Promise.all(batch);
  }
  const threeWorkers = performance.now() - t2;
  console.log(`  3 workers × 3 threads: ${threeWorkers.toFixed(0)}ms for ${N} batches (${(threeWorkers / N).toFixed(1)}ms/batch)`);
  console.log(`  Speedup: ${(baseline / threeWorkers).toFixed(2)}x`);
  w3a.terminate(); w3b.terminate(); w3c.terminate();

  console.log('\nSummary:');
  console.log(`  Baseline (1×7): ${(baseline / N).toFixed(1)}ms/batch`);
  console.log(`  2 workers (2×4): ${(twoWorkers / N).toFixed(1)}ms/batch → ${(baseline / twoWorkers).toFixed(2)}x`);
  console.log(`  3 workers (3×3): ${(threeWorkers / N).toFixed(1)}ms/batch → ${(baseline / threeWorkers).toFixed(2)}x`);
}
