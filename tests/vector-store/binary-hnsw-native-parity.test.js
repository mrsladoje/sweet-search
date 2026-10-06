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
      makeVectors(2000, 11).forEach((v, i) => built.addSync(`v${i}`, v, {}));
      const original = JSON.stringify(built.graph);
      await built.save(join(dir, 'a.idx'));

      const loaded = new BinaryHNSWIndex({ indexPath: join(dir, 'a.idx') });
      await loaded.load();
      expect(loaded._graphFrozen).not.toBeNull();
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
});
