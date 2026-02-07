/**
 * Int8 Stage-2 Rescoring Integration Test
 *
 * Workstream H Acceptance Criteria:
 *   - One canonical int8 source (.int8.json sidecar)
 *   - Document choice in code comments
 *   - Smoke test proves stage-2 reranking works
 *
 * This test verifies:
 *   1. Int8 vectors are stored in .int8.json sidecar (not SQLite)
 *   2. BinaryHNSWIndex.getInt8Vector() returns valid vectors
 *   3. Stage-2 rescoring computes correct int8 dot product scores
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';

// Test fixtures
const TEST_DIR = path.join(import.meta.dirname, '..', '__test_fixtures__', 'int8-stage2');
const TEST_INDEX_PATH = path.join(TEST_DIR, 'test-binary-hnsw.idx');

describe('Int8 Stage-2 Rescoring', () => {
  let BinaryHNSWIndex;
  let quantizeToInt8, quantizeToBinary;
  let int8DotProduct;

  beforeAll(async () => {
    // Import modules
    const binaryHnswModule = await import('../binary-hnsw-index.js');
    BinaryHNSWIndex = binaryHnswModule.BinaryHNSWIndex;

    const artifactBuilder = await import('../artifact-builder.js');
    quantizeToInt8 = artifactBuilder.quantizeToInt8;
    quantizeToBinary = artifactBuilder.quantizeToBinary;

    const embeddingService = await import('../embedding-service.js');
    int8DotProduct = embeddingService.int8DotProduct;

    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(async () => {
    // Clean up test fixtures
    try {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Canonical Int8 Storage', () => {
    it('should store int8 vectors in .int8.json sidecar', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_INDEX_PATH });
      await index.init();

      // Create synthetic test vectors
      const testVectors = [
        { id: 'test-1', embedding: new Array(512).fill(0).map(() => Math.random() * 2 - 1) },
        { id: 'test-2', embedding: new Array(512).fill(0).map(() => Math.random() * 2 - 1) },
        { id: 'test-3', embedding: new Array(512).fill(0).map(() => Math.random() * 2 - 1) },
      ];

      // Add vectors with int8
      for (const v of testVectors) {
        const binary = quantizeToBinary(v.embedding);
        const int8 = quantizeToInt8(v.embedding);
        await index.add(v.id, binary, { name: v.id }, int8);
      }

      // Save index (should create .int8.json sidecar)
      await index.save(TEST_INDEX_PATH);

      // Verify .int8.json sidecar exists
      const int8SidecarPath = TEST_INDEX_PATH.replace('.idx', '.int8.json');
      expect(existsSync(int8SidecarPath)).toBe(true);

      // Verify content
      const int8Data = JSON.parse(await fs.readFile(int8SidecarPath, 'utf-8'));
      expect(Object.keys(int8Data)).toHaveLength(3);
      expect(int8Data['test-1']).toBeDefined();
      expect(Array.isArray(int8Data['test-1'])).toBe(true);
      expect(int8Data['test-1'].length).toBe(512);
    });

    it('should NOT create SQLite int8 database', async () => {
      // The deprecated SQLite path should not exist after artifact building
      const deprecatedPath = path.join(TEST_DIR, 'codebase-int8.db');
      expect(existsSync(deprecatedPath)).toBe(false);
    });
  });

  describe('BinaryHNSWIndex.getInt8Vector()', () => {
    it('should return valid int8 vector for existing ID', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_INDEX_PATH });
      await index.load(TEST_INDEX_PATH);

      const int8Vec = index.getInt8Vector('test-1');

      expect(int8Vec).toBeDefined();
      expect(int8Vec).toBeInstanceOf(Int8Array);
      expect(int8Vec.length).toBe(512);
    });

    it('should return undefined for non-existent ID', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_INDEX_PATH });
      await index.load(TEST_INDEX_PATH);

      const int8Vec = index.getInt8Vector('non-existent-id');

      expect(int8Vec).toBeUndefined();
    });

    it('should provide O(1) lookup performance', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_INDEX_PATH });
      await index.load(TEST_INDEX_PATH);

      // Measure lookup latency
      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        index.getInt8Vector('test-1');
      }

      const elapsed = performance.now() - start;
      const avgLatencyUs = (elapsed / iterations) * 1000;

      // O(1) Map lookup should be < 1μs on average
      expect(avgLatencyUs).toBeLessThan(10); // 10μs generous upper bound
    });
  });

  describe('Stage-2 Int8 Dot Product', () => {
    it('should compute correct dot product between int8 vectors', () => {
      // Create two known vectors
      const a = new Int8Array([10, 20, 30, -10, -20, -30, 0, 0]);
      const b = new Int8Array([10, 20, 30, -10, -20, -30, 0, 0]);

      const result = int8DotProduct(a, b);

      // int8DotProduct is an alias for int8CosineSimilarity, so identical vectors
      // should have cosine similarity ~= 1.
      expect(result).toBeCloseTo(1, 4);
    });

    it('should produce higher scores for more similar vectors', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_INDEX_PATH });
      await index.load(TEST_INDEX_PATH);

      // Get int8 vectors
      const vec1 = index.getInt8Vector('test-1');
      const vec2 = index.getInt8Vector('test-2');

      // Self-similarity should be maximum (but normalized, not 1.0)
      const selfScore = int8DotProduct(vec1, vec1);

      // Cross-similarity should be lower (for random vectors)
      const crossScore = int8DotProduct(vec1, vec2);

      // Self-similarity > cross-similarity (the key invariant for rescoring)
      expect(selfScore).toBeGreaterThan(crossScore);
      // Self-similarity should be positive and reasonable
      expect(selfScore).toBeGreaterThan(0);
    });
  });

  describe('End-to-End Stage-2 Workflow', () => {
    it('should perform stage-2 rescoring on stage-1 candidates', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_INDEX_PATH });
      await index.load(TEST_INDEX_PATH);

      // Simulate stage-1: get candidates from binary HNSW search
      const testQuery = new Array(512).fill(0).map(() => Math.random() * 2 - 1);
      const queryBinary = quantizeToBinary(testQuery);

      const stage1Result = await index.search(queryBinary, 10);
      expect(stage1Result.results.length).toBeGreaterThan(0);

      // Stage-2: rescore with int8 dot product
      const queryInt8 = quantizeToInt8(testQuery);
      const stage2Results = [];

      for (const candidate of stage1Result.results) {
        const candidateInt8 = index.getInt8Vector(candidate.id);
        expect(candidateInt8).toBeDefined();

        const int8Score = int8DotProduct(queryInt8, candidateInt8);
        stage2Results.push({
          ...candidate,
          int8Score,
          binaryScore: candidate.score,
        });
      }

      // Sort by int8 score
      stage2Results.sort((a, b) => b.int8Score - a.int8Score);

      // Verify stage-2 rescoring produces valid results
      expect(stage2Results.length).toBe(stage1Result.results.length);
      expect(stage2Results[0].int8Score).toBeGreaterThanOrEqual(stage2Results[stage2Results.length - 1].int8Score);

      // Log for visibility
      console.log('Stage-2 Rescore Results:');
      stage2Results.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.id}: binary=${r.binaryScore.toFixed(4)}, int8=${r.int8Score.toFixed(4)}`);
      });
    });
  });
});
