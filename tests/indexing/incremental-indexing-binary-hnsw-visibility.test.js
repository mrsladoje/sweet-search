/**
 * Tests for the Binary-HNSW stale-visibility fix.
 *
 * Bug: a vector retired in codebase.db could remain *visible* in the Binary-HNSW
 * coarse index (present in vectors.json, stale bit unset) indefinitely. Root
 * cause: binary reclamation trusted its own stale bitmap as the liveness
 * authority, while codebase.db is the real source of truth — so a retire that
 * never set the binary stale bit (a rare op-delivery gap) was never healed
 * (unlike float HNSW, whose clean replacement already rebuilds from
 * `vectors WHERE epoch_retired IS NULL`).
 *
 * Fix:
 *   - `binaryHnswHandler` rebuilds the keep-set from codebase.db live ids.
 *   - `readBinaryHnswState` reports divergence (`unexplainedDead`) so the
 *     watermark scheduler fires binary_hnsw promptly even below the dead-doc
 *     ratio.
 *   - `evaluateWatermarks` schedules binary_hnsw on `unexplainedDead > 0`.
 *
 * These tests use real SQLite DBs + the real BinaryHNSWIndex (no DB mocks).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { binaryHnswHandler } from '../../core/incremental-indexing/application/maintenance-handlers.mjs';
import { readBinaryHnswState } from '../../core/incremental-indexing/infrastructure/maintenance-state-reader.mjs';
import { evaluateWatermarks, DEFAULT_WATERMARKS } from '../../core/incremental-indexing/domain/watermark-scheduler.mjs';
import { markBinaryStale } from '../../core/incremental-indexing/application/production-reconciler-helpers.mjs';
import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';
import { loadBitmap, isSet } from '../../core/incremental-indexing/infrastructure/tombstone-bitmap.mjs';

function mkState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bin-vis-'));
}

function makeBinary(seed) {
  const buf = new Uint8Array(32);
  for (let i = 0; i < 32; i++) buf[i] = (seed * 31 + i) & 0xff;
  return buf;
}

/** Build + persist a binary index with the given ids. */
async function buildBinaryIndex(stateDir, ids) {
  const indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
  const idx = new BinaryHNSWIndex({ indexPath, floatDimension: 32 });
  await idx.init();
  for (let i = 0; i < ids.length; i++) {
    await idx.add(ids[i], makeBinary(i), { name: ids[i] }, new Int8Array(32).fill(i));
  }
  await idx.save(indexPath);
  return indexPath;
}

/** Create codebase.db with a vectors table; `live`/`retired` are id arrays. */
function buildVectorsDb(stateDir, { live = [], retired = [] }) {
  const db = new Database(path.join(stateDir, 'codebase.db'));
  try {
    db.exec(`
      CREATE TABLE vectors (
        id TEXT PRIMARY KEY, embedding BLOB, metadata TEXT,
        file_path TEXT, epoch_written INTEGER, epoch_retired INTEGER
      )
    `);
    const ins = db.prepare('INSERT INTO vectors (id, epoch_written, epoch_retired) VALUES (?, ?, ?)');
    for (const id of live) ins.run(id, 1, null);
    for (const id of retired) ins.run(id, 1, 2);
  } finally {
    db.close();
  }
}

/** Probe-equivalent: binary ids that are visible (stale bit unset) but not live in codebase.db. */
function visibleRetired(stateDir) {
  const vec = JSON.parse(fs.readFileSync(path.join(stateDir, 'codebase-binary-hnsw.vectors.json'), 'utf8'));
  const db = new Database(path.join(stateDir, 'codebase.db'), { readonly: true });
  let live;
  try { live = new Set(db.prepare('SELECT id FROM vectors WHERE epoch_retired IS NULL').all().map((r) => r.id)); }
  finally { db.close(); }
  const sp = path.join(stateDir, 'codebase-binary-hnsw.idx.stale.bin');
  const bm = fs.existsSync(sp) ? loadBitmap(sp) : null;
  const out = [];
  for (let i = 0; i < vec.length; i++) {
    if (!(bm && isSet(bm, i)) && !live.has(vec[i].id)) out.push(vec[i].id);
  }
  return out;
}

function binaryIds(stateDir) {
  const vec = JSON.parse(fs.readFileSync(path.join(stateDir, 'codebase-binary-hnsw.vectors.json'), 'utf8'));
  return new Set(vec.map((v) => v.id));
}

