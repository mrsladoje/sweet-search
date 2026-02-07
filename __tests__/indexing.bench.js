/**
 * Indexing Performance Benchmarks
 *
 * Measures throughput and latency for:
 * 1. HCGS generation (summary generation throughput)
 * 2. Full index time (cold start)
 * 3. Incremental index time (warm start with changes)
 * 4. Code graph extraction throughput
 *
 * Run with: npx vitest bench
 * Results saved to: .agentdb/benchmark-results.json
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';

import { GraphExtractor, createGraphSchema, insertGraph } from '../graph-extractor.js';
import { buildSummaryPrompt, getTokenLimitForType, HIERARCHY_LEVELS } from '../hcgs-generator.js';
import { QueryRouter } from '../query-router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const INDEXER_PATH = join(__dirname, '..', 'index-codebase-v21.js');

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Sample Java file content for benchmarking
 */
const SAMPLE_JAVA_FILES = [
  {
    path: 'src/AuthService.java',
    content: `
package com.example.auth;

/**
 * Authentication service handling user login and logout.
 */
public class AuthService {
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(UserRepository userRepository, PasswordEncoder encoder, JwtService jwt) {
        this.userRepository = userRepository;
        this.passwordEncoder = encoder;
        this.jwtService = jwt;
    }

    /**
     * Authenticate user credentials.
     * @param username The username
     * @param password The password
     * @return JWT token if successful
     */
    public String authenticate(String username, String password) {
        User user = userRepository.findByUsername(username);
        if (user == null) {
            throw new AuthenticationException("User not found");
        }
        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new AuthenticationException("Invalid password");
        }
        return jwtService.generateToken(user);
    }

    /**
     * Logout user and invalidate token.
     */
    public void logout(String token) {
        jwtService.invalidateToken(token);
    }
}`,
  },
  {
    path: 'src/UserRepository.java',
    content: `
package com.example.repository;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Repository interface for User entity.
 */
public interface UserRepository extends JpaRepository<User, Long> {
    User findByUsername(String username);
    User findByEmail(String email);
    List<User> findByActiveTrue();
}`,
  },
  {
    path: 'src/JwtService.java',
    content: `
package com.example.security;

/**
 * JWT token generation and validation service.
 */
public class JwtService {
    private final String secretKey;
    private final long expirationMs;

    public JwtService(String secretKey, long expirationMs) {
        this.secretKey = secretKey;
        this.expirationMs = expirationMs;
    }

    public String generateToken(User user) {
        return Jwts.builder()
            .setSubject(user.getId().toString())
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + expirationMs))
            .signWith(SignatureAlgorithm.HS256, secretKey)
            .compact();
    }

    public boolean validateToken(String token) {
        try {
            Jwts.parser().setSigningKey(secretKey).parseClaimsJws(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public void invalidateToken(String token) {
        // Add to blacklist
        tokenBlacklist.add(token);
    }
}`,
  },
];

/**
 * Generate N sample files for benchmarking
 */
function generateSampleFiles(count) {
  const files = [];
  for (let i = 0; i < count; i++) {
    files.push({
      path: `src/generated/Service${i}.java`,
      content: `
package com.example.generated;

/**
 * Generated service ${i} for benchmarking.
 */
public class Service${i} {
    private final Repository${i} repository;

    public Service${i}(Repository${i} repository) {
        this.repository = repository;
    }

    public void process${i}(String input) {
        String result = repository.find${i}(input);
        validate${i}(result);
        transform${i}(result);
    }

    private void validate${i}(String data) {
        if (data == null || data.isEmpty()) {
            throw new IllegalArgumentException("Invalid data");
        }
    }

    private String transform${i}(String data) {
        return data.toUpperCase();
    }
}`,
    });
  }
  return files;
}

// =============================================================================
// Benchmark: Code Graph Extraction
// =============================================================================

