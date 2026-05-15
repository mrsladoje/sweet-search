/**
 * Tests for core/incremental-indexing/infrastructure/schema-migrations.mjs
 *
 * Covers plan § 33 pre-merge checklist items:
 *  - Vectors table acquires the seven new columns + epoch indices.
 *  - Entities & relationships acquire the strict-visibility columns.
 *  - All NOT NULL columns have DEFAULT clauses so an older daemon doing
 *    INSERT without the new columns cannot trigger SQLITE_CONSTRAINT_NOTNULL.
 *  - Migrations are idempotent (safe to call twice).
 *  - encoder_input_dependencies table & index exist.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  migrateVectorsSchema,
  migrateEntitiesSchema,
  migrateRelationshipsSchema,
  ensureEncoderDepsSchema,
  applyReconcileSchemaMigrations,
} from '../../core/incremental-indexing/infrastructure/schema-migrations.mjs';

function makeVectorsTable(db) {
  db.exec(`
    CREATE TABLE vectors (
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
}

function makeGraphTables(db) {
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      stale_since INTEGER DEFAULT NULL
    )
  `);
  db.exec(`
    CREATE TABLE relationships (
      source_id TEXT,
      target_id TEXT,
      target_name TEXT NOT NULL,
      type TEXT NOT NULL
    )
  `);
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

describe('schema-migrations / vectors', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    makeVectorsTable(db);
  });

  it('adds the seven reconcile-v2 columns', () => {
    const { added } = migrateVectorsSchema(db);
    expect(added).toEqual([
      'chunk_struct_id',
      'chunk_text_hash',
      'embedding_input_hash',
      'li_input_hash',
      'metadata_fingerprint',
      'logical_chunk_id',
      'epoch_written',
      'epoch_retired',
    ]);
    expect(columnNames(db, 'vectors')).toEqual(
      expect.arrayContaining([
        'chunk_struct_id', 'chunk_text_hash', 'embedding_input_hash',
        'li_input_hash', 'metadata_fingerprint', 'logical_chunk_id',
        'epoch_written', 'epoch_retired',
      ]),
    );
  });

  it('rollback-safety: older daemon INSERT without the new columns lands cleanly', () => {
    migrateVectorsSchema(db);
    // Pretend this is the older daemon's prepared statement that has no
    // knowledge of the new columns. The DEFAULT clauses must absorb the
    // missing column references.
    const stmt = db.prepare(`
      INSERT INTO vectors (id, file_path, embedding, text, metadata, session_id, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    expect(() => stmt.run(
      'chunk-1', 'src/a.js', Buffer.alloc(4), 'hello', '{}', 'sess', '[]', '2026-01-01',
    )).not.toThrow();
    const row = db.prepare('SELECT * FROM vectors WHERE id = ?').get('chunk-1');
    expect(row.chunk_struct_id).toBe('');
    expect(row.embedding_input_hash).toBe('');
    expect(row.li_input_hash).toBe('');
    expect(row.epoch_written).toBe(0);
    expect(row.epoch_retired).toBeNull();
  });

  it('is idempotent', () => {
    const first = migrateVectorsSchema(db);
    const second = migrateVectorsSchema(db);
    expect(first.added.length).toBe(8);
    expect(second.added.length).toBe(0);
  });

  it('creates the epoch and structural-id indices', () => {
    migrateVectorsSchema(db);
    const indices = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='vectors'",
    ).all().map((r) => r.name);
    expect(indices).toEqual(expect.arrayContaining([
      'idx_vectors_struct',
      'idx_vectors_epoch_written',
      'idx_vectors_epoch_retired',
      'idx_vectors_logical',
    ]));
  });

  it('returns no-op when vectors table does not exist', () => {
    const empty = new Database(':memory:');
    const res = migrateVectorsSchema(empty);
    expect(res.added).toEqual([]);
  });
});

describe('schema-migrations / entities + relationships', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    makeGraphTables(db);
  });

  it('adds the strict-visibility columns to entities', () => {
    const { added } = migrateEntitiesSchema(db);
    expect(added).toEqual(['logical_entity_id', 'epoch_written', 'epoch_retired']);
    expect(columnNames(db, 'entities')).toEqual(expect.arrayContaining([
      'logical_entity_id', 'epoch_written', 'epoch_retired',
    ]));
  });

  it('rollback-safety on entities: older INSERT path lands without crash', () => {
    migrateEntitiesSchema(db);
    expect(() => db.prepare(
      'INSERT INTO entities (id, file_path, type, name) VALUES (?, ?, ?, ?)',
    ).run('e1', 'src/a.js', 'function', 'foo')).not.toThrow();
    const row = db.prepare('SELECT * FROM entities WHERE id = ?').get('e1');
    expect(row.logical_entity_id).toBe('');
    expect(row.epoch_written).toBe(0);
    expect(row.epoch_retired).toBeNull();
  });

  it('adds the strict-visibility columns to relationships', () => {
    const { added } = migrateRelationshipsSchema(db);
    expect(added).toEqual(['logical_relationship_id', 'epoch_written', 'epoch_retired']);
  });

  it('rollback-safety on relationships', () => {
    migrateRelationshipsSchema(db);
    expect(() => db.prepare(
      'INSERT INTO relationships (target_name, type) VALUES (?, ?)',
    ).run('foo', 'call')).not.toThrow();
    const row = db.prepare('SELECT * FROM relationships WHERE target_name = ?').get('foo');
    expect(row.logical_relationship_id).toBe('');
    expect(row.epoch_written).toBe(0);
  });
});

describe('schema-migrations / encoder dependencies', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
  });

  it('creates the encoder_input_dependencies table with the consumer check', () => {
    ensureEncoderDepsSchema(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='encoder_input_dependencies'",
    ).all();
    expect(tables.length).toBe(1);
    db.prepare(`
      INSERT INTO encoder_input_dependencies (dependency_key, file_path, chunk_struct_id, consumer)
      VALUES (?, ?, ?, ?)
    `).run('entity:abc', 'src/a.js', 'chunk-1', 'dense');
    expect(() => db.prepare(`
      INSERT INTO encoder_input_dependencies (dependency_key, file_path, chunk_struct_id, consumer)
      VALUES (?, ?, ?, ?)
    `).run('entity:abc', 'src/a.js', 'chunk-2', 'invalid')).toThrow(/CHECK/);
  });
});

describe('schema-migrations / umbrella', () => {
  it('applies every migration in one call', () => {
    const codeGraph = new Database(':memory:');
    const vectors = new Database(':memory:');
    makeGraphTables(codeGraph);
    makeVectorsTable(vectors);
    const res = applyReconcileSchemaMigrations({ codeGraph, vectors });
    expect(res.vectors.added.length).toBe(8);
    expect(res.entities.added.length).toBe(3);
    expect(res.relationships.added.length).toBe(3);
    // encoder deps table on the code-graph DB
    const t = codeGraph.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='encoder_input_dependencies'",
    ).get();
    expect(t.name).toBe('encoder_input_dependencies');
  });
});
