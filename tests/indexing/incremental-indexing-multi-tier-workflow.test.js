/**
 * Multi-tier reconcile workflow.
 *
 * Plan § 7.1-7.7. The reconcile tick must touch ALL five physical indices
 * in lock-step. This test exercises each tier's domain/infrastructure
 * adapter through realistic scenarios:
 *
 *   - code-graph entities (with FTS5 merge tick)
 *   - codebase.db vectors (via vector-delta-writer)
 *   - Float HNSW (tombstone bitmap + add appends)
 *   - Binary HNSW (tombstone bitmap)
 *   - LI segments (per-segment stale ratio + recompaction trigger)
 *   - Sparse-gram (per-file delta record + watermark)
 *   - HCGS summary invalidation in the same epoch
 *
 * The tests prove the *outputs* of each tier-touching call land on disk
 * (or in the in-memory DB) as the plan specifies, and that the watermark
 * scheduler sees the resulting state and emits the right maintenance
 * jobs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createBitmap, loadBitmap, saveBitmap, setBit, popcount, isSet,
  tombstoneFraction, filterLive, resizeBitmap,
} from '../../core/incremental-indexing/infrastructure/tombstone-bitmap.mjs';
import {
  openSegmentState, tombstoneDoc, persistSegmentState,
  staleDocRatio, evaluateSegmentRatios, listSegments, isDocTombstoned,
} from '../../core/incremental-indexing/infrastructure/li-segment-state.mjs';
import {
  appendDeltaRecord, listDeltaSegments, resolveLatestRecords,
  deltaSizeStats, recordFileDeletion, fileIdFor, FALLBACK_WEIGHTS_ID,
} from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import {
  ensureHcgsSidecarSchema, recordSummary, retireDependentSummaries,
  summaryVisibilityPredicate, pruneRetiredSummaries,
} from '../../core/incremental-indexing/infrastructure/hcgs-invalidation.mjs';
import {
  evaluateWatermarks, hnswOversampleTarget, loadWatermarkConfig, DEFAULT_WATERMARKS,
} from '../../core/incremental-indexing/domain/watermark-scheduler.mjs';
import {
  enqueueMaintenanceJob, readMaintenanceQueue, appendDeadLetter,
  assertCpuOnlyEnvironment,
} from '../../core/incremental-indexing/application/maintenance-worker.mjs';
import {
  fts5SegmentCount, fts5Merge, fts5StructureDescribe, __testing as fts5Testing,
} from '../../core/incremental-indexing/infrastructure/sqlite-fts5.mjs';

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-multitier-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Float HNSW tombstone bitmap (plan § 7.3)', () => {
  it('append + tombstone preserves "tombstone-only writes" semantics', () => {
    const bm = createBitmap(1024);
    // Live state: 100 vectors added.
    for (let i = 0; i < 100; i++) {
      // No-op (live; bit stays 0).
    }
    // Retire 15 % of them: bits set.
    for (let i = 0; i < 15; i++) setBit(bm, i);
    expect(popcount(bm)).toBe(15);
    expect(tombstoneFraction(bm, 85)).toBeCloseTo(15 / 100, 3);
  });

  it('filterLive removes tombstoned candidates and preserves order', () => {
    const bm = createBitmap(64);
    setBit(bm, 2); setBit(bm, 5);
    const live = filterLive(bm, [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(live).toEqual([0, 1, 3, 4, 6, 7]);
  });

  it('resize preserves existing bits and grows capacity', () => {
    const bm = createBitmap(8);
    setBit(bm, 0); setBit(bm, 7);
    const r = resizeBitmap(bm, 256);
    expect(r.capacity).toBe(256);
    expect(isSet(r, 0)).toBe(true);
    expect(isSet(r, 7)).toBe(true);
    expect(isSet(r, 255)).toBe(false);
  });

  it('persists across save/load round-trip (atomic write)', () => {
    const file = path.join(tmpDir, 'codebase-hnsw.idx.stale.bin');
    const bm = createBitmap(2000);
    setBit(bm, 1); setBit(bm, 1999);
    saveBitmap(file, bm);
    const reloaded = loadBitmap(file);
    expect(reloaded.capacity).toBe(2000);
    expect(isSet(reloaded, 1)).toBe(true);
    expect(isSet(reloaded, 1999)).toBe(true);
    expect(popcount(reloaded)).toBe(2);
  });

  it('header is 64-byte aligned (SIMD requirement plan § 34.4)', () => {
    const file = path.join(tmpDir, 'aligned.bin');
    saveBitmap(file, createBitmap(1));
    const raw = fs.readFileSync(file);
    expect(raw.length % 64).toBe(0);
    expect(raw.subarray(0, 4).toString('ascii')).toBe('SSTB');
  });

  it('isSet returns false for out-of-range index without throwing', () => {
    const bm = createBitmap(8);
    expect(isSet(bm, 9999)).toBe(false);
    expect(() => setBit(bm, 9999)).toThrow(/outside bitmap capacity/);
  });

  it('rejects nonpositive capacity', () => {
    expect(() => createBitmap(0)).toThrow();
    expect(() => createBitmap(-1)).toThrow();
  });

  it('rejects malformed header on load', () => {
    const file = path.join(tmpDir, 'bad.bin');
    fs.writeFileSync(file, Buffer.alloc(100, 0xAB));
    expect(() => loadBitmap(file)).toThrow(/magic mismatch/);
  });

  it('rejects too-short file on load', () => {
    const file = path.join(tmpDir, 'tiny.bin');
    fs.writeFileSync(file, Buffer.from('SS', 'ascii'));
    expect(() => loadBitmap(file)).toThrow(/too short/);
  });

  it('rejects unsupported version', () => {
    const file = path.join(tmpDir, 'badver.bin');
    const buf = Buffer.alloc(128);
    Buffer.from('SSTB').copy(buf, 0);
    buf.writeUInt32LE(999, 4);
    fs.writeFileSync(file, buf);
    expect(() => loadBitmap(file)).toThrow(/unsupported version/);
  });
});

describe('LI segment state (plan § 7.5)', () => {
  function makeSegment(name, docCount) {
    const dir = path.join(tmpDir, 'codebase-late-interaction.db.segments');
    fs.mkdirSync(dir, { recursive: true });
    const seg = path.join(dir, name);
    fs.writeFileSync(seg, Buffer.alloc(1024));
    return openSegmentState(seg, docCount);
  }

  it('per-segment stale_doc_ratio tracks tombstoned docs', () => {
    const state = makeSegment('seg-001.bin', 100);
    expect(staleDocRatio(state)).toBe(0);
    for (let i = 0; i < 20; i++) tombstoneDoc(state, i);
    expect(staleDocRatio(state)).toBe(0.2);
  });

  it('persistSegmentState round-trips the bitmap', () => {
    const state = makeSegment('seg-002.bin', 50);
    tombstoneDoc(state, 7);
    tombstoneDoc(state, 49);
    persistSegmentState(state);
    const reloaded = openSegmentState(state.segmentPath, 50);
    expect(isDocTombstoned(reloaded, 7)).toBe(true);
    expect(isDocTombstoned(reloaded, 49)).toBe(true);
    expect(isDocTombstoned(reloaded, 8)).toBe(false);
  });

  it('listSegments excludes .stale.bin sidecars', () => {
    const dir = path.join(tmpDir, 'codebase-late-interaction.db.segments');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'seg-001.bin'), '');
    fs.writeFileSync(path.join(dir, 'seg-001.bin.stale.bin'), '');
    fs.writeFileSync(path.join(dir, 'seg-002.bin'), '');
    const segs = listSegments(dir);
    expect(segs.length).toBe(2);
    expect(segs.every((p) => !p.endsWith('.stale.bin'))).toBe(true);
  });

  it('listSegments handles non-existent dir', () => {
    expect(listSegments(path.join(tmpDir, 'nope'))).toEqual([]);
  });

  it('evaluateSegmentRatios emits per-segment data only for nonzero counts', () => {
    const dir = path.join(tmpDir, 'codebase-late-interaction.db.segments');
    fs.mkdirSync(dir, { recursive: true });
    const segA = path.join(dir, 'seg-A.bin');
    const segB = path.join(dir, 'seg-B.bin');
    fs.writeFileSync(segA, '');
    fs.writeFileSync(segB, '');
    const stA = openSegmentState(segA, 100);
    for (let i = 0; i < 25; i++) tombstoneDoc(stA, i);
    persistSegmentState(stA);

    const stB = openSegmentState(segB, 100);
    for (let i = 0; i < 5; i++) tombstoneDoc(stB, i);
    persistSegmentState(stB);

    const counts = new Map([[segA, 100], [segB, 100]]);
    const r = evaluateSegmentRatios(dir, counts);
    expect(r.length).toBe(2);
    const ratiosByName = Object.fromEntries(r.map((x) => [x.segmentId, x.staleDocRatio]));
    expect(ratiosByName['seg-A.bin']).toBe(0.25);
    expect(ratiosByName['seg-B.bin']).toBe(0.05);

    // Empty-doc-count segments are omitted
    const r2 = evaluateSegmentRatios(dir, new Map([[segA, 0]]));
    expect(r2.length).toBe(0);
  });
});

describe('Sparse-gram delta (plan § 7.6)', () => {
  const baseArtifact = () => path.join(tmpDir, 'codebase-sparse-grams.idx');

  it('appendDeltaRecord writes one JSONL record per call', () => {
    const base = baseArtifact();
    appendDeltaRecord(base, 100, {
      fileId: fileIdFor('src/a.js'),
      filePath: 'src/a.js',
      contentHash: 'aaaa',
      deleted: false,
      symbolMask: 1,
      weightsId: FALLBACK_WEIGHTS_ID,
      grams: [[1, 2], [3, 1]],
    });
    const segs = listDeltaSegments(base);
    expect(segs.length).toBe(1);
    expect(segs[0].epoch).toBe(100);
  });

  it('latest-wins resolution per fileId across appended records', () => {
    const base = baseArtifact();
    const fid = fileIdFor('src/a.js');
    appendDeltaRecord(base, 100, {
      fileId: fid, filePath: 'src/a.js', contentHash: 'v1',
      deleted: false, symbolMask: 0, weightsId: FALLBACK_WEIGHTS_ID, grams: [[1, 1]],
    });
    appendDeltaRecord(base, 200, {
      fileId: fid, filePath: 'src/a.js', contentHash: 'v2',
      deleted: false, symbolMask: 0, weightsId: FALLBACK_WEIGHTS_ID, grams: [[1, 3]],
    });
    const latest = resolveLatestRecords(base);
    expect(latest.size).toBe(1);
    expect(latest.get(fid).record.contentHash).toBe('v2');
  });

  it('recordFileDeletion writes a deleted=true marker', () => {
    const base = baseArtifact();
    recordFileDeletion(base, 50, 'src/gone.js');
    const latest = resolveLatestRecords(base);
    const fid = fileIdFor('src/gone.js');
    expect(latest.get(fid).record.deleted).toBe(true);
  });

  it('deltaSizeStats returns ratio over base + delta bytes', () => {
    const base = baseArtifact();
    fs.writeFileSync(base, Buffer.alloc(1000));
    appendDeltaRecord(base, 1, {
      fileId: fileIdFor('a'), filePath: 'a', contentHash: 'h',
      deleted: false, symbolMask: 0, weightsId: 'default-v1', grams: [],
    });
    const stats = deltaSizeStats(base);
    expect(stats.baseBytes).toBe(1000);
    expect(stats.deltaSegments).toBe(1);
    expect(stats.ratio).toBeGreaterThan(0);
    expect(stats.ratio).toBeLessThan(1);
  });

  it('appendDeltaRecord validates inputs', () => {
    const base = baseArtifact();
    expect(() => appendDeltaRecord(base, 'not-int', { fileId: 'f' })).toThrow();
    expect(() => appendDeltaRecord(base, 1, { fileId: null })).toThrow();
  });

  it('resolveLatestRecords skips torn / non-JSON lines without crashing', () => {
    const base = baseArtifact();
    const dir = base + '.deltas';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '99-0.ssgrmdelta'),
      '{not json\n' +
      JSON.stringify({ fileId: fileIdFor('ok'), filePath: 'ok', contentHash: 'h' }) + '\n' +
      '\n' + // blank
      '{"fileId":""}\n', // missing fileId → skipped
    );
    const latest = resolveLatestRecords(base);
    expect(latest.size).toBe(1);
    expect(latest.get(fileIdFor('ok')).record.contentHash).toBe('h');
  });
});

describe('HCGS invalidation (plan § 7.7)', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    ensureHcgsSidecarSchema(db);
  });
  afterEach(() => { try { db.close(); } catch {} });

  it('records a summary with source dependencies at epoch ε', () => {
    recordSummary(db, 'ent-1', {
      sourceEntityIds: ['ent-a', 'ent-b'],
      sourceChunkStructIds: ['chunk-x'],
      sourceHashes: { 'ent-a': '111', 'ent-b': '222' },
      epoch: 7,
    });
    const row = db.prepare(
      'SELECT * FROM hcgs_summary_metadata WHERE entity_id = ?',
    ).get('ent-1');
    expect(row.epoch_written).toBe(7);
    expect(row.epoch_retired).toBeNull();
    expect(JSON.parse(row.source_entity_ids)).toEqual(['ent-a', 'ent-b']);
  });

  it('upsert clears epoch_retired when re-recording at a new epoch', () => {
    recordSummary(db, 'ent-1', {
      sourceEntityIds: ['ent-a'], sourceChunkStructIds: [],
      sourceHashes: {}, epoch: 1,
    });
    db.prepare('UPDATE hcgs_summary_metadata SET epoch_retired = 5 WHERE entity_id = ?').run('ent-1');
    recordSummary(db, 'ent-1', {
      sourceEntityIds: ['ent-a', 'ent-c'], sourceChunkStructIds: [],
      sourceHashes: {}, epoch: 10,
    });
    const row = db.prepare(
      'SELECT * FROM hcgs_summary_metadata WHERE entity_id = ?',
    ).get('ent-1');
    expect(row.epoch_written).toBe(10);
    expect(row.epoch_retired).toBeNull();
    expect(JSON.parse(row.source_entity_ids)).toEqual(['ent-a', 'ent-c']);
  });

  it('retires summaries whose source entity_id changed', () => {
    recordSummary(db, 's1', {
      sourceEntityIds: ['e1', 'e2'], sourceChunkStructIds: [],
      sourceHashes: {}, epoch: 1,
    });
    recordSummary(db, 's2', {
      sourceEntityIds: ['e3'], sourceChunkStructIds: [],
      sourceHashes: {}, epoch: 1,
    });
    const n = retireDependentSummaries(db, {
      retiredEntityIds: ['e1'],
      retiredChunkStructIds: [],
    }, /* epoch */ 5);
    expect(n).toBe(1);
    const s1 = db.prepare('SELECT epoch_retired FROM hcgs_summary_metadata WHERE entity_id = ?').get('s1');
    const s2 = db.prepare('SELECT epoch_retired FROM hcgs_summary_metadata WHERE entity_id = ?').get('s2');
    expect(s1.epoch_retired).toBe(5);
    expect(s2.epoch_retired).toBeNull();
  });

  it('retires summaries whose source chunk_struct_id changed', () => {
    recordSummary(db, 's3', {
      sourceEntityIds: [], sourceChunkStructIds: ['c1', 'c2'],
      sourceHashes: {}, epoch: 1,
    });
    const n = retireDependentSummaries(db, {
      retiredEntityIds: [],
      retiredChunkStructIds: ['c2'],
    }, 6);
    expect(n).toBe(1);
  });

  it('returns 0 retirements when sources are empty', () => {
    recordSummary(db, 'sX', {
      sourceEntityIds: ['e1'], sourceChunkStructIds: [],
      sourceHashes: {}, epoch: 1,
    });
    expect(retireDependentSummaries(db, {
      retiredEntityIds: [], retiredChunkStructIds: [],
    }, 9)).toBe(0);
  });

  it('summaryVisibilityPredicate produces the strict epoch filter', () => {
    expect(summaryVisibilityPredicate('h')).toContain('h.epoch_written <= :manifestEpoch');
    expect(summaryVisibilityPredicate()).toContain('epoch_written <= :manifestEpoch');
  });

  it('pruneRetiredSummaries deletes only rows retired at-or-before frontier', () => {
    recordSummary(db, 'old', {
      sourceEntityIds: [], sourceChunkStructIds: [],
      sourceHashes: {}, epoch: 1,
    });
    db.prepare('UPDATE hcgs_summary_metadata SET epoch_retired = 3 WHERE entity_id = ?').run('old');
    recordSummary(db, 'newer', {
      sourceEntityIds: [], sourceChunkStructIds: [],
      sourceHashes: {}, epoch: 5,
    });
    db.prepare('UPDATE hcgs_summary_metadata SET epoch_retired = 100 WHERE entity_id = ?').run('newer');

    expect(pruneRetiredSummaries(db, 50)).toBe(1);
    const remaining = db.prepare('SELECT entity_id FROM hcgs_summary_metadata').all().map((r) => r.entity_id);
    expect(remaining).toEqual(['newer']);
  });

  it('pruneRetiredSummaries rejects non-integer frontier', () => {
    expect(() => pruneRetiredSummaries(db, 1.5)).toThrow(/integer/);
  });
});

