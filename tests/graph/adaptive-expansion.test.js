import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { expandResults, applyTokenBudget, rerankExpanded } from '../../core/graph/graph-expansion.js';

/**
 * Create a test graph for adaptive 2-hop expansion.
 *
 * Graph:
 *   A --imports--> B --extends--> C (weight=2.0, priority)
 *                  B --calls----> H (weight=1.0, non-priority)
 *                  B --calls----> G (dedup: G already in 1-hop)
 *   A --calls----> D --implements-> J (weight=3.0, priority)
 *                  D --uses------> K (weight=1.0, non-priority)
 *   A --uses-----> G
 *
 * Adaptive scoring: (effectiveAlpha^2 * weight * EDGE_PRIORITY) / sqrt(outDegree)
 *   J: (0.80^2 * 3.0 * 4) / sqrt(2) ≈ 5.43 (highest)
 *   C: (0.80^2 * 2.0 * 4) / sqrt(4) ≈ 2.56
 *   H: (0.60^2 * 1.0 * 2) / sqrt(4) ≈ 0.36
 *   K: (0.55^2 * 1.0 * 1) / sqrt(2) ≈ 0.21 (lowest)
 */
function createAdaptiveTestDb() {
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

  // Entities with known line ranges for token estimation (10 tokens/line)
  insertEntity.run('a', 'src/a.js', 'class', 'ServiceA', 'class ServiceA', 1, 50, null);   // 500 tokens
  insertEntity.run('b', 'src/b.js', 'class', 'ServiceB', 'class ServiceB', 1, 30, null);   // 300 tokens
  insertEntity.run('c', 'src/c.js', 'class', 'BaseC', 'class BaseC', 1, 20, null);         // 200 tokens
  insertEntity.run('d', 'src/d.js', 'function', 'helperD', 'function helperD()', 1, 10, null); // 100 tokens
  insertEntity.run('g', 'src/g.js', 'class', 'SharedG', 'class SharedG', 1, 30, null);     // 300 tokens
  insertEntity.run('h', 'src/h.js', 'class', 'UtilH', 'class UtilH', 1, 50, null);         // 500 tokens
  insertEntity.run('j', 'src/j.js', 'interface', 'InterfaceJ', 'interface InterfaceJ', 1, 15, null); // 150 tokens
  insertEntity.run('k', 'src/k.js', 'class', 'HelperK', 'class HelperK', 1, 40, null);     // 400 tokens
  insertEntity.run('stale1', 'src/stale.js', 'class', 'Stale', 'class Stale', 1, 5, 1700000000); // stale

  // 1-hop edges from A
  insertRel.run('a', 'b', 'ServiceB', 'imports', 1.0);
  insertRel.run('a', 'd', 'helperD', 'calls', 1.0);
  insertRel.run('a', 'g', 'SharedG', 'uses', 1.0);

  // 2-hop edges from B
  insertRel.run('b', 'c', 'BaseC', 'extends', 2.0);      // score ≈ 2.56, 200 tokens
  insertRel.run('b', 'h', 'UtilH', 'calls', 1.0);        // score ≈ 0.36, 500 tokens
  insertRel.run('b', 'g', 'SharedG', 'calls', 1.0);       // dedup: G already in 1-hop

  // 2-hop edges from D
  insertRel.run('d', 'j', 'InterfaceJ', 'implements', 3.0); // score ≈ 5.43, 150 tokens
  insertRel.run('d', 'k', 'HelperK', 'uses', 1.0);          // score ≈ 0.21, 400 tokens

  // Edge to stale entity (should be excluded by JOIN filter)
  insertRel.run('b', 'stale1', 'Stale', 'imports', 1.0);

  return db;
}

