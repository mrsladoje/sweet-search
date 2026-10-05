import { describe, it, expect } from 'vitest';
import { leadingDocStart } from '../../core/search/search-read.js';

describe('leadingDocStart', () => {
  it('climbs over the comment block right above a definition', () => {
    const lines = ['x := 1', '', '// calc does it', '// - first', 'func calc() {', '}'];
    expect(leadingDocStart(lines, 5)).toBe(3);
  });

  it('includes decorators and attributes', () => {
    const lines = ['class A:', '    @property', '    # the name', '    def name(self):'];
    expect(leadingDocStart(lines, 4)).toBe(2);
    expect(leadingDocStart(['#[derive(Debug)]', 'struct S;'], 2)).toBe(1);
  });

  it('stops at code and at a blank line', () => {
    expect(leadingDocStart(['let a = 1;', 'fn f() {}'], 2)).toBe(2);
    expect(leadingDocStart(['// orphan', '', 'fn f() {}'], 3)).toBe(3);
  });
});
