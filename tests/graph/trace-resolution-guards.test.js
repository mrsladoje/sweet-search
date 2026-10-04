/**
 * ss-trace resolution guards (output diet, 2026-10-04).
 *
 * Each case is a wrong or missing row seen in a real r3 trace:
 * - okhttp `ss-trace proceed callers --in RealInterceptorChain.kt` listed 6 callers, 5 of them
 *   tests: the production callers call `chain.proceed(...)` through the interface
 *   `Interceptor.Chain`, and the class header (23 constructor parameters before
 *   `) : Interceptor.Chain {`) was longer than the 12-line join cap, so the class had no
 *   supertype edge and its `proceed` no `overrides` edge.
 * - dgraph `ss-trace addMutationHelper` impact paths `-> String (testutil/docker.go)` and
 *   `-> GetUid (acl/utils.go)`: the body calls Go's `string(...)` and a local closure
 *   `getUID(...)`, bound by a case-insensitive / global name match.
 * - okhttp `proceed` impact `-> getHeadersThrows`: the annotation `@Throws(` matched by substring.
 * - GRDB `observer?.databaseWillCommit()` in the library bound to a test class `Observer`.
 * - dgraph pb_grpc.pb.go: an interface's method declaration listed as a caller.
 * - zipkin `V2SpanWriter.write`: 20 Proto3 field writes (`TIMESTAMP.write(`) listed as callers by name.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import {
  StructuralContextBuilder, callIntoTestTree, dispatchCallersOf, dropNameOnlyCallers, rowCounts, traceAlternatives,
} from '../../core/graph/structural-context.js';
import { formatTraceCompact } from '../../core/search/agent-output-fixes.js';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function buildGraph(files) {
  const root = mkdtempSync(join(tmpdir(), 'ss-trace-guards-'));
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
  const fts = createGraphSchema(db);
  const log = console.log;
  console.log = () => {};
  try {
    insertGraph(db, entities, relationships, fts, { syncFts: true, callSites });
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

const params = Array.from({ length: 16 }, (_, i) => `  val p${i}: Int,`);

describe('callers through the method a target implements (dispatch)', () => {
  it('Kotlin: a supertype after a 16-line constructor; calls through the interface list as `via`', async () => {
    const g = await buildGraph({
      'src/Chain.kt': [
        'package app',
        'interface Chain {',
        '  fun proceed(request: String): String',
        '}',
      ],
      'src/RealChain.kt': [
        'package app',
        'class RealChain(',
        ...params,
        ') : Chain {',
        '  override fun proceed(request: String): String {',
        '    return request',
        '  }',
        '}',
      ],
      'src/Retry.kt': [
        'package app',
        'class Retry {',
        '  fun intercept(chain: Chain): String {',
        '    return chain.proceed("x")',
        '  }',
        '}',
      ],
    });
    const result = trace(g, 'proceed', { filePath: 'src/RealChain.kt', modeSection: 'callers' });
    expect(result.target.filePath).toBe('src/RealChain.kt');
    const row = result.sections.callers.items.find((i) => i.name === 'intercept');
    expect(row).toMatchObject({ file: 'src/Retry.kt', via: 'Chain.proceed' });
    expect(formatTraceCompact(result, { mode: 'callers', inFile: 'src/RealChain.kt' }))
      .toContain('src/Retry.kt\nfunction intercept 3-5 @4 via Chain.proceed');
  });

  it('dispatchCallersOf: only calls resolved to the base method, none already listed', () => {
    const base = { id: 'b', name: 'proceed', parentClass: 'Chain' };
    const repo = {
      getOverriddenMethods: () => [base],
      getCallers: () => [
        { id: 'c1', name: 'a', targetId: 'b' },
        { id: 'c2', name: 'byName', targetId: null, targetName: 'x.proceed' },
        { id: 'c3', name: 'listed', targetId: 'b' },
      ],
    };
    const out = dispatchCallersOf(repo, { id: 't', name: 'proceed' }, [{ id: 'c3' }]);
    expect(out.map((r) => [r.id, r.via])).toEqual([['c1', 'Chain.proceed']]);
    expect(dispatchCallersOf({ getOverriddenMethods: () => [] }, { id: 't' })).toEqual([]);
  });
});

describe('no name-only guesses for calls the graph did not resolve', () => {
  const GO = {
    'posting/index.go': [
      'package posting',
      '',
      'func addHelper(t *Edge) uint64 {',
      '\tgetUID := func(t *Edge) uint64 { return 1 }',
      '\tif string(t.Value) != "" {',
      '\t\treturn getUID(t)',
      '\t}',
      '\treturn helper(t)',
      '}',
      '',
      'func helper(t *Edge) uint64 { return 2 }',
    ],
    'acl/utils.go': ['package acl', '', 'type User struct{}', '', 'func (u *User) GetUid() string {', '\treturn ""', '}'],
    'testutil/docker.go': ['package testutil', '', 'type C struct{}', '', 'func (c C) String() string {', '\treturn ""', '}'],
  };

  it('a bare call binds to no other type\'s method and to no case-insensitive match', async () => {
    const g = await buildGraph(GO);
    const result = trace(g, 'addHelper');
    const names = [
      ...result.sections.callees.items.map((i) => i.name),
      ...result.sections.impact.paths.map((p) => p.path),
    ].join(' ');
    expect(names).not.toMatch(/GetUid|String/);
    expect(names).toContain('helper');
  });

  it('a call from library code into a test file is unresolved', () => {
    expect(callIntoTestTree('GRDB/Core/TransactionObserver.swift', 'Tests/GRDBTests/Core/TransactionObserverTests.swift')).toBe(true);
    expect(callIntoTestTree('posting/index.go', 'posting/list_test.go')).toBe(true);
    expect(callIntoTestTree('posting/list_test.go', 'posting/index.go')).toBe(false);
    expect(callIntoTestTree('posting/a_test.go', 'posting/b_test.go')).toBe(false);
    expect(callIntoTestTree('a.go', null)).toBe(false);
  });

  it('a generic name keeps resolved, bare, same-file and dispatch callers and drops name-only rows', () => {
    const target = { id: 't', name: 'write' };
    const rows = [
      { id: 'r', targetId: 't', targetName: 'b.write' },
      { id: 'n', targetId: null, targetName: 'TIMESTAMP.write' },
      { id: 'o', targetId: 'other', targetName: 'w.write' },
      { id: 'bare', bare: true, targetName: 'write' },
      { id: 'v', via: 'Writer.write', targetId: 'base', targetName: 'w.write' },
    ];
    expect(dropNameOnlyCallers(rows, target, 31).map((r) => r.id)).toEqual(['r', 'bare', 'v']);
    // 3 definitions and fewer than 20 rows: not generic, every row stays.
    expect(dropNameOnlyCallers(rows, target, 3)).toHaveLength(5);
    expect(dropNameOnlyCallers(rows, target, null)).toHaveLength(5);
  });
});

describe('same-file caller scan', () => {
  it('an interface\'s method declaration is no caller (Go)', async () => {
    const g = await buildGraph({
      'pb/grpc.go': [
        'package pb',
        '',
        'type WorkerClient interface {',
        '\tUpdateState(ctx int) error',
        '}',
        '',
        'type workerClient struct{}',
        '',
        'func (c *workerClient) UpdateState(ctx int) error {',
        '\treturn nil',
        '}',
        '',
        'func run(c *workerClient) {',
        '\t_ = c.UpdateState(1)',
        '}',
      ],
    });
    const result = trace(g, 'UpdateState', { filePath: 'pb/grpc.go', modeSection: 'callers' });
    const names = result.sections.callers.items.map((i) => i.name);
    expect(names).not.toContain('WorkerClient');
  });
});

describe('trace rows', () => {
  it('a class\'s own constructor is no other definition of the class', () => {
    const target = { name: 'Loader', type: 'class', filePath: 'L.java', parentClass: null };
    const alts = traceAlternatives('Loader', target, [
      target,
      { name: 'Loader', type: 'method', filePath: 'L.java', parentClass: 'Loader', startLine: 31 },
      { name: 'Loader', type: 'class', filePath: 'other/L.java', parentClass: null, startLine: 3 },
    ]);
    expect(alts.map((a) => a.file)).toEqual(['other/L.java']);
  });

  it('rowCounts: in-repository rows left out, and rows without a definition', () => {
    const all = [
      { id: 'a', relationship: 'calls', filePath: 'a.go' },
      { id: 'b', relationship: 'calls', filePath: 'b.go' },
      { id: 'e', relationship: 'calls', type: 'external', filePath: null },
    ];
    expect(rowCounts(all, [{ id: 'a', relationship: 'calls', file: 'a.go' }])).toEqual({ hidden: 1, external: 1 });
  });

  it('impact: one row per path text, every path left out counted, external paths skipped on request', () => {
    const builder = new StructuralContextBuilder({ repository: { close() {} } });
    const n = (name, filePath) => ({ name, filePath, startLine: 1 });
    const paths = [
      { direction: 'downstream', path: [n('t', 'a.go'), n('x', 'b.go')], edgeTypes: ['calls'], importance: 1 },
      { direction: 'downstream', path: [n('t', 'a.go'), n('x', 'b.go')], edgeTypes: ['handoff'], importance: 0.9 },
      { direction: 'downstream', path: [n('t', 'a.go'), n('ext', null)], edgeTypes: ['calls'], importance: 0.8 },
      { direction: 'downstream', path: [n('t', 'a.go'), n('y', 'c.go')], edgeTypes: ['calls'], importance: 0.7 },
    ];
    const all = builder._packImpact(paths, 10000);
    expect(all.paths.map((p) => p.path)).toEqual(['t (a.go:1) -> x (b.go:1)', 't (a.go:1) -> ext (external)', 't (a.go:1) -> y (c.go:1)']);
    const inRepo = builder._packImpact(paths, 10000, { inRepoOnly: true });
    expect(inRepo.paths.map((p) => p.nodes.map((x) => x.name).join('>'))).toEqual(['t>x', 't>y']);
    expect(inRepo.hidden).toBe(0);
    // A tiny budget: 3 paths always fit, the rest are counted.
    const many = Array.from({ length: 6 }, (_, i) => ({
      direction: 'upstream', path: [n(`c${i}`, `f${i}.go`), n('t', 'a.go')], edgeTypes: ['calls'], importance: 1 - i / 10,
    }));
    const cut = builder._packImpact(many, 1, { inRepoOnly: true });
    expect(cut.paths).toHaveLength(3);
    expect(cut.hidden).toBe(3);
  });
});
