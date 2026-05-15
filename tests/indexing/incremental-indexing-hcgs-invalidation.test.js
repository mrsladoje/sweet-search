/**
 * Tests for core/incremental-indexing/infrastructure/hcgs-invalidation.mjs
 *
 * Plan § 7.7: HCGS summaries are retired in the same manifest epoch as
 * their source entities/chunks; readers honour the visibility predicate;
 * the prune frontier sweeps retired rows.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureHcgsSidecarSchema,
  recordSummary,
  retireDependentSummaries,
  summaryVisibilityPredicate,
  pruneRetiredSummaries,
} from '../../core/incremental-indexing/infrastructure/hcgs-invalidation.mjs';

describe('hcgs-invalidation', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    ensureHcgsSidecarSchema(db);
  });

  it('records a summary with the new epoch', () => {
    recordSummary(db, 'ent-1', {
      sourceEntityIds: ['ent-1'],
      sourceChunkStructIds: ['chunk-a'],
      sourceHashes: { 'ent-1': 'h1' },
      epoch: 4,
    });
    const row = db.prepare('SELECT * FROM hcgs_summary_metadata WHERE entity_id = ?').get('ent-1');
    expect(row.epoch_written).toBe(4);
    expect(row.epoch_retired).toBeNull();
    expect(JSON.parse(row.source_chunk_struct_ids)).toEqual(['chunk-a']);
  });

  it('retires summaries whose source entity changed', () => {
    recordSummary(db, 'ent-1', { sourceEntityIds: ['ent-A'], sourceChunkStructIds: [], sourceHashes: {}, epoch: 1 });
    recordSummary(db, 'ent-2', { sourceEntityIds: ['ent-B'], sourceChunkStructIds: [], sourceHashes: {}, epoch: 1 });
    const retired = retireDependentSummaries(db, {
      retiredEntityIds: ['ent-A'],
      retiredChunkStructIds: [],
    }, 7);
    expect(retired).toBe(1);
    const row1 = db.prepare('SELECT epoch_retired FROM hcgs_summary_metadata WHERE entity_id = ?').get('ent-1');
    const row2 = db.prepare('SELECT epoch_retired FROM hcgs_summary_metadata WHERE entity_id = ?').get('ent-2');
    expect(row1.epoch_retired).toBe(7);
    expect(row2.epoch_retired).toBeNull();
  });

  it('retires summaries whose source chunk struct id changed', () => {
    recordSummary(db, 'ent-1', { sourceEntityIds: [], sourceChunkStructIds: ['c-X'], sourceHashes: {}, epoch: 1 });
    retireDependentSummaries(db, {
      retiredEntityIds: [],
      retiredChunkStructIds: ['c-X'],
    }, 11);
    const row = db.prepare('SELECT epoch_retired FROM hcgs_summary_metadata WHERE entity_id = ?').get('ent-1');
    expect(row.epoch_retired).toBe(11);
  });

  it('summaryVisibilityPredicate produces the same shape as the entity/vector predicate', () => {
    expect(summaryVisibilityPredicate('m')).toBe(
      'm.epoch_written <= :manifestEpoch AND (m.epoch_retired IS NULL OR m.epoch_retired > :manifestEpoch)',
    );
  });

  it('pruneRetiredSummaries removes rows older than the prune frontier', () => {
    recordSummary(db, 'ent-1', { sourceEntityIds: ['ent-A'], sourceChunkStructIds: [], sourceHashes: {}, epoch: 1 });
    retireDependentSummaries(db, { retiredEntityIds: ['ent-A'], retiredChunkStructIds: [] }, 5);
    expect(pruneRetiredSummaries(db, 4)).toBe(0); // not yet
    expect(pruneRetiredSummaries(db, 5)).toBe(1); // now
    expect(db.prepare('SELECT COUNT(*) AS n FROM hcgs_summary_metadata').get().n).toBe(0);
  });

  it('recordSummary refreshes an existing row, clearing epoch_retired', () => {
    recordSummary(db, 'ent-1', { sourceEntityIds: ['ent-A'], sourceChunkStructIds: [], sourceHashes: {}, epoch: 1 });
    retireDependentSummaries(db, { retiredEntityIds: ['ent-A'], retiredChunkStructIds: [] }, 3);
    recordSummary(db, 'ent-1', { sourceEntityIds: ['ent-B'], sourceChunkStructIds: [], sourceHashes: {}, epoch: 4 });
    const row = db.prepare('SELECT * FROM hcgs_summary_metadata WHERE entity_id = ?').get('ent-1');
    expect(row.epoch_written).toBe(4);
    expect(row.epoch_retired).toBeNull();
  });
});
