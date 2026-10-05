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
 * Group 2 (format): no query header, merged continuations, related rows one line per kind,
 *   selected by relevance to the query.
 * 2026-10-04 owner shape: numbered entries in rank order, `N. <path|also short> <range> <kind name>`,
 *   a kind word on every name, `continues:` for code after a cut, imports of entry 1 only.
 */
import { describe, expect, it } from 'vitest';

import {
  printedCodeSpans,
  renderFixedBlocks,
  renderRelatedRows,
  selectEntries,
} from '../../core/search/agent-output-fixes.js';

const plan = (results) => selectEntries(results);
const render = (results) => renderFixedBlocks(results, plan(results));

// ---------------------------------------------------------------------------------------------
describe('1b / 2c: continuations and the summary rows they cover', () => {
  const entry = {
    rank: 1, file: 'okhttp/Interceptor.kt', startLine: 85, endLine: 85, shownStartLine: 85, shownEndLine: 85,
    symbol: 'request', symbolType: 'function', presentation: 'full', expansionKind: 'full',
    code: '    fun request(): Request',
    continuation: {
      kind: 'symbol', file: 'okhttp/Interceptor.kt', startLine: 86, endLine: 88, symbol: 'proceed', symbolType: 'function',
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
      '1. okhttp/Interceptor.kt 85-88 functions request, proceed',
      '```',
      '    fun request(): Request',
      '',
      '    @Throws(IOException::class)',
      '    fun proceed(request: Request): Response',
      '```',
      '2. also Interceptor.kt 94 function connection',
      '',
    ].join('\n'));
    expect(out).not.toContain('continues at');
  });

  it('a continuation after a gap prints as its own block under the same path', () => {
    const gapped = { ...entry, continuation: { ...entry.continuation, startLine: 245, endLine: 247, symbol: 'wait', code: 'def wait\nend\nx' } };
    const out = render([gapped]);
    expect(out).toContain('1. okhttp/Interceptor.kt 85 function request\n```\n    fun request(): Request\n```\ncontinues: 245-247 function wait\n```\ndef wait\nend\nx\n```\n');
    expect(out.match(/okhttp\/Interceptor\.kt/g)).toHaveLength(1);
  });

  it('a cut entry never merges with its continuation (the cut lines would vanish)', () => {
    const cut = { ...entry, endLine: 86, shownEndLine: 85, code: '    fun request(): Request\n// ... (1 more lines)' };
    expect(render([cut])).toContain('1. okhttp/Interceptor.kt 85-86 function request\n');
  });

  it('a trailer continuation drops its path and is skipped when a summary row of the file starts there', () => {
    const trailer = { ...entry, continuation: { kind: 'trailer', file: 'okhttp/Interceptor.kt', startLine: 632, endLine: 769, symbol: 'convert', rendered: '# continues at okhttp/Interceptor.kt:632 convert' } };
    expect(render([trailer])).toContain('continues (not shown): 632 convert\n');
    expect(render([trailer, summary(632, 769, 'convert')])).not.toContain('continues');
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
    expect(render([r])).toContain('\nnot shown, same file: 135: def preallocated_make_new\n');
    const named = { ...r, siblingLine: { ...r.siblingLine, sites: [{ line: 135, kind: 'method', name: 'preallocated_make_new', text: 'def preallocated_make_new' }] } };
    expect(render([named])).toContain('\nnot shown, same file: method preallocated_make_new (135)\n');
    expect(render([r])).not.toContain('192:');
  });
  it('drops the line when no site is left', () => {
    const r = { ...base, siblingLine: { enclosing: 'can_make_new?', rendered: 'x', sites: [{ line: 192, text: 'def try_make_new' }] } };
    expect(render([r])).not.toContain('not shown');
  });
  it('same-file neighbours print in the one sibling line, without those printed code shows', () => {
    const r = {
      ...base,
      continuation: { kind: 'symbol', file: base.file, startLine: 245, endLine: 247, symbol: 'wait', code: 'a\nb\nc' },
      sameFile: { rendered: 'x', neighbors: [
        { name: 'wait', type: 'method', startLine: 245, endLine: 247, position: 'below' },
        { name: 'hold', type: 'method', startLine: 71, endLine: 121, position: 'above' },
      ] },
    };
    const out = render([r]);
    expect(out).toContain('not shown, same file: method hold (71)');
    expect(out).not.toContain('# same file:');
    expect(out).not.toContain('method wait (245)');
  });
});

