import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import http from 'node:http';
import { buildAgentToolDaemonResponse } from '../../core/agent-tools/daemon-route.js';

const mockState = vi.hoisted(() => ({ rows: [] }));

vi.mock('../../core/infrastructure/codebase-repository.js', () => ({
  CodebaseRepository: class {
    refreshManifestEpoch() { return 1; }
    getChunksByFilePath(filePath) { return mockState.rows.filter(r => r.file_path === filePath); }
    close() {}
  },
}));

vi.mock('../../core/infrastructure/config/index.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    DB_PATHS: { ...(actual.DB_PATHS || {}), codebase: ':memory:' },
    LATE_INTERACTION_CONFIG: { ...(actual.LATE_INTERACTION_CONFIG || {}), enabled: false },
  };
});

const {
  ALSO_MAX,
  ALSO_NAME_CAP,
  buildAlsoCandidates,
  formatAlsoLine,
  formatSpanHeading,
  formatSpanSymbols,
  nameContext,
  uncoveredCutRests,
  mergeSpanNames,
  spanEntityNames,
} = await import('../../core/search/semantic-also.js');
const { readSemantic, __resetReadSemanticCachesForTests } = await import('../../core/search/search-read-semantic.js');
const { getGraphRepoForProject, __resetReadCachesForTests } = await import('../../core/search/search-read.js');
const { buildReadSemanticDaemonResponse } = await import('../../core/search/search-server.js');
const { collectSemanticShownSpans } = await import('../../core/search/agent-span-ledger.js');

const ent = (name, type, startLine, endLine, extra = {}) => ({ id: `${name}:${startLine}`, name, type, startLine, endLine, parentClass: null, ...extra });

// A graph double: enclosing = tightest entity containing the range; inRange = entities starting in it.
function fakeGraph(entities) {
  return {
    findEnclosingEntity: (_f, s, e) => entities
      .filter(x => x.startLine <= s && x.endLine >= e)
      .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0] || null,
    findEntitiesInRange: (_f, s, e) => entities.filter(x => x.startLine >= s && x.startLine <= e),
  };
}

const chunk = (id, startLine, endLine, score, symbol = null, type = 'code') => ({ id, startLine, endLine, score, symbol, type });

