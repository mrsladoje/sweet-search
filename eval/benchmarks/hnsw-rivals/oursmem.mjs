// Phase A (HANDOFF-v5 §4, A1-A3): memory, disk and load time of our arm on one bench set.
// Loads the index as the product does, runs the dev queries 3 times through semanticSearch3Stage (as ours.mjs),
// and prints one JSON (also written to <setDir>/<OUT|mem.json>):
//   load_s, peak_rss_mb (process maxRSS: load + queries), rss after load / after queries, split into anonymous
//   and file-backed (Linux /proc/self/smaps; the full-vector file mapping on its own line; macOS: footprint);
//   V8 heap (heapUsed, external, arrayBuffers);
//   per structure, computed from the live objects: native codes, native CSR per level, JS code slab, int8 slab;
//   per JS structure, measured: heap freed by dropping it with --expose-gc (node records, id map, int8 row map);
//   disk bytes per file and per vector.
// usage: node --expose-gc oursmem.mjs <setDir>    env: R (repo root), NQ (queries, default 3600), OUT
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const R = process.env.R || '/Users/admin/Projects/sweet-search-private';
const set = process.argv[2]; const NQ = Number(process.env.NQ || 3600);
if (typeof global.gc !== 'function') throw new Error('run with node --expose-gc');
const meta = JSON.parse(fs.readFileSync(`${set}/meta.json`));
const ss = `${process.env.ROOT || meta.root}/.sweet-search`;  // ROOT: another copy of the index (A/B arms)
const indexPath = `${ss}/codebase-binary-hnsw.idx`;
const MB = x => +(x / 2 ** 20).toFixed(1);