describe('Code Graph Extraction', () => {
  const extractor = new GraphExtractor();

  bench('extract single Java file', async () => {
    const file = SAMPLE_JAVA_FILES[0];
    await extractor.extractFromFile(file.path, file.content);
  });

  bench('extract 3 Java files', async () => {
    for (const file of SAMPLE_JAVA_FILES) {
      await extractor.extractFromFile(file.path, file.content);
    }
  });

  bench('extract 10 generated files', async () => {
    const files = generateSampleFiles(10);
    for (const file of files) {
      await extractor.extractFromFile(file.path, file.content);
    }
  });

  bench('extract 50 generated files', async () => {
    const files = generateSampleFiles(50);
    for (const file of files) {
      await extractor.extractFromFile(file.path, file.content);
    }
  }, { time: 5000 });
});

// =============================================================================
// Benchmark: Database Schema Operations
// =============================================================================

describe('Database Schema Operations', () => {
  bench('create schema (fresh db)', () => {
    const db = new Database(':memory:');
    createGraphSchema(db);
    db.close();
  });

  bench('insert 100 entities', () => {
    const db = new Database(':memory:');
    createGraphSchema(db);

    const entities = [];
    for (let i = 0; i < 100; i++) {
      entities.push({
        id: `entity-${i}`,
        filePath: `src/File${i}.java`,
        type: i % 3 === 0 ? 'class' : 'method',
        name: `Entity${i}`,
        signature: `public void entity${i}()`,
        hierarchyLevel: i % 3 === 0 ? 1 : 2,
      });
    }

    insertGraph(db, entities, [], true);
    db.close();
  });

  bench('insert 1000 entities', () => {
    const db = new Database(':memory:');
    createGraphSchema(db);

    const entities = [];
    for (let i = 0; i < 1000; i++) {
      entities.push({
        id: `entity-${i}`,
        filePath: `src/File${Math.floor(i / 10)}.java`,
        type: i % 5 === 0 ? 'class' : 'method',
        name: `Entity${i}`,
        signature: `public void entity${i}()`,
        code: `return value${i};`,
        hierarchyLevel: i % 5 === 0 ? 1 : 2,
      });
    }

    insertGraph(db, entities, [], true);
    db.close();
  }, { time: 5000 });
});

// =============================================================================
// Benchmark: HCGS Prompt Building
// =============================================================================

describe('HCGS Prompt Building', () => {
  const sampleEntity = {
    type: 'class',
    name: 'AuthService',
    signature: 'public class AuthService',
    doc_comment: '/** Authentication service handling user login and logout. */',
    code: 'public class AuthService { ... }',
  };

  const childSummaries = [
    { name: 'authenticate', type: 'method', summary: 'Validates user credentials against database' },
    { name: 'logout', type: 'method', summary: 'Invalidates user session token' },
    { name: 'refreshToken', type: 'method', summary: 'Generates new JWT token' },
  ];

  bench('build prompt without children', () => {
    buildSummaryPrompt(sampleEntity, [], 150);
  });

  bench('build prompt with 3 children', () => {
    buildSummaryPrompt(sampleEntity, childSummaries, 150);
  });

  bench('build prompt with 10 children', () => {
    const manyChildren = Array(10).fill(null).map((_, i) => ({
      name: `method${i}`,
      type: 'method',
      summary: `Method ${i} does something important`,
    }));
    buildSummaryPrompt(sampleEntity, manyChildren, 200);
  });

  bench('get token limit for various types', () => {
    const types = ['method', 'class', 'interface', 'function', 'file'];
    for (const type of types) {
      getTokenLimitForType(type);
    }
  });
});

// =============================================================================
// Benchmark: Query Routing
// =============================================================================

describe('Query Routing', () => {
  const router = new QueryRouter();

  const lexicalQueries = [
    'AuthService',
    'LoginController',
    'getUserById',
  ];

  const semanticQueries = [
    'how does user authentication work',
    'where are gRPC events handled',
    'find methods that handle exceptions',
  ];

  bench('route lexical query', () => {
    for (const query of lexicalQueries) {
      router.route(query);
    }
  });

  bench('route semantic query', () => {
    for (const query of semanticQueries) {
      router.route(query);
    }
  });

  bench('route 100 mixed queries', () => {
    const allQueries = [...lexicalQueries, ...semanticQueries];
    for (let i = 0; i < 100; i++) {
      router.route(allQueries[i % allQueries.length]);
    }
  });
});

