/**
 * Tests for core/incremental-indexing/application/maintenance-handlers.mjs.
 *
 * Each reclamation tier (sparse_gram, binary_hnsw, li_segment)
 * has its own block. We build a deliberately small fixture, populate the
 * artifacts in their soft-deleted state (live + tombstoned), invoke the
 * handler, and assert that:
 *
 *   - retired content is gone from the new artifact
 *   - the stale bitmap is reset (or removed for HNSW)
 *   - the artifact counters move in the expected direction
 *   - missing / corrupt artifacts return `{ skipped: ... }`, never throw
 *   - a handler failure does not corrupt the surrounding state dir
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  sparseGramHandler,
  binaryHnswHandler,
  liSegmentHandler,
  reclamationHandlers,
} from '../../core/incremental-indexing/application/maintenance-handlers.mjs';
import { appendDeltaRecord, listDeltaSegments, deltaSizeStats } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import {
  createBitmap, setBit, saveBitmap, loadBitmap, popcount,
} from '../../core/incremental-indexing/infrastructure/tombstone-bitmap.mjs';

function mkState(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ss-maint-h-${prefix}-`));
}

function makeBinary(seed) {
  // 32-byte deterministic blob
  const buf = new Uint8Array(32);
  for (let i = 0; i < 32; i++) buf[i] = (seed * 31 + i) & 0xff;
  return buf;
}

/* ------------------------------------------------------------------ *
 * sparse_gram                                                         *
 * ------------------------------------------------------------------ */

describe('sparseGramHandler', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState('sg'); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('skips when ≤1 delta segment exists', async () => {
    const base = path.join(stateDir, 'codebase-sparse-grams.idx');
    // one delta only
    appendDeltaRecord(base, 1, {
      fileId: 'aa', filePath: 'a.js', contentHash: 'h1', deleted: false,
      symbolMask: 0, weightsId: 'w1', grams: [['gr', 1]],
    });
    const out = await sparseGramHandler({}, { stateDir });
    expect(out.skipped).toBe('too-few-segments');
  });

  it('compacts many deltas into one, last-record-wins per fileId', async () => {
    const base = path.join(stateDir, 'codebase-sparse-grams.idx');
    appendDeltaRecord(base, 1, { fileId: 'aa', filePath: 'a.js', contentHash: 'h1', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['x', 1]] });
    appendDeltaRecord(base, 2, { fileId: 'bb', filePath: 'b.js', contentHash: 'h2', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['y', 1]] });
    appendDeltaRecord(base, 3, { fileId: 'aa', filePath: 'a.js', contentHash: 'h3', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['z', 1]] }); // supersedes #1
    appendDeltaRecord(base, 4, { fileId: 'cc', filePath: 'c.js', contentHash: 'h4', deleted: true,  symbolMask: 0, weightsId: 'w1', grams: [] });

    expect(listDeltaSegments(base).length).toBe(4);

    const out = await sparseGramHandler({}, { stateDir });
    expect(out.skipped).toBeUndefined();
    expect(out.recordsWritten).toBe(3); // aa (latest), bb, cc (deleted preserved)
    expect(out.consumedSegments).toBe(4);

    const after = listDeltaSegments(base);
    expect(after.length).toBe(1);
    // Re-resolve via reader API and verify aa picks the latest record.
    const text = fs.readFileSync(after[0].path, 'utf-8');
    const records = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const aa = records.find((r) => r.fileId === 'aa');
    expect(aa.contentHash).toBe('h3');
    const cc = records.find((r) => r.fileId === 'cc');
    expect(cc.deleted).toBe(true);
  });

  it('reduces deltaSegmentCount below the watermark', async () => {
    const base = path.join(stateDir, 'codebase-sparse-grams.idx');
    for (let i = 1; i <= 80; i++) {
      appendDeltaRecord(base, i, { fileId: `id-${i}`, filePath: `f${i}.js`, contentHash: `h${i}`, deleted: false, symbolMask: 0, weightsId: 'w1', grams: [] });
    }
    const before = deltaSizeStats(base);
    expect(before.deltaSegments).toBeGreaterThanOrEqual(80);

    await sparseGramHandler({}, { stateDir });
    const after = deltaSizeStats(base);
    expect(after.deltaSegments).toBe(1);
  });

  it('returns skipped when the artifact directory is missing', async () => {
    const out = await sparseGramHandler({}, { stateDir });
    expect(out.skipped).toBe('too-few-segments');
  });
});

