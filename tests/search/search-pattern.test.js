/**
 * Pattern Search Unit + Integration Tests
 *
 * Tests for core/search-pattern.js — the ColGrep-style hybrid regex + semantic
 * ranking module.
 *
 * Pure helper functions are tested directly. The prototype-bound `patternSearch`
 * is tested via `.call(mockThis, ...)` with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

import {
  bareGrep,
  buildChunkLocationMap,
  extractLiteralClauses,
  extractLiteralClausesHeuristic,
  extractRequiredLiteralsHeuristic,
  findChunkForLine,
  mapMatchesToChunks,
  querySparseGramCandidates,
  readFileRange,
  getChunkLocationMap,
  patternSearch,
  isRipgrepAvailable,
  _resetRgCache,
  runRipgrep,
} from '../../core/search/index.js';

// =============================================================================
// extractRequiredLiteralsHeuristic
// =============================================================================

describe('extractRequiredLiteralsHeuristic', () => {
  it('extracts fixed literals from concatenated regex fragments', () => {
    expect(extractRequiredLiteralsHeuristic('class\\s+Auth\\w+Service')).toEqual([
      'class',
      'Auth',
      'Service',
    ]);
  });

  it('returns no literals for alternation-heavy patterns to avoid false negatives', () => {
    expect(extractRequiredLiteralsHeuristic('(get|set)Config')).toEqual([]);
    expect(extractRequiredLiteralsHeuristic('foo|bar')).toEqual([]);
  });

  it('keeps surrounding literals around character classes and quantifiers', () => {
    expect(extractRequiredLiteralsHeuristic('import\\s+{[^}]+}\\s+from\\s+react')).toEqual([
      'import',
      'from',
      'react',
    ]);
  });
});

describe('extractLiteralClausesHeuristic', () => {
  it('wraps heuristic literals in a single AND clause', () => {
    expect(extractLiteralClausesHeuristic('class\\s+Auth\\w+Service')).toEqual([
      ['class', 'Auth', 'Service'],
    ]);
  });

  it('returns no clauses when the heuristic finds no safe literals', () => {
    expect(extractLiteralClausesHeuristic('foo|bar')).toEqual([]);
  });
});

describe('extractLiteralClauses', () => {
  it('falls back to the heuristic extractor when forced', () => {
    expect(extractLiteralClauses('class\\s+Auth\\w+Service', { forceHeuristic: true })).toEqual({
      clauses: [['class', 'Auth', 'Service']],
      source: 'heuristic',
    });
  });
});

// =============================================================================
// querySparseGramCandidates
// =============================================================================

describe('querySparseGramCandidates', () => {
  it('returns null when gram index is disabled', () => {
    const searcher = {
      sparseGramIndex: {
        queryLiterals: vi.fn(),
      },
    };

    expect(querySparseGramCandidates(searcher, [['auth']], { gramIndex: false })).toBeNull();
    expect(searcher.sparseGramIndex.queryLiterals).not.toHaveBeenCalled();
  });

  it('returns null when native query is not eligible', () => {
    const searcher = {
      sparseGramIndex: {
        queryLiterals: vi.fn().mockReturnValue({ eligible: false, files: [] }),
      },
    };

    expect(querySparseGramCandidates(searcher, [['auth']])).toBeNull();
  });

  it('returns candidate files from the native sparse gram index', () => {
    const result = {
      eligible: true,
      files: ['src/auth.js', 'docs/guide.md', 'src/session.js'],
      totalFiles: 42,
      candidateFiles: 3,
      gramsUsed: 5,
    };
    const searcher = {
      sparseGramIndex: {
        queryLiterals: vi.fn().mockReturnValue(result),
      },
    };

    expect(querySparseGramCandidates(searcher, [['AuthService']])).toEqual({
      ...result,
      denseGramsTouched: 0,
      candidateFiles: 2,
      files: ['src/auth.js', 'src/session.js'],
      sparseGramsTouched: 0,
    });
    expect(searcher.sparseGramIndex.queryLiterals).toHaveBeenCalledWith(['AuthService'], 0, 0);
  });

  it('falls back when gram candidates are too broad', () => {
    const searcher = {
      sparseGramIndex: {
        queryLiterals: vi.fn().mockReturnValue({
          eligible: true,
          files: Array.from({ length: 700 }, (_, i) => `src/file-${i}.js`),
          totalFiles: 1000,
        }),
      },
    };

    expect(querySparseGramCandidates(searcher, [['AuthService']])).toBeNull();
  });
});

// =============================================================================
// buildChunkLocationMap
// =============================================================================

describe('buildChunkLocationMap', () => {
  function makeLiIndex(docs) {
    return {
      documents: new Map(
        docs.map(d => [d.id, { metadata: d.meta, tokens: new Int8Array(10), numTokens: 1, dim: 10 }])
      ),
    };
  }

  it('builds map with sorted intervals per file', () => {
    const liIndex = makeLiIndex([
      { id: 'c1', meta: { file: 'a.js', startLine: 10, endLine: 20 } },
      { id: 'c2', meta: { file: 'a.js', startLine: 1, endLine: 9 } },
      { id: 'c3', meta: { file: 'b.js', startLine: 5, endLine: 15 } },
    ]);

    const map = buildChunkLocationMap(liIndex);

    expect(map.size).toBe(2);
    expect(map.get('a.js')).toHaveLength(2);
    // Should be sorted by startLine
    expect(map.get('a.js')[0].id).toBe('c2');
    expect(map.get('a.js')[1].id).toBe('c1');
    expect(map.get('b.js')).toHaveLength(1);
  });

  it('skips entries missing startLine or endLine', () => {
    const liIndex = makeLiIndex([
      { id: 'c1', meta: { file: 'a.js', startLine: 1 } },
      { id: 'c2', meta: { file: 'a.js', endLine: 10 } },
      { id: 'c3', meta: { file: 'a.js' } },
      { id: 'c4', meta: { file: 'a.js', startLine: 1, endLine: 10 } },
    ]);

    const map = buildChunkLocationMap(liIndex);

    expect(map.get('a.js')).toHaveLength(1);
    expect(map.get('a.js')[0].id).toBe('c4');
  });

  it('skips entries without file', () => {
    const liIndex = makeLiIndex([
      { id: 'c1', meta: { startLine: 1, endLine: 10 } },
      { id: 'c2', meta: {} },
    ]);

    const map = buildChunkLocationMap(liIndex);
    expect(map.size).toBe(0);
  });

  it('returns empty map for empty index', () => {
    const liIndex = makeLiIndex([]);
    const map = buildChunkLocationMap(liIndex);
    expect(map.size).toBe(0);
  });
});

// =============================================================================
// findChunkForLine
// =============================================================================

describe('findChunkForLine', () => {
  const intervals = [
    { startLine: 1, endLine: 10, id: 'c1' },
    { startLine: 11, endLine: 25, id: 'c2' },
    { startLine: 30, endLine: 50, id: 'c3' },
    { startLine: 55, endLine: 100, id: 'c4' },
  ];

  it('finds chunk at exact startLine', () => {
    expect(findChunkForLine(intervals, 1)).toBe('c1');
    expect(findChunkForLine(intervals, 11)).toBe('c2');
    expect(findChunkForLine(intervals, 30)).toBe('c3');
    expect(findChunkForLine(intervals, 55)).toBe('c4');
  });

  it('finds chunk at exact endLine', () => {
    expect(findChunkForLine(intervals, 10)).toBe('c1');
    expect(findChunkForLine(intervals, 25)).toBe('c2');
    expect(findChunkForLine(intervals, 50)).toBe('c3');
    expect(findChunkForLine(intervals, 100)).toBe('c4');
  });

  it('finds chunk at midpoint', () => {
    expect(findChunkForLine(intervals, 5)).toBe('c1');
    expect(findChunkForLine(intervals, 18)).toBe('c2');
    expect(findChunkForLine(intervals, 40)).toBe('c3');
    expect(findChunkForLine(intervals, 75)).toBe('c4');
  });

  it('returns null for gap between chunks', () => {
    expect(findChunkForLine(intervals, 27)).toBeNull();
    expect(findChunkForLine(intervals, 52)).toBeNull();
  });

  it('returns null for line before first chunk', () => {
    const gapped = [{ startLine: 5, endLine: 10, id: 'c1' }];
    expect(findChunkForLine(gapped, 1)).toBeNull();
  });

  it('returns null for line after last chunk', () => {
    expect(findChunkForLine(intervals, 101)).toBeNull();
  });

  it('returns null for undefined/null/empty intervals', () => {
    expect(findChunkForLine(undefined, 5)).toBeNull();
    expect(findChunkForLine(null, 5)).toBeNull();
    expect(findChunkForLine([], 5)).toBeNull();
  });

  it('works with single-line chunks', () => {
    const singleLine = [
      { startLine: 5, endLine: 5, id: 's1' },
      { startLine: 10, endLine: 10, id: 's2' },
    ];
    expect(findChunkForLine(singleLine, 5)).toBe('s1');
    expect(findChunkForLine(singleLine, 10)).toBe('s2');
    expect(findChunkForLine(singleLine, 7)).toBeNull();
  });
});

// =============================================================================
// mapMatchesToChunks
// =============================================================================

describe('mapMatchesToChunks', () => {
  const locationMap = new Map([
    ['src/auth.js', [
      { startLine: 1, endLine: 20, id: 'auth-c1' },
      { startLine: 21, endLine: 50, id: 'auth-c2' },
    ]],
    ['src/db.js', [
      { startLine: 1, endLine: 100, id: 'db-c1' },
    ]],
  ]);

  it('maps matches to correct chunk IDs', () => {
    const matches = [
      { file: 'src/auth.js', line: 5, content: 'class AuthService {' },
      { file: 'src/auth.js', line: 30, content: 'login()' },
      { file: 'src/db.js', line: 50, content: 'query()' },
    ];

    const { chunkIds, unindexed } = mapMatchesToChunks(matches, locationMap);

    expect(chunkIds.size).toBe(3);
    expect(chunkIds.has('auth-c1')).toBe(true);
    expect(chunkIds.has('auth-c2')).toBe(true);
    expect(chunkIds.has('db-c1')).toBe(true);
    expect(unindexed).toHaveLength(0);
  });

  it('reports unindexed for unknown files', () => {
    const matches = [
      { file: 'src/unknown.js', line: 1, content: 'foo' },
    ];

    const { chunkIds, unindexed } = mapMatchesToChunks(matches, locationMap);

    expect(chunkIds.size).toBe(0);
    expect(unindexed).toHaveLength(1);
    expect(unindexed[0].file).toBe('src/unknown.js');
  });

  it('reports unindexed for lines in gaps', () => {
    const matches = [
      { file: 'src/auth.js', line: 200, content: 'past end' },
    ];

    const { chunkIds, unindexed } = mapMatchesToChunks(matches, locationMap);

    expect(chunkIds.size).toBe(0);
    expect(unindexed).toHaveLength(1);
  });

  it('deduplicates chunk IDs from multiple matches in same chunk', () => {
    const matches = [
      { file: 'src/auth.js', line: 5, content: 'line 5' },
      { file: 'src/auth.js', line: 10, content: 'line 10' },
      { file: 'src/auth.js', line: 15, content: 'line 15' },
    ];

    const { chunkIds } = mapMatchesToChunks(matches, locationMap);

    expect(chunkIds.size).toBe(1);
    expect(chunkIds.has('auth-c1')).toBe(true);
  });

  it('handles empty matches array', () => {
    const { chunkIds, unindexed } = mapMatchesToChunks([], locationMap);
    expect(chunkIds.size).toBe(0);
    expect(unindexed).toHaveLength(0);
  });

  it('handles empty location map', () => {
    const matches = [{ file: 'src/auth.js', line: 5, content: 'foo' }];
    const { chunkIds, unindexed } = mapMatchesToChunks(matches, new Map());
    expect(chunkIds.size).toBe(0);
    expect(unindexed).toHaveLength(1);
  });
});

// =============================================================================
// readFileRange (with per-search file cache)
// =============================================================================

describe('readFileRange', () => {
  it('reads lines from a real file', () => {
    const cache = new Map();
    // Read line 1 of this test file
    const thisFile = path.resolve(import.meta.dirname, 'search-pattern.test.js');
    const result = readFileRange(cache, thisFile, 1, 3);
    expect(result).toContain('Pattern Search');
    // Cache should have been populated
    expect(cache.size).toBe(1);
  });

  it('caches file reads — second call uses cache', () => {
    const cache = new Map();
    const thisFile = path.resolve(import.meta.dirname, 'search-pattern.test.js');

    const result1 = readFileRange(cache, thisFile, 1, 1);
    const result2 = readFileRange(cache, thisFile, 2, 2);

    // Both succeed, cache only has one entry (same file)
    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
    expect(cache.size).toBe(1);
  });

  it('returns null for non-existent file', () => {
    const cache = new Map();
    const result = readFileRange(cache, '/nonexistent/file.js', 1, 1);
    expect(result).toBeNull();
  });
});

// =============================================================================
// getChunkLocationMap (cached on this)
// =============================================================================

describe('getChunkLocationMap', () => {
  it('builds map on first call and caches it', () => {
    const mockThis = {
      lateInteractionIndex: {
        documents: new Map([
          ['c1', { metadata: { file: 'a.js', startLine: 1, endLine: 10 } }],
        ]),
      },
    };

    const map1 = getChunkLocationMap.call(mockThis);
    expect(map1.size).toBe(1);
    expect(mockThis._chunkLocationMap).toBe(map1);

    // Second call returns cached
    const map2 = getChunkLocationMap.call(mockThis);
    expect(map2).toBe(map1);
  });

  it('rebuilds when document count changes', () => {
    const docs = new Map([
      ['c1', { metadata: { file: 'a.js', startLine: 1, endLine: 10 } }],
    ]);
    const mockThis = {
      lateInteractionIndex: { documents: docs },
    };

    const map1 = getChunkLocationMap.call(mockThis);
    expect(map1.size).toBe(1);

    // Add a document — should rebuild
    docs.set('c2', { metadata: { file: 'b.js', startLine: 1, endLine: 5 } });
    const map2 = getChunkLocationMap.call(mockThis);
    expect(map2).not.toBe(map1);
    expect(map2.size).toBe(2);
  });
});

// =============================================================================
// isRipgrepAvailable (race-safe)
// =============================================================================

describe('isRipgrepAvailable', () => {
  beforeEach(() => {
    _resetRgCache();
  });

  it('returns a boolean', async () => {
    const result = await isRipgrepAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('returns same promise on concurrent calls', () => {
    const p1 = isRipgrepAvailable();
    const p2 = isRipgrepAvailable();
    // Same promise object — no double spawn
    expect(p1).toBe(p2);
  });
});

// =============================================================================
// patternSearch (prototype-bound, tested via .call with mocked deps)
// =============================================================================

// Resolve rg availability once (top-level await is fine in ESM)
const rgAvailable = await isRipgrepAvailable();

describe('patternSearch', () => {
  it('throws if regex is not provided', async () => {
    const mockThis = { verbose: false };
    await expect(
      patternSearch.call(mockThis, 'auth', null, {})
    ).rejects.toThrow('requires a regex');
  });

  it('throws if regex is empty string', async () => {
    const mockThis = { verbose: false };
    await expect(
      patternSearch.call(mockThis, 'auth', null, { regex: '' })
    ).rejects.toThrow('requires a regex');
  });

  it('throws if LI index not available', async () => {
    const mockThis = {
      verbose: false,
      hasLateInteractionIndex: false,
    };
    await expect(
      patternSearch.call(mockThis, 'auth', null, { regex: 'class.*' })
    ).rejects.toThrow('late interaction index');
  });

  it.skipIf(!rgAvailable)('fails fast when the LI index lacks line span metadata', async () => {
    const mockThis = {
      verbose: false,
      hasLateInteractionIndex: true,
      lateInteractionIndex: {
        documents: new Map([
          ['c1', { metadata: { file: 'a.js' }, tokens: new Int8Array(10), numTokens: 1, dim: 10, min: 0, scale: 1 }],
        ]),
        init: vi.fn(),
      },
      getChunkLocationMap() {
        return new Map();
      },
    };

    await expect(
      patternSearch.call(mockThis, 'auth', null, { regex: 'class.*', k: 5 })
    ).rejects.toThrow('line spans');
  });

  it.skipIf(!rgAvailable)('returns empty results when grep finds no matches', async () => {
    // This tests the full pipeline with a regex that won't match anything
    const regex = ['ZZZZNOTFOUND', 'XYZZY', 'NEVERMATCHES', '42'].join('_');
    const mockLiIndex = {
      documents: new Map([
        ['c1', { metadata: { file: 'a.js', startLine: 1, endLine: 10 }, tokens: new Int8Array(10), numTokens: 1, dim: 10, min: 0, scale: 1 }],
      ]),
      init: vi.fn(),
      hasTokens: vi.fn().mockReturnValue(new Set()),
      scoreWithLateInteraction: vi.fn().mockResolvedValue([]),
    };

    const mockThis = {
      verbose: false,
      hasLateInteractionIndex: true,
      lateInteractionIndex: mockLiIndex,
      _chunkLocationMap: null,
      _chunkLocationMapSize: 0,
      getChunkLocationMap,
    };

    // Use a regex that won't match any file in the project
    const result = await patternSearch.call(
      mockThis, 'some query', null,
      { regex, k: 5 }
    );

    expect(result.results).toEqual([]);
    expect(result.stats.path).toBe('pattern');
    expect(result.stats.grepMatches).toBe(0);
  });

  it.skipIf(!rgAvailable)('returns results with correct stats shape', async () => {
    const regex = ['ZZZZNOTFOUND', 'XYZZY', '42'].join('_');
    const mockLiIndex = {
      documents: new Map([
        ['c1', { metadata: { file: 'a.js', startLine: 1, endLine: 10 }, tokens: new Int8Array(10), numTokens: 1, dim: 10, min: 0, scale: 1 }],
      ]),
      init: vi.fn(),
      hasTokens: vi.fn().mockReturnValue(new Set()),
      scoreWithLateInteraction: vi.fn().mockResolvedValue([]),
    };

    const mockThis = {
      verbose: false,
      hasLateInteractionIndex: true,
      lateInteractionIndex: mockLiIndex,
      _chunkLocationMap: null,
      _chunkLocationMapSize: 0,
      getChunkLocationMap,
    };

    const result = await patternSearch.call(
      mockThis, 'query', null,
      { regex, k: 5 }
    );

    // Verify stats shape
    expect(result.stats).toHaveProperty('path', 'pattern');
    expect(result.stats).toHaveProperty('regex');
    expect(result.stats).toHaveProperty('grepMatches');
    expect(result.stats).toHaveProperty('candidateGenTime_ms');
    expect(result.stats).toHaveProperty('grepTime_ms');
    expect(result.stats).toHaveProperty('literalFilterTime_ms');
    expect(result.stats).toHaveProperty('gramLookupTime_ms');
    expect(result.stats).toHaveProperty('encodeTime_ms');
    expect(result.stats).toHaveProperty('filesConsidered');
    expect(result.stats).toHaveProperty('filesScanned');
    expect(result.stats).toHaveProperty('filesSkipped');
    expect(result.stats).toHaveProperty('dirtyOverlayFiles');
    expect(result.stats).toHaveProperty('candidateFilesBeforeFilter');
    expect(result.stats).toHaveProperty('candidateFilesAfterFilter');
    expect(result.stats).toHaveProperty('candidateReductionRatio');
    expect(result.stats).toHaveProperty('literalExtractionHit');
    expect(result.stats).toHaveProperty('parallelTime_ms');
    expect(result.stats).toHaveProperty('total_ms');
    expect(typeof result.stats.total_ms).toBe('number');
  });
});

describe('bareGrep', () => {
  it('throws if regex is not provided', async () => {
    await expect(
      bareGrep.call({ projectRoot: process.cwd() }, '', null, {})
    ).rejects.toThrow('requires a regex');
  });

  it.skipIf(!rgAvailable)('returns empty grep results when no files match', async () => {
    const impossiblePattern = ['ZZZZ', 'UNLIKELY', 'MATCH', 'PATTERN', 'QXJ_7319'].join('__');
    const result = await bareGrep.call(
      { projectRoot: process.cwd(), sparseGramIndex: null },
      impossiblePattern,
      null,
      { regex: impossiblePattern, maxMatches: 10 }
    );

    expect(result.results).toEqual([]);
    expect(result.stats.path).toBe('grep');
    expect(result.stats.totalMatches).toBe(0);
  });

  it.skipIf(!rgAvailable)('matches raw ripgrep on the same corpus', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-grep-'));
    try {
      await fs.writeFile(path.join(tmpDir, 'a.js'), 'class AuthService {}\nconst x = new AuthService();\n');
      await fs.writeFile(path.join(tmpDir, 'b.js'), 'const y = 1;\n');

      const regex = 'AuthService';
      const grepResult = await bareGrep.call(
        { projectRoot: tmpDir, sparseGramIndex: null },
        regex,
        null,
        { regex, gramIndex: false }
      );
      const rgMatches = await runRipgrep(regex, tmpDir, { maxMatches: 0 });

      const grepKeys = grepResult.results.map(r => `${r.file}:${r.line}:${r.column}`);
      const rgKeys = rgMatches.map(r => `${r.file}:${r.line}:${r.column || 1}`);

      expect(grepKeys).toEqual(rgKeys);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it.skipIf(!rgAvailable)('filters grep results by symbol type using indexed chunk metadata', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-grep-type-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'a.js'),
        'function authHandler() {}\nconst authValue = authHandler();\nclass AuthBox {}\n'
      );

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          iterate: () => ([
            {
              file_path: 'a.js',
              metadata: JSON.stringify({
                type: 'function',
                name: 'authHandler',
                startLine: 1,
                endLine: 2,
              }),
            },
            {
              file_path: 'a.js',
              metadata: JSON.stringify({
                type: 'class',
                name: 'AuthBox',
                startLine: 3,
                endLine: 3,
              }),
            },
          ]),
        }),
      };

      const grepResult = await bareGrep.call(
        {
          projectRoot: tmpDir,
          sparseGramIndex: null,
          codebaseDb: mockDb,
        },
        'Auth',
        null,
        { regex: 'Auth', gramIndex: false, type: 'class' }
      );

      expect(grepResult.results).toHaveLength(1);
      expect(grepResult.results[0].line).toBe(3);
      expect(grepResult.stats.symbolType).toBe('class');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
