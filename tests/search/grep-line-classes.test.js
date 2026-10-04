/**
 * SS_FIX_GREP_LINES: which stored matches a file shows when it gets fewer lines than it has.
 * Classes come from code-graph entities (declaration 0, inside a symbol 1, outside 2); the
 * renderer shows the lowest (class, line) matches in line order, and rows without a class keep
 * the shipped prefix byte for byte. SS_FIX_GREP_LINE_SPREAD: one line per enclosing symbol first.
 */
import { describe, expect, it } from 'vitest';

import {
  classifyGrepLines,
  entityShortName,
  isCommentLine,
  nameOnLine,
  selectGrepLinesByClass,
  stampGrepLineClasses,
} from '../../core/search/grep-line-classes.js';
import { applyGrepFileDiversity, renderGrepBody } from '../../core/search/grep-output-shaping.js';

const ENTITIES = [
  { name: 'Server', startLine: 10, endLine: 40 },
  { name: 'Server.commit', startLine: 20, endLine: 30 },
  { name: 'helper', startLine: 50, endLine: 52 },
];

describe('nameOnLine / entityShortName', () => {
  it('whole identifier only', () => {
    expect(nameOnLine('commit', 'func (s *Server) commit(ctx)')).toBe(true);
    expect(nameOnLine('commit', 'func (s *Server) commitAll(ctx)')).toBe(false);
    expect(nameOnLine('commit', 'precommit := 1; commit()')).toBe(true);
    expect(nameOnLine('commit', '')).toBe(false);
    expect(nameOnLine('', 'commit')).toBe(false);
  });

  it('the last component of a qualified name', () => {
    expect(entityShortName('Oracle.hasConflict')).toBe('hasConflict');
    expect(entityShortName('a::b::c')).toBe('c');
    expect(entityShortName('Foo#bar')).toBe('bar');
    expect(entityShortName('plain')).toBe('plain');
  });
});

describe('classifyGrepLines', () => {
  it('declaration = start line or up to 3 lines after it, with the name on THAT line', () => {
    const rows = [
      { line: 1, text: 'import "server"' },          // outside every span
      { line: 10, text: 'type Server struct {' },     // declaration of Server
      { line: 12, text: '  commit bool' },           // inside Server, Server starts 2 lines up but name absent
      { line: 13, text: '  Server *Server' },        // Server's name within 3 lines of its start
      { line: 14, text: '  Server' },                // 4 lines after start: inside, not a declaration
      { line: 21, text: '// commit commits' },        // commit starts at 20, name on line 21
      { line: 25, text: 'x := commit' },             // inside commit, 5 lines after start
      { line: 45, text: 'server := 1' },             // outside (Server ends at 40)
      { line: 52, text: 'return helper()' },         // helper starts at 50: within 3, name present
    ];
    expect(classifyGrepLines(rows, ENTITIES)).toEqual([2, 0, 1, 0, 1, 0, 1, 2, 0]);
  });

  it('no entities: everything outside', () => {
    expect(classifyGrepLines([{ line: 3, text: 'x' }], [])).toEqual([2]);
  });

  it('nested spans: inside the outer span after the inner one ends', () => {
    expect(classifyGrepLines([{ line: 35, text: 'y' }], ENTITIES)).toEqual([1]);
  });

  it('symbolsOut: the innermost open symbol per row (index into the entities), -1 outside', () => {
    const rows = [1, 10, 25, 35, 45, 51].map(line => ({ line, text: '' }));
    const symbols = new Array(rows.length);
    const classes = classifyGrepLines(rows, ENTITIES, symbols);
    // Server 0 (10-40) holds commit 1 (20-30); helper 2 (50-52)
    expect(symbols).toEqual([-1, 0, 1, 0, -1, 2]);
    expect(classes).toEqual(classifyGrepLines(rows, ENTITIES));   // classes unchanged
  });

  it('symbolsOut: a sibling that ended under an open symbol is never reported', () => {
    const ents = [
      { name: 'Outer', startLine: 1, endLine: 100 },
      { name: 'a', startLine: 10, endLine: 20 },
      { name: 'b', startLine: 30, endLine: 40 },
    ];
    const symbols = [];
    classifyGrepLines([15, 25, 35, 45].map(line => ({ line, text: '' })), ents, symbols);
    expect(symbols).toEqual([1, 0, 2, 0]);
  });
});

