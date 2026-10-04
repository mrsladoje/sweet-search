/**
 * Doc comments on tree-sitter graph entities, and package-level Go var/const
 * and Rust const/static entities.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterProvider } from '../../core/infrastructure/tree-sitter-provider.js';
import { GraphExtractor } from '../../core/graph/index.js';
import { cleanCommentLines, DOC_COMMENT_MAX_CHARS } from '../../core/infrastructure/tree-sitter-doc-comments.js';

let provider;
beforeAll(async () => {
  provider = new TreeSitterProvider();
  await provider.isAvailable();
});

async function docs(lang, src) {
  const syms = await provider.extractSymbols(src, lang);
  const out = {};
  for (const s of syms) out[`${s.type}:${s.name}`] = s.docComment ?? null;
  return out;
}

describe('doc comments from the AST', () => {
  it('go: adjacent // comments only; directives and blank-line gaps excluded', async () => {
    const d = await docs('go', [
      '// Copyright 2020 Acme.',
      '',
      'package p',
      '',
      '// Detached by a blank line.',
      '',
      'func A() {}',
      '',
      '//go:generate stringer -type=Kind',
      '// Kind is a kind.',
      'type Kind int',
      '',
      '/* Block doc. */',
      'func (k Kind) String() string { return "" }',
      '',
      'var x = 1 // trailing',
      'func B() {}',
    ].join('\n'));
    expect(d['function:A']).toBeNull();
    expect(d['typeAlias:Kind']).toBe('Kind is a kind.');
    expect(d['method:String']).toBe('Block doc.');
    expect(d['function:B']).toBeNull();
  });

  it('python: docstring first, leading # comment as fallback, decorated methods', async () => {
    const d = await docs('python', [
      '# Copyright (c) Acme. Licensed under MIT.',
      'def first():',
      '    pass',
      '',
      '# helper comment',
      'def helper(x):',
      '    r"""Return x.',
      '',
      '    More text.',
      '    """',
      '    return x',
      '',
      'class A:',
      '    """Class doc."""',
      '    # comment for n',
      '    def n(self):',
      '        return 1',
      '',
      '    @property',
      '    def p(self):',
      "        '''Prop doc.'''",
      '        return 2',
    ].join('\n'));
    expect(d['function:first']).toBeNull(); // file-top license header
    expect(d['function:helper']).toBe('Return x. More text.');
    expect(d['class:A']).toBe('Class doc.');
    expect(d['method:n']).toBe('comment for n');
    expect(d['method:p']).toBe('Prop doc.');
    // The decorated_definition entity spans `p` too; the docstring is p's.
    expect(d['decorator:<anonymous:decorator>']).toBeNull();
  });

  it('rust: /// docs above attributes; //! inner docs are not item docs', async () => {
    const d = await docs('rust', [
      '//! Crate doc.',
      'fn top() {}',
      '',
      '/// A struct.',
      '/// Second line.',
      '#[derive(Debug)]',
      'pub struct S { x: u32 }',
      '',
      'impl S {',
      '    /** Block doc */',
      '    pub fn new() -> Self { S { x: 1 } }',
      '}',
    ].join('\n'));
    expect(d['function:top']).toBeNull();
    expect(d['struct:S']).toBe('A struct. Second line.');
    expect(d['function:new']).toBe('Block doc');
  });

  it('typescript / javascript: JSDoc above export, decorator, arrow and object pair', async () => {
    const d = await docs('typescript', [
      '/** Exported fn doc */',
      'export function f() {}',
      '',
      '/** arrow doc */',
      'const g = () => 1;',
      '',
      'class C {',
      '  /** method doc */',
      '  @Dec()',
      '  m() {}',
      '}',
    ].join('\n'));
    expect(d['function:f']).toBe('Exported fn doc');
    expect(d['arrowFunction:g']).toBe('arrow doc');
    expect(d['method:m']).toBe('method doc');

    const js = await docs('javascript', [
      '#!/usr/bin/env node',
      '/**',
      ' * Builds the app.',
      ' */',
      'function build() {}',
      'module.exports = {',
      '  /** Starts it. */',
      '  start: function () {},',
      '};',
    ].join('\n'));
    expect(js['function:build']).toBe('Builds the app.');
    expect(js['method:start']).toBe('Starts it.');
  });

  it('java, c#, kotlin, swift, php, c, c++, ruby, solidity, ocaml', async () => {
    expect((await docs('java', '/** Holds users. */\n@Entity\npublic class Users {\n  /** Max. */\n  static final int MAX = 3;\n}\n')))
      .toMatchObject({ 'class:Users': 'Holds users.', 'field:MAX': 'Max.' });
    expect((await docs('csharp', 'class W {\n  /// <summary>Runs it.</summary>\n  [Obsolete]\n  public void Run() {}\n}\n')))
      .toMatchObject({ 'method:Run': 'Runs it.' });
    expect((await docs('kotlin', '/** A box. */\nclass Box {\n  /** Opens. */\n  fun open() {}\n}\n')))
      .toMatchObject({ 'class:Box': 'A box.', 'method:open': 'Opens.' });
    expect((await docs('swift', '/// A thing.\nclass Thing {\n  /// Does it.\n  func doIt() {}\n}\n')))
      .toMatchObject({ 'class:Thing': 'A thing.', 'method:doIt': 'Does it.' });
    expect((await docs('php', '<?php\n/**\n * Handles.\n */\nclass H {\n  /** Dispatch. */\n  public function d() {}\n}\n')))
      .toMatchObject({ 'class:H': 'Handles.', 'method:d': 'Dispatch.' });
    expect((await docs('c', '/* Adds. */\nint add(int a, int b) { return a + b; }\n')))
      .toMatchObject({ 'function:add': 'Adds.' });
    expect((await docs('cpp', '/// Templated box.\ntemplate <typename T>\nclass Box { public: T v; };\n')))
      .toMatchObject({ 'class:Box': 'Templated box.' });
    expect((await docs('ruby', '# Parses.\nclass Parser\n  # Runs.\n  def run; end\n\n  # Second.\n  def bare; end\nend\n')))
      .toMatchObject({ 'class:Parser': 'Parses.', 'method:run': 'Runs.', 'method:bare': 'Second.' });
    expect((await docs('solidity', '/// @notice A token.\ncontract Token {\n  /// @dev Mints.\n  function mint() public {}\n}\n')))
      .toMatchObject({ 'class:Token': '@notice A token.', 'function:mint': '@dev Mints.' });
    expect((await docs('ocaml', '(** Adds one. *)\nlet incr x = x + 1\n')))
      .toMatchObject({ 'function:incr': 'Adds one.' });
  });

  it(`caps doc text at ${DOC_COMMENT_MAX_CHARS} chars`, async () => {
    const long = 'word '.repeat(300);
    const d = await docs('go', `package p\n\n// ${long}\nfunc F() {}\n`);
    expect(d['function:F'].length).toBe(DOC_COMMENT_MAX_CHARS);
  });

  it('cleanCommentLines strips markers and drops directive / ruler lines', () => {
    expect(cleanCommentLines('/**\n * One.\n * Two.\n */', 'javascript')).toEqual(['One.', 'Two.']);
    expect(cleanCommentLines('//nolint:errcheck', 'go')).toEqual([]);
    expect(cleanCommentLines('// ---------', 'go')).toEqual([]);
    expect(cleanCommentLines('//! inner', 'rust')).toEqual([]);
    expect(cleanCommentLines('//! Doxygen next-item doc', 'cpp')).toEqual(['Doxygen next-item doc']);
  });
});

