/**
 * Type declaration headers that span several lines.
 *
 * The inheritance patterns match one line at a time, so before the review fix
 * a base list after the first header line was lost: okhttp alone has 222
 * Kotlin classes whose supertypes follow a multi-line primary constructor
 * (`class RealCall(\n ... \n) : Call, Cloneable {`). The extractor now joins
 * the header lines of a declaration before it applies the inheritance
 * patterns. Inheritance matches inside a string literal are dropped, and a
 * one-line declaration's list belongs to the type, not a member on that line.
 */

import { describe, it, expect } from 'vitest';
import { GraphExtractor, buildTypeHeaderJoins } from '../../core/graph/graph-extractor.js';

const extractor = new GraphExtractor({ projectRoot: '/test' });

async function edges(file, lines, types = ['extends', 'implements']) {
  const { entities, relationships } = await extractor.extractFromFile(file, lines.join('\n'));
  const byId = new Map(entities.map(e => [e.id, e.name]));
  return relationships
    .filter(r => types.includes(r.type))
    .map(r => `${byId.get(r.source_id) ?? '<file>'}:${r.context_line}:${r.target_name}`);
}

describe('multi-line type headers', () => {
  it('Kotlin: supertypes after a multi-line primary constructor', async () => {
    expect(await edges('/test/RealCall.kt', [
      'class RealCall(',
      '  val client: OkHttpClient,',
      '  val forWebSocket: Boolean,',
      ') : Call, Cloneable {',
      '  override fun execute(): Response = TODO()',
      '}',
      'internal class Exchange',
      'constructor(',
      '  val call: RealCall,',
      ') : Closeable {',
      '}',
      'fun foo(',
      '  a: Int,',
      '): String = ""',
    ])).toEqual(['RealCall:1:Call', 'RealCall:1:Cloneable', 'Exchange:7:Closeable']);
  });

  it('Kotlin: a constructor longer than 12 lines still reaches its supertypes (okhttp RealInterceptorChain)', async () => {
    const params = Array.from({ length: 23 }, (_, i) => `  internal val p${i}: Int,`);
    expect(await edges('/test/RealInterceptorChain.kt', [
      'class RealInterceptorChain(',
      ...params,
      ') : Interceptor.Chain {',
      '  override fun proceed(request: Request): Response = TODO()',
      '}',
    ])).toEqual(['RealInterceptorChain:1:Interceptor.Chain']);
  });

  it('a header with closed brackets still stops at 12 lines', () => {
    const lines = ['class A :', ...Array.from({ length: 20 }, (_, i) => `  B${i},`), '  Z {', '}'];
    const { joins } = buildTypeHeaderJoins(lines);
    expect(joins.get(0)).toContain('B10');
    expect(joins.get(0)).not.toContain('Z');
  });

  it('Java: extends and implements on their own lines', async () => {
    expect(await edges('/test/Cache.java', [
      'public final class Cache<K, V>',
      '    extends AbstractCache<K, V>',
      '    implements Map<K, V>, java.io.Serializable {',
      '}',
    ])).toEqual(['Cache:1:AbstractCache', 'Cache:1:Map', 'Cache:1:java.io.Serializable']);
  });

  it('Python: one base per line', async () => {
    expect(await edges('/test/models.py', [
      'class Multi(',
      '    First,',
      '    Second,  # trailing note',
      '):',
      '    pass',
      'class Plain:',
      '    x = 1',
      'def f(',
      '    a,',
      '):',
      '    pass',
    ])).toEqual(['Multi:1:First', 'Multi:1:Second']);
  });

  it('TypeScript, C#, Swift, PHP and C++ continuation lines', async () => {
    expect(await edges('/test/long.ts', [
      'export class Long',
      '  extends Base<X>',
      '  implements A, B {',
      '}',
    ])).toEqual(['Long:1:Base', 'Long:1:A', 'Long:1:B']);
    expect(await edges('/test/Long.cs', [
      'namespace Z {',
      '  public class Long<T>',
      '      : Base<T>, IThing',
      '      where T : class {',
      '  }',
      '}',
    ])).toEqual(['Long:2:Base', 'Long:2:IThing']);
    expect(await edges('/test/Long.swift', [
      'final class Long<T>:',
      '    Base,',
      '    Proto {',
      '}',
    ])).toEqual(['Long:1:Base', 'Long:1:Proto']);
    expect(await edges('/test/Long.php', [
      '<?php',
      'abstract class Long extends Base implements',
      '    A, B {',
      '}',
    ])).toEqual(['Long:2:Base', 'Long:2:A', 'Long:2:B']);
    expect(await edges('/test/Long.hpp', [
      'class Long',
      '    : public Base',
      '{',
      '};',
    ])).toEqual(['Long:1:Base']);
  });

  it('a new declaration ends the header; only the open C statement is joined', () => {
    const { joins, consumed } = buildTypeHeaderJoins([
      'class A',
      'class B : Base {',
      'struct foo *p = make(',
      '  1,',
      ');',
    ]);
    expect([...joins.keys()]).toEqual([2]);
    expect(consumed.has(1)).toBe(false);
  });
});

describe('inheritance precision', () => {
  it('a class keyword inside a string literal is not a declaration', async () => {
    expect(await edges('/test/Str.java', [
      'public class Simple implements Runnable {',
      '  String s = "class Str extends Strung {";',
      '}',
    ])).toEqual(['Simple:1:Runnable']);
    expect(await edges('/test/str.ts', [
      'const s = "class Str extends Strung {";',
      'const t = `class T extends U`;',
      'export const C = class Named extends Other {};',
    ])).toEqual(['C:3:Other']);
  });

  it('a namespace never inherits (drogon partial specialization is not an entity)', async () => {
    expect(await edges('/test/coroutine.h', [
      'namespace drogon {',
      'namespace internal {',
      'template <typename T>',
      'struct WhenAllAwaiter<std::vector<Task<T>>>',
      '    : public CallbackAwaiter<std::vector<T>>',
      '{',
      '};',
      'struct Plain : public Base {',
      '};',
      '}',
      '}',
    ])).toEqual(['Plain:8:Base']);
  });

  it('a one-line declaration: the list belongs to the type, not its first member', async () => {
    expect(await edges('/test/Color.java', [
      'enum Color implements Paint { RED }',
    ])).toEqual(['Color:1:Paint']);
    expect(await edges('/test/Dog.kt', [
      'class Dog {',
      '  companion object Factory : Creator<Dog> { fun make() = Dog() }',
      '}',
    ])).toEqual(['Factory:2:Creator']);
  });
});