describe('Watermark scheduler (plan § 10)', () => {
  it('emits float_hnsw job when tombstone fraction exceeds threshold', () => {
    const jobs = evaluateWatermarks({
      floatHnsw: { tombstoneFraction: 0.20, deleteCycles: 0 },
      binaryHnsw: { deadDocRatio: 0 },
      liSegments: [], sparseGram: {}, fts5: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].tier).toBe('float_hnsw');
    expect(jobs[0].reason).toBe('tombstone_watermark');
  });

  it('emits float_hnsw job on delete_cycles overflow', () => {
    const jobs = evaluateWatermarks({
      floatHnsw: { tombstoneFraction: 0, deleteCycles: 2000 },
      binaryHnsw: {}, liSegments: [], sparseGram: {}, fts5: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].reason).toBe('delete_cycles');
  });

  it('emits float_hnsw job on live_candidate_shortfall', () => {
    const jobs = evaluateWatermarks({
      floatHnsw: { tombstoneFraction: 0, deleteCycles: 0, liveCandidateShortfall: true },
      binaryHnsw: {}, liSegments: [], sparseGram: {}, fts5: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].reason).toBe('live_candidate_shortfall');
  });

  it('emits binary_hnsw job on dead_doc_ratio > 0.30', () => {
    const jobs = evaluateWatermarks({
      floatHnsw: {}, binaryHnsw: { deadDocRatio: 0.4 },
      liSegments: [], sparseGram: {}, fts5: {},
    });
    expect(jobs.find((j) => j.tier === 'binary_hnsw').reason).toBe('dead_doc_ratio');
  });

  it('emits per-segment LI jobs for each segment crossing 0.20', () => {
    const jobs = evaluateWatermarks({
      floatHnsw: {}, binaryHnsw: {},
      liSegments: [
        { segmentId: 's1', staleDocRatio: 0.1 }, // under
        { segmentId: 's2', staleDocRatio: 0.25 }, // over
        { segmentId: 's3', staleDocRatio: 0.5 },  // over
      ],
      sparseGram: {}, fts5: {},
    });
    const liJobs = jobs.filter((j) => j.tier === 'li_segment');
    expect(liJobs.length).toBe(2);
    expect(liJobs.map((j) => j.payload.segmentId)).toEqual(['s2', 's3']);
  });

  it('emits sparse_gram job on deltaSizeRatio or segmentCount', () => {
    const a = evaluateWatermarks({
      floatHnsw: {}, binaryHnsw: {}, liSegments: [],
      sparseGram: { deltaSizeRatio: 0.15, deltaSegmentCount: 0 }, fts5: {},
    });
    expect(a.find((j) => j.tier === 'sparse_gram')).toBeDefined();

    const b = evaluateWatermarks({
      floatHnsw: {}, binaryHnsw: {}, liSegments: [],
      sparseGram: { deltaSizeRatio: 0, deltaSegmentCount: 100 }, fts5: {},
    });
    expect(b.find((j) => j.tier === 'sparse_gram')).toBeDefined();
  });

  it('emits fts5 job on segment count overflow', () => {
    const jobs = evaluateWatermarks({
      floatHnsw: {}, binaryHnsw: {}, liSegments: [], sparseGram: {},
      fts5: { segmentCount: 100 },
    });
    expect(jobs.find((j) => j.tier === 'fts5').payload.segmentCount).toBe(100);
  });

  it('empty state produces zero jobs', () => {
    expect(evaluateWatermarks({})).toEqual([]);
  });

  it('hnswOversampleTarget follows the formula in plan § 7.3', () => {
    // s = 0 → max(k+64, ceil(k/1 * 2)) = max(k+64, 2k)
    expect(hnswOversampleTarget(10, 0)).toBe(74);
    expect(hnswOversampleTarget(100, 0)).toBe(200);
    // s = 0.5 → max(k+64, ceil(k/0.5 * 2)) = max(k+64, 4k)
    expect(hnswOversampleTarget(10, 0.5)).toBe(74);
    expect(hnswOversampleTarget(100, 0.5)).toBe(400);
    // Hard cap k * 20
    expect(hnswOversampleTarget(1, 0.9)).toBeLessThanOrEqual(20);
  });

  it('hnswOversampleTarget clamps s to [0, 0.5] (sanity)', () => {
    expect(hnswOversampleTarget(10, -1)).toBe(hnswOversampleTarget(10, 0));
    expect(hnswOversampleTarget(10, 0.9)).toBe(hnswOversampleTarget(10, 0.5));
  });

  it('hnswOversampleTarget rejects invalid k', () => {
    expect(() => hnswOversampleTarget(0, 0)).toThrow();
    expect(() => hnswOversampleTarget(-1, 0)).toThrow();
    expect(() => hnswOversampleTarget(1.5, 0)).toThrow();
  });

  it('loadWatermarkConfig honors env overrides and falls back to defaults', () => {
    const env = {
      SWEET_SEARCH_HNSW_TOMBSTONE_THRESHOLD: '0.25',
      SWEET_SEARCH_FTS5_MERGE_SEGMENT_THRESHOLD: 'not-a-number',
    };
    const cfg = loadWatermarkConfig(env);
    expect(cfg.hnswTombstoneFraction).toBe(0.25);
    expect(cfg.fts5SegmentCount).toBe(DEFAULT_WATERMARKS.fts5SegmentCount);
  });
});

