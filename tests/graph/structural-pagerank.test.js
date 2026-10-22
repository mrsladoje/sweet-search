import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  pageRankWeighted,
  buildWeightedAdjacency,
  populatePageRankColumn,
} from '../../core/graph/structural-pagerank.js';
import { createGraphSchema } from '../../core/graph/graph-extractor.js';

function buildHubSpokeGraph() {
  // 1=hub, 2..6=spokes; every spoke calls the hub once.
  const out = new Map();
  const all = new Set(['1', '2', '3', '4', '5', '6']);
  for (const spoke of ['2', '3', '4', '5', '6']) {
    out.set(spoke, new Map([['1', 1.0]]));
  }
  return { out, all };
}

describe('pageRankWeighted', () => {
  it('puts the hub above every spoke', () => {
    const { out, all } = buildHubSpokeGraph();
    const scores = pageRankWeighted(out, all, { maxIterations: 80 });
    const hub = scores.get('1');
    for (const spoke of ['2', '3', '4', '5', '6']) {
      expect(hub).toBeGreaterThan(scores.get(spoke));
    }
  });

  it('weights edges so a hot source contributes more mass', () => {
    const all = new Set(['s', 'a', 'b']);
    // s calls a once, b ten times.
    const out = new Map([
      ['s', new Map([['a', 1.0], ['b', 10.0]])],
    ]);
    const scores = pageRankWeighted(out, all, { maxIterations: 80 });
    expect(scores.get('b')).toBeGreaterThan(scores.get('a'));
  });

  it('returns an empty map for an empty graph', () => {
    expect(pageRankWeighted(new Map(), new Set()).size).toBe(0);
  });

  it('handles dangling nodes without diverging', () => {
    const all = new Set(['a', 'b', 'c']);
    const out = new Map([['a', new Map([['b', 1.0]])]]); // b and c are dangling
    const scores = pageRankWeighted(out, all, { maxIterations: 80 });
    let total = 0;
    for (const v of scores.values()) total += v;
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThan(1.01);
  });
});

describe('buildWeightedAdjacency', () => {
  let dir;
  let db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ss-pr-'));
    db = new Database(join(dir, 'graph.db'));
    createGraphSchema(db);
    const ent = db.prepare("INSERT INTO entities (id, name, type, file_path) VALUES (?, ?, ?, 'a.js')");
    ent.run('hub', 'hub', 'function');
    ent.run('a', 'a', 'function');
    ent.run('b', 'b', 'function');
    const rel = db.prepare('INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)');
    rel.run('a', 'hub', 'hub', 'calls', 1.0);
    rel.run('a', 'hub', 'lib.hub', 'calls', 1.0); // weight collapsed via summation
    rel.run('b', 'hub', 'hub', 'calls', 1.0);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sums weights across multiple rows for the same edge', () => {
    const { outEdges, allNodes } = buildWeightedAdjacency(db);
    expect(allNodes.size).toBe(3);
    expect(outEdges.get('a').get('hub')).toBeGreaterThan(outEdges.get('b').get('hub'));
  });
});

describe('populatePageRankColumn', () => {
  let dir;
  let dbPath;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ss-pr2-'));
    dbPath = join(dir, 'graph.db');
    const db = new Database(dbPath);
    createGraphSchema(db);
    const ent = db.prepare("INSERT INTO entities (id, name, type, file_path) VALUES (?, ?, ?, 'a.js')");
    ent.run('hub', 'hub', 'function');
    ent.run('s1', 's1', 'function');
    ent.run('s2', 's2', 'function');
    const rel = db.prepare('INSERT INTO relationships (source_id, target_id, target_name, type, weight) VALUES (?, ?, ?, ?, ?)');
    rel.run('s1', 'hub', 'hub', 'calls', 1);
    rel.run('s2', 'hub', 'hub', 'calls', 1);
    db.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes ordered scores', () => {
    const db = new Database(dbPath);
    const stats = populatePageRankColumn(db);
    expect(stats.entities).toBe(3);
    expect(stats.written).toBe(3);
    const scores = db.prepare('SELECT id, page_rank FROM entities').all();
    const byId = Object.fromEntries(scores.map(r => [r.id, r.page_rank]));
    expect(byId.hub).toBeGreaterThan(byId.s1);
    expect(byId.hub).toBeGreaterThan(byId.s2);
    db.close();
  });

  it('is idempotent: a second run writes the same scores', () => {
    const db = new Database(dbPath);
    populatePageRankColumn(db);
    const first = db.prepare('SELECT id, page_rank FROM entities ORDER BY id').all();
    populatePageRankColumn(db);
    expect(db.prepare('SELECT id, page_rank FROM entities ORDER BY id').all()).toEqual(first);
    db.close();
  });
});

// The maintainer's PageRank refresh started from 1/n every pass (often all 50 iterations).
// It now starts from the stored scores: after a small graph change it must take fewer
// iterations and land at least as close to the converged fixed point as a cold start.
describe('pageRankWeighted warm start', () => {
  function graph(seed, n) {
    let s = seed >>> 0;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const nodes = new Set(Array.from({ length: n }, (_, i) => `e${i}`));
    const out = new Map();
    for (let i = 0; i < n * 3; i++) {
      const a = `e${Math.floor(r() * n)}`; const b = `e${Math.floor(r() * n)}`;
      if (!out.has(a)) out.set(a, new Map());
      out.get(a).set(b, (out.get(a).get(b) || 0) + 1 + Math.floor(r() * 3));
    }
    return { nodes, out };
  }
  const l1 = (a, b) => { let d = 0; for (const [k, v] of a) d += Math.abs(v - b.get(k)); return d; };

  it('converges in fewer iterations to a result no further from the fixed point', () => {
    const { nodes, out } = graph(7, 3000);
    const before = pageRankWeighted(out, nodes);
    // A small change: five new edges and one new node.
    nodes.add('fresh');
    for (let i = 0; i < 5; i++) out.set(`e${i * 13}`, new Map([...(out.get(`e${i * 13}`) || []), [`e${i * 29 + 1}`, 2], ['fresh', 1]]));
    const ref = pageRankWeighted(out, nodes, { maxIterations: 2000, convergence: 1e-12 });
    const coldStats = {};
    const cold = pageRankWeighted(out, nodes, { stats: coldStats });
    const warmStats = {};
    const warm = pageRankWeighted(out, nodes, { initialScores: before, stats: warmStats });
    expect(warmStats.iterations).toBeLessThan(coldStats.iterations);
    expect(l1(warm, ref)).toBeLessThanOrEqual(l1(cold, ref) + 1e-9);
    expect(l1(warm, ref)).toBeLessThan(1e-4);
  });
});
