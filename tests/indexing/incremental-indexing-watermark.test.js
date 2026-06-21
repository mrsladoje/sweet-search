/**
 * Tests for core/incremental-indexing/domain/watermark-scheduler.mjs
 *
 * Plan § 10: watermark evaluator emits one job per crossed threshold;
 * `hnswOversampleTarget` implements the adaptive oversampling rule.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WATERMARKS,
  loadWatermarkConfig,
  evaluateWatermarks,
  hnswOversampleTarget,
} from '../../core/incremental-indexing/domain/watermark-scheduler.mjs';

describe('watermark / config', () => {
  it('exposes the plan-default thresholds', () => {
    expect(DEFAULT_WATERMARKS.binaryHnswDeadRatio).toBe(0.30);
    expect(DEFAULT_WATERMARKS.liSegmentStaleRatio).toBe(0.20);
    expect(DEFAULT_WATERMARKS.fts5SegmentCount).toBe(64);
  });

  it('honors env overrides', () => {
    const cfg = loadWatermarkConfig({
      SWEET_SEARCH_FTS5_MERGE_SEGMENT_THRESHOLD: '128',
    });
    expect(cfg.fts5SegmentCount).toBe(128);
    expect(cfg.binaryHnswDeadRatio).toBe(0.30);
  });

  it('ignores non-numeric overrides', () => {
    const cfg = loadWatermarkConfig({ SWEET_SEARCH_FTS5_MERGE_SEGMENT_THRESHOLD: 'banana' });
    expect(cfg.fts5SegmentCount).toBe(64);
  });
});

describe('watermark / evaluator', () => {
  it('returns [] when no watermarks crossed', () => {
    expect(evaluateWatermarks({})).toEqual([]);
  });

  it('emits separate LI segment jobs per crossing', () => {
    const jobs = evaluateWatermarks({
      liSegments: [
        { segmentId: 'a.bin', staleDocRatio: 0.05 }, // under
        { segmentId: 'b.bin', staleDocRatio: 0.25 },
        { segmentId: 'c.bin', staleDocRatio: 0.5 },
      ],
    });
    const tiers = jobs.map((j) => j.payload?.segmentId);
    expect(tiers).toEqual(['b.bin', 'c.bin']);
  });

  it('emits sparse-gram job on either delta-size or segment-count breach', () => {
    expect(evaluateWatermarks({
      sparseGram: { deltaSizeRatio: 0.15, deltaSegmentCount: 0 },
    })[0]).toMatchObject({ tier: 'sparse_gram', reason: 'delta_size_ratio' });
    expect(evaluateWatermarks({
      sparseGram: { deltaSizeRatio: 0, deltaSegmentCount: 100 },
    })[0]).toMatchObject({ tier: 'sparse_gram', reason: 'delta_segment_count' });
  });

  it('emits an fts5 job past the segment threshold', () => {
    const jobs = evaluateWatermarks({ fts5: { segmentCount: 70 } });
    expect(jobs.length).toBe(1);
    expect(jobs[0].tier).toBe('fts5');
  });

  it('emits ONE coalescible li_segments batch job past the small-segment threshold', () => {
    const jobs = evaluateWatermarks({ liSegmentStats: { segmentCount: 30, smallSegmentCount: 25 } });
    expect(jobs.length).toBe(1);
    expect(jobs[0]).toMatchObject({ tier: 'li_segments', reason: 'small_segment_count' });
  });

  it('emits an li_segments job on the absolute segment-count backstop', () => {
    const jobs = evaluateWatermarks({ liSegmentStats: { segmentCount: 250, smallSegmentCount: 0 } });
    expect(jobs[0]).toMatchObject({ tier: 'li_segments', reason: 'segment_count' });
  });

  it('does NOT emit li_segments when small segments are within threshold', () => {
    expect(evaluateWatermarks({ liSegmentStats: { segmentCount: 10, smallSegmentCount: 10 } })).toEqual([]);
  });

  it('re-fires li_segments to drain quarantined files even with one active segment', () => {
    const jobs = evaluateWatermarks({ liSegmentStats: { segmentCount: 1, smallSegmentCount: 1, pendingDeleteFiles: 11 } });
    expect(jobs[0]).toMatchObject({ tier: 'li_segments', reason: 'pending_delete' });
  });

  it('emits a vector_gc job past the retired-count threshold', () => {
    const jobs = evaluateWatermarks({ vectors: { retiredCount: 6000, retiredRatio: 0.1 } });
    expect(jobs[0]).toMatchObject({ tier: 'vector_gc', reason: 'retired_count' });
  });

  it('emits a vector_gc job past the retired-ratio threshold', () => {
    const jobs = evaluateWatermarks({ vectors: { retiredCount: 100, retiredRatio: 0.4 } });
    expect(jobs[0]).toMatchObject({ tier: 'vector_gc', reason: 'retired_ratio' });
  });

  it('does NOT emit vector_gc below both thresholds', () => {
    expect(evaluateWatermarks({ vectors: { retiredCount: 100, retiredRatio: 0.05 } })).toEqual([]);
  });
});

describe('watermark / hnsw oversampling', () => {
  it('returns at least k+64 even at zero tombstones', () => {
    expect(hnswOversampleTarget(10, 0)).toBeGreaterThanOrEqual(74);
  });

  it('scales with tombstone fraction', () => {
    const low = hnswOversampleTarget(10, 0.05);
    const mid = hnswOversampleTarget(10, 0.25);
    const high = hnswOversampleTarget(10, 0.5);
    expect(mid).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThanOrEqual(mid);
  });

  it('caps at k * 20', () => {
    expect(hnswOversampleTarget(50, 0.99)).toBeLessThanOrEqual(50 * 20);
  });

  it('rejects non-positive k', () => {
    expect(() => hnswOversampleTarget(0, 0.1)).toThrow();
    expect(() => hnswOversampleTarget(-1, 0.1)).toThrow();
  });
});
