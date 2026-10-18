// Our arm (DESIGN.md 5): one process = one (mode, params, round) job over one split.
//   mode A  common rescoring with our generators: stage 1 (scan or walk) returns C candidates, the int8
//           stage scores all C and keeps H, the full-vector stage orders the H (the addon kernels;
//           rivals5.cpp copies them bit for bit). Retained list = the H with their full-vector scores.
//   mode B  as shipped: semanticSearch3Stage with k = k_v. Retained list = its k_v results.
// Timing protocol (5.1): load, 500 dev warm-up queries (seeded order), then every query of the split
// once, in order perm(42 + round); one timing per query, all kept. Boundary: query float vector in
// memory -> retained list (query conversion included).
//
// usage: node ours5.mjs --data DATA --set S --model M --split dev|ho --mode A|B --round r --out <stem>
//          [--gen scan|walk] [--C n --H n --ef n]  (A)     [--kv n --S1 n --EF n]  (B)
//          [--key <key.json> --job-hash h] [--index <root>] [--dump file (A, checks only)] [--heldout] [--native-split] [--cold] [--limit n]
// Writes <stem>.lists.bin then <stem>.json (atomic rename; the JSON is the completion mark).
// env: R (repo root), SS_TEST_SLEEP_MS (test_harness.sh only: a pause after each timed query)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const t0 = performance.now();
const R = process.env.R || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const argv = process.argv.slice(2), o = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]; if (!a.startsWith('--')) throw new Error(`bad argument ${a}`);
  const k = a.slice(2); if (['heldout', 'native-split', 'cold', 'stages'].includes(k)) o[k] = true; else o[k] = argv[++i];
}
for (const k of ['data', 'set', 'model', 'split', 'mode', 'round', 'out']) if (o[k] === undefined) throw new Error(`--${k} missing`);
const round = Number(o.round), mode = o.mode;
if (!!o.heldout !== (o.split === 'ho')) throw new Error('--heldout must be given exactly for the held-out split');
if (o.heldout && o.limit) throw new Error('held-out runs execute the whole split (no --limit)');
if (mode === 'A' && o.gen === 'scan') process.env.SS_FIX_HNSW_SCAN = '1';
if (mode === 'A' && o.gen === 'walk') process.env.SS_FIX_HNSW_SCAN = '0';  // the walk at any size

