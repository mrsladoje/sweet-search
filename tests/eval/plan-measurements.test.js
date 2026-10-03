/**
 * The offline measurement harnesses of docs/SUGGESTED_PLAN.md at 945a9664: their output parsers, and the
 * ss-trace mode-budget share rule (SS_FIX_TRACE_MODE_BUDGET, default off).
 */
import { describe, expect, it } from 'vitest';

import { parseEntries } from '../../eval/search-allocation-measure/measure.mjs';
import { printedBlocks } from '../../eval/semantic-range-replay/replay.mjs';
import { parseTrace } from '../../eval/trace-truncation-classify/classify.mjs';
import { modeSectionShares, sectionShares } from '../../core/graph/structural-context.js';

describe('parseEntries (recorded ss-search / ss-find output)', () => {
  const out = [
    '# ss-search: routed=hybrid conf=0.97 budget=3000 used=507 results=3 subMode=agent_preview',
    '## #1 x/tenancy.go:114-132 [function: aclTenantResolver] (full kind=chunk) score=0.600',
    '### imports', '```', '\t"context"', '```',
    '```', '114\t// aclTenantResolver is the built-in resolver', '115\tfunc aclTenantResolver(ctx context.Context) {', '```',
    '## #2 query/q.go:20-30 [function: helper] (summary) score=0.5',
    '## #3 x/keys.go:201-211 [function: DataKey]',
    '```go', 'func DataKey() {', '}', '```',
  ].join('\n');

  it('ranks, files, tiers, and the printed lines (gutter numbers, else counted from the start)', () => {
    const e = parseEntries(out);
    expect(e.map(x => [x.rank, x.file, x.tier])).toEqual([[1, 'x/tenancy.go', 'code'], [2, 'query/q.go', 'name'], [3, 'x/keys.go', 'code']]);
    expect([...e[0].printed]).toEqual([114, 115]);     // the imports block is not the entry's code
    expect([...e[2].printed]).toEqual([201, 202]);
    expect(e[0].name).toBe('aclTenantResolver');
  });
});

describe('printedBlocks (ss-semantic output)', () => {
  it('headers, code lines, and the not-shown lines on each side', () => {
    const out = [
      '# ss-semantic a.go | "q" | spans=1 | ~tokens=600',
      '# not shown: lines 1-8 — ss-read a.go 1 8',
      '### a.go:9-11 [f]', '```go', 'x', 'y', 'z', '```',
      '# not shown: lines 12-20 — ss-read a.go 12 20',
    ].join('\n');
    expect(printedBlocks(out)).toEqual([{
      start: 9, end: 11, code: ['x', 'y', 'z'],
      before: ['# not shown: lines 1-8 — ss-read a.go 1 8'],
      after: ['# not shown: lines 12-20 — ss-read a.go 12 20'],
    }]);
  });
});

describe('parseTrace (cmdTrace grammar)', () => {
  it('symbol, mode word, and the value flags', () => {
    expect(parseTrace('ss-trace Foo callees --in src/a.ts --query "who" --depth 2')).toMatchObject({
      symbol: 'Foo', mode: 'callees', filePath: 'src/a.ts', queryHint: 'who', maxDepth: 2,
    });
    expect(parseTrace('ss-trace Foo')).toMatchObject({ symbol: 'Foo', mode: null });
    expect(parseTrace('ss-trace Foo bogus')).toBeNull();
  });
});

describe('modeSectionShares (SS_FIX_TRACE_MODE_BUDGET)', () => {
  const base = sectionShares({ fanIn: 3, fanOut: 3 }, '', { type: 'function' });

  it('a mode word gives its section every share but the target\'s', () => {
    const s = modeSectionShares(base, 'callees');
    expect(s).toEqual({ target: base.target, callers: 0, callees: 1 - base.target, impact: 0 });
  });

  it('no mode word, or an unknown one: the shares are unchanged', () => {
    expect(modeSectionShares(base, null)).toBe(base);
    expect(modeSectionShares(base, undefined)).toBe(base);
    expect(modeSectionShares(base, 'all')).toBe(base);
  });
});
