/**
 * Calls through a receiver of declared type (receiver-types.js).
 *
 * - dgraph posting/index.go: `l.findPosting(…)` where `l *List` is a parameter
 *   of the caller; MutableLayer also defines findPosting. ss-trace hid the
 *   stored edge (the one-letter qualifier `l` names no owner or file).
 * - zipkin V2SpanWriter.writeAnnotation(…,\n WriteBuffer b): `b.write(endpoint)`
 *   was stored as a call of V2SpanWriter.write — the parameter sits on the
 *   signature's second line, so the type was unknown, the receiver `b` named
 *   no owner, and the same-file `write` won by name.
 * The extractor now reads the whole parameter list and the local declarations
 * before the call; resolution binds a typed receiver only to a method of that
 * type (or the nearest supertype that defines it), else leaves it unresolved.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets, resolveRowsScoped } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';
import { declaredTypeIn, parseReceiverType } from '../../core/graph/receiver-types.js';
import { StructuralContextRepository } from '../../core/infrastructure/structural-context-repository.js';
import { BareCallResolver } from '../../core/graph/bare-call-resolution.js';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function buildGraph(files) {
  const root = mkdtempSync(join(tmpdir(), 'ss-recv-type-'));
  roots.push(root);
  for (const [rel, lines] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, lines.join('\n'));
  }
  const sources = Object.keys(files).filter((f) => f !== 'go.mod');
  const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot: root, files: sources }) });
  const entities = [];
  const relationships = [];
  const callSites = [];
  const fileNodes = [];
  for (const rel of sources) {
    const out = await extractor.extractFromFile(rel, files[rel].join('\n'));
    entities.push(...out.entities);
    relationships.push(...out.relationships);
    callSites.push(...(out.callSites || []));
    if (out.file) fileNodes.push(out.file);
  }
  const dbPath = join(root, 'code-graph.db');
  const db = new Database(dbPath);
  const fts = createGraphSchema(db);
  const log = console.log;
  console.log = () => {};
  try {
    insertGraph(db, entities, relationships, fts, { syncFts: true, callSites, files: fileNodes });
    resolveRelationshipTargets(db);
  } finally {
    console.log = log;
  }
  db.close();
  return { root, dbPath };
}

/** target_name → `file#Owner.name` (or null) for one caller's `calls` rows. */
function callTargets(dbPath, caller) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT r.target_name, t.file_path, t.name, t.parent_class FROM relationships r
      JOIN entities s ON s.id = r.source_id
      LEFT JOIN entities t ON t.id = r.target_id
      WHERE s.name = ? AND r.type = 'calls'
    `).all(caller);
    return Object.fromEntries(rows.map((r) => [r.target_name, r.file_path ? `${r.file_path}#${r.parent_class ? `${r.parent_class}.` : ''}${r.name}` : null]));
  } finally {
    db.close();
  }
}

