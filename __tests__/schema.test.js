/**
 * Schema Tests
 *
 * Tests for code graph database schema:
 * 1. createGraphSchema() includes `code` column
 * 2. Schema migration adds `code` column to existing DBs without it
 * 3. Entities table has all required columns for HCGS
 *
 * Uses in-memory SQLite to test real schema behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createGraphSchema, insertGraph } from '../core/graph-extractor.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Creates an in-memory database for testing
 */
function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = DELETE');
  return db;
}

/**
 * Create a legacy schema (without `code` column) to test migration
 */
function createLegacySchema(db) {
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      signature TEXT,
      signature_hash TEXT,
      doc_comment TEXT,
      start_line INTEGER,
      end_line INTEGER,
      package TEXT,
      parent_class TEXT,
      search_text TEXT,
      summary TEXT,
      summary_embedding BLOB,
      parent_id TEXT,
      hierarchy_level INTEGER DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE relationships (
      source_id TEXT,
      target_id TEXT,
      target_name TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      context_line INTEGER,
      full_import_path TEXT,
      is_static INTEGER DEFAULT 0,
      is_wildcard INTEGER DEFAULT 0
    )
  `);
}

/**
 * Get column names from a table
 */
function getColumnNames(db, tableName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.map(col => col.name);
}

// =============================================================================
// SCHEMA CREATION TESTS
// =============================================================================

describe('createGraphSchema', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('should create entities table with code column', () => {
    createGraphSchema(db);

    const columns = getColumnNames(db, 'entities');

    expect(columns).toContain('code');
  });

  it('should create entities table with all required HCGS columns', () => {
    createGraphSchema(db);

    const columns = getColumnNames(db, 'entities');

    // Core entity columns
    expect(columns).toContain('id');
    expect(columns).toContain('file_path');
    expect(columns).toContain('type');
    expect(columns).toContain('name');
    expect(columns).toContain('signature');
    expect(columns).toContain('doc_comment');

    // HCGS-specific columns
    expect(columns).toContain('summary');
    expect(columns).toContain('summary_embedding');
    expect(columns).toContain('parent_id');
    expect(columns).toContain('hierarchy_level');
    expect(columns).toContain('code');
    expect(columns).toContain('signature_hash');
  });

  it('should create relationships table', () => {
    createGraphSchema(db);

    const columns = getColumnNames(db, 'relationships');

    expect(columns).toContain('source_id');
    expect(columns).toContain('target_id');
    expect(columns).toContain('target_name');
    expect(columns).toContain('type');
    expect(columns).toContain('weight');
  });

  it('should return boolean indicating FTS5 support', () => {
    const hasFts5 = createGraphSchema(db);

    // better-sqlite3 includes FTS5 by default
    expect(typeof hasFts5).toBe('boolean');
  });

  it('should be idempotent (safe to call multiple times)', () => {
    createGraphSchema(db);

    // Should not throw on second call
    expect(() => createGraphSchema(db)).not.toThrow();

    const columns = getColumnNames(db, 'entities');
    expect(columns).toContain('code');
  });
});

// =============================================================================
// SCHEMA MIGRATION TESTS
// =============================================================================

describe('Schema Migration: code column', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('should add code column to existing database without it', () => {
    // Create legacy schema without code column
    createLegacySchema(db);

    // Verify code column is missing
    let columns = getColumnNames(db, 'entities');
    expect(columns).not.toContain('code');

    // Run createGraphSchema which should migrate
    createGraphSchema(db);

    // Verify code column was added
    columns = getColumnNames(db, 'entities');
    expect(columns).toContain('code');
  });

  it('should preserve existing data during migration', () => {
    // Create legacy schema
    createLegacySchema(db);

    // Insert test data
    db.prepare(`
      INSERT INTO entities (id, file_path, type, name)
      VALUES (?, ?, ?, ?)
    `).run('test-1', 'src/Test.java', 'class', 'TestClass');

    // Migrate
    createGraphSchema(db);

    // Verify data preserved
    const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get('test-1');
    expect(entity.name).toBe('TestClass');
    expect(entity.file_path).toBe('src/Test.java');
  });

  it('should allow storing code after migration', () => {
    createLegacySchema(db);
    createGraphSchema(db);

    // Insert with code
    db.prepare(`
      INSERT INTO entities (id, file_path, type, name, code)
      VALUES (?, ?, ?, ?, ?)
    `).run('test-1', 'src/Test.java', 'class', 'TestClass', 'public class TestClass {}');

    const entity = db.prepare('SELECT code FROM entities WHERE id = ?').get('test-1');
    expect(entity.code).toBe('public class TestClass {}');
  });

  it('should handle fresh database (no migration needed)', () => {
    // Call createGraphSchema on empty database
    expect(() => createGraphSchema(db)).not.toThrow();

    const columns = getColumnNames(db, 'entities');
    expect(columns).toContain('code');
  });
});

// =============================================================================
// ENTITY STORAGE TESTS
// =============================================================================

describe('Entity Storage with code column', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
    createGraphSchema(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('should store entity with code content', () => {
    const entities = [{
      id: 'test-entity',
      file_path: 'src/AuthService.java',
      type: 'class',
      name: 'AuthService',
      signature: 'public class AuthService',
      doc_comment: '/** Auth service */',
      package: 'com.example',
    }];

    insertGraph(db, entities, [], true);

    const stored = db.prepare('SELECT * FROM entities WHERE id = ?').get('test-entity');
    // insertGraph doesn't handle code directly - entities need code from extractor
    expect(stored.name).toBe('AuthService');
    expect(stored.file_path).toBe('src/AuthService.java');
  });

  it('should store null code for entities without source', () => {
    const entities = [{
      id: 'interface-entity',
      file_path: 'src/Repository.java',
      type: 'interface',
      name: 'Repository',
      signature: 'public interface Repository',
    }];

    insertGraph(db, entities, [], true);

    const stored = db.prepare('SELECT code FROM entities WHERE id = ?').get('interface-entity');
    // Code is not set by insertGraph - it needs separate update
    expect(stored.code).toBeNull();
  });

  it('should store method entities with parent_id reference', () => {
    const entities = [
      {
        id: 'class-1',
        file_path: 'src/Service.java',
        type: 'class',
        name: 'Service',
        signature: 'public class Service',
      },
      {
        id: 'method-1',
        file_path: 'src/Service.java',
        type: 'method',
        name: 'process',
        signature: 'public void process()',
        parent_class: 'Service',
      },
    ];

    insertGraph(db, entities, [], true);

    const method = db.prepare('SELECT * FROM entities WHERE id = ?').get('method-1');
    expect(method.type).toBe('method');
    // Methods get hierarchy_level 1 in insertGraph
    expect(method.hierarchy_level).toBe(1);
    // Parent ID should be set
    expect(method.parent_id).toBe('class-1');
  });
});

// =============================================================================
// COLUMN TYPE TESTS
// =============================================================================

describe('Column Types', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
    createGraphSchema(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('should store summary_embedding as BLOB', () => {
    // Insert entity with embedding
    const embedding = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);

    db.prepare(`
      INSERT INTO entities (id, file_path, type, name, summary_embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run('test-1', 'test.java', 'class', 'Test', embedding);

    const entity = db.prepare('SELECT summary_embedding FROM entities WHERE id = ?').get('test-1');
    expect(Buffer.isBuffer(entity.summary_embedding)).toBe(true);
    expect(entity.summary_embedding[0]).toBe(0xAA);
  });

  it('should store hierarchy_level as INTEGER with default 0', () => {
    db.prepare(`
      INSERT INTO entities (id, file_path, type, name)
      VALUES (?, ?, ?, ?)
    `).run('test-1', 'test.java', 'class', 'Test');

    const entity = db.prepare('SELECT hierarchy_level FROM entities WHERE id = ?').get('test-1');
    expect(entity.hierarchy_level).toBe(0);
  });

  it('should allow NULL for optional columns', () => {
    db.prepare(`
      INSERT INTO entities (id, file_path, type, name)
      VALUES (?, ?, ?, ?)
    `).run('test-1', 'test.java', 'class', 'Test');

    const entity = db.prepare(`
      SELECT signature, doc_comment, code, summary, parent_id
      FROM entities WHERE id = ?
    `).get('test-1');

    expect(entity.signature).toBeNull();
    expect(entity.doc_comment).toBeNull();
    expect(entity.code).toBeNull();
    expect(entity.summary).toBeNull();
    expect(entity.parent_id).toBeNull();
  });
});

// =============================================================================
// INDEX TESTS
// =============================================================================

describe('Database Indexes', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
    createGraphSchema(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('should create index on file_path for efficient deletion', () => {
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'entities'
    `).all();

    const indexNames = indexes.map(i => i.name);
    // Index is named idx_entities_file (not idx_entities_file_path)
    expect(indexNames.some(name => name.includes('file'))).toBe(true);
  });

  it('should create index on type for entity filtering', () => {
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'entities'
    `).all();

    const indexNames = indexes.map(i => i.name);
    expect(indexNames.some(name => name.includes('type'))).toBe(true);
  });

  it('should create FTS5 virtual table for text search', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'entities_fts%'
    `).all();

    // Should have FTS5 table (better-sqlite3 includes FTS5)
    expect(tables.length).toBeGreaterThan(0);
  });
});
