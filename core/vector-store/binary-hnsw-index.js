
/**
 * Binary HNSW Index (P0: 32x memory reduction, 10x faster search)
 *
 * Specialized HNSW index for binary vectors using Hamming distance.
 * Part of the 3-stage retrieval pipeline:
 *   Stage 1: Binary HNSW (1000 candidates, ~100μs)
 *   Stage 2: Int8 rescore (100 candidates, ~1ms)
 *   Stage 3: Rerank (top 20 → k)
 *
 * CANONICAL INT8 STORAGE (Workstream H resolution):
 *   Int8 vectors for stage-2 rescoring are stored in this index's .int8.json sidecar.
 *   This file is saved/loaded alongside the binary HNSW index artifacts.
 *   - save(): Writes .int8.json with { id: Int8Array[], ... } format
 *   - load(): Populates this.int8Vectors Map from .int8.json
 *   - getInt8Vector(id): O(1) lookup used by sweet-search.js during stage-2
 *
 *   This is the ONLY source of int8 vectors. The SQLite approach (codebase-int8.db)
 *   was removed as redundant - it was created but never used by search.
 *
 * Reference: https://huggingface.co/blog/embedding-quantization
 *
 * Performance:
 *   - Memory: 32x smaller than float HNSW (512d → 64 bytes)
 *   - Search: ~10x faster (Hamming distance via SIMD-friendly popcount)
 *   - Throughput: ~10,000 queries/sec on 100k vectors
 */

import fs from 'fs/promises';
import {
  existsSync, statSync,
  openSync, readSync, closeSync, fstatSync,
} from 'fs';
import path from 'path';
import { BINARY_HNSW_CONFIG, DB_PATHS } from '../infrastructure/config/index.js';
import {
  floatToBinary,
  asymmetricDocEncode, asymmetricQueryEncode,
  computeCentroid, generateSignVector,
} from '../infrastructure/quantization.js';
import { wasmHammingDistance as hammingDistance } from '../infrastructure/simd-distance.js';
import { TypedMinHeap, TypedMaxHeap, VisitedList } from './binary-heap.js';
import { loadBitmap, isSet } from '../infrastructure/tombstone-bitmap-reader.js';

// Current quantization pipeline version. Bump when the encoding pipeline changes
// (centroid subtraction, rotation, quantization scheme). Indexes built with a
// different version are incompatible and must be rebuilt.
const PIPELINE_VERSION = 2;

// =============================================================================
// G9 — PACKED MMAP FORMAT (gated, NO MIGRATION)
// =============================================================================
//
// The default on-disk format is the JSON sidecar tuple
// (.meta.json / .vectors.json / .graph.json / .int8.json / .calibration.json),
// written by save() and read by load(). That format is preserved BYTE-FOR-BYTE
// when SWEET_SEARCH_HNSW_MMAP !== '1' — this whole subsystem is inert by
// default. Existing on-disk indexes (the 200 bench repos) keep loading via the
// JSON path regardless of the flag: format is detected by inspecting the .idx
// file's magic header (`_indexFormatOnDisk`), never by the flag.
//
// When SWEET_SEARCH_HNSW_MMAP === '1', NEWLY written indexes are packed into a
// single flat-binary `.idx` file (magic-prefixed) whose vectors / graph
// adjacency / int8 sections are laid out so the read/search path can fault in
// only the pages it touches (lazy fd reads → OS page cache). The packed format
// preserves the deterministic levels (G1) and deterministic entry point (FIX-B)
// because those are properties of the in-memory graph/entryPoint that get
// serialized verbatim — packing does not re-run construction.
//
// MMAP_MAGIC is 8 ASCII bytes so a packed file is trivially and cheaply
// distinguishable from a JSON sidecar's `.idx` (which today is never written
// with content — only the sidecars carry data) without parsing.
const MMAP_MAGIC = Buffer.from('SSHNSWP\0', 'ascii'); // 8 bytes
const MMAP_FORMAT_VERSION = 1;

function hnswMmapEnabled() {
  return process.env.SWEET_SEARCH_HNSW_MMAP === '1';
}

/**
 * Lazy, fd-backed graph adjacency for the packed (mmap) read path.
 *
 * Behaves like `graph[level][nodeIndex] -> number[]` (the JSON-loaded shape)
 * but reads each (level, node) neighbor list from the open file descriptor on
 * first touch and caches it, so a cold search faults in only the pages it
 * visits. `?.[idx]` / `.length` / iteration over a returned neighbor list all
 * work identically to a plain array because each level proxies an array-like
 * via numeric-index getters that materialize lazily.
 *
 * The on-disk graph section layout (all little-endian uint32):
 *   [levelCount]
 *   per level: [nodeCount] then nodeCount × [neighborCount, n0, n1, ...]
 * Per-(level,node) byte offsets are precomputed once into a flat index at load
 * so a touch is an O(1) seek + a single readSync of just that list.
 */
class MmapGraphLevel {
  constructor(fd, sectionBase, nodeOffsets, nodeCount) {
    this._fd = fd;
    this._base = sectionBase;
    this._nodeOffsets = nodeOffsets; // Int32Array of byte offsets (relative) per node, -1 if empty
    this._cache = new Array(nodeCount);
    this.length = nodeCount;
  }

  _materialize(i) {
    if (i < 0 || i >= this.length) return undefined;
    const cached = this._cache[i];
    if (cached !== undefined) return cached;
    const rel = this._nodeOffsets[i];
    if (rel < 0) {
      this._cache[i] = [];
      return this._cache[i];
    }
    const head = Buffer.allocUnsafe(4);
    readSync(this._fd, head, 0, 4, this._base + rel);
    const count = head.readUInt32LE(0);
    const list = new Array(count);
    if (count > 0) {
      const body = Buffer.allocUnsafe(count * 4);
      readSync(this._fd, body, 0, count * 4, this._base + rel + 4);
      for (let j = 0; j < count; j += 1) list[j] = body.readUInt32LE(j * 4);
    }
    this._cache[i] = list;
    return list;
  }
}

