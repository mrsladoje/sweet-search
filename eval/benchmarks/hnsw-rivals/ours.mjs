// Our arm (v4): the production semanticSearch3Stage per query, on the SAME query vectors as the rivals.
// Each query's exported 768-d vector (<set>/q768.bin, written on the Mac by export2.mjs) is placed in the
// embedding LRU before the query runs, so no encoder is loaded and every machine and every system sees
// identical inputs. Latency = median of 3 runs per query, query embedding excluded (it is a cache hit).
//
// usage: node ours.mjs <setDir>
// env: R (repo root), OUT (file in <setDir>, default ours.json), NQ (limit queries), K (results per query, default 10)
//   sweep knobs (unset = production values):
//   S1    stage-1 candidates (production 1000; exact scan <=150k vectors, binary HNSW walk above)
//   EF    walk efSearch floor (production 400; the walk uses max(EF, S1-derived target))
//   POOL  scale factor for the adaptive int8 / full-vector pool bounds (production 1)
//   SWEET_SEARCH_FULL_VECTOR_STAGE_WEIGHT  full-vector blend weight (production 0.8; 1 = pure exact rescore)
//   SS_FIX_HNSW_SCAN=0  force the walk at every size
import fs from 'node:fs';
import os from 'node:os';
const R = process.env.R || '/Users/admin/Projects/sweet-search-private';
const set = process.argv[2]; const NQ = Number(process.env.NQ || 1e9); const K = Number(process.env.K || 10);
const meta = JSON.parse(fs.readFileSync(`${set}/meta.json`));
const ss = `${meta.root}/.sweet-search`;
const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/index.js`);
const { CodebaseRepository } = await import(`${R}/core/infrastructure/codebase-repository.js`);
const { semanticSearch3Stage } = await import(`${R}/core/search/search-semantic.js`);
const { queryCache } = await import(`${R}/core/embedding/embedding-cache.js`);
const { truncateForHNSW, floatToBinary } = await import(`${R}/core/embedding/embedding-service.js`);
const { BINARY_HNSW_CONFIG } = await import(`${R}/core/config.js`);

const knobs = { S1: Number(process.env.S1 || BINARY_HNSW_CONFIG.retrieval.stage1Candidates), EF: Number(process.env.EF || BINARY_HNSW_CONFIG.efSearch), POOL: Number(process.env.POOL || 1), WEIGHT: process.env.SWEET_SEARCH_FULL_VECTOR_STAGE_WEIGHT || '0.8', SCAN: process.env.SS_FIX_HNSW_SCAN !== '0' };
if (knobs.POOL !== 1) {
  const a = BINARY_HNSW_CONFIG.retrieval.adaptive;
  for (const k of ['minStage2', 'maxStage2', 'minStage2_5', 'maxStage2_5']) a[k] = Math.max(1, Math.round(a[k] * knobs.POOL));
  for (const k of ['oversample1', 'oversample2']) a[k] = a[k] * knobs.POOL;
}
const tLoad = performance.now();
const idx = new BinaryHNSWIndex({ indexPath: `${ss}/codebase-binary-hnsw.idx` }); await idx.load();
idx.efSearch = knobs.EF;
const loadS = (performance.now() - tLoad) / 1000;
const self = {
  binaryHnswIndex: idx, floatVectorStore: null, codebaseRepo: new CodebaseRepository(`${ss}/codebase.db`),
  stage1Candidates: knobs.S1, cascadeEnabled: false, useLateInteraction: false,
  log() {}, shouldSkipRerank: () => ({ skip: false }), reranker: { isAnyAvailable: () => false },
};
const pos = new Map(meta.ids.map((id, i) => [id, i]));
const qs = meta.queries.slice(0, NQ);
const Q = new Float32Array(fs.readFileSync(`${set}/q768.bin`).buffer.slice(0));
const D = meta.dim || 768;
if (Q.length !== meta.queries.length * D) throw new Error(`q768.bin has ${Q.length / D} rows, meta has ${meta.queries.length} queries`);
// Same derivation as getBinaryEmbedding on a fresh vector: float = the 768-d vector, binary = sign codes
// of its 512-d prefix. Stored under getBinaryEmbedding's own cache key, so the query path is unchanged.
const inject = i => {
  const float = Q.slice(i * D, (i + 1) * D);
  queryCache.set(`binary:${qs[i].text}`, { binary: floatToBinary(truncateForHNSW(float)), float });
};
const run = i => { inject(i); return semanticSearch3Stage.call(self, qs[i].text, { k: K, rerank: false }); };
for (let i = 0; i < Math.min(200, qs.length); i++) await run(i);
const out = { system: 'sweet', knobs: { ...knobs, K, HNSW_ENV: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('SS_HNSW_'))) }, n: idx.vectors.length, load_s: loadS, host: os.hostname(), cpu: os.cpus()[0].model, node: process.version, total_us: [], stage1_us: [], res: [] };
for (let i = 0; i < qs.length; i++) {
  const t = [], s1 = []; let r;
  for (let rep = 0; rep < 3; rep++) {
    inject(i);
    const s = process.hrtime.bigint(); r = await semanticSearch3Stage.call(self, qs[i].text, { k: K, rerank: false }); const tot = Number(process.hrtime.bigint() - s) / 1e3;
    if (r.stats.embedding?.source !== 'cache') throw new Error('query vector not injected: ' + r.stats.embedding.source);
    t.push(tot - (r.stats.embed_us || 0)); s1.push(r.stats.stages.binary.latency_us);
  }
  const med = a => a.sort((x, y) => x - y)[1];
  out.total_us.push(med(t)); out.stage1_us.push(med(s1));
  out.res.push(r.results.map(x => pos.get(x.id) ?? -1));
}
out.rss_mb = Math.round(process.memoryUsage().rss / 1048576);
const p = (a, f) => [...a].sort((x, y) => x - y)[Math.floor(a.length * f)];
console.log(`${set.split('/').pop()} n=${idx.vectors.length} knobs=${JSON.stringify(knobs)} p50 ${p(out.total_us, .5).toFixed(0)} p99 ${p(out.total_us, .99).toFixed(0)} us | stage1 p50 ${p(out.stage1_us, .5)} us | rss ${out.rss_mb} MB`);
fs.writeFileSync(`${set}/${process.env.OUT || 'ours.json'}`, JSON.stringify(out)); process.exit(0);
