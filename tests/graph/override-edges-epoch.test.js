/**
 * Override derivation on an epoch-versioned graph (the incremental
 * maintainer's schema, or `--resolve-only` on a maintained index).
 *
 * Before the review fix the pass deleted EVERY `overrides` row (retired ones
 * too) and read retired entities and inheritance rows, so a re-derivation on
 * a live index could invent edges from retired facts and pulled rows out from
 * under pinned readers. Now it reads live rows only and diffs: unchanged
 * edges keep their row, vanished edges are retired at the writing epoch, new
 * edges are inserted at that epoch, and retired rows are never touched.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let GraphExtractor;
let createGraphSchema;
let insertGraph;
let resolveRelationshipTargets;
let deriveOverrideEdges;
let computeOverrideEdges;
let migrateEntitiesSchema;
let migrateRelationshipsSchema;
let resetTreeSitterProvider;

beforeAll(async () => {
  ({ GraphExtractor, createGraphSchema, insertGraph } = await import('../../core/graph/graph-extractor.js'));
  ({ resolveRelationshipTargets } = await import('../../core/graph/relationship-resolver.js'));
  ({ deriveOverrideEdges, computeOverrideEdges } = await import('../../core/graph/override-edges.js'));
  ({ migrateEntitiesSchema, migrateRelationshipsSchema } = await import('../../core/incremental-indexing/infrastructure/schema-migrations.mjs'));
  ({ resetTreeSitterProvider } = await import('../../core/infrastructure/tree-sitter-provider.js'));
});

afterAll(() => {
  if (resetTreeSitterProvider) resetTreeSitterProvider();
});

let originalLog;
beforeEach(() => { originalLog = console.log; console.log = () => {}; });
afterEach(() => { console.log = originalLog; });

const FILES = {
  'src/Animal.kt': 'open class Animal {\n  open fun sound(): String = ""\n  open fun walk() {}\n}\n',
  'src/Dog.kt': 'class Dog : Animal() {\n  override fun sound(): String = "w"\n  override fun walk() {}\n}\n',
};

async function buildVersioned() {
  const db = new Database(':memory:');
  const hasFts5 = createGraphSchema(db);
  const ex = new GraphExtractor();
  const ents = [];
  const rels = [];
  for (const [filePath, content] of Object.entries(FILES)) {
    const r = await ex.extractFromFile(filePath, content);
    ents.push(...r.entities);
    rels.push(...r.relationships);
  }
  insertGraph(db, ents, rels, hasFts5, { syncFts: false });
  resolveRelationshipTargets(db);
  migrateEntitiesSchema(db);
  migrateRelationshipsSchema(db);
  return db;
}

const liveOverrides = (db) => db.prepare(`
  SELECT s.name AS src, t.name AS dst, r.epoch_written AS written
  FROM relationships r JOIN entities s ON s.id = r.source_id JOIN entities t ON t.id = r.target_id
  WHERE r.type = 'overrides' AND r.epoch_retired IS NULL ORDER BY src, dst
`).all();

describe('override edges on an epoch-versioned graph', () => {
  it('a re-derivation with no change keeps every row (no churn)', async () => {
    const db = await buildVersioned();
    const before = db.prepare("SELECT rowid FROM relationships WHERE type = 'overrides' ORDER BY rowid").all();
    expect(before.length).toBe(2);
    const stats = deriveOverrideEdges(db, null, { epoch: 5 });
    expect(stats).toMatchObject({ edges: 0, retired: 0 });
    expect(db.prepare("SELECT rowid FROM relationships WHERE type = 'overrides' ORDER BY rowid").all()).toEqual(before);
    db.close();
  });

  it('a retired base method: its edge is retired at the epoch, the successor gets a new row', async () => {
    const db = await buildVersioned();
    const old = db.prepare("SELECT * FROM entities WHERE name = 'walk' AND file_path = 'src/Animal.kt'").get();
    // What the reconciler does when Animal.walk changes signature at epoch 7.
    db.prepare('UPDATE entities SET epoch_retired = 7, stale_since = 7 WHERE id = ?').run(old.id);
    db.prepare(`INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line, parent_class, epoch_written)
                VALUES ('walk@e7', 'src/Animal.kt', ?, 'walk', 'open fun walk(steps: Int) {}', 3, 3, ?, 7)`)
      .run(old.type, old.parent_class);

    deriveOverrideEdges(db, null, { epoch: 7 });
    const all = db.prepare(`SELECT target_id, epoch_written, epoch_retired FROM relationships
                            WHERE type = 'overrides' AND target_name LIKE '%walk' ORDER BY rowid`).all();
    expect(all).toEqual([
      { target_id: old.id, epoch_written: 0, epoch_retired: 7 },
      { target_id: 'walk@e7', epoch_written: 7, epoch_retired: null },
    ]);
    expect(liveOverrides(db).map(r => `${r.src}->${r.dst}`)).toEqual(['sound->sound', 'walk->walk']);
    db.close();
  });

  it('retired inheritance rows and entities never produce edges', async () => {
    const db = await buildVersioned();
    // Dog stops extending Animal at epoch 9 (the reconciler retires the row).
    db.prepare("UPDATE relationships SET epoch_retired = 9 WHERE type = 'extends'").run();
    deriveOverrideEdges(db, null, { epoch: 9 });
    expect(liveOverrides(db)).toEqual([]);
    // Retired rows stay for pinned readers.
    expect(db.prepare("SELECT COUNT(*) AS n FROM relationships WHERE type = 'overrides' AND epoch_retired = 9").get().n).toBe(2);
    db.close();
  });

  it('the pure computation does not depend on row order', async () => {
    const db = await buildVersioned();
    const ents = db.prepare('SELECT id, name, type, file_path, parent_class, signature, start_line, end_line FROM entities').all();
    const inh = db.prepare("SELECT source_id, target_id, context_line FROM relationships WHERE type IN ('extends','implements') AND target_id IS NOT NULL").all();
    const a = computeOverrideEdges(ents, inh, []);
    const b = computeOverrideEdges([...ents].reverse(), [...inh].reverse(), []);
    const key = (e) => `${e.source}>${e.target}`;
    expect(b.map(key).sort()).toEqual(a.map(key).sort());
    db.close();
  });
});
