/**
 * 3-Class Query Router Tests
 *
 * Validates the 3-class CatBoost model (LEXICAL, SEMANTIC, HYBRID).
 * Structural mode is opt-in only (explicit flag) — the ML model never outputs it.
 */

import { describe, it, expect } from 'vitest';
import { routeQueryCatBoostWithReject, LABELS } from '../../core/query/query-router-catboost.js';

// Test the JS fallback router (query-router-catboost.js)
// The WASM router has matching behavior but requires a build step

describe('3-Class CatBoost Router', () => {

  describe('LABELS', () => {
    it('should have exactly 3 classes', () => {
      expect(LABELS).toEqual(['LEXICAL', 'SEMANTIC', 'HYBRID']);
    });

    it('should NOT contain STRUCTURAL', () => {
      expect(LABELS).not.toContain('STRUCTURAL');
    });
  });

  describe('ML model never returns structural', () => {
    const testQueries = [
      'AuthService',
      'how does authentication work',
      'jwt token validation',
      'password reset flow',
      'getUserById',
      'what calls LoginController',       // formerly structural → now hybrid/semantic
      'callers of AuthService',            // formerly structural → now hybrid/semantic
      'implementations of UserRepository', // formerly structural → now hybrid/semantic
      'error handling strategy',
    ];

    it('should never return structural mode', () => {
      for (const q of testQueries) {
        const result = routeQueryCatBoostWithReject(q);
        expect(result.mode, `"${q}" should not route to structural`).not.toBe('structural');
        expect(result.rawMode, `"${q}" rawMode should not be structural`).not.toBe('structural');
      }
    });
  });

  describe('reject option with 3 classes', () => {
    it('should return valid result for null input', () => {
      const result = routeQueryCatBoostWithReject(null);
      expect(result.mode).toBe('hybrid');
      expect(result.scores).toHaveLength(3);
      expect(result.probs).toHaveLength(3);
    });

    it('should return valid result for empty string', () => {
      const result = routeQueryCatBoostWithReject('');
      expect(result.mode).toBe('hybrid');
      expect(result.scores).toHaveLength(3);
      expect(result.probs).toHaveLength(3);
    });

    it('should have 3-element scores and probs for real queries', () => {
      const result = routeQueryCatBoostWithReject('how does caching work');
      expect(result.scores).toHaveLength(3);
      expect(result.probs).toHaveLength(3);
      expect(result.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 2);
    });
  });
});
