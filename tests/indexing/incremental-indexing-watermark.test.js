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
    expect(DEFAULT_WATERMARKS.hnswTombstoneFraction).toBe(0.15);
    expect(DEFAULT_WATERMARKS.binaryHnswDeadRatio).toBe(0.30);
    expect(DEFAULT_WATERMARKS.liSegmentStaleRatio).toBe(0.20);
    expect(DEFAULT_WATERMARKS.fts5SegmentCount).toBe(64);
  });

  it('honors env overrides', () => {
    const cfg = loadWatermarkConfig({
      SWEET_SEARCH_HNSW_TOMBSTONE_THRESHOLD: '0.25',
      SWEET_SEARCH_FTS5_MERGE_SEGMENT_THRESHOLD: '128',
    });
    expect(cfg.hnswTombstoneFraction).toBe(0.25);
    expect(cfg.fts5SegmentCount).toBe(128);
    expect(cfg.binaryHnswDeadRatio).toBe(0.30);
  });

  it('ignores non-numeric overrides', () => {
    const cfg = loadWatermarkConfig({ SWEET_SEARCH_HNSW_TOMBSTONE_THRESHOLD: 'banana' });
    expect(cfg.hnswTombstoneFraction).toBe(0.15);
  });
});

describe('watermark / evaluator', () => {
  it('returns [] when no watermarks crossed', () => {
    expect(evaluateWatermarks({})).toEqual([]);
  });

  it('emits a float_hnsw job past the tombstone watermark', () => {
    const jobs = evaluateWatermarks({
      floatHnsw: { tombstoneFraction: 0.2 },
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0].tier).toBe('float_hnsw');
    expect(jobs[0].reason).toBe('tombstone_watermark');
  });

  it('emits a float_hnsw job on live-candidate shortfall regardless of fraction', () => {
    const jobs = evaluateWatermarks({
      floatHnsw: { tombstoneFraction: 0.05, liveCandidateShortfall: true },
    });
    expect(jobs[0].reason).toBe('live_candidate_shortfall');
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
