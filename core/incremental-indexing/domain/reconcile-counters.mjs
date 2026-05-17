/**
 * Per-tick reconcile counters.
 *
 * Plan § 13 Phase 1 ("Add tracing counters: chunks_struct_stable,
 * chunks_text_unchanged, chunks_metadata_dirty, chunks_dedup_repaired,
 * chunks_encoded per tick") and § 20.1 (metrics JSON line).
 *
 * The reconciler instantiates one `ReconcileCounters` per tick, increments
 * the relevant fields as it walks dirty files, and emits the counters as
 * part of the tick metrics line. Domain-only — no I/O, no global state.
 */

const DEFAULT_FIELDS = Object.freeze({
  ts: 0,
  epoch: 0,
  tick_ms: 0,

  dirty_paths_seen: 0,
  dirty_paths_deferred: 0,
  content_unchanged: 0,
  files_processed: 0,

  chunks_total: 0,
  chunks_encoded: 0,
  chunks_hash_reused: 0,
  chunks_struct_stable: 0,
  chunks_text_unchanged: 0,
  chunks_metadata_dirty: 0,
  chunks_dedup_repaired: 0,

  tree_sitter_error_nodes_seen: 0,
  tree_sitter_files_with_errors: 0,

  ops_per_tier: null, // populated below

  watermarks: null,   // populated below

  wal: null,          // populated below

  maintenance_jobs_enqueued: 0,
  cpu_budget_used_ms: 0,
  cpu_budget_total_ms: 0,

  manifest_epoch_mismatch_total: 0,
  hnsw_live_candidate_shortfall: 0,
});

function freshOpsTier() {
  return {
    graph_upsert: 0, graph_tombstone: 0,
    vectors_upsert: 0, vectors_delete: 0,
    hnsw_add: 0, hnsw_tombstone: 0,
    hnsw_capacity_used: 0,
    binary_hnsw_tombstone: 0, binary_hnsw_append: 0,
    li_segment_append: 0, li_tombstone: 0,
    sparse_gram_delta_upsert: 0,
    sparse_gram_compaction: 0,
    fts5_merge_calls: 0,
  };
}

function freshWatermarks() {
  return {
    hnsw_tombstone_fraction: 0,
    binary_hnsw_dead_doc_ratio: 0,
    li_segments_over_threshold: [],
    fts5_segment_count: 0,
  };
}

function freshWalState() {
  return {
    code_graph_db_wal_bytes: 0,
    codebase_db_wal_bytes: 0,
    last_passive_checkpoint_ms_ago: null,
    last_truncate_attempted_ms_ago: null,
    last_truncate_busy: false,
  };
}

export class ReconcileCounters {
  constructor() {
    this._fields = { ...DEFAULT_FIELDS };
    this._fields.ops_per_tier = freshOpsTier();
    this._fields.watermarks = freshWatermarks();
    this._fields.wal = freshWalState();
  }

  /**
   * Increment a counter by 1 (or by `n`).
   * @param {keyof typeof DEFAULT_FIELDS|string} key
   * @param {number} n
   */
  inc(key, n = 1) {
    if (typeof this._fields[key] === 'number') {
      this._fields[key] += n;
      return;
    }
    // Allow ops_per_tier.<sub> via dotted key.
    if (key.includes('.')) {
      const [scope, sub] = key.split('.', 2);
      if (this._fields[scope] && typeof this._fields[scope][sub] === 'number') {
        this._fields[scope][sub] += n;
        return;
      }
    }
    throw new Error(`ReconcileCounters.inc: unknown counter '${key}'`);
  }

  /**
   * Set an arbitrary scalar (used for `epoch`, `tick_ms`, watermarks, etc.).
   *
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    if (key.includes('.')) {
      const [scope, sub] = key.split('.', 2);
      if (this._fields[scope] !== undefined) {
        this._fields[scope][sub] = value;
        return;
      }
    }
    if (this._fields[key] === undefined) {
      throw new Error(`ReconcileCounters.set: unknown field '${key}'`);
    }
    this._fields[key] = value;
  }

  /**
   * Return the metrics object as it would be serialised to
   * `.sweet-search/reconcile-metrics.jsonl`. Plan § 20.1.
   *
   * @returns {object}
   */
  snapshot() {
    return JSON.parse(JSON.stringify(this._fields));
  }

  /**
   * Convenience for the dirty-set summary: how many candidates were dirty
   * but had identical content. Plan § 9.5 trigger-decision-tree branch.
   */
  observeContentUnchanged(n = 1) {
    this.inc('content_unchanged', n);
  }
}

export const __testing = { DEFAULT_FIELDS, freshOpsTier, freshWatermarks };
