// Re-embed a sample of texts with the product's own embedding path (core/embedding getEmbeddings: the
// path the indexer uses, native Metal/CoreML or ORT, whatever this machine selects) and compare each
// result with the stored vector. Prints max |cos - 1| and the max absolute component difference.
// usage: node texts_check.mjs --texts <texts.jsonl> (--corpus <corpus.f32> [--offset N] | --db <codebase.db>)
//                              [--n 20] [--seed 42] [--label name] [--path gpu|service] [--filter exact|inexact]
//   --filter keeps the lines whose "exact" field is true / false (texts.jsonl of texts.py).
//   --path gpu (default): the indexer's GPU pool (initIndexGpuPool + nativeEmbed, maxLength 512), as
//   eval/benchmarks/hnsw-rivals ... scale1m/embed.mjs did for the 1M set; --path service: getEmbeddings
//   (on a host without the GPU pool this is the ORT INT8 CPU model).
//   texts.jsonl lines: {"vid"|"id": "...", "text": "..."} (null text lines are skipped).
//   --corpus: stored vector of line i = row (i + offset) of the float32 file (768 columns).
//   --db: stored vector = `embedding` blob of the row whose id equals the line id.
// No retrieval metric is computed; light load (n texts).
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

const R = process.env.SS_REPO || '/Users/admin/Projects/sweet-search-private';
const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const textsF = arg('texts'), corpusF = arg('corpus'), dbF = arg('db');
const N = Number(arg('n', 20)), SEED = Number(arg('seed', 42)), OFFSET = Number(arg('offset', 0)), label = arg('label', '');
if (!textsF || (!corpusF && !dbF)) throw new Error('usage: --texts f (--corpus f32 | --db codebase.db) [--n] [--seed] [--offset] [--label]');
const D = 768;

// 1. pick the sample (seeded; two streaming passes, the 1M-line file is never held in memory)
let s = SEED; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
const FILTER = arg('filter');
const eligible = [];
{
  let i = 0;
  for await (const l of readline.createInterface({ input: fs.createReadStream(textsF), crlfDelay: Infinity })) {
    const o = JSON.parse(l);
    if (o.text != null && !(FILTER === 'exact' && o.exact !== true) && !(FILTER === 'inexact' && o.exact !== false)) eligible.push(i);
    i++;
  }
}
const pick = [];
const pool = eligible.slice();
for (let k = 0; k < Math.min(N, pool.length); k++) { const j = k + Math.floor(rnd() * (pool.length - k)); [pool[k], pool[j]] = [pool[j], pool[k]]; pick.push(pool[k]); }
pick.sort((a, b) => a - b);
const want = new Set(pick); const items = [];
{
  let i = 0;
  for await (const l of readline.createInterface({ input: fs.createReadStream(textsF), crlfDelay: Infinity })) {
    if (want.has(i)) items.push({ line: i, ...JSON.parse(l) });
    i++;
  }
}

// 2. stored vectors
const stored = items.map(it => {
  if (corpusF) {
    const fd = fs.openSync(corpusF, 'r'); const b = Buffer.alloc(D * 4);
    fs.readSync(fd, b, 0, D * 4, (it.line + OFFSET) * D * 4); fs.closeSync(fd);
    return new Float32Array(b.buffer, b.byteOffset, D).slice();
  }
  return null;
});
if (dbF) {
  const Database = (await import(`${R}/node_modules/better-sqlite3/lib/index.js`)).default;
  const db = new Database(dbF, { readonly: true });
  const st = db.prepare('SELECT embedding FROM vectors WHERE id = ?');
  items.forEach((it, i) => { const r = st.get(it.id ?? it.vid); const e = r.embedding; stored[i] = new Float32Array(e.buffer.slice(e.byteOffset, e.byteOffset + e.length)); });
  db.close();
}

// 3. re-embed with the product path
process.env.SWEET_SEARCH_PROJECT_ROOT ||= R;
const PATH = arg('path', 'gpu');
let res, info, ms, backend = PATH;
if (PATH === 'gpu') {
  const { teardownAllModels, initIndexGpuPool } = await import(`${R}/core/indexing/model-pool.js`);
  const ni = await import(`${R}/core/infrastructure/native-inference.js`);
  await teardownAllModels();
  const pool = await initIndexGpuPool({ includeLi: false });
  backend = JSON.stringify(pool); info = { model: 'native pool', provider: 'gpu' };
  const t0 = performance.now();
  const embs = await ni.nativeEmbed(items.map(it => it.text), { maxLength: 512 });
  ms = performance.now() - t0; res = embs.map(e => ({ embedding: e }));
} else {
  const { getEmbeddings, getModelInfo } = await import(`${R}/core/embedding/embedding-service.js`);
  info = getModelInfo();
  const t0 = performance.now();
  res = await getEmbeddings(items.map(it => it.text), { useCache: false });
  ms = performance.now() - t0;
}
const norm = v => { let n = 0; for (const x of v) n += x * x; return Math.sqrt(n) || 1; };
let maxCos = 0, maxAbs = 0, minCos = 1; const per = [];
res.forEach((r, i) => {
  const a = Float32Array.from(r.embedding), b = stored[i];
  if (a.length !== D) throw new Error('dim ' + a.length);
  let dot = 0, ad = 0; const na = norm(a), nb = norm(b);
  for (let k = 0; k < D; k++) { dot += (a[k] / na) * (b[k] / nb); ad = Math.max(ad, Math.abs(a[k] / na - b[k] / nb)); }
  per.push(+dot.toFixed(6)); maxCos = Math.max(maxCos, Math.abs(1 - dot)); minCos = Math.min(minCos, dot); maxAbs = Math.max(maxAbs, ad);
});
console.log(JSON.stringify({ label, texts: textsF && path.basename(textsF), n: items.length, model: info.model, provider: info.provider, backend,
  max_abs_cos_minus_1: +maxCos.toExponential(3), min_cos: +minCos.toFixed(6), max_abs_component_diff: +maxAbs.toExponential(3), ms_total: Math.round(ms), cos: per }));
process.exit(0);
