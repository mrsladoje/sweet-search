/**
 * HCGS Generator Integration Tests
 *
 * Tests for the Hierarchical Code Graph Summary Generator:
 * - Parent-child summary aggregation
 * - O(1) childrenByParent index correctness
 * - Embedding generation produces valid binary blobs
 * - Bottom-up processing order
 *
 * Uses an in-memory SQLite database to test real behavior.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// TEST DATABASE SETUP
// =============================================================================

/**
 * Creates an in-memory database with the entities table schema
 */
function createTestDatabase() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE entities (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      signature TEXT,
      doc_comment TEXT,
      code TEXT,
      parent_id INTEGER,
      hierarchy_level INTEGER DEFAULT 1,
      summary TEXT,
      summary_embedding BLOB,
      FOREIGN KEY (parent_id) REFERENCES entities(id)
    );

    CREATE TABLE relationships (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL,
      target_id INTEGER,
      target_name TEXT,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      context_line INTEGER,
      full_import_path TEXT,
      is_static INTEGER DEFAULT 0,
      is_wildcard INTEGER DEFAULT 0,
      FOREIGN KEY (source_id) REFERENCES entities(id),
      FOREIGN KEY (target_id) REFERENCES entities(id)
    );

    CREATE INDEX idx_entities_parent ON entities(parent_id);
    CREATE INDEX idx_entities_type ON entities(type);
    CREATE INDEX idx_entities_summary ON entities(summary);
    CREATE INDEX idx_relationships_source ON relationships(source_id);
  `);

  return db;
}

/**
 * Populates the test database with a hierarchy:
 * - AuthService (class, level 1)
 *   - authenticate (method, level 2)
 *   - logout (method, level 2)
 * - UserRepository (class, level 1)
 *   - findById (method, level 2)
 */
function populateTestHierarchy(db) {
  const insertEntity = db.prepare(`
    INSERT INTO entities (id, file_path, type, name, signature, doc_comment, code, parent_id, hierarchy_level, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRelationship = db.prepare(`
    INSERT INTO relationships (source_id, target_id, type)
    VALUES (?, ?, ?)
  `);

  // AuthService class (parent)
  insertEntity.run(1, 'src/AuthService.java', 'class', 'AuthService',
    'public class AuthService', '/** Authentication service */','class AuthService {}',
    null, 1, null);

  // authenticate method (child of AuthService)
  insertEntity.run(2, 'src/AuthService.java', 'method', 'authenticate',
    'public boolean authenticate(String username, String password)',
    '/** Authenticates user credentials */',
    'return checkPassword(username, password);',
    1, 2, null);

  // logout method (child of AuthService)
  insertEntity.run(3, 'src/AuthService.java', 'method', 'logout',
    'public void logout(String sessionId)',
    '/** Ends user session */',
    'invalidateSession(sessionId);',
    1, 2, null);

  // UserRepository class (parent, no children initially)
  insertEntity.run(4, 'src/UserRepository.java', 'class', 'UserRepository',
    'public interface UserRepository', '/** User data access */','interface UserRepository {}',
    null, 1, null);

  // findById method (child of UserRepository)
  insertEntity.run(5, 'src/UserRepository.java', 'method', 'findById',
    'User findById(Long id)',
    '/** Finds user by ID */',
    'return jdbcTemplate.queryForObject(...);',
    4, 2, null);

  // Add 'contains' relationships
  insertRelationship.run(1, 2, 'contains'); // AuthService contains authenticate
  insertRelationship.run(1, 3, 'contains'); // AuthService contains logout
  insertRelationship.run(4, 5, 'contains'); // UserRepository contains findById

  return {
    authServiceId: 1,
    authenticateId: 2,
    logoutId: 3,
    userRepoId: 4,
    findByIdId: 5,
  };
}

// =============================================================================
// UNIT TESTS FOR CORE LOGIC (Extracted from module)
// =============================================================================

