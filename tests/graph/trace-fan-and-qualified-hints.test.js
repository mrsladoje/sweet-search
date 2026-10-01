/**
 * ss-trace fixes (dgraph detectPendingTxns replay).
 *
 * 1. fan-in / fan-out come from the caller and callee sets the body prints.
 *    A stored-edge count printed `fan-in=0` above callers found by the
 *    same-file scan, and gave that section 5% of the token budget.
 * 2. A qualified call hint (`posting.Oracle(`) binds only to its resolved
 *    callee or, for self/this, to a same-file definition. It never takes a
 *    global same-name definition from another package.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { StructuralContextBuilder, formatStructuralContext, traceFanCounts } from '../../core/graph/structural-context.js';
import { callsiteHintSites, callsiteHints } from '../../core/graph/structural-callsite-hints.js';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

/** Build a graph DB from source files. `withEdges: false` stores entities only. */
async function buildGraph(files, { withEdges = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ss-trace-fan-'));
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
    if (withEdges) {
      relationships.push(...out.relationships);
      if (out.callSites) callSites.push(...out.callSites);
    }
  }
  const dbPath = join(root, 'code-graph.db');
  const db = new Database(dbPath);
  const fts = createGraphSchema(db);
  const log = console.log;
  console.log = () => {};
  try {
    insertGraph(db, entities, relationships, fts, { syncFts: true, callSites });
    if (withEdges) resolveRelationshipTargets(db);
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

const GO_FILES = {
  'worker/draft.go': [
    'package worker',
    '',
    'func detectPending(attr string) error {',
    '\to := posting.Oracle()',
    '\tk, _ := x.Parse(attr)',
    '\treturn localStep(o, k)',
    '}',
    '',
    'func localStep(a, b int) error {',
    '\treturn nil',
    '}',
    '',
    'type node struct{}',
    '',
    'func (n *node) applyMutations() {',
    '\tdetectPending("a")',
    '\tif n != nil {',
    '\t\tdetectPending("b")',
    '\t}',
    '}',
  ],
  // Same-named definitions in packages the body never imports. Each has a
  // smaller span than anything else, so it is the global top candidate.
  'cmd/zero/oracle.go': ['package zero', 'func Oracle() int { return 1 }'],
  'dql/parser.go': ['package dql', 'func Parse(s string) int { return 2 }'],
};

describe('ss-trace fan-in and fan-out agree with the printed callers and callees', () => {
  it('counts callers found only by the same-file scan (Go, entities without edges)', async () => {
    const graph = await buildGraph(GO_FILES, { withEdges: false });
    const result = trace(graph, 'detectPending', { filePath: 'worker/draft.go' });

    // Two call sites in one caller: two rows, one distinct caller.
    expect(result.sections.callers.total).toBe(2);
    expect(result.sections.callers.provenance.stored).toBe(0);
    expect(result.target.fanIn).toBe(1);
    expect(result.target.fanIn).toBe(result.sections.callers.distinct);

    const text = formatStructuralContext(result);
    expect(text).toContain('fan-in=1');
    expect(text).toContain('## callers (2 call sites, 1 distinct caller)');
  });

  it('gives a caller-only symbol a real caller budget share, not the fan-in=0 share', async () => {
    const graph = await buildGraph(GO_FILES, { withEdges: false });
    // 100 tokens in a 1000 budget: the 5% share (50 tokens) cannot hold the
    // caller's code. With fan-in=1 and no callees the callers share is larger.
    const result = trace(graph, 'detectPending', { filePath: 'worker/draft.go', tokenBudget: 1000 });
    expect(result.target.fanIn).toBe(1);
    expect(result.sections.callers.items[0].code).toBeTruthy();
  });

  it('header, section totals and body agree on the stored-edge path too', async () => {
    const graph = await buildGraph(GO_FILES);
    const result = trace(graph, 'detectPending', { filePath: 'worker/draft.go' });
    expect(result.target.fanIn).toBe(result.sections.callers.distinct);
    expect(result.target.fanOut).toBe(result.sections.callees.distinct);
    expect(result.target.fanIn).toBeGreaterThan(0);
    expect(result.target.fanOut).toBeGreaterThan(0);
  });

  it('traceFanCounts counts callers per entity and callees per definition or external name', () => {
    const callers = [{ id: 'a' }, { id: 'a' }, { id: 'b' }];
    const callees = [
      { id: 'x', type: 'function' },
      { id: 'x', type: 'function' },
      { id: 'external:0:pkg.Get', type: 'external', targetName: 'pkg.Get' },
      { id: 'external:1:pkg.Get', type: 'external', targetName: 'pkg.Get' },
      { id: 'external:2:pkg.Put', type: 'external', targetName: 'pkg.Put' },
    ];
    expect(traceFanCounts(callers, callees)).toEqual({ fanIn: 2, fanOut: 3 });
    expect(traceFanCounts([], [])).toEqual({ fanIn: 0, fanOut: 0 });
  });
});

describe('qualified call hints never bind to a global same-name definition', () => {
  it('Go: posting.Oracle() and x.Parse() do not land on unrelated Oracle / Parse', async () => {
    const graph = await buildGraph(GO_FILES);
    const result = trace(graph, 'detectPending', { filePath: 'worker/draft.go' });
    const paths = result.sections.impact.paths.map(p => p.path);
    expect(paths.some(p => p.includes('cmd/zero/oracle.go'))).toBe(false);
    expect(paths.some(p => p.includes('dql/parser.go'))).toBe(false);
    // The unqualified local call still reaches its definition.
    expect(paths.some(p => p.includes('localStep'))).toBe(true);
    expect(result.answerCues.criticalPaths.join(' ')).not.toMatch(/cmd\/zero\/oracle\.go|dql\/parser\.go/);
  });

  it('Go: with no stored edges, qualified hints add no callee and no path', async () => {
    const graph = await buildGraph(GO_FILES, { withEdges: false });
    const result = trace(graph, 'detectPending', { filePath: 'worker/draft.go' });
    const names = result.sections.callees.items.map(i => `${i.name}@${i.file}`);
    expect(names.some(n => n.includes('cmd/zero') || n.includes('dql/'))).toBe(false);
    // The unqualified `localStep(` hint keeps the old behaviour.
    expect(names.some(n => n.startsWith('localStep@worker/draft.go'))).toBe(true);
  });

  it('Go: the named method receiver (n.step) binds in the same file like self', async () => {
    const graph = await buildGraph({
      'worker/node.go': [
        'package worker',
        '',
        'type node struct{}',
        '',
        'func (n *node) apply(attr string) error {',
        '\tn.step(attr)',
        '\tm.step(attr)',
        '\treturn nil',
        '}',
        '',
        'func (n *node) step(attr string) {',
        '\t_ = attr',
        '}',
      ],
      'other/step.go': ['package other', '', 'func step(a string) {}'],
    }, { withEdges: false });
    const result = trace(graph, 'apply', { filePath: 'worker/node.go' });
    const callees = result.sections.callees.items.map(i => `${i.name}@${i.file}`);
    expect(callees).toContain('step@worker/node.go');
    expect(callees.some(c => c === 'step@other/step.go')).toBe(false);
  });

  it('own type name as receiver (Foo::helper / Foo.helper) binds in the same file', async () => {
    const graph = await buildGraph({
      'src/Foo.java': [
        'public class Foo {',
        '  public void run() {',
        '    Foo.helper();',
        '    Bar.helper();',
        '  }',
        '  static void helper() {',
        '    return;',
        '  }',
        '}',
      ],
      'src/Util.java': ['public class Util {', '  static void helper() { return; }', '}'],
    }, { withEdges: false });
    const result = trace(graph, 'run', { filePath: 'src/Foo.java' });
    const callees = result.sections.callees.items.map(i => `${i.name}@${i.file}`);
    expect(callees).toContain('helper@src/Foo.java');
    expect(callees.some(c => c === 'helper@src/Util.java')).toBe(false);
  });

  it('TypeScript: this.helper() binds in the same file, other.render() is left out', async () => {
    const graph = await buildGraph({
      'src/view.ts': [
        'export class View {',
        '  run(): void {',
        '    this.helper();',
        '    this.screen.render();',
        '    other.render();',
        '  }',
        '  helper(): void {',
        '    return;',
        '  }',
        '}',
      ],
      'src/screen.ts': [
        // Smaller span: the global top candidate for `render` and `helper`.
        'export function render() { return 1; }',
        'export function helper() { return 2; }',
      ],
    }, { withEdges: false });
    const result = trace(graph, 'run', { filePath: 'src/view.ts' });
    const callees = result.sections.callees.items.map(i => `${i.name}@${i.file}`);
    expect(callees).toContain('helper@src/view.ts');
    expect(callees.some(c => c.startsWith('render@'))).toBe(false);
    expect(callees.some(c => c === 'helper@src/screen.ts')).toBe(false);
    const paths = result.sections.impact.paths.map(p => p.path);
    expect(paths.some(p => p.includes('src/screen.ts'))).toBe(false);
  });

  it('Python: self.helper() binds in the same file, client.fetch() is left out', async () => {
    const graph = await buildGraph({
      'pkg/service.py': [
        'class Service:',
        '    def run(self):',
        '        self.helper()',
        '        client.fetch()',
        '',
        '    def helper(self):',
        '        return 1',
      ],
      'pkg/net.py': ['def fetch(): return 2', 'def helper(): return 3'],
    }, { withEdges: false });
    const result = trace(graph, 'run', { filePath: 'pkg/service.py' });
    const callees = result.sections.callees.items.map(i => `${i.name}@${i.file}`);
    expect(callees).toContain('helper@pkg/service.py');
    expect(callees.some(c => c.startsWith('fetch@'))).toBe(false);
  });

  it('Rust: Self::helper() binds in the same file, other::fetch() is left out', async () => {
    const graph = await buildGraph({
      'src/svc.rs': [
        'struct Svc;',
        'impl Svc {',
        '    fn run(&self) {',
        '        Self::helper();',
        '        other::fetch();',
        '    }',
        '    fn helper() {',
        '        let _ = 1;',
        '    }',
        '}',
      ],
      'src/net.rs': ['fn fetch() {}', 'fn helper() {}'],
    }, { withEdges: false });
    const result = trace(graph, 'run', { filePath: 'src/svc.rs' });
    const callees = result.sections.callees.items.map(i => `${i.name}@${i.file}`);
    expect(callees).toContain('helper@src/svc.rs');
    expect(callees.some(c => c.startsWith('fetch@'))).toBe(false);
  });
});

describe('callsiteHintSites records how each call was written', () => {
  const sites = code => Object.fromEntries(callsiteHintSites(code).map(h => [h.name, h]));

  it('marks unqualified, dotted, scoped and arrow calls', () => {
    const s = sites([
      'plain(1);',
      'x.dotted(2);',
      'pkg::scoped(3);',
      'ptr->arrow(4);',
      'this.selfCall(5);',
      'make().chained(6);',
    ].join('\n'));
    expect(s.plain.qualified).toBe(false);
    expect(s.dotted).toMatchObject({ qualified: true, qualifiers: ['x'] });
    expect(s.scoped).toMatchObject({ qualified: true, qualifiers: ['pkg'] });
    expect(s.arrow).toMatchObject({ qualified: true, qualifiers: ['ptr'] });
    expect(s.selfCall).toMatchObject({ qualified: true, qualifiers: ['this'] });
    expect(s.chained).toMatchObject({ qualified: true, qualifiers: ['?'] });
  });

  it('one bare call makes a name unqualified', () => {
    expect(sites('x.get(1);\nget(2);').get.qualified).toBe(false);
  });

  it('keeps the names callsiteHints always returned', () => {
    const code = 'a.b(1);\nfree(2);\nPkg::s(3);\nfmt.Println(4);';
    expect(callsiteHints(code)).toEqual(['free', 's', 'b']);
  });
});
