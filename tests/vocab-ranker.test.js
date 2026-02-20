/**
 * Vocabulary Ranker Tests
 *
 * Tests for classifyWarmMode, rankIdentifiers, rankCommunityPhrases,
 * rankAll, and internal utilities.
 * Pure computation module — no mocks needed.
 */

import { describe, it, expect } from 'vitest';

import {
  classifyWarmMode,
  rankIdentifiers,
  rankCommunityPhrases,
  rankAll,
  _internals,
} from '../core/vocab-ranker.js';

const {
  computeIDF,
  bm25Score,
  computeHeuristicMultiplier,
  deduplicatePhrases,
  MULTIPLIERS,
  DEPTH_CUTOFFS,
  QUESTION_TEMPLATES,
} = _internals;

// ---------------------------------------------------------------------------
// classifyWarmMode
// ---------------------------------------------------------------------------

describe('classifyWarmMode', () => {
  it('returns "both" for high PageRank terms', () => {
    expect(classifyWarmMode('AuthService', 0.2)).toBe('both');
    expect(classifyWarmMode('helper', 0.15)).toBe('both');
  });

  it('returns "lexical" for PascalCase', () => {
    expect(classifyWarmMode('AuthController')).toBe('lexical');
    expect(classifyWarmMode('UserService')).toBe('lexical');
  });

  it('returns "lexical" for SCREAMING_SNAKE', () => {
    expect(classifyWarmMode('MAX_RETRIES')).toBe('lexical');
    expect(classifyWarmMode('DEFAULT_TIMEOUT_MS')).toBe('lexical');
  });

  it('returns "lexical" for snake_case', () => {
    expect(classifyWarmMode('http_server')).toBe('lexical');
    expect(classifyWarmMode('get_user_data')).toBe('lexical');
  });

  it('returns "lexical" for camelCase', () => {
    expect(classifyWarmMode('getUserData')).toBe('lexical');
    expect(classifyWarmMode('parseResponse')).toBe('lexical');
  });

  it('returns "lexical" for dotted paths', () => {
    expect(classifyWarmMode('config.database.host')).toBe('lexical');
  });

  it('returns "semantic" for NL phrase (3+ tokens, no code)', () => {
    expect(classifyWarmMode('handle user authentication')).toBe('semantic');
    expect(classifyWarmMode('process background jobs')).toBe('semantic');
  });

  it('returns "both" for mixed NL + code phrases', () => {
    expect(classifyWarmMode('how does AuthService work')).toBe('both');
  });

  it('returns "lexical" for single word terms', () => {
    expect(classifyWarmMode('express')).toBe('lexical');
    expect(classifyWarmMode('vitest')).toBe('lexical');
  });

  it('returns "lexical" for 2-token code-like terms', () => {
    expect(classifyWarmMode('AuthService handler')).toBe('lexical');
  });

  it('returns "lexical" as default for ambiguous terms', () => {
    expect(classifyWarmMode('ab')).toBe('lexical');
  });
});

// ---------------------------------------------------------------------------
// Internal: computeIDF
// ---------------------------------------------------------------------------

