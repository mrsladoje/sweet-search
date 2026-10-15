/**
 * Full-vector file beside the binary HNSW index, for the final rescore.
 *
 * The final rescore needs the full embedding (768-d) of each stage-2
 * candidate. This file holds those vectors as f16 in node order (the
 * embedding models' values are f16 numbers already; others are rounded to
 * the nearest f16, ties to even), so the native
 * reader (crates/sweet-search-native/src/full_vectors.rs) memory-maps it and
 * scores rows in place (sequential f64 sums), and the page cache holds the
 * vectors instead of the process heap. A SQLite read cost one B-tree lookup
 * and one ~4 KB row per id (about 70 us for 30 ids on the x86 box).
 *
 * Files (next to `<name>.idx`):
 *   <name>.fullvec.bin  64-byte header (`SSFVEC2\0`, dim u32, generation u32)
 *                       + rows of dim f16. Append-only: a row is never
 *                       rewritten, so a reader's mapping never changes.
 *   <name>.fullvec.map  `SSFVMAP1`, generation u32, node count u32, then one
 *                       u32 row per node (NO_ROW when the node has none).
 * The writer that maintains the index puts each node's vector as it adds the
 * node (build, incremental tick, compaction). A re-added node gets a new row;
 * the old row stays as garbage until the next full rebuild writes a new file.
 * save() publishes the map before it renames the index file. A reader uses the file only when the map's generation and node
 * count match the data file and the index it loaded. The final rescore reads
 * full vectors only from this file: an index without it (built before the
 * file existed) skips that stage until it is rebuilt.
 */
import fs from 'fs';
import { randomInt } from 'crypto';
import { nativeRescoreKernels, scratchArray, scratchFloat64Query } from '../infrastructure/native-rescore.js';

const DATA_MAGIC = Buffer.from('SSFVEC2\0', 'ascii');
const MAP_MAGIC = Buffer.from('SSFVMAP1', 'ascii');
const HEADER = 64;
const MAP_HEADER = 16;
// Bytes per stored value (f16).
const VALUE_BYTES = 2;
export const NO_ROW = 0xffffffff;
// Rows buffered before one write (x 1.5 KB at 768-d).
const FLUSH_ROWS = 512;

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

/** IEEE f16 bits of `x` (rounded to nearest, ties to even). */
export function f32ToF16(x) {
  f32Scratch[0] = x;
  const b = u32Scratch[0];
  const sign = (b >>> 16) & 0x8000;
  const e = (b >>> 23) & 0xff;
  const m = b & 0x7fffff;
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  const he = e - 127 + 15;
  if (he >= 0x1f) return sign | 0x7c00;
  if (he <= 0) {
    if (he < -10) return sign;
    const mm = m | 0x800000;
    const shift = 14 - he;
    let h = mm >>> shift;
    const rem = mm & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    if (rem > mid || (rem === mid && (h & 1))) h++;
    return sign | h;
  }
  let h = (he << 10) | (m >>> 13);
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++;
  return sign | h;
}

/** The f32 value of IEEE f16 bits `h` (exact). */
export function f16ToF32(h) {
  const sign = (h & 0x8000) << 16;
  const e = (h >>> 10) & 0x1f;
  let m = h & 0x3ff;
  let bits;
  if (e === 0) {
    if (m === 0) {
      bits = sign;
    } else {
      let ee = 113;
      while ((m & 0x400) === 0) { m <<= 1; ee--; }
      bits = sign | (ee << 23) | ((m & 0x3ff) << 13);
    }
  } else if (e === 0x1f) {
    bits = sign | 0x7f800000 | (m << 13);
  } else {
    bits = sign | ((e + 112) << 23) | (m << 13);
  }
  u32Scratch[0] = bits >>> 0;
  return f32Scratch[0];
}

export function fullVectorPaths(indexPath) {
  return {
    data: indexPath.replace('.idx', '.fullvec.bin'),
    map: indexPath.replace('.idx', '.fullvec.map'),
  };
}

/** Remove both files (an index saved without full vectors). */
export async function removeFullVectorFiles(indexPath) {
  const { data, map } = fullVectorPaths(indexPath);
  await fs.promises.rm(map, { force: true });
  await fs.promises.rm(data, { force: true });
}

function readMap(mapPath) {
  let buf;
  try {
    buf = fs.readFileSync(mapPath);
  } catch {
    return null;
  }
  if (buf.length < MAP_HEADER || !buf.subarray(0, 8).equals(MAP_MAGIC)) return null;
  const generation = buf.readUInt32LE(8);
  const count = buf.readUInt32LE(12);
  if (buf.length !== MAP_HEADER + count * 4) return null;
  const rows = new Uint32Array(count);
  Buffer.from(rows.buffer).set(buf.subarray(MAP_HEADER));
  return { generation, rows };
}

