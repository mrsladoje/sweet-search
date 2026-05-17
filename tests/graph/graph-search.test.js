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
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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

function addEpochVisibilityColumns(db) {
  db.exec(`
    ALTER TABLE entities ADD COLUMN epoch_written INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE entities ADD COLUMN epoch_retired INTEGER;
    ALTER TABLE relationships ADD COLUMN epoch_written INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE relationships ADD COLUMN epoch_retired INTEGER;
  `);
}

function insertEpochVisibilityFixture(db) {
  const insertEntity = db.prepare(`
    INSERT INTO entities (
      id, name, type, file_path, start_line, end_line, signature,
      doc_comment, search_text, name_alias, stale_since, epoch_written, epoch_retired
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertEntity.run(10, 'PaymentService', 'class', 'src/old/payment.js', 1, 20, 'class PaymentService {}', 'old payment', 'PaymentService old payment', 'payment service', null, 1, 3);
  insertEntity.run(11, 'PaymentService', 'class', 'src/new/payment.js', 1, 20, 'class PaymentService {}', 'new payment', 'PaymentService new payment', 'payment service', null, 3, null);
  insertEntity.run(12, 'RemovedService', 'class', 'src/old/removed.js', 1, 20, 'class RemovedService {}', 'removed service', 'RemovedService', 'removed service', 1704067200, 1, 3);
  insertEntity.run(13, 'FutureService', 'class', 'src/future/service.js', 1, 20, 'class FutureService {}', 'future service', 'FutureService', 'future service', null, 7, null);
  insertEntity.run(20, 'Caller', 'class', 'src/caller.js', 1, 20, 'class Caller {}', 'caller', 'Caller payment', 'caller', null, 1, null);

  const insertRel = db.prepare(`
    INSERT INTO relationships (
      source_id, target_id, target_name, type, weight, context_line, epoch_written, epoch_retired
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRel.run(20, 10, 'PaymentService', 'calls', 1.0, 7, 1, 3);
  insertRel.run(20, 11, 'PaymentService', 'calls', 1.0, 8, 3, null);
}

// =============================================================================
// STALE ENTRY FILTERING TESTS (C1)
// =============================================================================

describe('GraphSearch - SQL Alias Handling', () => {
  it('normalizes dotted aliases in visibility and summary SQL fragments', () => {
    const graphSearch = new GraphSearch('/tmp/non-existent-code-graph.db');
    try {
      graphSearch._manifestEpoch = 4;
      graphSearch._hasEntityEpochVisibility = true;
      graphSearch._hasRelationshipEpochVisibility = true;
      graphSearch._hasHcgsSummaryMetadata = true;

      expect(graphSearch._entityVisibilitySql('e.')).toContain('e.epoch_written');
      expect(graphSearch._entityVisibilitySql('e.')).not.toContain('e..');
      expect(graphSearch._entityVisibilitySql('e')).toBe(graphSearch._entityVisibilitySql('e.'));
      expect(graphSearch._relationshipVisibilitySql('r.')).toContain('r.epoch_written');
      expect(graphSearch._relationshipVisibilitySql('r.')).not.toContain('r..');
      expect(graphSearch._relationshipVisibilitySql('r')).toBe(graphSearch._relationshipVisibilitySql('r.'));
      expect(graphSearch._summaryJoinSql('entities.')).toContain('hm.entity_id = entities.id');
      expect(graphSearch._summaryJoinSql('entities.')).not.toContain('entities..');
      expect(graphSearch._summarySelectSql('entities.')).toContain('entities.summary');
      expect(graphSearch._summarySelectSql('entities.')).not.toContain('entities..');
    } finally {
      graphSearch.close();
    }
  });
});

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

describe('GraphSearch - Reconcile Epoch Visibility', () => {
  let testDir;
  let dbPath;
  let graphSearch;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'graph-search-epoch-'));
    dbPath = join(testDir, 'test-graph.db');
    const db = createTestDatabase(dbPath);
    addEpochVisibilityColumns(db);
    insertEpochVisibilityFixture(db);
    db.close();
  });

  afterEach(() => {
    if (graphSearch) {
      graphSearch.close();
      graphSearch = null;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it('pins FTS5/trigram/entity reads to the supplied manifest epoch', async () => {
    graphSearch = new GraphSearch(dbPath, { manifestEpoch: 2 });
    await graphSearch.init();

    const { results } = await graphSearch.bm25Search('PaymentService', 10);
    expect(results.map((r) => r.file)).toEqual(['src/old/payment.js']);
    expect((await graphSearch.searchByName('PaymentService')).map((r) => r.file_path)).toEqual(['src/old/payment.js']);
    expect((await graphSearch.searchByFile('payment.js')).map((r) => r.file_path)).toEqual(['src/old/payment.js']);
    expect((await graphSearch.getEntity(10))?.file_path).toBe('src/old/payment.js');
    expect(await graphSearch.getEntity(11)).toBeNull();
    expect((await graphSearch.bm25Search('FutureService', 10)).results).toHaveLength(0);
  });

  it('uses adjacent reconcile-manifest.json when no explicit epoch is supplied', async () => {
    writeFileSync(join(testDir, 'reconcile-manifest.json'), JSON.stringify({ epoch: 2 }));
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();

    const { results } = await graphSearch.bm25SearchRaw('PaymentService', 10);
    expect(results.map((r) => r.file)).toEqual(['src/old/payment.js']);
  });

  it('opens the code graph path named by the adjacent reconcile manifest', async () => {
    const manifestDbPath = join(testDir, 'code-graph-epoch-5.db');
    const db = createTestDatabase(manifestDbPath);
    addEpochVisibilityColumns(db);
    db.prepare(`
      INSERT INTO entities (
        id, name, type, file_path, start_line, end_line, signature,
        doc_comment, search_text, name_alias, stale_since, epoch_written, epoch_retired
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      30,
      'ManifestService',
      'class',
      'src/manifest/service.js',
      1,
      20,
      'class ManifestService {}',
      'manifest graph',
      'ManifestService manifest graph',
      'manifest service',
      null,
      5,
      null,
    );
    db.close();
    writeFileSync(join(testDir, 'reconcile-manifest.json'), JSON.stringify({
      epoch: 5,
      codeGraph: { path: 'code-graph-epoch-5.db', epoch: 5 },
    }));

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();

    const { results } = await graphSearch.bm25SearchRaw('ManifestService', 10);
    expect(results.map((r) => r.file)).toEqual(['src/manifest/service.js']);
    expect((await graphSearch.bm25SearchRaw('PaymentService', 10)).results).toHaveLength(0);
  });

  it('uses the manifest code graph path when an explicit epoch is supplied', async () => {
    const manifestDbPath = join(testDir, 'code-graph-epoch-5.db');
    const db = createTestDatabase(manifestDbPath);
    addEpochVisibilityColumns(db);
    db.prepare(`
      INSERT INTO entities (
        id, name, type, file_path, start_line, end_line, signature,
        doc_comment, search_text, name_alias, stale_since, epoch_written, epoch_retired
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      31,
      'PinnedManifestService',
      'class',
      'src/manifest/pinned.js',
      1,
      20,
      'class PinnedManifestService {}',
      'manifest graph',
      'PinnedManifestService manifest graph',
      'pinned manifest service',
      null,
      5,
      null,
    );
    db.close();
    writeFileSync(join(testDir, 'reconcile-manifest.json'), JSON.stringify({
      epoch: 7,
      codeGraph: { path: 'code-graph-epoch-5.db', epoch: 7 },
    }));

    graphSearch = new GraphSearch(dbPath, { manifestEpoch: 5 });
    await graphSearch.init();

    const { results } = await graphSearch.bm25SearchRaw('PinnedManifestService', 10);
    expect(results.map((r) => r.file)).toEqual(['src/manifest/pinned.js']);
    expect((await graphSearch.bm25SearchRaw('PaymentService', 10)).results).toHaveLength(0);
  });

  it('refreshes adjacent manifest changes for long-lived graph readers', async () => {
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
    expect((await graphSearch.bm25SearchRaw('PaymentService', 10)).results.map((r) => r.file)).toEqual(['src/new/payment.js']);

    writeFileSync(join(testDir, 'reconcile-manifest.json'), JSON.stringify({ epoch: 2 }));
    graphSearch.refreshManifestEpoch();

    expect((await graphSearch.bm25SearchRaw('PaymentService', 10)).results.map((r) => r.file)).toEqual(['src/old/payment.js']);
  });

  it('hides retired rows by default and keeps unretired live rows visible', async () => {
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();

    const { results } = await graphSearch.bm25Search('PaymentService', 10);
    expect(results.map((r) => r.file)).toEqual(['src/new/payment.js']);
    expect((await graphSearch.bm25Search('FutureService', 10)).results).toHaveLength(1);
    expect((await graphSearch.bm25Search('RemovedService', 10)).results).toHaveLength(0);
  });

  it('keeps rows retired after the pinned epoch visible even when stale_since is set', async () => {
    graphSearch = new GraphSearch(dbPath, { manifestEpoch: 2 });
    await graphSearch.init();

    const { results } = await graphSearch.bm25Search('RemovedService', 10);
    expect(results.map((r) => r.file)).toEqual(['src/old/removed.js']);
  });

  it('does not report future-retired entities as stale for a pinned reader', async () => {
    graphSearch = new GraphSearch(dbPath, { manifestEpoch: 2 });
    await graphSearch.init();

    const staleAtEpoch2 = await graphSearch.getStaleEntityIds();
    expect(staleAtEpoch2.has(12)).toBe(false);
    graphSearch.close();

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
    const staleNow = await graphSearch.getStaleEntityIds();
    expect(staleNow.has(12)).toBe(true);
  });

  it('filters relationship expansion by entity and relationship epochs', async () => {
    graphSearch = new GraphSearch(dbPath, { manifestEpoch: 2 });
    await graphSearch.init();

    const relatedAtEpoch2 = await graphSearch.getRelated(20);
    expect(relatedAtEpoch2.map((r) => r.file_path)).toEqual(['src/old/payment.js']);
    graphSearch.close();

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
    const relatedNow = await graphSearch.getRelated(20);
    expect(relatedNow.map((r) => r.file_path)).toEqual(['src/new/payment.js']);
  });

  it('does not resolve a hidden target_id relationship by target_name fallback', async () => {
    const db = new Database(dbPath);
    try {
      db.prepare(`
        INSERT INTO entities (
          id, name, type, file_path, start_line, end_line, signature,
          doc_comment, search_text, name_alias, stale_since, epoch_written, epoch_retired
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(14, 'CollisionService', 'class', 'src/collision.js', 1, 20, 'class CollisionService {}', 'collision', 'CollisionService', 'collision service', null, 1, null);
      db.prepare(`
        INSERT INTO relationships (
          source_id, target_id, target_name, type, weight, context_line, epoch_written, epoch_retired
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(20, 13, 'CollisionService', 'calls', 9.0, 9, 2, null);
    } finally {
      db.close();
    }

    graphSearch = new GraphSearch(dbPath, { manifestEpoch: 2 });
    await graphSearch.init();

    const related = await graphSearch.getRelated(20);
    expect(related.map((r) => r.name)).not.toContain('CollisionService');
  });

  it('does not return summaries retired at the pinned manifest epoch', async () => {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE hcgs_summary_metadata (
        entity_id TEXT PRIMARY KEY,
        source_entity_ids TEXT NOT NULL,
        source_chunk_struct_ids TEXT NOT NULL,
        source_hashes TEXT NOT NULL,
        epoch_written INTEGER NOT NULL DEFAULT 0,
        epoch_retired INTEGER
      ) WITHOUT ROWID
    `);
    db.prepare('UPDATE entities SET summary = ? WHERE id = ?').run('stale old summary', 10);
    db.prepare('UPDATE entities SET summary = ? WHERE id = ?').run('stale caller summary', 20);
    db.prepare(`
      INSERT INTO hcgs_summary_metadata (
        entity_id, source_entity_ids, source_chunk_struct_ids, source_hashes, epoch_written, epoch_retired
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('10', '[]', '[]', '{}', 1, 2);
    db.prepare(`
      INSERT INTO hcgs_summary_metadata (
        entity_id, source_entity_ids, source_chunk_struct_ids, source_hashes, epoch_written, epoch_retired
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('20', '[]', '[]', '{}', 1, 2);
    db.close();

    graphSearch = new GraphSearch(dbPath, { manifestEpoch: 2 });
    await graphSearch.init();

    const { byName } = await graphSearch.findEntitiesBatch([{ name: 'PaymentService' }]);
    expect(byName.get('PaymentService')?.file_path).toBe('src/old/payment.js');
    expect(byName.get('PaymentService')?.summary).toBeNull();

    const entity = await graphSearch.getEntity(10);
    expect(entity?.summary).toBeNull();

    const related = await graphSearch.getRelated(20);
    expect(related.find((row) => row.id === 10)?.summary).toBeNull();

    expect((await graphSearch.searchByName('PaymentService')).find((row) => row.id === 10)?.summary).toBeNull();
    expect((await graphSearch.searchByFile('old/payment.js')).find((row) => row.id === 10)?.summary).toBeNull();

    const callers = await graphSearch.findCallers('PaymentService');
    expect(callers.results.find((row) => row.name === 'Caller')?.summary).toBeNull();

    const impact = await graphSearch.findImpact('PaymentService', { maxDepth: 1 });
    expect(impact.results.find((row) => row.name === 'Caller')?.summary).toBeNull();

    const expanded = await graphSearch.expandGraph([10], 1);
    expect(expanded.find((row) => row.id === 10)?.summary).toBeNull();
  });

  it('does not cache live HCGS summary visibility after sidecar retirement', async () => {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE hcgs_summary_metadata (
        entity_id TEXT PRIMARY KEY,
        source_entity_ids TEXT NOT NULL,
        source_chunk_struct_ids TEXT NOT NULL,
        source_hashes TEXT NOT NULL,
        epoch_written INTEGER NOT NULL DEFAULT 0,
        epoch_retired INTEGER
      ) WITHOUT ROWID
    `);
    db.prepare('UPDATE entities SET summary = ? WHERE id = ?').run('live summary', 11);
    db.prepare(`
      INSERT INTO hcgs_summary_metadata (
        entity_id, source_entity_ids, source_chunk_struct_ids, source_hashes, epoch_written, epoch_retired
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('11', '[]', '[]', '{}', 3, null);
    db.close();

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
    expect((await graphSearch.getEntity(11))?.summary).toBe('live summary');

    const writer = new Database(dbPath);
    writer.prepare('UPDATE hcgs_summary_metadata SET epoch_retired = ? WHERE entity_id = ?').run(4, '11');
    writer.close();

    expect((await graphSearch.getEntity(11))?.summary).toBeNull();
  });

  it('detects HCGS sidecar creation after a live reader has opened', async () => {
    const db = new Database(dbPath);
    db.prepare('UPDATE entities SET summary = ? WHERE id = ?').run('pre-sidecar summary', 11);
    db.close();

    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
    expect((await graphSearch.getEntity(11))?.summary).toBe('pre-sidecar summary');

    const writer = new Database(dbPath);
    writer.exec(`
      CREATE TABLE hcgs_summary_metadata (
        entity_id TEXT PRIMARY KEY,
        source_entity_ids TEXT NOT NULL,
        source_chunk_struct_ids TEXT NOT NULL,
        source_hashes TEXT NOT NULL,
        epoch_written INTEGER NOT NULL DEFAULT 0,
        epoch_retired INTEGER
      ) WITHOUT ROWID
    `);
    writer.prepare(`
      INSERT INTO hcgs_summary_metadata (
        entity_id, source_entity_ids, source_chunk_struct_ids, source_hashes, epoch_written, epoch_retired
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('11', '[]', '[]', '{}', 3, 4);
    writer.close();

    expect((await graphSearch.getEntity(11))?.summary).toBeNull();
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
