import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { tmpdir } from 'os';
import { CallSiteScanner } from '../../core/graph/call-site-scanner.js';
import { LANGUAGES } from '../../core/infrastructure/language-patterns/registry.js';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets, createCallResolutionIndex } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';
import { resolveBareCall } from '../../core/graph/bare-call-resolution.js';
import { StructuralContextRepository } from '../../core/infrastructure/structural-context-repository.js';

function bareCalls(language, lines, defined = []) {
  const scanner = new CallSiteScanner({ ...LANGUAGES[language], id: language });
  const out = [];
  const defs = new Set(defined);
  for (const line of lines) scanner.scanLine(line, () => {}, (name) => out.push(name), (name) => defs.has(name));
  return out;
}

describe('bare call scanning', () => {
  it('finds receiver-less calls and skips member calls, keywords and strings', () => {
    expect(bareCalls('python', [
      'def run(cmd):',
      '    if check(cmd) and not empty(cmd):',
      '        return execute(cmd, quiet=True)',
      '    self.log(cmd)',
      '    print("usage: run(cmd)")',
      '    data = [parse(x) for x in rows]',
    ], ['run'])).toEqual(['check', 'empty', 'execute', 'parse']);
  });

  it('skips definitions: def/fn/func/fun/function, typed C-family declarations, receivers', () => {
    expect(bareCalls('python', ['def helper(a, b):', 'class Foo(Base):', '@decorator(arg)'])).toEqual([]);
    expect(bareCalls('rust', ['pub fn new(x: u32) -> Self {', 'fn helper<T>(t: T) {', '    let v = compute(x)?;', '    println!("{}", fmt(x));'])).toEqual(['compute', 'fmt']);
    expect(bareCalls('go', ['func (c *Context) Next() {', 'func main() {', '\tc.handlers[c.index](c)', '\tdone := process(c)'])).toEqual(['process']);
    expect(bareCalls('java', ['public static int add(int a, int b) {', '  return sum(a, b);', '  List<String> names(int n) {', '  this.reset();'])).toEqual(['sum']);
    expect(bareCalls('c', ['static int *make_buf(size_t n)', '#define MAX(a, b) ((a) > (b) ? (a) : (b))', '  int r = parse_args(argc, argv);', '  if (sizeof(x) > 0) free(p);'])).toEqual(['parse_args', 'free']);
    expect(bareCalls('kotlin', ['fun load(id: Int): User {', '    val u = fetch(id)', 'class Repo(val db: Db) {'])).toEqual(['fetch']);
  });

  it('treats JS/TS class-method shorthand as a definition but keeps statement calls', () => {
    expect(bareCalls('typescript', [
      '  async render(props: Props): Promise<void> {',
      '    const out = format(props);',
      '    await flush(out)',
      '  constructor(private readonly db: Db) {',
      "    const t = `run(${x})`;",
    ])).toEqual(['format', 'flush']);
  });

  it('a name the line itself defines is not a call (tree-sitter entity start lines)', () => {
    expect(bareCalls('swift', ['    func statementDidFail(_ statement: Statement) throws {'], ['statementDidFail'])).toEqual([]);
  });
});

