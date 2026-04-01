import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { expandResults, rerankExpanded } from '../../core/graph/index.js';

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

function normSim(a, b) {
  return (cosine(a, b) + 1) / 2;
}

function minMaxNormalize(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

const mockCosineSimilarity = vi.fn((a, b) => cosine(a, b));

/**
 * Graph:
 *   seed --imports--> entityA (graph-connected, semantically unrelated)
 *   seed --imports--> entityB (graph-connected, semantically related)
 *   entityA --extends--> hop2A (2-hop, semantically unrelated)
 *   entityB --extends--> hop2B (2-hop, semantically related)
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
    'INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertRel = db.prepare(
    'INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)'
  );

  insertEntity.run('seed', 'src/seed.js', 'class', 'SeedService', 'class SeedService', 1, 50);
  insertEntity.run('entityA', 'src/unrelated.js', 'class', 'Unrelated', 'class Unrelated', 1, 30);
  insertEntity.run('entityB', 'src/related.js', 'class', 'Related', 'class Related', 1, 30);
  insertEntity.run('hop2A', 'src/hop2-unrelated.js', 'class', 'Hop2Unrelated', 'class Hop2Unrelated', 1, 20);
  insertEntity.run('hop2B', 'src/hop2-related.js', 'class', 'Hop2Related', 'class Hop2Related', 1, 20);
  insertEntity.run('noVec', 'src/no-vec.js', 'function', 'noVecFn', 'function noVecFn()', 1, 10);

  insertRel.run('seed', 'entityA', 'Unrelated', 'imports', 1.0);
  insertRel.run('seed', 'entityB', 'Related', 'imports', 1.0);
  insertRel.run('seed', 'noVec', 'noVecFn', 'calls', 1.0);
  insertRel.run('entityA', 'hop2A', 'Hop2Unrelated', 'extends', 2.0);
  insertRel.run('entityB', 'hop2B', 'Hop2Related', 'extends', 2.0);

  return db;
}

/**
 * Asymmetric topology DB for scale-calibration test:
 *   strongHop --extends--> topologyStrong (high graph, low semantic)
 *   weakHop --uses--> topologyWeak (low graph, high semantic)
 */
function createAsymmetricDb() {
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
    'INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertRel = db.prepare(
    'INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)'
  );

  insertEntity.run('seed', 'src/seed.js', 'class', 'SeedService', 'class SeedService', 1, 50);
  insertEntity.run('strongHop', 'src/strong-hop.js', 'class', 'StrongHop', 'class StrongHop', 1, 20);
  insertEntity.run('weakHop', 'src/weak-hop.js', 'class', 'WeakHop', 'class WeakHop', 1, 20);
  insertEntity.run('topologyStrong', 'src/topology-strong.js', 'class', 'TopologyStrong', 'class TopologyStrong', 1, 20);
  insertEntity.run('topologyWeak', 'src/topology-weak.js', 'class', 'TopologyWeak', 'class TopologyWeak', 1, 20);

  insertRel.run('seed', 'strongHop', 'StrongHop', 'imports', 1.0);
  insertRel.run('seed', 'weakHop', 'WeakHop', 'imports', 1.0);

  // Strong topology: high-priority edge + high weight.
  insertRel.run('strongHop', 'topologyStrong', 'TopologyStrong', 'extends', 2.0);
  // Weak topology: low-priority edge + low weight.
  insertRel.run('weakHop', 'topologyWeak', 'TopologyWeak', 'uses', 1.0);

  return db;
}

function createMockHnswIndex(vectors) {
  return {
    getInt8Vector: vi.fn(id => vectors[id] || undefined),
  };
}

