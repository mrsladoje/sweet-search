/**
 * Phase 5 Artifact Builder Integration Tests
 *
 * Problem Addressed:
 *   The test suite didn't verify that Phase 5 "success" reflects reality
 *   or that the indexer's return shape matches artifact-builder.js.
 *
 * These tests verify:
 *   1. buildFromCodebaseDb() returns expected shape: { hnsw, stats }
 *   2. hnsw.int8SidecarPath points to a real file
 *   3. The int8 sidecar contains valid JSON with expected structure
 *   4. Phase 5 in the indexer correctly handles the return value
 *   5. Artifact file existence after successful build
 *
 * Contract Verification:
 *   The indexer (index-codebase-v21.js) expects:
 *     - result.hnsw.totalVectors
 *     - result.hnsw.buildTimeMs
 *     - result.hnsw.vectorsPerSecond
 *     - result.int8.count      <-- IMPORTANT: This is NOT returned by buildFromCodebaseDb!
 *     - result.int8.sizeMB     <-- IMPORTANT: This is NOT returned by buildFromCodebaseDb!
 *
 *   The artifact-builder.js buildFromCodebaseDb() actually returns:
 *     - hnsw: { totalVectors, buildTimeMs, vectorsPerSecond, path, int8SidecarPath, ...stats }
 *     - stats: { totalVectors, floatDimension, binaryDimension, memoryReduction }
 *
 *   This test suite documents this contract mismatch and verifies correct behavior.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import Database from 'better-sqlite3';

// Test fixtures directory
const TEST_DIR = path.join(import.meta.dirname, '..', '__test_fixtures__', 'phase5-artifacts');
const TEST_CODEBASE_DB = path.join(TEST_DIR, 'test-codebase.db');
const TEST_HNSW_INDEX = path.join(TEST_DIR, 'test-binary-hnsw.idx');
const TEST_INT8_SIDECAR = TEST_HNSW_INDEX.replace('.idx', '.int8.json');
const TEST_META_FILE = TEST_HNSW_INDEX.replace('.idx', '.meta.json');
const TEST_VECTORS_FILE = TEST_HNSW_INDEX.replace('.idx', '.vectors.json');
const TEST_GRAPH_FILE = TEST_HNSW_INDEX.replace('.idx', '.graph.json');

describe('Phase 5: Artifact Builder Contract', () => {
  let buildFromCodebaseDb;
  let getArtifactStats;
  let verifyArtifacts;
  let BinaryHNSWIndex;

  beforeAll(async () => {
    // Import modules
    const artifactBuilder = await import('../../core/indexing/artifact-builder.js');
    buildFromCodebaseDb = artifactBuilder.buildFromCodebaseDb;
    getArtifactStats = artifactBuilder.getArtifactStats;
    verifyArtifacts = artifactBuilder.verifyArtifacts;

    const binaryHnswModule = await import('../../core/vector-store/binary-hnsw-index.js');
    BinaryHNSWIndex = binaryHnswModule.BinaryHNSWIndex;

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

  /**
   * Create a minimal codebase.db with synthetic vectors for testing
   */
  async function createTestCodebaseDb(vectorCount = 10, dimension = 512) {
    // Remove existing test DB
    try {
      await fs.unlink(TEST_CODEBASE_DB);
    } catch (e) {
      // File doesn't exist
    }

    const db = new Database(TEST_CODEBASE_DB);
    db.pragma('journal_mode = DELETE');

    // Create schema matching real codebase.db
    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        embedding BLOB NOT NULL,
        text TEXT,
        metadata TEXT,
        session_id TEXT,
        tags TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_file_path ON vectors(file_path)');

    // Insert synthetic vectors
    const stmt = db.prepare(`
      INSERT INTO vectors (id, file_path, embedding, text, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction(() => {
      for (let i = 0; i < vectorCount; i++) {
        // Create random normalized embedding
        const embedding = new Float32Array(dimension);
        let norm = 0;
        for (let j = 0; j < dimension; j++) {
          embedding[j] = Math.random() * 2 - 1;
          norm += embedding[j] * embedding[j];
        }
        norm = Math.sqrt(norm);
        for (let j = 0; j < dimension; j++) {
          embedding[j] /= norm;
        }

        stmt.run(
          `test-file-${i}.js:${i * 10}`,
          `test-file-${i}.js`,
          Buffer.from(embedding.buffer),
          `Test content for file ${i}`,
          JSON.stringify({ file: `test-file-${i}.js`, type: 'code' })
        );
      }
    });

    insertMany();
    db.close();

    return { vectorCount, dimension };
  }

  describe('buildFromCodebaseDb() Return Shape', () => {
    beforeEach(async () => {
      // Clean up artifact files before each test
      const files = [TEST_HNSW_INDEX, TEST_INT8_SIDECAR, TEST_META_FILE, TEST_VECTORS_FILE, TEST_GRAPH_FILE];
      for (const file of files) {
        try {
          await fs.unlink(file);
        } catch (e) {
          // File doesn't exist
        }
      }
    });

    it('should return object with hnsw and stats properties', async () => {
      await createTestCodebaseDb(5);

      const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
      });

      expect(result).toHaveProperty('hnsw');
      expect(result).toHaveProperty('stats');
    });

    it('should return hnsw object with required properties', async () => {
      await createTestCodebaseDb(5);

      const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
      });

      // Properties used by indexer Phase 5
      expect(result.hnsw).toHaveProperty('totalVectors');
      expect(result.hnsw).toHaveProperty('buildTimeMs');
      expect(result.hnsw).toHaveProperty('vectorsPerSecond');
      expect(result.hnsw).toHaveProperty('path');
      expect(result.hnsw).toHaveProperty('int8SidecarPath');

      // Type checks
      expect(typeof result.hnsw.totalVectors).toBe('number');
      expect(typeof result.hnsw.buildTimeMs).toBe('number');
      expect(typeof result.hnsw.vectorsPerSecond).toBe('number');
      expect(typeof result.hnsw.path).toBe('string');
      expect(typeof result.hnsw.int8SidecarPath).toBe('string');
    });

    it('should return stats object with required properties', async () => {
      await createTestCodebaseDb(5, 512);

      const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });

      expect(result.stats).toHaveProperty('totalVectors');
      expect(result.stats).toHaveProperty('floatDimension');
      expect(result.stats).toHaveProperty('binaryDimension');
      expect(result.stats).toHaveProperty('memoryReduction');

      expect(result.stats.totalVectors).toBe(5);
      expect(result.stats.floatDimension).toBe(512);
      expect(result.stats.binaryDimension).toBe(64); // 512 / 8
    });

    it('should have int8SidecarPath pointing to .int8.json file', async () => {
      await createTestCodebaseDb(5);

      const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
      });

      expect(result.hnsw.int8SidecarPath).toMatch(/\.int8\.json$/);
      expect(result.hnsw.int8SidecarPath).toBe(TEST_INT8_SIDECAR);
    });

    /**
     * CONTRACT MISMATCH DOCUMENTATION:
     *
     * The indexer (index-codebase-v21.js lines 1028-1029) expects:
     *   result.int8.count
     *   result.int8.sizeMB
     *
     * But buildFromCodebaseDb does NOT return an 'int8' property at all!
     * It only returns: { hnsw, stats }
     *
     * This test documents the mismatch. The indexer will fail when accessing
     * result.int8.count because result.int8 is undefined.
     */
    it('should NOT have result.int8 property (contract mismatch)', async () => {
      await createTestCodebaseDb(5);

      const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
      });

      // This documents the contract mismatch
      expect(result).not.toHaveProperty('int8');

      // The indexer expects result.int8.count - this will throw!
      // This test serves as documentation that the contract is broken.
    });
  });

  describe('Artifact File Existence', () => {
    beforeEach(async () => {
      await createTestCodebaseDb(10);
    });

    it('should create .int8.json sidecar file', async () => {
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
      });

      expect(existsSync(TEST_INT8_SIDECAR)).toBe(true);
    });

    it('should create .meta.json file', async () => {
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
      });

      expect(existsSync(TEST_META_FILE)).toBe(true);
    });

    it('should create .vectors.json file', async () => {
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
      });

      expect(existsSync(TEST_VECTORS_FILE)).toBe(true);
    });

    it('should create .graph.json file', async () => {
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
      });

      expect(existsSync(TEST_GRAPH_FILE)).toBe(true);
    });

    it('should create all 4 artifact files', async () => {
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
      });

      const expectedFiles = [
        TEST_INT8_SIDECAR,
        TEST_META_FILE,
        TEST_VECTORS_FILE,
        TEST_GRAPH_FILE,
      ];

      for (const file of expectedFiles) {
        expect(existsSync(file)).toBe(true);
      }
    });
  });

  describe('Int8 Sidecar Content Validation', () => {
    beforeEach(async () => {
      await createTestCodebaseDb(10, 512);
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });
    });

    it('should contain valid JSON', async () => {
      const content = await fs.readFile(TEST_INT8_SIDECAR, 'utf-8');

      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should have one entry per vector', async () => {
      const int8Data = JSON.parse(await fs.readFile(TEST_INT8_SIDECAR, 'utf-8'));

      expect(Object.keys(int8Data)).toHaveLength(10);
    });

    it('should have arrays as values (int8 vectors)', async () => {
      const int8Data = JSON.parse(await fs.readFile(TEST_INT8_SIDECAR, 'utf-8'));

      for (const [id, vec] of Object.entries(int8Data)) {
        expect(Array.isArray(vec)).toBe(true);
      }
    });

    it('should have correct dimension for int8 vectors (floatDimension)', async () => {
      const int8Data = JSON.parse(await fs.readFile(TEST_INT8_SIDECAR, 'utf-8'));

      for (const [id, vec] of Object.entries(int8Data)) {
        expect(vec.length).toBe(512); // floatDimension, not binaryDimension
      }
    });

    it('should have int8 values in range [-128, 127]', async () => {
      const int8Data = JSON.parse(await fs.readFile(TEST_INT8_SIDECAR, 'utf-8'));

      for (const [id, vec] of Object.entries(int8Data)) {
        for (const val of vec) {
          expect(val).toBeGreaterThanOrEqual(-128);
          expect(val).toBeLessThanOrEqual(127);
        }
      }
    });

    it('should have matching IDs between vectors.json and int8.json', async () => {
      const int8Data = JSON.parse(await fs.readFile(TEST_INT8_SIDECAR, 'utf-8'));
      const vectorsData = JSON.parse(await fs.readFile(TEST_VECTORS_FILE, 'utf-8'));

      const int8Ids = new Set(Object.keys(int8Data));
      const vectorIds = new Set(vectorsData.map(v => v.id));

      expect(int8Ids.size).toBe(vectorIds.size);
      for (const id of int8Ids) {
        expect(vectorIds.has(id)).toBe(true);
      }
    });
  });

  describe('Meta File Content Validation', () => {
    beforeEach(async () => {
      await createTestCodebaseDb(10, 512);
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });
    });

    it('should contain valid JSON', async () => {
      const content = await fs.readFile(TEST_META_FILE, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should have required metadata fields', async () => {
      const meta = JSON.parse(await fs.readFile(TEST_META_FILE, 'utf-8'));

      expect(meta).toHaveProperty('dimension');
      expect(meta).toHaveProperty('floatDimension');
      expect(meta).toHaveProperty('M');
      expect(meta).toHaveProperty('efConstruction');
      expect(meta).toHaveProperty('efSearch');
      expect(meta).toHaveProperty('vectorCount');
    });

    it('should have correct floatDimension', async () => {
      const meta = JSON.parse(await fs.readFile(TEST_META_FILE, 'utf-8'));

      expect(meta.floatDimension).toBe(512);
    });

    it('should have correct binaryDimension (floatDim / 8)', async () => {
      const meta = JSON.parse(await fs.readFile(TEST_META_FILE, 'utf-8'));

      expect(meta.dimension).toBe(64); // 512 / 8
    });

    it('should have correct vectorCount', async () => {
      const meta = JSON.parse(await fs.readFile(TEST_META_FILE, 'utf-8'));

      expect(meta.vectorCount).toBe(10);
    });
  });

  describe('BinaryHNSWIndex Load and Int8 Access', () => {
    beforeEach(async () => {
      await createTestCodebaseDb(10, 512);
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });
    });

    it('should load index successfully', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_HNSW_INDEX });
      await expect(index.load(TEST_HNSW_INDEX)).resolves.not.toThrow();
    });

    it('should have correct vector count after load', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_HNSW_INDEX });
      await index.load(TEST_HNSW_INDEX);

      expect(index.vectors.length).toBe(10);
    });

    it('should have int8Vectors Map populated after load', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_HNSW_INDEX });
      await index.load(TEST_HNSW_INDEX);

      expect(index.int8Vectors.size).toBe(10);
    });

    it('should return Int8Array from getInt8Vector()', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_HNSW_INDEX });
      await index.load(TEST_HNSW_INDEX);

      const firstId = index.vectors[0].id;
      const int8Vec = index.getInt8Vector(firstId);

      expect(int8Vec).toBeInstanceOf(Int8Array);
      expect(int8Vec.length).toBe(512);
    });

    it('should return undefined for non-existent ID', async () => {
      const index = new BinaryHNSWIndex({ indexPath: TEST_HNSW_INDEX });
      await index.load(TEST_HNSW_INDEX);

      const int8Vec = index.getInt8Vector('non-existent-id');

      expect(int8Vec).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw when codebase.db does not exist', async () => {
      const nonExistentPath = path.join(TEST_DIR, 'non-existent.db');

      await expect(buildFromCodebaseDb(nonExistentPath, {
        hnswIndexPath: TEST_HNSW_INDEX,
      })).rejects.toThrow(/not found/);
    });

    it('should throw when codebase.db has no vectors', async () => {
      // Create empty database
      const emptyDbPath = path.join(TEST_DIR, 'empty.db');
      const db = new Database(emptyDbPath);
      db.exec(`
        CREATE TABLE vectors (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          embedding BLOB NOT NULL,
          text TEXT,
          metadata TEXT
        )
      `);
      db.close();

      await expect(buildFromCodebaseDb(emptyDbPath, {
        hnswIndexPath: TEST_HNSW_INDEX,
      })).rejects.toThrow(/No vectors found/);

      // Cleanup
      await fs.unlink(emptyDbPath);
    });
  });

  describe('getArtifactStats()', () => {
    beforeEach(async () => {
      await createTestCodebaseDb(10, 512);
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });
    });

    it('should return stats for existing artifacts', async () => {
      // Mock DB_PATHS to use our test paths by loading with test paths
      const stats = await getArtifactStats();

      // Note: This test uses the real DB_PATHS, so it checks the production location
      // For a proper test, we'd need to mock DB_PATHS or accept test paths
      expect(stats).toHaveProperty('binaryHnsw');
      expect(stats).toHaveProperty('int8Sidecar');
    });
  });

  describe('verifyArtifacts()', () => {
    beforeEach(async () => {
      await createTestCodebaseDb(10, 512);
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });
    });

    it('should verify artifacts structure', async () => {
      const results = await verifyArtifacts();

      // Note: This uses production DB_PATHS
      expect(results).toHaveProperty('binaryHnsw');
      expect(results).toHaveProperty('int8Sidecar');
      expect(results).toHaveProperty('stage2Rescore');
    });
  });

  describe('Phase 5 Indexer Integration', () => {
    /**
     * This test simulates what the indexer does in buildQuantizedArtifactsPhase()
     * and documents the contract expectation vs actual return value.
     */
    it('should work with indexer usage pattern (hnsw stats access)', async () => {
      await createTestCodebaseDb(10, 512);

      const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });

      // This is what the indexer does (line 1028):
      // log(`\n${checkmark} Binary HNSW: ${result.hnsw.totalVectors} vectors (${result.hnsw.buildTimeMs}ms, ${result.hnsw.vectorsPerSecond} vec/s)`, 'green');
      expect(result.hnsw.totalVectors).toBe(10);
      // buildTimeMs can be 0 for very fast builds (Math.round of <0.5ms)
      expect(result.hnsw.buildTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.hnsw.buildTimeMs).toBe('number');
      // vectorsPerSecond can be Infinity if buildTimeMs rounds to 0
      expect(typeof result.hnsw.vectorsPerSecond).toBe('number');
    });

    /**
     * CRITICAL: This documents the contract mismatch
     *
     * The indexer (line 1029) expects:
     *   log(`${checkmark} Int8 vectors: ${result.int8.count} vectors (${result.int8.sizeMB} MB)`, 'green');
     *
     * But result.int8 is undefined!
     */
    it('should document contract mismatch for int8 stats', async () => {
      await createTestCodebaseDb(10, 512);

      const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });

      // The indexer expects result.int8 but it doesn't exist
      expect(result.int8).toBeUndefined();

      // To fix this, the indexer should either:
      // 1. Not log int8 stats (int8 is now in the sidecar, accessed via hnsw)
      // 2. Or the artifact-builder should add int8 stats to the return value

      // The int8 info IS available via:
      const int8Count = result.hnsw.int8VectorCount || result.hnsw.totalVectors;
      expect(int8Count).toBe(10);

      // For size, we'd need to stat the file:
      const int8Stats = await fs.stat(result.hnsw.int8SidecarPath);
      const sizeMB = (int8Stats.size / 1024 / 1024).toFixed(2);
      expect(parseFloat(sizeMB)).toBeGreaterThan(0);
    });

    it('should provide int8 info via hnsw object', async () => {
      await createTestCodebaseDb(10, 512);

      const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });

      // The int8SidecarPath is provided
      expect(result.hnsw.int8SidecarPath).toBeDefined();
      expect(existsSync(result.hnsw.int8SidecarPath)).toBe(true);

      // Count can be inferred from totalVectors (1:1 mapping)
      expect(result.hnsw.totalVectors).toBe(10);
    });
  });

  describe('Performance Validation', () => {
    it('should build 100 vectors in under 5 seconds', async () => {
      await createTestCodebaseDb(100, 512);

      const start = performance.now();
      await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5000);
    });

    it('should report accurate build time in result', async () => {
      await createTestCodebaseDb(20, 512);

      const start = performance.now();
      const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
        hnswIndexPath: TEST_HNSW_INDEX,
        floatDimension: 512,
      });
      const elapsed = performance.now() - start;

      // buildTimeMs should be close to actual elapsed (within 100ms tolerance)
      expect(Math.abs(result.hnsw.buildTimeMs - elapsed)).toBeLessThan(100);
    });
  });
});

describe('Phase 5: Edge Cases', () => {
  let buildFromCodebaseDb;

  const TEST_DIR_EDGE = path.join(import.meta.dirname, '..', '__test_fixtures__', 'phase5-edge');
  const TEST_CODEBASE_DB = path.join(TEST_DIR_EDGE, 'test-codebase.db');
  const TEST_HNSW_INDEX = path.join(TEST_DIR_EDGE, 'test-binary-hnsw.idx');

  beforeAll(async () => {
    const artifactBuilder = await import('../../core/indexing/artifact-builder.js');
    buildFromCodebaseDb = artifactBuilder.buildFromCodebaseDb;

    if (!existsSync(TEST_DIR_EDGE)) {
      mkdirSync(TEST_DIR_EDGE, { recursive: true });
    }
  });

  afterAll(async () => {
    try {
      if (existsSync(TEST_DIR_EDGE)) {
        rmSync(TEST_DIR_EDGE, { recursive: true, force: true });
      }
    } catch (err) {
      // Ignore
    }
  });

  async function createTestDb(vectorCount, dimension) {
    try {
      await fs.unlink(TEST_CODEBASE_DB);
    } catch (e) {}

    const db = new Database(TEST_CODEBASE_DB);
    db.exec(`
      CREATE TABLE vectors (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        embedding BLOB NOT NULL,
        text TEXT,
        metadata TEXT
      )
    `);

    const stmt = db.prepare(`
      INSERT INTO vectors (id, file_path, embedding, text, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction(() => {
      for (let i = 0; i < vectorCount; i++) {
        const embedding = new Float32Array(dimension);
        for (let j = 0; j < dimension; j++) {
          embedding[j] = Math.random() * 2 - 1;
        }
        stmt.run(
          `file-${i}.js:0`,
          `file-${i}.js`,
          Buffer.from(embedding.buffer),
          `content ${i}`,
          '{}'
        );
      }
    });
    insertMany();
    db.close();
  }

  it('should handle single vector', async () => {
    await createTestDb(1, 512);

    const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
      hnswIndexPath: TEST_HNSW_INDEX,
      floatDimension: 512,
    });

    expect(result.hnsw.totalVectors).toBe(1);
    expect(result.stats.totalVectors).toBe(1);
  });

  it('should handle non-512 dimension (256)', async () => {
    await createTestDb(5, 256);

    const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
      hnswIndexPath: TEST_HNSW_INDEX,
      floatDimension: 256,
    });

    expect(result.stats.floatDimension).toBe(256);
    expect(result.stats.binaryDimension).toBe(32); // 256 / 8
  });

  it('should handle non-512 dimension (1024)', async () => {
    await createTestDb(5, 1024);

    const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
      hnswIndexPath: TEST_HNSW_INDEX,
      floatDimension: 1024,
    });

    expect(result.stats.floatDimension).toBe(1024);
    expect(result.stats.binaryDimension).toBe(128); // 1024 / 8
  });

  it('should handle dimension mismatch (floatDimension < actual)', async () => {
    // Create vectors with 1024 dim but request 512 floatDimension
    await createTestDb(5, 1024);

    const result = await buildFromCodebaseDb(TEST_CODEBASE_DB, {
      hnswIndexPath: TEST_HNSW_INDEX,
      floatDimension: 512, // Request truncation
    });

    // Should truncate to 512
    expect(result.stats.floatDimension).toBe(512);

    // Verify int8 vectors are 512-dim
    const int8Data = JSON.parse(await fs.readFile(
      TEST_HNSW_INDEX.replace('.idx', '.int8.json'),
      'utf-8'
    ));
    const firstVec = Object.values(int8Data)[0];
    expect(firstVec.length).toBe(512);
  });
});
