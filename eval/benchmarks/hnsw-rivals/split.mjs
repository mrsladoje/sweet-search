// Phase A5 (HANDOFF-v5 §4): where a query's time goes, per stage, on the product's fused path.
// For each query (3 runs, median per column) it times:
//   total     semanticSearch3Stage as ours.mjs calls it (query vector injected into the LRU)
//   embed     getBinaryEmbedding (an LRU hit)
//   encode    truncateForHNSW + normalizedFloatToInt8 of the query
//   s1_js     searchCascade minus the native stage-1 call (stale-bitmap stat, setQuery, descent, ef)
//   s1_nat    native cascadeStage1 (scan or walk, stale filter, spread stats)
//   int8      int8Stage(all)  (native int8 dots + sort)
//   head      head size + materialize(head) + nodes(head)  (result objects; ~0 on the fused path)
//   full      fullDotScores of the head (mmap vector file, f64 kernel); on the fused path the native
//             full-vector order + result objects for the k returned
//   rest      total - the parts above (sort of the head, stats objects, promise hops, final slice)
// Steps run in the product order on the same inputs; the per-step copy is checked against the product results.
// usage: node split.mjs <setDir>      env: R (repo root), NQ, K, OUT (default split.json)
import fs from 'node:fs';
import os from 'node:os';
const R = process.env.R || '/Users/admin/Projects/sweet-search-private';
const set = process.argv[2]; const NQ = Number(process.env.NQ || 1e9); const K = Number(process.env.K || 10);
const meta = JSON.parse(fs.readFileSync(`${set}/meta.json`));
const ss = `${process.env.ROOT || meta.root}/.sweet-search`;  // ROOT: another copy of the index (A/B arms)
const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/index.js`);
const { CodebaseRepository } = await import(`${R}/core/infrastructure/codebase-repository.js`);
const { semanticSearch3Stage } = await import(`${R}/core/search/search-semantic.js`);
const { queryCache } = await import(`${R}/core/embedding/embedding-cache.js`);
const { truncateForHNSW, floatToBinary, normalizedFloatToInt8, getBinaryEmbedding } = await import(`${R}/core/embedding/embedding-service.js`);
const { BINARY_HNSW_CONFIG } = await import(`${R}/core/config.js`);

const idx = new BinaryHNSWIndex({ indexPath: `${ss}/codebase-binary-hnsw.idx` }); await idx.load();
const nat = idx._nativeSearcher();
const S1 = BINARY_HNSW_CONFIG.retrieval.stage1Candidates;
const ad = BINARY_HNSW_CONFIG.retrieval.adaptive;
const self = {
  binaryHnswIndex: idx, floatVectorStore: null, codebaseRepo: new CodebaseRepository(`${ss}/codebase.db`),
  stage1Candidates: S1, cascadeEnabled: false, useLateInteraction: false,
  log() {}, shouldSkipRerank: () => ({ skip: false }), reranker: { isAnyAvailable: () => false },
};
// Time the native stage-1 call inside searchCascade by wrapping it (same arguments, same result).
let natUs = 0;
const orig = nat.cascadeStage1.bind(nat);
nat.cascadeStage1 = (...a) => { const s = process.hrtime.bigint(); const r = orig(...a); natUs = Number(process.hrtime.bigint() - s) / 1e3; return r; };

const qs = meta.queries.slice(0, NQ);
const Q = new Float32Array(fs.readFileSync(`${set}/q768.bin`).buffer.slice(0));
const D = meta.dim || 768;
const inject = i => { const float = Q.slice(i * D, (i + 1) * D); queryCache.set(`binary:${qs[i].text}`, { binary: floatToBinary(truncateForHNSW(float)), float }); };
const stage1Count = (floor, k) => Math.max(floor, Math.min(ad.maxStage2, Math.floor(Math.max(ad.minStage2, k * ad.oversample1) * 1.5)));
const hr = () => process.hrtime.bigint();
const us = (a, b) => Number(b - a) / 1e3;

async function steps(i) {
  inject(i);
  const t0 = hr();
  const e = await getBinaryEmbedding(qs[i].text);
  const t1 = hr();
  const tf = truncateForHNSW(e.float); const qi8 = normalizedFloatToInt8(tf);
  const t2 = hr();
  const fused = idx.searchCascade(e.binary, stage1Count(S1, K), { floatQuery: tf, queryInt8: qi8 });
  const t3 = hr(); const nUs = natUs;
  const int8 = fused.int8Stage(fused.count);
  const t4 = hr();
  const top1 = int8.stats[1], top2 = int8.stats[2];
  let h = Math.max(ad.minStage2_5, K * ad.oversample2);
  if (int8.stats[0] >= 2 && top1 - top2 > 0.10) h = Math.max(ad.minStage2_5, Math.floor(h * 0.6));
  h = Math.min(h, ad.maxStage2_5, int8.count);
  let t5, t6;
  if (typeof int8.fullOrder === 'function') {
    // Fused path: native full-vector order of the head, objects for the k returned.
    t5 = hr();
    const fr = int8.fullOrder(e.float, h);
    if (fr && fr.found >= 2) int8.materializeFull(Math.min(h, Math.max(K, 10)), fr);
    t6 = hr();
  } else {
    const cands = int8.materialize(h); const nodes = int8.nodes(h);
    t5 = hr();
    idx.fullDotScores(e.float, cands.map(c => c.id || null), nodes);
    t6 = hr();
  }
  return { embed: us(t0, t1), encode: us(t1, t2), s1_js: us(t2, t3) - nUs, s1_nat: nUs, int8: us(t3, t4), head: us(t4, t5), full: us(t5, t6) };
}
async function total(i) {
  inject(i);
  const s = hr(); const r = await semanticSearch3Stage.call(self, qs[i].text, { k: K, rerank: false }); const t = us(s, hr());
  return { t, r };
}
for (let i = 0; i < Math.min(200, qs.length); i++) { await steps(i); await total(i); }
const cols = ['total', 'embed', 'encode', 's1_js', 's1_nat', 'int8', 'head', 'full', 'rest'];
const acc = Object.fromEntries(cols.map(c => [c, []]));
for (let i = 0; i < qs.length; i++) {
  const runs = [];
  for (let rep = 0; rep < 3; rep++) { const s = await steps(i); const { t } = await total(i); runs.push({ ...s, total: t }); }
  const med = c => runs.map(x => x[c]).sort((a, b) => a - b)[1];
  const row = Object.fromEntries(cols.filter(c => c !== 'rest').map(c => [c, med(c)]));
  row.rest = row.total - cols.filter(c => c !== 'total' && c !== 'rest').reduce((a, c) => a + row[c], 0);
  for (const c of cols) acc[c].push(row[c]);
}
const p = (a, f) => [...a].sort((x, y) => x - y)[Math.floor(a.length * f)];
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const out = { set: set.split('/').pop(), n: (idx.size ?? idx.vectors.length), nq: qs.length, host: os.hostname(), cpu: os.cpus()[0].model,
  p50: Object.fromEntries(cols.map(c => [c, +p(acc[c], 0.5).toFixed(1)])), mean: Object.fromEntries(cols.map(c => [c, +mean(acc[c]).toFixed(1)])) };
console.log(`${out.set} n=${out.n} ` + cols.map(c => `${c} ${out.p50[c]}/${out.mean[c]}`).join(' | ') + '  (p50/mean us)');
fs.writeFileSync(`${set}/${process.env.OUT || 'split.json'}`, JSON.stringify(out));
process.exit(0);
