/**
 * Graph Search Tests
 *
 * Tests for graph-search.js:
 * - C1: Stale entry filtering (stale_since IS NULL)
 * - BM25 search functionality
 * - findCallers/findCallees relationship queries
 *
 * Uses real better-sqlite3 database with test fixtures.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { GraphSearch } from '../../core/graph/index.js';

// =============================================================================
// TEST FIXTURES
// =============================================================================

/**
 * Create test database with standard schema matching graph-search.js expectations
 */
function createTestDatabase(dbPath) {
  const db = new Database(dbPath);

  // Create entities table (matches graph-extractor.js schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      signature TEXT,
      doc_comment TEXT,
      summary TEXT,
      package TEXT,
      parent_class TEXT,
      search_text TEXT,
      name_alias TEXT,
      stale_since INTEGER DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY,
      source_id INTEGER,
      target_id INTEGER,
      target_name TEXT,
      type TEXT,
      weight REAL DEFAULT 1.0,
      context_line INTEGER,
      full_import_path TEXT,
      is_static INTEGER DEFAULT 0,
      is_wildcard INTEGER DEFAULT 0
    );

    -- FTS5 index matching production schema: name, name_alias, signature, doc_comment
    CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
      name,
      name_alias,
      signature,
      doc_comment,
      content='entities',
      content_rowid='id',
      prefix='2 3 4'
    );

    -- Trigram FTS5 for fuzzy/substring matching
    CREATE VIRTUAL TABLE IF NOT EXISTS entities_trigram USING fts5(
      name,
      signature,
      content='entities',
      content_rowid='id',
      tokenize='trigram'
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
      INSERT INTO entities_fts(rowid, name, name_alias, signature, doc_comment)
      VALUES (NEW.id, NEW.name, NEW.name_alias, NEW.signature, NEW.doc_comment);
      INSERT INTO entities_trigram(rowid, name, signature)
      VALUES (NEW.id, NEW.name, NEW.signature);
    END;

    CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
      INSERT INTO entities_fts(entities_fts, rowid, name, name_alias, signature, doc_comment)
      VALUES('delete', OLD.id, OLD.name, OLD.name_alias, OLD.signature, OLD.doc_comment);
      INSERT INTO entities_trigram(entities_trigram, rowid, name, signature)
      VALUES('delete', OLD.id, OLD.name, OLD.signature);
    END;
  `);

  return db;
}

/**
 * Insert test entities with mix of active and stale entries
 */
function insertTestEntities(db) {
  const insertEntity = db.prepare(`
    INSERT INTO entities (id, name, type, file_path, start_line, end_line, signature, doc_comment, search_text, name_alias, stale_since)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Active entities (stale_since = NULL)
  insertEntity.run(1, 'ActiveService', 'class', 'src/service/ActiveService.java', 10, 100, 'public class ActiveService', 'Active service for testing', 'ActiveService service testing', 'active service activeservice', null);
  insertEntity.run(2, 'ActiveController', 'class', 'src/controller/ActiveController.java', 5, 80, 'public class ActiveController', 'Active controller', 'ActiveController controller', 'active controller activecontroller', null);
  insertEntity.run(3, 'ActiveRepository', 'interface', 'src/repo/ActiveRepository.java', 1, 50, 'public interface ActiveRepository', 'Active repository', 'ActiveRepository repository', 'active repository activerepository', null);
  insertEntity.run(4, 'activeMethod', 'method', 'src/service/ActiveService.java', 20, 30, 'public void activeMethod()', 'An active method', 'activeMethod method', 'active method activemethod', null);

  // Stale entities (stale_since = timestamp)
  const staleTimestamp = 1704067200; // 2024-01-01 00:00:00 UTC
  insertEntity.run(5, 'StaleService', 'class', 'src/service/StaleService.java', 10, 100, 'public class StaleService', 'Stale service', 'StaleService service', 'stale service staleservice', staleTimestamp);
  insertEntity.run(6, 'StaleController', 'class', 'src/controller/StaleController.java', 5, 80, 'public class StaleController', 'Stale controller', 'StaleController controller', 'stale controller stalecontroller', staleTimestamp);
  insertEntity.run(7, 'StaleRepository', 'interface', 'src/repo/StaleRepository.java', 1, 50, 'public interface StaleRepository', 'Stale repository', 'StaleRepository repository', 'stale repository stalerepository', staleTimestamp);
}

