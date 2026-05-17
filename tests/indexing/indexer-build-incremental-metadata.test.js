import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  createVectorSchema,
  insertVectors,
  pipelinedEmbedAndInsert,
} from '../../core/indexing/indexer-build.js';
import { chunkInputHashes } from '../../core/incremental-indexing/domain/encoder-input.mjs';

vi.mock('../../core/embedding/embedding-service.js', () => ({
  getEmbeddings: vi.fn(async (texts) => texts.map(() => ({ embedding: [1, 0, 0, 0] }))),
  getModelInfo: vi.fn(() => ({ provider: 'mock', dimension: 4 })),
}));

function functionChunk(id, symbol, content = 'return 1;') {
  return {
    id,
    file: 'src/a.js',
    content,
    text: content,
    embedding_text: `${symbol}\n${content}`,
    li_greedy_text: `${symbol}\n${content}`,
    metadata: {
      relative_path: 'src/a.js',
      language: 'javascript',
      chunk_type: 'function',
      symbol,
      signature: `function ${symbol}() {`,
      line_start: 1,
      line_end: 3,
    },
  };
}

function anonymousChunk(id) {
  return {
    id,
    file: 'src/a.js',
    content: 'if (err) return cb(err);',
    text: 'if (err) return cb(err);',
    embedding_text: 'if (err) return cb(err);',
    li_greedy_text: 'if (err) return cb(err);',
    metadata: {
      relative_path: 'src/a.js',
      language: 'javascript',
      chunk_type: 'code',
      parent_symbol: 'handler',
      line_start: 1,
      line_end: 1,
    },
  };
}

describe('indexer-build incremental vector metadata', () => {
  it('creates the incremental vector columns during cold schema setup', () => {
    const db = new Database(':memory:');
    createVectorSchema(db);

    const columns = db.prepare('PRAGMA table_info(vectors)').all().map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining([
      'chunk_struct_id',
      'chunk_text_hash',
      'embedding_input_hash',
      'li_input_hash',
      'metadata_fingerprint',
      'logical_chunk_id',
      'epoch_written',
      'epoch_retired',
    ]));
  });

  it('populates structural IDs and exact encoder-input hashes on full vector inserts', () => {
    const db = new Database(':memory:');
    createVectorSchema(db);
    const chunk = functionChunk('chunk-1', 'alpha');

    insertVectors(db, [chunk], [[1, 0, 0, 0]], { provider: 'mock', dimension: 4 });

    const row = db.prepare(`
      SELECT chunk_struct_id, chunk_text_hash, embedding_input_hash, li_input_hash,
             metadata_fingerprint, logical_chunk_id, epoch_written, epoch_retired
      FROM vectors WHERE id = ?
    `).get('chunk-1');
    const hashes = chunkInputHashes(chunk);
    expect(row.chunk_struct_id).toMatch(/^[0-9a-f]{16}$/);
    expect(row.chunk_text_hash).toBe(hashes.chunk_text_hash);
    expect(row.embedding_input_hash).toBe(hashes.embedding_input_hash);
    expect(row.li_input_hash).toBe(hashes.li_input_hash);
    expect(row.metadata_fingerprint).toBe(hashes.metadata_fingerprint);
    expect(row.logical_chunk_id).toBe(row.chunk_struct_id);
    expect(row.epoch_written).toBe(0);
    expect(row.epoch_retired).toBeNull();
  });

  it('normalizes AST chunk metadata.path into vector file metadata and hashes', () => {
    const db = new Database(':memory:');
    createVectorSchema(db);
    const chunk = {
      id: 'chunk-ast',
      file: 'a.js',
      content: 'export function alpha() { return 1; }',
      text: 'export function alpha() { return 1; }',
      embedding_text: 'export function alpha() { return 1; }',
      li_greedy_text: 'export function alpha() { return 1; }',
      metadata: {
        file: 'a.js',
        path: 'src/a.js',
        language: 'javascript',
        chunk_type: 'function',
        symbol: 'alpha',
        line_start: 4,
        line_end: 6,
      },
    };
    const canonical = {
      ...chunk,
      file: 'src/a.js',
      metadata: {
        ...chunk.metadata,
        file: undefined,
        path: undefined,
        relative_path: 'src/a.js',
      },
    };

    insertVectors(db, [chunk], [[1, 0, 0, 0]], { provider: 'mock', dimension: 4 });

    const row = db.prepare(`
      SELECT file_path, metadata, metadata_fingerprint
      FROM vectors WHERE id = ?
    `).get('chunk-ast');
    expect(row.file_path).toBe('src/a.js');
    expect(JSON.parse(row.metadata).file).toBe('src/a.js');
    expect(row.metadata_fingerprint).toBe(chunkInputHashes(canonical).metadata_fingerprint);
  });

  it('preserves anonymous occurrence indexes across pipelined embedding batches', async () => {
    const db = new Database(':memory:');
    createVectorSchema(db);
    const chunks = [anonymousChunk('c0'), anonymousChunk('c1'), anonymousChunk('c2')];

    await pipelinedEmbedAndInsert(
      db,
      chunks,
      chunks.map((chunk) => chunk.embedding_text),
      2,
      { provider: 'mock', dimension: 4 },
      () => {},
      {},
      () => {},
      1,
    );

    const rows = db.prepare(`
      SELECT id, chunk_struct_id
      FROM vectors
      ORDER BY id
    `).all();

    expect(rows.map((row) => row.chunk_struct_id.replace(/^[0-9a-f]{16}_/, '_'))).toEqual([
      '_0',
      '_1',
      '_2',
    ]);
    expect(new Set(rows.map((row) => row.chunk_struct_id)).size).toBe(3);
  });
});
