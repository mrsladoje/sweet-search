// Phase A4 (HANDOFF-v5 §4): build time and peak RSS of our production index build (buildHnswIndex: binary HNSW
// M64 / efC800, int8 store, full-vector file; one JS thread) from a set's corpus768.bin, then save().
// The input embeddings (one Float32Array(768) per item, as the indexer passes them) are part of the peak.
// usage: node --max-old-space-size=32000 buildtime.mjs <setDir> <outDir>     env: R (repo root)
import fs from 'node:fs';
import os from 'node:os';
const R = process.env.R || '/Users/admin/Projects/sweet-search-private';
const [set, out] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(`${set}/meta.json`));
const { buildHnswIndex } = await import(`${R}/core/indexing/artifact-builder.js`);
const n = meta.ids.length; const fd = fs.openSync(`${set}/corpus768.bin`, 'r');
const items = new Array(n);
for (let i = 0; i < n; i++) {
  const e = new Float32Array(768); fs.readSync(fd, Buffer.from(e.buffer), 0, 3072, i * 3072);
  items[i] = { id: meta.ids[i], embedding: e, metadata: {} };
}
fs.closeSync(fd); meta.ids = null;
const inputRss = process.memoryUsage().rss;
fs.mkdirSync(out, { recursive: true });
const indexPath = `${out}/codebase-binary-hnsw.idx`;
const t0 = performance.now();
const { index, stats } = await buildHnswIndex(items, { indexPath });
const t1 = performance.now();
await index.save(indexPath);
const t2 = performance.now();
const res = { set: set.split('/').pop(), n, host: os.hostname(), cpu: os.cpus()[0].model,
  build_s: +((t1 - t0) / 1000).toFixed(1), builder_ms: stats.buildTimeMs, save_s: +((t2 - t1) / 1000).toFixed(1),
  input_rss_mb: Math.round(inputRss / 2 ** 20), peak_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024) };
console.log(JSON.stringify(res));
fs.writeFileSync(`${set}/build.json`, JSON.stringify(res));
process.exit(0);
