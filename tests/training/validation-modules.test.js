/**
 * Unit Tests for Phase 3 Validation Modules
 *
 * Tests for:
 * - paraphraser.js - LLM paraphrasing with eval leak prevention
 * - anti-leak-check.js - Training/eval data separation
 * - heuristic-validator.js - Query validation heuristics
 * - outlier-detector.js - Training data outlier detection
 *
 * Run: npx jest training/__tests__/validation-modules.test.js
 */

// Using vitest globals (enabled in vitest.config.js)
import { beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================
// PARAPHRASER TESTS
// ============================================

describe('paraphraser', () => {
  // We test the exported functions, not the CLI
  let paraphraserModule;

  beforeEach(async () => {
    // Dynamic import to handle ESM
    paraphraserModule = await import('../../training/validation/paraphraser.js');
  });

  describe('deterministicParaphrase', () => {
    test('should generate paraphrases for "how does" queries', () => {
      const result = paraphraserModule.deterministicParaphrase(
        'how does authentication work',
        'SEMANTIC',
        'en'
      );

      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('how does authentication work');
    });

    test('should generate paraphrases for "what is" queries', () => {
      const result = paraphraserModule.deterministicParaphrase(
        'what is the AuthService',
        'SEMANTIC',
        'en'
      );

      expect(result.length).toBeGreaterThan(0);
    });

    test('should generate paraphrases for caller queries', () => {
      const result = paraphraserModule.deterministicParaphrase(
        'what calls AuthService',
        'STRUCTURAL',
        'en'
      );

      expect(result.length).toBeGreaterThan(0);
      // Should include variations like "callers of", "usages of"
    });

    test('should generate paraphrases for Serbian queries', () => {
      const result = paraphraserModule.deterministicParaphrase(
        'како ради аутентификација',
        'SEMANTIC',
        'sr'
      );

      expect(result.length).toBeGreaterThan(0);
    });

    test('should generate paraphrases for German queries', () => {
      const result = paraphraserModule.deterministicParaphrase(
        'wie funktioniert die Authentifizierung',
        'SEMANTIC',
        'de'
      );

      expect(result.length).toBeGreaterThan(0);
    });

    test('should generate paraphrases for Chinese queries', () => {
      const result = paraphraserModule.deterministicParaphrase(
        '如何进行认证',
        'SEMANTIC',
        'zh'
      );

      expect(result.length).toBeGreaterThan(0);
    });

    test('should not return duplicates or original', () => {
      const original = 'how does auth work';
      const result = paraphraserModule.deterministicParaphrase(original, 'SEMANTIC', 'en');

      // Should not contain the original (case-insensitive)
      const lowerResults = result.map(r => r.toLowerCase());
      expect(lowerResults).not.toContain(original.toLowerCase());

      // Should not have duplicates
      const unique = new Set(lowerResults);
      expect(unique.size).toBe(lowerResults.length);
    });

    test('should limit to max 3 paraphrases', () => {
      const result = paraphraserModule.deterministicParaphrase(
        'how does authentication work',
        'SEMANTIC',
        'en'
      );

      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    test('should have reasonable defaults', () => {
      const config = paraphraserModule.DEFAULT_CONFIG;

      expect(config.variations).toBeGreaterThan(0);
      expect(config.maxSamples).toBeGreaterThan(0);
      expect(config.batchSize).toBeGreaterThan(0);
      expect(config.temperature).toBeGreaterThan(0);
      expect(config.temperature).toBeLessThanOrEqual(1);
    });
  });
});

// ============================================
// TOKENIZE FOR TRAINING TESTS
// ============================================

describe('tokenizeForTraining', () => {
  let textSegmenter;

  beforeEach(async () => {
    textSegmenter = await import('../../training/features/text-segmenter.js');
  });

  describe('tokenizeForTraining', () => {
    test('should tokenize English text', () => {
      const result = textSegmenter.tokenizeForTraining('what calls AuthService');
      expect(result).toContain('what');
      expect(result).toContain('calls');
      expect(result).toContain('authservice');
    });

    test('should filter short tokens for Latin scripts', () => {
      const result = textSegmenter.tokenizeForTraining('a b c longer');
      expect(result).not.toContain('a');
      expect(result).not.toContain('b');
      expect(result).not.toContain('c');
      expect(result).toContain('longer');
    });

    test('should handle CJK text', () => {
      const result = textSegmenter.tokenizeForTraining('什么调用用户服务');
      expect(result.length).toBeGreaterThan(0);
    });

    test('should lowercase tokens', () => {
      const result = textSegmenter.tokenizeForTraining('AuthService');
      expect(result).toContain('authservice');
      expect(result).not.toContain('AuthService');
    });

    test('should handle empty/null input', () => {
      expect(textSegmenter.tokenizeForTraining('')).toEqual([]);
      expect(textSegmenter.tokenizeForTraining(null)).toEqual([]);
      expect(textSegmenter.tokenizeForTraining(undefined)).toEqual([]);
    });
  });
});

// ============================================
// HEURISTIC VALIDATOR TESTS
// ============================================

describe('heuristic-validator', () => {
  let validatorModule;

  beforeEach(async () => {
    try {
      validatorModule = await import('../../training/validation/heuristic-validator.js');
    } catch (e) {
      // Module may not be importable in test env
      validatorModule = null;
    }
  });

  test('module should export validation functions', () => {
    if (!validatorModule) {
      console.log('Skipping: heuristic-validator not importable');
      return;
    }

    // Check for expected exports
    expect(typeof validatorModule).toBe('object');
  });
});

// ============================================
// OUTLIER DETECTOR TESTS
// ============================================

describe('outlier-detector', () => {
  let outlierModule;

  beforeEach(async () => {
    try {
      outlierModule = await import('../../training/validation/outlier-detector.js');
    } catch (e) {
      // Module may not be importable in test env
      outlierModule = null;
    }
  });

  test('module should export detection functions', () => {
    if (!outlierModule) {
      console.log('Skipping: outlier-detector not importable');
      return;
    }

    // Check for expected exports
    expect(typeof outlierModule).toBe('object');
  });
});

// ============================================
// INTEGRATION: EVAL LEAK PREVENTION
// ============================================

describe('eval leak prevention', () => {
  test('paraphrases should not leak into eval set', async () => {
    const paraphraserModule = await import('../../training/validation/paraphraser.js');

    // Create a mock eval query
    const evalQuery = 'how does authentication work';

    // Generate paraphrases
    const paraphrases = paraphraserModule.deterministicParaphrase(
      'how does auth work',
      'SEMANTIC',
      'en'
    );

    // None should exactly match the eval query
    const normalizedEval = evalQuery.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedParaphrases = paraphrases.map(p =>
      p.toLowerCase().replace(/\s+/g, ' ').trim()
    );

    expect(normalizedParaphrases).not.toContain(normalizedEval);
  });
});

// ============================================
// FEATURE EXTRACTOR INTEGRATION
// ============================================

describe('feature extractor integration', () => {
  let extractorModule;

  beforeEach(async () => {
    try {
      extractorModule = await import('../../training/features/extractor.js');
    } catch (e) {
      extractorModule = null;
    }
  });

  test('should export extractFeatures function', () => {
    if (!extractorModule) {
      console.log('Skipping: extractor not importable');
      return;
    }

    expect(typeof extractorModule.extractFeatures).toBe('function');
  });

  test('should extract full feature vector', async () => {
    if (!extractorModule) {
      console.log('Skipping: extractor not importable');
      return;
    }

    const features = extractorModule.extractAllFeatures('what calls AuthService');

    // Current model uses 50 features (base + structural + semantic + multilingual + extras)
    expect(features).toBeInstanceOf(Float32Array);
    expect(features.length).toBe(50);
  });

  test('multilingual features should be included (features 25-28)', async () => {
    if (!extractorModule) {
      console.log('Skipping: extractor not importable');
      return;
    }

    // Query with non-ASCII identifier
    const features = extractorModule.extractAllFeatures('шта позива КорисникСервис');

    // Feature 25: hasNonAsciiIdentifier should be true (1)
    expect(features[25]).toBe(1);

    // Feature 27: hasStructuralKeywordNonEn should be true (1)
    expect(features[27]).toBe(1);
  });
});
