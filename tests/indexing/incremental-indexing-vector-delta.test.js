/**
 * Tests for core/incremental-indexing/infrastructure/vector-delta-writer.mjs
 *
 * Plan § 7.2 + § 13 Phase 1:
 *   - diffChunks returns reuse vs encode vs retire buckets correctly.
 *   - applyDiff preserves MVCC visibility for reused rows.
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
import { epochVisibilityPredicate } from '../../core/incremental-indexing/infrastructure/manifest.mjs';

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
    row.id, row.file_path, Buffer.alloc(4), row.text || '', row.metadata || '{}', 's', '[]', '2026',
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

function bareChunk(content) {
  return {
    content,
    embedding_text: content,
    li_greedy_text: content,
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
    expect(diff.toEncode[0].prevRow.id).toBe('row-foo');
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
  it('versions metadata-only reuse without hiding the previous manifest row', () => {
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

    const summary = applyDiff(db, 'src/a.js', diff, /* epoch */ 7);
    expect(summary.versionedRows).toEqual([{
      oldId: 'row-foo',
      newId: 'row-foo@e7',
      chunkStructId: ann[0].chunkStructId,
    }]);
    const oldRow = db.prepare('SELECT * FROM vectors WHERE id = ?').get('row-foo');
    expect(oldRow.epoch_written).toBe(1);
    expect(oldRow.epoch_retired).toBe(7);

    const newRow = db.prepare('SELECT * FROM vectors WHERE id = ?').get('row-foo@e7');
    expect(newRow.chunk_text_hash).toBe(ann[0].hashes.chunk_text_hash);
    expect(newRow.metadata_fingerprint).toBe(ann[0].hashes.metadata_fingerprint);
    expect(newRow.epoch_written).toBe(7);
    expect(newRow.epoch_retired).toBeNull();

    const visibleAt6 = db.prepare(`SELECT id FROM vectors WHERE ${epochVisibilityPredicate()} ORDER BY id`)
      .all({ manifestEpoch: 6 });
    const visibleAt7 = db.prepare(`SELECT id FROM vectors WHERE ${epochVisibilityPredicate()} ORDER BY id`)
      .all({ manifestEpoch: 7 });
    expect(visibleAt6.map((r) => r.id)).toEqual(['row-foo']);
    expect(visibleAt7.map((r) => r.id)).toEqual(['row-foo@e7']);
  });

  it('versions text-only reuse so fresh chunk text is visible without re-encoding', () => {
    const db = makeDb();
    const chunks = [symbolChunk('foo', 'return 1')];
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo', file_path: 'src/a.js',
      chunk_struct_id: ann[0].chunkStructId,
      chunk_text_hash: 'OLD_TEXT_HASH',
      embedding_input_hash: ann[0].hashes.embedding_input_hash,
      li_input_hash: ann[0].hashes.li_input_hash,
      metadata_fingerprint: ann[0].hashes.metadata_fingerprint,
      epoch_written: 1,
    });

    const diff = diffChunks(chunks, ann, snapshotFileRows(db, 'src/a.js'));
    expect(diff.toEncode.length).toBe(0);
    expect(diff.toReuse).toHaveLength(1);
    expect(diff.toReuse[0].textOnly).toBe(true);
    expect(diff.toReuse[0].metadataOnly).toBe(false);

    const summary = applyDiff(db, 'src/a.js', diff, /* epoch */ 7);
    expect(summary.versionedRows).toEqual([{
      oldId: 'row-foo',
      newId: 'row-foo@e7',
      chunkStructId: ann[0].chunkStructId,
    }]);
    const oldRow = db.prepare('SELECT text, chunk_text_hash, epoch_retired FROM vectors WHERE id = ?').get('row-foo');
    const newRow = db.prepare('SELECT text, chunk_text_hash, epoch_written, epoch_retired FROM vectors WHERE id = ?').get('row-foo@e7');
    expect(oldRow.epoch_retired).toBe(7);
    expect(newRow.text).toBe('return 1');
    expect(newRow.chunk_text_hash).toBe(ann[0].hashes.chunk_text_hash);
    expect(newRow.epoch_written).toBe(7);
    expect(newRow.epoch_retired).toBeNull();
  });

  it('preserves stored metadata during text-only reuse when chunk metadata is absent', () => {
    const db = makeDb();
    const chunks = [bareChunk('return 1')];
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo',
      file_path: 'src/a.js',
      text: 'return 0',
      metadata: '{"keep":true}',
      chunk_struct_id: ann[0].chunkStructId,
      chunk_text_hash: 'OLD_TEXT_HASH',
      embedding_input_hash: ann[0].hashes.embedding_input_hash,
      li_input_hash: ann[0].hashes.li_input_hash,
      metadata_fingerprint: ann[0].hashes.metadata_fingerprint,
      epoch_written: 1,
    });

    const diff = diffChunks(chunks, ann, snapshotFileRows(db, 'src/a.js'));
    expect(diff.toReuse[0].textOnly).toBe(true);
    expect(diff.toReuse[0].metadataOnly).toBe(false);

    applyDiff(db, 'src/a.js', diff, 7);

    const newRow = db.prepare('SELECT text, metadata FROM vectors WHERE id = ?').get('row-foo@e7');
    expect(newRow.text).toBe('return 1');
    expect(newRow.metadata).toBe('{"keep":true}');
  });

  it('keeps the cold-index vector metadata shape when metadata-only reuse versions a row', () => {
    const db = makeDb();
    const chunks = [symbolChunk('foo', 'return 1')];
    chunks[0].file = 'src/a.js';
    chunks[0].metadata.line_start = 10;
    chunks[0].metadata.line_end = 12;
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo',
      file_path: 'src/a.js',
      metadata: JSON.stringify({
        file: 'src/a.js',
        type: 'function',
        name: 'foo',
        startLine: 1,
        endLine: 3,
        language: 'javascript',
        provider: 'local',
        dimension: 384,
        simhash: 'old-simhash',
        clusterId: 'old-cluster',
        exemplarId: 'old-exemplar',
        isExemplar: false,
      }),
      chunk_struct_id: ann[0].chunkStructId,
      chunk_text_hash: ann[0].hashes.chunk_text_hash,
      embedding_input_hash: ann[0].hashes.embedding_input_hash,
      li_input_hash: ann[0].hashes.li_input_hash,
      metadata_fingerprint: 'OLD_META',
      epoch_written: 1,
    });

    const diff = diffChunks(chunks, ann, snapshotFileRows(db, 'src/a.js'));
    expect(diff.toReuse[0].metadataOnly).toBe(true);

    applyDiff(db, 'src/a.js', diff, 7);

    const newRow = db.prepare('SELECT metadata FROM vectors WHERE id = ?').get('row-foo@e7');
    const metadata = JSON.parse(newRow.metadata);
    expect(metadata).toMatchObject({
      file: 'src/a.js',
      type: 'function',
      name: 'foo',
      startLine: 10,
      endLine: 12,
      language: 'javascript',
      provider: 'local',
      dimension: 384,
      simhash: 'old-simhash',
      clusterId: 'old-cluster',
      exemplarId: 'old-exemplar',
      isExemplar: false,
    });
    expect(metadata.line_start).toBeUndefined();
  });

  it('prefers canonical metadata paths over chunk.file when versioning metadata-only rows', () => {
    const db = makeDb();
    const chunks = [symbolChunk('foo', 'return 1')];
    chunks[0].file = 'a.js';
    delete chunks[0].metadata.relative_path;
    chunks[0].metadata.path = 'src/a.js';
    chunks[0].metadata.line_start = 20;
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo',
      file_path: 'src/a.js',
      metadata: JSON.stringify({
        file: 'src/a.js',
        type: 'function',
        name: 'foo',
        startLine: 1,
        endLine: 3,
        language: 'javascript',
      }),
      chunk_struct_id: ann[0].chunkStructId,
      chunk_text_hash: ann[0].hashes.chunk_text_hash,
      embedding_input_hash: ann[0].hashes.embedding_input_hash,
      li_input_hash: ann[0].hashes.li_input_hash,
      metadata_fingerprint: 'OLD_META',
      epoch_written: 1,
    });

    const diff = diffChunks(chunks, ann, snapshotFileRows(db, 'src/a.js'));
    expect(diff.toReuse[0].metadataOnly).toBe(true);

    applyDiff(db, 'src/a.js', diff, 7);

    const newRow = db.prepare('SELECT metadata FROM vectors WHERE id = ?').get('row-foo@e7');
    expect(JSON.parse(newRow.metadata).file).toBe('src/a.js');
  });

  it('ignores unsafe metadata paths when versioning metadata-only rows', () => {
    const db = makeDb();
    const chunks = [symbolChunk('foo', 'return 1')];
    chunks[0].file = 'a.js';
    delete chunks[0].metadata.relative_path;
    chunks[0].metadata.path = '../../../../private/var/tmp/project/src/a.js';
    chunks[0].metadata.line_start = 20;
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo',
      file_path: 'src/a.js',
      metadata: JSON.stringify({
        file: 'src/a.js',
        type: 'function',
        name: 'foo',
        startLine: 1,
        endLine: 3,
        language: 'javascript',
      }),
      chunk_struct_id: ann[0].chunkStructId,
      chunk_text_hash: ann[0].hashes.chunk_text_hash,
      embedding_input_hash: ann[0].hashes.embedding_input_hash,
      li_input_hash: ann[0].hashes.li_input_hash,
      metadata_fingerprint: 'OLD_META',
      epoch_written: 1,
    });

    const diff = diffChunks(chunks, ann, snapshotFileRows(db, 'src/a.js'));
    applyDiff(db, 'src/a.js', diff, 7);

    const newRow = db.prepare('SELECT metadata FROM vectors WHERE id = ?').get('row-foo@e7');
    expect(JSON.parse(newRow.metadata).file).toBe('src/a.js');
  });

  it('uses stored file_path as the safe fallback when applyDiff receives an unsafe path', () => {
    const db = makeDb();
    const chunks = [symbolChunk('foo', 'return 1')];
    chunks[0].file = '/private/var/tmp/project/src/a.js';
    delete chunks[0].metadata.relative_path;
    chunks[0].metadata.path = '/private/var/tmp/project/src/a.js';
    chunks[0].metadata.line_start = 20;
    const ann = annotateChunksForDelta(chunks, 'src/a.js');
    insertExistingRow(db, {
      id: 'row-foo',
      file_path: 'src/a.js',
      metadata: JSON.stringify({
        file: '/private/var/tmp/project/src/a.js',
        type: 'function',
        name: 'foo',
      }),
      chunk_struct_id: ann[0].chunkStructId,
      chunk_text_hash: ann[0].hashes.chunk_text_hash,
      embedding_input_hash: ann[0].hashes.embedding_input_hash,
      li_input_hash: ann[0].hashes.li_input_hash,
      metadata_fingerprint: 'OLD_META',
      epoch_written: 1,
    });

    const diff = diffChunks(chunks, ann, snapshotFileRows(db, 'src/a.js'));
    applyDiff(db, '/private/var/tmp/project/src/a.js', diff, 7);

    const newRow = db.prepare('SELECT file_path, metadata FROM vectors WHERE id = ?').get('row-foo@e7');
    expect(newRow.file_path).toBe('src/a.js');
    expect(JSON.parse(newRow.metadata).file).toBe('src/a.js');
  });

  it('leaves exact reuse rows untouched', () => {
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
      epoch_written: 1,
    });

    const diff = diffChunks(chunks, ann, snapshotFileRows(db, 'src/a.js'));
    expect(diff.toReuse.length).toBe(1);
    expect(diff.toReuse[0].metadataOnly).toBeUndefined();
    const summary = applyDiff(db, 'src/a.js', diff, /* epoch */ 7);
    expect(summary).toEqual({ versionedRows: [], replacedRows: [], retiredRows: [] });

    const rows = db.prepare('SELECT id, epoch_written, epoch_retired FROM vectors ORDER BY id').all();
    expect(rows).toEqual([{ id: 'row-foo', epoch_written: 1, epoch_retired: null }]);
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

    const summary = applyDiff(db, 'src/a.js', diff, /* epoch */ 9);
    expect(summary.retiredRows).toEqual([{
      oldId: 'row-foo',
      chunkStructId: oldAnn[0].chunkStructId,
    }]);
    const row = db.prepare('SELECT * FROM vectors WHERE id = ?').get('row-foo');
    expect(row.epoch_retired).toBe(9);
  });

  it('tombstones replaced rows when the same structural chunk must be re-encoded', () => {
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
      epoch_written: 1,
    });

    const newChunks = [symbolChunk('foo', 'return 2')];
    const newAnn = annotateChunksForDelta(newChunks, 'src/a.js');
    expect(newAnn[0].chunkStructId).toBe(oldAnn[0].chunkStructId);
    const diff = diffChunks(newChunks, newAnn, snapshotFileRows(db, 'src/a.js'));
    expect(diff.toEncode.length).toBe(1);
    expect(diff.toEncode[0].reason).toBe('both');
    expect(diff.toEncode[0].prevRow.id).toBe('row-foo');

    const summary = applyDiff(db, 'src/a.js', diff, /* epoch */ 4);
    expect(summary.replacedRows).toEqual([{
      oldId: 'row-foo',
      chunkStructId: oldAnn[0].chunkStructId,
    }]);
    const oldRow = db.prepare('SELECT epoch_retired FROM vectors WHERE id = ?').get('row-foo');
    expect(oldRow.epoch_retired).toBe(4);
  });

  it('snapshotFileRows prefers the latest live row version for a structural id', () => {
    const db = makeDb();
    insertExistingRow(db, {
      id: 'row-old', file_path: 'src/a.js',
      chunk_struct_id: 'sid',
      chunk_text_hash: 'old',
      embedding_input_hash: 'dense-old',
      li_input_hash: 'li-old',
      metadata_fingerprint: 'meta-old',
      epoch_written: 1,
      epoch_retired: 7,
    });
    insertExistingRow(db, {
      id: 'row-new', file_path: 'src/a.js',
      chunk_struct_id: 'sid',
      chunk_text_hash: 'new',
      embedding_input_hash: 'dense-new',
      li_input_hash: 'li-new',
      metadata_fingerprint: 'meta-new',
      epoch_written: 7,
      epoch_retired: null,
    });

    const snap = snapshotFileRows(db, 'src/a.js');
    expect(snap.get('sid').id).toBe('row-new');
    expect(snap.get('sid').embedding_input_hash).toBe('dense-new');
  });

  it('snapshotFileRows can pin to the manifest-visible row after an unpublished future write', () => {
    const db = makeDb();
    insertExistingRow(db, {
      id: 'row-old', file_path: 'src/a.js',
      chunk_struct_id: 'sid',
      chunk_text_hash: 'old',
      embedding_input_hash: 'dense-old',
      li_input_hash: 'li-old',
      metadata_fingerprint: 'meta-old',
      epoch_written: 1,
      epoch_retired: 7,
    });
    insertExistingRow(db, {
      id: 'row-future', file_path: 'src/a.js',
      chunk_struct_id: 'sid',
      chunk_text_hash: 'future',
      embedding_input_hash: 'dense-future',
      li_input_hash: 'li-future',
      metadata_fingerprint: 'meta-future',
      epoch_written: 7,
      epoch_retired: null,
    });

    const current = snapshotFileRows(db, 'src/a.js');
    expect(current.get('sid').id).toBe('row-future');

    const pinned = snapshotFileRows(db, 'src/a.js', { manifestEpoch: 6 });
    expect(pinned.get('sid').id).toBe('row-old');
    expect(pinned.get('sid').embedding_input_hash).toBe('dense-old');
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