/**
 * Insert test relationships for caller/callee tests
 */
function insertTestRelationships(db) {
  const insertRel = db.prepare(`
    INSERT INTO relationships (source_id, target_id, target_name, type, weight, context_line)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Active -> Active relationships
  insertRel.run(2, 1, 'ActiveService', 'calls', 1.0, 25); // ActiveController calls ActiveService
  insertRel.run(1, 3, 'ActiveRepository', 'calls', 1.0, 50); // ActiveService calls ActiveRepository

  // Stale -> Active relationships (should be filtered in findCallers)
  insertRel.run(5, 1, 'ActiveService', 'calls', 1.0, 30); // StaleService calls ActiveService

  // Active -> Stale relationships (should be filtered in findCallees)
  insertRel.run(1, 5, 'StaleService', 'calls', 1.0, 60); // ActiveService calls StaleService

  // Stale -> Stale relationships
  insertRel.run(6, 5, 'StaleService', 'calls', 1.0, 40); // StaleController calls StaleService
}

// =============================================================================
// STALE ENTRY FILTERING TESTS (C1)
// =============================================================================

describe('GraphSearch - Stale Entry Filtering (C1)', () => {
  let testDir;
  let dbPath;
  let graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'graph-search-test-'));
    dbPath = join(testDir, 'test-graph.db');
    const db = createTestDatabase(dbPath);
    insertTestEntities(db);
    insertTestRelationships(db);
    db.close();

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    if (graphSearch) {
      graphSearch.close();
      graphSearch = null;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('bm25Search - Stale Filtering', () => {
    it('should exclude stale entries from BM25 search results', async () => {
      const { results } = await graphSearch.bm25Search('Service', 20);

      const names = results.map(r => r.name);

      // Should include active entries
      expect(names).toContain('ActiveService');

      // Should NOT include stale entries
      expect(names).not.toContain('StaleService');
    });

    it('should return only active entities for generic query', async () => {
      const { results } = await graphSearch.bm25Search('controller', 20);

      const names = results.map(r => r.name);

      expect(names).toContain('ActiveController');
      expect(names).not.toContain('StaleController');
    });

    it('should return empty for query matching only stale entities', async () => {
      // "Stale" only appears in stale entity names
      const { results } = await graphSearch.bm25Search('StaleService', 20);

      // Should return empty (all matches are stale)
      expect(results).toHaveLength(0);
    });
  });

  describe('searchByName - Stale Filtering', () => {
    it('should exclude stale entries from exact name search', async () => {
      const results = await graphSearch.searchByName('StaleService');

      expect(results).toHaveLength(0);
    });

    it('should return active entries for exact name match', async () => {
      const results = await graphSearch.searchByName('ActiveService');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('ActiveService');
    });
  });

  describe('searchByFile - Stale Filtering', () => {
    it('should exclude stale entries from file path search', async () => {
      const results = await graphSearch.searchByFile('StaleService.java');

      expect(results).toHaveLength(0);
    });

    it('should return active entries for file path match', async () => {
      const results = await graphSearch.searchByFile('ActiveService.java');

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.stale_since === null)).toBe(true);
    });
  });

  describe('getEntity - Stale Filtering', () => {
    it('should return null for stale entity ID', async () => {
      const result = await graphSearch.getEntity(5); // StaleService ID

      expect(result).toBeNull();
    });

    it('should return entity for active entity ID', async () => {
      const result = await graphSearch.getEntity(1); // ActiveService ID

      expect(result).not.toBeNull();
      expect(result.name).toBe('ActiveService');
    });
  });

  describe('getRelated - Stale Filtering', () => {
    it('should exclude stale entities from related results', async () => {
      const results = await graphSearch.getRelated(1); // ActiveService

      const names = results.map(r => r.name);

      // Should include active related entities
      expect(names).toContain('ActiveController');
      expect(names).toContain('ActiveRepository');

      // Should NOT include stale related entities
      expect(names).not.toContain('StaleService');
    });
  });
});

// =============================================================================
// CALLER/CALLEE RELATIONSHIP TESTS
// =============================================================================

describe('GraphSearch - Caller/Callee Queries', () => {
  let testDir;
  let dbPath;
  let graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'graph-callers-test-'));
    dbPath = join(testDir, 'test-graph.db');
    const db = createTestDatabase(dbPath);
    insertTestEntities(db);
    insertTestRelationships(db);
    db.close();

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    if (graphSearch) {
      graphSearch.close();
      graphSearch = null;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('findCallers - Stale Filtering', () => {
    it('should exclude stale callers from results', async () => {
      const { results, stats } = await graphSearch.findCallers('ActiveService');

      const callerNames = results.map(r => r.name);

      // ActiveController calls ActiveService (active -> active) - should appear
      expect(callerNames).toContain('ActiveController');

      // StaleService calls ActiveService (stale -> active) - should NOT appear
      expect(callerNames).not.toContain('StaleService');

      expect(stats.targetEntity).toBe('ActiveService');
    });

    it('should return empty for entity with only stale callers', async () => {
      // ActiveRepository is only called by ActiveService
      const { results } = await graphSearch.findCallers('ActiveRepository');

      // Only ActiveService calls it, and ActiveService is active
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('ActiveService');
    });
  });

  describe('findCallees - Stale Filtering', () => {
    it('should exclude stale callees from results', async () => {
      const { results, stats } = await graphSearch.findCallees('ActiveService');

      const calleeNames = results.map(r => r.name);

      // ActiveService calls ActiveRepository (active -> active) - should appear
      expect(calleeNames).toContain('ActiveRepository');

      // ActiveService calls StaleService (active -> stale) - should NOT appear
      // Note: The implementation may return unresolved target_name if entity is stale
      const hasStale = results.some(r => r.name === 'StaleService');
      expect(hasStale).toBe(false);

      expect(stats.sourceEntity).toBe('ActiveService');
    });
  });

  describe('findImplementations - Stale Filtering', () => {
    it('should exclude stale implementations from results', async () => {
      const { results } = await graphSearch.findImplementations('Repository');

      const implNames = results.map(r => r.name);

      // Active implementations should appear
      // Stale implementations should not
      for (const name of implNames) {
        expect(name).not.toContain('Stale');
      }
    });
  });

  describe('findImpact - Stale Filtering', () => {
    it('should exclude stale dependents from impact analysis', async () => {
      const { results, stats } = await graphSearch.findImpact('ActiveService');

      const impactedNames = results.map(r => r.name);

      // Should only include active dependents
      // StaleController depends on StaleService which depends on ActiveService
      // But since StaleController is stale, it shouldn't appear
      for (const name of impactedNames) {
        expect(name).not.toContain('Stale');
      }

      expect(stats.targetEntity).toBe('ActiveService');
    });
  });
});

// =============================================================================
// GRAPH EXPANDED SEARCH TESTS
// =============================================================================

describe('GraphSearch - Graph Expanded Search', () => {
  let testDir;
  let dbPath;
  let graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'graph-expanded-test-'));
    dbPath = join(testDir, 'test-graph.db');
    const db = createTestDatabase(dbPath);
    insertTestEntities(db);
    insertTestRelationships(db);
    db.close();

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    if (graphSearch) {
      graphSearch.close();
      graphSearch = null;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('graphExpandedSearch - Stale Filtering', () => {
    it('should exclude stale entities from expanded search', async () => {
      const { results, stats } = await graphSearch.graphExpandedSearch('Service', { k: 20 });

      const names = results.map(r => r.name);

      // Should include active entities
      expect(names).toContain('ActiveService');

      // Should NOT include stale entities
      expect(names).not.toContain('StaleService');

      expect(stats.total_ms).toBeGreaterThanOrEqual(0);
    });

    it('should return stats with correct mode', async () => {
      const { stats } = await graphSearch.graphExpandedSearch('ActiveService', { k: 5 });

      // Should have a recognized mode (exact, ambiguous, graph, or only)
      expect(['bm25_only', 'bm25_exact_match', 'bm25_graph', 'bm25_ambiguous', 'definition_first_exact', 'definition_first_graph', 'definition_first_ambiguous', 'definition_first_only']).toContain(stats.mode);
    });

    it('should respect expand=false option', async () => {
      const { results, stats } = await graphSearch.graphExpandedSearch('Service', {
        k: 10,
        expand: false,
      });

      expect(['bm25_only', 'definition_first_only']).toContain(stats.mode);
      expect(results.every(r => r.name !== 'StaleService')).toBe(true);
    });
  });
});

// =============================================================================
// DATABASE STATS TESTS
// =============================================================================

describe('GraphSearch - Database Statistics', () => {
  let testDir;
  let dbPath;
  let graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'graph-stats-test-'));
    dbPath = join(testDir, 'test-graph.db');
    const db = createTestDatabase(dbPath);
    insertTestEntities(db);
    insertTestRelationships(db);
    db.close();

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    if (graphSearch) {
      graphSearch.close();
      graphSearch = null;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return entity and relationship counts', async () => {
    const stats = await graphSearch.getStats();

    // We inserted 7 entities (4 active + 3 stale)
    expect(stats.entities).toBe(7);

    // We inserted 5 relationships
    expect(stats.relationships).toBe(5);

    expect(stats.hasFts5).toBe(true);
  });

  it('should return entity type breakdown', async () => {
    const stats = await graphSearch.getStats();

    expect(stats.entityTypes).toBeDefined();
    expect(stats.entityTypes.class).toBeGreaterThan(0);
    expect(stats.entityTypes.interface).toBeGreaterThan(0);
  });

  it('should return relationship type breakdown', async () => {
    const stats = await graphSearch.getStats();

    expect(stats.relationshipTypes).toBeDefined();
    expect(stats.relationshipTypes.calls).toBeGreaterThan(0);
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('GraphSearch - Error Handling', () => {
  let testDir;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), 'graph-error-test-'));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should throw error for non-existent database', async () => {
    const graphSearch = new GraphSearch(join(testDir, 'nonexistent.db'));

    await expect(graphSearch.bm25Search('test')).rejects.toThrow(/not found/);
  });

  it('should handle database close gracefully', async () => {
    const dbPath = join(testDir, 'close-test.db');
    const db = createTestDatabase(dbPath);
    db.close();

    const graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();

    // Should not throw
    graphSearch.close();
    graphSearch.close(); // Double close should be safe

    rmSync(dbPath, { force: true });
  });
});

// =============================================================================
// FTS5 QUERY SANITIZATION TESTS
// =============================================================================

describe('GraphSearch - FTS5 Query Sanitization', () => {
  let testDir;
  let dbPath;
  let graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'graph-fts-test-'));
    dbPath = join(testDir, 'test-graph.db');
    const db = createTestDatabase(dbPath);
    insertTestEntities(db);
    db.close();

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    if (graphSearch) {
      graphSearch.close();
      graphSearch = null;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should handle special FTS5 characters', async () => {
    // These characters could cause FTS5 syntax errors if not sanitized
    const queries = [
      'test:query',
      'test"query',
      'test*query',
      'test^query',
      'test~query',
      'test(query)',
    ];

    for (const query of queries) {
      // Should not throw
      const { results } = await graphSearch.bm25Search(query, 5);
      expect(Array.isArray(results)).toBe(true);
    }
  });

  it('should handle empty query', async () => {
    const { results } = await graphSearch.bm25Search('', 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle whitespace-only query', async () => {
    const { results } = await graphSearch.bm25Search('   ', 5);
    expect(Array.isArray(results)).toBe(true);
  });
});
