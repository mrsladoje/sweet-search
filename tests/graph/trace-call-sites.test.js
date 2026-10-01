/**
 * ss-trace lists every call site (dgraph replay: applyMutations calls
 * detectPendingTxns on lines 440 and 476; the trace showed only 440).
 *
 * Bare calls keep one call_sites row per site. Qualified calls keep one
 * ranking row per (caller, target) in `relationships` and every site line in
 * the trace-only call_lines table. A caller is one trace item that lists all
 * of its lines (`call@440,476`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { StructuralContextBuilder, formatStructuralContext, mergeCallSites } from '../../core/graph/structural-context.js';
import { pruneRetiredCallSites } from '../../core/incremental-indexing/infrastructure/graph-gc.mjs';
import { formatTraceCompact } from '../../core/search/agent-output-fixes.js';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function buildGraph(files, { dropCallLines = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ss-trace-sites-'));
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
    // A graph built before call_lines existed.
    if (dropCallLines) db.exec('DROP TABLE call_lines');
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
    '\treturn nil',
    '}',
    '',
    'func (n *node) applyMutations() {',
    '\tif err := detectPending("a"); err != nil {',
    '\t\treturn',
    '\t}',
    '\tn.store.Save("a")',
    '\tif err := detectPending("b"); err != nil {',
    '\t\treturn',
    '\t}',
    '\tn.store.Save("b")',
    '}',
  ],
  'worker/store.go': [
    'package worker',
    '',
    'type store struct{}',
    '',
    'func (s *store) Save(k string) {',
    '}',
  ],
};

describe('ss-trace shows every call site of a caller', () => {
  it('bare calls: one caller item listing both lines (dgraph detectPendingTxns shape)', async () => {
    const graph = await buildGraph(GO_FILES);
    const db = new Database(graph.dbPath, { readonly: true });
    const lines = db.prepare("SELECT context_line FROM call_sites WHERE callee_name = 'detectPending' ORDER BY 1").all().map((r) => r.context_line);
    db.close();
    expect(lines).toEqual([8, 12]);

    const result = trace(graph, 'detectPending', { filePath: 'worker/draft.go' });
    expect(result.sections.callers.total).toBe(2);
    expect(result.sections.callers.distinct).toBe(1);
    expect(result.target.fanIn).toBe(1);
    const item = result.sections.callers.items.find((x) => x.name === 'applyMutations');
    expect(item.contextLines).toEqual([8, 12]);
    const text = formatStructuralContext(result);
    expect(text).toContain('applyMutations [method] worker/draft.go:7 call@8,12');
    expect(text).toContain('## callers (2 call sites, 1 distinct caller)');
    // The compact product default (Bundle A, A4) prints the same row.
    const compact = formatTraceCompact(result, { mode: 'callers' });
    expect(compact).toContain('## callers (2 call sites, 1 distinct caller)\napplyMutations [method] worker/draft.go:7 call@8,12');
  });

  it('qualified calls: relationships keep one row per pair, call_lines keep every line', async () => {
    const graph = await buildGraph(GO_FILES);
    const db = new Database(graph.dbPath, { readonly: true });
    const relRows = db.prepare("SELECT context_line FROM relationships WHERE type = 'calls' AND target_name LIKE '%Save'").all();
    const siteLines = db.prepare("SELECT context_line FROM call_lines WHERE target_name LIKE '%Save' ORDER BY 1").all().map((r) => r.context_line);
    db.close();
    expect(relRows.map((r) => r.context_line)).toEqual([11]);
    expect(siteLines).toEqual([11, 15]);

    // Callees of applyMutations: Save is one item with both lines.
    const callees = trace(graph, 'applyMutations', { filePath: 'worker/draft.go' });
    const save = callees.sections.callees.items.find((x) => x.name === 'Save');
    expect(save?.contextLines).toEqual([11, 15]);
    const pending = callees.sections.callees.items.find((x) => x.name === 'detectPending');
    expect(pending?.contextLines).toEqual([8, 12]);

    // Callers of Save: applyMutations with both lines.
    const callers = trace(graph, 'Save', { filePath: 'worker/store.go' });
    const caller = callers.sections.callers.items.find((x) => x.name === 'applyMutations');
    expect(caller?.contextLines).toEqual([11, 15]);
    expect(formatStructuralContext(callers)).toContain('call@11,15');
  });

  it('different receivers of one target are one caller item with every line', async () => {
    // `a.load()` and `b.load()` are two (caller, target_name) pairs that
    // resolve to the same method: one caller, three call sites.
    const graph = await buildGraph({
      'src/store.ts': ['export class Store {', '  load() {', '    return 1;', '  }', '}'],
      'src/run.ts': [
        "import { Store } from './store';",
        'export function run(a: Store, b: Store) {',
        '  a.load();',
        '  b.load();',
        '  a.load();',
        '}',
      ],
    });
    const callers = trace(graph, 'load', { filePath: 'src/store.ts', mode: 'callers' });
    expect(callers.sections.callers.items.map((x) => [x.name, x.contextLines])).toEqual([['run', [3, 4, 5]]]);
    expect(callers.sections.callers.total).toBe(3);
    expect(callers.sections.callers.distinct).toBe(1);
    expect(formatTraceCompact(callers, { mode: 'callers' })).toContain('## callers (3 call sites, 1 distinct caller)\nrun [function] src/run.ts:2 call@3,4,5');
  });

  it('a single-site qualified pair needs no call_lines row: its line comes from relationships', async () => {
    const graph = await buildGraph({
      'app/run.go': [
        'package app',
        '',
        'func run(a *api) {',
        '\ta.One()',
        '\ta.Two()',
        '\ta.Two()',
        '}',
      ],
      'app/api.go': [
        'package app',
        '',
        'type api struct{}',
        '',
        'func (a *api) One() {}',
        'func (a *api) Two() {}',
      ],
    });
    const db = new Database(graph.dbPath, { readonly: true });
    const stored = db.prepare('SELECT target_name, context_line FROM call_lines ORDER BY 2').all();
    db.close();
    expect(stored).toEqual([
      { target_name: 'a.Two', context_line: 5 },
      { target_name: 'a.Two', context_line: 6 },
    ]);
    const callees = trace(graph, 'run', { filePath: 'app/run.go' });
    // The receiver's type is a parameter, so both stay external (`a.One`).
    const byName = Object.fromEntries(callees.sections.callees.items.map((x) => [x.name, x.contextLines]));
    expect(byName['a.One']).toEqual([4]);
    expect(byName['a.Two']).toEqual([5, 6]);
  });

  it('a graph built before call_lines still traces (first line only for qualified calls)', async () => {
    const graph = await buildGraph(GO_FILES, { dropCallLines: true });
    const callers = trace(graph, 'Save', { filePath: 'worker/store.go' });
    const caller = callers.sections.callers.items.find((x) => x.name === 'applyMutations');
    expect(caller?.contextLines).toEqual([11]);
    expect(formatStructuralContext(callers)).toContain('call@11');
  });

  it('mergeCallSites folds items per (entity, relationship) and sorts the lines', () => {
    const merged = mergeCallSites([
      { id: 'a', relationship: 'calls', contextLine: 30 },
      { id: 'a', relationship: 'calls', contextLines: [12, 30] },
      { id: 'a', relationship: 'overrides', contextLine: 5 },
      { id: 'b', relationship: 'calls', contextLine: null },
    ]);
    expect(merged.map((x) => [x.id, x.relationship, x.contextLines, x.contextLine])).toEqual([
      ['a', 'calls', [12, 30], 12],
      ['a', 'overrides', [5], 5],
      ['b', 'calls', [], null],
    ]);
  });
});

describe('graph GC prunes retired call_lines with call_sites', () => {
  it('deletes retired rows of both tables at or below the frontier, keeps live ones', () => {
    const db = new Database(':memory:');
    try {
      createGraphSchema(db);
      const site = db.prepare('INSERT INTO call_sites (source_id, callee_name, context_line, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, ?)');
      const line = db.prepare('INSERT INTO call_lines (source_id, target_name, context_line, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, ?)');
      site.run('s', 'f', 1, 1, 2);
      site.run('s', 'f', 2, 2, null);
      line.run('s', 'a.b', 1, 1, 2);
      line.run('s', 'a.b', 3, 1, 5);
      line.run('s', 'a.b', 4, 2, null);
      const out = pruneRetiredCallSites(db, 3);
      expect(out.deleted).toBe(2);
      expect(db.prepare('SELECT COUNT(*) AS n FROM call_sites').get().n).toBe(1);
      expect(db.prepare('SELECT context_line FROM call_lines ORDER BY 1').all().map((r) => r.context_line)).toEqual([3, 4]);
    } finally {
      db.close();
    }
  });
});