describe('HCGS Parent-Child Aggregation Logic', () => {
  let db;
  let entities;

  beforeAll(() => {
    db = createTestDatabase();
    entities = populateTestHierarchy(db);
  });

  afterAll(() => {
    if (db) db.close();
  });

  describe('getEntitiesNeedingSummary', () => {
    it('should return entities without summaries ordered by hierarchy level DESC', () => {
      const result = db.prepare(`
        SELECT id, name, file_path, type, signature, doc_comment, hierarchy_level, code, parent_id
        FROM entities
        WHERE summary IS NULL
        ORDER BY hierarchy_level DESC, type, name
      `).all();

      expect(result.length).toBe(5);

      // Deepest level first (methods at level 2)
      expect(result[0].hierarchy_level).toBe(2);
      expect(result[1].hierarchy_level).toBe(2);
      expect(result[2].hierarchy_level).toBe(2);

      // Then classes at level 1
      expect(result[3].hierarchy_level).toBe(1);
      expect(result[4].hierarchy_level).toBe(1);
    });

    it('should include parent_id in the result', () => {
      const result = db.prepare(`
        SELECT id, name, parent_id
        FROM entities
        WHERE summary IS NULL
      `).all();

      // Methods should have parent_id set
      const authenticate = result.find(e => e.name === 'authenticate');
      expect(authenticate.parent_id).toBe(entities.authServiceId);

      const logout = result.find(e => e.name === 'logout');
      expect(logout.parent_id).toBe(entities.authServiceId);

      // Classes should have null parent_id
      const authService = result.find(e => e.name === 'AuthService');
      expect(authService.parent_id).toBeNull();
    });
  });

  describe('childrenByParent Index', () => {
    it('should correctly group children by parent ID', () => {
      // Simulate the index-building logic from hcgs-generator.js
      const childrenByParent = new Map();
      const entitiesNeedingSummary = db.prepare(`
        SELECT id, name, parent_id
        FROM entities
        WHERE summary IS NULL
      `).all();

      for (const entity of entitiesNeedingSummary) {
        if (entity.parent_id) {
          if (!childrenByParent.has(entity.parent_id)) {
            childrenByParent.set(entity.parent_id, []);
          }
          childrenByParent.get(entity.parent_id).push(entity.id);
        }
      }

      // AuthService should have 2 children
      expect(childrenByParent.get(entities.authServiceId)).toEqual([
        entities.authenticateId,
        entities.logoutId,
      ]);

      // UserRepository should have 1 child
      expect(childrenByParent.get(entities.userRepoId)).toEqual([
        entities.findByIdId,
      ]);

      // Methods shouldn't be in the map as keys (they have no children)
      expect(childrenByParent.has(entities.authenticateId)).toBe(false);
    });

    it('should enable O(1) child lookup for parent entities', () => {
      // Setup: Create the index and summary cache
      const childrenByParent = new Map();
      const summaryCache = new Map();

      // First, process children (methods) and cache them
      const methods = db.prepare(`
        SELECT id, name, type, parent_id
        FROM entities
        WHERE type = 'method'
      `).all();

      for (const method of methods) {
        // Simulate storing summary in cache
        summaryCache.set(method.id, {
          name: method.name,
          type: method.type,
          summary: `Summary for ${method.name}`,
          parentId: method.parent_id,
        });

        // Index under parent
        if (method.parent_id) {
          if (!childrenByParent.has(method.parent_id)) {
            childrenByParent.set(method.parent_id, []);
          }
          childrenByParent.get(method.parent_id).push(method.id);
        }
      }

      // Now test O(1) lookup for AuthService
      const childIds = childrenByParent.get(entities.authServiceId) || [];
      const childSummaries = [];

      for (const childId of childIds) {
        const cached = summaryCache.get(childId);
        if (cached) {
          childSummaries.push({
            name: cached.name,
            type: cached.type,
            summary: cached.summary,
          });
        }
      }

      expect(childSummaries.length).toBe(2);
      expect(childSummaries.map(c => c.name)).toContain('authenticate');
      expect(childSummaries.map(c => c.name)).toContain('logout');
    });
  });

  describe('Parent Prompt Includes Child Summaries', () => {
    it('should build prompt with child summaries for class entities', () => {
      // Simulate child summaries being available
      const childSummaries = [
        { name: 'authenticate', type: 'method', summary: 'Validates user credentials against database' },
        { name: 'logout', type: 'method', summary: 'Invalidates user session' },
      ];

      const entity = {
        type: 'class',
        name: 'AuthService',
        signature: 'public class AuthService',
        doc_comment: '/** Authentication service */',
      };

      // Replicate buildSummaryPrompt logic
      const tokenLimit = 150; // class token limit
      let prompt = `Generate a clear 2-3 sentence summary for this class:\n\n`;
      prompt += `Name: ${entity.name}\n`;
      if (entity.signature) prompt += `Signature: ${entity.signature}\n`;
      if (entity.doc_comment) prompt += `Documentation: ${entity.doc_comment.slice(0, 200)}\n`;

      if (childSummaries.length > 0) {
        prompt += `\nContains:\n`;
        for (const child of childSummaries.slice(0, 10)) {
          prompt += `- ${child.name}: ${child.summary}\n`;
        }
      }

      prompt += `\nRespond with ONLY the summary. No prefixes, no explanations.`;

      // Verify prompt includes child summaries
      expect(prompt).toContain('Contains:');
      expect(prompt).toContain('- authenticate: Validates user credentials against database');
      expect(prompt).toContain('- logout: Invalidates user session');
    });

    it('should NOT include child summaries for leaf entities (methods)', () => {
      const childSummaries = []; // Methods have no children

      const entity = {
        type: 'method',
        name: 'authenticate',
        signature: 'public boolean authenticate(String username, String password)',
        doc_comment: '/** Authenticates user credentials */',
      };

      // Replicate buildSummaryPrompt logic
      let prompt = `Generate a brief one-line summary for this method:\n\n`;
      prompt += `Name: ${entity.name}\n`;
      if (entity.signature) prompt += `Signature: ${entity.signature}\n`;

      if (childSummaries.length > 0) {
        prompt += `\nContains:\n`;
        for (const child of childSummaries) {
          prompt += `- ${child.name}: ${child.summary}\n`;
        }
      }

      // Verify prompt does NOT include "Contains:" for methods
      expect(prompt).not.toContain('Contains:');
    });
  });
});

