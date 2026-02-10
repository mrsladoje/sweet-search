/**
 * Unit tests for Sweet Search Result Matcher
 *
 * Tests matching logic including:
 * - Exact matches (file, name, type, lineRange)
 * - AnyOf matches (at least N from set)
 * - Contains matches (pattern matching)
 * - Excluded matches (negative testing)
 * - Edge cases and error handling
 */

import { describe, it, expect } from 'vitest';
import { ResultMatcher, evaluateQuery } from '../lib/result-matcher.js';


// =============================================================================
// ResultMatcher Constructor Tests
// =============================================================================

describe('ResultMatcher', () => {
  describe('constructor', () => {
    it('creates matcher with default options', () => {
      const matcher = new ResultMatcher();
      expect(matcher.options.normalizePathSeparators).toBe(true);
      expect(matcher.options.caseSensitive).toBe(false);
    });

    it('accepts custom options', () => {
      const matcher = new ResultMatcher({ caseSensitive: true });
      expect(matcher.options.caseSensitive).toBe(true);
    });
  });


  // ===========================================================================
  // normalizePath Tests
  // ===========================================================================

  describe('normalizePath', () => {
    const matcher = new ResultMatcher();

    it('extracts filename from full path', () => {
      expect(matcher.normalizePath('src/main/java/AuthService.java')).toBe('authservice.java');
    });

    it('normalizes Windows path separators', () => {
      expect(matcher.normalizePath('src\\main\\java\\AuthService.java')).toBe('authservice.java');
    });

    it('handles empty path', () => {
      expect(matcher.normalizePath('')).toBe('');
      expect(matcher.normalizePath(null)).toBe('');
      expect(matcher.normalizePath(undefined)).toBe('');
    });

    it('respects caseSensitive option', () => {
      const caseSensitiveMatcher = new ResultMatcher({ caseSensitive: true });
      expect(caseSensitiveMatcher.normalizePath('AuthService.java')).toBe('AuthService.java');
    });
  });


  // ===========================================================================
  // matchResult Tests
  // ===========================================================================

  describe('matchResult', () => {
    const matcher = new ResultMatcher();

    it('returns no match for missing inputs', () => {
      expect(matcher.matchResult(null, {})).toEqual({
        matched: false,
        relevanceGrade: 0,
        matchType: null,
        details: 'Missing result or expected'
      });
      expect(matcher.matchResult({}, null)).toEqual({
        matched: false,
        relevanceGrade: 0,
        matchType: null,
        details: 'Missing result or expected'
      });
    });

    it('returns no match when nothing matches', () => {
      const result = { file: 'Other.java', name: 'Other' };
      const expected = { exact: [{ file: 'AuthService.java' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
      expect(match.matchType).toBeNull();
    });
  });


  // ===========================================================================
  // matchExact Tests
  // ===========================================================================

  describe('matchExact', () => {
    const matcher = new ResultMatcher();

    it('matches exact file names', () => {
      const result = { file: 'src/AuthService.java', name: 'AuthService' };
      const expected = { exact: [{ file: 'AuthService.java', name: 'AuthService' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
      expect(match.matchType).toBe('exact');
      expect(match.relevanceGrade).toBe(3);
    });

    it('uses bidirectional includes for file matching', () => {
      // Current implementation uses bidirectional includes()
      // 'authservice.java' does NOT include 'auth.java' (different basename)
      // But 'auth' is included in 'authservice'
      const result = { file: 'src/AuthService.java' };
      const expected = { exact: [{ file: 'Auth.java' }] };
      const match = matcher.matchResult(result, expected);
      // Does not match because 'authservice.java' does not include 'auth.java' (different extensions matter)
      expect(match.matched).toBe(false);
    });

    it('matches when basenames have substring relationship', () => {
      // Test case where includes() would work
      const result = { file: 'src/AuthServiceImpl.java' };
      const expected = { exact: [{ file: 'AuthServiceImpl.java' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
    });

    it('does not match when files are completely different', () => {
      const result = { file: 'src/UserService.java' };
      const expected = { exact: [{ file: 'Auth.java' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });

    it('matches file without name requirement', () => {
      const result = { file: 'src/AuthService.java' };
      const expected = { exact: [{ file: 'AuthService.java' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
    });

    it('fails when name does not match', () => {
      const result = { file: 'src/AuthService.java', name: 'AuthService' };
      const expected = { exact: [{ file: 'AuthService.java', name: 'LoginService' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });

    it('matches type when specified', () => {
      const result = { file: 'AuthService.java', type: 'class' };
      const expected = { exact: [{ file: 'AuthService.java', type: 'class' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
    });

    it('fails when type does not match', () => {
      const result = { file: 'AuthService.java', type: 'interface' };
      const expected = { exact: [{ file: 'AuthService.java', type: 'class' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });

    it('matches lineRange when specified', () => {
      const result = { file: 'AuthService.java', line: 50 };
      const expected = { exact: [{ file: 'AuthService.java', lineRange: [40, 60] }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
    });

    it('fails when line is outside lineRange', () => {
      const result = { file: 'AuthService.java', line: 100 };
      const expected = { exact: [{ file: 'AuthService.java', lineRange: [40, 60] }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });

    it('uses custom relevanceGrade from expected', () => {
      const result = { file: 'AuthService.java' };
      const expected = { exact: [{ file: 'AuthService.java', relevanceGrade: 2 }] };
      const match = matcher.matchResult(result, expected);
      expect(match.relevanceGrade).toBe(2);
    });

    it('handles filePath property as alternative to file', () => {
      const result = { filePath: 'src/AuthService.java' };
      const expected = { exact: [{ file: 'AuthService.java' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
    });
  });


  // ===========================================================================
  // matchAnyOf Tests
  // ===========================================================================

  describe('matchAnyOf', () => {
    const matcher = new ResultMatcher();

    it('matches when file is in anyOf set', () => {
      const result = { file: 'src/UserService.java' };
      const expected = {
        anyOf: [{
          files: ['AuthService.java', 'UserService.java', 'OrderService.java']
        }]
      };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
      expect(match.matchType).toBe('anyOf');
      expect(match.relevanceGrade).toBe(2);
    });

    it('does not match when file is not in set', () => {
      const result = { file: 'src/OtherService.java' };
      const expected = {
        anyOf: [{
          files: ['AuthService.java', 'UserService.java']
        }]
      };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });

    it('handles empty files array', () => {
      const result = { file: 'src/AuthService.java' };
      const expected = { anyOf: [{ files: [] }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });
  });


  // ===========================================================================
  // matchContains Tests
  // ===========================================================================

  describe('matchContains', () => {
    const matcher = new ResultMatcher();

    it('matches valid namePattern regex', () => {
      const result = { file: 'LoginController.java', name: 'LoginController' };
      const expected = { contains: [{ namePattern: '^Login.*' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
      expect(match.matchType).toBe('contains');
    });

    it('handles invalid regex patterns gracefully', () => {
      const result = { file: 'Test.java', name: 'Test' };
      const expected = { contains: [{ namePattern: '(a+)+$$$[[[' }] }; // Invalid regex
      // Should not throw, should log warning and return no match
      expect(() => {
        const match = matcher.matchResult(result, expected);
        expect(match.matched).toBe(false);
      }).not.toThrow();
    });

    it('matches filePattern glob', () => {
      const result = { file: 'src/main/java/AuthService.java' };
      const expected = { contains: [{ filePattern: '**/*.java' }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
    });

    it('matches typeIn filter', () => {
      const result = { file: 'AuthService.java', type: 'class' };
      const expected = { contains: [{ typeIn: ['class', 'interface'] }] };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
    });

    it('requires all patterns in mode=all', () => {
      const result = { file: 'AuthService.java', name: 'AuthService', type: 'class' };
      const expected = {
        contains: [{
          mode: 'all',
          namePattern: '^Auth.*',
          typeIn: ['class']
        }]
      };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
      expect(match.relevanceGrade).toBe(2); // 'all' mode gets grade 2
    });

    it('fails mode=all when not all patterns match', () => {
      const result = { file: 'AuthService.java', name: 'AuthService', type: 'interface' };
      const expected = {
        contains: [{
          mode: 'all',
          namePattern: '^Auth.*',
          typeIn: ['class']  // Won't match 'interface'
        }]
      };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });

    it('matches any pattern in mode=any (default)', () => {
      const result = { file: 'AuthService.java', name: 'AuthService', type: 'interface' };
      const expected = {
        contains: [{
          namePattern: '^Auth.*',
          typeIn: ['class']  // Won't match, but namePattern will
        }]
      };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
      expect(match.relevanceGrade).toBe(1); // 'any' mode gets grade 1
    });

    it('returns no match when no patterns specified', () => {
      const result = { file: 'AuthService.java' };
      const expected = { contains: [{}] };  // Empty pattern object
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });
  });


  // ===========================================================================
  // matchExcluded Tests
  // ===========================================================================

  describe('matchExcluded', () => {
    const matcher = new ResultMatcher();

    it('marks excluded results as not matched', () => {
      const result = { file: 'src/test/TestHelper.java' };
      const expected = {
        exact: [{ file: 'TestHelper.java' }],
        excluded: ['TestHelper.java']
      };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
      expect(match.matchType).toBe('excluded');
      expect(match.relevanceGrade).toBe(0);
    });

    it('allows non-excluded results through', () => {
      const result = { file: 'src/AuthService.java' };
      const expected = {
        exact: [{ file: 'AuthService.java' }],
        excluded: ['TestHelper.java']
      };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(true);
    });

    it('supports glob patterns in excluded', () => {
      // The current implementation uses minimatch for glob patterns
      const result = { file: 'src/test/SomeTest.java' };
      const expected = {
        exact: [{ file: 'SomeTest.java' }],
        excluded: ['**/*Test.java']  // Full glob pattern with directory wildcard
      };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });

    it('excludes with simple substring match', () => {
      const result = { file: 'src/TestHelper.java' };
      const expected = {
        exact: [{ file: 'TestHelper.java' }],
        excluded: ['testhelper.java']  // Exact basename match (case insensitive)
      };
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    });
  });


  // ===========================================================================
  // evaluateResults Tests
  // ===========================================================================

  describe('evaluateResults', () => {
    const matcher = new ResultMatcher();

    it('separates matched and unmatched results', () => {
      const results = [
        { file: 'AuthService.java', score: 0.9 },
        { file: 'Other.java', score: 0.5 }
      ];
      const expected = { exact: [{ file: 'AuthService.java' }] };
      const evaluation = matcher.evaluateResults(results, expected);

      expect(evaluation.matchedResults).toHaveLength(1);
      expect(evaluation.unmatchedResults).toHaveLength(1);
      expect(evaluation.summary.matched).toBe(1);
      expect(evaluation.summary.unmatched).toBe(1);
    });

    it('calculates avgRelevanceGrade correctly', () => {
      const results = [
        { file: 'A.java' },
        { file: 'B.java' }
      ];
      const expected = {
        exact: [
          { file: 'A.java', relevanceGrade: 3 },
          { file: 'B.java', relevanceGrade: 2 }
        ]
      };
      const evaluation = matcher.evaluateResults(results, expected);
      expect(evaluation.summary.avgRelevanceGrade).toBe(2.5);
    });

    it('handles empty results', () => {
      const evaluation = matcher.evaluateResults([], { exact: [{ file: 'A.java' }] });
      expect(evaluation.matchedResults).toHaveLength(0);
      expect(evaluation.summary.totalResults).toBe(0);
      expect(evaluation.summary.avgRelevanceGrade).toBe(0);
    });

    it('counts excluded results separately', () => {
      const results = [
        { file: 'AuthService.java' },
        { file: 'TestHelper.java' }
      ];
      const expected = {
        exact: [{ file: 'AuthService.java' }, { file: 'TestHelper.java' }],
        excluded: ['TestHelper.java']
      };
      const evaluation = matcher.evaluateResults(results, expected);
      expect(evaluation.summary.excluded).toBe(1);
      expect(evaluation.summary.matched).toBe(1);
    });
  });


  // ===========================================================================
  // checkMinRelevant Tests
  // ===========================================================================

  describe('checkMinRelevant', () => {
    const matcher = new ResultMatcher();

    it('succeeds when minRelevant is met', () => {
      const results = [
        { match: { matched: true, relevanceGrade: 3 } },
        { match: { matched: true, relevanceGrade: 2 } }
      ];
      const check = matcher.checkMinRelevant(results, 2);
      expect(check.success).toBe(true);
      expect(check.relevantCount).toBe(2);
    });

    it('fails when minRelevant is not met', () => {
      const results = [
        { match: { matched: true, relevanceGrade: 3 } },
        { match: { matched: false, relevanceGrade: 0 } }
      ];
      const check = matcher.checkMinRelevant(results, 2);
      expect(check.success).toBe(false);
      expect(check.relevantCount).toBe(1);
    });

    it('respects k cutoff', () => {
      const results = [
        { match: { matched: false, relevanceGrade: 0 } },
        { match: { matched: false, relevanceGrade: 0 } },
        { match: { matched: true, relevanceGrade: 3 } }  // At position 3
      ];
      // k=2 should not see the relevant result
      expect(matcher.checkMinRelevant(results, 1, 2).success).toBe(false);
      // k=5 should see it
      expect(matcher.checkMinRelevant(results, 1, 5).success).toBe(true);
    });
  });
});


// =============================================================================
// evaluateQuery Tests
// =============================================================================

describe('evaluateQuery', () => {
  it('evaluates query with all properties', () => {
    const query = {
      id: 'TEST-001',
      query: 'AuthService',
      expected: { exact: [{ file: 'AuthService.java' }] },
      expectedRoute: 'lexical',
      minRelevant: 1
    };
    const results = [
      { file: 'AuthService.java', score: 0.95 }
    ];
    const stats = {
      routing: { mode: 'lexical' }
    };

    const evaluation = evaluateQuery(query, results, stats);

    expect(evaluation.id).toBe('TEST-001');
    expect(evaluation.query).toBe('AuthService');
    expect(evaluation.expectedRoute).toBe('lexical');
    expect(evaluation.actualRoute).toBe('lexical');
    expect(evaluation.matchedResults).toHaveLength(1);
    expect(evaluation.success).toBe(true);
  });

  it('handles missing stats gracefully', () => {
    const query = {
      id: 'TEST-002',
      query: 'test',
      expected: {}
    };
    const results = [];

    const evaluation = evaluateQuery(query, results);

    expect(evaluation.actualRoute).toBe('unknown');
    expect(evaluation.stats).toEqual({});
  });

  it('respects custom matcher options', () => {
    const query = {
      id: 'TEST-003',
      query: 'AuthService',
      expected: { exact: [{ file: 'authservice.java', name: 'authservice' }] }
    };
    const results = [
      { file: 'AuthService.java', name: 'AuthService' }
    ];

    // Case-insensitive (default) - should match
    const evalInsensitive = evaluateQuery(query, results, {}, { caseSensitive: false });
    expect(evalInsensitive.matchedResults).toHaveLength(1);

    // Case-sensitive - name won't match
    const evalSensitive = evaluateQuery(query, results, {}, { caseSensitive: true });
    expect(evalSensitive.matchedResults).toHaveLength(0);
  });

  it('defaults minRelevant to 1', () => {
    const query = {
      id: 'TEST-004',
      query: 'test',
      expected: { exact: [{ file: 'test.java' }] }
      // No minRelevant specified
    };
    const results = [{ file: 'test.java' }];

    const evaluation = evaluateQuery(query, results);
    expect(evaluation.minRelevant).toBe(1);
    expect(evaluation.success).toBe(true);
  });
});


// =============================================================================
// ReDoS Protection Tests
// =============================================================================

describe('ReDoS protection', () => {
  it('rejects patterns with nested quantifiers', () => {
    const result = { file: 'Test.java', name: 'Test' };
    const expected = { contains: [{ namePattern: '(a+)+$' }] }; // Dangerous pattern
    const matcher = new ResultMatcher();
    // Should not hang and should log warning or return no match
    const match = matcher.matchResult(result, expected);
    expect(match.matched).toBe(false);
  });

  it('handles very long patterns gracefully', () => {
    const result = { file: 'Test.java', name: 'Test' };
    const longPattern = 'a'.repeat(200);
    const expected = { contains: [{ namePattern: longPattern }] };
    const matcher = new ResultMatcher();
    const match = matcher.matchResult(result, expected);
    // Should be skipped (pattern > MAX_REGEX_LENGTH), not matched
    expect(match.matched).toBe(false);
  });

  it('handles invalid regex patterns without throwing', () => {
    const result = { file: 'Test.java', name: 'Test' };
    const expected = { contains: [{ namePattern: '[[[invalid' }] };
    const matcher = new ResultMatcher();
    // Should not throw
    expect(() => {
      const match = matcher.matchResult(result, expected);
      expect(match.matched).toBe(false);
    }).not.toThrow();
  });
});


// =============================================================================
// normalizeResult Edge Case Tests
// =============================================================================

describe('normalizeResult edge cases', () => {
  it('handles result with filePath instead of file', () => {
    const result = { filePath: 'src/Test.java' };
    const matcher = new ResultMatcher();
    const normalized = matcher.normalizeResult(result);
    expect(normalized.file).toBe('test.java');
  });

  it('handles result with both file and filePath (prefers file)', () => {
    const result = { file: 'Auth.java', filePath: 'Other.java' };
    const matcher = new ResultMatcher();
    const normalized = matcher.normalizeResult(result);
    expect(normalized.file).toBe('auth.java');
  });

  it('handles result with lineNumber instead of line', () => {
    const result = { file: 'Test.java', lineNumber: 42 };
    const matcher = new ResultMatcher();
    const normalized = matcher.normalizeResult(result);
    expect(normalized.line).toBe(42);
  });

  it('handles completely empty result', () => {
    const matcher = new ResultMatcher();
    const normalized = matcher.normalizeResult({});
    expect(normalized.file).toBe('');
    expect(normalized.name).toBe('');
    expect(normalized.type).toBe('');
    expect(normalized.line).toBe(0);
  });

  it('handles null result gracefully', () => {
    const matcher = new ResultMatcher();
    // normalizeResult expects an object, but should handle null/undefined
    const normalized = matcher.normalizeResult(null);
    expect(normalized.file).toBe('');
  });

  it('handles undefined result gracefully', () => {
    const matcher = new ResultMatcher();
    const normalized = matcher.normalizeResult(undefined);
    expect(normalized.file).toBe('');
  });

  it('normalizes Windows backslash paths', () => {
    const result = { file: 'src\\main\\java\\AuthService.java' };
    const matcher = new ResultMatcher();
    const normalized = matcher.normalizeResult(result);
    expect(normalized.file).toBe('authservice.java');
    expect(normalized.fullPath).toBe('src/main/java/authservice.java');
  });

  it('handles special characters in name', () => {
    const result = { file: 'Test.java', name: 'Test$Inner' };
    const matcher = new ResultMatcher();
    const normalized = matcher.normalizeResult(result);
    expect(normalized.name).toBe('test$inner');
  });

  it('respects caseSensitive option', () => {
    const result = { file: 'AuthService.java', name: 'AuthService' };
    const matcher = new ResultMatcher({ caseSensitive: true });
    const normalized = matcher.normalizeResult(result);
    expect(normalized.file).toBe('AuthService.java');
    expect(normalized.name).toBe('AuthService');
  });
});
