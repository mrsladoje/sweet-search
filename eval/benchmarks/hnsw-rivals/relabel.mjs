// W5 (HANDOFF-v5 §5), bench only: renumber the nodes of a format-3 index for memory locality and write it to
// another root, so an A/B can time the walk on the same graph. Order: BFS over level 0 from the entry point
// (neighbor lists in their stored order; unreached nodes appended in old order). Everything indexed by node
// moves together: ids, metadata, codes, int8 rows, every level's lists (ids renamed, list order kept), the
// entry point and the full-vector map (same rows, same generation). codebase.db and the vector data file are
// hard-linked.
// usage: node relabel.mjs <srcRoot> <dstRoot> [bfs]      env: R (repo root)
import fs from 'node:fs';
const R = process.env.R || '/Users/admin/Projects/sweet-search-private';
const [srcRoot, dstRoot] = process.argv.slice(2);
const src = `${srcRoot}/.sweet-search`; const dst = `${dstRoot}/.sweet-search`;
fs.mkdirSync(dst, { recursive: true });
for (const f of ['codebase.db', 'codebase-binary-hnsw.fullvec.bin']) {
  fs.rmSync(`${dst}/${f}`, { force: true }); fs.linkSync(`${src}/${f}`, `${dst}/${f}`);
}
const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/binary-hnsw-index.js`);
const a = new BinaryHNSWIndex({ indexPath: `${src}/codebase-binary-hnsw.idx` }); await a.load();
const n = a.size;
const graph = a.graph;                      // thawed: exact lists
// BFS order over level 0.
const perm = new Int32Array(n).fill(-1);    // old -> new
let next = 0;
const queue = new Uint32Array(n); let qh = 0, qt = 0;
const visit = (v) => { if (perm[v] === -1) { perm[v] = next++; queue[qt++] = v; } };
if (a.entryPoint >= 0) visit(a.entryPoint);
while (qh < qt) { const v = queue[qh++]; for (const u of graph[0][v] || []) visit(u); }
const reached = next;
for (let v = 0; v < n; v++) if (perm[v] === -1) perm[v] = next++;
const b = new BinaryHNSWIndex({ indexPath: `${dst}/codebase-binary-hnsw.idx`, dimension: a.dimension, floatDimension: a.floatDimension,
  M: a.M, efConstruction: a.efConstruction, efSearch: a.efSearch, maxElements: a.maxElements });
b.resetForBuild();
for (const k of ['maxLevel', 'useAsymmetric', 'centroid', 'signVector']) b[k] = a[k];
b.entryPoint = a.entryPoint >= 0 ? perm[a.entryPoint] : -1;
const inv = new Uint32Array(n); for (let v = 0; v < n; v++) inv[perm[v]] = v;
const slab = b._codes(); slab.ensure(n);
for (let i = 0; i < n; i++) {
  const v = inv[i];
  slab.set(i, a.nodeBinary(v)); b._ids.push(a.nodeId(v)); b._metas.push(a.nodeMetadata(v)); b.idToIndex.set(a.nodeId(v), i);
  const r = a.nodeInt8(v); if (r) b._putInt8(i, r);
}
b.graph = graph.map((level) => {
  const out = new Array(n).fill(null);
  for (let v = 0; v < level.length; v++) if (level[v]) out[perm[v]] = level[v].map((u) => perm[u]);
  return out;
});
await b.save(`${dst}/codebase-binary-hnsw.idx`);
// Full-vector map: node -> row, renumbered; same generation as the data file.
const mapSrc = fs.readFileSync(`${src}/codebase-binary-hnsw.fullvec.map`);
const rows = new Uint32Array(mapSrc.buffer.slice(mapSrc.byteOffset + 16, mapSrc.byteOffset + 16 + n * 4));
const out = Buffer.alloc(16 + n * 4); mapSrc.copy(out, 0, 0, 16);
for (let v = 0; v < n; v++) out.writeUInt32LE(rows[v], 16 + perm[v] * 4);
fs.writeFileSync(`${dst}/codebase-binary-hnsw.fullvec.map`, out);
console.log(JSON.stringify({ n, reached, entry: b.entryPoint }));
process.exit(0);