describe('buildAlsoCandidates', () => {
  const graph = fakeGraph([
    ent('alpha', 'function', 10, 40),
    ent('beta', 'function', 50, 90),
    ent('Gamma.run', 'method', 100, 130),
    ent('delta', 'function', 140, 150),
    ent('eps', 'function', 160, 170),
    ent('zeta', 'function', 180, 190),
    ent('eta', 'function', 200, 210),
  ]);

  it('keeps score order, names the enclosing entity range, and caps at ALSO_MAX (5)', () => {
    const pool = [
      chunk('a', 100, 110, 0.9), chunk('b', 60, 70, 0.8), chunk('c', 15, 20, 0.7), chunk('d', 141, 145, 0.6),
      chunk('e', 162, 165, 0.5), chunk('f', 182, 185, 0.4), chunk('g', 202, 205, 0.3),
    ];
    const out = buildAlsoCandidates(pool, [], { file: 'f.js', graph });
    expect(ALSO_MAX).toBe(5);
    expect(out.map(o => [o.startLine, o.endLine, o.name])).toEqual([
      [100, 130, 'Gamma.run'],
      [50, 90, 'beta'],
      [10, 40, 'alpha'],
      [140, 150, 'delta'],
      [160, 170, 'eps'],
    ]);
    expect(out.map(o => o.score)).toEqual([0.9, 0.8, 0.7, 0.6, 0.5]);
    expect(out[1].kind).toBe('function');
  });

  it('never points at a printed line: a chunk cut by a printed span keeps its unprinted part', () => {
    const pool = [chunk('a', 15, 20, 0.9), chunk('b', 60, 70, 0.8), chunk('c', 19, 24, 0.7)];
    const out = buildAlsoCandidates(pool, [{ startLine: 18, endLine: 25 }], { file: 'f.js', graph });
    // alpha (10-40) is printed at 18-25: its place is the part before, 10-17; chunk c is printed whole.
    expect(out.map(o => [o.startLine, o.endLine, o.name])).toEqual([[10, 17, 'alpha'], [50, 90, 'beta']]);
  });

  it('names every entity a chunk holds (a cAST chunk is labelled after its first symbol)', () => {
    const g = fakeGraph([
      ent('Pool', 'class', 1, 300),
      ent('can_make_new?', 'method', 181, 185, { parentClass: 'Pool' }),
      ent('try_make_new', 'method', 192, 218, { parentClass: 'Pool' }),
      ent('acquire', 'method', 227, 234, { parentClass: 'Pool' }),
      ent('n', 'variable', 228, 228),
    ]);
    const out = buildAlsoCandidates([chunk('a', 174, 234, 0.9, 'can_make_new?', 'method')], [], { file: 'f.rb', graph: g });
    expect(out).toEqual([{
      startLine: 174, endLine: 234, names: ['Pool.can_make_new?', 'Pool.try_make_new', 'Pool.acquire'],
      name: 'Pool.can_make_new?', kind: 'method', score: 0.9,
    }]);
    expect(formatAlsoLine(out, nameContext(['Pool']))).toBe('# also: 174-234 can_make_new?, try_make_new, acquire');
  });

  it('drops a place with no name, and one that holds only the stub of an entity', () => {
    const g = fakeGraph([ent('Pool', 'class', 9, 300), ent('run', 'function', 20, 40)]);
    const pool = [chunk('head', 1, 5, 0.9), chunk('decl', 7, 10, 0.8, 'Pool', 'class'), chunk('r', 20, 40, 0.7)];
    expect(buildAlsoCandidates(pool, [], { file: 'f.rb', graph: g }).map(o => o.name)).toEqual(['run']);
  });

  it('joins a place that overlaps an earlier one (two overloads of one name)', () => {
    const g = fakeGraph([ent('move', 'function', 777, 783), ent('move', 'function', 778, 844)]);
    const out = buildAlsoCandidates([chunk('a', 777, 783, 0.9), chunk('b', 790, 844, 0.8)], [], { file: 'f.ts', graph: g });
    expect(out.map(o => [o.startLine, o.endLine, o.names])).toEqual([[777, 844, ['move']]]);
  });

  it('gives one entry per enclosing entity (two body chunks of one function)', () => {
    const pool = [chunk('a', 55, 60, 0.9), chunk('b', 70, 80, 0.8), chunk('c', 50, 51, 0.7), chunk('d', 12, 20, 0.6)];
    const out = buildAlsoCandidates(pool, [], { file: 'f.js', graph });
    expect(out.map(o => [o.startLine, o.endLine, o.name])).toEqual([[50, 90, 'beta'], [10, 40, 'alpha']]);
    expect(out[0].score).toBe(0.9);
  });

  it('is empty when every ranked chunk is printed or the pool is empty', () => {
    expect(buildAlsoCandidates([], [], { file: 'f.js', graph })).toEqual([]);
    expect(buildAlsoCandidates([chunk('a', 15, 20, 0.9)], [{ startLine: 10, endLine: 40 }], { file: 'f.js', graph })).toEqual([]);
    expect(buildAlsoCandidates(undefined, undefined, { file: 'f.js' })).toEqual([]);
  });

  it('falls back to the chunk range and stored name with no graph', () => {
    const pool = [chunk('a', 100, 110, 0.9, 'run', 'function'), chunk('b', 60, 70, 0.8, null, 'code'), chunk('c', 5, 9, 0.7, 'unknown', 'unknown')];
    const out = buildAlsoCandidates(pool, [], { file: 'f.js', graph: null });
    // Nameless places are dropped: a bare range says nothing about what is there.
    expect(out).toEqual([
      { startLine: 100, endLine: 110, names: ['run'], name: 'run', kind: 'function', score: 0.9 },
    ]);
    expect(formatAlsoLine(out)).toBe('# also: 100-110 run');
  });

  it('never throws when the graph throws or returns junk', () => {
    const boom = { findEnclosingEntity() { throw new Error('no such table: entities'); } };
    expect(buildAlsoCandidates([chunk('a', 1, 5, 1, 'x', 'function')], [], { file: 'f.js', graph: boom })).toEqual([
      { startLine: 1, endLine: 5, names: ['x'], name: 'x', kind: 'function', score: 1 },
    ]);
    const junk = { findEnclosingEntity: () => ({ name: 'v', type: 'variable', startLine: 1, endLine: 99 }) };
    expect(buildAlsoCandidates([chunk('a', 1, 5, 1, 'x', 'function')], [], { file: 'f.js', graph: junk })[0].endLine).toBe(5);
  });

  it('ignores a class-like container far larger than the chunk', () => {
    const g = fakeGraph([ent('Big', 'class', 1, 2000)]);
    const out = buildAlsoCandidates([chunk('a', 100, 120, 1, 'm', 'method')], [], { file: 'f.js', graph: g });
    expect(out).toEqual([{ startLine: 100, endLine: 120, names: ['m'], name: 'm', kind: 'method', score: 1 }]);
  });
});