function procMem() {
  const m = process.memoryUsage();
  const out = { rss: MB(m.rss), heapUsed: MB(m.heapUsed), heapTotal: MB(m.heapTotal), external: MB(m.external), arrayBuffers: MB(m.arrayBuffers) };
  if (fs.existsSync('/proc/self/smaps')) {
    // kB per mapping; group: anonymous (incl. [heap], [stack]), the full-vector file, other files.
    const txt = fs.readFileSync('/proc/self/smaps', 'utf8');
    const g = { anon: 0, anonHuge: 0, fullvec: 0, files: 0 };
    let name = '';
    for (const line of txt.split('\n')) {
      const h = line.match(/^[0-9a-f]+-[0-9a-f]+ \S+ \S+ \S+ \S+\s*(.*)$/);
      if (h) { name = h[1]; continue; }
      const f = line.match(/^(Rss|Anonymous|AnonHugePages):\s+(\d+) kB/);
      if (!f) continue;
      const kb = Number(f[2]);
      if (f[1] === 'Anonymous') g.anon += kb;
      else if (f[1] === 'AnonHugePages') g.anonHuge += kb;
      else if (f[1] === 'Rss' && name.startsWith('/')) { if (name.includes('.fullvec.bin')) g.fullvec += kb; else g.files += kb; }
    }
    // Rss of a file mapping includes its private dirty (anonymous) pages; files = Rss of file mappings.
    for (const k of Object.keys(g)) out[`${k}_mb`] = +(g[k] / 1024).toFixed(1);
  } else if (process.platform === 'darwin') {
    try {
      const f = execFileSync('footprint', ['-p', String(process.pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m2 = f.match(/Footprint:\s+([\d.]+)\s*(KB|MB|GB)/);
      if (m2) out.footprint_mb = +(Number(m2[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[m2[2]]).toFixed(1);
    } catch { /* footprint needs no root for own pid; skip if missing */ }
    try {
      const v = execFileSync('vmmap', ['-summary', String(process.pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
      const fv = v.split('\n').filter(l => l.includes('.fullvec.bin'));
      out.vmmap_fullvec = fv.map(l => l.trim()).slice(0, 3);
    } catch { /* optional */ }
  }
  return out;
}

const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/index.js`);
const { CodebaseRepository } = await import(`${R}/core/infrastructure/codebase-repository.js`);
const { semanticSearch3Stage } = await import(`${R}/core/search/search-semantic.js`);
const { queryCache } = await import(`${R}/core/embedding/embedding-cache.js`);
const { truncateForHNSW, floatToBinary } = await import(`${R}/core/embedding/embedding-service.js`);
const { BINARY_HNSW_CONFIG } = await import(`${R}/core/config.js`);

global.gc(); const before = procMem();
const t0 = performance.now();
const idx = new BinaryHNSWIndex({ indexPath }); await idx.load();
const loadS = (performance.now() - t0) / 1000;
const peakLoadMb = MB(process.resourceUsage().maxRSS * 1024);
global.gc(); const afterLoad = procMem();

const n = (idx.size ?? idx.vectors.length);
// Queries (same path and inputs as ours.mjs).
const self = {
  binaryHnswIndex: idx, floatVectorStore: null, codebaseRepo: new CodebaseRepository(`${ss}/codebase.db`),
  stage1Candidates: BINARY_HNSW_CONFIG.retrieval.stage1Candidates, cascadeEnabled: false, useLateInteraction: false,
  log() {}, shouldSkipRerank: () => ({ skip: false }), reranker: { isAnyAvailable: () => false },
};
const qs = meta.queries.slice(0, NQ);
const Q = new Float32Array(fs.readFileSync(`${set}/q768.bin`).buffer.slice(0));
const D = meta.dim || 768;
for (let rep = 0; rep < 3; rep++) {
  for (let i = 0; i < qs.length; i++) {
    const float = Q.slice(i * D, (i + 1) * D);
    queryCache.set(`binary:${qs[i].text}`, { binary: floatToBinary(truncateForHNSW(float)), float });
    await semanticSearch3Stage.call(self, qs[i].text, { k: 10, rerank: false });
  }
}
queryCache.clear?.();
global.gc(); const afterQueries = procMem();
const peakMb = MB(process.resourceUsage().maxRSS * 1024);
// Graph stats after the memory readings: exportLevel copies each level into a new buffer.
const nat = idx._nativeSearcher();
const levels = [];
for (let l = 0; l <= idx.maxLevel; l++) {
  const len = nat.exportLevel(l).length;  // offsets (n + 1) + links
  const links = len - (n + 1);
  levels.push({ level: l, links, mean_degree: +(links / n).toFixed(1), bytes: len * 4 });
}
const csr = levels.reduce((a, x) => a + x.bytes, 0);
const computed = {
  native_codes: n * idx.dimension,
  native_csr: csr,
  js_code_slab: idx._slab?.slab?.byteLength ?? 0,
  int8_slab: (idx._int8 ? idx._int8.rows : idx._int8Slab?.slab)?.byteLength ?? 0,
  int8_present: (idx._int8 ? idx._int8.present : idx._int8Slab?.present)?.byteLength ?? 0,
};


// JS structures: heap freed when each is dropped (the index is unusable afterwards).
const freed = {};
const drop = (name, fn) => { global.gc(); const a = process.memoryUsage(); fn(); global.gc(); const b = process.memoryUsage();
  freed[name] = { heap: MB(a.heapUsed - b.heapUsed), external: MB(a.external - b.external), arrayBuffers: MB(a.arrayBuffers - b.arrayBuffers), rss: MB(a.rss - b.rss) }; };
// Old code: node records {id, binary view, metadata} + an id -> int8 row map; new code: id and metadata arrays.
if (idx.int8Vectors) drop('int8_row_map', () => { idx.int8Vectors = new Map(); });
drop('id_map', () => { idx.idToIndex = new Map(); });
if (idx._ids) { drop('node_ids', () => { idx._ids = []; }); drop('node_metas', () => { idx._metas = []; }); }
else drop('node_records', () => { idx.vectors = []; });
drop('int8_slab', () => { if (idx._int8) idx._int8 = null; else idx._int8Slab = null; });
drop('js_code_slab', () => { idx._slab = null; });
drop('graph_frozen_meta', () => { idx._graphFrozen = null; });

// Disk: every file of this index + codebase.db.
const disk = {};
for (const f of fs.readdirSync(ss)) {
  if (!f.startsWith('codebase-binary-hnsw') && f !== 'codebase.db') continue;
  const st = fs.statSync(path.join(ss, f)); if (!st.isFile()) continue;
  disk[f] = { bytes: st.size, per_vector: +(st.size / n).toFixed(1) };
}
const diskTotal = Object.values(disk).reduce((a, x) => a + x.bytes, 0);

const res = {
  set: path.basename(set), n, host: os.hostname(), cpu: os.cpus()[0].model, node: process.version, nq: qs.length,
  load_s: +loadS.toFixed(2), peak_rss_load_mb: peakLoadMb, peak_rss_mb: peakMb,
  mem: { before, afterLoad, afterQueries },
  computed_mb: Object.fromEntries(Object.entries(computed).map(([k, v]) => [k, MB(v)])), levels,
  freed_mb: freed,
  disk, disk_total_mb: MB(diskTotal), disk_per_vector: +(diskTotal / n).toFixed(0),
};
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(`${set}/${process.env.OUT || 'mem.json'}`, JSON.stringify(res));
process.exit(0);
