/**
 * Final-k contract on the surfaces that take k/topK.
 *
 * Every surface (ss-search wrapper -> search server, core CLI, MCP, library API)
 * ends in SweetSearch.search(query, { k }). These tests pin that search():
 *   - runs the seed stage on max(k, 10) candidates,
 *   - returns at most k results after graph expansion,
 *   - computes the agent budget tier on the final <= k list,
 * and that the MCP handler forwards k untouched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createMockSearcher } from '../helpers/prototype-test-helper.js';
import { handleSearch } from '../../mcp/tool-handlers.js';

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
    insertEntity.run(`seed${s}`, `src/seed${s}.js`, 'function', `seed${s}`, `function seed${s}()`, 10, 89);
    for (let n = 0; n < neighboursPerSeed; n++) {
      const id = `n${s}_${n}`;
      insertEntity.run(id, `src/n${s}_${n}.js`, 'function', id, `function ${id}()`, 10, 89);
      insertRel.run(`seed${s}`, id, id, 'calls', 1.0);
    }
  }
  return db;
}

// Tied, big seeds: with 16 of them the auto budget picker picks full 8k.
function tiedSeeds(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `seed${i}`,
    file: `src/seed${i}.js`,
    name: `seed${i}`,
    startLine: 10,
    endLine: 89,
    score: 0.85 - i * 0.001,
    metadata: { file: `src/seed${i}.js`, name: `seed${i}`, type: 'function', startLine: 10, endLine: 89 },
  }));
}

async function makeSearcher({ seedCount, neighbours }) {
  const db = createGraphDb(seedCount, neighbours);
  const hybridSpy = vi.fn(async () => ({ results: tiedSeeds(seedCount), semanticStats: null, fusionStats: {} }));
  const searcher = await createMockSearcher({
    projectRoot: '/nonexistent',
    init: async () => {},
    _refreshManifestPins: async () => {},
    hybridSearchV2: hybridSpy,
    hasGraphIndex: true,
    hasLateInteractionIndex: false,
    useLateInteraction: false,
    cascadeEnabled: false,
    qualityWeight: 0,
    graphSearch: { init: async () => {}, db },
    binaryHnswIndex: { getInt8Vector: () => undefined },
    codeGraphRepo: null,
    codebaseRepo: null,
  });
  return { searcher, hybridSpy };
}

describe('SweetSearch.search final-k contract (library API, server, core CLI, MCP all call this)', () => {
  afterEach(() => { delete process.env.SWEET_SEARCH_SEED_POOL_MIN; });

  it('benchmark format: k=6 returns at most 6 results even though graph expansion adds neighbours', async () => {
    const { searcher } = await makeSearcher({ seedCount: 6, neighbours: 3 });
    const out = await searcher.search('q', { k: 6, mode: 'hybrid', graphExpand: '1hop' });
    expect(out.results.length).toBeLessThanOrEqual(6);
    expect(out.stats.results_count).toBeLessThanOrEqual(6);
    expect(out.stats.graphExpansion?.expanded).toBeGreaterThan(0);
    expect(out.stats.finalKCut?.before).toBeGreaterThan(6);
  });

  it('agent format: results, header count and budget tier all use the final <= k list', async () => {
    // 10 tied seeds + expansion would be 16+ results and pick the full 8k tier.
    const { searcher } = await makeSearcher({ seedCount: 10, neighbours: 2 });
    const out = await searcher.search('q', {
      k: 6, mode: 'hybrid', graphExpand: '1hop', format: 'agent',
    });
    expect(out.format).toBe('agent');
    expect(out.results.length).toBeLessThanOrEqual(6);
    expect(out.subMode).toBe('agent_preview');
    expect(out.tokenBudget).toBe(3000);
  });

  it('seed stage cuts at k by default (a wider pool lowered probe MRR)', async () => {
    const { searcher, hybridSpy } = await makeSearcher({ seedCount: 10, neighbours: 0 });
    await searcher.search('q', { k: 3, mode: 'hybrid' });
    expect(hybridSpy.mock.calls[0][1].k).toBe(3);
  });

  it('SWEET_SEARCH_SEED_POOL_MIN=10 widens the seed pool, and the final list is still exactly k', async () => {
    process.env.SWEET_SEARCH_SEED_POOL_MIN = '10';
    const { searcher, hybridSpy } = await makeSearcher({ seedCount: 10, neighbours: 0 });
    const out = await searcher.search('q', { k: 3, mode: 'hybrid' });
    expect(hybridSpy.mock.calls[0][1].k).toBe(10);
    expect(out.results).toHaveLength(3);
  });
});

describe('MCP search tool', () => {
  it('forwards k to SweetSearch.search unchanged', async () => {
    const search = vi.fn(async () => ({
      format: 'agent', results: [], confidence: 'low', confidenceReason: 'empty',
      tokensUsed: 0, tokenBudget: 3000, totalResults: 0, mode: 'auto', latencyMs: 1,
      subMode: 'agent_preview', query: 'q',
    }));
    await handleSearch({ query: 'q', k: 6, mode: 'auto', format: 'agent' }, {
      PROJECT_ROOT: '/repo',
      getSearcher: async () => ({ search }),
    });
    expect(search.mock.calls[0][1].k).toBe(6);
  });
});
