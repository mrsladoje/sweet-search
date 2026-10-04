/**
 * A resolved graph never depends on the order files were discovered in.
 *
 * Ties between equal candidates used to follow entity rowid order, which is
 * file discovery order in a full build (and re-insert order in a maintained
 * graph): on ocelot, 733 C# `imports` rows bound to one of 209 `Ocelot`
 * namespace blocks, and which one followed the file order. Every resolver
 * input is now sorted (entity-order.js), and an import with several
 * same-named candidates and no evidence gets no edge.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { compareEntitiesForResolution } from '../../core/graph/entity-order.js';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function build(files, order) {
  const root = mkdtempSync(join(tmpdir(), 'ss-determinism-'));
  roots.push(root);
  const extractor = new GraphExtractor({ projectRoot: root });
  const db = new Database(join(root, 'g.db'));
  const log = console.log;
  console.log = () => {};
  try {
    const fts = createGraphSchema(db);
    for (const rel of order) {
      const out = await extractor.extractFromFile(rel, files[rel].join('\n'));
      insertGraph(db, out.entities, out.relationships, fts, { syncFts: false, callSites: out.callSites, files: out.file ? [out.file] : [] });
    }
    resolveRelationshipTargets(db);
  } finally {
    console.log = log;
  }
  const rels = db.prepare('SELECT source_id, target_id, target_name, type, context_line FROM relationships')
    .all().map((r) => JSON.stringify(r)).sort();
  // The `using` line of Alpha.cs (line 1; each namespace line is line 2).
  const imports = db.prepare("SELECT target_name, target_id FROM relationships WHERE type = 'imports' AND target_name = 'App.Core' AND context_line = 1").all();
  db.close();
  return { rels, imports };
}

// Three C# files that each open `namespace App.X`: the declaration lines are
// stored as `imports` rows, and `App` names three namespace blocks.
// `using App.Core;` in Alpha.cs: App.Core is declared in two other files and Alpha's own
// namespace is App.A, so nothing tells which declaration the import means.
const FILES = {
  'src/A/Alpha.cs': ['using App.Core;', 'namespace App.A', '{', '  public class Alpha {', '    public void Run() { var h = new Helper(); h.Go(); }', '  }', '}'],
  'src/B/Beta.cs': ['// Beta', 'namespace App.Core', '{', '  public class Beta {', '    public void Go() {}', '  }', '}'],
  'src/C/Helper.cs': ['// Helper', 'namespace App.Core', '{', '  public class Helper {', '    public void Go() {}', '  }', '}'],
};

describe('resolution does not depend on file order', () => {
  it('two discovery orders give identical relationships', async () => {
    const names = Object.keys(FILES);
    const a = await build(FILES, names);
    const b = await build(FILES, [...names].reverse());
    const c = await build(FILES, [names[1], names[2], names[0]]);
    expect(b.rels).toEqual(a.rels);
    expect(c.rels).toEqual(a.rels);
  });

  it('an import with several same-named candidates and no evidence gets no edge', async () => {
    const { imports } = await build(FILES, Object.keys(FILES));
    expect(imports.length).toBeGreaterThan(0);
    for (const row of imports) expect(row.target_id).toBeNull();
  });

  it('compareEntitiesForResolution orders by path, position, kind, name, id', () => {
    const rows = [
      { file_path: 'b.cs', start_line: 1, end_line: 2, type: 'class', name: 'X', id: '1' },
      { file_path: 'a.cs', start_line: 9, end_line: 9, type: 'class', name: 'X', id: '2' },
      { file_path: 'a.cs', start_line: 3, end_line: 9, type: 'method', name: 'Y', id: '3' },
      { file_path: 'a.cs', start_line: 3, end_line: 9, type: 'class', name: 'Z', id: '4' },
    ];
    expect([...rows].sort(compareEntitiesForResolution).map((r) => r.id)).toEqual(['4', '3', '2', '1']);
    expect([...rows].reverse().sort(compareEntitiesForResolution).map((r) => r.id)).toEqual(['4', '3', '2', '1']);
  });
});
