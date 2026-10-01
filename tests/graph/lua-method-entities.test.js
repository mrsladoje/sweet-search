/**
 * Lua method definitions (`function List:clone()`) were stored under the
 * table's name (`List`), so every method of a class was an entity named
 * `List` and a bare `List()` call resolved to 23 "overloads". They are now
 * dotted like `function M.helper()`.
 */
import { describe, it, expect } from 'vitest';
import { GraphExtractor } from '../../core/graph/graph-extractor.js';

describe('Lua method entities', () => {
  it('names `function T:m()` as T.m and keeps `function M.f()` and `local function f()`', async () => {
    const src = [
      'local List = {}',
      'function List:clone()',
      '  return List(self)',
      'end',
      'function List.new(t)',
      '  return t',
      'end',
      'local function helper(x)',
      '  return x',
      'end',
    ].join('\n');
    const out = await new GraphExtractor({ projectRoot: '/nonexistent' }).extractFromFile('lua/pl/List.lua', src);
    const names = out.entities.filter(e => e.type === 'function').map(e => e.name);
    expect(names).toEqual(['List.clone', 'List.new', 'helper']);
  });
});
