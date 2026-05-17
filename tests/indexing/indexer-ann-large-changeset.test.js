/**
 * Regression test: indexer-ann.js must not crash with "too many SQL
 * variables" when the changedFiles list exceeds SQLite's bound-parameter
 * limit.
 *
 * Background:
 *   Encountered as a P0 production bug during CoSQA+ (51,516 docs) and
 *   BRIGHT-code (528,907 docs) benchmark runs. The original implementation
 *   built a single IN(?,?,...) clause sized to the entire changedFileSet,
 *   which SQLite rejects when it exceeds compile-time
 *   SQLITE_LIMIT_VARIABLE_NUMBER (default 32766; historic floor 999).
 *   better-sqlite3 does NOT expose sqlite3_limit(), so application-side
 *   chunking via chunkedIn() in core/infrastructure/db-utils.js is the
 *   only correct fix.
 *
 * What this test guards:
 *   1. The exact SQL template indexer-ann.js uses runs cleanly via
 *      chunkedIn() for both small (< SAFE_IN_CLAUSE_BATCH) and very
 *      large (>> 32766) file lists.
 *   2. Results are returned for ALL requested files — no silent
 *      truncation.
 *   3. Global ORDER BY rowid is recoverable via post-sort (the indexer
 *      relies on this for deterministic HNSW insertion order).
 *   4. The raw unchunked IN(?,?,...) at the same scale STILL fails — this
 *      pins the failure mode so the regression cannot resurface by
 *      someone reverting the chunking and accidentally relying on a
 *      newer SQLite default.
 *
 * This is a SQLite-only test (no HNSW / embedding model dependencies),
 * so it runs in CI on every platform unchanged.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  SAFE_IN_CLAUSE_BATCH,
  chunkedIn,
} from '../../core/infrastructure/db-utils.js';
import { __TEST__ as indexerAnnTest } from '../../core/indexing/indexer-ann.js';

// Exact SQL template from indexer-ann.js incrementalUpdateHNSW().
// Keeping this verbatim here means any future drift in the indexer is
// caught: if someone changes the projected columns or the alias filter,
// they must update this fixture too — which surfaces the change in
// review.
function indexerQueryTemplate(db) {
  return `
  SELECT rowid, id, file_path, embedding, metadata FROM vectors
   WHERE ${indexerAnnTest.vectorIndexWhere(db)}
     AND file_path IN (__IN_PLACEHOLDERS__)
   ORDER BY rowid
`;
}

function createCodebaseDb({ fileCount, chunksPerFile = 1, withAliasNoise = true, withEpochRetired = false }) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      embedding BLOB,
      metadata TEXT
      ${withEpochRetired ? ', epoch_retired INTEGER' : ''}
    );
    CREATE INDEX vectors_file_path_idx ON vectors(file_path);
  `);

  const insert = db.prepare(
    withEpochRetired
      ? 'INSERT INTO vectors (id, file_path, embedding, metadata, epoch_retired) VALUES (?, ?, ?, ?, ?)'
      : 'INSERT INTO vectors (id, file_path, embedding, metadata) VALUES (?, ?, ?, ?)'
  );
  const txn = db.transaction(() => {
    let rowCount = 0;
    for (let f = 0; f < fileCount; f++) {
      const filePath = `src/path/${Math.floor(f / 100)}/file_${f}.ts`;
      for (let c = 0; c < chunksPerFile; c++) {
        const id = `${filePath}::chunk_${c}`;
        // Tiny embedding (4-d float32) — content doesn't matter for this test
        const emb = Buffer.from(new Float32Array([0.1 * f, 0.2 * c, 0.3, 0.4]).buffer);
        const meta = JSON.stringify({ symbol: `fn_${rowCount}`, chunk_type: 'function' });
        if (withEpochRetired) insert.run(id, filePath, emb, meta, null);
        else insert.run(id, filePath, emb, meta);
        rowCount++;
      }
    }
    // Alias siblings (dedup pointers) — these MUST be filtered out by
    // ALIAS_FILTER_SQL. If the filter ever regresses, the row count
    // assertion below will catch it.
    if (withAliasNoise) {
      for (let i = 0; i < Math.min(50, fileCount); i++) {
        const filePath = `src/path/${Math.floor(i / 100)}/file_${i}.ts`;
        insert.run(
          `${filePath}::alias_${i}`,
          filePath,
          Buffer.alloc(16),
          JSON.stringify({ exemplarId: `${filePath}::chunk_0` }),
          ...(withEpochRetired ? [null] : []),
        );
      }
    }
  });
  txn();
  return db;
}

describe('indexer-ann SQL read path — large changedFiles regression', () => {
  it('reproduces the original crash: raw IN(?,?,...) with >32766 paths throws "too many SQL variables"', () => {
    // Pin the failure mode. If someone ever rewrites this without
    // chunking and SQLite's compile-time limit happens to be larger,
    // this assertion will fail and force them to acknowledge the
    // platform-portability risk.
    const db = createCodebaseDb({ fileCount: 200 });
    const N = 40000; // > 32766
    const paths = Array.from({ length: N }, (_, i) => `bogus/file_${i}.ts`);
    try {
      const placeholders = paths.map(() => '?').join(',');
      expect(() => db.prepare(
        `SELECT rowid FROM vectors WHERE ${indexerAnnTest.vectorIndexWhere(db)} AND file_path IN (${placeholders}) ORDER BY rowid`
      ).all(...paths)).toThrow(/too many SQL variables/i);
    } finally {
      db.close();
    }
  });

  it('chunkedIn handles a list larger than SAFE_IN_CLAUSE_BATCH without error', () => {
    const db = createCodebaseDb({ fileCount: 100 });
    const N = SAFE_IN_CLAUSE_BATCH * 5 + 13; // forces 6 batches, partial tail
    const paths = Array.from({ length: N }, (_, i) => `bogus/missing_${i}.ts`);
    try {
      expect(() => chunkedIn(db, indexerQueryTemplate(db), paths)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('chunkedIn handles a CoSQA+-scale changeset (~51k files) without error', () => {
    // Mirrors the exact corpus that crashed in production: more file
    // paths than fit in a single IN(?,?,...) clause on any SQLite build.
    const db = createCodebaseDb({ fileCount: 100 });
    const N = 51516; // CoSQA+ doc count
    const paths = Array.from({ length: N }, (_, i) => `cosqa/file_${i}.py`);
    try {
      expect(() => chunkedIn(db, indexerQueryTemplate(db), paths)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('chunkedIn handles a BRIGHT-scale changeset (~528k files) without error', () => {
    // Documents the upper bound. Don't pre-create all 528k rows — only
    // the IN clause needs to be that large; the indexer is expected to
    // return only the file_paths that actually exist.
    const db = createCodebaseDb({ fileCount: 100 });
    const N = 528907; // BRIGHT-code doc count
    const paths = Array.from({ length: N }, (_, i) => `bright/file_${i}`);
    try {
      const rows = chunkedIn(db, indexerQueryTemplate(db), paths);
      expect(rows).toEqual([]); // no matches — all paths are absent
    } finally {
      db.close();
    }
  }, 30_000);

  it('returns rows for ALL requested files (no silent truncation across batch boundaries)', () => {
    const FILE_COUNT = 5_000;
    const CHUNKS_PER_FILE = 2;
    const db = createCodebaseDb({ fileCount: FILE_COUNT, chunksPerFile: CHUNKS_PER_FILE });

    const paths = Array.from({ length: FILE_COUNT }, (_, i) => `src/path/${Math.floor(i / 100)}/file_${i}.ts`);

    try {
      let rows = chunkedIn(db, indexerQueryTemplate(db), paths);
      // Re-sort (callers must do this; the indexer does).
      rows.sort((a, b) => a.rowid - b.rowid);

      // Every file's every chunk should be returned, and alias rows
      // (exemplarId IS NOT NULL) must be filtered out.
      expect(rows.length).toBe(FILE_COUNT * CHUNKS_PER_FILE);
      // file_path coverage
      const recoveredFiles = new Set(rows.map(r => r.file_path));
      expect(recoveredFiles.size).toBe(FILE_COUNT);
    } finally {
      db.close();
    }
  });

  it('preserves global ORDER BY rowid after post-sort, even across many batches', () => {
    const FILE_COUNT = 3_500; // → 4 batches at SAFE_IN_CLAUSE_BATCH=999
    const db = createCodebaseDb({ fileCount: FILE_COUNT, withAliasNoise: false });

    // Shuffle the input paths so adjacent batches see disjoint rowid
    // ranges — the strongest test of batch-boundary order break.
    const paths = Array.from({ length: FILE_COUNT }, (_, i) => `src/path/${Math.floor(i / 100)}/file_${i}.ts`);
    // Reverse so high-rowid files land in the first batch.
    paths.reverse();

    try {
      let rows = chunkedIn(db, indexerQueryTemplate(db), paths);
      rows.sort((a, b) => a.rowid - b.rowid);
      // Strictly monotonic rowids
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].rowid).toBeGreaterThan(rows[i - 1].rowid);
      }
      expect(rows.length).toBe(FILE_COUNT);
    } finally {
      db.close();
    }
  });

  it('returns empty array when changedFiles is empty (no prepare/execution overhead)', () => {
    const db = createCodebaseDb({ fileCount: 10 });
    try {
      expect(chunkedIn(db, indexerQueryTemplate(db), [])).toEqual([]);
      expect(chunkedIn(db, indexerQueryTemplate(db), null)).toEqual([]);
      expect(chunkedIn(db, indexerQueryTemplate(db), undefined)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('filters alias rows correctly even at scale (exemplarId IS NOT NULL guard)', () => {
    const FILE_COUNT = 2_500;
    const db = createCodebaseDb({ fileCount: FILE_COUNT, withAliasNoise: true });

    const paths = Array.from({ length: FILE_COUNT }, (_, i) => `src/path/${Math.floor(i / 100)}/file_${i}.ts`);
    try {
      const rows = chunkedIn(db, indexerQueryTemplate(db), paths);
      // No row should have an exemplarId — the alias rows were inserted
      // for the first 50 files but must be filtered out by the
      // ALIAS_FILTER_SQL predicate.
      for (const row of rows) {
        const meta = JSON.parse(row.metadata);
        expect(meta.exemplarId).toBeUndefined();
      }
      // Exactly one chunk per file (no alias contamination)
      expect(rows.length).toBe(FILE_COUNT);
    } finally {
      db.close();
    }
  });

  it('filters epoch-retired vector rows from incremental HNSW changed-file reads', () => {
    const db = createCodebaseDb({
      fileCount: 3,
      chunksPerFile: 2,
      withAliasNoise: false,
      withEpochRetired: true,
    });
    const filePath = 'src/path/0/file_1.ts';
    db.prepare('UPDATE vectors SET epoch_retired = 7 WHERE id = ?').run(`${filePath}::chunk_0`);

    try {
      const rows = chunkedIn(db, indexerQueryTemplate(db), [filePath]);
      expect(rows.map((row) => row.id)).toEqual([`${filePath}::chunk_1`]);
    } finally {
      db.close();
    }
  });
});
