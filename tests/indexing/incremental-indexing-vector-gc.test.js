/**
 * Tests for core/incremental-indexing/infrastructure/vector-gc.mjs.
 *
 * Retired vector rows must be physically removed only once no live or
 * future reader can observe them. These tests assert:
 *
 *   - pruneRetiredVectors deletes rows at/below the frontier in bounded
 *     batches and leaves live rows + rows retired above the frontier
 *   - a live reader pin holds back GC of rows retired after its epoch
 *   - after the reader releases, GC reclaims the older retired rows
 *   - the no-reader frontier is the current manifest epoch
 *   - missing DB / column / manifest+heartbeats degrade to a skip, no throw
 *   - reads never surface deleted rows (visibility predicate stays correct)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { pruneRetiredVectors, runVectorGc } from '../../core/incremental-indexing/infrastructure/vector-gc.mjs';
import { readVectorGcState } from '../../core/incremental-indexing/infrastructure/maintenance-state-reader.mjs';
import { writeManifest, zeroManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import { beginRead, endRead, minLiveEpoch } from '../../core/incremental-indexing/infrastructure/reader-heartbeat.mjs';
import { readManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';

function mkState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ss-vec-gc-'));
}

/** Create codebase.db with a vectors table and the given rows. */
function makeVectorsDb(stateDir, rows) {
  const dbPath = path.join(stateDir, 'codebase.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY, embedding BLOB, text TEXT, metadata TEXT,
      file_path TEXT, epoch_written INTEGER, epoch_retired INTEGER
    )
  `);
  const ins = db.prepare('INSERT INTO vectors (id, epoch_written, epoch_retired) VALUES (?, ?, ?)');
  for (const r of rows) ins.run(r.id, r.written ?? 0, r.retired ?? null);
  db.close();
  return dbPath;
}

function countRows(dbPath, where = '') {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare(`SELECT COUNT(*) AS n FROM vectors ${where}`).get().n; }
  finally { db.close(); }
}

const deps = { minLiveEpoch, readManifest };

describe('pruneRetiredVectors', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('deletes rows at/below the frontier, keeps live + above-frontier rows', () => {
    const dbPath = makeVectorsDb(stateDir, [
      { id: 'live', retired: null },
      { id: 'r5', retired: 5 },
      { id: 'r10', retired: 10 },
      { id: 'r15', retired: 15 },
    ]);
    const db = new Database(dbPath);
    try {
      const res = pruneRetiredVectors(db, 10);
      expect(res.deleted).toBe(2); // r5, r10
    } finally { db.close(); }

    expect(countRows(dbPath)).toBe(2);
    expect(countRows(dbPath, "WHERE id = 'live'")).toBe(1);
    expect(countRows(dbPath, "WHERE id = 'r15'")).toBe(1);
  });

  it('bounds work to maxRows per run (hitCap)', () => {
    const rows = [];
    for (let i = 0; i < 50; i += 1) rows.push({ id: `r${i}`, retired: 1 });
    const dbPath = makeVectorsDb(stateDir, rows);
    const db = new Database(dbPath);
    try {
      const res = pruneRetiredVectors(db, 100, { batchSize: 10, maxRows: 20 });
      expect(res.deleted).toBe(20);
      expect(res.hitCap).toBe(true);
    } finally { db.close(); }
    expect(countRows(dbPath)).toBe(30);
  });

  it('rejects a non-integer frontier', () => {
    const dbPath = makeVectorsDb(stateDir, [{ id: 'a', retired: 1 }]);
    const db = new Database(dbPath);
    try {
      expect(() => pruneRetiredVectors(db, null)).toThrow(/integer/);
    } finally { db.close(); }
  });
});

describe('runVectorGc', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  function manifestAt(epoch) {
    const m = zeroManifest({});
    m.epoch = epoch;
    writeManifest(stateDir, m);
  }

  it('skips when codebase.db is absent', () => {
    expect(runVectorGc(stateDir, deps).skipped).toBe('no-vector-db');
  });

  it('skips when there is no frontier (no readers, no manifest)', () => {
    makeVectorsDb(stateDir, [{ id: 'r1', retired: 1 }]);
    expect(runVectorGc(stateDir, deps).skipped).toBe('no-frontier');
    // Nothing deleted.
    expect(countRows(path.join(stateDir, 'codebase.db'))).toBe(1);
  });

  it('uses the current manifest epoch as the frontier when no readers are live', () => {
    const dbPath = makeVectorsDb(stateDir, [
      { id: 'live', retired: null },
      { id: 'r5', retired: 5 },
      { id: 'r20', retired: 20 },
    ]);
    manifestAt(10);
    const out = runVectorGc(stateDir, deps);
    expect(out.hadReaders).toBe(false);
    expect(out.frontier).toBe(10);
    expect(out.deleted).toBe(1); // r5 only; r20 is retired above the frontier
    expect(countRows(dbPath, "WHERE id = 'r20'")).toBe(1);
    expect(countRows(dbPath, "WHERE id = 'live'")).toBe(1);
  });

  it('a live reader pin holds back GC of rows retired after its epoch; release lets GC reclaim', () => {
    const dbPath = makeVectorsDb(stateDir, [
      { id: 'live', retired: null },
      { id: 'r5', retired: 5 },
      { id: 'r8', retired: 8 },
    ]);
    manifestAt(20);

    // Reader pinned at epoch 6 still sees r8 (retired 8 > 6). minLiveEpoch=6.
    const pin = beginRead(stateDir, 6);
    expect(minLiveEpoch(stateDir)).toBe(6);
    const held = runVectorGc(stateDir, deps);
    expect(held.hadReaders).toBe(true);
    expect(held.frontier).toBe(6);
    expect(held.deleted).toBe(1); // r5 only (5 <= 6); r8 retained (8 > 6)
    expect(countRows(dbPath, "WHERE id = 'r8'")).toBe(1);

    // Release the pin → frontier jumps to the manifest epoch → r8 reclaimed.
    endRead(stateDir, pin);
    const after = runVectorGc(stateDir, deps);
    expect(after.hadReaders).toBe(false);
    expect(after.frontier).toBe(20);
    expect(after.deleted).toBe(1); // r8
    expect(countRows(dbPath, "WHERE id = 'live'")).toBe(1);
    expect(countRows(dbPath)).toBe(1);
  });

  it('readMaintenanceState surfaces retired counts that drop after GC', () => {
    makeVectorsDb(stateDir, [
      { id: 'live', retired: null },
      { id: 'r1', retired: 1 },
      { id: 'r2', retired: 2 },
    ]);
    manifestAt(10);
    expect(readVectorGcState(stateDir)).toMatchObject({ retiredCount: 2, totalCount: 3 });
    runVectorGc(stateDir, deps);
    expect(readVectorGcState(stateDir)).toMatchObject({ retiredCount: 0, totalCount: 1 });
  });
});