describe('declaredTypeIn', () => {
  const cases = [
    // Go: parameters over several lines, grouped names, locals.
    ['a.go', 'func (txn *Txn) addMutationHelper(ctx context.Context, l *List, doUpdateIndex bool,\n\tt *pb.DirectedEdge) error {\n\tl.findPosting(1)', 'l', 'List'],
    ['a.go', 'func f(ctx context.Context) {\n\tctx.Value(1)', 'ctx', 'context.Context'],
    ['a.go', 'func f(a, l *List) {\n\tl.x()', 'l', 'List'],
    ['a.go', 'func f() {\n\tl := &List{}\n\tl.x()', 'l', 'List'],
    ['a.go', 'func f() {\n\tvar l List\n\tl.x()', 'l', 'List'],
    // An untyped rebinding hides the parameter's type.
    ['a.go', 'func f(l *List) {\n\tl, err := get()\n\tl.x()', 'l', null],
    // `n * Scale` is a product, not a declaration.
    ['a.go', 'func f() {\n\tx := n * Scale\n\tn.x()', 'n', null],
    // Java / C#: type-first, including a parameter on the signature's second line.
    ['A.java', 'static void writeAnnotation(long timestamp, @Nullable byte[] endpoint,\n    WriteBuffer b) {\n  b.write(endpoint);', 'b', 'WriteBuffer'],
    ['A.java', 'void f() {\n  Span.Builder builder = Span.newBuilder();\n  builder.id(1);', 'builder', 'Span.Builder'],
    ['A.java', 'void f() {\n  var b = new Foo();\n  b.x();', 'b', 'Foo'],
    ['A.java', 'void f() {\n  var b = get();\n  b.x();', 'b', null],
    ['A.java', 'void f() {\n  for (Span s : spans) s.x();', 's', 'Span'],
    ['A.cs', 'void F(Foo b) {\n  if (x is Bar b) b.X();', 'b', null],
    // Kotlin / TS / Rust / Swift / Python: `name: Type`.
    ['A.kt', 'fun f(\n  client: OkHttpClient,\n) {\n  client.x()', 'client', 'OkHttpClient'],
    ['A.kt', 'fun f() {\n  val b = Foo(1)\n  b.x()', 'b', 'Foo'],
    ['A.kt', 'fun f() {\n  val b = foo()\n  b.x()', 'b', null],
    ['A.kt', 'fun f(b: Foo) {\n  xs.forEach { b -> b.x() }', 'b', null],
    ['a.ts', 'function f(b: Foo | null) {\n  b.x()', 'b', 'Foo'],
    ['a.ts', 'function f(b: Foo[]) {\n  b.x()', 'b', null],
    ['a.ts', 'function f() {\n  const b = new Foo()\n  b.x()', 'b', 'Foo'],
    ['a.ts', 'function f() {\n  const x = c ? b : Foo\n  b.x()', 'b', null],
    ['a.rs', 'fn f(b: &mut Foo) {\n    b.x()', 'b', 'Foo'],
    // `Box<Foo>` derefs to Foo's methods: the outer name says nothing.
    ['a.rs', 'fn f(b: Box<Foo>) {\n    b.x()', 'b', null],
    ['a.swift', 'func f(_ db: Database) {\n  db.x()', 'db', 'Database'],
    ['a.py', 'def f(self, b: Foo):\n    b.x()', 'b', 'Foo'],
    ['a.py', 'def f(self, b: Foo):\n    b = g()\n    b.x()', 'b', null],
    ['a.py', 'def f(self, b):\n    b.x()', 'b', null],
    // No written types: JS, Ruby.
    ['a.js', 'function f(b) {\n  b.x()', 'b', null],
    ['a.rb', 'def f(b)\n  b.x', 'b', null],
  ];
  it.each(cases)('%s %j: %s → %s', (file, text, name, want) => {
    const r = declaredTypeIn(text, name, file);
    expect(r ? `${r.qualifier ? `${r.qualifier}.` : ''}${r.type}` : null).toBe(want);
  });

  it('parses annotations', () => {
    expect(parseReceiverType('recvtype:Span.Builder')).toEqual({ type: 'Builder', outer: 'Span', dir: null, external: false });
    expect(parseReceiverType('recvtype:List@posting/')).toEqual({ type: 'List', outer: null, dir: 'posting/', external: false });
    expect(parseReceiverType('recvtype:!sync.WaitGroup')).toEqual({ type: 'sync.WaitGroup', outer: null, dir: null, external: true });
    expect(parseReceiverType('gopkg:x/')).toBeNull();
  });
});

