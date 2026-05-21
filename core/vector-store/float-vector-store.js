/**
 * Float Vector Store — Direct-access binary storage for Stage 2.5 rescoring.
 *
 * Replaces SQLite on the float-rescore hot path. Vectors are stored contiguously
 * in a flat binary file and preloaded into memory at startup. Lookup is O(1) by
 * integer index or by ID via an ID→index map.
 *
 * File format (.float-vectors.bin):
 *   Header (20 bytes):
 *     magic:     4 bytes  "FVEC"
 *     version:   uint32   1
 *     dimension: uint32   number of float32 elements per vector
 *     count:     uint32   number of vectors
 *     reserved:  uint32   0
 *   Data:
 *     count × dimension × 4 bytes (float32, little-endian, contiguous)
 *
 * ID mapping (.float-vectors.ids.json):
 *   Array of string IDs in index order. id[i] corresponds to vector at offset
 *   i * dimension * 4 in the data section.
 *
 * At query time:
 *   1. Resolve chunk ID → index via idToIndex Map
 *   2. Slice Float32Array at index * dimension
 *   3. Batch dot product for Stage 2.5 candidates
 */

import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { float32BatchDot } from '../infrastructure/simd-distance.js';

const MAGIC = 0x43455646; // "FVEC" in little-endian
const VERSION = 1;
const HEADER_SIZE = 20;

export class FloatVectorStore {
  constructor() {
    this.buffer = null;       // Raw ArrayBuffer
    this.data = null;         // Float32Array view over data section
    this.dimension = 0;
    this.count = 0;
    this.idToIndex = new Map();
    this.loaded = false;
  }

  /**
   * Build the store from an array of { id, vector } entries.
   * Vectors should be Float32Array or number[] of consistent dimension.
   *
   * @param {Array<{id: string, vector: Float32Array|number[]}>} entries
   * @param {number} dimension
   */
  build(entries, dimension) {
    this.dimension = dimension;
    this.count = entries.length;
    this.idToIndex = new Map();

    // Allocate contiguous buffer: header + data
    const dataBytes = this.count * this.dimension * 4;
    this.buffer = new ArrayBuffer(HEADER_SIZE + dataBytes);

    // Write header
    const header = new DataView(this.buffer, 0, HEADER_SIZE);
    header.setUint32(0, MAGIC, true);
    header.setUint32(4, VERSION, true);
    header.setUint32(8, this.dimension, true);
    header.setUint32(12, this.count, true);
    header.setUint32(16, 0, true); // reserved

    // Write data + build ID map (bulk set per vector)
    this.data = new Float32Array(this.buffer, HEADER_SIZE);
    for (let i = 0; i < entries.length; i++) {
      const { id, vector } = entries[i];
      this.idToIndex.set(id, i);
      this.data.set(vector, i * this.dimension);
    }

    this.loaded = true;
  }

  /**
   * Save to disk: binary file + ID map JSON.
   *
   * Both files are written via temp-file + atomic rename so a crash mid-write
   * never leaves a half-written artifact, and a concurrent reader either sees
   * the whole previous version or the whole new one. The binary is renamed
   * first; if a crash interleaves the two renames, the next load sees a new
   * binary against the old ID map — the count guard in `load()` rejects that
   * mismatch and Stage 2.5 cleanly falls back to SQLite until re-reconciled.
   *
   * @param {string} binPath - Path for binary file (e.g., foo.float-vectors.bin)
   */
  async save(binPath) {
    if (!this.loaded) throw new Error('FloatVectorStore: nothing to save');

    const idsPath = binPath.replace(/\.bin$/, '.ids.json');
    const ids = new Array(this.count);
    for (const [id, idx] of this.idToIndex) ids[idx] = id;

    const binTmp = `${binPath}.tmp.${process.pid}`;
    const idsTmp = `${idsPath}.tmp.${process.pid}`;
    await writeFile(binTmp, Buffer.from(this.buffer));
    await writeFile(idsTmp, JSON.stringify(ids));
    await rename(binTmp, binPath);
    await rename(idsTmp, idsPath);
  }

  /**
   * Load from disk. Reads entire binary file into memory.
   * @param {string} binPath - Path to binary file
   * @returns {boolean} true if loaded successfully
   */
  async load(binPath) {
    if (!existsSync(binPath)) return false;

    const idsPath = binPath.replace(/\.bin$/, '.ids.json');
    if (!existsSync(idsPath)) return false;

    // Read binary
    const fileBuffer = await readFile(binPath);
    this.buffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    );

    // Parse header
    const header = new DataView(this.buffer, 0, HEADER_SIZE);
    const magic = header.getUint32(0, true);
    if (magic !== MAGIC) throw new Error(`FloatVectorStore: bad magic 0x${magic.toString(16)}`);

    const version = header.getUint32(4, true);
    if (version !== VERSION) throw new Error(`FloatVectorStore: unsupported version ${version}`);

    this.dimension = header.getUint32(8, true);
    this.count = header.getUint32(12, true);

    // Map data section
    this.data = new Float32Array(this.buffer, HEADER_SIZE, this.count * this.dimension);

    // Read ID map
    const idsJson = await readFile(idsPath, 'utf-8');
    const ids = JSON.parse(idsJson);