describe('computeIDF', () => {
  it('returns positive value for common terms', () => {
    expect(computeIDF(100, 50)).toBeGreaterThan(0);
  });

  it('returns higher IDF for rarer terms', () => {
    const commonIDF = computeIDF(100, 80);
    const rareIDF = computeIDF(100, 2);
    expect(rareIDF).toBeGreaterThan(commonIDF);
  });

  it('handles docFreq=0', () => {
    expect(computeIDF(100, 0)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Internal: bm25Score
// ---------------------------------------------------------------------------

describe('bm25Score', () => {
  it('returns positive score for valid inputs', () => {
    const score = bm25Score(5, 2.0, 10, 10);
    expect(score).toBeGreaterThan(0);
  });

  it('higher tf yields higher score', () => {
    const lowTF = bm25Score(1, 2.0, 10, 10);
    const highTF = bm25Score(10, 2.0, 10, 10);
    expect(highTF).toBeGreaterThan(lowTF);
  });

  it('higher IDF yields higher score', () => {
    const lowIDF = bm25Score(5, 0.5, 10, 10);
    const highIDF = bm25Score(5, 3.0, 10, 10);
    expect(highIDF).toBeGreaterThan(lowIDF);
  });
});

// ---------------------------------------------------------------------------
// Internal: computeHeuristicMultiplier
// ---------------------------------------------------------------------------

describe('computeHeuristicMultiplier', () => {
  it('returns exports multiplier for export type', () => {
    const m = computeHeuristicMultiplier({ term: 'Foo', type: 'export', sources: [] }, 0);
    expect(m).toBe(MULTIPLIERS.exports);
  });

  it('returns pagerank multiplier for high PR score', () => {
    const m = computeHeuristicMultiplier({ term: 'foo', sources: [] }, 0.2);
    expect(m).toBe(MULTIPLIERS.pagerank);
  });

  it('returns filepath multiplier for filepath source', () => {
    const m = computeHeuristicMultiplier({ term: 'foo', type: 'filepath', sources: ['filepath'] }, 0);
    expect(m).toBe(MULTIPLIERS.filepath);
  });

  it('returns crossfile multiplier for multi-source terms', () => {
    const m = computeHeuristicMultiplier({ term: 'foo', sources: ['a', 'b'] }, 0);
    expect(m).toBe(MULTIPLIERS.crossfile);
  });

  it('returns named multiplier for PascalCase', () => {
    const m = computeHeuristicMultiplier({ term: 'AuthService', sources: [] }, 0);
    expect(m).toBe(MULTIPLIERS.named);
  });

  it('returns private multiplier for low-value terms', () => {
    const m = computeHeuristicMultiplier({ term: 'xyz', score: 1, type: 'private', sources: [] }, 0);
    expect(m).toBe(MULTIPLIERS.private);
  });
});

// ---------------------------------------------------------------------------
// Internal: deduplicatePhrases
// ---------------------------------------------------------------------------

describe('deduplicatePhrases', () => {
  it('keeps highest-scoring occurrence', () => {
    const phrases = [
      { phrase: 'user auth', communityId: 0, score: 0.5 },
      { phrase: 'user auth', communityId: 1, score: 0.9 },
      { phrase: 'user auth', communityId: 2, score: 0.3 },
    ];
    const result = deduplicatePhrases(phrases);
    expect(result.length).toBe(1);
    expect(result[0].score).toBe(0.9);
    expect(result[0].communityId).toBe(1);
  });

  it('normalizes case for deduplication', () => {
    const phrases = [
      { phrase: 'Auth Service', communityId: 0, score: 0.5 },
      { phrase: 'auth service', communityId: 1, score: 0.9 },
    ];
    const result = deduplicatePhrases(phrases);
    expect(result.length).toBe(1);
  });

  it('keeps distinct phrases separate', () => {
    const phrases = [
      { phrase: 'auth service', communityId: 0, score: 0.5 },
      { phrase: 'user model', communityId: 1, score: 0.4 },
    ];
    const result = deduplicatePhrases(phrases);
    expect(result.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// rankIdentifiers
// ---------------------------------------------------------------------------

describe('rankIdentifiers', () => {
  const sampleTerms = [
    { term: 'AuthService', score: 0.8, source: 'export', type: 'export' },
    { term: 'helper', score: 0.3, source: 'definition', type: 'definition' },
    { term: 'MAX_RETRIES', score: 0.4, source: 'constant', type: 'constant' },
    { term: 'getUserData', score: 0.6, source: 'definition', type: 'definition' },
  ];
  const prScores = new Map([['AuthService', 0.5], ['helper', 0.01]]);

  it('returns empty for no terms', () => {
    const result = rankIdentifiers([], new Map());
    expect(result.identifiers).toEqual([]);
    expect(result.totalMined).toBe(0);
  });

  it('returns empty for null terms', () => {
    const result = rankIdentifiers(null, new Map());
    expect(result.identifiers).toEqual([]);
  });

  it('scores and sorts identifiers correctly', () => {
    const result = rankIdentifiers(sampleTerms, prScores);
    expect(result.identifiers.length).toBe(4);
    expect(result.totalMined).toBe(4);

    // Should be sorted by score descending
    for (let i = 1; i < result.identifiers.length; i++) {
      expect(result.identifiers[i].score).toBeLessThanOrEqual(result.identifiers[i - 1].score);
    }
  });

  it('assigns warm_mode to each identifier', () => {
    const result = rankIdentifiers(sampleTerms, prScores);
    for (const id of result.identifiers) {
      expect(['lexical', 'semantic', 'both']).toContain(id.warm_mode);
    }
  });

  it('respects light depth cutoff', () => {
    // Create more terms than light cutoff (200)
    const manyTerms = Array.from({ length: 300 }, (_, i) => ({
      term: `Term${i}`, score: Math.random(), source: 'def', type: 'definition',
    }));
    const result = rankIdentifiers(manyTerms, new Map(), { depth: 'light' });
    expect(result.identifiers.length).toBeLessThanOrEqual(DEPTH_CUTOFFS.light.identifiers);
  });

  it('respects explicit topN over depth', () => {
    const manyTerms = Array.from({ length: 50 }, (_, i) => ({
      term: `Term${i}`, score: Math.random(), source: 'def', type: 'definition',
    }));
    const result = rankIdentifiers(manyTerms, new Map(), { topN: 10 });
    expect(result.identifiers.length).toBe(10);
  });

  it('boosts high-PageRank terms', () => {
    const terms = [
      { term: 'Hub', score: 0.5, source: 'src-a', type: 'definition' },
      { term: 'Leaf', score: 0.5, source: 'src-b', type: 'definition' },
    ];
    const pr = new Map([['Hub', 0.9], ['Leaf', 0.0]]);
    // Provide totalFiles > docFreq so IDF is positive
    const result = rankIdentifiers(terms, pr, { totalFiles: 100 });
    const hubScore = result.identifiers.find(i => i.term === 'Hub')?.score;
    const leafScore = result.identifiers.find(i => i.term === 'Leaf')?.score;
    expect(hubScore).toBeGreaterThan(leafScore);
  });
});

// ---------------------------------------------------------------------------
// rankCommunityPhrases
// ---------------------------------------------------------------------------

describe('rankCommunityPhrases', () => {
  it('returns empty for no phrases', () => {
    const result = rankCommunityPhrases([], new Map());
    expect(result.phrases).toEqual([]);
    expect(result.totalMined).toBe(0);
  });

  it('returns empty for null input', () => {
    const result = rankCommunityPhrases(null, new Map());
    expect(result.phrases).toEqual([]);
  });

  it('ranks phrases and generates question variants', () => {
    const communityPhrases = [
      {
        communityId: 0,
        phrases: [
          { text: 'user authentication', score: 0.8 },
          { text: 'session management', score: 0.5 },
        ],
      },
    ];
    const result = rankCommunityPhrases(communityPhrases, new Map());
    expect(result.phrases.length).toBe(2);
    expect(result.totalMined).toBe(2);

    // Each phrase should have question variants
    for (const p of result.phrases) {
      expect(p.variants.length).toBe(QUESTION_TEMPLATES.length);
      expect(p.variants[0]).toContain('how does');
    }
  });

  it('deduplicates across communities', () => {
    const communityPhrases = [
      { communityId: 0, phrases: [{ text: 'auth flow', score: 0.8 }] },
      { communityId: 1, phrases: [{ text: 'auth flow', score: 0.3 }] },
    ];
    const result = rankCommunityPhrases(communityPhrases, new Map());
    expect(result.phrases.length).toBe(1);
    expect(result.phrases[0].score).toBe(0.8);
  });

  it('respects maxPhrasesPerCommunity', () => {
    const communityPhrases = [{
      communityId: 0,
      phrases: Array.from({ length: 50 }, (_, i) => ({
        text: `phrase ${i}`, score: 1.0 - i * 0.01,
      })),
    }];
    const result = rankCommunityPhrases(communityPhrases, new Map(), { maxPhrasesPerCommunity: 5 });
    expect(result.phrases.length).toBe(5);
  });

  it('boosts phrases containing high-PageRank entities', () => {
    const communityPhrases = [{
      communityId: 0,
      phrases: [
        { text: 'authservice handles login', score: 0.5 },
        { text: 'generic background task', score: 0.5 },
      ],
    }];
    const pr = new Map([['AuthService', 0.5]]);
    const result = rankCommunityPhrases(communityPhrases, pr);
    const boosted = result.phrases.find(p => p.phrase.includes('authservice'));
    const unboosted = result.phrases.find(p => p.phrase.includes('generic'));
    expect(boosted.score).toBeGreaterThan(unboosted.score);
  });

  it('respects depth light phrase cutoff', () => {
    const manyPhrases = Array.from({ length: 200 }, (_, i) => ({
      text: `phrase number ${i}`, score: 1.0 - i * 0.001,
    }));
    const communityPhrases = [{ communityId: 0, phrases: manyPhrases }];
    const result = rankCommunityPhrases(communityPhrases, new Map(), { depth: 'light' });
    expect(result.phrases.length).toBeLessThanOrEqual(DEPTH_CUTOFFS.light.phrases);
  });
});

// ---------------------------------------------------------------------------
// rankAll
// ---------------------------------------------------------------------------

describe('rankAll', () => {
  it('combines identifier and phrase ranking', () => {
    const terms = [
      { term: 'AuthService', score: 0.8, source: 'export', type: 'export' },
    ];
    const phrases = [{
      communityId: 0,
      phrases: [{ text: 'user authentication', score: 0.5 }],
    }];
    const pr = new Map([['AuthService', 0.3]]);

    const result = rankAll(terms, phrases, pr);
    expect(result.identifiers.length).toBe(1);
    expect(result.phrases.length).toBe(1);
    expect(result.stats).toBeDefined();
    expect(result.stats.totalIdentifiersMined).toBe(1);
    expect(result.stats.totalPhrasesMined).toBe(1);
  });

  it('returns correct depth in stats', () => {
    const result = rankAll([], [], new Map(), { depth: 'deep' });
    expect(result.stats.depth).toBe('deep');
  });

  it('defaults to medium depth', () => {
    const result = rankAll([], [], new Map());
    expect(result.stats.depth).toBe('medium');
  });

  it('handles empty inputs gracefully', () => {
    const result = rankAll([], [], new Map());
    expect(result.identifiers).toEqual([]);
    expect(result.phrases).toEqual([]);
  });
});
