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
import {
  readManifest,
  writeManifest,
  zeroManifest,
} from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import {
  enqueueMaintenanceJob,
  readMaintenanceQueue,
} from '../../core/incremental-indexing/application/maintenance-worker.mjs';

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

  it('emits progress checkpoints around per-file tier work', async () => {
    const phases = [];
    const r = new Reconciler({
      stateDir,
      adapters: makeAdapter({ readDirtySet: async () => ['a.js'] }),
      onProgress: (phase) => phases.push(phase),
    });

    await r.tick();

    expect(phases).toContain('reconciler:dirty-read');
    expect(phases).toContain('reconciler:file:hashed');
    expect(phases).toContain('reconciler:graph:start');
    expect(phases).toContain('reconciler:sparse:done');
    expect(phases).toContain('reconciler:manifest-published');
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
    const requeued = [];
    let handed = 0;
    const adapter = makeAdapter({
      readDirtySet: async () => dirty,
      requeueDirtyFiles: async (files) => { requeued.push(...files); },
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
    expect(snap.dirty_paths_deferred).toBe(2);
    expect(requeued).toEqual(['d.js', 'e.js']);
    expect(snap.chunks_encoded).toBe(3);
  });

  it('honors cpuBudgetMs between files and requeues the tail', async () => {
    const dirty = ['a.js', 'b.js', 'c.js'];
    const requeued = [];
    const handed = [];
    let nowMs = 0;
    const adapter = makeAdapter({
      readDirtySet: async () => dirty,
      requeueDirtyFiles: async (files) => { requeued.push(...files); },
      hashFile: async (file) => {
        handed.push(file);
        nowMs += 11;
        return { file, contentUnchanged: false, chunks: [] };
      },
      applyVectorDelta: async () => ({ ops: { vectors_upsert: 1 }, chunksEncoded: 1, chunksTotal: 1 }),
    });
    const r = new Reconciler({
      stateDir,
      adapters: adapter,
      now: () => nowMs,
      config: { filesPerTick: 10, cpuBudgetMs: 10 },
    });

    const snap = await r.tick();

    expect(handed).toEqual(['a.js']);
    expect(snap.files_processed).toBe(1);
    expect(snap.dirty_paths_deferred).toBe(2);
    expect(requeued).toEqual(['b.js', 'c.js']);
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

  it('publishes adapter-provided tier descriptors into the next manifest', async () => {
    const adapter = makeAdapter({
      readDirtySet: async () => ['x.js'],
      applyGraphDelta: async () => ({
        ops: { graph_upsert: 1 },
        manifest: { path: 'code-graph.next.db' },
      }),
      applyVectorDelta: async () => ({
        ops: { vectors_upsert: 1 },
        vectorOps: [{ id: 'x' }],
        tokenOps: [{ id: 'x' }],
        gramOps: [{ file: 'x.js' }],
        manifest: { path: 'codebase.next.db' },
      }),
      applyHNSWDelta: async () => ({
        ops: { hnsw_add: 1 },
        manifest: { path: 'codebase-hnsw.next.idx', stale: 'codebase-hnsw.next.idx.stale.bin' },
      }),
      applyBinaryHNSWDelta: async () => ({
        ops: { binary_hnsw_append: 1 },
        manifest: { path: 'codebase-binary-hnsw.next.idx' },
      }),
      applyLIDelta: async () => ({
        ops: { li_segment_append: 1 },
        manifest: { manifest: 'codebase-late-interaction.next.db.segments/manifest.json' },
      }),
      applySparseGramDelta: async () => ({
        ops: { sparse_gram_delta_upsert: 1 },
        manifest: {
          base: 'codebase-sparse-grams.idx',
          deltas: ['codebase-sparse-grams.idx.deltas/1-0.ssgrmdelta'],
          weightsId: 'weights-v2',
        },
      }),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    await r.tick();
    const manifest = readManifest(stateDir);

    expect(manifest.codeGraph.path).toBe('code-graph.next.db');
    expect(manifest.vectors.path).toBe('codebase.next.db');
    expect(manifest.hnsw).toMatchObject({
      path: 'codebase-hnsw.next.idx',
      stale: 'codebase-hnsw.next.idx.stale.bin',
      epoch: 1,
    });
    expect(manifest.binaryHnsw.path).toBe('codebase-binary-hnsw.next.idx');
    expect(manifest.lateInteraction.manifest).toBe('codebase-late-interaction.next.db.segments/manifest.json');
    expect(manifest.sparseGram).toMatchObject({
      deltas: ['codebase-sparse-grams.idx.deltas/1-0.ssgrmdelta'],
      weightsId: 'weights-v2',
      epoch: 1,
    });
  });

  it('merges sparse-gram delta allowlists across multiple dirty files', async () => {
    const adapter = makeAdapter({
      readDirtySet: async () => ['a.js', 'b.js'],
      applySparseGramDelta: async (file) => ({
        ops: { sparse_gram_delta_upsert: 1 },
        manifest: {
          deltas: [`codebase-sparse-grams.idx.deltas/1-${file[0]}.ssgrmdelta`],
        },
      }),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    await r.tick();
    const manifest = readManifest(stateDir);

    expect(manifest.sparseGram.deltas).toEqual([
      'codebase-sparse-grams.idx.deltas/1-a.ssgrmdelta',
      'codebase-sparse-grams.idx.deltas/1-b.ssgrmdelta',
    ]);
  });

  it('carries forward previous sparse-gram delta allowlists when appending a new delta', async () => {
    const previous = zeroManifest({
      sparseBase: 'codebase-sparse-grams.idx',
      sparseDeltas: ['codebase-sparse-grams.idx.deltas/5-old.ssgrmdelta'],
      weightsId: 'weights-v2',
    });
    previous.epoch = 5;
    previous.sparseGram.epoch = 5;
    writeManifest(stateDir, previous);
    const adapter = makeAdapter({
      readDirtySet: async () => ['c.js'],
      applySparseGramDelta: async () => ({
        ops: { sparse_gram_delta_upsert: 1 },
        manifest: {
          deltas: ['codebase-sparse-grams.idx.deltas/6-new.ssgrmdelta'],
        },
      }),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    await r.tick();
    const manifest = readManifest(stateDir);

    expect(manifest.epoch).toBe(6);
    expect(manifest.sparseGram).toMatchObject({
      base: 'codebase-sparse-grams.idx',
      weightsId: 'weights-v2',
      epoch: 6,
    });
    expect(manifest.sparseGram.deltas).toEqual([
      'codebase-sparse-grams.idx.deltas/5-old.ssgrmdelta',
      'codebase-sparse-grams.idx.deltas/6-new.ssgrmdelta',
    ]);
  });

  it('replaces sparse-gram delta allowlists when a new compacted base is published', async () => {
    const previous = zeroManifest({
      sparseBase: 'codebase-sparse-grams.idx',
      sparseDeltas: ['codebase-sparse-grams.idx.deltas/5-old.ssgrmdelta'],
      weightsId: 'weights-v2',
    });
    previous.epoch = 5;
    previous.sparseGram.epoch = 5;
    writeManifest(stateDir, previous);
    const adapter = makeAdapter({
      readDirtySet: async () => ['c.js'],
      applySparseGramDelta: async () => ({
        ops: { sparse_gram_delta_upsert: 1 },
        manifest: {
          base: 'codebase-sparse-grams.compacted.idx',
          deltas: [],
        },
      }),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    await r.tick();
    const manifest = readManifest(stateDir);

    expect(manifest.epoch).toBe(6);
    expect(manifest.sparseGram).toMatchObject({
      base: 'codebase-sparse-grams.compacted.idx',
      deltas: [],
      weightsId: 'weights-v2',
      epoch: 6,
    });
  });

  it('clears sparse-gram delta allowlists when a compacted base omits deltas', async () => {
    const previous = zeroManifest({
      sparseBase: 'codebase-sparse-grams.idx',
      sparseDeltas: ['codebase-sparse-grams.idx.deltas/5-old.ssgrmdelta'],
      weightsId: 'weights-v2',
    });
    previous.epoch = 5;
    previous.sparseGram.epoch = 5;
    writeManifest(stateDir, previous);
    const adapter = makeAdapter({
      readDirtySet: async () => ['c.js'],
      applySparseGramDelta: async () => ({
        ops: { sparse_gram_delta_upsert: 1 },
        manifest: { base: 'codebase-sparse-grams.compacted.idx' },
      }),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    await r.tick();
    const manifest = readManifest(stateDir);

    expect(manifest.sparseGram).toMatchObject({
      base: 'codebase-sparse-grams.compacted.idx',
      deltas: [],
      weightsId: 'weights-v2',
      epoch: 6,
    });
  });

  it('clears sparse-gram delta allowlists when the active weightsId changes', async () => {
    const previous = zeroManifest({
      sparseBase: 'codebase-sparse-grams.idx',
      sparseDeltas: ['codebase-sparse-grams.idx.deltas/5-old.ssgrmdelta'],
      weightsId: 'weights-v2',
    });
    previous.epoch = 5;
    previous.sparseGram.epoch = 5;
    writeManifest(stateDir, previous);
    const adapter = makeAdapter({
      readDirtySet: async () => ['c.js'],
      applySparseGramDelta: async () => ({
        ops: { sparse_gram_delta_upsert: 1 },
        manifest: { weightsId: 'weights-v3' },
      }),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    await r.tick();
    const manifest = readManifest(stateDir);

    expect(manifest.sparseGram).toMatchObject({
      base: 'codebase-sparse-grams.idx',
      deltas: [],
      weightsId: 'weights-v3',
      epoch: 6,
    });
  });

  it('evaluates maintenance watermarks and enqueues jobs during the tick', async () => {
    const adapter = makeAdapter({
      readMaintenanceState: () => ({
        fts5: { segmentCount: 70 },
        sparseGram: { deltaSizeRatio: 0.2 },
      }),
      scheduleMaintenance: async (job) => enqueueMaintenanceJob(stateDir, job),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    const snap = await r.tick();
    const jobs = readMaintenanceQueue(stateDir);

    expect(snap.maintenance_jobs_enqueued).toBe(2);
    expect(jobs.map((job) => job.tier).sort()).toEqual(['fts5', 'sparse_gram']);
    expect(jobs.every((job) => job.epoch === 1)).toBe(true);
  });

  it('accepts precomputed maintenance jobs from the adapter', async () => {
    const scheduled = [];
    const adapter = makeAdapter({
      readMaintenanceState: () => [
        { tier: 'li_segment', reason: 'stale_doc_ratio', payload: { segmentId: 's1' } },
      ],
      scheduleMaintenance: async (job) => scheduled.push(job),
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    const snap = await r.tick();

    expect(snap.maintenance_jobs_enqueued).toBe(1);
    expect(scheduled[0]).toMatchObject({ tier: 'li_segment', epoch: 1 });
  });

  it('does not schedule maintenance when manifest publish fails', async () => {
    const scheduled = [];
    const requeued = [];
    const adapter = makeAdapter({
      readDirtySet: async () => ['x'],
      readMaintenanceState: () => [
        { tier: 'fts5', reason: 'segment_count', payload: { segmentCount: 70 } },
      ],
      scheduleMaintenance: async (job) => scheduled.push(job),
      requeueDirtyFiles: async (files) => { requeued.push(...files); },
      persistManifest: async () => {
        throw new Error('manifest write failed');
      },
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    await expect(r.tick()).rejects.toThrow(/manifest write failed/);
    expect(scheduled).toEqual([]);
    expect(requeued).toEqual(['x']);
    expect(readManifest(stateDir)).toBeNull();
  });

  it('does not duplicate already-requeued budget tails when publish fails', async () => {
    const requeueCalls = [];
    const adapter = makeAdapter({
      readDirtySet: async () => ['a.js', 'b.js', 'c.js', 'd.js'],
      requeueDirtyFiles: async (files) => { requeueCalls.push([...files]); },
      applyVectorDelta: async () => ({ ops: { vectors_upsert: 1 }, chunksEncoded: 1, chunksTotal: 1 }),
      persistManifest: async () => {
        throw new Error('manifest write failed');
      },
    });
    const r = new Reconciler({
      stateDir,
      adapters: adapter,
      config: { filesPerTick: 2 },
    });

    await expect(r.tick()).rejects.toThrow(/manifest write failed/);

    expect(requeueCalls).toEqual([
      ['c.js', 'd.js'],
      ['a.js', 'b.js'],
    ]);
    expect(new Set(requeueCalls.flat()).size).toBe(4);
  });

  it('requeues the drained dirty snapshot when a per-file update fails before publish', async () => {
    const dirty = ['a.js', 'b.js', 'c.js'];
    const requeued = [];
    const adapter = makeAdapter({
      readDirtySet: async () => dirty,
      requeueDirtyFiles: async (files) => { requeued.push(...files); },
      applyVectorDelta: async (file) => {
        if (file === 'b.js') throw new Error('vector delta failed');
        return { ops: { vectors_upsert: 1 }, chunksEncoded: 1, chunksTotal: 1 };
      },
    });
    const r = new Reconciler({ stateDir, adapters: adapter });

    await expect(r.tick()).rejects.toThrow(/vector delta failed/);
    expect(requeued).toEqual(dirty);
    expect(readManifest(stateDir)).toBeNull();
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