/* ------------------------------------------------------------------ *
 * binary_hnsw                                                         *
 * ------------------------------------------------------------------ */

describe('binaryHnswHandler', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState('bhnsw'); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('skips when no index meta exists', async () => {
    const out = await binaryHnswHandler({}, { stateDir });
    expect(out.skipped).toBe('no-index');
  });

  it('rebuilds visible vectors only and clears the stale bitmap', async () => {
    const indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
    const stalePath = indexPath + '.stale.bin';
    const idx = new BinaryHNSWIndex({ indexPath, floatDimension: 32 });
    await idx.init();
    for (let i = 0; i < 6; i++) {
      await idx.add(`vec-${i}`, makeBinary(i), { name: `n${i}` }, null);
    }
    await idx.save(indexPath);

    // Mark indices 1 and 4 as stale.
    const bitmap = createBitmap(8);
    setBit(bitmap, 1); setBit(bitmap, 4);
    saveBitmap(stalePath, bitmap);

    const result = await binaryHnswHandler({}, { stateDir });
    expect(result.skipped).toBeUndefined();
    expect(result.kept).toBe(4);
    expect(result.dropped).toBe(2);

    // Stale bitmap removed.
    expect(fs.existsSync(stalePath)).toBe(false);

    // Reload — no tombstoned ids should appear in vectors.
    const reloaded = new BinaryHNSWIndex({ indexPath });
    await reloaded.load(indexPath);
    const ids = new Set(reloaded.vectors.map((v) => v.id));
    expect(ids.has('vec-1')).toBe(false);
    expect(ids.has('vec-4')).toBe(false);
    expect(ids.size).toBe(4);
  });

  it('skips when the bitmap is absent', async () => {
    const indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
    const idx = new BinaryHNSWIndex({ indexPath, floatDimension: 32 });
    await idx.init();
    await idx.add('vec-0', makeBinary(0), { name: 'a' }, null);
    await idx.save(indexPath);
    const result = await binaryHnswHandler({}, { stateDir });
    expect(result.skipped).toBe('no-stale-vectors');
  });
});

/* ------------------------------------------------------------------ *
 * li_segment                                                          *
 * ------------------------------------------------------------------ */

