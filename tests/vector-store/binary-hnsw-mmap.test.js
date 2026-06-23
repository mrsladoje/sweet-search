/**
 * Tests for G9 — packed, mmap-backed HNSW format (gated, NO MIGRATION).
 *
 * The DEFAULT on-disk format is the JSON sidecar tuple. G9 adds a packed
 * flat-binary `.idx` that the read/search path can mmap (touched pages only),
 * activated ONLY when SWEET_SEARCH_HNSW_MMAP === '1', and even then only for
 * NEWLY written indexes. Format is detected by a magic header on the `.idx`
 * file, so old and new coexist with ZERO reindex.
 *
 * These tests assert:
 *   1. ROUND-TRIP PARITY: a packed save→mmap-load yields an identical graph,
 *      entryPoint, maxLevel, int8 vectors AND identical search results vs a
 *      JSON-sidecar build of the SAME ids (deterministic levels on so both are
 *      reproducible).
 *   2. STRONG NO-MIGRATION: with the flag OFF, save() writes the JSON sidecars
 *      byte-for-byte (modulo the savedAt timestamp) and writes NO packed `.idx`
 *      file — i.e. existing indexes are never rewritten/migrated.
 *   3. COEXISTENCE: a packed index loads via the mmap path even with the flag
 *      OFF (detected by content), and a JSON index loads via the JSON path even
 *      with the flag ON.
 *   4. The packed read view is read-only (add() throws), and init() auto-detects
 *      a packed `.idx` with no `.meta.json` present.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BinaryHNSWIndex, createBinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';

// Well-spread deterministic binary so several nodes land above level 0 (a flat
// maxLevel=0 graph makes the graph-equality assertion trivial / uninformative).
function spreadBin(seed) {
  const b = new Uint8Array(64);
  let x = (seed * 2654435761) >>> 0;
  for (let i = 0; i < 64; i += 1) {
    x = (x * 1103515245 + 12345) >>> 0;
    b[i] = x & 0xff;
  }
  return b;
}

function int8For(seed, len = 512) {
  const v = new Int8Array(len);
  for (let i = 0; i < len; i += 1) v[i] = ((seed * 7 + i) % 255) - 127;
  return v;
}

function idNum(id) {
  return Number(id.split('-')[1]);
}

async function build(M, indexPath, ids, { withInt8 = false } = {}) {
  const idx = new BinaryHNSWIndex({ M, indexPath });
  idx.resetForBuild();
  for (const id of ids) {
    const n = idNum(id);
    await idx.add(id, spreadBin(n), { f: id }, withInt8 ? int8For(n) : null);
  }
  return idx;
}

function graphsEqual(a, b) {
  if (a.graph.length !== b.graph.length) return false;
  for (let l = 0; l < a.graph.length; l += 1) {
    const la = a.graph[l] || [];
    const lb = b.graph[l] || [];
    if (la.length !== lb.length) return false;
    for (let i = 0; i < la.length; i += 1) {
      if (JSON.stringify(la[i] || []) !== JSON.stringify(lb[i] || [])) return false;
    }
  }
  return true;
}

const SAVED_MMAP = process.env.SWEET_SEARCH_HNSW_MMAP;
const SAVED_DET = process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS;

function restoreEnv() {
  if (SAVED_MMAP === undefined) delete process.env.SWEET_SEARCH_HNSW_MMAP;
  else process.env.SWEET_SEARCH_HNSW_MMAP = SAVED_MMAP;
  if (SAVED_DET === undefined) delete process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS;
  else process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = SAVED_DET;
}

describe('BinaryHNSW packed mmap — round-trip parity vs JSON sidecar (flag ON)', () => {
  afterEach(restoreEnv);

  it('packed save→mmap-load == JSON build: identical graph, entryPoint, maxLevel, search, int8', async () => {
    // Deterministic levels on so the JSON build and the packed build of the
    // same ids produce the same in-memory graph/entryPoint to begin with;
    // packing must then preserve them through a save→load cycle.
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    const ids = Array.from({ length: 250 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-parity-'));
    try {
      for (const M of [4, 5, 8]) {
        // JSON build (flag OFF) of the same ids.
        delete process.env.SWEET_SEARCH_HNSW_MMAP;
        const jp = join(dir, `j${M}.idx`);
        const jBuild = await build(M, jp, ids, { withInt8: true });
        await jBuild.save();
        expect(existsSync(jp.replace('.idx', '.meta.json')), `M=${M} JSON meta written`).toBe(true);

        // Packed build (flag ON) of the same ids.
        process.env.SWEET_SEARCH_HNSW_MMAP = '1';
        const pp = join(dir, `p${M}.idx`);
        const pBuild = await build(M, pp, ids, { withInt8: true });
        await pBuild.save();
        expect(existsSync(pp), `M=${M} packed .idx written`).toBe(true);
        expect(existsSync(pp.replace('.idx', '.meta.json')), `M=${M} no JSON meta for packed`).toBe(false);

        // Load both (load() routes by detected format, not the flag).
        const jl = new BinaryHNSWIndex({ M, indexPath: jp });
        await jl.load();
        const pl = new BinaryHNSWIndex({ M, indexPath: pp });
        await pl.load();

        expect(pl._mmapBacked, `M=${M} mmap-backed`).toBe(true);
        expect(graphsEqual(pl, jl), `M=${M} graph identical`).toBe(true);
        expect(pl.maxLevel, `M=${M} maxLevel`).toBe(jl.maxLevel);
        expect(
          pl.vectors[pl.entryPoint].id,
          `M=${M} entryPoint id`,
        ).toBe(jl.vectors[jl.entryPoint].id);

        // Identical search results across many queries.
        for (let q = 0; q < 40; q += 1) {
          const qb = spreadBin(10000 + q);
          const rp = (await pl.search(qb, 10)).results.map((r) => r.id);
          const rj = (await jl.search(qb, 10)).results.map((r) => r.id);
          expect(rp, `M=${M} q=${q} search results`).toEqual(rj);
        }

        // Identical int8 vectors (used by stage-2 rescore).
        for (const id of ids.slice(0, 30)) {
          const vp = pl.getInt8Vector(id);
          const vj = jl.getInt8Vector(id);
          expect(vp, `M=${M} int8 present ${id}`).toBeTruthy();
          expect(Array.from(vp), `M=${M} int8 bytes ${id}`).toEqual(Array.from(vj));
        }

        pl.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('packed save→mmap-load preserves the deterministic entry point (min-id @ maxLevel)', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    process.env.SWEET_SEARCH_HNSW_MMAP = '1';
    const M = 4;
    const ids = Array.from({ length: 300 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-ep-'));
    try {
      // Independently derive the expected min-id @ maxLevel entry point.
      const probe = new BinaryHNSWIndex({ M });
      const assigned = ids.map((id) => ({ id, lvl: probe.levelForId(id) }));
      const maxLvl = Math.max(...assigned.map((a) => a.lvl));
      const expectedEp = assigned.filter((a) => a.lvl === maxLvl).map((a) => a.id).sort()[0];

      const pp = join(dir, 'p.idx');
      const pBuild = await build(M, pp, ids);
      await pBuild.save();
      const pl = new BinaryHNSWIndex({ M, indexPath: pp });
      await pl.load();
      expect(pl.vectors[pl.entryPoint].id).toBe(expectedEp);
      pl.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('BinaryHNSW packed mmap — STRONG no-migration guarantee (flag OFF)', () => {
  afterEach(restoreEnv);

  it('flag OFF: save() emits the JSON sidecar format and NO packed .idx (no migration)', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    delete process.env.SWEET_SEARCH_HNSW_MMAP;
    const ids = Array.from({ length: 200 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-nomig-'));
    try {
      const ip = join(dir, 'a.idx');
      const idx = await build(8, ip, ids, { withInt8: true });
      await idx.save();

      // JSON sidecars exist; the packed .idx file does NOT (save() wrote no
      // packed binary at the .idx path).
      expect(existsSync(ip.replace('.idx', '.meta.json'))).toBe(true);
      expect(existsSync(ip.replace('.idx', '.vectors.json'))).toBe(true);
      expect(existsSync(ip.replace('.idx', '.graph.json'))).toBe(true);
      expect(existsSync(ip.replace('.idx', '.int8.json'))).toBe(true);
      expect(existsSync(ip)).toBe(false);

      // The .meta.json still carries the legacy PIPELINE_VERSION (2), NOT a
      // bumped/packed version — old readers stay compatible.
      const meta = JSON.parse(readFileSync(ip.replace('.idx', '.meta.json'), 'utf-8'));
      expect(meta.pipelineVersion).toBe(2);
      expect(meta.magic).toBeUndefined(); // JSON meta has no packed magic field
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flag OFF: two saves of the same ids are byte-identical (JSON), modulo savedAt', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    delete process.env.SWEET_SEARCH_HNSW_MMAP;
    const ids = Array.from({ length: 200 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-bytes-'));
    try {
      const a = await build(8, join(dir, 'A.idx'), ids, { withInt8: true });
      await a.save();
      const b = await build(8, join(dir, 'B.idx'), ids, { withInt8: true });
      await b.save();

      const normMeta = (f) => {
        const o = JSON.parse(readFileSync(f, 'utf-8'));
        delete o.savedAt;
        return JSON.stringify(o);
      };
      expect(normMeta(join(dir, 'A.meta.json'))).toBe(normMeta(join(dir, 'B.meta.json')));
      expect(readFileSync(join(dir, 'A.graph.json'), 'utf-8'))
        .toBe(readFileSync(join(dir, 'B.graph.json'), 'utf-8'));
      expect(readFileSync(join(dir, 'A.vectors.json'), 'utf-8'))
        .toBe(readFileSync(join(dir, 'B.vectors.json'), 'utf-8'));
      expect(readFileSync(join(dir, 'A.int8.json'), 'utf-8'))
        .toBe(readFileSync(join(dir, 'B.int8.json'), 'utf-8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a JSON index written before the flag existed is re-saved as JSON when the flag is OFF', async () => {
    // Simulate an existing index (built+saved JSON), then resave with flag off:
    // it stays JSON, .idx stays absent — no migration.
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    delete process.env.SWEET_SEARCH_HNSW_MMAP;
    const ids = Array.from({ length: 60 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-resave-'));
    try {
      const ip = join(dir, 'a.idx');
      const idx = await build(6, ip, ids);
      await idx.save();
      await idx.save(); // resave, still flag off
      expect(existsSync(ip)).toBe(false);
      expect(existsSync(ip.replace('.idx', '.meta.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('BinaryHNSW packed mmap — coexistence (format detected by content, not flag)', () => {
  afterEach(restoreEnv);

  it('a packed index loads via mmap even with the flag OFF', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    const ids = Array.from({ length: 90 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-coex1-'));
    try {
      process.env.SWEET_SEARCH_HNSW_MMAP = '1';
      const pp = join(dir, 'p.idx');
      const p = await build(6, pp, ids);
      await p.save();

      // Now the flag is OFF, but the on-disk file is packed → mmap path.
      delete process.env.SWEET_SEARCH_HNSW_MMAP;
      const pl = new BinaryHNSWIndex({ M: 6, indexPath: pp });
      await pl.load();
      expect(pl._mmapBacked).toBe(true);
      expect(pl.vectors.length).toBe(ids.length);
      expect((await pl.search(spreadBin(7), 5)).results.length).toBeGreaterThan(0);
      pl.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a JSON index loads via the JSON path even with the flag ON', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    const ids = Array.from({ length: 90 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-coex2-'));
    try {
      delete process.env.SWEET_SEARCH_HNSW_MMAP;
      const jp = join(dir, 'j.idx');
      const j = await build(6, jp, ids);
      await j.save();

      process.env.SWEET_SEARCH_HNSW_MMAP = '1';
      const jl = new BinaryHNSWIndex({ M: 6, indexPath: jp });
      await jl.load();
      expect(jl._mmapBacked).toBe(false);
      expect(jl.vectors.length).toBe(ids.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init() and createBinaryHNSWIndex() auto-detect a packed .idx (no .meta.json)', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    process.env.SWEET_SEARCH_HNSW_MMAP = '1';
    const ids = Array.from({ length: 70 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-init-'));
    try {
      const pp = join(dir, 'p.idx');
      const p = await build(6, pp, ids);
      await p.save();
      expect(existsSync(pp.replace('.idx', '.meta.json'))).toBe(false);

      const viaInit = new BinaryHNSWIndex({ M: 6, indexPath: pp });
      await viaInit.init();
      expect(viaInit._mmapBacked).toBe(true);
      expect(viaInit.vectors.length).toBe(ids.length);
      viaInit.close();

      const viaFactory = await createBinaryHNSWIndex({ M: 6, indexPath: pp });
      expect(viaFactory._mmapBacked).toBe(true);
      expect(viaFactory.vectors.length).toBe(ids.length);
      viaFactory.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('BinaryHNSW packed mmap — read-only view + integrity', () => {
  afterEach(restoreEnv);

  it('add() on an mmap-backed index throws (read/search-only)', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    process.env.SWEET_SEARCH_HNSW_MMAP = '1';
    const ids = Array.from({ length: 50 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-ro-'));
    try {
      const pp = join(dir, 'p.idx');
      const p = await build(6, pp, ids);
      await p.save();
      const pl = new BinaryHNSWIndex({ M: 6, indexPath: pp });
      await pl.load();
      await expect(pl.add('new-id', spreadBin(999))).rejects.toThrow(/read\/search-only/);
      pl.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('getStats() works on a packed index without faulting the whole graph', async () => {
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    process.env.SWEET_SEARCH_HNSW_MMAP = '1';
    const ids = Array.from({ length: 120 }, (_, i) => `chunk-${i}`).sort();
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-stats-'));
    try {
      const pp = join(dir, 'p.idx');
      const p = await build(4, pp, ids);
      await p.save();
      const pl = new BinaryHNSWIndex({ M: 4, indexPath: pp });
      await pl.load();
      const stats = pl.getStats();
      expect(stats.totalVectors).toBe(ids.length);
      expect(stats.graphNodes).toBeGreaterThan(0);
      expect(stats.graphEdges).toBeGreaterThan(0);
      pl.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a corrupt/non-magic .idx is treated as JSON-format (graceful), not packed', async () => {
    // A stray .idx file with junk content must NOT be misread as packed; the
    // content detector only returns 'packed' on the exact magic header.
    const dir = mkdtempSync(join(tmpdir(), 'hnsw-g9-junk-'));
    try {
      const ip = join(dir, 'a.idx');
      writeFileSync(ip, 'not a packed index, just junk bytes here for testing');
      const idx = new BinaryHNSWIndex({ M: 6, indexPath: ip });
      // No .meta.json either → init() falls through to a fresh empty index.
      await idx.init();
      expect(idx._mmapBacked).toBe(false);
      expect(idx.vectors.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
