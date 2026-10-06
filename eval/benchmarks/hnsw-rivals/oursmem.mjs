// Our resident index bytes (what the query path keeps in RAM) + a timed rebuild
// of the binary HNSW from the same vectors (single JS thread, production build).
// usage: node oursmem.mjs <name> [rebuild]
import fs from 'node:fs';
const R = '/Users/admin/Projects/sweet-search-private';
const name = process.argv[2];
const meta = JSON.parse(fs.readFileSync(`${name}/meta.json`)); const ss = `${meta.root}/.sweet-search`;
const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/index.js`);
const idx = new BinaryHNSWIndex({ indexPath: `${ss}/codebase-binary-hnsw.idx` }); await idx.load();
const n = idx.vectors.length; const nat = idx._nativeSearcher();
let csr = 0; for (let l = 0; l <= idx.maxLevel; l++) csr += nat.exportLevel(l).length * 4;
const b = { binary: n * 64, graph: csr, int8: n * 512, float512: n * 2048, full768Cache: n <= 16384 ? n * 3072 : 0 };
const total = Object.values(b).reduce((a, x) => a + x, 0);
const mb = (x) => +(x / 2 ** 20).toFixed(1);
const res = { name, n, index_mb: mb(total), parts_mb: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, mb(v)])) };
if (process.argv[3] === 'rebuild') {
  const { buildHnswIndex } = await import(`${R}/core/indexing/artifact-builder.js`);
  const X = new Float32Array(fs.readFileSync(`${name}/corpus768.bin`).buffer.slice(0));
  const items = meta.ids.map((id, i) => ({ id, embedding: X.subarray(i * 768, (i + 1) * 768), metadata: {} }));
  const t = performance.now(); await buildHnswIndex(items, { indexPath: '/nonexistent/x.idx' }); res.build_s = +((performance.now() - t) / 1000).toFixed(1);
} else if (meta.build_s) res.build_s = +meta.build_s.toFixed(1);
console.log(JSON.stringify(res)); fs.writeFileSync(`${name}/oursmem.json`, JSON.stringify(res)); process.exit(0);