// =============================================================================
// Benchmark: FTS5 Search (requires populated DB)
// =============================================================================

describe('FTS5 Search Performance', () => {
  let db;

  beforeAll(() => {
    db = new Database(':memory:');
    createGraphSchema(db);

    // Populate with test data
    const entities = [];
    const types = ['class', 'method', 'interface', 'field'];
    const packages = ['com.auth', 'com.user', 'com.config', 'com.data'];

    for (let i = 0; i < 1000; i++) {
      entities.push({
        id: `entity-${i}`,
        filePath: `src/${packages[i % 4].replace(/\./g, '/')}/Entity${i}.java`,
        type: types[i % 4],
        name: `Entity${i}`,
        signature: `public ${types[i % 4]} Entity${i}`,
        docComment: `/** Entity ${i} provides functionality for ${packages[i % 4]} **/`,
        packageName: packages[i % 4],
        hierarchyLevel: types[i % 4] === 'method' ? 2 : 1,
      });
    }

    insertGraph(db, entities, [], true);
  });

  afterAll(() => {
    if (db) db.close();
  });

  bench('FTS5 simple search', () => {
    db.prepare(`
      SELECT id, name, type FROM entities
      WHERE id IN (
        SELECT rowid FROM entities_fts WHERE entities_fts MATCH 'Entity'
      )
      LIMIT 10
    `).all();
  });

  bench('FTS5 compound search', () => {
    db.prepare(`
      SELECT id, name, type FROM entities
      WHERE id IN (
        SELECT rowid FROM entities_fts WHERE entities_fts MATCH 'Entity AND auth'
      )
      LIMIT 10
    `).all();
  });

  bench('Type-filtered search', () => {
    db.prepare(`
      SELECT id, name, type FROM entities
      WHERE type = 'class'
      AND id IN (
        SELECT rowid FROM entities_fts WHERE entities_fts MATCH 'Entity'
      )
      LIMIT 10
    `).all();
  });
});

// =============================================================================
// Benchmark: Hierarchy Level Processing
// =============================================================================

describe('Hierarchy Level Processing', () => {
  bench('group entities by level', () => {
    const entities = [];
    for (let i = 0; i < 500; i++) {
      entities.push({
        id: i,
        type: i % 5 === 0 ? 'class' : 'method',
        hierarchy_level: i % 5 === 0 ? 1 : 2,
        parent_id: i % 5 === 0 ? null : Math.floor(i / 5) * 5,
      });
    }

    const byLevel = new Map();
    for (const entity of entities) {
      const level = entity.hierarchy_level ?? HIERARCHY_LEVELS[entity.type] ?? 1;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level).push(entity);
    }

    // Sort levels descending
    [...byLevel.keys()].sort((a, b) => b - a);
  });

  bench('build childrenByParent index', () => {
    const entities = [];
    for (let i = 0; i < 500; i++) {
      entities.push({
        id: i,
        parent_id: i % 5 === 0 ? null : Math.floor(i / 5) * 5,
      });
    }

    const childrenByParent = new Map();
    for (const entity of entities) {
      if (entity.parent_id) {
        if (!childrenByParent.has(entity.parent_id)) {
          childrenByParent.set(entity.parent_id, []);
        }
        childrenByParent.get(entity.parent_id).push(entity.id);
      }
    }
  });

  bench('lookup children O(1)', () => {
    const childrenByParent = new Map();
    for (let i = 0; i < 100; i++) {
      childrenByParent.set(i, [i * 10, i * 10 + 1, i * 10 + 2]);
    }

    // 1000 lookups
    for (let i = 0; i < 1000; i++) {
      childrenByParent.get(i % 100) || [];
    }
  });
});