function readDataHeader(fd) {
  const h = Buffer.alloc(HEADER);
  if (fs.readSync(fd, h, 0, HEADER, 0) !== HEADER || !h.subarray(0, 8).equals(DATA_MAGIC)) return null;
  return { dim: h.readUInt32LE(8), generation: h.readUInt32LE(12) };
}

/**
 * Writer for one index. `fresh` writes a new data file (staged at a temp path,
 * renamed on publish); `resume` appends to the published one.
 */
export class FullVectorWriter {
  static fresh(indexPath) {
    const w = new FullVectorWriter(indexPath);
    w.generation = randomInt(1, 0xffffffff);
    w.fresh = true;
    return w;
  }

  /** Writer that appends to the published files; null when they are absent or inconsistent. */
  static resume(indexPath, nodeCount) {
    const paths = fullVectorPaths(indexPath);
    const map = readMap(paths.map);
    if (!map || map.rows.length !== nodeCount) return null;
    let fd;
    try {
      fd = fs.openSync(paths.data, 'r');
    } catch {
      return null;
    }
    try {
      const head = readDataHeader(fd);
      const size = fs.fstatSync(fd).size;
      if (!head || head.generation !== map.generation || (size - HEADER) % (head.dim * VALUE_BYTES) !== 0) return null;
      const w = new FullVectorWriter(indexPath);
      w.generation = head.generation;
      w.dim = head.dim;
      w.fileRows = (size - HEADER) / (head.dim * VALUE_BYTES);
      w.nodeRow = Array.from(map.rows);
      w.fresh = false;
      return w;
    } finally {
      fs.closeSync(fd);
    }
  }

  constructor(indexPath) {
    this.indexPath = indexPath;
    this.generation = 0;
    this.dim = 0;
    this.fileRows = 0;     // rows already written to the data file
    this.nodeRow = [];     // node -> row
    this.buf = null;       // Uint16Array (f16 bits) of FLUSH_ROWS rows not yet written
    this.bufRows = 0;
    this.fd = null;
    this.fresh = true;
    this.rowsWithVector = 0;
    this.broken = false;   // mixed widths or a lost data file: publish removes the files
  }

  // Fixed staging name, like the indexer's `*.idx.tmp`: a long build must not
  // match the daemon's `*.tmp.<pid>` orphan sweep, and the next fresh build
  // overwrites a crashed one.
  _tmpData() {
    return `${fullVectorPaths(this.indexPath).data}.build`;
  }

  _open() {
    if (this.fd !== null) return;
    if (this.fresh) {
      this.fd = fs.openSync(this._tmpData(), 'w');
      const h = Buffer.alloc(HEADER);
      DATA_MAGIC.copy(h, 0);
      h.writeUInt32LE(this.dim, 8);
      h.writeUInt32LE(this.generation, 12);
      fs.writeSync(this.fd, h, 0, HEADER, 0);
    } else {
      // Append only to the file this writer resumed: another writer may have
      // replaced it (compaction) since.
      const fd = fs.openSync(fullVectorPaths(this.indexPath).data, 'r+');
      const head = readDataHeader(fd);
      const size = fs.fstatSync(fd).size;
      if (!head || head.generation !== this.generation || size !== HEADER + this.fileRows * this.dim * VALUE_BYTES) {
        fs.closeSync(fd);
        this.broken = true;
        return;
      }
      this.fd = fd;
    }
  }

  _flush() {
    if (this.bufRows === 0 || this.broken) return;
    this._open();
    if (this.broken) return;
    const bytes = Buffer.from(this.buf.buffer, 0, this.bufRows * this.dim * VALUE_BYTES);
    const at = HEADER + this.fileRows * this.dim * VALUE_BYTES;
    let off = 0;
    while (off < bytes.length) off += fs.writeSync(this.fd, bytes, off, bytes.length - off, at + off);
    this.fileRows += this.bufRows;
    this.bufRows = 0;
  }

  /** Record node `node`'s full vector (null: the node has none). */
  put(node, vector) {
    if (this.broken) return;
    if (!vector || vector.length === 0) {
      this.nodeRow[node] = NO_ROW;
      return;
    }
    if (this.dim === 0) this.dim = vector.length;
    if (vector.length !== this.dim) {
      this.broken = true;
      return;
    }
    if (!this.buf) this.buf = new Uint16Array(FLUSH_ROWS * this.dim);
    const at = this.bufRows * this.dim;
    for (let i = 0; i < this.dim; i++) this.buf[at + i] = f32ToF16(vector[i]);
    this.nodeRow[node] = this.fileRows + this.bufRows;
    this.bufRows++;
    this.rowsWithVector++;
    if (this.bufRows === FLUSH_ROWS) this._flush();
  }

