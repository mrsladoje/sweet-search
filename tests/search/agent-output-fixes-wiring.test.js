/**
 * Wiring of the ss-* output (eval/agent-read-workflows/bin/_ss-helpers.mjs), through the same
 * functions the wrapper calls: the compact result blocks (A1, A2, A7), the compact sufficiency
 * line, the A5 regex repair, the A4 alternatives. The end-to-end bytes of the real tools are in
 * tests/agent-tools/.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  alternativesAfterSwitch,
  dedupeImports,
  renderCompactSufficiency,
  renderFixedBlocks,
  repairRegexBranches,
  resultsForOriginalLedger,
  rustRegexLooksValid,
  selectEntries,
  splitTopLevelAlternation,
} from '../../core/search/agent-output-fixes.js';
import { translateBreToRustRegex } from '../../core/search/regex-dialect.js';

const gutter = (code, startLine) => code.split('\n').map((l, i) => `${startLine + i}\t${l}`).join('\n');

const lines = (from, n) => Array.from({ length: n }, (_, i) => `line ${from + i}`).join('\n');

function fixture() {
  return [
    {
      rank: 1, file: 'a.go', startLine: 1, endLine: 6, symbol: 'Run', symbolType: 'function',
      presentation: 'full', expansionKind: 'full', score: 0.91, code: 'package a\nimport "fmt"\nfunc Run() {\n  fmt.Println()\n  x()\n}',
      headerContext: 'package a\nimport "fmt"',
      neighbors: { rendered: 'x() b.go:3', tokens: 12 },
      sameFile: { rendered: 'same file: Stop (l.40)' },
      siblingLine: { rendered: 'siblings: RunAll' },
      continuation: { rendered: '# continues at b.go:3-8', kind: 'symbol', file: 'b.go', startLine: 3, endLine: 8, code: lines(3, 6) },
      familyManifest: { rendered: 'family: Run, RunAll' },
    },
    { rank: 2, file: 'a.go', startLine: 2, endLine: 4, symbol: 'Run', symbolType: 'function', presentation: 'summary', score: 0.5, summary: 'a.go:2 — Run (function)', stale: true },
    { rank: 3, file: 'c.go', startLine: 10, endLine: 20, symbol: 'Other', symbolType: 'method', presentation: 'summary', score: 0.4, summary: 'c.go:10 handles other things' },
    { rank: 4, file: 'd.go', startLine: 5, endLine: 9, symbol: 'Prev', symbolType: 'function', presentation: 'preview', expansionKind: 'window', score: 0.3, code: 'prev\n...' },
  ];
}

describe('result blocks (A1, A2, A7): grouped by file', () => {
  it('prints the compact blocks, byte for byte: no query header or rank numbers', () => {
    const results = fixture();
    const out = renderFixedBlocks(results, selectEntries(results), { gutter });
    expect(out).toBe([
      'a.go',
      '## 1-6 Run',
      '```', gutter(results[0].code, 1), '```',
      // No `rows` on this package: its one-row-per-line text prints as it is.
      'x() b.go:3',
      'same file: Stop (l.40)',
      'siblings: RunAll',
      // A continuation in another file keeps its path.
      '## b.go:3-8', '```', lines(3, 6), '```',
      'family: Run, RunAll',
      // Rank 2 (a.go:2-4) is inside rank 1's printed code: dropped (A2).
      'c.go',
      '10-20 Other',
      'c.go:10 handles other things',
      'd.go',
      '## 5-9 Prev', '```', gutter('prev\n...', 5), '```',
      '',
    ].join('\n'));
    expect(out).not.toContain('score=');
    expect(out).not.toContain('## #');
    // A7: the imports are the first lines of the code block: no imports block.
    expect(out).not.toContain('### imports');
  });

  it('prints exactly (no results) on zero results', () => {
    expect(renderFixedBlocks([], selectEntries([]), { gutter })).toBe('(no results)\n');
  });

  it('the header names the printed lines; the rest of the packed range is a `# not shown:` line', () => {
    const results = [{
      rank: 1, file: 'w/draft.go', startLine: 1756, endLine: 1758, fullStartLine: 1750, fullEndLine: 1894,
      symbol: 'calculateSnapshot', symbolType: 'method', presentation: 'full', expansionKind: 'full',
      shownStartLine: 1756, shownEndLine: 1758, code: 'a\nb\nc',
      continuation: { kind: 'symbol', file: 'w/draft.go', startLine: 1759, endLine: 1760, code: 'd\ne', symbol: 'next' },
    }];
    expect(renderFixedBlocks(results, selectEntries(results), { gutter })).toBe([
      'w/draft.go',
      '## 1756-1758 calculateSnapshot',
      '# not shown: lines 1750-1755 — ss-read w/draft.go 1750 1755',
      '```', gutter('a\nb\nc', 1756), '```',
      '# not shown: lines 1759-1894 — ss-read w/draft.go 1759 1894',
      // Lines of the packed range are left out after the body: the continuation does not merge.
      '## 1759-1760 next', '```', 'd\ne', '```',
      '',
    ].join('\n'));
  });

  it('a summary of the packed range of a cut entry repeats it: dropped', () => {
    const results = [
      { rank: 1, file: 'a.go', startLine: 10, endLine: 12, fullStartLine: 10, fullEndLine: 40, symbol: 'F', presentation: 'full', shownStartLine: 10, shownEndLine: 12, code: 'x\ny\nz' },
      { rank: 2, file: 'a.go', startLine: 10, endLine: 40, symbol: 'F', presentation: 'summary', summary: 'a.go:10 — F (function)' },
    ];
    expect(selectEntries(results).entries.map((e) => e.r.rank)).toEqual([1]);
  });

  it('keeps the imports block when the code does not show it', () => {
    const results = fixture();
    results[0].code = 'func Run() {\n  fmt.Println()\n}';
    expect(renderFixedBlocks(results, selectEntries(results), { gutter })).toContain('### imports\n```\npackage a\nimport "fmt"\n```\n');
  });

  it('the shown-span ledger gets every result unless A2 hid one that carries code', () => {
    const results = fixture();
    expect(resultsForOriginalLedger(results, selectEntries(results))).toBe(results);
    const withCont = [...results];
    withCont[1] = { ...withCont[1], continuation: { kind: 'symbol', code: 'x' } };
    expect(resultsForOriginalLedger(withCont, selectEntries(withCont)).map((r) => r.rank)).toEqual([1, 3, 4]);
  });
});

describe('dedupeImports (A7)', () => {
  it('drops the block when the code shows all of it, cuts a shared tail, and never edits the middle', () => {
    expect(dedupeImports('package a\nimport "fmt"', 'package a\nimport "fmt"\n\nfunc A() {}')).toBe('');
    expect(dedupeImports('import os\nimport sys\nimport re', 'import re\ndef f(): pass')).toBe('import os\nimport sys');
    const partial = 'import (\n  "fmt"\n  "os"\n)';
    expect(dedupeImports(partial, 'func A() {\n  "os"\n}')).toBe(partial);
    expect(dedupeImports('import a', 'x = 1')).toBe('import a');
    // A shared tail made only of punctuation is not a reason to cut.
    expect(dedupeImports('import (\n  "fmt"\n)', ')\nfunc A() {}')).toBe('import (\n  "fmt"\n)');
  });
});

describe('compact sufficiency line (A1, owner decision)', () => {
  it('prints only YES, and only with a confidence verdict', () => {
    expect(renderCompactSufficiency({ confidence: 'high' }, ' sufficient=YES (margin)')).toBe('# sufficient=YES\n');
    expect(renderCompactSufficiency({ confidence: 'low' }, ' sufficient=unknown (x)')).toBe('');
    expect(renderCompactSufficiency({ confidence: 'low' }, ' sufficient=no')).toBe('');
    expect(renderCompactSufficiency({}, ' sufficient=YES')).toBe('');
  });
});

describe('A5 regex repair keeps alternatives', () => {
  it('splits on top-level | and the GNU \\| only', () => {
    expect(splitTopLevelAlternation('a|b(c|d)|[x|y]')).toEqual(['a', 'b(c|d)', '[x|y]']);
    expect(splitTopLevelAlternation('type T\\|Transform(data')).toEqual(['type T', 'Transform(data']);
    expect(splitTopLevelAlternation('func(')).toEqual(['func(']);
  });

  it('approximates the Rust parser', () => {
    expect(rustRegexLooksValid('foo\\(bar')).toBe(true);
    expect(rustRegexLooksValid('(?i)foo')).toBe(true);
    expect(rustRegexLooksValid('a{2,3}')).toBe(true);
    expect(rustRegexLooksValid('func(')).toBe(false);
    expect(rustRegexLooksValid("Command '{}' exited")).toBe(false);
    expect(rustRegexLooksValid('foo(?=bar)')).toBe(false);
    expect(rustRegexLooksValid('(a)\\1')).toBe(false);
  });

  it('repairs only the broken alternative of the recorded failure shapes', () => {
    expect(repairRegexBranches("pipe_notebook|Command '{}' exited|had no output|stderr"))
      .toEqual({ pattern: "pipe_notebook|Command '[{][}]' exited|had no output|stderr", wholeLiteral: false, repairedBranches: 1 });
    expect(repairRegexBranches('type Transformation\\|Transform(data').pattern).toBe('type Transformation|Transform[(]data');
    // The agent's own `\(` stays as written; only the part that did not parse is escaped.
    expect(repairRegexBranches('runModeSetup\\({\\|runModeTransition\\({').pattern).toBe('runModeSetup\\([{]|runModeTransition\\([{]');
  });

  it('a single broken pattern is still searched as literal text', () => {
    expect(repairRegexBranches('func(')).toEqual({ pattern: 'func[(]', wholeLiteral: true, repairedBranches: 1 });
    expect(repairRegexBranches('options(\'').pattern).toBe("options[(]'");
    // Look-around is not Rust syntax: literal text.
    expect(repairRegexBranches('foo(?=bar)').pattern).toBe('foo[(][?]=bar[)]');
    // A partial repair keeps the parts that parse (`.`); `[` keeps the backslash form.
    expect(repairRegexBranches('a.b[(').pattern).toBe('a.b\\[[(]');
  });

  it("the engine's GNU-dialect retry never turns a repair escape back into an operator", () => {
    // `functio\(n)` was repaired to `functio\(n\)`. On zero hits the engine retried it as
    // `functio(n)` and printed every `function` under "searched it as literal text". A repair
    // escape is now a one-character class, which translateBreToRustRegex never rewrites: the
    // translation either does not exist or does not parse (the engine then keeps the zero hits).
    for (const raw of ['functio\\(n)', 'func\\(.*)', 'a\\(b)', 'foo(bar', 'x{', '+x', 'f(a|b', 'g(x))', 'useState(']) {
      const repaired = repairRegexBranches(raw).pattern;
      expect(rustRegexLooksValid(repaired), raw).toBe(true);
      const translated = translateBreToRustRegex(repaired)?.pattern;
      if (translated) expect(rustRegexLooksValid(translated), `${raw} -> ${repaired} -> ${translated}`).toBe(false);
    }
  });

  it('a `|` inside an unclosed group stays inside it (never a new top-level alternative)', () => {
    // `app.(get|post` used to become `app.\(get|post`, which matches every `post` in the repo.
    // The pipe stays literal as `[|]` (a `\|` would trigger the GNU-alternation dialect hint).
    expect(repairRegexBranches('app.(get|post').pattern).toBe('app.[(]get[|]post');
    expect(repairRegexBranches('a(b|c(d|e)').pattern).toBe('a[(]b[|]c(d|e)');
    expect(repairRegexBranches('x(y|z|w').pattern).toBe('x[(]y[|]z[|]w');
    // A closed group is untouched; only top-level alternatives split.
    expect(repairRegexBranches('ok(a|b)|bad(').pattern).toBe('ok(a|b)|bad[(]');
    for (const raw of ['app.(get|post', 'a(b|c(d|e)', 'x(y|z|w']) {
      expect(rustRegexLooksValid(repairRegexBranches(raw).pattern), raw).toBe(true);
    }
  });

  it('every repaired pattern parses', () => {
    for (const raw of ["pipe_notebook|Command '{}' exited|had no output|stderr", 'a(|b', 'x{|y}', '*foo|bar', 'f(a[|b']) {
      expect(rustRegexLooksValid(repairRegexBranches(raw).pattern), raw).toBe(true);
    }
  });
});

describe('A4 alternatives after the switch to the non-test definition', () => {
  it('names the test definition and drops the chosen one', () => {
    const original = {
      target: { name: 'Do', type: 'method', filePath: 'mock/do_test.go', startLine: 3 },
      disambiguation: [{ name: 'Do', type: 'method', file: 'do.go', startLine: 10 }, { name: 'Do', type: 'method', file: 'x.go', startLine: 1 }],
    };
    expect(alternativesAfterSwitch(original, 'do.go', 10)).toEqual([
      { name: 'Do', type: 'method', file: 'mock/do_test.go', startLine: 3 },
      { name: 'Do', type: 'method', file: 'x.go', startLine: 1 },
    ]);
  });
});

describe('wrapper source checks', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../../eval/agent-read-workflows/bin/_ss-helpers.mjs'), 'utf8');

  it('the ss-trace usage text has no bracketed or piped mode-word form', () => {
    const usage = src.slice(src.indexOf('const TRACE_USAGE ='), src.indexOf('async function cmdTrace'));
    expect(usage).toContain("ss-trace <symbol> callers --in <defining file>");
    expect(usage).not.toMatch(/'[^']*callers\|callees[^']*'/);
    expect(usage).not.toMatch(/'[^']*\[callers[^']*'/);
  });

  it('the shown-span ledger call has no sessionId override and no deleted switch name is left', () => {
    expect(src).not.toMatch(/SS_FIX_(A|TRACE_COMPACT|GREP_RETRY|GREP_ALLOC|GREP_LINES|GREP_WEIGHT|SEMANTIC_|TRACE_MODE_BUDGET|ALREADY_SHOWN|DROP_SUFFICIENCY|SUMMARY_CAP|ONE_PER_FILE|GREP_ORDER|SEARCH_FIRST_UNIT)\b/);
    expect(src).not.toMatch(/SS_VARIANT_(SEARCH_DEDUPE|SENTINEL)|SWEET_SEARCH_COMPACT_OUTPUT/);
    // recordAgentToolCall (the shown-span ledger) has no sessionId override.
    const rec = src.slice(src.indexOf('async function recordAgentToolCall'), src.indexOf('// Pure arg-parsing helpers'));
    expect(rec).toContain('sessionId: AGENT_SESSION_ID');
    expect(rec).not.toMatch(/sessionId\s*=/);
  });
});
