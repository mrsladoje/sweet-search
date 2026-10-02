/**
 * Chunker fixes C, D, E (OBSERVATIONS.md 2026-10-02, entries "Chunker: C++/C#/Ruby
 * namespace chunks and the export macro" and "Chunker: a large function splits
 * into a junk signature chunk…"). Real tree-sitter grammars on fixtures copied
 * from eval/repos/r3-drogon and eval/repos/r3-dgraph.
 *
 *   C. Namespace / module wrappers are transparent: the body is chunked with
 *      the namespace as parent info; no namespace-labelled chunk wraps a class.
 *   D. The C/C++ export macro is blanked in parse(), so the chunker and the
 *      graph agree (no `function: HttpViewData`, no `class: DROGON_EXPORT`).
 *   E. An oversized declaration gives a header chunk (doc comment + signature
 *      + first body statements) and body chunks named `Foo (part N)`; no
 *      one-token-per-line signature chunk; every chunk is one source slice;
 *      no line is in two chunks.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterProvider } from '../../core/infrastructure/tree-sitter-provider.js';
import { ASTChunker } from '../../core/indexing/ast-chunker.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'chunker');
const DROGON = fs.readFileSync(path.join(FIXTURES, 'drogon-HttpViewData.h'), 'utf8');
const DGRAPH = fs.readFileSync(path.join(FIXTURES, 'dgraph-export.go'), 'utf8');

let provider;
beforeAll(async () => {
  provider = new TreeSitterProvider();
  expect(await provider.isAvailable()).toBe(true);
});

const chunk = (content, lang) => provider.parseFileToChunks(content, lang);

/** Shared structural invariants for every chunk list. */
function expectSliceInvariants(content, chunks, { maxSize = 2000 } = {}) {
  const lines = content.split('\n');
  const owner = new Map();
  for (const c of chunks) {
    // One source slice: the text is a contiguous substring of the file and
    // of its own line range, and its line count equals the range.
    expect(content.includes(c.text)).toBe(true);
    expect(lines.slice(c.startLine, c.endLine + 1).join('\n').includes(c.text)).toBe(true);
    expect(c.text.split('\n').length).toBe(c.endLine - c.startLine + 1);
    expect(c.text.length).toBeLessThanOrEqual(maxSize * 1.25);
    // No line indexed twice.
    for (let l = c.startLine; l <= c.endLine; l++) {
      expect(owner.has(l), `line ${l + 1} in ${owner.get(l)} and ${c.name}`).toBe(false);
      owner.set(l, c.name);
    }
  }
}

/** A chunk of 3+ lines where every line is one token: `func\nName\n(args)\n(ret)`. */
const isJunkSignature = c => {
  const ls = c.text.split('\n');
  return ls.length >= 3 && ls.every(l => !/\s/.test(l.trim()));
};

describe('C + D: drogon HttpViewData.h (namespace + DROGON_EXPORT)', () => {
  it('labels the class, not the namespace or the macro', async () => {
    const chunks = await chunk(DROGON, 'cpp');
    expect(chunks.filter(c => c.type === 'namespace')).toEqual([]);
    expect(chunks.some(c => c.name === 'DROGON_EXPORT')).toBe(false);
    expect(chunks.some(c => c.type === 'function' && c.name === 'HttpViewData')).toBe(false);

    const header = chunks.find(c => c.name === 'HttpViewData');
    expect(header.type).toBe('class');
    expect(header.parentSymbol).toBe('drogon');
    expect(header.parentType).toBe('namespace');
    // The doc comment above the class is in its header chunk (with the
    // namespace's opening line, too small to be a chunk); the source text
    // keeps the macro.
    expect(header.text.startsWith('namespace drogon\n{\n/// This class represents the data set displayed in views.')).toBe(true);
    expect(header.text).toContain('class DROGON_EXPORT HttpViewData');

    // Members are chunked with the class as parent.
    const members = chunks.filter(c => c.parentSymbol === 'HttpViewData');
    expect(members.length).toBeGreaterThanOrEqual(2);
    expectSliceInvariants(DROGON, chunks);
  });

  it('graph entities still name the class (macro blanking shared with parse())', async () => {
    const symbols = await provider.extractSymbols(DROGON, 'cpp');
    const names = symbols.map(s => s.name);
    expect(names).toContain('HttpViewData');
    expect(names).not.toContain('DROGON_EXPORT');
    const cls = symbols.find(s => s.name === 'HttpViewData');
    expect(cls.type).toBe('class');
    expect(symbols.find(s => s.name === 'insert')?.parentClass).toBe('HttpViewData');
  });

  it('a small C++ namespace holding one class gives a class chunk', async () => {
    const src = [
      'namespace drogon',
      '{',
      '/// Doc for the class.',
      'class DROGON_EXPORT HttpViewData',
      '{',
      '  public:',
      '    int get() const',
      '    {',
      '        return 1;',
      '    }',
      '};',
      '}  // namespace drogon',
      '',
    ].join('\n');
    const chunks = await chunk(src, 'cpp');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'class', name: 'HttpViewData', parentSymbol: 'drogon', parentType: 'namespace' });
    expect(chunks[0].text).toBe(src.trim());
  });

  it('nested and anonymous C++ namespaces: innermost name is the parent', async () => {
    const src = 'namespace a {\nnamespace b {\nclass Widget { public: int size() const { return 42; } };\n}\n}\nnamespace {\nint helperFunctionWithLongName(int x) { return x * 2 + 1; }\n}\n';
    const chunks = await chunk(src, 'cpp');
    expect(chunks.some(c => c.type === 'namespace')).toBe(false);
    expect(chunks.find(c => c.name === 'Widget')?.parentSymbol).toBe('b');
  });
});

