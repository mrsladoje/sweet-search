/**
 * The native query path (HnswSearcher, crates/sweet-search-native/src/hnsw_search.rs)
 * must return exactly what the JS path returns: same ids, same order (including
 * equal-distance ties), same distances, same visited counts and adaptive ef.
 * Also checks that a mutation (add / in-place update) invalidates the native
 * snapshot. Skipped when the native addon is not built or SS_FIX_HNSW_NATIVE=0.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';
import { loadNativeAddon } from '../../core/infrastructure/native-resolver.js';
import { nativeRescoreKernels } from '../../core/infrastructure/native-rescore.js';
import { int8BatchDotScores } from '../../core/embedding/embedding-service.js';

const hasNative = process.env.SS_FIX_HNSW_NATIVE !== '0'
  && !!loadNativeAddon({ validate: (m) => typeof m.HnswSearcher === 'function' });

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
}

// Clustered random 512-bit vectors: many equal Hamming distances, so tie
// handling is exercised.
function makeVectors(n, seed) {
  const r = rng(seed);
  const centers = Array.from({ length: 8 }, () => Uint8Array.from({ length: 64 }, () => Math.floor(r() * 256)));
  return Array.from({ length: n }, () => {
    const c = centers[Math.floor(r() * centers.length)];
    const v = Uint8Array.from(c);
    for (let f = 0; f < 40; f++) v[Math.floor(r() * 64)] ^= 1 << Math.floor(r() * 8);
    return v;
  });
}

function makeInt8(n, seed) {
  const r = rng(seed);
  return Array.from({ length: n }, () => Int8Array.from({ length: 64 }, () => Math.floor(r() * 255) - 127));
}

async function searchBoth(index, queries, k) {
  const native = index._nativeSearcher.bind(index);
  const run = async (fn) => {
    index._nativeSearcher = fn;
    const out = [];
    for (const q of queries) {
      const r = await index.search(q, k);
      out.push({ hits: r.results.map((x) => [x.id, x.hammingDistance]), visited: r.visitedNodes, ef: r.adaptiveEf });
    }
    return out;
  };
  const js = await run(() => null);
  const nat = await run(native);
  index._nativeSearcher = native;
  return { js, nat };
}

describe.skipIf(!hasNative)('BinaryHNSWIndex native search parity', () => {
  it('matches the JS path exactly, before and after mutations', async () => {
    const index = new BinaryHNSWIndex({ M: 16, efConstruction: 64, efSearch: 50, indexPath: '/nonexistent/parity.idx' });
    index.resetForBuild();
    index.initialized = true;
    const vectors = makeVectors(3000, 7);
    vectors.forEach((v, i) => index.addSync(`v${i}`, v, {}));
    const queries = makeVectors(60, 99);

    expect(index._nativeSearcher()).not.toBeNull();
    for (const k of [1, 10, 200]) {
      const { js, nat } = await searchBoth(index, queries, k);
      expect(nat).toEqual(js);
    }

    // Mutations must rebuild the snapshot: new nodes and an in-place update.
    const before = index._native;
    makeVectors(500, 3).forEach((v, i) => index.addSync(`w${i}`, v, {}));
    index.addSync('v0', queries[0], {});
    const { js, nat } = await searchBoth(index, queries, 50);
    expect(nat).toEqual(js);
    expect(index._native).not.toBe(before);
    expect(nat[0].hits[0]).toEqual(['v0', 0]);
  });

  it('releases the JS graph after load and rebuilds it exactly; save output is unchanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-freeze-'));
    try {
      const built = new BinaryHNSWIndex({ M: 16, efConstruction: 64, efSearch: 50, indexPath: join(dir, 'a.idx') });
      built.resetForBuild();
      built.initialized = true;
      const int8 = makeInt8(2000, 12);
      makeVectors(2000, 11).forEach((v, i) => built.addSync(`v${i}`, v, {}, i % 5 === 0 ? null : int8[i]));
      const original = JSON.stringify(built.graph);
      await built.save(join(dir, 'a.idx'));

      const loaded = new BinaryHNSWIndex({ indexPath: join(dir, 'a.idx') });
      await loaded.load();
      expect(loaded._graphFrozen).not.toBeNull();
      // int8 vectors are read straight into the node-ordered slab.
      expect(loaded.int8Vectors.size).toBe(built.int8Vectors.size);
      for (const [id, v] of built.int8Vectors) expect(Array.from(loaded.int8Vectors.get(id))).toEqual(Array.from(v));
      if (nativeRescoreKernels()) expect(loaded._int8NodeSlab()).toBe(loaded._int8Slab);
      const queries = makeVectors(20, 5);
      const before = [];
      for (const q of queries) before.push((await loaded.search(q, 20)).results.map((r) => r.id));
      expect(loaded._graphFrozen).not.toBeNull(); // searching never thaws

      expect(JSON.stringify(loaded.graph)).toBe(original); // thaw is exact
      await loaded.save(join(dir, 'b.idx'));
      expect(readFileSync(join(dir, 'b.graph.json'), 'utf8')).toBe(readFileSync(join(dir, 'a.graph.json'), 'utf8'));
      for (let i = 0; i < queries.length; i++) {
        expect((await loaded.search(queries[i], 20)).results.map((r) => r.id)).toEqual(before[i]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lazy search gives the same scores, results and node indices', async () => {
    const index = new BinaryHNSWIndex({ M: 16, efConstruction: 64, efSearch: 50, indexPath: '/nonexistent/lazy.idx' });
    index.resetForBuild();
    index.initialized = true;
    makeVectors(1500, 21).forEach((v, i) => index.addSync(`v${i}`, v, { i }));
    for (const q of makeVectors(20, 4)) {
      const eager = await index.search(q, 300);
      const lazy = await index.search(q, 300, { lazy: true });
      expect(lazy.results).toBeNull();
      expect(lazy.count).toBe(eager.results.length);
      expect(Array.from(lazy.scores)).toEqual(eager.results.map((r) => r.score));
      expect(lazy.materialize(120)).toEqual(eager.results.slice(0, 120));
      expect(lazy.nodeIndices.map((i) => index.vectors[i].id)).toEqual(eager.results.map((r) => r.id));
      expect(Object.keys(eager)).not.toContain('nodeIndices');
    }
  });

  it.skipIf(!nativeRescoreKernels())('int8ScoresForNodes matches int8BatchDotScores over getInt8VectorsForIds', async () => {
    const index = new BinaryHNSWIndex({ M: 16, efConstruction: 64, efSearch: 50, indexPath: '/nonexistent/int8.idx' });
    index.resetForBuild();
    index.initialized = true;
    const vectors = makeVectors(1200, 31);
    const int8 = makeInt8(1200, 32);
    // Every 7th node has no int8 vector (counts as missing).
    vectors.forEach((v, i) => index.addSync(`v${i}`, v, {}, i % 7 === 0 ? null : int8[i]));
    const check = async (seed) => {
      for (const q of makeVectors(10, seed)) {
        const r = await index.search(q, 150, { lazy: true });
        const nodes = r.nodeIndices.slice(0, 100);
        const queryInt8 = makeInt8(1, seed + 1)[0];
        const got = index.int8ScoresForNodes(queryInt8, nodes);
        const vecs = index.getInt8VectorsForIds(nodes.map((n) => index.vectors[n].id));
        const present = vecs.map(Boolean);
        expect(got.missing).toEqual(present.map((p) => !p));
        const want = int8BatchDotScores(queryInt8, vecs.filter(Boolean));
        expect(got.scores.filter((_, i) => present[i])).toEqual(Array.from(want));
      }
    };
    await check(40);
    // Writes invalidate the node-ordered slab: replace one vector, add nodes.
    index.int8Vectors.set('v1', makeInt8(1, 77)[0]);
    makeVectors(100, 50).forEach((v, i) => index.addSync(`w${i}`, v, {}, makeInt8(1, 900 + i)[0]));
    await check(60);
    expect(Array.from(index.int8Vectors.get('v1'))).toEqual(Array.from(makeInt8(1, 77)[0]));
  });
});

