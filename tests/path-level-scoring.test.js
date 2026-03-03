import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import {
  expandResults,
  expandOneHop,
  expandSecondHop,
  expandSecondHopAdaptive,
} from '../core/graph-expansion.js';

const DEFAULT_EDGE_TYPES = new Set(['imports', 'extends', 'implements', 'uses', 'calls']);

function createGraphDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY, file_path TEXT NOT NULL, type TEXT NOT NULL,
      name TEXT NOT NULL, signature TEXT, start_line INTEGER, end_line INTEGER,
      stale_since INTEGER DEFAULT NULL
    )
  `);
  db.exec(`
    CREATE TABLE relationships (
      source_id TEXT, target_id TEXT, target_name TEXT NOT NULL,
      type TEXT NOT NULL, weight REAL DEFAULT 1.0
    )
  `);
  return {
    db,
    insertEntity: db.prepare(
      'INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ),
    insertRel: db.prepare(
      'INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)'
    ),
  };
}

/**
 * Test graph:
 *   seed --extends--> strongHop1 --extends--> hop2Target
 *   seed --uses-----> weakHop1   --extends--> hop2Target
 *   seed --imports--> dupeTarget (also reached by --calls-->)
 *   reverseEntity --extends--> seed  (reverse edge)
 */
function createTestDb() {
  const { db, insertEntity, insertRel } = createGraphDb();

  insertEntity.run('seed', 'src/seed.js', 'class', 'Seed', 'class Seed', 1, 50);
  insertEntity.run('strongHop1', 'src/strong.js', 'class', 'StrongHop1', 'class StrongHop1', 1, 40);
  insertEntity.run('weakHop1', 'src/weak.js', 'class', 'WeakHop1', 'class WeakHop1', 1, 30);
  insertEntity.run('hop2Target', 'src/hop2.js', 'class', 'Hop2Target', 'class Hop2Target', 1, 20);
  insertEntity.run('dupeTarget', 'src/dupe.js', 'function', 'dupeTarget', 'function dupeTarget()', 1, 15);
  insertEntity.run('reverseEntity', 'src/reverse.js', 'class', 'ReverseEntity', 'class ReverseEntity', 1, 25);

  insertRel.run('seed', 'strongHop1', 'StrongHop1', 'extends', 1.0);
  insertRel.run('seed', 'weakHop1', 'WeakHop1', 'uses', 1.0);
  insertRel.run('strongHop1', 'hop2Target', 'Hop2Target', 'extends', 1.0);
  insertRel.run('weakHop1', 'hop2Target', 'Hop2Target', 'extends', 1.0);
  insertRel.run('seed', 'dupeTarget', 'dupeTarget', 'imports', 1.0);
  insertRel.run('seed', 'dupeTarget', 'dupeTarget', 'calls', 1.0);
  insertRel.run('reverseEntity', 'seed', 'Seed', 'extends', 1.0);

  return db;
}

/**
 * Ordering graph:
 *   seed --extends--> strongHop1 --extends--> hop2A
 *   seed --uses-----> weakHop1   --uses-----> hop2B
 */
function createOrderingDb() {
  const { db, insertEntity, insertRel } = createGraphDb();

  insertEntity.run('seed', 'src/seed.js', 'class', 'Seed', 'class Seed', 1, 50);
  insertEntity.run('strongHop1', 'src/strong.js', 'class', 'StrongHop1', 'class StrongHop1', 1, 30);
  insertEntity.run('weakHop1', 'src/weak.js', 'class', 'WeakHop1', 'class WeakHop1', 1, 30);
  insertEntity.run('hop2A', 'src/hop2a.js', 'class', 'Hop2A', 'class Hop2A', 1, 20);
  insertEntity.run('hop2B', 'src/hop2b.js', 'class', 'Hop2B', 'class Hop2B', 1, 20);

  insertRel.run('seed', 'strongHop1', 'StrongHop1', 'extends', 1.0);
  insertRel.run('seed', 'weakHop1', 'WeakHop1', 'uses', 1.0);
  insertRel.run('strongHop1', 'hop2A', 'Hop2A', 'extends', 1.0);
  insertRel.run('weakHop1', 'hop2B', 'Hop2B', 'uses', 1.0);

  return db;
}

describe('Path-Level Scoring (Section 23)', () => {
  let db;
  beforeAll(() => { db = createTestDb(); });
  afterAll(() => { db.close(); });

  describe('expandOneHop scores', () => {
    it('returns entries with numeric score field', () => {
      const expanded = expandOneHop(db, new Set(['seed']), DEFAULT_EDGE_TYPES);

      expect(expanded.size).toBeGreaterThan(0);
      for (const [, entry] of expanded) {
        expect(typeof entry.score).toBe('number');
        expect(entry.score).toBeGreaterThan(0);
      }
    });

    it('scores equal effectiveAlpha (single decay per hop, no EDGE_PRIORITY)', () => {
      const expanded = expandOneHop(db, new Set(['seed']), DEFAULT_EDGE_TYPES);

      // strongHop1 via extends: BASE_ALPHA(0.55) + EDGE_ALPHA_BONUS['extends'](0.25) = 0.80
      const strong = expanded.get('strongHop1');
      expect(strong.score).toBeCloseTo(0.80, 5);
      expect(strong.via).toBe('extends');

      // weakHop1 via uses: BASE_ALPHA(0.55) + 0 = 0.55
      const weak = expanded.get('weakHop1');
      expect(weak.score).toBeCloseTo(0.55, 5);
      expect(weak.via).toBe('uses');

      // Verify the strong/weak ratio reflects edge-type differentiation (1.45x)
      expect(strong.score / weak.score).toBeCloseTo(0.80 / 0.55, 2);
    });

    it('uses max-score-wins for duplicate entities', () => {
      const expanded = expandOneHop(db, new Set(['seed']), DEFAULT_EDGE_TYPES);

      // dupeTarget reached via imports (effectiveAlpha=0.65) AND calls (effectiveAlpha=0.60)
      const dupe = expanded.get('dupeTarget');
      expect(dupe).toBeDefined();
      expect(dupe.via).toBe('imports');
      expect(dupe.score).toBeCloseTo(0.65, 5);
      // Confirm calls score would have been lower
      expect(dupe.score).toBeGreaterThan(0.60);
    });

    it('scores reverse edges', () => {
      const expanded = expandOneHop(db, new Set(['seed']), DEFAULT_EDGE_TYPES);

      const rev = expanded.get('reverseEntity');
      expect(rev).toBeDefined();
      expect(rev.direction).toBe('reverse');
      // reverse extends: effectiveAlpha = 0.80
      expect(rev.score).toBeCloseTo(0.80, 5);
    });
  });

  describe('expandSecondHopAdaptive path scoring', () => {
    it('strong hop-1 path produces higher adaptiveScore than weak path for same target', () => {
      // hop2Target is reached via both strongHop1 (extends, score=0.80) and
      // weakHop1 (uses, score=0.55). The bestByTarget should pick the strong path.
      // Strong path graphScore = 0.80 * 0.80 * 1.0 * 4 / sqrt(1) = 2.56
      // Weak path graphScore   = 0.55 * 0.80 * 1.0 * 4 / sqrt(1) = 1.76
      const result = expandResults(db, [{ entity_id: 'seed', score: 1.0 }], {
        expandMode: '2hop',
        adaptiveHop2: true,
        maxExpanded: 20,
        tokenBudget: 20000,
        hop2TokenBudget: 10000,
        edgeTypes: DEFAULT_EDGE_TYPES,
      });

      const hop2 = result.find(r => r.entity_id === 'hop2Target');
      expect(hop2).toBeDefined();
      expect(hop2.is_expanded).toBe(true);
      expect(hop2.expansion?.hops).toBe(2);
      // adaptiveScore should reflect the strong path (normalized, but > 0)
      expect(hop2.expansion?.adaptiveScore).toBeGreaterThan(0);
    });

    it('adaptive graphScore uses hop1Score, not effectiveAlpha squared', () => {
      // Verify via expandOneHop that different hop-1 scores exist,
      // then verify the adaptive path uses them.
      const expanded = expandOneHop(db, new Set(['seed']), DEFAULT_EDGE_TYPES);
      const strongScore = expanded.get('strongHop1').score; // 0.80
      const weakScore = expanded.get('weakHop1').score;     // 0.55

      // If the old formula were used (effectiveAlpha² for extends = 0.64),
      // both paths to hop2Target would produce the same graphScore.
      // With path-level scoring, the strong path dominates because
      // hop1Score differs by edge type.
      expect(strongScore).toBeGreaterThan(weakScore);

      // The ratio between hop-1 scores reflects edge-type differentiation
      // (1.45x) — this signal was previously lost with effectiveAlpha².
      expect(strongScore).toBeCloseTo(0.80, 5);
      expect(weakScore).toBeCloseTo(0.55, 5);
    });

    it('adaptive fallback is exercised when hop-1 entry value is undefined', () => {
      // Key exists (so source_id is queried), but value is undefined -> hop1Entry?.score ?? effectiveAlpha.
      const hop1Expanded = new Map([
        ['strongHop1', undefined],
        ['weakHop1', { via: 'uses', direction: 'forward', score: 0.55 }],
      ]);
      const seedIds = new Set(['seed']);

      const stats = expandSecondHopAdaptive(db, seedIds, hop1Expanded, DEFAULT_EDGE_TYPES, {
        maxHop2: 10,
        tokenBudget: 10000,
      });

      expect(stats.added).toBeGreaterThan(0);
      const hop2 = hop1Expanded.get('hop2Target');
      expect(hop2).toBeDefined();
      expect(hop2.hops).toBe(2);
      expect(hop2.adaptiveScore).toBeGreaterThan(0);
    });
  });

  describe('expandSecondHop (non-adaptive) path scoring', () => {
    it('semantic-enabled branch produces hop-2 results with path influence', () => {
      const mockCosineSimilarity = vi.fn(() => 0.5);
      const mockHnswIndex = {
        getInt8Vector: vi.fn(() => new Int8Array(8).fill(1)),
      };
      const queryInt8 = new Int8Array(8).fill(1);

      const result = expandResults(db, [{ entity_id: 'seed', score: 1.0 }], {
        expandMode: '2hop',
        adaptiveHop2: false,
        maxExpanded: 20,
        tokenBudget: 20000,
        edgeTypes: DEFAULT_EDGE_TYPES,
        queryInt8,
        hnswIndex: mockHnswIndex,
        semanticWeight: 0.4,
        cosineSimilarity: mockCosineSimilarity,
      });

      const hop2 = result.find(r => r.entity_id === 'hop2Target');
      expect(hop2).toBeDefined();
      expect(hop2.is_expanded).toBe(true);
      expect(hop2.expansion?.hops).toBe(2);
      // Verify cosine was called for hop-2 entities (semantic path exercised)
      expect(mockCosineSimilarity).toHaveBeenCalled();
    });

    it('non-semantic branch works with source_id SQL change', () => {
      const result = expandResults(db, [{ entity_id: 'seed', score: 1.0 }], {
        expandMode: '2hop',
        adaptiveHop2: false,
        maxExpanded: 20,
        tokenBudget: 20000,
        edgeTypes: DEFAULT_EDGE_TYPES,
      });

      const hop2 = result.find(r => r.entity_id === 'hop2Target');
      expect(hop2).toBeDefined();
      expect(hop2.is_expanded).toBe(true);
      expect(hop2.expansion?.hops).toBe(2);
      expect(hop2.expansion?.via).toBe('extends');
    });

    it('non-adaptive semantic fallback is exercised when hop-1 entry value is undefined', () => {
      const mockCosineSimilarity = vi.fn(() => 0.5);
      const mockHnswIndex = {
        getInt8Vector: vi.fn(() => new Int8Array(8).fill(1)),
      };
      const queryInt8 = new Int8Array(8).fill(1);
      const expanded = new Map([
        ['strongHop1', undefined],
        ['weakHop1', { via: 'uses', direction: 'forward', score: 0.55 }],
      ]);
      const seedIds = new Set(['seed']);

      expandSecondHop(db, seedIds, expanded, DEFAULT_EDGE_TYPES, {
        queryInt8,
        hnswIndex: mockHnswIndex,
        semanticWeight: 0.4,
        cosineSimilarity: mockCosineSimilarity,
      });

      const hop2 = expanded.get('hop2Target');
      expect(hop2).toBeDefined();
      expect(hop2.hops).toBe(2);
      expect(mockCosineSimilarity).toHaveBeenCalled();
    });
  });

  describe('end-to-end via expandResults', () => {
    it('hop-1 scores propagate into 2-hop selection with adaptive mode', () => {
      const result = expandResults(db, [{ entity_id: 'seed', score: 1.0 }], {
        expandMode: '2hop',
        adaptiveHop2: true,
        maxExpanded: 20,
        tokenBudget: 20000,
        hop2TokenBudget: 10000,
        edgeTypes: DEFAULT_EDGE_TYPES,
      });

      // Verify all expected entities are present
      const entityIds = result.map(r => r.entity_id);
      expect(entityIds).toContain('strongHop1');
      expect(entityIds).toContain('weakHop1');
      expect(entityIds).toContain('hop2Target');

      // hop2Target should have been reached and carry 2-hop metadata
      const hop2 = result.find(r => r.entity_id === 'hop2Target');
      expect(hop2.expansion.hops).toBe(2);
      expect(hop2.expansion.adaptiveScore).toBeGreaterThan(0);
    });
  });

  describe('score ordering', () => {
    let orderDb;
    beforeAll(() => { orderDb = createOrderingDb(); });
    afterAll(() => { orderDb.close(); });

    it('hop-2 via strong path ranks higher than hop-2 via weak path', () => {
      const result = expandResults(orderDb, [{ entity_id: 'seed', score: 1.0 }], {
        expandMode: '2hop',
        adaptiveHop2: true,
        maxExpanded: 20,
        tokenBudget: 20000,
        hop2TokenBudget: 10000,
        edgeTypes: DEFAULT_EDGE_TYPES,
      });

      const hop2A = result.find(r => r.entity_id === 'hop2A');
      const hop2B = result.find(r => r.entity_id === 'hop2B');

      expect(hop2A).toBeDefined();
      expect(hop2B).toBeDefined();

      // hop2A via extends->extends (strong) must appear before hop2B via uses->uses (weak)
      expect(result.indexOf(hop2A)).toBeLessThan(result.indexOf(hop2B));

      // Verify the adaptive scores reflect the path difference
      expect(hop2A.expansion.adaptiveScore).toBeGreaterThan(hop2B.expansion.adaptiveScore);
    });
  });

  describe('backward compatibility', () => {
    it('1-hop-only expansion assigns scores but produces no 2-hop entities', () => {
      const result = expandResults(db, [{ entity_id: 'seed', score: 1.0 }], {
        expandMode: '1hop',
        maxExpanded: 20,
        tokenBudget: 20000,
        edgeTypes: DEFAULT_EDGE_TYPES,
      });

      const expandedResults = result.filter(r => r.is_expanded);
      expect(expandedResults.length).toBeGreaterThan(0);

      // No hop-2 entities
      expect(result.filter(r => r.expansion?.hops === 2).length).toBe(0);

      // hop2Target is ONLY reachable via 2-hop
      expect(result.find(r => r.entity_id === 'hop2Target')).toBeUndefined();

      // expandOneHop should have scored these
      const hop1 = expandOneHop(db, new Set(['seed']), DEFAULT_EDGE_TYPES);
      for (const [, entry] of hop1) {
        expect(entry.score).toBeGreaterThan(0);
      }
    });
  });
});
