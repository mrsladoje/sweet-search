/**
 * ss-search / ss-find agent output (2026-10-04): the owner's read of real outputs.
 *
 * Renderer side (packager side: related-rows-and-labels.test.js; the visible cut marker:
 * entry-cut-marker.test.js).
 * Group 1 (bugs):
 *   b. summary rows that printed code covers (entry OR continuation code) are dropped;
 *   c. sibling-line sites inside printed code are dropped;
 *   d. an entry header names every top-level symbol of its span;
 *   e. related rows from ambiguous name-only resolution are dropped.
 * Group 2 (format): grouped by file, no query header, no rank numbers, merged continuations,
 *   related rows one line per kind, selected by relevance to the query.
 */
import { describe, expect, it } from 'vitest';

import {
  printedCodeSpans,
  renderFixedBlocks,
  renderRelatedRows,
  selectEntries,
} from '../../core/search/agent-output-fixes.js';

const plan = (results) => selectEntries(results, { dedupe: 'a2', k: 10 });
const render = (results) => renderFixedBlocks(results, plan(results), { compact: true });

// ---------------------------------------------------------------------------------------------
describe('1b / 2c: continuations and the summary rows they cover', () => {
  const entry = {
    rank: 1, file: 'okhttp/Interceptor.kt', startLine: 85, endLine: 85, shownStartLine: 85, shownEndLine: 85,
    symbol: 'request', symbolType: 'function', presentation: 'full', expansionKind: 'full',
    code: '    fun request(): Request',
    continuation: {
      kind: 'symbol', file: 'okhttp/Interceptor.kt', startLine: 86, endLine: 88, symbol: 'proceed',
      code: '\n    @Throws(IOException::class)\n    fun proceed(request: Request): Response',
      rendered: '# continues at okhttp/Interceptor.kt:87 proceed',
    },
  };
  const summary = (startLine, endLine, symbol, extra = {}) => ({
    rank: 9, file: 'okhttp/Interceptor.kt', startLine, endLine, symbol, symbolType: 'function',
    presentation: 'summary', code: null, summary: `okhttp/Interceptor.kt:${startLine} — ${symbol} (function)`, ...extra,
  });

  it('a summary row inside continuation code is dropped; one that only overlaps it stays', () => {
    const results = [entry, summary(87, 88, 'proceed'), summary(86, 120, 'chainTail'), summary(94, 94, 'connection')];
    const kept = plan(results).entries.map((e) => e.r.symbol);
    expect(kept).toEqual(['request', 'chainTail', 'connection']);
    expect(printedCodeSpans(plan(results).entries).get('okhttp/Interceptor.kt')).toEqual([
      { start: 85, end: 85 }, { start: 86, end: 88 },
    ]);
  });

  it('a summary row ranked ABOVE the code that covers it is dropped too (one file group)', () => {
    const results = [{ ...summary(87, 88, 'proceed'), rank: 1 }, { ...entry, rank: 2 }];
    expect(plan(results).entries.map((e) => e.r.symbol)).toEqual(['request']);
  });

  it('a continuation that starts on the next line merges into one block with both names', () => {
    const out = render([entry, summary(94, 94, 'connection')]);
    expect(out).toBe([
      'okhttp/Interceptor.kt',
      '## 85-88 request, proceed',
      '```',
      '    fun request(): Request',
      '',
      '    @Throws(IOException::class)',
      '    fun proceed(request: Request): Response',
      '```',
      '94 connection',
      '',
    ].join('\n'));
    expect(out).not.toContain('continues at');
  });

  it('a continuation after a gap prints as its own block under the same path', () => {
    const gapped = { ...entry, continuation: { ...entry.continuation, startLine: 245, endLine: 247, symbol: 'wait', code: 'def wait\nend\nx' } };
    const out = render([gapped]);
    expect(out).toContain('## 85 request\n```\n    fun request(): Request\n```\n## 245-247 wait\n```\ndef wait\nend\nx\n```\n');
    expect(out.match(/okhttp\/Interceptor\.kt/g)).toHaveLength(1);
  });

  it('a cut entry never merges with its continuation (the cut lines would vanish)', () => {
    const cut = { ...entry, endLine: 86, shownEndLine: 85, code: '    fun request(): Request\n// ... (1 more lines)' };
    expect(render([cut])).toContain('## 85-86 request\n');
  });

  it('a trailer continuation drops its path and is skipped when a summary row of the file starts there', () => {
    const trailer = { ...entry, continuation: { kind: 'trailer', file: 'okhttp/Interceptor.kt', startLine: 632, endLine: 769, symbol: 'convert', rendered: '# continues at okhttp/Interceptor.kt:632 convert' } };
    expect(render([trailer])).toContain('# continues at 632 convert\n');
    expect(render([trailer, summary(632, 769, 'convert')])).not.toContain('continues at');
  });

});

