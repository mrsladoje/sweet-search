// Distractor set (GCSN held-out + dev-repo chunks) with exact-duplicate distractors removed.
// A distractor is dropped when its normalised vector (rounded to 1e-5) equals one already kept.
// GCSN chunks always come first and are never dropped. Same production build as build-cap.mjs.
// usage: node build-dedup.mjs <cap|all> <outDir> <gcsnHoDir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const R = '/Users/admin/Projects/sweet-search-private';
const Database = (await import(`${R}/node_modules/better-sqlite3/lib/index.js`)).default;
const { buildHnswIndex } = await import(`${R}/core/indexing/artifact-builder.js`);
const { FloatVectorStore } = await import(`${R}/core/vector-store/float-vector-store.js`);
const { truncateForHNSW } = await import(`${R}/core/infrastructure/quantization.js`);
const [capArg, outArg, hoArg] = process.argv.slice(2);
const CAP = capArg === 'all' ? Infinity : Number(capArg);
const OUT = path.resolve(outArg); const SS = `${OUT}/.sweet-search`; fs.mkdirSync(SS, { recursive: true });
const HO = path.resolve(hoArg);
const repos = fs.readdirSync(`${R}/eval/repos`).filter(r => !r.startsWith('h-') && fs.existsSync(`${R}/eval/repos/${r}/.sweet-search/codebase-binary-hnsw.meta.json`));
const sources = [['', `${R}/eval/corpus/gencodesearchnet`], ...repos.map(r => [`${r}::`, `${R}/eval/repos/${r}`])];
const gm = JSON.parse(fs.readFileSync(`${HO}/meta.json`)); const g2doc = new Map(gm.ids.map((id, i) => [id, gm.chunkDoc[i]]));
const key = e => {
  let n = 0; for (const v of e) n += v * v; n = Math.sqrt(n) || 1;
  const q = new Int32Array(e.length); for (let i = 0; i < e.length; i++) q[i] = Math.round(e[i] / n * 1e5);
  return crypto.createHash('sha1').update(Buffer.from(q.buffer)).digest('base64');
};
const seen = new Set(), items = [], chunkDoc = [], dropped = {};
let scanned = 0;
for (const [pfx, root] of sources) {
  const db = new Database(`${root}/.sweet-search/codebase.db`, { readonly: true });
  const ep = db.prepare("SELECT count(*) c FROM pragma_table_info('vectors') WHERE name='epoch_retired'").get().c ? ' WHERE epoch_retired IS NULL' : '';
  for (const r of db.prepare(`SELECT id, embedding FROM vectors${ep} ORDER BY rowid`).iterate()) {
    const e = new Float32Array(r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.length));
    if (e.length !== 768) continue;
    if (items.length >= CAP) break;
    scanned++;
    const k = key(e);
    if (pfx && seen.has(k)) { const repo = pfx.slice(0, -2); dropped[repo] = (dropped[repo] || 0) + 1; continue; }
    seen.add(k);
    items.push({ id: pfx + r.id, embedding: e, metadata: {} }); chunkDoc.push(pfx ? null : g2doc.get(r.id) ?? null);
  }
  db.close();
  if (items.length >= CAP) break;
}
const nDropped = Object.values(dropped).reduce((a, b) => a + b, 0);
const top = Object.entries(dropped).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log('vectors', items.length, 'gcsn mapped', chunkDoc.filter(Boolean).length, 'scanned', scanned, 'duplicates dropped', nDropped, 'top repos', JSON.stringify(top));
const t0 = performance.now();
const { index, stats } = await buildHnswIndex(items, { indexPath: `${SS}/codebase-binary-hnsw.idx` });
console.log('build', stats.buildTimeMs / 1000, 's');
await index.save(`${SS}/codebase-binary-hnsw.idx`);
const fvs = new FloatVectorStore(); fvs.build(items.map(it => ({ id: it.id, vector: truncateForHNSW(it.embedding, 512) })), 512); await fvs.save(`${SS}/codebase-float-vectors.bin`);
const db = new Database(`${SS}/codebase.db`); db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, embedding BLOB)');
const ins = db.prepare('INSERT INTO vectors VALUES (?, ?, ?)'); db.transaction(() => { for (const it of items) ins.run(it.id, '', Buffer.from(it.embedding.buffer)); })(); db.close();
const fd = fs.openSync(`${OUT}/corpus768.bin`, 'w'); for (const it of items) fs.writeSync(fd, Buffer.from(it.embedding.buffer)); fs.closeSync(fd);
fs.copyFileSync(`${HO}/q768.bin`, `${OUT}/q768.bin`);
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify({ root: OUT, dim: 768, ids: items.map(i => i.id), chunkDoc, queries: gm.queries, build_s: stats.buildTimeMs / 1000, dedup: { scanned, dropped: nDropped, byRepo: dropped } }));
console.log('done', ((performance.now() - t0) / 1000).toFixed(0), 's'); process.exit(0);