// Numeric-index access (graph[level][idx]) is the hot path; back each level
// with a Proxy that maps integer keys to lazy materialization and forwards
// `length`. Optional-chaining (`graph[level]?.[idx]`) and `.length` both work.
function makeMmapGraphLevelProxy(level) {
  return new Proxy(level, {
    get(target, prop) {
      if (prop === 'length') return target.length;
      if (typeof prop === 'string') {
        const n = Number(prop);
        if (Number.isInteger(n) && n >= 0) return target._materialize(n);
      }
      return target[prop];
    },
    has(target, prop) {
      if (prop === 'length') return true;
      const n = Number(prop);
      if (Number.isInteger(n) && n >= 0 && n < target.length) return true;
      return prop in target;
    },
  });
}

/**
 * Lazy, fd-backed vectors store for the packed read path.
 *
 * Behaves like `vectors[idx] -> { id, binary, metadata }`. `id` and `metadata`
 * are kept fully resident (they live in the small header JSON, parsed once),
 * but the `binary` Uint8Array is read from the flat vector blob on first touch
 * so cold ticks hold near-zero binary bytes in heap. Each materialized record
 * is cached so repeated touches in a search don't re-read.
 */
class MmapVectorStore {
  constructor(fd, blobBase, dimension, ids, metas) {
    this._fd = fd;
    this._base = blobBase;
    this._dim = dimension;
    this._ids = ids;       // string[]
    this._metas = metas;   // object[]
    this._cache = new Array(ids.length);
    this.length = ids.length;
  }

  _materialize(i) {
    if (i < 0 || i >= this.length) return undefined;
    const cached = this._cache[i];
    if (cached !== undefined) return cached;
    const buf = Buffer.allocUnsafe(this._dim);
    readSync(this._fd, buf, 0, this._dim, this._base + i * this._dim);
    // Copy into a standalone Uint8Array so callers (hammingDistance) see a
    // tight, stable view independent of the scratch Buffer.
    const binary = new Uint8Array(this._dim);
    binary.set(buf);
    const rec = { id: this._ids[i], binary, metadata: this._metas[i] };
    this._cache[i] = rec;
    return rec;
  }
}

