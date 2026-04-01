/**
 * Vocabulary Miner Utilities Unit Tests
 *
 * Tests for all exports from core/vocab-miner-utils.js.
 * Pure-function tests — no SweetSearch instance or mocking needed (except walkShallow).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  STOP_WORDS,
  SOURCE_EXTENSIONS,
  splitIdentifier,
  addTerm,
  mergeTerms,
  termsToArray,
  walkShallow,
} from '../../core/vocabulary/index.js';

// ---------------------------------------------------------------------------
// STOP_WORDS
// ---------------------------------------------------------------------------

describe('STOP_WORDS', () => {
  it('is a Set', () => {
    expect(STOP_WORDS).toBeInstanceOf(Set);
  });

  it('contains common English stop words', () => {
    expect(STOP_WORDS.has('the')).toBe(true);
    expect(STOP_WORDS.has('is')).toBe(true);
    expect(STOP_WORDS.has('a')).toBe(true);
    expect(STOP_WORDS.has('and')).toBe(true);
  });

  it('contains code stop words', () => {
    expect(STOP_WORDS.has('function')).toBe(true);
    expect(STOP_WORDS.has('import')).toBe(true);
    expect(STOP_WORDS.has('const')).toBe(true);
    expect(STOP_WORDS.has('return')).toBe(true);
    expect(STOP_WORDS.has('class')).toBe(true);
  });

  it('does not contain domain-specific terms', () => {
    expect(STOP_WORDS.has('user')).toBe(false);
    expect(STOP_WORDS.has('search')).toBe(false);
    expect(STOP_WORDS.has('database')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SOURCE_EXTENSIONS
// ---------------------------------------------------------------------------

describe('SOURCE_EXTENSIONS', () => {
  it('is a Set', () => {
    expect(SOURCE_EXTENSIONS).toBeInstanceOf(Set);
  });

  it('contains JavaScript extensions', () => {
    expect(SOURCE_EXTENSIONS.has('.js')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.jsx')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.mjs')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.cjs')).toBe(true);
  });

  it('contains TypeScript extensions', () => {
    expect(SOURCE_EXTENSIONS.has('.ts')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.tsx')).toBe(true);
  });

  it('contains Python, Go, Rust extensions', () => {
    expect(SOURCE_EXTENSIONS.has('.py')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.go')).toBe(true);
    expect(SOURCE_EXTENSIONS.has('.rs')).toBe(true);
  });

  it('does not contain non-source extensions', () => {
    expect(SOURCE_EXTENSIONS.has('.md')).toBe(false);
    expect(SOURCE_EXTENSIONS.has('.json')).toBe(false);
    expect(SOURCE_EXTENSIONS.has('.txt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// splitIdentifier
// ---------------------------------------------------------------------------

describe('splitIdentifier', () => {
  it('splits camelCase', () => {
    expect(splitIdentifier('getUserData')).toEqual(['get', 'user', 'data']);
  });

  it('splits PascalCase', () => {
    expect(splitIdentifier('UserService')).toEqual(['user', 'service']);
  });

  it('splits snake_case', () => {
    expect(splitIdentifier('http_server_utils')).toEqual(['http', 'server', 'utils']);
  });

  it('splits SCREAMING_SNAKE_CASE', () => {
    expect(splitIdentifier('MAX_RETRY_COUNT')).toEqual(['max', 'retry', 'count']);
  });

  it('splits kebab-case', () => {
    expect(splitIdentifier('my-component-name')).toEqual(['my', 'component', 'name']);
  });

  it('handles digit to uppercase transition', () => {
    // Regex chain: /([0-9])([A-Z])/g splits '2D' → '2 D', then /([A-Z]+)([A-Z][a-z])/g
    // already split 'DArray' → 'D Array'. The digit stays attached to the preceding word
    // because there is no lowercase→digit split rule. This is expected regex behavior.
    expect(splitIdentifier('get2DArray')).toEqual(['get2', 'd', 'array']);
  });

  it('handles acronym followed by word', () => {
    expect(splitIdentifier('XMLParser')).toEqual(['xml', 'parser']);
  });

  it('returns empty array for null/undefined', () => {
    expect(splitIdentifier(null)).toEqual([]);
    expect(splitIdentifier(undefined)).toEqual([]);
  });

  it('returns empty string lowercased for empty string', () => {
    expect(splitIdentifier('')).toEqual([]);
  });

  it('returns single char lowercased', () => {
    expect(splitIdentifier('A')).toEqual(['a']);
  });

  it('handles dot-separated paths', () => {
    expect(splitIdentifier('com.example.App')).toEqual(['com', 'example', 'app']);
  });
});

// ---------------------------------------------------------------------------
// addTerm
// ---------------------------------------------------------------------------

describe('addTerm', () => {
  let terms;

  beforeEach(() => {
    terms = new Map();
  });

  it('adds a new term', () => {
    addTerm(terms, 'UserService', 5.0, 'structural');
    expect(terms.has('userservice')).toBe(true);
    expect(terms.get('userservice').score).toBe(5.0);
    expect(terms.get('userservice').source).toBe('structural');
  });

  it('updates score if new score is higher', () => {
    addTerm(terms, 'getData', 3.0, 'symbol');
    addTerm(terms, 'getData', 5.0, 'pagerank');
    expect(terms.get('getdata').score).toBe(5.0);
    expect(terms.get('getdata').source).toBe('pagerank');
  });

  it('does not update if new score is lower', () => {
    addTerm(terms, 'getData', 5.0, 'pagerank');
    addTerm(terms, 'getData', 3.0, 'symbol');
    expect(terms.get('getdata').score).toBe(5.0);
    expect(terms.get('getdata').source).toBe('pagerank');
  });

  it('ignores null/empty/single-char terms', () => {
    addTerm(terms, null, 5.0, 'test');
    addTerm(terms, '', 5.0, 'test');
    addTerm(terms, 'a', 5.0, 'test');
    expect(terms.size).toBe(0);
  });

  it('preserves original casing from first addition', () => {
    addTerm(terms, 'UserService', 5.0, 'structural');
    // Second add with higher score overwrites source/score but first term casing was kept
    // Actually, looking at the code: if existing && existing.score < score, it sets term to existing?.term || term
    // So on first add, term = existing?.term (undefined) || term = 'UserService'
    // On update with higher score, term = existing.term ('UserService') || term
    expect(terms.get('userservice').term).toBe('UserService');
  });

  it('accepts NaN score on first add (no comparison)', () => {
    addTerm(terms, 'weirdTerm', NaN, 'test');
    expect(terms.has('weirdterm')).toBe(true);
    expect(isNaN(terms.get('weirdterm').score)).toBe(true);
  });

  it('NaN score blocks future valid updates (NaN < N is false)', () => {
    addTerm(terms, 'stuck', NaN, 'first');
    addTerm(terms, 'stuck', 5.0, 'second');
    // existing.score (NaN) < 5.0 => false, so update is skipped
    expect(isNaN(terms.get('stuck').score)).toBe(true);
    expect(terms.get('stuck').source).toBe('first');
  });

  it('accepts Infinity score', () => {
    addTerm(terms, 'bigTerm', Infinity, 'test');
    expect(terms.get('bigterm').score).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// mergeTerms
// ---------------------------------------------------------------------------

describe('mergeTerms', () => {
  it('merges an array of term objects into a map', () => {
    const target = new Map();
    const source = [
      { term: 'foo', score: 3.0, source: 'symbol' },
      { term: 'bar', score: 5.0, source: 'structural' },
    ];

    mergeTerms(target, source);
    expect(target.size).toBe(2);
    expect(target.get('foo').score).toBe(3.0);
    expect(target.get('bar').score).toBe(5.0);
  });

  it('keeps higher score on conflict', () => {
    const target = new Map();
    addTerm(target, 'foo', 10.0, 'existing');

    const source = [
      { term: 'foo', score: 5.0, source: 'new' },
    ];

    mergeTerms(target, source);
    expect(target.get('foo').score).toBe(10.0);
  });

  it('handles empty source array', () => {
    const target = new Map();
    mergeTerms(target, []);
    expect(target.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// termsToArray
// ---------------------------------------------------------------------------

describe('termsToArray', () => {
  it('converts Map to sorted array (highest score first)', () => {
    const terms = new Map();
    addTerm(terms, 'low', 1.0, 'a');
    addTerm(terms, 'high', 10.0, 'b');
    addTerm(terms, 'mid', 5.0, 'c');

    const arr = termsToArray(terms);
    expect(arr).toHaveLength(3);
    expect(arr[0].score).toBe(10.0);
    expect(arr[1].score).toBe(5.0);
    expect(arr[2].score).toBe(1.0);
  });

  it('returns empty array for empty map', () => {
    expect(termsToArray(new Map())).toEqual([]);
  });

  it('each element has term, score, source', () => {
    const terms = new Map();
    addTerm(terms, 'hello', 3.0, 'test');
    const arr = termsToArray(terms);
    expect(arr[0]).toHaveProperty('term');
    expect(arr[0]).toHaveProperty('score');
    expect(arr[0]).toHaveProperty('source');
  });

  it('handles tied scores without crashing', () => {
    const terms = new Map();
    addTerm(terms, 'alpha', 5.0, 'a');
    addTerm(terms, 'bravo', 5.0, 'b');
    addTerm(terms, 'charlie', 5.0, 'c');
    const arr = termsToArray(terms);
    expect(arr).toHaveLength(3);
    // All scores equal — sort is stable in V8, but we only verify no crash + correct length
    arr.forEach(item => expect(item.score).toBe(5.0));
  });
});

// ---------------------------------------------------------------------------
// walkShallow
// ---------------------------------------------------------------------------

describe('walkShallow', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'walk-shallow-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds files in root directory', () => {
    writeFileSync(join(tmpDir, 'foo.js'), '');
    writeFileSync(join(tmpDir, 'bar.ts'), '');

    const files = walkShallow(tmpDir, 2);
    expect(files).toHaveLength(2);
    expect(files.some(f => f.endsWith('foo.js'))).toBe(true);
    expect(files.some(f => f.endsWith('bar.ts'))).toBe(true);
  });

  it('recurses into subdirectories up to maxDepth', () => {
    mkdirSync(join(tmpDir, 'sub'));
    writeFileSync(join(tmpDir, 'sub', 'deep.js'), '');

    const files = walkShallow(tmpDir, 2);
    expect(files.some(f => f.endsWith('deep.js'))).toBe(true);
  });

  it('stops at maxDepth', () => {
    mkdirSync(join(tmpDir, 'a'));
    mkdirSync(join(tmpDir, 'a', 'b'));
    writeFileSync(join(tmpDir, 'a', 'b', 'deep.js'), '');

    // maxDepth=1 means only root level (depth=0) is traversed, not subdirs
    const files = walkShallow(tmpDir, 1);
    expect(files.some(f => f.endsWith('deep.js'))).toBe(false);
  });

  it('skips node_modules', () => {
    mkdirSync(join(tmpDir, 'node_modules'));
    writeFileSync(join(tmpDir, 'node_modules', 'pkg.js'), '');

    const files = walkShallow(tmpDir, 2);
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
  });

  it('skips .git directory', () => {
    mkdirSync(join(tmpDir, '.git'));
    writeFileSync(join(tmpDir, '.git', 'config'), '');

    // .git starts with '.' and depth > 0 when inside, so skipped by hidden dir filter
    const files = walkShallow(tmpDir, 2);
    // At depth 0, .git is NOT skipped by the dot check (depth > 0 condition)
    // But .git IS in SKIP_DIRS
    expect(files.some(f => f.includes('.git'))).toBe(false);
  });

  it('returns empty array for nonexistent directory', () => {
    const files = walkShallow('/nonexistent/path/xyz', 2);
    expect(files).toEqual([]);
  });

  it('returns empty array when maxDepth is 0', () => {
    writeFileSync(join(tmpDir, 'file.js'), '');
    const files = walkShallow(tmpDir, 0);
    expect(files).toEqual([]);
  });
});