describe('liSegmentHandler', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState('li'); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('throws when payload.segmentId is missing', async () => {
    await expect(liSegmentHandler({ payload: {} }, { stateDir })).rejects.toThrow(/segmentId/);
  });

  it('skips when no LI stub exists', async () => {
    const out = await liSegmentHandler({ payload: { segmentId: 'segment-0000.bin' } }, { stateDir });
    expect(out.skipped).toBe('no-li-index');
  });

  it('drops tombstoned docs and resets the segment stale bitmap', async () => {
    // Bootstrap a 1-segment LI fixture by using LateInteractionIndex with
    // the production write path: insert 4 docs, save, then mark 2 stale.
    const indexPath = path.join(stateDir, 'codebase-late-interaction.db');
    const writer = new LateInteractionIndex({
      indexPath, loadExisting: false, tokenDim: 4, useInt8: false, modelId: 'test', maxTokens: 8,
    });
    await writer.init();
    await writer.add('doc-0', [Float32Array.from([1, 2, 3, 4])], { name: 'a' });
    await writer.add('doc-1', [Float32Array.from([5, 6, 7, 8])], { name: 'b' });
    await writer.add('doc-2', [Float32Array.from([9, 10, 11, 12])], { name: 'c' });
    await writer.add('doc-3', [Float32Array.from([13, 14, 15, 16])], { name: 'd' });

    // Manually flush a single segment via the segmented writer path.
    // (LateInteractionIndex.add() in loadExisting=false mode populates
    // _currentSegment which we now persist as a single sealed segment.)
    const segmentDir = `${indexPath}.segments`;
    fs.mkdirSync(segmentDir, { recursive: true });
    const segmentPath = path.join(segmentDir, 'segment-0000.bin');
    await writer._writeSegmentFile(segmentPath, writer._currentSegment);
    fs.writeFileSync(path.join(segmentDir, 'manifest.json'), JSON.stringify({
      version: '3.0', format: 'sslx-v3',
      modelId: writer.modelId, tokenDim: writer.tokenDim, maxTokens: writer.maxTokens,
      useInt8: writer.useInt8, quantBits: writer.quantBits || 32,
      poolFactor: writer.poolFactor || 1, whtSeed: writer.whtSeed || 0, whtOrdering: writer.whtOrdering || 'natural',
      matryoshkaDim: writer.matryoshkaDim || 0,
      totalDocuments: 4,
      segments: [{ path: 'segment-0000.bin', count: 4 }],
    }));
    fs.writeFileSync(indexPath, JSON.stringify({ version: '3.0', format: 'segmented', segmentDir: 'codebase-late-interaction.db.segments' }));

    // Mark docs 1 and 2 as stale.
    const stalePath = segmentPath + '.stale.bin';
    const bm = createBitmap(8);
    setBit(bm, 1); setBit(bm, 2);
    saveBitmap(stalePath, bm);

    const result = await liSegmentHandler({ payload: { segmentId: 'segment-0000.bin' } }, { stateDir });
    expect(result.skipped).toBeUndefined();
    expect(result.kept).toBe(2);
    expect(result.dropped).toBe(2);
    expect(result.staleBitmapCleared).toBe(true);

    // Manifest count updated.
    const newManifest = JSON.parse(fs.readFileSync(path.join(segmentDir, 'manifest.json'), 'utf-8'));
    expect(newManifest.segments[0].count).toBe(2);
    expect(newManifest.totalDocuments).toBe(2);

    // Stale bitmap reset (or recreated empty).
    const bm2 = loadBitmap(stalePath);
    if (bm2) expect(popcount(bm2)).toBe(0);

    // Reload the index and confirm only doc-0 / doc-3 are present.
    // Pass matching modelId so the loader doesn't bail (fixture uses
    // modelId='test', not the default 'lateon-code').
    const reloaded = new LateInteractionIndex({ indexPath, loadExisting: true, modelId: 'test' });
    await reloaded.init();
    const ids = new Set(reloaded.documents.keys());
    expect(ids.has('doc-1')).toBe(false);
    expect(ids.has('doc-2')).toBe(false);
    expect(ids.has('doc-0')).toBe(true);
    expect(ids.has('doc-3')).toBe(true);
  });

  it('skips when the requested segment is not in the manifest', async () => {
    const segmentDir = path.join(stateDir, 'codebase-late-interaction.db.segments');
    fs.mkdirSync(segmentDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'codebase-late-interaction.db'), JSON.stringify({ version: '3.0', format: 'segmented', segmentDir: 'codebase-late-interaction.db.segments' }));
    fs.writeFileSync(path.join(segmentDir, 'manifest.json'), JSON.stringify({ segments: [{ path: 'segment-0000.bin', count: 0 }] }));
    const out = await liSegmentHandler({ payload: { segmentId: 'segment-9999.bin' } }, { stateDir });
    expect(out.skipped).toBe('unknown-segment');
  });
});

/* ------------------------------------------------------------------ *
 * Registry                                                            *
 * ------------------------------------------------------------------ */

