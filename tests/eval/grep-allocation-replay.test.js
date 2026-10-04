/**
 * eval/grep-allocation-replay: recorded-call parsing (Python shlex semantics) and the
 * probe-clustered bootstrap (shared by the eval measurement harnesses).
 */
import { describe, expect, it } from 'vitest';

import { pairedBootstrap, parseGrepCall, pyList, shellWords, symbolKey } from '../../eval/grep-allocation-replay/lib.mjs';

describe('shellWords / parseGrepCall', () => {
  it('double quotes keep a backslash before anything but " and \\ (shlex posix)', () => {
    expect(shellWords('ss-grep "func \\(o \\*Oracle\\) commit\\b" -k 10')).toEqual(['ss-grep', 'func \\(o \\*Oracle\\) commit\\b', '-k', '10']);
    expect(shellWords("ss-grep 'a|b' -i")).toEqual(['ss-grep', 'a|b', '-i']);
    expect(shellWords('ss-grep a\\ b "x\\"y"')).toEqual(['ss-grep', 'a b', 'x"y']);
  });

  it('unscoped calls only; flags, -k (default 20) and context are read', () => {
    expect(parseGrepCall('ss-grep "a|b" -i -w -k 30 -C 2')).toEqual({ pattern: 'a|b', flags: { i: true, w: true, F: false }, k: 30, context: ['-C', '2'] });
    expect(parseGrepCall('ss-grep foo')).toMatchObject({ k: 20 });
    expect(parseGrepCall('ss-grep foo --in src')).toBeNull();
    expect(parseGrepCall("ss-grep foo -g '*.go'")).toBeNull();
    expect(parseGrepCall('ss-grep foo bar')).toBeNull();
    expect(parseGrepCall('ss-grep "unterminated')).toBeNull();
  });

  it('python list literals and symbol keys', () => {
    expect(pyList("['a.go', \"b.go\"]")).toEqual(['a.go', 'b.go']);
    expect(symbolKey('Oracle.hasConflict')).toBe('hasConflict');
  });
});

describe('pairedBootstrap', () => {
  it('a constant difference has a zero-width interval; unpaired input throws', () => {
    const a = [{ probe: 'p1', value: 1 }, { probe: 'p1', value: 1 }, { probe: 'p2', value: 0.5 }];
    const b = [{ probe: 'p1', value: 0 }, { probe: 'p1', value: 0 }, { probe: 'p2', value: -0.5 }];
    expect(pairedBootstrap(a, b, { reps: 200, seed: 7 })).toEqual({ diff: 1, lo: 1, hi: 1, n: 3, probes: 2 });
    expect(() => pairedBootstrap(a, [...b].reverse())).toThrow(/unpaired/);
  });

  it('null values are left out of both arms', () => {
    const r = pairedBootstrap([{ probe: 'p', value: null }, { probe: 'p', value: 1 }], [{ probe: 'p', value: 0 }, { probe: 'p', value: 0 }]);
    expect(r.n).toBe(1);
  });
});
