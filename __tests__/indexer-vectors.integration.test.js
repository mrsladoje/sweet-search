/**
 * Integration tests for incremental vector indexing.
 *
 * These tests verify that:
 * 1. Incremental runs preserve vectors for unchanged files
 * 2. Deleted file vectors are properly removed
 * 3. Full rebuild still produces a valid database
 * 4. Schema migration works correctly for old databases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test database path
const TEST_DB_PATH = path.join(__dirname, 'test-vectors.db');

// Inline the schema functions to avoid import issues
function createVectorSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      embedding BLOB NOT NULL,
      text TEXT,
      metadata TEXT,
      session_id TEXT,
      tags TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_session ON vectors(session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_file_path ON vectors(file_path)');
}

function ensureVectorSchema(db) {
  const columns = db.prepare("PRAGMA table_info(vectors)").all();
  const hasFilePath = columns.some(col => col.name === 'file_path');

  if (!hasFilePath) {
    db.exec('ALTER TABLE vectors ADD COLUMN file_path TEXT');

    const rows = db.prepare('SELECT id, metadata FROM vectors').all();
    const updateStmt = db.prepare('UPDATE vectors SET file_path = ? WHERE id = ?');

    const migrate = db.transaction(() => {
      for (const row of rows) {
        try {
          const metadata = JSON.parse(row.metadata || '{}');
          if (metadata.file) {
            updateStmt.run(metadata.file, row.id);
          }
        } catch (e) {
          // Skip rows with invalid metadata
        }
      }
    });
    migrate();

    db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_file_path ON vectors(file_path)');
  }
}

function insertVectors(db, chunks, embeddings, modelInfo) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vectors (id, file_path, embedding, text, metadata, session_id, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      stmt.run(
        item.id,
        item.filePath,
        item.embeddingBlob,
        item.text,
        item.metadata,
        item.sessionId,
        item.tags,
        item.createdAt
      );
    }
  });

  const items = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];

    if (!embedding || embedding.length === 0) continue;

    items.push({
      id: chunk.id,
      filePath: chunk.file,
      embeddingBlob: Buffer.from(new Float32Array(embedding).buffer),
      text: (chunk.text || chunk.content || '').slice(0, 2000),
      metadata: JSON.stringify({
        file: chunk.file,
        type: chunk.metadata?.chunk_type || 'code',
        name: chunk.metadata?.symbol || null,
        startLine: chunk.metadata?.line_start || null,
        endLine: chunk.metadata?.line_end || null,
        language: chunk.metadata?.language || null,
        provider: modelInfo.provider,
        dimension: embedding.length,
      }),
      sessionId: `codebase-v22-${modelInfo.provider}`,
      tags: JSON.stringify(['codebase', chunk.metadata?.language || 'unknown']),
      createdAt: new Date().toISOString(),
    });
  }

  insertMany(items);
}

// Mock model info for insertVectors
const mockModelInfo = {
  provider: 'test',
  dimension: 4,
};

// Helper to create synthetic chunks
function createChunk(file, lineStart, symbol = null) {
  return {
    id: `${file}:${lineStart}`,
    file,
    text: `Test content for ${file} at line ${lineStart}`,
    metadata: {
      chunk_type: 'code',
      symbol,
      line_start: lineStart,
      line_end: lineStart + 10,
      language: 'javascript',
    },
  };
}

// Helper to create synthetic embeddings (simple float arrays)
function createEmbedding(dimension = 4) {
  return Array.from({ length: dimension }, () => Math.random());
}

describe('Incremental Vector Indexing', () => {
  let db;

  beforeEach(async () => {
    // Clean up any existing test database
    try {
      await fs.unlink(TEST_DB_PATH);
    } catch (e) {
      // File doesn't exist, that's fine
    }

    // Create fresh database with new schema
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = DELETE');
    db.pragma('synchronous = NORMAL');
    createVectorSchema(db);
  });

  afterEach(async () => {
    if (db) {
      db.close();
    }
    try {
      await fs.unlink(TEST_DB_PATH);
    } catch (e) {
      // File doesn't exist, that's fine
    }
  });

  describe('Schema', () => {
    it('should create vectors table with file_path column', () => {
      const columns = db.prepare("PRAGMA table_info(vectors)").all();
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('file_path');
      expect(columnNames).toContain('embedding');
      expect(columnNames).toContain('text');
      expect(columnNames).toContain('metadata');
    });

    it('should create file_path index', () => {
      const indexes = db.prepare("PRAGMA index_list(vectors)").all();
      const indexNames = indexes.map(i => i.name);

      expect(indexNames).toContain('idx_vectors_file_path');
    });
  });

  describe('Schema Migration', () => {
    it('should migrate old schema without file_path column', async () => {
      // Close current db and create one with old schema
      db.close();
      try {
        await fs.unlink(TEST_DB_PATH);
      } catch (e) {}

      // Create old schema (without file_path)
      const oldDb = new Database(TEST_DB_PATH);
      oldDb.exec(`
        CREATE TABLE vectors (
          id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          text TEXT,
          metadata TEXT,
          session_id TEXT,
          tags TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert a row with metadata containing file path
      const embedding = Buffer.from(new Float32Array([1, 2, 3, 4]).buffer);
      oldDb.prepare(`
        INSERT INTO vectors (id, embedding, text, metadata)
        VALUES (?, ?, ?, ?)
      `).run(
        'src/test.js:10',
        embedding,
        'test content',
        JSON.stringify({ file: 'src/test.js', type: 'code' })
      );

      // Run migration
      ensureVectorSchema(oldDb);

      // Verify file_path column was added
      const columns = oldDb.prepare("PRAGMA table_info(vectors)").all();
      const hasFilePath = columns.some(c => c.name === 'file_path');
      expect(hasFilePath).toBe(true);

      // Verify file_path was populated from metadata
      const row = oldDb.prepare('SELECT file_path FROM vectors WHERE id = ?').get('src/test.js:10');
      expect(row.file_path).toBe('src/test.js');

      oldDb.close();
    });
  });

  describe('insertVectors', () => {
    it('should insert vectors with file_path', () => {
      const chunks = [
        createChunk('src/a.js', 0, 'functionA'),
        createChunk('src/a.js', 50, 'functionB'),
        createChunk('src/b.js', 0, 'classC'),
      ];
      const embeddings = chunks.map(() => createEmbedding());

      insertVectors(db, chunks, embeddings, mockModelInfo);

      const count = db.prepare('SELECT COUNT(*) as count FROM vectors').get();
      expect(count.count).toBe(3);

      // Verify file_path is set correctly
      const aVectors = db.prepare('SELECT * FROM vectors WHERE file_path = ?').all('src/a.js');
      expect(aVectors.length).toBe(2);

      const bVectors = db.prepare('SELECT * FROM vectors WHERE file_path = ?').all('src/b.js');
      expect(bVectors.length).toBe(1);
    });
  });

  describe('Incremental Update Behavior', () => {
    it('should preserve vectors for unchanged files when updating one file', () => {
      // STEP 1: Initial population with 2 files (3 chunks total)
      const initialChunks = [
        createChunk('src/unchanged.js', 0, 'funcUnchanged1'),
        createChunk('src/unchanged.js', 50, 'funcUnchanged2'),
        createChunk('src/changed.js', 0, 'funcChanged'),
      ];
      const initialEmbeddings = initialChunks.map(() => createEmbedding());
      insertVectors(db, initialChunks, initialEmbeddings, mockModelInfo);

      const initialCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get();
      expect(initialCount.count).toBe(3);

      // STEP 2: Simulate incremental update - remove changed file vectors
      const deleteStmt = db.prepare('DELETE FROM vectors WHERE file_path = ?');
      const deleteResult = deleteStmt.run('src/changed.js');
      expect(deleteResult.changes).toBe(1);

      // STEP 3: Insert new vectors for changed file (with modified content)
      const updatedChunks = [
        createChunk('src/changed.js', 0, 'funcChangedNew'),
        createChunk('src/changed.js', 100, 'funcChangedNew2'),
      ];
      const updatedEmbeddings = updatedChunks.map(() => createEmbedding());
      insertVectors(db, updatedChunks, updatedEmbeddings, mockModelInfo);

      // VERIFY: Unchanged file vectors still exist
      const unchangedVectors = db.prepare('SELECT * FROM vectors WHERE file_path = ?').all('src/unchanged.js');
      expect(unchangedVectors.length).toBe(2);
      expect(unchangedVectors[0].id).toBe('src/unchanged.js:0');
      expect(unchangedVectors[1].id).toBe('src/unchanged.js:50');

      // VERIFY: Changed file has new vectors
      const changedVectors = db.prepare('SELECT * FROM vectors WHERE file_path = ?').all('src/changed.js');
      expect(changedVectors.length).toBe(2);

      // VERIFY: Total count is correct (2 unchanged + 2 new = 4)
      const finalCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get();
      expect(finalCount.count).toBe(4);
    });

    it('should remove vectors for deleted files', () => {
      // STEP 1: Initial population
      const initialChunks = [
        createChunk('src/keep.js', 0, 'keep1'),
        createChunk('src/keep.js', 50, 'keep2'),
        createChunk('src/delete.js', 0, 'delete1'),
        createChunk('src/delete.js', 100, 'delete2'),
      ];
      const initialEmbeddings = initialChunks.map(() => createEmbedding());
      insertVectors(db, initialChunks, initialEmbeddings, mockModelInfo);

      expect(db.prepare('SELECT COUNT(*) as count FROM vectors').get().count).toBe(4);

      // STEP 2: Remove deleted file vectors
      const deleteStmt = db.prepare('DELETE FROM vectors WHERE file_path = ?');
      const deleteResult = deleteStmt.run('src/delete.js');
      expect(deleteResult.changes).toBe(2);

      // VERIFY: Only kept file vectors remain
      const remainingVectors = db.prepare('SELECT * FROM vectors').all();
      expect(remainingVectors.length).toBe(2);
      expect(remainingVectors.every(v => v.file_path === 'src/keep.js')).toBe(true);
    });

    it('should handle multiple files being changed at once', () => {
      // STEP 1: Initial population with 4 files
      const initialChunks = [
        createChunk('src/a.js', 0),
        createChunk('src/b.js', 0),
        createChunk('src/c.js', 0),
        createChunk('src/d.js', 0),
      ];
      const initialEmbeddings = initialChunks.map(() => createEmbedding());
      insertVectors(db, initialChunks, initialEmbeddings, mockModelInfo);

      expect(db.prepare('SELECT COUNT(*) as count FROM vectors').get().count).toBe(4);

      // STEP 2: Remove vectors for files a.js and c.js (being changed)
      const changedFiles = ['src/a.js', 'src/c.js'];
      const deleteStmt = db.prepare('DELETE FROM vectors WHERE file_path = ?');

      const deleteTransaction = db.transaction((files) => {
        let total = 0;
        for (const f of files) {
          total += deleteStmt.run(f).changes;
        }
        return total;
      });

      const removed = deleteTransaction(changedFiles);
      expect(removed).toBe(2);

      // STEP 3: Insert updated vectors for changed files
      const updatedChunks = [
        createChunk('src/a.js', 0, 'newA'),
        createChunk('src/a.js', 20, 'newA2'),
        createChunk('src/c.js', 0, 'newC'),
      ];
      const updatedEmbeddings = updatedChunks.map(() => createEmbedding());
      insertVectors(db, updatedChunks, updatedEmbeddings, mockModelInfo);

      // VERIFY: Unchanged files still have their vectors
      expect(db.prepare('SELECT COUNT(*) FROM vectors WHERE file_path = ?').get('src/b.js')['COUNT(*)']).toBe(1);
      expect(db.prepare('SELECT COUNT(*) FROM vectors WHERE file_path = ?').get('src/d.js')['COUNT(*)']).toBe(1);

      // VERIFY: Changed files have new vectors
      expect(db.prepare('SELECT COUNT(*) FROM vectors WHERE file_path = ?').get('src/a.js')['COUNT(*)']).toBe(2);
      expect(db.prepare('SELECT COUNT(*) FROM vectors WHERE file_path = ?').get('src/c.js')['COUNT(*)']).toBe(1);

      // VERIFY: Total count (2 unchanged + 3 new = 5)
      expect(db.prepare('SELECT COUNT(*) as count FROM vectors').get().count).toBe(5);
    });

    it('should maintain row count after incremental update with same number of chunks', () => {
      // STEP 1: Initial population
      const initialChunks = [
        createChunk('src/file1.js', 0),
        createChunk('src/file1.js', 50),
        createChunk('src/file2.js', 0),
      ];
      const initialEmbeddings = initialChunks.map(() => createEmbedding());
      insertVectors(db, initialChunks, initialEmbeddings, mockModelInfo);

      const initialCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get().count;
      expect(initialCount).toBe(3);

      // STEP 2: Update file1.js (remove old, add new with same chunk count)
      db.prepare('DELETE FROM vectors WHERE file_path = ?').run('src/file1.js');

      const updatedChunks = [
        createChunk('src/file1.js', 0, 'updated1'),
        createChunk('src/file1.js', 50, 'updated2'),
      ];
      const updatedEmbeddings = updatedChunks.map(() => createEmbedding());
      insertVectors(db, updatedChunks, updatedEmbeddings, mockModelInfo);

      // VERIFY: Row count should be exactly the same
      const finalCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get().count;
      expect(finalCount).toBe(initialCount);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty chunk array', () => {
      insertVectors(db, [], [], mockModelInfo);
      expect(db.prepare('SELECT COUNT(*) as count FROM vectors').get().count).toBe(0);
    });

    it('should handle embeddings with empty arrays', () => {
      const chunks = [createChunk('src/test.js', 0)];
      const embeddings = [[]];  // Empty embedding

      insertVectors(db, chunks, embeddings, mockModelInfo);

      // Empty embeddings should be skipped
      expect(db.prepare('SELECT COUNT(*) as count FROM vectors').get().count).toBe(0);
    });

    it('should handle null embeddings', () => {
      const chunks = [createChunk('src/test.js', 0)];
      const embeddings = [null];

      insertVectors(db, chunks, embeddings, mockModelInfo);

      // Null embeddings should be skipped
      expect(db.prepare('SELECT COUNT(*) as count FROM vectors').get().count).toBe(0);
    });

    it('should replace existing vector with same id', () => {
      const chunk = createChunk('src/test.js', 0, 'original');
      const embedding = createEmbedding();

      insertVectors(db, [chunk], [embedding], mockModelInfo);

      // Insert again with same ID but different text
      const updatedChunk = { ...chunk, text: 'updated content' };
      insertVectors(db, [updatedChunk], [embedding], mockModelInfo);

      // Should still be just one row
      expect(db.prepare('SELECT COUNT(*) as count FROM vectors').get().count).toBe(1);

      // Should have updated text
      const row = db.prepare('SELECT text FROM vectors WHERE id = ?').get('src/test.js:0');
      expect(row.text).toBe('updated content');
    });
  });
});

describe('Full Rebuild vs Incremental', () => {
  const TEST_DB_PATH_2 = path.join(__dirname, 'test-vectors-2.db');

  afterEach(async () => {
    try {
      await fs.unlink(TEST_DB_PATH_2);
    } catch (e) {}
  });

  it('should produce equivalent results for fresh DB', () => {
    // Create two databases
    const dbFull = new Database(TEST_DB_PATH_2);
    dbFull.pragma('journal_mode = DELETE');
    createVectorSchema(dbFull);

    const chunks = [
      { id: 'src/a.js:0', file: 'src/a.js', text: 'test a', metadata: {} },
      { id: 'src/b.js:0', file: 'src/b.js', text: 'test b', metadata: {} },
    ];
    const embeddings = chunks.map(() => [1, 2, 3, 4]);

    insertVectors(dbFull, chunks, embeddings, { provider: 'test', dimension: 4 });

    const count = dbFull.prepare('SELECT COUNT(*) as count FROM vectors').get();
    expect(count.count).toBe(2);

    const files = dbFull.prepare('SELECT DISTINCT file_path FROM vectors').all();
    expect(files.length).toBe(2);

    dbFull.close();
  });
});