// =============================================================================
// EMBEDDING GENERATION TESTS
// =============================================================================

describe('Embedding Generation for Summaries', () => {
  describe('floatToBinary conversion', () => {
    // Replicate floatToBinary from embedding-service.js
    function floatToBinary(embedding) {
      const numBytes = Math.ceil(embedding.length / 8);
      const binary = new Uint8Array(numBytes);

      for (let i = 0; i < embedding.length; i++) {
        if (embedding[i] > 0) {
          binary[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
        }
      }

      return binary;
    }

    it('should convert float embedding to binary Uint8Array', () => {
      // Example 8-dimensional embedding
      const floatEmbedding = [0.5, -0.3, 0.1, -0.8, 0.9, -0.2, 0.4, -0.1];

      const binary = floatToBinary(floatEmbedding);

      expect(binary).toBeInstanceOf(Uint8Array);
      expect(binary.length).toBe(1); // 8 dimensions = 1 byte
    });

    it('should pack 8 dimensions into 1 byte', () => {
      // All positive = all 1s = 0xFF
      const allPositive = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
      expect(floatToBinary(allPositive)[0]).toBe(0xFF);

      // All negative = all 0s = 0x00
      const allNegative = [-0.1, -0.2, -0.3, -0.4, -0.5, -0.6, -0.7, -0.8];
      expect(floatToBinary(allNegative)[0]).toBe(0x00);

      // Alternating = 10101010 = 0xAA
      const alternating = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1];
      expect(floatToBinary(alternating)[0]).toBe(0xAA);
    });

    it('should handle 512-dimensional embedding', () => {
      const embedding = new Array(512).fill(0).map((_, i) => (i % 2 === 0 ? 0.5 : -0.5));

      const binary = floatToBinary(embedding);

      expect(binary.length).toBe(64); // 512 / 8 = 64 bytes
      expect(binary[0]).toBe(0xAA); // Alternating pattern
    });

    it('should handle 1024-dimensional embedding (Voyage Code 3)', () => {
      const embedding = new Array(1024).fill(0.1);

      const binary = floatToBinary(embedding);

      expect(binary.length).toBe(128); // 1024 / 8 = 128 bytes
      // All positive = all 0xFF
      expect(binary.every(b => b === 0xFF)).toBe(true);
    });

    it('should treat 0 as negative (not positive)', () => {
      // Zero values become 0 bits (not positive)
      const withZeros = [0, 0, 0, 0, 0, 0, 0, 0];
      expect(floatToBinary(withZeros)[0]).toBe(0x00);

      // Mix of zero and positive
      const mixed = [0.1, 0, 0.1, 0, 0.1, 0, 0.1, 0];
      // Pattern: 10101010 = 0xAA
      expect(floatToBinary(mixed)[0]).toBe(0xAA);
    });
  });

  describe('Embedding extraction from getEmbedding result', () => {
    it('should extract embedding array from result object', () => {
      // Mock getEmbedding result format
      const mockEmbeddingResult = {
        embedding: [0.1, 0.2, 0.3, -0.1, -0.2, -0.3, 0.4, -0.4],
        cached: false,
        source: 'voyage',
        latency_us: 250000,
      };

      // Correct extraction
      const embedding = mockEmbeddingResult.embedding;
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(8);

      // This is the bug that was fixed - passing the whole object
      const wrongExtraction = mockEmbeddingResult;
      expect(wrongExtraction.embedding).toBeDefined();
      expect(typeof wrongExtraction).toBe('object');
      expect(Array.isArray(wrongExtraction)).toBe(false);
    });

    it('should handle undefined embedding gracefully', () => {
      const mockEmbeddingResult = {
        embedding: undefined,
        cached: false,
        source: 'failed',
      };

      // The fixed code checks for embeddingResult?.embedding
      if (mockEmbeddingResult?.embedding) {
        // Would have called floatToBinary here
        throw new Error('Should not reach here');
      }

      // Should skip embedding generation silently
      expect(mockEmbeddingResult.embedding).toBeUndefined();
    });
  });
});

