/**
 * ss-trace shows every line of a trace-only type usage, as it does for calls
 * (`call@440,476`): a method that constructs `new Foo()` on three lines is one
 * caller `(instantiates)@4,5,6`, not `(instantiates)@4`.
 *
 * `relationships` keeps one row per (source, type, target) — unchanged. The
 * site lines live in the trace-only call_lines table with `rel_type`, so an
 * instantiation line never mixes with a call line of the same name.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, ensureCallSitesSchema, insertCallSites, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { StructuralContextBuilder, formatStructuralContext } from '../../core/graph/structural-context.js';
import { formatTraceCompact } from '../../core/search/agent-output-fixes.js';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function buildGraph(files, { schema = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ss-trace-type-sites-'));
  roots.push(root);
  const extractor = new GraphExtractor({ projectRoot: root });
  const entities = [];
  const relationships = [];
  const callSites = [];
  for (const [rel, lines] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, lines.join('\n'));
    const out = await extractor.extractFromFile(rel, lines.join('\n'));
    entities.push(...out.entities);
    relationships.push(...out.relationships);
    callSites.push(...(out.callSites || []));
  }
  const dbPath = join(root, 'code-graph.db');
  const db = new Database(dbPath);
  const log = console.log;
  console.log = () => {};
  try {
    const fts = createGraphSchema(db);
    if (schema === 'no-call-lines') db.exec('DROP TABLE call_lines');
    if (schema === 'untyped-call-lines') {
      // A graph written before call_lines had `rel_type`.
      db.exec('DROP TABLE call_lines');
      db.exec('CREATE TABLE call_lines (source_id TEXT NOT NULL, target_name TEXT NOT NULL, context_line INTEGER, epoch_written INTEGER NOT NULL DEFAULT 0, epoch_retired INTEGER)');
    }
    insertGraph(db, entities, relationships, fts, { syncFts: true });
    if (schema === null) db.transaction(() => insertCallSites(db, callSites))();
    else if (schema === 'untyped-call-lines') insertCallSites(db, callSites);
    resolveRelationshipTargets(db);
  } finally {
    console.log = log;
  }
  db.close();
  return { root, dbPath };
}

function trace({ root, dbPath }, symbol, options = {}) {
  const builder = new StructuralContextBuilder({ projectRoot: root, graphDbPath: dbPath });
  try {
    return builder.build(symbol, options);
  } finally {
    builder.close();
  }
}

function instantiators(result) {
  return result.sections.callers.items
    .filter((x) => x.relationship === 'instantiates')
    .map((x) => [x.name, x.contextLines]);
}

// One type `Foo` constructed on several lines of one function, per language.
const LANGUAGES = [
  ['Java', { 'src/Foo.java': ['package app;', 'public class Foo {', '  public Foo() {}', '}'],
    'src/A.java': ['package app;', 'public class A {', '  void run() {', '    Foo a = new Foo();', '    Foo b = new Foo();', '    Foo c = new Foo();', '  }', '}'] },
  'src/Foo.java', 'run', [4, 5, 6]],
  ['Kotlin', { 'src/Foo.kt': ['package app', '', 'class Foo'],
    'src/A.kt': ['package app', '', 'fun run() {', '  val a = Foo()', '  val b = Foo()', '}'] },
  'src/Foo.kt', 'run', [4, 5]],
  ['TypeScript', { 'src/foo.ts': ['export class Foo {}'],
    'src/a.ts': ["import { Foo } from './foo';", 'export function run() {', '  const a = new Foo();', '  const b = new Foo();', '  return new Foo();', '}'] },
  'src/foo.ts', 'run', [3, 4, 5]],
  ['Swift', { 'Sources/Foo.swift': ['class Foo {}'],
    'Sources/A.swift': ['func run() {', '  let a = Foo()', '  let b = Foo()', '}'] },
  'Sources/Foo.swift', 'run', [2, 3]],
  ['C#', { 'src/Foo.cs': ['namespace App {', '  public class Foo {}', '}'],
    'src/A.cs': ['namespace App {', '  public class A {', '    void Run() {', '      var a = new Foo();', '      var b = new Foo();', '    }', '  }', '}'] },
  'src/Foo.cs', 'Run', [4, 5]],
  ['Python', { 'app/foo.py': ['class Foo:', '    pass'],
    'app/a.py': ['from app.foo import Foo', '', 'def run():', '    a = Foo()', '    b = Foo()'] },
  'app/foo.py', 'run', [4, 5]],
  ['Rust', { 'src/foo.rs': ['pub struct Foo {}', 'impl Foo {', '    pub fn new() -> Foo { Foo {} }', '}'],
    'src/a.rs': ['use crate::foo::Foo;', 'fn run() {', '    let a = Foo::new();', '    let b = Foo::new();', '}'] },
  'src/foo.rs', 'run', [3, 4]],
  ['Go', { 'app/foo.go': ['package app', '', 'type Foo struct{}'],
    'app/a.go': ['package app', '', 'func run() {', '\ta := Foo{}', '\tb := &Foo{}', '\t_, _ = a, b', '}'] },
  'app/foo.go', 'run', [4, 5]],
];

describe('ss-trace lists every line of an instantiation', () => {
  it.each(LANGUAGES)('%s: one instantiates row per pair, every line in call_lines and in the trace', async (_lang, files, fooFile, caller, lines) => {
    const graph = await buildGraph(files);
    const db = new Database(graph.dbPath, { readonly: true });
    const rel = db.prepare("SELECT context_line FROM relationships WHERE type = 'instantiates' AND target_name = 'Foo'").all();
    const stored = db.prepare("SELECT context_line FROM call_lines WHERE rel_type = 'instantiates' AND target_name = 'Foo' ORDER BY 1").all();
    db.close();
    // Ranking-visible shape unchanged: one row per pair, the first site's line.
    expect(rel.map((r) => r.context_line)).toEqual([lines[0]]);
    expect(stored.map((r) => r.context_line)).toEqual(lines);

    const result = trace(graph, 'Foo', { filePath: fooFile, mode: 'callers' });
    expect(instantiators(result)).toEqual([[caller, lines]]);
    const at = `(instantiates)@${lines.join(',')}`;
    expect(formatStructuralContext(result)).toContain(at);
    expect(formatTraceCompact(result, { mode: 'callers' })).toContain(at);
  });

  it('header counts every site; fan-in counts the constructing function once', async () => {
    const [, files, fooFile] = LANGUAGES[0];
    const result = trace(await buildGraph(files), 'Foo', { filePath: fooFile, mode: 'callers' });
    expect(result.sections.callers.total).toBe(3);
    expect(result.sections.callers.distinct).toBe(1);
    expect(result.target.fanIn).toBe(1);
    // Instantiation rows are not calls: the heading says "sites" (both formats).
    expect(result.sections.callers.siteNoun).toBe('sites');
    expect(formatTraceCompact(result, { mode: 'callers' })).toContain('## callers (3 sites, 1 distinct caller)\nrun [method] src/A.java:3 (instantiates)@4,5,6');
    expect(formatStructuralContext(result)).toContain('## callers (3 sites, 1 distinct caller)');
    expect(formatTraceCompact(result, { mode: 'callers' })).not.toContain('call sites');
  });

  it('siteNoun says "call sites" only when every counted row is a call', async () => {
    const { siteNoun } = await import('../../core/graph/structural-context.js');
    expect(siteNoun([{ relationship: 'calls' }, { relationship: 'calls' }])).toBe('call sites');
    expect(siteNoun([{ relationship: 'calls' }, { relationship: 'handoff' }, {}])).toBe('call sites');
    expect(siteNoun([{ relationship: 'calls' }, { relationship: 'instantiates' }])).toBe('sites');
    expect(siteNoun([{ relationship: 'extends' }])).toBe('sites');
    expect(siteNoun([])).toBe('call sites');
  });

  it('a single instantiation needs no call_lines row: its line comes from relationships', async () => {
    const graph = await buildGraph({
      'src/foo.ts': ['export class Foo {}'],
      'src/a.ts': ["import { Foo } from './foo';", 'export function run() {', '  return new Foo();', '}'],
    });
    const db = new Database(graph.dbPath, { readonly: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM call_lines').get().n).toBe(0);
    db.close();
    expect(instantiators(trace(graph, 'Foo', { filePath: 'src/foo.ts', mode: 'callers' }))).toEqual([['run', [3]]]);
  });

  it('typeRef keeps one line per definition (signature types are read on the definition line)', async () => {
    const graph = await buildGraph({
      'src/foo.ts': ['export class Foo {}'],
      'src/a.ts': ["import { Foo } from './foo';", 'export function run(', '  a: Foo,', '  b: Foo,', '): Foo {', '  return a;', '}'],
    });
    const db = new Database(graph.dbPath, { readonly: true });
    const rel = db.prepare("SELECT context_line FROM relationships WHERE type = 'typeRef' AND target_name = 'Foo'").all();
    const stored = db.prepare("SELECT COUNT(*) AS n FROM call_lines WHERE rel_type = 'typeRef'").get().n;
    db.close();
    // Parameters on later lines join the definition's signature, so the
    // pair has one line by nature: no site rows, nothing to merge.
    expect(rel.map((r) => r.context_line)).toEqual([2]);
    expect(stored).toBe(0);
  });
});

describe('ss-trace lists a type\'s signature users (typeRef) by default', () => {
  const rows = (result, rel) => result.sections.callers.items.filter((x) => x.relationship === rel).map((x) => x.name);

  it('a type used only in signatures has callers (before: an empty section)', async () => {
    const graph = await buildGraph({
      'src/foo.ts': ['export class Foo {}'],
      'src/a.ts': ["import { Foo } from './foo';", 'export function take(a: Foo): void {', '  return;', '}', 'export function give(): Foo {', '  return null;', '}'],
    });
    const result = trace(graph, 'Foo', { filePath: 'src/foo.ts', mode: 'callers' });
    expect(rows(result, 'typeRef').sort()).toEqual(['give', 'take']);
    expect(result.sections.callers.siteNoun).toBe('sites');
    expect(formatTraceCompact(result, { mode: 'callers' })).toMatch(/take \[function\] src\/a\.ts:2 \(typeRef\)@2/);
  });

  it('a function listed by a stronger relationship is not repeated as a typeRef row', async () => {
    const graph = await buildGraph({
      'src/foo.ts': ['export class Foo {}'],
      'src/a.ts': ["import { Foo } from './foo';", 'export function make(seed: Foo): Foo {', '  return new Foo();', '}'],
    });
    const result = trace(graph, 'Foo', { filePath: 'src/foo.ts', mode: 'callers' });
    expect(rows(result, 'instantiates')).toEqual(['make']);
    expect(rows(result, 'typeRef')).toEqual([]);
  });

  it('a popular type: typeRef rows are capped and rank after constructors', async () => {
    const users = Array.from({ length: 60 }, (_, i) => `export function use${i}(a: Foo): void {}`);
    const graph = await buildGraph({
      'src/foo.ts': ['export class Foo {}'],
      'src/users.ts': ["import { Foo } from './foo';", ...users],
      'src/make.ts': ["import { Foo } from './foo';", 'export function build() {', '  return new Foo();', '}'],
    });
    const result = trace(graph, 'Foo', { filePath: 'src/foo.ts', mode: 'callers', tokenBudget: 12000 });
    const items = result.sections.callers.items;
    expect(rows(result, 'typeRef').length).toBeLessThanOrEqual(40);
    const firstTypeRef = items.findIndex((x) => x.relationship === 'typeRef');
    const ctor = items.findIndex((x) => x.relationship === 'instantiates');
    expect(ctor).toBeGreaterThanOrEqual(0);
    expect(ctor).toBeLessThan(firstTypeRef);
  });

  it('a function target never gets typeRef rows', async () => {
    const graph = await buildGraph({
      'src/a.ts': ['export function helper(): void {}', 'export function run(): void {', '  helper();', '}'],
    });
    const result = trace(graph, 'helper', { filePath: 'src/a.ts', mode: 'callers' });
    expect(rows(result, 'typeRef')).toEqual([]);
  });
});

describe('call_lines rel_type keeps type-usage lines apart from call lines', () => {
  function memDb() {
    const db = new Database(':memory:');
    ensureCallSitesSchema(db);
    return db;
  }

  it('pairs are counted per (source, rel_type, target): a call and a construction of one name never pool', () => {
    const db = memDb();
    insertCallSites(db, [
      { source_id: 's', target_name: 'Foo', context_line: 10 },
      { source_id: 's', target_name: 'Foo', context_line: 3, rel_type: 'instantiates' },
    ]);
    // One site each: both lines live on their relationship rows.
    expect(db.prepare('SELECT COUNT(*) AS n FROM call_lines').get().n).toBe(0);

    insertCallSites(db, [
      { source_id: 't', target_name: 'Foo', context_line: 10 },
      { source_id: 't', target_name: 'Foo', context_line: 11 },
      { source_id: 't', target_name: 'Foo', context_line: 3, rel_type: 'instantiates' },
      { source_id: 't', target_name: 'Foo', context_line: 4, rel_type: 'instantiates' },
    ]);
    const rows = db.prepare("SELECT rel_type, context_line FROM call_lines WHERE source_id = 't' ORDER BY rel_type, context_line").all();
    expect(rows).toEqual([
      { rel_type: 'calls', context_line: 10 },
      { rel_type: 'calls', context_line: 11 },
      { rel_type: 'instantiates', context_line: 3 },
      { rel_type: 'instantiates', context_line: 4 },
    ]);
    db.close();
  });

  it('ensureCallSitesSchema adds rel_type to an older call_lines table; old rows become call lines', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE call_lines (source_id TEXT NOT NULL, target_name TEXT NOT NULL, context_line INTEGER, epoch_written INTEGER NOT NULL DEFAULT 0, epoch_retired INTEGER)');
    db.prepare('INSERT INTO call_lines (source_id, target_name, context_line) VALUES (?, ?, ?)').run('s', 'x.y', 7);
    ensureCallSitesSchema(db);
    ensureCallSitesSchema(db); // idempotent
    expect(db.prepare('SELECT rel_type FROM call_lines').all()).toEqual([{ rel_type: 'calls' }]);
    db.close();
  });

  it('a writer on an untyped table stores call lines only and does not fail', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE call_sites (source_id TEXT NOT NULL, callee_name TEXT NOT NULL, context_line INTEGER, epoch_written INTEGER NOT NULL DEFAULT 0, epoch_retired INTEGER)');
    db.exec('CREATE TABLE call_lines (source_id TEXT NOT NULL, target_name TEXT NOT NULL, context_line INTEGER, epoch_written INTEGER NOT NULL DEFAULT 0, epoch_retired INTEGER)');
    insertCallSites(db, [
      { source_id: 's', target_name: 'x.y', context_line: 1 },
      { source_id: 's', target_name: 'x.y', context_line: 2 },
      { source_id: 's', target_name: 'Foo', context_line: 3, rel_type: 'instantiates' },
      { source_id: 's', target_name: 'Foo', context_line: 4, rel_type: 'instantiates' },
    ]);
    expect(db.prepare('SELECT target_name, context_line FROM call_lines ORDER BY 2').all()).toEqual([
      { target_name: 'x.y', context_line: 1 },
      { target_name: 'x.y', context_line: 2 },
    ]);
    db.close();
  });
});

describe('older graphs still trace type usages (first line only)', () => {
  const [, JAVA, FOO] = LANGUAGES[0];

  it('a graph without call_lines', async () => {
    const graph = await buildGraph(JAVA, { schema: 'no-call-lines' });
    const result = trace(graph, 'Foo', { filePath: FOO, mode: 'callers' });
    expect(instantiators(result)).toEqual([['run', [4]]]);
    expect(formatTraceCompact(result, { mode: 'callers' })).toContain('(instantiates)@4');
  });

  it('a graph whose call_lines has no rel_type: call lines still list, instantiations show their first line', async () => {
    const graph = await buildGraph({
      ...JAVA,
      'src/B.java': ['package app;', 'public class B {', '  void go(A s) {', '    s.run();', '    s.run();', '  }', '}'],
    }, { schema: 'untyped-call-lines' });
    const db = new Database(graph.dbPath, { readonly: true });
    expect(db.prepare('PRAGMA table_info(call_lines)').all().some((c) => c.name === 'rel_type')).toBe(false);
    db.close();
    expect(instantiators(trace(graph, 'Foo', { filePath: FOO, mode: 'callers' }))).toEqual([['run', [4]]]);
    const callers = trace(graph, 'run', { filePath: 'src/A.java', mode: 'callers' });
    expect(callers.sections.callers.items.find((x) => x.name === 'go')?.contextLines).toEqual([4, 5]);
  });

  it('a connected reader sees rel_type once a maintainer adds it to an older graph', async () => {
    const graph = await buildGraph(JAVA, { schema: 'untyped-call-lines' });
    const builder = new StructuralContextBuilder({ projectRoot: graph.root, graphDbPath: graph.dbPath });
    try {
      expect(instantiators(builder.build('Foo', { filePath: FOO, mode: 'callers' }))).toEqual([['run', [4]]]);
      // An upgraded maintainer migrates the table and writes typed lines.
      const writer = new Database(graph.dbPath);
      ensureCallSitesSchema(writer);
      const runId = writer.prepare("SELECT id FROM entities WHERE name = 'run'").get().id;
      const add = writer.prepare("INSERT INTO call_lines (source_id, target_name, context_line, rel_type) VALUES (?, 'Foo', ?, 'instantiates')");
      for (const line of [4, 5, 6]) add.run(runId, line);
      writer.close();
      expect(instantiators(builder.build('Foo', { filePath: FOO, mode: 'callers' }))).toEqual([['run', [4, 5, 6]]]);
    } finally {
      builder.close();
    }
  });
});
