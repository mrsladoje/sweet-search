/**
 * Edge case and negative tests for AST chunker
 *
 * Tests boundary conditions, false positive rejection, and parser robustness:
 * 1. Braces in strings (shouldn't affect depth tracking)
 * 2. Nested classes (should produce separate chunks)
 * 3. Comments containing patterns (shouldn't be matched)
 * 4. Empty/minimal files
 * 5. False positive rejection (keywords in non-boundary positions)
 * 6. 30-char chunk threshold boundary
 * 7. Multi-line signatures
 * 8. Decorators/attributes before definitions
 * 9. Comment-only files
 */

import { describe, it, expect } from 'vitest';
import { ASTChunker } from '../../ast-chunker.js';
import GraphExtractor from '../../core/graph/graph-extractor.js';

const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });
const extractor = new GraphExtractor({ projectRoot: '/test' });

// =============================================================================
// Brace depth tracking with braces inside strings/comments
// =============================================================================

describe('brace-based depth tracking', () => {
  it('correctly ignores unbalanced string braces', async () => {
    // String "open { only" has 1 unbalanced open brace.
    // Without stripping, braceDepth would be 2 after line 1, and the
    // closing } on line 3 would only bring depth to 1, never closing the chunk.
    const chunks = await chunker.parseFile('/test/format.js', [
      'function formatJson(obj) {',
      '  let template = "open { only";',
      '  return template + obj.name;',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('formatJson');
  });

  it('handles consecutive closing braces', async () => {
    const chunks = await chunker.parseFile('/test/nested.js', [
      'class Outer {',
      '  inner() {',
      '    if (true) {',
      '      return { value: 42, extra: "data" };',
      '    }',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    const summary = chunks.map(c => c.metadata.chunk_type);
    expect(summary).toContain('class');
  });
});

// =============================================================================
// _stripNonCode unit tests — directly verify the scanner output
// =============================================================================

describe('_stripNonCode scanner', () => {
  const jsComment = { line: '//', block: ['/*', '*/'] };
  const goComment = { line: '//', block: ['/*', '*/'] };
  const shellComment = { line: '#', block: null };

  it('strips double-quoted string content', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('let s = "{ open";', state, jsComment, true);
    expect(result).toBe('let s = ;');
  });

  it('strips single-quoted string content', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode("let s = '} close';", state, jsComment, true);
    expect(result).toBe('let s = ;');
  });

  it('handles escaped quotes inside strings', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('let s = "say \\"{ hi";', state, jsComment, true);
    expect(result).toBe('let s = ;');
  });

  it('strips line comment after code', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('code(); // { comment', state, jsComment, true);
    expect(result).toBe('code(); ');
  });

  it('strips inline block comment', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('a /* { } { */ b', state, jsComment, true);
    expect(result).toBe('a  b');
  });

  it('tracks block comment across lines', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const r1 = chunker._stripNonCode('a /* { start', state, jsComment, true);
    expect(r1).toBe('a ');
    expect(state.inBlockComment).toBe(true);
    const r2 = chunker._stripNonCode('  still { comment */ b', state, jsComment, true);
    expect(r2).toBe(' b');
    expect(state.inBlockComment).toBe(false);
  });

  it('strips JS template literal body, keeps interpolation code', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('let x = `text ${ val }`;', state, jsComment, true);
    // backtick body "text " stripped; ${ and } are interp delimiters (stripped);
    // " val " is code inside interpolation (emitted); backtick close; ;
    expect(result).toBe('let x =  val ;');
  });

  it('strips template literal but keeps structural braces in interpolation', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('let x = `${arr.map(v => { return v; })}`;', state, jsComment, true);
    // ${ stripped, arr.map(v => { return v; }) emitted, } (interp close) stripped
    expect(result).toBe('let x = arr.map(v => { return v; });');
  });

  it('strips Go raw string (backtick, no interpolation)', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('s := `{ raw }`', state, goComment, false);
    expect(result).toBe('s := ');
  });

  it('tracks Go multi-line raw string across lines', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const r1 = chunker._stripNonCode('s := `{ start', state, goComment, false);
    expect(r1).toBe('s := ');
    expect(state.inTemplateLiteral).toBe(true);
    const r2 = chunker._stripNonCode('  still { raw` + rest', state, goComment, false);
    expect(r2).toBe(' + rest');
    expect(state.inTemplateLiteral).toBe(false);
  });

  it('strips shell line comment', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('code # { comment', state, shellComment, false);
    expect(result).toBe('code ');
  });

  it('handles null comment config (like JSON)', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('"key": "{value}"', state, null, false);
    // Strings stripped, no comments to handle
    expect(result).toBe(': ');
  });

  it('multiple strings on one line', () => {
    const state = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const result = chunker._stripNonCode('f("{", "}", "{")', state, jsComment, true);
    expect(result).toBe('f(, , )');
  });
});

