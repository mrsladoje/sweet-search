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

// =============================================================================
// Review round 2: no text is dropped; ids stay unique; macro rule edge cases.
// =============================================================================

/** Every non-whitespace character of the file is in some chunk. */
function expectFullCoverage(content, chunks) {
  const covered = new Uint8Array(content.length);
  const lines = content.split('\n');
  for (const c of chunks) {
    const from = lines.slice(0, c.startLine).reduce((n, l) => n + l.length + 1, 0);
    const at = content.indexOf(c.text, from);
    expect(at).toBeGreaterThanOrEqual(0);
    covered.fill(1, at, at + c.text.length);
  }
  const lost = [];
  for (let i = 0; i < content.length; i++) if (!covered[i] && !/\s/.test(content[i])) lost.push(content[i]);
  expect(lost.join('')).toBe('');
}

describe('no text is dropped', () => {
  const big = (n, line) => Array.from({ length: n }, (_, i) => line(i)).join('\n');

  it('python: `class A:` before an oversized __init__ keeps its line and its name', async () => {
    const src = `class A:\n    def __init__(self, x):\n${big(80, i => `        self.value_${i} = compute(x, ${i})`)}\n`;
    const chunks = await chunk(src, 'python');
    expectFullCoverage(src, chunks);
    const first = chunks[0];
    expect(first.text.startsWith('class A:')).toBe(true);
    expect([first.name, ...(first.additionalSymbols || [])]).toContain('A');
  });

  it('python: class line + docstring yields a class-typed chunk', async () => {
    const doc = big(20, i => `    Docstring line ${i} explaining the application object.`);
    const methods = big(30, i => `    def method_${i}(self):\n        return compute_value(self, ${i})`);
    const src = `class Flask(App):\n    """\n${doc}\n    """\n\n${methods}\n`;
    const chunks = await chunk(src, 'python');
    expectFullCoverage(src, chunks);
    const cls = chunks.find(c => c.name === 'Flask');
    expect(cls.type).toBe('class');
    expect(cls.text.startsWith('class Flask(App):')).toBe(true);
  });

  it('csharp: a small class after a nested namespace is kept and findable', async () => {
    const src = 'namespace Outer\n{\n    namespace Inner\n    {\n        public class A { public int Run(int x) { return x * 2 + 1; } }\n    }\n    public class B { }\n}\n';
    const chunks = await chunk(src, 'csharp');
    expectFullCoverage(src, chunks);
    expect(chunks.some(c => c.name === 'B' || (c.additionalSymbols || []).includes('B'))).toBe(true);
  });

  it('javascript: a small function after a large one is kept and findable', async () => {
    const src = `function large(a) {\n${big(90, i => `  const value${i} = compute(a, ${i});`)}\n  return a;\n}\nfunction empty() {}\n`;
    const chunks = await chunk(src, 'javascript');
    expectFullCoverage(src, chunks);
    expect(chunks.some(c => c.name === 'empty' || (c.additionalSymbols || []).includes('empty'))).toBe(true);
  });

  it('swift: a file of only `import Foundation` is one chunk', async () => {
    const src = 'import Foundation\n';
    expectFullCoverage(src, await chunk(src, 'swift'));
  });

  it('fixtures: drogon and dgraph lose no text', async () => {
    expectFullCoverage(DROGON, await chunk(DROGON, 'cpp'));
    expectFullCoverage(DGRAPH, await chunk(DGRAPH, 'go'));
  });

  it('a header that holds whole members lists their names', async () => {
    const src = `class Small {\n  int a() { return 1; }\n  int b() { return 2; }\n${big(80, i => `  int m${i}(int x) { return compute(x, ${i}); }`)}\n}\n`;
    const chunks = await chunk(src, 'java');
    const header = chunks.find(c => c.name === 'Small');
    expect(header.additionalSymbols).toEqual(expect.arrayContaining(['a', 'b']));
  });
});

describe('C/C++ export-macro rule', () => {
  for (const lang of ['cpp', 'c']) {
    it(`${lang}: \`struct HTTP_HEADER header;\` is a variable, not a macro`, async () => {
      const src = 'struct HTTP_HEADER header;\nint parse_request_with_long_name(int x) { return x + header.size; }\n';
      const chunks = await chunk(src, lang);
      expect(chunks.some(c => c.name === 'header')).toBe(false);
      const symbols = await provider.extractSymbols(src, lang);
      expect(symbols.some(s => s.name === 'header' && s.type === 'struct')).toBe(false);
    });
  }
});

