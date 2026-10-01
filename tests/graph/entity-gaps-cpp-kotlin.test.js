/**
 * Entity gaps found by the relations work:
 * - C++ `class DROGON_EXPORT HttpRequest` became a one-line class named
 *   `DROGON_EXPORT` and lost every member (the grammar read the macro as the
 *   name); its extends edges had the wrong source.
 * - Kotlin companion objects had no entity.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let GraphExtractor;
let resetTreeSitterProvider;

beforeAll(async () => {
  ({ GraphExtractor } = await import('../../core/graph/graph-extractor.js'));
  ({ resetTreeSitterProvider } = await import('../../core/infrastructure/tree-sitter-provider.js'));
});

afterAll(() => {
  if (resetTreeSitterProvider) resetTreeSitterProvider();
});

describe('entity gaps', () => {
  it('C++: an export macro is not the class name (drogon HttpRequest)', async () => {
    const ex = new GraphExtractor();
    const { entities, relationships } = await ex.extractFromFile('lib/inc/HttpRequest.h', [
      'namespace drogon {',
      'class DROGON_EXPORT HttpRequest : public HttpMessage',
      '{',
      '  public:',
      '    void setPath(const std::string &p) { path_ = p; }',
      '};',
      'class Plain final : public HttpRequest',
      '{',
      '};',
      '}',
    ].join('\n'));
    const names = entities.filter(e => e.type === 'class').map(e => `${e.name}:${e.start_line}-${e.end_line}`);
    expect(names).toEqual(['HttpRequest:2-6', 'Plain:7-9']);
    const byId = new Map(entities.map(e => [e.id, e.name]));
    const ext = relationships.filter(r => r.type === 'extends').map(r => `${byId.get(r.source_id)}->${r.target_name}`);
    expect(ext).toEqual(['HttpRequest->HttpMessage', 'Plain->HttpRequest']);
  });

  it('C++: an ALL-CAPS class name followed by a base list is still a name', async () => {
    const ex = new GraphExtractor();
    const { entities } = await ex.extractFromFile('src/io.cpp', 'class IO : public Base\n{\n};\nstruct RGB final\n{\n};\n');
    expect(entities.filter(e => e.type === 'class' || e.type === 'struct').map(e => e.name)).toEqual(['IO', 'RGB']);
  });

  it('Kotlin: companion objects are entities; members keep the outer class as parent', async () => {
    const ex = new GraphExtractor();
    const { entities } = await ex.extractFromFile('okhttp/Cache.kt', [
      'class Cache : Closeable {',
      '  companion object Factory {',
      '    fun key(url: HttpUrl): String = url.toString()',
      '  }',
      '}',
      'class Body {',
      '  companion object {',
      '    fun create(): Body = Body()',
      '  }',
      '}',
    ].join('\n'));
    const got = entities.map(e => `${e.name}:${e.parent_class || ''}`).sort();
    expect(got).toEqual(['Body:', 'Cache:', 'Companion:Body', 'Factory:Cache', 'create:Body', 'key:Cache']);
  });
});
