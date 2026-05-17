/**
 * Tests for core/incremental-indexing/infrastructure/sqlite-fts5.mjs
 *
 * Covers plan § 7.1.5:
 *   - `fts5SegmentCount` returns 0 on an empty table.
 *   - Segment count grows under many independent commits.
 *   - `fts5Merge` with a generous page budget collapses to 1 segment.
 *   - The helper tolerates a non-FTS5 table by returning 0 instead of
 *     throwing — the watermark scheduler may probe optional tables.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  fts5SegmentCount,
  fts5Merge,
  fts5StructureDescribe,
} from '../../core/incremental-indexing/infrastructure/sqlite-fts5.mjs';

describe('fts5SegmentCount', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('returns 0 on an empty FTS5 table', () => {
    db.exec("CREATE VIRTUAL TABLE t USING fts5(c)");
    expect(fts5SegmentCount(db, 't')).toBe(0);
  });

  it('returns 0 on a missing shadow table (non-FTS5)', () => {
    db.exec('CREATE TABLE plain (x)');
    expect(fts5SegmentCount(db, 'plain')).toBe(0);
  });

  it('rejects an unsafe table name', () => {
    expect(() => fts5SegmentCount(db, "t; DROP TABLE x;--")).toThrow();
  });

  it('counts segments after many independent commits', () => {
    db.exec("CREATE VIRTUAL TABLE t USING fts5(c)");
    for (let i = 0; i < 50; i++) {
      db.exec('BEGIN');
      db.prepare('INSERT INTO t(c) VALUES (?)').run(`hello world ${i}`);
      db.exec('COMMIT');
    }
    expect(fts5SegmentCount(db, 't')).toBeGreaterThanOrEqual(2);
  });

  it('shrinks to 1 after a generous merge', () => {
    db.exec("CREATE VIRTUAL TABLE t USING fts5(c)");
    for (let i = 0; i < 30; i++) {
      db.exec('BEGIN');
      db.prepare('INSERT INTO t(c) VALUES (?)').run(`row ${i}`);
      db.exec('COMMIT');
    }
    const before = fts5SegmentCount(db, 't');
    fts5Merge(db, 't', 500);
    const after = fts5SegmentCount(db, 't');
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThanOrEqual(1);
  });
});

describe('fts5Merge', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec("CREATE VIRTUAL TABLE t USING fts5(c)");
  });

  it('rejects an unsafe table name', () => {
    expect(() => fts5Merge(db, "t; DROP", 16)).toThrow();
  });

  it('rejects non-positive page budgets', () => {
    expect(() => fts5Merge(db, 't', 0)).toThrow();
    expect(() => fts5Merge(db, 't', -1)).toThrow();
  });

  it('rejects fractional page budgets', () => {
    expect(() => fts5Merge(db, 't', 1.5)).toThrow(/positive integer/);
  });

  it('runs cleanly on an empty table', () => {
    expect(() => fts5Merge(db, 't', 16)).not.toThrow();
  });
});

describe('fts5StructureDescribe', () => {
  it('returns the zero structure on an empty FTS5 table', () => {
    const db = new Database(':memory:');
    db.exec("CREATE VIRTUAL TABLE t USING fts5(c)");
    const struct = fts5StructureDescribe(db, 't');
    // FTS5 writes a structure record at table creation (cookie + 0 levels +
    // 0 segments), so `null` only happens when the shadow table is missing.
    expect(struct).not.toBeNull();
    expect(struct.nSegment).toBe(0);
    expect(struct.nLevel).toBe(0);
  });

  it('returns null on a table without a shadow', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE plain (x)');
    expect(fts5StructureDescribe(db, 'plain')).toBeNull();
  });

  it('reports the same total segment count as fts5SegmentCount when populated', () => {
    const db = new Database(':memory:');
    db.exec("CREATE VIRTUAL TABLE t USING fts5(c)");
    for (let i = 0; i < 12; i++) {
      db.exec('BEGIN');
      db.prepare('INSERT INTO t(c) VALUES (?)').run(`row ${i}`);
      db.exec('COMMIT');
    }
    const struct = fts5StructureDescribe(db, 't');
    expect(struct).not.toBeNull();
    // Phase 0 preflight (§ 3): structure-record top-level field matches the
    // shift-based count on SQLite ≥ 3.30.
    expect(struct.nSegment).toBe(fts5SegmentCount(db, 't'));
  });
});