  /**
   * Write pending rows and the map for `nodeCount` nodes beside `indexPath`.
   * Call from save() after the graph sidecars are staged and before
   * .meta.json is renamed. False when the files were removed instead.
   */
  async publish(indexPath, nodeCount, pidSuffix) {
    // A fresh writer that has not touched disk yet writes beside the index
    // being saved. A resumed one appends only to the file it resumed.
    if (indexPath !== this.indexPath && !this.fresh) this.broken = true;
    if (indexPath !== this.indexPath && this.fresh && this.fd === null) this.indexPath = indexPath;
    const paths = fullVectorPaths(indexPath);
    this._flush();
    if (this.broken || (this.fresh && this.rowsWithVector === 0)) {
      this.close();
      await fs.promises.rm(this._tmpData(), { force: true });
      await removeFullVectorFiles(indexPath);
      return false;
    }
    if (this.fd !== null) fs.fsyncSync(this.fd);
    if (this.fresh) {
      this.close();
      await fs.promises.rename(this._tmpData(), paths.data);
      this.indexPath = indexPath;
      this.fresh = false;
    }
    const map = Buffer.alloc(MAP_HEADER + nodeCount * 4);
    MAP_MAGIC.copy(map, 0);
    map.writeUInt32LE(this.generation, 8);
    map.writeUInt32LE(nodeCount, 12);
    for (let i = 0; i < nodeCount; i++) {
      const r = this.nodeRow[i];
      map.writeUInt32LE(r === undefined ? NO_ROW : r, MAP_HEADER + i * 4);
    }
    await fs.promises.writeFile(paths.map + pidSuffix, map);
    await fs.promises.rename(paths.map + pidSuffix, paths.map);
    return true;
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

/**
 * Reader for one loaded index: null when the files are absent, inconsistent
 * with `nodeCount`, or the native reader is unavailable.
 */
export function openFullVectors(indexPath, nodeCount) {
  const kernels = nativeRescoreKernels();
  if (!kernels) return null;
  const paths = fullVectorPaths(indexPath);
  const map = readMap(paths.map);
  if (!map || map.rows.length !== nodeCount) return null;
  let file;
  try {
    file = new kernels.FullVectorFile(paths.data);
  } catch {
    return null;
  }
  if (file.generation !== map.generation) return null;
  return { file, path: paths.data, rows: map.rows, dim: file.dim, fileRows: file.rows, fd: null };
}

/**
 * Full-vector scores for candidate nodes: { scores, found } aligned with
 * `nodes`. A node without a row (no embedding) scores null and is not
 * counted in `found` (the number of distinct ids with a row). null when the
 * index has no file or the query has another width.
 */
export function fullDotScoresForNodes(reader, query, nodes, ids) {
  if (!reader || !query || query.length !== reader.dim) return null;
  const n = nodes.length;
  const rows = scratchArray('fullRows', Uint32Array, n);
  let m = 0;
  let missing = false;
  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    const row = node === undefined || node >= reader.rows.length ? NO_ROW : reader.rows[node];
    if (row === NO_ROW || row >= reader.fileRows) missing = true;
    else rows[m++] = row;
  }
  const out = scratchArray('fullScores', Float64Array, n);
  if (m > 0) reader.file.dotScores(scratchFloat64Query(query), rows.subarray(0, m), out);
  const scores = new Array(n);
  if (!missing) {
    for (let i = 0; i < n; i++) scores[i] = out[i];
    return { scores, found: new Set(ids.filter(Boolean)).size };
  }
  const found = new Set();
  for (let i = 0, j = 0; i < n; i++) {
    const node = nodes[i];
    const row = node === undefined || node >= reader.rows.length ? NO_ROW : reader.rows[node];
    if (row === NO_ROW || row >= reader.fileRows) {
      scores[i] = null;
    } else {
      scores[i] = out[j++];
      if (ids[i]) found.add(ids[i]);
    }
  }
  return { scores, found: found.size };
}

/**
 * A copy of node `node`'s full vector, or null. Compaction carries every
 * vector over this way: a plain file read, so the rows pass through the page
 * cache without becoming resident in the maintainer (its RSS is budgeted).
 */
export function readFullVector(reader, node) {
  if (!reader || node >= reader.rows.length) return null;
  const row = reader.rows[node];
  if (row === NO_ROW || row >= reader.fileRows) return null;
  if (reader.fd === null) reader.fd = fs.openSync(reader.path, 'r');
  const half = new Uint16Array(reader.dim);
  const bytes = Buffer.from(half.buffer);
  fs.readSync(reader.fd, bytes, 0, bytes.length, HEADER + row * reader.dim * VALUE_BYTES);
  const out = new Float32Array(reader.dim);
  for (let i = 0; i < reader.dim; i++) out[i] = f16ToF32(half[i]);
  return out;
}

/** Close the file a reader opened for readFullVector. */
export function closeFullVectors(reader) {
  if (reader?.fd != null) {
    fs.closeSync(reader.fd);
    reader.fd = null;
  }
}