describe('graph entities carry doc_comment (tree-sitter path)', () => {
  it('GraphExtractor fills doc_comment from the provider', async () => {
    const extractor = new GraphExtractor({ projectRoot: '/project' });
    const { entities } = await extractor.extractFromFile(
      '/project/worker/draft.go',
      'package worker\n\n// We must not wait here.\nfunc detectPendingTxns(attr string) error { return nil }\n',
    );
    const fn = entities.find(e => e.name === 'detectPendingTxns');
    expect(fn.doc_comment).toBe('We must not wait here.');
  });
});

describe('Go package-level var / const entities', () => {
  const src = [
    'package p',
    '',
    '// errFoo is returned on foo.',
    'var errFoo = errors.New("Pending transactions found. Please retry operation")',
    '',
    'var (',
    '\t// A is a.',
    '\tA = 1',
    '\tB, C int',
    ')',
    '',
    'const (',
    '\tX Kind = iota',
    '\tY',
    ')',
    '',
    'const Z = "z"',
    '',
    'var _ io.Writer = (*T)(nil)',
    '',
    'func F() {',
    '\tvar local = 1',
    '\tconst inner = 2',
    '\t_ = local + inner',
    '}',
  ].join('\n');

  it('extracts single and grouped specs, every name, not function-locals', async () => {
    const syms = await provider.extractSymbols(src, 'go');
    const byName = Object.fromEntries(syms.map(s => [s.name, s]));
    expect(byName.errFoo).toMatchObject({
      type: 'variable',
      startLine: 3,
      signature: 'var errFoo = errors.New("Pending transactions found. Please retry operation")',
      docComment: 'errFoo is returned on foo.',
    });
    expect(byName.A).toMatchObject({ type: 'variable', signature: 'var A = 1', docComment: 'A is a.' });
    expect(byName.B).toMatchObject({ type: 'variable', signature: 'var B, C int' });
    expect(byName.C).toMatchObject({ type: 'variable', signature: 'var B, C int' });
    expect(byName.X).toMatchObject({ type: 'const', signature: 'const X Kind = iota' });
    expect(byName.Y).toMatchObject({ type: 'const' });
    expect(byName.Z).toMatchObject({ type: 'const', signature: 'const Z = "z"' });
    expect(byName._).toBeUndefined();
    expect(byName.local).toBeUndefined();
    expect(byName.inner).toBeUndefined();
    expect(byName.F).toMatchObject({ type: 'function' });
  });
});

describe('Rust const / static entities', () => {
  it('extracts module-level and associated items, not function-locals', async () => {
    const syms = await provider.extractSymbols([
      '/// Max items.',
      'pub const MAX: usize = 10;',
      'static COUNTER: AtomicUsize = AtomicUsize::new(0);',
      'impl S {',
      '    const INNER: u32 = 3;',
      '}',
      'mod m {',
      '    pub(crate) static N: u8 = 1;',
      '}',
      'fn f() {',
      '    const LOCAL: u8 = 1;',
      '}',
    ].join('\n'), 'rust');
    const byName = Object.fromEntries(syms.map(s => [s.name, s]));
    expect(byName.MAX).toMatchObject({ type: 'const', docComment: 'Max items.' });
    expect(byName.COUNTER).toMatchObject({ type: 'static' });
    expect(byName.INNER).toMatchObject({ type: 'const', parentClass: 'S' });
    expect(byName.N).toMatchObject({ type: 'static' });
    expect(byName.LOCAL).toBeUndefined();
  });
});
