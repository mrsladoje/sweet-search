/**
 * Structural invariance test (plan § 12.3).
 *
 * "A new CI gate: a deterministic reindex test that proves the reconcile
 *  output equals the cold-rebuild output for unchanged files.
 *  1. cold-build index on fixture corpus
 *  2. snapshot file-level hashes of every per-tier artifact row for every file
 *  3. edit one file
 *  4. run reconcile
 *  5. assert: every OTHER file's per-tier rows hash-equal step 2"
 *
 * This is the load-bearing structural test. It catches phantom invalidation,
 * ghost re-encoding, and the kind of silent breakage that an MRR test would
 * miss until the next probe pass.
 *
 * We exercise the actual production code paths (annotateChunksForDelta,
 * snapshotFileRows, diffChunks, applyDiff, manifest publish, encoder-deps
 * persistence) against a real SQLite database. No mocks of the diff layer —
 * the only mocked piece is the chunker (we supply pre-built chunks) and the
 * encoder (we supply pre-built embeddings so we can verify exact-byte reuse).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  annotateChunksForDelta,
  snapshotFileRows,
  diffChunks,
  applyDiff,
} from '../../core/incremental-indexing/infrastructure/vector-delta-writer.mjs';
import {
  migrateVectorsSchema,
  migrateEntitiesSchema,
  migrateRelationshipsSchema,
  ensureEncoderDepsSchema,
} from '../../core/incremental-indexing/infrastructure/schema-migrations.mjs';
import {
  collectChunkDependencies,
  persistDependencies,
  dependentsOf,
  forgetFile,
} from '../../core/incremental-indexing/domain/encoder-deps.mjs';
import { Reconciler } from '../../core/incremental-indexing/application/reconciler.mjs';
import { readManifest, epochVisibilityPredicate } from '../../core/incremental-indexing/infrastructure/manifest.mjs';

// ----- Helpers ---------------------------------------------------------

function makeVectorsDb() {
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

function makeCodeGraphDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      signature_hash TEXT,
      start_line INTEGER,
      end_line INTEGER,
      stale_since INTEGER
    );
    CREATE TABLE relationships (
      id TEXT PRIMARY KEY,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT,
      target_name TEXT,
      relationship_type TEXT NOT NULL,
      file_path TEXT
    );
  `);
  migrateEntitiesSchema(db);
  migrateRelationshipsSchema(db);
  ensureEncoderDepsSchema(db);
  return db;
}

let _embeddingCounter = 0;
function fakeEmbedding(text) {
  // Deterministic embedding bytes derived from text so re-encoding the
  // SAME bytes produces identical buffers; we use sha256 truncate to make
  // a 32-byte mock embedding. The counter increments only when the
  // encoder is "called" — exposed for the test to count encode invocations.
  _embeddingCounter += 1;
  return Buffer.from(crypto.createHash('sha256').update(text).digest()).subarray(0, 32);
}

function resetEncodeCounter() {
  _embeddingCounter = 0;
}

function getEncodeCount() {
  return _embeddingCounter;
}

function makeSymbolChunk(filePath, name, body, opts = {}) {
  return {
    content: body,
    embedding_text: opts.embedding_text ?? `${filePath} ${name}\n${body}`,
    li_text: opts.li_text ?? `${name}\n${body}`,
    li_greedy_text: opts.li_greedy_text ?? `${filePath}\n${name}\n${body}`,
    metadata: {
      chunk_type: opts.chunk_type ?? 'function',
      symbol: name,
      signature: opts.signature ?? `function ${name}() {`,
      relative_path: filePath,
      language: opts.language ?? 'javascript',
      parent_symbol: opts.parent_symbol,
      parent_type: opts.parent_type,
    },
  };
}

function makeAnonymousChunk(filePath, parent, body) {
  return {
    content: body,
    embedding_text: body,
    li_text: body,
    li_greedy_text: body,
    metadata: {
      chunk_type: 'code',
      parent_symbol: parent,
      relative_path: filePath,
      language: 'javascript',
    },
  };
}

/**
 * Cold-index a fixture corpus. Writes vectors + graph rows + encoder
 * dependencies, returning a per-file snapshot the test can compare to
 * after the reconcile.
 */
