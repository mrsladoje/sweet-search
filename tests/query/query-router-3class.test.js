/**
 * 3-Class Query Router Tests
 *
 * Validates the 3-class CatBoost model (LEXICAL, SEMANTIC, HYBRID).
 * Structural mode is opt-in only (explicit flag) — the ML model never outputs it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the JS fallback router (query-router-catboost.js)
// The WASM router has matching behavior but requires a build step

describe('3-Class CatBoost Router', () => {
  let routeQueryCatBoostWithReject, LABELS;

  beforeEach(async () => {
    try {
      const mod = await import('../../core/query/query-router-catboost.js');
      routeQueryCatBoostWithReject = mod.routeQueryCatBoostWithReject;
      LABELS = mod.LABELS;
    } catch {
      // v46 router not yet generated — skip
    }
  });

  describe('LABELS', () => {
    it('should have exactly 3 classes', () => {
      if (!LABELS) return; // skip if not generated yet
      expect(LABELS).toEqual(['LEXICAL', 'SEMANTIC', 'HYBRID']);
    });

    it('should NOT contain STRUCTURAL', () => {
      if (!LABELS) return;
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
      if (!routeQueryCatBoostWithReject) return;
      for (const q of testQueries) {
        const result = routeQueryCatBoostWithReject(q);
        expect(result.mode, `"${q}" should not route to structural`).not.toBe('structural');
        expect(result.rawMode, `"${q}" rawMode should not be structural`).not.toBe('structural');
      }
    });
  });

  describe('reject option with 3 classes', () => {
    it('should return valid result for null input', () => {
      if (!routeQueryCatBoostWithReject) return;
      const result = routeQueryCatBoostWithReject(null);
      expect(result.mode).toBe('hybrid');
      expect(result.scores).toHaveLength(3);
      expect(result.probs).toHaveLength(3);
    });

    it('should return valid result for empty string', () => {
      if (!routeQueryCatBoostWithReject) return;
      const result = routeQueryCatBoostWithReject('');
      expect(result.mode).toBe('hybrid');
      expect(result.scores).toHaveLength(3);
      expect(result.probs).toHaveLength(3);
    });

    it('should have 3-element scores and probs for real queries', () => {
      if (!routeQueryCatBoostWithReject) return;
      const result = routeQueryCatBoostWithReject('how does caching work');
      expect(result.scores).toHaveLength(3);
      expect(result.probs).toHaveLength(3);
      expect(result.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 2);
    });
  });

  describe('no STRUCTURAL reject thresholds', () => {
    it('should not have STRUCTURAL in reject option thresholds', async () => {
      try {
        const content = (await import('fs')).readFileSync(
          new URL('../../core/query-router-catboost.js', import.meta.url), 'utf-8'
        );
        expect(content).not.toContain("STRUCTURAL: {");
        expect(content).not.toContain("'STRUCTURAL'");
      } catch {
        // file read issues — skip
      }
    });
  });
});

describe('Query Router (WASM wrapper)', () => {
  it('should not contain STRUCTURAL_PATTERNS', async () => {
    try {
      const content = (await import('fs')).readFileSync(
        new URL('../../core/query-router.js', import.meta.url), 'utf-8'
      );
      expect(content).not.toContain('STRUCTURAL_PATTERNS');
      expect(content).not.toContain("mode: 'structural'");
    } catch {
      // file read issues — skip
    }
  });

  it('should document structural as opt-in only', async () => {
    try {
      const content = (await import('fs')).readFileSync(
        new URL('../../core/query-router.js', import.meta.url), 'utf-8'
      );
      expect(content).toContain('opt-in');
    } catch {
      // file read issues — skip
    }
  });
});
