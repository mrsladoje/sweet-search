import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  pageRankWeighted,
  buildWeightedAdjacency,
  ensurePageRankColumn,
  populatePageRankColumn,
} from '../../core/graph/structural-pagerank.js';

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
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        file_path TEXT,
        stale_since INTEGER DEFAULT NULL
      );
      CREATE TABLE relationships (
        source_id TEXT,
        target_id TEXT,
        target_name TEXT,
        type TEXT,
        weight REAL DEFAULT 1.0
      );
    `);
    const ent = db.prepare('INSERT INTO entities (id, name, type) VALUES (?, ?, ?)');
    ent.run('hub', 'hub', 'function');
    ent.run('a', 'a', 'function');
    ent.run('b', 'b', 'function');
    const rel = db.prepare('INSERT INTO relationships (source_id, target_id, type, weight) VALUES (?, ?, ?, ?)');
    rel.run('a', 'hub', 'calls', 1.0);
    rel.run('a', 'hub', 'calls', 1.0); // weight collapsed via summation
    rel.run('b', 'hub', 'calls', 1.0);
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
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        file_path TEXT,
        stale_since INTEGER DEFAULT NULL
      );
      CREATE TABLE relationships (
        source_id TEXT,
        target_id TEXT,
        target_name TEXT,
        type TEXT,
        weight REAL DEFAULT 1.0
      );
    `);
    const ent = db.prepare('INSERT INTO entities (id, name, type) VALUES (?, ?, ?)');
    ent.run('hub', 'hub', 'function');
    ent.run('s1', 's1', 'function');
    ent.run('s2', 's2', 'function');
    const rel = db.prepare('INSERT INTO relationships (source_id, target_id, type, weight) VALUES (?, ?, ?, ?)');
    rel.run('s1', 'hub', 'calls', 1);
    rel.run('s2', 'hub', 'calls', 1);
    db.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('adds the page_rank column and writes ordered scores', () => {
    const db = new Database(dbPath);
    expect(ensurePageRankColumn(db)).toBe(true);
    const stats = populatePageRankColumn(db);
    expect(stats.entities).toBe(3);
    expect(stats.written).toBe(3);
    const scores = db.prepare('SELECT id, page_rank FROM entities').all();
    const byId = Object.fromEntries(scores.map(r => [r.id, r.page_rank]));
    expect(byId.hub).toBeGreaterThan(byId.s1);
    expect(byId.hub).toBeGreaterThan(byId.s2);
    db.close();
  });

  it('is idempotent: a second run does not break or re-add the column', () => {
    const db = new Database(dbPath);
    populatePageRankColumn(db);
    populatePageRankColumn(db);
    const cols = db.prepare('PRAGMA table_info(entities)').all().map(c => c.name);
    expect(cols.filter(n => n === 'page_rank').length).toBe(1);
    db.close();
  });
});
