// Throughput: W worker threads, each with its own loaded index, splitting the queries.
// usage: node tput-ours.mjs <name> <workers>
import fs from 'node:fs'; import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
const R = '/Users/admin/Projects/sweet-search-private';
if (isMainThread) {
  const [name, W] = [process.argv[2], +process.argv[3]];
  const meta = JSON.parse(fs.readFileSync(`${name}/meta.json`)); const nq = meta.queries.length;
  const ws = Array.from({ length: W }, (_, w) => new Worker(new URL(import.meta.url), { workerData: { name, from: Math.floor(w * nq / W), to: Math.floor((w + 1) * nq / W) } }));
  let ready = 0, done = 0, t0 = 0;
  for (const w of ws) w.on('message', (m) => {
    if (m === 'ready' && ++ready === W) { t0 = performance.now(); for (const x of ws) x.postMessage('go'); }
    if (m === 'done' && ++done === W) { const s = (performance.now() - t0) / 1000; console.log(JSON.stringify({ name, workers: W, qps: Math.round(nq * 3 / s) })); process.exit(0); }
  });
} else {
  const { name, from, to } = workerData;
  const meta = JSON.parse(fs.readFileSync(`${name}/meta.json`)); const ss = `${meta.root}/.sweet-search`;
  const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/index.js`);
  const { FloatVectorStore } = await import(`${R}/core/vector-store/float-vector-store.js`);
  const { CodebaseRepository } = await import(`${R}/core/infrastructure/codebase-repository.js`);
  const { semanticSearch3Stage } = await import(`${R}/core/search/search-semantic.js`);
  const { getBinaryEmbedding } = await import(`${R}/core/embedding/index.js`);
  const idx = new BinaryHNSWIndex({ indexPath: `${ss}/codebase-binary-hnsw.idx` }); await idx.load();
  const fvs = new FloatVectorStore(); await fvs.load(`${ss}/codebase-float-vectors.bin`);
  const self = { binaryHnswIndex: idx, floatVectorStore: fvs, codebaseRepo: new CodebaseRepository(`${ss}/codebase.db`), stage1Candidates: 1000,
    cascadeEnabled: false, useLateInteraction: false, log() {}, shouldSkipRerank: () => ({ skip: false }), reranker: { isAnyAvailable: () => false } };
  // Query embeddings are cached up front (embedding is excluded, as in the latency runs).
  const qs = meta.queries.slice(from, to); for (const q of qs) await getBinaryEmbedding(q.text);
  for (const q of qs.slice(0, 50)) await semanticSearch3Stage.call(self, q.text, { k: 10, rerank: false });
  parentPort.postMessage('ready');
  parentPort.once('message', async () => {
    for (let rep = 0; rep < 3; rep++) for (const q of qs) await semanticSearch3Stage.call(self, q.text, { k: 10, rerank: false });
    parentPort.postMessage('done');
  });
}
