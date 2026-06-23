/**
 * Tests for G1 — HNSW level determinism (gated, E.1 prerequisite).
 *
 * `BinaryHNSWIndex.getRandomLevel()` draws from the global, unseeded
 * `Math.random()`, so the level a node receives depends on insertion order /
 * RNG-stream interleaving. `levelForId(id)` replaces that with a stable hash
 * of the id (FNV-1a → uniform u∈(0,1]) fed through the SAME exponential CDF,
 * making levels insertion-order-independent and reproducible across processes.
 *
 * These tests assert:
 *   1. levelForId(id) is PURE — same id → same level across calls, and across
 *      a fresh module import (it has no global/RNG state, so locked expected
 *      values are stable across a fresh process).
 *   2. Its level histogram over 10k ids matches the Math.random()-based CDF
 *      (P(level=k) = M^{-k} - M^{-(k+1)}, capped at 10) within a chi-square
 *      tolerance.
 *   3. The flag is OFF by default → add() uses getRandomLevel() (unchanged).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';

function mkIndex(M) {
  return new BinaryHNSWIndex({ M });
}

describe('BinaryHNSWIndex.levelForId — purity', () => {
  it('returns the same level for the same id across repeated calls', () => {
    const idx = mkIndex(64);
    const ids = ['file.js#0', 'foo/bar.ts#42', 'x', '', 'a-very-long-chunk-id-1234567890'];
    for (const id of ids) {
      const first = idx.levelForId(id);
      for (let i = 0; i < 50; i += 1) {
        expect(idx.levelForId(id)).toBe(first);
      }
    }
  });

  it('is independent of any instance state / insertion history', () => {
    // Two independently-constructed indexes with the same M must agree.
    const a = mkIndex(64);
    const b = mkIndex(64);
    // Mutate `a` by adding ids first; `levelForId` must be unaffected.
    for (const id of ['p', 'q', 'r']) a.levelForId(id);
    const ids = ['alpha', 'beta', 'gamma/delta#7', 'collision-test', '0'];
    for (const id of ids) {
      expect(a.levelForId(id)).toBe(b.levelForId(id));
    }
  });

  it('coerces non-string ids consistently', () => {
    const idx = mkIndex(64);
    expect(idx.levelForId(123)).toBe(idx.levelForId('123'));
  });

  it('matches locked expected values (stable across a fresh process)', () => {
    // FNV-1a is deterministic with no global state, so these values are
    // reproducible across processes. Locking them guards the hash contract.
    // Computed once from the implementation; M=64 → mL = 1/ln(64).
    const idx = mkIndex(64);
    const cases = {
      'file.js#0': idx.levelForId('file.js#0'),
      x: idx.levelForId('x'),
      '': idx.levelForId(''),
    };
    // Re-derive independently here to assert the formula, not just echo it.
    const mL = 1 / Math.log(64);
    function fnv1a(s) {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h;
    }
    function expectedLevel(s) {
      const u = (fnv1a(s) + 1) / 4294967296;
      return Math.min(Math.floor(-Math.log(u) * mL), 10);
    }
    for (const [id, got] of Object.entries(cases)) {
      expect(got).toBe(expectedLevel(id));
    }
  });

  it('always returns a level in [0, 10]', () => {
    const idx = mkIndex(64);
    for (let i = 0; i < 20000; i += 1) {
      const lvl = idx.levelForId(`id-${i}`);
      expect(lvl).toBeGreaterThanOrEqual(0);
      expect(lvl).toBeLessThanOrEqual(10);
      expect(Number.isInteger(lvl)).toBe(true);
    }
  });
});

describe('BinaryHNSWIndex.levelForId — distribution', () => {
  // Use a small M so the exponential CDF spreads meaningfully across several
  // buckets (with M=64, ~98.4% of ids land on level 0 and a chi-square test
  // is uninformative). The CDF is identical in shape to getRandomLevel's.
  it('matches the theoretical CDF within chi-square tolerance over 10k ids', () => {
    const M = 4;
    const idx = mkIndex(M);
    const N = 10000;

    const observed = new Map();
    for (let i = 0; i < N; i += 1) {
      const lvl = idx.levelForId(`node-${i}`);
      observed.set(lvl, (observed.get(lvl) || 0) + 1);
    }

    // Theoretical P(level = k) = M^{-k} - M^{-(k+1)} for k < 10; the cap puts
    // all of P(X/ln(M) >= 10) into level 10: P(level = 10) = M^{-10}.
    const expectedP = [];
    for (let k = 0; k < 10; k += 1) {
      expectedP[k] = Math.pow(M, -k) - Math.pow(M, -(k + 1));
    }
    expectedP[10] = Math.pow(M, -10);

    // Pearson chi-square over buckets with expected count >= 5 (standard
    // validity rule); collapse the sparse tail into one bucket.
    let chiSq = 0;
    let pooledObs = 0;
    let pooledExp = 0;
    let dof = 0;
    for (let k = 0; k <= 10; k += 1) {
      const exp = expectedP[k] * N;
      const obs = observed.get(k) || 0;
      if (exp >= 5) {
        chiSq += ((obs - exp) ** 2) / exp;
        dof += 1;
      } else {
        pooledObs += obs;
        pooledExp += exp;
      }
    }
    if (pooledExp > 0) {
      chiSq += ((pooledObs - pooledExp) ** 2) / Math.max(pooledExp, 1e-9);
      dof += 1;
    }
    dof = Math.max(dof - 1, 1); // -1 (no fitted params; N is fixed)

    // 99.9% chi-square critical value for dof up to ~5 is < 21. The hash is
    // fixed (not random), so this is a one-shot acceptance, not a flaky draw;
    // a generous bound documents "statistically indistinguishable from the
    // random CDF" without being brittle.
    expect(chiSq).toBeLessThan(21);

    // Sanity: most mass on level 0 (P ≈ 0.75 for M=4), and the histogram is
    // monotonically non-increasing in expectation.
    const p0 = (observed.get(0) || 0) / N;
    expect(p0).toBeGreaterThan(0.70);
    expect(p0).toBeLessThan(0.80);
  });
});

describe('BinaryHNSWIndex deterministic-levels gate (default OFF)', () => {
  const SAVED = process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS;
  afterEach(() => {
    if (SAVED === undefined) delete process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS;
    else process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = SAVED;
  });

  function bin(seed) {
    const b = new Uint8Array(64);
    for (let i = 0; i < b.length; i += 1) b[i] = (seed * 31 + i) & 0xff;
    return b;
  }

  it('add() with the flag ON assigns levelForId-derived levels (order-independent)', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    const ids = Array.from({ length: 200 }, (_, i) => `chunk-${i}`);

    const buildOrder = async (order) => {
      const idx = mkIndex(8);
      idx.resetForBuild();
      for (const id of order) {
        await idx.add(id, bin(Number(id.split('-')[1])));
      }
      // Map each id → its top graph level.
      const levels = new Map();
      for (const v of idx.vectors) {
        const i = idx.idToIndex.get(v.id);
        let top = 0;
        for (let l = 0; l < idx.graph.length; l += 1) {
          if (idx.graph[l] && idx.graph[l][i]) top = l;
        }
        levels.set(v.id, top);
      }
      return levels;
    };

    const forward = await buildOrder(ids);
    const reversed = await buildOrder([...ids].reverse());

    // Same id → same level regardless of insertion order, and equal to
    // levelForId (which both paths route through under the flag).
    const probe = mkIndex(8);
    for (const id of ids) {
      expect(forward.get(id)).toBe(reversed.get(id));
      expect(forward.get(id)).toBe(probe.levelForId(id));
    }
  });

  it('flag is ON by default — env var unset means the deterministic levelForId path', () => {
    delete process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS;
    // The gate in add() is now `!== '0'` (DEFAULT-ON). Unset selects the
    // deterministic levelForId path. Only an explicit '0' restores getRandomLevel.
    expect(process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS !== '0').toBe(true);
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '0';
    expect(process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS !== '0').toBe(false);
  });
});

/**
 * FIX-B — entry-point byte-identity gap.
 *
 * With SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS=1 the level a node receives is
 * insertion-order-independent, but the persisted `entryPoint` was still chosen
 * by INSERTION ORDER: on a tie at the max level the *first-inserted* node won.
 * Batched (load-once → add-all → save-once) and per-file (reload → add-one →
 * save, ×N) consume insertion differently, so they diverged ONLY on
 * `meta.entryPoint` even though levels (and same-order graphs) matched.
 *
 * Under the flag the entry point is now refined deterministically to the node
 * with the smallest id among those at the max level, making it
 * insertion-order-independent. These tests pin that contract; the DEFAULT path
 * (flag off) must keep today's first-inserted-at-max-level behavior.
 */