describe('adaptive graph expansion', () => {
  let db;

  beforeAll(() => {
    db = createAdaptiveTestDb();
  });

  afterAll(() => {
    db.close();
  });

  describe('adaptive 2-hop token budget', () => {
    it('respects hop2TokenBudget and does not exceed it', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 400, // J=150 + C=200 = 350 fits; adding H=500 or K=400 would exceed
        tokenBudget: 100000,  // large overall budget so it doesn't interfere
      });

      const hop2Items = expanded.filter(r => r.expansion?.hops === 2);
      const hop2Ids = hop2Items.map(r => r.id);

      // J (150 tokens) and C (200 tokens) fit within 400 budget
      expect(hop2Ids).toContain('j');
      expect(hop2Ids).toContain('c');
      // H (500 tokens) and K (400 tokens) exceed remaining budget
      expect(hop2Ids).not.toContain('h');
      expect(hop2Ids).not.toContain('k');
    });

    it('very tight budget allows only highest-priority candidate', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 160, // Only J (150 tokens) fits
        tokenBudget: 100000,
      });

      const hop2Items = expanded.filter(r => r.expansion?.hops === 2);
      expect(hop2Items.length).toBe(1);
      expect(hop2Items[0].id).toBe('j'); // highest score ≈ 5.43
    });
  });

  describe('edge priority ranking', () => {
    it('prefers extends/implements over calls/uses', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      const hop2Items = expanded.filter(r => r.expansion?.hops === 2);
      // All 4 candidates should be included with large budget
      expect(hop2Items.length).toBe(4);

      // Priority edges (extends/implements) get higher effectiveAlpha (0.80) and thus higher decay
      // Non-priority edges (calls/uses) get lower effectiveAlpha (0.55-0.60) and thus lower decay
      const j = hop2Items.find(r => r.id === 'j'); // implements (priority)
      const c = hop2Items.find(r => r.id === 'c'); // extends (priority)
      const h = hop2Items.find(r => r.id === 'h'); // calls (non-priority)
      const k = hop2Items.find(r => r.id === 'k'); // uses (non-priority)

      expect(j.score).toBeGreaterThan(h.score);
      expect(j.score).toBeGreaterThan(k.score);
      expect(c.score).toBeGreaterThan(h.score);
      expect(c.score).toBeGreaterThan(k.score);
    });
  });

  describe('relationship weight', () => {
    it('higher weight edges produce higher adaptive scores', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      const hop2Items = expanded.filter(r => r.expansion?.hops === 2);
      // J (implements, alpha=0.80): score = 0.64*3*4/sqrt(deg) > C (extends, alpha=0.80): score = 0.64*2*4/sqrt(deg)
      // J has higher composite score because of higher edge weight
      const j = hop2Items.find(r => r.id === 'j');
      const c = hop2Items.find(r => r.id === 'c');
      expect(j.expansion.adaptiveScore).toBeGreaterThan(c.expansion.adaptiveScore);
    });
  });

  describe('score decay modulation', () => {
    it('uses effectiveAlpha^2 decay with degree normalization', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      // J: implements, effectiveAlpha = 0.80, decay = 0.64, interface boost (1.3x)
      // score = 10 * 0.64 * 1.3 = 8.32
      const j = expanded.find(r => r.id === 'j');
      expect(j).toBeDefined();
      expect(j.score).toBeCloseTo(10 * 0.64 * 1.3);

      // H: calls, effectiveAlpha = 0.60, decay = 0.36, class boost (1.3x)
      // score = 10 * 0.36 * 1.3 = 4.68
      const h = expanded.find(r => r.id === 'h');
      expect(h).toBeDefined();
      expect(h.score).toBeCloseTo(10 * 0.36 * 1.3);
    });

    it('stores sourceOutDegree in expansion metadata', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      // J comes from D (2 outgoing edges), H comes from B (4 outgoing edges)
      const j = expanded.find(r => r.id === 'j');
      expect(j.expansion.sourceOutDegree).toBe(2);

      const h = expanded.find(r => r.id === 'h');
      expect(h.expansion.sourceOutDegree).toBe(4);
    });

    it('skips candidates below flow threshold', () => {
      const ftDb = new Database(':memory:');
      ftDb.exec(`
        CREATE TABLE entities (id TEXT PRIMARY KEY, file_path TEXT, type TEXT, name TEXT, signature TEXT, start_line INTEGER, end_line INTEGER, stale_since INTEGER);
        CREATE TABLE relationships (source_id TEXT, target_id TEXT, target_name TEXT, type TEXT, weight REAL);
      `);

      const ie = ftDb.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const ir = ftDb.prepare('INSERT INTO relationships VALUES (?, ?, ?, ?, ?)');

      ie.run('seed', 'src/seed.js', 'class', 'Seed', 'class Seed', 1, 10, null);
      ie.run('hop1', 'src/hop1.js', 'class', 'Hop1', 'class Hop1', 1, 10, null);
      ie.run('good', 'src/good.js', 'class', 'Good', 'class Good', 1, 10, null);
      ie.run('weak', 'src/weak.js', 'class', 'Weak', 'class Weak', 1, 10, null);

      ir.run('seed', 'hop1', 'Hop1', 'imports', 1.0);
      // Strong edge: score = (0.80^2 * 2.0 * 4) / sqrt(2) ≈ 3.62 >> 0.05
      ir.run('hop1', 'good', 'Good', 'extends', 2.0);
      // Very weak edge: score = (0.55^2 * 0.001 * 1) / sqrt(2) ≈ 0.0002 < 0.05 threshold
      ir.run('hop1', 'weak', 'Weak', 'uses', 0.001);

      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', start_line: 1, end_line: 10 }];
      const expanded = expandResults(ftDb, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      const ids = expanded.map(r => r.id);
      expect(ids).toContain('good');
      expect(ids).not.toContain('weak');

      ftDb.close();
    });

    it('1-hop results still use HOP_DECAY (0.6)', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
      });

      // B is 1-hop → standard HOP_DECAY=0.6, then reranked with class boost (1.3x)
      // score = 10 * 0.6 * 1.3 = 7.8
      const b = expanded.find(r => r.id === 'b' && r.is_expanded);
      expect(b).toBeDefined();
      expect(b.score).toBeCloseTo(10 * 0.6 * 1.3);
    });
  });

  describe('deduplication', () => {
    it('entities in seed set are excluded from 2-hop', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      // A should appear only once (as original, not expanded)
      const aItems = expanded.filter(r => r.id === 'a');
      expect(aItems.length).toBe(1);
      expect(aItems[0].is_expanded).toBeUndefined();
    });

    it('entities in 1-hop set are excluded from 2-hop', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      // G is reachable via 1-hop (A --uses--> G) AND 2-hop (B --calls--> G)
      // It should appear only as 1-hop, not duplicated as 2-hop
      const gItems = expanded.filter(r => r.id === 'g');
      expect(gItems.length).toBe(1);
      expect(gItems[0].expansion?.hops).toBeUndefined(); // 1-hop has no hops field
    });

    it('stale entities are excluded from 2-hop adaptive results', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      const ids = expanded.map(r => r.id);
      expect(ids).not.toContain('stale1');
    });
  });

  describe('budget tracking stats', () => {
    it('_budgetStats tracks per-category token usage', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      const stats = expanded._budgetStats;
      expect(stats).toBeDefined();
      expect(stats.original.count).toBe(1);
      expect(stats.original.tokens).toBe(500); // A: 50 lines * 10
      expect(stats.hop1.count).toBeGreaterThan(0);
      expect(stats.hop2.count).toBeGreaterThan(0);
      expect(stats.total.count).toBe(expanded.length);
      expect(stats.total.tokens).toBeGreaterThan(0);
    });
  });

  describe('applyTokenBudget with expandedBudget', () => {
    it('separate expandedBudget limits expanded results', () => {
      const results = [
        { id: 'orig1', score: 10, start_line: 1, end_line: 50 },       // 500 tokens
        { id: 'exp1', score: 5, start_line: 1, end_line: 20, is_expanded: true, expansion: {} }, // 200 tokens
        { id: 'exp2', score: 4, start_line: 1, end_line: 30, is_expanded: true, expansion: {} }, // 300 tokens
        { id: 'exp3', score: 3, start_line: 1, end_line: 10, is_expanded: true, expansion: {} }, // 100 tokens
      ];

      const { results: budgeted, stats } = applyTokenBudget(results, 100000, { expandedBudget: 250 });

      // expandedBudget=250: exp1 (200) fits, exp2 (300) doesn't (200+300=500>250), exp3 (100) fits (200+100=300>250 nope)
      const expandedIds = budgeted.filter(r => r.is_expanded).map(r => r.id);
      expect(expandedIds).toContain('exp1');
      expect(expandedIds).not.toContain('exp2');
      expect(expandedIds).not.toContain('exp3');
      expect(stats.hop1.count).toBe(1);
      expect(stats.hop1.tokens).toBe(200);
    });

    it('stats categorize hop1 vs hop2 correctly', () => {
      const results = [
        { id: 'orig', score: 10, start_line: 1, end_line: 10 },
        { id: 'h1', score: 5, start_line: 1, end_line: 10, is_expanded: true, expansion: {} },
        { id: 'h2', score: 3, start_line: 1, end_line: 15, is_expanded: true, expansion: { hops: 2 } },
      ];

      const { stats } = applyTokenBudget(results, 100000);

      expect(stats.original.count).toBe(1);
      expect(stats.original.tokens).toBe(100);
      expect(stats.hop1.count).toBe(1);
      expect(stats.hop1.tokens).toBe(100);
      expect(stats.hop2.count).toBe(1);
      expect(stats.hop2.tokens).toBe(150);
      expect(stats.total.count).toBe(3);
      expect(stats.total.tokens).toBe(350);
    });
  });

  describe('backward compatibility', () => {
    it('non-adaptive 2-hop still works as before', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js' }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: false, // explicit non-adaptive
        tokenBudget: 100000,
        maxExpanded: 20,
      });

      const ids = expanded.map(r => r.id || r.entity_id);
      expect(ids).toContain('a');
      expect(ids).toContain('b'); // 1-hop
      expect(ids).toContain('d'); // 1-hop
      // 2-hop entities should be present (naive expansion)
      expect(ids).toContain('c'); // B extends C
    });

    it('default 2-hop without adaptiveHop2 uses naive expansion', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js' }];
      const expanded = expandResults(db, results, { expandMode: '2hop', tokenBudget: 100000 });

      // Non-adaptive: 2-hop entities get HOP2_DECAY=0.35 (not modulated),
      // then reranked with class boost (1.3x): 10 * 0.35 * 1.3 = 4.55
      const c = expanded.find(r => r.id === 'c');
      if (c) {
        expect(c.score).toBeCloseTo(10 * 0.35 * 1.3);
      }
    });

    it('1-hop mode is unaffected by adaptive options', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js' }];
      const expanded = expandResults(db, results, {
        expandMode: '1hop',
        adaptiveHop2: true, // should be ignored for 1-hop
        tokenBudget: 100000,
      });

      const ids = expanded.map(r => r.id || r.entity_id);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
      expect(ids).toContain('d');
      expect(ids).toContain('g');
      // No 2-hop entities
      expect(ids).not.toContain('c');
      expect(ids).not.toContain('j');
    });
  });

  describe('edge cases', () => {
    it('empty graph returns original results', () => {
      const emptyDb = new Database(':memory:');
      emptyDb.exec(`
        CREATE TABLE entities (id TEXT PRIMARY KEY, file_path TEXT, type TEXT, name TEXT, signature TEXT, start_line INTEGER, end_line INTEGER, stale_since INTEGER);
        CREATE TABLE relationships (source_id TEXT, target_id TEXT, target_name TEXT, type TEXT, weight REAL);
      `);

      const results = [{ id: 'x', score: 10, file: 'src/x.js' }];
      const expanded = expandResults(emptyDb, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
      });

      expect(expanded).toEqual(results);
      emptyDb.close();
    });

    it('no 2-hop candidates returns 1-hop results only', () => {
      // Create a DB where 1-hop neighbors have no outgoing edges
      const simpleDb = new Database(':memory:');
      simpleDb.exec(`
        CREATE TABLE entities (id TEXT PRIMARY KEY, file_path TEXT, type TEXT, name TEXT, signature TEXT, start_line INTEGER, end_line INTEGER, stale_since INTEGER);
        CREATE TABLE relationships (source_id TEXT, target_id TEXT, target_name TEXT, type TEXT, weight REAL);
      `);

      simpleDb.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p', 'src/p.js', 'class', 'P', 'class P', 1, 10, null);
      simpleDb.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('q', 'src/q.js', 'class', 'Q', 'class Q', 1, 10, null);
      simpleDb.prepare('INSERT INTO relationships VALUES (?, ?, ?, ?, ?)').run('p', 'q', 'Q', 'imports', 1.0);

      const results = [{ id: 'p', score: 10, file: 'src/p.js', start_line: 1, end_line: 10 }];
      const expanded = expandResults(simpleDb, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        tokenBudget: 100000,
      });

      const ids = expanded.map(r => r.id);
      expect(ids).toContain('p');
      expect(ids).toContain('q');
      const hop2Items = expanded.filter(r => r.expansion?.hops === 2);
      expect(hop2Items.length).toBe(0);

      simpleDb.close();
    });

    it('maxHop2 limits number of 2-hop results', () => {
      const results = [{ id: 'a', score: 10, file: 'src/a.js', start_line: 1, end_line: 50 }];
      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        maxExpanded: 1, // maxHop2 = maxExpanded = 1
      });

      // With maxExpanded=1, only 1 expanded result total (may be 1-hop)
      const expandedItems = expanded.filter(r => r.is_expanded);
      expect(expandedItems.length).toBeLessThanOrEqual(1);
    });
  });

  describe('rerankExpanded', () => {
    it('boosts same-file expanded results', () => {
      const seedResults = [
        { file_path: 'src/a.js', score: 10 },
      ];
      const expandedResults = [
        { id: 'x', file_path: 'src/a.js', type: 'variable', score: 3 },   // same file
        { id: 'y', file_path: 'src/other.js', type: 'variable', score: 3 }, // different file
      ];

      rerankExpanded(expandedResults, seedResults);

      const x = expandedResults.find(r => r.id === 'x');
      const y = expandedResults.find(r => r.id === 'y');
      // Same-file result gets 1.5x boost: 3 * 1.5 = 4.5
      expect(x.score).toBeCloseTo(4.5);
      // Different-file result keeps original score: 3
      expect(y.score).toBeCloseTo(3);
      // Same-file result should rank higher
      expect(expandedResults[0].id).toBe('x');
    });

    it('boosts structural entity types', () => {
      const seedResults = [
        { file_path: 'src/z.js', score: 10 },
      ];
      const expandedResults = [
        { id: 'cls', file_path: 'src/cls.js', type: 'class', score: 3 },       // class: 1.3x
        { id: 'fn', file_path: 'src/fn.js', type: 'function', score: 3 },      // function: 1.2x
        { id: 'iface', file_path: 'src/iface.js', type: 'interface', score: 3 }, // interface: 1.3x
        { id: 'mtd', file_path: 'src/mtd.js', type: 'method', score: 3 },      // method: 1.2x
        { id: 'st', file_path: 'src/st.js', type: 'struct', score: 3 },        // struct: 1.2x
        { id: 'var', file_path: 'src/var.js', type: 'variable', score: 3 },    // no boost
      ];

      rerankExpanded(expandedResults, seedResults);

      expect(expandedResults.find(r => r.id === 'cls').score).toBeCloseTo(3 * 1.3);
      expect(expandedResults.find(r => r.id === 'fn').score).toBeCloseTo(3 * 1.2);
      expect(expandedResults.find(r => r.id === 'iface').score).toBeCloseTo(3 * 1.3);
      expect(expandedResults.find(r => r.id === 'mtd').score).toBeCloseTo(3 * 1.2);
      expect(expandedResults.find(r => r.id === 'st').score).toBeCloseTo(3 * 1.2);
      expect(expandedResults.find(r => r.id === 'var').score).toBeCloseTo(3);
    });

    it('reranking changes order: low-decay same-file beats high-decay cross-file', () => {
      // Setup: cross-file result starts with higher score but same-file result
      // should overtake it after file proximity boost
      const seedResults = [
        { file_path: 'src/main.js', score: 10 },
      ];
      const expandedResults = [
        // Cross-file, non-structural: high initial score, no boosts
        { id: 'far', file_path: 'src/far.js', type: 'variable', score: 4.0 },
        // Same-file, structural (class): low initial score, gets 1.5 * 1.3 = 1.95x
        { id: 'near', file_path: 'src/main.js', type: 'class', score: 2.5 },
      ];

      // Before reranking: far (4.0) > near (2.5)
      expect(expandedResults[0].id).toBe('far');

      rerankExpanded(expandedResults, seedResults);

      // After reranking:
      // near: 2.5 * 1.5 (file) * 1.3 (class) = 4.875
      // far:  4.0 (no boosts)
      expect(expandedResults[0].id).toBe('near');
      expect(expandedResults[0].score).toBeCloseTo(2.5 * 1.5 * 1.3);
      expect(expandedResults[1].id).toBe('far');
      expect(expandedResults[1].score).toBeCloseTo(4.0);
    });

    it('handles empty expanded results', () => {
      const result = rerankExpanded([], [{ file_path: 'src/a.js', score: 10 }]);
      expect(result).toEqual([]);
    });

    it('handles seed results with mixed path fields', () => {
      // Seeds use different path field names
      const seedResults = [
        { file: 'src/a.js', score: 10 },
        { metadata: { path: 'src/b.js' }, score: 8 },
      ];
      const expandedResults = [
        { id: 'x', file_path: 'src/a.js', type: 'variable', score: 3 },
        { id: 'y', file: 'src/b.js', type: 'variable', score: 3 },
        { id: 'z', file_path: 'src/c.js', type: 'variable', score: 3 },
      ];

      rerankExpanded(expandedResults, seedResults);

      // x matches seed via file_path, y matches via file
      expect(expandedResults.find(r => r.id === 'x').score).toBeCloseTo(4.5);
      expect(expandedResults.find(r => r.id === 'y').score).toBeCloseTo(4.5);
      expect(expandedResults.find(r => r.id === 'z').score).toBeCloseTo(3);
    });

    it('applies both file proximity and type boost multiplicatively', () => {
      const seedResults = [{ file_path: 'src/a.js', score: 10 }];
      const expandedResults = [
        { id: 'x', file_path: 'src/a.js', type: 'class', score: 2 },
      ];

      rerankExpanded(expandedResults, seedResults);

      // file boost (1.5) * class boost (1.3) = 1.95x
      expect(expandedResults[0].score).toBeCloseTo(2 * 1.5 * 1.3);
    });
  });

  describe('reranking integration with expandResults', () => {
    it('expanded results from expandResults are reranked', () => {
      // Build a DB where same-file expanded entity should rank above cross-file
      const rrDb = new Database(':memory:');
      rrDb.exec(`
        CREATE TABLE entities (id TEXT PRIMARY KEY, file_path TEXT, type TEXT, name TEXT, signature TEXT, start_line INTEGER, end_line INTEGER, stale_since INTEGER);
        CREATE TABLE relationships (source_id TEXT, target_id TEXT, target_name TEXT, type TEXT, weight REAL);
      `);

      const ie = rrDb.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const ir = rrDb.prepare('INSERT INTO relationships VALUES (?, ?, ?, ?, ?)');

      // Seed entity in src/main.js
      ie.run('seed', 'src/main.js', 'class', 'Seed', 'class Seed', 1, 10, null);
      // Expanded entity in same file (class = 1.3x boost, same file = 1.5x boost)
      ie.run('same', 'src/main.js', 'class', 'SameFile', 'class SameFile', 20, 30, null);
      // Expanded entity in different file (variable = no type boost, different file = no proximity boost)
      ie.run('diff', 'src/other.js', 'variable', 'diffVar', 'const diffVar', 1, 10, null);

      ir.run('seed', 'same', 'SameFile', 'imports', 1.0);
      ir.run('seed', 'diff', 'diffVar', 'calls', 1.0);

      const results = [{ id: 'seed', score: 10, file_path: 'src/main.js', start_line: 1, end_line: 10 }];
      const expanded = expandResults(rrDb, results, {
        expandMode: '1hop',
        tokenBudget: 100000,
        maxExpanded: 10,
      });

      const expandedOnly = expanded.filter(r => r.is_expanded);
      expect(expandedOnly.length).toBe(2);

      const same = expandedOnly.find(r => r.id === 'same');
      const diff = expandedOnly.find(r => r.id === 'diff');

      // same-file class: 10 * 0.6 * 1.5 * 1.3 = 11.7
      // diff-file variable: 10 * 0.6 = 6.0 (no boosts)
      expect(same.score).toBeGreaterThan(diff.score);
      expect(same.score).toBeCloseTo(10 * 0.6 * 1.5 * 1.3);
      expect(diff.score).toBeCloseTo(10 * 0.6);

      rrDb.close();
    });
  });
});
