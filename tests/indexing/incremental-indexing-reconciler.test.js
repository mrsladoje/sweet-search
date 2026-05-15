/**
 * Tests for core/incremental-indexing/application/reconciler.mjs
 *
 * Plan § 6.1, § 8.1, § 13 Phase 2:
 *   - tick() advances the manifest epoch by 1.
 *   - tick() honors filesPerTick budget.
 *   - tick() routes adapter ops into the per-tier counters.
 *   - tick() refuses re-entrance.
 *   - reader heartbeats round-trip through the reconciler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Reconciler } from '../../core/incremental-indexing/application/reconciler.mjs';
import { readManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';

function makeAdapter(overrides = {}) {
  return {
    readDirtySet: async () => [],
    hashFile: async (file) => ({ file, contentUnchanged: false, chunks: [] }),
    applyGraphDelta: async () => ({ ops: { graph_upsert: 0 } }),
    applyVectorDelta: async () => ({ ops: { vectors_upsert: 0 } }),
    applyHNSWDelta: async () => ({ ops: { hnsw_add: 0 } }),
    applyBinaryHNSWDelta: async () => ({ ops: { binary_hnsw_append: 0 } }),
    applyLIDelta: async () => ({ ops: { li_segment_append: 0 } }),
    applySparseGramDelta: async () => ({ ops: { sparse_gram_delta_upsert: 0 } }),
    ...overrides,
  };
}

describe('Reconciler / tick lifecycle', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-reconciler-'));
  });
  afterEach(() => {
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch {}
  });

  it('publishes a manifest with the next epoch on first tick', async () => {
    const r = new Reconciler({ stateDir, adapters: makeAdapter() });
    const snap = await r.tick();
    expect(snap.epoch).toBe(1);
    const m = readManifest(stateDir);
    expect(m.epoch).toBe(1);
  });

  it('monotonically advances the epoch across consecutive ticks', async () => {
    const r = new Reconciler({ stateDir, adapters: makeAdapter() });
    const a = await r.tick();
    const b = await r.tick();
    const c = await r.tick();
    expect([a.epoch, b.epoch, c.epoch]).toEqual([1, 2, 3]);
  });

  it('honors filesPerTick when more dirty files exist than budget', async () => {
    const dirty = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'];
    let handed = 0;
    const adapter = makeAdapter({
      readDirtySet: async () => dirty,
      hashFile: async (file) => {
        handed += 1;
        return { file, contentUnchanged: false, chunks: [] };
      },
      applyVectorDelta: async () => ({ ops: { vectors_upsert: 1 }, chunksEncoded: 1, chunksTotal: 1 }),
    });
    const r = new Reconciler({
      stateDir,
      adapters: adapter,
      config: { filesPerTick: 3 },
    });
    const snap = await r.tick();
    expect(handed).toBe(3);
    expect(snap.files_processed).toBe(3);
    expect(snap.dirty_paths_seen).toBe(5);
    expect(snap.chunks_encoded).toBe(3);
  });

  it('counts files whose content is unchanged separately', async () => {
    const adapter = makeAdapter({
      readDirtySet: async () => ['a.js', 'b.js'],
      hashFile: async (file) => ({ file, contentUnchanged: file === 'a.js' }),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });
    const snap = await r.tick();
    expect(snap.content_unchanged).toBe(1);
    expect(snap.files_processed).toBe(1);
  });

  it('routes per-tier ops into the metrics object', async () => {
    const adapter = makeAdapter({
      readDirtySet: async () => ['x.js'],
      hashFile: async (file) => ({ file, contentUnchanged: false, chunks: [] }),
      applyGraphDelta: async () => ({ ops: { graph_upsert: 5, graph_tombstone: 1 } }),
      applyVectorDelta: async () => ({
        ops: { vectors_upsert: 4, vectors_delete: 2 },
        chunksTotal: 5,
        chunksEncoded: 4,
        chunksReused: 1,
      }),
      applyHNSWDelta: async () => ({ ops: { hnsw_add: 4, hnsw_tombstone: 2 } }),
      applyLIDelta: async () => ({ ops: { li_segment_append: 4, li_tombstone: 2 } }),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });
    const snap = await r.tick();
    expect(snap.ops_per_tier.graph_upsert).toBe(5);
    expect(snap.ops_per_tier.vectors_upsert).toBe(4);
    expect(snap.ops_per_tier.hnsw_add).toBe(4);
    expect(snap.ops_per_tier.li_tombstone).toBe(2);
    expect(snap.chunks_encoded).toBe(4);
    expect(snap.chunks_hash_reused).toBe(1);
  });

  it('refuses re-entrance during an in-flight tick', async () => {
    let resolveInflight;
    const inflight = new Promise((res) => { resolveInflight = res; });
    const adapter = makeAdapter({
      readDirtySet: async () => ['x'],
      hashFile: async (file) => {
        await inflight;
        return { file, contentUnchanged: false, chunks: [] };
      },
    });
    const r = new Reconciler({ stateDir, adapters: adapter });
    const tickPromise = r.tick();
    await expect(r.tick()).rejects.toThrow(/tick already in progress/);
    resolveInflight();
    await tickPromise;
  });

  it('reader heartbeats round-trip via the reconciler helpers', () => {
    const r = new Reconciler({ stateDir, adapters: makeAdapter() });
    const record = r.beginRead(123);
    expect(r.minLiveEpoch()).toBe(123);
    r.endRead(record);
    expect(r.minLiveEpoch()).toBeNull();
  });
});