// ---------------------------------------------------------------------------------------------
describe('1c: sibling-line sites inside printed code are dropped', () => {
  const base = {
    rank: 1, file: 'lib/timed_queue.rb', startLine: 174, endLine: 234, shownStartLine: 174, shownEndLine: 234,
    symbol: 'can_make_new?', symbolType: 'method', presentation: 'full', code: Array.from({ length: 61 }, (_, i) => `l${174 + i}`).join('\n'),
  };
  it('keeps only the sites outside every printed span', () => {
    const r = { ...base, siblingLine: { enclosing: 'can_make_new?', rendered: 'x', sites: [{ line: 135, text: 'def preallocated_make_new' }, { line: 192, text: 'def try_make_new' }] } };
    expect(render([r])).toContain('\n# siblings: 135: def preallocated_make_new\n');
    expect(render([r])).not.toContain('192:');
  });
  it('drops the line when no site is left', () => {
    const r = { ...base, siblingLine: { enclosing: 'can_make_new?', rendered: 'x', sites: [{ line: 192, text: 'def try_make_new' }] } };
    expect(render([r])).not.toContain('siblings');
  });
  it('drops `# same file:` neighbours whose lines printed code shows', () => {
    const r = {
      ...base,
      continuation: { kind: 'symbol', file: base.file, startLine: 245, endLine: 247, symbol: 'wait', code: 'a\nb\nc' },
      sameFile: { rendered: 'x', neighbors: [
        { name: 'wait', type: 'method', startLine: 245, endLine: 247, position: 'below' },
        { name: 'hold', type: 'method', startLine: 71, endLine: 121, position: 'above' },
      ] },
    };
    const out = render([r]);
    expect(out).toContain('# same file: hold (method 71-121 above) — sweep: ss-semantic lib/timed_queue.rb "<query>"\n');
    expect(out).not.toContain('wait (method');
  });
});

