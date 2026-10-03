/**
 * Chunker follow-ups found while finishing the chunker branch (OBSERVATIONS.md
 * chunker entries). Real tree-sitter grammars; shapes copied from
 * eval/repos/r3-drogon, r3-typedoc and r3-grdb.
 *
 *   a. C/C++ function chunks are named from the declarator chain, never from
 *      the return type (`template <typename T> const T &get()` was `T`,
 *      `void create::detail()` was null). Same name as the graph entity.
 *   b. JS/TS exported declarations (`export class`, `export default class`,
 *      `export abstract class`) are class chunks named after the class, not
 *      `code` chunks with no name.
 *   c. Swift `#if` / `#endif` lines are made readable for the grammar in
 *      parse(), so the chunker and extractSymbols see the same tree, and the
 *      directive text stays in a chunk.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterProvider } from '../../core/infrastructure/tree-sitter-provider.js';

let provider;
beforeAll(async () => {
  provider = new TreeSitterProvider();
  expect(await provider.isAvailable()).toBe(true);
});

const chunk = (content, lang) => provider.parseFileToChunks(content, lang);

/** Every non-whitespace character of the file is in exactly one chunk. */
function expectAllTextKept(content, chunks) {
  const covered = new Uint8Array(content.length);
  for (const c of chunks) {
    const at = content.indexOf(c.text, content.split('\n').slice(0, c.startLine).join('\n').length);
    expect(at, `chunk ${c.name} is a source slice`).toBeGreaterThanOrEqual(0);
    for (let i = at; i < at + c.text.length; i++) covered[i]++;
  }
  for (let i = 0; i < content.length; i++) {
    if (/\s/.test(content[i])) continue;
    expect(covered[i], `char ${i} ${JSON.stringify(content.slice(i, i + 20))}`).toBe(1);
  }
}

const allNames = chunks => chunks.flatMap(c => [c.name, ...(c.additionalSymbols || [])]);

