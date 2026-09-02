// A literal prefilter is sound only when EVERY string the regex can match contains at
// least one clause's literals. The native extractor silently drops an alternation branch
// with no usable literal:
//
//   extractRegexLiteralClauses('_color|_.*,')  ->  [['_color']]
//
// The prefilter then keeps only files containing `_color`, and every file matching the
// other branch is dropped before the regex runs. Measured once on the fresh pool: 59 lines
// lost, none holding the literal the agent sought, and the agent was told there were no
// matches. A silent, confident, wrong zero is the worst failure a search tool has.
import { describe, it, expect } from 'vitest';
import {
  extractLiteralClauses, expandAlternatives, hasAlternation,
} from '../../core/search/search-pattern-prefilter.js';

/** Does this clause set cover the string? (clauses are OR of AND-groups) */
const covered = (clauses, s) => clauses.some(cl => cl.every(lit => s.includes(lit)));

describe('hasAlternation', () => {
  it('sees a real alternation and ignores a literal pipe', () => {
    expect(hasAlternation('foo|bar')).toBe(true);
    expect(hasAlternation('(a|b)c')).toBe(true);
    expect(hasAlternation('abc[|]def')).toBe(false);   // inside a character class
    expect(hasAlternation('a\\|b')).toBe(false);       // escaped
    expect(hasAlternation('plain')).toBe(false);
  });
});

describe('expandAlternatives', () => {
  it('expands top-level and grouped alternations, preserving the language', () => {
    expect(expandAlternatives('_color|_.*,')).toEqual(['_color', '_.*,']);
    expect(expandAlternatives('abcd(x|y)')).toEqual(['abcdx', 'abcdy']);
    expect(expandAlternatives('(?:alpha|beta)gamma')).toEqual(['alphagamma', 'betagamma']);
    expect(expandAlternatives('^(get|set)Value')).toEqual(['^getValue', '^setValue']);
    expect(expandAlternatives('(a|b)(c|d)')).toEqual(['ac', 'ad', 'bc', 'bd']);
  });

  it('leaves a pattern with no alternation exactly as it is', () => {
    expect(expandAlternatives('foo.*bar')).toEqual(['foo.*bar']);
    expect(expandAlternatives('abc[|]def')).toEqual(['abc[|]def']);
    expect(expandAlternatives('(ab)+c')).toEqual(['(ab)+c']);
  });

  it('refuses a QUANTIFIED alternation group', () => {
    // `(a|b)+` matches "ab", which neither `a+` nor `b+` does. No expansion preserves the
    // language, so there is nothing sound to build a prefilter from.
    expect(expandAlternatives('(a|b)+')).toBeNull();
    expect(expandAlternatives('(foo|bar)*baz')).toBeNull();
    expect(expandAlternatives('(foo|bar){2,3}')).toBeNull();
  });

  it('refuses an alternation inside a lookaround or a named group', () => {
    // A lookahead is not part of the match, so expanding it changes what it asserts.
    expect(expandAlternatives('(?=foo|bar)x')).toBeNull();
    expect(expandAlternatives('(?!foo|bar)x')).toBeNull();
    expect(expandAlternatives('(?<name>foo|bar)')).toBeNull();
  });

  it('refuses an unbalanced pattern and one that expands past the cap', () => {
    expect(expandAlternatives('(a|b')).toBeNull();
    expect(expandAlternatives('a)b')).toBeNull();
    expect(expandAlternatives('(a|b)(c|d)(e|f)(g|h)(i|j)(k|l)')).toBeNull();   // 64 > 32
  });
});

describe('extractLiteralClauses refuses an unsound prefilter', () => {
  it('drops the prefilter when a branch carries no usable literal (the _color case)', () => {
    const r = extractLiteralClauses('_color|_.*,');
    expect(r.clauses).toEqual([]);
    expect(r.source).toBe('unsafe-alternation');
  });

  it('drops it for a short branch and a quantifier-only branch', () => {
    // `b` is under the 3-character literal floor, so its files would be prefiltered away.
    expect(extractLiteralClauses('foo|b').clauses).toEqual([]);
    expect(extractLiteralClauses('x{2,}|yyyy').clauses).toEqual([]);
    // A grouped alternation is just as unsound, and a top-level-`|` check would miss it.
    expect(extractLiteralClauses('(alpha|be)').clauses).toEqual([]);
  });

  it('keeps a sound prefilter and makes it no less selective', () => {
    const plain = extractLiteralClauses('handleError|processData');
    expect(plain.clauses).toEqual([['handleError'], ['processData']]);

    // Expanding a common prefix over the branches is MORE selective than the single
    // shared literal the extractor used to return for this shape.
    const prefixed = extractLiteralClauses('abcd(x|y)');
    expect(prefixed.clauses).toEqual([['abcdx'], ['abcdy']]);

    const anchored = extractLiteralClauses('^(get|set)Value');
    expect(anchored.clauses).toEqual([['getValue'], ['setValue']]);
  });

  it('leaves non-alternating patterns untouched', () => {
    expect(extractLiteralClauses('foo.*bar').clauses).toEqual([['foo', 'bar']]);
    expect(extractLiteralClauses('handleRequest').clauses).toEqual([['handleRequest']]);
  });

  it('SOUNDNESS: whatever survives covers every alternative of the pattern', () => {
    // The property the whole guard exists for, checked directly: for any pattern that
    // still gets a prefilter, every alternative it can match satisfies some clause.
    const patterns = [
      'handleError|processData', 'abcd(x|y)', '^(get|set)Value', 'foo.*bar',
      '(?:alpha|beta)gamma', 'renderWidget|renderGadget', '_color|_.*,', 'foo|b',
      '(alpha|be)', 'x{2,}|yyyy', '(a|b)+',
    ];
    for (const p of patterns) {
      const { clauses } = extractLiteralClauses(p);
      if (clauses.length === 0) continue;               // no prefilter: vacuously sound
      const alts = expandAlternatives(p);
      expect(alts, `${p} kept a prefilter, so it must be expandable`).not.toBeNull();
      for (const alt of alts) {
        // The literal skeleton of the alternative: metacharacters removed, which is a
        // subset of anything it can actually match, so it is the hardest case to cover.
        const skeleton = alt.replace(/[\\^$.*+?()[\]{}|]/g, '');
        expect(covered(clauses, skeleton), `${p}: clause set must cover alternative "${alt}"`).toBe(true);
      }
    }
  });

  it('refuses rather than throwing on junk input', () => {
    expect(extractLiteralClauses('').clauses).toEqual([]);
    expect(extractLiteralClauses(null).clauses).toEqual([]);
    expect(extractLiteralClauses(undefined).source).toBe('none');
  });
});