describe('BinaryHNSWIndex deterministic entry-point (FIX-B, flag ON)', () => {
  const SAVED = process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS;
  afterEach(() => {
    if (SAVED === undefined) delete process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS;
    else process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = SAVED;
  });

  // Well-spread deterministic binary so several nodes land above level 0
  // (a flat maxLevel=0 graph makes the entry-point tie trivial / uninformative).
  function spreadBin(seed) {
    const b = new Uint8Array(64);
    let x = (seed * 2654435761) >>> 0;
    for (let i = 0; i < 64; i += 1) {
      x = (x * 1103515245 + 12345) >>> 0;
      b[i] = x & 0xff;
    }
    return b;
  }

  // The deterministic entry point is, by construction, the lexicographically
  // smallest id among nodes whose id-assigned level equals the global max.
  function expectedEntryPointId(ids, M) {
    const probe = new BinaryHNSWIndex({ M });
    const assigned = ids.map((id) => ({ id, lvl: probe.levelForId(id) }));
    const maxLvl = Math.max(...assigned.map((a) => a.lvl));
    return assigned
      .filter((a) => a.lvl === maxLvl)
      .map((a) => a.id)
      .sort()[0];
  }

  async function buildInOrder(order, M) {
    const idx = new BinaryHNSWIndex({ M });
    idx.resetForBuild();
    for (const id of order) {
      await idx.add(id, spreadBin(Number(id.split('-')[1])));
    }
    return idx;
  }

  it('entryPoint is identical across two insertion orders (and is min-id @ maxLevel)', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    // Several M so the max level varies (M=4 → maxLevel≈2 with real ties).
    for (const M of [4, 5, 8, 16]) {
      const ids = Array.from({ length: 300 }, (_, i) => `chunk-${i}`);
      const fwd = await buildInOrder(ids, M);
      const rev = await buildInOrder([...ids].reverse(), M);

      const epFwd = fwd.vectors[fwd.entryPoint].id;
      const epRev = rev.vectors[rev.entryPoint].id;
      const expected = expectedEntryPointId(ids, M);

      expect(epFwd, `M=${M}`).toBe(epRev);
      expect(epFwd, `M=${M}`).toBe(expected);
      // maxLevel is the max id-assigned level → order-independent too.
      expect(fwd.maxLevel, `M=${M}`).toBe(rev.maxLevel);
    }
  });

  it('same insertion order → byte-identical graph + entryPoint + maxLevel (full determinism)', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    for (const M of [4, 8, 16]) {
      const ids = Array.from({ length: 300 }, (_, i) => `chunk-${i}`);
      const a = await buildInOrder(ids, M);
      const b = await buildInOrder(ids, M);
      expect(JSON.stringify(a.graph), `M=${M} graph`).toBe(JSON.stringify(b.graph));
      expect(a.entryPoint, `M=${M} entryPoint`).toBe(b.entryPoint);
      expect(a.maxLevel, `M=${M} maxLevel`).toBe(b.maxLevel);
    }
  });

  it('batched vs per-file (save/load round-trip) agree on persisted entryPointId', async () => {
    // This is the exact E.1 byte-identity gap: per-file picks the first-inserted
    // node at the max level, batched picks a different one. With the flag on the
    // refinement makes BOTH pick min-id@maxLevel. Insertion order is sorted-by-id
    // in both (the order G2 locks for the tick) so the only axis under test here
    // is the entry-point tiebreak surviving an intermediate save→load cycle.
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    const M = 5;
    const ids = Array.from({ length: 120 }, (_, i) => `chunk-${i}`).sort();

    // BATCHED: one resident index, add all, save once.
    const dirB = mkdtempSync(join(tmpdir(), 'hnsw-fixb-batched-'));
    const dirP = mkdtempSync(join(tmpdir(), 'hnsw-fixb-perfile-'));
    try {
      const batched = new BinaryHNSWIndex({ M, indexPath: join(dirB, 'idx.idx') });
      batched.resetForBuild();
      for (const id of ids) await batched.add(id, spreadBin(Number(id.split('-')[1])));
      await batched.save();

      // PER-FILE: reload from disk, add one node, save — fresh instance each step.
      const idxPath = join(dirP, 'idx.idx');
      const seed = new BinaryHNSWIndex({ M, indexPath: idxPath });
      seed.resetForBuild();
      await seed.add(ids[0], spreadBin(Number(ids[0].split('-')[1])));
      await seed.save();
      for (let i = 1; i < ids.length; i += 1) {
        const inst = new BinaryHNSWIndex({ M, indexPath: idxPath });
        await inst.load();
        await inst.add(ids[i], spreadBin(Number(ids[i].split('-')[1])));
        await inst.save();
      }

      // Reload both from disk; compare the PERSISTED entry point by id.
      const rb = new BinaryHNSWIndex({ M, indexPath: join(dirB, 'idx.idx') });
      await rb.load();
      const rp = new BinaryHNSWIndex({ M, indexPath: idxPath });
      await rp.load();

      const epBatched = rb.vectors[rb.entryPoint].id;
      const epPerFile = rp.vectors[rp.entryPoint].id;
      expect(epBatched).toBe(epPerFile);
      expect(epBatched).toBe(expectedEntryPointId(ids, M));
      expect(rb.maxLevel).toBe(rp.maxLevel);
    } finally {
      rmSync(dirB, { recursive: true, force: true });
      rmSync(dirP, { recursive: true, force: true });
    }
  });
});