describe('formatAlsoLine', () => {
  it('prints range and name joined by a middle dot, and nothing when empty', () => {
    expect(formatAlsoLine([
      { startLine: 606, endLine: 694, name: 'ToExportKvList' },
      { startLine: 775, endLine: 944, name: 'exportInternal' },
    ])).toBe('# also: 606-694 ToExportKvList · 775-944 exportInternal');
    expect(formatAlsoLine([])).toBe('');
    expect(formatAlsoLine(undefined)).toBe('');
  });
});

describe('span header symbols', () => {
  it('lists up to 4 names then +N, preferring entity names', () => {
    expect(formatSpanSymbols({ symbols: ['a'] })).toBe(' [a]');
    expect(formatSpanSymbols({ symbols: [] })).toBe('');
    expect(formatSpanSymbols({ symbols: ['a'], entityNames: ['a', 'b', 'c', 'd'] })).toBe(' [a, b, c, d]');
    expect(formatSpanSymbols({ symbols: ['a'], entityNames: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(' [a, b, c, d, +2]');
  });

  it('merges chunk labels after entity names without repeats', () => {
    expect(mergeSpanNames(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(mergeSpanNames([], undefined)).toEqual([]);
  });

  it('a chunk label an entity name covers is not repeated; `(part N)` pieces are one name', () => {
    // zipkin Collector: `Collector.accept` then `accept`; typedoc `onResolve (part 3)`.
    expect(mergeSpanNames(['Collector', 'Collector.accept'], ['accept', 'onResolve (part 3)', 'onResolve (part 4)']))
      .toEqual(['Collector', 'Collector.accept', 'onResolve']);
    expect(mergeSpanNames(['TimedQueueConnectionPool'], ['Sequel::TimedQueueConnectionPool'])).toEqual(['TimedQueueConnectionPool']);
  });

  it('a span the budget cut names no chunk label: the labels describe lines it did not print', () => {
    // sequel timed_queue.rb: 11-80 printed of the merged 11-293; hold..available are below 80.
    const labels = ['initialize', 'hold', 'preallocated_make_new', 'can_make_new?', 'available'];
    expect(mergeSpanNames(['Pool', 'Pool.initialize'], labels, { truncated: true })).toEqual(['Pool', 'Pool.initialize']);
    expect(formatSpanSymbols({ symbols: labels, truncated: true })).toBe('');
  });
});

describe('formatSpanHeading and the Parent. prefix', () => {
  it('prints `## a-b names` and drops a prefix the output already named', () => {
    const named = nameContext();
    const span = { startLine: 11, endLine: 80, entityNames: ['Pool', 'Pool.initialize', 'Pool.all_connections', 'Pool.disconnect', 'Pool.x'] };
    expect(formatSpanHeading(span, named)).toBe('## 11-80 Pool, initialize, all_connections, disconnect +1 more');
    // With the index kinds, one word per run of the same kind (kind-words.js).
    const kinds = { Pool: 'class', 'Pool.initialize': 'method', 'Pool.all_connections': 'method', 'Pool.disconnect': 'method', 'Pool.x': 'method' };
    expect(formatSpanHeading(span, nameContext([], kinds))).toBe('## 11-80 class Pool, methods initialize, all_connections, disconnect +1 more');
    expect(formatAlsoLine([{ startLine: 174, endLine: 234, names: ['Pool.try_make_new', 'Pool.acquire'] }], named))
      .toBe('# also: 174-234 try_make_new, acquire');
    expect(formatSpanHeading({ startLine: 1, endLine: 2, symbols: [] })).toBe('## 1-2');
  });

  it('keeps a prefix nothing named before; inside one list the parent is said once', () => {
    expect(formatAlsoLine([{ startLine: 397, endLine: 451, names: ['Builder.traceId', 'Builder.parentId', 'Other.id'] }]))
      .toBe('# also: 397-451 Builder.traceId, parentId, Other.id');
  });

  it('a parent printed once is dropped later, until a second parent makes bare names ambiguous', () => {
    // GRDB: one class throughout.
    const one = nameContext();
    expect(formatSpanHeading({ startLine: 354, endLine: 362, entityNames: ['Obs.asyncStart'] }, one)).toBe('## 354-362 Obs.asyncStart');
    expect(formatAlsoLine([{ startLine: 423, endLine: 525, names: ['Obs.asyncStartObservation'] }], one))
      .toBe('# also: 423-525 asyncStartObservation');
    // zipkin Span.java: Span's and Builder's traceId must stay apart.
    const two = nameContext();
    expect(formatSpanHeading({ startLine: 611, endLine: 676, entityNames: ['Span', 'Span.toString'] }, two)).toBe('## 611-676 Span, toString');
    expect(formatAlsoLine([
      { startLine: 397, endLine: 451, names: ['Builder.traceId', 'Builder.id'] },
      { startLine: 56, endLine: 96, names: ['Span.traceId', 'Span.id'] },
    ], two)).toBe('# also: 397-451 Builder.traceId, id · 56-96 Span.traceId, id');
  });

  it('a constructor named like its class is not listed beside it', () => {
    expect(formatSpanHeading({ startLine: 68, endLine: 111, entityNames: ['Handler', 'Handler.Handler', 'Handler.SendAsync'] }))
      .toBe('## 68-111 Handler, SendAsync');
  });

  it('caps an also place at ALSO_NAME_CAP names', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(formatAlsoLine([{ startLine: 1, endLine: 9, names }])).toBe(`# also: 1-9 ${names.slice(0, ALSO_NAME_CAP).join(', ')} +2 more`);
  });
});

describe('uncoveredCutRests', () => {
  const cut = { startLine: 11, endLine: 80, fullStartLine: 11, fullEndLine: 293, truncated: true, exactRange: true };
  it('is empty when the also places cover the rest of a cut span (padding gaps ignored)', () => {
    const also = [{ startLine: 81, endLine: 121 }, { startLine: 123, endLine: 172 }, { startLine: 174, endLine: 293 }];
    expect(uncoveredCutRests([cut], also)).toEqual([]);
  });
  it('names the rest no place covers', () => {
    expect(uncoveredCutRests([cut], [{ startLine: 81, endLine: 121 }])).toEqual(['122-293']);
    // A leftover of at most two lines beside a place is padding; a rest no place touches is not.
    expect(uncoveredCutRests([cut], [{ startLine: 81, endLine: 291 }])).toEqual([]);
    expect(uncoveredCutRests([{ ...cut, endLine: 291 }], [])).toEqual(['292-293']);
    expect(uncoveredCutRests([{ ...cut, truncated: false }], [])).toEqual([]);
    expect(uncoveredCutRests([cut], [])).toEqual(['81-293']);
  });

  it('names every entity a span holds and skips fields, nested closures and stub neighbours', () => {
    const g = fakeGraph([
      ent('SchemaExportKv', 'function', 946, 959),
      ent('TypeExportKv', 'function', 961, 967),
      ent('Export', 'method', 972, 987),
      ent('inner', 'arrowFunction', 975, 978),
      ent('mode', 'variable', 980, 980),
      ent('handleExportOverNetwork', 'function', 989, 1006),
      ent('ExportOverNetwork', 'function', 1009, 1066),
    ]);
    // 942-1010 shows only the first two lines of ExportOverNetwork: a stub, not content.
    expect(spanEntityNames(g, 'f.go', { startLine: 942, endLine: 1010 })).toEqual([
      'SchemaExportKv', 'TypeExportKv', 'Export', 'handleExportOverNetwork',
    ]);
    // A span inside one function names that function even though it starts after it.
    expect(spanEntityNames(g, 'f.go', { startLine: 990, endLine: 1000 })).toEqual(['handleExportOverNetwork']);
    // A truncated span names only what its printed head reaches.
    expect(spanEntityNames(g, 'f.go', { startLine: 942, endLine: 1010, truncated: true, text: 'a\n'.repeat(25) })).toEqual(['SchemaExportKv', 'TypeExportKv']);
  });

  it('returns [] with no graph', () => {
    expect(spanEntityNames(null, 'f.go', { startLine: 1, endLine: 9 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readSemantic end to end on a small indexed file with a real code-graph.db
// ---------------------------------------------------------------------------

const FILE = [
  'function fa() {',            // 1
  '  token token token',        // 2
  '  token token token',        // 3
  '  return 1;',                // 4
  '}',                          // 5
  '',                           // 6
  'function fb() {',            // 7
  '  const sig = token;',       // 8
  '  token token',              // 9
  '  token token',              // 10
  '}',                          // 11
  '',                           // 12
  'function fc() {',            // 13
  '  token token token',        // 14
  '  return 3;',                // 15
  '}',                          // 16
  '',                           // 17
  'function fd() {',            // 18
  '  token token',              // 19
  '}',                          // 20
  '',
].join('\n');

let TMP;

function addChunk(id, startLine, endLine, symbol = null, type = 'code') {
  mockState.rows.push({
    id, file_path: 'src/a.js', text: 'x',
    metadata: JSON.stringify({ language: 'javascript', symbol, chunk_type: type, line_start: startLine, line_end: endLine }),
  });
}

function writeGraph(entities) {
  const dir = path.join(TMP, '.sweet-search');
  mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'code-graph.db'));
  db.exec(`CREATE TABLE entities (id TEXT PRIMARY KEY, name TEXT, type TEXT, file_path TEXT,
    start_line INTEGER, end_line INTEGER, parent_class TEXT, stale_since TEXT)`);
  const ins = db.prepare('INSERT INTO entities (id, name, type, file_path, start_line, end_line, parent_class) VALUES (?,?,?,?,?,?,?)');
  for (const e of entities) ins.run(e.id, e.name, e.type, 'src/a.js', e.startLine, e.endLine, e.parentClass ?? null);
  db.close();
}

function setupFile() {
  mkdirSync(path.join(TMP, 'src'), { recursive: true });
  writeFileSync(path.join(TMP, 'src/a.js'), FILE);
  // fb has a signature chunk and a body chunk: two chunks, one function.
  addChunk('fa', 1, 5, 'fa', 'function');
  addChunk('fb-sig', 7, 8, 'fb', 'function');
  addChunk('fb-body', 9, 11, 'fb');
  addChunk('fc', 13, 16, 'fc', 'function');
  addChunk('fd', 18, 20, 'fd', 'function');
}

const REQ = () => ({ path: 'src/a.js', query: 'token', contextLines: 0, maxChars: 80, projectRoot: TMP });

beforeEach(() => {
  mockState.rows = [];
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
  TMP = mkdtempSync(path.join(tmpdir(), 'sweet-search-also-'));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mockState.rows = [];
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
});

describe('readSemantic alsoCandidates', () => {
  it('reads graph entities once for both printed names and alternative candidates', async () => {
    setupFile();
    writeGraph([
      ent('fa', 'function', 1, 5),
      ent('fb', 'function', 7, 11),
      ent('fc', 'function', 13, 16),
      ent('fd', 'function', 18, 20),
    ]);
    const graph = getGraphRepoForProject(TMP);
    const open = vi.spyOn(graph, '_open');
    const enclosing = vi.spyOn(graph, 'findEnclosingEntity');
    const inRange = vi.spyOn(graph, 'findEntitiesInRange');
    try {
      const r = await readSemantic(REQ());
      expect(r.spans[0].entityNames).toEqual(['fa']);
      expect(r.alsoCandidates.map(c => c.name)).toEqual(['fb', 'fc', 'fd']);
      expect(open).toHaveBeenCalledTimes(1);
      expect(enclosing).not.toHaveBeenCalled();
      expect(inRange).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      enclosing.mockRestore();
      inRange.mockRestore();
    }
  });

  it('prints the best span and names the next-best entities, one per function, in score order', async () => {
    setupFile();
    writeGraph([
      { id: 'fa', name: 'fa', type: 'function', startLine: 1, endLine: 5 },
      { id: 'fb', name: 'fb', type: 'function', startLine: 7, endLine: 11 },
      { id: 'fc', name: 'fc', type: 'function', startLine: 13, endLine: 16 },
      { id: 'fd', name: 'fd', type: 'function', startLine: 18, endLine: 20 },
    ]);
    const r = await readSemantic(REQ());
    expect(r.spans.map(s => [s.startLine, s.endLine])).toEqual([[1, 5]]);
    expect(r.spans[0].entityNames).toEqual(['fa']);
    // fb-body (4 hits) > fc (3) > fd (2) > fb-sig (1 hit); fb-sig folds into fb.
    expect(r.alsoCandidates.map(c => [c.startLine, c.endLine, c.name])).toEqual([[7, 11, 'fb'], [13, 16, 'fc'], [18, 20, 'fd']]);
    expect(formatAlsoLine(r.alsoCandidates)).toBe('# also: 7-11 fb · 13-16 fc · 18-20 fd');
    // No candidate overlaps the printed span.
    for (const c of r.alsoCandidates) expect(c.startLine > 5 || c.endLine < 1).toBe(true);
  });

  it('falls back to chunk ranges and stored names when the graph db is missing (old index)', async () => {
    setupFile();
    const r = await readSemantic(REQ());
    expect(r.ok).toBe(true);
    expect(r.spans[0].entityNames).toBeUndefined();
    expect(r.alsoCandidates.map(c => [c.startLine, c.endLine, c.name])).toEqual([[9, 11, 'fb'], [13, 16, 'fc'], [18, 20, 'fd']]);
  });

  it('survives a graph db without an entities table', async () => {
    setupFile();
    mkdirSync(path.join(TMP, '.sweet-search'), { recursive: true });
    const db = new Database(path.join(TMP, '.sweet-search/code-graph.db'));
    db.exec('CREATE TABLE unrelated (x INTEGER)');
    db.close();
    const r = await readSemantic(REQ());
    expect(r.ok).toBe(true);
    expect(r.alsoCandidates.length).toBeGreaterThan(0);
    expect(formatSpanSymbols(r.spans[0])).toBe(' [fa]');
  });

  it('is empty when everything ranked fits the budget', async () => {
    setupFile();
    const r = await readSemantic({ ...REQ(), maxChars: 8000 });
    expect(r.spans.length).toBeGreaterThan(0);
    expect(r.alsoCandidates).toEqual([]);
    expect(formatAlsoLine(r.alsoCandidates)).toBe('');
  });

  it('lists every entity a multi-function chunk holds in the span header', async () => {
    const lines = [];
    for (let i = 0; i < 6; i++) lines.push(`function g${i}() {`, '  token token token token', '}');
    mkdirSync(path.join(TMP, 'src'), { recursive: true });
    writeFileSync(path.join(TMP, 'src/a.js'), lines.join('\n') + '\n');
    addChunk('multi', 1, 18, 'g0', 'function');
    writeGraph(Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, name: `g${i}`, type: 'function', startLine: i * 3 + 1, endLine: i * 3 + 3 })));
    const r = await readSemantic({ ...REQ(), maxChars: 8000 });
    expect(r.spans[0].symbols).toEqual(['g0']);
    expect(formatSpanSymbols(r.spans[0])).toBe(' [g0, g1, g2, g3, +2]');
  });

  it('changes neither the printed spans nor their ranking relative to the span list', async () => {
    setupFile();
    const without = await readSemantic(REQ());
    writeGraph([{ id: 'fa', name: 'fa', type: 'function', startLine: 1, endLine: 5 }]);
    __resetReadCachesForTests();
    __resetReadSemanticCachesForTests();
    const withGraph = await readSemantic(REQ());
    const strip = (r) => r.spans.map(s => [s.startLine, s.endLine, s.score, s.text]);
    expect(strip(withGraph)).toEqual(strip(without));
  });
});

describe('warm-server path and in-process path agree', () => {
  it('uses one graph lookup through the real agent-tool handler and its socket and fallback paths', async () => {
    TMP = realpathSync(TMP);
    mkdirSync(path.join(TMP, 'src'), { recursive: true });
    const lines = [];
    const entities = ['alpha', 'beta', 'gamma', 'delta'].map((name, i) => {
      const start = i * 40 + 1;
      lines.push(`function f${i}() {`, '  token token token', '  return 1;', '}', ...Array(36).fill(''));
      addChunk(`f${i}`, start, start + 3, `f${i}`, 'function');
      return ent(name, 'function', start, start + 3);
    });
    writeFileSync(path.join(TMP, 'src/a.js'), lines.join('\n'));
    writeGraph(entities);
    const db = new Database(path.join(TMP, '.sweet-search/codebase.db'));
    db.exec("CREATE TABLE vectors (file_path TEXT, epoch_retired INTEGER); INSERT INTO vectors VALUES ('src/a.js', NULL)");
    db.close();
    const graph = getGraphRepoForProject(TMP);
    const open = vi.spyOn(graph, '_open');
    const enclosing = vi.spyOn(graph, 'findEnclosingEntity');
    const inRange = vi.spyOn(graph, 'findEntitiesInRange');
    const requests = [];
    const responses = [];
    const socketPath = path.join(TMP, 'tool.sock');
    const searcher = { projectRoot: TMP };
    const server = http.createServer(async (req, res) => {
      requests.push(req.url);
      try {
        const response = await buildReadSemanticDaemonResponse(req.url, {
          isUnixSocket: true, serverReady: true, searcher,
        });
        responses.push(response);
        res.writeHead(response.status, { 'Content-Type': response.contentType });
        res.end(response.body);
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
      });
      const call = () => buildAgentToolDaemonResponse({
        v: 1, tool: 'semantic', args: ['src/a.js', 'token', '--max-tokens', '20'],
        cwd: TMP, pid: process.pid,
        env: {
          SWEET_SEARCH_PROJECT_ROOT: TMP, SWEET_SEARCH_SOCKET_PATH: socketPath,
          SWEET_SEARCH_EXACT_REREAD_OMISSION: '0', SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
        },
      }, { isUnixSocket: true, isReady: () => true, searcher });
      const warmResponse = await call();
      expect(warmResponse.status).toBe(200);
      const warm = JSON.parse(warmResponse.body);
      expect(warm.code).toBe(0);
      expect(warm.stderr).toBe('');
      expect(warm.stdout).toContain('## 1-4 functions alpha, f0\n');
      expect(warm.stdout).toContain('# also: 41-44 function beta · 81-84 function gamma · 121-124 function delta');
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatch(/^\/read-semantic\?/);
      expect(responses[0].status).toBe(200);
      expect(JSON.parse(responses[0].body).ok).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
      expect(enclosing).not.toHaveBeenCalled();
      expect(inRange).not.toHaveBeenCalled();
      await new Promise(resolve => server.close(resolve));
      open.mockClear();
      const fallback = JSON.parse((await call()).body);
      expect(fallback).toEqual(warm);
      expect(open).toHaveBeenCalledTimes(1);
      expect(enclosing).not.toHaveBeenCalled();
      expect(inRange).not.toHaveBeenCalled();
    } finally {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      open.mockRestore();
      enclosing.mockRestore();
      inRange.mockRestore();
    }
  });

  it('serves the same structured fields as readSemantic and renders identical text', async () => {
    setupFile();
    writeGraph([
      { id: 'fa', name: 'fa', type: 'function', startLine: 1, endLine: 5 },
      { id: 'fb', name: 'fb', type: 'function', startLine: 7, endLine: 11 },
      { id: 'fc', name: 'fc', type: 'function', startLine: 13, endLine: 16 },
    ]);
    const direct = await readSemantic(REQ());
    const url = `/read-semantic?${new URLSearchParams({
      path: 'src/a.js', q: 'token', projectRoot: TMP, format: 'json', maxChars: '80', contextLines: '0',
    })}`;
    const res = await buildReadSemanticDaemonResponse(url, {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: TMP },
      readSemanticFn: readSemantic,
      formatReadSemanticResultFn: (result) => JSON.stringify(result),
    });
    expect(res.status).toBe(200);
    const served = JSON.parse(res.body);
    const render = (r) => [
      formatAlsoLine(r.alsoCandidates),
      ...r.spans.map(s => `${s.startLine}-${s.endLine}${formatSpanSymbols(s)}`),
    ].join('\n');
    expect(served.alsoCandidates).toEqual(JSON.parse(JSON.stringify(direct.alsoCandidates)));
    expect(render(served)).toBe(render(direct));
    expect(render(direct)).toContain('# also: 7-11 fb · 13-16 fc');
  });
});

describe('also candidates are pointers, not shown spans', () => {
  it('the span ledger collects only printed spans', async () => {
    setupFile();
    const r = await readSemantic(REQ());
    expect(r.alsoCandidates.length).toBeGreaterThan(0);
    const shown = collectSemanticShownSpans(r, { projectRoot: TMP });
    expect(shown.map(s => [s.startLine, s.endLine])).toEqual([[1, 5]]);
  });

  it('cmdSemantic prints the line after the spans and never feeds it to the ledger calls', () => {
    const src = readFileSync(path.join(import.meta.dirname, '../../eval/agent-read-workflows/bin/_ss-helpers.mjs'), 'utf8');
    const body = src.slice(src.indexOf('async function cmdSemantic'), src.indexOf('const TRACE_USAGE'));
    expect(body).toContain('formatAlsoLine(r.alsoCandidates, named)');
    expect(body).toContain('formatSpanHeading(span, named)');
    expect(body.indexOf('formatAlsoLine(')).toBeGreaterThan(body.indexOf('formatSpanHeading('));
    // The span ledger is recorded server-side; no `shown-full:` trailer is printed.
    expect(body).not.toContain('renderShownFullTrailer(');
    expect(body.match(/recordAgentToolCall\([^)]*\)/)[0]).not.toContain('also');
    expect(body.match(/recordForAlreadyShown\(shownSpans/)).not.toBeNull();
  });
});

// Agents pass `-k N` (and `--in <file>`) to every ss-* tool by habit; ss-semantic rejected `-k`
// with its usage text (2 Codex calls, TRACES-rules3). ss-semantic maps -k to its topK (the
// ranked chunks its spans come from); ss-read and ss-trace take -k and ignore it; ss-semantic
// and ss-read take `--in <file>` as the file.
describe('ss-* flag habits: -k and --in', () => {
  function setupFourFunctions() {
    TMP = realpathSync(TMP);
    mkdirSync(path.join(TMP, 'src'), { recursive: true });
    const lines = [];
    const entities = ['alpha', 'beta', 'gamma', 'delta'].map((name, i) => {
      const start = i * 40 + 1;
      lines.push(`function f${i}() {`, '  token token token', '  return 1;', '}', ...Array(36).fill(''));
      addChunk(`f${i}`, start, start + 3, `f${i}`, 'function');
      return ent(name, 'function', start, start + 3);
    });
    writeFileSync(path.join(TMP, 'src/a.js'), lines.join('\n'));
    writeGraph(entities);
    const db = new Database(path.join(TMP, '.sweet-search/codebase.db'));
    db.exec("CREATE TABLE vectors (file_path TEXT, epoch_retired INTEGER); INSERT INTO vectors VALUES ('src/a.js', NULL)");
    db.close();
  }

  const run = async (tool, args, socketPath = path.join(TMP, 'none.sock')) => {
    const response = await buildAgentToolDaemonResponse({
      v: 1, tool, args, cwd: TMP, pid: process.pid,
      env: {
        SWEET_SEARCH_PROJECT_ROOT: TMP, SWEET_SEARCH_SOCKET_PATH: socketPath,
        SWEET_SEARCH_EXACT_REREAD_OMISSION: '0', SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
      },
    }, { isUnixSocket: true, isReady: () => true, searcher: { projectRoot: TMP } });
    expect(response.status).toBe(200);
    return JSON.parse(response.body);
  };
  const spans = (out) => out.stdout.split('\n').filter(l => /^## \d+-\d+/.test(l)).length;

  it('ss-semantic: -k N sets the ranked-chunk count, -kN and --top too; no usage error', async () => {
    setupFourFunctions();
    const all = await run('semantic', ['src/a.js', 'token', '--max-tokens', '400']);
    expect(all.code).toBe(0);
    expect(spans(all)).toBe(4);
    for (const k of [['-k', '1'], ['-k1'], ['--top', '1']]) {
      const one = await run('semantic', ['src/a.js', 'token', ...k, '--max-tokens', '400']);
      expect(one.code, k.join(' ')).toBe(0);
      expect(one.stderr).not.toContain('Usage');
      expect(spans(one), k.join(' ')).toBe(1);
    }
    const bad = await run('semantic', ['src/a.js', 'token', '-k', 'x']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('-k must be an integer');
  });

  it('ss-semantic: -k reaches the warm daemon as topK', async () => {
    setupFourFunctions();
    const socketPath = path.join(TMP, 'tool.sock');
    const requests = [];
    const server = http.createServer(async (req, res) => {
      requests.push(req.url);
      const response = await buildReadSemanticDaemonResponse(req.url, {
        isUnixSocket: true, serverReady: true, searcher: { projectRoot: TMP },
      });
      res.writeHead(response.status, { 'Content-Type': response.contentType });
      res.end(response.body);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    try {
      const warm = await run('semantic', ['src/a.js', 'token', '-k', '2', '--max-tokens', '400'], socketPath);
      expect(warm.code).toBe(0);
      expect(new URLSearchParams(requests[0].split('?')[1]).get('topK')).toBe('2');
      expect(spans(warm)).toBe(2);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('ss-semantic: "<question>" --in <file> is the positional form', async () => {
    setupFourFunctions();
    const positional = await run('semantic', ['src/a.js', 'token', '--max-tokens', '400']);
    const scoped = await run('semantic', ['token', '--in', 'src/a.js', '--max-tokens', '400']);
    expect(scoped).toEqual(positional);
    const twice = await run('semantic', ['src/a.js', 'token', '--in', 'src/a.js']);
    expect(twice.code).toBe(2);
  });

  it('ss-read and ss-trace accept -k (ignored); ss-read takes --in <file>', async () => {
    setupFourFunctions();
    const read = await run('read', ['src/a.js', '1', '3']);
    expect(read.code).toBe(0);
    expect(await run('read', ['src/a.js', '1', '3', '-k', '5'])).toEqual(read);
    expect(await run('read', ['-k5', 'src/a.js', '1', '3'])).toEqual(read);
    expect(await run('read', ['--in', 'src/a.js', '1', '3'])).toEqual(read);
    const trace = await run('trace', ['f0']);
    const traceK = await run('trace', ['f0', '-k', '5']);
    expect(traceK).toEqual(trace);
    expect(traceK.stderr).not.toContain('unrecognised');
  });
});
