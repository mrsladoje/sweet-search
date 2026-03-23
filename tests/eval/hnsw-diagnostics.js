#!/usr/bin/env node

/**
 * HNSW Phase 0 Diagnostics (HNSW_OPT_PLAN.md)
 *
 * Three diagnostic tools:
 *   1. Dimension distribution profiler
 *   2. Graph connectivity checker (Union-Find)
 *   3. Parameter sweep harness
 *
 * Usage:
 *   node tests/eval/hnsw-diagnostics.js profile   [indexPath]
 *   node tests/eval/hnsw-diagnostics.js connect    [indexPath]
 *   node tests/eval/hnsw-diagnostics.js sweep      [codebaseDbPath]
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import { BinaryHNSWIndex } from '../../core/binary-hnsw-index.js';
import { DB_PATHS, BINARY_HNSW_CONFIG, EMBEDDING_CONFIG } from '../../core/config.js';
import { hammingDistance } from '../../core/embedding-service.js';

// =============================================================================
// 1. DIMENSION DISTRIBUTION PROFILER (Float + Binary)
// =============================================================================

async function profileDimensions(codebaseDbPath) {
  console.log('=== Dimension Distribution Profiler ===\n');

  if (!existsSync(codebaseDbPath)) {
    console.error(`Codebase DB not found: ${codebaseDbPath}`);
    process.exit(1);
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(codebaseDbPath, { readonly: true });
  const rows = db.prepare('SELECT embedding FROM vectors LIMIT 2000').all();
  db.close();

  if (rows.length === 0) {
    console.log('No vectors found.');
    return;
  }

  // Parse float embeddings
  const embeddings = rows.map(r => {
    const buf = r.embedding;
    return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  });

  const dim = embeddings[0].length;
  const n = embeddings.length;
  const hnswDim = EMBEDDING_CONFIG.hnswDimension;
  console.log(`Vectors sampled: ${n}, Full dim: ${dim}, HNSW dim: ${hnswDim}\n`);

  // Per-dimension statistics (on HNSW-truncated dimensions)
  const profDim = Math.min(dim, hnswDim);
  const means = new Float64Array(profDim);
  const m2 = new Float64Array(profDim);  // for Welford variance

  for (const emb of embeddings) {
    for (let d = 0; d < profDim; d++) {
      means[d] += emb[d];
    }
  }
  for (let d = 0; d < profDim; d++) means[d] /= n;

  for (const emb of embeddings) {
    for (let d = 0; d < profDim; d++) {
      const diff = emb[d] - means[d];
      m2[d] += diff * diff;
    }
  }

  let nearZero = 0;      // dimensions where mean is in [-0.05, +0.05]
  let lowVariance = 0;   // dimensions with stddev < 0.01
  let highVariance = 0;  // dimensions with stddev > 0.1

  console.log('Per-dimension statistics (first 20):');
  console.log('  dim    mean      stddev    near-zero');
  for (let d = 0; d < profDim; d++) {
    const stddev = Math.sqrt(m2[d] / n);
    const isNearZero = Math.abs(means[d]) < 0.05;
    if (isNearZero) nearZero++;
    if (stddev < 0.01) lowVariance++;
    if (stddev > 0.1) highVariance++;

    if (d < 20) {
      console.log(`  [${String(d).padStart(3)}]  ${means[d].toFixed(4).padStart(8)}  ${stddev.toFixed(4).padStart(8)}  ${isNearZero ? 'YES' : ''}`);
    }
  }

  console.log(`\nSummary (${profDim} dimensions):`);
  console.log(`  Near-zero mean (|mean| < 0.05): ${nearZero} (${(100 * nearZero / profDim).toFixed(1)}%)`);
  console.log(`  Low variance (stddev < 0.01):   ${lowVariance} (${(100 * lowVariance / profDim).toFixed(1)}%)`);
  console.log(`  High variance (stddev > 0.1):   ${highVariance} (${(100 * highVariance / profDim).toFixed(1)}%)`);
  console.log(`\nInterpretation:`);
  console.log(`  High near-zero % → many sign-bit coin flips → centroid subtraction helps`);
  console.log(`  High low-variance % → dead dimensions → rotation (WHT) equalizes`);
  console.log(`  Mean far from 0 on many dims → centroid subtraction is critical`);
}

// =============================================================================
// 2. GRAPH CONNECTIVITY CHECKER (Union-Find)
// =============================================================================

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Uint8Array(n);
  }

  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path halving
      x = this.parent[x];
    }
    return x;
  }

  union(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return;
    if (this.rank[a] < this.rank[b]) [a, b] = [b, a];
    this.parent[b] = a;
    if (this.rank[a] === this.rank[b]) this.rank[a]++;
  }
}

async function checkConnectivity(indexPath) {
  console.log('=== Graph Connectivity Checker ===\n');

  const index = new BinaryHNSWIndex({ indexPath });
  await index.load(indexPath);

  const n = index.vectors.length;
  console.log(`Vectors: ${n}, Levels: ${index.maxLevel + 1}, Entry: ${index.entryPoint}\n`);

  for (let level = 0; level <= index.maxLevel; level++) {
    const graphLevel = index.graph[level] || [];
    const uf = new UnionFind(n);
    let edgeCount = 0;
    let nodesWithEdges = 0;

    for (let i = 0; i < graphLevel.length; i++) {
      const neighbors = graphLevel[i];
      if (!neighbors || neighbors.length === 0) continue;
      nodesWithEdges++;
      for (const j of neighbors) {
        uf.union(i, j);
        edgeCount++;
      }
    }

    // Count components
    const components = new Map();
    for (let i = 0; i < n; i++) {
      if (!graphLevel[i] || graphLevel[i].length === 0) {
        if (level > 0) continue; // Only count nodes present at this level
      }
      const root = uf.find(i);
      components.set(root, (components.get(root) || 0) + 1);
    }

    const sizes = [...components.values()].sort((a, b) => b - a);
    const largest = sizes[0] || 0;
    const largestFrac = (largest / n * 100).toFixed(1);

    console.log(`Level ${level}:`);
    console.log(`  Nodes with edges: ${nodesWithEdges}, Edges: ${edgeCount}`);
    console.log(`  Components: ${sizes.length}, Largest: ${largest} (${largestFrac}%)`);

    if (sizes.length > 1) {
      console.log(`  ⚠ DISCONNECTED: ${sizes.length - 1} unreachable components`);
      console.log(`    Sizes: [${sizes.slice(0, 10).join(', ')}${sizes.length > 10 ? '...' : ''}]`);
    } else {
      console.log(`  ✓ Fully connected`);
    }
  }
}

// =============================================================================
// 3. PARAMETER SWEEP HARNESS
// =============================================================================

async function parameterSweep(codebaseDbPath) {
  console.log('=== Parameter Sweep Harness ===\n');
  console.log('Sweeps BINARY_HNSW_CONFIG parameters and reports recall vs latency.\n');

  if (!existsSync(codebaseDbPath)) {
    console.error(`Codebase DB not found: ${codebaseDbPath}`);
    console.log('\nUsage: node tests/eval/hnsw-diagnostics.js sweep <path-to-codebase.db>');
    process.exit(1);
  }

  const { buildFromCodebaseDb } = await import('../../core/artifact-builder.js');

  // Parameter grid
  const sweeps = {
    M: [16, 24, 32, 48, 64],
    efConstruction: [200, 400, 600, 800],
    efSearch: [100, 200, 400, 600],
  };

  const results = [];
  const baseConfig = {
    M: BINARY_HNSW_CONFIG.M,
    efConstruction: BINARY_HNSW_CONFIG.efConstruction,
    efSearch: BINARY_HNSW_CONFIG.efSearch,
  };

  // Sweep one parameter at a time (keep others at base)
  for (const [param, values] of Object.entries(sweeps)) {
    console.log(`\n--- Sweeping ${param} ---`);
    console.log(`${'Value'.padEnd(8)} ${'BuildMs'.padEnd(10)} ${'Vec/s'.padEnd(8)} ${'Vectors'.padEnd(10)}`);

    for (const val of values) {
      const config = { ...baseConfig, [param]: val };
      try {
        const start = performance.now();
        // We can't easily measure recall without a query set — just measure build stats
        const result = await buildFromCodebaseDb(codebaseDbPath, {
          hnswIndexPath: `/tmp/hnsw-sweep-${param}-${val}.idx`,
          ...config,
        });
        const elapsed = Math.round(performance.now() - start);

        console.log(
          `${String(val).padEnd(8)} ${String(result.hnsw.buildTimeMs).padEnd(10)} ` +
          `${String(result.hnsw.vectorsPerSecond).padEnd(8)} ${result.hnsw.totalVectors}`
        );

        results.push({ param, value: val, ...result.hnsw });
      } catch (err) {
        console.log(`${String(val).padEnd(8)} ERROR: ${err.message}`);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log('Full eval requires running GenCodeSearchNet JS queries against each config.');
  console.log('Use `node tests/eval/hnsw-diagnostics.js profile` to check dimension distributions.');
  console.log('Use `node tests/eval/hnsw-diagnostics.js connect` to check graph connectivity.');

  return results;
}

// =============================================================================
// CLI
// =============================================================================

const [cmd, arg] = process.argv.slice(2);
const defaultIndex = DB_PATHS.binaryHnswIndex;
const defaultDb = DB_PATHS.codebase;

switch (cmd) {
  case 'profile':
    await profileDimensions(arg || defaultDb);
    break;
  case 'connect':
    await checkConnectivity(arg || defaultIndex);
    break;
  case 'sweep':
    await parameterSweep(arg || defaultDb);
    break;
  default:
    console.log('HNSW Phase 0 Diagnostics');
    console.log('');
    console.log('Commands:');
    console.log('  profile [codebaseDbPath]  Float dimension distribution profiler');
    console.log('  connect [indexPath]        Graph connectivity checker (Union-Find)');
    console.log('  sweep   [codebaseDbPath]   Parameter sweep harness');
    console.log('');
    console.log('Defaults:');
    console.log(`  indexPath:      ${defaultIndex}`);
    console.log(`  codebaseDbPath: ${defaultDb}`);
}