describe('Java: a typed receiver binds to its type only (zipkin V2SpanWriter)', () => {
  const REPO = {
    'zipkin/internal/WriteBuffer.java': [
      'package zipkin2.internal;',
      '',
      'public final class WriteBuffer {',
      '  public interface Writer<T> {',
      '    void write(T value, WriteBuffer buffer);',
      '  }',
      '',
      '  public void write(byte[] v) {',
      '  }',
      '',
      '  public void writeAscii(String v) {',
      '  }',
      '}',
    ],
    'zipkin/internal/V2SpanWriter.java': [
      'package zipkin2.internal;',
      '',
      'public final class V2SpanWriter implements WriteBuffer.Writer<Span> {',
      '  @Override public void write(Span value, WriteBuffer b) {',
      '    b.writeAscii("{");',
      '  }',
      '',
      '  static void writeAnnotation(long timestamp, String value, @Nullable byte[] endpoint,',
      '    WriteBuffer b) {',
      '    b.writeAscii("{");',
      '    if (endpoint != null) {',
      '      b.write(endpoint);',
      '    }',
      '    String key = value;',
      '    key.equals("x");',
      '  }',
      '}',
    ],
    'zipkin/internal/SharedKey.java': [
      'package zipkin2.internal;',
      '',
      'final class SharedKey {',
      '  @Override public boolean equals(Object o) {',
      '    return false;',
      '  }',
      '}',
    ],
  };

  it('`b.write(endpoint)` → WriteBuffer.write, never the same-file V2SpanWriter.write', async () => {
    const g = await buildGraph(REPO);
    const t = callTargets(g.dbPath, 'writeAnnotation');
    expect(t['b.write']).toBe('zipkin/internal/WriteBuffer.java#WriteBuffer.write');
    expect(t['b.writeAscii']).toBe('zipkin/internal/WriteBuffer.java#WriteBuffer.writeAscii');
    // A type outside the repo (String) has no method here: no edge to SharedKey.equals.
    expect(t['key.equals']).toBeNull();
  });

  it('the incremental resolver (resolveRowsScoped) agrees with the full build', async () => {
    const g = await buildGraph(REPO);
    const db = new Database(g.dbPath);
    try {
      const rows = db.prepare(`
        SELECT r.source_id, r.target_name, r.type, r.context_line, r.full_import_path, r.target_id
        FROM relationships r JOIN entities s ON s.id = r.source_id
        WHERE s.name = 'writeAnnotation' AND r.type = 'calls' ORDER BY r.target_name
      `).all();
      expect(resolveRowsScoped(db, rows, { liveOnly: false })).toEqual(rows.map((r) => r.target_id));
    } finally {
      db.close();
    }
  });

  it('ss-trace callers of V2SpanWriter.write no longer list writeAnnotation', async () => {
    const g = await buildGraph(REPO);
    const repo = new StructuralContextRepository(g.dbPath, { BareCallResolver, projectRoot: g.root });
    try {
      const target = repo.findEntityCandidates('write', { filePath: 'zipkin/internal/V2SpanWriter.java', limit: 4 })[0];
      expect(target.parentClass).toBe('V2SpanWriter');
      expect(repo.getCallers(target, { limit: 20 }).map((c) => c.name)).not.toContain('writeAnnotation');
    } finally {
      repo.close();
    }
  });
});

describe('Java: nested types and inherited methods', () => {
  const REPO = {
    'src/Span.java': [
      'public final class Span {',
      '  public static final class Builder {',
      '    public Builder id(String v) { return this; }',
      '  }',
      '}',
    ],
    'src/V1Span.java': [
      'public final class V1Span {',
      '  public static final class Builder {',
      '    public Builder id(String v) { return this; }',
      '  }',
      '}',
    ],
    'src/Call.java': [
      'public abstract class Call<V> {',
      '  public abstract V execute();',
      '  public static abstract class Base<V> extends Call<V> {',
      '    @Override public final V execute() { return null; }',
      '  }',
      '}',
    ],
    'src/ThrottledCall.java': [
      'final class ThrottledCall extends Call.Base<Void> {',
      '}',
    ],
    'src/Decoder.java': [
      'class Decoder {',
      '  void decode() {',
      '    Span.Builder span = new Span.Builder();',
      '    span.id("a");',
      '    V1Span.Builder old = new V1Span.Builder();',
      '    old.id("b");',
      '  }',
      '  void run(ThrottledCall overCapacity) {',
      '    overCapacity.execute();',
      '  }',
      '}',
    ],
  };

  it('`Span.Builder span` → the Builder nested in Span', async () => {
    const g = await buildGraph(REPO);
    const t = callTargets(g.dbPath, 'decode');
    expect(t['span.id']).toBe('src/Span.java#Builder.id');
    expect(t['old.id']).toBe('src/V1Span.java#Builder.id');
  });

  it('an inherited method binds to the nearest supertype that defines it', async () => {
    const g = await buildGraph(REPO);
    expect(callTargets(g.dbPath, 'run')['overCapacity.execute']).toBe('src/Call.java#Base.execute');
  });
});

describe('Kotlin / TypeScript locals', () => {
  it('Kotlin `val b = Foo()` and a multi-line parameter list', async () => {
    const g = await buildGraph({
      'a/Foo.kt': ['class Foo {', '  fun send() {}', '}'],
      'a/Bar.kt': ['class Bar {', '  fun send() {}', '}'],
      'a/Use.kt': [
        'class Use {',
        '  fun go(',
        '    x: Int,',
        '    bar: Bar,',
        '  ) {',
        '    val b = Foo()',
        '    b.send()',
        '    bar.send()',
        '  }',
        '}',
      ],
    });
    const t = callTargets(g.dbPath, 'go');
    expect(t['b.send']).toBe('a/Foo.kt#Foo.send');
    expect(t['bar.send']).toBe('a/Bar.kt#Bar.send');
  });

  it('TypeScript `const q: Queue` binds to Queue, an untyped local keeps the name rules', async () => {
    const g = await buildGraph({
      'src/queue.ts': ['export class Queue {', '  push(x: number) {}', '}'],
      'src/stack.ts': ['export class Stack {', '  push(x: number) {}', '}'],
      'src/main.ts': [
        "import { Queue } from './queue';",
        "import { Stack } from './stack';",
        'export function main(make: () => Stack) {',
        '  const q: Queue = new Queue();',
        '  q.push(1);',
        '}',
      ],
    });
    expect(callTargets(g.dbPath, 'main')['q.push']).toBe('src/queue.ts#Queue.push');
  });
});