describe('bare call scope resolution', () => {
  const ent = (id, name, file, extra = {}) => ({ id, name, file_path: file, type: 'function', start_line: 1, end_line: 5, parent_class: null, signature: '', ...extra });

  it('Python/JS: only the caller file or an imported file — never a method, never an unrelated file', () => {
    const caller = ent('c', 'main', 'app/cli.py');
    const local = ent('l', 'parse', 'app/cli.py', { start_line: 20, end_line: 30 });
    const imported = ent('i', 'parse', 'app/util.py');
    const unrelated = ent('u', 'parse', 'other/parse.py');
    const method = ent('m', 'parse', 'app/model.py', { type: 'method', parent_class: 'Model' });
    const idx = (imports) => createCallResolutionIndex([caller, local, imported, unrelated, method], { fileImports: new Map([['app/cli.py', new Set(imports)]]) });
    expect(resolveBareCall(caller, [imported, unrelated, method, local], idx([])).map(c => c.id)).toEqual(['l']);
    expect(resolveBareCall(caller, [imported, unrelated, method], idx(['app/util.py'])).map(c => c.id)).toEqual(['i']);
    expect(resolveBareCall(caller, [unrelated, method], idx(['app/util.py']))).toEqual([]);
  });

  it('Go: same package directory only', () => {
    const caller = ent('c', 'Serve', 'server/http.go');
    const pkg = ent('p', 'handle', 'server/route.go');
    const other = ent('o', 'handle', 'client/route.go');
    const idx = createCallResolutionIndex([caller, pkg, other]);
    expect(resolveBareCall(caller, [other, pkg], idx).map(c => c.id)).toEqual(['p']);
    expect(resolveBareCall(caller, [other], idx)).toEqual([]);
  });

  it('Java: implicit-this method of the caller type only', () => {
    const cls = { id: 'k', name: 'Cart', type: 'class', file_path: 'Cart.java', start_line: 1, end_line: 100 };
    const caller = ent('c', 'checkout', 'Cart.java', { type: 'method', start_line: 10, end_line: 20 });
    const own = ent('t', 'total', 'Cart.java', { type: 'method', start_line: 30, end_line: 40 });
    const foreign = ent('f', 'total', 'Order.java', { type: 'method', parent_class: 'Order' });
    const idx = createCallResolutionIndex([cls, caller, own, foreign]);
    expect(resolveBareCall(caller, [foreign, own], idx).map(c => c.id)).toEqual(['t']);
    expect(resolveBareCall(caller, [foreign], idx)).toEqual([]);
  });

  it('C: the single non-test definition repo-wide; two definitions stay unresolved', () => {
    const caller = ent('c', 'main', 'src/main.c');
    const one = ent('a', 'parse_args', 'src/args.c');
    const testDup = ent('t', 'parse_args', 'tests/fake_args.c');
    const dup = ent('d', 'parse_args', 'tools/args.c');
    const idx = createCallResolutionIndex([caller, one, testDup, dup]);
    expect(resolveBareCall(caller, [one, testDup], idx).map(c => c.id)).toEqual(['a']);
    expect(resolveBareCall(caller, [one, dup], idx)).toEqual([]);
  });

  it('a nested local function is visible only inside its host function', () => {
    const hostA = ent('a', 'testA', 'T.swift', { start_line: 10, end_line: 30 });
    const localA = ent('la', 'check', 'T.swift', { start_line: 12, end_line: 15 });
    const hostB = ent('b', 'testB', 'T.swift', { start_line: 40, end_line: 60 });
    const idx = { ...createCallResolutionIndex([hostA, localA, hostB]), enclosingFunctionOf: (e) => (e.id === 'la' ? hostA : null) };
    expect(resolveBareCall(hostA, [localA], idx).map(c => c.id)).toEqual(['la']);
    expect(resolveBareCall(hostB, [localA], idx)).toEqual([]);
  });

  it('Swift has no global tier: a stdlib-named call never binds to an unrelated repo function', () => {
    const caller = ent('c', 'fulfill', 'Tests/Recorder.swift');
    const sqlMin = ent('m', 'min', 'Sources/SQLFunctions.swift');
    expect(resolveBareCall(caller, [sqlMin], createCallResolutionIndex([caller, sqlMin]))).toEqual([]);
  });

  it('never links a call to its own caller (recursion is not an edge)', () => {
    const fn = ent('r', 'walk', 'a.py');
    expect(resolveBareCall(fn, [fn], createCallResolutionIndex([fn]))).toEqual([]);
  });
});

