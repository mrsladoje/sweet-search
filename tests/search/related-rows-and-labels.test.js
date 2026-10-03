/**
 * Packager side of the 2026-10-04 ss-search output fixes (renderer side: agent-output-diet.test.js).
 *   1d. an entry names every top-level symbol of its span (annotateEntrySymbols);
 *   1e. related rows from ambiguous name-only resolution are dropped;
 *   2c. a short gap before a continuation is read, so the two print as one block;
 *   2d. related rows are selected by relevance to the query, with the shortest unique path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  estimateTokens,
  relatedRowScore,
  renderGraphNeighbors,
  selectRelatedRows,
  shortestUniquePath,
} from '../../core/search/context-expander.js';
import {
  annotateEntrySymbols,
  applyAgentPackCompletion,
  topLevelSymbolNames,
} from '../../core/search/agent-pack-completion.js';
import { informativeSubtokens } from '../../core/search/query-sufficiency.js';

let projectRoot;
beforeEach(() => { projectRoot = mkdtempSync(path.join(tmpdir(), 'related-rows-')); });
afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });
function write(rel, lines) {
  const abs = path.join(projectRoot, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `${lines.join('\n')}\n`);
  return rel;
}

describe('2c: a continuation after a short gap starts right after the entry', () => {
  const entry = {
    rank: 1, file: 'okhttp/Interceptor.kt', startLine: 85, endLine: 85, shownStartLine: 85, shownEndLine: 85,
    symbol: 'request', symbolType: 'function', presentation: 'full', expansionKind: 'full',
  };
  it('completion reads a short gap so the continuation is contiguous with the entry', () => {
    const file = 'okhttp/Interceptor.kt';
    write(file, Array.from({ length: 100 }, (_, i) => `line ${i + 1}`));
    const results = [
      { ...entry, code: 'line 85', codeTokens: 3 },
      { rank: 2, file: 'b.kt', startLine: 1, endLine: 20, symbol: 'b', presentation: 'preview', code: 'x'.repeat(560), codeTokens: 160 },
    ];
    const repo = {
      findAdjacentEntities: vi.fn(() => ({ above: [], below: [{ id: 'p', name: 'proceed', type: 'function', startLine: 87, endLine: 88 }] })),
      getEntityById: vi.fn(() => null),
      findEntitiesByAnyName: vi.fn(() => []),
      findFamilyCandidates: vi.fn(() => []),
    };
    applyAgentPackCompletion({
      results, query: 'proceed', regex: '', codeGraphRepo: repo, fileCache: new Map(), projectRoot,
      tokensUsed: 163, tokenBudget: 3000, estimateTokens, isAgentFormat: true,
    });
    expect(results[0].continuation).toMatchObject({ kind: 'symbol', startLine: 86, endLine: 88, symbol: 'proceed' });
    expect(results[0].continuation.code).toBe('line 86\nline 87\nline 88');
  });
});

// ---------------------------------------------------------------------------------------------
describe('1d: an entry names every top-level symbol of its span', () => {
  const entities = [
    { name: 'can_make_new?', type: 'method', startLine: 181, endLine: 185 },
    { name: 'try_make_new', type: 'method', startLine: 192, endLine: 218 },
    { name: 'to_disconnect', type: 'variable', startLine: 196, endLine: 196 },
    { name: 'acquire', type: 'method', startLine: 227, endLine: 234 },
  ];
  it('top-level names in line order; nested entities and repeated names once', () => {
    expect(topLevelSymbolNames(entities, 'can_make_new?')).toEqual(['can_make_new?', 'try_make_new', 'acquire']);
    expect(topLevelSymbolNames([...entities, { name: 'acquire', type: 'method', startLine: 230, endLine: 231 }], null))
      .toEqual(['can_make_new?', 'try_make_new', 'acquire']);
    // The chunk's own label first when its entity starts above the span.
    expect(topLevelSymbolNames(entities.slice(1), 'can_make_new?')).toEqual(['can_make_new?', 'try_make_new', 'acquire']);
    expect(topLevelSymbolNames([{ name: 'k', type: 'topKey', startLine: 1, endLine: 1 }], 'x')).toEqual(['x']);
  });
  it('annotateEntrySymbols stamps `symbols` only when the span declares more than one', () => {
    const results = [
      { file: 'a.rb', startLine: 174, endLine: 234, symbol: 'can_make_new?' },
      { file: 'a.rb', startLine: 181, endLine: 185, symbol: 'can_make_new?' },
    ];
    const repo = { findEntitiesInRange: (f, s, e) => entities.filter((x) => x.startLine >= s && x.startLine <= e) };
    annotateEntrySymbols(results, repo);
    expect(results[0].symbols).toEqual(['can_make_new?', 'try_make_new', 'acquire']);
    expect(results[1].symbols).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
describe('1e / 2d: related rows', () => {
  const caller = (name, filePath, startLine) => ({ type: 'calls', source: { id: name, name, type: 'function', filePath, startLine, endLine: startLine + 10 } });
  const entity = { id: 'e', filePath: 'okhttp/Interceptor.kt', startLine: 85, endLine: 85, name: 'request', type: 'function' };

  it('drops incoming rows of a name with many definitions and a large fan-in (name-only resolution)', () => {
    const incoming = Array.from({ length: 24 }, (_, i) => caller(`interceptorCall${i}`, `src/Interceptor${i}.kt`, 10));
    const repo = {
      getOutgoingRelationships: () => [],
      getIncomingRelationships: () => incoming,
      countEntitiesByAnyName: (names) => new Map(names.map((n) => [n.toLowerCase(), n === 'request' ? 18 : 1])),
    };
    expect(renderGraphNeighbors({ codeGraphRepo: repo, entity, skipKeys: new Set(), tokenCap: 600, query: 'interceptor call' })).toBeNull();
    // A unique name keeps its callers (then relevance selects among them).
    const unique = { ...repo, countEntitiesByAnyName: (names) => new Map(names.map((n) => [n.toLowerCase(), 1])) };
    const out = renderGraphNeighbors({ codeGraphRepo: unique, entity, skipKeys: new Set(), tokenCap: 600, query: 'interceptor call' });
    expect(out.rows).toHaveLength(3);
    expect(out.rows.every((r) => r.kind === 'caller')).toBe(true);
  });

  it('a body type name prefers a non-test definition and is skipped when ambiguous', () => {
    const repo = {
      getOutgoingRelationships: () => [],
      getIncomingRelationships: () => [],
      countEntitiesByAnyName: (names) => new Map(names.map((n) => [n.toLowerCase(), n === 'Sequel' ? 287 : 2])),
      findEntitiesByNames: (names, opts) => {
        expect(opts.distinct).toBe(false);
        return [
          { id: 's', name: 'Sequel', type: 'class', filePath: 'spec/core/database_spec.rb', startLine: 3103, endLine: 3105 },
          { id: 'p1', name: 'PoolTimeout', type: 'class', filePath: 'spec/pool_spec.rb', startLine: 1, endLine: 2 },
          { id: 'p2', name: 'PoolTimeout', type: 'class', filePath: 'lib/sequel/exceptions.rb', startLine: 40, endLine: 44 },
        ];
      },
    };
    const out = renderGraphNeighbors({
      codeGraphRepo: repo, entity: { ...entity, name: 'acquire', filePath: 'lib/timed_queue.rb' }, skipKeys: new Set(), tokenCap: 600,
      body: 'raise ::Sequel::PoolTimeout, "timeout"', query: 'connection pool raises on timeout',
    });
    expect(out.rows).toEqual([expect.objectContaining({ kind: 'type', name: 'PoolTimeout', file: 'lib/sequel/exceptions.rb' })]);
  });

  it('selection: test rows only when the query asks about tests, a threshold, at most maxRows', () => {
    const rows = [
      { kind: 'caller', name: 'gzipThroughCall', file: 'okhttp/src/commonTest/kotlin/okhttp3/CompressionInterceptorTest.kt', startLine: 67, endLine: 92 },
      { kind: 'caller', name: 'getResponseWithInterceptorChain', file: 'okhttp/src/main/RealCall.kt', startLine: 210, endLine: 260 },
      { kind: 'caller', name: 'intercept', file: 'okhttp/src/main/RetryAndFollowUpInterceptor.kt', startLine: 72, endLine: 140 },
      { kind: 'calls', name: 'toString', file: 'okhttp/src/main/Util.kt', startLine: 1, endLine: 3 },
    ];
    const q = 'how are interceptors chained and how does each one call the next';
    expect(selectRelatedRows(rows, q).map((r) => r.name)).toEqual(['getResponseWithInterceptorChain', 'intercept']);
    expect(selectRelatedRows(rows, `${q} in tests`).map((r) => r.name)).toContain('gzipThroughCall');
    expect(selectRelatedRows(rows, q, [], 1).map((r) => r.name)).toEqual(['getResponseWithInterceptorChain']);
    expect(selectRelatedRows(rows, 'parse yaml frontmatter')).toEqual([]);
    // A row whose entity is a search candidate gets a bonus point.
    const qt = [...informativeSubtokens('string formatting')];
    expect(relatedRowScore(rows[3], qt, [{ file: 'okhttp/src/main/Util.kt', startLine: 2, endLine: 9 }]))
      .toBe(relatedRowScore(rows[3], qt) + 1);
  });

  it('shortest unique path: the basename when no other repository file shares it', () => {
    const index = new Map([
      ['RealCall.kt', ['okhttp/src/main/RealCall.kt']],
      ['index.ts', ['src/a/index.ts', 'src/b/index.ts', 'lib/b/index.ts']],
    ]);
    expect(shortestUniquePath('okhttp/src/main/RealCall.kt', index)).toBe('RealCall.kt');
    expect(shortestUniquePath('src/a/index.ts', index)).toBe('a/index.ts');
    expect(shortestUniquePath('src/b/index.ts', index)).toBe('src/b/index.ts');
    expect(shortestUniquePath('x/y.kt', null)).toBe('x/y.kt');
  });

});
