/**
 * Tests for core/incremental-indexing/infrastructure/graph-gc.mjs and its
 * wiring into the maintenance state reader + watermark scheduler.
 *
 * Retired graph rows (entities / relationships / HCGS summaries) must be
 * physically removed only once no live or future reader can observe them, and
 * the external-content FTS5 indices must stay consistent. These tests use a
 * REAL code-graph.db built with the production schema + FTS wiring (no DB
 * mocks — per the integrity rules) and assert:
 *
 *   - missing DB / tables / columns degrade to a skip / zero, never throw
 *   - the no-reader frontier is the current manifest epoch; retired rows
 *     at/below it are deleted, live rows + rows retired above it are kept
 *   - a live reader pin holds back GC of rows retired after its epoch; after
 *     release, GC reclaims them
 *   - relationship consistency: live relationships survive, retired ones go
 *   - FTS5 consistency: retired-entity tokens stop matching after GC, live
 *     tokens keep matching, and the read repository never surfaces deleted rows
 *   - batch limits cap a single run and a follow-up run continues cleanup
 *   - the watermark scheduler emits one coalescible graph_gc job past either
 *     threshold and the queue coalesces it
 *   - readGraphGcState surfaces retired counts that drop after GC
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import {
  runGraphGc,
  pruneRetiredEntities,
  pruneRetiredRelationships,
  pruneRetiredGraphSummaries,
} from '../../core/incremental-indexing/infrastructure/graph-gc.mjs';
import { readGraphGcState } from '../../core/incremental-indexing/infrastructure/maintenance-state-reader.mjs';
import { evaluateWatermarks, loadWatermarkConfig } from '../../core/incremental-indexing/domain/watermark-scheduler.mjs';
import { enqueueMaintenanceJob, readMaintenanceQueue } from '../../core/incremental-indexing/application/maintenance-worker.mjs';
import { writeManifest, zeroManifest, readManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import { beginRead, endRead, minLiveEpoch } from '../../core/incremental-indexing/infrastructure/reader-heartbeat.mjs';
import { createGraphSchema } from '../../core/graph/graph-extractor.js';
import { migrateEntitiesSchema, migrateRelationshipsSchema } from '../../core/incremental-indexing/infrastructure/schema-migrations.mjs';
import { ensureHcgsSidecarSchema, recordSummary } from '../../core/incremental-indexing/infrastructure/hcgs-invalidation.mjs';
import { insertEntity } from '../../core/incremental-indexing/application/production-reconciler-helpers.mjs';
import { CodeGraphRepository } from '../../core/infrastructure/code-graph-repository.js';

const deps = { minLiveEpoch, readManifest };

function mkState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ss-graph-gc-'));
}

function graphPath(stateDir) {
  return path.join(stateDir, 'code-graph.db');
}

/** Open the graph DB with the full production schema + epoch migrations. */
function openGraphDb(stateDir) {
  const db = new Database(graphPath(stateDir));
  const hasFts = createGraphSchema(db);
  migrateEntitiesSchema(db);
  migrateRelationshipsSchema(db);
  ensureHcgsSidecarSchema(db);
  return { db, hasFts };
}

function addEntity(db, hasFts, opts) {
  const {
    logicalId, physicalId, name, file = 'a.js', type = 'function',
    written = 1, retired = null, signature = null, doc = null,
  } = opts;
  insertEntity(db, {
    id: logicalId,
    file_path: file,
    type,
    name,
    signature,
    signature_hash: `${name}-h`,
    doc_comment: doc,
    start_line: 1,
    end_line: 2,
  }, physicalId, written, hasFts);
  if (retired != null) {
    db.prepare('UPDATE entities SET epoch_retired = ?, stale_since = COALESCE(stale_since, ?) WHERE id = ?')
      .run(retired, retired, physicalId);
  }
}

function addRel(db, opts) {
  const { source, target = null, name, type = 'calls', written = 1, retired = null } = opts;
  db.prepare(`
    INSERT INTO relationships
    (source_id, target_id, target_name, type, weight, context_line, full_import_path,
     is_static, is_wildcard, logical_relationship_id, epoch_written, epoch_retired)
    VALUES (?, ?, ?, ?, 1, NULL, NULL, 0, 0, ?, ?, ?)
  `).run(source, target, name, type, `${source}:${type}:${name}`, written, retired);
}

function manifestAt(stateDir, epoch) {
  const m = zeroManifest({});
  m.epoch = epoch;
  writeManifest(stateDir, m);
}

function countWhere(stateDir, table, where = '') {
  const db = new Database(graphPath(stateDir), { readonly: true });
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get().n; }
  finally { db.close(); }
}

