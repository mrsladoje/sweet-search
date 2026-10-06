// Export full 768d corpus vectors (codebase.db) + query embeddings for one dataset.
// usage: node export2.mjs <name> <indexRoot> <queriesJsonl> <corpusJsonl|-> <nQueries> [devSplitJson]
import fs from 'node:fs';
import path from 'node:path';
const R = '/Users/admin/Projects/sweet-search-private';
const [name, root, qFile, cFile, nQ, devFile] = process.argv.slice(2);
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), name); fs.mkdirSync(OUT, { recursive: true });
const Database = (await import(`${R}/node_modules/better-sqlite3/lib/index.js`)).default;
const { getBinaryEmbedding } = await import(`${R}/core/embedding/index.js`);
const { prepareCorpus } = await import(`${R}/eval/lib/corpus.js`);
const db = new Database(`${root}/.sweet-search/codebase.db`, { readonly: true });
const hasEpoch = db.prepare("SELECT count(*) c FROM pragma_table_info('vectors') WHERE name='epoch_retired'").get().c > 0;
const W = hasEpoch ? ' WHERE epoch_retired IS NULL' : '';
const n = db.prepare('SELECT count(*) c FROM vectors' + W).get().c;
const X = fs.openSync(`${OUT}/corpus768.bin`, 'w'); const ids = []; let dim = 0;
for (const r of db.prepare('SELECT id, embedding FROM vectors' + W + ' ORDER BY rowid').iterate()) {
  dim = r.embedding.length / 4; ids.push(r.id); fs.writeSync(X, r.embedding);
}
fs.closeSync(X); console.log('corpus', n, ids.length, 'dim', dim);
const load = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse);
let chunkDoc = null;
if (cFile !== '-') {
  const m = prepareCorpus(load(cFile), root, { skipClean: true });
  const f2d = {}; for (const [d, f] of m) f2d[path.relative(root, f)] = d;
  chunkDoc = ids.map(id => f2d[id.replace(/:\d+-\d+:\d+$/, '')] ?? null);
  console.log('unmapped', chunkDoc.filter(x => !x).length);
}
let qs = load(qFile);
if (devFile) { const dev = new Set(JSON.parse(fs.readFileSync(devFile)).ids); qs = qs.filter(q => dev.has(q.query_id)); }
// deterministic seed-42 shuffle, then take nQ
let s = 42; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]]; }
qs = qs.slice(0, Number(nQ));
const Q = new Float32Array(qs.length * dim);
for (let i = 0; i < qs.length; i++) { const e = await getBinaryEmbedding(qs[i].query); Q.set(e.float.slice(0, dim), i * dim); }
fs.writeFileSync(`${OUT}/q768.bin`, Buffer.from(Q.buffer));
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify({ root, dim, ids, chunkDoc, queries: qs.map(q => ({ id: q.query_id, text: q.query, gold: q.relevant_doc_ids ?? null })) }));
console.log('done', qs.length); process.exit(0);
