/**
 * Phase 1 verification tests for the encode-skip CPU-saving claim.
 *
 * Plan § 13 Phase 1 "Verify on:":
 *   - "format file" no-op edit → 100 % chunks_text_unchanged
 *   - "insert function at top of file" → all other chunks
 *     chunks_struct_stable; only one chunks_encoded
 *   - "rename function" → only the renamed function's chunk encoded
 *
 * The Phase 2 reconciler will execute the actual encoder call. Phase 1
 * supplies the diff machinery; this test verifies that the diff produces
 * the right reuse / encode split for each scenario, which is the
 * load-bearing input to the encoder budget.
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
import { ReconcileCounters } from '../../core/incremental-indexing/domain/reconcile-counters.mjs';

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

function symbolChunk(name, content, signature = `function ${name}() {`) {
  return {
    content,
    embedding_text: `${name}\n${content}`,
    li_greedy_text: `${name}\n${content}`,
    metadata: {
      chunk_type: 'function',
      symbol: name,
      signature,
      relative_path: 'src/file.js',
      language: 'javascript',
    },
  };
}

function anonymousChunk(parent, content) {
  return {
    content,
    embedding_text: content,
    li_greedy_text: content,
    metadata: {
      chunk_type: 'code',
      parent_symbol: parent,
      relative_path: 'src/file.js',
      language: 'javascript',
    },
  };
}

function materialise(db, chunks, annotations, epoch = 1) {
  for (let i = 0; i < chunks.length; i++) {
    const ann = annotations[i];
    db.prepare(`
      INSERT INTO vectors (
        id, file_path, embedding, text, metadata, session_id, tags, created_at,
        chunk_struct_id, chunk_text_hash, embedding_input_hash, li_input_hash,
        metadata_fingerprint, logical_chunk_id, epoch_written, epoch_retired
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `row-${i}-${ann.chunkStructId}`,
      'src/file.js', Buffer.alloc(4), chunks[i].content || '', '{}', 's', '[]', '2026',
      ann.chunkStructId,
      ann.hashes.chunk_text_hash,
      ann.hashes.embedding_input_hash,
      ann.hashes.li_input_hash,
      ann.hashes.metadata_fingerprint,
      ann.chunkStructId,
      epoch,
      null,
    );
  }
}

describe('Phase 1 encode-skip verification', () => {
  let db;
  beforeEach(() => {
    db = makeDb();
  });

  it('format-only edit → 100 % reuse, zero encodes', () => {
    const chunks = [
      symbolChunk('foo', 'return 1;'),
      symbolChunk('bar', 'return 2;'),
      anonymousChunk('main', 'console.log(1);'),
    ];
    const ann1 = annotateChunksForDelta(chunks, 'src/file.js');
    materialise(db, chunks, ann1);

    // Same content, different surface whitespace
    const formatted = chunks.map((c) => ({
      ...c,
      content: c.content + ' ',
      embedding_text: c.embedding_text, // graph enrichment produces same text
    }));
    const ann2 = annotateChunksForDelta(formatted, 'src/file.js');
    const snap = snapshotFileRows(db, 'src/file.js');
    const diff = diffChunks(formatted, ann2, snap);

    expect(diff.counters.hit).toBe(3);
    expect(diff.counters.miss).toBe(0);
    expect(diff.counters.retire).toBe(0);
    expect(diff.toEncode.length).toBe(0);
  });

  it('insert function at top → 1 encode + N-1 reuse', () => {
    const initial = [
      symbolChunk('foo', 'return 1;'),
      symbolChunk('bar', 'return 2;'),
      symbolChunk('baz', 'return 3;'),
      anonymousChunk('main', 'console.log(1);'),
    ];
    const ann1 = annotateChunksForDelta(initial, 'src/file.js');
    materialise(db, initial, ann1);

    const edited = [
      symbolChunk('NEW_FN', 'return -1;'), // inserted at top
      ...initial,
    ];
    const ann2 = annotateChunksForDelta(edited, 'src/file.js');
    const snap = snapshotFileRows(db, 'src/file.js');
    const diff = diffChunks(edited, ann2, snap);

    expect(diff.toEncode.length).toBe(1);
    expect(diff.toEncode[0].chunk.metadata.symbol).toBe('NEW_FN');
    expect(diff.toReuse.length).toBe(4);
    expect(diff.toRetire.length).toBe(0);
  });

  it('rename function → 1 encode, all siblings stable', () => {
    const initial = [
      symbolChunk('foo', 'return 1;'),
      symbolChunk('bar', 'return 2;'),
      anonymousChunk('main', 'console.log(1);'),
    ];
    const ann1 = annotateChunksForDelta(initial, 'src/file.js');
    materialise(db, initial, ann1);

    const renamed = [
      symbolChunk('fooRenamed', 'return 1;', 'function fooRenamed() {'),
      symbolChunk('bar', 'return 2;'),
      anonymousChunk('main', 'console.log(1);'),
    ];
    const ann2 = annotateChunksForDelta(renamed, 'src/file.js');
    const snap = snapshotFileRows(db, 'src/file.js');
    const diff = diffChunks(renamed, ann2, snap);

    expect(diff.toEncode.length).toBe(1);
    expect(diff.toEncode[0].chunk.metadata.symbol).toBe('fooRenamed');
    expect(diff.toReuse.length).toBe(2);
    expect(diff.toRetire.length).toBe(1); // the old `foo` row gets tombstoned
  });

  it('delete function → tombstones the orphan, leaves siblings reused', () => {
    const initial = [
      symbolChunk('foo', 'return 1;'),
      symbolChunk('bar', 'return 2;'),
      symbolChunk('baz', 'return 3;'),
    ];
    const ann1 = annotateChunksForDelta(initial, 'src/file.js');
    materialise(db, initial, ann1, /* epoch */ 1);

    const trimmed = [
      symbolChunk('foo', 'return 1;'),
      symbolChunk('baz', 'return 3;'),
    ];
    const ann2 = annotateChunksForDelta(trimmed, 'src/file.js');
    const snap = snapshotFileRows(db, 'src/file.js');
    const diff = diffChunks(trimmed, ann2, snap);
    applyDiff(db, 'src/file.js', diff, /* epoch */ 2);

    expect(diff.toReuse.length).toBe(2);
    expect(diff.toRetire.length).toBe(1);

    // Verify the tombstone landed at epoch 2
    const orphan = db.prepare(
      'SELECT epoch_retired FROM vectors WHERE chunk_struct_id = ?',
    ).get(ann1[1].chunkStructId);
    expect(orphan.epoch_retired).toBe(2);
  });

  it('reconcile counters reflect a clean tick across the four scenarios', () => {
    const counters = new ReconcileCounters();
    counters.set('epoch', 17);
    counters.inc('files_processed', 1);

    // Pretend we just did the "rename function" case.
    counters.inc('chunks_total', 3);
    counters.inc('chunks_encoded', 1);
    counters.inc('chunks_hash_reused', 2);
    counters.inc('chunks_struct_stable', 2);
    counters.inc('ops_per_tier.vectors_upsert', 1);
    counters.inc('ops_per_tier.vectors_delete', 1);

    const snap = counters.snapshot();
    expect(snap.epoch).toBe(17);
    expect(snap.chunks_encoded).toBe(1);
    expect(snap.chunks_hash_reused).toBe(2);
    expect(snap.chunks_struct_stable).toBe(2);
    expect(snap.ops_per_tier.vectors_upsert).toBe(1);
    expect(snap.ops_per_tier.vectors_delete).toBe(1);
  });
});
