/**
 * Tests for core/incremental-indexing/infrastructure/vector-delta-writer.mjs
 *
 * Plan § 7.2 + § 13 Phase 1:
 *   - diffChunks returns reuse vs encode vs retire buckets correctly.
 *   - applyDiff updates reused rows' hashes + epoch_written.
 *   - applyDiff tombstones retired rows by setting epoch_retired.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  annotateChunksForDelta,
  snapshotFileRows,
  diffChunks,
  applyDiff,
} from '../../core/incremental-indexing/infrastructure/vector-delta-writer.mjs';
import { migrateVectorsSchema } from '../../core/incremental-indexing/infrastructure/schema-migrations.mjs';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      embedding BLOB NOT NULL,
      text TEXT,
      metadata TEXT,
      session_id TEXT,
      tags TEXT,
      created_at TEXT
    )
  `);
  migrateVectorsSchema(db);
  return db;
}

function insertExistingRow(db, row) {
  db.prepare(`
    INSERT INTO vectors (
      id, file_path, embedding, text, metadata, session_id, tags, created_at,
      chunk_struct_id, chunk_text_hash, embedding_input_hash, li_input_hash,
      metadata_fingerprint, logical_chunk_id, epoch_written, epoch_retired
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.file_path, Buffer.alloc(4), row.text || '', '{}', 's', '[]', '2026',
    row.chunk_struct_id, row.chunk_text_hash, row.embedding_input_hash,
    row.li_input_hash, row.metadata_fingerprint, row.logical_chunk_id || row.chunk_struct_id,
    row.epoch_written ?? 1, row.epoch_retired ?? null,
  );
}

function symbolChunk(name, content, signature = `function ${name}() {`) {
  return {
    content,
    embedding_text: `${name}\n${content}`,
    li_greedy_text: `${name}\n${content}`,
    metadata: {
      chunk_type: 'function',
      symbol: name,
      signature,
      relative_path: 'src/a.js',
      language: 'javascript',
    },
  };
}

describe('vector-delta-writer / diffChunks', () => {
  it('treats every chunk as encode on an empty DB', () => {
    const db = makeDb();
    const chunks = [
      symbolChunk('foo', 'return 1'),
      symbolChunk('bar', 'return 2'),
    ];
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    const snap = snapshotFileRows(db, 'src/a.js');
    const diff = diffChunks(chunks, ann, snap);
    expect(diff.toEncode.length).toBe(2);
    expect(diff.toReuse.length).toBe(0);
    expect(diff.toRetire.length).toBe(0);
    expect(diff.counters.miss).toBe(2);
  });

  it('reuses rows whose embedding and LI hashes match', () => {
    const db = makeDb();
    const chunks = [symbolChunk('foo', 'return 1')];
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo', file_path: 'src/a.js',
      chunk_struct_id: ann[0].chunkStructId,
      chunk_text_hash: ann[0].hashes.chunk_text_hash,
      embedding_input_hash: ann[0].hashes.embedding_input_hash,
      li_input_hash: ann[0].hashes.li_input_hash,
      metadata_fingerprint: ann[0].hashes.metadata_fingerprint,
    });
    const snap = snapshotFileRows(db, 'src/a.js');
    const diff = diffChunks(chunks, ann, snap);
    expect(diff.toEncode.length).toBe(0);
    expect(diff.toReuse.length).toBe(1);
    expect(diff.toRetire.length).toBe(0);
    expect(diff.counters.hit).toBe(1);
  });

  it('re-encodes only the dense side when LI hash matches but dense differs', () => {
    const db = makeDb();
    const chunks = [symbolChunk('foo', 'return 1')];
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo', file_path: 'src/a.js',
      chunk_struct_id: ann[0].chunkStructId,
      chunk_text_hash: ann[0].hashes.chunk_text_hash,
      embedding_input_hash: 'STALE',
      li_input_hash: ann[0].hashes.li_input_hash,
      metadata_fingerprint: ann[0].hashes.metadata_fingerprint,
    });
    const snap = snapshotFileRows(db, 'src/a.js');
    const diff = diffChunks(chunks, ann, snap);
    expect(diff.toEncode.length).toBe(1);
    expect(diff.toEncode[0].denseNeeded).toBe(true);
    expect(diff.toEncode[0].liNeeded).toBe(false);
    expect(diff.toEncode[0].reason).toBe('dense-only');
  });

  it('marks rows for retire when no matching struct id appears in the new chunks', () => {
    const db = makeDb();
    const oldChunks = [symbolChunk('foo', 'return 1'), symbolChunk('bar', 'return 2')];
    const oldAnn = annotateChunksForDelta(oldChunks, 'src/a.js');
    for (let i = 0; i < oldChunks.length; i++) {
      insertExistingRow(db, {
        id: `row-${i}`, file_path: 'src/a.js',
        chunk_struct_id: oldAnn[i].chunkStructId,
        chunk_text_hash: oldAnn[i].hashes.chunk_text_hash,
        embedding_input_hash: oldAnn[i].hashes.embedding_input_hash,
        li_input_hash: oldAnn[i].hashes.li_input_hash,
        metadata_fingerprint: oldAnn[i].hashes.metadata_fingerprint,
      });
    }

    const newChunks = [symbolChunk('foo', 'return 1')]; // bar removed
    const newAnn = annotateChunksForDelta(newChunks, 'src/a.js');
    const snap = snapshotFileRows(db, 'src/a.js');
    const diff = diffChunks(newChunks, newAnn, snap);
    expect(diff.toReuse.length).toBe(1);
    expect(diff.toRetire.length).toBe(1);
    expect(diff.toRetire[0].chunkStructId).toBe(oldAnn[1].chunkStructId);
  });
});

describe('vector-delta-writer / applyDiff', () => {
  it('refreshes reused rows with the new column values + epoch_written', () => {
    const db = makeDb();
    const chunks = [symbolChunk('foo', 'return 1')];
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo', file_path: 'src/a.js',
      chunk_struct_id: ann[0].chunkStructId,
      chunk_text_hash: 'OLD',
      embedding_input_hash: ann[0].hashes.embedding_input_hash,
      li_input_hash: ann[0].hashes.li_input_hash,
      metadata_fingerprint: 'OLD',
      epoch_written: 1,
    });
    const snap = snapshotFileRows(db, 'src/a.js');
    const diff = diffChunks(chunks, ann, snap);
    // metadata fingerprint differs → metadata-only reuse path.
    expect(diff.toReuse.length).toBe(1);
    expect(diff.toReuse[0].metadataOnly).toBe(true);

    applyDiff(db, 'src/a.js', diff, /* epoch */ 7);
    const row = db.prepare('SELECT * FROM vectors WHERE id = ?').get('row-foo');
    expect(row.chunk_text_hash).toBe(ann[0].hashes.chunk_text_hash);
    expect(row.metadata_fingerprint).toBe(ann[0].hashes.metadata_fingerprint);
    expect(row.epoch_written).toBe(7);
    expect(row.epoch_retired).toBeNull();
  });

  it('tombstones retired rows with epoch_retired', () => {
    const db = makeDb();
    const oldChunks = [symbolChunk('foo', 'return 1')];
    const oldAnn = annotateChunksForDelta(oldChunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo', file_path: 'src/a.js',
      chunk_struct_id: oldAnn[0].chunkStructId,
      chunk_text_hash: oldAnn[0].hashes.chunk_text_hash,
      embedding_input_hash: oldAnn[0].hashes.embedding_input_hash,
      li_input_hash: oldAnn[0].hashes.li_input_hash,
      metadata_fingerprint: oldAnn[0].hashes.metadata_fingerprint,
    });
    const newAnn = annotateChunksForDelta([], 'src/a.js');
    const snap = snapshotFileRows(db, 'src/a.js');
    const diff = diffChunks([], newAnn, snap);
    expect(diff.toRetire.length).toBe(1);

    applyDiff(db, 'src/a.js', diff, /* epoch */ 9);
    const row = db.prepare('SELECT * FROM vectors WHERE id = ?').get('row-foo');
    expect(row.epoch_retired).toBe(9);
  });
});

