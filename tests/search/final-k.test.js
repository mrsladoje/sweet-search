import { describe, it, expect, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  normalizeFinalK,
  capToFinalK,
  seedPoolSize,
  DEFAULT_SEED_POOL_MIN,
} from '../../core/search/final-k.js';
import { applyPostRetrieval, packageForAgent } from '../../core/search/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGraphDb(seedCount, neighboursPerSeed) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY, file_path TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
      signature TEXT, start_line INTEGER, end_line INTEGER, stale_since INTEGER DEFAULT NULL
    );
    CREATE TABLE relationships (
      source_id TEXT, target_id TEXT, target_name TEXT NOT NULL, type TEXT NOT NULL, weight REAL DEFAULT 1.0
    );
  `);
  const insertEntity = db.prepare(
    'INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertRel = db.prepare(
    'INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)'
  );
  for (let s = 0; s < seedCount; s++) {
    insertEntity.run(`seed${s}`, `src/seed${s}.js`, 'function', `seed${s}`, `function seed${s}()`, 1, 30);
    for (let n = 0; n < neighboursPerSeed; n++) {
      const id = `n${s}_${n}`;
      insertEntity.run(id, `src/n${s}_${n}.js`, 'function', id, `function ${id}()`, 1, 20);
      insertRel.run(`seed${s}`, id, id, 'calls', 1.0);
    }
  }
  return db;
}

function makeSearcher(db) {
  return {
    log: () => {},
    logPerformance: () => {},
    verbose: false,
    timing: false,
    enableTranslationFallback: false,
    hasGraphIndex: true,
    hasLateInteractionIndex: false,
    useLateInteraction: false,
    qualityWeight: 0,
    cascadeEnabled: false,
    graphSearch: { init: vi.fn(async () => {}), db },
    binaryHnswIndex: { getInt8Vector: vi.fn(() => undefined) },
  };
}

function makeSeeds(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `seed${i}`,
    file: `src/seed${i}.js`,
    name: `seed${i}`,
    score: 10 - i * 0.1,
  }));
}

async function runPost(db, seeds, options) {
  return applyPostRetrieval.call(
    makeSearcher(db),
    seeds,
    'test query',
    { adaptiveHop2: false, qualityWeight: 0, ...options },
    {
      stats: {},
      semanticStats: null,
      searchMode: 'hybrid',
      effectiveGraphExpand: '1hop',
      intentPolicy: null,
      start: Date.now(),
    },
  );
}

// ---------------------------------------------------------------------------
// final-k.js helpers
// ---------------------------------------------------------------------------

describe('final-k helpers', () => {
  afterEach(() => { delete process.env.SWEET_SEARCH_SEED_POOL_MIN; });

  it('normalizeFinalK accepts positive integers and numeric strings only', () => {
    expect(normalizeFinalK(6)).toBe(6);
    expect(normalizeFinalK('6')).toBe(6);
    expect(normalizeFinalK(6.9)).toBe(6);
    expect(normalizeFinalK(0)).toBeNull();
    expect(normalizeFinalK(-3)).toBeNull();
    expect(normalizeFinalK(undefined)).toBeNull();
    expect(normalizeFinalK(NaN)).toBeNull();
    expect(normalizeFinalK('abc')).toBeNull();
  });

  it('capToFinalK cuts to k, keeps order, and is a no-op without a usable k', () => {
    const list = [1, 2, 3, 4, 5];
    expect(capToFinalK(list, 3)).toEqual([1, 2, 3]);
    expect(capToFinalK(list, 5)).toBe(list);
    expect(capToFinalK(list, 9)).toBe(list);
    expect(capToFinalK(list, undefined)).toBe(list);
    expect(capToFinalK(list, 0)).toBe(list);
  });

  it('seedPoolSize equals k by default (measured: a wider pool lowered probe MRR)', () => {
    expect(DEFAULT_SEED_POOL_MIN).toBe(0);
    expect(seedPoolSize(3)).toBe(3);
    expect(seedPoolSize(6)).toBe(6);
    expect(seedPoolSize(25)).toBe(25);
  });

  it('SWEET_SEARCH_SEED_POOL_MIN=10 widens the seed pool to max(k, 10), never below k', () => {
    process.env.SWEET_SEARCH_SEED_POOL_MIN = '10';
    expect(seedPoolSize(3)).toBe(10);
    expect(seedPoolSize(25)).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Library / core CLI / server / MCP: all call SweetSearch.search(), which runs
// applyPostRetrieval. The final cut lives there.
// ---------------------------------------------------------------------------

describe('applyPostRetrieval final-k cut', () => {
  it('cuts graph-expanded results back to k (the "-k 6 returned 16" bug)', async () => {
    const db = createGraphDb(6, 3); // 6 seeds, 18 reachable neighbours
    const uncut = await runPost(db, makeSeeds(6), { k: 100 });
    // Sanity: expansion really does append neighbours beyond the 6 seeds.
    expect(uncut.results.length).toBeGreaterThan(6);

    const out = await runPost(db, makeSeeds(6), { k: 6 });
    expect(out.results).toHaveLength(6);
    expect(out.stats.results_count).toBe(6);
    expect(out.stats.finalKCut.k).toBe(6);
    expect(out.stats.finalKCut.before).toBeGreaterThan(6);
  });

  it('keeps expanded neighbours that out-rank seeds only up to k, never more', async () => {
    const db = createGraphDb(2, 8);
    const out = await runPost(db, makeSeeds(2), { k: 4 });
    expect(out.results).toHaveLength(4);
  });

  it('is a no-op when the list is already <= k', async () => {
    const db = createGraphDb(2, 0);
    const out = await runPost(db, makeSeeds(2), { k: 6 });
    expect(out.results).toHaveLength(2);
    expect(out.stats.finalKCut).toBeUndefined();
  });

  it('defaults to k=10 like search() does', async () => {
    const db = createGraphDb(10, 3);
    const out = await runPost(db, makeSeeds(10), {});
    expect(out.results).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// Budget-tier signals use the final <= k list
// ---------------------------------------------------------------------------

describe('packageForAgent honours k for budget-tier signals', () => {
  // 16 tightly-tied big results: without the cut this trips the
  // numResults >= 10 AND D < 1.05 AND top1Tokens >= 600 -> full 8k rule.
  const tiedResults = (count) => Array.from({ length: count }, (_, i) => ({
    id: `chunk${i}`,
    file: `src/file${i}.js`,
    startLine: 10,
    endLine: 89,
    score: 0.85 - i * 0.001,
    lateInteractionScore: 0.85 - i * 0.001,
    metadata: { file: `src/file${i}.js`, name: `func${i}`, type: 'function', startLine: 10, endLine: 89 },
  }));
  const base = { query: 'q', regex: '', format: 'agent', projectRoot: '/nonexistent' };

  it('without k, 16 tied results pick the full 8k tier (the old behaviour)', () => {
    const r = packageForAgent(tiedResults(16), {}, base);
    expect(r.subMode).toBe('agent_full');
    expect(r.tokenBudget).toBe(8000);
  });

  it('with k=6, only 6 results are counted and packaged: preview 3k', () => {
    const r = packageForAgent(tiedResults(16), {}, { ...base, k: 6 });
    expect(r.results).toHaveLength(6);
    expect(r.subMode).toBe('agent_preview');
    expect(r.tokenBudget).toBe(3000);
    expect(r.budgetSignals?.numResults ?? 6).toBe(6);
  });

  it('k larger than the list changes nothing', () => {
    const r = packageForAgent(tiedResults(12), {}, { ...base, k: 50 });
    expect(r.results).toHaveLength(12);
    expect(r.subMode).toBe('agent_full');
  });
});