/** Direct FTS index probe — touches only the index, not the content join. */
function ftsMatchCount(stateDir, term) {
  const db = new Database(graphPath(stateDir), { readonly: true });
  try { return db.prepare('SELECT COUNT(*) AS n FROM entities_fts WHERE entities_fts MATCH ?').get(term).n; }
  finally { db.close(); }
}

describe('graph-gc / pure batch pruners', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('pruneRetiredRelationships deletes at/below frontier, keeps live + above', () => {
    const { db } = openGraphDb(stateDir);
    addRel(db, { source: 'e1', name: 'live', retired: null });
    addRel(db, { source: 'e2', name: 'r5', retired: 5 });
    addRel(db, { source: 'e3', name: 'r10', retired: 10 });
    addRel(db, { source: 'e4', name: 'r15', retired: 15 });
    const res = pruneRetiredRelationships(db, 10);
    db.close();
    expect(res.deleted).toBe(2); // r5, r10
    expect(countWhere(stateDir, 'relationships')).toBe(2);
    expect(countWhere(stateDir, 'relationships', "WHERE target_name = 'live'")).toBe(1);
    expect(countWhere(stateDir, 'relationships', "WHERE target_name = 'r15'")).toBe(1);
  });

  it('pruneRetiredEntities bounds work to maxRows per run (hitCap), follow-up continues', () => {
    const { db, hasFts } = openGraphDb(stateDir);
    for (let i = 0; i < 50; i += 1) {
      addEntity(db, hasFts, { logicalId: `l${i}`, physicalId: `p${i}`, name: `ent${i}`, retired: 1 });
    }
    const first = pruneRetiredEntities(db, 100, { batchSize: 10, maxRows: 20 });
    expect(first.deleted).toBe(20);
    expect(first.hitCap).toBe(true);
    const second = pruneRetiredEntities(db, 100, { batchSize: 10, maxRows: 100 });
    db.close();
    expect(second.deleted).toBe(30);
    expect(countWhere(stateDir, 'entities')).toBe(0);
  });

  it('pruneRetiredEntities skips safely when the epoch column is absent', () => {
    // Base graph schema only — no epoch migration.
    const db = new Database(graphPath(stateDir));
    createGraphSchema(db);
    const res = pruneRetiredEntities(db, 100);
    db.close();
    expect(res.skipped).toBe('no-epoch-column');
    expect(res.deleted).toBe(0);
  });

  it('pruneRetiredGraphSummaries deletes retired summaries at/below frontier', () => {
    const { db } = openGraphDb(stateDir);
    recordSummary(db, 'ent-A', { sourceEntityIds: [], sourceChunkStructIds: [], sourceHashes: {}, epoch: 1 });
    recordSummary(db, 'ent-B', { sourceEntityIds: [], sourceChunkStructIds: [], sourceHashes: {}, epoch: 1 });
    db.prepare('UPDATE hcgs_summary_metadata SET epoch_retired = 5 WHERE entity_id = ?').run('ent-A');
    const res = pruneRetiredGraphSummaries(db, 10);
    db.close();
    expect(res.deleted).toBe(1);
    expect(countWhere(stateDir, 'hcgs_summary_metadata')).toBe(1);
    expect(countWhere(stateDir, 'hcgs_summary_metadata', "WHERE entity_id = 'ent-B'")).toBe(1);
  });

  it('rejects a non-integer frontier', () => {
    const { db } = openGraphDb(stateDir);
    expect(() => pruneRetiredEntities(db, null)).toThrow(/integer/);
    expect(() => pruneRetiredRelationships(db, null)).toThrow(/integer/);
    db.close();
  });
});