describe('Go: typed parameters and locals (dgraph posting/index.go)', () => {
  const MODULE = 'example.com/app';
  const REPO = {
    'go.mod': [`module ${MODULE}`, '', 'go 1.22'],
    'posting/list.go': [
      'package posting',
      '',
      'type List struct{}',
      '',
      'type MutableLayer struct{}',
      '',
      'func (l *List) findPosting(readTs uint64, uid uint64) bool {',
      '\treturn false',
      '}',
      '',
      'func (mm *MutableLayer) findPosting(readTs, uid uint64) bool {',
      '\treturn false',
      '}',
      '',
      'func (l *List) addMutationInternal(t int) error {',
      '\treturn nil',
      '}',
    ],
    'posting/writer.go': [
      'package posting',
      '',
      'type TxnWriter struct{}',
      '',
      'func (w *TxnWriter) Wait() error {',
      '\treturn nil',
      '}',
    ],
    'posting/index.go': [
      'package posting',
      '',
      'import (',
      '\t"context"',
      '\t"sync"',
      ')',
      '',
      'type Txn struct{}',
      '',
      'func (txn *Txn) addMutationHelper(ctx context.Context, l *List, doUpdateIndex bool,',
      '\tt int) error {',
      '\tl.findPosting(1, 2)',
      '\tif err := l.addMutationInternal(t); err != nil {',
      '\t\treturn err',
      '\t}',
      '\tvar wg sync.WaitGroup',
      '\twg.Wait()',
      '\treturn nil',
      '}',
    ],
    'schema/schema.go': [
      'package schema',
      '',
      'type Mutation interface {',
      '\tMutatedType() string',
      '}',
      '',
      'type mutation struct{}',
      '',
      'func (m *mutation) MutatedType() string {',
      '\treturn ""',
      '}',
    ],
    'resolve/rewrite.go': [
      'package resolve',
      '',
      `import "${MODULE}/schema"`,
      '',
      'func rewrite(m schema.Mutation) string {',
      '\treturn m.MutatedType()',
      '}',
    ],
  };

  it('`l *List` (a parameter) → List.findPosting, not MutableLayer.findPosting', async () => {
    const g = await buildGraph(REPO);
    const t = callTargets(g.dbPath, 'addMutationHelper');
    expect(t['l.findPosting']).toBe('posting/list.go#List.findPosting');
    expect(t['l.addMutationInternal']).toBe('posting/list.go#List.addMutationInternal');
    // sync.WaitGroup is outside the repo: never the in-repo TxnWriter.Wait.
    expect(t['wg.Wait']).toBeNull();
  });

  it('a call through a Go interface keeps the receiver rules (implementations are implicit)', async () => {
    const g = await buildGraph(REPO);
    expect(callTargets(g.dbPath, 'rewrite')['m.MutatedType']).toBe('schema/schema.go#mutation.MutatedType');
  });

  it('ss-trace callees list the typed calls; an external receiver type is no name match', async () => {
    const g = await buildGraph(REPO);
    const repo = new StructuralContextRepository(g.dbPath, { BareCallResolver, projectRoot: g.root });
    try {
      const target = repo.findEntityCandidates('addMutationHelper', { limit: 2 })[0];
      const callees = repo.getCallees(target, { limit: 20 });
      const byName = Object.fromEntries(callees.map((c) => [c.targetName, c.type === 'external' ? null : `${c.parentClass}.${c.name}`]));
      expect(byName['l.findPosting']).toBe('List.findPosting');
      expect(byName['l.addMutationInternal']).toBe('List.addMutationInternal');
      expect(byName['wg.Wait']).toBeNull();
    } finally {
      repo.close();
    }
  });

  it('a graph built before the annotation: the caller signature declares `l *List`, so the stored edge is kept', async () => {
    const g = await buildGraph(REPO);
    const db = new Database(g.dbPath);
    db.prepare(`UPDATE relationships SET full_import_path = NULL WHERE full_import_path LIKE 'recvtype:%'`).run();
    db.close();
    const repo = new StructuralContextRepository(g.dbPath, { BareCallResolver, projectRoot: g.root });
    try {
      const target = repo.findEntityCandidates('addMutationHelper', { limit: 2 })[0];
      const names = repo.getCallees(target, { limit: 20 }).filter((c) => c.type !== 'external').map((c) => c.name);
      expect(names).toContain('findPosting');
      expect(names).toContain('addMutationInternal');
    } finally {
      repo.close();
    }
  });
});

