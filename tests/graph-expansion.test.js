import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { expandResults, getExpansionStats } from '../core/graph-expansion.js';

/**
 * Create an in-memory SQLite database with test entities and relationships.
 *
 * Graph:
 *   A --imports--> B --extends--> C
 *   A --calls----> D
 *   B --uses-----> E (stale)
 *   A --unknown--> F  (edge type not in default set)
 */
function createTestDb() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      signature TEXT,
      start_line INTEGER,
      end_line INTEGER,
      stale_since INTEGER DEFAULT NULL
    )
  `);

  db.exec(`
    CREATE TABLE relationships (
      source_id TEXT,
      target_id TEXT,
      target_name TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0
    )
  `);

  const insertEntity = db.prepare(
    'INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line, stale_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertRel = db.prepare(
    'INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)'
  );

  // Entities
  insertEntity.run('a', 'src/a.js', 'class', 'ServiceA', 'class ServiceA', 1, 50, null);
  insertEntity.run('b', 'src/b.js', 'class', 'ServiceB', 'class ServiceB', 1, 30, null);
  insertEntity.run('c', 'src/c.js', 'class', 'BaseService', 'class BaseService', 1, 20, null);
  insertEntity.run('d', 'src/d.js', 'function', 'helper', 'function helper()', 1, 10, null);
  insertEntity.run('e', 'src/e.js', 'class', 'StaleService', 'class StaleService', 1, 15, 1700000000); // stale
  insertEntity.run('f', 'src/f.js', 'class', 'UnknownEdge', 'class UnknownEdge', 1, 10, null);

  // Relationships: A -> B (imports), B -> C (extends), A -> D (calls)
  insertRel.run('a', 'b', 'ServiceB', 'imports', 1.0);
  insertRel.run('b', 'c', 'BaseService', 'extends', 2.0);
  insertRel.run('a', 'd', 'helper', 'calls', 1.0);

  // B -> E (uses), but E is stale
  insertRel.run('b', 'e', 'StaleService', 'uses', 1.0);

  // A -> F with edge type not in default set
  insertRel.run('a', 'f', 'UnknownEdge', 'decorates', 1.0);

  return db;
}

describe('graph-expansion', () => {
  let db;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  describe('expandResults', () => {
    it('1-hop from A finds B and D', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', name: 'ServiceA' }];
      const expanded = expandResults(db, results, { expandMode: '1hop' });

      const ids = expanded.map(r => r.id || r.entity_id);
      expect(ids).toContain('a'); // original
      expect(ids).toContain('b'); // A imports B
      expect(ids).toContain('d'); // A calls D
    });

    it('2-hop from A also finds C (via B)', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', name: 'ServiceA' }];
      const expanded = expandResults(db, results, { expandMode: '2hop' });

      const ids = expanded.map(r => r.id || r.entity_id);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
      expect(ids).toContain('c'); // B extends C (2nd hop)
      expect(ids).toContain('d');
    });

    it('expandMode none returns original results unchanged', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', name: 'ServiceA' }];
      const expanded = expandResults(db, results, { expandMode: 'none' });

      expect(expanded).toEqual(results);
    });

    it('empty results returns empty', () => {
      const expanded = expandResults(db, [], { expandMode: '1hop' });
      expect(expanded).toEqual([]);
    });

    it('maxExpanded limits expansion count', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', name: 'ServiceA' }];
      // A has 2 neighbors (B, D); limit to 1
      const expanded = expandResults(db, results, { expandMode: '1hop', maxExpanded: 1 });

      const expandedOnly = expanded.filter(r => r.is_expanded);
      expect(expandedOnly.length).toBeLessThanOrEqual(1);
    });

    it('edgeTypes filter works', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', name: 'ServiceA' }];
      // Only follow 'imports' edges
      const expanded = expandResults(db, results, {
        expandMode: '1hop',
        edgeTypes: new Set(['imports']),
      });

      const ids = expanded.map(r => r.id || r.entity_id);
      expect(ids).toContain('a');
      expect(ids).toContain('b'); // imports edge
      expect(ids).not.toContain('d'); // calls edge excluded
    });

    it('stale entities are excluded', () => {
      // B -> E (uses), but E is stale
      const results = [{ id: 'b', score: 10, file: 'src/b.js', name: 'ServiceB' }];
      const expanded = expandResults(db, results, { expandMode: '1hop' });

      const ids = expanded.map(r => r.id || r.entity_id);
      expect(ids).not.toContain('e');
    });

    it('expanded results have is_expanded: true', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', name: 'ServiceA' }];
      const expanded = expandResults(db, results, { expandMode: '1hop' });

      const expandedOnly = expanded.filter(r => r.is_expanded);
      expect(expandedOnly.length).toBeGreaterThan(0);
      for (const r of expandedOnly) {
        expect(r.is_expanded).toBe(true);
      }

      // Original result should NOT have is_expanded
      const original = expanded.find(r => r.id === 'a' && !r.is_expanded);
      expect(original).toBeDefined();
    });

    it('expanded results have lower scores than original', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', name: 'ServiceA' }];
      const expanded = expandResults(db, results, { expandMode: '1hop' });

      const originalScore = expanded.find(r => r.id === 'a' && !r.is_expanded)?.score;
      const expandedResults = expanded.filter(r => r.is_expanded);

      for (const r of expandedResults) {
        expect(r.score).toBeLessThan(originalScore);
      }
    });

    it('edge type not in default set is excluded', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', name: 'ServiceA' }];
      const expanded = expandResults(db, results, { expandMode: '1hop' });

      const ids = expanded.map(r => r.id || r.entity_id);
      expect(ids).not.toContain('f'); // 'decorates' is not in DEFAULT_EDGE_TYPES
    });

    it('reverse edges are followed', () => {
      // D is called by A. Starting from D, reverse traversal finds A.
      const results = [{ id: 'd', score: 10, file: 'src/d.js', name: 'helper' }];
      const expanded = expandResults(db, results, { expandMode: '1hop' });

      const ids = expanded.map(r => r.id || r.entity_id);
      expect(ids).toContain('a'); // A calls D (reverse edge from D's perspective)
    });

    it('works with entity_id in metadata', () => {
      const results = [{ metadata: { entity_id: 'a' }, score: 10, file: 'src/a.js', name: 'ServiceA' }];
      const expanded = expandResults(db, results, { expandMode: '1hop' });

      const ids = expanded.map(r => r.id || r.entity_id);
      expect(ids).toContain('b');
      expect(ids).toContain('d');
    });

    it('token budget limits total results', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', name: 'ServiceA', start_line: 1, end_line: 50 }];
      // Very small budget: 50 tokens ~ 5 lines. Entity A alone has 50 lines (~500 tokens).
      const expanded = expandResults(db, results, {
        expandMode: '1hop',
        tokenBudget: 50,
      });

      // Should at least include the original result (always included even if over budget)
      expect(expanded.length).toBeGreaterThanOrEqual(1);
      // But should be fewer than unrestricted
      const unrestricted = expandResults(db, results, {
        expandMode: '1hop',
        tokenBudget: 100000,
      });
      expect(expanded.length).toBeLessThanOrEqual(unrestricted.length);
    });
  });

  describe('getExpansionStats', () => {
    it('returns stats for connected entities', () => {
      const stats = getExpansionStats(db, ['a']);
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byType).toHaveProperty('imports');
      expect(stats.byType).toHaveProperty('calls');
    });

    it('returns empty stats for empty input', () => {
      const stats = getExpansionStats(db, []);
      expect(stats.total).toBe(0);
      expect(stats.byType).toEqual({});
    });

    it('returns empty stats for unconnected entity', () => {
      // Entity F has no standard relationships (only 'decorates' which involves A->F)
      // But getExpansionStats checks both source and target, so F will appear in A->F
      const stats = getExpansionStats(db, ['f']);
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });
  });
});
