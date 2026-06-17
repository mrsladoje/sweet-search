/**
 * Unit tests for the ss-* CLI argument parser
 * (eval/agent-read-workflows/bin/_ss-argparse.mjs).
 *
 * Pure, deterministic string/array checks — no index, no network, no LLM.
 *
 * These lock the behaviour of the ss-grep / ss-find flag surface so the
 * double-call failure mode (an unsupported flag silently becoming the search
 * pattern, or a working input regressing to a hard error) cannot recur
 * unnoticed. The H1/H2/H3 blocks are named after the regressions caught during
 * the brutal-honesty review of the original guard.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGrepPattern,
  normalizeArgs,
  looksLikeOption,
  extractPositional,
  stripInertFlags,
  parseBoolFlag,
  parseShortFlag,
  parseFlag,
} from '../../eval/agent-read-workflows/bin/_ss-argparse.mjs';

describe('buildGrepPattern', () => {
  it('passes a plain pattern through unchanged', () => {
    expect(buildGrepPattern('WALKER', {})).toBe('WALKER');
  });
  it('-i prepends the inline (?i) flag the planner honours', () => {
    expect(buildGrepPattern('WALKER', { ignoreCase: true })).toBe('(?i)WALKER');
  });
  it('does not double-apply (?i) when the pattern already has it', () => {
    expect(buildGrepPattern('(?i)WALKER', { ignoreCase: true })).toBe('(?i)WALKER');
  });
  it('-w wraps in word boundaries', () => {
    expect(buildGrepPattern('fn', { wordBound: true })).toBe('\\b(?:fn)\\b');
  });
  it('-F escapes regex metacharacters so they are literal', () => {
    expect(buildGrepPattern('ab.c', { fixedString: true })).toBe('ab\\.c');
  });
  it('composes -i + -w in escape→wrap→case order', () => {
    expect(buildGrepPattern('WALKER', { ignoreCase: true, wordBound: true }))
      .toBe('(?i)\\b(?:WALKER)\\b');
  });
  it('composes -F + -w (escape first, then wrap)', () => {
    expect(buildGrepPattern('a.b', { fixedString: true, wordBound: true }))
      .toBe('\\b(?:a\\.b)\\b');
  });
  it('returns falsy patterns untouched', () => {
    expect(buildGrepPattern('', { ignoreCase: true })).toBe('');
    expect(buildGrepPattern(undefined, { ignoreCase: true })).toBe(undefined);
  });
});

describe('normalizeArgs', () => {
  it('H2: splits an attached short value (-k5 → -k 5)', () => {
    expect(normalizeArgs(['fn main', '-k5'])).toEqual(['fn main', '-k', '5']);
  });
  it('H3: expands a pure-boolean short bundle (-iw → -i -w)', () => {
    expect(normalizeArgs(['-iw', 'WALKER'])).toEqual(['-i', '-w', 'WALKER']);
  });
  it('expands a three-flag bundle (-iwF)', () => {
    expect(normalizeArgs(['-iwF', 'X'])).toEqual(['-i', '-w', '-F', 'X']);
  });
  it('expands a bundle ending in a value short (-ik5 → -i -k 5)', () => {
    expect(normalizeArgs(['-ik5', 'X'])).toEqual(['-i', '-k', '5', 'X']);
  });
  it('splits --name=value', () => {
    expect(normalizeArgs(['q', '--regex=foo'])).toEqual(['q', '--regex', 'foo']);
  });
  it('H1: leaves a dash-leading regex intact (not a flag)', () => {
    expect(normalizeArgs(['-?\\d+'])).toEqual(['-?\\d+']);
  });
  it('leaves a genuine unknown short flag intact for the guard', () => {
    expect(normalizeArgs(['-z', 'fn'])).toEqual(['-z', 'fn']);
  });
  it('does not split past a -- sentinel', () => {
    expect(normalizeArgs(['--', '-k5'])).toEqual(['--', '-k5']);
  });
});

describe('looksLikeOption', () => {
  const opts = ['-i', '-z', '-iw', '--ignore-case', '--color', '-C'];
  const notOpts = ['-?\\d+', '-->', 'WALKER', 'fn main', '-', '--', '', '-1.5'];
  it.each(opts)('treats %s as an option', (t) => expect(looksLikeOption(t)).toBe(true));
  it.each(notOpts)('treats %s as NOT an option', (t) => expect(looksLikeOption(t)).toBe(false));
});

describe('extractPositional', () => {
  it('H1: returns a dash-leading regex as the pattern, no error', () => {
    expect(extractPositional(['-?\\d+'])).toEqual({ pattern: '-?\\d+', unknownFlag: null });
  });
  it('flags a genuine unknown option instead of searching for it', () => {
    expect(extractPositional(['-z', 'fn'])).toEqual({ pattern: undefined, unknownFlag: '-z' });
  });
  it('flags a leftover semantic flag (-C) we do not implement', () => {
    expect(extractPositional(['-C', '2', 'fn'])).toEqual({ pattern: undefined, unknownFlag: '-C' });
  });
  it('-- lets a dash-leading literal pattern through verbatim', () => {
    expect(extractPositional(['--', '-->'])).toEqual({ pattern: '-->', unknownFlag: null });
  });
  it('takes the first token as the pattern when nothing looks like a flag', () => {
    expect(extractPositional(['hello']).pattern).toBe('hello');
  });
});

describe('stripInertFlags', () => {
  it('removes always-true no-ops without touching the pattern', () => {
    const args = ['-n', 'fn main', '--color=always', '-H'];
    stripInertFlags(args);
    expect(args).toEqual(['fn main']);
  });
  it('leaves semantic flags in place (so the guard can reject them)', () => {
    const args = ['-C', 'fn'];
    stripInertFlags(args);
    expect(args).toEqual(['-C', 'fn']);
  });
});

describe('value/bool flag parsers', () => {
  it('parseBoolFlag removes every occurrence and reports presence', () => {
    const args = ['-i', 'x', '-i'];
    expect(parseBoolFlag(args, ['-i', '--ignore-case'])).toBe(true);
    expect(args).toEqual(['x']);
    expect(parseBoolFlag(['x'], ['-i'])).toBe(false);
  });
  it('parseShortFlag consumes the value and falls back', () => {
    const args = ['p', '-k', '5'];
    expect(parseShortFlag(args, ['-k', '--top'], 20)).toBe('5');
    expect(args).toEqual(['p']);
    expect(parseShortFlag(['p'], ['-k', '--top'], 20)).toBe(20);
  });
  it('parseFlag consumes a long-flag value', () => {
    const args = ['q', '--regex', 'foo'];
    expect(parseFlag(args, '--regex', '')).toBe('foo');
    expect(args).toEqual(['q']);
  });
});

describe('end-to-end pipeline (normalize → parse → resolve → build)', () => {
  // Mirrors cmdGrep's parsing order without the SweetSearch I/O.
  function grepPattern(rawArgs) {
    const args = normalizeArgs(rawArgs);
    const ignoreCase = parseBoolFlag(args, ['-i', '--ignore-case']);
    const wordBound = parseBoolFlag(args, ['-w', '--word-regexp']);
    const fixedString = parseBoolFlag(args, ['-F', '--fixed-strings']);
    parseShortFlag(args, ['-k', '--top'], 20);
    stripInertFlags(args);
    const { pattern, unknownFlag } = extractPositional(args);
    if (unknownFlag) return { error: unknownFlag };
    return { regex: buildGrepPattern(pattern, { ignoreCase, wordBound, fixedString }) };
  }

  it('H1: dash-leading regex resolves, no error', () => {
    expect(grepPattern(['-?\\d+', '-k', '2'])).toEqual({ regex: '-?\\d+' });
  });
  it('H2: attached -k5 resolves the pattern cleanly', () => {
    expect(grepPattern(['fn main', '-k5'])).toEqual({ regex: 'fn main' });
  });
  it('H3: -iw bundle applies both flags', () => {
    expect(grepPattern(['-iw', 'WALKER'])).toEqual({ regex: '(?i)\\b(?:WALKER)\\b' });
  });
  it('genuine unknown flag is reported, not searched for', () => {
    expect(grepPattern(['-z', 'fn'])).toEqual({ error: '-z' });
  });
  it('inert -n is a no-op; pattern still resolves', () => {
    expect(grepPattern(['-n', 'fn main'])).toEqual({ regex: 'fn main' });
  });
});
