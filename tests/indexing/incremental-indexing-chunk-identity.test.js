/**
 * Tests for core/incremental-indexing/domain/chunk-identity.mjs
 *
 * Covers the six chunk-identity invariants from plan § 33:
 *   1. Whitespace-only edit → all IDs stable.
 *   2. Top-of-file insertion → all unchanged IDs stable.
 *   3. Rename one symbol → only that one ID flips.
 *   4. Two identical anonymous siblings → distinct via occurrence index.
 *   5. Rename one of two identical → surviving sibling occ index shifts
 *      `_1 → _0` (the known acceptable degradation).
 *   6. Delete one distinct sibling → surviving ID stable.
 */

import { describe, it, expect } from 'vitest';
import {
  assignStructuralIds,
  deriveStructuralId,
  normalizeSignature,
  normalizeAnonymousContent,
  __testing,
} from '../../core/incremental-indexing/domain/chunk-identity.mjs';

const { parentSymbolPath, isSymbolAttached } = __testing;

function symbolChunk(name, signature, content = '/* body */') {
  return {
    content,
    metadata: { chunk_type: 'function', symbol: name, signature },
  };
}
function anonymousChunk(parent, content) {
  return {
    content,
    metadata: { chunk_type: 'code', parent_symbol: parent },
  };
}

describe('chunk-identity / pure helpers', () => {
  it('normalizeSignature collapses whitespace and drops trailing brace', () => {
    expect(normalizeSignature('function  foo(x) {')).toBe('function foo(x)');
    expect(normalizeSignature('function foo(x){')).toBe('function foo(x)');
    expect(normalizeSignature('  function   foo(x)   ')).toBe('function foo(x)');
  });

  it('normalizeAnonymousContent drops blank lines and trims', () => {
    const raw = '\n\nconsole.log(1);\n\n\nconsole.log(2);  \n';
    expect(normalizeAnonymousContent(raw)).toBe('console.log(1);\nconsole.log(2);');
  });

  it('parentSymbolPath prefers explicit parent_path over reconstructed', () => {
    expect(parentSymbolPath({ parent_path: 'module:Foo/class:Foo' }))
      .toBe('module:Foo/class:Foo');
    expect(parentSymbolPath({ parent_symbol: 'Foo', parent_type: 'class' }))
      .toBe('class:Foo');
    expect(parentSymbolPath({})).toBe('');
  });

  it('isSymbolAttached only flags real symbols', () => {
    expect(isSymbolAttached(symbolChunk('foo', 'fn foo()'))).toBe(true);
    expect(isSymbolAttached(anonymousChunk('main', 'x = 1;'))).toBe(false);
    expect(isSymbolAttached({ metadata: { chunk_type: 'function', symbol: 'unknown' } }))
      .toBe(false);
  });
});

