// 1M-vector set: the 6,918 GCSN documents + CodeSearchNet functions as distractors (scale1m/mk_texts.py:
// all CodeXGLUE code-to-text splits, the 30 GCSN source repos excluded, whitespace-normalised duplicates
// dropped, seed-42 shuffle; embedded with CodeRankEmbed by scale1m/embed.mjs, maxLength 512).
// GCSN chunks come first and are never dropped; a distractor whose unit vector (rounded to 1e-5) equals a
// kept one is dropped (same rule as build-dedup.mjs). Our index is built by the production builder
// (buildHnswIndex: binary HNSW M64 / efC800 + int8 store); full 768-d vectors go to codebase.db.
// Writes <out>/{corpus768.bin, .sweet-search/...} and one set dir per query split (<out>-ho, <out>-dev)
// with q768.bin + meta.json pointing at the shared root.
// usage: node --max-old-space-size=32000 build-1m.mjs <gcsnHoSetDir> <gcsnDevSetDir> <csnTexts.jsonl> <vec768.f32> <outRoot> [limit]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
const R = process.env.R || '/Users/admin/Projects/sweet-search-private';
const Database = (await import(`${R}/node_modules/better-sqlite3/lib/index.js`)).default;
const { buildHnswIndex } = await import(`${R}/core/indexing/artifact-builder.js`);
const [hoArg, devArg, textsArg, vecArg, outArg, limArg] = process.argv.slice(2);
const LIMIT = limArg ? Number(limArg) : Infinity;
const OUT = path.resolve(outArg); const SS = `${OUT}/.sweet-search`; fs.mkdirSync(SS, { recursive: true });
const ho = JSON.parse(fs.readFileSync(`${hoArg}/meta.json`)), dev = JSON.parse(fs.readFileSync(`${devArg}/meta.json`));
if (JSON.stringify(ho.ids) !== JSON.stringify(dev.ids)) throw new Error('ho/dev corpora differ');
const key = e => {
  let n = 0; for (const v of e) n += v * v; n = Math.sqrt(n) || 1;
  const q = new Int32Array(e.length); for (let i = 0; i < e.length; i++) q[i] = Math.round(e[i] / n * 1e5);
  return crypto.createHash('sha1').update(Buffer.from(q.buffer)).digest('base64');
};
const seen = new Set(), items = [], chunkDoc = [];
const G = new Float32Array(fs.readFileSync(`${hoArg}/corpus768.bin`).buffer.slice(0));
for (let i = 0; i < ho.ids.length; i++) {
  const e = G.slice(i * 768, (i + 1) * 768); seen.add(key(e));
  items.push({ id: ho.ids[i], embedding: e, metadata: {} }); chunkDoc.push(ho.chunkDoc[i]);
}
const nG = items.length;
const fd = fs.openSync(vecArg, 'r'); const nVec = fs.fstatSync(fd).size / 3072;
let row = 0, dropped = 0;
for await (const line of readline.createInterface({ input: fs.createReadStream(textsArg) })) {
  if (row >= nVec || items.length - nG >= LIMIT) break;
  const e = new Float32Array(768); fs.readSync(fd, Buffer.from(e.buffer), 0, 3072, row * 3072); row++;
  const k = key(e); if (seen.has(k)) { dropped++; continue; } seen.add(k);
  items.push({ id: JSON.parse(line).id, embedding: e, metadata: {} }); chunkDoc.push(null);
}
fs.closeSync(fd);
console.log('vectors', items.length, 'gcsn', nG, 'distractors read', row, 'duplicates dropped', dropped);
const cf = fs.openSync(`${OUT}/corpus768.bin`, 'w'); for (const it of items) fs.writeSync(cf, Buffer.from(it.embedding.buffer)); fs.closeSync(cf);
const db = new Database(`${SS}/codebase.db`); db.exec('CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, file_path TEXT, embedding BLOB)');
const ins = db.prepare('INSERT OR REPLACE INTO vectors VALUES (?, ?, ?)');
db.transaction(() => { for (const it of items) ins.run(it.id, '', Buffer.from(it.embedding.buffer)); })(); db.close();
console.log('codebase.db written', new Date().toISOString());
const t0 = performance.now();
const { index, stats } = await buildHnswIndex(items, { indexPath: `${SS}/codebase-binary-hnsw.idx` });
const build_s = stats.buildTimeMs / 1000;
await index.save(`${SS}/codebase-binary-hnsw.idx`);
console.log('our index build', build_s, 's; with save', ((performance.now() - t0) / 1000).toFixed(0), 's');
const common = { root: OUT, dim: 768, ids: items.map(i => i.id), chunkDoc, build_s, dedup: { distractors_read: row, dropped } };
for (const [suffix, m, dir] of [['-ho', ho, hoArg], ['-dev', dev, devArg]]) {
  const sd = `${OUT}${suffix}`; fs.mkdirSync(sd, { recursive: true });
  fs.copyFileSync(`${dir}/q768.bin`, `${sd}/q768.bin`);
  fs.writeFileSync(`${sd}/meta.json`, JSON.stringify({ ...common, queries: m.queries }));
  try { fs.symlinkSync(`${OUT}/corpus768.bin`, `${sd}/corpus768.bin`); } catch {}
}
console.log('done', new Date().toISOString()); process.exit(0);