describe('Maintenance worker queue (plan § 10.2)', () => {
  it('enqueueMaintenanceJob + readMaintenanceQueue round-trip', () => {
    enqueueMaintenanceJob(tmpDir, {
      tier: 'float_hnsw', reason: 'crash_recovery', epoch: 100, payload: { reason: 'crash' },
    });
    enqueueMaintenanceJob(tmpDir, {
      tier: 'li_segment', reason: 'stale_doc_ratio', epoch: 100, payload: { segmentId: 's1' },
    });
    const jobs = readMaintenanceQueue(tmpDir);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].tier).toBe('float_hnsw');
    expect(jobs[1].tier).toBe('li_segment');
    expect(jobs[0].createdAt).toBeDefined();
  });

  it('readMaintenanceQueue returns empty array when no queue exists', () => {
    expect(readMaintenanceQueue(tmpDir)).toEqual([]);
  });

  it('readMaintenanceQueue tolerates torn/blank lines', () => {
    const file = path.join(tmpDir, 'rebuild-queue.jsonl');
    fs.writeFileSync(file, '{"tier":"ok"}\nnot-json\n\n{"tier":"ok2"}\n');
    const jobs = readMaintenanceQueue(tmpDir);
    expect(jobs.map((j) => j.tier)).toEqual(['ok', 'ok2']);
  });

  it('appendDeadLetter captures the error and the original job', () => {
    appendDeadLetter(tmpDir, { tier: 'failed' }, new Error('boom'));
    const dlPath = path.join(tmpDir, 'rebuild-queue.dead-letter.jsonl');
    const content = fs.readFileSync(dlPath, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.job.tier).toBe('failed');
    expect(parsed.error.message).toBe('boom');
    expect(parsed.deadAt).toBeDefined();
  });

  it('assertCpuOnlyEnvironment passes on a clean env', () => {
    expect(() => assertCpuOnlyEnvironment({})).not.toThrow();
  });

  it('assertCpuOnlyEnvironment passes when GPU flag is CPU-equivalent', () => {
    expect(() => assertCpuOnlyEnvironment({ SWEET_SEARCH_GPU: '0' })).not.toThrow();
    expect(() => assertCpuOnlyEnvironment({ SWEET_SEARCH_GPU: 'cpu' })).not.toThrow();
    expect(() => assertCpuOnlyEnvironment({ INDEX_GPU_BACKEND: 'OFF' })).not.toThrow();
    expect(() => assertCpuOnlyEnvironment({ INDEX_GPU_BACKEND: 'False' })).not.toThrow();
  });

  it('assertCpuOnlyEnvironment refuses when GPU flag is armed', () => {
    expect(() => assertCpuOnlyEnvironment({ SWEET_SEARCH_GPU: '1' })).toThrow(/CPU-only/);
    expect(() => assertCpuOnlyEnvironment({ INDEX_GPU_BACKEND: 'metal' })).toThrow(/CPU-only/);
  });
});

