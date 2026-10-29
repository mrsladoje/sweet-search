/**
 * The ss-trace caller lookups (graph-name-indexes.js): the index candidates must hold every
 * row the LIKE patterns of getCallers / getReverseDependents match (they still decide).
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { GRAPH_NAME_INDEXES, targetNameCandidateSql } from '../../core/infrastructure/graph-name-indexes.js';
import { lowerCamel } from '../../core/infrastructure/structural-context-utils.js';

const TARGETS = [
  'foo', 'Foo', 'foo.bar', 'Foo.bar', 'Foo::bar', 'x.foo', 'x::foo', 'a:foo', '.foo', 'foo.', 'this.#foo',
  'Ünïcode', 'x.Ünïcode', 'ünïcode.y', 'ÜNÏCODE', 'x.ÜNÏCODE', 'Größe', 'x.Größe', 'größe.y',
  'get', 'x.GET', 'Get.y', 'xfoo', 'foox', 'x.fooo',
];

function graph() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE relationships (target_id TEXT, target_name TEXT)');
  db.exec('CREATE INDEX idx_rel_target_name ON relationships(target_name)');
  for (const [name, on] of Object.entries(GRAPH_NAME_INDEXES)) if (name.startsWith('idx_rel')) db.exec(`CREATE INDEX ${name} ${on}`);
  const ins = db.prepare('INSERT INTO relationships (target_id, target_name) VALUES (?, ?)');
  TARGETS.forEach((t, i) => ins.run(`id${i}`, t));
  return db;
}

describe('targetNameCandidateSql', () => {
  const db = graph();
  for (const q of ['foo', 'Foo', 'bar', 'Ünïcode', 'ünïcode', 'Größe', 'get', 'Get', '#foo']) {
    it(`finds every LIKE match of ${q}`, () => {
      const like = db.prepare(`SELECT rowid FROM relationships WHERE target_name = ? OR target_name LIKE ?
        OR target_name LIKE ? OR target_name LIKE ? OR target_name LIKE ?`)
        .all(q, `${q}.%`, `${lowerCamel(q)}.%`, `%.${q}`, `%::${q}`).map((r) => r.rowid);
      const cand = targetNameCandidateSql(q);
      const got = new Set(db.prepare(cand.sql).all(...cand.params).map((r) => r.rowid));
      expect(like.filter((r) => !got.has(r))).toEqual([]);
    });
  }

  it('reads the indexes, not the table', () => {
    const cand = targetNameCandidateSql('Foo');
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${cand.sql}`).all(...cand.params).map((r) => r.detail).join('\n');
    expect(plan).not.toMatch(/SCAN relationships/);
  });

  it('leaves dotted names to the scanning query', () => {
    expect(targetNameCandidateSql('a.b')).toBeNull();
    expect(targetNameCandidateSql('a::b')).toBeNull();
  });
});
