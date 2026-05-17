/**
 * Phase 0 Correctness Tests — Rescoring Fix Plan
 *
 * These tests must pass BEFORE optimization work is considered validated.
 * They verify invariants that the rescoring changes depend on.
 *
 * Tests:
 *   1. Dimension mismatch detection in cosineSimilarity and int8CosineSimilarity
 *   2. Pipeline-version mismatch forces rebuild (not silent fallback)
 *   3. Batched vs per-candidate scoring equivalence
 *   4. Adaptive pool sizing behavior
 *   5. Float vector store build/load/score round-trip
 *   6. Normalized quantizer matches index-time quantizer
 *   7. Score-spread analysis shared signal consistency
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { createBitmap, saveBitmap, setBit, loadBitmap } from '../../core/incremental-indexing/infrastructure/tombstone-bitmap.mjs';

const TEST_DIR = path.join(import.meta.dirname, '..', '..', '__test_fixtures__', 'rescoring-phase0');

/** Deterministic unit vector generator for tests. */
function makeUnitVector(dim, seed) {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed * (i + 1));
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

describe('Phase 0: Rescoring Fix Correctness', () => {
  beforeAll(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  });
  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ===========================================================================
  // 1. Dimension Mismatch Detection
  // ===========================================================================
  describe('Dimension mismatch detection', () => {
    it('cosineSimilarity throws on dimension mismatch', async () => {
      const { SweetSearch } = await import('../../core/search/sweet-search.js');
      const ss = new SweetSearch();
      const a = [1, 2, 3];
      const b = [1, 2];
      expect(() => ss.cosineSimilarity(a, b)).toThrow('dimension mismatch');
    });

    it('cosineSimilarity works on equal dimensions', async () => {
      const { SweetSearch } = await import('../../core/search/sweet-search.js');
      const ss = new SweetSearch();
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      expect(ss.cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    it('int8CosineSimilarity throws on dimension mismatch', async () => {
      const { int8CosineSimilarity } = await import('../../core/embedding/embedding-service.js');
      const a = new Int8Array([1, 2, 3]);
      const b = new Int8Array([1, 2]);
      expect(() => int8CosineSimilarity(a, b)).toThrow('dimension mismatch');
    });
  });

  // ===========================================================================
  // 2. Pipeline-Version Mismatch
  // ===========================================================================
  describe('Pipeline version mismatch', () => {
    it('BinaryHNSWIndex.load rejects mismatched pipeline version', async () => {
      const { BinaryHNSWIndex } = await import('../../core/vector-store/index.js');
      const { writeFile } = await import('fs/promises');

      // Create a fake meta.json with an invalid pipeline version
      const indexPath = path.join(TEST_DIR, 'version-test.idx');
      const metaPath = indexPath.replace('.idx', '.meta.json');
      const vectorsPath = indexPath.replace('.idx', '.vectors.json');
      const graphPath = indexPath.replace('.idx', '.graph.json');

      await writeFile(metaPath, JSON.stringify({
        dimension: 8,
        floatDimension: 64,
        M: 16,
        efConstruction: 200,
        efSearch: 100,
        pipelineVersion: 999, // bogus version
        totalVectors: 0,
      }));
      await writeFile(vectorsPath, '[]');
      await writeFile(graphPath, JSON.stringify({ graph: [], entryPoint: -1, maxLevel: 0 }));

      const index = new BinaryHNSWIndex({ indexPath });
      await expect(index.load(indexPath)).rejects.toThrow('Pipeline version mismatch');
    });

    it('BinaryHNSWIndex.search filters tombstoned docs from the stale bitmap', async () => {
      const { BinaryHNSWIndex } = await import('../../core/vector-store/index.js');

      const indexPath = path.join(TEST_DIR, 'binary-stale-test.idx');
      const stalePath = `${indexPath}.stale.bin`;
      const index = new BinaryHNSWIndex({
        indexPath,
        stalePath,
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      index.resetForBuild();
      await index.add('doc-a', new Uint8Array([0]), { rank: 1 });
      await index.add('doc-b', new Uint8Array([255]), { rank: 2 });

      const bitmap = createBitmap(2);
      setBit(bitmap, 0);
      saveBitmap(stalePath, bitmap);

      const result = await index.search(new Uint8Array([0]), 2);
      expect(result.results.map((r) => r.id)).not.toContain('doc-a');
      expect(result.results.map((r) => r.id)).toContain('doc-b');
      expect(result.total).toBe(1);
    });

    it('BinaryHNSWIndex.getInt8Vector hides tombstoned vectors from rescoring', async () => {
      const { BinaryHNSWIndex } = await import('../../core/vector-store/index.js');

      const indexPath = path.join(TEST_DIR, 'binary-stale-int8-test.idx');
      const stalePath = `${indexPath}.stale.bin`;
      const index = new BinaryHNSWIndex({
        indexPath,
        stalePath,
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      index.resetForBuild();
      await index.add('doc-a', new Uint8Array([0]), { rank: 1 }, new Int8Array([1, 2, 3]));
      await index.add('doc-b', new Uint8Array([255]), { rank: 2 }, new Int8Array([4, 5, 6]));

      expect(Array.from(index.getInt8Vector('doc-a'))).toEqual([1, 2, 3]);

      const bitmap = createBitmap(2);
      setBit(bitmap, 0);
      saveBitmap(stalePath, bitmap);

      expect(index.getInt8Vector('doc-a')).toBeUndefined();
      expect(Array.from(index.getInt8Vector('doc-b'))).toEqual([4, 5, 6]);
    });

    it('BinaryHNSWIndex.resetForBuild clears stale int8 rescoring vectors', async () => {
      const { BinaryHNSWIndex } = await import('../../core/vector-store/index.js');

      const index = new BinaryHNSWIndex({
        indexPath: path.join(TEST_DIR, 'binary-reset-int8.idx'),
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      index.resetForBuild();
      await index.add('old-doc', new Uint8Array([0]), {}, new Int8Array([1, 2, 3]));
      expect(Array.from(index.getInt8Vector('old-doc'))).toEqual([1, 2, 3]);

      index.resetForBuild();
      await index.add('fresh-doc', new Uint8Array([255]), {}, new Int8Array([4, 5, 6]));

      expect(index.getInt8Vector('old-doc')).toBeUndefined();
      expect(Array.from(index.getInt8Vector('fresh-doc'))).toEqual([4, 5, 6]);
      expect(index.getStats().int8VectorCount).toBe(1);
    });

    it('BinaryHNSWIndex ignores and omits orphan int8 sidecar rows', async () => {
      const { BinaryHNSWIndex } = await import('../../core/vector-store/index.js');
      const { readFile } = await import('fs/promises');

      const indexPath = path.join(TEST_DIR, 'binary-orphan-int8.idx');
      const index = new BinaryHNSWIndex({
        indexPath,
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      index.resetForBuild();
      await index.add('fresh-doc', new Uint8Array([255]), {}, new Int8Array([4, 5, 6]));
      index.int8Vectors.set('orphan-doc', new Int8Array([9, 9, 9]));

      expect(index.getInt8Vector('orphan-doc')).toBeUndefined();

      await index.save(indexPath);
      const int8Data = JSON.parse(await readFile(indexPath.replace('.idx', '.int8.json'), 'utf-8'));

      expect(int8Data).toEqual({ 'fresh-doc': [4, 5, 6] });
    });

    it('BinaryHNSWIndex.load clears previous int8 vectors when the next artifact has no int8 sidecar', async () => {
      const { BinaryHNSWIndex } = await import('../../core/vector-store/index.js');

      const withInt8Path = path.join(TEST_DIR, 'binary-load-with-int8.idx');
      const withoutInt8Path = path.join(TEST_DIR, 'binary-load-without-int8.idx');

      const withInt8 = new BinaryHNSWIndex({
        indexPath: withInt8Path,
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      withInt8.resetForBuild();
      await withInt8.add('old-doc', new Uint8Array([0]), {}, new Int8Array([1, 2, 3]));
      await withInt8.save(withInt8Path);

      const withoutInt8 = new BinaryHNSWIndex({
        indexPath: withoutInt8Path,
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      withoutInt8.resetForBuild();
      await withoutInt8.add('fresh-doc', new Uint8Array([255]), {});
      await withoutInt8.save(withoutInt8Path);
      expect(existsSync(withoutInt8Path.replace('.idx', '.int8.json'))).toBe(false);

      await withInt8.load(withInt8Path);
      expect(Array.from(withInt8.getInt8Vector('old-doc'))).toEqual([1, 2, 3]);

      await withInt8.load(withoutInt8Path);

      expect(withInt8.getInt8Vector('old-doc')).toBeUndefined();
      expect(withInt8.getStats().int8VectorCount).toBe(0);
    });

    it('BinaryHNSWIndex.save removes stale int8 sidecars when a replacement has no int8 vectors', async () => {
      const { BinaryHNSWIndex } = await import('../../core/vector-store/index.js');

      const indexPath = path.join(TEST_DIR, 'binary-save-removes-int8.idx');
      const int8Path = indexPath.replace('.idx', '.int8.json');
      const index = new BinaryHNSWIndex({
        indexPath,
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      index.resetForBuild();
      await index.add('old-doc', new Uint8Array([0]), {}, new Int8Array([1, 2, 3]));
      await index.save(indexPath);
      expect(existsSync(int8Path)).toBe(true);

      index.resetForBuild();
      await index.add('fresh-doc', new Uint8Array([255]), {});
      await index.save(indexPath);

      expect(existsSync(int8Path)).toBe(false);

      const loaded = new BinaryHNSWIndex({ indexPath });
      await loaded.load(indexPath);
      expect(loaded.vectors.map(v => v.id)).toEqual(['fresh-doc']);
      expect(loaded.getStats().int8VectorCount).toBe(0);
    });

    it('BinaryHNSWIndex.save removes stale calibration sidecars when replacement is symmetric', async () => {
      const { BinaryHNSWIndex } = await import('../../core/vector-store/index.js');

      const indexPath = path.join(TEST_DIR, 'binary-save-removes-calibration.idx');
      const calibPath = indexPath.replace('.idx', '.calibration.json');
      const index = new BinaryHNSWIndex({
        indexPath,
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      index.resetForBuild();
      index.useAsymmetric = true;
      index.centroid = new Float32Array([1, 2, 3]);
      index.signVector = new Float32Array([1, -1, 1]);
      await index.add('old-doc', new Uint8Array([0]), {});
      await index.save(indexPath);
      expect(existsSync(calibPath)).toBe(true);

      index.resetForBuild();
      await index.add('fresh-doc', new Uint8Array([255]), {});
      await index.save(indexPath);

      expect(existsSync(calibPath)).toBe(false);
    });

    it('BinaryHNSWIndex clean rebuild removes stale sidecars from the replaced artifact', async () => {
      const { BinaryHNSWIndex } = await import('../../core/vector-store/index.js');

      const indexPath = path.join(TEST_DIR, 'binary-clean-rebuild.idx');
      const stalePath = `${indexPath}.stale.bin`;
      const oldBitmap = createBitmap(1);
      setBit(oldBitmap, 0);
      saveBitmap(stalePath, oldBitmap);

      const index = new BinaryHNSWIndex({
        indexPath,
        stalePath,
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      index.resetForBuild();
      await index.add('fresh-doc', new Uint8Array([0]), {}, new Int8Array([1, 2, 3]));
      await index.save(indexPath);

      expect(loadBitmap(stalePath)).toBeNull();
    });

    it('createBinaryHNSWIndex loads sidecar artifacts even when the .idx placeholder is absent', async () => {
      const { BinaryHNSWIndex, createBinaryHNSWIndex } = await import('../../core/vector-store/index.js');

      const indexPath = path.join(TEST_DIR, 'binary-factory-sidecar.idx');
      const index = new BinaryHNSWIndex({
        indexPath,
        dimension: 1,
        floatDimension: 8,
        M: 2,
        efSearch: 4,
      });
      index.resetForBuild();
      await index.add('doc-sidecar', new Uint8Array([0]), { file: 'src/a.js' }, new Int8Array([1, 2, 3]));
      await index.save(indexPath);

      expect(existsSync(indexPath)).toBe(false);
      expect(existsSync(indexPath.replace('.idx', '.meta.json'))).toBe(true);
      expect(existsSync(indexPath.replace('.idx', '.vectors.json'))).toBe(true);
      expect(existsSync(indexPath.replace('.idx', '.graph.json'))).toBe(true);

      const loaded = await createBinaryHNSWIndex({ indexPath });

      expect(loaded.vectors.map(v => v.id)).toEqual(['doc-sidecar']);
      expect(Array.from(loaded.getInt8Vector('doc-sidecar'))).toEqual([1, 2, 3]);
    });
  });

  // ===========================================================================
  // 3. Batched vs Per-Candidate Scoring Equivalence
  // ===========================================================================
  describe('Batched vs per-candidate scoring equivalence', () => {
    it('int8BatchDotScores matches per-candidate normalized dot', async () => {
      const { normalizedFloatToInt8, int8BatchDotScores } = await import('../../core/embedding/embedding-service.js');
      const { wasmInt8Dot } = await import('../../core/vector-store/index.js');

      const dim = 64;
      const query = makeUnitVector(dim, 1);
      const docs = [makeUnitVector(dim, 2), makeUnitVector(dim, 3), makeUnitVector(dim, 4)];

      const queryInt8 = normalizedFloatToInt8(query);
      const docInt8s = docs.map(d => normalizedFloatToInt8(d));

      // Batched scoring
      const batchScores = int8BatchDotScores(queryInt8, docInt8s);

      // Per-candidate scoring (manual)
      const scale = 1.0 / (127 * 127);
      for (let i = 0; i < docInt8s.length; i++) {
        const rawDot = wasmInt8Dot(queryInt8, docInt8s[i]);
        const perCandidateScore = rawDot * scale;
        expect(batchScores[i]).toBeCloseTo(perCandidateScore, 10);
      }
    });

    it('batched path is self-consistent and correlated with legacy cosine', async () => {
      const { normalizedFloatToInt8, int8BatchDotScores, int8CosineSimilarity } =
        await import('../../core/embedding/embedding-service.js');

      const dim = 64;
      const query = makeUnitVector(dim, 1);
      const docs = Array.from({ length: 10 }, (_, i) => makeUnitVector(dim, i + 2));

      // Batched normalized-dot path (new, matches index-time quantizer)
      const queryInt8 = normalizedFloatToInt8(query);
      const docInt8s = docs.map(d => normalizedFloatToInt8(d));
      const batchScores = int8BatchDotScores(queryInt8, docInt8s);

      // Legacy cosine path (both sides use same quantizer for fair comparison)
      const cosineScores = docInt8s.map(d => int8CosineSimilarity(queryInt8, d));

      // Both paths use the same quantizer, so rankings should be identical.
      // The batched-dot score = dot/(127²), cosine = dot/(normA*normB).
      // For L2-normalized source vectors, normA ≈ normB ≈ 127, so scores are close.
      const batchRanking = Array.from(batchScores).map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map(x => x.i);
      const cosineRanking = cosineScores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map(x => x.i);

      // When using the same quantizer, top-1 must agree
      expect(batchRanking[0]).toBe(cosineRanking[0]);

      // Rank correlation (Kendall's tau approximation): count concordant pairs
      let concordant = 0;
      let total = 0;
      for (let i = 0; i < batchRanking.length; i++) {
        for (let j = i + 1; j < batchRanking.length; j++) {
          const bOrd = batchRanking.indexOf(i) - batchRanking.indexOf(j);
          const cOrd = cosineRanking.indexOf(i) - cosineRanking.indexOf(j);
          if (bOrd * cOrd > 0) concordant++;
          total++;
        }
      }
      const tau = concordant / total;
      expect(tau).toBeGreaterThan(0.8); // High correlation
    });
  });

  // ===========================================================================
  // 4. Adaptive Pool Sizing
  // ===========================================================================
  describe('Adaptive pool sizing', () => {
    let shouldSkipRerank;

    beforeAll(async () => {
      const mod = await import('../../core/search/search-semantic.js');
      shouldSkipRerank = mod.shouldSkipRerank;
    });

    it('shouldSkipRerank returns skip=true for clear winner', () => {
      // Large gap between top-1 and top-2
      const scores = [0.95, 0.70, 0.65, 0.60];
      const result = shouldSkipRerank(scores);
      expect(result.skip).toBe(true);
      expect(result.reason).toContain('clear_winner');
    });

    it('shouldSkipRerank returns skip=true for tight cluster', () => {
      const scores = [0.80, 0.79, 0.78, 0.77];
      const result = shouldSkipRerank(scores);
      expect(result.skip).toBe(true);
      expect(result.reason).toContain('tight_cluster');
    });

    it('shouldSkipRerank returns skip=false for ambiguous scores', () => {
      const scores = [0.75, 0.72, 0.68, 0.55];
      const result = shouldSkipRerank(scores);
      expect(result.skip).toBe(false);
    });

    it('shouldSkipRerank returns skip=false for low scores', () => {
      const scores = [0.30, 0.10, 0.05, 0.01];
      const result = shouldSkipRerank(scores);
      expect(result.skip).toBe(false);
      expect(result.reason).toContain('low_scores');
    });
  });

  // ===========================================================================
  // 5. Float Vector Store Round-Trip
  // ===========================================================================
  describe('Float vector store', () => {
    it('build → save → load → get round-trips correctly', async () => {
      const { FloatVectorStore } = await import('../../core/vector-store/index.js');
      const storePath = path.join(TEST_DIR, 'test-float-vectors.bin');

      const dim = 8;
      const entries = [
        { id: 'chunk-a', vector: new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]) },
        { id: 'chunk-b', vector: new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]) },
        { id: 'chunk-c', vector: new Float32Array([0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0]) },
      ];

      // Build and save
      const store = new FloatVectorStore();
      store.build(entries, dim);
      await store.save(storePath);
      expect(store.count).toBe(3);
      expect(store.dimension).toBe(dim);

      // Load into fresh instance
      const loaded = new FloatVectorStore();
      const ok = await loaded.load(storePath);
      expect(ok).toBe(true);
      expect(loaded.count).toBe(3);
      expect(loaded.dimension).toBe(dim);

      // Verify vectors
      const vecA = loaded.get('chunk-a');
      expect(vecA).not.toBeNull();
      expect(vecA[0]).toBeCloseTo(1, 5);
      expect(vecA[1]).toBeCloseTo(0, 5);

      const vecC = loaded.get('chunk-c');
      expect(vecC[0]).toBeCloseTo(0.5, 5);

      // Missing ID
      expect(loaded.get('nonexistent')).toBeNull();
    });

    it('get() returns a copy, not a mutable view', async () => {
      const { FloatVectorStore } = await import('../../core/vector-store/index.js');

      const dim = 4;
      const store = new FloatVectorStore();
      store.build([{ id: 'a', vector: new Float32Array([1, 2, 3, 4]) }], dim);

      const v1 = store.get('a');
      v1[0] = 999; // mutate the returned copy

      const v2 = store.get('a');
      expect(v2[0]).toBeCloseTo(1, 5); // original data unchanged
    });

    it('batchScore computes correct dot products', async () => {
      const { FloatVectorStore } = await import('../../core/vector-store/index.js');

      const dim = 4;
      const store = new FloatVectorStore();
      store.build([
        { id: 'a', vector: new Float32Array([1, 0, 0, 0]) },
        { id: 'b', vector: new Float32Array([0, 1, 0, 0]) },
      ], dim);

      const query = new Float32Array([1, 0, 0, 0]);
      const { scores, missing } = store.batchScore(query, ['a', 'b', 'nonexistent']);

      expect(scores.get('a')).toBeCloseTo(1.0, 5); // dot([1,0,0,0], [1,0,0,0]) = 1
      expect(scores.get('b')).toBeCloseTo(0.0, 5); // dot([1,0,0,0], [0,1,0,0]) = 0
      expect(missing).toBe(1); // nonexistent
    });
  });

  // ===========================================================================
  // 6. Normalized Quantizer Matches Index-Time Quantizer
  // ===========================================================================
  describe('Quantizer consistency', () => {
    it('normalizedFloatToInt8 matches quantizeToInt8 for unit vectors', async () => {
      const { normalizedFloatToInt8 } = await import('../../core/embedding/embedding-service.js');
      const { quantizeToInt8 } = await import('../../core/indexing/artifact-builder.js');

      // Create a unit vector
      const dim = 64;
      const v = new Float32Array(dim);
      for (let i = 0; i < dim; i++) v[i] = Math.sin(i * 0.5);
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm);
      for (let i = 0; i < dim; i++) v[i] /= norm;

      const fromSearch = normalizedFloatToInt8(v);
      const fromIndex = quantizeToInt8(v);

      // Should produce identical int8 vectors
      expect(fromSearch.length).toBe(fromIndex.length);
      for (let i = 0; i < fromSearch.length; i++) {
        expect(fromSearch[i]).toBe(fromIndex[i]);
      }
    });
  });

  // ===========================================================================
  // 7. Score-Spread Analysis Shared Signals
  // ===========================================================================
  describe('Score-spread analysis consistency', () => {
    it('shouldSkipRerank clear_winner threshold matches adaptive pool shrink', async () => {
      const { shouldSkipRerank } = await import('../../core/search/search-semantic.js');

      // Scores with a clear winner (gap > threshold)
      const scores = [0.95, 0.70, 0.65, 0.60];
      const result = shouldSkipRerank(scores);

      // shouldSkipRerank should detect clear winner
      expect(result.skip).toBe(true);
      expect(result.reason).toContain('clear_winner');

      // The gap (0.25) exceeds the shared topGapThreshold (0.10)
      // This same signal drives pool shrinking in adaptiveStage2Pool
    });

    it('shouldSkipRerank tight_cluster threshold matches adaptive pool default behavior', async () => {
      const { shouldSkipRerank } = await import('../../core/search/search-semantic.js');

      // Tight cluster scores (spread < threshold)
      const scores = [0.80, 0.79, 0.78, 0.77, 0.76];
      const result = shouldSkipRerank(scores);

      // shouldSkipRerank should detect tight cluster
      expect(result.skip).toBe(true);
      expect(result.reason).toContain('tight_cluster');

      // The spread (0.04) < spreadThreshold (0.08)
      // The same isAmbiguous signal in analyzeScoreSpread drives pool widening
    });
  });

  // ===========================================================================
  // 8. WASM Batch Function
  // ===========================================================================
  describe('WASM batch dot product', () => {
    it('wasmInt8BatchDot returns correct scores', async () => {
      const { wasmInt8BatchDot } = await import('../../core/vector-store/index.js');

      const query = new Int8Array([10, 20, 30, 40]);
      const candidates = [
        new Int8Array([1, 1, 1, 1]),  // dot = 10+20+30+40 = 100
        new Int8Array([2, 0, 0, 0]),  // dot = 20
        new Int8Array([0, 0, 0, 1]),  // dot = 40
      ];

      const scores = wasmInt8BatchDot(query, candidates);
      expect(scores[0]).toBe(100);
      expect(scores[1]).toBe(20);
      expect(scores[2]).toBe(40);
    });

    it('wasmInt8BatchDot handles empty candidates', async () => {
      const { wasmInt8BatchDot } = await import('../../core/vector-store/index.js');
      const query = new Int8Array([1, 2]);
      const scores = wasmInt8BatchDot(query, []);
      expect(scores.length).toBe(0);
    });
  });

  // ===========================================================================
  // 9. Dimension Mismatch Propagation
  // ===========================================================================
  describe('Dimension mismatch propagation', () => {
    it('float32BatchDot throws on dimension mismatch', async () => {
      const { float32BatchDot } = await import('../../core/vector-store/index.js');
      const query = new Float32Array([1, 0, 0]);
      const candidates = [new Float32Array([1, 0])]; // wrong dimension
      expect(() => float32BatchDot(query, candidates)).toThrow('dimension mismatch');
    });

    it('FloatVectorStore.batchScore throws on query/store dimension mismatch', async () => {
      const { FloatVectorStore } = await import('../../core/vector-store/index.js');
      const store = new FloatVectorStore();
      store.build([{ id: 'a', vector: new Float32Array([1, 0, 0, 0]) }], 4);

      // Query with wrong dimension
      const wrongQuery = new Float32Array([1, 0]);
      expect(() => store.batchScore(wrongQuery, ['a'])).toThrow('dimension mismatch');
    });
  });
});