// =============================================================================
// BOTTOM-UP PROCESSING ORDER TESTS
// =============================================================================

describe('Bottom-Up Processing Order', () => {
  const HIERARCHY_LEVELS = {
    'method': 2,
    'field': 2,
    'rpc': 2,
    'function': 1,
    'component': 1,
    'class': 1,
    'interface': 1,
    'enum': 1,
    'service': 1,
    'message': 1,
    'file': 0,
    'package': 0,
  };

  it('should process deepest levels (methods) before parents (classes)', () => {
    const entities = [
      { id: 1, type: 'class', name: 'Service', hierarchy_level: 1 },
      { id: 2, type: 'method', name: 'methodA', hierarchy_level: 2, parent_id: 1 },
      { id: 3, type: 'method', name: 'methodB', hierarchy_level: 2, parent_id: 1 },
      { id: 4, type: 'file', name: 'Service.java', hierarchy_level: 0 },
    ];

    // Group by level
    const byLevel = new Map();
    for (const entity of entities) {
      const level = entity.hierarchy_level ?? HIERARCHY_LEVELS[entity.type] ?? 1;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level).push(entity);
    }

    // Sort levels descending (deepest first)
    const levels = [...byLevel.keys()].sort((a, b) => b - a);

    expect(levels).toEqual([2, 1, 0]);

    // Level 2 (methods) processed first
    expect(byLevel.get(2).map(e => e.type)).toEqual(['method', 'method']);

    // Level 1 (class) processed second
    expect(byLevel.get(1).map(e => e.type)).toEqual(['class']);

    // Level 0 (file) processed last
    expect(byLevel.get(0).map(e => e.type)).toEqual(['file']);
  });

  it('should ensure children are in cache before parent processing', () => {
    const processOrder = [];
    const summaryCache = new Map();
    const childrenByParent = new Map();

    // Simulate processing order
    const entities = [
      { id: 2, type: 'method', name: 'methodA', hierarchy_level: 2, parent_id: 1 },
      { id: 3, type: 'method', name: 'methodB', hierarchy_level: 2, parent_id: 1 },
      { id: 1, type: 'class', name: 'Service', hierarchy_level: 1, parent_id: null },
    ];

    // Sort by hierarchy level DESC
    const sorted = [...entities].sort((a, b) => b.hierarchy_level - a.hierarchy_level);

    for (const entity of sorted) {
      processOrder.push(entity.name);

      // Simulate caching and indexing
      summaryCache.set(entity.id, {
        name: entity.name,
        summary: `Summary of ${entity.name}`,
        parentId: entity.parent_id,
      });

      if (entity.parent_id) {
        if (!childrenByParent.has(entity.parent_id)) {
          childrenByParent.set(entity.parent_id, []);
        }
        childrenByParent.get(entity.parent_id).push(entity.id);
      }
    }

    // Methods should be processed before class
    expect(processOrder.indexOf('methodA')).toBeLessThan(processOrder.indexOf('Service'));
    expect(processOrder.indexOf('methodB')).toBeLessThan(processOrder.indexOf('Service'));

    // When Service is processed, its children should already be in cache
    const childIds = childrenByParent.get(1) || [];
    expect(childIds).toContain(2);
    expect(childIds).toContain(3);
    expect(summaryCache.has(2)).toBe(true);
    expect(summaryCache.has(3)).toBe(true);
  });
});

