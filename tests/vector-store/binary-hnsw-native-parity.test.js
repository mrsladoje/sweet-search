/**
 * The native query path (HnswSearcher, crates/sweet-search-native/src/hnsw_search.rs)
 * must return exactly what the JS path returns: same ids, same order (including
 * equal-distance ties), same distances, same visited counts and adaptive ef.
 * Also checks that a mutation (add / in-place update) invalidates the native
 * snapshot. Skipped when the native addon is not built or SS_FIX_HNSW_NATIVE=0.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';
import { loadNativeAddon } from '../../core/infrastructure/native-resolver.js';
import { nativeRescoreKernels } from '../../core/infrastructure/native-rescore.js';
import { int8BatchDotScores } from '../../core/embedding/embedding-service.js';
import { createBitmap, setBit, saveBitmap } from '../../core/infrastructure/tombstone-bitmap-reader.js';

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

function makeInt8(n, seed, dim = 64) {
  const r = rng(seed);
  return Array.from({ length: n }, () => Int8Array.from({ length: dim }, () => Math.floor(r() * 255) - 127));
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
  // Exact equality with the JS walk needs the JS-exact heaps and the walk
  // itself (not the small-index exact scan).
  const saved = {};
  beforeAll(() => {
    for (const k of ['SS_FIX_HNSW_BUCKET', 'SS_FIX_HNSW_SCAN']) { saved[k] = process.env[k]; process.env[k] = '0'; }
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

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

  // The fused stages 1-2 (searchCascade) against the path semanticSearch3Stage
  // takes without it: lazy search, int8ScoresForNodes, a stable int8 sort, and
  // analyzeScoreSpread's sums (same order and arithmetic). One difference by
  // design: when the pool cutoff falls inside a run of equal Hamming
  // distances, the run is ordered by the asymmetric score (sum of the query's
  // int8 values over the set code bits, highest first, ties kept in order).
  // int8 dim 200 = whole SIMD blocks plus a scalar tail.
  it.skipIf(!nativeRescoreKernels())('searchCascade matches lazy search + int8ScoresForNodes + stable sort', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-cascade-'));
    const prevScan = process.env.SS_FIX_HNSW_SCAN;
    try {
      const index = new BinaryHNSWIndex({ M: 16, efConstruction: 64, efSearch: 50, indexPath: join(dir, 'c.idx') });
      index.resetForBuild();
      index.initialized = true;
      const vectors = makeVectors(1500, 61);
      const int8 = makeInt8(1500, 62, 200);
      vectors.forEach((v, i) => index.addSync(`v${i}`, v, { i }, i % 9 === 0 ? null : int8[i]));
      const spread = (xs) => {
        let top1 = -Infinity, top2 = -Infinity, min = Infinity, sum = 0;
        for (const s of xs) {
          sum += s;
          if (s > top1) { top2 = top1; top1 = s; } else if (s > top2) top2 = s;
          if (s < min) min = s;
        }
        const mean = sum / xs.length;
        let variance = 0;
        for (const s of xs) variance += (s - mean) ** 2;
        return [top1, top2, min, mean, variance / xs.length];
      };
      const setBitSum = (code, q8) => {
        let s = 0;
        for (let i = 0; i < Math.min(q8.length, code.length * 8); i++) {
          if (code[i >> 3] & (1 << (7 - (i & 7)))) s += q8[i];
        }
        return s;
      };
      // Pool of the first c stage-1 results with the cutoff run reordered.
      const pool = (all, c, q8) => {
        const out = all.slice();
        const d = (i) => out[i].hammingDistance;
        if (c > 0 && c < out.length && d(c) === d(c - 1)) {
          let g0 = c - 1;
          while (g0 > 0 && d(g0 - 1) === d(c)) g0--;
          let g1 = c + 1;
          while (g1 < out.length && d(g1) === d(c)) g1++;
          const key = (x) => setBitSum(vectors[x.metadata.i], q8);
          const run = out.slice(g0, g1).map((x) => [key(x), x]).sort((a, b) => b[0] - a[0]).map((p) => p[1]);
          out.splice(g0, g1 - g0, ...run);
          ties.hit++;
        }
        return out.slice(0, c);
      };
      const ties = { hit: 0 };
      const check = async (seed) => {
        for (const q of makeVectors(12, seed)) {
          const queryInt8 = makeInt8(1, seed + 3, 200)[0];
          const ref = await index.search(q, 300, { lazy: true });
          const got = index.searchCascade(q, 300, { queryInt8 });
          expect(got.count).toBe(ref.count);
          expect(got.visitedNodes).toBe(ref.visitedNodes);
          expect(got.adaptiveEf).toBe(ref.adaptiveEf);
          expect(Array.from(got.stats.subarray(2, 7))).toEqual(spread(ref.scores));
          const all = ref.materialize(ref.count);
          const nodeOf = new Map(Array.from(ref.nodeIndices.slice(0, ref.count), (n, i) => [all[i].id, n]));
          for (const c of [1, 40, 100, 137, ref.count]) {
            const cand = pool(all, c, queryInt8).map((x) => ({ ...x }));
            const r8 = index.int8ScoresForNodes(queryInt8, Uint32Array.from(cand, (x) => nodeOf.get(x.id)));
            cand.forEach((x, i) => {
              if (r8.missing[i]) { x.int8Score = 0.0; x.missingInt8 = true; } else x.int8Score = r8.scores[i];
            });
            const sorted = [...cand].sort((a, b) => b.int8Score - a.int8Score);
            const stage = got.int8Stage(c);
            expect(stage.count).toBe(c);
            expect(JSON.stringify(stage.materialize(c))).toBe(JSON.stringify(sorted));
            expect(stage.missing).toBe(sorted.filter((x) => x.missingInt8).length);
            const kept = sorted.filter((x) => !x.missingInt8).map((x) => x.int8Score);
            expect(stage.stats[0]).toBe(kept.length);
            if (kept.length > 0) expect(Array.from(stage.stats.subarray(1, 6))).toEqual(spread(kept));
          }
        }
      };
      process.env.SS_FIX_HNSW_SCAN = '0';
      await check(70); // graph walk
      delete process.env.SS_FIX_HNSW_SCAN;
      await check(80); // exact scan (small index)
      // Tombstones: stale nodes are dropped from stage 1 and count as missing.
      const bm = createBitmap(1500);
      for (let i = 0; i < 1500; i += 5) setBit(bm, i);
      saveBitmap(index.stalePath, bm);
      await check(90);
      process.env.SS_FIX_HNSW_SCAN = '0';
      await check(100);
      expect(ties.hit).toBeGreaterThan(20);
    } finally {
      if (prevScan === undefined) delete process.env.SS_FIX_HNSW_SCAN; else process.env.SS_FIX_HNSW_SCAN = prevScan;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasNative)('exact scan = brute force (ascending distance, ties in node order)', () => {
    const r = rng(5);
    for (const n of [1, 3, 4, 5, 17, 1000, 1003]) {
      // Few distinct values per byte: many equal distances.
      const codes = Array.from({ length: n }, () => Uint8Array.from({ length: 64 }, () => (r() < 0.5 ? 0 : 255) & Math.floor(r() * 256) & 0xf0));
      const slab = new Uint8Array(n * 64);
      codes.forEach((c, i) => slab.set(c, i * 64));
      const searcher = new (loadNativeAddon({ validate: (m) => typeof m.HnswSearcher === 'function' }).mod.HnswSearcher)(64, n, slab);
      const q = codes[Math.floor(r() * n)].map((b) => b ^ (r() < 0.1 ? 1 : 0));
      searcher.setQuery(q);
      const pop = (x) => { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; };
      const d = codes.map((c) => c.reduce((a, b, j) => a + pop(b ^ q[j]), 0));
      const order = d.map((_, i) => i).sort((a, b) => d[a] - d[b] || a - b);
      for (const k of [0, 1, Math.min(n, 7), Math.floor(n / 2), n]) {
        const out = new Uint32Array(2 + 2 * k);
        expect(searcher.scanInto(k, out)).toBe(k);
        expect(Array.from(out.subarray(2, 2 + k))).toEqual(order.slice(0, k));
        expect(Array.from(out.subarray(2 + k, 2 + 2 * k))).toEqual(order.slice(0, k).map((i) => d[i]));
      }
    }
  });
});
