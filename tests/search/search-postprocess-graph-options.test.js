import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyPostRetrieval } from '../../core/search/search-postprocess.js';

function createDb() {
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

  insertEntity.run('seed', 'src/seed.js', 'class', 'SeedService', 'class SeedService', 1, 40);
  insertEntity.run('entityA', 'src/unrelated.js', 'class', 'Unrelated', 'class Unrelated', 1, 20);
  insertEntity.run('entityB', 'src/related.js', 'class', 'Related', 'class Related', 1, 20);

  insertRel.run('seed', 'entityA', 'Unrelated', 'imports', 1.0);
  insertRel.run('seed', 'entityB', 'Related', 'imports', 1.0);

  return db;
}

function createHnswIndex(vectors) {
  return {
    getInt8Vector: vi.fn(id => vectors[id] || undefined),
  };
}

describe('postprocess graphExpandOptions semanticWeight override', () => {
  it('forwards semanticWeight from graphExpandOptions into graph expansion scoring', async () => {
    const db = createDb();

    const queryInt8 = new Int8Array([100, 50, 0, -50, -100]);
    const relatedVector = new Int8Array([90, 40, 10, -40, -90]);
    const unrelatedVector = new Int8Array([-90, -40, -10, 40, 90]);

    const searcher = {
      log: () => {},
      logPerformance: () => {},
      verbose: false,
      timing: false,
      enableTranslationFallback: false,
      hasGraphIndex: true,
      hasLateInteractionIndex: false,
      useLateInteraction: false,
      qualityWeight: 0,
      graphSearch: {
        init: vi.fn(async () => {}),
        db,
      },
      binaryHnswIndex: createHnswIndex({
        entityA: unrelatedVector,
        entityB: relatedVector,
      }),
    };

    const baseResults = [{ id: 'seed', score: 10, file: 'src/seed.js', name: 'SeedService' }];

    const context = {
      stats: {},
      semanticStats: { queryInt8 },
      searchMode: 'hybrid',
      effectiveGraphExpand: '1hop',
      intentPolicy: null,
      start: Date.now(),
    };

    const withZeroWeight = await applyPostRetrieval.call(
      searcher,
      [...baseResults],
      'test query',
      {
        graphExpandOptions: { semanticWeight: 0 },
        adaptiveHop2: false,
        qualityWeight: 0,
      },
      { ...context, stats: {}, start: Date.now() }
    );

    const withFullWeight = await applyPostRetrieval.call(
      searcher,
      [...baseResults],
      'test query',
      {
        graphExpandOptions: { semanticWeight: 1 },
        adaptiveHop2: false,
        qualityWeight: 0,
      },
      { ...context, stats: {}, start: Date.now() }
    );

    const zeroA = withZeroWeight.results.find(r => (r.entity_id || r.id) === 'entityA');
    const zeroB = withZeroWeight.results.find(r => (r.entity_id || r.id) === 'entityB');
    const fullA = withFullWeight.results.find(r => (r.entity_id || r.id) === 'entityA');
    const fullB = withFullWeight.results.find(r => (r.entity_id || r.id) === 'entityB');

    expect(zeroA).toBeDefined();
    expect(zeroB).toBeDefined();
    expect(fullA).toBeDefined();
    expect(fullB).toBeDefined();

    // weight=0 keeps graph-only tie behavior for symmetric topology.
    expect(Math.abs(zeroA.score - zeroB.score)).toBeLessThan(1e-9);

    // weight=1 should rank by pure cosine similarity.
    expect(fullB.score).toBeGreaterThan(fullA.score);

    db.close();
  });
});