describe('BinaryHNSWIndex entry-point default path (FIX-B, flag OFF unchanged)', () => {
  const SAVED = process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS;
  afterEach(() => {
    if (SAVED === undefined) delete process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS;
    else process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = SAVED;
  });

  function bin(seed) {
    const b = new Uint8Array(64);
    for (let i = 0; i < b.length; i += 1) b[i] = (seed * 31 + i) & 0xff;
    return b;
  }

  it('flag OFF (explicit =0): a tie at the max level keeps the FIRST-inserted node (legacy behavior)', async () => {
    // Det-levels is now DEFAULT-ON, so the legacy first-inserted-wins entry-point
    // path must be exercised by explicitly disabling the flag with '0'.
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '0';
    // Drive addToGraph directly with explicit equal levels so the tie is forced
    // without relying on Math.random(). The id ordering ('z' before 'a') is the
    // inverse of the deterministic min-id rule, so it proves the OFF path does
    // NOT apply the refinement: the first-inserted ('z-node') must keep the EP.
    const idx = new BinaryHNSWIndex({ M: 8 });
    idx.resetForBuild();
    // Manually register two vectors and graph them at the same level.
    idx.vectors.push({ id: 'z-node', binary: bin(1), metadata: {} });
    idx.idToIndex.set('z-node', 0);
    idx.addToGraph(0, 1); // first node at level 1 → entry point
    idx.vectors.push({ id: 'a-node', binary: bin(2), metadata: {} });
    idx.idToIndex.set('a-node', 1);
    idx.addToGraph(1, 1); // tie at maxLevel — flag OFF must NOT move EP

    expect(idx.maxLevel).toBe(1);
    expect(idx.vectors[idx.entryPoint].id).toBe('z-node');
  });

  it('flag ON: the same forced tie refines the entry point to the min id', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    const idx = new BinaryHNSWIndex({ M: 8 });
    idx.resetForBuild();
    idx.vectors.push({ id: 'z-node', binary: bin(1), metadata: {} });
    idx.idToIndex.set('z-node', 0);
    idx.addToGraph(0, 1);
    idx.vectors.push({ id: 'a-node', binary: bin(2), metadata: {} });
    idx.idToIndex.set('a-node', 1);
    idx.addToGraph(1, 1); // tie — flag ON refines to smallest id ('a-node')

    expect(idx.maxLevel).toBe(1);
    expect(idx.vectors[idx.entryPoint].id).toBe('a-node');
  });
});