describe('Ruby operator and setter methods are entities (sequel `def []=`)', () => {
  const SRC = [
    'module Sequel',
    '  class Model',
    '    module InstanceMethods',
    '      def [](column)',
    '        @values[column]',
    '      end',
    '',
    '      def []=(column, value)',
    '        change_column_value(column, value)',
    '      end',
    '',
    '      def <=>(other)',
    '        pk <=> other.pk',
    '      end',
    '',
    '      def name=(v)',
    '        change_column_value(:name, v)',
    '      end',
    '',
    '      def change_column_value(column, value)',
    '        @values[column] = value',
    '      end',
    '    end',
    '  end',
    'end',
  ];

  it('extracts `[]`, `[]=`, `<=>` and `name=` with their spans and owner', async () => {
    const out = await new GraphExtractor({ projectRoot: '/t' }).extractFromFile('lib/sequel/model/base.rb', SRC.join('\n'));
    const methods = out.entities.filter((e) => e.type === 'method').map((e) => `${e.parent_class}.${e.name}:${e.start_line}-${e.end_line}`);
    expect(methods).toEqual([
      'InstanceMethods.[]:4-6',
      'InstanceMethods.[]=:8-10',
      'InstanceMethods.<=>:12-14',
      'InstanceMethods.name=:16-18',
      'InstanceMethods.change_column_value:20-22',
    ]);
  });

  it('a call inside `def []=` belongs to `[]=`, not to the module', async () => {
    const g = await buildGraph({ 'lib/sequel/model/base.rb': SRC });
    const repo = new StructuralContextRepository(g.dbPath, { BareCallResolver, projectRoot: g.root });
    try {
      const target = repo.findEntityCandidates('change_column_value', { limit: 2 })[0];
      const callers = [
        ...(repo.getBareCallers?.(target, { limit: 10 }) || []),
        ...repo.getCallers(target, { limit: 10 }),
      ].map((c) => c.name);
      expect(callers).toContain('[]=');
      expect(callers).toContain('name=');
      expect(callers).not.toContain('InstanceMethods');
    } finally {
      repo.close();
    }
  });
});