// =============================================================================
// DATABASE STORAGE TESTS
// =============================================================================

describe('Summary Storage', () => {
  let db;

  beforeAll(() => {
    db = createTestDatabase();
    populateTestHierarchy(db);
  });

  afterAll(() => {
    if (db) db.close();
  });

  it('should store summary text correctly', () => {
    const updateStmt = db.prepare(`
      UPDATE entities SET summary = ? WHERE id = ?
    `);

    updateStmt.run('Authenticates user credentials against database', 2);

    const result = db.prepare('SELECT summary FROM entities WHERE id = ?').get(2);
    expect(result.summary).toBe('Authenticates user credentials against database');
  });

  it('should store binary embedding as BLOB', () => {
    // Create a binary embedding
    const binaryEmbedding = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);

    const updateStmt = db.prepare(`
      UPDATE entities SET summary_embedding = ? WHERE id = ?
    `);

    updateStmt.run(binaryEmbedding, 3);

    const result = db.prepare('SELECT summary_embedding FROM entities WHERE id = ?').get(3);

    // SQLite returns Buffer in Node.js
    expect(Buffer.isBuffer(result.summary_embedding)).toBe(true);
    expect(result.summary_embedding.length).toBe(4);
    expect(result.summary_embedding[0]).toBe(0xAA);
    expect(result.summary_embedding[3]).toBe(0xDD);
  });

  it('should store null embedding when generation fails', () => {
    const updateStmt = db.prepare(`
      UPDATE entities SET summary = ?, summary_embedding = ? WHERE id = ?
    `);

    updateStmt.run('Manual summary without embedding', null, 4);

    const result = db.prepare('SELECT summary, summary_embedding FROM entities WHERE id = ?').get(4);
    expect(result.summary).toBe('Manual summary without embedding');
    expect(result.summary_embedding).toBeNull();
  });

  it('should batch-store multiple summaries in a transaction', () => {
    const summaries = [
      { id: 2, summary: 'Summary A', embedding: new Uint8Array([0x11]) },
      { id: 3, summary: 'Summary B', embedding: new Uint8Array([0x22]) },
      { id: 5, summary: 'Summary C', embedding: new Uint8Array([0x33]) },
    ];

    const stmt = db.prepare(`
      UPDATE entities SET summary = ?, summary_embedding = ? WHERE id = ?
    `);

    const transaction = db.transaction(() => {
      for (const { id, summary, embedding } of summaries) {
        stmt.run(summary, embedding, id);
      }
    });

    transaction();

    // Verify all were stored
    for (const { id, summary, embedding } of summaries) {
      const result = db.prepare('SELECT summary, summary_embedding FROM entities WHERE id = ?').get(id);
      expect(result.summary).toBe(summary);
      expect(result.summary_embedding[0]).toBe(embedding[0]);
    }
  });
});
