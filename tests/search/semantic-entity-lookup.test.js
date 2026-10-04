import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeGraphRepository } from '../../core/infrastructure/code-graph-repository.js';
import {
  buildAlsoCandidates,
  createSemanticEntityLookup,
  spanEntityNames,
} from '../../core/search/semantic-also.js';

const FILE = 'src/a.js';
const dirs = [];
const repos = [];
const span = (startLine, endLine) => ({ startLine, endLine });

function fixture({ epochColumns = true, epoch = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'semantic-entity-lookup-'));
  dirs.push(dir);
  const dbPath = path.join(dir, 'code-graph.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, file_path TEXT,
      start_line INTEGER, end_line INTEGER, parent_class TEXT, stale_since INTEGER
      ${epochColumns ? ', epoch_written INTEGER, epoch_retired INTEGER' : ''}
    );
    CREATE INDEX idx_entities_file ON entities(file_path);
    CREATE INDEX idx_entities_active ON entities(id, name, type, file_path) WHERE stale_since IS NULL;
    CREATE INDEX idx_entities_sig_hash ON entities(file_path, type, name);
  `);
  const insert = epochColumns
    ? db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    : db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  function add(id, name, type, start, end, opts = {}) {
    const args = [id, name, type, opts.file ?? FILE, start, end, opts.parent ?? null, opts.stale ?? null];
    if (epochColumns) args.push(opts.written ?? 1, opts.retired ?? null);
    insert.run(...args);
  }
  const manifest = (value, graphPath = 'code-graph.db') => writeFileSync(
    path.join(dir, 'reconcile-manifest.json'),
    JSON.stringify({ epoch: value, codeGraph: { path: graphPath, epoch: value } }),
  );
  if (epoch !== null) manifest(epoch);
  const repo = new CodeGraphRepository(dbPath);
  repos.push(repo);
  return { db, dbPath, add, repo, manifest, dir };
}

afterEach(() => {
  for (const repo of repos) repo.close();
  repos.length = 0;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function random(seed = 42) {
  let state = seed;
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

describe('request-local semantic entity lookup', () => {
  it('runs one entity statement and no further SQL for names or alternatives', () => {
    const { db, dbPath, add, repo } = fixture();
    add('a', 'alpha', 'function', 1, 20);
    add('b', 'beta', 'method', 30, 60, { parent: 'Owner' });
    db.close();
    const statements = [];
    repo._db = new Database(dbPath, { readonly: true, verbose: sql => statements.push(sql) });
    const printed = [span(3, 10)];
    const pool = [{ startLine: 32, endLine: 35, score: 1 }];
    const lookup = createSemanticEntityLookup(repo, FILE, printed, pool);
    const selects = () => statements.filter(sql => /^\s*(SELECT|WITH)\b/i.test(sql));
    expect(selects()).toHaveLength(1);
    expect(spanEntityNames(lookup, FILE, printed[0])).toEqual(['alpha']);
    expect(buildAlsoCandidates(pool, printed, { file: FILE, graph: lookup }))
      .toEqual([{ startLine: 30, endLine: 60, names: ['Owner.beta'], name: 'Owner.beta', kind: 'method', score: 1 }]);
    expect(selects()).toHaveLength(1);
    const plan = repo._db.prepare(`EXPLAIN QUERY PLAN ${selects()[0]}`).all();
    expect(plan.filter(row => /\b(SEARCH|SCAN) entities\b/.test(row.detail))).toHaveLength(1);
    expect(lookup.findEntitiesInRange('src/other.js', 3, 10)).toEqual([]);
    expect(lookup.findEnclosingEntity('src/other.js', 3, 10)).toBeNull();
  });

  it('preserves SQL ties, same-start ordering, unnamed entities, and null endpoints', () => {
    const { db, add, repo } = fixture();
    add('first', 'zFirst', 'class', 10, 40);
    add('second', 'aSecond', 'class', 5, 35);
    add('unnamed', null, 'variable', 16, 20);
    add('outer', 'outer', 'function', 50, 80);
    add('inner', 'inner', 'function', 50, 60);
    add('no-end', 'noEnd', 'function', 55, null);
    add('no-start', 'noStart', 'function', null, 99);
    add('other', 'other', 'function', 1, 100, { file: 'src/other.js' });
    db.close();
    const ranges = [[21, 30], [17, 19], [1, 99], [50, 60], [51, 58]].map(([s, e]) => span(s, e));
    const lookup = createSemanticEntityLookup(repo, FILE, ranges);
    expect(lookup.findEnclosingEntity(FILE, 17, 19)?.id).toBe('unnamed');
    for (const { startLine, endLine } of ranges) {
      expect(lookup.findEnclosingEntity(FILE, startLine, endLine)).toEqual(repo.findEnclosingEntity(FILE, startLine, endLine));
      expect(lookup.findEntitiesInRange(FILE, startLine, endLine)).toEqual(repo.findEntitiesInRange(FILE, startLine, endLine));
      expect(spanEntityNames(lookup, FILE, span(startLine, endLine)))
        .toEqual(spanEntityNames(repo, FILE, span(startLine, endLine)));
    }
  });

  it.each(['no indexes', 'file index', 'analyzed indexes'])('keeps tie ordering with %s', indexCase => {
    const { db, add, repo } = fixture();
    db.transaction(() => {
      for (let i = 99; i >= 0; i--) {
        add(`e${i}`, `f${String(i).padStart(3, '0')}`, 'function', 10, 40);
      }
      for (let i = 0; i < 300; i++) {
        add(`other${i}`, `other${i}`, 'function', 10, 40, { file: `src/other${i % 5}.js` });
      }
    })();
    if (indexCase !== 'analyzed indexes') {
      db.exec('DROP INDEX idx_entities_active; DROP INDEX idx_entities_sig_hash');
      if (indexCase === 'no indexes') db.exec('DROP INDEX idx_entities_file');
    } else {
      db.exec('ANALYZE');
    }
    db.close();
    const ranges = [span(10, 40), span(15, 30)];
    const lookup = createSemanticEntityLookup(repo, FILE, ranges);
    for (const { startLine, endLine } of ranges) {
      expect(lookup.findEnclosingEntity(FILE, startLine, endLine)).toEqual(repo.findEnclosingEntity(FILE, startLine, endLine));
      expect(lookup.findEntitiesInRange(FILE, startLine, endLine)).toEqual(repo.findEntitiesInRange(FILE, startLine, endLine));
    }
    expect(lookup.findEntitiesInRange(FILE, 10, 40)).toHaveLength(64);
  });

  it('keeps the 64-row range cap without imposing a whole-file cap', () => {
    const { db, add, repo } = fixture();
    db.transaction(() => {
      for (let i = 0; i < 2200; i++) add(`e${i}`, `f${i}`, 'function', i * 4 + 1, i * 4 + 3);
    })();
    db.close();
    const lookup = createSemanticEntityLookup(repo, FILE, [span(1, 10000), span(8797, 8799)]);
    expect(lookup.findEntitiesInRange(FILE, 1, 10000)).toEqual(repo.findEntitiesInRange(FILE, 1, 10000));
    expect(lookup.findEntitiesInRange(FILE, 1, 10000)).toHaveLength(64);
    expect(lookup.findEnclosingEntity(FILE, 8797, 8799)?.id).toBe('e2199');
    expect(lookup.findEntitiesInRange(FILE, 8797, 8799).map(e => e.id)).toEqual(['e2199']);
  });

  it.each([true, false])('matches direct SQL and output helpers on seeded ranges (epoch columns: %s)', epochColumns => {
    const { db, add, repo } = fixture({ epochColumns, epoch: epochColumns ? 4 : null });
    const next = random();
    const kinds = ['class', 'function', 'method', 'arrowFunction', 'variable', 'chunk'];
    db.transaction(() => {
      for (let i = 0; i < 400; i++) {
        const start = 1 + next(1000);
        add(`e${i}`, i % 19 === 0 ? null : `f${i}`, kinds[next(kinds.length)], start, start + next(100), {
          parent: i % 11 === 0 ? 'Owner' : null,
          stale: i % 23 === 0 ? 123 : null,
          written: i % 13 === 0 ? 7 : 1,
          retired: i % 17 === 0 ? 3 : i % 29 === 0 ? 6 : null,
        });
      }
    })();
    db.close();
    const ranges = Array.from({ length: 1000 }, () => {
      const start = 1 + next(1100);
      return { ...span(start, start + next(150)), includeInside: true };
    });
    const results = repo.findEntitiesForRanges(FILE, ranges);
    expect(results).toHaveLength(ranges.length);
    for (let i = 0; i < ranges.length; i++) {
      const { startLine, endLine } = ranges[i];
      expect(results[i].enclosing).toEqual(repo.findEnclosingEntity(FILE, startLine, endLine));
      expect(results[i].inRange).toEqual(repo.findEntitiesInRange(FILE, startLine, endLine));
      if (i % 10 !== 0) continue;
      const printed = [i % 20 === 0
        ? { startLine, endLine, truncated: true, text: 'line\n'.repeat(1 + next(20)) }
        : span(startLine, endLine)];
      const pool = Array.from({ length: 20 }, (_, j) => {
        const s = 1 + next(1100);
        return { startLine: s, endLine: s + next(50), score: 1 / (j + 1), symbol: `label${j}`, type: 'function' };
      });
      const lookup = createSemanticEntityLookup(repo, FILE, printed, pool);
      expect(spanEntityNames(lookup, FILE, printed[0])).toEqual(spanEntityNames(repo, FILE, printed[0]));
      expect(buildAlsoCandidates(pool, printed, { file: FILE, graph: lookup }))
        .toEqual(buildAlsoCandidates(pool, printed, { file: FILE, graph: repo }));
    }
  });

  it('refreshes manifest visibility between calls without changing an existing lookup', () => {
    const { db, add, repo, manifest } = fixture({ epoch: 2 });
    add('old', 'oldName', 'function', 1, 20, { stale: 123, retired: 3 });
    add('new', 'newName', 'function', 1, 20, { written: 3 });
    add('stale', 'stale', 'function', 25, 40, { stale: 123 });
    db.close();
    const ranges = [span(3, 10), span(25, 40)];
    const oldLookup = createSemanticEntityLookup(repo, FILE, ranges);
    expect(oldLookup.findEnclosingEntity(FILE, 3, 10)?.name).toBe('oldName');
    expect(oldLookup.findEntitiesInRange(FILE, 25, 40)).toEqual([]);
    manifest(4);
    const newLookup = createSemanticEntityLookup(repo, FILE, ranges);
    expect(newLookup.findEnclosingEntity(FILE, 3, 10)?.name).toBe('newName');
    expect(oldLookup.findEnclosingEntity(FILE, 3, 10)?.name).toBe('oldName');
  });

  it('reads source graph changes and redirected graph paths on the next call', () => {
    const { db, add, repo, dbPath, manifest, dir } = fixture();
    add('a', 'before', 'function', 1, 20);
    db.close();
    const lookup = () => createSemanticEntityLookup(repo, FILE, [span(3, 10)]);
    expect(lookup().findEnclosingEntity(FILE, 3, 10)?.name).toBe('before');
    const writer = new Database(dbPath);
    writer.prepare('UPDATE entities SET name = ? WHERE id = ?').run('after', 'a');
    writer.close();
    expect(lookup().findEnclosingEntity(FILE, 3, 10)?.name).toBe('after');
    const replacementPath = path.join(dir, 'replacement.db');
    copyFileSync(dbPath, replacementPath);
    const replacement = new Database(replacementPath);
    replacement.prepare('UPDATE entities SET name = ? WHERE id = ?').run('redirected', 'a');
    replacement.close();
    manifest(4, 'replacement.db');
    expect(lookup().findEnclosingEntity(FILE, 3, 10)?.name).toBe('redirected');
  });

  it('falls back safely for absent, unreadable, or incomplete graphs', () => {
    expect(createSemanticEntityLookup(null, FILE, [span(1, 10)])).toBeNull();
    const { db, repo, dbPath } = fixture();
    db.exec('DROP TABLE entities');
    db.close();
    const ranges = [{ ...span(1, 10), includeInside: true }];
    expect(repo.findEntitiesForRanges(FILE, [])).toEqual([]);
    expect(repo.findEntitiesForRanges(FILE, ranges)).toEqual([]);
    expect(createSemanticEntityLookup(repo, FILE, ranges)).toBeNull();
    repo.close();
    writeFileSync(dbPath, 'not a SQLite database');
    expect(repo.findEntitiesForRanges(FILE, ranges)).toEqual([]);
    expect(createSemanticEntityLookup(repo, FILE, ranges)).toBeNull();
    repo.close();
    const missing = new CodeGraphRepository(path.join(path.dirname(dbPath), 'missing.db'));
    repos.push(missing);
    expect(missing.findEntitiesForRanges(FILE, ranges)).toEqual([]);
  });
});
