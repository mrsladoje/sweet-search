import { describe, expect, it } from 'vitest';

import { kindName, kindNameList, kindWord } from '../../core/search/kind-words.js';

describe('kind words (ss-search, ss-find, ss-read)', () => {
  it('one word per run of the same kind, plural for a run of more than one', () => {
    expect(kindNameList([{ name: 'Pool', type: 'class' }, { name: 'a', type: 'method' }, { name: 'b', type: 'method' }, { name: 'c', type: 'field' }]))
      .toBe('class Pool, methods a, b, field c');
    expect(kindNameList([{ name: 'a', type: 'method' }, { name: 'b', type: 'method' }])).toBe('methods a, b');
    expect(kindNameList([{ name: 'S', type: 'struct' }, { name: 'T', type: 'struct' }, { name: 'P', type: 'property' }]))
      .toBe('structs S, T, property P');
    expect(kindNameList([{ name: 'K', type: 'class' }, { name: 'L', type: 'class' }])).toBe('classes K, L');
  });

  it('a name with no known kind prints bare and never joins a kinded run', () => {
    expect(kindNameList([{ name: 'w', type: 'function' }, { name: 'x' }, { name: 'y', type: 'symbol' }])).toBe('function w, x, y');
    expect(kindNameList([{ name: 'unknown', type: 'code' }])).toBe('');
  });

  it('cap: the rest prints as +N more', () => {
    const four = ['a', 'b', 'c', 'd'].map((name) => ({ name, type: 'method' }));
    expect(kindNameList(four, 3)).toBe('methods a, b, c +1 more');
  });

  it('index types map to plain words', () => {
    expect(kindWord('typeAlias')).toBe('type');
    expect(kindWord('topKey')).toBe('key');
    expect(kindWord('code')).toBe('');
    expect(kindName('Chain', 'interface')).toBe('interface Chain');
  });
});
