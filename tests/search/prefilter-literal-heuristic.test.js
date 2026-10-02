/**
 * The JS literal extractor (extractRequiredLiteralsHeuristic) and the case-insensitive literal
 * rule of extractLiteralClauses. A prefilter literal must be a substring of EVERY match: a wrong
 * one is a silent zero (`ss-grep express -i -w` -> `(?i)\b(?:express)\b` used to yield
 * ":express"; `\broute` yielded "broute"). When unsure the extractor returns nothing.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractLiteralClauses,
  extractRequiredLiteralsHeuristic as lits,
  hasCaseInsensitiveRegexFlag,
  prefilterLiteralClauses,
} from '../../core/search/search-pattern-prefilter.js';
import { isNativeGrepAvailable, nativeGrepLines } from '../../core/infrastructure/native-sparse-gram.js';

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

  it('\\< \\> and \\b{start} / \\b{end} / \\b{start-half} / \\b{end-half} are assertions, not text', () => {
    expect(lits('(?i)\\<foobar\\>')).toEqual(['foobar']);
    expect(lits('\\<ab')).toEqual([]);
    expect(lits('x\\>yzw')).toEqual(['yzw']);
    expect(lits('\\b{start}cde')).toEqual(['cde']);
    expect(lits('ab\\b{end}cde')).toEqual(['cde']);
    expect(lits('\\b{start-half}xyz\\b{end-half}')).toEqual(['xyz']);
  });

  it('\\p \\P \\x \\u \\U stand for one char of a class: they break a literal', () => {
    expect(lits('\\p{L}abc\\pLdef\\P{Greek}ghi')).toEqual(['abc', 'def', 'ghi']);
    expect(lits('\\x20abc\\x{41}def')).toEqual(['abc', 'def']);
    expect(lits('\\u0041abc\\u{1F600}def\\U0001F600ghi')).toEqual(['abc', 'def', 'ghi']);
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
    for (const p of ['(?x)foo bar', '\\xZZbcd', '\\b{bad}abc', '\\B{2}abc', '\\Qabc\\E', '(abc)\\1def', 'abc{,3}', 'x{ 2 }yz',
      '{2}abc', '*abc', 'abc)', '(abc', '[abc', 'abc\\', 'a**bcd', '(?#c)abc']) {
      expect(lits(p), p).toEqual([]);
    }
  });
});

describe('prefilterLiteralClauses: what each prefilter may use', () => {
  const plan = (p) => prefilterLiteralClauses(extractLiteralClauses(p).clauses,
    { caseInsensitive: hasCaseInsensitiveRegexFlag(p) });

  it('ripgrep keeps the full literal: rg -F -i folds Kelvin and long s itself', () => {
    expect(plan('(?i)\\b(?:express)\\b').rg).toEqual([['express']]);
    expect(plan('(?i)useState\\(').rg).toEqual([['useState(']]);
  });

  it('the ASCII-folding consumers cut case-insensitive literals at k and s', () => {
    expect(plan('(?i)\\b(?:express)\\b')).toMatchObject({ ascii: [['expre']], gram: [['expre']] });
    expect(plan('(?i)\\b(?:require)\\b')).toMatchObject({ ascii: [['require']], gram: [['require']] });
    expect(plan('(?i)kind').gram).toEqual([['ind']]);
    expect(plan('(?i)sss')).toMatchObject({ ascii: [], gram: [] });
    // case-sensitive: no cut
    expect(plan('\\b(?:express)\\b')).toMatchObject({ ascii: [['express']], gram: [['express']] });
  });

  it('the gram index gets span pieces: a non-span byte no longer makes the clause ineligible', () => {
    expect(plan('useState\\(').gram).toEqual([['useState']]);
    expect(plan('(?i)useState\\(')).toMatchObject({ ascii: [['tate(']], gram: [['tate']] });
    expect(plan('foo\\(bar\\)').gram).toEqual([['foo', 'bar']]);
  });

  it('an OR-clause left empty means no prefilter, never a narrower one', () => {
    expect(plan('(?i)\\b(?:class|kss)\\b')).toMatchObject({ ascii: [], gram: [] });
    expect(plan('(?i)\\b(?:class|router)\\b').gram).toEqual([['cla'], ['router']]);
    expect(plan('(?i)\\b(?:class|router)\\b').rg).toEqual([['class'], ['router']]);
  });
});

// Property test: random patterns over a small alphabet (with \<, \>, \b{..}, \p, \x, classes,
// groups, flags, quantifiers) against the real regex engine's matches on random lines: the
// native grep (Rust regex 1.12, in process, every pattern) and ripgrep (the first RG_PATTERNS
// patterns, when installed). Every line either matches must contain every literal of at least
// one clause, for each consumer, under that consumer's case folding. Deterministic seed.
const RG_OK = spawnSync('rg', ['--version'], { encoding: 'utf8' }).status === 0;
const RG_PATTERNS = 60;
describe.runIf(isNativeGrepAvailable())('property: prefilter literals never drop a line the engine matches', () => {
  it('holds for every random pattern (seeded)', () => {
    let seed = 20261002;
    const rnd = () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const CH = ['a', 'b', 'c', 'a', 'b', 'c', 'k', 's', 'A', 'B', 'K', 'S', '-', '_', '<', '>'];
    const ESC = ['\\<', '\\>', '\\b{start}', '\\b{end}', '\\b{start-half}', '\\b{end-half}', '\\b', '\\B',
      '\\.', '\\-', '\\{', '\\}', '\\(', '\\p{L}', '\\pL', '\\x20', '\\x{61}', '\\u0062', '\\w', '\\s', '\\d'];
    const atom = (d) => {
      const r = rnd();
      if (r < 0.55) return pick(CH);
      if (r < 0.75) return pick(ESC);
      if (r < 0.82) return pick(['.', '[ab]', '[^a]', '[]a]', '[[:alpha:]]', '^', '$']);
      if (d > 2) return pick(CH);
      const inner = rnd() < 0.3 ? `${seq(d + 1)}|${seq(d + 1)}` : seq(d + 1);
      return `${pick(['(', '(?:', '(?i:', '(?-i:'])}${inner})`;
    };
    const quant = () => (rnd() < 0.75 ? '' : pick(['?', '*', '+', '{0,2}', '{2}', '{1,}', '+?']));
    function seq(d) {
      let out = '';
      const n = 2 + Math.floor(rnd() * 8);
      for (let i = 0; i < n; i++) {
        const a = atom(d);
        out += a;
        if (!/^(\\[bB<>]|\^|\$)/.test(a)) out += quant();
      }
      return out;
    }
    const pattern = () => {
      let p = seq(0);
      if (rnd() < 0.1) p += `|${seq(0)}`;
      if (rnd() < 0.5) p = `(?i)${p}`;
      if (rnd() < 0.2) p = `\\b(?:${p})\\b`;
      return p;
    };
    const LINE_CH = ['a', 'b', 'c', 'k', 's', 'A', 'B', 'K', 'S', 'K', 'ſ', '-', '<', '>', ' ', '_', '{', '}', '(', 'x'];
    const lines = [];
    for (let i = 0; i < 600; i++) {
      let line = '';
      const n = 2 + Math.floor(rnd() * 12);
      for (let j = 0; j < n; j++) line += pick(LINE_CH);
      lines.push(line);
    }
    const dir = mkdtempSync(path.join(tmpdir(), 'prefilter-prop-'));
    const file = path.join(dir, 'lines.txt');
    writeFileSync(file, `${lines.join('\n')}\n`);

    const unicodeFold = (x) => x.toLowerCase().replace(/ſ/g, 's');   // what rg -i matches
    const asciiFold = (x) => x.replace(/[A-Z]/g, (c) => c.toLowerCase()); // native grep, gram index
    const covered = (clauses, line, fold) => clauses.length === 0
      || clauses.some((clause) => clause.every((lit) => fold(line).includes(fold(lit))));
    const counts = { patterns: 0, valid: 0, rgChecked: 0, withRg: 0, withAscii: 0, withGram: 0, unsound: [] };
    try {
      for (let t = 0; t < 1200; t++) {
        const p = pattern();
        counts.patterns++;
        const native = nativeGrepLines(p, dir, ['lines.txt'], false);
        if (!native) continue;                                             // invalid pattern
        counts.valid++;
        const hitLines = new Set(native.matches.map((m) => m.line));
        if (RG_OK && counts.rgChecked < RG_PATTERNS) {
          const r = spawnSync('rg', ['-n', '--no-filename', '--no-config', '-e', p, file], { encoding: 'utf8' });
          if (r.status === 0 || r.status === 1) {
            counts.rgChecked++;
            for (const hit of r.stdout.split('\n').filter(Boolean)) hitLines.add(Number(hit.slice(0, hit.indexOf(':'))));
          }
        }
        const ci = hasCaseInsensitiveRegexFlag(p);
        const sets = prefilterLiteralClauses(extractLiteralClauses(p).clauses, { caseInsensitive: ci });
        if (sets.rg.length) counts.withRg++;
        if (sets.ascii.length) counts.withAscii++;
        if (sets.gram.length) counts.withGram++;
        const same = (x) => x;
        for (const n of hitLines) {
          const line = lines[n - 1];
          const bad = [
            ['rg', sets.rg, ci ? unicodeFold : same],
            ['ascii', sets.ascii, ci ? asciiFold : same],
            ['gram', sets.gram, asciiFold],
          ].find(([, clauses, fold]) => !covered(clauses, line, fold));
          if (bad) { counts.unsound.push({ p, line, consumer: bad[0], clauses: bad[1] }); break; }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    console.log(`prefilter property: ${JSON.stringify({ ...counts, unsound: counts.unsound.length })}`);
    expect(counts.unsound).toEqual([]);
    expect(counts.valid).toBeGreaterThan(1000);
    expect(counts.withGram).toBeGreaterThan(80);
  });
});
