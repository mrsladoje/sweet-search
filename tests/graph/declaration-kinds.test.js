/**
 * Declaration kinds for grammars that use one node type for several kinds.
 *
 * tree-sitter-kotlin parses `class`, `interface` and `enum class` as
 * `class_declaration`; tree-sitter-swift parses class / struct / enum /
 * extension / actor as `class_declaration` with a `declaration_kind` field.
 * The graph entity type and the chunk type must carry the real kind
 * (ss-search prints it: "interface Chain"). Other languages must not change:
 * GenCodeSearchNet (go/java/javascript/php/python/ruby) ranking reads chunk
 * and entity types, so their kinds stay byte-identical.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let provider;
let refineDeclarationKind;
let resetTreeSitterProvider;

beforeAll(async () => {
  const mod = await import('../../core/infrastructure/tree-sitter-provider.js');
  refineDeclarationKind = mod.refineDeclarationKind;
  resetTreeSitterProvider = mod.resetTreeSitterProvider;
  provider = mod.getTreeSitterProvider();
});

afterAll(() => {
  if (resetTreeSitterProvider) resetTreeSitterProvider();
});

async function kinds(code, lang) {
  const symbols = await provider.extractSymbols(code, lang);
  expect(symbols, `${lang} grammar unavailable`).not.toBeNull();
  return Object.fromEntries(symbols.map(s => [s.name, s.type]));
}

/** Chunk types by name; a small max size keeps every declaration its own chunk. */
async function chunkKinds(code, lang) {
  const chunks = await provider.parseFileToChunks(code, lang, { maxChunkSize: 60 });
  expect(chunks, `${lang} chunker returned null`).not.toBeNull();
  const out = {};
  for (const c of chunks) if (c.name && !(c.name in out)) out[c.name] = c.type;
  return out;
}

const KOTLIN = `
interface Chain {
    fun proceed(request: Request): Response
}
enum class Color { RED, GREEN, BLUE }
class Foo(val x: Int) : Chain {
    override fun proceed(request: Request): Response = TODO()
    companion object {
        fun create(): Foo = Foo(1)
    }
}
object Registry {
    fun lookup(name: String): Foo? = null
}
data class Point(val x: Int, val y: Int)
sealed class Result
annotation class Marker
`;

const SWIFT = `
class Database {
    func execute() {}
}
struct Row {
    var values: [String]
}
enum Mode {
    case read
    case write
}
extension Database {
    func vacuum() {}
}
actor Pool {
    func acquire() {}
}
protocol Cursor {
    func next() -> Row?
}
final class Writer: Database {
    override func execute() {}
}
indirect enum Expr {
    case leaf
}
`;

describe('Kotlin declaration kinds', () => {
  it('graph entities carry interface / enum / object / class', async () => {
    const k = await kinds(KOTLIN, 'kotlin');
    expect(k.Chain).toBe('interface');
    expect(k.Color).toBe('enum');
    expect(k.Foo).toBe('class');
    expect(k.Companion).toBe('object');
    expect(k.Registry).toBe('object');
    expect(k.Point).toBe('class');
    expect(k.Result).toBe('class');
    expect(k.Marker).toBe('class');
  });

  it('chunks carry the same kinds', async () => {
    const k = await chunkKinds(KOTLIN, 'kotlin');
    expect(k.Chain).toBe('interface');
    expect(k.Color).toBe('enum');
    expect(k.Foo).toBe('class');
    expect(k.Registry).toBe('object');
  });
});