describe('query-dependent-expansion', () => {
  let db;

  const queryInt8 = new Int8Array([100, 50, 0, -50, -100]);
  const relatedVector = new Int8Array([90, 40, 10, -40, -90]);
  const unrelatedVector = new Int8Array([-90, -40, -10, 40, 90]);

  const vectorMap = {
    entityA: unrelatedVector,
    entityB: relatedVector,
    hop2A: unrelatedVector,
    hop2B: relatedVector,
  };

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    mockCosineSimilarity.mockClear();
  });

  describe('cosine blend improves relevance', () => {
    it('semantically related entity scores higher than unrelated with same graph topology', () => {
      const hnswIndex = createMockHnswIndex(vectorMap);
      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

      const expanded = expandResults(db, results, {
        expandMode: '1hop',
        queryInt8,
        hnswIndex,
        semanticWeight: 0.4,
        cosineSimilarity: mockCosineSimilarity,
      });

      const entityAResult = expanded.find(r => (r.entity_id || r.id) === 'entityA');
      const entityBResult = expanded.find(r => (r.entity_id || r.id) === 'entityB');

      expect(entityAResult).toBeDefined();
      expect(entityBResult).toBeDefined();
      expect(entityBResult.score).toBeGreaterThan(entityAResult.score);
    });

    it('2-hop semantically related entity scores higher with adaptive expansion', () => {
      const hnswIndex = createMockHnswIndex(vectorMap);
      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        queryInt8,
        hnswIndex,
        semanticWeight: 0.4,
        maxExpanded: 20,
        cosineSimilarity: mockCosineSimilarity,
      });

      const hop2AResult = expanded.find(r => (r.entity_id || r.id) === 'hop2A');
      const hop2BResult = expanded.find(r => (r.entity_id || r.id) === 'hop2B');

      expect(hop2AResult).toBeDefined();
      expect(hop2BResult).toBeDefined();
      expect(hop2BResult.score).toBeGreaterThan(hop2AResult.score);
    });

    it('2-hop semantically related entity scores higher with non-adaptive expansion', () => {
      const hnswIndex = createMockHnswIndex(vectorMap);
      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

      const expanded = expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: false,
        queryInt8,
        hnswIndex,
        semanticWeight: 0.7,
        maxExpanded: 20,
        cosineSimilarity: mockCosineSimilarity,
      });

      const hop2AResult = expanded.find(r => (r.entity_id || r.id) === 'hop2A');
      const hop2BResult = expanded.find(r => (r.entity_id || r.id) === 'hop2B');

      expect(hop2AResult).toBeDefined();
      expect(hop2BResult).toBeDefined();
      expect(hop2BResult.score).toBeGreaterThan(hop2AResult.score);
    });

    it('semantic weighting can overcome asymmetric topology after graph-score normalization', () => {
      const asymDb = createAsymmetricDb();
      const asymVectors = {
        topologyStrong: unrelatedVector,
        topologyWeak: relatedVector,
      };
      const hnswIndex = createMockHnswIndex(asymVectors);
      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

      const expanded = expandResults(asymDb, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        queryInt8,
        hnswIndex,
        semanticWeight: 0.7,
        maxExpanded: 20,
        cosineSimilarity: mockCosineSimilarity,
      });

      const strong = expanded.find(r => (r.entity_id || r.id) === 'topologyStrong');
      const weak = expanded.find(r => (r.entity_id || r.id) === 'topologyWeak');

      expect(strong).toBeDefined();
      expect(weak).toBeDefined();
      expect(weak.score).toBeGreaterThan(strong.score);

      asymDb.close();
    });
  });

  describe('graceful degradation', () => {
    it('produces identical results to no-semantic-blend behavior when queryInt8 is null', () => {
      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

      const withoutSemantic = expandResults(db, results, { expandMode: '1hop' });
      const withNullQuery = expandResults(db, results, {
        expandMode: '1hop',
        queryInt8: null,
        hnswIndex: createMockHnswIndex(vectorMap),
        semanticWeight: 0.4,
        cosineSimilarity: mockCosineSimilarity,
      });

      const idsWithout = withoutSemantic.map(r => r.id || r.entity_id).sort();
      const idsNull = withNullQuery.map(r => r.id || r.entity_id).sort();
      expect(idsNull).toEqual(idsWithout);

      for (const rNull of withNullQuery) {
        const rWithout = withoutSemantic.find(r => (r.id || r.entity_id) === (rNull.id || rNull.entity_id));
        if (rWithout) expect(rNull.score).toBeCloseTo(rWithout.score, 10);
      }
    });

    it('entity without vector falls back to normalized graph score', () => {
      const hnswIndex = createMockHnswIndex(vectorMap); // noVec intentionally omitted
      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

      const withSemantic = expandResults(db, results, {
        expandMode: '1hop',
        queryInt8,
        hnswIndex,
        semanticWeight: 0.4,
        cosineSimilarity: mockCosineSimilarity,
      });

      const noVecWith = withSemantic.find(r => (r.entity_id || r.id) === 'noVec');
      const entityAWith = withSemantic.find(r => (r.entity_id || r.id) === 'entityA');
      const entityBWith = withSemantic.find(r => (r.entity_id || r.id) === 'entityB');

      expect(noVecWith).toBeDefined();
      expect(entityAWith).toBeDefined();
      expect(entityBWith).toBeDefined();
      expect(noVecWith.score).toBeCloseTo(0, 8);
      expect(noVecWith.score).toBeLessThan(entityAWith.score);
      expect(noVecWith.score).toBeLessThan(entityBWith.score);
    });
  });

  describe('semantic weight behavior', () => {
    it('semanticWeight=0 produces identical scores to no-blend path', () => {
      const hnswIndex = createMockHnswIndex(vectorMap);
      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

      const noBlend = expandResults(db, results, { expandMode: '1hop' });
      const zeroWeight = expandResults(db, results, {
        expandMode: '1hop',
        queryInt8,
        hnswIndex,
        semanticWeight: 0,
        cosineSimilarity: mockCosineSimilarity,
      });

      for (const rZero of zeroWeight) {
        const rNo = noBlend.find(r => (r.id || r.entity_id) === (rZero.id || rZero.entity_id));
        if (rNo) expect(rZero.score).toBeCloseTo(rNo.score, 10);
      }
    });

    it('semanticWeight=1 returns exact normalized cosine scores for vectorized entities', () => {
      const hnswIndex = createMockHnswIndex(vectorMap);
      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

      const pureCosine = expandResults(db, results, {
        expandMode: '1hop',
        queryInt8,
        hnswIndex,
        semanticWeight: 1,
        cosineSimilarity: mockCosineSimilarity,
      });

      const entityAResult = pureCosine.find(r => (r.entity_id || r.id) === 'entityA');
      const entityBResult = pureCosine.find(r => (r.entity_id || r.id) === 'entityB');

      expect(entityAResult).toBeDefined();
      expect(entityBResult).toBeDefined();
      expect(entityAResult.score).toBeCloseTo(normSim(queryInt8, unrelatedVector), 6);
      expect(entityBResult.score).toBeCloseTo(normSim(queryInt8, relatedVector), 6);
      expect(entityBResult.score).toBeGreaterThan(entityAResult.score);
    });
  });

  describe('rerankExpanded with semantic blend', () => {
    it('computes exact blended score values', () => {
      const hnswIndex = createMockHnswIndex(vectorMap);
      const seedResults = [{ id: 'seed', score: 10, file_path: 'src/seed.js' }];
      const expandedResults = [
        { entity_id: 'entityA', id: 'entityA', score: 5, file_path: 'src/seed.js', type: 'class' },
        { entity_id: 'entityB', id: 'entityB', score: 5, file_path: 'src/related.js', type: 'class' },
      ];

      rerankExpanded(expandedResults, seedResults, {
        queryInt8,
        hnswIndex,
        semanticWeight: 0.4,
        cosineSimilarity: mockCosineSimilarity,
      });

      const entityA = expandedResults.find(r => r.entity_id === 'entityA');
      const entityB = expandedResults.find(r => r.entity_id === 'entityB');

      const baseA = 5 * 1.5 * 1.3;
      const baseB = 5 * 1.3;
      const [normA, normB] = minMaxNormalize([baseA, baseB]);
      const expectedA = (1 - 0.4) * normA + 0.4 * normSim(queryInt8, unrelatedVector);
      const expectedB = (1 - 0.4) * normB + 0.4 * normSim(queryInt8, relatedVector);

      expect(entityA.score).toBeCloseTo(expectedA, 6);
      expect(entityB.score).toBeCloseTo(expectedB, 6);
      expect(expandedResults[0].score).toBeGreaterThanOrEqual(expandedResults[1].score);
    });

    it('works without semantic data (backward compatible)', () => {
      const seedResults = [{ id: 'seed', score: 10, file_path: 'src/seed.js' }];
      const expandedResults = [
        { entity_id: 'entityA', id: 'entityA', score: 5, file_path: 'src/seed.js', type: 'class' },
        { entity_id: 'entityB', id: 'entityB', score: 5, file_path: 'src/related.js', type: 'function' },
      ];

      rerankExpanded(expandedResults, seedResults);

      const entityA = expandedResults.find(r => r.entity_id === 'entityA');
      const entityB = expandedResults.find(r => r.entity_id === 'entityB');

      expect(entityA.score).toBeCloseTo(9.75, 2);
      expect(entityB.score).toBeCloseTo(6.0, 2);
    });
  });

  describe('function call behavior', () => {
    it('calls getInt8Vector for 2-hop entities in non-adaptive mode', () => {
      const hnswIndex = createMockHnswIndex(vectorMap);
      const results = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

      expandResults(db, results, {
        expandMode: '2hop',
        adaptiveHop2: false,
        queryInt8,
        hnswIndex,
        semanticWeight: 0.4,
        maxExpanded: 20,
        cosineSimilarity: mockCosineSimilarity,
      });

      const calledIds = hnswIndex.getInt8Vector.mock.calls.map(call => call[0]);
      expect(calledIds).toContain('hop2A');
      expect(calledIds).toContain('hop2B');
    });

    it('calls cosineSimilarity with query and entity vectors', () => {
      const hnswIndex = createMockHnswIndex(vectorMap);
      const seedResults = [{ id: 'seed', score: 10, file_path: 'src/seed.js' }];
      const expandedResults = [
        { entity_id: 'entityB', id: 'entityB', score: 5, file_path: 'src/related.js', type: 'class' },
      ];

      rerankExpanded(expandedResults, seedResults, {
        queryInt8,
        hnswIndex,
        semanticWeight: 0.4,
        cosineSimilarity: mockCosineSimilarity,
      });

      expect(mockCosineSimilarity).toHaveBeenCalled();
      const [callQueryArg, callEntityArg] = mockCosineSimilarity.mock.calls[0];
      expect(callQueryArg).toBe(queryInt8);
      expect(callEntityArg).toBe(relatedVector);
    });

    it('uses entity_id for vector lookup when id is a chunk id', () => {
      const hnswIndex = createMockHnswIndex({
        entityB: relatedVector,
      });
      const seedResults = [{ id: 'seed', score: 10, file_path: 'src/seed.js' }];
      const expandedResults = [
        { entity_id: 'entityB', id: 'chunk-entityB-0', score: 5, file_path: 'src/related.js', type: 'class' },
      ];

      rerankExpanded(expandedResults, seedResults, {
        queryInt8,
        hnswIndex,
        semanticWeight: 1,
        cosineSimilarity: mockCosineSimilarity,
      });

      const calledIds = hnswIndex.getInt8Vector.mock.calls.map(call => call[0]);
      expect(calledIds).toContain('entityB');
      expect(calledIds).not.toContain('chunk-entityB-0');
    });
  });
});
