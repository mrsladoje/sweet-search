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
  binaryHnswDeadRatio: 0.30,
  liSegmentStaleRatio: 0.20,
  liSmallSegmentCount: 16,
  liSegmentCount: 200,
  sparseDeltaRatio: 0.10,
  sparseDeltaSegmentCount: 64,
  fts5SegmentCount: 64,
  retiredVectorCount: 5000,
  retiredVectorRatio: 0.25,
  retiredGraphRowCount: 5000,
  retiredGraphRowRatio: 0.25,
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
    binaryHnswDeadRatio: num('SWEET_SEARCH_BINARY_HNSW_DEAD_THRESHOLD', DEFAULT_WATERMARKS.binaryHnswDeadRatio),
    liSegmentStaleRatio: num('SWEET_SEARCH_LI_SEGMENT_STALE_THRESHOLD', DEFAULT_WATERMARKS.liSegmentStaleRatio),
    liSmallSegmentCount: num('SWEET_SEARCH_LI_SMALL_SEGMENT_THRESHOLD', DEFAULT_WATERMARKS.liSmallSegmentCount),
    liSegmentCount: num('SWEET_SEARCH_LI_SEGMENT_COUNT_THRESHOLD', DEFAULT_WATERMARKS.liSegmentCount),
    sparseDeltaRatio: num('SWEET_SEARCH_SPARSE_DELTA_RATIO', DEFAULT_WATERMARKS.sparseDeltaRatio),
    sparseDeltaSegmentCount: num('SWEET_SEARCH_SPARSE_DELTA_SEGCOUNT', DEFAULT_WATERMARKS.sparseDeltaSegmentCount),
    fts5SegmentCount: num('SWEET_SEARCH_FTS5_MERGE_SEGMENT_THRESHOLD', DEFAULT_WATERMARKS.fts5SegmentCount),
    retiredVectorCount: num('SWEET_SEARCH_VECTOR_GC_COUNT_THRESHOLD', DEFAULT_WATERMARKS.retiredVectorCount),
    retiredVectorRatio: num('SWEET_SEARCH_VECTOR_GC_RATIO_THRESHOLD', DEFAULT_WATERMARKS.retiredVectorRatio),
    retiredGraphRowCount: num('SWEET_SEARCH_GRAPH_GC_COUNT_THRESHOLD', DEFAULT_WATERMARKS.retiredGraphRowCount),
    retiredGraphRowRatio: num('SWEET_SEARCH_GRAPH_GC_RATIO_THRESHOLD', DEFAULT_WATERMARKS.retiredGraphRowRatio),
  };
}

/**
 * Tier-state input shape:
 *
 *   {
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
  const binH = state.binaryHnsw || {};
  // Reclaim on the dead-doc ratio (batched) OR on any *unexplained* divergence
  // from codebase.db — a vector retired there but never stale-marked in the
  // binary index. The latter is reader-visible (the coarse index surfaces a
  // retired vector) and the handler is codebase.db-sourced, so heal promptly.
  if ((binH.deadDocRatio ?? 0) > config.binaryHnswDeadRatio || (binH.unexplainedDead ?? 0) > 0) {
    jobs.push({
      tier: 'binary_hnsw',
      reason: (binH.unexplainedDead ?? 0) > 0 ? 'codebase_divergence' : 'dead_doc_ratio',
      payload: { deadDocRatio: binH.deadDocRatio ?? 0, unexplainedDead: binH.unexplainedDead ?? 0 },
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
  // Segment-count growth bound: collapse many small live segments into
  // fewer larger ones. One coalesced batch job regardless of count.
  const liStats = state.liSegmentStats || {};
  const liSmallOver = (liStats.smallSegmentCount ?? 0) > config.liSmallSegmentCount;
  const liCountOver = (liStats.segmentCount ?? 0) > config.liSegmentCount;
  // Also re-fire when files are quarantined for deferred deletion: the merge
  // handler runs the grace-gated quarantine sweep, so this keeps unreferenced
  // segment files from lingering after churn settles (the sweep is otherwise
  // only invoked when a count-driven merge is due).
  const liPendingDelete = (liStats.pendingDeleteFiles ?? 0) > 0;
  if (liSmallOver || liCountOver || liPendingDelete) {
    jobs.push({
      tier: 'li_segments',
      reason: liSmallOver ? 'small_segment_count'
        : liCountOver ? 'segment_count'
        : 'pending_delete',
      payload: {
        segmentCount: liStats.segmentCount ?? 0,
        smallSegmentCount: liStats.smallSegmentCount ?? 0,
        pendingDeleteFiles: liStats.pendingDeleteFiles ?? 0,
      },
    });
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
  // Retired-vector physical GC: bound `codebase.db` growth once enough rows
  // have been tombstoned. One coalesced job; the handler is reader-safe.
  const vec = state.vectors || {};
  if ((vec.retiredCount ?? 0) > config.retiredVectorCount
      || (vec.retiredRatio ?? 0) > config.retiredVectorRatio) {
    jobs.push({
      tier: 'vector_gc',
      reason: (vec.retiredCount ?? 0) > config.retiredVectorCount
        ? 'retired_count'
        : 'retired_ratio',
      payload: {
        retiredCount: vec.retiredCount ?? 0,
        retiredRatio: vec.retiredRatio ?? 0,
      },
    });
  }
  // Retired-graph-row physical GC: bound `code-graph.db` growth once enough
  // entity/relationship/summary rows have been tombstoned. One coalesced job;
  // the handler is reader-safe and keeps the external-content FTS5 indices
  // consistent.
  const graph = state.graph || {};
  if ((graph.retiredRows ?? 0) > config.retiredGraphRowCount
      || (graph.retiredEntityRatio ?? 0) > config.retiredGraphRowRatio) {
    jobs.push({
      tier: 'graph_gc',
      reason: (graph.retiredRows ?? 0) > config.retiredGraphRowCount
        ? 'retired_count'
        : 'retired_ratio',
      payload: {
        retiredRows: graph.retiredRows ?? 0,
        retiredEntities: graph.retiredEntities ?? 0,
        retiredRelationships: graph.retiredRelationships ?? 0,
        retiredEntityRatio: graph.retiredEntityRatio ?? 0,
      },
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
