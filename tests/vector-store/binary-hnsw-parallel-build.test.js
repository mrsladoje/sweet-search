/**
 * The native graph builder (crates/sweet-search-native/src/hnsw_build.rs, used by linkGraph) must
 * give exactly the lists of the JS addSync loop: same entry point, max level, level lengths and
 * every list in order, on 1 thread and on many. Skipped when the addon lacks buildBinaryHnsw.
 * The deferred-insert rules (addDeferred, duplicate ids) are checked without the addon too.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';
import { loadNativeAddon } from '../../core/infrastructure/native-resolver.js';

const hasBuilder = !!loadNativeAddon({ validate: (m) => typeof m.buildBinaryHnsw === 'function' });
// An addon without the builder is a stale build (rebuild with npm run build:native): fail, do not
// skip, or the parity checks pass without running. No addon at all (a JS-only checkout): skip.
const staleAddon = !hasBuilder && !!loadNativeAddon({});
const dir = mkdtempSync(join(tmpdir(), 'ss-hnsw-par-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
}

// Clustered 512-bit codes with few flipped bits: many equal distances, so the heap tie rules matter.
function makeCodes(n, seed, flips) {
  const r = rng(seed);
  const centers = Array.from({ length: 12 }, () => Uint8Array.from({ length: 64 }, () => Math.floor(r() * 256)));
  return Array.from({ length: n }, () => {
    const v = Uint8Array.from(centers[Math.floor(r() * centers.length)]);
    for (let f = 0; f < flips; f++) v[Math.floor(r() * 64)] ^= 1 << Math.floor(r() * 8);
    return v;
  });
}

let seq = 0;
function fresh(M = 8, efConstruction = 32) {
  const ix = new BinaryHNSWIndex({ dimension: 64, floatDimension: 512, M, efConstruction, indexPath: join(dir, `i${seq++}.idx`) });
  ix.resetForBuild();
  return ix;
}

function lists(ix) {
  return {
    ep: ix.entryPoint,
    ml: ix.maxLevel,
    levels: ix.graph.map((level) => Array.from({ length: level.length }, (_, i) => (level[i] ? Array.from(level[i]) : null))),
  };
}

function withEnv(name, value, fn) {
  const prev = process.env[name];
  process.env[name] = value;
  try { return fn(); } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; }
}

function jsBuild(ids, codes, M, ef) {
  return withEnv('SWEET_SEARCH_HNSW_NATIVE_BUILD', '0', () => {
    const ix = fresh(M, ef);
    for (let i = 0; i < ids.length; i++) ix.addSync(ids[i], codes[i], {}, null, null);
    return lists(ix);
  });
}

it('the addon, when present, has the graph builder', () => {
  expect(staleAddon).toBe(false);
});

describe.skipIf(!hasBuilder)('native parallel HNSW build', () => {
  for (const [n, flips, M, ef] of [[1500, 3, 8, 32], [2500, 40, 6, 24], [400, 0, 4, 16]]) {
    it(`gives the JS lists (n=${n}, flips=${flips}, M=${M}, ef=${ef}) on 1, 3 and 8 threads`, async () => {
      const codes = makeCodes(n, n + flips, flips);
      // Ids out of node order: the entry-point tie-break compares ids, not node numbers.
      const ids = codes.map((_, i) => `f${(i * 7919) % n}:${i}`);
      const want = jsBuild(ids, codes, M, ef);
      for (const threads of [1, 3, 8]) {
        const ix = fresh(M, ef);
        for (let i = 0; i < n; i++) ix.addFlat(ids[i], codes[i], {}, null, null);
        const link = await ix.linkGraph({ threads });
        expect(link.native).toBe(true);
        expect(lists(ix)).toEqual(want);
      }
    });
  }
});

describe('deferred build inserts', () => {
  it('links at linkGraph and matches addSync without the addon', async () => {
    const codes = makeCodes(300, 5, 20);
    const ids = codes.map((_, i) => `c${i}`);
    const want = jsBuild(ids, codes, 8, 32);
    const prev = process.env.SWEET_SEARCH_HNSW_NATIVE_BUILD;
    process.env.SWEET_SEARCH_HNSW_NATIVE_BUILD = '0';
    try {
      const ix = fresh();
      for (let i = 0; i < ids.length; i++) await ix.addDeferred(ids[i], codes[i], {}, null, null);
      expect(ix.entryPoint).toBe(-1);
      const link = await ix.linkGraph();
      expect(link.native).toBe(false);
      expect(lists(ix)).toEqual(want);
    } finally {
      if (prev === undefined) delete process.env.SWEET_SEARCH_HNSW_NATIVE_BUILD;
      else process.env.SWEET_SEARCH_HNSW_NATIVE_BUILD = prev;
    }
  });

  it('a fractional efConstruction keeps the JS lists (the addon takes whole numbers)', async () => {
    const codes = makeCodes(400, 11, 20);
    const ids = codes.map((_, i) => `c${i}`);
    const want = jsBuild(ids, codes, 8, 12.5);
    const ix = fresh(8, 12.5);
    for (let i = 0; i < ids.length; i++) await ix.addDeferred(ids[i], codes[i], {}, null, null);
    expect((await ix.linkGraph()).native).toBe(false);
    expect(lists(ix)).toEqual(want);
  });

  it('a repeated id links the earlier nodes first, as addSync does', async () => {
    const codes = makeCodes(200, 9, 20);
    const ids = codes.map((_, i) => `c${i}`);
    ids[150] = 'c20'; // updates node 20 after 150 nodes are in
    const want = jsBuild(ids, codes, 8, 32);
    const ix = fresh();
    for (let i = 0; i < ids.length; i++) await ix.addDeferred(ids[i], codes[i], {}, null, null);
    await ix.linkGraph();
    expect(ix.size).toBe(199);
    expect(lists(ix)).toEqual(want);
  });
});
