
/**
 * Binary HNSW Index (P0: 32x memory reduction, 10x faster search)
 *
 * Specialized HNSW index for binary vectors using Hamming distance.
 * Part of the 3-stage retrieval pipeline:
 *   Stage 1: Binary HNSW (1000 candidates, ~100μs)
 *   Stage 2: Int8 rescore (100 candidates, ~1ms)
 *   Stage 3: Rerank (top 20 → k)
 *
 * STORAGE: one index file (format 3, see "INDEX FILE" below) holds the sign
 *   codes, ids, metadata, int8 rows and graph; the full 768-d vectors are in
 *   the full-vector file beside it (full-vector-file.js). In memory: ids and
 *   metadata in two arrays, int8 rows in one node-ordered Int8Array, codes and
 *   graph in the native searcher (a JS copy is built only for writes).
 *
 * Reference: https://huggingface.co/blog/embedding-quantization
 *
 * Performance:
 *   - Memory: 32x smaller than float HNSW (512d → 64 bytes)
 *   - Search: ~10x faster (Hamming distance via SIMD-friendly popcount)
 *   - Throughput: ~10,000 queries/sec on 100k vectors
 */

import fs from 'fs/promises';
import { bootLog } from '../infrastructure/boot-log.js';
import {
  existsSync, statSync,
  openSync, readSync, closeSync, fstatSync,
} from 'fs';
import path from 'path';
import { BINARY_HNSW_CONFIG, DB_PATHS } from '../infrastructure/config/index.js';
import {
  floatToBinary, normalizedFloatToInt8, truncateForHNSW,
  asymmetricDocEncode, asymmetricQueryEncode,
  computeCentroid, generateSignVector,
} from '../infrastructure/quantization.js';
import { HammingSlab } from '../infrastructure/hamming-kernel.js';
import { TypedMinHeap, TypedMaxHeap, VisitedList } from './binary-heap.js';
import { loadBitmap, isSet, popcountRange } from '../infrastructure/tombstone-bitmap-reader.js';
import { loadNativeAddon } from '../infrastructure/native-resolver.js';
import { INDEX_MAGIC, alignUp, readHeaderFd, binaryHnswIndexExists } from './index-file-header.js';
import { nativeRescoreKernels, scratchArray, scratchFloat64Query } from '../infrastructure/native-rescore.js';
import {
  FullVectorWriter,
  closeFullVectors,
  fullDotScoresForNodes,
  openFullVectors,
  readFullVector,
  removeFullVectorFiles,
} from './full-vector-file.js';

// Native query path (crates/sweet-search-native/src/hnsw_search.rs): an exact
// port of greedySearchQuery/searchLayerQuery over a CSR snapshot of the graph.
// Same visit order and heap tie rules, so results are identical to the JS
// path. SS_FIX_HNSW_NATIVE=0 restores the JS loop. Probed once per process.
let _NativeHnswSearcher;
function nativeHnswSearcherCtor() {
  if (_NativeHnswSearcher !== undefined) return _NativeHnswSearcher;
  _NativeHnswSearcher = null;
  if (process.env.SS_FIX_HNSW_NATIVE === '0') return null;
  const res = loadNativeAddon({ validate: (m) => typeof m.HnswSearcher === 'function' });
  if (res) _NativeHnswSearcher = res.mod.HnswSearcher;
  return _NativeHnswSearcher;
}

// At or below this many vectors, search() scans every binary vector exactly
// instead of walking the graph (SS_FIX_HNSW_SCAN=0 keeps the walk). The scan
// reads only the resident binary slab, so it adds no memory. A fixed cap (not
// a per-machine timing) keeps rankings the same on every machine: the scan is
// faster than the walk up to 140k vectors on an M3 Max and ties it at 140k on
// an x86 EPYC (AVX2), so the cap sits just above that.
const EXACT_SCAN_MAX_VECTORS = 150000;
// SS_FIX_HNSW_ADAPTIVE=0 (bench only): no early termination thresholds in the native walk.
const NO_EARLY_STOP = [];

// The native walk uses bucket queues by default (O(1) per queue operation;
// equal Hamming distances may come out in another order than the JS heaps).
// SS_FIX_HNSW_BUCKET=0 selects the JS-exact heaps (the native-vs-JS parity
// tests use it).
function configureNativeSearcher(searcher) {
  if (process.env.SS_FIX_HNSW_BUCKET === '0') searcher.setBucketQueue(false);
}

// Flattened early-termination thresholds for the native walk, rebuilt only
// when the config array changes.
const nativeThresholds = { list: null, flat: null };

// Shared empty neighbor list for graph misses in the hot search loops —
// callers only iterate it, so one frozen instance replaces a fresh `[]`
// allocation per miss.
const EMPTY_NEIGHBORS = Object.freeze([]);

// Current quantization pipeline version. Bump when the encoding pipeline changes
// (centroid subtraction, rotation, quantization scheme). Indexes built with a
// different version are incompatible and must be rebuilt.
const PIPELINE_VERSION = 2;

// =============================================================================
// INDEX FILE (format 3)
// =============================================================================
//
// One file per index (`codebase-binary-hnsw.idx`), written to `<path>.tmp.<pid>`
// and published by one atomic rename, so a reader sees a whole old or a whole
// new index. No other format is read: an index in an older format fails to
// load and is rebuilt.
//
// Layout (integers little-endian):
//   magic 'SSHNSW3\0' (8) | header length u32 | header JSON (utf-8)
//   zero padding to a 64-byte boundary = the data start; then the sections,
//   each at a 64-byte aligned offset from the data start:
//     codes        count x dimension bytes: the sign codes, node order
//     ids          JSON arrays of RECORD_CHUNK ids each, back to back
//     metas        the same for the per-node metadata objects
//     int8         count x int8Dim bytes, node order (zero rows where absent)
//     int8Present  count bytes: 1 = node has an int8 row
//     per level    present (length bytes: 1 = the node has a list there),
//                  offsets ((count + 1) x u32, CSR over all nodes),
//                  neighbors (links x u32)
// The header holds the index fields, the asymmetric calibration, and every
// section's { off, len } relative to the data start (record sections also
// list their chunk offsets).
export { readIndexHeader, binaryHnswIndexExists } from './index-file-header.js';

const RECORD_CHUNK = 4096;
// readSync/write move at most 2 GB per call.
const IO_BLOCK = 1 << 30;

/** Fill `bytes` from the file at `pos`; throws on a short read. */
function readFully(fd, bytes, pos) {
  for (let done = 0; done < bytes.length;) {
    const want = Math.min(IO_BLOCK, bytes.length - done);
    const got = readSync(fd, bytes, done, want, pos + done);
    if (got <= 0) throw new Error('BinaryHNSW: index file is truncated');
    done += got;
  }
}

/** A section as a new typed array of type `Ctor`. */
function readSection(fd, dataStart, sec, Ctor) {
  const out = new Ctor(sec.len / Ctor.BYTES_PER_ELEMENT);
  readFully(fd, new Uint8Array(out.buffer, out.byteOffset, sec.len), dataStart + sec.off);
  return out;
}

/**
 * A section as a typed array over a private memory mapping of the file (the
 * int8 rows: file-backed pages instead of a heap copy; a write copies only the
 * page it touches). null when the addon lacks the call; the caller then reads.
 */
function mappedSection(path, dataStart, sec, Ctor) {
  const fn = nativeRescoreKernels()?.mapFileSection;
  if (typeof fn !== 'function') return null;
  const buf = fn(path, dataStart + sec.off, sec.len);
  return new Ctor(buf.buffer, buf.byteOffset, sec.len / Ctor.BYTES_PER_ELEMENT);
}

/** A record section (ids or metas) as one array. */
function readRecords(fd, dataStart, sec, count) {
  const bytes = Buffer.allocUnsafe(sec.len);
  readFully(fd, bytes, dataStart + sec.off);
  const out = new Array(count);
  let i = 0;
  const ends = sec.chunks;
  for (let c = 0; c < ends.length; c++) {
    const records = JSON.parse(bytes.toString('utf-8', c === 0 ? 0 : ends[c - 1], ends[c]));
    for (let j = 0; j < records.length; j++) out[i++] = records[j];
  }
  if (i !== count) throw new Error(`BinaryHNSW: index file holds ${i} records, header says ${count}`);
  return out;
}

/** UTF-8 JSON chunks of `values` and their end offsets. */
function recordChunks(values) {
  const parts = [];
  const chunks = [];
  let len = 0;
  for (let i = 0; i < values.length; i += RECORD_CHUNK) {
    const part = Buffer.from(JSON.stringify(values.slice(i, i + RECORD_CHUNK)), 'utf-8');
    parts.push(part);
    len += part.length;
    chunks.push(len);
  }
  return { parts, chunks };
}

/**
 * Write an index file: `header` plus `sections` (name -> list of byte
 * views; a name with `chunks` keeps them). Fills header.sections and returns
 * once the file is closed.
 */