describe('selectGrepLinesByClass', () => {
  const ms = [
    { line: 1, lineClass: 2 }, { line: 3, lineClass: 2 }, { line: 10, lineClass: 0 },
    { line: 15, lineClass: 1 }, { line: 20, lineClass: 0 }, { line: 33, lineClass: 1 },
  ];

  it('declarations first, then inside, then outside; picks return in line order', () => {
    expect(selectGrepLinesByClass(ms, 1)).toEqual([2]);
    expect(selectGrepLinesByClass(ms, 2)).toEqual([2, 4]);
    expect(selectGrepLinesByClass(ms, 3)).toEqual([2, 3, 4]);
    expect(selectGrepLinesByClass(ms, 5)).toEqual([0, 2, 3, 4, 5]);
  });

  it('null (keep the prefix) when every match fits or any row lacks a class', () => {
    expect(selectGrepLinesByClass(ms, 6)).toBeNull();
    expect(selectGrepLinesByClass([{ line: 1, lineClass: 0 }, { line: 2 }], 1)).toBeNull();
  });
});

describe('isCommentLine', () => {
  it('comment shapes by the first characters', () => {
    for (const t of ['// x', '  /// doc', '\t/* x', ' * body', '*/', '# python', '#', '  #\tx']) expect(isCommentLine(t)).toBe(true);
    for (const t of ['#include <x>', '#[derive(Debug)]', '#!/bin/sh', 'a // b', 'x = 2 * y', '/regex/', '', undefined]) {
      expect(isCommentLine(t)).toBe(false);
    }
  });
});

describe('selectGrepLinesByClass spread', () => {
  // r3hb-grdb-07, SerializedDatabase.swift: three hits in reentrantSync (symbol 1), one in
  // preconditionNoUnsafeTransactionLeft (symbol 2), an import outside every symbol.
  const ms = [
    { line: 3, lineClass: 2, lineSymbol: -1 },
    { line: 194, lineClass: 1, lineSymbol: 1 },
    { line: 207, lineClass: 1, lineSymbol: 1 },
    { line: 220, lineClass: 1, lineSymbol: 1 },
    { line: 304, lineClass: 1, lineSymbol: 2 },
  ];

  it('one line per symbol before a second line of any symbol', () => {
    expect(selectGrepLinesByClass(ms, 2)).toEqual([1, 2]);          // today: 194, 207
    expect(selectGrepLinesByClass(ms, 2, true)).toEqual([1, 4]);    // spread: 194, 304
    expect(selectGrepLinesByClass(ms, 3, true)).toEqual([1, 2, 4]);
  });

  it('lines outside every symbol stay last', () => {
    expect(selectGrepLinesByClass(ms, 4, true)).toEqual([1, 2, 3, 4]);
  });

  it('declarations still come first; a declaration takes its symbol\'s one slot', () => {
    const decl = [
      { line: 10, lineClass: 1, lineSymbol: 0 },
      { line: 20, lineClass: 0, lineSymbol: 1 },
      { line: 25, lineClass: 1, lineSymbol: 1 },
      { line: 40, lineClass: 1, lineSymbol: 2 },
    ];
    expect(selectGrepLinesByClass(decl, 3, true)).toEqual([0, 1, 3]);
  });

  it('a row without an integer lineSymbol, or spread off, gives the class order', () => {
    const partial = ms.map((m, j) => (j === 4 ? { line: m.line, lineClass: m.lineClass } : m));
    expect(selectGrepLinesByClass(partial, 2, true)).toEqual(selectGrepLinesByClass(partial, 2));
    expect(selectGrepLinesByClass(ms, 2, false)).toEqual([1, 2]);
  });

  it('a comment line never takes its symbol\'s slot (WALSnapshotTransaction.swift:54)', () => {
    const wal = [
      { line: 17, lineClass: 1, lineSymbol: 1, content: '  let x = reader.reentrantSync {' },
      { line: 25, lineClass: 1, lineSymbol: 1, content: '    return db.isInsideTransaction' },
      { line: 54, lineClass: 1, lineSymbol: 0, content: '    ///     release: { isInsideTransaction in' },
    ];
    expect(selectGrepLinesByClass(wal, 2, true)).toEqual([0, 1]);
  });

  it('repeated calls do not see each other\'s marks', () => {
    for (let i = 0; i < 3; i++) expect(selectGrepLinesByClass(ms, 2, true)).toEqual([1, 4]);
    const many = Array.from({ length: 300 }, (_, j) => ({ line: j + 1, lineClass: 1, lineSymbol: j % 3 }));
    expect(selectGrepLinesByClass(many, 4, true)).toEqual([0, 1, 2, 3]);
    expect(selectGrepLinesByClass(ms, 2, true)).toEqual([1, 4]);
  });
});

