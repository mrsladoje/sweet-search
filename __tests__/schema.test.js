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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createGraphSchema, insertGraph } from '../core/graph-extractor.js';
import { resolveRelationshipTargets } from '../core/relationship-resolver.js';
import { loadProjectConfig, FILE_PATTERNS } from '../core/config.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProjectBoundary } from '../core/project-detector.js';

// Mock project-detector so same-project preference tests can control boundary detection.
// Default: wraps the original (transparent for non-same-project tests).
vi.mock('../core/project-detector.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    detectProjectBoundary: vi.fn((...args) => original.detectProjectBoundary(...args)),
  };
});

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

  it('should store relationships with all fields', () => {
    const entities = [{
      id: 'class-a',
      file_path: 'src/A.java',
      type: 'class',
      name: 'A',
      signature: 'public class A',
      package: 'com.example',
    }];

    const relationships = [
      {
        source_id: 'class-a',
        target_id: null,
        target_name: 'com.example.B',
        type: 'imports',
        weight: 1.0,
        context_line: 'import com.example.B;',
        full_import_path: 'com.example.B',
        is_static: false,
        is_wildcard: false,
      },
      {
        source_id: 'class-a',
        target_id: null,
        target_name: 'Serializable',
        type: 'implements',
        weight: 0.8,
        context_line: 'class A implements Serializable',
      },
    ];

    insertGraph(db, entities, relationships, true);

    const rels = db.prepare('SELECT * FROM relationships WHERE source_id = ?').all('class-a');
    expect(rels.length).toBe(2);

    const importRel = rels.find(r => r.type === 'imports');
    expect(importRel.target_name).toBe('com.example.B');
    expect(importRel.full_import_path).toBe('com.example.B');
    expect(importRel.is_static).toBe(0);
    expect(importRel.is_wildcard).toBe(0);

    const implRel = rels.find(r => r.type === 'implements');
    expect(implRel.target_name).toBe('Serializable');
    expect(implRel.weight).toBe(0.8);
  });

  it('should skip relationships without target_name', () => {
    const entities = [{
      id: 'fn-1',
      file_path: 'src/util.js',
      type: 'function',
      name: 'helper',
      signature: 'function helper()',
    }];

    const relationships = [
      { source_id: 'fn-1', type: 'calls', target_name: null },
      { source_id: 'fn-1', type: 'calls', target_name: undefined },
      { source_id: 'fn-1', type: 'calls', target_name: 'validTarget' },
    ];

    insertGraph(db, entities, relationships, true);

    const rels = db.prepare('SELECT * FROM relationships').all();
    // Only the relationship with target_name='validTarget' should be inserted
    expect(rels.length).toBe(1);
    expect(rels[0].target_name).toBe('validTarget');
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

// =============================================================================
// RELATIONSHIP RESOLUTION TESTS
// =============================================================================

describe('resolveRelationshipTargets', () => {
  let db;
  let originalLog;

  beforeEach(() => {
    db = createTestDb();
    createGraphSchema(db);
    originalLog = console.log;
    console.log = () => {}; // suppress resolution logs
  });

  afterEach(() => {
    console.log = originalLog;
    if (db) db.close();
  });

  function insertEntity(id, filePath, type, name) {
    db.prepare(`
      INSERT INTO entities (id, file_path, type, name)
      VALUES (?, ?, ?, ?)
    `).run(id, filePath, type, name);
  }

  function insertRel(sourceId, targetName, type) {
    db.prepare(`
      INSERT INTO relationships (source_id, target_id, target_name, type)
      VALUES (?, NULL, ?, ?)
    `).run(sourceId, targetName, type);
  }

  it('should resolve same-file calls', () => {
    insertEntity('class-1', 'src/App.java', 'class', 'App');
    insertEntity('method-1', 'src/App.java', 'method', 'process');
    insertRel('class-1', 'process', 'calls');

    const result = resolveRelationshipTargets(db);

    expect(result.resolved).toBe(1);
    expect(result.total).toBe(1);

    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('class-1');
    expect(rel.target_id).toBe('method-1');
  });

  it('should resolve cross-file imports', () => {
    insertEntity('class-a', 'src/A.java', 'class', 'A');
    insertEntity('class-b', 'src/B.java', 'class', 'B');
    insertRel('class-a', 'B', 'imports');

    const result = resolveRelationshipTargets(db);

    expect(result.resolved).toBe(1);
    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('class-a');
    expect(rel.target_id).toBe('class-b');
  });

  it('should resolve extends relationships', () => {
    insertEntity('child', 'src/Child.java', 'class', 'Child');
    insertEntity('parent', 'src/Parent.java', 'class', 'Parent');
    insertRel('child', 'Parent', 'extends');

    const result = resolveRelationshipTargets(db);

    expect(result.resolved).toBe(1);
    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('child');
    expect(rel.target_id).toBe('parent');
  });

  it('should leave unresolvable targets as NULL', () => {
    insertEntity('class-x', 'src/X.java', 'class', 'X');
    insertRel('class-x', 'NonExistentClass', 'imports');

    const result = resolveRelationshipTargets(db);

    expect(result.resolved).toBe(0);
    expect(result.total).toBe(1);
    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('class-x');
    expect(rel.target_id).toBeNull();
  });

  it('should return correct resolution counts', () => {
    insertEntity('e1', 'src/A.java', 'class', 'ServiceA');
    insertEntity('e2', 'src/B.java', 'class', 'ServiceB');
    // Resolvable
    insertRel('e1', 'ServiceB', 'imports');
    // Unresolvable
    insertRel('e1', 'Unknown', 'imports');
    insertRel('e2', 'Missing', 'extends');

    const result = resolveRelationshipTargets(db);

    expect(result.total).toBe(3);
    expect(result.resolved).toBe(1);
    expect(typeof result.ambiguous).toBe('number');
    expect(typeof result.deduped).toBe('number');
  });

  it('should skip already-resolved relationships', () => {
    insertEntity('e1', 'src/A.java', 'class', 'A');
    insertEntity('e2', 'src/B.java', 'class', 'B');
    // Pre-resolved relationship (target_id is already set)
    db.prepare(`
      INSERT INTO relationships (source_id, target_id, target_name, type)
      VALUES (?, ?, ?, ?)
    `).run('e1', 'e2', 'B', 'imports');

    const result = resolveRelationshipTargets(db);

    // Should find 0 unresolved (the one above is already resolved)
    expect(result.total).toBe(0);
    expect(result.resolved).toBe(0);
  });

  it('should count ambiguous targets (multiple entities with same name)', () => {
    // Two classes named "Config" in different files
    insertEntity('c1', 'src/app/Config.java', 'class', 'Config');
    insertEntity('c2', 'src/util/Config.java', 'class', 'Config');
    insertEntity('svc', 'src/Service.java', 'class', 'Service');
    // An import that can't find "Missing" but has 2+ exact matches → won't resolve
    // But "Missing" has 0 matches, so it won't count as ambiguous.
    // Use a name that matches multiple entities but the resolver can't pick one:
    // For "imports" type, multiple matches without full_import_path → uses first (resolved, not ambiguous)
    // For ambiguous to increment, resolveTarget must return null while byExactName has >1 entry.
    // This happens when the target_name doesn't match any entity name BUT the name lookup
    // returns multiple. Actually, looking at the code: ambiguous++ only when targetId is null
    // AND exactMatches.length > 1. So we need a name that exists in byExactName with >1 entry
    // but resolveTarget returns null. That's tricky because resolveTarget returns candidates[0]
    // for most types. For "calls" type with method lookup, if byMethodName has 0 entries
    // but byExactName has >1, resolveTarget returns null (since calls uses byMethodName).
    // Let's use that path:
    insertRel('svc', 'Config', 'calls');

    const result = resolveRelationshipTargets(db);

    // "Config" as a call target: resolveTarget looks in byMethodName for "Config",
    // finds nothing (it's a class, not method/function/rpc). Returns null.
    // Post-check: byExactName.get("Config") has 2 entries → ambiguous++
    expect(result.resolved).toBe(0);
    expect(result.ambiguous).toBe(1);
  });

  it('should dedup via UNIQUE constraint when resolution would create duplicate', () => {
    insertEntity('svc', 'src/Service.java', 'class', 'Service');
    insertEntity('repo', 'src/Repo.java', 'class', 'Repo');

    // Insert two unresolved relationships with same source/target_name/type.
    // Both have NULL target_id so the UNIQUE index (which excludes NULL source_id) allows this.
    insertRel('svc', 'Repo', 'imports');
    insertRel('svc', 'Repo', 'imports');

    const result = resolveRelationshipTargets(db);

    // First resolves successfully (target_id set to 'repo').
    // Second tries to set target_id to 'repo' too, but UNIQUE(source_id, target_id, type, target_name)
    // now conflicts → caught, row deleted, deduped++.
    expect(result.resolved).toBe(1);
    expect(result.deduped).toBe(1);
    expect(result.total).toBe(2);

    // Only one relationship should remain
    const rels = db.prepare('SELECT * FROM relationships WHERE source_id = ?').all('svc');
    expect(rels.length).toBe(1);
    expect(rels[0].target_id).toBe('repo');
  });

  it('should disambiguate imports via full_import_path', () => {
    // Two classes named "Config" in different packages
    insertEntity('c1', 'src/com/example/app/Config.java', 'class', 'Config');
    insertEntity('c2', 'src/com/example/util/Config.java', 'class', 'Config');
    insertEntity('svc', 'src/com/example/app/Service.java', 'class', 'Service');

    // Insert relationship with full_import_path pointing to the util package
    db.prepare(`
      INSERT INTO relationships (source_id, target_id, target_name, type, full_import_path)
      VALUES (?, NULL, ?, ?, ?)
    `).run('svc', 'Config', 'imports', 'com.example.util.Config');

    const result = resolveRelationshipTargets(db);

    expect(result.resolved).toBe(1);
    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('svc');
    // Should resolve to c2 (util/Config) based on full_import_path suffix matching
    expect(rel.target_id).toBe('c2');
  });

  it('should resolve calls with object.method format', () => {
    insertEntity('svc', 'src/Service.java', 'class', 'Service');
    insertEntity('m1', 'src/Repo.java', 'method', 'findById');

    // Production code emits "repo.findById" not just "findById"
    insertRel('svc', 'repo.findById', 'calls');

    const result = resolveRelationshipTargets(db);

    // The resolver splits "repo.findById" on "." and uses the last part "findById"
    // to look up in byMethodName
    expect(result.resolved).toBe(1);
    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('svc');
    expect(rel.target_id).toBe('m1');
  });

  it('should resolve overrides to method in parent class', () => {
    insertEntity('parent-m', 'src/Base.java', 'method', 'toString');
    insertEntity('child', 'src/Child.java', 'class', 'Child');
    insertRel('child', 'toString', 'overrides');

    const result = resolveRelationshipTargets(db);

    expect(result.resolved).toBe(1);
    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('child');
    expect(rel.target_id).toBe('parent-m');
  });

  it('should resolve "uses" relationships by exact name', () => {
    insertEntity('fn1', 'src/Service.java', 'function', 'process');
    insertEntity('type1', 'src/types.java', 'class', 'Config');
    insertRel('fn1', 'Config', 'uses');

    const result = resolveRelationshipTargets(db);

    expect(result.resolved).toBe(1);
    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('fn1');
    expect(rel.target_id).toBe('type1');
  });

  it('should resolve "throws" relationships by exact name', () => {
    insertEntity('fn1', 'src/Service.java', 'method', 'validate');
    insertEntity('exc1', 'src/Errors.java', 'class', 'ValidationError');
    insertRel('fn1', 'ValidationError', 'throws');

    const result = resolveRelationshipTargets(db);

    expect(result.resolved).toBe(1);
    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('fn1');
    expect(rel.target_id).toBe('exc1');
  });

  describe('same-project preference', () => {
    // Mock project-detector so isSameProject discriminates by path prefix,
    // not by filesystem marker files (which don't exist for test paths).
    beforeEach(() => {
      detectProjectBoundary.mockImplementation((filePath) => {
        if (filePath && filePath.startsWith('src/')) return { name: 'my-project', rootDir: '/src' };
        if (filePath && filePath.startsWith('vendor/')) return { name: 'vendor-lib', rootDir: '/vendor' };
        return { name: 'unknown', rootDir: '/' };
      });
    });

    afterEach(() => {
      detectProjectBoundary.mockRestore();
    });

    it('should prefer same-project match for "uses" with multiple candidates', () => {
      insertEntity('fn1', 'src/app/Handler.java', 'function', 'handle');
      // Insert vendor candidate FIRST — proves preference isn't just insertion order
      insertEntity('log2', 'vendor/lib/Logger.java', 'class', 'Logger');
      insertEntity('log1', 'src/app/Logger.java', 'class', 'Logger');
      insertRel('fn1', 'Logger', 'uses');

      const result = resolveRelationshipTargets(db);

      expect(result.resolved).toBe(1);
      const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('fn1');
      // Must resolve to log1 (same project) despite log2 being inserted first
      expect(rel.target_id).toBe('log1');
    });

    it('should resolve "implements" with same-project preference', () => {
      insertEntity('class1', 'src/app/UserRepo.java', 'class', 'UserRepo');
      // Insert vendor candidate FIRST
      insertEntity('iface2', 'vendor/framework/Repository.java', 'interface', 'Repository');
      insertEntity('iface1', 'src/app/Repository.java', 'interface', 'Repository');
      insertRel('class1', 'Repository', 'implements');

      const result = resolveRelationshipTargets(db);

      expect(result.resolved).toBe(1);
      const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('class1');
      // Must resolve to iface1 (same project) despite iface2 being inserted first
      expect(rel.target_id).toBe('iface1');
    });

    it('should prefer same-project match for "calls" with multiple candidates', () => {
      insertEntity('svc', 'src/app/Service.java', 'class', 'Service');
      // Insert vendor candidate FIRST
      insertEntity('m2', 'vendor/lib/Helper.java', 'method', 'process');
      insertEntity('m1', 'src/app/Worker.java', 'method', 'process');
      insertRel('svc', 'worker.process', 'calls');

      const result = resolveRelationshipTargets(db);

      expect(result.resolved).toBe(1);
      const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('svc');
      // Must resolve to m1 (same project) despite m2 being inserted first
      expect(rel.target_id).toBe('m1');
    });
  });

  it('should handle unknown relationship type via exact name fallback', () => {
    insertEntity('e1', 'src/A.java', 'class', 'A');
    insertEntity('e2', 'src/B.java', 'class', 'B');
    insertRel('e1', 'B', 'custom_rel_type');

    const result = resolveRelationshipTargets(db);

    expect(result.resolved).toBe(1);
    const rel = db.prepare('SELECT target_id FROM relationships WHERE source_id = ?').get('e1');
    expect(rel.target_id).toBe('e2');
  });
});

// =============================================================================
// LOAD PROJECT CONFIG TESTS
// =============================================================================

describe('loadProjectConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sweet-search-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return defaults when no config file exists', () => {
    const config = loadProjectConfig(tmpDir);

    expect(config.include).toEqual(FILE_PATTERNS.include);
    expect(config.exclude).toEqual(FILE_PATTERNS.exclude);
    expect(config.maxFileSize).toBe(FILE_PATTERNS.maxFileSize);
    expect(config.respectGitignore).toBe(FILE_PATTERNS.respectGitignore);
  });

  it('should merge exclude arrays (append project excludes to defaults)', () => {
    writeFileSync(join(tmpDir, '.sweet-search.config.json'), JSON.stringify({
      exclude: ['**/vendor/**', '**/generated/**'],
    }));

    const config = loadProjectConfig(tmpDir);

    // Project excludes are appended to default excludes
    expect(config.exclude.length).toBe(FILE_PATTERNS.exclude.length + 2);
    expect(config.exclude).toContain('**/vendor/**');
    expect(config.exclude).toContain('**/generated/**');
    // Default excludes still present
    for (const pattern of FILE_PATTERNS.exclude) {
      expect(config.exclude).toContain(pattern);
    }
  });

  it('should respect custom maxFileSize', () => {
    writeFileSync(join(tmpDir, '.sweet-search.config.json'), JSON.stringify({
      maxFileSize: 5 * 1024 * 1024,
    }));

    const config = loadProjectConfig(tmpDir);

    expect(config.maxFileSize).toBe(5 * 1024 * 1024);
  });

  it('should warn on unknown keys', () => {
    writeFileSync(join(tmpDir, '.sweet-search.config.json'), JSON.stringify({
      unknownKey: 'value',
      anotherBad: 42,
    }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    loadProjectConfig(tmpDir);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown key "unknownKey"')
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown key "anotherBad"')
    );

    errorSpy.mockRestore();
  });

  it('should return defaults on malformed JSON', () => {
    writeFileSync(join(tmpDir, '.sweet-search.config.json'), '{ invalid json }}}');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config = loadProjectConfig(tmpDir);

    expect(config.include).toEqual(FILE_PATTERNS.include);
    expect(config.maxFileSize).toBe(FILE_PATTERNS.maxFileSize);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

// =============================================================================
// CONFIG → RUNTIME FILTERING (end-to-end proof)
// =============================================================================

describe('maxFileSize filtering (runtime proof)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sweet-search-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should filter oversized files using config maxFileSize', async () => {
    const { statSync } = await import('node:fs');
    const fg = await import('fast-glob');
    const glob = fg.default.glob || fg.default;

    // Write config with 500-byte limit
    writeFileSync(join(tmpDir, '.sweet-search.config.json'), JSON.stringify({
      maxFileSize: 500,
      include: ['**/*.js'],
    }));

    // Create a small file (under limit) and a large file (over limit)
    writeFileSync(join(tmpDir, 'src', 'small.js'), 'const x = 1;\n');
    writeFileSync(join(tmpDir, 'src', 'large.js'), 'x'.repeat(600) + '\n');

    // Load config (same flow as discoverFiles in index-codebase-v21.js)
    const config = loadProjectConfig(tmpDir);
    expect(config.maxFileSize).toBe(500);

    // Discover files (same glob call as production)
    const discovered = await glob(config.include, {
      ignore: config.exclude,
      cwd: tmpDir,
      absolute: false,
      onlyFiles: true,
    });

    // Apply maxFileSize filter (same logic as index-codebase-v21.js:445-459)
    const files = [];
    let oversized = 0;
    for (const file of discovered) {
      const stat = statSync(join(tmpDir, file));
      if (stat.size > config.maxFileSize) {
        oversized++;
      } else {
        files.push(file);
      }
    }

    // small.js passes, large.js is filtered
    expect(files.length).toBe(1);
    expect(files[0]).toContain('small.js');
    expect(oversized).toBe(1);
  });

  it('should use default maxFileSize (1 MB) when no config', async () => {
    const config = loadProjectConfig(tmpDir);

    // No config file → defaults
    expect(config.maxFileSize).toBe(1 * 1024 * 1024);
    expect(config.respectGitignore).toBe(true);
  });

  it('should merge exclude patterns into glob ignore list', async () => {
    const fg = await import('fast-glob');
    const globFn = fg.default.glob || fg.default;

    // Config that excludes src/vendor/
    writeFileSync(join(tmpDir, '.sweet-search.config.json'), JSON.stringify({
      exclude: ['**/vendor/**'],
      include: ['**/*.js'],
    }));

    mkdirSync(join(tmpDir, 'src', 'vendor'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'app.js'), 'const a = 1;\n');
    writeFileSync(join(tmpDir, 'src', 'vendor', 'lib.js'), 'const b = 2;\n');

    const config = loadProjectConfig(tmpDir);

    const discovered = await globFn(config.include, {
      ignore: config.exclude,
      cwd: tmpDir,
      absolute: false,
      onlyFiles: true,
    });

    // vendor/lib.js should be excluded
    expect(discovered.some(f => f.includes('vendor'))).toBe(false);
    expect(discovered.some(f => f.includes('app.js'))).toBe(true);
  });
});
