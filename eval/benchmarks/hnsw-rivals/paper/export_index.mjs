// Exports our index's own stage data in vector-id order for the shared C++ (A) path (DESIGN.md 1, 5.2):
// export/{codes.u8 (n x 64), int8.i8 (n x W8), f16.u16 (n x 768), node.u32 (vid -> node), export.json}.
// Checks every row against the stored float32 corpus: the codes and int8 rows must equal the product
// encoders on that vector (floatToBinary / normalizedFloatToInt8 of truncateForHNSW), and the f16 row
// must equal the float32 value rounded to the nearest f16; any mismatch is counted and the export fails.
//
// usage: node export_index.mjs <DATA> <set> <model> [indexRoot [outDir]]   (defaults DATA/emb/<model>/<set>/{index,export})
//        node export_index.mjs --old <v4SetDir> <outDir>              (v4 layout: meta.json ids + corpus768.bin)
// env: R (repo root)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const R = process.env.R || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const { BinaryHNSWIndex } = await import(`${R}/core/vector-store/index.js`);
const { truncateForHNSW, floatToBinary, normalizedFloatToInt8 } = await import(`${R}/core/embedding/embedding-service.js`);
const { f32ToF16 } = await import(`${R}/core/vector-store/full-vector-file.js`);

const a = process.argv.slice(2);
let keys, corpusPath, root, out;
if (a[0] === '--old') {
  const meta = JSON.parse(fs.readFileSync(`${a[1]}/meta.json`));
  keys = meta.ids; corpusPath = `${a[1]}/corpus768.bin`; root = meta.root; out = a[2];
} else {
  const [DATA, set, model, idxRoot, outDir] = a;
  keys = fs.readFileSync(`${DATA}/sets/${set}/vectors.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).vid);
  const emb = `${DATA}/emb/${model}/${set}`;
  corpusPath = `${emb}/corpus.f32`; root = idxRoot || `${emb}/index`; out = outDir || `${emb}/export`;
}
fs.mkdirSync(out, { recursive: true });
const D = 768;
const idxPath = `${root}/.sweet-search/codebase-binary-hnsw.idx`;
const idx = new BinaryHNSWIndex({ indexPath: idxPath }); await idx.load();
const n = keys.length;
if (idx.size !== n) throw new Error(`index has ${idx.size} nodes, set has ${n} vectors`);

const codes = idx._codes(), cb = idx.dimension;        // bytes per code
const s8 = idx._int8NodeSlab(); const W8 = s8.dim;
const fv = `${idxPath.replace(/\.idx$/, '')}.fullvec`;
const data = fs.readFileSync(`${fv}.bin`), map = fs.readFileSync(`${fv}.map`);
if (data.subarray(0, 8).toString('latin1') !== 'SSFVEC2\0' || map.subarray(0, 8).toString('latin1') !== 'SSFVMAP1') throw new Error('vector file magic');
const fdim = data.readUInt32LE(8); if (fdim !== D) throw new Error(`vector file dim ${fdim}`);
if (map.readUInt32LE(8) !== data.readUInt32LE(12) || map.readUInt32LE(12) !== n) throw new Error('vector map generation or count differs');
const rows = new Uint32Array(map.buffer.slice(map.byteOffset + 16, map.byteOffset + 16 + 4 * n));
const f16 = new Uint16Array(data.buffer.slice(data.byteOffset + 64));

const corpus = fs.openSync(corpusPath, 'r');
const oc = Buffer.alloc(n * cb), o8 = Buffer.alloc(n * W8), of = Buffer.alloc(n * D * 2), on = new Uint32Array(n);
const row = new Float32Array(D);
let badCode = 0, badInt8 = 0, badF16 = 0, absent = 0;
for (let v = 0; v < n; v++) {
  const node = idx.idToIndex.get(keys[v]);
  if (node === undefined) throw new Error(`vector ${v} (${keys[v]}) not in the index`);
  on[v] = node;
  fs.readSync(corpus, Buffer.from(row.buffer), 0, D * 4, v * D * 4);
  const t = truncateForHNSW(row, idx.floatDimension), t8 = W8 === idx.floatDimension ? t : truncateForHNSW(row, W8);
  const c = codes.view(node); oc.set(c, v * cb);
  const ec = floatToBinary(t); for (let j = 0; j < cb; j++) if (ec[j] !== c[j]) { badCode++; break; }
  if (!s8.present[node]) absent++;
  const r8 = s8.slab.subarray(node * W8, (node + 1) * W8); o8.set(new Uint8Array(r8.buffer, r8.byteOffset, W8), v * W8);
  const e8 = normalizedFloatToInt8(t8); for (let j = 0; j < W8; j++) if (e8[j] !== r8[j]) { badInt8++; break; }
  const fr = rows[node]; if (fr === 0xffffffff) throw new Error(`node ${node} has no full vector`);
  const src = f16.subarray(fr * D, (fr + 1) * D); of.set(new Uint8Array(src.buffer, src.byteOffset, D * 2), v * D * 2);
  for (let j = 0; j < D; j++) if (f32ToF16(row[j]) !== src[j]) { badF16++; break; }
}
fs.closeSync(corpus);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const shaFile = p => { const h = crypto.createHash('sha256'); const fd = fs.openSync(p, 'r'); const buf = Buffer.alloc(1 << 22); let k; while ((k = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, k)); fs.closeSync(fd); return h.digest('hex'); };
const nb = Buffer.from(on.buffer);
for (const [f, b] of [['codes.u8', oc], ['int8.i8', o8], ['f16.u16', of], ['node.u32', nb]]) fs.writeFileSync(`${out}/${f}`, b);
const info = {
  n, code_bytes: cb, code_width: idx.floatDimension, int8_width: W8, dim: D, index: idxPath, index_sha256: shaFile(idxPath),
  vector_file_sha256: shaFile(`${fv}.bin`), vector_map_sha256: shaFile(`${fv}.map`), corpus_sha256: shaFile(corpusPath),
  sha256: { 'codes.u8': sha(oc), 'int8.i8': sha(o8), 'f16.u16': sha(of), 'node.u32': sha(nb) },
  checks: { code_rows_differ: badCode, int8_rows_differ: badInt8, f16_rows_differ: badF16, int8_rows_absent: absent },
};
fs.writeFileSync(`${out}/export.json`, JSON.stringify(info, null, 1));
console.log(`exported ${n} vectors to ${out}: codes ${cb} B, int8 ${W8}, checks ${JSON.stringify(info.checks)}`);
process.exit(badCode || badInt8 || badF16 || absent ? 1 : 0);