describe('graph-gc / runGraphGc safety + degradation', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('skips when code-graph.db is absent', () => {
    expect(runGraphGc(stateDir, deps).skipped).toBe('no-graph-db');
  });

  it('skips when there is no frontier (no readers, no manifest)', () => {
    const { db, hasFts } = openGraphDb(stateDir);
    addEntity(db, hasFts, { logicalId: 'l1', physicalId: 'p1', name: 'ent1', retired: 1 });
    db.close();
    expect(runGraphGc(stateDir, deps).skipped).toBe('no-frontier');
    expect(countWhere(stateDir, 'entities')).toBe(1);
  });

  it('uses the manifest epoch as frontier when no readers are live', () => {
    const { db, hasFts } = openGraphDb(stateDir);
    addEntity(db, hasFts, { logicalId: 'lLive', physicalId: 'pLive', name: 'liveent', retired: null });
    addEntity(db, hasFts, { logicalId: 'l5', physicalId: 'p5', name: 'ent5', retired: 5 });
    addEntity(db, hasFts, { logicalId: 'l20', physicalId: 'p20', name: 'ent20', retired: 20 });
    addRel(db, { source: 'pLive', name: 'liverel', retired: null });
    addRel(db, { source: 'p5', name: 'rel5', retired: 5 });
    db.close();
    manifestAt(stateDir, 10);

    const out = runGraphGc(stateDir, deps);
    expect(out.hadReaders).toBe(false);
    expect(out.frontier).toBe(10);
    expect(out.deletedEntities).toBe(1); // p5 only; p20 retired above frontier
    expect(out.deletedRelationships).toBe(1); // rel5 only
    expect(countWhere(stateDir, 'entities', "WHERE id = 'p20'")).toBe(1);
    expect(countWhere(stateDir, 'entities', "WHERE id = 'pLive'")).toBe(1);
    expect(countWhere(stateDir, 'relationships', "WHERE target_name = 'liverel'")).toBe(1);
  });

  it('a live reader pin holds back GC of rows retired after its epoch; release reclaims', () => {
    const { db, hasFts } = openGraphDb(stateDir);
    addEntity(db, hasFts, { logicalId: 'lLive', physicalId: 'pLive', name: 'liveent', retired: null });
    addEntity(db, hasFts, { logicalId: 'l5', physicalId: 'p5', name: 'ent5', retired: 5 });
    addEntity(db, hasFts, { logicalId: 'l8', physicalId: 'p8', name: 'ent8', retired: 8 });
    db.close();
    manifestAt(stateDir, 20);

    const pin = beginRead(stateDir, 6); // still sees ent8 (retired 8 > 6)
    expect(minLiveEpoch(stateDir)).toBe(6);
    const held = runGraphGc(stateDir, deps);
    expect(held.hadReaders).toBe(true);
    expect(held.frontier).toBe(6);
    expect(held.deletedEntities).toBe(1); // p5 only
    expect(countWhere(stateDir, 'entities', "WHERE id = 'p8'")).toBe(1);

    endRead(stateDir, pin);
    const after = runGraphGc(stateDir, deps);
    expect(after.hadReaders).toBe(false);
    expect(after.frontier).toBe(20);
    expect(after.deletedEntities).toBe(1); // p8
    expect(countWhere(stateDir, 'entities')).toBe(1); // only live remains
  });

  it('degrades without throwing on an empty (table-less) graph DB', () => {
    // A code-graph.db that exists but has no graph tables.
    new Database(graphPath(stateDir)).close();
    manifestAt(stateDir, 5);
    const out = runGraphGc(stateDir, deps);
    expect(out.skipped).toBeUndefined();
    expect(out.deletedEntities).toBe(0);
    expect(out.deletedRelationships).toBe(0);
  });
});

describe('graph-gc / relationship + entity reference consistency', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('keeps live relationships + their live target entities; removes retired ones', () => {
    const { db, hasFts } = openGraphDb(stateDir);
    // Live caller -> live callee (both live), plus a retired caller whose
    // outgoing relationship was retired in the same epoch.
    addEntity(db, hasFts, { logicalId: 'lCaller', physicalId: 'pCaller', name: 'caller', retired: null });
    addEntity(db, hasFts, { logicalId: 'lCallee', physicalId: 'pCallee', name: 'callee', retired: null });
    addEntity(db, hasFts, { logicalId: 'lOld', physicalId: 'pOld', name: 'oldcaller', retired: 5 });
    addRel(db, { source: 'pCaller', target: 'pCallee', name: 'callee', retired: null });
    addRel(db, { source: 'pOld', target: 'pCallee', name: 'callee', retired: 5 });
    db.close();
    manifestAt(stateDir, 10);

    const out = runGraphGc(stateDir, deps);
    expect(out.deletedEntities).toBe(1); // pOld
    expect(out.deletedRelationships).toBe(1); // the retired pOld->pCallee edge

    // The live caller, live callee, and the live edge between them survive,
    // and the live edge still resolves to its live target via the read path.
    expect(countWhere(stateDir, 'entities', "WHERE id IN ('pCaller','pCallee')")).toBe(2);
    expect(countWhere(stateDir, 'relationships')).toBe(1);

    const repo = new CodeGraphRepository(graphPath(stateDir), { manifestEpoch: 10 });
    const outgoing = repo.getOutgoingRelationships('pCaller');
    repo.close();
    expect(outgoing.length).toBe(1);
    expect(outgoing[0].target?.id).toBe('pCallee');
  });
});

