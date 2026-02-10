
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
import { existsSync } from 'fs';
import path from 'path';
import { BINARY_HNSW_CONFIG, DB_PATHS } from './config.js';
import { floatToBinary, hammingDistance } from './embedding-service.js';

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
   * Add node to HNSW graph
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

    // At each level from level down to 0, find M neighbors and connect
    for (let l = level; l >= 0; l--) {
      const neighbors = this.searchLayer(currentNode, idx, this.efConstruction, l);

      // Select best M neighbors
      const selectedNeighbors = neighbors.slice(0, this.M);

      // Connect both directions
      this.graph[l][idx] = selectedNeighbors.map(n => n.idx);

      for (const neighbor of selectedNeighbors) {
        if (!this.graph[l][neighbor.idx]) {
          this.graph[l][neighbor.idx] = [];
        }
        if (!this.graph[l][neighbor.idx].includes(idx)) {
          this.graph[l][neighbor.idx].push(idx);

          // Prune if too many neighbors
          if (this.graph[l][neighbor.idx].length > this.M * 2) {
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
   * Search layer returning ef closest candidates
   */
  searchLayer(startNode, targetIdx, ef, level) {
    const targetBinary = this.vectors[targetIdx].binary;
    const visited = new Set([startNode]);
    const candidates = [{ idx: startNode, dist: hammingDistance(this.vectors[startNode].binary, targetBinary) }];
    const results = [...candidates];

    while (candidates.length > 0) {
      // Get closest candidate
      candidates.sort((a, b) => a.dist - b.dist);
      const current = candidates.shift();

      // If current is further than furthest result, stop
      if (results.length >= ef && current.dist > results[results.length - 1].dist) {
        break;
      }

      // Explore neighbors
      const neighbors = this.graph[level]?.[current.idx] || [];
      for (const neighborIdx of neighbors) {
        if (!visited.has(neighborIdx)) {
          visited.add(neighborIdx);
          const dist = hammingDistance(this.vectors[neighborIdx].binary, targetBinary);

          if (results.length < ef || dist < results[results.length - 1].dist) {
            candidates.push({ idx: neighborIdx, dist });
            results.push({ idx: neighborIdx, dist });
            results.sort((a, b) => a.dist - b.dist);
            if (results.length > ef) {
              results.pop();
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Prune neighbors to keep only M best
   */
  pruneNeighbors(nodeIdx, level) {
    const neighbors = this.graph[level][nodeIdx];
    const nodeBinary = this.vectors[nodeIdx].binary;

    // Calculate distances and sort
    const withDist = neighbors.map(idx => ({
      idx,
      dist: hammingDistance(this.vectors[idx].binary, nodeBinary),
    }));
    withDist.sort((a, b) => a.dist - b.dist);

    // Keep only M best
    this.graph[level][nodeIdx] = withDist.slice(0, this.M).map(n => n.idx);
  }

  /**
   * Search for k nearest neighbors
   *
   * @param {Uint8Array|number[]} queryVector - Binary query vector (or float to convert)
   * @param {number} k - Number of results
   * @returns {Promise<{results: Array, latency_us: number}>}
   */
  async search(queryVector, k = 10) {
    await this.init();

    const start = performance.now();

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

    // HNSW search
    let currentNode = this.entryPoint;

    // Traverse from top level to level 1
    for (let l = this.maxLevel; l >= 1; l--) {
      currentNode = this.greedySearchQuery(currentNode, queryBinary, l);
    }

    // Search at level 0 with ef candidates
    const candidates = this.searchLayerQuery(currentNode, queryBinary, Math.max(k, this.efSearch), 0);

    // Return top k
    const results = candidates.slice(0, k).map(c => ({
      id: this.vectors[c.idx].id,
      score: 1 - (c.dist / (this.dimension * 8)), // Convert distance to similarity
      hammingDistance: c.dist,
      metadata: this.vectors[c.idx].metadata,
    }));

    const latency = performance.now() - start;

    return {
      results,
      latency_us: Math.round(latency * 1000),
      latency_ms: latency.toFixed(3),
      k,
      total: this.vectors.length,
    };
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
   * Search layer for query vector
   */
  searchLayerQuery(startNode, queryBinary, ef, level) {
    const visited = new Set([startNode]);
    const candidates = [{ idx: startNode, dist: hammingDistance(this.vectors[startNode].binary, queryBinary) }];
    const results = [...candidates];

    while (candidates.length > 0) {
      candidates.sort((a, b) => a.dist - b.dist);
      const current = candidates.shift();

      if (results.length >= ef && current.dist > results[results.length - 1].dist) {
        break;
      }

      const neighbors = this.graph[level]?.[current.idx] || [];
      for (const neighborIdx of neighbors) {
        if (!visited.has(neighborIdx)) {
          visited.add(neighborIdx);
          const dist = hammingDistance(this.vectors[neighborIdx].binary, queryBinary);

          if (results.length < ef || dist < results[results.length - 1].dist) {
            candidates.push({ idx: neighborIdx, dist });
            results.push({ idx: neighborIdx, dist });
            results.sort((a, b) => a.dist - b.dist);
            if (results.length > ef) {
              results.pop();
            }
          }
        }
      }
    }

    return results;
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

    // Save int8 vectors if any
    if (this.int8Vectors.size > 0) {
      const int8Data = {};
      for (const [id, vec] of this.int8Vectors) {
        int8Data[id] = Array.from(vec);
      }
      const int8Path = indexPath.replace('.idx', '.int8.json');
      await fs.writeFile(int8Path, JSON.stringify(int8Data));
    }

    console.log(`BinaryHNSW: Saved ${this.vectors.length} vectors to ${indexPath}`);
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
    this.dimension = meta.dimension;
    this.floatDimension = meta.floatDimension;
    this.M = meta.M;
    this.efConstruction = meta.efConstruction;
    this.efSearch = meta.efSearch;
    this.maxLevel = meta.maxLevel;
    this.entryPoint = meta.entryPoint;

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
    if (existsSync(int8Path)) {
      const int8Data = JSON.parse(await fs.readFile(int8Path, 'utf-8'));
      this.int8Vectors.clear();
      for (const [id, vec] of Object.entries(int8Data)) {
        this.int8Vectors.set(id, new Int8Array(vec));
      }
    }

    this.initialized = true;
    console.log(`BinaryHNSW: Loaded ${this.vectors.length} vectors from ${indexPath}`);
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
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export async function createBinaryHNSWIndex(options = {}) {
  const index = new BinaryHNSWIndex(options);

  if (options.load !== false && existsSync(options.indexPath || DB_PATHS.binaryHnswIndex)) {
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