// =============================================================================
// Benchmark: Binary Embedding Conversion
// =============================================================================

describe('Binary Embedding Conversion', () => {
  /**
   * Convert float embedding to binary (replicated from embedding-service.js)
   */
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

  bench('convert 512-dim embedding', () => {
    const embedding = new Array(512).fill(0).map(() => Math.random() * 2 - 1);
    floatToBinary(embedding);
  });

  bench('convert 1024-dim embedding (Voyage Code 3)', () => {
    const embedding = new Array(1024).fill(0).map(() => Math.random() * 2 - 1);
    floatToBinary(embedding);
  });

  bench('convert 100 embeddings', () => {
    for (let i = 0; i < 100; i++) {
      const embedding = new Array(1024).fill(0).map(() => Math.random() * 2 - 1);
      floatToBinary(embedding);
    }
  });
});

// =============================================================================
// Benchmark: HCGS Generation Throughput (Simulated)
// =============================================================================

describe('HCGS Generation Throughput', () => {
  /**
   * Simulates HCGS processing without actual LLM calls.
   * Measures the overhead of hierarchy traversal, caching, and batch storage prep.
   */

  bench('process 100 entities bottom-up (overhead only)', () => {
    const entities = [];
    const summaryCache = new Map();
    const childrenByParent = new Map();

    // Create test entities: 20 classes with 4 methods each = 100 entities
    for (let c = 0; c < 20; c++) {
      const classId = c * 5;
      entities.push({
        id: classId,
        type: 'class',
        name: `Class${c}`,
        hierarchy_level: 1,
        parent_id: null,
      });

      for (let m = 1; m <= 4; m++) {
        const methodId = classId + m;
        entities.push({
          id: methodId,
          type: 'method',
          name: `method${m}`,
          hierarchy_level: 2,
          parent_id: classId,
        });
      }
    }

    // Group by level (simulating generateAllSummaries logic)
    const byLevel = new Map();
    for (const entity of entities) {
      const level = entity.hierarchy_level;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level).push(entity);
    }

    // Process bottom-up
    const levels = [...byLevel.keys()].sort((a, b) => b - a);

    for (const level of levels) {
      for (const entity of byLevel.get(level)) {
        // Simulate getting child summaries (O(1) lookup)
        const childIds = childrenByParent.get(entity.id) || [];
        const childSummaries = childIds.map(id => summaryCache.get(id)).filter(Boolean);

        // Simulate caching this entity's summary
        summaryCache.set(entity.id, {
          name: entity.name,
          type: entity.type,
          summary: `Summary for ${entity.name}`,
        });

        // Index under parent
        if (entity.parent_id) {
          if (!childrenByParent.has(entity.parent_id)) {
            childrenByParent.set(entity.parent_id, []);
          }
          childrenByParent.get(entity.parent_id).push(entity.id);
        }
      }
    }
  });

  bench('process 500 entities bottom-up (overhead only)', () => {
    const entities = [];
    const summaryCache = new Map();
    const childrenByParent = new Map();

    // 100 classes with 4 methods each = 500 entities
    for (let c = 0; c < 100; c++) {
      const classId = c * 5;
      entities.push({
        id: classId,
        type: 'class',
        name: `Class${c}`,
        hierarchy_level: 1,
        parent_id: null,
      });

      for (let m = 1; m <= 4; m++) {
        const methodId = classId + m;
        entities.push({
          id: methodId,
          type: 'method',
          name: `method${m}`,
          hierarchy_level: 2,
          parent_id: classId,
        });
      }
    }

    const byLevel = new Map();
    for (const entity of entities) {
      const level = entity.hierarchy_level;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level).push(entity);
    }

    const levels = [...byLevel.keys()].sort((a, b) => b - a);

    for (const level of levels) {
      for (const entity of byLevel.get(level)) {
        const childIds = childrenByParent.get(entity.id) || [];
        const childSummaries = childIds.map(id => summaryCache.get(id)).filter(Boolean);

        summaryCache.set(entity.id, {
          name: entity.name,
          type: entity.type,
          summary: `Summary for ${entity.name}`,
        });

        if (entity.parent_id) {
          if (!childrenByParent.has(entity.parent_id)) {
            childrenByParent.set(entity.parent_id, []);
          }
          childrenByParent.get(entity.parent_id).push(entity.id);
        }
      }
    }
  }, { time: 5000 });

  bench('batch storage preparation (50 summaries)', () => {
    const pendingBatch = [];
    const batchSize = 50;

    for (let i = 0; i < batchSize; i++) {
      pendingBatch.push({
        id: i,
        summary: `Summary for entity ${i} with some additional context`,
        embedding: new Uint8Array(128), // 1024-dim binary embedding
      });
    }

    // Simulate batch processing check
    if (pendingBatch.length >= batchSize) {
      // Would store to DB here
      pendingBatch.length = 0;
    }
  });
});