    // Reject a torn binary/ID-map pair (e.g. a crash between the two atomic
    // renames in save()). A mismatched count means the index→ID mapping would
    // be wrong; refuse to load so Stage 2.5 falls back to SQLite instead.
    if (ids.length !== this.count) {
      this.buffer = null;
      this.data = null;
      this.count = 0;
      return false;
    }

    this.idToIndex = new Map();
    for (let i = 0; i < ids.length; i++) {
      this.idToIndex.set(ids[i], i);
    }

    this.loaded = true;
    return true;
  }

  /**
   * Load an existing store, or initialise an empty mutable one at the given
   * dimension when no store exists on disk yet. Used by the incremental
   * reconcile path so the first add after an empty baseline produces a real
   * float store rather than relying on the SQLite fallback.
   *
   * When a store loads, its on-disk dimension wins (it is authoritative for
   * the vectors already stored); `dimension` only seeds a fresh empty store.
   *
   * @param {string} binPath
   * @param {number} dimension
   * @returns {Promise<boolean>} true if an existing store was loaded, false if initialised empty
   */
  async loadOrInit(binPath, dimension) {
    let loaded = false;
    try {
      loaded = await this.load(binPath);
    } catch {
      loaded = false; // corrupt/torn store → treat as empty and rebuild from delta
    }
    if (loaded) return true;

    this.dimension = dimension;
    this.count = 0;
    this.idToIndex = new Map();
    this.data = new Float32Array(0);
    this.buffer = null;
    this.loaded = true;
    return false;
  }

  /**
   * Apply incremental upserts/removes and rebuild the contiguous buffer.
   *
   * Writer-side only (the reconcile maintainer). The read hot path
   * (get/batchScore over the contiguous buffer) is untouched; readers reload
   * the rebuilt store from disk after the manifest publishes.
   *
   * Upserts replace any existing vector for the same ID. Removes drop the ID.
   * The rebuilt buffer preserves no particular order — IDs are addressed via
   * the idToIndex map, never by position.
   *
   * @param {{upserts?: Array<{id: string, vector: Float32Array|number[]}>, removeIds?: Iterable<string>}} delta
   * @returns {{count: number}}
   */
  applyDelta({ upserts = [], removeIds = [] } = {}) {
    // Materialise current id → vector. Subarrays view the old buffer; build()
    // copies their values into a freshly allocated buffer before the old one
    // is dropped, so the aliasing is safe.
    const entries = new Map();
    if (this.loaded && this.data && this.count > 0) {
      for (const [id, idx] of this.idToIndex) {
        const offset = idx * this.dimension;
        entries.set(id, this.data.subarray(offset, offset + this.dimension));
      }
    }

    for (const id of removeIds) entries.delete(id);
    for (const { id, vector } of upserts) {
      if (!id || !vector) continue;
      entries.set(id, vector);
    }

    const list = [];
    for (const [id, vector] of entries) list.push({ id, vector });
    this.build(list, this.dimension);
    return { count: this.count };
  }

  /**
   * Get a float vector by string ID.
   * @param {string} id
   * @returns {Float32Array|null}
   */
  get(id) {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return null;
    const offset = idx * this.dimension;
    // Return a copy, not a view — prevents callers from corrupting the shared buffer.
    return this.data.slice(offset, offset + this.dimension);
  }

  /**
   * Batch-get float vectors for multiple IDs.
   * @param {string[]} ids
   * @returns {Map<string, Float32Array>}
   */
  batchGet(ids) {
    const result = new Map();
    for (const id of ids) {
      const vec = this.get(id);
      if (vec) result.set(id, vec);
    }
    return result;
  }

  /**
   * Batch dot product of a query against candidates identified by IDs.
   * For L2-normalized vectors (from truncateForHNSW), dot = cosine.
   *
   * Uses subarray views internally (no per-candidate copy) since the
   * vectors are only passed to float32BatchDot and never returned.
   *
   * @param {Float32Array} query - L2-normalized query vector
   * @param {string[]} ids - Candidate chunk IDs
   * @returns {{ scores: Map<string, number>, missing: number }}
   */
  batchScore(query, ids) {
    const candidates = [];
    const validIds = [];
    let missing = 0;

    for (const id of ids) {
      const idx = this.idToIndex.get(id);
      if (idx !== undefined) {
        const offset = idx * this.dimension;
        candidates.push(this.data.subarray(offset, offset + this.dimension));
        validIds.push(id);
      } else {
        missing++;
      }
    }

    if (candidates.length === 0) {
      return { scores: new Map(), missing };
    }

    // For L2-normalized vectors (from truncateForHNSW), dot product = cosine.
    const dotScores = float32BatchDot(query, candidates);
    const scores = new Map();
    for (let i = 0; i < validIds.length; i++) {
      scores.set(validIds[i], dotScores[i]);
    }

    return { scores, missing };
  }

  /** Memory size in MB */
  get memorySizeMB() {
    if (!this.buffer) return 0;
    return (this.buffer.byteLength / (1024 * 1024)).toFixed(2);
  }

  getStats() {
    return {
      loaded: this.loaded,
      count: this.count,
      dimension: this.dimension,
      memorySizeMB: this.memorySizeMB,
    };
  }
}

/**
 * Derive the float vector store path from the binary HNSW index path.
 * e.g., .sweet-search/codebase-binary-hnsw.idx → .sweet-search/codebase-float-vectors.bin
 */
export function getFloatStorePath(binaryHnswPath) {
  const dir = path.dirname(binaryHnswPath);
  return path.join(dir, 'codebase-float-vectors.bin');
}
