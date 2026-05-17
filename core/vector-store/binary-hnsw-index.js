
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
import { existsSync, statSync } from 'fs';
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

    // Asymmetric binary quantization calibration data
    this.centroid = null;       // Float32Array — dataset centroid
    this.signVector = null;     // Float32Array — random ±1 for WHT rotation
    this.useAsymmetric = false; // Enabled after calibration
    this._staleBitmapCache = null;
    this._cleanBuild = false;
  }

  /** Reset to empty state for a fresh build (skips loading from disk). */
  resetForBuild() {
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

  _stalePathForIndex(indexPath = this.indexPath) {
    return indexPath === this.indexPath ? this.stalePath : `${indexPath}.stale.bin`;
  }

  /**
   * Initialize the index
   */
  async init() {
    if (this.initialized) return;

    // Try to load existing index
    const metaPath = this.indexPath.replace('.idx', '.meta.json');
    if (existsSync(metaPath)) {
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
   * Calculate random level for new node (exponential distribution)
   */
  getRandomLevel() {
    const mL = 1 / Math.log(this.M);
    let level = Math.floor(-Math.log(Math.random()) * mL);
    return Math.min(level, 10); // Cap at 10 levels
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

    // Add to HNSW graph
    const level = this.getRandomLevel();
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

    // Update entry point if new level is higher
    if (level > this.maxLevel) {
      this.entryPoint = idx;
      this.maxLevel = level;
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
    const candidates = new TypedMinHeap(ef * 4);
    candidates.insert(startNode, startDist);

    // results = max-heap of size ef (peek furthest, replaceMax when closer found)
    const results = new TypedMaxHeap(ef + 1);
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
    const candidates = new TypedMinHeap(ef * 4);
    const results = new TypedMaxHeap(ef + 1);
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
   * Save index to disk
   */
  async save(indexPath = this.indexPath) {
    await fs.mkdir(path.dirname(indexPath), { recursive: true });

    // Save metadata
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

    const metaPath = indexPath.replace('.idx', '.meta.json');
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    // Save vectors (binary + metadata)
    const vectorsData = this.vectors.map(v => ({
      id: v.id,
      binary: Array.from(v.binary),
      metadata: v.metadata,
    }));

    const vectorsPath = indexPath.replace('.idx', '.vectors.json');
    await fs.writeFile(vectorsPath, JSON.stringify(vectorsData));

    // Save graph structure
    const graphPath = indexPath.replace('.idx', '.graph.json');
    await fs.writeFile(graphPath, JSON.stringify(this.graph));

    // Save int8 vectors if any; remove a stale optional sidecar when a clean
    // replacement no longer has stage-2 vectors for this artifact.
    const int8Path = indexPath.replace('.idx', '.int8.json');
    const int8Data = {};
    if (this.int8Vectors.size > 0) {
      const liveIds = new Set(this.vectors.map(v => v.id));
      for (const [id, vec] of this.int8Vectors) {
        if (!liveIds.has(id)) continue;
        int8Data[id] = Array.from(vec);
      }
    }
    if (Object.keys(int8Data).length > 0) {
      await fs.writeFile(int8Path, JSON.stringify(int8Data));
    } else {
      await fs.rm(int8Path, { force: true });
    }

    // Save asymmetric calibration data (centroid + rotation signs)
    const calibPath = indexPath.replace('.idx', '.calibration.json');
    if (this.useAsymmetric && this.centroid && this.signVector) {
      await fs.writeFile(calibPath, JSON.stringify({
        centroid: Array.from(this.centroid),
        signVector: Array.from(this.signVector),
      }));
    } else {
      await fs.rm(calibPath, { force: true });
    }

    if (this._cleanBuild) {
      await fs.rm(this._stalePathForIndex(indexPath), { force: true });
      this._staleBitmapCache = null;
      this._cleanBuild = false;
    }

    console.log(`BinaryHNSW: Saved ${this.vectors.length} vectors to ${indexPath} (asymmetric=${this.useAsymmetric})`);
  }

  /**
   * Load index from disk
   */
  async load(indexPath = this.indexPath) {
    const metaPath = indexPath.replace('.idx', '.meta.json');
    const vectorsPath = indexPath.replace('.idx', '.vectors.json');
    const graphPath = indexPath.replace('.idx', '.graph.json');
    const int8Path = indexPath.replace('.idx', '.int8.json');

    if (!existsSync(metaPath)) {
      throw new Error(`Index metadata not found: ${metaPath}`);
    }

    // Load metadata
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));

    // Validate pipeline version — mismatched indexes must be rebuilt
    const storedVersion = meta.pipelineVersion || 1;
    if (storedVersion !== PIPELINE_VERSION) {
      throw new Error(
        `Pipeline version mismatch: index=${storedVersion}, current=${PIPELINE_VERSION}. ` +
        `Index must be rebuilt (quantization pipeline changed).`
      );
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

    // Load vectors
    const vectorsData = JSON.parse(await fs.readFile(vectorsPath, 'utf-8'));
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
   * Get index statistics
   */
  getStats() {
    const graphNodes = this.graph.reduce((sum, level) => sum + level.filter(n => n).length, 0);
    const graphEdges = this.graph.reduce((sum, level) =>
      sum + level.reduce((s, neighbors) => s + (neighbors?.length || 0), 0), 0);

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
  return existsSync(indexPath.replace('.idx', '.meta.json'))
    && existsSync(indexPath.replace('.idx', '.vectors.json'))
    && existsSync(indexPath.replace('.idx', '.graph.json'));
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

      } else if (command === 'compare') {
        console.log('\n=== Binary vs Float HNSW Comparison ===\n');

        const { HNSWIndex } = await import('./hnsw-index.js');

        const numVectors = 5000;
        const floatDim = 512;

        console.log(`Testing with ${numVectors} vectors, ${floatDim} dimensions\n`);

        // Generate vectors
        const vectors = [];
        for (let i = 0; i < numVectors; i++) {
          const float = new Array(floatDim).fill(0).map(() => Math.random() * 2 - 1);
          vectors.push({ id: `vec-${i}`, float });
        }

        // Binary index
        const binaryIndex = new BinaryHNSWIndex({ dimension: Math.ceil(floatDim / 8), floatDimension: floatDim });
        await binaryIndex.init();

        console.log('Building binary index...');
        let start = performance.now();
        for (const v of vectors) {
          await binaryIndex.add(v.id, floatToBinary(v.float));
        }
        const binaryBuildTime = performance.now() - start;

        // Float index
        const floatIndex = new HNSWIndex({ dimension: floatDim });
        await floatIndex.init();

        console.log('Building float index...');
        start = performance.now();
        for (const v of vectors) {
          await floatIndex.add(v.id, v.float);
        }
        const floatBuildTime = performance.now() - start;

        console.log(`\nBuild time: Binary ${binaryBuildTime.toFixed(0)}ms, Float ${floatBuildTime.toFixed(0)}ms`);

        // Search comparison
        const numQueries = 50;
        const binaryLatencies = [];
        const floatLatencies = [];

        for (let i = 0; i < numQueries; i++) {
          const queryFloat = new Array(floatDim).fill(0).map(() => Math.random() * 2 - 1);

          const binaryResult = await binaryIndex.search(floatToBinary(queryFloat), 10);
          binaryLatencies.push(binaryResult.latency_us);

          const floatResult = await floatIndex.search(queryFloat, 10);
          floatLatencies.push(floatResult.latency_us);
        }

        const binaryP50 = binaryLatencies.sort((a, b) => a - b)[Math.floor(numQueries * 0.5)];
        const floatP50 = floatLatencies.sort((a, b) => a - b)[Math.floor(numQueries * 0.5)];

        console.log(`\nSearch latency p50: Binary ${binaryP50}μs, Float ${floatP50}μs`);
        console.log(`Speedup: ${(floatP50 / binaryP50).toFixed(1)}x`);

        const binaryMem = numVectors * Math.ceil(floatDim / 8);
        const floatMem = numVectors * floatDim * 4;
        console.log(`\nMemory: Binary ${(binaryMem / 1024).toFixed(0)} KB, Float ${(floatMem / 1024).toFixed(0)} KB`);
        console.log(`Compression: ${(floatMem / binaryMem).toFixed(0)}x`);

      } else {
        console.log('Unknown command. Use: stats, test, or compare');
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
