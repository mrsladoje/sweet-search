import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CodebaseRepository } from '../../core/infrastructure/codebase-repository.js';
import { writeManifest, zeroManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';

// Helper: create a temp DB with the vectors schema and seed data
function createTestDb(rows = []) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-repo-test-'));
  const dbPath = path.join(tmpDir, 'codebase.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      embedding BLOB,
      text TEXT,
      metadata TEXT
    )
  `);
  const insert = db.prepare(
    'INSERT INTO vectors (id, file_path, embedding, text, metadata) VALUES (?, ?, ?, ?, ?)'
  );
  for (const row of rows) {
    insert.run(row.id, row.file_path, row.embedding ?? null, row.text ?? null, row.metadata ?? null);
  }
  db.close();
  return { dbPath, tmpDir };
}

function createVisibilityDb(rows = []) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-repo-visibility-'));
  const dbPath = path.join(tmpDir, 'codebase.db');
  writeVisibilityDb(dbPath, rows);
  return { dbPath, tmpDir };
}

function writeVisibilityDb(dbPath, rows = []) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      embedding BLOB,
      text TEXT,
      metadata TEXT,
      epoch_written INTEGER,
      epoch_retired INTEGER
    )
  `);
  const insert = db.prepare(`
    INSERT INTO vectors (id, file_path, embedding, text, metadata, epoch_written, epoch_retired)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      row.id,
      row.file_path,
      row.embedding ?? null,
      row.text ?? null,
      row.metadata ?? null,
      Object.hasOwn(row, 'epoch_written') ? row.epoch_written : 0,
      row.epoch_retired ?? null,
    );
  }
  db.close();
}

function makeEmbedding(values) {
  return Buffer.from(new Float32Array(values).buffer);
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodebaseRepository', () => {
  let dbPath;
  let tmpDir;
  let repo;

  afterEach(() => {
    repo?.close();
    if (tmpDir) cleanup(tmpDir);
  });

  // -------------------------------------------------------------------------
  // iterateVectors
  // -------------------------------------------------------------------------

  describe('iterateVectors', () => {
    it('yields all rows from the vectors table', () => {
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', text: 'function a() {}', metadata: '{"type":"function"}' },
        { id: 'v2', file_path: 'b.js', text: 'class B {}', metadata: '{"type":"class"}' },
      ]));
      repo = new CodebaseRepository(dbPath);

      const rows = [...repo.iterateVectors()];

      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe('v1');
      expect(rows[0].file_path).toBe('a.js');
      expect(rows[0].text).toBe('function a() {}');
      expect(rows[1].id).toBe('v2');
    });

    it('returns columns needed by getCodebaseChunkTypeMap (file_path + metadata)', () => {
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'src/auth.ts', metadata: JSON.stringify({ type: 'function', startLine: 1, endLine: 10 }) },
      ]));
      repo = new CodebaseRepository(dbPath);

      const [row] = [...repo.iterateVectors()];

      expect(row.file_path).toBe('src/auth.ts');
      const meta = JSON.parse(row.metadata);
      expect(meta.type).toBe('function');
      expect(meta.startLine).toBe(1);
    });

    it('yields zero rows from an empty table', () => {
      ({ dbPath, tmpDir } = createTestDb([]));
      repo = new CodebaseRepository(dbPath);

      expect([...repo.iterateVectors()]).toHaveLength(0);
    });

    it('opens the connection lazily on first call', () => {
      ({ dbPath, tmpDir } = createTestDb([]));
      repo = new CodebaseRepository(dbPath);

      expect(repo._db !== null).toBe(false);
      [...repo.iterateVectors()];
      expect(repo._db !== null).toBe(true);
    });

    it('reuses the same connection across calls', () => {
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js' },
      ]));
      repo = new CodebaseRepository(dbPath);

      [...repo.iterateVectors()];
      const dbAfterFirst = repo._db;
      [...repo.iterateVectors()];
      expect(repo._db).toBe(dbAfterFirst);
    });
  });

  // -------------------------------------------------------------------------
  // getEmbeddingsByIds
  // -------------------------------------------------------------------------

  describe('getEmbeddingsByIds', () => {
    it('returns Float32Arrays keyed by ID', () => {
      const emb1 = makeEmbedding([1.0, 2.0, 3.0]);
      const emb2 = makeEmbedding([4.0, 5.0, 6.0]);
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', embedding: emb1 },
        { id: 'v2', file_path: 'b.js', embedding: emb2 },
      ]));
      repo = new CodebaseRepository(dbPath);

      const result = repo.getEmbeddingsByIds(['v1', 'v2']);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      const arr1 = result.get('v1');
      expect(arr1).toBeInstanceOf(Float32Array);
      expect([...arr1]).toEqual([1.0, 2.0, 3.0]);
      expect([...result.get('v2')]).toEqual([4.0, 5.0, 6.0]);
    });

    it('deduplicates IDs — no duplicate SQL placeholders', () => {
      const emb = makeEmbedding([1.0]);
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', embedding: emb },
      ]));
      repo = new CodebaseRepository(dbPath);

      const result = repo.getEmbeddingsByIds(['v1', 'v1', 'v1']);

      expect(result.size).toBe(1);
      expect([...result.get('v1')]).toEqual([1.0]);
    });

    it('returns empty Map for empty input', () => {
      ({ dbPath, tmpDir } = createTestDb([]));
      repo = new CodebaseRepository(dbPath);

      expect(repo.getEmbeddingsByIds([]).size).toBe(0);
    });

    it('skips rows with null embeddings', () => {
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', embedding: null },
        { id: 'v2', file_path: 'b.js', embedding: makeEmbedding([9.0]) },
      ]));
      repo = new CodebaseRepository(dbPath);

      const result = repo.getEmbeddingsByIds(['v1', 'v2']);

      expect(result.size).toBe(1);
      expect(result.has('v1')).toBe(false);
      expect(result.has('v2')).toBe(true);
    });

    it('ignores IDs that do not exist in the table', () => {
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', embedding: makeEmbedding([1.0]) },
      ]));
      repo = new CodebaseRepository(dbPath);

      const result = repo.getEmbeddingsByIds(['v1', 'nonexistent']);

      expect(result.size).toBe(1);
      expect(result.has('nonexistent')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getChunkTexts
  // -------------------------------------------------------------------------

  describe('getChunkTexts', () => {
    it('returns id → text map', () => {
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', text: 'function a() {}' },
        { id: 'v2', file_path: 'b.js', text: 'class B {}' },
      ]));
      repo = new CodebaseRepository(dbPath);

      const result = repo.getChunkTexts(['v1', 'v2']);

      expect(result.get('v1')).toBe('function a() {}');
      expect(result.get('v2')).toBe('class B {}');
    });

    it('returns empty Map for null/undefined/empty input', () => {
      ({ dbPath, tmpDir } = createTestDb([]));
      repo = new CodebaseRepository(dbPath);

      expect(repo.getChunkTexts(null).size).toBe(0);
      expect(repo.getChunkTexts(undefined).size).toBe(0);
      expect(repo.getChunkTexts([]).size).toBe(0);
    });

    it('returns empty Map when DB has no matching IDs', () => {
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', text: 'hello' },
      ]));
      repo = new CodebaseRepository(dbPath);

      expect(repo.getChunkTexts(['nonexistent']).size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // scanAllVectors
  // -------------------------------------------------------------------------

  describe('scanAllVectors', () => {
    it('returns all rows as an array', () => {
      const emb = makeEmbedding([1.0, 2.0]);
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', embedding: emb, text: 'fn a', metadata: '{}' },
        { id: 'v2', file_path: 'b.js', embedding: emb, text: 'fn b', metadata: '{}' },
      ]));
      repo = new CodebaseRepository(dbPath);

      const rows = repo.scanAllVectors();

      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe('v1');
      expect(rows[1].id).toBe('v2');
    });

    it('does NOT open the persistent connection', () => {
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js' },
      ]));
      repo = new CodebaseRepository(dbPath);

      repo.scanAllVectors();

      expect(repo._db !== null).toBe(false);
    });

    it('returns embeddings as Buffers usable by Float32Array constructor', () => {
      const values = [1.5, -2.5, 3.5, 0.0];
      const emb = makeEmbedding(values);
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', embedding: emb },
      ]));
      repo = new CodebaseRepository(dbPath);

      const [row] = repo.scanAllVectors();
      const buf = row.embedding;
      const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);

      expect([...floats]).toEqual(values);
    });

    it('returns empty array from empty table', () => {
      ({ dbPath, tmpDir } = createTestDb([]));
      repo = new CodebaseRepository(dbPath);

      expect(repo.scanAllVectors()).toHaveLength(0);
    });
  });

  describe('incremental epoch visibility', () => {
    it('hides retired vectors by default across repository reads', () => {
      const emb = makeEmbedding([1.0]);
      ({ dbPath, tmpDir } = createVisibilityDb([
        { id: 'old', file_path: 'a.js', embedding: emb, text: 'old', metadata: JSON.stringify({ clusterId: 'c1' }), epoch_written: 1, epoch_retired: 2 },
        { id: 'live', file_path: 'a.js', embedding: emb, text: 'live', metadata: JSON.stringify({ clusterId: 'c1' }), epoch_written: 2, epoch_retired: null },
      ]));
      repo = new CodebaseRepository(dbPath);

      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['live']);
      expect([...repo.getChunkTexts(['old', 'live']).keys()]).toEqual(['live']);
      expect([...repo.getEmbeddingsByIds(['old', 'live']).keys()]).toEqual(['live']);
      expect(repo.getChunksByFilePath('a.js').map((r) => r.id)).toEqual(['live']);
      expect(repo.scanAllVectors().map((r) => r.id)).toEqual(['live']);
      expect(repo.findSiblingsByClusterIds(['c1']).map((r) => r.id)).toEqual(['live']);
    });

    it('honors a pinned manifest epoch when one is supplied', () => {
      const emb = makeEmbedding([1.0]);
      ({ dbPath, tmpDir } = createVisibilityDb([
        { id: 'old', file_path: 'a.js', embedding: emb, text: 'old', metadata: '{}', epoch_written: 1, epoch_retired: 3 },
        { id: 'new', file_path: 'a.js', embedding: emb, text: 'new', metadata: '{}', epoch_written: 3, epoch_retired: null },
      ]));
      repo = new CodebaseRepository(dbPath, { manifestEpoch: 2 });

      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['old']);
      expect(repo.getChunksByFilePath('a.js').map((r) => r.id)).toEqual(['old']);
      expect([...repo.getEmbeddingsByIds(['old', 'new']).keys()]).toEqual(['old']);
    });

    it('auto-pins the adjacent reconcile manifest when present', () => {
      const emb = makeEmbedding([1.0]);
      ({ dbPath, tmpDir } = createVisibilityDb([
        { id: 'old', file_path: 'a.js', embedding: emb, text: 'old', metadata: '{}', epoch_written: 1, epoch_retired: 3 },
        { id: 'new', file_path: 'a.js', embedding: emb, text: 'new', metadata: '{}', epoch_written: 3, epoch_retired: null },
      ]));
      const manifest = zeroManifest({});
      manifest.epoch = 2;
      writeManifest(tmpDir, manifest);

      repo = new CodebaseRepository(dbPath);
      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['old']);
    });

    it('opens the vectors database named by the adjacent reconcile manifest', () => {
      const emb = makeEmbedding([1.0]);
      ({ dbPath, tmpDir } = createVisibilityDb([
        { id: 'default-db', file_path: 'a.js', embedding: emb, text: 'default', metadata: '{}', epoch_written: 2, epoch_retired: null },
      ]));
      writeVisibilityDb(path.join(tmpDir, 'vectors-epoch-2.db'), [
        { id: 'manifest-db', file_path: 'a.js', embedding: emb, text: 'manifest', metadata: '{}', epoch_written: 2, epoch_retired: null },
      ]);
      const manifest = zeroManifest({ vectors: 'vectors-epoch-2.db' });
      manifest.epoch = 2;
      manifest.vectors = { path: 'vectors-epoch-2.db', epoch: 2 };
      writeManifest(tmpDir, manifest);

      repo = new CodebaseRepository(dbPath);
      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['manifest-db']);
    });

    it('uses the manifest vectors path when an explicit epoch is supplied', () => {
      const emb = makeEmbedding([1.0]);
      ({ dbPath, tmpDir } = createVisibilityDb([
        { id: 'default-db', file_path: 'a.js', embedding: emb, text: 'default', metadata: '{}', epoch_written: 2, epoch_retired: null },
      ]));
      writeVisibilityDb(path.join(tmpDir, 'vectors-epoch-2.db'), [
        { id: 'manifest-db', file_path: 'a.js', embedding: emb, text: 'manifest', metadata: '{}', epoch_written: 2, epoch_retired: null },
      ]);
      const manifest = zeroManifest({ vectors: 'vectors-epoch-2.db' });
      manifest.epoch = 7;
      manifest.vectors = { path: 'vectors-epoch-2.db', epoch: 7 };
      writeManifest(tmpDir, manifest);

      repo = new CodebaseRepository(dbPath, { manifestEpoch: 2 });
      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['manifest-db']);
    });

    it('refreshes adjacent manifest epochs for long-lived readers', () => {
      const emb = makeEmbedding([1.0]);
      ({ dbPath, tmpDir } = createVisibilityDb([
        { id: 'old', file_path: 'a.js', embedding: emb, text: 'old', metadata: '{}', epoch_written: 1, epoch_retired: 3 },
        { id: 'new', file_path: 'a.js', embedding: emb, text: 'new', metadata: '{}', epoch_written: 3, epoch_retired: null },
      ]));
      const manifest = zeroManifest({});
      manifest.epoch = 2;
      writeManifest(tmpDir, manifest);
      repo = new CodebaseRepository(dbPath);
      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['old']);

      manifest.epoch = 3;
      writeManifest(tmpDir, manifest);
      repo.refreshManifestEpoch();
      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['new']);
    });

    it('reopens the vectors database when a manifest refresh follows an atomic DB swap', () => {
      const emb = makeEmbedding([1.0]);
      ({ dbPath, tmpDir } = createVisibilityDb([
        { id: 'before-swap', file_path: 'a.js', embedding: emb, text: 'old', metadata: '{}', epoch_written: 1, epoch_retired: null },
      ]));
      const manifest = zeroManifest({});
      manifest.epoch = 1;
      writeManifest(tmpDir, manifest);

      repo = new CodebaseRepository(dbPath);
      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['before-swap']);

      const replacement = path.join(tmpDir, 'replacement.db');
      const db = new Database(replacement);
      db.exec(`
        CREATE TABLE vectors (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          embedding BLOB,
          text TEXT,
          metadata TEXT,
          epoch_written INTEGER,
          epoch_retired INTEGER
        )
      `);
      db.prepare(`
        INSERT INTO vectors (id, file_path, embedding, text, metadata, epoch_written, epoch_retired)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('after-swap', 'a.js', emb, 'new', '{}', 2, null);
      db.close();
      fs.renameSync(replacement, dbPath);

      manifest.epoch = 2;
      writeManifest(tmpDir, manifest);
      repo.refreshManifestEpoch();

      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['after-swap']);
    });

    it('treats legacy rows with null epoch_written as visible when a manifest is pinned', () => {
      const emb = makeEmbedding([1.0]);
      ({ dbPath, tmpDir } = createVisibilityDb([
        { id: 'legacy', file_path: 'a.js', embedding: emb, text: 'legacy', metadata: '{}', epoch_written: null, epoch_retired: null },
        { id: 'future', file_path: 'a.js', embedding: emb, text: 'future', metadata: '{}', epoch_written: 7, epoch_retired: null },
      ]));
      repo = new CodebaseRepository(dbPath, { manifestEpoch: 3 });

      expect([...repo.iterateVectors()].map((r) => r.id)).toEqual(['legacy']);
      expect(repo.getChunksByFilePath('a.js').map((r) => r.id)).toEqual(['legacy']);
    });
  });

  // -------------------------------------------------------------------------
  // close
  // -------------------------------------------------------------------------

  describe('close', () => {
    it('closes the persistent connection', () => {
      ({ dbPath, tmpDir } = createTestDb([]));
      repo = new CodebaseRepository(dbPath);
      [...repo.iterateVectors()]; // force open

      expect(repo._db !== null).toBe(true);
      repo.close();
      expect(repo._db !== null).toBe(false);
    });

    it('is safe to call multiple times', () => {
      ({ dbPath, tmpDir } = createTestDb([]));
      repo = new CodebaseRepository(dbPath);
      [...repo.iterateVectors()];

      repo.close();
      expect(() => repo.close()).not.toThrow();
    });

    it('is safe to call without ever opening', () => {
      ({ dbPath, tmpDir } = createTestDb([]));
      repo = new CodebaseRepository(dbPath);

      expect(() => repo.close()).not.toThrow();
    });

    it('allows reopening after close', () => {
      ({ dbPath, tmpDir } = createTestDb([
        { id: 'v1', file_path: 'a.js', text: 'hello' },
      ]));
      repo = new CodebaseRepository(dbPath);

      [...repo.iterateVectors()];
      repo.close();

      // Should reopen lazily
      const rows = [...repo.iterateVectors()];
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws when DB file does not exist (iterateVectors)', () => {
      repo = new CodebaseRepository('/nonexistent/path/codebase.db');

      expect(() => [...repo.iterateVectors()]).toThrow();
    });

    it('throws when DB file does not exist (scanAllVectors)', () => {
      repo = new CodebaseRepository('/nonexistent/path/codebase.db');

      expect(() => repo.scanAllVectors()).toThrow();
    });

    it('getChunkTexts returns empty Map on missing DB (swallowed)', () => {
      repo = new CodebaseRepository('/nonexistent/path/codebase.db');

      expect(repo.getChunkTexts(['v1']).size).toBe(0);
    });
  });
});
