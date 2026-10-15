// Builds our index for one set and model with the production builder (buildHnswIndex: binary HNSW M64 /
// efC800 + int8 rows + the f16 vector file), from DATA/emb/<model>/<set>/corpus.f32 and the vector keys of
// DATA/sets/<set>/vectors.jsonl. The product shuffles the insertion order with Math.random; here the order is
// a seeded Fisher-Yates (splitmix64, the harness's perm) given to the builder as 'sequential', so a build is
// reproducible from its seed. Single-threaded JS, as in the product (PAPER_PLAN 5.10).
// usage: node build_ours.mjs <DATA> <set> <model> [--out <root>] [--seed 42] [--code-width 512] [--int8-width 512]
// Writes <root>/.sweet-search/{codebase-binary-hnsw.idx, .fullvec.bin, .fullvec.map, codebase.db} and
// <root>/build.json (build_s, peak RSS, widths, seed, file SHA-256). env: R (repo root)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const R = process.env.R || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const a = process.argv.slice(2); const [DATA, set, model] = a;
const opt = k => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
const seed = Number(opt('seed') ?? 42), cw = Number(opt('code-width') ?? 512), w8 = Number(opt('int8-width') ?? cw);
const emb = `${DATA}/emb/${model}/${set}`, root = path.resolve(opt('out') ?? `${emb}/index`), SS = `${root}/.sweet-search`;
fs.mkdirSync(SS, { recursive: true });
const { BINARY_HNSW_CONFIG } = await import(`${R}/core/config.js`);
BINARY_HNSW_CONFIG.insertionOrder = 'sequential';
const { buildHnswIndex } = await import(`${R}/core/indexing/artifact-builder.js`);
const Database = (await import(`${R}/node_modules/better-sqlite3/lib/index.js`)).default;

const keys = fs.readFileSync(`${DATA}/sets/${set}/vectors.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).vid);
const D = 768, n = keys.length;
const X = new Float32Array(fs.readFileSync(`${emb}/corpus.f32`).buffer.slice(0));
if (X.length !== n * D) throw new Error(`corpus.f32 has ${X.length / D} rows, the set ${n}`);
function perm(m, s0) {  // the harness's order (ours5.mjs perm)
  let s = BigInt.asUintN(64, BigInt(s0)); const M = (1n << 64n) - 1n;
  const next = () => { s = (s + 0x9e3779b97f4a7c15n) & M; let z = s; z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M; z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M; return z ^ (z >> 31n); };
  const p = Array.from({ length: m }, (_, i) => i);
  for (let i = m - 1; i > 0; i--) { const j = Number(next() % BigInt(i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p;
}
const items = perm(n, seed).map(v => ({ id: keys[v], embedding: X.subarray(v * D, (v + 1) * D), metadata: {} }));
const db = new Database(`${SS}/codebase.db`);
db.exec('CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, file_path TEXT, embedding BLOB)');
const ins = db.prepare('INSERT OR REPLACE INTO vectors VALUES (?, ?, ?)');
db.transaction(() => { for (let v = 0; v < n; v++) ins.run(keys[v], '', Buffer.from(X.buffer, v * D * 4, D * 4)); })(); db.close();
const idxPath = `${SS}/codebase-binary-hnsw.idx`;
const t0 = performance.now();
const { index } = await buildHnswIndex(items, { indexPath: idxPath, floatDimension: cw, int8Dimension: w8 });
const buildS = (performance.now() - t0) / 1000;
await index.save(idxPath);
const totalS = (performance.now() - t0) / 1000;
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = {};
for (const f of ['codebase-binary-hnsw.idx', 'codebase-binary-hnsw.fullvec.bin', 'codebase-binary-hnsw.fullvec.map']) {
  files[f] = { bytes: fs.statSync(`${SS}/${f}`).size, sha256: sha(`${SS}/${f}`) };
}
const info = { set, model, n, seed, code_width: cw, int8_width: w8, M: BINARY_HNSW_CONFIG.M, efC: BINARY_HNSW_CONFIG.efConstruction,
  build_s: buildS, build_and_save_s: totalS, peak_rss_kb: Math.round(process.resourceUsage().maxRSS), threads: 1, files,
  node: process.version, bench_sha: (() => { try { return fs.readFileSync(`${R}/.bench-sha`, 'utf8').trim(); } catch { return null; } })() };
fs.writeFileSync(`${root}/build.json`, JSON.stringify(info, null, 1));
console.log(`built ours ${set}/${model} n=${n} widths ${cw}/${w8} seed ${seed}: ${buildS.toFixed(1)} s (+save ${(totalS - buildS).toFixed(1)} s), peak ${(info.peak_rss_kb / 1024).toFixed(0)} MB`);
process.exit(0);
