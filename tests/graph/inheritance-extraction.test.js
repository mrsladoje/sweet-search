/**
 * Inheritance / conformance / decorator edges per language.
 *
 * Each case is a shape that was missed, cut short or invented by the regex
 * relationship layer before the 2026-10 fix (r3 bench repos: GRDB, okhttp,
 * ocelot, drogon, typedoc, zipkin, flask, sequel, composer, dgraph).
 */

import { describe, it, expect } from 'vitest';
import { GraphExtractor } from '../../core/graph/index.js';

const extractor = new GraphExtractor({ projectRoot: '/test' });

async function edges(file, lines, types = ['extends', 'implements']) {
  const { relationships } = await extractor.extractFromFile(file, lines.join('\n'));
  return relationships.filter(r => types.includes(r.type)).map(r => `${r.context_line}:${r.target_name}`);
}

describe('inheritance lists', () => {
  it('Python: every base, no keyword arguments, no generic subscripts', async () => {
    expect(await edges('/test/models.py', [
      'class Foo(Base, mixins.Mixin, metaclass=abc.ABCMeta):',
      '    pass',
      'class G(Generic[T], Protocol):',
      '    pass',
      'class H[T](Base[T]):',
      '    pass',
    ])).toEqual(['1:Base', '1:mixins.Mixin', '3:Generic', '3:Protocol', '5:Base']);
  });

  it('Kotlin: the whole supertype list after the primary constructor', async () => {
    expect(await edges('/test/Foo.kt', [
      'class Foo(val x: Int) : Bar(x), Baz, Qux<Int> {',
      '}',
      'class Gen<T : Any>(v: T) : Base<T>() {}',
      'object Single : Iface {}',
      'interface I : J, K',
      'class Del(b: Base) : Base by b',
      'class Inj @Inject constructor(val a: A) : Svc',
      'val o = object : Runnable { }',
      'fun <T : Comparable<T>> sort(x: List<T>) {}',
      '  object : Task("closer") {',
      '  companion object : Factory<X>()',
    ])).toEqual(['1:Bar', '1:Baz', '1:Qux', '3:Base', '4:Iface', '5:J', '5:K', '6:Base', '7:Svc', '11:Factory']);
  });

  it('Swift: generic types, protocols, actors; where clauses cut', async () => {
    expect(await edges('/test/Foo.swift', [
      'public final class Foo<T>: Base, Sendable where T: Codable {',
      '}',
      'extension Bar: Equatable where Value: Equatable, Key: Hashable {',
      '}',
      'public protocol MutablePersistableRecord: EncodableRecord, TableRecord {',
      '}',
      'actor A: Sendable {}',
      'class var shared: Foo { x }',
    ])).toEqual(['1:Base', '1:Sendable', '3:Equatable', '5:EncodableRecord', '5:TableRecord', '7:Sendable']);
  });

  it('C#: generic classes, interfaces, structs and records', async () => {
    expect(await edges('/test/Foo.cs', [
      'public class Foo<T> : Base<T>, IFoo where T : class',
      '{',
      '}',
      'public interface IBar : IBaz, IQux { }',
      'public struct S : IEquatable<S> { }',
      'public record R(int X) : Base;',
      '    where T : class, new()',
    ])).toEqual(['1:Base', '1:IFoo', '4:IBaz', '4:IQux', '5:IEquatable', '6:Base']);
  });

  it('C++: final, export macros, templates; never `enum class X : int`', async () => {
    expect(await edges('/test/foo.h', [
      'class Foo final : public Bar, private Baz<int> {',
      '};',
      'enum class Color : uint8_t { Red };',
      'class DROGON_EXPORT HttpAppFramework : public trantor::NonCopyable {',
      '};',
      'template <typename T> class W : public ::DrObject<T>, virtual public V {};',
      'void HttpController::handle() { for (auto &x : xs) {} }',
    ])).toEqual(['1:Bar', '1:Baz', '4:trantor::NonCopyable', '6:DrObject', '6:V']);
  });

  it('TypeScript: generic classes and qualified bases', async () => {
    expect(await edges('/test/foo.ts', [
      'export class Foo<T> extends Base<T> implements IA<T>, IB {',
      '}',
      'class C extends React.Component<Props> {}',
      'class Q<T extends Map<string, number>> extends R {}',
    ])).toEqual(['1:Base', '1:IA', '1:IB', '3:React.Component', '4:R']);
  });

  it('Java: interface lists and implements before a next-line brace', async () => {
    expect(await edges('/test/Foo.java', [
      'public interface I extends J, K {',
      '}',
      'class Z extends a.b.Qual implements Runnable',
      '{',
      '}',
      'class G<T extends Comparable<T>> extends H<T> {}',
    ])).toEqual(['1:J', '1:K', '3:a.b.Qual', '3:Runnable', '6:H']);
  });

  it('Ruby namespaced classes, PHP modifiers and interface lists, GraphQL &', async () => {
    expect(await edges('/test/foo.rb', ['class Foo::Bar < Sequel::Model', 'end']))
      .toEqual(['1:Sequel::Model']);
    expect(await edges('/test/Foo.php', [
      '<?php',
      'interface I extends J, K {}',
      'readonly class R extends S {}',
    ])).toEqual(['2:J', '2:K', '3:S']);
    expect(await edges('/test/schema.graphql', [
      'type Human implements Character & Employee {',
      '  id: ID!',
      '}',
    ])).toEqual(['1:Character', '1:Employee']);
  });
});

describe('comments, docstrings and strings create no edges', () => {
  it('skips line comments, block comments and doc examples', async () => {
    expect(await edges('/test/foo.ts', [
      '// class Fake extends Comment {}',
      '/**',
      ' * @example',
      ' * class Doc extends Comment2 {}',
      ' */',
      '/* class Block extends Comment3 {} */',
      'class Real extends Base {}',
    ])).toEqual(['7:Base']);
  });

  it('skips Python docstrings and triple-quoted strings', async () => {
    expect(await edges('/test/foo.py', [
      'class Foo(Base):',
      '    """Example:',
      '',
      '    class Bad(Wrong):',
      '    """',
      'SQL = """',
      'class NotCode(Wrong2):',
      '"""',
      '# class C(Comment):',
      'class After(Ok):',
      '    pass',
    ])).toEqual(['1:Base', '10:Ok']);
  });

  it('a `/*` inside a string does not hide the rest of the file', async () => {
    expect(await edges('/test/foo.ts', [
      'const glob = "src/**/*.ts";',
      'class Real extends Base {}',
    ])).toEqual(['2:Base']);
  });
});

describe('decorators belong to the definition below them', () => {
  it('Python decorators attach to the decorated function', async () => {
    const { entities, relationships } = await extractor.extractFromFile('/test/views.py', [
      'class View:',
      '    @property',
      '    def x(self):',
      '        return 1',
      '',
      '@app.route("/")',
      '@login_required',
      'def index():',
      '    pass',
    ].join('\n'));
    const byId = new Map(entities.map(e => [e.id, e.name]));
    const uses = relationships.filter(r => r.type === 'uses').map(r => `${r.target_name}->${byId.get(r.source_id)}`);
    expect(uses).toEqual(['property->x', 'app.route->index', 'login_required->index']);
  });
});