describe('chunk-identity / six structural invariants', () => {
  it('1. whitespace-only edits (indent / trailing spaces / blank lines) keep every ID stable', () => {
    const a = [
      symbolChunk('foo', 'function foo(x) {'),
      symbolChunk('bar', 'function bar(y) {'),
      anonymousChunk('main', '  console.log(1);\n  doWork();\n'),
    ];
    const b = [
      symbolChunk('foo', 'function foo(x){'),       // no space before {
      symbolChunk('bar', 'function bar(y){'),
      // indent + trailing spaces + extra blank line
      anonymousChunk('main', '    console.log(1);   \n\n    doWork();\n'),
    ];
    const idsA = assignStructuralIds(a, 'src/a.js');
    const idsB = assignStructuralIds(b, 'src/a.js');
    expect(idsA[0].chunkStructId).toBe(idsB[0].chunkStructId);
    expect(idsA[1].chunkStructId).toBe(idsB[1].chunkStructId);
    expect(idsA[2].chunkStructId).toBe(idsB[2].chunkStructId);
  });

  it('2. inserting a new function at the top keeps every other ID stable', () => {
    const before = [
      symbolChunk('foo', 'function foo(x) {'),
      symbolChunk('bar', 'function bar(y) {'),
      anonymousChunk('main', 'console.log("hi");'),
    ];
    const after = [
      symbolChunk('NEW', 'function NEW(z) {'),
      symbolChunk('foo', 'function foo(x) {'),
      symbolChunk('bar', 'function bar(y) {'),
      anonymousChunk('main', 'console.log("hi");'),
    ];
    const idsBefore = assignStructuralIds(before, 'src/a.js');
    const idsAfter = assignStructuralIds(after, 'src/a.js');
    expect(idsAfter[0].chunkStructId).not.toBe(idsBefore[0].chunkStructId);
    expect(idsAfter[1].chunkStructId).toBe(idsBefore[0].chunkStructId);
    expect(idsAfter[2].chunkStructId).toBe(idsBefore[1].chunkStructId);
    expect(idsAfter[3].chunkStructId).toBe(idsBefore[2].chunkStructId);
  });

  it('3. renaming one function flips only that ID', () => {
    const before = [
      symbolChunk('foo', 'function foo(x) {'),
      symbolChunk('bar', 'function bar(y) {'),
    ];
    const after = [
      symbolChunk('fooRenamed', 'function fooRenamed(x) {'),
      symbolChunk('bar', 'function bar(y) {'),
    ];
    const idsBefore = assignStructuralIds(before, 'src/a.js');
    const idsAfter = assignStructuralIds(after, 'src/a.js');
    expect(idsAfter[0].chunkStructId).not.toBe(idsBefore[0].chunkStructId);
    expect(idsAfter[1].chunkStructId).toBe(idsBefore[1].chunkStructId);
  });

  it('4. two identical anonymous siblings are distinct via occurrence index', () => {
    const chunks = [
      anonymousChunk('doWork', 'if (err) return cb(err);'),
      anonymousChunk('doWork', 'if (err) return cb(err);'),
    ];
    const ids = assignStructuralIds(chunks, 'src/b.js');
    expect(ids[0].chunkStructId).not.toBe(ids[1].chunkStructId);
    expect(ids[0].occurrenceIndex).toBe(0);
    expect(ids[1].occurrenceIndex).toBe(1);
    expect(ids[0].chunkStructId.endsWith('_0')).toBe(true);
    expect(ids[1].chunkStructId.endsWith('_1')).toBe(true);
  });

  it('5. modifying one of two identical → surviving sibling shifts _1 → _0', () => {
    const before = [
      anonymousChunk('doWork', 'if (err) return cb(err);'),
      anonymousChunk('doWork', 'if (err) return cb(err);'),
    ];
    const after = [
      anonymousChunk('doWork', 'if (err) return cb(err);'),    // surviving
      anonymousChunk('doWork', 'if (err) throw new Error(err);'), // modified
    ];
    const idsBefore = assignStructuralIds(before, 'src/b.js');
    const idsAfter = assignStructuralIds(after, 'src/b.js');
    // surviving sibling now sits in a population of 1
    expect(idsAfter[0].occurrenceIndex).toBe(0);
    // its ID therefore equals "what before-position-0's prefix + _0" not before-position-1
    expect(idsAfter[0].chunkStructId).toBe(idsBefore[0].chunkStructId);
    // modified sibling is in a fresh population: occurrenceIndex 0, distinct ID
    expect(idsAfter[1].occurrenceIndex).toBe(0);
    expect(idsAfter[1].chunkStructId).not.toBe(idsBefore[1].chunkStructId);
    expect(idsAfter[1].chunkStructId).not.toBe(idsAfter[0].chunkStructId);
  });

  it('6. deleting one distinct anonymous sibling leaves the survivor stable', () => {
    const before = [
      anonymousChunk('main', 'console.log("start");'),
      anonymousChunk('main', 'doWork();'),
    ];
    const after = [
      anonymousChunk('main', 'console.log("start");'),
    ];
    const idsBefore = assignStructuralIds(before, 'src/c.js');
    const idsAfter = assignStructuralIds(after, 'src/c.js');
    expect(idsAfter[0].chunkStructId).toBe(idsBefore[0].chunkStructId);
  });
});

describe('chunk-identity / deriveStructuralId edge cases', () => {
  it('falls back when an anonymous chunk lacks an occurrence index', () => {
    const out = deriveStructuralId(anonymousChunk('main', 'x = 1;'), 'src/d.js', null);
    expect(out.structural).toBe(false);
    expect(out.reason).toBe('fallback');
  });

  it('still emits a structural ID for symbol-attached chunks with no signature', () => {
    const out = deriveStructuralId(
      { content: '', metadata: { chunk_type: 'function', symbol: 'mystery' } },
      'src/e.js',
      null,
    );
    expect(out.structural).toBe(true);
    expect(out.reason).toBe('symbol');
    expect(out.chunkStructId).toMatch(/^[a-f0-9]+$/);
  });

  it('falls back on missing chunk or filePath', () => {
    expect(deriveStructuralId(null, 'src/x.js', 0).structural).toBe(false);
    expect(deriveStructuralId(anonymousChunk('p', 'x;'), null, 0).structural).toBe(false);
  });
});
