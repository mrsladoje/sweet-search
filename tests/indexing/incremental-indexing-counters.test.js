/**
 * Tests for core/incremental-indexing/domain/reconcile-counters.mjs
 *
 * Plan § 13 Phase 1 ("tracing counters per tick") and § 20.1 (metrics JSON
 * line shape).
 */

import { describe, it, expect } from 'vitest';
import { ReconcileCounters } from '../../core/incremental-indexing/domain/reconcile-counters.mjs';

describe('reconcile-counters', () => {
  it('starts at zeros and snapshots a plain JSON object', () => {
    const c = new ReconcileCounters();
    const snap = c.snapshot();
    expect(snap.chunks_encoded).toBe(0);
    expect(snap.chunks_struct_stable).toBe(0);
    expect(snap.ops_per_tier.hnsw_add).toBe(0);
    expect(snap.watermarks.fts5_segment_count).toBe(0);
    expect(snap.wal.last_truncate_busy).toBe(false);
  });

  it('inc() increments scalar counters', () => {
    const c = new ReconcileCounters();
    c.inc('chunks_encoded');
    c.inc('chunks_encoded', 4);
    expect(c.snapshot().chunks_encoded).toBe(5);
  });

  it('inc() with dotted key increments nested ops_per_tier scalars', () => {
    const c = new ReconcileCounters();
    c.inc('ops_per_tier.hnsw_add', 3);
    c.inc('ops_per_tier.li_tombstone');
    expect(c.snapshot().ops_per_tier.hnsw_add).toBe(3);
    expect(c.snapshot().ops_per_tier.li_tombstone).toBe(1);
  });

  it('set() updates scalar fields', () => {
    const c = new ReconcileCounters();
    c.set('epoch', 4711);
    c.set('tick_ms', 132);
    c.set('watermarks.fts5_segment_count', 12);
    const snap = c.snapshot();
    expect(snap.epoch).toBe(4711);
    expect(snap.tick_ms).toBe(132);
    expect(snap.watermarks.fts5_segment_count).toBe(12);
  });

  it('rejects unknown counter keys to catch typos in callers', () => {
    const c = new ReconcileCounters();
    expect(() => c.inc('mistype_field')).toThrow();
    expect(() => c.set('also_typo', 1)).toThrow();
  });

  it('mirrors plan § 20.1 metric shape', () => {
    const c = new ReconcileCounters();
    const snap = c.snapshot();
    expect(snap).toHaveProperty('dirty_paths_seen');
    expect(snap).toHaveProperty('chunks_total');
    expect(snap).toHaveProperty('chunks_hash_reused');
    expect(snap).toHaveProperty('tree_sitter_error_nodes_seen');
    expect(snap).toHaveProperty('tree_sitter_files_with_errors');
    expect(snap.ops_per_tier).toHaveProperty('sparse_gram_delta_upsert');
    expect(snap.ops_per_tier).toHaveProperty('fts5_merge_calls');
    expect(snap.watermarks).toHaveProperty('hnsw_tombstone_fraction');
    expect(snap.wal).toHaveProperty('code_graph_db_wal_bytes');
  });
});
