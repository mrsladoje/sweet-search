/**
 * The index schema: the full build creates the final code-graph.db and codebase.db schema
 * (epoch columns, logical ids, partial indexes) and stamps SCHEMA_VERSION. There are no
 * migrations: an index with another version fails at reader open, at the maintainer gate
 * and at search init with the rebuild instruction, never with a SQL error.
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGraphSchema } from '../../core/graph/graph-extractor.js';
import { createVectorSchema } from '../../core/indexing/indexer-build.js';
import { SCHEMA_VERSION } from '../../core/indexing/index-format-versions.js';
import { buildConfigFingerprint, diffConfigFingerprint } from '../../core/indexing/config-fingerprint.js';
import { ensureEncoderDepsSchema } from '../../core/incremental-indexing/infrastructure/schema-migrations.mjs';
import { IndexSchemaError, assertIndexSchemas } from '../../core/infrastructure/index-schema.js';
import { CodeGraphRepository } from '../../core/infrastructure/code-graph-repository.js';
import { CodebaseRepository } from '../../core/infrastructure/codebase-repository.js';

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function indexNames(db, table) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ?").all(table).map((r) => r.name);
}

describe('createVectorSchema', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => db.close());

  it('creates every column and index and stamps the schema version', () => {
    createVectorSchema(db);
    expect(columnNames(db, 'vectors')).toEqual(expect.arrayContaining([
      'chunk_struct_id', 'chunk_text_hash', 'embedding_input_hash', 'li_input_hash',
      'metadata_fingerprint', 'logical_chunk_id', 'epoch_written', 'epoch_retired',
    ]));
    expect(indexNames(db, 'vectors')).toEqual(expect.arrayContaining([
      'idx_vectors_file_path', 'idx_vectors_struct', 'idx_vectors_epoch_written',
      'idx_vectors_epoch_retired', 'idx_vectors_logical', 'idx_vectors_alias_exemplar',
    ]));
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('gives every NOT NULL column a default (a full-build row needs only the base columns)', () => {
    createVectorSchema(db);
    db.prepare('INSERT INTO vectors (id, file_path, embedding) VALUES (?, ?, ?)').run('c1', 'src/a.js', Buffer.alloc(4));
    const row = db.prepare('SELECT * FROM vectors WHERE id = ?').get('c1');
    expect(row.chunk_struct_id).toBe('');
    expect(row.epoch_written).toBe(0);
    expect(row.epoch_retired).toBeNull();
  });

  it('is idempotent on a current index', () => {
    createVectorSchema(db);
    expect(() => createVectorSchema(db)).not.toThrow();
  });

  it('refuses an existing vectors table of another version instead of altering it', () => {
    db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, embedding BLOB NOT NULL)');
    expect(() => createVectorSchema(db)).toThrow(IndexSchemaError);
    expect(columnNames(db, 'vectors')).not.toContain('epoch_written');
  });
});

describe('createGraphSchema', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => db.close());

  it('creates the epoch columns, logical ids and the live-only unique edge index', () => {
    createGraphSchema(db);
    expect(columnNames(db, 'entities')).toEqual(expect.arrayContaining([
      'logical_entity_id', 'epoch_written', 'epoch_retired', 'page_rank', 'code', 'name_alias', 'stale_since',
    ]));
    expect(columnNames(db, 'relationships')).toEqual(expect.arrayContaining([
      'logical_relationship_id', 'epoch_written', 'epoch_retired',
    ]));
    expect(columnNames(db, 'call_sites')).toEqual(expect.arrayContaining(['epoch_written', 'epoch_retired']));
    expect(columnNames(db, 'call_lines')).toEqual(expect.arrayContaining(['epoch_written', 'epoch_retired', 'rel_type']));
    const unique = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_rel_unique'").get().sql;
    expect(unique).toMatch(/epoch_retired IS NULL/);
    const version = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get().value;
    expect(Number(version)).toBe(SCHEMA_VERSION);
  });

  it('lets a retired edge sit next to its live successor', () => {
    createGraphSchema(db);
    const ins = db.prepare('INSERT INTO relationships (source_id, target_id, target_name, type, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run('a', 'b', 'b', 'calls', 0, 2);
    expect(() => ins.run('a', 'b', 'b', 'calls', 2, null)).not.toThrow();
    expect(() => ins.run('a', 'b', 'b', 'calls', 3, null)).toThrow(/UNIQUE/);
  });

  it('refuses an existing graph of another version instead of altering it', () => {
    db.exec('CREATE TABLE entities (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL)');
    expect(() => createGraphSchema(db)).toThrow(IndexSchemaError);
    expect(columnNames(db, 'entities')).not.toContain('epoch_written');
  });
});

describe('an index of another schema version', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ss-schema-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function oldIndex() {
    const graphPath = join(dir, 'code-graph.db');
    const g = new Database(graphPath);
    g.exec("CREATE TABLE entities (id TEXT PRIMARY KEY, file_path TEXT, type TEXT, name TEXT); CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO schema_meta VALUES ('version', '2')");
    g.close();
    const vecPath = join(dir, 'codebase.db');
    const v = new Database(vecPath);
    v.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, embedding BLOB, text TEXT, metadata TEXT)');
    v.close();
    return { graphPath, vecPath };
  }

  it('fails at reader open with the rebuild instruction', () => {
    const { graphPath, vecPath } = oldIndex();
    const graph = new CodeGraphRepository(graphPath);
    expect(() => graph.findEntitiesInFile('src/a.js')).toThrow(/sweet-search index --full/);
    const vectors = new CodebaseRepository(vecPath);
    expect(() => vectors.getEmbeddingsByIds(['c1'])).toThrow(/sweet-search index --full/);
  });

  it('fails the search-init check for either database', () => {
    const { graphPath, vecPath } = oldIndex();
    expect(() => assertIndexSchemas({ graphDbPath: graphPath })).toThrow(/schema version 2, this sweet-search needs/);
    expect(() => assertIndexSchemas({ codebaseDbPath: vecPath })).toThrow(/sweet-search index --full/);
  });

  it('passes the search-init check once the full build created the current schema', () => {
    const graphPath = join(dir, 'g.db');
    const vecPath = join(dir, 'v.db');
    const g = new Database(graphPath); createGraphSchema(g); g.close();
    const v = new Database(vecPath); createVectorSchema(v); v.close();
    expect(() => assertIndexSchemas({ graphDbPath: graphPath, codebaseDbPath: vecPath })).not.toThrow();
  });

  it('makes the maintainer gate report a schema version change', () => {
    const stored = { ...buildConfigFingerprint() };
    delete stored.schemaVersion;
    expect(diffConfigFingerprint(stored).map((c) => c.reason)).toContain('schema_version_changed');
    expect(diffConfigFingerprint({ ...stored, schemaVersion: SCHEMA_VERSION })).toEqual([]);
  });
});

describe('schema-migrations / encoder dependencies', () => {
  it('creates the encoder_input_dependencies table with the consumer check', () => {
    const db = new Database(':memory:');
    ensureEncoderDepsSchema(db);
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