describe('binaryHnswHandler / codebase.db source-of-truth', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('drops a vector retired in codebase.db even when its binary stale bit was never set', async () => {
    await buildBinaryIndex(stateDir, ['v0', 'v1', 'v2', 'v3']);
    // v1 retired in codebase.db, but NO binary stale bitmap exists (the bug).
    buildVectorsDb(stateDir, { live: ['v0', 'v2', 'v3'], retired: ['v1'] });
    expect(visibleRetired(stateDir)).toEqual(['v1']); // bug present before heal

    const res = await binaryHnswHandler({}, { stateDir });
    expect(res.dropped).toBe(1);
    expect(res.kept).toBe(3);
    expect(binaryIds(stateDir).has('v1')).toBe(false);
    expect(visibleRetired(stateDir)).toEqual([]); // healed
  });

  it('keeps live vectors and drops codebase.db-retired ones (mixed)', async () => {
    await buildBinaryIndex(stateDir, ['a', 'b', 'c', 'd', 'e']);
    buildVectorsDb(stateDir, { live: ['a', 'c', 'e'], retired: ['b', 'd'] });
    const res = await binaryHnswHandler({}, { stateDir });
    expect(res.dropped).toBe(2);
    expect([...binaryIds(stateDir)].sort()).toEqual(['a', 'c', 'e']);
    expect(visibleRetired(stateDir)).toEqual([]);
  });

  it('skips when binary already matches codebase.db live set', async () => {
    await buildBinaryIndex(stateDir, ['a', 'b']);
    buildVectorsDb(stateDir, { live: ['a', 'b'], retired: [] });
    const res = await binaryHnswHandler({}, { stateDir });
    expect(res.skipped).toBe('no-stale-vectors');
    expect(res.dropped).toBe(0);
  });

  it('falls back to the stale bitmap when codebase.db is absent', async () => {
    const indexPath = await buildBinaryIndex(stateDir, ['x0', 'x1', 'x2']);
    // No codebase.db. Mark x1 stale via the production marker.
    const idx = new BinaryHNSWIndex({ indexPath, floatDimension: 32 });
    await idx.load(indexPath);
    expect(markBinaryStale(idx, 'x1')).toBe(true);
    const res = await binaryHnswHandler({}, { stateDir });
    expect(res.dropped).toBe(1);
    expect(binaryIds(stateDir).has('x1')).toBe(false);
  });
});

describe('readBinaryHnswState / divergence detection', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('reports unexplainedDead>0 for a codebase.db-retired vector with no stale bit', async () => {
    await buildBinaryIndex(stateDir, ['v0', 'v1', 'v2', 'v3']);
    buildVectorsDb(stateDir, { live: ['v0', 'v2', 'v3'], retired: ['v1'] });
    const st = readBinaryHnswState(stateDir);
    expect(st.unexplainedDead).toBe(1);
    expect(st.deadDocRatio).toBeCloseTo(0.25, 5);
  });

  it('reports unexplainedDead=0 when binary matches codebase.db live set', async () => {
    await buildBinaryIndex(stateDir, ['v0', 'v1']);
    buildVectorsDb(stateDir, { live: ['v0', 'v1'], retired: [] });
    const st = readBinaryHnswState(stateDir);
    expect(st.unexplainedDead).toBe(0);
    expect(st.deadDocRatio).toBe(0);
  });
});

describe('evaluateWatermarks / binary_hnsw scheduling', () => {
  it('schedules binary_hnsw on unexplained divergence even below the dead-doc ratio', () => {
    const jobs = evaluateWatermarks({ binaryHnsw: { deadDocRatio: 0.05, unexplainedDead: 1 } }, DEFAULT_WATERMARKS);
    expect(jobs.find((j) => j.tier === 'binary_hnsw')).toMatchObject({
      tier: 'binary_hnsw',
      reason: 'codebase_divergence',
    });
  });

  it('schedules binary_hnsw on the dead-doc ratio when no unexplained divergence', () => {
    const jobs = evaluateWatermarks({ binaryHnsw: { deadDocRatio: 0.5, unexplainedDead: 0 } }, DEFAULT_WATERMARKS);
    expect(jobs.find((j) => j.tier === 'binary_hnsw')).toMatchObject({
      tier: 'binary_hnsw',
      reason: 'dead_doc_ratio',
    });
  });

  it('does NOT schedule binary_hnsw when below ratio and no divergence', () => {
    const jobs = evaluateWatermarks({ binaryHnsw: { deadDocRatio: 0.05, unexplainedDead: 0 } }, DEFAULT_WATERMARKS);
    expect(jobs.find((j) => j.tier === 'binary_hnsw')).toBeUndefined();
  });
});

describe('markBinaryStale / stale bitmap persists across save+load', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('a non-clean-build save preserves a stale mark', async () => {
    const indexPath = await buildBinaryIndex(stateDir, ['p0', 'p1', 'p2']);
    const idx = new BinaryHNSWIndex({ indexPath, floatDimension: 32 });
    await idx.load(indexPath);
    expect(markBinaryStale(idx, 'p1')).toBe(true);
    // A subsequent ordinary save (not a clean build) must not clobber the bitmap.
    await idx.save(indexPath);

    const reloaded = new BinaryHNSWIndex({ indexPath, floatDimension: 32 });
    await reloaded.load(indexPath);
    const pos = reloaded.vectors.findIndex((v) => v.id === 'p1');
    const bm = loadBitmap(path.join(stateDir, 'codebase-binary-hnsw.idx.stale.bin'));
    expect(bm).not.toBeNull();
    expect(isSet(bm, pos)).toBe(true);
  });
});