describe('Swift declaration kinds', () => {
  it('graph entities carry class / struct / enum / actor; protocol stays interface', async () => {
    const k = await kinds(SWIFT, 'swift');
    expect(k.Database).toBe('class');
    expect(k.Row).toBe('struct');
    expect(k.Mode).toBe('enum');
    expect(k.Pool).toBe('actor');
    expect(k.Cursor).toBe('interface');
    expect(k.Writer).toBe('class');
    expect(k.Expr).toBe('enum');
  });

  it('chunks carry the same kinds, extensions included', async () => {
    const chunks = await provider.parseFileToChunks(SWIFT, 'swift', { maxChunkSize: 60 });
    const byKind = (type) => chunks.filter(c => c.type === type).map(c => c.name);
    expect(byKind('struct')).toContain('Row');
    expect(byKind('enum')).toEqual(expect.arrayContaining(['Mode', 'Expr']));
    expect(byKind('actor')).toContain('Pool');
    expect(byKind('extension').length).toBe(1);
    expect(byKind('class')).toEqual(expect.arrayContaining(['Database', 'Writer']));
    expect(byKind('class')).not.toContain('Row');
  });

  it('members of a struct / actor keep their container name', async () => {
    const symbols = await provider.extractSymbols(SWIFT, 'swift');
    expect(symbols.find(s => s.name === 'acquire')?.parentClass).toBe('Pool');
    expect(symbols.find(s => s.name === 'vacuum')?.parentClass).toBe('Database');
  });
});

describe('graph extraction end to end', () => {
  it('stores the Kotlin interface kind and keeps the implements edge', async () => {
    const { GraphExtractor } = await import('../../core/graph/graph-extractor.js');
    const extractor = new GraphExtractor();
    const result = await extractor.extractFromFile('/test/Interceptor.kt', KOTLIN);
    const chain = result.entities.find(e => e.name === 'Chain');
    expect(chain?.type).toBe('interface');
    expect(result.entities.find(e => e.name === 'Registry')?.type).toBe('object');
    const foo = result.entities.find(e => e.name === 'Foo');
    expect(result.relationships.some(r => r.source_id === foo.id
      && r.type === 'extends' && r.target_name === 'Chain')).toBe(true);
  });
});

describe('other languages are unchanged (GenCodeSearchNet parity)', () => {
  const CASES = [
    ['java', 'public class Service {\n  void run() {}\n}\ninterface Port {\n  void open();\n}\nenum Level { LOW, HIGH }\n',
      { Service: 'class', Port: 'interface', Level: 'enum' }],
    ['javascript', 'class Router {\n  route() { return 1; }\n}\n', { Router: 'class' }],
    ['typescript', 'class Store {\n  get(): number { return 1; }\n}\ninterface Shape {\n  area(): number;\n}\n',
      { Store: 'class', Shape: 'interface' }],
    ['php', '<?php\nclass Controller {\n  public function index() { return []; }\n}\ninterface Repo {}\n',
      { Controller: 'class', Repo: 'interface' }],
    ['python', 'class Model:\n    def save(self):\n        return 1\n', { Model: 'class' }],
    ['ruby', 'class Engine\n  def start\n    1\n  end\nend\n', { Engine: 'class' }],
    ['go', 'package x\ntype Server struct {\n  port int\n}\ntype Handler interface {\n  Serve()\n}\n',
      { Server: 'struct', Handler: 'interface' }],
    ['csharp', 'class Session {\n  void Run() {}\n}\nstruct Span {\n  int x;\n}\n', { Session: 'class', Span: 'struct' }],
  ];

  for (const [lang, code, expected] of CASES) {
    it(`${lang}: entity kinds stay as before`, async () => {
      const k = await kinds(code, lang);
      for (const [name, type] of Object.entries(expected)) expect(k[name], `${lang} ${name}`).toBe(type);
    });

    it(`${lang}: chunk kinds stay as before`, async () => {
      const chunks = await provider.parseFileToChunks(code, lang, { maxChunkSize: 60 });
      for (const c of chunks || []) {
        expect(['object', 'actor', 'extension']).not.toContain(c.type);
      }
      const k = await chunkKinds(code, lang);
      for (const [name, type] of Object.entries(expected)) {
        if (k[name] !== undefined) expect(k[name], `${lang} ${name}`).toBe(type);
      }
    });
  }

  it('refineDeclarationKind is a no-op for non-Kotlin/Swift languages', async () => {
    const tree = await provider.parse('class A {}\ninterface B {}\n', 'java');
    const nodes = tree.rootNode.namedChildren;
    for (const lang of ['java', 'javascript', 'typescript', 'php', 'python', 'ruby', 'go', 'csharp', undefined, null]) {
      for (const n of nodes) {
        expect(refineDeclarationKind(n, lang, 'class')).toBe('class');
        expect(refineDeclarationKind(n, lang, 'code')).toBe('code');
      }
    }
    tree.delete();
  });
});
