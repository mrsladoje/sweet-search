/**
 * Trace-only `instantiates` / `typeRef` / `extensionOf` rows
 * (core/graph/type-usage-scanner.js) and their resolution.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { scanInstantiations, scanSignatureTypes, swiftExtensionTarget } from '../../core/graph/type-usage-scanner.js';

let GraphExtractor;
let createGraphSchema;
let insertGraph;
let resolveRelationshipTargets;
let resetTreeSitterProvider;

beforeAll(async () => {
  ({ GraphExtractor, createGraphSchema, insertGraph } = await import('../../core/graph/graph-extractor.js'));
  ({ resolveRelationshipTargets } = await import('../../core/graph/relationship-resolver.js'));
  ({ resetTreeSitterProvider } = await import('../../core/infrastructure/tree-sitter-provider.js'));
});

afterAll(() => {
  if (resetTreeSitterProvider) resetTreeSitterProvider();
});

let originalLog;
beforeEach(() => { originalLog = console.log; console.log = () => {}; });
afterEach(() => { console.log = originalLog; });

describe('scanInstantiations', () => {
  it.each([
    ['java', 'Foo f = new Foo(x);', ['Foo']],
    ['java', 'List<Bar> l = new ArrayList<Bar>();', ['ArrayList']],
    ['typescript', 'const s = new store.Session({ id });', ['Session']],
    ['csharp', 'var h = new HttpClientHandler { UseProxy = false };', ['HttpClientHandler']],
    ['php', '$u = new \\App\\Models\\User($attrs);', ['User']],
    ['cpp', 'auto p = std::make_unique<HttpRequestImpl>(loop);', ['HttpRequestImpl']],
    ['cpp', 'Foo *f = new Foo(1);', ['Foo']],
    ['swift', 'let observer = DatabaseRegionObserver(region: region)', ['DatabaseRegionObserver']],
    ['kotlin', 'val body = MultipartBody(boundary, parts)', ['MultipartBody']],
    ['python', 'session = Session(app, url_prefix="/x")', ['Session']],
    ['rust', 'let w = Workspace::new(&settings)?;', ['Workspace']],
    ['rust', 'Ok(Config { name, path })', ['Config']],
    ['go', 'c := &Context{engine: e}', ['Context']],
    ['go', 'return &node{path: p}', ['node']],
    ['ruby', 'ds = Sequel::Dataset.new(db)', ['Dataset']],
    ['objc', 'Foo *f = [[Foo alloc] init];', ['Foo']],
    ['elixir', 'user = %MyApp.User{name: "x"}', ['User']],
  ])('%s: %s', (lang, line, expected) => {
    expect(scanInstantiations(line, lang)).toEqual(expected);
  });

  it.each([
    ['swift', 'class Broker: NSObject {'],
    ['swift', 'func Make(x: Int) {'],
    ['kotlin', 'data class Point(val x: Int)'],
    ['python', 'def Build(self):'],
    ['python', '@Decorator(name="x")'],
    ['kotlin', 'foo.Bar(1)'],
    ['swift', 'let v = MAX_VALUE(3)'],
    ['rust', 'impl Config {'],
    ['rust', 'if x {'],
    ['java', 'Foo.create(x);'],
    ['go', 'x := NewContext(e)'],
  ])('%s: no instantiation in %s', (lang, line) => {
    expect(scanInstantiations(line, lang)).toEqual([]);
  });
});

describe('scanSignatureTypes', () => {
  it('collects parameter and return types, skips the own name, owner and generic parameters', () => {
    expect(scanSignatureTypes('func statementDidFail(_ statement: Statement, withResultCode resultCode: CInt) throws -> Never {', 'swift', { ownName: 'statementDidFail' }))
      .toEqual(['Statement', 'CInt', 'Never']);
    expect(scanSignatureTypes('public <Key extends Comparable> Node<Key> insert(Key k, Tree owner) {', 'java', { ownName: 'insert', ownerName: 'Tree' }))
      .toEqual(['Comparable', 'Node']);
    expect(scanSignatureTypes('func (c *Context) Bind(obj any, b Binding) error {', 'go', { ownName: 'Bind', ownerName: 'Context' }))
      .toEqual(['Binding']);
    expect(scanSignatureTypes('def fetch(self, req: Request, name="Default") -> Response:', 'python', { ownName: 'fetch' }))
      .toEqual(['Request', 'Response']);
    expect(scanSignatureTypes('fn map<Output>(self, f: Mapper) -> Output {', 'rust', { ownName: 'map' }))
      .toEqual(['Mapper']);
    // Untyped language: no signature types.
    expect(scanSignatureTypes('def fetch(req, Response)', 'ruby', { ownName: 'fetch' })).toEqual([]);
  });
});

describe('swiftExtensionTarget', () => {
  it('names the extended type of a conformance extension only', () => {
    expect(swiftExtensionTarget('extension ValueWriteOnlyObserver: TransactionObserver {')).toBe('ValueWriteOnlyObserver');
    expect(swiftExtensionTarget('public extension Database.TraceEvent: Sendable { }')).toBe('TraceEvent');
    expect(swiftExtensionTarget('extension Array: Foo where Element: Bar {')).toBe('Array');
    expect(swiftExtensionTarget('extension Database {')).toBeNull();
    expect(swiftExtensionTarget('// extension Foo: Bar')).toBeNull();
  });
});

async function build(files) {
  const db = new Database(':memory:');
  const hasFts5 = createGraphSchema(db);
  const ex = new GraphExtractor();
  const ents = [];
  const rels = [];
  for (const [filePath, content] of Object.entries(files)) {
    const r = await ex.extractFromFile(filePath, content);
    ents.push(...r.entities);
    rels.push(...r.relationships);
  }
  insertGraph(db, ents, rels, hasFts5, { syncFts: false });
  resolveRelationshipTargets(db);
  return db;
}

function edges(db, type) {
  return db.prepare(`
    SELECT s.name AS src, t.name || '@' || t.file_path AS dst
    FROM relationships r JOIN entities s ON s.id = r.source_id JOIN entities t ON t.id = r.target_id
    WHERE r.type = ? ORDER BY src, dst
  `).all(type).map(r => `${r.src} -> ${r.dst}`);
}

describe('type-usage resolution', () => {
  it('links a constructed repo type and a signature type; library types stay unlinked', async () => {
    const db = await build({
      'src/model.py': 'class Session:\n    pass\n\nclass Request:\n    pass\n',
      'src/app.py': [
        'from .model import Session, Request',
        '',
        'def handle(req: Request) -> Session:',
        '    s = Session()',
        '    raise ValueError("x")',
      ].join('\n'),
    });
    expect(edges(db, 'instantiates')).toEqual(['handle -> Session@src/model.py']);
    expect(edges(db, 'typeRef')).toEqual(['handle -> Request@src/model.py', 'handle -> Session@src/model.py']);
    db.close();
  });

  it('test code links a test-file type only in its own top-level directory (jj LineRange)', async () => {
    const db = await build({
      'cli/testing/fake-formatter.rs': 'struct LineRange {\n    first: usize,\n}\n',
      'lib/tests/test_fix.rs': 'fn line_range(first: usize) -> LineRange {\n    todo!()\n}\n',
      'cli/tests/test_fmt.rs': 'fn other(first: usize) -> LineRange {\n    todo!()\n}\n',
    });
    expect(edges(db, 'typeRef')).toEqual(['other -> LineRange@cli/testing/fake-formatter.rs']);
    db.close();
  });

  it('no edge when two non-test types share the name; library code never links a test-file type', async () => {
    const db = await build({
      'a/Config.kt': 'class Config(val x: Int)\n',
      'b/Config.kt': 'class Config(val y: Int)\n',
      'src/test/kotlin/Key.kt': 'class Key(val k: String)\n',
      'src/main/kotlin/Use.kt': [
        'class Use {',
        '  fun make(k: Key): Int {',
        '    val c = Config(1)',
        '    return 0',
        '  }',
        '}',
      ].join('\n'),
    });
    expect(edges(db, 'instantiates')).toEqual([]);
    expect(edges(db, 'typeRef')).toEqual([]);
    db.close();
  });
});
