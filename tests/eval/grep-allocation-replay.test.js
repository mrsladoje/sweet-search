/**
 * eval/grep-allocation-replay: recorded-call parsing (Python shlex semantics), the per-call
 * metrics, the probe-clustered bootstrap, and the replay rendering through production code.
 */
import { describe, expect, it } from 'vitest';

import { callMetrics, pairedBootstrap, parseGrepCall, pyList, shellWords, symbolKey } from '../../eval/grep-allocation-replay/lib.mjs';
import { callTargets, matchList, renderArm } from '../../eval/grep-allocation-replay/replay-core.mjs';

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

describe('replay rendering and metrics', () => {
  const byFile = {
    'a/export.go': { total: 6, lines: [[1, 'package export'], [3, 'import "export"'], [10, 'func Export() {'], [14, 'export()'], [30, 'func ExportAll() {'], [40, '// export']] },
    'b.go': { total: 1, lines: [[2, 'export']] },
  };
  const call = { k: 3, flags: { i: false, w: false, F: false }, goldFiles: ['a/export.go'], goldSymbols: ['pkg.Export'] };
  const index = { spans: { 'a/export.go': [[10, 20, 'Export'], [30, 35, 'ExportAll']] }, stale: new Set() };

  it('targets: answer-symbol spans with a match inside, and their declaration lines', () => {
    expect(callTargets(call, byFile, index.spans)).toEqual([{ file: 'a/export.go', start: 10, end: 20, name: 'Export', declLines: [10] }]);
  });

  it('Step 1 lines raise the answer-symbol hit on the same allocation', () => {
    const ctx = { gold: new Set(call.goldFiles), matchedFiles: Object.keys(byFile), targets: callTargets(call, byFile, index.spans), k: 3 };
    const shipped = callMetrics(renderArm(call, matchList(byFile), { alloc: true, weight: 'sqrt', rule: 'sl' }, index).rows, ctx);
    const lines = callMetrics(renderArm(call, matchList(byFile), { alloc: true, weight: 'sqrt', rule: 'sl', lines: true }, index).rows, ctx);
    expect(shipped).toMatchObject({ inclusion: 1, answerLines: 2, symHit: 0, declHit: 0 });
    expect(lines).toMatchObject({ inclusion: 1, answerLines: 2, symHit: 1, declHit: 1 });
    // -F is not agent format in the engine: no classes, the prefix
    const fixed = renderArm({ ...call, flags: { ...call.flags, F: true } }, matchList(byFile), { alloc: true, lines: true }, index);
    expect(fixed.rows.map(r => r.line)).toEqual([1, 3, 2]);
  });

  it('count-only placeholders keep a file\'s total without storing its lines', () => {
    const m = matchList({ 'x.go': { total: 3, lines: [[5, 'x']] } });
    expect(m).toHaveLength(3);
    expect(m.slice(1).every(r => r.line >= 1e9)).toBe(true);
  });
});
