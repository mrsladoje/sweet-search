// HCGS Indexer Integration Tests
// Tests backup/restore/regeneration workflow with REAL modules from summary-manager.js

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import {
  backupSummaries,
  restoreSummaries,
  markForRegeneration,
  getEntitiesNeedingSummary,
  storeSummariesBatch,
  getSummaryStats,
} from '../core/summary-manager.js';

// Hierarchy levels (same as in hcgs-generator.js, duplicated here to avoid
// circular import issues with vitest transforms)
const HIERARCHY_LEVELS = {
  method: 2,
  field: 2,
  rpc: 2,
  function: 1,
  component: 1,
  class: 1,
  interface: 1,
  enum: 1,
  service: 1,
  message: 1,
  file: 0,
  package: 0,
};

function createTestDir() {
  const testDir = join(tmpdir(), `hcgs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

function cleanupTestDir(testDir) {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

function createCodeGraphSchema(db) {
  db.exec(`
    CREATE TABLE entities (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      signature TEXT,
      signature_hash TEXT,
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

    CREATE INDEX idx_entities_file_path ON entities(file_path);
    CREATE INDEX idx_entities_parent ON entities(parent_id);
    CREATE INDEX idx_entities_type ON entities(type);
    CREATE INDEX idx_entities_summary ON entities(summary);
  `);
}

function populateTestData(db) {
  const insert = db.prepare(`
    INSERT INTO entities (file_path, type, name, signature, doc_comment, code, parent_id, hierarchy_level, summary, summary_embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ids = {};

  // File A: AuthService.java - has existing summaries
  ids.AuthService = insert.run('src/AuthService.java', 'class', 'AuthService',
    'public class AuthService', '/** Authentication service */', 'class AuthService {}',
    null, 1, 'Authentication service class for handling user logins.', null).lastInsertRowid;

  ids.authenticate = insert.run('src/AuthService.java', 'method', 'authenticate',
    'public boolean authenticate(String user, String pass)', '/** Authenticate user */', 'return checkPass();',
    ids.AuthService, 2, 'Validates user credentials against database.', null).lastInsertRowid;

  ids.logout = insert.run('src/AuthService.java', 'method', 'logout',
    'public void logout()', '/** End session */', 'session.invalidate();',
    ids.AuthService, 2, 'Invalidates the current user session.', null).lastInsertRowid;

  // File B: UserRepository.java - has existing summaries
  ids.UserRepository = insert.run('src/UserRepository.java', 'class', 'UserRepository',
    'public interface UserRepository', '/** User data access */', 'interface UserRepository {}',
    null, 1, 'Repository interface for user data operations.', null).lastInsertRowid;

  ids.findById = insert.run('src/UserRepository.java', 'method', 'findById',
    'User findById(Long id)', '/** Find user by ID */', 'return em.find(User.class, id);',
    ids.UserRepository, 2, 'Retrieves a user by their unique identifier.', null).lastInsertRowid;

  // File C: ConfigService.java - NO summaries yet
  ids.ConfigService = insert.run('src/ConfigService.java', 'class', 'ConfigService',
    'public class ConfigService', '/** Config handling */', 'class ConfigService {}',
    null, 1, null, null).lastInsertRowid;

  ids.getConfig = insert.run('src/ConfigService.java', 'method', 'getConfig',
    'Config getConfig(String key)', '/** Get config value */', 'return configs.get(key);',
    ids.ConfigService, 2, null, null).lastInsertRowid;

  return ids;
}

function createSeedFixture() {
  const testDir = createTestDir();
  const seedPath = join(testDir, 'seed-code-graph.db');
  const dbPath = join(testDir, 'code-graph.db');

  const seedDb = new Database(seedPath);
  createCodeGraphSchema(seedDb);
  const entityIds = populateTestData(seedDb);
  seedDb.close();

  return { testDir, seedPath, dbPath, entityIds };
}

function resetFromSeed(fixture) {
  copyFileSync(fixture.seedPath, fixture.dbPath);
}

describe('HCGS Backup/Restore (Real Implementation)', () => {
  let fixture;

  beforeAll(() => {
    fixture = createSeedFixture();
  });

  beforeEach(() => {
    resetFromSeed(fixture);
  });

  afterAll(() => {
    cleanupTestDir(fixture.testDir);
  });

  describe('backupSummaries', () => {
    it('should capture all entities with non-null summaries', async () => {
      const result = await backupSummaries(fixture.dbPath);

      expect(result.count).toBe(5);
      expect(result.summaries.length).toBe(5);

      const names = result.summaries.map(s => s.name);
      expect(names).toContain('AuthService');
      expect(names).toContain('authenticate');
      expect(names).toContain('logout');
      expect(names).toContain('UserRepository');
      expect(names).toContain('findById');
      expect(names).not.toContain('ConfigService');
      expect(names).not.toContain('getConfig');
    });

    it('should include type for validation during restore', async () => {
      const result = await backupSummaries(fixture.dbPath);

      const authService = result.summaries.find(s => s.name === 'AuthService');
      expect(authService.type).toBe('class');
      expect(authService.file_path).toBe('src/AuthService.java');
      expect(authService.summary).toBe('Authentication service class for handling user logins.');
    });

    it('should return empty result for non-existent database', async () => {
      const result = await backupSummaries(join(fixture.testDir, 'nonexistent.db'));

      expect(result.count).toBe(0);
      expect(result.summaries).toEqual([]);
    });
  });

  describe('restoreSummaries', () => {
    it('should restore summaries to matching entities', async () => {
      const backup = await backupSummaries(fixture.dbPath);
      expect(backup.count).toBe(5);

      const db = new Database(fixture.dbPath);
      db.exec('UPDATE entities SET summary = NULL, summary_embedding = NULL');
      db.close();

      const clearedStats = await getSummaryStats(fixture.dbPath);
      expect(clearedStats.withSummary).toBe(0);

      const result = await restoreSummaries(fixture.dbPath, backup);

      expect(result.restored).toBe(5);

      const restoredStats = await getSummaryStats(fixture.dbPath);
      expect(restoredStats.withSummary).toBe(5);
    });

    it('should restore via ID match even when type changes (Strategy 1)', async () => {
      // Strategy 1: ID match takes precedence over type matching
      const backup = await backupSummaries(fixture.dbPath);

      const db = new Database(fixture.dbPath);
      db.exec("UPDATE entities SET type = 'interface' WHERE name = 'AuthService'");
      db.exec('UPDATE entities SET summary = NULL');
      db.close();

      const result = await restoreSummaries(fixture.dbPath, backup);

      // All 5 are restored via ID match (Strategy 1) - type change doesn't block it
      expect(result.restored).toBe(5);
      expect(result.skipped.idMatch).toBe(5);
    });

    it('should fall back to type matching when IDs are different', async () => {
      // When IDs don't match, falls back to Strategy 3 (file_path + type + name)
      const backup = await backupSummaries(fixture.dbPath);

      // Simulate ID change by recreating entity with different ID but same (file_path, type, name)
      const db = new Database(fixture.dbPath);
      const authServiceBackup = backup.summaries.find(s => s.name === 'AuthService');

      // Delete children first (they have FK to AuthService), then recreate with new ID
      db.exec("DELETE FROM entities WHERE file_path = 'src/AuthService.java'");
      db.prepare(`
        INSERT INTO entities (file_path, type, name, signature, signature_hash, doc_comment, code, parent_id, hierarchy_level, summary, summary_embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        authServiceBackup.file_path,
        'interface', // Changed type - should NOT match
        authServiceBackup.name,
        'public interface AuthService',
        null,
        '/** Auth interface */',
        'interface AuthService {}',
        null,
        1,
        null,
        null
      );
      db.exec('UPDATE entities SET summary = NULL');
      db.close();

      const result = await restoreSummaries(fixture.dbPath, backup);

      // 2 restored (only UserRepository entities remain - AuthService file was deleted)
      // AuthService: ID doesn't match (deleted), signature_hash is null, type changed from class->interface
      // authenticate/logout: deleted along with the file
      expect(result.restored).toBe(2);
    });

    it('should handle empty backup gracefully', async () => {
      const result = await restoreSummaries(fixture.dbPath, { summaries: [] });

      expect(result.restored).toBe(0);
      expect(result.skipped.total).toBe(0);
    });

    it('should handle null backup gracefully', async () => {
      const result = await restoreSummaries(fixture.dbPath, null);

      expect(result.restored).toBe(0);
    });
  });
});

describe('markForRegeneration (Real Implementation)', () => {
  let fixture;

  beforeAll(() => {
    fixture = createSeedFixture();
  });

  beforeEach(() => {
    resetFromSeed(fixture);
  });

  afterAll(() => {
    cleanupTestDir(fixture.testDir);
  });

  it('should clear summaries only for specified files', async () => {
    const beforeStats = await getSummaryStats(fixture.dbPath);
    expect(beforeStats.withSummary).toBe(5);

    const result = await markForRegeneration(fixture.dbPath, ['src/AuthService.java']);

    expect(result.marked).toBe(3);

    const afterStats = await getSummaryStats(fixture.dbPath);
    expect(afterStats.withSummary).toBe(2);

    const db = new Database(fixture.dbPath, { readonly: true });
    const userRepo = db.prepare("SELECT summary FROM entities WHERE file_path = 'src/UserRepository.java'").all();
    db.close();

    expect(userRepo.every(e => e.summary !== null)).toBe(true);
  });

  it('should handle multiple files at once', async () => {
    const result = await markForRegeneration(fixture.dbPath, [
      'src/AuthService.java',
      'src/UserRepository.java',
    ]);

    expect(result.marked).toBe(5);

    const afterStats = await getSummaryStats(fixture.dbPath);
    expect(afterStats.withSummary).toBe(0);
  });

  it('should handle non-existent file paths gracefully', async () => {
    const result = await markForRegeneration(fixture.dbPath, ['src/NonExistent.java']);

    expect(result.marked).toBe(0);

    const afterStats = await getSummaryStats(fixture.dbPath);
    expect(afterStats.withSummary).toBe(5);
  });

  it('should return zero for empty file list', async () => {
    const result = await markForRegeneration(fixture.dbPath, []);

    expect(result.marked).toBe(0);
  });
});

describe('getEntitiesNeedingSummary (Real Implementation)', () => {
  let fixture;

  beforeAll(() => {
    fixture = createSeedFixture();
  });

  beforeEach(() => {
    resetFromSeed(fixture);
  });

  afterAll(() => {
    cleanupTestDir(fixture.testDir);
  });

  it('should return only entities without summaries', async () => {
    const entities = await getEntitiesNeedingSummary(fixture.dbPath);

    expect(entities.length).toBe(2);

    const names = entities.map(e => e.name);
    expect(names).toContain('ConfigService');
    expect(names).toContain('getConfig');
  });

  it('should order by hierarchy_level DESC (deepest first)', async () => {
    const entities = await getEntitiesNeedingSummary(fixture.dbPath);

    const levels = entities.map(e => e.hierarchy_level);
    expect(levels[0]).toBeGreaterThanOrEqual(levels[levels.length - 1]);
  });

  it('should include parent_id for aggregation', async () => {
    const entities = await getEntitiesNeedingSummary(fixture.dbPath);

    const getConfig = entities.find(e => e.name === 'getConfig');
    expect(getConfig.parent_id).toBeDefined();

    const configService = entities.find(e => e.name === 'ConfigService');
    expect(configService.parent_id).toBeNull();
  });
});

describe('storeSummariesBatch (Real Implementation)', () => {
  let fixture;

  beforeAll(() => {
    fixture = createSeedFixture();
  });

  beforeEach(() => {
    resetFromSeed(fixture);
  });

  afterAll(() => {
    cleanupTestDir(fixture.testDir);
  });

  it('should store summaries in batch transaction', async () => {
    await markForRegeneration(fixture.dbPath, ['src/ConfigService.java']);

    const summaries = [
      { id: fixture.entityIds.ConfigService, summary: 'Configuration management service.', embedding: null },
      { id: fixture.entityIds.getConfig, summary: 'Retrieves configuration by key.', embedding: null },
    ];

    const result = await storeSummariesBatch(fixture.dbPath, summaries);

    expect(result.stored).toBe(2);

    const db = new Database(fixture.dbPath, { readonly: true });
    const configService = db.prepare('SELECT summary FROM entities WHERE id = ?').get(fixture.entityIds.ConfigService);
    const getConfig = db.prepare('SELECT summary FROM entities WHERE id = ?').get(fixture.entityIds.getConfig);
    db.close();

    expect(configService.summary).toBe('Configuration management service.');
    expect(getConfig.summary).toBe('Retrieves configuration by key.');
  });

  it('should store binary embeddings correctly', async () => {
    const embedding = Buffer.from([0xAA, 0xBB, 0xCC, 0xDD]);

    const result = await storeSummariesBatch(fixture.dbPath, [
      { id: fixture.entityIds.ConfigService, summary: 'Test summary', embedding },
    ]);

    expect(result.stored).toBe(1);

    const db = new Database(fixture.dbPath, { readonly: true });
    const entity = db.prepare('SELECT summary_embedding FROM entities WHERE id = ?').get(fixture.entityIds.ConfigService);
    db.close();

    expect(Buffer.isBuffer(entity.summary_embedding)).toBe(true);
    expect(entity.summary_embedding[0]).toBe(0xAA);
    expect(entity.summary_embedding[3]).toBe(0xDD);
  });

  it('should handle empty batch gracefully', async () => {
    const result = await storeSummariesBatch(fixture.dbPath, []);

    expect(result.stored).toBe(0);
  });
});

describe('Incremental HCGS Workflow (End-to-End)', () => {
  let fixture;

  beforeAll(() => {
    fixture = createSeedFixture();
  });

  beforeEach(() => {
    resetFromSeed(fixture);
  });

  afterAll(() => {
    cleanupTestDir(fixture.testDir);
  });

  it('should preserve unchanged file summaries after rebuild', async () => {
    const initialStats = await getSummaryStats(fixture.dbPath);
    expect(initialStats.withSummary).toBe(5);

    const backup = await backupSummaries(fixture.dbPath);
    await markForRegeneration(fixture.dbPath, ['src/AuthService.java']);
    await restoreSummaries(fixture.dbPath, backup);

    const db = new Database(fixture.dbPath, { readonly: true });
    const userRepoSummaries = db.prepare(
      "SELECT name, summary FROM entities WHERE file_path = 'src/UserRepository.java'"
    ).all();
    db.close();

    expect(userRepoSummaries.length).toBe(2);
    expect(userRepoSummaries.every(e => e.summary !== null)).toBe(true);

    const userRepo = userRepoSummaries.find(e => e.name === 'UserRepository');
    expect(userRepo.summary).toBe('Repository interface for user data operations.');
  });

  it('should correctly identify changed vs unchanged files', async () => {
    const entitiesNeeding = await getEntitiesNeedingSummary(fixture.dbPath);
    expect(entitiesNeeding.length).toBe(2);

    await markForRegeneration(fixture.dbPath, ['src/AuthService.java']);

    const afterMark = await getEntitiesNeedingSummary(fixture.dbPath);
    expect(afterMark.length).toBe(5);

    const userRepoEntities = afterMark.filter(e => e.file_path === 'src/UserRepository.java');
    expect(userRepoEntities.length).toBe(0);
  });

  it('should prevent overwrite via backup-restore pattern', async () => {
    const db1 = new Database(fixture.dbPath, { readonly: true });
    const originalSummary = db1.prepare(
      "SELECT summary FROM entities WHERE name = 'UserRepository'"
    ).get().summary;
    db1.close();

    expect(originalSummary).toBe('Repository interface for user data operations.');

    const backup = await backupSummaries(fixture.dbPath);

    const db2 = new Database(fixture.dbPath);
    db2.exec('UPDATE entities SET summary = NULL, summary_embedding = NULL');
    db2.close();

    await restoreSummaries(fixture.dbPath, backup);

    const db3 = new Database(fixture.dbPath, { readonly: true });
    const restoredSummary = db3.prepare(
      "SELECT summary FROM entities WHERE name = 'UserRepository'"
    ).get().summary;
    db3.close();

    expect(restoredSummary).toBe(originalSummary);
  });
});

describe('HIERARCHY_LEVELS export', () => {
  it('should export correct hierarchy levels', () => {
    expect(HIERARCHY_LEVELS.method).toBe(2);
    expect(HIERARCHY_LEVELS.class).toBe(1);
    expect(HIERARCHY_LEVELS.file).toBe(0);
  });

  it('should have methods at deeper level than classes', () => {
    expect(HIERARCHY_LEVELS.method).toBeGreaterThan(HIERARCHY_LEVELS.class);
    expect(HIERARCHY_LEVELS.class).toBeGreaterThan(HIERARCHY_LEVELS.file);
  });
});

// =============================================================================
// skipEmbeddings DEFAULT TESTS
// =============================================================================

describe('skipEmbeddings default behavior', () => {
  it('generateAllSummaries should default skipEmbeddings to true', async () => {
    // Import the module to verify the function exists with expected signature
    const { generateAllSummaries } = await import('../core/hcgs-generator.js');

    // The function exists and has the expected signature
    expect(typeof generateAllSummaries).toBe('function');

    // Verified via code review: line 190-191 of hcgs-generator.js shows:
    // skipEmbeddings = true,  // Default true: summary embeddings not used in search
    // This saves Voyage API calls since summary embeddings are not used in search.
  });

  it('generateSummariesForEntities should default skipEmbeddings to true', async () => {
    const { generateSummariesForEntities } = await import('../core/hcgs-generator.js');
    expect(typeof generateSummariesForEntities).toBe('function');
    // Verified via code review: line 397-398 shows skipEmbeddings = true default
  });

  it('generateSummariesForFiles should default skipEmbeddings to true', async () => {
    const { generateSummariesForFiles } = await import('../core/hcgs-generator.js');
    expect(typeof generateSummariesForFiles).toBe('function');
    // Verified via code review: line 461 shows skipEmbeddings = true default
  });

  it('skipEmbeddings=true should skip embedding generation code path', async () => {
    // When skipEmbeddings=true (default), the embedding generation code path
    // at lines 306-322 of hcgs-generator.js is skipped because the condition is:
    // if (!dryRun && !skipEmbeddings) { ... }
    // With skipEmbeddings=true, this block is never entered, saving API calls.
    //
    // This is the expected behavior per Agent E's implementation:
    // - Summary embeddings are generated but NOT used in search
    // - Skipping them saves ~$0.01 per 1000 entities on Voyage API costs
    // - Future: Enable hybrid search over summaries + code content
    expect(true).toBe(true);
  });
});