describe('a. C/C++ function chunk names', () => {
  // Each function is large enough to be a chunk of its own.
  const body = (n) => `{\n${Array.from({ length: n }, (_, i) => `    doSomething(${i}, "padding text for size");`).join('\n')}\n}\n`;
  const CPP = [
    'namespace drogon {',
    'class HttpViewData {',
    '  public:',
    '    template <typename T>',
    `    const T &get(const std::string &key) const\n    ${body(40)}`,
    '};',
    '}',
    `template <typename T>\nconst T &getItem(const std::string &key)\n${body(40)}`,
    `std::string create::detail()\n${body(40)}`,
    `static void createFilterSourceFile(std::ofstream &file)\n${body(40)}`,
    `template <>\ninline std::string fromString<std::string>(const std::string &p)\n${body(40)}`,
    `HttpResponsePtr makeResponse(int code)\n${body(40)}`,
    `Cookie::operator bool() const\n${body(40)}`,
  ].join('\n');

  it('names come from the declarator, not the return type', async () => {
    const chunks = await chunk(CPP, 'cpp');
    const fnNames = chunks.filter(c => c.type === 'function').map(c => c.name);
    expect(fnNames).toEqual(expect.arrayContaining([
      'getItem', 'detail', 'createFilterSourceFile', 'fromString', 'makeResponse', 'operator bool',
    ]));
    expect(allNames(chunks)).not.toContain('T');
    expect(allNames(chunks)).not.toContain('HttpResponsePtr');
    expect(chunks.filter(c => c.type === 'function' && !c.name)).toEqual([]);
  });

  it('chunk names agree with the graph entity on the same line', async () => {
    const chunks = await chunk(CPP, 'cpp');
    const symbols = await provider.extractSymbols(CPP, 'cpp');
    const byLine = new Map(symbols.filter(s => /function|method/.test(s.type)).map(s => [s.startLine, s.name]));
    let compared = 0;
    for (const c of chunks.filter(k => k.type === 'function')) {
      for (let l = c.startLine; l <= c.startLine + 2; l++) {
        if (byLine.has(l) && byLine.get(l) !== '<anonymous:method>') {
          expect(c.name).toBe(byLine.get(l));
          compared++;
          break;
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(3);
  });

  it('C: `int main()` and `void f(void)` are named', async () => {
    const src = '#include <uuid.h>\nint main()\n{\n    uuid_t uu;\n    uuid_generate(uu);\n    return 0;\n}\n';
    const chunks = await chunk(src, 'c');
    expect(allNames(chunks)).toContain('main');
    expect(chunks.filter(c => c.type === 'function' && !c.name)).toEqual([]);
  });
});

describe('b. JS/TS exported classes', () => {
  const pad = (n) => Array.from({ length: n }, (_, i) => `  field${i}: string = "padding text";`).join('\n');
  const TS = [
    `export class Foo {\n${pad(40)}\n  m() { return 1; }\n}`,
    `export default class Bar {\n${pad(40)}\n  x() {}\n}`,
    `export abstract class Baz {\n${pad(40)}\n  abstract y(): void;\n}`,
    `abstract class Plain {\n${pad(40)}\n}`,
  ].join('\n\n');

  it('export class / export default class / export abstract class are class chunks', async () => {
    const chunks = await chunk(TS, 'typescript');
    const classes = chunks.filter(c => c.type === 'class').map(c => c.name);
    expect(classes).toEqual(['Foo', 'Bar', 'Baz', 'Plain']);
    expect(chunks.filter(c => c.type === 'code')).toEqual([]);
    // The `export` keyword starts the class chunk.
    expect(chunks.find(c => c.name === 'Foo').text.startsWith('export class Foo {')).toBe(true);
    expect(chunks.find(c => c.name === 'Baz').text.startsWith('export abstract class Baz {')).toBe(true);
    expectAllTextKept(TS, chunks);
  });

  it('small exported declarations merged into one chunk are all named', async () => {
    const src = 'export class Foo {\n  a = 1;\n}\n\nexport default class Bar {\n  x() {}\n}\nexport abstract class Baz { y(): void {} }\nexport function f() {}\nexport interface I { a: number }\n';
    const chunks = await chunk(src, 'typescript');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: 'class', name: 'Foo' });
    expect(chunks[0].additionalSymbols).toEqual(['Bar', 'Baz', 'f', 'I']);
  });

  it('an oversized exported class: header named after the class, members under it (no `unknown` parent)', async () => {
    const methods = Array.from({ length: 30 }, (_, i) => `  method${i}(a: number): number {\n    return a + ${i}; // padding padding padding\n  }`).join('\n\n');
    const src = `/**\n * Doc.\n */\nexport class Big {\n${methods}\n}\n`;
    const chunks = await chunk(src, 'typescript');
    expect(chunks[0]).toMatchObject({ type: 'class', name: 'Big' });
    expect(chunks[0].parentSymbol).toBeNull();
    expect(chunks[0].text.startsWith('/**\n * Doc.\n */\nexport class Big {')).toBe(true);
    for (const c of chunks.slice(1)) expect(c.parentSymbol).toBe('Big');
    expectAllTextKept(src, chunks);
  });

  it('javascript: export class is a class chunk', async () => {
    const src = 'export class Foo {\n  constructor() { this.a = 1; }\n}\n';
    const chunks = await chunk(src, 'javascript');
    expect(chunks[0]).toMatchObject({ type: 'class', name: 'Foo' });
  });

  it('export namespace and export const keep their behaviour', async () => {
    const src = 'export namespace NS {\n  export class Inner { a = 1; }\n}\nexport const x = 1;\n';
    const chunks = await chunk(src, 'typescript');
    expect(chunks.find(c => c.name === 'Inner')).toMatchObject({ type: 'class', parentSymbol: 'NS' });
    expectAllTextKept(src, chunks);
  });
});
