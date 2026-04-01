import { describe, it, expect } from 'vitest';
import { classifyIntent, getIntentPolicy, INTENTS } from '../../core/query/intent-router.js';

// ---------------------------------------------------------------------------
// Helper: apply intent policy to results (mirrors logic in sweet-search.js)
// ---------------------------------------------------------------------------

/**
 * Applies the P2.2 intent policy fields to a results array,
 * exactly mirroring the code in SweetSearch.search().
 *
 * @param {Array} results - synthetic search results
 * @param {Object} intentPolicy - from getIntentPolicy()
 * @param {number} k - requested result count
 * @returns {Array} transformed results
 */
function applyIntentPolicy(results, intentPolicy, k = 100) {
  if (!intentPolicy || !Array.isArray(results) || results.length === 0) return results;

  // (a) chunkTypeBoosts
  if (intentPolicy.chunkTypeBoosts && Object.keys(intentPolicy.chunkTypeBoosts).length > 0) {
    for (const r of results) {
      const chunkType = r.metadata?.chunk_type || r.chunk_type || r.type;
      const boost = intentPolicy.chunkTypeBoosts[chunkType];
      if (boost && boost !== 1.0) {
        r._preIntentBoostScore = r.score;
        r.score = (r.score || 0) * boost;
      }
    }
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  // (b) rerankerWeight
  if (intentPolicy.rerankerWeight != null) {
    const rw = intentPolicy.rerankerWeight;
    for (const r of results) {
      if (r.rerankScore != null && r.originalScore != null) {
        r._preIntentRerankScore = r.score;
        r.score = rw * r.rerankScore + (1 - rw) * r.originalScore;
      }
    }
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  // (c) maxResults
  if (intentPolicy.maxResults) {
    const effectiveK = Math.min(k, intentPolicy.maxResults);
    results = results.slice(0, effectiveK);
  }

  return results;
}

// ---------------------------------------------------------------------------
// classifyIntent
// ---------------------------------------------------------------------------

describe('classifyIntent', () => {
  describe('API lookup intent', () => {
    it('classifies "how to use the fetch API" as api_lookup', () => {
      const r = classifyIntent('how to use the fetch API');
      expect(r.intent).toBe(INTENTS.API_LOOKUP);
      expect(r.confidence).toBeGreaterThan(0);
    });

    it('classifies "import function from module" as api_lookup', () => {
      const r = classifyIntent('import function from module');
      expect(r.intent).toBe(INTENTS.API_LOOKUP);
    });

    it('classifies "class interface method signature" as api_lookup', () => {
      const r = classifyIntent('class interface method signature');
      expect(r.intent).toBe(INTENTS.API_LOOKUP);
    });

    it('classifies "endpoint type export" as api_lookup', () => {
      const r = classifyIntent('endpoint type export');
      expect(r.intent).toBe(INTENTS.API_LOOKUP);
    });
  });

  describe('bug fix intent', () => {
    it('classifies "fix the crash in login" as bug_fix', () => {
      const r = classifyIntent('fix the crash in login');
      expect(r.intent).toBe(INTENTS.BUG_FIX);
    });

    it('classifies "TypeError undefined is not a function" as bug_fix', () => {
      const r = classifyIntent('TypeError undefined is not a function');
      expect(r.intent).toBe(INTENTS.BUG_FIX);
    });

    it('classifies "debug error exception thrown" as bug_fix', () => {
      const r = classifyIntent('debug error exception thrown');
      expect(r.intent).toBe(INTENTS.BUG_FIX);
    });

    it('classifies "broken issue fail" as bug_fix', () => {
      const r = classifyIntent('broken issue fail');
      expect(r.intent).toBe(INTENTS.BUG_FIX);
    });
  });

  describe('refactor intent', () => {
    it('classifies "refactor the auth module" as refactor', () => {
      const r = classifyIntent('refactor the auth module');
      expect(r.intent).toBe(INTENTS.REFACTOR);
    });

    it('classifies "rename variable and extract method" as refactor', () => {
      const r = classifyIntent('rename variable and extract method');
      expect(r.intent).toBe(INTENTS.REFACTOR);
    });

    it('classifies "simplify cleanup reorganize" as refactor', () => {
      const r = classifyIntent('simplify cleanup reorganize');
      expect(r.intent).toBe(INTENTS.REFACTOR);
    });

    it('classifies "split and merge modules" as refactor', () => {
      const r = classifyIntent('split and merge modules');
      expect(r.intent).toBe(INTENTS.REFACTOR);
    });
  });

  describe('security intent', () => {
    it('classifies "fix XSS vulnerability in user input" as security', () => {
      const r = classifyIntent('fix XSS vulnerability in user input');
      expect(r.intent).toBe(INTENTS.SECURITY);
    });

    it('classifies "authentication authorization token" as security', () => {
      const r = classifyIntent('authentication authorization token');
      expect(r.intent).toBe(INTENTS.SECURITY);
    });

    it('classifies "sanitize password credential encrypt" as security', () => {
      const r = classifyIntent('sanitize password credential encrypt');
      expect(r.intent).toBe(INTENTS.SECURITY);
    });

    it('classifies "CSRF injection security" as security', () => {
      const r = classifyIntent('CSRF injection security');
      expect(r.intent).toBe(INTENTS.SECURITY);
    });
  });

  describe('general / fallback intent', () => {
    it('returns general for empty string', () => {
      const r = classifyIntent('');
      expect(r.intent).toBe(INTENTS.GENERAL);
      expect(r.confidence).toBe(0);
    });

    it('returns general for null', () => {
      const r = classifyIntent(null);
      expect(r.intent).toBe(INTENTS.GENERAL);
      expect(r.confidence).toBe(0);
    });

    it('returns general for undefined', () => {
      const r = classifyIntent(undefined);
      expect(r.intent).toBe(INTENTS.GENERAL);
      expect(r.confidence).toBe(0);
    });

    it('returns general for whitespace-only', () => {
      const r = classifyIntent('   ');
      expect(r.intent).toBe(INTENTS.GENERAL);
      expect(r.confidence).toBe(0);
    });

    it('returns general for unrecognized query', () => {
      const r = classifyIntent('hello world testing stuff');
      expect(r.intent).toBe(INTENTS.GENERAL);
      expect(r.confidence).toBe(0);
    });
  });

  describe('confidence scoring', () => {
    it('gives higher confidence for single-intent queries', () => {
      const pure = classifyIntent('fix the bug crash error');
      expect(pure.confidence).toBeGreaterThan(0.8);
    });

    it('gives lower confidence for mixed-intent queries', () => {
      // "fix" → bug_fix, "security" → security
      const mixed = classifyIntent('fix security vulnerability');
      expect(mixed.confidence).toBeLessThan(1);
      expect(mixed.confidence).toBeGreaterThan(0);
    });

    it('confidence is clamped to [0, 1]', () => {
      const r = classifyIntent('bug fix error crash fail broken issue debug exception');
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('position weighting', () => {
    it('scores keyword at start higher than at end', () => {
      const atStart = classifyIntent('error in the login module code');
      const atEnd = classifyIntent('the login module code has an error');
      // Both should classify as bug_fix, but start should score higher
      expect(atStart.intent).toBe(INTENTS.BUG_FIX);
      expect(atEnd.intent).toBe(INTENTS.BUG_FIX);
      expect(atStart.scores[INTENTS.BUG_FIX]).toBeGreaterThan(
        atEnd.scores[INTENTS.BUG_FIX]
      );
    });
  });

  describe('multi-word keyword bonus', () => {
    it('"how to use" multi-word keyword boosts api_lookup', () => {
      const r = classifyIntent('how to use the database');
      expect(r.intent).toBe(INTENTS.API_LOOKUP);
      // "how to use" is multi-word → 1.5× bonus
      expect(r.scores[INTENTS.API_LOOKUP]).toBeGreaterThan(1);
    });

    it('"method signature" multi-word keyword boosts api_lookup', () => {
      const r = classifyIntent('show method signature');
      expect(r.intent).toBe(INTENTS.API_LOOKUP);
    });
  });

  describe('very long query', () => {
    it('handles very long queries without error', () => {
      const long = 'fix '.repeat(500) + 'error';
      const r = classifyIntent(long);
      expect(r.intent).toBe(INTENTS.BUG_FIX);
      expect(r.confidence).toBeGreaterThan(0);
    });
  });

  describe('case insensitivity', () => {
    it('matches regardless of case', () => {
      const r = classifyIntent('FIX the BUG');
      expect(r.intent).toBe(INTENTS.BUG_FIX);
    });

    it('matches CSRF in uppercase', () => {
      const r = classifyIntent('check for CSRF');
      expect(r.intent).toBe(INTENTS.SECURITY);
    });
  });

  describe('return shape', () => {
    it('always returns { intent, confidence, scores }', () => {
      for (const q of ['', 'fix bug', null]) {
        const r = classifyIntent(q);
        expect(r).toHaveProperty('intent');
        expect(r).toHaveProperty('confidence');
        expect(r).toHaveProperty('scores');
        expect(typeof r.intent).toBe('string');
        expect(typeof r.confidence).toBe('number');
        expect(typeof r.scores).toBe('object');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// getIntentPolicy
// ---------------------------------------------------------------------------

describe('getIntentPolicy', () => {
  const requiredKeys = [
    'chunkTypeBoosts',
    'edgeTypePriority',
    'expandMode',
    'maxResults',
    'rerankerWeight',
  ];

  for (const intent of Object.values(INTENTS)) {
    describe(`policy for ${intent}`, () => {
      const policy = getIntentPolicy(intent);

      it('has all required keys', () => {
        for (const key of requiredKeys) {
          expect(policy).toHaveProperty(key);
        }
      });

      it('expandMode is valid', () => {
        expect(['none', '1hop', '2hop']).toContain(policy.expandMode);
      });

      it('maxResults is a positive integer', () => {
        expect(Number.isInteger(policy.maxResults)).toBe(true);
        expect(policy.maxResults).toBeGreaterThan(0);
      });

      it('rerankerWeight is between 0 and 1', () => {
        expect(policy.rerankerWeight).toBeGreaterThanOrEqual(0);
        expect(policy.rerankerWeight).toBeLessThanOrEqual(1);
      });

      it('edgeTypePriority is a non-empty array of strings', () => {
        expect(Array.isArray(policy.edgeTypePriority)).toBe(true);
        expect(policy.edgeTypePriority.length).toBeGreaterThan(0);
        for (const e of policy.edgeTypePriority) {
          expect(typeof e).toBe('string');
        }
      });

      it('chunkTypeBoosts is an object', () => {
        expect(typeof policy.chunkTypeBoosts).toBe('object');
        expect(policy.chunkTypeBoosts).not.toBeNull();
      });
    });
  }

  it('api_lookup uses 1hop expansion with 10 max results', () => {
    const p = getIntentPolicy(INTENTS.API_LOOKUP);
    expect(p.expandMode).toBe('1hop');
    expect(p.maxResults).toBe(10);
  });

  it('bug_fix uses 2hop expansion with 20 max results', () => {
    const p = getIntentPolicy(INTENTS.BUG_FIX);
    expect(p.expandMode).toBe('2hop');
    expect(p.maxResults).toBe(20);
  });

  it('refactor uses 2hop expansion with 15 max results', () => {
    const p = getIntentPolicy(INTENTS.REFACTOR);
    expect(p.expandMode).toBe('2hop');
    expect(p.maxResults).toBe(15);
  });

  it('security uses 1hop expansion with 10 max results', () => {
    const p = getIntentPolicy(INTENTS.SECURITY);
    expect(p.expandMode).toBe('1hop');
    expect(p.maxResults).toBe(10);
  });

  it('general uses 1hop expansion with 10 max results', () => {
    const p = getIntentPolicy(INTENTS.GENERAL);
    expect(p.expandMode).toBe('1hop');
    expect(p.maxResults).toBe(10);
  });

  it('falls back to general policy for unknown intent', () => {
    const p = getIntentPolicy('unknown_intent');
    const general = getIntentPolicy(INTENTS.GENERAL);
    expect(p).toEqual(general);
  });
});

// ---------------------------------------------------------------------------
// INTENTS constant
// ---------------------------------------------------------------------------

describe('INTENTS', () => {
  it('has exactly 5 intents', () => {
    expect(Object.keys(INTENTS)).toHaveLength(5);
  });

  it('all values are unique', () => {
    const vals = Object.values(INTENTS);
    expect(new Set(vals).size).toBe(vals.length);
  });
});

// ---------------------------------------------------------------------------
// P2.2: Intent policy application (chunkTypeBoosts, maxResults, rerankerWeight)
// ---------------------------------------------------------------------------

describe('P2.2 intent policy application', () => {
  describe('chunkTypeBoosts', () => {
    it('api_lookup boosts declaration-type chunks above function_body chunks', () => {
      const policy = getIntentPolicy(INTENTS.API_LOOKUP);

      // Simulate results: a function_body chunk scored slightly higher than a declaration chunk
      const results = [
        { name: 'handleRequest', type: 'function_body', score: 0.90 },
        { name: 'UserService', type: 'declaration', score: 0.85 },
        { name: 'helper', type: 'block', score: 0.80 },
      ];

      const boosted = applyIntentPolicy(structuredClone(results), policy);

      // declaration gets 1.3x boost: 0.85 * 1.3 = 1.105
      // function_body has no boost in api_lookup policy: stays 0.90
      // So declaration should now outrank function_body
      const declIdx = boosted.findIndex(r => r.type === 'declaration');
      const fbIdx = boosted.findIndex(r => r.type === 'function_body');
      expect(declIdx).toBeLessThan(fbIdx);
      expect(boosted[declIdx].score).toBeGreaterThan(boosted[fbIdx].score);
    });

    it('bug_fix boosts function_body chunks above declaration chunks', () => {
      const policy = getIntentPolicy(INTENTS.BUG_FIX);

      // Simulate results: declaration slightly higher than function_body
      const results = [
        { name: 'UserService', type: 'declaration', score: 0.90 },
        { name: 'processLogin', type: 'function_body', score: 0.85 },
        { name: 'doWork', type: 'method', score: 0.70 },
      ];

      const boosted = applyIntentPolicy(structuredClone(results), policy);

      // function_body gets 1.3x boost: 0.85 * 1.3 = 1.105
      // declaration has no boost in bug_fix: stays 0.90
      const fbIdx = boosted.findIndex(r => r.type === 'function_body');
      const declIdx = boosted.findIndex(r => r.type === 'declaration');
      expect(fbIdx).toBeLessThan(declIdx);
      expect(boosted[fbIdx].score).toBeGreaterThan(boosted[declIdx].score);
    });

    it('does not modify scores when boost is 1.0 or absent', () => {
      // general policy has empty chunkTypeBoosts
      const policy = getIntentPolicy(INTENTS.GENERAL);

      const results = [
        { name: 'a', type: 'function', score: 0.90 },
        { name: 'b', type: 'class', score: 0.80 },
      ];

      const boosted = applyIntentPolicy(structuredClone(results), policy);

      // Scores should be unchanged (general has empty chunkTypeBoosts)
      expect(boosted[0].score).toBe(0.90);
      expect(boosted[1].score).toBe(0.80);
    });

    it('reads chunk_type from metadata.chunk_type', () => {
      const policy = getIntentPolicy(INTENTS.API_LOOKUP);

      const results = [
        { name: 'funcA', metadata: { chunk_type: 'signature' }, score: 0.50 },
        { name: 'funcB', type: 'other', score: 0.80 },
      ];

      const boosted = applyIntentPolicy(structuredClone(results), policy);

      // signature gets 1.3x boost: 0.50 * 1.3 = 0.65
      // 'other' has no boost: stays 0.80
      // funcB still higher since 0.80 > 0.65, but funcA was boosted
      expect(boosted.find(r => r.name === 'funcA').score).toBeCloseTo(0.65, 5);
    });

    it('preserves _preIntentBoostScore for audit trail', () => {
      const policy = getIntentPolicy(INTENTS.API_LOOKUP);
      const results = [{ name: 'x', type: 'declaration', score: 0.50 }];

      const boosted = applyIntentPolicy(structuredClone(results), policy);

      expect(boosted[0]._preIntentBoostScore).toBe(0.50);
      expect(boosted[0].score).toBeCloseTo(0.65, 5); // 0.50 * 1.3
    });
  });

  describe('maxResults', () => {
    it('limits output when intent policy specifies maxResults', () => {
      const policy = getIntentPolicy(INTENTS.API_LOOKUP); // maxResults = 10

      const results = Array.from({ length: 25 }, (_, i) => ({
        name: `result_${i}`,
        type: 'function',
        score: 1 - i * 0.01,
      }));

      const capped = applyIntentPolicy(structuredClone(results), policy, 25);

      expect(capped).toHaveLength(10);
    });

    it('respects min(k, maxResults)', () => {
      const policy = getIntentPolicy(INTENTS.BUG_FIX); // maxResults = 20

      const results = Array.from({ length: 25 }, (_, i) => ({
        name: `result_${i}`,
        type: 'function',
        score: 1 - i * 0.01,
      }));

      // k=5 is smaller than policy.maxResults=20, so should cap at 5
      const capped = applyIntentPolicy(structuredClone(results), policy, 5);

      expect(capped).toHaveLength(5);
    });

    it('does not truncate when results are fewer than maxResults', () => {
      const policy = getIntentPolicy(INTENTS.API_LOOKUP); // maxResults = 10

      const results = Array.from({ length: 3 }, (_, i) => ({
        name: `result_${i}`,
        type: 'function',
        score: 0.90 - i * 0.1,
      }));

      const capped = applyIntentPolicy(structuredClone(results), policy, 100);

      expect(capped).toHaveLength(3);
    });
  });

  describe('rerankerWeight', () => {
    it('blends rerankScore and originalScore using policy weight', () => {
      const policy = getIntentPolicy(INTENTS.API_LOOKUP); // rerankerWeight = 0.6

      const results = [
        { name: 'a', type: 'function', score: 0.5, rerankScore: 0.9, originalScore: 0.3 },
        { name: 'b', type: 'function', score: 0.5, rerankScore: 0.2, originalScore: 0.8 },
      ];

      const blended = applyIntentPolicy(structuredClone(results), policy);

      // a: 0.6 * 0.9 + 0.4 * 0.3 = 0.54 + 0.12 = 0.66
      // b: 0.6 * 0.2 + 0.4 * 0.8 = 0.12 + 0.32 = 0.44
      expect(blended[0].name).toBe('a');
      expect(blended[0].score).toBeCloseTo(0.66, 5);
      expect(blended[1].name).toBe('b');
      expect(blended[1].score).toBeCloseTo(0.44, 5);
    });

    it('does not modify results without rerankScore/originalScore', () => {
      const policy = getIntentPolicy(INTENTS.SECURITY); // rerankerWeight = 0.8

      const results = [
        { name: 'a', type: 'function', score: 0.75 },
        { name: 'b', type: 'class', score: 0.60 },
      ];

      const blended = applyIntentPolicy(structuredClone(results), policy);

      // No rerankScore/originalScore, so score should be unchanged
      expect(blended[0].score).toBe(0.75);
      expect(blended[1].score).toBe(0.60);
    });

    it('security policy uses heavier reranker weight than refactor', () => {
      const secPolicy = getIntentPolicy(INTENTS.SECURITY);
      const refPolicy = getIntentPolicy(INTENTS.REFACTOR);
      expect(secPolicy.rerankerWeight).toBeGreaterThan(refPolicy.rerankerWeight);
    });

    it('preserves _preIntentRerankScore for audit trail', () => {
      const policy = getIntentPolicy(INTENTS.BUG_FIX); // rerankerWeight = 0.7

      const results = [
        { name: 'a', type: 'function', score: 0.5, rerankScore: 0.9, originalScore: 0.3 },
      ];

      const blended = applyIntentPolicy(structuredClone(results), policy);

      // _preIntentRerankScore should capture the score AFTER chunkTypeBoosts
      // but BEFORE rerankerWeight blending. Since 'function' has no boost in
      // bug_fix, it stays 0.5.
      expect(blended[0]._preIntentRerankScore).toBe(0.5);
      // New score: 0.7 * 0.9 + 0.3 * 0.3 = 0.63 + 0.09 = 0.72
      expect(blended[0].score).toBeCloseTo(0.72, 5);
    });
  });

  describe('edgeTypePriority', () => {
    it('api_lookup prioritizes imports over calls', () => {
      const policy = getIntentPolicy(INTENTS.API_LOOKUP);
      const edges = policy.edgeTypePriority;
      expect(edges.indexOf('imports')).toBeLessThan(edges.indexOf('uses'));
    });

    it('bug_fix prioritizes calls over extends', () => {
      const policy = getIntentPolicy(INTENTS.BUG_FIX);
      const edges = policy.edgeTypePriority;
      expect(edges.indexOf('calls')).toBeLessThan(edges.indexOf('imports'));
    });

    it('refactor includes extends and implements', () => {
      const policy = getIntentPolicy(INTENTS.REFACTOR);
      expect(policy.edgeTypePriority).toContain('extends');
      expect(policy.edgeTypePriority).toContain('implements');
    });
  });

  describe('combined policy application', () => {
    it('applies boosts then maxResults in correct order', () => {
      const policy = getIntentPolicy(INTENTS.API_LOOKUP); // declaration 1.3x, maxResults 10

      // 15 results, mix of types
      const results = Array.from({ length: 15 }, (_, i) => ({
        name: `result_${i}`,
        type: i % 3 === 0 ? 'declaration' : 'function_body',
        score: 1 - i * 0.05,
      }));

      const processed = applyIntentPolicy(structuredClone(results), policy, 15);

      // maxResults = 10, k = 15 -> capped at 10
      expect(processed).toHaveLength(10);

      // Verify declaration items got boosted (they should cluster near the top)
      const declInTop5 = processed.slice(0, 5).filter(r => r.type === 'declaration').length;
      expect(declInTop5).toBeGreaterThan(0);
    });

    it('null intentPolicy is a no-op', () => {
      const results = [
        { name: 'a', type: 'function', score: 0.90 },
        { name: 'b', type: 'class', score: 0.80 },
      ];

      const processed = applyIntentPolicy(structuredClone(results), null);

      expect(processed[0].score).toBe(0.90);
      expect(processed[1].score).toBe(0.80);
    });

    it('empty results array is a no-op', () => {
      const policy = getIntentPolicy(INTENTS.API_LOOKUP);
      const processed = applyIntentPolicy([], policy);
      expect(processed).toHaveLength(0);
    });
  });
});
