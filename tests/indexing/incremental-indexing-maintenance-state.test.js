/**
 * Tests for core/incremental-indexing/infrastructure/maintenance-state-reader.mjs
 *
 * Plan § 6.2 / § 10: the production adapter's `readMaintenanceState()`
 * must surface Binary HNSW and LI segment metrics in addition to the
 * existing FTS5 and sparse-gram counters. Without those signals the
 * watermark scheduler stays blind to those tiers (see
 * eval/results/incremental-soak/REPORT.md § 6.2 Finding 1).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readMaintenanceState,
  readBinaryHnswState,
  readLiSegmentsState,
} from '../../core/incremental-indexing/infrastructure/maintenance-state-reader.mjs';
import {
  createBitmap, setBit, saveBitmap,
} from '../../core/incremental-indexing/infrastructure/tombstone-bitmap.mjs';
import { evaluateWatermarks, DEFAULT_WATERMARKS } from '../../core/incremental-indexing/domain/watermark-scheduler.mjs';

function writeJson(p, payload) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(payload));
}

function writeBitmap(p, capacity, bitsToSet = []) {
  const bm = createBitmap(capacity);
  for (const i of bitsToSet) setBit(bm, i);
  saveBitmap(p, bm);
}

describe('maintenance-state-reader / missing artifacts', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-maint-state-empty-'));
  });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('does not throw and returns zero metrics across the board', () => {
    const state = readMaintenanceState(stateDir);
    expect(state.fts5).toEqual({ segmentCount: 0 });
    expect(state.sparseGram.deltaSegmentCount).toBe(0);
    expect(state.binaryHnsw).toEqual({ deadDocRatio: 0 });
    expect(state.liSegments).toEqual([]);
  });

  it('handles a corrupt meta.json without throwing', () => {
    fs.writeFileSync(path.join(stateDir, 'codebase-binary-hnsw.meta.json'), '{{{broken');
    fs.writeFileSync(path.join(stateDir, 'codebase-late-interaction.db'), '<<<');
    const state = readMaintenanceState(stateDir);
    expect(state.binaryHnsw.deadDocRatio).toBe(0);
    expect(state.liSegments).toEqual([]);
  });
});

describe('maintenance-state-reader / Binary HNSW', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-maint-state-bhnsw-'));
  });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('returns zero when meta is absent', () => {
    expect(readBinaryHnswState(stateDir)).toEqual({ deadDocRatio: 0 });
  });

  it('computes deadDocRatio = popcount / vectorCount', () => {
    writeJson(path.join(stateDir, 'codebase-binary-hnsw.meta.json'), { vectorCount: 20 });
    writeBitmap(path.join(stateDir, 'codebase-binary-hnsw.idx.stale.bin'), 32, [0, 1, 2, 3, 4, 5, 6, 7]);
    // 8 tombstoned / 20 total = 0.4
    expect(readBinaryHnswState(stateDir).deadDocRatio).toBeCloseTo(0.4, 5);
  });

  it('crosses the default watermark and schedules binary_hnsw', () => {
    writeJson(path.join(stateDir, 'codebase-binary-hnsw.meta.json'), { vectorCount: 20 });
    writeBitmap(path.join(stateDir, 'codebase-binary-hnsw.idx.stale.bin'), 32, [0, 1, 2, 3, 4, 5, 6, 7]);
    const state = readMaintenanceState(stateDir);
    const jobs = evaluateWatermarks(state, DEFAULT_WATERMARKS);
    expect(jobs.find((j) => j.tier === 'binary_hnsw')).toMatchObject({
      tier: 'binary_hnsw',
      reason: 'dead_doc_ratio',
    });
  });
});

describe('maintenance-state-reader / LI segments', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-maint-state-li-'));
  });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('returns [] when the LI stub is legacy (unsegmented)', () => {
    writeJson(path.join(stateDir, 'codebase-late-interaction.db'), {
      format: 'legacy',
      documents: {},
    });
    expect(readLiSegmentsState(stateDir)).toEqual([]);
  });

  it('returns per-segment stale ratios from the segmented manifest', () => {
    const segDirName = 'codebase-late-interaction.db.segments';
    const segDir = path.join(stateDir, segDirName);
    fs.mkdirSync(segDir, { recursive: true });

    writeJson(path.join(stateDir, 'codebase-late-interaction.db'), {
      version: '3.0', format: 'segmented', segmentDir: segDirName,
    });
    writeJson(path.join(segDir, 'manifest.json'), {
      version: '3.0', format: 'sslx-v3',
      segments: [
        { path: 'segment-0000.bin', count: 10 },
        { path: 'segment-0001.bin', count: 10 },
      ],
      totalDocuments: 20,
    });

    // empty stub bins (li-segment-state only reads the stale sidecar bitmaps)
    fs.writeFileSync(path.join(segDir, 'segment-0000.bin'), '');
    fs.writeFileSync(path.join(segDir, 'segment-0001.bin'), '');
    // seg-0000: 3/10 stale = 0.3 (above 0.20 watermark)
    writeBitmap(path.join(segDir, 'segment-0000.bin.stale.bin'), 16, [0, 1, 2]);
    // seg-0001: 1/10 stale = 0.1 (under watermark)
    writeBitmap(path.join(segDir, 'segment-0001.bin.stale.bin'), 16, [0]);

    const segs = readLiSegmentsState(stateDir);
    expect(segs.length).toBe(2);
    const byId = Object.fromEntries(segs.map((s) => [s.segmentId, s.staleDocRatio]));
    expect(byId['segment-0000.bin']).toBeCloseTo(0.3, 5);
    expect(byId['segment-0001.bin']).toBeCloseTo(0.1, 5);
  });

  it('schedules li_segment for any segment over the watermark', () => {
    const segDirName = 'codebase-late-interaction.db.segments';
    const segDir = path.join(stateDir, segDirName);
    fs.mkdirSync(segDir, { recursive: true });
    writeJson(path.join(stateDir, 'codebase-late-interaction.db'), {
      version: '3.0', format: 'segmented', segmentDir: segDirName,
    });
    writeJson(path.join(segDir, 'manifest.json'), {
      version: '3.0', format: 'sslx-v3',
      segments: [{ path: 'segment-0000.bin', count: 10 }],
      totalDocuments: 10,
    });
    fs.writeFileSync(path.join(segDir, 'segment-0000.bin'), '');
    writeBitmap(path.join(segDir, 'segment-0000.bin.stale.bin'), 16, [0, 1, 2, 3]); // 4/10 = 0.4

    const state = readMaintenanceState(stateDir);
    const jobs = evaluateWatermarks(state, DEFAULT_WATERMARKS);
    const li = jobs.find((j) => j.tier === 'li_segment');
    expect(li).toMatchObject({ tier: 'li_segment', reason: 'stale_doc_ratio' });
    expect(li.payload.segmentId).toBe('segment-0000.bin');
  });
});

describe('maintenance-state-reader / preserves existing scheduling', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-maint-state-misc-'));
  });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('sparse-gram watermark continues to fire when many delta segments exist', () => {
    // Synthesize the .idx.deltas directory layout the sparse-gram delta
    // accumulator expects: <stateDir>/codebase-sparse-grams.idx.deltas/<segment>.ssgrmdelta
    const deltaDir = path.join(stateDir, 'codebase-sparse-grams.idx.deltas');
    fs.mkdirSync(deltaDir, { recursive: true });
    for (let i = 0; i < 70; i++) {
      const ep = String(i).padStart(6, '0');
      fs.writeFileSync(path.join(deltaDir, `${ep}-0.ssgrmdelta`), 'x');
    }
    const state = readMaintenanceState(stateDir);
    expect(state.sparseGram.deltaSegmentCount).toBeGreaterThanOrEqual(70);
    const jobs = evaluateWatermarks(state, DEFAULT_WATERMARKS);
    expect(jobs.find((j) => j.tier === 'sparse_gram')).toMatchObject({
      tier: 'sparse_gram',
    });
  });
});