function makeMmapVectorProxy(store) {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'length') return target.length;
      if (typeof prop === 'string') {
        const n = Number(prop);
        if (Number.isInteger(n) && n >= 0) return target._materialize(n);
      }
      return target[prop];
    },
    has(target, prop) {
      if (prop === 'length') return true;
      const n = Number(prop);
      if (Number.isInteger(n) && n >= 0 && n < target.length) return true;
      return prop in target;
    },
  });
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

    // Storage
    this.vectors = [];           // Array of { id, binary: Uint8Array, metadata }
    this.idToIndex = new Map();  // id → array index
    this.initialized = false;

    // For int8 rescoring
    this.int8Vectors = new Map(); // id → Int8Array

    // Graph structure (simplified HNSW for pure JS)
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

    // G9 mmap: set when this instance is backed by an open, packed .idx fd
    // (loadMmap). `vectors`/`graph` are then lazy proxies and the index is
    // read/search-only. Null/false on the default JSON path.
    this._mmapBacked = false;
    this._mmapFd = null;
  }

  /** Reset to empty state for a fresh build (skips loading from disk). */
  resetForBuild() {
    this._closeMmap();
    this.vectors = [];
    this.idToIndex = new Map();
    this.int8Vectors.clear();
    this.graph = [];
    this.entryPoint = -1;
    this.maxLevel = 0;
    this.centroid = null;
    this.signVector = null;
    this.useAsymmetric = false;
    this.initialized = true;
    this._staleBitmapCache = null;
    this._cleanBuild = true;
  }

  /** Close an open packed-file descriptor if this index is mmap-backed. */
  _closeMmap() {
    if (this._mmapFd != null) {
      try { closeSync(this._mmapFd); } catch { /* best-effort */ }
    }
    this._mmapFd = null;
    this._mmapBacked = false;
  }

  _stalePathForIndex(indexPath = this.indexPath) {
    return indexPath === this.indexPath ? this.stalePath : `${indexPath}.stale.bin`;
  }

  /**
   * Initialize the index
   */
  async init() {
    if (this.initialized) return;

    // Try to load an existing index. Detect the on-disk format by inspecting
    // the artifacts (NOT the flag): a JSON sidecar tuple is identified by its
    // .meta.json descriptor; a packed (mmap) index is identified by the magic
    // header on the .idx file itself. Old indexes always take the JSON path
    // regardless of SWEET_SEARCH_HNSW_MMAP (no migration, ever).
    const metaPath = this.indexPath.replace('.idx', '.meta.json');
    const onDisk = _indexFormatOnDisk(this.indexPath);
    if (onDisk === 'packed') {
      try {
        await this.load(); // load() routes to loadMmap() for packed files
        this.initialized = true;
        return;
      } catch (err) {
        console.log(`BinaryHNSW: Failed to load packed index, creating new: ${err.message}`);
      }
    } else if (existsSync(metaPath)) {
      try {
        await this.load();
        this.initialized = true;
        return;
      } catch (err) {
        console.log(`BinaryHNSW: Failed to load, creating new index: ${err.message}`);
      }
    }

    this.vectors = [];
    this.idToIndex = new Map();
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
  async add(id, binaryVector, metadata = {}, int8Vector = null) {
    await this.init();

    // The packed (mmap) layout is a read/search-only representation: `vectors`
    // and `graph` are lazy fd-backed proxies, not mutable plain arrays. Build
    // paths must construct on plain arrays and persist via save()/saveMmap().
    // Mutating a packed-loaded index would silently corrupt the graph, so fail
    // loudly instead. (This is unreachable on the default path; the reconciler
    // builds in memory and only the read side mmap-loads.)
    if (this._mmapBacked) {
      throw new Error(
        'BinaryHNSW: cannot add() to an mmap-backed (packed) index — '
        + 'it is a read/search-only view. Rebuild on a fresh in-memory index.'
      );
    }

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

    // Check if already exists
    if (this.idToIndex.has(id)) {
      const idx = this.idToIndex.get(id);
      this.vectors[idx] = { id, binary, metadata };
      if (int8Vector) {
        this.int8Vectors.set(id, int8Vector);
      }
      return idx;
    }

    // Add new vector
    const idx = this.vectors.length;
    this.vectors.push({ id, binary, metadata });
    this.idToIndex.set(id, idx);

    if (int8Vector) {
      this.int8Vectors.set(id, int8Vector);
    }

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

  /**
   * Heuristic neighbor selection (Algorithm 4, Malkov & Yashunin 2016).
   * Selects diverse neighbors that cover different angular directions,
   * avoiding clusters of nearby nodes pointing at each other.
   */
  selectNeighborsHeuristic(nodeIdx, candidates, maxM) {
    const selected = [];
    const nodeBinary = this.vectors[nodeIdx].binary;

    // Sort candidates by distance ascending
    candidates.sort((a, b) => a.dist - b.dist);

    for (const candidate of candidates) {
      if (selected.length >= maxM) break;

      // Check if this candidate is closer to any already-selected neighbor
      // than it is to the node itself — if so, it's redundant (same direction)
      let tooClose = false;
      for (const s of selected) {
        const interDist = hammingDistance(
          this.vectors[candidate.idx].binary,
          this.vectors[s.idx].binary
        );
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
    const idA = String(this.vectors[idxA].id);
    const idB = String(this.vectors[idxB].id);
    return idA <= idB ? idxA : idxB;
  }

  /**
   * Add node to HNSW graph.
   * Uses heuristic selection + level-aware M0=2*M.
   */
  addToGraph(idx, level) {
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
      const selectedNeighbors = this.selectNeighborsHeuristic(idx, neighbors, maxM);

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
    const targetBinary = this.vectors[targetIdx].binary;
    let currentNode = startNode;
    let currentDist = hammingDistance(this.vectors[currentNode].binary, targetBinary);

    let improved = true;
    while (improved) {
      improved = false;
      const neighbors = this.graph[level]?.[currentNode] || [];

      for (const neighborIdx of neighbors) {
        const neighborDist = hammingDistance(this.vectors[neighborIdx].binary, targetBinary);
        if (neighborDist < currentDist) {
          currentNode = neighborIdx;
          currentDist = neighborDist;
          improved = true;
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
    const targetBinary = this.vectors[targetIdx].binary;
    const visited = this._visitedList;
    visited.ensureCapacity(this.vectors.length);
    visited.reset();
    visited.mark(startNode);

    const startDist = hammingDistance(this.vectors[startNode].binary, targetBinary);

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

      const neighbors = this.graph[level]?.[currentIdx] || [];
      for (let i = 0; i < neighbors.length; i++) {
        const neighborIdx = neighbors[i];
        if (visited.isVisited(neighborIdx)) continue;
        visited.mark(neighborIdx);

        const dist = hammingDistance(this.vectors[neighborIdx].binary, targetBinary);

        if (results.size < ef) {
          candidates.insert(neighborIdx, dist);
          results.insert(neighborIdx, dist);
        } else if (dist < results.peekVal()) {
          candidates.insert(neighborIdx, dist);
          results.replaceMax(neighborIdx, dist);
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
    const neighbors = this.graph[level][nodeIdx];
    const nodeBinary = this.vectors[nodeIdx].binary;
    const maxM = this.getMaxM(level);

    const withDist = neighbors.map(idx => ({
      idx,
      dist: hammingDistance(this.vectors[idx].binary, nodeBinary),
    }));

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
  async search(queryVector, k = 10, opts = {}) {
    await this.init();

    const start = performance.now();
    const staleBitmap = this._loadStaleBitmap();

    if (this.vectors.length === 0) {
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
    let currentNode = this.entryPoint;

    for (let l = this.maxLevel; l >= 1; l--) {
      currentNode = this.greedySearchQuery(currentNode, queryBinary, l);
    }

    // Adaptive ef: easy queries get a smaller budget, hard queries get more
    let ef = Math.max(this._oversampleTarget(k, staleBitmap), this.efSearch);
    const greedyDist = hammingDistance(this.vectors[currentNode].binary, queryBinary);
    const maxDist = this.dimension * 8;
    const greedyQuality = 1 - (greedyDist / maxDist);
    if (greedyQuality > 0.85) {
      ef = Math.max(this._oversampleTarget(k, staleBitmap), Math.round(ef * 0.6));
    } else if (greedyQuality < 0.55) {
      ef = Math.round(ef * 1.5);
    }

    // Level 0 search — pure Hamming, no asymmetric in the traversal loop
    const searchResult = this.searchLayerQuery(currentNode, queryBinary, ef, 0);
    let candidates = searchResult.candidates;

    candidates = candidates.filter(c => !this._isIndexStale(c.idx, staleBitmap));
    if (candidates.length < k && ef < this.vectors.length) {
      const retryEf = Math.min(this.vectors.length, ef * 2);
      if (retryEf > ef) {
        const retry = this.searchLayerQuery(currentNode, queryBinary, retryEf, 0);
        candidates = retry.candidates.filter(c => !this._isIndexStale(c.idx, staleBitmap));
      }
    }

    // Return top k
    const results = candidates.slice(0, k).map(c => ({
      id: this.vectors[c.idx].id,
      score: 1 - (c.dist / maxDist),
      hammingDistance: c.dist,
      metadata: this.vectors[c.idx].metadata,
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

  _loadStaleBitmap() {
    if (!existsSync(this.stalePath)) {
      this._staleBitmapCache = null;
      return null;
    }
    let stat;
    try {
      stat = statSync(this.stalePath, { bigint: true });
    } catch {
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
    if (!bitmap) return this.vectors.length;
    let live = 0;
    for (let i = 0; i < this.vectors.length; i++) {
      if (!this._isIndexStale(i, bitmap)) live++;
    }
    return live;
  }

  _oversampleTarget(k, bitmap) {
    if (!bitmap) return k;
    const live = this._liveVectorCount(bitmap);
    const tombstoned = Math.max(0, this.vectors.length - live);
    if (tombstoned === 0) return k;
    const s = Math.max(0, Math.min(tombstoned / Math.max(1, this.vectors.length), 0.5));
    return Math.min(Math.max(k + 64, Math.ceil(k / Math.max(0.05, 1 - s) * 2)), k * 20);
  }

  /**
   * Greedy search for query vector
   */
  greedySearchQuery(startNode, queryBinary, level) {
    let currentNode = startNode;
    let currentDist = hammingDistance(this.vectors[currentNode].binary, queryBinary);

    let improved = true;
    while (improved) {
      improved = false;
      const neighbors = this.graph[level]?.[currentNode] || [];

      for (const neighborIdx of neighbors) {
        const neighborDist = hammingDistance(this.vectors[neighborIdx].binary, queryBinary);
        if (neighborDist < currentDist) {
          currentNode = neighborIdx;
          currentDist = neighborDist;
          improved = true;
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
    const visited = this._visitedList;
    visited.ensureCapacity(this.vectors.length);
    visited.reset();
    visited.mark(startNode);

    const startDist = hammingDistance(this.vectors[startNode].binary, queryBinary);
    const candidates = this._candHeap;
    candidates.clear();
    const results = this._resHeap;
    results.clear();
    candidates.insert(startNode, startDist);
    results.insert(startNode, startDist);

    const etConfig = BINARY_HNSW_CONFIG.earlyTermination || {};
    const windowSize = etConfig.windowSize || 16;
    const etThresholds = etConfig.thresholds || [[0.3, 0.05], [0.6, 0.10]];
    let visitedCount = 0;
    let recentDiscoveries = 0;
    let recentVisits = 0;

    while (candidates.size > 0) {
      if (results.size >= ef && candidates.peekVal() > results.peekVal()) break;

      const currentIdx = candidates.extractMin();
      visitedCount++;

      const neighbors = this.graph[level]?.[currentIdx] || [];
      let foundNew = false;
      for (let i = 0; i < neighbors.length; i++) {
        const neighborIdx = neighbors[i];
        if (visited.isVisited(neighborIdx)) continue;
        visited.mark(neighborIdx);

        const dist = hammingDistance(this.vectors[neighborIdx].binary, queryBinary);

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
    await this.init();

    const results = [];
    for (const item of items) {
      const idx = await this.add(item.id, item.binary || item.vector, item.metadata, item.int8);
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
    return this.int8Vectors.get(id);
  }

  /**
   * Save index to disk.
   *
   * Publish semantics: every sidecar is written to a sibling
   * `<path>.tmp.<pid>` then atomically renamed into its canonical
   * name. Cross-process readers loading the index never observe a
   * torn `(meta, vectors, graph, int8)` tuple — POSIX `rename` is
   * atomic per-file, and the publish order below puts the
   * descriptor (`.meta.json`) LAST so that any reader that observes
   * the new meta.json is guaranteed to read the matching data
   * sidecars alongside it.
   *
   * The brief window between data renames remains: a reader can
   * still observe `(NEW vectors, OLD graph)` for a few microseconds.
   * The size of the rebuilt index makes this window negligible on
   * the existing single-writer process model; a deeper fix would
   * publish all sidecars via a single packaged artifact under
   * versioned manifest paths.
   */
  async save(indexPath = this.indexPath) {
    // G9 gate. Default OFF → the JSON-sidecar writer below runs UNCHANGED, so
    // every existing index keeps its exact byte format and there is no
    // migration. ONLY when SWEET_SEARCH_HNSW_MMAP === '1' do NEW writes pack
    // into the mmap-friendly flat-binary .idx (a distinct on-disk format with
    // its own magic/version). The deterministic levels (G1) and entry point
    // (FIX-B) live in `this.graph`/`this.entryPoint`, which both writers
    // serialize verbatim — packing preserves them.
    if (hnswMmapEnabled()) {
      return this.saveMmap(indexPath);
    }

    await fs.mkdir(path.dirname(indexPath), { recursive: true });

    const meta = {
      dimension: this.dimension,
      floatDimension: this.floatDimension,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      maxElements: this.maxElements,
      vectorCount: this.vectors.length,
      maxLevel: this.maxLevel,
      entryPoint: this.entryPoint,
      useAsymmetric: this.useAsymmetric,
      pipelineVersion: PIPELINE_VERSION,
      savedAt: new Date().toISOString(),
    };

    const vectorsData = this.vectors.map(v => ({
      id: v.id,
      binary: Array.from(v.binary),
      metadata: v.metadata,
    }));

    const metaPath = indexPath.replace('.idx', '.meta.json');
    const vectorsPath = indexPath.replace('.idx', '.vectors.json');
    const graphPath = indexPath.replace('.idx', '.graph.json');
    const int8Path = indexPath.replace('.idx', '.int8.json');
    const calibPath = indexPath.replace('.idx', '.calibration.json');
    const pidSuffix = `.tmp.${process.pid}`;

    // Stage all sidecars to sibling temp paths.
    await fs.writeFile(metaPath + pidSuffix, JSON.stringify(meta, null, 2));
    await fs.writeFile(vectorsPath + pidSuffix, JSON.stringify(vectorsData));
    await fs.writeFile(graphPath + pidSuffix, JSON.stringify(this.graph));

    let stagedInt8 = false;
    if (this.int8Vectors.size > 0) {
      const liveIds = new Set(this.vectors.map(v => v.id));
      const int8Data = {};
      for (const [id, vec] of this.int8Vectors) {
        if (!liveIds.has(id)) continue;
        int8Data[id] = Array.from(vec);
      }
      if (Object.keys(int8Data).length > 0) {
        await fs.writeFile(int8Path + pidSuffix, JSON.stringify(int8Data));
        stagedInt8 = true;
      }
    }

    let stagedCalib = false;
    if (this.useAsymmetric && this.centroid && this.signVector) {
      await fs.writeFile(calibPath + pidSuffix, JSON.stringify({
        centroid: Array.from(this.centroid),
        signVector: Array.from(this.signVector),
      }));
      stagedCalib = true;
    }

    // Atomic publish in safety order: data sidecars first, descriptor
    // (.meta.json) LAST. Optional sidecars without staged content are
    // unlinked from the canonical path so the canonical state matches
    // the staged tuple exactly.
    await fs.rename(vectorsPath + pidSuffix, vectorsPath);
    await fs.rename(graphPath + pidSuffix, graphPath);
    if (stagedInt8) await fs.rename(int8Path + pidSuffix, int8Path);
    else await fs.rm(int8Path, { force: true });
    if (stagedCalib) await fs.rename(calibPath + pidSuffix, calibPath);
    else await fs.rm(calibPath, { force: true });
    await fs.rename(metaPath + pidSuffix, metaPath);

    if (this._cleanBuild) {
      await fs.rm(this._stalePathForIndex(indexPath), { force: true });
      this._staleBitmapCache = null;
      this._cleanBuild = false;
    }

    console.log(`BinaryHNSW: Saved ${this.vectors.length} vectors to ${indexPath} (asymmetric=${this.useAsymmetric})`);
  }

  /**
   * Load index from disk.
   *
   * Torn-publish handling: `save()` publishes data sidecars and
   * `.meta.json` via separate atomic renames. A reader that opens the
   * index in the microsecond window between renames can observe a torn
   * `(meta, vectors)` pair where `meta.entryPoint` references an index
   * past `vectors.length`. The first `search()` call would then
   * `TypeError` on `this.vectors[entryPoint].binary`. To keep fresh
   * readers crash-free we re-read the pair up to three times on
   * `(vectorCount, entryPoint)` inconsistency — the publish window
   * closes in microseconds so a brief retry self-heals it. A persistent
   * mismatch surfaces as an explicit load error rather than a deferred
   * search crash.
   */
  async load(indexPath = this.indexPath) {
    // Route by DETECTED on-disk format, never by the flag: a packed .idx
    // (magic header) is read via the mmap path even with the flag off, and a
    // JSON-sidecar index is read via the JSON path even with the flag on. This
    // is what lets old and new coexist with zero migration.
    if (_indexFormatOnDisk(indexPath) === 'packed') {
      return this.loadMmap(indexPath);
    }

    const metaPath = indexPath.replace('.idx', '.meta.json');
    const vectorsPath = indexPath.replace('.idx', '.vectors.json');
    const graphPath = indexPath.replace('.idx', '.graph.json');
    const int8Path = indexPath.replace('.idx', '.int8.json');

    if (!existsSync(metaPath)) {
      throw new Error(`Index metadata not found: ${metaPath}`);
    }

    // Validate pipeline version first — a stale on-disk artifact from a
    // previous quantization scheme is a callable-level error, not a
    // torn-publish race, and the caller needs the specific message to
    // route to the rebuild path.
    const initialMeta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    const storedVersion = initialMeta.pipelineVersion || 1;
    if (storedVersion !== PIPELINE_VERSION) {
      throw new Error(
        `Pipeline version mismatch: index=${storedVersion}, current=${PIPELINE_VERSION}. ` +
        `Index must be rebuilt (quantization pipeline changed).`
      );
    }

    let meta;
    let vectorsData;
    let attempt = 0;
    while (true) {
      meta = attempt === 0 ? initialMeta : JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      vectorsData = JSON.parse(await fs.readFile(vectorsPath, 'utf-8'));
      const consistent = meta.vectorCount === vectorsData.length
        && (meta.entryPoint === -1 || meta.entryPoint < vectorsData.length);
      if (consistent) break;
      if (attempt >= 2) {
        throw new Error(
          `BinaryHNSW: persistent meta/vectors inconsistency at ${indexPath} ` +
          `(meta.vectorCount=${meta.vectorCount}, vectors.length=${vectorsData.length}, ` +
          `entryPoint=${meta.entryPoint})`
        );
      }
      // Brief delay to let an in-flight save() finish its second rename.
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
      attempt += 1;
    }

    this.dimension = meta.dimension;
    this.floatDimension = meta.floatDimension;
    this.M = meta.M;
    this.efConstruction = meta.efConstruction;
    this.efSearch = meta.efSearch;
    this.maxLevel = meta.maxLevel;
    this.entryPoint = meta.entryPoint;
    this.useAsymmetric = meta.useAsymmetric || false;
    this.centroid = null;
    this.signVector = null;

    // Vectors already read above as part of the consistency probe.
    this.vectors = vectorsData.map(v => ({
      id: v.id,
      binary: new Uint8Array(v.binary),
      metadata: v.metadata,
    }));

    // Rebuild id map
    this.idToIndex.clear();
    for (let i = 0; i < this.vectors.length; i++) {
      this.idToIndex.set(this.vectors[i].id, i);
    }

    // Load graph
    this.graph = JSON.parse(await fs.readFile(graphPath, 'utf-8'));

    // Load int8 vectors if available
    this.int8Vectors.clear();
    if (existsSync(int8Path)) {
      const int8Data = JSON.parse(await fs.readFile(int8Path, 'utf-8'));
      for (const [id, vec] of Object.entries(int8Data)) {
        this.int8Vectors.set(id, new Int8Array(vec));
      }
    }

    // Load asymmetric calibration data
    const calibPath = indexPath.replace('.idx', '.calibration.json');
    if (this.useAsymmetric && existsSync(calibPath)) {
      const calibData = JSON.parse(await fs.readFile(calibPath, 'utf-8'));
      this.centroid = new Float32Array(calibData.centroid);
      this.signVector = new Float32Array(calibData.signVector);
    }

    // Resize visited list to actual vector count
    this._visitedList.ensureCapacity(this.vectors.length);

    this.initialized = true;
    console.log(`BinaryHNSW: Loaded ${this.vectors.length} vectors from ${indexPath} (asymmetric=${this.useAsymmetric})`);
  }

  /**
   * Save the index in the packed, mmap-friendly flat-binary format (G9).
   *
   * Activated only via save() under SWEET_SEARCH_HNSW_MMAP === '1'. The whole
   * index is serialized into a SINGLE `.idx` file (so the read path can fault
   * in only touched pages) and the legacy JSON sidecars for this path are
   * removed so a stale JSON descriptor can never shadow the packed file. The
   * graph + entryPoint are written verbatim, preserving G1/FIX-B determinism.
   *
   * On-disk layout (all integers little-endian):
   *   magic(8) | formatVersion(u32) | headerLen(u32) | header(JSON utf-8) | sections...
   * The header JSON carries the meta fields, the id/metadata arrays, the
   * asymmetric calibration (inlined — small), and { offset, len } descriptors
   * for the three binary sections (vectors, graph, int8), each section offset
   * being relative to the start of the section region (right after the header).
   *
   * Publish is atomic: write to `<path>.tmp.<pid>` then rename over `<path>`.
   */
  async saveMmap(indexPath = this.indexPath) {
    await fs.mkdir(path.dirname(indexPath), { recursive: true });

    const dim = this.dimension;
    const n = this.vectors.length;

    // --- Section 1: vectors blob (flat n*dim bytes) ---
    const vectorsBlob = Buffer.allocUnsafe(n * dim);
    const ids = new Array(n);
    const metas = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const v = this.vectors[i];
      ids[i] = v.id;
      metas[i] = v.metadata;
      vectorsBlob.set(v.binary, i * dim);
    }

    // --- Section 2: graph blob ---
    // [levelCount] then per level [nodeCount] then per node [count, n0, n1...]
    const graphParts = [];
    const lvlHead = Buffer.allocUnsafe(4);
    lvlHead.writeUInt32LE(this.graph.length, 0);
    graphParts.push(lvlHead);
    for (let l = 0; l < this.graph.length; l += 1) {
      const level = this.graph[l] || [];
      const nodeHead = Buffer.allocUnsafe(4);
      nodeHead.writeUInt32LE(level.length, 0);
      graphParts.push(nodeHead);
      for (let i = 0; i < level.length; i += 1) {
        const neighbors = level[i] || [];
        const buf = Buffer.allocUnsafe(4 + neighbors.length * 4);
        buf.writeUInt32LE(neighbors.length, 0);
        for (let j = 0; j < neighbors.length; j += 1) {
          buf.writeUInt32LE(neighbors[j], 4 + j * 4);
        }
        graphParts.push(buf);
      }
    }
    const graphBlob = Buffer.concat(graphParts);

    // --- Section 3: int8 blob (only live ids, matching JSON save() semantics) ---
    // [entryCount] then per entry [idIndex(u32), len(u32), bytes...]
    const liveIds = new Set(ids);
    const int8Parts = [];
    const idToIdx = new Map();
    for (let i = 0; i < n; i += 1) idToIdx.set(ids[i], i);
    let int8Count = 0;
    const int8Body = [];
    for (const [id, vec] of this.int8Vectors) {
      if (!liveIds.has(id)) continue;
      const idIndex = idToIdx.get(id);
      if (idIndex === undefined) continue;
      const entry = Buffer.allocUnsafe(8 + vec.length);
      entry.writeUInt32LE(idIndex, 0);
      entry.writeUInt32LE(vec.length, 4);
      // Int8Array → bytes (two's complement, identical layout)
      Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).copy(entry, 8);
      int8Body.push(entry);
      int8Count += 1;
    }
    const int8Head = Buffer.allocUnsafe(4);
    int8Head.writeUInt32LE(int8Count, 0);
    int8Parts.push(int8Head, ...int8Body);
    const int8Blob = Buffer.concat(int8Parts);

    // --- Header ---
    let vOff = 0;
    const gOff = vOff + vectorsBlob.length;
    const iOff = gOff + graphBlob.length;
    const header = {
      magic: 'SSHNSWP',
      formatVersion: MMAP_FORMAT_VERSION,
      dimension: this.dimension,
      floatDimension: this.floatDimension,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      maxElements: this.maxElements,
      vectorCount: n,
      maxLevel: this.maxLevel,
      entryPoint: this.entryPoint,
      useAsymmetric: this.useAsymmetric,
      pipelineVersion: PIPELINE_VERSION,
      savedAt: new Date().toISOString(),
      ids,
      metas,
      calibration: (this.useAsymmetric && this.centroid && this.signVector)
        ? { centroid: Array.from(this.centroid), signVector: Array.from(this.signVector) }
        : null,
      sections: {
        vectors: { offset: vOff, len: vectorsBlob.length },
        graph: { offset: gOff, len: graphBlob.length },
        int8: { offset: iOff, len: int8Blob.length },
      },
    };
    const headerBuf = Buffer.from(JSON.stringify(header), 'utf-8');
    const prefix = Buffer.allocUnsafe(MMAP_MAGIC.length + 8);
    MMAP_MAGIC.copy(prefix, 0);
    prefix.writeUInt32LE(MMAP_FORMAT_VERSION, MMAP_MAGIC.length);
    prefix.writeUInt32LE(headerBuf.length, MMAP_MAGIC.length + 4);

    const full = Buffer.concat([prefix, headerBuf, vectorsBlob, graphBlob, int8Blob]);

    const tmpPath = `${indexPath}.tmp.${process.pid}`;
    await fs.writeFile(tmpPath, full);
    await fs.rename(tmpPath, indexPath);

    // Retire any legacy JSON sidecars at this path so a stale descriptor can
    // never shadow the packed file on the next load. This is NOT a migration
    // of other indexes — it only cleans up the path we just wrote.
    await Promise.all([
      fs.rm(indexPath.replace('.idx', '.meta.json'), { force: true }),
      fs.rm(indexPath.replace('.idx', '.vectors.json'), { force: true }),
      fs.rm(indexPath.replace('.idx', '.graph.json'), { force: true }),
      fs.rm(indexPath.replace('.idx', '.int8.json'), { force: true }),
      fs.rm(indexPath.replace('.idx', '.calibration.json'), { force: true }),
    ]);

    if (this._cleanBuild) {
      await fs.rm(this._stalePathForIndex(indexPath), { force: true });
      this._staleBitmapCache = null;
      this._cleanBuild = false;
    }

    console.log(`BinaryHNSW: Saved ${n} vectors to ${indexPath} (packed/mmap, asymmetric=${this.useAsymmetric})`);
  }

  /**
   * Load a packed (mmap) index for read/search (G9).
   *
   * Keeps the `.idx` file descriptor OPEN and backs `vectors`/`graph` with
   * lazy fd-readers so a cold tick faults in only the pages a search visits
   * (touched-pages-only, near-zero heap until traversed). The header (ids,
   * metadata, calibration, section offsets) is small and parsed eagerly. The
   * resulting in-memory graph/entryPoint are byte-equivalent to what a
   * JSON-sidecar build of the same ids would hold, so search results are
   * identical.
   */
  async loadMmap(indexPath = this.indexPath) {
    this._closeMmap();
    const fd = openSync(indexPath, 'r');
    try {
      const stat = fstatSync(fd);
      const prefix = Buffer.allocUnsafe(MMAP_MAGIC.length + 8);
      readSync(fd, prefix, 0, prefix.length, 0);
      if (!prefix.subarray(0, MMAP_MAGIC.length).equals(MMAP_MAGIC)) {
        throw new Error(`BinaryHNSW: not a packed index (bad magic): ${indexPath}`);
      }
      const fmt = prefix.readUInt32LE(MMAP_MAGIC.length);
      if (fmt !== MMAP_FORMAT_VERSION) {
        throw new Error(
          `BinaryHNSW: packed format version mismatch: file=${fmt}, current=${MMAP_FORMAT_VERSION}.`
        );
      }
      const headerLen = prefix.readUInt32LE(MMAP_MAGIC.length + 4);
      const headerBuf = Buffer.allocUnsafe(headerLen);
      readSync(fd, headerBuf, 0, headerLen, prefix.length);
      const header = JSON.parse(headerBuf.toString('utf-8'));

      const storedVersion = header.pipelineVersion || 1;
      if (storedVersion !== PIPELINE_VERSION) {
        throw new Error(
          `Pipeline version mismatch: index=${storedVersion}, current=${PIPELINE_VERSION}. `
          + 'Index must be rebuilt (quantization pipeline changed).'
        );
      }

      this.dimension = header.dimension;
      this.floatDimension = header.floatDimension;
      this.M = header.M;
      this.efConstruction = header.efConstruction;
      this.efSearch = header.efSearch;
      this.maxElements = header.maxElements;
      this.maxLevel = header.maxLevel;
      this.entryPoint = header.entryPoint;
      this.useAsymmetric = header.useAsymmetric || false;
      this.centroid = null;
      this.signVector = null;
      if (this.useAsymmetric && header.calibration) {
        this.centroid = new Float32Array(header.calibration.centroid);
        this.signVector = new Float32Array(header.calibration.signVector);
      }

      const sectionsBase = prefix.length + headerLen;
      const sec = header.sections;
      const n = header.vectorCount;
      const ids = header.ids;
      const metas = header.metas;

      // Consistency probe mirroring the JSON load() invariant.
      if (ids.length !== n || (this.entryPoint !== -1 && this.entryPoint >= n)) {
        throw new Error(
          `BinaryHNSW: packed index inconsistency at ${indexPath} `
          + `(vectorCount=${n}, ids=${ids.length}, entryPoint=${this.entryPoint})`
        );
      }

      // id → index map (resident; needed by getInt8Vector and searches).
      this.idToIndex.clear();
      for (let i = 0; i < n; i += 1) this.idToIndex.set(ids[i], i);

      // Lazy vectors store (binary bytes faulted in per touch).
      const vectorStore = new MmapVectorStore(
        fd, sectionsBase + sec.vectors.offset, this.dimension, ids, metas
      );
      this.vectors = makeMmapVectorProxy(vectorStore);

      // Build the per-(level,node) offset table for the graph section so each
      // touch is an O(1) seek. We read the section's structural integers once
      // (small relative to the neighbor bodies); neighbor LISTS stay on disk
      // until touched.
      const graphBase = sectionsBase + sec.graph.offset;
      const graphLevels = this._buildMmapGraphOffsets(fd, graphBase, sec.graph.len);
      this.graph = graphLevels;

      // int8 vectors: small Int8Arrays, read eagerly into the resident Map
      // (getInt8Vector is an O(1) Map lookup on the hot rescore path; keeping
      // them resident matches the JSON path and avoids per-lookup seeks).
      this.int8Vectors.clear();
      if (sec.int8 && sec.int8.len >= 4) {
        const int8Base = sectionsBase + sec.int8.offset;
        const head = Buffer.allocUnsafe(4);
        readSync(fd, head, 0, 4, int8Base);
        const entryCount = head.readUInt32LE(0);
        let cursor = int8Base + 4;
        for (let e = 0; e < entryCount; e += 1) {
          const eh = Buffer.allocUnsafe(8);
          readSync(fd, eh, 0, 8, cursor);
          const idIndex = eh.readUInt32LE(0);
          const len = eh.readUInt32LE(4);
          const body = Buffer.allocUnsafe(len);
          readSync(fd, body, 0, len, cursor + 8);
          const vec = new Int8Array(len);
          for (let b = 0; b < len; b += 1) vec[b] = body.readInt8(b);
          this.int8Vectors.set(ids[idIndex], vec);
          cursor += 8 + len;
        }
      }

      this._mmapFd = fd;
      this._mmapBacked = true;
      this._visitedList.ensureCapacity(n);
      this.initialized = true;

      // Touch the file size to keep the consistency contract auditable.
      void stat.size;
      console.log(`BinaryHNSW: Loaded ${n} vectors from ${indexPath} (packed/mmap, asymmetric=${this.useAsymmetric})`);
    } catch (err) {
      try { closeSync(fd); } catch { /* best-effort */ }
      this._mmapFd = null;
      this._mmapBacked = false;
      throw err;
    }
  }

  /**
   * Scan the graph section's structural integers once and build a flat
   * per-(level,node) byte-offset table, returning an array of lazy level
   * proxies. Only the [levelCount]/[nodeCount]/[neighborCount] integers are
   * read here; the neighbor id lists themselves remain on disk until a level
   * proxy materializes a node on touch.
   */
  _buildMmapGraphOffsets(fd, base, sectionLen) {
    const lvlHead = Buffer.allocUnsafe(4);
    readSync(fd, lvlHead, 0, 4, base);
    const levelCount = lvlHead.readUInt32LE(0);
    let cursor = 4; // relative to base
    const levels = new Array(levelCount);
    const four = Buffer.allocUnsafe(4);
    for (let l = 0; l < levelCount; l += 1) {
      readSync(fd, four, 0, 4, base + cursor);
      const nodeCount = four.readUInt32LE(0);
      cursor += 4;
      const nodeOffsets = new Int32Array(nodeCount);
      for (let i = 0; i < nodeCount; i += 1) {
        // Record this node's neighbor-list offset (points at its [count] word).
        nodeOffsets[i] = cursor;
        readSync(fd, four, 0, 4, base + cursor);
        const neighborCount = four.readUInt32LE(0);
        cursor += 4 + neighborCount * 4;
      }
      const level = new MmapGraphLevel(fd, base, nodeOffsets, nodeCount);
      levels[l] = makeMmapGraphLevelProxy(level);
    }
    if (cursor !== sectionLen) {
      // Structural mismatch → corrupt/truncated section.
      throw new Error(
        `BinaryHNSW: packed graph section length mismatch (read ${cursor}, expected ${sectionLen})`
      );
    }
    return levels;
  }

  /**
   * Get index statistics
   */
  getStats() {
    // On the packed mmap path each `this.graph[l]` is a lazy level proxy, not a
    // real Array, so Array.prototype.filter/reduce are unavailable and walking
    // it would also fault in every neighbor list (defeating mmap). Iterate by
    // index instead, which works for both representations.
    let graphNodes = 0;
    let graphEdges = 0;
    for (let l = 0; l < this.graph.length; l += 1) {
      const level = this.graph[l];
      if (!level) continue;
      for (let i = 0; i < level.length; i += 1) {
        const neighbors = level[i];
        if (neighbors) {
          graphNodes += 1;
          graphEdges += neighbors.length || 0;
        }
      }
    }

    return {
      dimension: this.dimension,
      floatDimension: this.floatDimension,
      totalVectors: this.vectors.length,
      maxElements: this.maxElements,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      maxLevel: this.maxLevel,
      graphLevels: this.graph.length,
      graphNodes,
      graphEdges,
      int8VectorCount: this.int8Vectors.size,
      memorySizeBytes: this.vectors.length * this.dimension, // Just binary vectors
      memorySizeMB: (this.vectors.length * this.dimension / 1024 / 1024).toFixed(2),
    };
  }

  /**
   * Clear all data
   */
  async clear() {
    this._closeMmap();
    this.vectors = [];
    this.idToIndex.clear();
    this.int8Vectors.clear();
    this.graph = [];
    this.entryPoint = -1;
    this.maxLevel = 0;
    await fs.rm(this.stalePath, { force: true });
    this._staleBitmapCache = null;
    this._cleanBuild = false;
  }

  /**
   * Release the packed (mmap) file descriptor, if any. The OS page cache may
   * retain touched pages; this only drops the fd. Safe no-op on the JSON path.
   */
  close() {
    this._closeMmap();
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export async function createBinaryHNSWIndex(options = {}) {
  const index = new BinaryHNSWIndex(options);

  if (options.load !== false && binaryHnswArtifactsExist(options.indexPath || DB_PATHS.binaryHnswIndex)) {
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

function binaryHnswArtifactsExist(indexPath) {
  // A packed (mmap) index is a single .idx file; the JSON format is the sidecar
  // tuple. Either is loadable, so report presence of EITHER. Detection is by
  // on-disk content (magic header) — never the flag — so old + new coexist.
  if (_indexFormatOnDisk(indexPath) === 'packed') return true;
  return existsSync(indexPath.replace('.idx', '.meta.json'))
    && existsSync(indexPath.replace('.idx', '.vectors.json'))
    && existsSync(indexPath.replace('.idx', '.graph.json'));
}

/**
 * Detect the on-disk format of an HNSW index WITHOUT loading it, by content:
 *   - 'packed'  : the `.idx` file exists and begins with the MMAP magic header.
 *   - 'json'    : the JSON-sidecar descriptor (`.meta.json`) exists.
 *   - 'none'    : neither.
 * Reads only the leading magic bytes of the `.idx` (cheap), so the JSON path is
 * chosen for every legacy index regardless of SWEET_SEARCH_HNSW_MMAP — the
 * guarantee that existing on-disk indexes load unchanged with no migration.
 */
function _indexFormatOnDisk(indexPath) {
  try {
    if (existsSync(indexPath)) {
      const st = statSync(indexPath);
      if (st.isFile() && st.size >= MMAP_MAGIC.length) {
        const fd = openSync(indexPath, 'r');
        try {
          const head = Buffer.allocUnsafe(MMAP_MAGIC.length);
          readSync(fd, head, 0, MMAP_MAGIC.length, 0);
          if (head.equals(MMAP_MAGIC)) return 'packed';
        } finally {
          closeSync(fd);
        }
      }
    }
  } catch { /* fall through to JSON detection */ }
  if (existsSync(indexPath.replace('.idx', '.meta.json'))) return 'json';
  return 'none';
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