describe('stable chunk ids', () => {
  const body = Array.from({ length: 80 }, (_, i) => `        int value${i} = computeSomething(argument, ${i});`).join('\n');

  it('two same-named oversized methods in different classes get distinct ids', async () => {
    const { assignStructuralIds } = await import('../../core/incremental-indexing/domain/chunk-identity.mjs');
    const method = `    public int run(int argument) {\n${body}\n        return value0;\n    }`;
    const src = `class First {\n${method}\n}\n\nclass Second {\n${method}\n}\n`;
    const chunker = new ASTChunker({ projectRoot: '/repo', useTreeSitter: true });
    const chunks = await chunker.parseFile('/repo/Two.java', src);
    expect(chunks.filter(c => /^run \(part \d+\)$/.test(c.metadata.symbol)).length).toBeGreaterThanOrEqual(4);
    const ids = assignStructuralIds(chunks, 'Two.java');
    expect(new Set(ids.map(x => x.chunkStructId)).size).toBe(chunks.length);
    // Unique without the occurrence suffix: the path tells the classes apart.
    expect(ids.filter(x => x.reason === 'symbol' && x.occurrenceIndex > 0)).toEqual([]);
  });

  it('overloads get distinct ids through the stored signature', async () => {
    const { assignStructuralIds } = await import('../../core/incremental-indexing/domain/chunk-identity.mjs');
    const src = `class Over {\n    public int run(int argument) {\n${body}\n        return 0;\n    }\n    public int run(long argument) {\n${body}\n        return 1;\n    }\n}\n`;
    const chunker = new ASTChunker({ projectRoot: '/repo', useTreeSitter: true });
    const chunks = await chunker.parseFile('/repo/Over.java', src);
    const ids = assignStructuralIds(chunks, 'Over.java');
    expect(new Set(ids.map(x => x.chunkStructId)).size).toBe(chunks.length);
    expect(ids.filter(x => x.reason === 'symbol' && x.occurrenceIndex > 0)).toEqual([]);
  });

  it('identical declarations (both #if branches) still get distinct ids', async () => {
    const { assignStructuralIds } = await import('../../core/incremental-indexing/domain/chunk-identity.mjs');
    const mk = () => ({ text: 'int f() { return 1; }', metadata: { chunk_type: 'function', symbol: 'f', signature: 'int f()' } });
    const ids = assignStructuralIds([mk(), mk()], 'a.c');
    expect(ids[0].chunkStructId).not.toBe(ids[1].chunkStructId);
  });
});

// =============================================================================
// Review round 3: Go header size, export macro on forward declarations, cap.
// =============================================================================

describe('Go: newline tokens do not grow the header', () => {
  it('a 2,300-char function with no blank lines keeps a header of ~600 chars', async () => {
    const stmts = Array.from({ length: 90 }, (_, i) => `\tvalue${i} := compute(a, ${i})`).join('\n');
    const src = `package x\n\nfunc big(a int) int {\n${stmts}\n\treturn a\n}\n`;
    expect(src.length).toBeGreaterThan(2300);
    const chunks = await chunk(src, 'go');
    const header = chunks.find(c => c.name === 'big');
    expect(header.text.length).toBeLessThanOrEqual(600);
    expect(chunks.filter(c => c.name?.startsWith('big (part ')).length).toBeGreaterThanOrEqual(1);
    expectSliceInvariants(src, chunks);
    expectFullCoverage(src, chunks);
  });
});

describe('C/C++ export macro on a forward declaration', () => {
  for (const lang of ['cpp', 'c']) {
    it(`${lang}: \`struct ABC_EXPORT Fwd;\` names Fwd; \`struct HTTP_HEADER header;\` stays a variable`, async () => {
      const src = 'struct ABC_EXPORT Fwd;\nstruct HTTP_HEADER header;\nint parse_request_with_long_name(int x) { return x + header.size; }\n';
      const symbols = await provider.extractSymbols(src, lang);
      const names = symbols.map(s => s.name);
      expect(names).not.toContain('ABC_EXPORT');
      expect(names).not.toContain('header');
    });

    it(`${lang}: a lower-case forward declaration with a #defined export macro`, async () => {
      const src = '#define MYLIB_API\nstruct MYLIB_API event_base;\nint run_loop_with_long_name(int x) { return x * 2 + 1; }\n';
      const symbols = await provider.extractSymbols(src, lang);
      expect(symbols.map(s => s.name)).not.toContain('MYLIB_API');
    });
  }
});

describe('carried tokens respect the chunk cap', () => {
  it('opening tokens before a node that nearly fills the cap become their own chunk', async () => {
    const body = Array.from({ length: 60 }, (_, i) => `    int v${i} = f(${i});`).join('\n');
    let inner = `int fill(void) {\n${body}\n    return 0;\n}`;
    // Pad the function to 1,995 chars with a comment inside its body.
    inner = inner.replace('    return 0;', `    /*${'x'.repeat(1995 - inner.length - 9)}*/\n    return 0;`);
    expect(inner.length).toBe(1995);
    const src = `int g;\n${inner}\n`;
    const chunks = await chunk(src, 'c');
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(2000);
    expectFullCoverage(src, chunks);
  });
});