describe('graph-gc / FTS5 consistency', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('removes retired-entity tokens from the FTS index while keeping live tokens', () => {
    const { db, hasFts } = openGraphDb(stateDir);
    expect(hasFts).toBe(true);
    addEntity(db, hasFts, { logicalId: 'lLive', physicalId: 'pLive', name: 'zzliveentity', retired: null });
    addEntity(db, hasFts, { logicalId: 'lDead', physicalId: 'pDead', name: 'zzretiredentity', retired: 5 });
    db.close();
    manifestAt(stateDir, 10);

    // Before GC: both tokens are present in the index.
    expect(ftsMatchCount(stateDir, 'zzliveentity')).toBe(1);
    expect(ftsMatchCount(stateDir, 'zzretiredentity')).toBe(1);

    const out = runGraphGc(stateDir, deps);
    expect(out.deletedEntities).toBe(1);

    // After GC: the retired token is gone from the index; the live one remains.
    expect(ftsMatchCount(stateDir, 'zzretiredentity')).toBe(0);
    expect(ftsMatchCount(stateDir, 'zzliveentity')).toBe(1);

    // The read repository surfaces the live entity and never the deleted one.
    const repo = new CodeGraphRepository(graphPath(stateDir), { manifestEpoch: 10 });
    expect(repo.findEntitiesByAnyName(['zzliveentity']).length).toBe(1);
    expect(repo.findEntitiesByAnyName(['zzretiredentity']).length).toBe(0);
    repo.close();

    // FTS5 internal integrity is intact after the targeted deletes.
    const check = new Database(graphPath(stateDir));
    try {
      expect(() => check.prepare("INSERT INTO entities_fts(entities_fts) VALUES('integrity-check')").run()).not.toThrow();
    } finally { check.close(); }
  });
});

describe('graph-gc / watermark scheduling + coalescing', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('emits a graph_gc job past the retired-row count threshold', () => {
    const jobs = evaluateWatermarks({ graph: { retiredRows: 6000, retiredEntityRatio: 0.1 } });
    expect(jobs.some((j) => j.tier === 'graph_gc' && j.reason === 'retired_count')).toBe(true);
  });

  it('emits a graph_gc job past the retired-entity ratio threshold', () => {
    const jobs = evaluateWatermarks({ graph: { retiredRows: 100, retiredEntityRatio: 0.4 } });
    expect(jobs.some((j) => j.tier === 'graph_gc' && j.reason === 'retired_ratio')).toBe(true);
  });

  it('does NOT emit graph_gc below both thresholds', () => {
    const jobs = evaluateWatermarks({ graph: { retiredRows: 100, retiredEntityRatio: 0.05 } });
    expect(jobs.some((j) => j.tier === 'graph_gc')).toBe(false);
  });

  it('honors env threshold overrides', () => {
    const cfg = loadWatermarkConfig({
      SWEET_SEARCH_GRAPH_GC_COUNT_THRESHOLD: '10',
      SWEET_SEARCH_GRAPH_GC_RATIO_THRESHOLD: '0.5',
    });
    expect(cfg.retiredGraphRowCount).toBe(10);
    expect(cfg.retiredGraphRowRatio).toBe(0.5);
    const jobs = evaluateWatermarks({ graph: { retiredRows: 11, retiredEntityRatio: 0.1 } }, cfg);
    expect(jobs.some((j) => j.tier === 'graph_gc' && j.reason === 'retired_count')).toBe(true);
  });

  it('coalesces repeated graph_gc enqueues to a single pending job', () => {
    const job = { tier: 'graph_gc', reason: 'retired_ratio', payload: {} };
    expect(enqueueMaintenanceJob(stateDir, job).enqueued).toBe(true);
    expect(enqueueMaintenanceJob(stateDir, job).enqueued).toBe(false);
    const pending = readMaintenanceQueue(stateDir).filter((j) => j.tier === 'graph_gc');
    expect(pending.length).toBe(1);
  });
});

describe('graph-gc / readGraphGcState', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('returns zeros when the graph DB is absent', () => {
    expect(readGraphGcState(stateDir)).toMatchObject({ retiredEntities: 0, retiredRows: 0, totalEntities: 0 });
  });

  it('surfaces retired counts that drop after GC', () => {
    const { db, hasFts } = openGraphDb(stateDir);
    addEntity(db, hasFts, { logicalId: 'lLive', physicalId: 'pLive', name: 'liveent', retired: null });
    addEntity(db, hasFts, { logicalId: 'l1', physicalId: 'p1', name: 'ent1', retired: 1 });
    addEntity(db, hasFts, { logicalId: 'l2', physicalId: 'p2', name: 'ent2', retired: 2 });
    addRel(db, { source: 'p1', name: 'rel1', retired: 1 });
    db.close();
    manifestAt(stateDir, 10);

    const before = readGraphGcState(stateDir);
    expect(before).toMatchObject({ retiredEntities: 2, retiredRelationships: 1, totalEntities: 3 });
    expect(before.retiredRows).toBe(3);

    runGraphGc(stateDir, deps);

    const after = readGraphGcState(stateDir);
    expect(after).toMatchObject({ retiredEntities: 0, retiredRelationships: 0, totalEntities: 1 });
    expect(after.retiredRows).toBe(0);
  });
});