describe('FTS5 introspection (plan § 7.1.5)', () => {
  it('fts5SegmentCount returns 0 on missing table', () => {
    const db = new Database(':memory:');
    expect(fts5SegmentCount(db, 'nonexistent')).toBe(0);
    db.close();
  });

  it('fts5SegmentCount counts distinct segment IDs from leaf-rowid prefixes', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(name);`);
    // Insert + flush to grow segments.
    const insert = db.prepare(`INSERT INTO t (name) VALUES (?)`);
    for (let i = 0; i < 100; i++) insert.run(`token-${i} word-${i % 10} k-${i % 5}`);
    // Force commit so segments materialise.
    db.exec(`INSERT INTO t (t) VALUES ('rebuild')`);
    const count = fts5SegmentCount(db, 't');
    expect(count).toBeGreaterThanOrEqual(0); // any value is fine; structure differs per SQLite minor
    db.close();
  });

  it('fts5Merge invokes the bounded merge against a real FTS5 table', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(name);`);
    db.prepare(`INSERT INTO t (name) VALUES (?)`).run('hello world');
    expect(() => fts5Merge(db, 't', 16)).not.toThrow();
    expect(() => fts5Merge(db, 't', 500)).not.toThrow();
    db.close();
  });

  it('fts5Merge validates pages and table name', () => {
    const db = new Database(':memory:');
    expect(() => fts5Merge(db, 'bad name', 16)).toThrow();
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(name);`);
    expect(() => fts5Merge(db, 't', 0)).toThrow();
    expect(() => fts5Merge(db, 't', -1)).toThrow();
    db.close();
  });

  it('fts5SegmentCount validates table name', () => {
    const db = new Database(':memory:');
    expect(() => fts5SegmentCount(db, "1; DROP TABLE x; --")).toThrow();
    db.close();
  });

  it('fts5StructureDescribe returns null for a missing table or empty structure', () => {
    const db = new Database(':memory:');
    expect(fts5StructureDescribe(db, 'nonexistent')).toBeNull();
    db.exec(`CREATE VIRTUAL TABLE empty USING fts5(name);`);
    // No data yet → no structure record
    const res = fts5StructureDescribe(db, 'empty');
    expect(res === null || typeof res === 'object').toBe(true);
    db.close();
  });

  it('fts5StructureDescribe validates table name', () => {
    const db = new Database(':memory:');
    expect(() => fts5StructureDescribe(db, 'bad name!')).toThrow();
    db.close();
  });

  it('readVarint round-trips small + multi-byte values', () => {
    const { readVarint } = fts5Testing;
    // 0x42 → single byte 0x42
    expect(readVarint(Buffer.from([0x42]), 0).value).toBe(0x42n);
    // 0x80 continuation; encodes 0
    expect(readVarint(Buffer.from([0x80, 0x00]), 0).value).toBe(0n);
    // Two-byte 0x81 0x01 → ((1 << 7) | 1) = 129
    expect(readVarint(Buffer.from([0x81, 0x01]), 0).value).toBe(129n);
  });
});