// ---------------------------------------------------------------------------------------------
describe('2d: related rows render one line per kind', () => {
  it('renders one line per kind, the path once per run of rows in one file', () => {
    expect(renderRelatedRows([
      { kind: 'caller', name: 'getResponseWithInterceptorChain', file: 'a/RealCall.kt', shortPath: 'RealCall.kt', startLine: 210, endLine: 260 },
      { kind: 'caller', name: 'execute', file: 'a/RealCall.kt', shortPath: 'RealCall.kt', startLine: 300, endLine: 300 },
      { kind: 'caller', name: 'intercept', file: 'a/Retry.kt', shortPath: 'Retry.kt', startLine: 72, endLine: 140 },
      { kind: 'extends', name: 'ConnectionPool', file: 'lib/connection_pool.rb', shortPath: 'connection_pool.rb', startLine: 27, endLine: 175 },
      { kind: 'imports', name: 'subprocess', line: 12 },
    ])).toEqual([
      'callers: RealCall.kt 210-260 getResponseWithInterceptorChain · 300 execute · Retry.kt 72-140 intercept',
      'extends: connection_pool.rb 27-175 ConnectionPool',
      'imports: subprocess (line 12)',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('1d: the entry header names every top-level symbol', () => {
  it('prints `symbols` (packager: annotateEntrySymbols) in the header', () => {
    const out = render([{ rank: 1, file: 'a.rb', startLine: 174, endLine: 234, symbol: 'can_make_new?', symbols: ['can_make_new?', 'try_make_new', 'acquire'], presentation: 'full', code: 'x' }]);
    expect(out).toContain('## 174-234 can_make_new?, try_make_new, acquire\n');
  });
});

// ---------------------------------------------------------------------------------------------
describe('2b: grouped by file', () => {
  it('files in order of their best-ranked entry; entries keep rank order; one path line per file', () => {
    const r = (rank, file, startLine, endLine, symbol, extra = {}) => ({
      rank, file, startLine, endLine, symbol, symbolType: 'function', presentation: 'summary', code: null,
      summary: `${file}:${startLine} — ${symbol} (function)`, ...extra,
    });
    const results = [
      r(1, 'a.kt', 300, 343, 'proceed', { presentation: 'full', code: 'x', shownStartLine: 300, shownEndLine: 300, endLine: 300 }),
      r(2, 'b.kt', 85, 88, 'request'),
      r(3, 'a.kt', 10, 20, 'copy'),
      r(4, 'b.kt', 94, 94, 'connection'),
      r(5, 'c.kt', 1, 40, 'Chain', { symbolType: 'interface' }),
    ];
    expect(render(results)).toBe([
      'a.kt', '## 300 proceed', '```', 'x', '```', '10-20 copy',
      'b.kt', '85-88 request · 94 connection',
      'c.kt', '1-40 Chain (interface)',
      '',
    ].join('\n'));
  });
});

// ---------------------------------------------------------------------------------------------
describe('sibling sites that a row of the same file prints appear once', () => {
  const file = 'zipkin/StorageConfigurationTest.java';
  const top = {
    rank: 1, file, startLine: 236, endLine: 260, shownStartLine: 236, shownEndLine: 260,
    symbol: 'dailyIndexFormat_overridingDateSeparator_empty', symbolType: 'method', presentation: 'full',
    code: Array.from({ length: 25 }, (_, i) => `l${236 + i}`).join('\n'),
    siblingLine: {
      enclosing: 'dailyIndexFormat_overridingDateSeparator_empty', rendered: 'x',
      sites: [{ line: 210, text: '@Test void dailyIndexFormat_overridingPrefix() {' }, { line: 223, text: '@Test void dailyIndexFormat_overridingDateSeparator() {' }],
    },
  };
  const row = (startLine, endLine, symbol, symbolType = 'method') => ({
    rank: 2, file, startLine, endLine, symbol, symbolType, presentation: 'summary', code: null,
    summary: `${file}:${startLine} — ${symbol} (${symbolType})`,
  });

  it('a site inside a member row of the file prints only as the row (the zipkin duplicate)', () => {
    const out = render([top, row(223, 234, 'dailyIndexFormat_overridingDateSeparator')]);
    expect(out).toContain('\n# siblings: 210: @Test void dailyIndexFormat_overridingPrefix() {\n');
    expect(out).not.toContain('223: @Test');
    expect(out).toContain('\n223-234 dailyIndexFormat_overridingDateSeparator\n');
  });

  it('a type row does not hide its members from the sibling line', () => {
    const out = render([top, row(1, 400, 'StorageConfigurationTest', 'class')]);
    expect(out).toContain('210: @Test');
    expect(out).toContain('223: @Test');
  });

  it('the line names neither the file nor the entry above it', () => {
    expect(render([top])).toMatch(/\n# siblings: 210: [^\n]+ · 223: [^\n]+\n/);
    expect(render([top])).not.toContain('same file (');
  });
});

// ---------------------------------------------------------------------------------------------
describe('a declaration block of a type already shown prints as one row', () => {
  const file = 'okhttp/Interceptor.kt';
  const head = {
    rank: 1, file, startLine: 84, endLine: 104, shownStartLine: 84, shownEndLine: 104, symbol: 'Chain', symbolType: 'class',
    presentation: 'full', code: Array.from({ length: 21 }, (_, i) => `l${84 + i}`).join('\n'),
  };
  const block = {
    rank: 2, file, startLine: 183, endLine: 247, shownStartLine: 183, shownEndLine: 247, symbol: 'withAuthenticator',
    symbolType: 'function', presentation: 'preview', code: Array.from({ length: 65 }, (_, i) => `d${183 + i}`).join('\n'),
    symbols: ['withAuthenticator', 'withCookieJar', 'withCache', 'withProxy', 'withProxySelector', 'withProxyAuthenticator'],
    headerContext: 'import a.B',
    declarationBlockOf: { name: 'Chain', startLine: 84, endLine: 297 },
  };
  const fold = (results) => selectEntries(results, { dedupe: 'a2', k: 10, foldDeclarationBlocks: true });

  it('folds the later block into `range names` when code of the same type printed above', () => {
    const p = fold([head, block]);
    const out = renderFixedBlocks([head, block], p, { compact: true });
    expect(out).toContain('\n183-247 withAuthenticator, withCookieJar, withCache +3\n');
    expect(out).not.toContain('d183');
    expect(out).not.toContain('import a.B');
    expect(p.hiddenCode).toBe(true);
  });

  it('keeps the block as code when it is the best entry of its type, or the type is another one', () => {
    expect(fold([block, head]).entries[0].r.code).toBeTruthy();
    const other = { ...block, declarationBlockOf: { name: 'Other', startLine: 300, endLine: 400 } };
    expect(fold([head, other]).entries[1].r.code).toBeTruthy();
    const unmarked = { ...block, declarationBlockOf: undefined };
    expect(fold([head, unmarked]).entries[1].r.code).toBeTruthy();
  });

  it('changes nothing without the option (non-agent renderers, legacy arm)', () => {
    const p = selectEntries([head, block], { dedupe: 'a2', k: 10 });
    expect(p.entries[1].r).toBe(block);
    expect(p.hiddenCode).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('an unexpanded preview counts the lines it shows as printed code', () => {
  const file = 'src/lib/converter/symbols.ts';
  const preview = (code, extra = {}) => ({
    rank: 2, file, startLine: 1196, endLine: 1199, symbol: 'convertVariableAsFunction', symbolType: 'function',
    presentation: 'preview', expanded: false, code, ...extra,
  });
  it('a whole preview covers its span; a cut one covers the lines above the marker', () => {
    expect(printedCodeSpans([{ r: preview('a\nb\nc\nd') }]).get(file)).toEqual([{ start: 1196, end: 1199 }]);
    expect(printedCodeSpans([{ r: preview('a\nb\n// ... (2 more lines)') }]).get(file)).toEqual([{ start: 1196, end: 1197 }]);
    expect(printedCodeSpans([{ r: preview('a\nb') }]).get(file)).toBeUndefined(); // unknown cut: not counted
    expect(printedCodeSpans([{ r: preview('a\nb\nc\nd', { expanded: true }) }]).get(file)).toBeUndefined();
  });
  it('a sibling site that a later preview prints in full is not repeated (typedoc)', () => {
    const top = {
      rank: 1, file, startLine: 551, endLine: 552, shownStartLine: 551, shownEndLine: 552, symbol: 'convertFunctionOrMethod',
      symbolType: 'function', presentation: 'full', code: 'x\ny',
      siblingLine: { enclosing: 'convertFunctionOrMethod', rendered: 'x', sites: [{ line: 882, text: 'function convertArrowAsMethod(' }, { line: 1196, text: 'function convertVariableAsFunction(' }] },
    };
    const out = render([top, preview('a\nb\nc\nd')]);
    expect(out).toContain('# siblings: 882: function convertArrowAsMethod(\n');
    expect(out).not.toContain('1196: function');
  });
});
