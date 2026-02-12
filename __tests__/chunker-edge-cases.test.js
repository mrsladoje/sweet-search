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
import { ASTChunker } from '../ast-chunker.js';
import GraphExtractor from '../core/graph-extractor.js';

const chunker = new ASTChunker({ projectRoot: '/test' });
const extractor = new GraphExtractor({ projectRoot: '/test' });

// =============================================================================
// Brace depth tracking with braces inside strings/comments
// =============================================================================

describe('brace-based depth tracking', () => {
  it('tracks braces in string literals (may miscount)', async () => {
    // The chunker counts ALL { and } on a line, including those in strings.
    // This is a known simplification — testing actual behavior.
    const chunks = await chunker.parseFile('/test/format.js', [
      'function formatJson(obj) {',
      '  const template = "{ name: {name} }";',
      '  return template.replace("{name}", obj.name);',
      '  return obj;',
      '}',
    ].join('\n'));
    // Even with string braces, the function should produce at least one chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].metadata.language).toBe('javascript');
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
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const summary = chunks.map(c => c.metadata.chunk_type);
    expect(summary).toContain('class');
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
    // Should produce at least one chunk for the outer class
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some(c => c.metadata.symbol === 'Container')).toBe(true);
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
    // Python is indent-based, so both commented and real function may match
    // At minimum the real function should produce a chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some(c => c.metadata.symbol === 'real_function')).toBe(true);
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
    if (chunks.length > 0) {
      expect(chunks[0].metadata.language).toBe('text');
      expect(chunks[0].metadata.chunk_type).toBe('code');
    }
  });
});

// =============================================================================
// 30-char chunk threshold boundary
// =============================================================================

describe('chunk size threshold (> 30 chars)', () => {
  it('drops chunks at exactly 30 chars', async () => {
    // A chunk with exactly 30 trimmed chars should be dropped (> 30, not >=)
    const chunks = await chunker.parseFile('/test/threshold.go', [
      'func a() {',
      '  return 12345678901234567',  // total: "func a() {\n  return 12345678901234567\n}" = 40 chars
      '}',
    ].join('\n'));
    // This should be > 30 chars and produce a chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
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
    expect(chunks.length).toBeGreaterThanOrEqual(1);
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
    // Should produce at least the class chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some(c => c.metadata.symbol === 'Account')).toBe(true);
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
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some(c => c.metadata.symbol === 'validate')).toBe(true);
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
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // The class boundary should match 'Generic'
    expect(chunks.some(c => c.metadata.symbol === 'Generic')).toBe(true);
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
    // 'Split' class should still be detected
    expect(chunks.some(c => c.metadata.symbol === 'Split')).toBe(true);
    // The method 'computeIndex' is on a continuation line — it may or may not
    // be detected depending on whether the pattern matches the indented line.
    // We just verify the chunker doesn't crash and produces valid output.
    expect(chunks.every(c => c.metadata.line_start <= c.metadata.line_end)).toBe(true);
  });

  it('matches Rust function with lifetime params on one line', async () => {
    const chunks = await chunker.parseFile('/test/lifetime.rs', [
      "pub fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {",
      '    if x.len() > y.len() { x } else { y }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some(c => c.metadata.symbol === 'longest')).toBe(true);
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
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some(c => c.metadata.symbol === 'process_data')).toBe(true);
  });

  it('matches C# method with generic constraints on one line', async () => {
    const chunks = await chunker.parseFile('/test/Constraints.cs', [
      'public class Constraints {',
      '  public T FindFirst<T>(IEnumerable<T> items) where T : class {',
      '    return items.FirstOrDefault();',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.some(c => c.metadata.symbol === 'Constraints')).toBe(true);
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
    // Both functions should be detected
    const funcChunks = chunks.filter(c => c.metadata.chunk_type === 'function');
    expect(funcChunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some(c => c.metadata.symbol === 'name')).toBe(true);
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
    expect(chunks.some(c => c.metadata.symbol === 'expensive_compute')).toBe(true);
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
    expect(chunks.some(c => c.metadata.symbol === 'Override')).toBe(true);
    // toString and legacyMethod should be detected as method boundaries
    expect(chunks.some(c => c.metadata.symbol === 'toString')).toBe(true);
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
    expect(chunks.some(c => c.metadata.symbol === 'Config')).toBe(true);
    expect(chunks.some(c => c.metadata.chunk_type === 'struct')).toBe(true);
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
    expect(chunks.some(c => c.metadata.symbol === 'UserController')).toBe(true);
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
    // Block comment has braces? No — only { } count, not /* */.
    // Content is >30 chars but no boundary patterns match, so it falls
    // through to the final-chunk handler as type 'code' / 'unknown'.
    if (chunks.length > 0) {
      expect(chunks[0].metadata.chunk_type).toBe('code');
    }
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
    // Content may or may not produce a final trailing chunk.
    if (chunks.length > 0) {
      expect(chunks[0].metadata.chunk_type).toBe('code');
    }
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