describe('PHP: typed parameters, catch variables, `new` and library factories (composer)', () => {
  const REPO = {
    'src/Autoload/ClassLoader.php': [
      '<?php',
      'namespace App\\Autoload;',
      'class ClassLoader {',
      '    public function unregister() {',
      '    }',
      '}',
    ],
    'src/Util/IniHelper.php': [
      '<?php',
      'namespace App\\Util;',
      'class IniHelper {',
      '    public function getMessage() {',
      '    }',
      '}',
    ],
    'src/IO/IOInterface.php': [
      '<?php',
      'namespace App\\IO;',
      'interface IOInterface {',
      '    public function write($message);',
      '}',
    ],
    'src/Package/PackageInterface.php': [
      '<?php',
      'namespace App\\Package;',
      'interface PackageInterface {',
      '    public function getName();',
      '}',
    ],
    'src/Package/Package.php': [
      '<?php',
      'namespace App\\Package;',
      'class Package implements PackageInterface {',
      '    public function getName() {',
      '    }',
      '    public function setExtra(array $extra) {',
      '    }',
      '}',
    ],
    'src/Installer/Manager.php': [
      '<?php',
      'namespace App\\Installer;',
      'use Seld\\Signal\\SignalHandler;',
      'use App\\IO\\IOInterface;',
      'use App\\Package\\Package;',
      'use App\\Package\\PackageInterface;',
      'class Manager {',
      '    public function execute(?IOInterface $io = null) {',
      '        $signalHandler = SignalHandler::create([1, 2], function (string $signal) {',
      '            exit(1);',
      '        });',
      '        try {',
      '            $io->write("x");',
      '        } catch (\\RuntimeException $e) {',
      '            $e->getMessage();',
      '        } finally {',
      '            $signalHandler->unregister();',
      '        }',
      '    }',
      '',
      '    public function load(PackageInterface $package) {',
      '        if ($package instanceof Package) {',
      '            $package->setExtra([]);',
      '        }',
      '        $package->getName();',
      '    }',
      '}',
    ],
  };

  it('a library object, a built-in exception and a typed interface parameter', async () => {
    const g = await buildGraph(REPO);
    const t = callTargets(g.dbPath, 'execute');
    // SignalHandler::create(…) made it, and the repo defines no SignalHandler: not ClassLoader.
    expect(t['signalHandler.unregister']).toBeNull();
    // \RuntimeException is PHP's: its getMessage is no repo method.
    expect(t['e.getMessage']).toBeNull();
    expect(t['io.write']).toBe('src/IO/IOInterface.php#IOInterface.write');
  });

  it('a method only a subtype defines (narrowed by instanceof) binds to that subtype', async () => {
    const g = await buildGraph(REPO);
    const t = callTargets(g.dbPath, 'load');
    expect(t['package.setExtra']).toBe('src/Package/Package.php#Package.setExtra');
    expect(t['package.getName']).toBe('src/Package/PackageInterface.php#PackageInterface.getName');
  });

  it('the incremental resolver (resolveRowsScoped) agrees with the full build', async () => {
    const g = await buildGraph(REPO);
    const db = new Database(g.dbPath);
    try {
      const rows = db.prepare(`
        SELECT r.source_id, r.target_name, r.type, r.context_line, r.full_import_path, r.target_id
        FROM relationships r JOIN entities s ON s.id = r.source_id
        WHERE s.name IN ('execute', 'load') AND r.type = 'calls' ORDER BY r.target_name
      `).all();
      expect(rows.length).toBeGreaterThan(3);
      expect(resolveRowsScoped(db, rows, { liveOnly: false })).toEqual(rows.map((r) => r.target_id));
    } finally {
      db.close();
    }
  });

  it('declaredTypeIn reads PHP declarations soundly', () => {
    const t = (src, name) => declaredTypeIn(src, name, 'a.php');
    expect(t('function f(?Foo $x = null, array $a = []) {\n $x->run();', 'x')).toMatchObject({ type: 'Foo', factory: false });
    expect(t('$p = new \\Symfony\\Process($c);\n$p->run();', 'p')).toMatchObject({ type: 'Process', factory: false });
    expect(t('$p = Process::fromShellCommandline(\n $c\n);\n$p->run();', 'p')).toMatchObject({ type: 'Process', factory: true });
    // A chained static call returns another type; a rebinding, a loop variable, an untyped
    // parameter or a union type gives none.
    expect(t('$p = Process::create($c)->setTimeout(1);\n$p->run();', 'p')).toBeNull();
    expect(t('$p = new Process($c);\n$p = get();\n$p->run();', 'p')).toBeNull();
    expect(t('foreach ($xs as $p) {\n $p->run();', 'p')).toBeNull();
    expect(t('function f($p) {\n $p->run();', 'p')).toBeNull();
    expect(t('try {} catch (A|B $e) {\n $e->getMessage();', 'e')).toBeNull();
    expect(parseReceiverType('recvtype:?Process')).toMatchObject({ type: 'Process', factory: true, external: false });
  });
});

describe('one repo method of a generic API name (many distinct receivers)', () => {
  const callers = [];
  for (let i = 0; i < 22; i++) callers.push(`    d${i}.items()`);
  const REPO = {
    'pkg/apps.py': [
      'class Apps:',
      '    def items(self):',
      '        return []',
    ],
    'pkg/use.py': [
      'def walk(apps):',
      ...callers,
      '    apps.items()',
    ],
  };

  it('`dict.items()` is no call of Apps.items; a receiver that names the owner still is', async () => {
    const g = await buildGraph(REPO);
    const db = new Database(g.dbPath, { readonly: true });
    try {
      const rows = db.prepare(`
        SELECT r.target_name, t.parent_class FROM relationships r JOIN entities s ON s.id = r.source_id
        LEFT JOIN entities t ON t.id = r.target_id WHERE s.name = 'walk' AND r.type = 'calls'
      `).all();
      const bound = rows.filter(r => r.parent_class).map(r => r.target_name);
      expect(bound).toEqual(['apps.items']);
    } finally {
      db.close();
    }
  });
});
