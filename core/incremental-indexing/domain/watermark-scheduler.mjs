/**
 * Watermark scheduler.
 *
 * Plan § 10. At the end of each reconcile tick the scheduler inspects
 * per-tier counters and emits maintenance jobs to the queue when a
 * threshold is crossed. The actual maintenance work runs in the separate
 * worker process (`application/maintenance-worker.mjs`).
 *
 * Watermarks (plan § 6.2):
 *
 *   - Float HNSW: `tombstone_fraction > 0.15` OR `delete_cycles > 1000`
 *     OR live-candidate shortfall observed → `float_hnsw` clean replacement.
 *   - Binary HNSW: `dead_doc_ratio > 0.30` → replacement.
 *   - LI segment: per-segment `stale_doc_ratio > 0.20` → per-segment recompaction.
 *   - Sparse-gram: `delta_size_ratio > 0.10` OR `delta_segment_count > 64`
 *     → compaction.
 *   - FTS5: `segment_count > 64` → bounded `('merge', 500)` cycles until
 *     under threshold.
 *
 * Phase 5 calibrates the actual numeric thresholds; Phase 3 ships the
 * starting defaults. Operators override via the env vars listed in
 * plan § 21.
 */

export const DEFAULT_WATERMARKS = Object.freeze({
  hnswTombstoneFraction: 0.15,
  hnswDeleteCycles: 1000,
  binaryHnswDeadRatio: 0.30,
  liSegmentStaleRatio: 0.20,
  sparseDeltaRatio: 0.10,
  sparseDeltaSegmentCount: 64,
  fts5SegmentCount: 64,
});

/**
 * Build a fresh watermark configuration from environment overrides. Plan
 * § 21.1 specifies the variable names; we map them here so the scheduler
 * stays a pure function of its config object.
 */
export function loadWatermarkConfig(env = process.env) {
  const num = (name, def) => {
    const v = env[name];
    if (v === undefined) return def;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : def;
  };
  return {
    hnswTombstoneFraction: num('SWEET_SEARCH_HNSW_TOMBSTONE_THRESHOLD', DEFAULT_WATERMARKS.hnswTombstoneFraction),
    hnswDeleteCycles: num('SWEET_SEARCH_HNSW_DELETE_CYCLES', DEFAULT_WATERMARKS.hnswDeleteCycles),
    binaryHnswDeadRatio: num('SWEET_SEARCH_BINARY_HNSW_DEAD_THRESHOLD', DEFAULT_WATERMARKS.binaryHnswDeadRatio),
    liSegmentStaleRatio: num('SWEET_SEARCH_LI_SEGMENT_STALE_THRESHOLD', DEFAULT_WATERMARKS.liSegmentStaleRatio),
    sparseDeltaRatio: num('SWEET_SEARCH_SPARSE_DELTA_RATIO', DEFAULT_WATERMARKS.sparseDeltaRatio),
    sparseDeltaSegmentCount: num('SWEET_SEARCH_SPARSE_DELTA_SEGCOUNT', DEFAULT_WATERMARKS.sparseDeltaSegmentCount),
    fts5SegmentCount: num('SWEET_SEARCH_FTS5_MERGE_SEGMENT_THRESHOLD', DEFAULT_WATERMARKS.fts5SegmentCount),
  };
}

/**
 * Tier-state input shape:
 *
 *   {
 *     floatHnsw:    { tombstoneFraction, deleteCycles, liveCandidateShortfall },
 *     binaryHnsw:   { deadDocRatio },
 *     liSegments:   Array<{ segmentId, staleDocRatio }>,
 *     sparseGram:   { deltaSizeRatio, deltaSegmentCount },
 *     fts5:         { segmentCount },
 *   }
 *
 * The scheduler emits zero or more jobs. Each job is a plain object that
 * the queue writer (`maintenance-worker.enqueueMaintenanceJob`) appends
 * to the JSONL queue.
 *
 * @param {object} state
 * @param {object} [config]    Watermark thresholds (see DEFAULT_WATERMARKS).
 * @returns {Array<object>}
 */
export function evaluateWatermarks(state, config = DEFAULT_WATERMARKS) {
  const jobs = [];
  const floatH = state.floatHnsw || {};
  if (
    (floatH.tombstoneFraction ?? 0) > config.hnswTombstoneFraction
    || (floatH.deleteCycles ?? 0) > config.hnswDeleteCycles
    || floatH.liveCandidateShortfall === true
  ) {
    jobs.push({
      tier: 'float_hnsw',
      reason: floatH.liveCandidateShortfall ? 'live_candidate_shortfall'
        : (floatH.tombstoneFraction > config.hnswTombstoneFraction
            ? 'tombstone_watermark' : 'delete_cycles'),
      payload: {
        tombstoneFraction: floatH.tombstoneFraction ?? 0,
        deleteCycles: floatH.deleteCycles ?? 0,
      },
    });
  }
  const binH = state.binaryHnsw || {};
  if ((binH.deadDocRatio ?? 0) > config.binaryHnswDeadRatio) {
    jobs.push({
      tier: 'binary_hnsw',
      reason: 'dead_doc_ratio',
      payload: { deadDocRatio: binH.deadDocRatio },
    });
  }
  const liSegs = state.liSegments || [];
  for (const seg of liSegs) {
    if ((seg.staleDocRatio ?? 0) > config.liSegmentStaleRatio) {
      jobs.push({
        tier: 'li_segment',
        reason: 'stale_doc_ratio',
        payload: { segmentId: seg.segmentId, staleDocRatio: seg.staleDocRatio },
      });
    }
  }
  const sparse = state.sparseGram || {};
  if ((sparse.deltaSizeRatio ?? 0) > config.sparseDeltaRatio
      || (sparse.deltaSegmentCount ?? 0) > config.sparseDeltaSegmentCount) {
    jobs.push({
      tier: 'sparse_gram',
      reason: (sparse.deltaSizeRatio ?? 0) > config.sparseDeltaRatio
        ? 'delta_size_ratio'
        : 'delta_segment_count',
      payload: {
        deltaSizeRatio: sparse.deltaSizeRatio ?? 0,
        deltaSegmentCount: sparse.deltaSegmentCount ?? 0,
      },
    });
  }
  const fts5 = state.fts5 || {};
  if ((fts5.segmentCount ?? 0) > config.fts5SegmentCount) {
    jobs.push({
      tier: 'fts5',
      reason: 'fts5_segment_count',
      payload: { segmentCount: fts5.segmentCount },
    });
  }
  return jobs;
}

/**
 * Adaptive HNSW oversampling rule (plan § 7.3). Given the requested top-k
 * and the live tombstone fraction, compute how many candidates to fetch
 * before filtering stale entries.
 *
 *   s = clamp(tombstoneFraction, 0, 0.5)
 *   candidate_k = min(
 *     max(k + 64, ceil(k / max(0.05, 1 - s) * 2)),
 *     k * 20
 *   )
 *
 * @param {number} k
 * @param {number} tombstoneFraction
 * @returns {number}
 */
export function hnswOversampleTarget(k, tombstoneFraction) {
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error(`hnswOversampleTarget: k must be a positive integer, got ${k}`);
  }
  const s = Math.max(0, Math.min(tombstoneFraction || 0, 0.5));
  const liveFrac = Math.max(0.05, 1 - s);
  return Math.min(
    Math.max(k + 64, Math.ceil((k / liveFrac) * 2)),
    k * 20,
  );
}
