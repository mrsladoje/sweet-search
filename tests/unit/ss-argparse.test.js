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
  absorbPositionalPaths,
  extractPositional,
  stripInertFlags,
  parseBoolFlag,
  parseShortFlag,
  parseFlag,
  parseValueFlag,
  parsePositiveIntFlag,
  parseRepeatedValueFlag,
  extraPositionals,
  parseLineRange,
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
  it('keeps optional-value inert flags atomic', () => {
    expect(normalizeArgs(['--color=always', 'q'])).toEqual(['--color=always', 'q']);
  });
  it('keeps unknown --name=value intact for the guard', () => {
    expect(normalizeArgs(['--mystery=value', 'q'])).toEqual(['--mystery=value', 'q']);
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
  const opts = ['-i', '-z', '-iw', '--ignore-case', '--color', '-C', '-C2', '-A3', '--unknown=value'];
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
  it('flags attached unsupported flags (-C2) instead of searching for them', () => {
    expect(extractPositional(['-C2', 'fn'])).toEqual({ pattern: undefined, unknownFlag: '-C2' });
  });
  it('flags unknown long options with values intact', () => {
    expect(extractPositional(['--mystery=value', 'fn'])).toEqual({ pattern: undefined, unknownFlag: '--mystery=value' });
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
  it('parseValueFlag reports a missing value without consuming the flag', () => {
    const args = ['q', '--mode'];
    expect(parseValueFlag(args, '--mode', 'auto')).toEqual({
      value: 'auto',
      flag: '--mode',
      error: '--mode requires a value',
    });
    expect(args).toEqual(['q', '--mode']);
  });
  it('parseValueFlag can allow dash-leading regex values explicitly', () => {
    const args = ['q', '--regex', '-?\\d+'];
    expect(parseValueFlag(args, '--regex', '', { allowOptionValue: true })).toEqual({
      value: '-?\\d+',
      flag: '--regex',
      error: null,
    });
    expect(args).toEqual(['q']);
  });
  it('parsePositiveIntFlag rejects missing and invalid numeric values', () => {
    expect(parsePositiveIntFlag(['q', '-k'], ['-k', '--top'], 20).error)
      .toBe('-k requires a value');
    expect(parsePositiveIntFlag(['q', '-k', '0'], ['-k', '--top'], 20).error)
      .toBe('-k must be an integer >= 1');
    expect(parsePositiveIntFlag(['q', '-k', 'abc'], ['-k', '--top'], 20).error)
      .toBe('-k must be an integer >= 1');
  });
});

describe('ss-grep multi-scope --in (dashbitco/nimble_options: a dropped scope decided the task)', () => {
  // Mirrors cmdGrep's parsing order: repeated --in, then inert strip, then the
  // extras guard, then the positional pattern.
  function grepScopes(rawArgs) {
    const args = normalizeArgs(rawArgs);
    parseBoolFlag(args, ['-i', '--ignore-case']);
    parseBoolFlag(args, ['-w', '--word-regexp']);
    parseBoolFlag(args, ['-F', '--fixed-strings']);
    const k = parsePositiveIntFlag(args, ['-k', '--top'], 20);
    if (k.error) return { error: k.error };
    const scopes = parseRepeatedValueFlag(args, '--in');
    if (scopes.error) return { error: scopes.error };
    stripInertFlags(args);
    const extras = extraPositionals(args);
    if (extras.length) return { extras };
    const { pattern, unknownFlag } = extractPositional(args);
    if (unknownFlag) return { error: unknownFlag };
    return { pattern, scopes: scopes.values };
  }

  it('one scope: unchanged behaviour', () => {
    expect(grepScopes(['keys', '--in', 'lib/nimble_options.ex']))
      .toEqual({ pattern: 'keys', scopes: ['lib/nimble_options.ex'] });
  });

  it('several scopes: every repeated --in is applied, in order', () => {
    expect(grepScopes(['keys', '--in', 'lib/nimble_options.ex', '--in', 'test/nimble_options_test.exs']))
      .toEqual({ pattern: 'keys', scopes: ['lib/nimble_options.ex', 'test/nimble_options_test.exs'] });
  });

  it('a directory scope is a scope like any other', () => {
    expect(grepScopes(['expect_error', '--in', 'tests/testthat']))
      .toEqual({ pattern: 'expect_error', scopes: ['tests/testthat'] });
  });

  it('de-duplicates a repeated identical scope', () => {
    expect(grepScopes(['x', '--in', 'a.ex', '--in', 'a.ex']).scopes).toEqual(['a.ex']);
  });

  it('THE DEFECT: a second bare path is now reported, never silently dropped', () => {
    // Was: --in consumed only 'lib/…', the header echoed that one scope back,
    // and 'test/…' — which held the deciding assertion — vanished.
    expect(grepScopes(['keys', '--in', 'lib/nimble_options.ex', 'test/nimble_options_test.exs']))
      .toEqual({ extras: ['test/nimble_options_test.exs'] });
  });

  it('reports every unconsumed argument, not just the first', () => {
    expect(grepScopes(['keys', '--in', 'a.ex', 'b.ex', 'c.ex']))
      .toEqual({ extras: ['b.ex', 'c.ex'] });
  });

  it('malformed value: --in with nothing after it is a loud error', () => {
    expect(grepScopes(['keys', '--in'])).toEqual({ error: '--in requires a value' });
    expect(grepScopes(['keys', '--in', '-k', '5'])).toEqual({ error: '--in requires a value' });
    expect(grepScopes(['keys', '--in='])).toEqual({ error: '--in requires a value' });
    expect(grepScopes(['keys', '--in', ''])).toEqual({ error: '--in requires a value' });
    expect(grepScopes(['keys', '--in', '--'])).toEqual({ error: '--in requires a value' });
  });

  it('no --in at all still parses, and a lone pattern is not an extra', () => {
    expect(grepScopes(['fn main'])).toEqual({ pattern: 'fn main', scopes: [] });
    expect(grepScopes(['-i', 'fn main', '-k', '5'])).toEqual({ pattern: 'fn main', scopes: [] });
  });

  it('extras are counted after inert flags are stripped, so -n never trips the guard', () => {
    expect(grepScopes(['-n', 'fn main', '--color=always'])).toEqual({ pattern: 'fn main', scopes: [] });
  });

  it('extraPositionals ignores option-shaped tokens (extractPositional reports those)', () => {
    expect(extraPositionals(['fn', '-z'])).toEqual([]);
    expect(extraPositionals(['fn', '-z', 'extra'])).toEqual(['extra']);
  });

  it('extraPositionals respects the -- sentinel', () => {
    expect(extraPositionals(['--', '-->'])).toEqual([]);
    expect(extraPositionals(['--', '-->', 'extra'])).toEqual(['extra']);
  });

  it('parseRepeatedValueFlag consumes each flag+value pair out of args', () => {
    const args = ['keys', '--in', 'a.ex', '-k', '5', '--in', 'b.ex'];
    expect(parseRepeatedValueFlag(args, '--in')).toEqual({
      values: ['a.ex', 'b.ex'], flag: '--in', error: null,
    });
    expect(args).toEqual(['keys', '-k', '5']);
  });

  it('parseRepeatedValueFlag returns no values and no flag when absent', () => {
    expect(parseRepeatedValueFlag(['keys'], '--in')).toEqual({ values: [], flag: null, error: null });
  });

  it('parseRepeatedValueFlag never consumes flag-shaped positionals after --', () => {
    const args = ['keys', '--', '--in', 'src'];
    expect(parseRepeatedValueFlag(args, '--in'))
      .toEqual({ values: [], flag: null, error: null });
    expect(args).toEqual(['keys', '--', '--in', 'src']);
  });
});

describe('parseLineRange (ss-read single-token ranges)', () => {
  it.each([
    ['10-20', { start: 10, end: 20 }],
    ['10:20', { start: 10, end: 20 }],
    ['10,20', { start: 10, end: 20 }],
    ['5-5', { start: 5, end: 5 }],
  ])('parses %s', (tok, expected) => {
    expect(parseLineRange(tok)).toEqual(expected);
  });
  it.each([
    '20-10',      // descending → invalid
    '0-5',        // start < 1
    '10',         // plain number, not a range
    '10-',        // open-ended (would over-read) → rejected
    '-5',         // looks like a flag
    '10-20.txt',  // filename, not a range
    'abc',
    '',
  ])('rejects %s (returns null)', (tok) => {
    expect(parseLineRange(tok)).toBeNull();
  });
  it('does NOT treat a read-flag as a range (no silent over-read)', () => {
    // -n / --limit etc. must stay loud errors, never coerced to a range.
    expect(parseLineRange('-n')).toBeNull();
    expect(parseLineRange('--limit')).toBeNull();
  });
});

describe('end-to-end pipeline (normalize → parse → resolve → build)', () => {
  // Mirrors cmdGrep's parsing order without the SweetSearch I/O.
  function grepPattern(rawArgs) {
    const args = normalizeArgs(rawArgs);
    const ignoreCase = parseBoolFlag(args, ['-i', '--ignore-case']);
    const wordBound = parseBoolFlag(args, ['-w', '--word-regexp']);
    const fixedString = parseBoolFlag(args, ['-F', '--fixed-strings']);
    const k = parsePositiveIntFlag(args, ['-k', '--top'], 20);
    if (k.error) return { error: k.error };
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
  it('attached unsupported context flag is reported, not searched for', () => {
    expect(grepPattern(['-C2', 'fn'])).toEqual({ error: '-C2' });
  });
  it('inert -n is a no-op; pattern still resolves', () => {
    expect(grepPattern(['-n', 'fn main'])).toEqual({ regex: 'fn main' });
  });
  it('--color=always is a no-op without leaving "always" as the pattern', () => {
    expect(grepPattern(['--color=always', 'TODO'])).toEqual({ regex: 'TODO' });
  });
  it('missing -k value is a loud parse error', () => {
    expect(grepPattern(['TODO', '-k'])).toEqual({ error: '-k requires a value' });
  });
});

describe('adjacent ss-wrapper parser guards', () => {
  function searchArgs(rawArgs) {
    const args = normalizeArgs(rawArgs);
    if (args.includes('--full')) args.splice(args.indexOf('--full'), 1);
    if (args.includes('--xl')) args.splice(args.indexOf('--xl'), 1);
    const k = parsePositiveIntFlag(args, ['-k', '--top'], 5);
    if (k.error) return { error: k.error };
    const mode = parseValueFlag(args, '--mode', 'auto');
    if (mode.error) return { error: mode.error };
    const { pattern, unknownFlag } = extractPositional(args);
    if (unknownFlag) return { error: unknownFlag };
    return { query: pattern, k: k.value, mode: mode.value };
  }

  function semanticArgs(rawArgs) {
    const args = normalizeArgs(rawArgs);
    const maxTokens = parsePositiveIntFlag(args, '--max-tokens', 600);
    if (maxTokens.error) return { error: maxTokens.error };
    const bad = args.find(looksLikeOption);
    if (bad) return { error: bad };
    return { file: args[0], query: args[1], maxTokens: maxTokens.value };
  }

  function traceArgs(rawArgs) {
    const args = normalizeArgs(rawArgs);
    if (args.includes('--json')) args.splice(args.indexOf('--json'), 1);
    const file = parseValueFlag(args, ['--in', '--file'], null);
    if (file.error) return { error: file.error };
    const hint = parseValueFlag(args, ['--query', '--hint'], '', { allowOptionValue: true });
    if (hint.error) return { error: hint.error };
    const depth = parsePositiveIntFlag(args, '--depth', null);
    if (depth.error) return { error: depth.error };
    const { pattern, unknownFlag } = extractPositional(args);
    if (unknownFlag) return { error: unknownFlag };
    return { symbol: pattern, file: file.value, hint: hint.value, depth: depth.value };
  }

  it('ss-search reports an unknown leading flag instead of searching for it', () => {
    expect(searchArgs(['--unknown', 'auth'])).toEqual({ error: '--unknown' });
  });
  it('ss-search reports missing value flags', () => {
    expect(searchArgs(['auth', '--mode'])).toEqual({ error: '--mode requires a value' });
  });
  it('ss-semantic accepts --max-tokens anywhere but rejects missing values', () => {
    expect(semanticArgs(['file.js', 'question', '--max-tokens', '200']))
      .toEqual({ file: 'file.js', query: 'question', maxTokens: 200 });
    expect(semanticArgs(['file.js', 'question', '--max-tokens']))
      .toEqual({ error: '--max-tokens requires a value' });
  });
  it('ss-semantic reports unknown flags after parsing known flags', () => {
    expect(semanticArgs(['file.js', 'question', '--bad'])).toEqual({ error: '--bad' });
  });
  it('ss-trace parses flags before resolving the symbol and rejects unknowns', () => {
    expect(traceArgs(['--in', 'src/a.js', 'AuthService', '--depth', '2']))
      .toEqual({ symbol: 'AuthService', file: 'src/a.js', hint: '', depth: 2 });
    expect(traceArgs(['AuthService', '--bad'])).toEqual({ error: '--bad' });
  });
});

describe('absorbPositionalPaths', () => {
  // Injected predicate: treat these exact tokens as real paths.
  const isPath = (paths) => (tok) => new Set(paths).has(tok);

  it('reinterprets a trailing positional path as an --in scope', () => {
    const args = ['rule install', 'src/tools'];
    const inPaths = [];
    absorbPositionalPaths(args, inPaths, isPath(['src/tools']));
    expect(inPaths).toEqual(['src/tools']);
    expect(args).toEqual(['rule install']);       // pattern preserved, scope removed
  });

  it('keeps the first positional as the pattern even if it names a path', () => {
    const args = ['src/tools', 'src/build'];       // first is the "pattern" by position
    const inPaths = [];
    absorbPositionalPaths(args, inPaths, isPath(['src/tools', 'src/build']));
    expect(args).toEqual(['src/tools']);           // first stays as pattern
    expect(inPaths).toEqual(['src/build']);        // second absorbed
  });

  it('absorbs several trailing paths, preserving order', () => {
    const args = ['pat', 'lib', 'test'];
    const inPaths = [];
    absorbPositionalPaths(args, inPaths, isPath(['lib', 'test']));
    expect(inPaths).toEqual(['lib', 'test']);
    expect(args).toEqual(['pat']);
  });

  it('leaves a non-path bareword in place (ambiguous → rejectExtraPositionals)', () => {
    const args = ['def', 'foo'];                   // unquoted two-word pattern, not a path
    const inPaths = [];
    absorbPositionalPaths(args, inPaths, isPath([]));
    expect(inPaths).toEqual([]);
    expect(args).toEqual(['def', 'foo']);          // untouched
  });

  it('ignores option-shaped tokens and merges with an existing --in list', () => {
    const args = ['pat', 'src/a'];
    const inPaths = ['src/b'];                      // already parsed from --in src/b
    absorbPositionalPaths(args, inPaths, isPath(['src/a']));
    expect(inPaths).toEqual(['src/b', 'src/a']);
    expect(args).toEqual(['pat']);
  });
});