describe('stampGrepLineClasses', () => {
  const rows = () => [
    { file: 'a.go', line: 1, content: 'package a' },
    { file: 'a.go', line: 20, content: 'func (s *Server) commit() {' },
    { file: 'b.go', line: 5, content: 'only one row' },
    { file: 'c.go', line: 2, content: 'x' },
    { file: 'c.go', line: 9, content: 'y' },
  ];

  it('stamps fresh indexed files with more than one row; leaves the rest unstamped', () => {
    const results = rows();
    const looked = [];
    const stats = stampGrepLineClasses(results, {
      entitiesInFile: (f) => { looked.push(f); return f === 'a.go' ? ENTITIES : []; },
      isFresh: () => true,
    });
    expect(results.map(r => r.lineClass)).toEqual([2, 0, undefined, undefined, undefined]);
    expect(results.map(r => r.lineSymbol)).toEqual([-1, 1, undefined, undefined, undefined]);
    expect(looked).toEqual(['a.go', 'c.go']);   // b.go has one row: no lookup
    expect(stats).toEqual({ files: 2, stamped: 1 });
  });

  it('a stale file is never looked up and keeps the prefix', () => {
    const results = rows();
    const looked = [];
    stampGrepLineClasses(results, {
      entitiesInFile: (f) => { looked.push(f); return ENTITIES; },
      isFresh: f => f !== 'a.go',
    });
    expect(looked).toEqual(['c.go']);
    expect(results[0].lineClass).toBeUndefined();
    expect(results[1].lineClass).toBeUndefined();
  });

  it('a graph read that throws keeps the prefix (fail open)', () => {
    const results = rows();
    stampGrepLineClasses(results, { entitiesInFile: () => { throw new Error('locked'); }, isFresh: () => true });
    expect(results.every(r => r.lineClass === undefined)).toBe(true);
  });
});