// =============================================================================
// Benchmark: Incremental vs Full Index Simulation
// =============================================================================

describe('Incremental Index Simulation', () => {
  bench('detect changed files (merkle hash comparison)', () => {
    // Simulate merkle hash comparison for 1000 files
    const oldHashes = new Map();
    const newHashes = new Map();

    for (let i = 0; i < 1000; i++) {
      oldHashes.set(`src/file${i}.java`, `hash-${i}-old`);
      // 5% of files changed
      const hash = i % 20 === 0 ? `hash-${i}-new` : `hash-${i}-old`;
      newHashes.set(`src/file${i}.java`, hash);
    }

    const changedFiles = [];
    for (const [file, newHash] of newHashes) {
      if (oldHashes.get(file) !== newHash) {
        changedFiles.push(file);
      }
    }

    // Should find ~50 changed files (5%)
  });

  bench('incremental update (1 file of 1000)', () => {
    // Simulate incremental index: most work is skipped
    const totalFiles = 1000;
    const changedFiles = ['src/AuthService.java'];

    // Only process changed files
    for (const file of changedFiles) {
      // Simulate extraction
      const entities = [
        { id: 1, type: 'class', name: 'AuthService' },
        { id: 2, type: 'method', name: 'authenticate' },
        { id: 3, type: 'method', name: 'logout' },
      ];

      // Simulate insertion
      for (const entity of entities) {
        // Would insert to DB
      }
    }
  });

  bench('full index simulation (100 files)', () => {
    const files = [];
    for (let i = 0; i < 100; i++) {
      files.push(`src/Service${i}.java`);
    }

    const allEntities = [];
    for (const file of files) {
      // Simulate extraction: 5 entities per file
      for (let e = 0; e < 5; e++) {
        allEntities.push({
          id: allEntities.length,
          file_path: file,
          type: e === 0 ? 'class' : 'method',
          name: `Entity${e}`,
        });
      }
    }

    // Simulate batch insert preparation
    const insertBatch = allEntities.map(e => ({
      id: e.id,
      file_path: e.file_path,
      type: e.type,
      name: e.name,
    }));
  }, { time: 5000 });
});

// =============================================================================
// Benchmark: Indexer CLI (Process Spawn - Slow)
// =============================================================================

describe.skip('Indexer CLI Performance', () => {
  /**
   * Run indexer and measure time
   */
  async function runIndexerTimed(args) {
    const start = performance.now();

    return new Promise((resolve) => {
      const child = spawn('node', [INDEXER_PATH, ...args], {
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin.end();

      child.on('close', () => {
        resolve(performance.now() - start);
      });
    });
  }

  bench('--help (cold)', async () => {
    await runIndexerTimed(['--help']);
  });

  bench('--dry-run (minimal)', async () => {
    await runIndexerTimed(['--dry-run']);
  }, { time: 10000 });

  bench('--stats (check state)', async () => {
    await runIndexerTimed(['--stats']);
  });
});