describe('ss-trace lists bare callers and callees (graph build + query)', () => {
  let root;
  let dbPath;
  const FILES = {
    'app/util.py': ['def parse(text):', '    return text.strip()', '', 'def unused():', '    return 1'],
    'app/cli.py': ['from app.util import parse', '', 'def main(argv):', '    return parse(argv[0])', '', 'def other(x):', '    return parse(x)'],
    'other/tool.py': ['def parse(x):', '    return x', '', 'def run():', '    return parse(1)'],
    'svc/route.go': ['package svc', '', 'func handle(path string) string {', '\treturn path', '}'],
    'svc/http.go': ['package svc', '', 'func Serve(p string) string {', '\treturn handle(p)', '}'],
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ss-bare-calls-'));
    for (const [rel, lines] of Object.entries(FILES)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), lines.join('\n'));
    }
    const files = Object.keys(FILES);
    const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot: root, files }) });
    const entities = [];
    const relationships = [];
    const callSites = [];
    for (const rel of files) {
      const out = await extractor.extractFromFile(rel, FILES[rel].join('\n'));
      entities.push(...out.entities);
      relationships.push(...out.relationships);
      callSites.push(...(out.callSites || []));
    }
    dbPath = join(root, 'code-graph.db');
    const db = new Database(dbPath);
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      insertGraph(db, entities, relationships, fts, { syncFts: true, callSites });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
    }
    db.close();
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function withRepo(fn) {
    const repo = new StructuralContextRepository(dbPath, { projectRoot: root });
    try { return fn(repo); } finally { repo.close?.(); }
  }

  it('stores bare calls in call_sites, not in relationships', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const sites = db.prepare('SELECT callee_name FROM call_sites ORDER BY callee_name').all().map(r => r.callee_name);
      expect(sites).toEqual(expect.arrayContaining(['handle', 'parse']));
      expect(db.prepare("SELECT count(*) n FROM relationships WHERE target_name = 'parse' AND type = 'calls'").get().n).toBe(0);
    } finally {
      db.close();
    }
  });

  it('callers of app/util.py parse: the importing file only, not other/tool.py', () => {
    const callers = withRepo((repo) => {
      const target = repo.findEntityCandidates('parse', { filePath: 'app/util.py', limit: 3 })[0];
      expect(target.filePath).toBe('app/util.py');
      return repo.getBareCallers(target).map(c => `${c.filePath}:${c.name}`).sort();
    });
    expect(callers).toEqual(['app/cli.py:main', 'app/cli.py:other']);
  });

  it('callers of other/tool.py parse: its own file only', () => {
    const callers = withRepo((repo) => {
      const target = repo.findEntityCandidates('parse', { filePath: 'other/tool.py', limit: 3 })[0];
      return repo.getBareCallers(target).map(c => `${c.filePath}:${c.name}`);
    });
    expect(callers).toEqual(['other/tool.py:run']);
  });

  it('Go: same-package bare call; callees list the bare callee', () => {
    withRepo((repo) => {
      const handle = repo.findEntityCandidates('handle', { filePath: 'svc/route.go', limit: 3 })[0];
      expect(repo.getBareCallers(handle).map(c => c.name)).toEqual(['Serve']);
      const serve = repo.findEntityCandidates('Serve', { filePath: 'svc/http.go', limit: 3 })[0];
      expect(repo.getBareCallees(serve).map(c => `${c.filePath}:${c.name}`)).toEqual(['svc/route.go:handle']);
    });
  });
});

describe('ranking safety', () => {
  it('only the graph writer, incremental maintenance, GC and ss-trace read call_sites', () => {
    const allowed = new Set([
      'core/graph/graph-extractor.js',
      'core/graph/bare-call-resolution.js',
      'core/incremental-indexing/application/production-reconciler.mjs',
      'core/incremental-indexing/infrastructure/graph-gc.mjs',
      'core/infrastructure/structural-context-repository.js',
      'core/graph/structural-context.js',
    ]);
    const repoRoot = join(__dirname, '..', '..');
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) { walk(abs); continue; }
        if (!/\.(m?js)$/.test(name)) continue;
        const rel = relative(repoRoot, abs);
        if (readFileSync(abs, 'utf-8').includes('call_sites') && !allowed.has(rel)) offenders.push(rel);
      }
    };
    walk(join(repoRoot, 'core'));
    expect(offenders).toEqual([]);
  });
});

describe('call scanning for languages without a registry methodCall pattern', () => {
  const scan = (language, lines) => {
    const scanner = new CallSiteScanner({ ...LANGUAGES[language], id: language });
    const q = [];
    const b = [];
    for (const line of lines) scanner.scanLine(line, (t) => q.push(t), (n) => b.push(n), () => false);
    return { q, b };
  };

  it('Lua: dot and colon method calls, bare calls, -- comments', () => {
    expect(scan('lua', ['local x = util.trim(s) -- util.strip(s)', 'self:render(view)', 'return build(x)'])).toEqual({ q: ['util.trim', 'self.render'], b: ['build'] });
  });

  it('Elixir: pipes call the right-hand function; def lines are not calls', () => {
    expect(scan('elixir', ['def run(data) do', '  data |> normalize |> Cache.put(&fix/1) |> Repo.insert', '  validate(data)'])).toEqual({ q: ['Repo.insert', 'Cache.put'], b: ['normalize', 'validate'] });
  });

  it('Shell: command words call functions; definitions and assignments do not', () => {
    expect(scan('shell', ['deploy() {', 'function cleanup {', '  build_image "$tag" && push_image', '  out=$(render_page index)', '  if check_deps; then', '  local x=1'])).toEqual({ q: [], b: ['build_image', 'push_image', 'render_page', 'check_deps'] });
  });

  it('Julia: short-form definitions are not calls', () => {
    expect(scan('julia', ['area(r) = pi * r^2', 'total = area(2) + perimeter(3)']).b).toEqual(['area', 'perimeter']);
  });
});