describe('vector-delta-writer / reconcile-counters integration', () => {
  it('reports identical counter shape for unchanged vs touched files', () => {
    const db = makeDb();
    const chunks = [symbolChunk('foo', 'return 1'), symbolChunk('bar', 'return 2')];
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    // First reconcile: empty DB → 2 misses.
    let diff = diffChunks(chunks, ann, snapshotFileRows(db, 'src/a.js'));
    expect(diff.counters).toEqual({ hit: 0, miss: 2, retire: 0, metadata_dirty: 0 });

    // Materialise the rows.
    for (let i = 0; i < chunks.length; i++) {
      insertExistingRow(db, {
        id: `row-${i}`, file_path: 'src/a.js',
        chunk_struct_id: ann[i].chunkStructId,
        chunk_text_hash: ann[i].hashes.chunk_text_hash,
        embedding_input_hash: ann[i].hashes.embedding_input_hash,
        li_input_hash: ann[i].hashes.li_input_hash,
        metadata_fingerprint: ann[i].hashes.metadata_fingerprint,
      });
    }

    // Second reconcile, no chunk change → 2 reuse.
    diff = diffChunks(chunks, ann, snapshotFileRows(db, 'src/a.js'));
    expect(diff.counters).toEqual({ hit: 2, miss: 0, retire: 0, metadata_dirty: 0 });
  });
});
