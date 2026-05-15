/**
 * Tests for core/incremental-indexing/application/tombstone-injector.mjs
 *
 * Plan § 13 Phase 5. The harness is the prerequisite for the actual
 * sensitivity sweep (user-driven GCSN benchmark; CLAUDE.md
 * `feedback_heldout_discipline_strict.md`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrateVectorsSchema } from '../../core/incremental-indexing/infrastructure/schema-migrations.mjs';
import { injectTombstones, sweepTombstoneFractions, __testing } from '../../core/incremental-indexing/application/tombstone-injector.mjs';

function makePopulatedDb(n) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY, file_path TEXT NOT NULL, embedding BLOB NOT NULL,
      text TEXT, metadata TEXT, session_id TEXT, tags TEXT, created_at TEXT
    )
  `);
  migrateVectorsSchema(db);
  const ins = db.prepare(`
    INSERT INTO vectors (id, file_path, embedding, text, metadata, session_id, tags, created_at)
    VALUES (?, ?, ?, '', '{}', 'sess', '[]', '2026')
  `);
  for (let i = 0; i < n; i++) ins.run(`row-${i}`, `src/${i}.js`, Buffer.alloc(4));
  return db;
}

describe('tombstone-injector / mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = __testing.mulberry32(42);
    const b = __testing.mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('differs across seeds', () => {
    const a = __testing.mulberry32(1);
    const b = __testing.mulberry32(2);
    expect(a()).not.toBe(b());
  });
});

describe('tombstone-injector / injectTombstones', () => {
  it('rejects fractions outside (0, 0.5]', () => {
    const db = makePopulatedDb(10);
    expect(() => injectTombstones({ db, fraction: 0, epoch: 1 })).toThrow();
    expect(() => injectTombstones({ db, fraction: 0.6, epoch: 1 })).toThrow();
    expect(() => injectTombstones({ db, fraction: -0.1, epoch: 1 })).toThrow();
  });

  it('injects approximately the requested fraction', () => {
    const db = makePopulatedDb(1000);
    const out = injectTombstones({ db, fraction: 0.2, epoch: 7 });
    expect(out.injected).toBe(200);
    expect(out.fraction).toBeCloseTo(0.2, 5);
    const tombstoned = db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE epoch_retired = ?').get(7).n;
    expect(tombstoned).toBe(200);
  });

  it('restore() undoes the injection', () => {
    const db = makePopulatedDb(100);
    const out = injectTombstones({ db, fraction: 0.3, epoch: 9 });
    expect(out.injected).toBe(30);
    out.restore();
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE epoch_retired IS NOT NULL').get().n;
    expect(remaining).toBe(0);
  });

  it('is deterministic for a given seed', () => {
    const db1 = makePopulatedDb(200);
    const db2 = makePopulatedDb(200);
    injectTombstones({ db: db1, fraction: 0.1, epoch: 5, seed: 123 });
    injectTombstones({ db: db2, fraction: 0.1, epoch: 5, seed: 123 });
    const ids1 = db1.prepare('SELECT id FROM vectors WHERE epoch_retired = ? ORDER BY id').all(5);
    const ids2 = db2.prepare('SELECT id FROM vectors WHERE epoch_retired = ? ORDER BY id').all(5);
    expect(ids1).toEqual(ids2);
  });
});

describe('tombstone-injector / sweepTombstoneFractions', () => {
  it('runs runOnce for each fraction and restores between points', async () => {
    const db = makePopulatedDb(500);
    const observations = [];
    const points = await sweepTombstoneFractions({
      db,
      fractions: [0.05, 0.1, 0.2],
      runOnce: async ({ fraction, injected }) => {
        const live = db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE epoch_retired IS NULL').get().n;
        observations.push({ fraction, injected, live });
        return { live };
      },
    });
    expect(points.length).toBe(3);
    expect(observations.map((o) => o.live)).toEqual([475, 450, 400]);
    // After the sweep, everything restored.
    const tombstoned = db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE epoch_retired IS NOT NULL').get().n;
    expect(tombstoned).toBe(0);
  });
});
