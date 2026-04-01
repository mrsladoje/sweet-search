/**
 * Search Boost Unit Tests
 *
 * Tests for all 6 exported functions + BOOST_POLICY constant from core/search-boost.js.
 * Pure functions tested directly; `this`-bound functions tested via `.call(mockThis, ...)`.
 * Note: makeMockThis() in applyPostFusionBoosts injects real sub-functions (computeDefinitionBoost,
 * etc.) for integration-level coverage — not isolated mocks.
 */

import { describe, it, expect } from 'vitest';

import {
  BOOST_POLICY,
  getBoostIntent,
  applyPostFusionBoosts,
  computeDefinitionBoost,
  computeSyntaxBoost,
  computePositionBoost,
  extractQueryTokens,
} from '../../core/search/index.js';

// ---------------------------------------------------------------------------
// BOOST_POLICY
// ---------------------------------------------------------------------------

describe('BOOST_POLICY', () => {
  it('has all expected policy keys', () => {
    const keys = Object.keys(BOOST_POLICY);
    expect(keys).toContain('definition_strong');
    expect(keys).toContain('definition_mild');
    expect(keys).toContain('general');
    expect(keys).toContain('none');
    expect(keys).toContain('structural');
  });

  it('each policy has the required fields', () => {
    for (const [, policy] of Object.entries(BOOST_POLICY)) {
      expect(policy).toHaveProperty('definitionBoost');
      expect(policy).toHaveProperty('syntaxBoost');
      expect(policy).toHaveProperty('kindHierarchy');
      expect(policy).toHaveProperty('positionBoost');
      expect(typeof policy.definitionBoost).toBe('number');
      expect(typeof policy.syntaxBoost).toBe('number');
      expect(typeof policy.kindHierarchy).toBe('boolean');
      expect(typeof policy.positionBoost).toBe('boolean');
    }
  });

  it('definition_strong has highest boosts', () => {
    expect(BOOST_POLICY.definition_strong.definitionBoost).toBe(2.0);
    expect(BOOST_POLICY.definition_strong.syntaxBoost).toBe(1.8);
    expect(BOOST_POLICY.definition_strong.positionBoost).toBe(true);
  });

  it('none policy has neutral boosts', () => {
    expect(BOOST_POLICY.none.definitionBoost).toBe(1.0);
    expect(BOOST_POLICY.none.syntaxBoost).toBe(1.0);
    expect(BOOST_POLICY.none.positionBoost).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractQueryTokens
// ---------------------------------------------------------------------------

describe('extractQueryTokens', () => {
  it('returns the full query as a token', () => {
    const tokens = extractQueryTokens('getUserData');
    expect(tokens).toContain('getuserdata');
  });

  it('splits on whitespace', () => {
    const tokens = extractQueryTokens('search fusion');
    expect(tokens).toContain('search');
    expect(tokens).toContain('fusion');
  });

  it('splits camelCase parts', () => {
    const tokens = extractQueryTokens('getUserData');
    expect(tokens).toContain('get');
    expect(tokens).toContain('data');
  });

  it('filters out single-char camelCase parts', () => {
    // Split of "aB" => ["a", "B"], "a" has length 1 so excluded from camel split
    const tokens = extractQueryTokens('aB');
    expect(tokens).toContain('ab'); // full query
    // camel split of "aB" -> ["a", "B"] -> "a" is len 1 (excluded), "b" is len 1 (excluded)
  });

  it('lowercases all tokens', () => {
    const tokens = extractQueryTokens('MyClass');
    tokens.forEach(t => expect(t).toBe(t.toLowerCase()));
  });

  it('handles special characters in queries', () => {
    const tokens = extractQueryTokens('file:path/to/file.js');
    expect(tokens).toContain('file:path/to/file.js');
  });

  it('handles empty string', () => {
    const tokens = extractQueryTokens('');
    // Empty string: Set(['']) → single empty-string token
    expect(tokens).toContain('');
  });
});

// ---------------------------------------------------------------------------
// getBoostIntent
// ---------------------------------------------------------------------------

describe('getBoostIntent', () => {
  it('returns definition_strong for high-confidence lexical', () => {
    expect(getBoostIntent('lexical', 0.8)).toBe('definition_strong');
    expect(getBoostIntent('lexical', 0.95)).toBe('definition_strong');
  });

  it('returns definition_mild for lower-confidence lexical', () => {
    expect(getBoostIntent('lexical', 0.5)).toBe('definition_mild');
    expect(getBoostIntent('lexical', 0.79)).toBe('definition_mild');
  });

  it('returns general for hybrid mode', () => {
    expect(getBoostIntent('hybrid', 0.9)).toBe('general');
  });

  it('returns none for semantic mode', () => {
    expect(getBoostIntent('semantic', 0.9)).toBe('none');
  });

  it('returns structural for structural mode', () => {
    expect(getBoostIntent('structural', 0.5)).toBe('structural');
  });

  it('returns general for unknown mode', () => {
    expect(getBoostIntent('unknown', 0.5)).toBe('general');
    expect(getBoostIntent(undefined, 0.5)).toBe('general');
  });
});

// ---------------------------------------------------------------------------
// computeDefinitionBoost
// ---------------------------------------------------------------------------

describe('computeDefinitionBoost', () => {
  it('returns 2.0 when filename matches query and is definition type', () => {
    const result = { name: 'UserService', file: 'src/user-service.js', type: 'class' };
    const boost = computeDefinitionBoost(result, 'user', ['user']);
    expect(boost).toBe(2.0);
  });

  it('returns 1.5 for exact name match on definition type', () => {
    const result = { name: 'calculate', file: 'src/utils.js', type: 'function' };
    const boost = computeDefinitionBoost(result, 'calculate', ['calculate']);
    expect(boost).toBe(1.5);
  });

  it('returns 1.2 for definition type without name/file match', () => {
    const result = { name: 'somethingElse', file: 'src/other.js', type: 'method' };
    const boost = computeDefinitionBoost(result, 'finduser', ['finduser']);
    expect(boost).toBe(1.2);
  });

  it('returns 1.0 for non-definition type', () => {
    const result = { name: 'count', file: 'src/count.js', type: 'variable' };
    const boost = computeDefinitionBoost(result, 'count', ['count']);
    expect(boost).toBe(1.0);
  });

  it('handles missing name and file gracefully', () => {
    const result = { type: 'function' };
    const boost = computeDefinitionBoost(result, 'test', ['test']);
    expect(boost).toBe(1.2); // definition type, no name/file match
  });

  it('returns 1.0 when type is undefined', () => {
    const result = { name: 'count', file: 'src/count.js' };
    const boost = computeDefinitionBoost(result, 'count', ['count']);
    expect(boost).toBe(1.0); // DEFINITION_TYPES.has(undefined) = false
  });
});

// ---------------------------------------------------------------------------
// computeSyntaxBoost
// ---------------------------------------------------------------------------

describe('computeSyntaxBoost', () => {
  it('returns 1.8 for matching class definition in signature', () => {
    const result = { signature: 'export class UserService {' };
    const boost = computeSyntaxBoost(result, ['userservice']);
    expect(boost).toBe(1.8);
  });

  it('returns 1.8 for matching function definition in signature', () => {
    const result = { signature: 'function calculateTotal(items) {' };
    const boost = computeSyntaxBoost(result, ['calculatetotal']);
    expect(boost).toBe(1.8);
  });

  it('returns 1.8 for matching interface in signature', () => {
    const result = { signature: 'interface UserConfig {' };
    const boost = computeSyntaxBoost(result, ['userconfig']);
    expect(boost).toBe(1.8);
  });

  it('returns 1.8 for matching type alias in signature', () => {
    const result = { signature: 'type Options =' };
    const boost = computeSyntaxBoost(result, ['options']);
    expect(boost).toBe(1.8);
  });

  it('returns 1.0 when no signature', () => {
    const result = {};
    const boost = computeSyntaxBoost(result, ['foo']);
    expect(boost).toBe(1.0);
  });

  it('returns 1.0 when signature does not match query tokens', () => {
    const result = { signature: 'class UserService {' };
    const boost = computeSyntaxBoost(result, ['otherthing']);
    expect(boost).toBe(1.0);
  });

  it('matches partial token inclusion', () => {
    // definedName "userservice" includes "user"
    const result = { signature: 'class UserService {' };
    const boost = computeSyntaxBoost(result, ['user']);
    expect(boost).toBe(1.8);
  });
});

// ---------------------------------------------------------------------------
// computePositionBoost
// ---------------------------------------------------------------------------

describe('computePositionBoost', () => {
  it('gives highest boost at line 0 for definition type', () => {
    const result = { startLine: 0, type: 'function' };
    const boost = computePositionBoost(result);
    // rawPrior = 1/(1+0/50) = 1.0, capped to [0.5,1.0] = 1.0
    // boost = 1 + 0.3 * 1.0 = 1.3
    expect(boost).toBeCloseTo(1.3, 2);
  });

  it('gives smaller boost at higher line numbers', () => {
    const result = { startLine: 200, type: 'class' };
    const boost = computePositionBoost(result);
    // rawPrior = 1/(1+200/50) = 1/5 = 0.2, capped to 0.5
    // boost = 1 + 0.3 * 0.5 = 1.15
    expect(boost).toBeCloseTo(1.15, 2);
  });

  it('returns 1.0 for non-definition type', () => {
    const result = { startLine: 0, type: 'variable' };
    expect(computePositionBoost(result)).toBe(1.0);
  });

  it('returns 1.0 when startLine is null', () => {
    const result = { startLine: null, type: 'function' };
    expect(computePositionBoost(result)).toBe(1.0);
  });

  it('returns 1.0 when startLine is negative', () => {
    const result = { startLine: -1, type: 'function' };
    expect(computePositionBoost(result)).toBe(1.0);
  });

  it('gives moderate boost at line 50', () => {
    const result = { startLine: 50, type: 'function' };
    const boost = computePositionBoost(result);
    // rawPrior = 1/(1+50/50) = 1/2 = 0.5, capped to [0.5,1.0] = 0.5
    // boost = 1 + 0.3 * 0.5 = 1.15
    expect(boost).toBeCloseTo(1.15, 2);
  });
});

// ---------------------------------------------------------------------------
// applyPostFusionBoosts (uses `this`)
// ---------------------------------------------------------------------------

describe('applyPostFusionBoosts', () => {
  function makeMockThis() {
    return {
      getBoostIntent,
      extractQueryTokens,
      computeDefinitionBoost,
      computeSyntaxBoost,
      computePositionBoost,
    };
  }

  it('modifies scores based on boost policy', () => {
    const mockCtx = makeMockThis();
    const results = [
      { id: 'a', score: 1.0, name: 'UserService', file: 'src/user.js', type: 'class' },
      { id: 'b', score: 0.8, name: 'helper', file: 'src/utils.js', type: 'variable' },
    ];

    const boosted = applyPostFusionBoosts.call(mockCtx, results, 'UserService', 'lexical', 0.9);
    // The class result should get definition + syntax boosts
    const classResult = boosted.find(r => r.id === 'a');
    expect(classResult.score).toBeGreaterThan(1.0);
    expect(classResult._originalScore).toBe(1.0);
    expect(classResult._boostFactor).toBeGreaterThan(1.0);
  });

  it('preserves original score in _originalScore', () => {
    const mockCtx = makeMockThis();
    const results = [{ id: 'a', score: 0.5, type: 'function', name: 'test' }];

    const boosted = applyPostFusionBoosts.call(mockCtx, results, 'test', 'hybrid', 0.7);
    expect(boosted[0]._originalScore).toBe(0.5);
  });

  it('caps total boost at 3.0', () => {
    const mockCtx = makeMockThis();
    // Create a scenario that would generate a very high boost
    const results = [
      {
        id: 'a',
        score: 1.0,
        name: 'getData',
        file: 'src/getdata.js',
        type: 'function',
        signature: 'function getData() {',
        startLine: 0,
      },
    ];

    const boosted = applyPostFusionBoosts.call(mockCtx, results, 'getData', 'lexical', 0.95);
    // Score should never exceed original * 3.0
    expect(boosted[0].score).toBeLessThanOrEqual(1.0 * 3.0);
  });

  it('sorts results by boosted score descending', () => {
    const mockCtx = makeMockThis();
    const results = [
      { id: 'a', score: 0.5, type: 'variable', name: 'x' },
      { id: 'b', score: 0.4, type: 'function', name: 'findUser', file: 'src/finduser.js', signature: 'function findUser() {' },
    ];

    const boosted = applyPostFusionBoosts.call(mockCtx, results, 'findUser', 'lexical', 0.9);
    for (let i = 1; i < boosted.length; i++) {
      expect(boosted[i - 1].score).toBeGreaterThanOrEqual(boosted[i].score);
    }
  });

  it('uses general policy for hybrid mode', () => {
    const mockCtx = makeMockThis();
    const results = [{ id: 'a', score: 1.0, type: 'function', name: 'test' }];

    const boosted = applyPostFusionBoosts.call(mockCtx, results, 'test', 'hybrid', 0.5);
    // general policy: positionBoost = false, so no position boost applied
    expect(boosted[0]._boostDetails).toBeDefined();
  });

  it('applies no definition/syntax boosts for "none" policy (semantic mode)', () => {
    const mockCtx = makeMockThis();
    const results = [
      { id: 'a', score: 1.0, type: 'function', name: 'handleRequest', signature: 'function handleRequest() {' },
    ];

    const boosted = applyPostFusionBoosts.call(mockCtx, results, 'handleRequest', 'semantic', 0.9);
    // none policy: definitionBoost=1.0, syntaxBoost=1.0 => no def/syntax boost
    // but kindHierarchy is true, so some mild kind boost may apply
    const details = boosted[0]._boostDetails;
    expect(details.some(d => d.startsWith('def:'))).toBe(false);
    expect(details.some(d => d.startsWith('syntax:'))).toBe(false);
  });

  it('returns empty array for empty results', () => {
    const mockCtx = makeMockThis();
    const boosted = applyPostFusionBoosts.call(mockCtx, [], 'test', 'lexical', 0.9);
    expect(boosted).toEqual([]);
  });

  it('handles result with score=0', () => {
    const mockCtx = makeMockThis();
    const results = [{ id: 'a', score: 0, type: 'function', name: 'test' }];
    const boosted = applyPostFusionBoosts.call(mockCtx, results, 'test', 'lexical', 0.9);
    // 0 * any boost = 0
    expect(boosted[0].score).toBe(0);
    expect(boosted[0]._originalScore).toBe(0);
  });
});
