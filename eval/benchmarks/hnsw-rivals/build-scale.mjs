// Build a ~148k-vector index (GCSN + dev-repo distractors) with the production build function.
import fs from 'node:fs';
import path from 'node:path';
const R = '/Users/admin/Projects/sweet-search-private';
const Database = (await import(`${R}/node_modules/better-sqlite3/lib/index.js`)).default;
const { buildHnswIndex } = await import(`${R}/core/indexing/artifact-builder.js`);
const { FloatVectorStore } = await import(`${R}/core/vector-store/float-vector-store.js`);
const { truncateForHNSW } = await import(`${R}/core/infrastructure/quantization.js`);
const OUT = path.resolve('scale'); const SS = `${OUT}/.sweet-search`; fs.mkdirSync(SS, { recursive: true });
const repos = fs.readdirSync(`${R}/eval/repos`).filter(r => !r.startsWith('h-') && fs.existsSync(`${R}/eval/repos/${r}/.sweet-search/codebase-binary-hnsw.meta.json`));
const sources = [['', `${R}/eval/corpus/gencodesearchnet`], ...repos.map(r => [`${r}::`, `${R}/eval/repos/${r}`])];
const gm = JSON.parse(fs.readFileSync('gcsn/meta.json')); const g2doc = new Map(gm.ids.map((id, i) => [id, gm.chunkDoc[i]]));
const items = [], chunkDoc = [];
for (const [pfx, root] of sources) {
  const db = new Database(`${root}/.sweet-search/codebase.db`, { readonly: true });
  const ep = db.prepare("SELECT count(*) c FROM pragma_table_info('vectors') WHERE name='epoch_retired'").get().c ? ' WHERE epoch_retired IS NULL' : '';
  for (const r of db.prepare(`SELECT id, embedding FROM vectors${ep} ORDER BY rowid`).iterate()) {
    const e = new Float32Array(r.embedding.buffer.slice(r.embedding.byteOffset, r.embedding.byteOffset + r.embedding.length));
    if (e.length !== 768) continue;
    items.push({ id: pfx + r.id, embedding: e, metadata: {} }); chunkDoc.push(pfx ? null : g2doc.get(r.id) ?? null);
  }
  db.close();
}
console.log('repos', repos.length, 'vectors', items.length, 'gcsn mapped', chunkDoc.filter(Boolean).length);
const t0 = performance.now();
const { index, stats } = await buildHnswIndex(items, { indexPath: `${SS}/codebase-binary-hnsw.idx` });
console.log('build', stats.buildTimeMs / 1000, 's', stats.insertionOrder);
await index.save(`${SS}/codebase-binary-hnsw.idx`);
const fvs = new FloatVectorStore(); fvs.build(items.map(it => ({ id: it.id, vector: truncateForHNSW(it.embedding, 512) })), 512); await fvs.save(`${SS}/codebase-float-vectors.bin`);
const db = new Database(`${SS}/codebase.db`); db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, embedding BLOB)');
const ins = db.prepare('INSERT INTO vectors VALUES (?, ?, ?)'); db.transaction(() => { for (const it of items) ins.run(it.id, '', Buffer.from(it.embedding.buffer)); })(); db.close();
const fd = fs.openSync(`${OUT}/corpus768.bin`, 'w'); for (const it of items) fs.writeSync(fd, Buffer.from(it.embedding.buffer)); fs.closeSync(fd);
fs.copyFileSync('gcsn/q768.bin', `${OUT}/q768.bin`);
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify({ root: OUT, dim: 768, ids: items.map(i => i.id), chunkDoc, queries: gm.queries, build_s: stats.buildTimeMs / 1000 }));
console.log('done', ((performance.now() - t0) / 1000).toFixed(0), 's'); process.exit(0);