describe('renderGrepBody lineClasses', () => {
  // One file with 6 stored matches: import, package, header comment, then two declarations
  // and one usage. The shipped prefix shows the first three.
  const FILE = [
    { line: 1, text: 'package export', cls: 2 },
    { line: 3, text: 'import "export/x"', cls: 2 },
    { line: 5, text: '// export helpers', cls: 2 },
    { line: 10, text: 'func Export() {', cls: 0 },
    { line: 14, text: '  export(x)', cls: 1 },
    { line: 30, text: 'func ExportAll() {', cls: 0 },
  ];
  const matches = (withClass) => [
    ...FILE.map(r => ({ file: 'a/export.go', line: r.line, column: 1, matchText: r.text, content: r.text,
      ...(withClass ? { lineClass: r.cls } : {}) })),
    { file: 'b.go', line: 2, column: 1, matchText: 'export', content: 'export', ...(withClass ? { lineClass: 2 } : {}) },
  ];
  const render = (withClass, opts, k = 4) => {
    const { kept, fileSummary } = applyGrepFileDiversity(matches(withClass), { perFileCap: k, maxFiles: k, order: 'weight' });
    return renderGrepBody(kept, fileSummary, k, { alloc: 'weight', ...opts });
  };

  it('declarations first, outside-span last, printed in line order; the marker stays on the last printed line', () => {
    const body = render(true, { lineClasses: true });
    // k = 4, perFileCap 4: a/export.go stores lines 1, 3, 5, 10 and gets 3 lines (sqrt(6) vs 1);
    // the declaration at 10 displaces the header comment at 5
    expect(body.lines).toEqual([
      'a/export.go:1: package export',
      'a/export.go:3: import "export/x"',
      'a/export.go:10: func Export() { (+3 more in this file)',
      'b.go:2: export',
    ]);
    expect(render(true, {}).lines[2]).toBe('a/export.go:5: // export helpers (+3 more in this file)');
    // k = 6: every match stored, 5 lines; the last outside-span line (5) is the one left out
    const wide = render(true, { lineClasses: true }, 6);
    expect(wide.lines.filter(l => l.startsWith('a/export.go'))).toEqual([
      'a/export.go:1: package export',
      'a/export.go:3: import "export/x"',
      'a/export.go:10: func Export() {',
      'a/export.go:14: export(x)',
      'a/export.go:30: func ExportAll() { (+1 more in this file)',
    ]);
    expect(wide.truncatedFileCount).toBe(1);
  });

  it('rows without a class, or the switch off, keep the shipped prefix byte for byte', () => {
    for (const k of [2, 4, 6, 10]) {
      expect(render(false, { lineClasses: true }, k)).toEqual(render(false, {}, k));
      expect(render(true, {}, k)).toEqual(render(false, {}, k));
    }
  });

  it('lineSpread without symbols on the rows changes nothing', () => {
    for (const k of [2, 4, 6, 10]) {
      expect(render(true, { lineClasses: true, lineSpread: true }, k)).toEqual(render(true, { lineClasses: true }, k));
    }
  });
});

describe('renderGrepBody lineSpread', () => {
  // One file, 6 stored matches: three in run() (symbol 0), one in stop() (symbol 1), two imports.
  const FILE = [
    { line: 1, text: 'import "run"', cls: 2, sym: -1 },
    { line: 10, text: 'func run() {', cls: 0, sym: 0 },
    { line: 12, text: '  run(a)', cls: 1, sym: 0 },
    { line: 14, text: '  run(b)', cls: 1, sym: 0 },
    { line: 30, text: '  run(c) // in stop', cls: 1, sym: 1 },
    { line: 40, text: 'import "run2"', cls: 2, sym: -1 },
  ];
  const kept = FILE.map(r => ({ file: 'x.go', line: r.line, column: 1, matchText: r.text, content: r.text, lineClass: r.cls, lineSymbol: r.sym }));
  const render = (opts, k) => {
    const d = applyGrepFileDiversity(kept.map(m => ({ ...m })), { perFileCap: 6, maxFiles: 6, order: 'weight' });
    return renderGrepBody(d.kept, d.fileSummary, k, { alloc: 'weight', lineClasses: true, ...opts }).lines;
  };

  it('two lines: the declaration of run() and the hit in stop(), not two lines of run()', () => {
    expect(render({}, 2)).toEqual(['x.go:10: func run() {', 'x.go:12: run(a) (+4 more in this file)']);
    expect(render({ lineSpread: true }, 2)).toEqual(['x.go:10: func run() {', 'x.go:30: run(c) // in stop (+4 more in this file)']);
  });
});
