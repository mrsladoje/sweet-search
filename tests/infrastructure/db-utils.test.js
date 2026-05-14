import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  applyReadPragmas,
  SAFE_IN_CLAUSE_BATCH,
  assertInClauseSize,
  chunkedIn,
  chunkedInExec,
} from '../../core/infrastructure/index.js';

describe('db-utils', () => {
  describe('applyReadPragmas', () => {
    it('should apply mmap_size and cache_size pragmas to a database handle', () => {
      // Arrange
      const db = { pragma: vi.fn() };

      // Act
      applyReadPragmas(db);

      // Assert
      expect(db.pragma).toHaveBeenCalledTimes(2);
      expect(db.pragma).toHaveBeenCalledWith('mmap_size = 268435456');
      expect(db.pragma).toHaveBeenCalledWith('cache_size = -20000');
    });

    it('should apply temp_store MEMORY pragma when tempStoreMemory option is true', () => {
      // Arrange
      const db = { pragma: vi.fn() };

      // Act
      applyReadPragmas(db, { tempStoreMemory: true });

      // Assert
      expect(db.pragma).toHaveBeenCalledTimes(3);
      expect(db.pragma).toHaveBeenCalledWith('mmap_size = 268435456');
      expect(db.pragma).toHaveBeenCalledWith('cache_size = -20000');
      expect(db.pragma).toHaveBeenCalledWith('temp_store = MEMORY');
    });

    it('should NOT apply temp_store pragma when tempStoreMemory option is false', () => {
      // Arrange
      const db = { pragma: vi.fn() };

      // Act
      applyReadPragmas(db, { tempStoreMemory: false });

      // Assert
      expect(db.pragma).toHaveBeenCalledTimes(2);
      expect(db.pragma).not.toHaveBeenCalledWith('temp_store = MEMORY');
    });

    it('should NOT apply temp_store pragma when options are omitted entirely', () => {
      // Arrange
      const db = { pragma: vi.fn() };

      // Act
      applyReadPragmas(db);

      // Assert
      expect(db.pragma).not.toHaveBeenCalledWith('temp_store = MEMORY');
    });

    describe('error resilience', () => {
      it('should swallow errors thrown by individual pragma calls', () => {
        // Arrange
        const db = {
          pragma: vi.fn().mockImplementation((stmt) => {
            if (stmt === 'mmap_size = 268435456') throw new Error('disk I/O error');
          }),
        };

        // Act & Assert — should not throw
        expect(() => applyReadPragmas(db)).not.toThrow();
        // cache_size should still be attempted after mmap_size failure
        expect(db.pragma).toHaveBeenCalledWith('cache_size = -20000');
      });

      it('should swallow error from temp_store pragma and not propagate', () => {
        // Arrange
        const db = {
          pragma: vi.fn().mockImplementation((stmt) => {
            if (stmt === 'temp_store = MEMORY') throw new Error('readonly db');
          }),
        };

        // Act & Assert
        expect(() => applyReadPragmas(db, { tempStoreMemory: true })).not.toThrow();
        expect(db.pragma).toHaveBeenCalledWith('temp_store = MEMORY');
      });

      it('should continue applying remaining pragmas when one throws', () => {
        // Arrange
        const db = {
          pragma: vi.fn()
            .mockImplementationOnce(() => { throw new Error('fail first'); })
            .mockImplementationOnce(() => {})
            .mockImplementationOnce(() => {}),
        };

        // Act
        applyReadPragmas(db, { tempStoreMemory: true });

        // Assert — all 3 pragmas attempted despite first failure
        expect(db.pragma).toHaveBeenCalledTimes(3);
      });
    });

    describe('edge cases: null/undefined db handle', () => {
      it('should not throw when db is null [RED: missing null guard]', () => {
        // Arrange / Act / Assert
        // Current impl throws TypeError — needs null guard for 7+ domain callers
        expect(() => applyReadPragmas(null)).not.toThrow();
      });

      it('should not throw when db is undefined [RED: missing undefined guard]', () => {
        // Arrange / Act / Assert
        // Current impl throws TypeError — needs undefined guard for 7+ domain callers
        expect(() => applyReadPragmas(undefined)).not.toThrow();
      });

      it('should not throw when db has no pragma method', () => {
        // Arrange
        const db = {};

        // Act / Assert
        expect(() => applyReadPragmas(db)).not.toThrow();
      });

      it('should not throw when db.pragma is not a function', () => {
        // Arrange
        const db = { pragma: 'not-a-function' };

        // Act / Assert
        expect(() => applyReadPragmas(db)).not.toThrow();
      });
    });

    describe('call ordering', () => {
      it('should apply mmap_size before cache_size', () => {
        // Arrange
        const calls = [];
        const db = {
          pragma: vi.fn().mockImplementation((stmt) => {
            calls.push(stmt);
          }),
        };

        // Act
        applyReadPragmas(db);

        // Assert
        expect(calls[0]).toBe('mmap_size = 268435456');
        expect(calls[1]).toBe('cache_size = -20000');
      });

      it('should apply temp_store after mmap_size and cache_size', () => {
        // Arrange
        const calls = [];
        const db = {
          pragma: vi.fn().mockImplementation((stmt) => {
            calls.push(stmt);
          }),
        };

        // Act
        applyReadPragmas(db, { tempStoreMemory: true });

        // Assert
        expect(calls).toEqual([
          'mmap_size = 268435456',
          'cache_size = -20000',
          'temp_store = MEMORY',
        ]);
      });
    });
  });

  // ===========================================================================
  // SQLite IN(?,?,...) bound-parameter limit (regression — see indexer-ann
  // crash on >32k changed files, "too many SQL variables").
  // ===========================================================================

  describe('SAFE_IN_CLAUSE_BATCH', () => {
    it('should be set to 999 — the historic SQLite LIMIT_VARIABLE_NUMBER floor', () => {
      expect(SAFE_IN_CLAUSE_BATCH).toBe(999);
    });
  });

  describe('assertInClauseSize', () => {
    it('should accept sizes at and below SAFE_IN_CLAUSE_BATCH', () => {
      expect(() => assertInClauseSize(0)).not.toThrow();
      expect(() => assertInClauseSize(1)).not.toThrow();
      expect(() => assertInClauseSize(500)).not.toThrow();
      expect(() => assertInClauseSize(SAFE_IN_CLAUSE_BATCH)).not.toThrow();
    });

    it('should throw RangeError when size exceeds SAFE_IN_CLAUSE_BATCH', () => {
      expect(() => assertInClauseSize(SAFE_IN_CLAUSE_BATCH + 1)).toThrow(RangeError);
      expect(() => assertInClauseSize(32766)).toThrow(RangeError);
    });

    it('should include site label and suggested helper in error message', () => {
      let err;
      try { assertInClauseSize(2000, 'TestSite.foo'); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(RangeError);
      expect(err.message).toContain('TestSite.foo');
      expect(err.message).toContain('chunkedIn');
      expect(err.message).toMatch(/SAFE_IN_CLAUSE_BATCH=999/);
    });

    it('should reject non-numeric / negative / NaN sizes with TypeError', () => {
      expect(() => assertInClauseSize('100')).toThrow(TypeError);
      expect(() => assertInClauseSize(NaN)).toThrow(TypeError);
      expect(() => assertInClauseSize(-1)).toThrow(TypeError);
      expect(() => assertInClauseSize(undefined)).toThrow(TypeError);
    });
  });

  describe('chunkedIn — input validation', () => {
    it('should throw TypeError when db is null or has no prepare()', () => {
      expect(() => chunkedIn(null, 'SELECT 1 WHERE id IN (__IN_PLACEHOLDERS__)', [1])).toThrow(TypeError);
      expect(() => chunkedIn({}, 'SELECT 1 WHERE id IN (__IN_PLACEHOLDERS__)', [1])).toThrow(TypeError);
    });

    it('should throw TypeError when sqlTemplate lacks __IN_PLACEHOLDERS__ token', () => {
      const db = new Database(':memory:');
      try {
        expect(() => chunkedIn(db, 'SELECT 1 WHERE id IN (?,?)', [1, 2])).toThrow(TypeError);
        expect(() => chunkedIn(db, '', [1])).toThrow(TypeError);
      } finally {
        db.close();
      }
    });

    it('should return [] without preparing for empty values', () => {
      const db = new Database(':memory:');
      const prepareSpy = vi.spyOn(db, 'prepare');
      try {
        expect(chunkedIn(db, 'SELECT 1 WHERE id IN (__IN_PLACEHOLDERS__)', [])).toEqual([]);
        expect(chunkedIn(db, 'SELECT 1 WHERE id IN (__IN_PLACEHOLDERS__)', null)).toEqual([]);
        expect(chunkedIn(db, 'SELECT 1 WHERE id IN (__IN_PLACEHOLDERS__)', undefined)).toEqual([]);
        expect(prepareSpy).not.toHaveBeenCalled();
      } finally {
        prepareSpy.mockRestore();
        db.close();
      }
    });
  });

  describe('chunkedIn — single-batch behavior (length ≤ SAFE_IN_CLAUSE_BATCH)', () => {
    it('should return rows in template-defined ORDER BY within one batch', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
      const insert = db.prepare('INSERT INTO t (id, val) VALUES (?, ?)');
      for (let i = 1; i <= 50; i++) insert.run(i, `v${i}`);

      const ids = [42, 1, 17, 8];
      try {
        const rows = chunkedIn(
          db,
          'SELECT id, val FROM t WHERE id IN (__IN_PLACEHOLDERS__) ORDER BY id',
          ids,
        );
        expect(rows.map(r => r.id)).toEqual([1, 8, 17, 42]);
        expect(rows.map(r => r.val)).toEqual(['v1', 'v8', 'v17', 'v42']);
      } finally {
        db.close();
      }
    });

    it('should issue exactly one prepare() call when length ≤ SAFE_IN_CLAUSE_BATCH', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      for (let i = 1; i <= SAFE_IN_CLAUSE_BATCH; i++) db.prepare('INSERT INTO t VALUES (?)').run(i);
      const prepareSpy = vi.spyOn(db, 'prepare');
      try {
        const ids = Array.from({ length: SAFE_IN_CLAUSE_BATCH }, (_, i) => i + 1);
        const rows = chunkedIn(db, 'SELECT id FROM t WHERE id IN (__IN_PLACEHOLDERS__)', ids);
        expect(rows.length).toBe(SAFE_IN_CLAUSE_BATCH);
        // Exactly one prepare call within the helper itself
        expect(prepareSpy).toHaveBeenCalledTimes(1);
      } finally {
        prepareSpy.mockRestore();
        db.close();
      }
    });
  });

  describe('chunkedIn — multi-batch behavior (the regression case)', () => {
    it('should NOT throw "too many SQL variables" when length > SAFE_IN_CLAUSE_BATCH', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      const N = SAFE_IN_CLAUSE_BATCH * 3 + 7; // forces 4 batches with a partial tail
      const insert = db.prepare('INSERT INTO t VALUES (?)');
      const txn = db.transaction((n) => { for (let i = 1; i <= n; i++) insert.run(i); });
      txn(N);

      const ids = Array.from({ length: N }, (_, i) => i + 1);
      try {
        const rows = chunkedIn(db, 'SELECT id FROM t WHERE id IN (__IN_PLACEHOLDERS__)', ids);
        expect(rows.length).toBe(N);
      } finally {
        db.close();
      }
    });

    it('should reject this exact query before the fix (sanity: raw IN(?,?,...) crashes at ~32k+)', () => {
      // This test documents the failure mode: a single IN(?,?,...) with
      // length > SQLITE_LIMIT_VARIABLE_NUMBER (default 32766) crashes
      // SQLite with "too many SQL variables". This is what was happening
      // on the indexer's full changedFileSet for the 51k-doc CoSQA+
      // corpus before the chunkedIn fix landed.
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      const N = 40000; // > 32766
      try {
        const placeholders = Array.from({ length: N }, () => '?').join(',');
        const ids = Array.from({ length: N }, (_, i) => i + 1);
        expect(() => db.prepare(`SELECT id FROM t WHERE id IN (${placeholders})`).all(...ids))
          .toThrow(/too many SQL variables/i);
      } finally {
        db.close();
      }
    });

    it('should issue ceil(N / SAFE_IN_CLAUSE_BATCH) prepare() calls', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      const N = SAFE_IN_CLAUSE_BATCH * 2 + 1; // 3 batches
      const insert = db.prepare('INSERT INTO t VALUES (?)');
      const txn = db.transaction(() => { for (let i = 1; i <= N; i++) insert.run(i); });
      txn();

      const prepareSpy = vi.spyOn(db, 'prepare');
      try {
        const ids = Array.from({ length: N }, (_, i) => i + 1);
        chunkedIn(db, 'SELECT id FROM t WHERE id IN (__IN_PLACEHOLDERS__)', ids);
        expect(prepareSpy).toHaveBeenCalledTimes(3);
      } finally {
        prepareSpy.mockRestore();
        db.close();
      }
    });

    it('should return rows for ALL values (no silent truncation)', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE files (path TEXT PRIMARY KEY)');
      const N = 5000;
      const insert = db.prepare('INSERT INTO files VALUES (?)');
      const txn = db.transaction(() => { for (let i = 0; i < N; i++) insert.run(`p${i}`); });
      txn();

      const paths = Array.from({ length: N }, (_, i) => `p${i}`);
      try {
        const rows = chunkedIn(db, 'SELECT path FROM files WHERE path IN (__IN_PLACEHOLDERS__)', paths);
        expect(rows.length).toBe(N);
        const recovered = new Set(rows.map(r => r.path));
        expect(recovered.size).toBe(N);
        for (let i = 0; i < N; i++) expect(recovered.has(`p${i}`)).toBe(true);
      } finally {
        db.close();
      }
    });

    it('should expose batch-boundary effect: ORDER BY in template is NOT globally monotonic across batches', () => {
      // Documents the documented caveat: callers needing globally sorted
      // output (e.g. indexer-ann.js HNSW insertion order) must re-sort.
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      const N = SAFE_IN_CLAUSE_BATCH * 2;
      const insert = db.prepare('INSERT INTO t VALUES (?)');
      const txn = db.transaction(() => { for (let i = 1; i <= N; i++) insert.run(i); });
      txn();

      // Pass IDs in shuffled order across the two batches: batch 1 = [SAFE..1+SAFE),
      // batch 2 = [1..SAFE). After ORDER BY id within each batch, batch 1's lowest is
      // SAFE+1 and batch 2's lowest is 1 — concatenation breaks global monotonicity.
      const ids = [
        ...Array.from({ length: SAFE_IN_CLAUSE_BATCH }, (_, i) => SAFE_IN_CLAUSE_BATCH + 1 + i),
        ...Array.from({ length: SAFE_IN_CLAUSE_BATCH }, (_, i) => 1 + i),
      ];
      try {
        const rows = chunkedIn(db, 'SELECT id FROM t WHERE id IN (__IN_PLACEHOLDERS__) ORDER BY id', ids);
        expect(rows.length).toBe(N);
        // Within batch 1 (first SAFE rows): monotonic from SAFE+1..2*SAFE
        expect(rows[0].id).toBe(SAFE_IN_CLAUSE_BATCH + 1);
        expect(rows[SAFE_IN_CLAUSE_BATCH - 1].id).toBe(N);
        // Within batch 2 (next SAFE rows): restarts at 1..SAFE
        expect(rows[SAFE_IN_CLAUSE_BATCH].id).toBe(1);
        expect(rows[N - 1].id).toBe(SAFE_IN_CLAUSE_BATCH);
        // Re-sorting recovers global monotonic order
        rows.sort((a, b) => a.id - b.id);
        for (let i = 0; i < N; i++) expect(rows[i].id).toBe(i + 1);
      } finally {
        db.close();
      }
    });

    it('should accept Set-like iterables as values (not only arrays)', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      for (let i = 1; i <= 10; i++) db.prepare('INSERT INTO t VALUES (?)').run(i);
      try {
        const setOfIds = new Set([1, 2, 3, 4, 5]);
        const rows = chunkedIn(
          db,
          'SELECT id FROM t WHERE id IN (__IN_PLACEHOLDERS__) ORDER BY id',
          [...setOfIds],
        );
        expect(rows.map(r => r.id)).toEqual([1, 2, 3, 4, 5]);
      } finally {
        db.close();
      }
    });
  });

  describe('chunkedInExec — UPDATE/DELETE with chunked binds', () => {
    it('should sum changes across batches', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, marked INTEGER DEFAULT 0)');
      const N = SAFE_IN_CLAUSE_BATCH * 2 + 5; // 3 batches
      const insert = db.prepare('INSERT INTO t (id) VALUES (?)');
      const txn = db.transaction(() => { for (let i = 1; i <= N; i++) insert.run(i); });
      txn();

      const ids = Array.from({ length: N }, (_, i) => i + 1);
      try {
        const result = chunkedInExec(
          db,
          'UPDATE t SET marked = 1 WHERE id IN (__IN_PLACEHOLDERS__)',
          ids,
        );
        expect(result.changes).toBe(N);
        const verified = db.prepare('SELECT COUNT(*) AS c FROM t WHERE marked = 1').get();
        expect(verified.c).toBe(N);
      } finally {
        db.close();
      }
    });

    it('should roll back ALL batches if any batch throws', () => {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, marked INTEGER DEFAULT 0)');
      const N = SAFE_IN_CLAUSE_BATCH + 5; // 2 batches
      const insert = db.prepare('INSERT INTO t (id) VALUES (?)');
      const txn = db.transaction(() => { for (let i = 1; i <= N; i++) insert.run(i); });
      txn();

      // Mix a string into the IDs to force a constraint/type error inside
      // the second batch — better-sqlite3 raises on binding mismatch when
      // a strict typed column is involved. Use a malformed template
      // instead, which throws when prepare() is called on the 2nd batch.
      const ids = Array.from({ length: N }, (_, i) => i + 1);
      try {
        let prepareCount = 0;
        const origPrepare = db.prepare.bind(db);
        const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
          prepareCount++;
          if (prepareCount === 2) throw new Error('synthetic batch-2 failure');
          return origPrepare(sql);
        });
        try {
          expect(() => chunkedInExec(
            db,
            'UPDATE t SET marked = 1 WHERE id IN (__IN_PLACEHOLDERS__)',
            ids,
          )).toThrow('synthetic batch-2 failure');
        } finally {
          prepareSpy.mockRestore();
        }

        // Batch 1's update must have been rolled back by the transaction.
        const verified = db.prepare('SELECT COUNT(*) AS c FROM t WHERE marked = 1').get();
        expect(verified.c).toBe(0);
      } finally {
        db.close();
      }
    });

    it('should return { changes: 0 } for empty values without preparing', () => {
      const db = new Database(':memory:');
      const prepareSpy = vi.spyOn(db, 'prepare');
      try {
        expect(chunkedInExec(db, 'DELETE FROM t WHERE id IN (__IN_PLACEHOLDERS__)', [])).toEqual({ changes: 0 });
        expect(chunkedInExec(db, 'DELETE FROM t WHERE id IN (__IN_PLACEHOLDERS__)', null)).toEqual({ changes: 0 });
        expect(prepareSpy).not.toHaveBeenCalled();
      } finally {
        prepareSpy.mockRestore();
        db.close();
      }
    });

    it('should throw TypeError when sqlTemplate lacks __IN_PLACEHOLDERS__', () => {
      const db = new Database(':memory:');
      try {
        expect(() => chunkedInExec(db, 'DELETE FROM t WHERE id = ?', [1])).toThrow(TypeError);
      } finally {
        db.close();
      }
    });
  });
});