// ---------------------------------------------------------------------------------------------
describe('2d: related rows render one line per kind', () => {
  it('renders one line per kind, the path once per run of rows in one file', () => {
    expect(renderRelatedRows([
      { kind: 'caller', name: 'getResponseWithInterceptorChain', file: 'a/RealCall.kt', shortPath: 'RealCall.kt', startLine: 210, endLine: 260, entityType: 'function' },
      { kind: 'caller', name: 'execute', file: 'a/RealCall.kt', shortPath: 'RealCall.kt', startLine: 300, endLine: 300, entityType: 'function' },
      { kind: 'caller', name: 'intercept', file: 'a/Retry.kt', shortPath: 'Retry.kt', startLine: 72, endLine: 140, entityType: 'function' },
      { kind: 'extends', name: 'ConnectionPool', file: 'lib/connection_pool.rb', shortPath: 'connection_pool.rb', startLine: 27, endLine: 175, entityType: 'class' },
      { kind: 'imports', name: 'subprocess', line: 12 },
    ], new Set(), { name: 'TimedQueueConnectionPool', type: 'class' })).toEqual([
      'callers of class TimedQueueConnectionPool: function getResponseWithInterceptorChain (a/RealCall.kt 210-260) · function execute (300) · function intercept (a/Retry.kt 72-140)',
      'class TimedQueueConnectionPool extends class ConnectionPool (lib/connection_pool.rb 27-175)',
      'class TimedQueueConnectionPool imports: subprocess (line 12)',
    ]);
  });

  it('incoming extends / implements read the other way round', () => {
    expect(renderRelatedRows([
      { kind: 'extendedBy', name: 'Timed', file: 'a/t.rb', startLine: 9, endLine: 293, entityType: 'class' },
      { kind: 'implementedBy', name: 'Real', file: 'a/r.kt', startLine: 1, endLine: 2, entityType: 'class' },
    ], new Set(), { name: 'Pool', type: 'interface' })).toEqual([
      // A class "extending" an interface implements it (C#/Kotlin/Swift base lists).
      'interface Pool is implemented by class Timed (a/t.rb 9-293) · class Real (a/r.kt 1-2)',
    ]);
  });

  it('path rule: full path the first time the output names a file, the short form after', () => {
    const printed = new Set(['a/RealCall.kt']);
    const rows = [
      { kind: 'caller', name: 'execute', file: 'a/RealCall.kt', shortPath: 'RealCall.kt', startLine: 300, endLine: 300 },
      { kind: 'caller', name: 'intercept', file: 'a/b/Retry.kt', shortPath: 'Retry.kt', startLine: 72, endLine: 140 },
      { kind: 'calls', name: 'retry', file: 'a/b/Retry.kt', shortPath: 'Retry.kt', startLine: 150, endLine: 160 },
      { kind: 'type', name: 'Chain', file: 'a/c/Chain.kt', shortPath: 'Chain.kt' },
    ];
    expect(renderRelatedRows(rows, printed)).toEqual([
      'callers of this: execute (RealCall.kt 300) · intercept (a/b/Retry.kt 72-140)',
      'this calls: retry (Retry.kt 150-160)',
      'types in this: Chain (a/c/Chain.kt)',
    ]);
    expect([...printed]).toEqual(['a/RealCall.kt', 'a/b/Retry.kt', 'a/c/Chain.kt']);
    // A second entry of the same output names them again: short now.
    expect(renderRelatedRows([rows[3]], printed)).toEqual(['types in this: Chain (Chain.kt)']);
  });

  it('path rule, typed files: a file the agent typed (--in) prints short, or not at all when alone', () => {
    const one = (file, extra = {}) => ({ rank: 1, file, startLine: 1, endLine: 2, symbol: 'a', presentation: 'full', code: 'x', ...extra });
    const typed = ['lib/sequel/model/base.rb'];
    const alone = renderFixedBlocks([one(typed[0])], plan([one(typed[0])]), { compact: true, typed });
    expect(alone.startsWith('1. 1-2 a\n')).toBe(true);
    const rows = [one(typed[0], { neighbors: { rows: [
      { kind: 'caller', name: 'b', file: typed[0], shortPath: 'base.rb', startLine: 9, endLine: 9 },
    ] } }), { ...one('lib/sequel/dataset.rb'), rank: 2 }];
    const two = renderFixedBlocks(rows, plan(rows), { compact: true, typed });
    expect(two).toContain('1. base.rb 1-2 a\n');
    expect(two).toContain('callers of this: b (base.rb 9)\n');
    expect(two).toContain('2. lib/sequel/dataset.rb 1-2 a\n');
    expect(two).not.toContain('lib/sequel/model/base.rb');
  });

  it('path rule in a whole ss-search output: a related row names an unprinted file in full', () => {
    const out = render([
      { rank: 1, file: 'zipkin/es/IndexNameFormatter.java', startLine: 100, endLine: 120, symbol: 'formatType',
        presentation: 'full', code: 'x', neighbors: { rows: [
          { kind: 'calls', name: 'formatTypeAndTimestamp', file: 'zipkin/es/IndexNameFormatter.java', shortPath: 'IndexNameFormatter.java', startLine: 179, endLine: 181 },
          { kind: 'extends', name: 'ConnectionPool', file: 'lib/sequel/connection_pool.rb', shortPath: 'connection_pool.rb', startLine: 27, endLine: 175 },
        ] } },
      { rank: 2, file: 'lib/sequel/connection_pool.rb', startLine: 27, endLine: 30, symbol: 'ConnectionPool',
        presentation: 'full', code: 'y', neighbors: { rows: [
          { kind: 'caller', name: 'hold', file: 'lib/sequel/connection_pool.rb', shortPath: 'connection_pool.rb', startLine: 40, endLine: 50 },
        ] } },
    ]);
    expect(out).toContain('this calls: formatTypeAndTimestamp (IndexNameFormatter.java 179-181)\n');
    expect(out).toContain('this extends ConnectionPool (lib/sequel/connection_pool.rb 27-175)\n');
    // Named in full by a related row above: the entry prints the short name.
    expect(out).toContain('2. connection_pool.rb 27-30 ConnectionPool\n');
    expect(out).toContain('callers of this: hold (connection_pool.rb 40-50)\n');
  });
});