describe('C: namespace / module wrappers in other languages', () => {
  const cases = [
    ['csharp', 'namespace App\n{\n    public class Store\n    {\n        public void Save(int id) { System.Console.WriteLine(id); }\n    }\n}\n', 'Store', 'App', 'namespace'],
    ['csharp', 'namespace App;\n\npublic class Store\n{\n    public void Save(int id) { System.Console.WriteLine(id); }\n}\n', 'Store', 'App', 'namespace'],
    ['ruby', 'module App\n  class Store\n    def save(id)\n      puts id\n    end\n  end\nend\n', 'Store', 'App', 'module'],
    ['php', '<?php\nnamespace Foo {\n    class Store {\n        public function save($id) { return $id * 2; }\n    }\n}\n', 'Store', 'Foo', 'namespace'],
  ];
  for (const [lang, src, cls, ns, nsType] of cases) {
    it(`${lang}: ${JSON.stringify(src.split('\n')[0])} → class chunk with the namespace as parent`, async () => {
      const chunks = await chunk(src, lang);
      expect(chunks.some(c => c.type === 'namespace' || c.type === 'module')).toBe(false);
      const c = chunks.find(x => x.name === cls);
      expect(c).toMatchObject({ type: 'class', parentSymbol: ns, parentType: nsType });
      expectSliceInvariants(src, chunks);
    });
  }

  it('typescript: export namespace is not a chunk of its own', async () => {
    const src = 'export namespace Shapes {\n  export class Circle {\n    area(r: number): number { return Math.PI * r * r; }\n  }\n}\n';
    const chunks = await chunk(src, 'typescript');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].parentSymbol).toBe('Shapes');
    expect(chunks[0].type).not.toBe('namespace');
  });

  it('php: `namespace Foo;` does not label the chunk that holds the class', async () => {
    const src = '<?php\nnamespace Foo;\n\nclass Store {\n    public function save($id) { return $id * 2; }\n}\n';
    const chunks = await chunk(src, 'php');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'class', name: 'Store' });
  });

  it('ruby: a large module is transparent and its opening line starts the first chunk', async () => {
    const methods = Array.from({ length: 30 }, (_, i) =>
      `      def method_number_${i}(arg)\n        compute_value(arg, ${i}) + other_value(arg)\n      end`).join('\n\n');
    const src = `module Outer\n  module Inner\n    class Store\n${methods}\n    end\n  end\nend\n`;
    const chunks = await chunk(src, 'ruby');
    expect(chunks.some(c => c.type === 'module')).toBe(false);
    expect(chunks[0].text.startsWith('module Outer\n  module Inner')).toBe(true);
    expect(chunks.find(c => c.name === 'Store')?.parentSymbol).toBe('Inner');
    expectSliceInvariants(src, chunks);
  });
});