describe('reclamationHandlers registry', () => {
  it('returns handlers for every reclamation tier', () => {
    const h = reclamationHandlers('/tmp/whatever');
    expect(typeof h.sparse_gram).toBe('function');
    expect(typeof h.binary_hnsw).toBe('function');
    expect(typeof h.li_segment).toBe('function');
  });
});

/* ------------------------------------------------------------------ *
 * Cross-process publish atomicity                                     *
 *                                                                     *
 * These tests pin the contract that maintenance handlers leave the    *
 * canonical artifacts consistent for cross-process readers:           *
 *   - sparse: the reconcile manifest's `sparseGram.deltas` list MUST  *
 *     reference only segments that exist on disk after compaction.    *
 *   - binary HNSW: no `.tmp.<pid>` staging files leak past a          *
 *     successful save (atomic publish protocol).                      *
 * ------------------------------------------------------------------ */

describe('cross-process publish atomicity', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState('atomic'); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('sparseGramHandler updates the reconcile manifest to point at the surviving segment', async () => {
    const base = path.join(stateDir, 'codebase-sparse-grams.idx');
    // Bootstrap with 3 delta segments.
    appendDeltaRecord(base, 1, { fileId: 'aa', filePath: 'a.js', contentHash: 'h1', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['x', 1]] });
    appendDeltaRecord(base, 2, { fileId: 'bb', filePath: 'b.js', contentHash: 'h2', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['y', 1]] });
    appendDeltaRecord(base, 3, { fileId: 'cc', filePath: 'c.js', contentHash: 'h3', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['z', 1]] });

    // Bootstrap a manifest whose deltas list references those 3 segments.
    const { writeManifest, zeroManifest } = await import('../../core/incremental-indexing/infrastructure/manifest.mjs');
    const segsBefore = listDeltaSegments(base);
    const manifest = zeroManifest({});
    manifest.epoch = 5;
    manifest.sparseGram.deltas = segsBefore.map((s) =>
      path.relative(stateDir, s.path).replace(/\\/g, '/'),
    );
    writeManifest(stateDir, manifest);

    const out = await sparseGramHandler({}, { stateDir });
    expect(out.skipped).toBeUndefined();
    expect(out.manifestUpdated).toBe(true);

    // The directory now has the single compacted segment.
    const segsAfter = listDeltaSegments(base);
    expect(segsAfter.length).toBe(1);

    // The reconcile manifest's deltas list MUST point at the surviving
    // segment AND nothing else (otherwise fresh cross-process readers
    // would resolve zero records until the next reconcile tick).
    const { readManifest } = await import('../../core/incremental-indexing/infrastructure/manifest.mjs');
    const reloaded = readManifest(stateDir);
    expect(reloaded.sparseGram.deltas.length).toBe(1);
    const absolute = path.resolve(stateDir, reloaded.sparseGram.deltas[0]);
    expect(fs.existsSync(absolute)).toBe(true);
    expect(absolute).toBe(segsAfter[0].path);
  });

  it('sparseGramHandler keeps consumed segments alive across the staged window (no manifest/file order race)', async () => {
    // The publish-order contract: compacted segment is written FIRST, then
    // the reconcile manifest is rewritten, and only AFTER that are the
    // consumed old segments unlinked. We assert this by injecting a
    // failing `writeManifest` step — that simulates a crash exactly at
    // the moment the false-negative window used to open. The old segments
    // MUST still be on disk and a manifest-pinned reader MUST still
    // resolve every record.
    const base = path.join(stateDir, 'codebase-sparse-grams.idx');
    appendDeltaRecord(base, 1, { fileId: 'aa', filePath: 'a.js', contentHash: 'h1', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['x', 1]] });
    appendDeltaRecord(base, 2, { fileId: 'bb', filePath: 'b.js', contentHash: 'h2', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['y', 1]] });
    appendDeltaRecord(base, 3, { fileId: 'cc', filePath: 'c.js', contentHash: 'h3', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['z', 1]] });
    const segsBefore = listDeltaSegments(base).map((s) => s.path);

    const { writeManifest, zeroManifest, readManifest } = await import('../../core/incremental-indexing/infrastructure/manifest.mjs');
    const manifest = zeroManifest({});
    manifest.epoch = 5;
    manifest.sparseGram.deltas = segsBefore.map((s) => path.relative(stateDir, s).replace(/\\/g, '/'));
    writeManifest(stateDir, manifest);

    // Force the handler's manifest-write step to throw. `writeManifest`
    // opens `reconcile-manifest.json.tmp` for writing — if we create a
    // DIRECTORY at that path, the open fails with EISDIR and the handler
    // surfaces it as `manifestError`. This is the surgical equivalent of
    // a crash exactly at the publish-order window.
    const tmpManifestBlocker = path.join(stateDir, 'reconcile-manifest.json.tmp');
    fs.mkdirSync(tmpManifestBlocker, { recursive: true });

    let out;
    try {
      out = await sparseGramHandler({}, { stateDir });
    } finally {
      fs.rmdirSync(tmpManifestBlocker);
    }

    // Handler reports the failure but does not throw.
    expect(out.skipped).toBeUndefined();
    expect(out.manifestUpdated).toBe(false);
    expect(out.manifestError).toBeTruthy();

    // The compacted segment IS present (atomic temp+rename succeeded).
    const allSegs = listDeltaSegments(base);
    expect(allSegs.length).toBe(4);

    // ALL old segments are STILL on disk. This is the heart of the fix —
    // the publish-order window is closed.
    for (const oldPath of segsBefore) expect(fs.existsSync(oldPath)).toBe(true);

    // The manifest still pins the OLD segment list (write failed).
    const stillOld = readManifest(stateDir);
    expect(stillOld.sparseGram.deltas.length).toBe(3);

    // A cross-process reader pinning the old manifest's segments list
    // RESOLVES EVERY RECORD — no microsecond zero-records window.
    const { resolveLatestSparseGramDeltaRecords } = await import('../../core/infrastructure/sparse-gram-delta-reader.js');
    const records = resolveLatestSparseGramDeltaRecords(base, { segments: stillOld.sparseGram.deltas.map((s) => path.join(stateDir, s)) });
    expect(records.size).toBe(3);
    expect(records.get('aa').record.contentHash).toBe('h1');
    expect(records.get('bb').record.contentHash).toBe('h2');
    expect(records.get('cc').record.contentHash).toBe('h3');
  });

  it('sparseGramHandler converges idempotently on the next run after a crash before manifest rewrite', async () => {
    // Simulate the crash window: write a compacted segment via deferDelete,
    // then DO NOT update the manifest and DO NOT unlink old segments.
    // Re-run the handler and assert it converges (single segment + manifest
    // updated, all old segments gone).
    const base = path.join(stateDir, 'codebase-sparse-grams.idx');
    appendDeltaRecord(base, 1, { fileId: 'aa', filePath: 'a.js', contentHash: 'h1', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['x', 1]] });
    appendDeltaRecord(base, 2, { fileId: 'bb', filePath: 'b.js', contentHash: 'h2', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['y', 1]] });
    appendDeltaRecord(base, 3, { fileId: 'cc', filePath: 'c.js', contentHash: 'h3', deleted: false, symbolMask: 0, weightsId: 'w1', grams: [['z', 1]] });
    const segsBefore = listDeltaSegments(base).map((s) => s.path);

    const { writeManifest, zeroManifest, readManifest } = await import('../../core/incremental-indexing/infrastructure/manifest.mjs');
    const { compactDeltaSegments } = await import('../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs');
    const manifest = zeroManifest({});
    manifest.epoch = 5;
    manifest.sparseGram.deltas = segsBefore.map((s) => path.relative(stateDir, s).replace(/\\/g, '/'));
    writeManifest(stateDir, manifest);

    // Simulate the "crashed midway" state: compacted segment exists, old
    // segments still exist, manifest still references old segments.
    const staged = compactDeltaSegments(base, { deferDelete: true });
    expect(fs.existsSync(staged.compactedPath)).toBe(true);
    for (const p of segsBefore) expect(fs.existsSync(p)).toBe(true);

    // Now re-run the handler — it must converge.
    const out = await sparseGramHandler({}, { stateDir });
    expect(out.skipped).toBeUndefined();
    expect(out.manifestUpdated).toBe(true);

    const after = listDeltaSegments(base);
    expect(after.length).toBe(1);

    // Old segments all gone.
    for (const oldPath of segsBefore) expect(fs.existsSync(oldPath)).toBe(false);
    // The first crashed-but-written compacted segment is also gone — it
    // was consumed by the second compaction.
    expect(fs.existsSync(staged.compactedPath)).toBe(false);

    // Manifest now references the surviving compacted segment.
    const finalManifest = readManifest(stateDir);
    expect(finalManifest.sparseGram.deltas.length).toBe(1);
    expect(path.resolve(stateDir, finalManifest.sparseGram.deltas[0])).toBe(after[0].path);

    // All three records preserved.
    const { resolveLatestSparseGramDeltaRecords } = await import('../../core/infrastructure/sparse-gram-delta-reader.js');
    const records = resolveLatestSparseGramDeltaRecords(base, { segments: finalManifest.sparseGram.deltas.map((s) => path.join(stateDir, s)) });
    expect(records.size).toBe(3);
  });

  it('BinaryHNSWIndex.load detects a persistent torn (meta, vectors) pair and refuses', async () => {
    const indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
    const idx = new BinaryHNSWIndex({ indexPath, floatDimension: 32 });
    await idx.init();
    for (let i = 0; i < 3; i += 1) {
      await idx.add(`vec-${i}`, makeBinary(i), { name: `n${i}` }, null);
    }
    await idx.save(indexPath);

    // Forge a torn pair: meta claims 99 vectors with entryPoint=42,
    // vectors.json still has 3. The microsecond publish-window
    // scenario in production; here we make it permanent so the load
    // guard's terminal-throw path is deterministic.
    const metaPath = indexPath.replace('.idx', '.meta.json');
    const realMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    fs.writeFileSync(metaPath, JSON.stringify({ ...realMeta, vectorCount: 99, entryPoint: 42 }, null, 2));

    const reloader = new BinaryHNSWIndex({ indexPath });
    await expect(reloader.load(indexPath)).rejects.toThrow(/persistent meta\/vectors inconsistency/);
  });

  it('binaryHnswHandler leaves no orphan `.tmp.<pid>` files', async () => {
    const indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
    const stalePath = indexPath + '.stale.bin';
    const idx = new BinaryHNSWIndex({ indexPath, floatDimension: 32 });
    await idx.init();
    for (let i = 0; i < 4; i += 1) {
      await idx.add(`vec-${i}`, makeBinary(i), { name: `n${i}` }, null);
    }
    await idx.save(indexPath);

    const bitmap = createBitmap(8);
    setBit(bitmap, 1);
    saveBitmap(stalePath, bitmap);

    const out = await binaryHnswHandler({}, { stateDir });
    expect(out.skipped).toBeUndefined();
    expect(out.atomicPublish).toBe(true);

    const orphans = fs.readdirSync(stateDir).filter((name) => name.includes('.tmp.'));
    expect(orphans).toEqual([]);

    // Canonical sidecars are all present.
    for (const suffix of ['meta.json', 'vectors.json', 'graph.json']) {
      expect(fs.existsSync(indexPath.replace('.idx', '.' + suffix))).toBe(true);
    }
  });
});