// ---------------------------------------------------------------------------------------------
describe('1d: the entry header names every top-level symbol', () => {
  it('prints `symbols` (packager: annotateEntrySymbols) in the header', () => {
    const out = render([{ rank: 1, file: 'a.rb', startLine: 174, endLine: 234, symbol: 'can_make_new?', symbols: ['can_make_new?', 'try_make_new', 'acquire'], presentation: 'full', code: 'x' }]);
    expect(out).toContain('1. a.rb 174-234 can_make_new?, try_make_new, acquire\n');
    const info = [
      { name: 'can_make_new?', type: 'method', startLine: 181, endLine: 185 },
      { name: 'try_make_new', type: 'method', startLine: 192, endLine: 218 },
      { name: 'acquire', type: 'method', startLine: 227, endLine: 234 },
    ];
    expect(render([{ rank: 1, file: 'a.rb', startLine: 174, endLine: 234, symbol: 'can_make_new?', symbolInfo: info, presentation: 'full', code: 'x' }]))
      .toContain('1. a.rb 174-234 methods can_make_new?, try_make_new, acquire\n');
    const mixed = [{ name: 'size', type: 'field', startLine: 1, endLine: 1 }, { name: 'grow', type: 'method', startLine: 2, endLine: 9 }];
    expect(render([{ rank: 1, file: 'a.rb', startLine: 1, endLine: 9, symbol: 'size', symbolInfo: mixed, presentation: 'full', code: 'x' }]))
      .toContain('1. a.rb 1-9 field size, method grow\n');
  });

  it('marks an entry that shows only part of its symbol', () => {
    const info = [{ name: 'Chain', type: 'interface', startLine: 84, endLine: 297 }];
    expect(render([{ rank: 1, file: 'I.kt', startLine: 84, endLine: 104, symbol: 'Chain', symbolInfo: info, presentation: 'full', code: 'x' }]))
      .toContain('1. I.kt 84-104 interface Chain (part; whole 84-297)\n');
  });
});

// ---------------------------------------------------------------------------------------------
describe('2b: numbered in rank order', () => {
  it('every entry has its number in rank order; a file printed before reads `also <short>`', () => {
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
      '1. a.kt 300 function proceed', '```', 'x', '```',
      '2. b.kt 85-88 function request',
      '3. also a.kt 10-20 function copy',
      '4. also b.kt 94 function connection',
      '5. c.kt 1-40 interface Chain',
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
    expect(out).toContain('\nnot shown, same file: 210: @Test void dailyIndexFormat_overridingPrefix() {\n');
    expect(out).not.toContain('223: @Test');
    expect(out).toContain('\n2. also StorageConfigurationTest.java 223-234 method dailyIndexFormat_overridingDateSeparator\n');
  });

  it('a type row does not hide its members from the sibling line', () => {
    const out = render([top, row(1, 400, 'StorageConfigurationTest', 'class')]);
    expect(out).toContain('210: @Test');
    expect(out).toContain('223: @Test');
  });

  it('the line names neither the file nor the entry above it', () => {
    expect(render([top])).toMatch(/\nnot shown, same file: 210: [^\n]+ · 223: [^\n]+\n/);
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
    expect(out).toContain('\n2. also Interceptor.kt 183-247 function withAuthenticator, withCookieJar, withCache +3 more\n');
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
    expect(out).toContain('not shown, same file: 882: function convertArrowAsMethod(\n');
    expect(out).not.toContain('1196: function');
  });
});
