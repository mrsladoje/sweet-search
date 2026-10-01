/**
 * Graph entity containment (`parent_class`) and definition-capture fixes.
 *
 * Before: every tree-sitter entity was parentless, so same-named methods of
 * different types (GRDB's broker `statementDidFail` vs
 * `Database.statementDidFail`) could not be told apart. Also covers the C#
 * query that never compiled, Swift `#if` lines that hid whole type bodies,
 * Ruby `class A::B` / Rust generic and scoped impls that were not captured,
 * and regex-path containment + comment-line guard.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let provider;
let resetTreeSitterProvider;
let GraphExtractor;

beforeAll(async () => {
  const mod = await import('../../core/infrastructure/tree-sitter-provider.js');
  resetTreeSitterProvider = mod.resetTreeSitterProvider;
  provider = mod.getTreeSitterProvider();
  ({ GraphExtractor } = await import('../../core/graph/graph-extractor.js'));
});

afterAll(() => {
  if (resetTreeSitterProvider) resetTreeSitterProvider();
});

async function parents(code, lang) {
  const symbols = await provider.extractSymbols(code, lang);
  expect(symbols, `extractSymbols('${lang}') returned null`).not.toBeNull();
  return Object.fromEntries(symbols.map(s => [`${s.type}:${s.name}`, s.parentClass ?? null]));
}

describe('tree-sitter containment', () => {
  it('Swift: class, struct, enum and extension members; nested func is local', async () => {
    const p = await parents([
      'class Broker { func statementDidFail() {} }',
      'struct S { func s() {} }',
      'extension Database { func statementDidFail() {} }',
      'extension Foo.Bar where T: Q { func g() {} }',
      'protocol P { func pm() }',
      'func top() { func inner() {} }',
    ].join('\n'), 'swift');
    expect(p['function:s']).toBe('S');
    expect(p['function:g']).toBe('Bar');
    expect(p['method:pm']).toBe('P');
    expect(p['function:top']).toBeNull();
    expect(p['function:inner']).toBeNull();
    const symbols = await provider.extractSymbols(
      'class Broker { func statementDidFail() {} }\nextension Database { func statementDidFail() {} }', 'swift');
    expect(symbols.filter(s => s.name === 'statementDidFail').map(s => s.parentClass)).toEqual(['Broker', 'Database']);
  });

  it('Swift: #if lines inside a type body no longer hide the type (GRDB DatabaseObservationBroker)', async () => {
    const code = [
      'class DatabaseObservationBroker {',
      '    func statementDidFail(_ statement: Statement) throws {',
      '        try other()',
      '    }',
      '    #if SQLITE_ENABLE_PREUPDATE_HOOK',
      '    func databaseWillChange(with event: DatabasePreUpdateEvent) {',
      '    }',
      '    #endif',
      '    func installCommitAndRollbackHooks() {',
      '    }',
      '}',
    ].join('\n');
    const symbols = await provider.extractSymbols(code, 'swift');
    const byName = Object.fromEntries(symbols.map(s => [s.name, s]));
    expect(byName.DatabaseObservationBroker?.type).toBe('class');
    expect(byName.DatabaseObservationBroker.endLine).toBe(10);
    expect(byName.statementDidFail.parentClass).toBe('DatabaseObservationBroker');
    expect(byName.installCommitAndRollbackHooks.parentClass).toBe('DatabaseObservationBroker');
    expect(byName.statementDidFail.startLine).toBe(1); // line numbers unchanged by masking
  });

  it('Go: receiver type owns the method (pointer and generic receivers)', async () => {
    const p = await parents('package p\nfunc (b *Broker) M() {}\nfunc (s Server[T]) G() {}\nfunc F() {}', 'go');
    expect(p['method:M']).toBe('Broker');
    expect(p['method:G']).toBe('Server');
    expect(p['function:F']).toBeNull();
  });

  it('Rust: impl, generic impl, scoped impl, trait; nested fn is local', async () => {
    const symbols = await provider.extractSymbols([
      'impl Foo { fn a() {} }',
      'impl<T> Bar<T> { fn b() {} }',
      'impl fmt::Display for Err { fn fmt() {} }',
      'impl<T> Tr for x::Gen<T> { fn h() {} }',
      'trait Tr { fn t(); fn u() {} }',
      'fn top() { fn inner() {} }',
    ].join('\n'), 'rust');
    const p = Object.fromEntries(symbols.map(s => [`${s.type}:${s.name}`, s.parentClass ?? null]));
    expect(symbols.filter(s => s.type === 'impl').map(s => s.name)).toEqual(['Foo', 'Bar', 'Err', 'Gen']);
    expect(p['function:a']).toBe('Foo');
    expect(p['function:b']).toBe('Bar');
    expect(p['function:fmt']).toBe('Err');
    expect(p['function:h']).toBe('Gen');
    expect(p['method:t']).toBe('Tr'); // trait method without a body is now captured
    expect(p['function:u']).toBe('Tr');
    expect(p['function:inner']).toBeNull();
  });

  it('Python: methods and decorated methods belong to the class; nested def is local', async () => {
    const p = await parents('class A:\n    def m(self):\n        def inner(): pass\n    @property\n    def p(self): pass\ndef top(): pass', 'python');
    expect(p['function:m']).toBe('A');
    expect(p['function:p']).toBe('A');
    expect(p['function:inner']).toBeNull();
    expect(p['function:top']).toBeNull();
  });

  it('Ruby: class, module, class << self, scoped `class A::B`, capitalised method names', async () => {
    const symbols = await provider.extractSymbols([
      'class A',
      '  def m; end',
      '  class << self',
      '    def s; end',
      '  end',
      'end',
      'module M',
      '  def self.k; end',
      'end',
      'module Sequel::S',
      '  def S(*a); end',
      'end',
    ].join('\n'), 'ruby');
    const p = Object.fromEntries(symbols.map(s => [`${s.type}:${s.name}`, s.parentClass ?? null]));
    expect(p['method:m']).toBe('A');
    expect(p['method:s']).toBe('A');
    expect(p['method:k']).toBe('M');
    expect(p['module:S']).toBeNull();
    expect(p['method:S']).toBe('S');
    expect(symbols.some(s => s.name === 'Sequel::S' || s.name === 'Sequel')).toBe(false);
  });

  it('Java: inner class members; anonymous class body is not the outer class', async () => {
    const p = await parents('class A { void m() {} class In { void n() {} } Runnable r = new Runnable() { public void run() {} }; }', 'java');
    expect(p['method:m']).toBe('A');
    expect(p['class:In']).toBe('A');
    expect(p['method:n']).toBe('In');
    expect(p['field:r']).toBe('A');
    expect(p['method:run']).toBeNull();
  });

  it('Kotlin: anonymous object members and function-local classes stay parentless', async () => {
    const p = await parents([
      'object O { fun o() {} }',
      'class C {',
      '  val factory = object : Factory { override fun matches(): Boolean = true }',
      '  fun run() { class Effects(val x: Int) }',
      '}',
    ].join('\n'), 'kotlin');
    expect(p['function:o']).toBe('O');
    expect(p['function:run']).toBe('C');
    expect(p['function:matches']).toBeNull();
  });

  it('C#: the query compiles (fields included) and members get their type', async () => {
    const p = await parents('namespace N.M { public partial class A { private int f = 1; void M() {} class Nested { void Q() {} } } struct S { void T() {} } }', 'csharp');
    expect(p['class:A']).toBeNull(); // namespaces are not owners
    expect(p['field:f']).toBe('A');
    expect(p['method:M']).toBe('A');
    expect(p['method:Q']).toBe('Nested');
    expect(p['method:T']).toBe('S');
  });

  it('C++: in-class and out-of-line `Type::method` definitions', async () => {
    const p = await parents('class C { void in() {} };\nvoid C::out() {}\nvoid ns::C::deep() {}\ntemplate<class T> void D<T>::tm() {}\nvoid freeFn() {}', 'cpp');
    expect(p['method:in']).toBe('C');
    expect(p['method:out']).toBe('C');
    expect(p['method:deep']).toBe('C');
    expect(p['method:tm']).toBe('D');
    expect(p['function:freeFn']).toBeNull();
  });

  it('TS/JS: class methods, object-literal methods owned by their variable, local classes', async () => {
    const ts = await parents('class A { m() {} }\nconst api = { get() {}, put: () => 1 };\nfunction f() { class L { q() {} } }', 'typescript');
    expect(ts['method:m']).toBe('A');
    expect(ts['method:get']).toBe('api');
    expect(ts['arrowFunction:put']).toBe('api');
    expect(ts['method:q']).toBe('L');
    const js = await parents('module.exports = { x() {} };\nconst o = { y: function() {} };', 'javascript');
    expect(js['method:x']).toBeNull();
    expect(js['method:y']).toBe('o');
  });

  it('PHP: class and trait methods', async () => {
    const p = await parents('<?php class A { function m() {} }\ntrait T { function t() {} }\nfunction f() {}', 'php');
    expect(p['method:m']).toBe('A');
    expect(p['method:t']).toBe('T');
    expect(p['function:f']).toBeNull();
  });
});

describe('GraphExtractor entities', () => {
  it('stores parent_class on tree-sitter entities', async () => {
    const ex = new GraphExtractor({ projectRoot: '/tmp' });
    const { entities } = await ex.extractFromFile('Core/TransactionObserver.swift',
      'class DatabaseObservationBroker {\n    func statementDidFail() {}\n}\nfunc top() {}');
    const byName = Object.fromEntries(entities.map(e => [e.name, e]));
    expect(byName.statementDidFail.parent_class).toBe('DatabaseObservationBroker');
    expect('parent_class' in byName.top).toBe(false);
  });

  it('C# files with parse errors (C# 12 primary constructors) keep the regex extractor', async () => {
    const ex = new GraphExtractor({ projectRoot: '/tmp' });
    const code = [
      'public class FileRouteBox<T>(T route) : Box<T>(route, "x")',
      '    where T : FileRoute',
      '{',
      '    public FileRouteBox<T> Priority(int priority)',
      '    {',
      '        return this;',
      '    }',
      '}',
    ].join('\n');
    const { entities } = await ex.extractFromFile('FileRouteBox.cs', code);
    const priority = entities.find(e => e.name === 'Priority');
    expect(priority?.type).toBe('method');
    expect(priority.parent_class).toBe('FileRouteBox');
  });

  it('regex path: members get their container; doc-comment prose makes no entity', async () => {
    const ex = new GraphExtractor({ projectRoot: '/tmp', useTreeSitter: false });
    const code = [
      '/// A cursor whose element protocol comes from the database.',
      'public final class Cursor {',
      '    func forEach() {',
      '    }',
      '}',
      'func top() {',
      '}',
    ].join('\n');
    const { entities } = await ex.extractFromFile('Cursor.swift', code);
    expect(entities.some(e => e.name === 'comes')).toBe(false);
    const byName = Object.fromEntries(entities.map(e => [e.name, e]));
    expect(byName.forEach.parent_class).toBe('Cursor');
    expect(byName.top.parent_class).toBeUndefined();
  });

  it('regex path: no containment for end-keyword languages (keyword-counted spans are loose)', async () => {
    const ex = new GraphExtractor({ projectRoot: '/tmp', useTreeSitter: false });
    const { entities } = await ex.extractFromFile('a.rb', 'class A\n  def m\n  end\nend\n');
    expect(entities.every(e => !e.parent_class)).toBe(true);
  });
});
