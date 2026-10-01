// An incrementally maintained code graph must resolve call/type edges exactly
// as a fresh full build of the same files does — including edges INTO a file
// whose definitions were edited, added or deleted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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

describe('incremental graph edge resolution matches a full build', () => {
  let projectRoot;
  let stateDir;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-edge-parity-'));
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
    config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
  });

  // Full and incremental builds mint different entity ids; compare entities
  // by what they are (file, type, name, line). File nodes exist only in the
  // incremental graph, so file-level sources compare as 'file'.
  function entityKeys(db) {
    return new Map(db.prepare("SELECT id, file_path, type, name, start_line FROM entities WHERE type != 'file'").all()
      .map((e) => [e.id, `${e.file_path}#${e.type}:${e.name}@${e.start_line}`]));
  }

  /** Live edges of the maintained graph as (source, target) entity tuples. */
  function incrementalEdges() {
    const db = new Database(join(stateDir, 'code-graph.db'), { readonly: true });
    try {
      const key = entityKeys(db);
      return db.prepare("SELECT source_id, target_id, type, target_name FROM relationships WHERE epoch_retired IS NULL AND type IN ('calls','extends','implements','uses','overrides','throws','imports')").all()
        .map((r) => `${r.type} ${key.get(r.source_id) || 'file'} -> ${r.target_id ? key.get(r.target_id) || 'missing' : 'null'} (${r.target_name})`)
        .sort();
    } finally {
      db.close();
    }
  }

  /**
   * Live call-site rows — bare calls (call_sites), every qualified call line
   * and every type-usage line (call_lines) — as (caller, name, line) tuples.
   * Call lines print as `line`, type-usage lines as `line:<rel_type>`.
   */
  function siteRows(db, live) {
    const key = entityKeys(db);
    const where = live ? 'WHERE epoch_retired IS NULL' : '';
    return [
      ...db.prepare(`SELECT source_id, callee_name AS name, context_line FROM call_sites ${where}`).all()
        .map((r) => `bare ${key.get(r.source_id) || 'file'} ${r.name}@${r.context_line}`),
      ...db.prepare(`SELECT source_id, rel_type, target_name AS name, context_line FROM call_lines ${where}`).all()
        .map((r) => `${r.rel_type === 'calls' ? 'line' : `line:${r.rel_type}`} ${key.get(r.source_id) || 'file'} ${r.name}@${r.context_line}`),
    ].sort();
  }

  function incrementalSites() {
    const db = new Database(join(stateDir, 'code-graph.db'), { readonly: true });
    try {
      return siteRows(db, true);
    } finally {
      db.close();
    }
  }

  async function fullBuildSites(files) {
    const db = new Database(':memory:');
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot, files }) });
      const ents = [];
      const rels = [];
      const callSites = [];
      for (const rel of files) {
        const out = await extractor.extractFromFile(rel, readFileSync(join(projectRoot, rel), 'utf-8'));
        ents.push(...out.entities);
        rels.push(...out.relationships);
        callSites.push(...(out.callSites || []));
      }
      insertGraph(db, ents, rels, fts, { syncFts: false, callSites });
      resolveRelationshipTargets(db);
      return siteRows(db, false);
    } finally {
      console.log = log;
      db.close();
    }
  }

  /** The same files built from scratch with the full pass. */
  async function fullBuildEdges(files) {
    const db = new Database(':memory:');
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot, files }) });
      const ents = [];
      const rels = [];
      for (const rel of files) {
        const out = await extractor.extractFromFile(rel, readFileSync(join(projectRoot, rel), 'utf-8'));
        ents.push(...out.entities);
        rels.push(...out.relationships);
      }
      insertGraph(db, ents, rels, fts, { syncFts: false });
      resolveRelationshipTargets(db);
      const key = entityKeys(db);
      return db.prepare("SELECT source_id, target_id, type, target_name FROM relationships WHERE type IN ('calls','extends','implements','uses','overrides','throws','imports')").all()
        .map((r) => `${r.type} ${key.get(r.source_id) || 'file'} -> ${r.target_id ? key.get(r.target_id) || 'missing' : 'null'} (${r.target_name})`)
        .sort();
    } finally {
      console.log = log;
      db.close();
    }
  }

  it('resolves new edges, rebinds edges into edited/added definitions, and unbinds deleted ones', async () => {
    write('src/store.ts', [
      'export class Store {',
      '  load(key: string) {',
      '    return key;',
      '  }',
      '}',
    ]);
    write('src/service.ts', [
      "import { Store } from './store';",
      'export class Service {',
      '  constructor(private store: Store) {}',
      '  run(key: string) {',
      '    return this.store.load(key) + this.store.save(key);',
      '  }',
      '}',
    ]);
    enqueue('src/store.ts', 'src/service.ts');
    await tick();
    const files = ['src/store.ts', 'src/service.ts'];
    let inc = incrementalEdges();
    expect(inc.some((e) => e.includes('(store.load)') && !e.includes('-> null'))).toBe(true);
    expect(inc).toEqual(await fullBuildEdges(files));

    // Edit the callee's file only: `load` changes signature (new physical id)
    // and `save` appears — service.ts's untouched edges must follow.
    write('src/store.ts', [
      'export class Store {',
      '  load(key: string, fallback?: string) {',
      '    return key ?? fallback;',
      '  }',
      '  save(key: string) {',
      '    return key;',
      '  }',
      '}',
    ]);
    enqueue('src/store.ts');
    await tick();
    inc = incrementalEdges();
    expect(inc.some((e) => e.includes('(store.save)') && !e.includes('-> null'))).toBe(true);
    expect(inc).toEqual(await fullBuildEdges(files));

    // Delete the callee's file: edges into it must stop pointing at retired ids.
    unlinkSync(join(projectRoot, 'src/store.ts'));
    enqueue('src/store.ts');
    await tick();
    inc = incrementalEdges();
    expect(inc.filter((e) => e.includes('(store.')).every((e) => e.includes('-> null'))).toBe(true);
    expect(inc).toEqual(await fullBuildEdges(['src/service.ts']));
  });

  it('keeps every call site — bare, qualified and top-level — through add, edit and delete', async () => {
    write('src/util.ts', [
      'export function helper(n: number) {',
      '  return n;',
      '}',
      'export class Store {',
      '  load(key: string) {',
      '    return key;',
      '  }',
      '}',
    ]);
    const app = (body) => write('src/app.ts', [
      "import { helper, Store } from './util';",
      'const store = new Store();',
      'helper(1);',
      'helper(2);',
      ...top,
      'export function run() {',
      ...body,
      '}',
    ]);
    let top = ['store.load("t1");', 'store.load("t2");'];
    // run() calls helper twice and store.load twice; top-level code calls
    // helper twice and store.load twice (source: the file node).
    app(['  helper(3);', '  store.load("a");', '  helper(4);', '  store.load("b");']);
    enqueue('src/util.ts', 'src/app.ts');
    await tick();
    let files = ['src/util.ts', 'src/app.ts'];
    let inc = incrementalSites();
    const runSites = (rows) => rows.filter((r) => r.includes('#function:run@'));
    const topLevel = (rows) => rows.filter((r) => / file /.test(r));
    expect(runSites(inc)).toEqual([
      'bare src/app.ts#function:run@7 helper@10',
      'bare src/app.ts#function:run@7 helper@8',
      'line src/app.ts#function:run@7 store.load@11',
      'line src/app.ts#function:run@7 store.load@9',
    ]);
    expect(topLevel(inc)).toEqual([
      'bare file helper@3',
      'bare file helper@4',
      'line file store.load@5',
      'line file store.load@6',
    ]);
    expect(inc).toEqual(await fullBuildSites(files));
    expect(incrementalEdges()).toEqual(await fullBuildEdges(files));

    // Remove one of two helper calls in run() and one top-level store.load;
    // add a third store.load in run().
    top = ['store.load("t1");'];
    app(['  helper(3);', '  store.load("a");', '  store.load("b");', '  store.load("c");']);
    enqueue('src/app.ts');
    await tick();
    inc = incrementalSites();
    expect(runSites(inc)).toEqual([
      'bare src/app.ts#function:run@6 helper@7',
      'line src/app.ts#function:run@6 store.load@10',
      'line src/app.ts#function:run@6 store.load@8',
      'line src/app.ts#function:run@6 store.load@9',
    ]);
    // One top-level store.load left: a single site needs no call_lines row
    // (its line is the relationship row's).
    expect(topLevel(inc)).toEqual(['bare file helper@3', 'bare file helper@4']);
    expect(inc).toEqual(await fullBuildSites(files));
    expect(incrementalEdges()).toEqual(await fullBuildEdges(files));

    // Delete the caller's file: none of its sites stay live.
    unlinkSync(join(projectRoot, 'src/app.ts'));
    enqueue('src/app.ts');
    await tick();
    files = ['src/util.ts'];
    inc = incrementalSites();
    expect(inc).toEqual([]);
    expect(inc).toEqual(await fullBuildSites(files));
  });

  it('keeps every instantiation line — in a function and at top level — through add, edit, move and delete', async () => {
    write('src/foo.ts', ['export class Foo {}', 'export class Bar {}']);
    const app = (top, body) => write('src/app.ts', [
      "import { Foo, Bar } from './foo';",
      ...top,
      'export function run() {',
      ...body,
      '}',
    ]);
    // run() constructs Foo three times and Bar once; top-level code constructs
    // Foo twice (source: the file node).
    app(['const t1 = new Foo();', 'const t2 = new Foo();'],
      ['  const a = new Foo();', '  const b = new Bar();', '  const c = new Foo();', '  const d = new Foo();']);
    enqueue('src/foo.ts', 'src/app.ts');
    await tick();
    let files = ['src/foo.ts', 'src/app.ts'];
    const typed = (rows) => rows.filter((r) => r.startsWith('line:'));
    let inc = incrementalSites();
    expect(typed(inc)).toEqual([
      'line:instantiates file Foo@2',
      'line:instantiates file Foo@3',
      'line:instantiates src/app.ts#function:run@4 Foo@5',
      'line:instantiates src/app.ts#function:run@4 Foo@7',
      'line:instantiates src/app.ts#function:run@4 Foo@8',
    ]);
    expect(inc).toEqual(await fullBuildSites(files));
    expect(incrementalEdges()).toEqual(await fullBuildEdges(files));

    // Remove one of three Foo lines in run(), move another down, drop one
    // top-level Foo (a single site needs no row), and construct Bar twice.
    app(['const t1 = new Foo();'],
      ['  const b = new Bar();', '  const a = new Foo();', '  const e = new Bar();', '  log();', '  const d = new Foo();']);
    enqueue('src/app.ts');
    await tick();
    inc = incrementalSites();
    expect(typed(inc)).toEqual([
      'line:instantiates src/app.ts#function:run@3 Bar@4',
      'line:instantiates src/app.ts#function:run@3 Bar@6',
      'line:instantiates src/app.ts#function:run@3 Foo@5',
      'line:instantiates src/app.ts#function:run@3 Foo@8',
    ]);
    expect(inc).toEqual(await fullBuildSites(files));
    expect(incrementalEdges()).toEqual(await fullBuildEdges(files));

    // Delete the constructing file: none of its lines stay live.
    unlinkSync(join(projectRoot, 'src/app.ts'));
    enqueue('src/app.ts');
    await tick();
    files = ['src/foo.ts'];
    inc = incrementalSites();
    expect(inc).toEqual([]);
    expect(inc).toEqual(await fullBuildSites(files));
  });

  it('resolves Go package-qualified calls like a full build through add, edit and delete', async () => {
    // `x.Parse` binds the package's top-level function, not the method
    // WorkerOptions.Parse; `glog.Errorf` (third party) binds nothing, not the
    // in-repo method ToGlog.Errorf.
    writeFileSync(join(projectRoot, 'go.mod'), 'module example.com/app\n\ngo 1.22\n');
    mkdirSync(join(projectRoot, 'x'), { recursive: true });
    mkdirSync(join(projectRoot, 'worker'), { recursive: true });
    write('x/keys.go', ['package x', '', 'func Parse(key []byte) int {', '\treturn len(key)', '}']);
    write('x/config.go', ['package x', '', 'type WorkerOptions struct{}', '', 'func (w *WorkerOptions) Parse(conf string) {', '}', '', 'type ToGlog struct{}', '', 'func (rl *ToGlog) Errorf(format string) {', '}']);
    const draft = (extra) => write('worker/draft.go', [
      'package worker',
      '',
      'import (',
      '\t"github.com/golang/glog"',
      '',
      '\t"example.com/app/x"',
      ')',
      '',
      'func detect(key []byte) int {',
      '\tglog.Errorf("k")',
      ...extra,
      '\treturn x.Parse(key)',
      '}',
    ]);
    draft([]);
    enqueue('x/keys.go', 'x/config.go', 'worker/draft.go');
    await tick();
    let files = ['x/keys.go', 'x/config.go', 'worker/draft.go'];
    let inc = incrementalEdges();
    const goCalls = (edges) => edges.filter((e) => e.startsWith('calls worker/draft.go'));
    expect(goCalls(inc)).toEqual([
      'calls worker/draft.go#function:detect@9 -> null (glog.Errorf)',
      'calls worker/draft.go#function:detect@9 -> x/keys.go#function:Parse@3 (x.Parse)',
    ]);
    expect(inc).toEqual(await fullBuildEdges(files));

    // A new package function, called from an edited caller.
    write('x/keys.go', ['package x', '', 'func Parse(key []byte) int {', '\treturn len(key)', '}', '', 'func Encode() string {', '\treturn ""', '}']);
    draft(['\tx.Encode()']);
    enqueue('x/keys.go', 'worker/draft.go');
    await tick();
    inc = incrementalEdges();
    expect(goCalls(inc)).toContain('calls worker/draft.go#function:detect@9 -> x/keys.go#function:Encode@7 (x.Encode)');
    expect(inc).toEqual(await fullBuildEdges(files));

    // The package function goes away: the method of the same name never takes over.
    unlinkSync(join(projectRoot, 'x/keys.go'));
    enqueue('x/keys.go');
    await tick();
    files = ['x/config.go', 'worker/draft.go'];
    inc = incrementalEdges();
    expect(goCalls(inc)).toEqual([
      'calls worker/draft.go#function:detect@9 -> null (glog.Errorf)',
      'calls worker/draft.go#function:detect@9 -> null (x.Encode)',
      'calls worker/draft.go#function:detect@9 -> null (x.Parse)',
    ]);
    expect(inc).toEqual(await fullBuildEdges(files));
  });

  it('keeps override edges current through add, edit, rename and delete', async () => {
    const overrides = (edges) => edges.filter((e) => e.startsWith('overrides '));
    const base = (method) => [
      'export class Animal {',
      `  ${method}(): string {`,
      "    return '';",
      '  }',
      '}',
    ];
    const dog = [
      "import { Animal } from './animal';",
      'export class Dog extends Animal {',
      '  sound(): string {',
      "    return 'woof';",
      '  }',
      '}',
    ];

    // Add: Dog.sound overrides Animal.sound.
    write('src/animal.ts', base('sound'));
    write('src/dog.ts', dog);
    enqueue('src/animal.ts', 'src/dog.ts');
    await tick();
    let files = ['src/animal.ts', 'src/dog.ts'];
    let inc = incrementalEdges();
    expect(overrides(inc).some((e) => e.includes('Dog') || e.includes('src/dog.ts#'))).toBe(true);
    expect(inc).toEqual(await fullBuildEdges(files));

    // Edit only the base: the overridden method is renamed — the edge vanishes.
    write('src/animal.ts', base('noise'));
    enqueue('src/animal.ts');
    await tick();
    inc = incrementalEdges();
    expect(overrides(inc)).toEqual([]);
    expect(inc).toEqual(await fullBuildEdges(files));

    // Edit it back: the edge returns although dog.ts was not touched.
    write('src/animal.ts', base('sound'));
    enqueue('src/animal.ts');
    await tick();
    inc = incrementalEdges();
    expect(overrides(inc).length).toBe(1);
    expect(inc).toEqual(await fullBuildEdges(files));

    // Rename the subclass file (delete + add under a new path).
    unlinkSync(join(projectRoot, 'src/dog.ts'));
    write('src/pet.ts', dog);
    enqueue('src/dog.ts', 'src/pet.ts');
    await tick();
    files = ['src/animal.ts', 'src/pet.ts'];
    inc = incrementalEdges();
    expect(overrides(inc).length).toBe(1);
    expect(overrides(inc)[0]).toContain('src/pet.ts#');
    expect(inc).toEqual(await fullBuildEdges(files));

    // Delete the base: no override edge may point at a retired definition.
    unlinkSync(join(projectRoot, 'src/animal.ts'));
    enqueue('src/animal.ts');
    await tick();
    inc = incrementalEdges();
    expect(overrides(inc)).toEqual([]);
    expect(inc).toEqual(await fullBuildEdges(['src/pet.ts']));
  });
});