async function writeIndexFile(filePath, header, sections) {
  const placed = {};
  let off = 0;
  for (const [name, s] of sections) {
    off = alignUp(off);
    const len = s.parts.reduce((a, p) => a + p.byteLength, 0);
    placed[name] = s.chunks ? { off, len, chunks: s.chunks } : { off, len };
    off += len;
  }
  header.sections = placed;
  const headerBuf = Buffer.from(JSON.stringify(header), 'utf-8');
  const prefix = Buffer.alloc(INDEX_MAGIC.length + 4);
  INDEX_MAGIC.copy(prefix, 0);
  prefix.writeUInt32LE(headerBuf.length, INDEX_MAGIC.length);
  const dataStart = alignUp(prefix.length + headerBuf.length);
  const fh = await fs.open(filePath, 'w');
  try {
    let pos = 0;
    const put = async (bytes) => {
      for (let done = 0; done < bytes.byteLength;) {
        const n = Math.min(IO_BLOCK, bytes.byteLength - done);
        const { bytesWritten } = await fh.write(bytes, done, n, pos);
        done += bytesWritten;
        pos += bytesWritten;
      }
    };
    const padTo = async (target) => { if (target > pos) await put(Buffer.alloc(target - pos)); };
    await put(prefix);
    await put(headerBuf);
    for (const [name, s] of sections) {
      await padTo(dataStart + placed[name].off);
      for (const p of s.parts) await put(new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
    }
  } finally {
    await fh.close();
  }
}

/**
 * Tooling (soak probes): node ids of an index file and the ids that have an
 * int8 row, or null when there is no format-3 file at `indexPath`.
 * @returns {{ ids: string[], int8Ids: string[] } | null}
 */
export function readIndexIdsSync(indexPath) {
  let fd;
  try { fd = openSync(indexPath, 'r'); } catch { return null; }
  try {
    const parsed = readHeaderFd(fd);
    if (!parsed) return null;
    const { header, dataStart } = parsed;
    const ids = readRecords(fd, dataStart, header.sections.ids, header.count);
    const int8Ids = [];
    if (header.int8Dim > 0) {
      const present = readSection(fd, dataStart, header.sections.int8Present, Uint8Array);
      for (let i = 0; i < ids.length; i++) if (present[i]) int8Ids.push(ids[i]);
    }
    return { ids, int8Ids };
  } finally {
    closeSync(fd);
  }
}

/**
 * Tooling (determinism dumps): the whole index file as plain arrays, or null
 * when there is no format-3 file at `indexPath`. `graph[l][i]` is node i's
 * list on level l (null when absent), as the JS graph holds it.
 */
export function readIndexFileSync(indexPath) {
  let fd;
  try { fd = openSync(indexPath, 'r'); } catch { return null; }
  try {
    const parsed = readHeaderFd(fd);
    if (!parsed) return null;
    const { header, dataStart } = parsed;
    const sec = header.sections;
    const n = header.count;
    const ids = readRecords(fd, dataStart, sec.ids, n);
    const metas = readRecords(fd, dataStart, sec.metas, n);
    const codes = readSection(fd, dataStart, sec.codes, Uint8Array);
    const int8 = header.int8Dim > 0
      ? new Int8Rows(header.int8Dim, readSection(fd, dataStart, sec.int8, Int8Array),
        readSection(fd, dataStart, sec.int8Present, Uint8Array))
      : null;
    const graph = header.levels.map((lv, l) => {
      const present = readSection(fd, dataStart, sec[`l${l}.present`], Uint8Array);
      const offsets = readSection(fd, dataStart, sec[`l${l}.offsets`], Uint32Array);
      const neighbors = readSection(fd, dataStart, sec[`l${l}.neighbors`], Uint32Array);
      const level = new Array(lv.len).fill(null);
      for (let i = 0; i < lv.len; i++) if (present[i]) level[i] = Array.from(neighbors.subarray(offsets[i], offsets[i + 1]));
      return level;
    });
    const nodes = ids.map((id, i) => ({
      id,
      binary: Array.from(codes.subarray(i * header.dimension, (i + 1) * header.dimension)),
      metadata: metas[i],
      int8: int8?.has(i) ? Array.from(int8.get(i)) : null,
    }));
    return { header, nodes, graph };
  } finally {
    closeSync(fd);
  }
}

/**
 * Node-ordered int8 rows (one Int8Array) with a presence flag per node. The
 * width is set by the first row; a row of another width is an error.
 */
class Int8Rows {
  constructor(dim, rows = null, present = null) {
    this.dim = dim;
    this.rows = rows || new Int8Array(0);
    this.present = present || new Uint8Array(0);
  }

  get capacity() { return this.present.length; }

  put(node, vec) {
    if (vec.length !== this.dim) {
      throw new Error(`BinaryHNSW: int8 row of width ${vec.length}, index uses ${this.dim}`);
    }
    if (node >= this.capacity) {
      let cap = Math.max(1024, this.capacity * 2);
      while (cap <= node) cap *= 2;
      const rows = new Int8Array(cap * this.dim);
      rows.set(this.rows);
      const present = new Uint8Array(cap);
      present.set(this.present);
      this.rows = rows;
      this.present = present;
    }
    this.rows.set(vec, node * this.dim);
    this.present[node] = 1;
  }

  has(node) { return node < this.capacity && this.present[node] === 1; }

  /** A view of node's row (shares the bytes), or undefined. */
  get(node) {
    return this.has(node) ? this.rows.subarray(node * this.dim, (node + 1) * this.dim) : undefined;
  }

  drop(node) { if (node < this.capacity) this.present[node] = 0; }

  /** Rows present among the first n nodes. */
  count(n) {
    let c = 0;
    const m = Math.min(n, this.capacity);
    for (let i = 0; i < m; i++) c += this.present[i];
    return c;
  }
}

// =============================================================================
// BINARY HNSW INDEX CLASS
// =============================================================================

export class BinaryHNSWIndex {
  constructor(options = {}) {
    // Binary dimension (bytes, not bits)
    this.dimension = options.dimension || BINARY_HNSW_CONFIG.dimension;
    this.floatDimension = options.floatDimension || BINARY_HNSW_CONFIG.floatDimension;

    // HNSW parameters (more aggressive since Hamming is cheap)
    this.M = options.M || BINARY_HNSW_CONFIG.M;
    this.efConstruction = options.efConstruction || BINARY_HNSW_CONFIG.efConstruction;
    this.efSearch = options.efSearch || BINARY_HNSW_CONFIG.efSearch;
    this.maxElements = options.maxElements || BINARY_HNSW_CONFIG.maxElements;

    this.indexPath = options.indexPath || DB_PATHS.binaryHnswIndex;
    this.stalePath = options.stalePath || `${this.indexPath}.stale.bin`;

    // Nodes: node i has id _ids[i] and metadata _metas[i]; its sign code is
    // row i of the code slab, its int8 row is row i of _int8.
    this._ids = [];
    this._metas = [];
    this.idToIndex = new Map();  // id → node
    // Sign codes for the JS paths (build, insert, the no-addon walk): a
    // HammingSlab (JS bytes + WASM mirror). A loaded index with the native
    // searcher leaves it unbuilt; _codes() reads it from the index file on
    // the first write.
    this._slab = new HammingSlab(this.dimension);
    this._queryBinary = null;    // staged query for the fallback distance path
    this.initialized = false;

    // int8 rows for stage-2 rescoring (Int8Rows, node order), or null.
    this._int8 = null;

    // Graph structure (simplified HNSW for pure JS)
    this._graphGen = 0;
    this._native = null;
    this._graphFrozen = null;    // shape of a graph released to the native snapshot or left on disk
    this.graph = [];             // Array of neighbor lists per level
    this.entryPoint = -1;
    this.maxLevel = 0;

    // Pre-allocated visited list (generation-stamped, reused across searches)
    this._visitedList = new VisitedList(this.maxElements);
    // Pooled search heaps — searchLayer/searchLayerQuery are synchronous and
    // never re-entered, so one pair (auto-growing) serves all calls. Same
    // single-flight contract as _visitedList.
    this._candHeap = new TypedMinHeap(64);
    this._resHeap = new TypedMaxHeap(64);

    // Asymmetric binary quantization calibration data
    this.centroid = null;       // Float32Array — dataset centroid
    this.signVector = null;     // Float32Array — random ±1 for WHT rotation
    this.useAsymmetric = false; // Enabled after calibration
    this._staleBitmapCache = null;
    this._cleanBuild = false;
    // Full-vector file (full-vector-file.js): the writer is chosen at the
    // first add (fresh for an empty index, else resume the published file);
    // the reader is opened by load() and save().
    this._fullWriter = undefined;
    this._fullReader = null;
    this._fullDirty = false;

    // The loaded index file, kept open while parts of it are not in memory
    // (the code slab, or a graph the exact scan never reads): { fd, dataStart,
    // codes, levels }. The fd keeps the loaded version readable after a newer
    // save renames over the path.
    this._file = null;
  }

  /** Number of nodes (stale ones included). */
  get size() {
    return this._ids.length;
  }

  /** Id of node i. */
  nodeId(i) {
    return this._ids[i];
  }

  /** Metadata object of node i. */
  nodeMetadata(i) {
    return this._metas[i];
  }

  /** Sign code of node i (a view into the code slab). */
  nodeBinary(i) {
    return this._codes().view(i);
  }

  /**
   * The code slab for the JS paths, read from the index file when the load
   * left it out.
   */
  _codes() {
    if (this._slab) return this._slab;
    const slab = new HammingSlab(this.dimension);
    const n = this._ids.length;
    if (n > 0) {
      const f = this._file;
      slab.fill(readSection(f.fd, f.dataStart, f.codes, Uint8Array), n);
    }
    this._slab = slab;
    this._releaseFile();
    return slab;
  }

  /**
   * Neighbor lists per level. After a native snapshot is built the JS arrays
   * are released (the snapshot holds the same lists); any reader rebuilds
   * them exactly from the snapshot, or from the index file when the load
   * left the graph there, on first access. Assignment bumps _graphGen so the
   * snapshot is rebuilt.
   */
  get graph() {
    if (this._graphFrozen) this._thawGraph();
    return this._graphStore;
  }

  set graph(value) {
    this._graphStore = value;
    this._graphFrozen = null;
    this._graphGen++;
    this._releaseFile();
  }

  /** Release the JS graph arrays; the native snapshot is the only copy. */
  _freezeGraph() {
    const levels = this._graphStore;
    this._graphFrozen = {
      lengths: levels.map((level) => level.length),
      present: levels.map((level) => {
        const flags = new Uint8Array(level.length);
        for (let i = 0; i < level.length; i++) flags[i] = level[i] ? 1 : 0;
        return flags;
      }),
      links: null,
      onDisk: false,
    };
    this._graphStore = null;
  }

  /**
   * Level l of the frozen graph as CSR over the nodes it was frozen with:
   * { offsets (n + 1), neighbors }, from the native snapshot or the file.
   */
  _frozenLevelCsr(l) {
    if (!this._graphFrozen.onDisk) {
      // The snapshot's node count (an insert may already have appended a node).
      const n = this._native.n;
      const flat = this._native.searcher.exportLevel(l);
      return { offsets: flat.subarray(0, n + 1), neighbors: flat.subarray(n + 1) };
    }
    const f = this._file;
    const lv = f.levels[l];
    return {
      offsets: readSection(f.fd, f.dataStart, lv.offsets, Uint32Array),
      neighbors: readSection(f.fd, f.dataStart, lv.neighbors, Uint32Array),
    };
  }

  /** Rebuild the JS graph arrays from the native snapshot or the file (exact lists). */
  _thawGraph() {
    const { lengths, present } = this._graphFrozen;
    const levels = lengths.map((len, l) => {
      const { offsets, neighbors } = this._frozenLevelCsr(l);
      const level = new Array(len).fill(null);
      for (let i = 0; i < len; i++) {
        if (!present[l][i]) continue;
        const from = offsets[i], to = offsets[i + 1];
        const list = new Array(to - from);
        for (let j = from; j < to; j++) list[j - from] = neighbors[j];
        level[i] = list;
      }
      return level;
    });
    const onDisk = this._graphFrozen.onDisk;
    this._graphStore = levels;
    this._graphFrozen = null;
    if (onDisk) this._releaseFile();
  }

  /** Close the index file once nothing is read from it any more. */
  _releaseFile() {
    const f = this._file;
    if (!f || !this._slab || this._graphFrozen?.onDisk) return;
    try { closeSync(f.fd); } catch { /* best-effort */ }
    this._file = null;
  }

  _closeFile() {
    const f = this._file;
    this._file = null;
    if (f) {
      try { closeSync(f.fd); } catch { /* best-effort */ }
    }
  }

  /** Reset to empty state for a fresh build (skips loading from disk). */
  resetForBuild() {
    this._closeFile();
    this._ids = [];
    this._metas = [];
    this._slab = new HammingSlab(this.dimension);
    this.idToIndex = new Map();
    this._int8 = null;
    this.graph = [];
    this.entryPoint = -1;
    this.maxLevel = 0;
    this.centroid = null;
    this.signVector = null;
    this.useAsymmetric = false;
    this.initialized = true;
    this._staleBitmapCache = null;
    this._cleanBuild = true;
    this._fullWriter?.close();
    this._fullWriter = undefined;
    closeFullVectors(this._fullReader);
    this._fullReader = null;
    this._fullDirty = false;
  }

  _stalePathForIndex(indexPath = this.indexPath) {
    return indexPath === this.indexPath ? this.stalePath : `${indexPath}.stale.bin`;
  }

  /**
   * Initialize the index
   */
  async init() {
    if (this.initialized) return;

    // Load the index file when there is one (format 3; anything else is
    // rebuilt).
    if (existsSync(this.indexPath)) {
      try {
        await this.load();
        this.initialized = true;
        return;
      } catch (err) {
        console.log(`BinaryHNSW: Failed to load, creating new index: ${err.message}`);
      }
    }

    this._closeFile();
    this._ids = [];
    this._metas = [];
    this._slab = new HammingSlab(this.dimension);
    this.idToIndex = new Map();
    this._int8 = null;
    this.graph = [];
    this.entryPoint = -1;
    this.maxLevel = 0;
    this.initialized = true;

    console.log(`BinaryHNSW: Initialized (${this.dimension} bytes, M=${this.M})`);
  }

  /**
   * Calculate random level for new node (exponential distribution).
   *
   * Draws from the global, unseeded Math.random() at insert time, so the
   * level a node receives depends on insertion order / RNG-stream
   * interleaving (per-file reload-and-insert vs. batched load-once-insert-all
   * vs. compaction rebuild all consume the stream differently). This is the
   * default path and is intentionally left unchanged. For an
   * insertion-order-independent level, see `levelForId(id)` (gated on
   * SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS).
   */
  getRandomLevel() {
    const mL = 1 / Math.log(this.M);
    let level = Math.floor(-Math.log(Math.random()) * mL);
    return Math.min(level, 10); // Cap at 10 levels
  }

  /**
   * Deterministic level for a node id (insertion-order-independent).
   *
   * Pure function of the string id (FNV-1a 32-bit hash → uniform u∈(0,1])
   * fed through the SAME exponential CDF as `getRandomLevel()`
   * (`floor(-ln(u) * (1/ln(M)))`, capped at 10). Because the level depends
   * only on the id (not on Math.random() or insertion order), batched,
   * per-file, and compaction construction paths all assign the same node the
   * same level — the prerequisite for a byte-identical graph.
   *
   * Used only when SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS === '1'; the default
   * path (`getRandomLevel`) is unchanged.
   *
   * @param {string} id - node id (coerced to string)
   * @returns {number} level in [0, 10]
   */
  levelForId(id) {
    // FNV-1a 32-bit over the id's UTF-16 code units. Stable across calls and
    // across a fresh process (no global state, no RNG).
    const s = String(id);
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      // FNV prime multiply via shifts, kept in unsigned 32-bit space.
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    // Map hash → u ∈ (0,1]. Use (h+1)/2^32 so u is never 0 (avoids -ln(0)=∞)
    // and never exceeds 1; h ranges over [0, 2^32-1] so (h+1) ∈ [1, 2^32].
    const u = (h + 1) / 4294967296; // 2^32
    const mL = 1 / Math.log(this.M);
    const level = Math.floor(-Math.log(u) * mL);
    return Math.min(level, 10); // Cap at 10 levels (same as getRandomLevel)
  }

  /**
   * Add a vector to the index
   *
   * @param {string} id - Unique identifier
   * @param {Uint8Array|number[]} binaryVector - Binary vector (or float to convert)
   * @param {object} metadata - Optional metadata
   * @param {Int8Array} int8Vector - Optional int8 vector for rescoring
   */
  async add(id, binaryVector, metadata = {}, int8Vector = null, fullVector = null) {
    if (!this.initialized) await this.init();
    return this.addSync(id, binaryVector, metadata, int8Vector, fullVector);
  }

  /**
   * Synchronous insert for callers that know the index is initialized
   * (build loops, addBatch). Identical semantics to add() minus the init
   * probe — avoids per-insert promise machinery on hot construction paths.
   */
  addSync(id, binaryVector, metadata = {}, int8Vector = null, fullVector = null) {
    // Convert float to binary if needed
    let binary;
    if (binaryVector instanceof Uint8Array) {
      binary = binaryVector;
    } else if (Array.isArray(binaryVector) && binaryVector.length > this.dimension) {
      // Assume it's a float vector, convert to binary
      binary = floatToBinary(binaryVector.slice(0, this.floatDimension));
    } else {
      binary = new Uint8Array(binaryVector);
    }

    const slab = this._codes();
    this._graphGen++;
    if (this._fullWriter === undefined) {
      // An index loaded without the file (built before it existed) has no
      // writer: it gets the file at its next full rebuild.
      this._fullWriter = this._ids.length === 0 ? FullVectorWriter.fresh(this.indexPath)
        : FullVectorWriter.resume(this.indexPath, this._ids.length);
    }
    this._fullDirty = true;

    // Check if already exists
    if (this.idToIndex.has(id)) {
      const idx = this.idToIndex.get(id);
      slab.set(idx, binary);
      this._metas[idx] = metadata;
      if (int8Vector) this._putInt8(idx, int8Vector);
      this._fullWriter?.put(idx, fullVector);
      return idx;
    }

    // Add new vector.
    const idx = this._ids.length;
    slab.set(idx, binary);
    this._ids.push(id);
    this._metas.push(metadata);
    this.idToIndex.set(id, idx);
    this._fullWriter?.put(idx, fullVector);

    if (int8Vector) this._putInt8(idx, int8Vector);

    // Add to HNSW graph.
    // Gate: deterministic per-id levels are DEFAULT-ON (disable with
    // SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS=0). When on, assign the level from a
    // stable hash of the id (insertion-order-independent) so all construction
    // paths (incremental add, end-of-tick batch, compaction rebuild) agree and
    // the graph is reproducible. Verified recall-neutral on GCSN (+0.01pp MRR)
    // and byte-identical via the determinism harness. Set the flag to '0' to
    // restore the legacy random-level (insertion-order-dependent) path.
    const level = process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS !== '0'
      ? this.levelForId(id)
      : this.getRandomLevel();
    this.addToGraph(idx, level);

    return idx;
  }

  /**
   * Level-aware max degree: M0=2*M on layer 0, M on higher layers.
   */
  getMaxM(level) {
    return level === 0 ? this.M * 2 : this.M;
  }

  /** Store node's int8 row (the first row sets the width). */
  _putInt8(node, vec) {
    if (!this._int8) this._int8 = new Int8Rows(vec.length);
    this._int8.put(node, vec);
  }

  /**
   * Hamming distance between two RESIDENT vectors (construction paths).
   * Slab-backed on the default path (single FFI call, zero copies); falls
   * back to the copy-per-call kernel on the mmap-proxy read path.
   */
  _distPair(aIdx, bIdx) {
    return this._codes().dist(aIdx, bIdx);
  }

  /** Stage the query for _distQ(). */
  _setQuery(queryBinary) {
    this._queryBinary = queryBinary;
    this._codes().setQuery(queryBinary);
  }

  /** Hamming distance from the staged query to a resident vector. */
  _distQ(idx) {
    return this._codes().distToQuery(idx);
  }

  /**
   * Heuristic neighbor selection (Algorithm 4, Malkov & Yashunin 2016).
   * Selects diverse neighbors that cover different angular directions,
   * avoiding clusters of nearby nodes pointing at each other.
   */
  selectNeighborsHeuristic(nodeIdx, candidates, maxM, presorted = false) {
    const selected = [];

    // Sort candidates by distance ascending. searchLayer() already returns
    // ascending order (heap drain), so its callers pass presorted=true and
    // skip the redundant O(ef log ef) stable sort — a stable sort of an
    // already-sorted array is the identity, so selection is unchanged.
    if (!presorted) candidates.sort((a, b) => a.dist - b.dist);

    for (const candidate of candidates) {
      if (selected.length >= maxM) break;

      // Check if this candidate is closer to any already-selected neighbor
      // than it is to the node itself — if so, it's redundant (same direction)
      let tooClose = false;
      for (const s of selected) {
        const interDist = this._distPair(candidate.idx, s.idx);
        if (interDist < candidate.dist) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        selected.push(candidate);
      }
    }

    // Backfill with closest if heuristic was too aggressive
    if (selected.length < maxM) {
      const selectedSet = new Set(selected.map(s => s.idx));
      for (const candidate of candidates) {
        if (selected.length >= maxM) break;
        if (!selectedSet.has(candidate.idx)) {
          selected.push(candidate);
          selectedSet.add(candidate.idx);
        }
      }
    }

    return selected;
  }

  /**
   * Whether insertion-order-independent entry-point selection is active.
   *
   * Mirrors the gate on level assignment in `add()`. When ON, the entry
   * point is chosen deterministically (min id at the max level) so batched,
   * per-file, and compaction construction paths agree on `entryPoint` even
   * when several nodes share the max level — the last byte-identity gap left
   * by deterministic levels (E.1 entry-point divergence). DEFAULT-ON (disable
   * with SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS=0) → mirrors the level-assignment
   * gate in `add()`. Set the flag to '0' to restore today's
   * first-inserted-at-max-level behavior.
   */
  _deterministicEntryPoint() {
    return process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS !== '0';
  }

  /**
   * Tie-break two graph node indices by their string id (deterministic,
   * insertion-order-independent). Returns the index whose id sorts first
   * lexicographically. Lexicographic comparison of the stable string id is
   * used (not the FNV-1a hash) so the choice is human-auditable and never
   * subject to hash collisions.
   */
  _entryPointWinner(idxA, idxB) {
    if (idxA === -1) return idxB;
    if (idxB === -1) return idxA;
    const idA = String(this._ids[idxA]);
    const idB = String(this._ids[idxB]);
    return idA <= idB ? idxA : idxB;
  }

  /**
   * Add node to HNSW graph.
   * Uses heuristic selection + level-aware M0=2*M.
   */
  addToGraph(idx, level) {
    this._graphGen++;
    // Ensure graph has enough levels
    while (this.graph.length <= level) {
      this.graph.push([]);
    }

    // Initialize neighbor lists for new node
    for (let l = 0; l <= level; l++) {
      if (!this.graph[l][idx]) {
        this.graph[l][idx] = [];
      }
    }

    // If first node, set as entry point
    if (this.entryPoint === -1) {
      this.entryPoint = idx;
      this.maxLevel = level;
      return;
    }

    // Find neighbors at each level and connect
    let currentNode = this.entryPoint;

    // Traverse from top to target level
    for (let l = this.maxLevel; l > level; l--) {
      currentNode = this.greedySearch(currentNode, idx, l);
    }

    // At each level from level down to 0, find neighbors and connect
    for (let l = level; l >= 0; l--) {
      const maxM = this.getMaxM(l);
      const neighbors = this.searchLayer(currentNode, idx, this.efConstruction, l);

      // Heuristic selection (Algorithm 4) for angular diversity
      const selectedNeighbors = this.selectNeighborsHeuristic(idx, neighbors, maxM, true);

      // Connect both directions
      this.graph[l][idx] = selectedNeighbors.map(n => n.idx);

      for (const neighbor of selectedNeighbors) {
        if (!this.graph[l][neighbor.idx]) {
          this.graph[l][neighbor.idx] = [];
        }
        if (!this.graph[l][neighbor.idx].includes(idx)) {
          this.graph[l][neighbor.idx].push(idx);

          // Prune if too many neighbors (threshold = 2 * maxM for the level)
          if (this.graph[l][neighbor.idx].length > maxM * 2) {
            this.pruneNeighbors(neighbor.idx, l);
          }
        }
      }

      if (selectedNeighbors.length > 0) {
        currentNode = selectedNeighbors[0].idx;
      }
    }

    // Update entry point.
    //
    // Default path (flag OFF): unchanged — the entry point only moves when a
    // strictly higher level appears, so the first node inserted at the running
    // max level keeps it (insertion-order-dependent, today's behavior).
    //
    // Deterministic path (flag ON): a strictly higher level still wins, but on
    // a TIE at the current max level the entry point is refined to the node
    // with the smallest id. Because `maxLevel` only ever rises during a build
    // (no deletions here) and equals the max id-assigned level, this converges
    // to `min(id)` over all nodes at the final max level regardless of
    // insertion order — closing the E.1 entry-point byte-identity gap.
    if (level > this.maxLevel) {
      this.entryPoint = idx;
      this.maxLevel = level;
    } else if (level === this.maxLevel && this._deterministicEntryPoint()) {
      this.entryPoint = this._entryPointWinner(this.entryPoint, idx);
    }
  }

  /**
   * Greedy search to find closest node at a given level
   */
  greedySearch(startNode, targetIdx, level) {
    const slab = this._codes();
    let currentNode = startNode;
    let currentDist = this._distPair(currentNode, targetIdx);

    let improved = true;
    while (improved) {
      improved = false;
      const neighbors = this.graph[level]?.[currentNode] || EMPTY_NEIGHBORS;
      const n = neighbors.length;

      if (slab && n > 1 && n <= slab.batchIdx.length) {
        const idx = slab.batchIdx;
        for (let i = 0; i < n; i++) idx[i] = neighbors[i];
        const out = slab.batchToVector(targetIdx, n);
        for (let i = 0; i < n; i++) {
          if (out[i] < currentDist) {
            currentNode = neighbors[i];
            currentDist = out[i];
            improved = true;
          }
        }
      } else {
        for (const neighborIdx of neighbors) {
          const neighborDist = this._distPair(neighborIdx, targetIdx);
          if (neighborDist < currentDist) {
            currentNode = neighborIdx;
            currentDist = neighborDist;
            improved = true;
          }
        }
      }
    }

    return currentNode;
  }

  /**
   * Search layer returning ef closest candidates (construction-time).
   * Heap-based with generation-stamped visited list.
   */
  searchLayer(startNode, targetIdx, ef, level) {
    const visited = this._visitedList;
    visited.ensureCapacity(this._ids.length);
    visited.reset();
    visited.mark(startNode);

    const startDist = this._distPair(startNode, targetIdx);
    const slab = this._codes();

    // candidates = min-heap (explore closest first)
    const candidates = this._candHeap;
    candidates.clear();
    candidates.insert(startNode, startDist);

    // results = max-heap of size ef (peek furthest, replaceMax when closer found)
    const results = this._resHeap;
    results.clear();
    results.insert(startNode, startDist);

    while (candidates.size > 0) {
      const currentDist = candidates.peekVal();

      // If closest candidate is further than furthest result, stop
      if (results.size >= ef && currentDist > results.peekVal()) {
        break;
      }

      const currentIdx = candidates.extractMin();

      const neighbors = this.graph[level]?.[currentIdx] || EMPTY_NEIGHBORS;
      const nn = neighbors.length;
      if (slab && nn > 1 && nn <= slab.batchIdx.length) {
        // Two-pass block scoring (see searchLayerQuery) — one kernel call
        // per neighbor block, identical push sequence.
        const bIdx = slab.batchIdx;
        let m = 0;
        for (let i = 0; i < nn; i++) {
          const neighborIdx = neighbors[i];
          if (visited.isVisited(neighborIdx)) continue;
          visited.mark(neighborIdx);
          bIdx[m++] = neighborIdx;
        }
        if (m > 0) {
          const out = slab.batchToVector(targetIdx, m);
          for (let i = 0; i < m; i++) {
            const neighborIdx = bIdx[i];
            const dist = out[i];
            if (results.size < ef) {
              candidates.insert(neighborIdx, dist);
              results.insert(neighborIdx, dist);
            } else if (dist < results.peekVal()) {
              candidates.insert(neighborIdx, dist);
              results.replaceMax(neighborIdx, dist);
            }
          }
        }
      } else {
        for (let i = 0; i < nn; i++) {
          const neighborIdx = neighbors[i];
          if (visited.isVisited(neighborIdx)) continue;
          visited.mark(neighborIdx);

          const dist = this._distPair(neighborIdx, targetIdx);

          if (results.size < ef) {
            candidates.insert(neighborIdx, dist);
            results.insert(neighborIdx, dist);
          } else if (dist < results.peekVal()) {
            candidates.insert(neighborIdx, dist);
            results.replaceMax(neighborIdx, dist);
          }
        }
      }
    }

    // Drain results heap into sorted array (ascending by distance)
    const sorted = results.drainSorted();
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      out.push({ idx: sorted.keys[i], dist: sorted.vals[i] });
    }
    return out;
  }

  /**
   * Prune neighbors using heuristic selection.
   * Level-aware: M0=2*M on layer 0, M on higher layers.
   */
  pruneNeighbors(nodeIdx, level) {
    this._graphGen++;
    const neighbors = this.graph[level][nodeIdx];
    const maxM = this.getMaxM(level);
    const slab = this._codes();

    let withDist;
    const n = neighbors.length;
    if (slab && n > 1 && n <= slab.batchIdx.length) {
      const bIdx = slab.batchIdx;
      for (let i = 0; i < n; i++) bIdx[i] = neighbors[i];
      const out = slab.batchToVector(nodeIdx, n);
      withDist = new Array(n);
      for (let i = 0; i < n; i++) withDist[i] = { idx: neighbors[i], dist: out[i] };
    } else {
      withDist = neighbors.map(idx => ({
        idx,
        dist: this._distPair(idx, nodeIdx),
      }));
    }

    const selected = this.selectNeighborsHeuristic(nodeIdx, withDist, maxM);
    this.graph[level][nodeIdx] = selected.map(n => n.idx);
  }

  /**
   * Search for k nearest neighbors.
   * Supports asymmetric binary quantization.
   * Fix 7: Adaptive ef based on greedy descent quality.
   *
   * @param {Uint8Array|number[]} queryVector - Binary query vector (or float to convert)
   * @param {number} k - Number of results
   * @param {object} opts - Optional { floatQuery: Float32Array } for asymmetric mode
   * @returns {Promise<{results: Array, latency_us: number}>}
   */
  /**
   * Native searcher over a CSR snapshot of the resident graph, or null (no
   * addon, or SS_FIX_HNSW_NATIVE=0). Rebuilt lazily after any mutation
   * (_graphGen) or a graph reassignment (load/reset).
   */
  _nativeSearcher() {
    const n = this._ids.length;
    const cached = this._native;
    if (cached && cached.gen === this._graphGen && cached.n === n) {
      return cached.searcher;
    }
    const Ctor = nativeHnswSearcherCtor();
    if (!Ctor) return null;
    const slab = this._codes();
    if (slab.count < n) return null;
    const searcher = new Ctor(this.dimension, n, slab.slab.subarray(0, n * this.dimension));
    configureNativeSearcher(searcher);
    for (let l = 0; l < this.graph.length; l++) {
      const level = this.graph[l] || EMPTY_NEIGHBORS;
      const offsets = new Uint32Array(n + 1);
      let total = 0;
      for (let i = 0; i < n; i++) {
        offsets[i] = total;
        const nb = level[i];
        if (nb) total += nb.length;
      }
      offsets[n] = total;
      const neighbors = new Uint32Array(total);
      let p = 0;
      for (let i = 0; i < n; i++) {
        const nb = level[i];
        if (nb) for (let j = 0; j < nb.length; j++) neighbors[p++] = nb[j];
      }
      searcher.setLevel(l, offsets, neighbors);
    }
    this._native = { searcher, gen: this._graphGen, n };
    // Release the JS lists (read paths use the snapshot; writers thaw).
    this._freezeGraph();
    return searcher;
  }

  /**
   * Native layer-0 search: `[visitedCount, n, idx[0..n), dist[0..n)]` in a
   * shared scratch buffer, valid until the next native search call.
   */
  _nativeSearchLayer(searcher, startNode, ef, level) {
    const et = BINARY_HNSW_CONFIG.earlyTermination || {};
    const list = process.env.SS_FIX_HNSW_ADAPTIVE === '0' ? NO_EARLY_STOP : (et.thresholds || [[0.2, 0.10], [0.5, 0.15]]);
    if (nativeThresholds.list !== list) {
      nativeThresholds.list = list;
      nativeThresholds.flat = new Float64Array(list.flat());
    }
    const out = scratchArray('hnswLayer', Uint32Array, 2 + 2 * ef);
    searcher.searchLayerInto(startNode, ef, level, et.windowSize || 16, nativeThresholds.flat, out);
    return out;
  }

  /**
   * Live (non-stale) entries of a native layer result, copied into plain
   * arrays (young-generation heap: cheap to collect, and they outlive the
   * scratch buffer).
   */
  _nativeLive(out, staleBitmap) {
    const n = out[1];
    const idx = [];
    const dist = [];
    for (let i = 0; i < n; i++) {
      const node = out[2 + i];
      if (staleBitmap && this._isIndexStale(node, staleBitmap)) continue;
      idx.push(node);
      dist.push(out[2 + n + i]);
    }
    return { idx, dist, length: idx.length };
  }

  /**
   * Tail of search() on the native path: same stale filtering, retry and
   * result objects as the JS path, without the intermediate {idx, dist}
   * objects.
   */
  _finishNativeSearch(nat, currentNode, ef, k, staleBitmap, start, lazy = false) {
    let out;
    let live;
    const total = this._ids.length;
    if (total <= EXACT_SCAN_MAX_VECTORS && process.env.SS_FIX_HNSW_SCAN !== '0') {
      // Small index: exact top-k over every vector beats the walk on time
      // and never misses a neighbor. Ask for k plus the stale count so k live
      // results remain after filtering.
      const want = Math.min(total, k + (total - this._liveVectorCount(staleBitmap)));
      out = scratchArray('hnswLayer', Uint32Array, 2 + 2 * want);
      nat.scanInto(want, out);
      live = this._nativeLive(out, staleBitmap);
      return this._nativeResults(live, out[0], ef, k, staleBitmap, start, lazy);
    }
    out = this._nativeSearchLayer(nat, currentNode, ef, 0);
    const visitedCount = out[0];
    live = this._nativeLive(out, staleBitmap);
    if (live.length < k && ef < this._ids.length) {
      const retryEf = Math.min(this._ids.length, ef * 2);
      if (retryEf > ef) {
        out = this._nativeSearchLayer(nat, currentNode, retryEf, 0);
        live = this._nativeLive(out, staleBitmap);
      }
    }
    return this._nativeResults(live, visitedCount, ef, k, staleBitmap, start, lazy);
  }

  /** Result objects (or the lazy form) from live native candidates. */
  _nativeResults(live, visitedCount, ef, k, staleBitmap, start, lazy) {
    const maxDist = this.dimension * 8;
    const n = Math.min(k, live.length);
    const materialize = (m) => {
      const results = new Array(m);
      for (let i = 0; i < m; i++) {
        const node = live.idx[i];
        const dist = live.dist[i];
        results[i] = { id: this._ids[node], score: 1 - (dist / maxDist), hammingDistance: dist, metadata: this._metas[node] };
      }
      return results;
    };
    let results = null;
    let lazyFields = null;
    if (lazy) {
      // The caller reads all n scores but builds result objects only for the
      // head it keeps: materialize(m) gives the first m of the same results.
      const scores = new Array(n);
      for (let i = 0; i < n; i++) scores[i] = 1 - (live.dist[i] / maxDist);
      lazyFields = { count: n, scores, materialize: (m) => materialize(Math.min(m, n)) };
    } else {
      results = materialize(n);
    }
    const latency = performance.now() - start;
    const ret = {
      results,
      latency_us: Math.round(latency * 1000),
      latency_ms: latency.toFixed(3),
      k,
      total: this._liveVectorCount(staleBitmap),
      visitedNodes: visitedCount,
      adaptiveEf: ef,
      useAsymmetric: this.useAsymmetric,
    };
    // Node index of each result, for int8ScoresForNodes. Non-enumerable so
    // the visible result shape is unchanged.
    Object.defineProperty(ret, 'nodeIndices', { value: n === live.idx.length ? live.idx : live.idx.slice(0, n) });
    if (lazyFields) Object.assign(ret, lazyFields);
    return ret;
  }

  async search(queryVector, k = 10, opts = {}) {
    if (!this.initialized) await this.init();

    const start = performance.now();
    const staleBitmap = this._loadStaleBitmap();

    if (this._ids.length === 0) {
      return { results: [], latency_us: 0, k, total: 0 };
    }

    // Convert float to binary if needed
    let queryBinary;
    if (queryVector instanceof Uint8Array) {
      queryBinary = queryVector;
    } else if (Array.isArray(queryVector) && queryVector.length > this.dimension) {
      queryBinary = floatToBinary(queryVector.slice(0, this.floatDimension));
    } else {
      queryBinary = new Uint8Array(queryVector);
    }

    // When asymmetric mode is active (future: 1024d+ providers), re-encode
    // query binary through center→rotate→sign-bit for Hamming consistency.
    if (this.useAsymmetric && opts.floatQuery) {
      queryBinary = this.encodeDocument(opts.floatQuery);
    }
    // Stage the query once: traversal distances become resident-slab calls.
    const nat = this._nativeSearcher();
    if (nat) nat.setQuery(queryBinary);
    else this._setQuery(queryBinary);
    let currentNode = this.entryPoint;
    let ef = Math.max(this._oversampleTarget(k, staleBitmap), this.efSearch);
    const maxDist = this.dimension * 8;
    // The native exact scan (_finishNativeSearch) uses neither the entry node
    // nor ef, so only a walk descends the upper layers.
    const scan = nat && this._ids.length <= EXACT_SCAN_MAX_VECTORS && process.env.SS_FIX_HNSW_SCAN !== '0';
    if (!scan) {
      for (let l = this.maxLevel; l >= 1; l--) {
        currentNode = nat
          ? nat.greedy(currentNode, l)
          : this.greedySearchQuery(currentNode, queryBinary, l);
      }

      // Adaptive ef: easy queries get a smaller budget, hard queries get more
      // (SS_FIX_HNSW_ADAPTIVE=0, bench only: fixed ef and no early termination)
      const greedyDist = nat ? nat.dist(currentNode) : this._distQ(currentNode);
      const greedyQuality = 1 - (greedyDist / maxDist);
      if (process.env.SS_FIX_HNSW_ADAPTIVE === '0') {
        // fixed ef
      } else if (greedyQuality > 0.85) {
        ef = Math.max(this._oversampleTarget(k, staleBitmap), Math.round(ef * 0.6));
      } else if (greedyQuality < 0.55) {
        ef = Math.round(ef * 1.5);
      }
    }

    // Level 0 search — pure Hamming, no asymmetric in the traversal loop
    if (nat) return this._finishNativeSearch(nat, currentNode, ef, k, staleBitmap, start, opts.lazy === true);

    const searchResult = this.searchLayerQuery(currentNode, queryBinary, ef, 0);
    let candidates = searchResult.candidates;

    candidates = candidates.filter(c => !this._isIndexStale(c.idx, staleBitmap));
    if (candidates.length < k && ef < this._ids.length) {
      const retryEf = Math.min(this._ids.length, ef * 2);
      if (retryEf > ef) {
        const retry = this.searchLayerQuery(currentNode, queryBinary, retryEf, 0);
        candidates = retry.candidates.filter(c => !this._isIndexStale(c.idx, staleBitmap));
      }
    }

    // Return top k
    const results = candidates.slice(0, k).map(c => ({
      id: this._ids[c.idx],
      score: 1 - (c.dist / maxDist),
      hammingDistance: c.dist,
      metadata: this._metas[c.idx],
    }));

    const latency = performance.now() - start;

    return {
      results,
      latency_us: Math.round(latency * 1000),
      latency_ms: latency.toFixed(3),
      k,
      total: this._liveVectorCount(staleBitmap),
      visitedNodes: searchResult.visitedCount,
      adaptiveEf: ef,
      useAsymmetric: this.useAsymmetric,
    };
  }

  /**
   * Stages 1 and 2 of the semantic cascade on the native searcher, in one
   * synchronous span (the native scratch it reads is overwritten by the next
   * search). Same candidates, scores, order and statistics as
   * search(..., { lazy: true }) followed by int8ScoresForNodes and the
   * stable int8 sort in semanticSearch3Stage; only the result objects the
   * caller keeps are built. Returns null when the native path is not
   * available (the caller then uses search()).
   *
   * Result: stage-1 fields as search() returns them, `count`, `stats`
   * (`[visited, n, top1, top2, min, mean, variance]` of the stage-1 scores)
   * and `int8Stage(count)`, which scores (against `opts.queryInt8`, the
   * stage-2 query) the first `count`
   * stage-1 results and returns `{ count, missing, stats, materialize(m) }`:
   * `stats` is `[nonMissing, top1, top2, min, mean, variance]` of the
   * non-missing int8 scores in sorted order, and `materialize(m)` builds the
   * first m candidates in int8 order (`{ id, score, hammingDistance,
   * metadata, int8Score[, missingInt8] }`).
   */
  searchCascade(queryVector, k, opts = {}) {
    if (!this.initialized || this._ids.length === 0) return null;
    const kernels = nativeRescoreKernels();
    if (!kernels) return null;
    const nat = this._nativeSearcher();
    if (!nat || typeof nat.cascadeStage1 !== 'function') return null;
    const store = this._int8NodeSlab();
    if (!store) return null;
    // opts.queryFloat (the full query vector): the int8 query is encoded here at
    // the index's int8 width; otherwise opts.queryInt8 is the encoded query.
    const queryInt8 = opts.queryInt8 || (opts.queryFloat ? normalizedFloatToInt8(truncateForHNSW(opts.queryFloat, store.dim)) : null);
    if (!queryInt8 || queryInt8.length !== store.dim) return null;

    const start = performance.now();
    const staleBitmap = this._loadStaleBitmap();
    let queryBinary;
    if (queryVector instanceof Uint8Array) {
      queryBinary = queryVector;
    } else if (Array.isArray(queryVector) && queryVector.length > this.dimension) {
      queryBinary = floatToBinary(queryVector.slice(0, this.floatDimension));
    } else {
      queryBinary = new Uint8Array(queryVector);
    }
    if (this.useAsymmetric && opts.floatQuery) {
      queryBinary = this.encodeDocument(opts.floatQuery);
    } else if (opts.queryFloat && queryBinary.length !== this.dimension) {
      // An index whose codes use another prefix width than the configured one (K4).
      queryBinary = floatToBinary(truncateForHNSW(opts.queryFloat, this.floatDimension));
    }
    nat.setQuery(queryBinary);

    const total = this._ids.length;
    const live = this._liveVectorCount(staleBitmap);
    const scan = total <= EXACT_SCAN_MAX_VECTORS && process.env.SS_FIX_HNSW_SCAN !== '0';
    const maxDist = this.dimension * 8;
    let currentNode = this.entryPoint;
    let ef = Math.max(this._oversampleTarget(k, staleBitmap), this.efSearch);
    // The exact scan uses neither the entry node nor ef, so only the walk
    // descends the upper layers.
    if (!scan) {
      for (let l = this.maxLevel; l >= 1; l--) currentNode = nat.greedy(currentNode, l);
      const greedyQuality = 1 - (nat.dist(currentNode) / maxDist);
      if (process.env.SS_FIX_HNSW_ADAPTIVE === '0') {
        // fixed ef (bench only)
      } else if (greedyQuality > 0.85) {
        ef = Math.max(this._oversampleTarget(k, staleBitmap), Math.round(ef * 0.6));
      } else if (greedyQuality < 0.55) {
        ef = Math.round(ef * 1.5);
      }
    }
    const want = scan ? Math.min(total, k + (total - live)) : 0;
    const et = BINARY_HNSW_CONFIG.earlyTermination || {};
    const list = process.env.SS_FIX_HNSW_ADAPTIVE === '0' ? NO_EARLY_STOP : (et.thresholds || [[0.2, 0.10], [0.5, 0.15]]);
    if (nativeThresholds.list !== list) {
      nativeThresholds.list = list;
      nativeThresholds.flat = new Float64Array(list.flat());
    }
    const stalePayload = staleBitmap ? staleBitmap.payload : null;
    const staleBits = staleBitmap ? staleBitmap.capacity : 0;
    const stats = scratchArray('cascadeStats1', Float64Array, 8);
    const n = nat.cascadeStage1(scan, want, currentNode, ef, k, et.windowSize || 16,
      nativeThresholds.flat, stalePayload, staleBits, stats);
    const visitedCount = stats[0];
    const latency = performance.now() - start;

    const ids = this._ids;
    const metas = this._metas;
    const int8Stage = (count) => {
      const m = Math.min(count, n);
      const nodes = scratchArray('cascadeNodes', Uint32Array, m);
      const dists = scratchArray('cascadeDists', Uint32Array, m);
      const scores = scratchArray('cascadeScores', Float64Array, m);
      const missing = scratchArray('cascadeMissing', Uint8Array, m);
      const s2 = scratchArray('cascadeStats2', Float64Array, 8);
      nat.cascadeInt8(store.slab, store.dim, store.n, store.present, queryInt8, m,
        stalePayload, staleBits, nodes, dists, scores, missing, s2);
      return {
        count: m,
        missing: m - s2[0],
        stats: s2,
        // Node indices of the first h candidates (a copy: the scratch is shared).
        nodes: (h) => nodes.slice(0, Math.min(h, m)),
        // The final (full-vector) order of the first h candidates, computed
        // natively as applyFullVectorStageRescore would: { found, order,
        // full, norm } (scratch views; `found` < 2 = the stage does not
        // apply), or null when the native step or the vector file is missing.
        fullOrder: (queryFloat, h) => {
          const reader = this._fullReader;
          if (!reader || typeof nat.cascadeFull !== 'function' || !queryFloat || queryFloat.length !== reader.dim) return null;
          const hh = Math.min(h, m);
          const order = scratchArray('cascadeOrder', Uint32Array, hh);
          const full = scratchArray('cascadeFull', Float64Array, hh);
          const norm = scratchArray('cascadeNorm', Float64Array, hh);
          const found = nat.cascadeFull(reader.file, reader.rows, scratchFloat64Query(queryFloat), hh, order, full, norm);
          return { found, order, full, norm };
        },
        // The first `need` candidates in the final order of `fr` (from
        // fullOrder), with the fields applyFullVectorStageRescore sets.
        materializeFull: (need, fr) => {
          const out = new Array(need);
          for (let j = 0; j < need; j++) {
            const pos = fr.order[j];
            const node = nodes[pos];
            const dist = dists[pos];
            const c = { id: ids[node], score: 1 - (dist / maxDist), hammingDistance: dist, metadata: metas[node] };
            if (missing[pos]) {
              c.int8Score = 0.0;
              c.missingInt8 = true;
            } else {
              c.int8Score = scores[pos];
            }
            const f = fr.full[pos];
            if (!Number.isNaN(f)) {
              c.fullVectorScore = f;
              c.fullVectorNorm = fr.norm[pos];
              c.preFullVectorScore = c.int8Score;
              c.semanticBlendScore = fr.norm[pos];
            }
            c.score = c.semanticBlendScore;
            out[j] = c;
          }
          return out;
        },
        materialize: (h) => {
          const out = new Array(Math.min(h, m));
          for (let i = 0; i < out.length; i++) {
            const node = nodes[i];
            const dist = dists[i];
            const c = { id: ids[node], score: 1 - (dist / maxDist), hammingDistance: dist, metadata: metas[node] };
            if (missing[i]) {
              c.int8Score = 0.0;
              c.missingInt8 = true;
            } else {
              c.int8Score = scores[i];
            }
            out[i] = c;
          }
          return out;
        },
      };
    };

    return {
      results: null,
      latency_us: Math.round(latency * 1000),
      latency_ms: latency.toFixed(3),
      k,
      total: live,
      visitedNodes: visitedCount,
      adaptiveEf: ef,
      useAsymmetric: this.useAsymmetric,
      count: n,
      stats,
      queryInt8,
      int8Stage,
    };
  }

  _loadStaleBitmap() {
    // Freshness contract: an externally written bitmap must be visible on the
    // NEXT call (rescoring-fix-phase0 pins this), so every call stats the
    // file; only the LOAD is cached (by stat identity). Hot rescore paths that
    // would otherwise stat per candidate snapshot once per batch via
    // getInt8VectorsForIds().
    // One stat call (no exception when the file is absent).
    let stat;
    try {
      stat = statSync(this.stalePath, { bigint: true, throwIfNoEntry: false });
    } catch {
      stat = undefined;
    }
    if (!stat) {
      this._staleBitmapCache = null;
      return null;
    }
    const statKey = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;

    if (
      this._staleBitmapCache
      && this._staleBitmapCache.statKey === statKey
    ) {
      return this._staleBitmapCache.bitmap;
    }

    try {
      const bitmap = loadBitmap(this.stalePath);
      this._staleBitmapCache = { statKey, bitmap };
      return bitmap;
    } catch (err) {
      if (process.env.SWEET_DEBUG) {
        console.debug(`[BinaryHNSW] ignoring unreadable stale bitmap ${this.stalePath}: ${err.message}`);
      }
      this._staleBitmapCache = { statKey, bitmap: null };
      return null;
    }
  }

  _isIndexStale(idx, bitmap) {
    return bitmap ? isSet(bitmap, idx) : false;
  }

  _liveVectorCount(bitmap) {
    // O(words) bitmap popcount instead of an O(n) per-index isSet loop, and
    // memoized on the bitmap cache entry: bits only ever get SET, and every
    // setter nulls the cache, so a cached count stays exact for the cached
    // bitmap at a given vector count.
    const n = this._ids.length;
    if (!bitmap) return n;
    const cache = this._staleBitmapCache;
    if (cache && cache.bitmap === bitmap) {
      if (cache.staleCountLen !== n) {
        cache.staleCount = popcountRange(bitmap, n);
        cache.staleCountLen = n;
      }
      return n - cache.staleCount;
    }
    return n - popcountRange(bitmap, n);
  }

  _oversampleTarget(k, bitmap) {
    if (!bitmap) return k;
    const live = this._liveVectorCount(bitmap);
    const tombstoned = Math.max(0, this._ids.length - live);
    if (tombstoned === 0) return k;
    const s = Math.max(0, Math.min(tombstoned / Math.max(1, this._ids.length), 0.5));
    return Math.min(Math.max(k + 64, Math.ceil(k / Math.max(0.05, 1 - s) * 2)), k * 20);
  }

  /**
   * Greedy search for query vector
   */
  greedySearchQuery(startNode, queryBinary, level) {
    // Direct callers (outside search()) may pass their own query — stage it.
    if (queryBinary !== this._queryBinary) this._setQuery(queryBinary);
    const slab = this._codes();
    let currentNode = startNode;
    let currentDist = this._distQ(currentNode);

    let improved = true;
    while (improved) {
      improved = false;
      const neighbors = this.graph[level]?.[currentNode] || EMPTY_NEIGHBORS;
      const n = neighbors.length;

      if (slab && n > 1 && n <= slab.batchIdx.length) {
        // Batch-score the whole neighbor block in one kernel call, then scan
        // with the exact per-neighbor update rule (distances are precomputed,
        // comparisons run in the same order → identical walk).
        const idx = slab.batchIdx;
        for (let i = 0; i < n; i++) idx[i] = neighbors[i];
        const out = slab.batchToQuery(n);
        for (let i = 0; i < n; i++) {
          if (out[i] < currentDist) {
            currentNode = neighbors[i];
            currentDist = out[i];
            improved = true;
          }
        }
      } else {
        for (const neighborIdx of neighbors) {
          const neighborDist = this._distQ(neighborIdx);
          if (neighborDist < currentDist) {
            currentNode = neighborIdx;
            currentDist = neighborDist;
            improved = true;
          }
        }
      }
    }

    return currentNode;
  }

  /**
   * Search layer for query vector.
   * Pure Hamming distance — heaps are integer-native, no float packing.
   * Asymmetric rescoring happens in search() after candidates are returned.
   */
  searchLayerQuery(startNode, queryBinary, ef, level) {
    // Direct callers (outside search()) may pass their own query — stage it.
    if (queryBinary !== this._queryBinary) this._setQuery(queryBinary);
    const visited = this._visitedList;
    visited.ensureCapacity(this._ids.length);
    visited.reset();
    visited.mark(startNode);

    const startDist = this._distQ(startNode);
    const slab = this._codes();
    const candidates = this._candHeap;
    candidates.clear();
    const results = this._resHeap;
    results.clear();
    candidates.insert(startNode, startDist);
    results.insert(startNode, startDist);

    const etConfig = BINARY_HNSW_CONFIG.earlyTermination || {};
    const windowSize = etConfig.windowSize || 16;
    const etThresholds = etConfig.thresholds || [[0.2, 0.10], [0.5, 0.15]];
    let visitedCount = 0;
    let recentDiscoveries = 0;
    let recentVisits = 0;

    while (candidates.size > 0) {
      if (results.size >= ef && candidates.peekVal() > results.peekVal()) break;

      const currentIdx = candidates.extractMin();
      visitedCount++;

      const neighbors = this.graph[level]?.[currentIdx] || EMPTY_NEIGHBORS;
      let foundNew = false;
      const nn = neighbors.length;
      if (slab && nn > 1 && nn <= slab.batchIdx.length) {
        // Two-pass block scoring: pass 1 visited-filters into the batch
        // scratch, pass 2 scores the block in one kernel call, pass 3 pushes
        // in the same sequence — identical heap states to the per-call loop.
        const bIdx = slab.batchIdx;
        let m = 0;
        for (let i = 0; i < nn; i++) {
          const neighborIdx = neighbors[i];
          if (visited.isVisited(neighborIdx)) continue;
          visited.mark(neighborIdx);
          bIdx[m++] = neighborIdx;
        }
        if (m > 0) {
          const out = slab.batchToQuery(m);
          for (let i = 0; i < m; i++) {
            const neighborIdx = bIdx[i];
            const dist = out[i];
            if (results.size < ef) {
              candidates.insert(neighborIdx, dist);
              results.insert(neighborIdx, dist);
              foundNew = true;
            } else if (dist < results.peekVal()) {
              candidates.insert(neighborIdx, dist);
              results.replaceMax(neighborIdx, dist);
              foundNew = true;
            }
          }
        }
      } else {
        for (let i = 0; i < nn; i++) {
          const neighborIdx = neighbors[i];
          if (visited.isVisited(neighborIdx)) continue;
          visited.mark(neighborIdx);

          const dist = this._distQ(neighborIdx);

          if (results.size < ef) {
            candidates.insert(neighborIdx, dist);
            results.insert(neighborIdx, dist);
            foundNew = true;
          } else if (dist < results.peekVal()) {
            candidates.insert(neighborIdx, dist);
            results.replaceMax(neighborIdx, dist);
            foundNew = true;
          }
        }
      }

      recentVisits++;
      if (foundNew) recentDiscoveries++;
      if (recentVisits > windowSize) {
        recentVisits >>= 1;
        recentDiscoveries >>= 1;
      }
      if (recentVisits >= windowSize) {
        const progress = visitedCount / ef;
        const rate = recentDiscoveries / recentVisits;
        if (etThresholds.some(([p, r]) => progress > p && rate < r)) break;
      }
    }

    const sorted = results.drainSorted();
    const out = new Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
      out[i] = { idx: sorted.keys[i], dist: sorted.vals[i] };
    }
    return { candidates: out, visitedCount };
  }

  /**
   * Calibrate asymmetric quantization from float embeddings.
   * Must be called once per index build, before adding vectors.
   * Computes centroid and generates sign vector for WHT rotation.
   */
  calibrateAsymmetric(floatEmbeddings) {
    if (!floatEmbeddings || floatEmbeddings.length === 0) return;
    this.centroid = computeCentroid(floatEmbeddings);
    this.signVector = generateSignVector(this.centroid.length);
    this.useAsymmetric = true;
  }

  /**
   * Encode a float embedding using the asymmetric pipeline (center→rotate→binarize).
   * Falls back to simple sign-bit if not calibrated.
   */
  encodeDocument(floatEmbedding) {
    if (this.useAsymmetric && this.centroid && this.signVector) {
      return asymmetricDocEncode(floatEmbedding, this.centroid, this.signVector);
    }
    return floatToBinary(floatEmbedding);
  }

  /**
   * Encode a query using the asymmetric pipeline (center→rotate→int4).
   * Returns { int4, norm } for asymmetric distance, or null if not calibrated.
   */
  encodeQuery(floatEmbedding) {
    if (this.useAsymmetric && this.centroid && this.signVector) {
      return asymmetricQueryEncode(floatEmbedding, this.centroid, this.signVector);
    }
    return null;
  }

  /**
   * Batch add vectors
   */
  async addBatch(items) {
    if (!this.initialized) await this.init();

    const results = [];
    for (const item of items) {
      const idx = this.addSync(item.id, item.binary || item.vector, item.metadata, item.int8, item.full || null);
      results.push(idx);
    }
    return results;
  }

  /**
   * Get int8 vector for rescoring
   */
  getInt8Vector(id) {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return undefined;
    if (this._isIndexStale(idx, this._loadStaleBitmap())) {
      return undefined;
    }
    return this._int8?.get(idx);
  }

  /** int8 row of node i (a view, shares the bytes), or undefined. */
  nodeInt8(i) {
    return this._int8?.get(i);
  }

  /** Drop the int8 row of `id` (a deleted chunk). */
  deleteInt8(id) {
    const idx = this.idToIndex.get(id);
    if (idx !== undefined) this._int8?.drop(idx);
  }

  /** Number of nodes with an int8 row. */
  int8Count() {
    return this._int8 ? this._int8.count(this._ids.length) : 0;
  }

  /**
   * save() helper: publish the full-vector file for this save, or remove it
   * when this save's nodes have no full vectors (so no reader pairs an old
   * map with a new graph), then reopen the reader on what was published.
   */
  async _publishFullVectors(indexPath, pidSuffix) {
    const w = this._fullWriter;
    if (w) {
      await w.publish(indexPath, this._ids.length, pidSuffix);
    } else if (this._fullDirty || this._ids.length === 0) {
      await removeFullVectorFiles(indexPath);
    }
    this._fullDirty = false;
    closeFullVectors(this._fullReader);
    this._fullReader = openFullVectors(indexPath, this._ids.length);
  }

  /**
   * Full-vector scores for the final rescore from the full-vector file:
   * { scores, found } aligned with `ids` (null score for an id without a
   * row), or null when the index has no file. `nodes`, when given, are the
   * ids' node indices (from searchCascade), so no id lookup.
   */
  fullDotScores(query, ids, nodes = null) {
    const reader = this._fullReader;
    if (!reader) return null;
    if (!nodes || nodes.length !== ids.length || !this._nodesMatch(nodes, ids)) {
      nodes = new Array(ids.length);
      for (let i = 0; i < ids.length; i++) nodes[i] = ids[i] == null ? undefined : this.idToIndex.get(ids[i]);
    }
    return fullDotScoresForNodes(reader, query, nodes, ids);
  }

  _nodesMatch(nodes, ids) {
    for (let i = 0; i < ids.length; i++) if (this._ids[nodes[i]] !== ids[i]) return false;
    return true;
  }

  /** A copy of node `node`'s full vector from the file, or null. */
  fullVectorOf(node) {
    return readFullVector(this._fullReader, node);
  }

  /**
   * Node-ordered int8 rows for the native rescore: { slab, present, dim, n },
   * or null when the index has none.
   */
  _int8NodeSlab() {
    const s = this._int8;
    const n = this._ids.length;
    if (!s || s.capacity < n) return s && n > 0 ? this._int8Grow(n) : null;
    return { slab: s.rows, present: s.present, dim: s.dim, n };
  }

  /** Grow the int8 rows to cover all n nodes (absent rows stay absent). */
  _int8Grow(n) {
    const s = this._int8;
    const rows = new Int8Array(n * s.dim);
    rows.set(s.rows.subarray(0, Math.min(s.rows.length, rows.length)));
    const present = new Uint8Array(n);
    present.set(s.present.subarray(0, Math.min(s.present.length, n)));
    s.rows = rows;
    s.present = present;
    return { slab: rows, present, dim: s.dim, n };
  }

  /**
   * Stage-2 int8 scores for stage-1 node indices, exactly as
   * int8BatchDotScores(query, getInt8VectorsForIds(ids)) would give them.
   * Returns { scores, missing } aligned with `nodes`, or null when the
   * native path is unavailable (callers then use getInt8VectorsForIds).
   */
  int8ScoresForNodes(queryInt8, nodes) {
    const kernels = nativeRescoreKernels();
    if (!kernels || !nodes) return null;
    const store = this._int8NodeSlab();
    if (!store || queryInt8.length !== store.dim) return null;
    const bitmap = this._loadStaleBitmap();
    const missing = new Array(nodes.length).fill(false);
    const rows = scratchArray('int8Rows', Uint32Array, nodes.length);
    let m = 0;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node >= store.n || !store.present[node] || this._isIndexStale(node, bitmap)) {
        missing[i] = true;
      } else {
        rows[m++] = node;
      }
    }
    const packed = scratchArray('int8Scores', Float64Array, m);
    if (m > 0) kernels.int8DotScores(store.slab, store.dim, queryInt8, rows.subarray(0, m), packed);
    const scores = new Array(nodes.length).fill(0);
    for (let i = 0, j = 0; i < nodes.length; i++) if (!missing[i]) scores[i] = packed[j++];
    return { scores, missing, queryInt8 };
  }

  /**
   * Batch variant of getInt8Vector for hot rescore loops: snapshots the stale
   * bitmap ONCE for the whole batch.
   *
   * @param {string[]} ids
   * @returns {Array<Int8Array|undefined>} aligned with ids
   */
  getInt8VectorsForIds(ids) {
    const bitmap = this._loadStaleBitmap();
    const out = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const idx = this.idToIndex.get(ids[i]);
      out[i] = (idx === undefined || this._isIndexStale(idx, bitmap))
        ? undefined
        : this._int8?.get(idx);
    }
    return out;
  }

  /**
   * Level l as CSR over all n nodes for save(): { len, present, offsets, neighbors }.
   */
  _levelForSave(l, n) {
    const frozen = this._graphFrozen;
    if (frozen) {
      const { offsets, neighbors } = this._frozenLevelCsr(l);
      return { len: frozen.lengths[l], present: frozen.present[l], offsets, neighbors };
    }
    const level = this._graphStore[l] || EMPTY_NEIGHBORS;
    const len = level.length;
    const present = new Uint8Array(len);
    const offsets = new Uint32Array(n + 1);
    let total = 0;
    for (let i = 0; i < n; i++) {
      offsets[i] = total;
      const nb = level[i];
      if (nb) { total += nb.length; if (i < len) present[i] = 1; }
    }
    offsets[n] = total;
    const neighbors = new Uint32Array(total);
    let p = 0;
    for (let i = 0; i < n; i++) {
      const nb = level[i];
      if (nb) for (let j = 0; j < nb.length; j++) neighbors[p++] = nb[j];
    }
    // Level 0 of a walked index is re-pruned to 128 links when the native
    // searcher takes it; save it pruned (the same native routine) so loads
    // skip that pass. The JS lists stay as built.
    const Ctor = l === 0 && n > EXACT_SCAN_MAX_VECTORS ? nativeHnswSearcherCtor() : null;
    if (Ctor) {
      const t = new Ctor(this.dimension, n, this._codes().slab.subarray(0, n * this.dimension));
      t.setLevel(0, offsets, neighbors);
      const flat = t.exportLevel(0);
      return { len, present, offsets: flat.subarray(0, n + 1), neighbors: flat.subarray(n + 1) };
    }
    return { len, present, offsets, neighbors };
  }

  /**
   * Save index to disk: one index file (format 3) written to
   * `<path>.tmp.<pid>` and renamed over `<path>`, so readers see the old or
   * the new index, never a mix. The full-vector file is published first.
   */
  async save(indexPath = this.indexPath) {
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    const n = this._ids.length;
    const dim = this.dimension;
    const levelCount = this._graphFrozen ? this._graphFrozen.lengths.length : this._graphStore.length;

    const sections = [];
    sections.push(['codes', { parts: [this._codes().slab.subarray(0, n * dim)] }]);
    sections.push(['ids', recordChunks(this._ids)]);
    sections.push(['metas', recordChunks(this._metas)]);
    let int8Dim = 0;
    const int8Count = this.int8Count();
    if (int8Count > 0) {
      const s = this._int8NodeSlab();
      int8Dim = s.dim;
      sections.push(['int8', { parts: [s.slab.subarray(0, n * s.dim)] }]);
      sections.push(['int8Present', { parts: [s.present.subarray(0, n)] }]);
    }
    const levels = [];
    for (let l = 0; l < levelCount; l++) {
      const lv = this._levelForSave(l, n);
      levels.push({ len: lv.len, links: lv.neighbors.length });
      sections.push([`l${l}.present`, { parts: [lv.present] }]);
      sections.push([`l${l}.offsets`, { parts: [lv.offsets] }]);
      sections.push([`l${l}.neighbors`, { parts: [lv.neighbors] }]);
    }

    const header = {
      format: 3,
      pipelineVersion: PIPELINE_VERSION,
      dimension: this.dimension,
      floatDimension: this.floatDimension,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      maxElements: this.maxElements,
      count: n,
      maxLevel: this.maxLevel,
      entryPoint: this.entryPoint,
      useAsymmetric: this.useAsymmetric,
      calibration: (this.useAsymmetric && this.centroid && this.signVector)
        ? { centroid: Array.from(this.centroid), signVector: Array.from(this.signVector) }
        : null,
      int8Dim,
      int8Count,
      levels,
      savedAt: new Date().toISOString(),
    };

    const pidSuffix = `.tmp.${process.pid}`;
    await writeIndexFile(indexPath + pidSuffix, header, sections);
    await this._publishFullVectors(indexPath, pidSuffix);
    await fs.rename(indexPath + pidSuffix, indexPath);

    if (this._cleanBuild) {
      await fs.rm(this._stalePathForIndex(indexPath), { force: true });
      this._staleBitmapCache = null;
      this._cleanBuild = false;
    }

    console.log(`BinaryHNSW: Saved ${n} vectors to ${indexPath} (asymmetric=${this.useAsymmetric})`);
  }

  /**
   * Load index from disk (format 3; any other file is an error the caller
   * routes to a rebuild).
   *
   * With the native searcher, the codes and the graph go straight into it.
   * The JS code slab is left out until a write needs it, and so is the graph
   * when the exact scan answers (at most EXACT_SCAN_MAX_VECTORS nodes): both
   * stay readable from the file, kept open for that.
   */
  async load(indexPath = this.indexPath) {
    this._closeFile();
    const fd = openSync(indexPath, 'r');
    let keep = false;
    try {
      const parsed = readHeaderFd(fd);
      if (!parsed) throw new Error(`BinaryHNSW: not an index file (format 3): ${indexPath}`);
      const { header, dataStart } = parsed;
      const storedVersion = header.pipelineVersion || 1;
      if (storedVersion !== PIPELINE_VERSION) {
        throw new Error(
          `Pipeline version mismatch: index=${storedVersion}, current=${PIPELINE_VERSION}. ` +
          `Index must be rebuilt (quantization pipeline changed).`
        );
      }
      const n = header.count;
      if (header.entryPoint !== -1 && header.entryPoint >= n) {
        throw new Error(`BinaryHNSW: entry point ${header.entryPoint} out of range (${n} nodes): ${indexPath}`);
      }
      const sec = header.sections;
      // Parts of the file may be read only later (scan-size graph, code slab),
      // so check now that every section is there.
      const end = Object.values(sec).reduce((a, x) => Math.max(a, x.off + x.len), 0);
      if (fstatSync(fd).size < dataStart + end) {
        throw new Error(`BinaryHNSW: index file is truncated: ${indexPath}`);
      }

      this.dimension = header.dimension;
      this.floatDimension = header.floatDimension;
      this.M = header.M;
      this.efConstruction = header.efConstruction;
      this.efSearch = header.efSearch;
      this.maxElements = header.maxElements ?? this.maxElements;
      this.maxLevel = header.maxLevel;
      this.entryPoint = header.entryPoint;
      this.useAsymmetric = header.useAsymmetric || false;
      this.centroid = this.useAsymmetric && header.calibration ? new Float32Array(header.calibration.centroid) : null;
      this.signVector = this.useAsymmetric && header.calibration ? new Float32Array(header.calibration.signVector) : null;

      this._ids = readRecords(fd, dataStart, sec.ids, n);
      this._metas = readRecords(fd, dataStart, sec.metas, n);
      this.idToIndex = new Map();
      for (let i = 0; i < n; i++) this.idToIndex.set(this._ids[i], i);

      this._int8 = header.int8Dim > 0
        ? new Int8Rows(header.int8Dim, mappedSection(indexPath, dataStart, sec.int8, Int8Array) ?? readSection(fd, dataStart, sec.int8, Int8Array),
          readSection(fd, dataStart, sec.int8Present, Uint8Array))
        : null;

      const levels = header.levels.map((lv, l) => ({
        len: lv.len,
        present: sec[`l${l}.present`],
        offsets: sec[`l${l}.offsets`],
        neighbors: sec[`l${l}.neighbors`],
      }));
      const lengths = levels.map((lv) => lv.len);
      const present = levels.map((lv) => readSection(fd, dataStart, lv.present, Uint8Array));
      const codes = readSection(fd, dataStart, sec.codes, Uint8Array);

      this.graph = [];  // resets the store and bumps _graphGen
      this._graphStore = null;
      const Ctor = nativeHnswSearcherCtor();
      if (Ctor) {
        const searcher = new Ctor(this.dimension, n, codes);
        configureNativeSearcher(searcher);
        const scanOnly = n <= EXACT_SCAN_MAX_VECTORS && process.env.SS_FIX_HNSW_SCAN !== '0';
        if (!scanOnly) {
          levels.forEach((lv, l) => searcher.setLevel(l,
            readSection(fd, dataStart, lv.offsets, Uint32Array),
            readSection(fd, dataStart, lv.neighbors, Uint32Array)));
        }
        this._graphFrozen = { lengths, present, onDisk: scanOnly };
        this._native = { searcher, gen: this._graphGen, n };
        this._slab = null;
        this._file = { fd, dataStart, codes: sec.codes, levels };
        keep = true;
      } else {
        // No addon: the JS walk needs the code slab and the graph arrays.
        const slab = new HammingSlab(this.dimension);
        if (n > 0) slab.fill(codes, n);
        this._slab = slab;
        this._native = null;
        this._file = { fd, dataStart, codes: sec.codes, levels };
        this._graphFrozen = { lengths, present, onDisk: true };
        this._thawGraph();
        keep = this._file !== null;
      }

      this._visitedList.ensureCapacity(n);
      this._fullWriter?.close();
      this._fullWriter = undefined;
      this._fullDirty = false;
      closeFullVectors(this._fullReader);
      this._fullReader = openFullVectors(indexPath, n);
      if (!this._fullReader && n > 0) {
        bootLog(`BinaryHNSW: no full-vector file at ${indexPath}; the final rescore is off until a full rebuild`);
      }
      this.initialized = true;
      bootLog(`BinaryHNSW: Loaded ${n} vectors from ${indexPath} (asymmetric=${this.useAsymmetric})`);
    } finally {
      if (!keep) {
        if (this._file?.fd === fd) this._file = null;
        try { closeSync(fd); } catch { /* best-effort */ }
      }
    }
  }

  /**
   * Get index statistics (from the header shape and link counts; no graph
   * arrays are rebuilt).
   */
  getStats() {
    let graphNodes = 0;
    let graphEdges = 0;
    let graphLevels;
    const frozen = this._graphFrozen;
    if (frozen) {
      graphLevels = frozen.lengths.length;
      for (let l = 0; l < graphLevels; l++) {
        const p = frozen.present[l];
        for (let i = 0; i < p.length; i++) graphNodes += p[i];
        graphEdges += this._frozenLevelCsr(l).neighbors.length;
      }
    } else {
      const graph = this._graphStore;
      graphLevels = graph.length;
      for (const level of graph) {
        if (!level) continue;
        for (const neighbors of level) {
          if (neighbors) {
            graphNodes += 1;
            graphEdges += neighbors.length;
          }
        }
      }
    }

    const n = this._ids.length;
    return {
      dimension: this.dimension,
      floatDimension: this.floatDimension,
      totalVectors: n,
      maxElements: this.maxElements,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      maxLevel: this.maxLevel,
      graphLevels,
      graphNodes,
      graphEdges,
      int8VectorCount: this.int8Count(),
      memorySizeBytes: n * this.dimension, // Just binary vectors
      memorySizeMB: (n * this.dimension / 1024 / 1024).toFixed(2),
    };
  }

  /**
   * Clear all data
   */
  async clear() {
    this._closeFile();
    this._ids = [];
    this._metas = [];
    this._slab = new HammingSlab(this.dimension);
    this.idToIndex = new Map();
    this._int8 = null;
    this.graph = [];
    this.entryPoint = -1;
    this.maxLevel = 0;
    await fs.rm(this.stalePath, { force: true });
    this._staleBitmapCache = null;
    this._cleanBuild = false;
    this._fullWriter?.close();
    this._fullWriter = undefined;
    closeFullVectors(this._fullReader);
    this._fullReader = null;
    this._fullDirty = false;
    await removeFullVectorFiles(this.indexPath);
  }

  /**
   * Release the open index file and the full-vector reader. The index stays
   * searchable only from what is in memory.
   */
  close() {
    this._closeFile();
    closeFullVectors(this._fullReader);
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export async function createBinaryHNSWIndex(options = {}) {
  const index = new BinaryHNSWIndex(options);

  if (options.load !== false && binaryHnswIndexExists(options.indexPath || DB_PATHS.binaryHnswIndex)) {
    try {
      await index.load(options.indexPath);
    } catch (err) {
      console.log(`BinaryHNSW: Could not load existing index: ${err.message}`);
      await index.init();
    }
  } else {
    await index.init();
  }

  return index;
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  console.log(`
Binary HNSW Index CLI

Usage:
  binary-hnsw-index.js stats     Show index statistics
  binary-hnsw-index.js test      Run performance benchmark
  binary-hnsw-index.js compare   Compare binary vs float HNSW

Options:
  --vectors <n>   Number of test vectors (default: 10000)
  --dim <n>       Float dimension (default: 512)
`);

  const command = args[0];

  (async () => {
    const index = new BinaryHNSWIndex();

    try {
      if (command === 'stats') {
        await index.load();
        console.log('\nBinary HNSW Index Statistics:');
        console.log(JSON.stringify(index.getStats(), null, 2));

      } else if (command === 'test' || command === 'benchmark') {
        console.log('\n=== Binary HNSW Performance Benchmark ===\n');

        const numVectors = parseInt(args.find((_, i) => args[i - 1] === '--vectors') || '10000', 10);
        const floatDim = parseInt(args.find((_, i) => args[i - 1] === '--dim') || '512', 10);
        const binaryDim = Math.ceil(floatDim / 8);

        console.log(`Generating ${numVectors} random ${floatDim}-dim vectors...`);
        console.log(`Binary dimension: ${binaryDim} bytes (${floatDim} bits)\n`);

        // Generate random vectors
        const vectors = [];
        for (let i = 0; i < numVectors; i++) {
          const float = new Array(floatDim).fill(0).map(() => Math.random() * 2 - 1);
          const binary = floatToBinary(float);
          vectors.push({ id: `vec-${i}`, float, binary });
        }

        // Add to index
        console.log('Adding vectors to index...');
        const addStart = performance.now();
        for (const v of vectors) {
          await index.add(v.id, v.binary, { index: parseInt(v.id.split('-')[1]) });
        }
        const addTime = performance.now() - addStart;
        console.log(`Added ${numVectors} vectors in ${addTime.toFixed(2)}ms (${(numVectors / addTime * 1000).toFixed(0)} vec/s)\n`);

        // Search benchmark
        const numQueries = 100;
        console.log(`Running ${numQueries} searches...`);
        const latencies = [];

        for (let i = 0; i < numQueries; i++) {
          const queryFloat = new Array(floatDim).fill(0).map(() => Math.random() * 2 - 1);
          const queryBinary = floatToBinary(queryFloat);
          const result = await index.search(queryBinary, 10);
          latencies.push(result.latency_us);
        }

        // Stats
        latencies.sort((a, b) => a - b);
        const p50 = latencies[Math.floor(numQueries * 0.5)];
        const p95 = latencies[Math.floor(numQueries * 0.95)];
        const p99 = latencies[Math.floor(numQueries * 0.99)];
        const avg = latencies.reduce((a, b) => a + b, 0) / numQueries;

        console.log(`\nSearch Latency (μs):`);
        console.log(`  p50: ${p50.toFixed(0)}μs`);
        console.log(`  p95: ${p95.toFixed(0)}μs`);
        console.log(`  p99: ${p99.toFixed(0)}μs`);
        console.log(`  avg: ${avg.toFixed(0)}μs`);

        console.log(`\nMemory usage:`);
        const stats = index.getStats();
        console.log(`  Binary vectors: ${stats.memorySizeMB} MB`);
        console.log(`  Equivalent float: ${(numVectors * floatDim * 4 / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Compression: ${(floatDim * 4 / binaryDim).toFixed(0)}x`);

      } else {
        console.log('Unknown command. Use: stats, test');
      }
    } catch (err) {
      console.error('Error:', err.message);
      if (args.includes('-v') || args.includes('--verbose')) {
        console.error(err.stack);
      }
      process.exit(1);
    }
  })();
}

export default BinaryHNSWIndex;