// =============================================================================
// Integration: string/comment brace stripping in chunker
// =============================================================================

describe('string and comment aware brace counting (integration)', () => {
  // Each test uses TWO functions so that depth corruption in the first
  // would prevent the second from getting its own chunk. _pushFinalChunk
  // cannot save these — only correct stripping produces 2 separate chunks.

  it('string brace does not corrupt next function', async () => {
    const chunks = await chunker.parseFile('/test/str.js', [
      'function first() {',
      '  let s = "{ open";',
      '  return s;',
      '}',
      'function second() {',
      '  return 2;',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('first');
    expect(chunks[1].metadata.symbol).toBe('second');
    // Discriminating: without stripping, depth corruption causes first chunk
    // to extend past its } until the next boundary match, bleeding into second
    expect(chunks[0].text).not.toContain('function second');
  });

  it('line comment brace does not corrupt next function', async () => {
    const chunks = await chunker.parseFile('/test/lc.js', [
      'function first() { // extra {',
      '  return 1;',
      '}',
      'function second() {',
      '  return 2;',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('first');
    expect(chunks[1].metadata.symbol).toBe('second');
    expect(chunks[0].text).not.toContain('function second');
  });

  it('block comment brace does not corrupt next function', async () => {
    const chunks = await chunker.parseFile('/test/bc.js', [
      'function first() {',
      '  /* extra { */',
      '  return 1;',
      '}',
      'function second() {',
      '  return 2;',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('first');
    expect(chunks[1].metadata.symbol).toBe('second');
    expect(chunks[0].text).not.toContain('function second');
  });

  it('multi-line block comment brace does not corrupt next function', async () => {
    const chunks = await chunker.parseFile('/test/mbc.js', [
      'function first() {',
      '  /* {{{ unclosed',
      '  across lines */',
      '  return 1;',
      '}',
      'function second() {',
      '  return 2;',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('first');
    expect(chunks[1].metadata.symbol).toBe('second');
    expect(chunks[0].text).not.toContain('function second');
  });

  it('escaped-quote string brace does not corrupt next function', async () => {
    const chunks = await chunker.parseFile('/test/esc.js', [
      'function first() {',
      '  let s = "say \\"{ hi";',
      '  return s;',
      '}',
      'function second() {',
      '  return 2;',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('first');
    expect(chunks[1].metadata.symbol).toBe('second');
    expect(chunks[0].text).not.toContain('function second');
  });

  it('template literal brace does not corrupt next function', async () => {
    // Template text contains unbalanced { — without stripping, depth is corrupted
    const chunks = await chunker.parseFile('/test/tmpl.js', [
      'function first() {',
      '  let x = `text { ${ val }`;',
      '  return x;',
      '}',
      'function second() {',
      '  return 2;',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('first');
    expect(chunks[1].metadata.symbol).toBe('second');
    expect(chunks[0].text).not.toContain('function second');
  });

  it('Go raw string brace does not corrupt next function', async () => {
    const chunks = await chunker.parseFile('/test/raw.go', [
      'func first() {',
      '  s := `extra { here`',
      '  return s',
      '}',
      'func second() {',
      '  result := 2 + 1',
      '  return result',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('first');
    expect(chunks[1].metadata.symbol).toBe('second');
    expect(chunks[0].text).not.toContain('func second');
  });
});

// =============================================================================
// Nested classes
// =============================================================================

describe('nested classes', () => {
  it('chunks nested Java-style classes', async () => {
    const chunks = await chunker.parseFile('/test/Container.java', [
      'public class Container {',
      '  private String name = "container";',
      '  private int count = 0;',
      '',
      '  public class Inner {',
      '    private String value = "inner";',
      '    private int id = 1;',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('Container');
    expect(chunks[1].metadata.symbol).toBe('Inner');
  });
});

// =============================================================================
// Comments containing patterns
// =============================================================================

describe('comments and non-code patterns', () => {
  it('matches commented-out code as boundaries (known behavior)', async () => {
    // The chunker does NOT filter comments — it matches patterns on ALL lines.
    // This is a design trade-off for simplicity. Testing actual behavior.
    const chunks = await chunker.parseFile('/test/commented.py', [
      '# def old_function():',
      '#     return None',
      '#     print("old")',
      '',
      'def real_function():',
      '    return True',
      '    print("real")',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('real_function');
  });
});

// =============================================================================
// Empty and minimal files
// =============================================================================

describe('empty and minimal files', () => {
  it('returns empty for empty file', async () => {
    const chunks = await chunker.parseFile('/test/empty.js', '');
    expect(chunks).toEqual([]);
  });

  it('returns empty for file with only whitespace', async () => {
    const chunks = await chunker.parseFile('/test/blank.js', '   \n\n  \n');
    expect(chunks).toEqual([]);
  });

  it('returns empty for file under 30 chars with no patterns', async () => {
    const chunks = await chunker.parseFile('/test/tiny.js', 'const x = 1;');
    expect(chunks).toEqual([]);
  });

  it('returns generic chunk for unknown extensions', async () => {
    const chunks = await chunker.parseFile('/test/readme.xyz', [
      'This is a test file with unknown extension.',
      'It should fall through to generic chunking.',
      'Generic chunks use a 50-line sliding window.',
    ].join('\n'));
    // 133 chars > generic threshold of 20 → must produce a chunk
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.language).toBe('text');
    expect(chunks[0].metadata.chunk_type).toBe('code');
  });
});

// =============================================================================
// 30-char chunk threshold boundary
// =============================================================================

describe('chunk size threshold (> 30 chars, strict)', () => {
  it('drops chunk at exactly 30 trimmed chars (kills >= mutation)', async () => {
    // "func xx() {\n  return 1234567\n}" = exactly 30 trimmed chars.
    // With > 30: 30 > 30 is false → DROPPED.
    // If mutated to >= 30: 30 >= 30 is true → KEPT → test fails → mutation killed!
    const chunks = await chunker.parseFile('/test/boundary30.go', [
      'func xx() {',         // 11 chars
      '  return 1234567',    // 16 chars
      '}',                   // 1 char = 11+1+16+1+1 = 30
      'func keepMe() {',
      '  result := "this content is long enough to be kept easily by the chunker"',
      '  return result',
      '}',
    ].join('\n'));
    // First function (30 chars) should be dropped, only second kept
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('keepMe');
  });

  it('keeps chunk at exactly 31 trimmed chars (just above threshold)', async () => {
    // "func xx() {\n  return 12345678\n}" = exactly 31 trimmed chars.
    // 31 > 30 is true → KEPT.
    const chunks = await chunker.parseFile('/test/boundary31.go', [
      'func xx() {',          // 11 chars
      '  return 12345678',    // 17 chars
      '}',                    // 1 char = 11+1+17+1+1 = 31
      'func keepMe() {',
      '  result := "this content is long enough to be kept easily by the chunker"',
      '  return result',
      '}',
    ].join('\n'));
    // Both functions should be kept (31 > 30 and ~95 > 30)
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('xx');
    expect(chunks[1].metadata.symbol).toBe('keepMe');
  });

  it('keeps chunks well above 30 chars', async () => {
    const chunks = await chunker.parseFile('/test/big.go', [
      'func processLargeDataSet() {',
      '  var result = make([]string, 0, 100)',
      '  for i := 0; i < 100; i++ {',
      '    result = append(result, fmt.Sprintf("item-%d", i))',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('processLargeDataSet');
  });
});

// =============================================================================
// False positive rejection
// =============================================================================

describe('false positive rejection', () => {
  it('does not match keywords inside method bodies as boundaries', async () => {
    const chunks = await chunker.parseFile('/test/Logic.java', [
      'public class Logic {',
      '  public void process() {',
      '    String className = "not a class";',
      '    String interfaceName = "not an interface";',
      '    boolean result = true;',
      '  }',
      '}',
    ].join('\n'));
    // Only "Logic" should be a class boundary, not string contents
    const classChunks = chunks.filter(c =>
      c.metadata.chunk_type === 'class'
    );
    // "class" in strings won't match because the Java class pattern requires
    // modifiers like public/private/abstract and proper syntax
    expect(classChunks.every(c => c.metadata.symbol === 'Logic')).toBe(true);
  });

  it('does not match function calls as function definitions', async () => {
    const chunks = await chunker.parseFile('/test/caller.go', [
      'func main() {',
      '  result := process(data)',
      '  output := transform(result)',
      '  fmt.Println(output)',
      '}',
    ].join('\n'));
    // Only "main" should match as a function boundary
    const funcChunks = chunks.filter(c =>
      c.metadata.chunk_type === 'function'
    );
    expect(funcChunks.length).toBeLessThanOrEqual(1);
    if (funcChunks.length > 0) {
      expect(funcChunks[0].metadata.symbol).toBe('main');
    }
  });
});

// =============================================================================
// End-keyword parser edge cases
// =============================================================================

describe('end-keyword parser', () => {
  it('handles nested Ruby blocks correctly', async () => {
    const chunks = await chunker.parseFile('/test/nested.rb', [
      'class Account',
      '  def deposit(amount)',
      '    if amount > 0',
      '      @balance += amount',
      '      update_history',
      '    end',
      '  end',
      '',
      '  def withdraw(amount)',
      '    @balance -= amount',
      '    update_history',
      '  end',
      'end',
    ].join('\n'));
    // With correct depth tracking, the entire class is one chunk
    // (if/end inside deposit no longer prematurely closes the class)
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('Account');
  });

  it('handles Lua function with nested if/end', async () => {
    const chunks = await chunker.parseFile('/test/logic.lua', [
      'function validate(input)',
      '    if input == nil then',
      '        return false',
      '    end',
      '    if input.name == "" then',
      '        return false',
      '    end',
      '    return true',
      'end',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('validate');
  });
});

// =============================================================================
// Entity extraction edge cases
// =============================================================================

// =============================================================================
// Multi-line signatures
// =============================================================================

describe('multi-line signatures', () => {
  it('matches Java method when signature fits one line with generics', async () => {
    const chunks = await chunker.parseFile('/test/Generic.java', [
      'public class Generic {',
      '  public <T extends Comparable<T>> List<T> sort(List<T> items) {',
      '    Collections.sort(items);',
      '    return items;',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('Generic');
    expect(chunks[1].metadata.symbol).toBe('sort');
  });

  it('misses method name when opening paren is on a different line (known limitation)', async () => {
    // The chunker matches patterns per-line. If the method name and '(' are split
    // across lines, the method pattern won't match. Testing actual behavior.
    const chunks = await chunker.parseFile('/test/Split.java', [
      'public class Split {',
      '  public Map<String, List<Integer>>',
      '      computeIndex(String input) {',
      '    return null;',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('Split');
    // computeIndex is on a continuation line — not matched (known limitation).
    // Verify the chunker doesn't crash and produces valid line ranges.
    expect(chunks.every(c => c.metadata.line_start <= c.metadata.line_end)).toBe(true);
  });

  it('matches Rust function with lifetime params on one line', async () => {
    const chunks = await chunker.parseFile('/test/lifetime.rs', [
      "pub fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {",
      '    if x.len() > y.len() { x } else { y }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('longest');
  });

  it('matches Python def even with multi-line args (def line has opening paren)', async () => {
    // Python chunker matches on the `def name(` line. The closing paren being
    // on a later line doesn't matter since only the first line is checked.
    const chunks = await chunker.parseFile('/test/multiarg.py', [
      'def process_data(',
      '    input_path: str,',
      '    output_path: str,',
      '    verbose: bool = False,',
      ') -> bool:',
      '    with open(input_path) as f:',
      '        data = f.read()',
      '    return True',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('process_data');
  });

  it('matches C# method with generic constraints on one line', async () => {
    const chunks = await chunker.parseFile('/test/Constraints.cs', [
      'public class Constraints {',
      '  public T FindFirst<T>(IEnumerable<T> items) where T : class {',
      '    return items.FirstOrDefault();',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('Constraints');
  });
});

// =============================================================================
// Decorators and attributes before definitions
// =============================================================================

describe('decorators and attributes before definitions', () => {
  it('handles Python decorator followed by function', async () => {
    // Python chunker has a `decorator` pattern. @property starts a chunk,
    // then `def` starts a new chunk — the decorator chunk is tiny and may
    // be dropped by the 30-char threshold.
    const chunks = await chunker.parseFile('/test/decorated.py', [
      '@property',
      'def name(self):',
      '    return self._name',
      '',
      '@name.setter',
      'def name(self, value):',
      '    self._name = value',
    ].join('\n'));
    const funcChunks = chunks.filter(c => c.metadata.chunk_type === 'function');
    expect(funcChunks.length).toBe(2);
    expect(funcChunks.every(c => c.metadata.symbol === 'name')).toBe(true);
  });

  it('handles Python class with multiple decorators', async () => {
    const chunks = await chunker.parseFile('/test/multi_deco.py', [
      'import functools',
      '',
      '@functools.lru_cache(maxsize=128)',
      '@staticmethod',
      'def expensive_compute(n):',
      '    result = sum(range(n))',
      '    return result * 2',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.chunk_type).toBe('decorator');
    expect(chunks[1].metadata.symbol).toBe('expensive_compute');
  });

  it('Java @Override stays part of enclosing chunk (no annotation pattern in chunker)', async () => {
    // Java chunker has no annotation/decorator pattern, so @Override is
    // a non-matching line that stays in the enclosing chunk.
    const chunks = await chunker.parseFile('/test/Override.java', [
      'public class Override {',
      '  @Override',
      '  public String toString() {',
      '    return "Override object";',
      '  }',
      '',
      '  @Deprecated',
      '  @SuppressWarnings("unchecked")',
      '  public void legacyMethod() {',
      '    System.out.println("old");',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(3);
    expect(chunks[0].metadata.symbol).toBe('Override');
    expect(chunks[1].metadata.symbol).toBe('toString');
    expect(chunks[2].metadata.symbol).toBe('legacyMethod');
  });

  it('Rust #[derive] before struct does not create a separate chunk', async () => {
    // Rust chunker has no derive/attribute pattern — #[derive(...)] is non-matching
    const chunks = await chunker.parseFile('/test/derived.rs', [
      '#[derive(Debug, Clone, PartialEq)]',
      '#[serde(rename_all = "camelCase")]',
      'pub struct Config {',
      '    pub name: String,',
      '    pub value: i32,',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('Config');
    expect(chunks[0].metadata.chunk_type).toBe('struct');
  });

  it('C# [Attribute] before method does not create a separate chunk', async () => {
    const chunks = await chunker.parseFile('/test/Controller.cs', [
      'public class UserController {',
      '  [HttpGet("{id}")]',
      '  [Authorize(Roles = "Admin")]',
      '  public IActionResult GetUser(int id) {',
      '    return Ok(FindUser(id));',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('UserController');
    expect(chunks[1].metadata.symbol).toBe('GetUser');
  });
});

// =============================================================================
// Comment-only files
// =============================================================================

describe('comment-only files', () => {
  it('produces trailing chunk for JS file with only single-line comments', async () => {
    const chunks = await chunker.parseFile('/test/header.js', [
      '// Copyright 2024 Acme Corp',
      '// Licensed under MIT',
      '// This file intentionally left blank',
    ].join('\n'));
    // No boundary patterns match, but _pushFinalChunk captures content >30 chars
    // as a trailing chunk with type 'code' and symbol 'unknown'.
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.chunk_type).toBe('code');
    expect(chunks[0].metadata.symbol).toBe('unknown');
  });

  it('handles JS file with block comment only', async () => {
    const chunks = await chunker.parseFile('/test/license.js', [
      '/**',
      ' * Copyright 2024 Acme Corporation',
      ' * All rights reserved.',
      ' *',
      ' * This software is licensed under the MIT License.',
      ' * See LICENSE file for details.',
      ' */',
    ].join('\n'));
    // No boundary patterns match. Content (~145 chars) > 30 → _pushFinalChunk captures it.
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.chunk_type).toBe('code');
    expect(chunks[0].metadata.symbol).toBe('unknown');
  });

  it('produces trailing chunk for Python file with only comments', async () => {
    const chunks = await chunker.parseFile('/test/header.py', [
      '# -*- coding: utf-8 -*-',
      '# Module docstring placeholder',
      '# Author: Test User',
    ].join('\n'));
    // Python indent-based parser skips comment lines in its loop, but
    // _pushFinalChunk captures the remaining content (>30 chars) as trailing chunk.
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.chunk_type).toBe('code');
    expect(chunks[0].metadata.symbol).toBe('unknown');
  });

  it('produces trailing chunk for shell file with only comments', async () => {
    const chunks = await chunker.parseFile('/test/header.sh', [
      '#!/bin/bash',
      '# Setup script configuration',
      '# Version: 1.0.0',
    ].join('\n'));
    // Brace-based parser: no boundaries match, trailing content >30 chars
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.chunk_type).toBe('code');
    expect(chunks[0].metadata.symbol).toBe('unknown');
  });

  it('handles Ruby file with only comments (end-keyword parser)', async () => {
    const chunks = await chunker.parseFile('/test/header.rb', [
      '# frozen_string_literal: true',
      '# Copyright 2024 Ruby Corp',
      '# This module will be filled in later',
    ].join('\n'));
    // End-keyword parser: no `def`/`class`/`module` boundaries match.
    // Content (~94 chars) > 30 → _pushFinalChunk captures as trailing chunk.
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.chunk_type).toBe('code');
    expect(chunks[0].metadata.symbol).toBe('unknown');
  });
});

// =============================================================================
// Binary, Unicode, and Large File Robustness
// =============================================================================

describe('binary and non-text content', () => {
  it('handles content with null bytes without throwing', async () => {
    const content = 'function a() {\x00  return 1;\x00}';
    const chunks = await chunker.parseFile('/test/binary.js', content);
    // Must not throw; null bytes disrupt pattern matching so no chunks extracted
    expect(chunks.length).toBe(0);
  });

  it('handles pure binary content (all null bytes)', async () => {
    const content = '\x00'.repeat(100);
    const chunks = await chunker.parseFile('/test/pure-binary.js', content);
    expect(Array.isArray(chunks)).toBe(true);
    // Null bytes aren't whitespace, so trim() doesn't remove them.
    // No boundary patterns match → _pushFinalChunk captures as trailing chunk.
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.chunk_type).toBe('code');
  });

  it('handles mixed binary and valid code', async () => {
    const content = [
      'function valid() {',
      '  return "hello";',
      '}',
      '\x00\x01\x02\x03\x04\x05\x06\x07',
      'function another() {',
      '  return "world";',
      '}',
    ].join('\n');
    const chunks = await chunker.parseFile('/test/mixed-binary.js', content);
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('valid');
    expect(chunks[1].metadata.symbol).toBe('another');
  });
});

describe('unicode content handling', () => {
  it('handles emoji in strings without affecting chunk boundaries', async () => {
    // Uses Go to avoid JS const-matching extra boundaries
    const chunks = await chunker.parseFile('/test/emoji.go', [
      'func processData() {',
      '  msg := "Hello \u{1F30D} World \u{1F389}"',
      '  fmt.Println(msg + " \u{1F680}")',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('processData');
  });

  it('handles CJK characters in strings', async () => {
    const chunks = await chunker.parseFile('/test/cjk.go', [
      'func translate() {',
      '  greeting := "\u3053\u3093\u306B\u3061\u306F\u4E16\u754C"',
      '  chinese := "\u4F60\u597D\u4E16\u754C"',
      '  fmt.Println(greeting + chinese)',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('translate');
  });

  it('handles RTL characters in strings', async () => {
    const chunks = await chunker.parseFile('/test/rtl.go', [
      'func renderText() {',
      '  arabic := "\u0645\u0631\u062D\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645"',
      '  hebrew := "\u05E9\u05DC\u05D5\u05DD \u05E2\u05D5\u05DC\u05DD"',
      '  fmt.Println(arabic + hebrew)',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('renderText');
  });

  it('handles combining characters and diacritics', async () => {
    const chunks = await chunker.parseFile('/test/diacritics.go', [
      'func formatName() {',
      '  name := "caf\u00E9 r\u00E9sum\u00E9 na\u00EFve"',
      '  fmt.Println(name)',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('formatName');
  });
});

describe('large file handling', () => {
  it('handles file with 200 functions', async () => {
    const lines = [];
    for (let i = 0; i < 200; i++) {
      lines.push(`function fn${i}() {`);
      lines.push(`  return ${i} + Math.random();`);
      lines.push('}');
      lines.push('');
    }
    const chunks = await chunker.parseFile('/test/many-functions.js', lines.join('\n'));
    expect(chunks.length).toBe(200);
    expect(chunks[0].metadata.symbol).toBe('fn0');
    expect(chunks[199].metadata.symbol).toBe('fn199');
  });

  it('handles very long lines without crashing', async () => {
    const longLine = 'x'.repeat(10000);
    // Use Go to avoid JS const-matching extra boundaries
    const content = [
      'func processLongData() {',
      `  data := "${longLine}"`,
      '  fmt.Println(len(data))',
      '}',
    ].join('\n');
    const chunks = await chunker.parseFile('/test/long-lines.go', content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('processLongData');
  });
});

// =============================================================================
// Entity extraction edge cases
// =============================================================================

describe('entity extraction edge cases', () => {
  it('returns empty entities for unknown file type', async () => {
    const result = await extractor.extractFromFile('/test/data.xyz', 'some random content');
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });

  it('entities have all required fields', async () => {
    const result = await extractor.extractFromFile('/test/model.py', [
      'class User:',
      '    def __init__(self, name):',
      '        self.name = name',
    ].join('\n'));
    const entity = result.entities[0];
    expect(entity).toHaveProperty('id');
    expect(entity).toHaveProperty('file_path');
    expect(entity).toHaveProperty('type');
    expect(entity).toHaveProperty('name');
    expect(entity).toHaveProperty('signature');
    expect(entity).toHaveProperty('start_line');
    expect(entity).toHaveProperty('end_line');
  });

  it('relationships have all required fields', async () => {
    const result = await extractor.extractFromFile('/test/app.py', [
      'from flask import Flask',
      '',
      'app = Flask(__name__)',
    ].join('\n'));
    const rel = result.relationships.find(r => r.type === 'imports');
    expect(rel).toBeTruthy();
    expect(rel).toHaveProperty('source_id');
    expect(rel).toHaveProperty('target_name');
    expect(rel).toHaveProperty('type');
    expect(rel).toHaveProperty('weight');
    expect(rel).toHaveProperty('context_line');
  });
});
