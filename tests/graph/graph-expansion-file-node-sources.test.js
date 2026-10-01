// Graph expansion follows reverse edges to the neighbours that call / import a
// seed. Top-level code has a FILE node as its source (graph/file-nodes.js),
// which is no entity. Such a source must never take an expansion slot: the
// caller cuts the neighbour list to `maxExpanded` before the entity lookup,
// and the 2-hop pass would expand from it.
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { expandOneHop, expandSecondHop, expandResults } from '../../core/graph/graph-expansion.js';

const EDGES = new Set(['imports', 'extends', 'implements', 'uses', 'calls']);

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE entities (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
      signature TEXT, start_line INTEGER, end_line INTEGER, stale_since INTEGER DEFAULT NULL);
    CREATE TABLE relationships (source_id TEXT, target_id TEXT, target_name TEXT NOT NULL, type TEXT NOT NULL, weight REAL DEFAULT 1.0);
  `);
  const ent = db.prepare('INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const rel = db.prepare('INSERT INTO relationships (source_id, target_id, target_name, type) VALUES (?, ?, ?, ?)');
  ent.run('seed', 'src/lib.js', 'function', 'boot', 'function boot()', 1, 3);
  ent.run('caller', 'src/app.js', 'function', 'start', 'function start()', 1, 5);
  ent.run('other', 'src/util.js', 'function', 'log', 'function log()', 1, 2);
  // Ten scripts call the seed from top-level code: their source is a file node.
  for (let i = 0; i < 10; i++) {
    rel.run(`filenode${i}`, 'seed', 'boot', 'calls');
    // ...and each script's top-level code also calls `log`.
    rel.run(`filenode${i}`, 'other', 'log', 'calls');
  }
  rel.run('caller', 'seed', 'boot', 'calls');
  return db;
}

describe('graph expansion skips file-node sources', () => {
  it('a reverse edge from a file node is no neighbour', () => {
    const db = makeDb();
    const one = expandOneHop(db, new Set(['seed']), EDGES);
    expect([...one.keys()]).toEqual(['caller']);
    db.close();
  });

  it('a file node never seeds the 2-hop pass', () => {
    const db = makeDb();
    const one = expandOneHop(db, new Set(['seed']), EDGES);
    expandSecondHop(db, new Set(['seed']), one, EDGES);
    // `other` is reachable only through the file nodes' top-level calls.
    expect(one.has('other')).toBe(false);
    db.close();
  });

  it('the real caller survives the maxExpanded cut', () => {
    const db = makeDb();
    const out = expandResults(db, [{ id: 'seed', entity_id: 'seed', file_path: 'src/lib.js', score: 1, content: 'function boot() {}' }], {
      expandMode: '1hop', maxExpanded: 1, tokenBudget: 100_000,
    });
    expect(out.filter((r) => r.is_expanded).map((r) => r.id || r.entity_id)).toEqual(['caller']);
    db.close();
  });
});