describe('E: dgraph export.go (oversized Go functions)', () => {
  let chunks;
  beforeAll(async () => { chunks = await chunk(DGRAPH, 'go'); });

  it('emits no one-token-per-line signature chunk', () => {
    expect(chunks.filter(isJunkSignature)).toEqual([]);
    expect(chunks.some(c => c.text.includes('func\nToExportKvList'))).toBe(false);
  });

  it('ToExportKvList: header + named body parts, no overlap', () => {
    const parts = chunks.filter(c => c.name?.startsWith('ToExportKvList'));
    expect(parts.map(c => c.name)).toEqual([
      'ToExportKvList', 'ToExportKvList (part 2)', 'ToExportKvList (part 3)',
    ]);
    const [header, ...body] = parts;
    expect(header.type).toBe('function');
    expect(header.parentSymbol).toBeNull();
    expect(header.text.startsWith('func ToExportKvList(pk x.ParsedKey')).toBe(true);
    // The header ends where the first body chunk starts.
    expect(body[0].startLine).toBeGreaterThan(header.endLine);
    for (const b of body) {
      expect(b.type).toBe('function');
      expect(b.parentSymbol).toBe('ToExportKvList');
    }
    // Body text is the file text (tabs kept), not a `\n` join of siblings.
    expect(body[0].text.startsWith('switch {\n\t// These predicates are not required')).toBe(true);
    // The last statement of the function is indexed.
    expect(body[body.length - 1].text).toContain('return emptyList, nil\n}');
  });

  it('exportInternal: the doc comment opens the header chunk', () => {
    const header = chunks.find(c => c.name === 'exportInternal');
    expect(header.text.startsWith('// exportInternal contains the core logic')).toBe(true);
    expect(header.text).toContain('func exportInternal(ctx context.Context');
    expect(chunks.filter(c => c.name?.startsWith('exportInternal (part ')).length).toBeGreaterThanOrEqual(2);
  });

  it('every chunk is one source slice, within the cap, with no duplicate lines', () => {
    expectSliceInvariants(DGRAPH, chunks);
  });

  it('ASTChunker metadata: line_end agrees with the text and the symbol is stored', async () => {
    const chunker = new ASTChunker({ projectRoot: '/repo', useTreeSitter: true });
    const out = await chunker.parseFile('/repo/worker/export.go', DGRAPH);
    for (const c of out) {
      expect(c.text.split('\n').length).toBe(c.metadata.line_end - c.metadata.line_start + 1);
    }
    const part2 = out.find(c => c.metadata.symbol === 'ToExportKvList (part 2)');
    expect(part2.metadata.chunk_type).toBe('function');
    expect(part2.metadata.parent_symbol).toBe('ToExportKvList');
  });
});

describe('E: oversized declarations in other languages', () => {
  const body = n => Array.from({ length: n }, (_, i) => i);

  it('python: decorators + signature open the header; no junk chunk', async () => {
    const stmts = body(80).map(i => `    value_${i} = compute_something(argument_${i}, other)`).join('\n');
    const src = `@app.route("/x")\n@cached\ndef big_handler(argument, other):\n    """Handle the big request."""\n${stmts}\n    return value_0\n`;
    const chunks = await chunk(src, 'python');
    expect(chunks.filter(isJunkSignature)).toEqual([]);
    expect(chunks[0].text.startsWith('@app.route("/x")\n@cached\ndef big_handler(argument, other):')).toBe(true);
    expect(chunks.slice(1).every(c => c.name?.startsWith('big_handler (part '))).toBe(true);
    expectSliceInvariants(src, chunks);
  });

  it('java: oversized method inside a class keeps the class as parent', async () => {
    const stmts = body(80).map(i => `        int value${i} = computeSomething(argument, ${i});`).join('\n');
    const src = `class Big {\n    /** Does the work. */\n    public int work(int argument) {\n${stmts}\n        return value0;\n    }\n}\n`;
    const chunks = await chunk(src, 'java');
    expect(chunks.filter(isJunkSignature)).toEqual([]);
    const header = chunks.find(c => c.name === 'work');
    // The method's doc comment opens its header (the class opening line is
    // too small for a chunk of its own and joins it).
    expect(header.text).toContain('/** Does the work. */\n    public int work(int argument) {');
    expect(header.parentSymbol).toBe('Big');
    expect(chunks.filter(c => c.name?.startsWith('work (part ')).length).toBeGreaterThanOrEqual(1);
    expectSliceInvariants(src, chunks);
  });

  it('rust and kotlin: no junk signature chunk, header names the function', async () => {
    const rs = `fn big(a: i32) -> i32 {\n${body(90).map(i => `    let value_${i} = compute_something(a, ${i});`).join('\n')}\n    a\n}\n`;
    const kt = `fun big(a: Int): Int {\n${body(90).map(i => `    val value${i} = computeSomething(a, ${i})`).join('\n')}\n    return a\n}\n`;
    for (const [src, lang] of [[rs, 'rust'], [kt, 'kotlin']]) {
      const chunks = await chunk(src, lang);
      expect(chunks.filter(isJunkSignature)).toEqual([]);
      expect(chunks[0].name).toBe('big');
      expect(chunks[0].text.split('\n')[0]).toMatch(/^(fn|fun) big\(a: /);
      expectSliceInvariants(src, chunks);
    }
  });
});
