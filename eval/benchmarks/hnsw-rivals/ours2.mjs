// Our arm: the unchanged production semanticSearch3Stage (binary HNSW -> int8 -> float512 -> full-768 stage).
// usage: node ours2.mjs <name>
import fs from 'node:fs';
const R = process.env.SS_ROOT || '/Users/admin/Projects/sweet-search-private';
const name = process.argv[2];
const meta = JSON.parse(fs.readFileSync(`${name}/meta.json`));
const ss = `${meta.root}/.sweet-search`;
const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/index.js`);
const { FloatVectorStore } = await import(`${R}/core/vector-store/float-vector-store.js`);
const { CodebaseRepository } = await import(`${R}/core/infrastructure/codebase-repository.js`);
const { semanticSearch3Stage } = await import(`${R}/core/search/search-semantic.js`);
const { getBinaryEmbedding } = await import(`${R}/core/embedding/index.js`);
const { BINARY_HNSW_CONFIG } = await import(`${R}/core/config.js`);
const t0 = performance.now();
const idx = new BinaryHNSWIndex({ indexPath: `${ss}/codebase-binary-hnsw.idx` }); await idx.load();
const fvs = new FloatVectorStore(); await fvs.load(`${ss}/codebase-float-vectors.bin`);
const self = {
  binaryHnswIndex: idx, floatVectorStore: fvs, codebaseRepo: new CodebaseRepository(`${ss}/codebase.db`),
  stage1Candidates: BINARY_HNSW_CONFIG.retrieval.stage1Candidates, cascadeEnabled: false, useLateInteraction: false,
  log() {}, shouldSkipRerank: () => ({ skip: false }), reranker: { isAnyAvailable: () => false },
};
console.log('load s', ((performance.now() - t0) / 1000).toFixed(1), 'n', idx.vectors.length, 'stage1', self.stage1Candidates);
const pos = new Map(meta.ids.map((id, i) => [id, i]));
const qs = meta.queries;
const run = q => semanticSearch3Stage.call(self, q.text, { k: 10, rerank: false });
for (let i = 0; i < 100; i++) await run(qs[i]);
const out = { total_us: [], stage1_us: [], embed_us: [], res: [] };
for (let qi = 0; qi < qs.length; qi++) {
  const q = qs[qi];
  if (qi % 500 === 0) { for (const w of qs.slice(qi, qi + 500)) await getBinaryEmbedding(w.text); for (const w of qs.slice(qi, qi + 50)) await run(w); } // LRU holds 1000
  const t = [], s1 = []; let r;
  for (let rep = 0; rep < 3; rep++) {
    const s = process.hrtime.bigint(); r = await run(q); const tot = Number(process.hrtime.bigint() - s) / 1e3;
    t.push(tot - r.stats.embed_us); out.embed_us.push(r.stats.embed_us); s1.push(r.stats.stages.binary.latency_us);
  }
  out.total_us.push(t.sort((a, b) => a - b)[1]); out.stage1_us.push(s1.sort((a, b) => a - b)[1]);
  out.res.push(r.results.map(x => pos.get(x.id) ?? -1));
  (out.full ??= []).push(JSON.stringify(r.results.map(x => { const o = { ...x }; delete o.metadata; return o; })));
}
const p = (a, f) => [...a].sort((x, y) => x - y)[Math.floor(a.length * f)].toFixed(0);
console.log(`vector search (excl. embedding) p50 ${p(out.total_us, .5)}us p99 ${p(out.total_us, .99)}us | stage1 p50 ${p(out.stage1_us, .5)}us`);
fs.writeFileSync(`${name}/${process.env.OUT || 'ours.json'}`, JSON.stringify(out)); process.exit(0);
