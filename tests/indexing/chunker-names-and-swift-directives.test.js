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
