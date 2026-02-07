/**
 * Local Reranker Tests
 *
 * Tests for the LocalReranker class (gte-reranker-modernbert-base INT8):
 * - Singleton pattern works correctly
 * - Model availability detection
 * - Basic reranking functionality (when model is available)
 * - Graceful handling of missing model
 * - Score sorting and topK limiting
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalReranker, getGlobalLocalReranker } from '../local-reranker.js';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = path.join(__dirname, '..', 'models', 'gte-reranker-int8');

describe('LocalReranker', () => {
  describe('singleton pattern', () => {
    it('should return the same instance from getGlobalLocalReranker', () => {
      const instance1 = getGlobalLocalReranker();
      const instance2 = getGlobalLocalReranker();
      expect(instance1).toBe(instance2);
    });

    it('should return the same instance from static getGlobalInstance', () => {
      const instance1 = LocalReranker.getGlobalInstance();
      const instance2 = LocalReranker.getGlobalInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('isAvailable', () => {
    it('should return boolean', () => {
      const reranker = new LocalReranker();
      const available = reranker.isAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should report availability when transformers runtime is present', () => {
      const reranker = new LocalReranker();
      const available = reranker.isAvailable();

      // LocalReranker auto-downloads model on first init; availability reflects runtime.
      expect(available).toBe(true);
    });
  });

  describe('rerank - basic behavior', () => {
    let reranker;

    beforeEach(() => {
      reranker = new LocalReranker();
    });

    it('should return empty results for empty documents', async () => {
      const result = await reranker.rerank('test query', [], 10);
      expect(result.results).toEqual([]);
      expect(result.latency_ms).toBe(0);
      expect(result.model).toBe('gte-reranker-modernbert-base-int8');
    });

    it('should return empty results for null documents', async () => {
      const result = await reranker.rerank('test query', null, 10);
      expect(result.results).toEqual([]);
      expect(result.latency_ms).toBe(0);
    });

    it('should return empty results for undefined documents', async () => {
      const result = await reranker.rerank('test query', undefined, 10);
      expect(result.results).toEqual([]);
      expect(result.latency_ms).toBe(0);
    });
  });

  describe('rerank - with mock model', () => {
    let reranker;
    let mockClassifier;

    beforeEach(() => {
      reranker = new LocalReranker();
      // Mock the classifier to avoid needing the actual model
      mockClassifier = vi.fn().mockImplementation((input) => {
        // Simulate scoring based on keyword overlap
        const query = input.split(' [SEP] ')[0].toLowerCase();
        const doc = input.split(' [SEP] ')[1].toLowerCase();
        const queryWords = query.split(/\s+/);
        let score = 0;
        for (const word of queryWords) {
          if (doc.includes(word)) score += 0.2;
        }
        return [{ label: 'LABEL_1', score: Math.min(score, 1.0) }];
      });
      reranker.classifier = mockClassifier;
      reranker.ready = true;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should sort results by score descending', async () => {
      const documents = [
        'Database connection pool',
        'Authentication service handles login',
        'User authentication module',
      ];

      const result = await reranker.rerank('authentication', documents, 3);

      expect(result.results.length).toBe(3);
      // Documents with "authentication" should rank higher
      expect(result.results[0].localRerankerScore).toBeGreaterThanOrEqual(
        result.results[1].localRerankerScore
      );
      expect(result.results[1].localRerankerScore).toBeGreaterThanOrEqual(
        result.results[2].localRerankerScore
      );
    });

    it('should respect topK limit', async () => {
      const documents = Array(20).fill('test document');

      const result = await reranker.rerank('test', documents, 5);

      expect(result.results.length).toBe(5);
    });

    it('should preserve original document structure', async () => {
      const documents = [
        { content: 'First document', id: 1 },
        { content: 'Second document', id: 2 },
      ];

      const result = await reranker.rerank('test', documents, 2);

      expect(result.results.length).toBe(2);
      // Each result should have original properties plus reranker metadata
      result.results.forEach((r) => {
        expect(r).toHaveProperty('content');
        expect(r).toHaveProperty('id');
        expect(r).toHaveProperty('localRerankerScore');
        expect(r).toHaveProperty('originalIndex');
        expect(r).toHaveProperty('newRank');
        expect(r).toHaveProperty('source');
      });
    });

    it('should handle document objects with text property', async () => {
      const documents = [
        { text: 'First document', metadata: 'a' },
        { text: 'Second document', metadata: 'b' },
      ];

      const result = await reranker.rerank('test', documents, 2);

      expect(result.results.length).toBe(2);
    });

    it('should add correct metadata to results', async () => {
      const documents = ['Document 1', 'Document 2'];

      const result = await reranker.rerank('test', documents, 2);

      expect(result.model).toBe('gte-reranker-modernbert-base-int8');
      expect(typeof result.latency_ms).toBe('number');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);

      result.results.forEach((r, i) => {
        expect(r.source).toBe('local-gte-modernbert-int8');
        expect(r.newRank).toBe(i + 1);
        expect(typeof r.originalIndex).toBe('number');
      });
    });

    it('should handle classifier errors gracefully', async () => {
      // Make classifier throw for specific input
      mockClassifier.mockImplementation((input) => {
        if (input.includes('error')) {
          throw new Error('Mock classifier error');
        }
        return [{ label: 'LABEL_1', score: 0.5 }];
      });

      const documents = ['Normal document', 'error document', 'Another normal'];

      const result = await reranker.rerank('test', documents, 3);

      // Should complete without throwing
      expect(result.results.length).toBe(3);
      // The error document should have score 0
      const errorDoc = result.results.find(r => r.originalIndex === 1);
      expect(errorDoc.localRerankerScore).toBe(0);
    });
  });

  describe('rerankBatched', () => {
    let reranker;

    beforeEach(() => {
      reranker = new LocalReranker();
      // Mock the classifier
      reranker.classifier = vi.fn().mockResolvedValue([{ label: 'LABEL_1', score: 0.5 }]);
      reranker.ready = true;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return empty results for empty documents', async () => {
      const result = await reranker.rerankBatched('test', [], 10);
      expect(result.results).toEqual([]);
    });

    it('should handle batching correctly', async () => {
      const documents = Array(50).fill('test document');

      const result = await reranker.rerankBatched('test', documents, 10, 16);

      expect(result.results.length).toBe(10);
      expect(result.model).toBe('gte-reranker-modernbert-base-int8');
    });

    it('should set source to batched variant', async () => {
      const documents = ['doc1', 'doc2'];

      const result = await reranker.rerankBatched('test', documents, 2);

      result.results.forEach(r => {
        expect(r.source).toBe('local-gte-modernbert-int8-batched');
      });
    });
  });

  describe('shutdown', () => {
    it('should reset state', async () => {
      const reranker = new LocalReranker();
      reranker.tokenizer = 'mock';
      reranker.model = 'mock';
      reranker.ready = true;

      await reranker.shutdown();

      expect(reranker.tokenizer).toBeNull();
      expect(reranker.model).toBeNull();
      expect(reranker.ready).toBe(false);
      expect(reranker.initPromise).toBeNull();
    });
  });

  describe('init idempotency', () => {
    it('should only initialize once', async () => {
      const reranker = new LocalReranker();

      // If model is available, init should succeed
      // If model is not available, init should throw
      // Either way, calling init twice shouldn't cause issues

      if (reranker.isAvailable()) {
        // Model exists, test idempotency
        const initPromise1 = reranker.init();
        const initPromise2 = reranker.init();

        // Both should resolve to the same result
        await Promise.all([initPromise1, initPromise2]);
        expect(reranker.ready).toBe(true);
      } else {
        // Model doesn't exist, just verify isAvailable returns false
        expect(reranker.isAvailable()).toBe(false);
      }
    });
  });
});

describe('config integration', () => {
  it('should have LOCAL_RERANKER_CONFIG exported from config.js', async () => {
    const config = await import('../config.js');
    expect(config.LOCAL_RERANKER_CONFIG).toBeDefined();
    expect(config.LOCAL_RERANKER_CONFIG.model).toBeDefined();
    expect(config.LOCAL_RERANKER_CONFIG.model.name).toBe('gte-reranker-modernbert-base-int8');
  });

  it('should have shouldUseLocalReranker function', async () => {
    const config = await import('../config.js');
    expect(typeof config.shouldUseLocalReranker).toBe('function');
    const result = config.shouldUseLocalReranker();
    expect(typeof result).toBe('boolean');
  });
});

describe('flashrank integration', () => {
  it('should have localReranker in Reranker class', async () => {
    const { Reranker } = await import('../flashrank.js');
    const reranker = new Reranker();

    expect(reranker.localReranker).toBeDefined();
    expect(reranker.localReranker).toBeInstanceOf(LocalReranker);
  });

  it('should include localReranker in getStatus', async () => {
    const { Reranker } = await import('../flashrank.js');
    const reranker = new Reranker();
    const status = reranker.getStatus();

    expect(status).toHaveProperty('localRerankerAvailable');
    expect(status).toHaveProperty('localRerankerModel');
    expect(status).toHaveProperty('useLocalReranker');
    expect(status.localRerankerModel).toBe('gte-reranker-modernbert-base-int8');
  });
});
