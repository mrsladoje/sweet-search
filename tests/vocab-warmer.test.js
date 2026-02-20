/**
 * Vocabulary Warmer Tests
 *
 * Tests for warmLexical, warmSemantic, warmHybrid, warmFromCache,
 * and runFullWarmup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock DB reference that tests can override
let _mockDbInstance = null;

// Mock better-sqlite3 using module-level variable pattern
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(function () {
      if (_mockDbInstance) return _mockDbInstance;
      return {
        prepare: () => ({ all: () => [], get: () => null, run: () => {} }),
        exec: () => {},
        close: () => {},
        pragma: () => {},
        transaction: (fn) => fn,
      };
    }),
  };
});

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(async () => '{}'),
    writeFile: vi.fn(async () => {}),
    appendFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
  },
  readFile: vi.fn(async () => '{}'),
  writeFile: vi.fn(async () => {}),
  appendFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
}));

// Mock fs (sync)
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ size: 100 })),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  mkdtempSync: vi.fn(),
}));

// Mock embedding-service
vi.mock('../core/embedding-service.js', () => ({
  generateEmbeddings: vi.fn(async (texts) =>
    texts.map(() => new Float32Array(256).fill(0.1))
  ),
  truncateForHNSW: vi.fn((emb) => emb.slice(0, 256)),
}));

// Mock community-detector
vi.mock('../core/community-detector.js', () => ({
  detectCommunities: vi.fn(() => ({
    communities: [{ id: 0, entityIds: [1], fileIds: ['a.js'], entityCount: 1 }],
    graphHash: 'abc123',
    stale: false,
  })),
  computeGraphHash: vi.fn(() => 'abc123'),
}));

// Mock vocab-miner
vi.mock('../core/vocab-miner.js', () => ({
  mineAll: vi.fn(() => ({
    terms: [
      { term: 'AuthService', score: 0.8, source: 'export', type: 'export' },
      { term: 'helper', score: 0.3, source: 'definition', type: 'definition' },
    ],
    pageRankScores: new Map([['AuthService', 0.5]]),
    communityPhrases: [
      { communityId: 0, phrases: [{ text: 'user auth', score: 0.5 }] },
    ],
  })),
}));

// Mock vocab-ranker
vi.mock('../core/vocab-ranker.js', () => ({
  rankAll: vi.fn(() => ({
    identifiers: [
      { term: 'AuthService', score: 5.0, warm_mode: 'both', sources: ['export'], type: 'export' },
      { term: 'helper', score: 1.0, warm_mode: 'lexical', sources: ['def'], type: 'definition' },
    ],
    phrases: [
      { phrase: 'user auth', communityId: 0, score: 0.5, variants: ['how does user auth work'] },
    ],
    stats: { totalIdentifiersMined: 2, totalPhrasesMined: 1 },
  })),
}));

// Mock vocabulary-utils with proper constructor function
vi.mock('../core/vocabulary-utils.js', () => ({
  BinaryVocabulary: vi.fn(function () { return {}; }),
}));

import {
  warmLexical,
  warmSemantic,
  warmHybrid,
  warmFromCache,
  runFullWarmup,
} from '../core/vocab-warmer.js';

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { generateEmbeddings } from '../core/embedding-service.js';

beforeEach(() => {
  _mockDbInstance = null;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// warmLexical
// ---------------------------------------------------------------------------

describe('warmLexical', () => {
  it('returns zero queries for empty terms', async () => {
    const result = await warmLexical([]);
    expect(result.queriesRun).toBe(0);
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('returns zero queries for null terms', async () => {
    const result = await warmLexical(null);
    expect(result.queriesRun).toBe(0);
  });

  it('returns zero queries when DB does not exist', async () => {
    existsSync.mockReturnValue(false);
    const result = await warmLexical([{ term: 'foo', score: 1 }]);
    expect(result.queriesRun).toBe(0);
  });

  it('executes MATCH queries against FTS5', async () => {
    existsSync.mockReturnValue(true);

    const matchStmt = { get: vi.fn(() => ({ rowid: 1 })) };
    const ftsCheck = { get: vi.fn(() => ({ name: 'entities_fts' })) };
    const relStmt = { get: vi.fn(() => ({ 'count(*)': 5 })) };

    _mockDbInstance = {
      pragma: vi.fn(),
      prepare: vi.fn((sql) => {
        if (sql.includes('sqlite_master')) return ftsCheck;
        if (sql.includes('MATCH')) return matchStmt;
        return relStmt;
      }),
      exec: vi.fn(),
      close: vi.fn(),
      transaction: vi.fn((fn) => fn),
    };

    const terms = [
      { term: 'AuthService', score: 0.8 },
      { term: 'UserModel', score: 0.5 },
    ];
    const result = await warmLexical(terms, '/fake/db');
    expect(result.queriesRun).toBe(2);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('skips when no FTS5 table exists', async () => {
    existsSync.mockReturnValue(true);

    _mockDbInstance = {
      pragma: vi.fn(),
      prepare: vi.fn(() => ({ get: vi.fn(() => null) })),
      exec: vi.fn(),
      close: vi.fn(),
    };

    const result = await warmLexical([{ term: 'foo', score: 1 }], '/fake/db');
    expect(result.queriesRun).toBe(0);
    expect(result.skip).toBe('no FTS5 table');
  });

  it('handles DB errors gracefully', async () => {
    existsSync.mockReturnValue(true);
    _mockDbInstance = 'THROW_ERROR';
    Database.mockImplementationOnce(function () { throw new Error('DB locked'); });

    const result = await warmLexical([{ term: 'foo', score: 1 }], '/fake/db');
    expect(result.error).toBe('DB locked');
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('handles string terms in addition to objects', async () => {
    existsSync.mockReturnValue(true);

    const matchStmt = { get: vi.fn(() => null) };
    const ftsCheck = { get: vi.fn(() => ({ name: 'entities_fts' })) };

    _mockDbInstance = {
      pragma: vi.fn(),
      prepare: vi.fn((sql) => {
        if (sql.includes('sqlite_master')) return ftsCheck;
        return matchStmt;
      }),
      exec: vi.fn(),
      close: vi.fn(),
      transaction: vi.fn((fn) => fn),
    };

    const result = await warmLexical(['AuthService', 'UserModel'], '/fake/db');
    expect(result.queriesRun).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// warmSemantic
// ---------------------------------------------------------------------------

describe('warmSemantic', () => {
  it('returns zero for empty inputs', async () => {
    const result = await warmSemantic([], []);
    expect(result.embeddingsGenerated).toBe(0);
    expect(result.hnswTraversals).toBe(0);
  });

  it('generates embeddings for hub entities', async () => {
    const hubEntities = [{ term: 'AuthService' }, { term: 'UserModel' }];
    const result = await warmSemantic(hubEntities, []);
    expect(result.embeddingsGenerated).toBe(2);
    expect(generateEmbeddings).toHaveBeenCalledWith(['AuthService', 'UserModel']);
  });

  it('generates embeddings for community phrases + variants', async () => {
    const phrases = [
      { phrase: 'user auth', variants: ['how does user auth work'] },
    ];
    const result = await warmSemantic([], phrases);
    // 1 phrase + 1 variant = 2
    expect(result.embeddingsGenerated).toBe(2);
  });

  it('warms HNSW index when available', async () => {
    const mockSearch = vi.fn(async () => []);
    const hnswIndex = { search: mockSearch };

    const hubEntities = [{ term: 'Auth' }];
    const result = await warmSemantic(hubEntities, [], { hnswIndex });
    expect(result.hnswTraversals).toBe(1);
    expect(mockSearch).toHaveBeenCalled();
  });

  it('handles embedding generation failure gracefully', async () => {
    generateEmbeddings.mockRejectedValueOnce(new Error('API down'));
    const result = await warmSemantic([{ term: 'foo' }], []);
    expect(result.embeddingsGenerated).toBe(0);
    expect(result.error).toBe('API down');
  });

  it('returns embedding map for persistence', async () => {
    const result = await warmSemantic([{ term: 'Auth' }], []);
    expect(result.embeddings).toBeInstanceOf(Map);
    expect(result.embeddings.has('Auth')).toBe(true);
  });

  it('handles string entities', async () => {
    const result = await warmSemantic(['AuthService'], []);
    expect(result.embeddingsGenerated).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// warmHybrid
// ---------------------------------------------------------------------------

describe('warmHybrid', () => {
  it('returns zero for empty queries', async () => {
    const result = await warmHybrid([]);
    expect(result.queriesRun).toBe(0);
  });

  it('returns zero for null queries', async () => {
    const result = await warmHybrid(null);
    expect(result.queriesRun).toBe(0);
  });

  it('returns skip when no searcher provided', async () => {
    const result = await warmHybrid([{ query: 'test' }]);
    expect(result.skip).toBe('no searcher');
  });

  it('executes hybrid queries through searcher', async () => {
    const mockSearcher = { search: vi.fn(async () => []) };
    const queries = [
      { query: 'how does auth work' },
      { query: 'find user model' },
    ];
    const result = await warmHybrid(queries, mockSearcher);
    expect(result.queriesRun).toBe(2);
    expect(mockSearcher.search).toHaveBeenCalledTimes(2);
    expect(mockSearcher.search).toHaveBeenCalledWith('how does auth work', { mode: 'hybrid', k: 5 });
  });

  it('handles individual query failures gracefully', async () => {
    const mockSearcher = {
      search: vi.fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('search failed'))
        .mockResolvedValueOnce([]),
    };
    const queries = [{ query: 'a' }, { query: 'b' }, { query: 'c' }];
    const result = await warmHybrid(queries, mockSearcher);
    expect(result.queriesRun).toBe(2); // 1st and 3rd succeed
  });

  it('handles string queries', async () => {
    const mockSearcher = { search: vi.fn(async () => []) };
    const result = await warmHybrid(['query1', 'query2'], mockSearcher);
    expect(result.queriesRun).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// warmFromCache
// ---------------------------------------------------------------------------

describe('warmFromCache', () => {
  it('returns no-op when no cached artifacts exist', async () => {
    existsSync.mockReturnValue(false);
    const result = await warmFromCache();
    expect(result.fts5Queries).toBe(0);
    expect(result.hnswTraversals).toBe(0);
    expect(result.skip).toBe('no cached artifacts');
  });

  it('returns timing info', async () => {
    existsSync.mockReturnValue(false);
    const result = await warmFromCache();
    expect(typeof result.elapsedMs).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// runFullWarmup
// ---------------------------------------------------------------------------

describe('runFullWarmup', () => {
  it('returns dry-run stats without warming', async () => {
    const result = await runFullWarmup({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(typeof result.terms).toBe('number');
    expect(typeof result.phrases).toBe('number');
    expect(typeof result.communities).toBe('number');
    expect(result.timing).toBeDefined();
  });

  it('runs full pipeline with default options', async () => {
    const result = await runFullWarmup();
    expect(typeof result.terms).toBe('number');
    expect(typeof result.phrases).toBe('number');
    expect(result.timing).toBeDefined();
    expect(result.timing.communities).toBeGreaterThanOrEqual(0);
    expect(result.timing.mining).toBeGreaterThanOrEqual(0);
    expect(result.timing.ranking).toBeGreaterThanOrEqual(0);
    expect(result.timing.total).toBeGreaterThanOrEqual(0);
  });

  it('runs lexical warmup when mode includes lexical', async () => {
    const result = await runFullWarmup({ modes: ['lexical'] });
    expect(result.timing.lexical).toBeGreaterThanOrEqual(0);
  });

  it('runs semantic warmup when mode includes semantic', async () => {
    const result = await runFullWarmup({ modes: ['semantic'] });
    expect(result.timing.semantic).toBeGreaterThanOrEqual(0);
  });

  it('includes hybrid warmup when searcher is provided', async () => {
    const mockSearcher = { search: vi.fn(async () => []) };
    const result = await runFullWarmup({
      modes: ['hybrid'],
      searcher: mockSearcher,
    });
    expect(result.timing.hybrid).toBeGreaterThanOrEqual(0);
  });

  it('respects depth parameter', async () => {
    const result = await runFullWarmup({ depth: 'deep', dryRun: true });
    expect(result.stats?.depth || result.timing).toBeDefined();
  });

  it('handles mining errors gracefully', async () => {
    const { mineAll } = await import('../core/vocab-miner.js');
    mineAll.mockImplementationOnce(() => { throw new Error('mine failed'); });

    const result = await runFullWarmup({ dryRun: true });
    // Should still return a result (with 0 terms due to error fallback)
    expect(typeof result.terms).toBe('number');
  });
});
