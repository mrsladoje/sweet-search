// Write the full-vector file (core/vector-store/full-vector-file.js) for an existing bench index, from its
// codebase.db, without touching the index file: node i gets the SQLite embedding of node i's id.
// A fresh index build writes the same file itself; this is for indexes built before it existed, or with
// another vector-file format.
// usage: node build-fullvec.mjs <setDir>    env: R (repo root), ROOT (index root, default meta.root)
import fs from 'node:fs';
const R = process.env.R || '/Users/admin/Projects/sweet-search-private';
const set = process.argv[2];
const meta = JSON.parse(fs.readFileSync(`${set}/meta.json`));
const ss = `${process.env.ROOT || meta.root}/.sweet-search`;
const indexPath = `${ss}/codebase-binary-hnsw.idx`;
const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/index.js`);
const { CodebaseRepository } = await import(`${R}/core/infrastructure/codebase-repository.js`);
const { FullVectorWriter } = await import(`${R}/core/vector-store/full-vector-file.js`);
const idx = new BinaryHNSWIndex({ indexPath }); await idx.load();
const db = new CodebaseRepository(`${ss}/codebase.db`)._open();
const get = db.prepare('SELECT embedding FROM vectors WHERE id = ?').pluck();
const t = performance.now();
const w = FullVectorWriter.fresh(indexPath);
let missing = 0;
for (let i = 0; i < idx.size; i++) {
  const b = get.get(idx.nodeId(i));
  if (!b) missing++;
  w.put(i, b ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) : null);
}
await w.publish(indexPath, idx.size, `.tmp.${process.pid}`);
const size = fs.statSync(indexPath.replace('.idx', '.fullvec.bin')).size;
console.log(`${set}: ${idx.size} nodes, ${missing} without a vector, ${(size / 1048576).toFixed(0)} MB, ${((performance.now() - t) / 1000).toFixed(1)} s`);
process.exit(0);