function coldIndex(vectorsDb, graphDb, corpus, epoch = 1) {
  const fileSnapshots = new Map();
  for (const [filePath, chunks] of Object.entries(corpus)) {
    const ann = annotateChunksForDelta(chunks, filePath);
    const chunkSnap = [];
    for (let i = 0; i < chunks.length; i++) {
      const a = ann[i];
      const embeddingText = chunks[i].embedding_text || chunks[i].content;
      const embedding = fakeEmbedding(embeddingText);
      const id = `cold-${filePath}-${i}-${a.chunkStructId}`;
      vectorsDb.prepare(`
        INSERT INTO vectors (
          id, file_path, embedding, text, metadata, session_id, tags, created_at,
          chunk_struct_id, chunk_text_hash, embedding_input_hash, li_input_hash,
          metadata_fingerprint, logical_chunk_id, epoch_written, epoch_retired
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, filePath, embedding, chunks[i].content, JSON.stringify(chunks[i].metadata),
        'session-1', '[]', '2026-01-01',
        a.chunkStructId, a.hashes.chunk_text_hash, a.hashes.embedding_input_hash,
        a.hashes.li_input_hash, a.hashes.metadata_fingerprint, a.chunkStructId,
        epoch, null,
      );
      const deps = collectChunkDependencies(chunks[i]);
      persistDependencies(graphDb, filePath, a.chunkStructId, deps);
      chunkSnap.push({
        id, chunkStructId: a.chunkStructId,
        chunkTextHash: a.hashes.chunk_text_hash,
        embeddingInputHash: a.hashes.embedding_input_hash,
        liInputHash: a.hashes.li_input_hash,
        metadataFingerprint: a.hashes.metadata_fingerprint,
        embeddingBytes: embedding.toString('hex'),
        epochWritten: epoch,
        epochRetired: null,
      });

      // Also write a graph entity so the structural invariance assertion
      // can verify the graph stays stable.
      const entityId = crypto.createHash('sha256')
        .update(`${filePath}:${chunks[i].metadata.chunk_type}:${chunks[i].metadata.symbol || 'anon-' + i}`)
        .digest('hex').slice(0, 16);
      const sigHash = a.hashes.metadata_fingerprint.slice(0, 16);
      graphDb.prepare(`
        INSERT INTO entities (
          id, file_path, type, name, signature_hash, start_line, end_line, stale_since,
          logical_entity_id, epoch_written, epoch_retired
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entityId, filePath, chunks[i].metadata.chunk_type,
        chunks[i].metadata.symbol || `anon-${i}`,
        sigHash, 1, 10, null,
        entityId, epoch, null,
      );
    }
    fileSnapshots.set(filePath, chunkSnap);
  }
  return fileSnapshots;
}

function graphRowsForFile(graphDb, filePath) {
  return graphDb.prepare(`
    SELECT id, file_path, type, name, signature_hash, logical_entity_id,
           epoch_written, epoch_retired
    FROM entities
    WHERE file_path = ?
    ORDER BY id
  `).all(filePath);
}

function dependencyRowsForFile(graphDb, filePath) {
  return graphDb.prepare(`
    SELECT dependency_key, file_path, chunk_struct_id, consumer
    FROM encoder_input_dependencies
    WHERE file_path = ?
    ORDER BY dependency_key, chunk_struct_id, consumer
  `).all(filePath);
}

/**
 * Reconcile one file against the existing DB state. Mirrors what the
 * Phase 3 vector adapter will do: diff, encode missing, write rows.
 */
function reconcileOneFile(vectorsDb, graphDb, filePath, newChunks, epoch) {
  const ann = annotateChunksForDelta(newChunks, filePath);
  const snap = snapshotFileRows(vectorsDb, filePath);
  const diff = diffChunks(newChunks, ann, snap);

  // Encode only what diff says to encode (THIS is the cache-skip claim).
  const encodedRows = [];
  for (let i = 0; i < diff.toEncode.length; i++) {
    const item = diff.toEncode[i];
    const text = item.chunk.embedding_text || item.chunk.content;
    const embedding = fakeEmbedding(text);
    encodedRows.push({ item, embedding });
  }

  // Apply diff updates (reuse rows + retire missing).
  applyDiff(vectorsDb, filePath, diff, epoch);

  // Insert new rows for encoded chunks.
  for (const er of encodedRows) {
    const id = `recon-${filePath}-${epoch}-${er.item.ann.chunkStructId}`;
    vectorsDb.prepare(`
      INSERT INTO vectors (
        id, file_path, embedding, text, metadata, session_id, tags, created_at,
        chunk_struct_id, chunk_text_hash, embedding_input_hash, li_input_hash,
        metadata_fingerprint, logical_chunk_id, epoch_written, epoch_retired
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, filePath, er.embedding, er.item.chunk.content,
      JSON.stringify(er.item.chunk.metadata), 'session-1', '[]', '2026-01-01',
      er.item.ann.chunkStructId, er.item.ann.hashes.chunk_text_hash,
      er.item.ann.hashes.embedding_input_hash, er.item.ann.hashes.li_input_hash,
      er.item.ann.hashes.metadata_fingerprint, er.item.ann.chunkStructId,
      epoch, null,
    );
    persistDependencies(
      graphDb, filePath, er.item.ann.chunkStructId,
      collectChunkDependencies(er.item.chunk),
    );
  }
  return { diff, encoded: diff.toEncode.length, reused: diff.toReuse.length, retired: diff.toRetire.length };
}

// ----- Tests ----------------------------------------------------------

describe('Structural invariance (plan § 12.3)', () => {
  let vectorsDb, graphDb;

  beforeEach(() => {
    resetEncodeCounter();
    vectorsDb = makeVectorsDb();
    graphDb = makeCodeGraphDb();
  });

  afterEach(() => {
    try { vectorsDb.close(); } catch {}
    try { graphDb.close(); } catch {}
  });

  it('editing ONE file leaves every other file byte-identical at the vectors, graph, and dependency layers', () => {
    // Fixture corpus: 4 files, each with 3 chunks (mix of symbol + anon).
    const corpus = {
      'src/a.js': [
        makeSymbolChunk('src/a.js', 'aOne', 'return 1;'),
        makeSymbolChunk('src/a.js', 'aTwo', 'return 2;'),
        makeAnonymousChunk('src/a.js', 'aOne', 'console.log("a");'),
      ],
      'src/b.js': [
        makeSymbolChunk('src/b.js', 'bOne', 'return 11;'),
        makeSymbolChunk('src/b.js', 'bTwo', 'return 12;'),
        makeAnonymousChunk('src/b.js', 'bOne', 'console.log("b");'),
      ],
      'src/c.js': [
        makeSymbolChunk('src/c.js', 'cOne', 'return 21;'),
        makeSymbolChunk('src/c.js', 'cTwo', 'return 22;'),
        makeAnonymousChunk('src/c.js', 'cOne', 'console.log("c");'),
      ],
      'src/d.js': [
        makeSymbolChunk('src/d.js', 'dOne', 'return 31;'),
        makeSymbolChunk('src/d.js', 'dTwo', 'return 32;'),
        makeAnonymousChunk('src/d.js', 'dOne', 'console.log("d");'),
      ],
    };
    const snap = coldIndex(vectorsDb, graphDb, corpus, /* epoch */ 1);
    const graphSnap = new Map();
    const depSnap = new Map();
    for (const filePath of Object.keys(corpus)) {
      graphSnap.set(filePath, graphRowsForFile(graphDb, filePath));
      depSnap.set(filePath, dependencyRowsForFile(graphDb, filePath));
    }
    const coldEncodes = getEncodeCount();
    expect(coldEncodes).toBe(12); // 4 files × 3 chunks

    // EDIT ONE FILE: src/b.js gets a new top-level function inserted at the top.
    const editedB = [
      makeSymbolChunk('src/b.js', 'NEW_FN', 'return -1;'),
      ...corpus['src/b.js'],
    ];

    resetEncodeCounter();
    const result = reconcileOneFile(vectorsDb, graphDb, 'src/b.js', editedB, /* epoch */ 2);

    // Reconcile must encode ONLY the new function.
    expect(getEncodeCount()).toBe(1);
    expect(result.encoded).toBe(1);
    expect(result.reused).toBe(3);
    expect(result.retired).toBe(0);

    // Every OTHER file's vectors rows must be byte-identical to the cold
    // snapshot. This is the load-bearing invariant.
    for (const otherFile of ['src/a.js', 'src/c.js', 'src/d.js']) {
      const rows = vectorsDb.prepare(`
        SELECT id, chunk_struct_id, chunk_text_hash, embedding_input_hash,
               li_input_hash, metadata_fingerprint, epoch_written, epoch_retired,
               embedding
        FROM vectors WHERE file_path = ?
        ORDER BY id
      `).all(otherFile);
      const expected = [...snap.get(otherFile)].sort((a, b) => a.id.localeCompare(b.id));
      expect(rows.length).toBe(expected.length);
      for (let i = 0; i < rows.length; i++) {
        expect(rows[i].chunk_struct_id).toBe(expected[i].chunkStructId);
        expect(rows[i].chunk_text_hash).toBe(expected[i].chunkTextHash);
        expect(rows[i].embedding_input_hash).toBe(expected[i].embeddingInputHash);
        expect(rows[i].li_input_hash).toBe(expected[i].liInputHash);
        expect(rows[i].metadata_fingerprint).toBe(expected[i].metadataFingerprint);
        // CRITICAL: embedding bytes must be identical — no re-encoding.
        expect(rows[i].embedding.toString('hex')).toBe(expected[i].embeddingBytes);
        // Epoch must be unchanged (still 1 — never re-written).
        expect(rows[i].epoch_written).toBe(1);
        expect(rows[i].epoch_retired).toBeNull();
      }

      expect(graphRowsForFile(graphDb, otherFile)).toEqual(graphSnap.get(otherFile));
      expect(dependencyRowsForFile(graphDb, otherFile)).toEqual(depSnap.get(otherFile));
    }
  });

  it('whitespace-only edit (format-on-save) → zero encodes, zero retires', () => {
    const corpus = {
      'app.js': [
        makeSymbolChunk('app.js', 'foo', 'return 1;'),
        makeSymbolChunk('app.js', 'bar', 'return 2;'),
      ],
    };
    coldIndex(vectorsDb, graphDb, corpus, 1);
    resetEncodeCounter();

    // Same chunks; only the source whitespace changed but the chunker still
    // emits the same normalized `embedding_text` / `li_*` strings (the
    // graph-enrichment pass is deterministic over the AST). The chunk
    // `.content` differs by trailing whitespace.
    const formatted = corpus['app.js'].map((c) => ({
      ...c,
      content: c.content + '   ',  // visible whitespace addition
      embedding_text: c.embedding_text, // unchanged after normalization
      li_text: c.li_text,
      li_greedy_text: c.li_greedy_text,
    }));

    const result = reconcileOneFile(vectorsDb, graphDb, 'app.js', formatted, 2);
    expect(getEncodeCount()).toBe(0);
    expect(result.encoded).toBe(0);
    expect(result.reused).toBe(2);
    expect(result.retired).toBe(0);
  });

  it('renaming a function only re-encodes the renamed chunk', () => {
    const corpus = {
      'lib.js': [
        makeSymbolChunk('lib.js', 'foo', 'return 1;'),
        makeSymbolChunk('lib.js', 'bar', 'return 2;'),
        makeSymbolChunk('lib.js', 'baz', 'return 3;'),
        makeAnonymousChunk('lib.js', 'foo', 'const X = 1;'),
      ],
    };
    coldIndex(vectorsDb, graphDb, corpus, 1);
    resetEncodeCounter();

    const renamed = [
      makeSymbolChunk('lib.js', 'fooRenamed', 'return 1;',
        { signature: 'function fooRenamed() {' }),
      makeSymbolChunk('lib.js', 'bar', 'return 2;'),
      makeSymbolChunk('lib.js', 'baz', 'return 3;'),
      makeAnonymousChunk('lib.js', 'foo', 'const X = 1;'),
    ];
    const result = reconcileOneFile(vectorsDb, graphDb, 'lib.js', renamed, 2);
    expect(getEncodeCount()).toBe(1);
    expect(result.encoded).toBe(1);
    expect(result.reused).toBe(3);
    expect(result.retired).toBe(1); // old `foo` row gets tombstoned

    // The retired row must carry epoch_retired = 2; new row epoch_written = 2.
    const retired = vectorsDb.prepare(`
      SELECT epoch_written, epoch_retired FROM vectors
      WHERE file_path = 'lib.js' AND epoch_retired IS NOT NULL
    `).all();
    expect(retired.length).toBe(1);
    expect(retired[0].epoch_retired).toBe(2);

    const fresh = vectorsDb.prepare(`
      SELECT epoch_written FROM vectors
      WHERE file_path = 'lib.js' AND epoch_written = 2 AND epoch_retired IS NULL
    `).all();
    expect(fresh.length).toBeGreaterThanOrEqual(1);
  });

  it('deleting a file removes its rows from manifest visibility but preserves history', () => {
    const corpus = {
      'keep.js': [makeSymbolChunk('keep.js', 'k', 'return 1;')],
      'gone.js': [
        makeSymbolChunk('gone.js', 'a', 'return 1;'),
        makeSymbolChunk('gone.js', 'b', 'return 2;'),
      ],
    };
    coldIndex(vectorsDb, graphDb, corpus, 1);

    // Reconcile gone.js as deleted = pass empty chunks.
    const result = reconcileOneFile(vectorsDb, graphDb, 'gone.js', [], 2);
    expect(result.encoded).toBe(0);
    expect(result.reused).toBe(0);
    expect(result.retired).toBe(2);

    // Rows still physically exist but are not visible at epoch 2.
    const visibleAtE2 = vectorsDb.prepare(
      `SELECT id FROM vectors WHERE file_path = 'gone.js' AND ${epochVisibilityPredicate()}`,
    ).all({ manifestEpoch: 2 });
    expect(visibleAtE2.length).toBe(0);

    // But still visible at epoch 1 (history preserved).
    const visibleAtE1 = vectorsDb.prepare(
      `SELECT id FROM vectors WHERE file_path = 'gone.js' AND ${epochVisibilityPredicate()}`,
    ).all({ manifestEpoch: 1 });
    expect(visibleAtE1.length).toBe(2);

    forgetFile(graphDb, 'gone.js');
    const deps = dependentsOf(graphDb, ['path:gone.js']);
    expect(deps.length).toBe(0);
  });

  it('signature-equivalent reformat (trailing brace strip + run collapse) reuses 100%', () => {
    // Plan § 7.2: `normalizeSignature` collapses whitespace runs and drops
    // trailing `{`/`=`. Two signatures that differ only by trailing-brace
    // and trailing whitespace MUST hash equally.
    const corpus = {
      'a.js': [
        makeSymbolChunk('a.js', 'foo', 'return 1;',
          { signature: 'function foo(a, b) {' }),
      ],
    };
    coldIndex(vectorsDb, graphDb, corpus, 1);
    resetEncodeCounter();

    // Same canonical signature: the chunker on the second pass produces
    // a brace-less signature line (some grammars do this), but it's
    // semantically identical after normalization.
    const edited = [
      makeSymbolChunk('a.js', 'foo', 'return 1;',
        { signature: 'function foo(a, b)' }),
    ];
    const result = reconcileOneFile(vectorsDb, graphDb, 'a.js', edited, 2);
    expect(getEncodeCount()).toBe(0);
    expect(result.reused).toBe(1);
  });
});

describe('Reconciler orchestration over a real adapter (multi-file)', () => {
  let stateDir, vectorsDb, graphDb;

  beforeEach(() => {
    resetEncodeCounter();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-recon-e2e-'));
    vectorsDb = makeVectorsDb();
    graphDb = makeCodeGraphDb();
  });

  afterEach(() => {
    try { vectorsDb.close(); } catch {}
    try { graphDb.close(); } catch {}
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch {}
  });

  function buildAdapter(dirty, opts = {}) {
    return {
      readDirtySet: async () => dirty,
      hashFile: async (file) => ({ file, contentUnchanged: false, chunks: opts.chunksByFile?.[file] ?? [] }),
      applyGraphDelta: async (file, hashes /* , epoch */) => ({
        ops: { graph_upsert: hashes.chunks?.length ?? 0, graph_tombstone: 0 },
      }),
      applyVectorDelta: async (file, chunks, hashes, epoch) => {
        // Real call into the diff machinery.
        const ann = annotateChunksForDelta(chunks, file);
        const snap = snapshotFileRows(vectorsDb, file);
        const diff = diffChunks(chunks, ann, snap);
        applyDiff(vectorsDb, file, diff, epoch);
        // Insert encoded rows
        for (const item of diff.toEncode) {
          const text = item.chunk.embedding_text || item.chunk.content;
          const embedding = fakeEmbedding(text);
          const id = `e2e-${file}-${epoch}-${item.ann.chunkStructId}`;
          vectorsDb.prepare(`
            INSERT INTO vectors (
              id, file_path, embedding, text, metadata, session_id, tags, created_at,
              chunk_struct_id, chunk_text_hash, embedding_input_hash, li_input_hash,
              metadata_fingerprint, logical_chunk_id, epoch_written, epoch_retired
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id, file, embedding, item.chunk.content, JSON.stringify(item.chunk.metadata),
            'session-e2e', '[]', '2026-05-16',
            item.ann.chunkStructId, item.ann.hashes.chunk_text_hash,
            item.ann.hashes.embedding_input_hash, item.ann.hashes.li_input_hash,
            item.ann.hashes.metadata_fingerprint, item.ann.chunkStructId,
            epoch, null,
          );
        }
        return {
          ops: { vectors_upsert: diff.toEncode.length, vectors_delete: diff.toRetire.length },
          chunksTotal: chunks.length,
          chunksEncoded: diff.toEncode.length,
          chunksReused: diff.toReuse.length,
          vectorOps: [], tokenOps: [], gramOps: [],
        };
      },
      applyBinaryHNSWDelta: async () => ({ ops: { binary_hnsw_append: 0 } }),
      applyLIDelta: async () => ({ ops: { li_segment_append: 0 } }),
      applySparseGramDelta: async () => ({ ops: { sparse_gram_delta_upsert: 0 } }),
    };
  }

  it('full tick drives the diff layer end-to-end and publishes a manifest', async () => {
    const chunksByFile = {
      'fileA.js': [
        makeSymbolChunk('fileA.js', 'aOne', 'return 1;'),
        makeSymbolChunk('fileA.js', 'aTwo', 'return 2;'),
      ],
      'fileB.js': [
        makeSymbolChunk('fileB.js', 'bOne', 'return 11;'),
      ],
    };
    const adapter = buildAdapter(['fileA.js', 'fileB.js'], { chunksByFile });
    const r = new Reconciler({ stateDir, adapters: adapter });
    const snap = await r.tick();
    expect(snap.epoch).toBe(1);
    expect(snap.files_processed).toBe(2);
    expect(snap.chunks_encoded).toBe(3);
    expect(snap.chunks_hash_reused).toBe(0);

    // Manifest written, epoch=1.
    const m = readManifest(stateDir);
    expect(m.epoch).toBe(1);

    // Vectors rows really landed in SQLite at epoch=1.
    const rows = vectorsDb.prepare('SELECT file_path, chunk_struct_id, epoch_written FROM vectors').all();
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.epoch_written).toBe(1);
    }
  });

  it('second tick with same chunks → 100% reuse (zero encodes)', async () => {
    const chunksByFile = {
      'idem.js': [
        makeSymbolChunk('idem.js', 'foo', 'return 1;'),
        makeSymbolChunk('idem.js', 'bar', 'return 2;'),
      ],
    };
    const adapter = buildAdapter(['idem.js'], { chunksByFile });
    const r = new Reconciler({ stateDir, adapters: adapter });
    const first = await r.tick();
    expect(first.chunks_encoded).toBe(2);

    resetEncodeCounter();
    const second = await r.tick();
    expect(getEncodeCount()).toBe(0);
    expect(second.chunks_encoded).toBe(0);
    expect(second.chunks_hash_reused).toBe(2);
    expect(second.epoch).toBe(2);

    // Vectors rows still only 2 — no duplicates.
    const cnt = vectorsDb.prepare('SELECT COUNT(*) as c FROM vectors').get();
    expect(cnt.c).toBe(2);
  });

  it('manifest pinning: a query at epoch ε never sees ε+1 vectors', async () => {
    const chunksByFile = {
      'evolve.js': [makeSymbolChunk('evolve.js', 'foo', 'v1')],
    };
    const adapter1 = buildAdapter(['evolve.js'], { chunksByFile });
    const r = new Reconciler({ stateDir, adapters: adapter1 });
    await r.tick(); // epoch=1
    const e1 = readManifest(stateDir).epoch;

    // Reader pins epoch=1, then we advance.
    const chunksAtE2 = {
      'evolve.js': [makeSymbolChunk('evolve.js', 'fooRenamed', 'v1',
        { signature: 'function fooRenamed() {' })],
    };
    const adapter2 = buildAdapter(['evolve.js'], { chunksByFile: chunksAtE2 });
    const r2 = new Reconciler({ stateDir, adapters: adapter2 });
    await r2.tick(); // epoch=2

    // Reader pinned to epoch=1 still sees the old chunk_struct_id.
    const visibleE1 = vectorsDb.prepare(`
      SELECT chunk_struct_id FROM vectors
      WHERE file_path = 'evolve.js' AND ${epochVisibilityPredicate()}
    `).all({ manifestEpoch: e1 });
    expect(visibleE1.length).toBe(1);

    // Reader pinned to epoch=2 sees the renamed function only.
    const visibleE2 = vectorsDb.prepare(`
      SELECT chunk_struct_id FROM vectors
      WHERE file_path = 'evolve.js' AND ${epochVisibilityPredicate()}
    `).all({ manifestEpoch: 2 });
    expect(visibleE2.length).toBe(1);
    // The two readers see different rows (different chunk_struct_id).
    expect(visibleE1[0].chunk_struct_id).not.toBe(visibleE2[0].chunk_struct_id);
  });

  it('worktree stamp is minted on first tick when projectRoot is provided', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-proj-'));
    try {
      const adapter = buildAdapter([], { chunksByFile: {} });
      const r = new Reconciler({ stateDir, adapters: adapter, projectRoot });
      const verify = r.verifyStartup();
      expect(verify.ok).toBe(true);
      // Re-verify after stamp written.
      const verify2 = r.verifyStartup();
      expect(verify2.ok).toBe(true);
      expect(fs.existsSync(path.join(stateDir, 'worktree-stamp.json'))).toBe(true);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('worktree stamp mismatch is reported as not-ok', async () => {
    const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-projA-'));
    const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-projB-'));
    try {
      const adapter = buildAdapter([], { chunksByFile: {} });
      const rA = new Reconciler({ stateDir, adapters: adapter, projectRoot: projA });
      rA.verifyStartup();
      // Same stateDir, different projectRoot → mismatch
      const errMsgs = [];
      const rB = new Reconciler({
        stateDir, adapters: adapter, projectRoot: projB,
        logger: { info: () => {}, warn: () => {}, error: (m) => errMsgs.push(m) },
      });
      const verify = rB.verifyStartup();
      expect(verify.ok).toBe(false);
      expect(errMsgs.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(projA, { recursive: true, force: true });
      fs.rmSync(projB, { recursive: true, force: true });
    }
  });

  it('interval auto-tune activates when configured and tracks dirty churn', async () => {
    const chunksByFile = {};
    const dirtyFiles = Array.from({ length: 80 }, (_, i) => `f${i}.js`);
    for (const f of dirtyFiles) chunksByFile[f] = [makeSymbolChunk(f, 'x', 'return 0;')];

    const adapter = buildAdapter(dirtyFiles, { chunksByFile });
    const infoMsgs = [];
    const r = new Reconciler({
      stateDir, adapters: adapter,
      config: { autotuneInterval: true, intervalMs: 60_000, filesPerTick: 5 },
      logger: { info: (m) => infoMsgs.push(m), warn: () => {}, error: () => {} },
    });
    await r.tick();
    // 80 dirty files > 50 → "dirty-churn" reason should fire.
    expect(r.config.intervalMs).toBeLessThan(60_000);
    expect(infoMsgs.some((m) => /interval.*dirty-churn/.test(m))).toBe(true);
  });

  it('interval pin overrides auto-tune', async () => {
    const adapter = buildAdapter([], { chunksByFile: {} });
    const r = new Reconciler({
      stateDir, adapters: adapter,
      config: { autotuneInterval: true, intervalMs: 60_000, pinnedIntervalMs: true },
    });
    await r.tick();
    expect(r.config.intervalMs).toBe(60_000);
  });
});
