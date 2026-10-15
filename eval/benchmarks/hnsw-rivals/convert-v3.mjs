// Bench only: rewrite a bench index in the format-3 index file without rebuilding it, so an A/B compares the
// same graph, codes and int8 rows. The old code (oldRepo) loads the JSON sidecars; the new code (newRepo)
// takes over the node table, graph (as the old load left it: re-pruned above 150k), int8 rows and entry point,
// and saves to <outRoot>/.sweet-search. codebase.db and the full-vector files are hard-linked beside it.
// usage: node convert-v3.mjs <oldRepo> <newRepo> <root> <outRoot>
import fs from 'node:fs';
import path from 'node:path';
const [oldRepo, newRepo, root, outRoot] = process.argv.slice(2);
const src = `${root}/.sweet-search`; const dst = `${outRoot}/.sweet-search`;
fs.mkdirSync(dst, { recursive: true });
for (const f of ['codebase.db', 'codebase-binary-hnsw.fullvec.bin', 'codebase-binary-hnsw.fullvec.map', 'codebase-binary-hnsw.idx.stale.bin']) {
  if (!fs.existsSync(`${src}/${f}`)) continue;
  fs.rmSync(`${dst}/${f}`, { force: true }); fs.linkSync(`${src}/${f}`, `${dst}/${f}`);
}
const Old = (await import(`${oldRepo}/core/vector-store/binary-hnsw-index.js`)).BinaryHNSWIndex;
const New = (await import(`${newRepo}/core/vector-store/binary-hnsw-index.js`)).BinaryHNSWIndex;
const a = new Old({ indexPath: `${src}/codebase-binary-hnsw.idx` }); await a.load();
const n = a.vectors.length;
const b = new New({ indexPath: `${dst}/codebase-binary-hnsw.idx`, dimension: a.dimension, floatDimension: a.floatDimension,
  M: a.M, efConstruction: a.efConstruction, efSearch: a.efSearch, maxElements: a.maxElements });
b.resetForBuild();
for (const k of ['dimension', 'floatDimension', 'M', 'efConstruction', 'efSearch', 'maxElements', 'maxLevel', 'entryPoint', 'useAsymmetric', 'centroid', 'signVector']) b[k] = a[k];
const slab = b._codes();
for (let i = 0; i < n; i++) {
  const v = a.vectors[i];
  slab.set(i, v.binary); b._ids.push(v.id); b._metas.push(v.metadata); b.idToIndex.set(v.id, i);
  const r = a.int8Vectors.get(v.id); if (r) b._putInt8(i, r);
}
b.graph = a.graph;               // thawed from the old native snapshot (exact lists)
b._cleanBuild = false;
await b.save(`${dst}/codebase-binary-hnsw.idx`);
const sz = fs.statSync(`${dst}/codebase-binary-hnsw.idx`).size;
console.log(JSON.stringify({ root: path.basename(root), n, idx_bytes: sz, per_vector: +(sz / n).toFixed(1) }));
process.exit(0);
