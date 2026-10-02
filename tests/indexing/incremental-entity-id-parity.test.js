// Entity ids (GraphExtractor.entityId) must be unique per definition and the
// same in a full build and in a maintained graph:
//  - same-named members of different classes are separate entities;
//  - repeated definitions (a Makefile variable set in two branches) are
//    separate entities; an exact repeat of a data key (YAML) is one;
//  - editing, moving (lines shift), deleting and adding members keeps the
//    maintained graph equal to a fresh build: same ids, same lines, same
//    resolved call edges.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake-e2e', dimension: 8, hnswDimension: 8 });
const silentLogger = { info() {}, warn() {}, error() {} };
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

describe('entity ids: unique per definition, identical in full and maintained graphs', () => {
  let projectRoot;
  let stateDir;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-entity-ids-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const write = (rel, lines) => writeFileSync(join(projectRoot, rel), lines.join('\n'));
  const enqueue = (...rels) => writeFileSync(
    join(stateDir, 'index-maintainer-queue.jsonl'),
    rels.map((file_path) => JSON.stringify({ file_path })).join('\n') + '\n',
  );
  const tick = () => runProductionReconcileTick({
    projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO, logger: silentLogger,
    config: { filesPerTick: 20, cpuBudgetMs: 10_000 },
  });

  /**
   * Live entities as `logicalId file type name start-end parent` lines, and
   * live call edges as `caller -> callee` by entity description.
   * A full build stores the extractor id in `id`; a maintained graph stores
   * it in `logical_entity_id` (its `id` is a per-epoch physical id).
   */
  function snapshot(dbPath, { maintained }) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const live = maintained ? ' AND epoch_retired IS NULL' : '';
      const rows = db.prepare(`SELECT id, ${maintained ? 'logical_entity_id' : 'id AS logical_entity_id'}, file_path, type, name, start_line, end_line, parent_class, parent_id, hierarchy_level FROM entities WHERE type != 'file'${live}`).all();
      const describe = (e) => `${e.file_path}#${e.parent_class ? `${e.parent_class}.` : ''}${e.name}@${e.start_line}`;
      const byId = new Map(rows.map((e) => [e.id, describe(e)]));
      // `parent_id` is a stored row id (physical in a maintained graph): it
      // must name a LIVE row of the parent, described the same way.
      const entities = rows
        .map((e) => `${e.logical_entity_id} ${e.file_path} ${e.type} ${e.name} ${e.start_line}-${e.end_line} ${e.parent_class || '-'} ^${e.parent_id ? byId.get(e.parent_id) || 'dead' : '-'} L${e.hierarchy_level}`)
        .sort();
      const calls = db.prepare(`SELECT source_id, target_id, target_name, context_line FROM relationships WHERE type = 'calls'${live}`).all()
        .map((r) => `${byId.get(r.source_id) || 'file'} ${r.target_name}:${r.context_line} -> ${r.target_id ? byId.get(r.target_id) || 'missing' : 'null'}`)
        .sort();
      return { entities, calls };
    } finally {
      db.close();
    }
  }

  async function fullBuild(files) {
    const dbPath = join(projectRoot, 'full-graph.db');
    rmSync(dbPath, { force: true });
    const db = new Database(dbPath);
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot, files }) });
      const ents = []; const rels = []; const sites = []; const nodes = [];
      for (const rel of files) {
        const out = await extractor.extractFromFile(rel, readFileSync(join(projectRoot, rel), 'utf-8'));
        ents.push(...out.entities); rels.push(...out.relationships); sites.push(...(out.callSites || [])); nodes.push(out.file);
      }
      // Every extracted entity is stored: no two share an id.
      expect(new Set(ents.map((e) => e.id)).size).toBe(ents.length);
      insertGraph(db, ents, rels, fts, { syncFts: false, callSites: sites, files: nodes });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
      db.close();
    }
    return snapshot(dbPath, { maintained: false });
  }

  async function expectParity(files) {
    enqueue(...files);
    await tick();
    const full = await fullBuild(files);
    const inc = snapshot(join(stateDir, 'code-graph.db'), { maintained: true });
    expect(inc.entities).toEqual(full.entities);
    expect(inc.calls).toEqual(full.calls);
    return full;
  }

  // `file type name start parent` (end lines follow each extractor's own span rule).
  const shapes = (lines) => lines.map((l) => {
    const [, file, type, name, span, parent] = l.split(' ');
    return `${file} ${type} ${name} ${span.split('-')[0]} ${parent}`;
  });

  it('same-named members, repeated definitions and data keys through add, edit, move, delete', async () => {
    const files = ['src/shapes.ts', 'src/use.ts', 'Makefile', 'ci.yml'];
    write('src/shapes.ts', [
      'export class Alpha {',
      '  count = 0;',
      '  run(): number { return 1; }',
      '}',
      'export class Beta {',
      '  count = 0;',
      '  run(): number { return 2; }',
      '}',
    ]);
    write('src/use.ts', [
      "import { Alpha, Beta } from './shapes';",
      'export function go(): number {',
      '  const a = new Alpha();',
      '  const b = new Beta();',
      '  return a.run() + b.run();',
      '}',
    ]);
    write('Makefile', [
      'ifeq ($(CI),1)',
      'MODE = fast',
      'else',
      'MODE = fast',
      'endif',
    ]);
    write('ci.yml', [
      'jobs:',
      '  a:',
      '    run: make',
      '  b:',
      '    run: make',
      '  c:',
      '    run: make test',
    ]);

    // 1. Initial build: both `run` methods exist, each under its own class; both MODE assignments exist; `run: make` is one key.
    let full = await expectParity(files);
    const s = shapes(full.entities);
    expect(s).toEqual(expect.arrayContaining([
      'src/shapes.ts method run 3 Alpha',
      'src/shapes.ts method run 7 Beta',
      'Makefile variable MODE 2 -',
      'Makefile variable MODE 4 -',
    ]));
    expect(s.filter((l) => l.startsWith('ci.yml topKey run '))).toHaveLength(2); // `make` once, `make test` once
    const runIds = full.entities.filter((l) => / method run /.test(l)).map((l) => l.split(' ')[0]);
    expect(new Set(runIds).size).toBe(2);

    // 2. Edit one member's body: the other member keeps its id.
    write('src/shapes.ts', [
      'export class Alpha {',
      '  count = 0;',
      '  run(): number { return 10; }',
      '}',
      'export class Beta {',
      '  count = 0;',
      '  run(): number { return 2; }',
      '}',
    ]);
    const betaRunId = (snap) => snap.entities.find((l) => / method run \S+ Beta /.test(l)).split(' ')[0];
    const betaBefore = betaRunId(full);
    full = await expectParity(files);
    expect(betaRunId(full)).toBe(betaBefore);

    // 3. Move: lines above shift every definition down. Ids stay; lines follow.
    write('src/shapes.ts', [
      '// shapes used by use.ts',
      '',
      'export class Beta {',
      '  count = 0;',
      '  run(): number { return 2; }',
      '}',
      'export class Alpha {',
      '  count = 0;',
      '  run(): number { return 10; }',
      '}',
    ]);
    const idsBeforeMove = full.entities.filter((l) => / src\/shapes\.ts method run /.test(l)).map((l) => l.split(' ')[0]).sort();
    full = await expectParity(files);
    expect(shapes(full.entities)).toEqual(expect.arrayContaining([
      'src/shapes.ts method run 5 Beta',
      'src/shapes.ts method run 9 Alpha',
    ]));
    const idsAfterMove = full.entities.filter((l) => / src\/shapes\.ts method run /.test(l)).map((l) => l.split(' ')[0]).sort();
    expect(idsAfterMove).toEqual(idsBeforeMove);

    // 4. Delete one member.
    write('src/shapes.ts', [
      '// shapes used by use.ts',
      '',
      'export class Beta {',
      '  count = 0;',
      '  run(): number { return 2; }',
      '}',
      'export class Alpha {',
      '  count = 0;',
      '}',
    ]);
    full = await expectParity(files);
    expect(shapes(full.entities).filter((l) => / method run /.test(l))).toEqual(['src/shapes.ts method run 5 Beta']);

    // 5. Add a third class with the same member; a third MODE assignment.
    write('src/shapes.ts', [
      '// shapes used by use.ts',
      '',
      'export class Beta {',
      '  count = 0;',
      '  run(): number { return 2; }',
      '}',
      'export class Alpha {',
      '  count = 0;',
      '}',
      'export class Gamma {',
      '  count = 0;',
      '  run(): number { return 3; }',
      '}',
    ]);
    write('Makefile', [
      'ifeq ($(CI),1)',
      'MODE = fast',
      'else',
      'MODE = fast',
      'endif',
      'MODE = fast',
    ]);
    full = await expectParity(files);
    expect(shapes(full.entities).filter((l) => / method run /.test(l)).sort()).toEqual([
      'src/shapes.ts method run 12 Gamma',
      'src/shapes.ts method run 5 Beta',
    ]);
    expect(shapes(full.entities).filter((l) => l.startsWith('Makefile variable MODE'))).toHaveLength(3);
  });

  it('nested classes, overloads, parent rows, owner rename and ordinal shifts stay in parity', async () => {
    const files = ['src/Demo.cs', 'Makefile'];
    const demo = (innerDoc, otherName, withInner = true) => [
      'namespace Demo;',
      '',
      '/// <summary>Outer.</summary>',
      'public class Outer',
      '{',
      innerDoc,
      ...(withInner ? [
        '    public class Inner',
        '    {',
        '        private readonly Builder _builder = new();',
        '        private const string Url = "http://localhost:5000";',
        '        public void Given(int a) => _builder.Set(a);',
        '        public void Given(string s) => _builder.Set(s);',
        '    }',
      ] : []),
      '',
      `    public class ${otherName}`,
      '    {',
      '        private readonly Builder _builder = new();',
      '        public void Given(int a) => _builder.Set(a);',
      '    }',
      '',
      '    public void Run() { new Inner().Given(1); }',
      '}',
    ];
    const ofName = (snap, name) => snap.entities.filter((l) => l.split(' ')[3] === name);
    write('src/Demo.cs', demo('', 'Other'));
    write('Makefile', ['MODE = fast', 'all:', '\techo $(MODE)']);

    // 1. Every member exists once, under its own class, with a live parent row.
    let full = await expectParity(files);
    const builders = ofName(full, '_builder');
    expect(builders).toHaveLength(2);
    expect(builders.map((l) => l.split(' ').slice(5, 7).join(' ')).sort()).toEqual([
      'Inner ^src/Demo.cs#Outer.Inner@7',
      'Other ^src/Demo.cs#Outer.Other@15',
    ]);
    expect(ofName(full, 'Given')).toHaveLength(3); // two Inner overloads + Other's
    expect(ofName(full, 'Url')[0]).toMatch(/ 10-10 Inner /); // a `//` inside a string does not hide the `;`
    expect(full.entities.join('\n')).not.toMatch(/\^dead/);

    // 2. A doc comment on Inner (no line moves): Inner's row is re-written,
    //    so its kept members must point at the new row, as a fresh build does.
    write('src/Demo.cs', demo('    /// <summary>Inner.</summary>', 'Other'));
    const innerMemberIds = (snap) => snap.entities.filter((l) => / Inner \^/.test(l)).map((l) => l.split(' ')[0]).sort();
    const before = innerMemberIds(full);
    full = await expectParity(files);
    expect(innerMemberIds(full)).toEqual(before); // same ids: only the parent row changed
    expect(full.entities.join('\n')).not.toMatch(/\^dead/);

    // 3. Rename the owner class: its members are new definitions (owner in the id).
    write('src/Demo.cs', demo('    /// <summary>Inner.</summary>', 'Second'));
    full = await expectParity(files);
    expect(ofName(full, '_builder').map((l) => l.split(' ')[5]).sort()).toEqual(['Inner', 'Second']);

    // 4. An identical definition inserted ABOVE an existing one renumbers it (#n).
    write('Makefile', ['MODE = fast', 'MODE = fast', 'all:', '\techo $(MODE)']);
    full = await expectParity(files);
    expect(ofName(full, 'MODE')).toHaveLength(2);

    // 5. Delete the nested class with its members.
    write('src/Demo.cs', demo('', 'Second', false));
    full = await expectParity(files);
    expect(ofName(full, '_builder')).toHaveLength(1);
    expect(full.entities.join('\n')).not.toMatch(/\^dead/);
  });
});