const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/index.js`);
const { CodebaseRepository } = await import(`${R}/core/infrastructure/codebase-repository.js`);
const { semanticSearch3Stage } = await import(`${R}/core/search/search-semantic.js`);
const { queryCache } = await import(`${R}/core/embedding/embedding-cache.js`);
const { truncateForHNSW, floatToBinary, normalizedFloatToInt8 } = await import(`${R}/core/embedding/embedding-service.js`);
const { BINARY_HNSW_CONFIG } = await import(`${R}/core/config.js`);

// ---- set, split, queries
const setDir = `${o.data}/sets/${o.set}`, emb = `${o.data}/emb/${o.model}/${o.set}`;
const lines = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const vkeys = lines(`${setDir}/vectors.jsonl`).map(v => v.vid);
const queries = lines(`${setDir}/queries.jsonl`);
const D = 768;
const QF = new Float32Array(fs.readFileSync(`${emb}/queries.f32`).buffer.slice(0));
if (QF.length !== queries.length * D) throw new Error(`queries.f32 has ${QF.length / D} rows, queries.jsonl ${queries.length}`);
const rowsOf = s => queries.map((q, i) => (q.split === s ? i : -1)).filter(i => i >= 0);
let qrows = rowsOf(o.split); if (o.limit) qrows = qrows.slice(0, Number(o.limit));
const warm = rowsOf('dev');
const nq = qrows.length;

// Fisher-Yates over splitmix64 (DESIGN.md 5.1; rivals5.cpp and the Python adapters use the same).
function perm(n, seed) {
  let s = BigInt.asUintN(64, BigInt(seed)); const M = (1n << 64n) - 1n;
  const next = () => {
    s = (s + 0x9e3779b97f4a7c15n) & M; let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M; z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
    return z ^ (z >> 31n);
  };
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Number(next() % BigInt(i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p;
}

// ---- index
const root = o.index || `${emb}/index`, ss = `${root}/.sweet-search`;
const tLoad = performance.now();
const idx = new BinaryHNSWIndex({ indexPath: `${ss}/codebase-binary-hnsw.idx` }); await idx.load();
const loadS = (performance.now() - tLoad) / 1000;
if (idx.size !== vkeys.length) throw new Error(`index has ${idx.size} nodes, set has ${vkeys.length} vectors`);
const vidOf = new Int32Array(idx.size).fill(-1);
{ const pos = new Map(vkeys.map((k, i) => [k, i])); for (let n = 0; n < idx.size; n++) { const v = pos.get(idx.nodeId(n)); if (v === undefined) throw new Error(`node ${n} not in the set`); vidOf[n] = v; } }
const idOf = new Map(vkeys.map((k, i) => [k, i]));

// ---- the search of one query, per mode
const params = {};
let L, searchOne;
const dump = !!o.dump, dumpRows = [];
const stages = !!o.stages, lastStage = [0, 0, 0, 0];  // post-freeze: per-query stage times in comparison A
let timedPass = false, curRow = -1;
const inject = r => {
  const float = QF.slice(r * D, (r + 1) * D);
  return float;
};
if (mode === 'A') {
  const C = Number(o.C), H = Number(o.H); if (!(C >= H && H >= 10)) throw new Error('A needs C >= H >= 10');
  if (!['scan', 'walk'].includes(o.gen)) throw new Error('--gen scan|walk');
  idx.efSearch = Number(o.ef || C);  // walk ef floor; the product's adaptive ef rule applies on top
  const w8 = idx._int8NodeSlab().dim;
  Object.assign(params, { gen: o.gen, C, H, ef: idx.efSearch, code_width: idx.floatDimension, int8_width: w8 });
  L = H;
  searchOne = (float, ids, scores) => {
    // As the product calls it: the query code at the index's code width; the index encodes the int8 query (K4).
    // Stage clocks (post-freeze, --stages): query code | stage 1 (generator) | int8 screen | full rescoring
    const c0 = stages ? process.hrtime.bigint() : 0n;
    const qcode = floatToBinary(truncateForHNSW(float, idx.floatDimension));
    const c1 = stages ? process.hrtime.bigint() : 0n;
    const fused = idx.searchCascade(qcode, C, { queryFloat: float });
    if (!fused) throw new Error('native cascade unavailable');
    const c2 = stages ? process.hrtime.bigint() : 0n;
    const st = fused.int8Stage(fused.count);
    const c3 = stages ? process.hrtime.bigint() : 0n;
    const fr = st.fullOrder(float, H);
    const h = Math.min(H, st.count);
    if (!fr || (h >= 3 && fr.found < h)) throw new Error('full-vector stage unavailable');
    const nodes = st.nodes(h);
    for (let j = 0; j < h; j++) {
      const p = h >= 3 ? fr.order[j] : j;
      ids[j] = vidOf[nodes[p]]; scores[j] = h >= 3 ? fr.full[p] : NaN;
    }
    if (stages) { const c4 = process.hrtime.bigint(); lastStage[0] = Number(c1 - c0); lastStage[1] = Number(c2 - c1); lastStage[2] = Number(c3 - c2); lastStage[3] = Number(c4 - c3); }
    if (dump && timedPass) {  // --dump: all C candidates in int8 order with their int8 dots, then the H final vids and f64 scores
      const all = st.nodes(st.count), mat = st.materialize(st.count), rec = new Int32Array(2 * C).fill(-1), fin = new Float64Array(H).fill(NaN), fv = new Int32Array(H).fill(-1);
      for (let j = 0; j < st.count; j++) { rec[j] = vidOf[all[j]]; rec[C + j] = mat[j].missingInt8 ? 0 : Math.round(mat[j].int8Score * 127 * 127); }
      for (let j = 0; j < h; j++) { fv[j] = ids[j]; fin[j] = scores[j]; }
      dumpRows.push(Buffer.from(new Int32Array([curRow]).buffer), Buffer.from(rec.buffer), Buffer.from(fv.buffer), Buffer.from(fin.buffer));
    }
    return h;
  };
} else if (mode === 'B') {
  const kv = Number(o.kv); if (!(kv >= 10)) throw new Error('B needs --kv >= 10');
  const S1 = Number(o.S1 || BINARY_HNSW_CONFIG.retrieval.stage1Candidates), EF = Number(o.EF || BINARY_HNSW_CONFIG.efSearch);
  const ad = BINARY_HNSW_CONFIG.retrieval.adaptive;
  // K5 (bench only): a stage-1 size below the product's floor (1.5 x max(minStage2, k x oversample1)).
  if (S1 < Math.floor(Math.max(ad.minStage2 ?? 40, kv * (ad.oversample1 ?? 10)) * 1.5)) { ad.minStage2 = 1; ad.oversample1 = 0; }
  idx.efSearch = EF;
  Object.assign(params, { kv, S1, EF });
  L = kv;
  const self = {
    binaryHnswIndex: idx, floatVectorStore: null, codebaseRepo: new CodebaseRepository(`${ss}/codebase.db`),
    stage1Candidates: S1, cascadeEnabled: false, useLateInteraction: false,
    log() {}, shouldSkipRerank: () => ({ skip: false }), reranker: { isAnyAvailable: () => false },
  };
  searchOne = async (float, ids, scores, text) => {
    queryCache.set(`binary:${text}`, { binary: floatToBinary(truncateForHNSW(float)), float });
    const r = await semanticSearch3Stage.call(self, text, { k: kv, rerank: false });
    if (r.stats.embedding?.source !== 'cache') throw new Error('query vector not injected');
    const n = Math.min(kv, r.results.length);
    for (let j = 0; j < n; j++) {
      const x = r.results[j]; ids[j] = idOf.get(x.id) ?? -1;
      scores[j] = x.fullVectorScore ?? x.score;
    }
    return n;
  };
} else throw new Error('--mode A|B');

// --native-split: also time the native calls alone (wrapped; a separate job, it adds wrapper cost)
let nativeNs = 0;
if (o['native-split']) {
  const nat = idx._nativeSearcher();
  for (const m of ['cascadeStage1', 'cascadeInt8', 'cascadeFull', 'greedy']) {
    const f = nat[m].bind(nat);
    nat[m] = (...a) => { const s = process.hrtime.bigint(); const r = f(...a); nativeNs += Number(process.hrtime.bigint() - s); return r; };
  }
}

// ---- memory (DESIGN.md 5.4; PAPER_PLAN 5.7)
function memory() {
  const m = { rss_kb: Math.round(process.memoryUsage().rss / 1024) };
  try { const f = fs.readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' '); m.minflt = Number(f[7]); m.majflt = Number(f[9]); } catch {}
  try {
    for (const l of fs.readFileSync('/proc/self/smaps_rollup', 'utf8').split('\n')) {
      const x = l.match(/^(\w+):\s+(\d+) kB/); if (x) m[x[1]] = Number(x[2]);
    }
    if (m.Rss !== undefined) m.file_backed_kb = m.Rss - (m.Anonymous ?? 0);
  } catch {}
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('footprint', ['-p', String(process.pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const x = out.match(/phys_footprint:\s+([\d.]+)\s*(KB|MB|GB)/); if (x) m.phys_footprint_kb = Math.round(Number(x[1]) * { KB: 1, MB: 1024, GB: 1048576 }[x[2]]);
    } catch {}
  }
  return m;
}
const memLoaded = memory();

// ---- warm-up, then the timed pass
const ids = new Int32Array(L), scores = new Float64Array(L);
const lists = Buffer.alloc(nq * L * 8); const lv = new Int32Array(lists.buffer, 0, nq * L), ls = new Float32Array(lists.buffer, nq * L * 4, nq * L);
const timings = new Array(nq).fill(-1), native = o['native-split'] ? new Array(nq).fill(0) : null;
const stageNs = stages ? [0, 1, 2, 3].map(() => new Array(nq).fill(-1)) : null;
const run = async r => { curRow = r; ids.fill(-1); scores.fill(NaN); return searchOne(inject(r), ids, scores, queries[r].text); };
let firstNs = null;
if (!o.cold) { const w = perm(warm.length, 7); for (let i = 0; i < Math.min(500, warm.length); i++) await run(warm[w[i]]); }
const testSleep = Number(process.env.SS_TEST_SLEEP_MS || 0), sleepCell = new Int32Array(new SharedArrayBuffer(4));
const order = perm(nq, 42 + round);
timedPass = true;
let short = 0;
for (const qi of order) {
  nativeNs = 0;
  const s = process.hrtime.bigint();
  const n = await run(qrows[qi]);
  const ns = Number(process.hrtime.bigint() - s);
  timings[qi] = ns; if (firstNs === null) firstNs = ns; if (native) native[qi] = nativeNs;
  if (stageNs) for (let k = 0; k < 4; k++) stageNs[k][qi] = lastStage[k];
  if (n < L) short++;
  if (testSleep) Atomics.wait(sleepCell, 0, 0, testSleep);  // test_harness.sh only: a job slow enough to kill mid-run
  for (let j = 0; j < L; j++) { lv[qi * L + j] = ids[j]; ls[qi * L + j] = scores[j]; }
}
const memAfter = memory();
if (dump) fs.writeFileSync(o.dump, Buffer.concat(dumpRows));  // timed-pass order: see order_seed

// ---- record
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const stem = o.out; fs.mkdirSync(path.dirname(stem), { recursive: true });
fs.writeFileSync(`${stem}.lists.bin.tmp`, lists); fs.renameSync(`${stem}.lists.bin.tmp`, `${stem}.lists.bin`);
const key = o.key ? JSON.parse(fs.readFileSync(o.key, 'utf8')) : null;
const rec = {
  job_hash: o['job-hash'] ?? null, key, complete: true,
  system: `ours_${mode === 'A' ? o.gen : 'cascade'}`, comparison: mode, set: o.set, model: o.model, split: o.split, round,
  params, L, n_queries: nq, order_seed: 42 + round, warmup: o.cold ? 0 : Math.min(500, warm.length), cold: !!o.cold,
  timings_ns: timings, native_ns: native, first_query_ns: firstNs,
  ...(stageNs ? { stage_ns: { conv: stageNs[0], gen: stageNs[1], screen: stageNs[2], rescore: stageNs[3] } } : {}),
  env_switches: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('SS_FIX_') || k.startsWith('SS_HNSW_'))),
  lists_sha256: sha(lists), short_lists: short,
  memory: { loaded: memLoaded, after: memAfter }, load_s: loadS, process_s: (performance.now() - t0) / 1000,
  env: { host: os.hostname(), cpu: os.cpus()[0]?.model, node: process.version, platform: process.platform, arch: process.arch,
    index_root: root, thp: (() => { try { return fs.readFileSync('/sys/kernel/mm/transparent_hugepage/enabled', 'utf8').trim(); } catch { return null; } })() },
};
fs.writeFileSync(`${stem}.json.tmp`, JSON.stringify(rec)); fs.renameSync(`${stem}.json.tmp`, `${stem}.json`);
const p50 = [...timings].sort((a, b) => a - b)[Math.floor(nq / 2)] / 1e3;
console.log(`${rec.system} ${o.set}/${o.model}/${o.split} r${round} ${JSON.stringify(params)} nq=${nq} short=${short}` + (o.heldout ? '' : ` p50 ${p50.toFixed(0)} us`));
process.exit(0);
