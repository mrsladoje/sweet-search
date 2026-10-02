/**
 * The JS literal extractor (extractRequiredLiteralsHeuristic) and the case-insensitive literal
 * rule of extractLiteralClauses. A prefilter literal must be a substring of EVERY match: a wrong
 * one is a silent zero (`ss-grep express -i -w` -> `(?i)\b(?:express)\b` used to yield
 * ":express"; `\broute` yielded "broute"). When unsure the extractor returns nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  extractLiteralClauses,
  extractRequiredLiteralsHeuristic as lits,
} from '../../core/search/search-pattern-prefilter.js';

describe('extractRequiredLiteralsHeuristic: inline flags, groups, escapes', () => {
  it('ss-grep -i / -w / -i -w patterns give the word itself', () => {
    expect(lits('(?i)\\bfoo\\b')).toEqual(['foo']);
    expect(lits('(?i)\\b(?:express)\\b')).toEqual(['express']);
    expect(lits('\\b(?:route)\\b')).toEqual(['route']);
    expect(lits('(?i)express')).toEqual(['express']);
    expect(lits('(?i:Hello)World')).toEqual(['Hello', 'World']);
    expect(lits('(?-i)abc')).toEqual(['abc']);
  });

  it('zero-width and class escapes break a literal and are never part of one', () => {
    expect(lits('\\bfoo\\s*\\(')).toEqual(['foo']);
    expect(lits('\\d+')).toEqual([]);
    expect(lits('\\wabc\\Wdef\\Bghi\\Ajkl\\z')).toEqual(['abc', 'def', 'ghi', 'jkl']);
    expect(lits('class\\s+Auth\\w+Service')).toEqual(['class', 'Auth', 'Service']);
  });

  it('escaped punctuation is the literal char', () => {
    expect(lits('\\.')).toEqual([]);
    expect(lits('foo\\.bar\\(\\)')).toEqual(['foo.bar()']);
    expect(lits('a\\/b\\-c')).toEqual(['a/b-c']);
  });

  it('a group with an alternation contributes nothing; the rest stays', () => {
    expect(lits('(?:a|b)')).toEqual([]);
    expect(lits('(get|set)Config')).toEqual(['Config']);
    expect(lits('foo|bar')).toEqual([]);
  });

  it('optional atoms and groups contribute nothing; repeated ones do not join', () => {
    expect(lits('abc?def')).toEqual(['def']);
    expect(lits('(foo)?barx')).toEqual(['barx']);
    expect(lits('(?:foo)*barx')).toEqual(['barx']);
    expect(lits('xyz{0,2}w')).toEqual([]);
    expect(lits('(abc)+def')).toEqual(['abc', 'def']);
    expect(lits('(abc){2}def')).toEqual(['abc', 'def']);
    expect(lits('abc+?def')).toEqual(['def']); // "ab" is too short; c+ stands alone
  });

  it('character classes, POSIX classes and nested classes are skipped whole', () => {
    expect(lits('[:alpha:]')).toEqual([]);
    expect(lits('[[:alpha:]]foo')).toEqual(['foo']);
    expect(lits('[]abc]xyz')).toEqual(['xyz']);
    expect(lits('[^]x]yzw')).toEqual(['yzw']);
    expect(lits('[a[bc]]def')).toEqual(['def']);
    expect(lits('[\\]]abc')).toEqual(['abc']);
  });

  it('lookarounds consume nothing and are never required', () => {
    expect(lits('foo(?!bar)baz')).toEqual(['foo', 'baz']);
    expect(lits('foo(?=bar)')).toEqual(['foo']);
    expect(lits('(?<!abc)def')).toEqual(['def']);
    expect(lits('(?P<name>hello)')).toEqual(['hello']);
    expect(lits('(?<name>hello)')).toEqual(['hello']);
  });

  it('a `{` that is not a counted repetition is a literal char', () => {
    expect(lits('import\\s+{[^}]+}\\s+from\\s+react')).toEqual(['import', 'from', 'react']);
    expect(lits('a{2}bcd')).toEqual(['bcd']);
  });

  it('gives up on what it does not fully understand', () => {
    for (const p of ['(?x)foo bar', '\\x41bcd', '\\p{L}abc', '\\Qabc\\E', '(abc)\\1def', 'abc{,3}', 'x{ 2 }yz',
      '{2}abc', '*abc', 'abc)', '(abc', '[abc', 'abc\\', 'a**bcd', '(?#c)abc']) {
      expect(lits(p), p).toEqual([]);
    }
  });
});

describe('extractLiteralClauses: case-insensitive literals', () => {
  it('cuts at k and s, which (?i) also matches as U+212A and U+017F', () => {
    expect(extractLiteralClauses('(?i)\\b(?:express)\\b').clauses).toEqual([['expre']]);
    expect(extractLiteralClauses('(?i)\\b(?:require)\\b').clauses).toEqual([['require']]);
    expect(extractLiteralClauses('(?i)kind').clauses).toEqual([['ind']]);
    expect(extractLiteralClauses('(?i)sss').clauses).toEqual([]);
    // a case-sensitive literal is not cut
    expect(extractLiteralClauses('\\b(?:express)\\b').clauses).toEqual([['express']]);
  });

  it('an OR-clause left empty means no prefilter, never a narrower one', () => {
    expect(extractLiteralClauses('(?i)\\b(?:class|kss)\\b').clauses).toEqual([]);
    expect(extractLiteralClauses('(?i)\\b(?:class|router)\\b').clauses).toEqual([['cla'], ['router']]);
  });
});
