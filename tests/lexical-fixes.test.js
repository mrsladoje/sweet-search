/**
 * Lexical Fix Plan Tests
 *
 * Comprehensive tests for all 11 fixes from docs/LEXICAL_FIX_PLAN.md.
 * Uses real better-sqlite3 database with production-matching schema.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { GraphSearch } from '../core/graph-search.js';
import { createGraphSchema, normalizeIdentifier, SCHEMA_VERSION } from '../core/graph-extractor.js';

// =============================================================================
// SHARED TEST DATABASE
// =============================================================================

function createLexicalTestDb(dbPath) {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE entities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      signature TEXT,
      doc_comment TEXT,
      summary TEXT,
      package TEXT,
      parent_class TEXT,
      search_text TEXT,
      name_alias TEXT,
      stale_since INTEGER DEFAULT NULL
    );

    CREATE TABLE relationships (
      source_id TEXT,
      target_id TEXT,
      target_name TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      context_line INTEGER,
      full_import_path TEXT,
      is_static INTEGER DEFAULT 0,
      is_wildcard INTEGER DEFAULT 0
    );

    -- Production-matching FTS5: name, name_alias, signature, doc_comment
    CREATE VIRTUAL TABLE entities_fts USING fts5(
      name,
      name_alias,
      signature,
      doc_comment,
      content='entities',
      content_rowid='id',
      tokenize='porter unicode61',
      prefix='2 3 4'
    );

    -- Trigram FTS5 for fuzzy/substring matching
    CREATE VIRTUAL TABLE entities_trigram USING fts5(
      name,
      signature,
      content='entities',
      content_rowid='id',
      tokenize='trigram'
    );

    CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN
      INSERT INTO entities_fts(rowid, name, name_alias, signature, doc_comment)
      VALUES (NEW.id, NEW.name, NEW.name_alias, NEW.signature, NEW.doc_comment);
      INSERT INTO entities_trigram(rowid, name, signature)
      VALUES (NEW.id, NEW.name, NEW.signature);
    END;
  `);

  const insert = db.prepare(`
    INSERT INTO entities (id, name, type, file_path, start_line, end_line, signature, doc_comment, search_text, name_alias, stale_since)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Rich fixture set for lexical testing
  insert.run(1, 'AuthService', 'class', 'src/auth/AuthService.java', 10, 200, 'public class AuthService', 'Authentication service', 'authservice authentication service', 'auth service authservice', null);
  insert.run(2, 'UserService', 'class', 'src/user/UserService.java', 5, 150, 'public class UserService', 'User management service', 'userservice user management', 'user service userservice', null);
  insert.run(3, 'getUserName', 'method', 'src/user/UserService.java', 20, 30, 'public String getUserName(int id)', 'Gets user name by id', 'getusername user name', 'get user name getusername', null);
  insert.run(4, 'get_user_name', 'function', 'src/utils/helpers.py', 10, 20, 'def get_user_name(user_id)', 'Python helper for user name', 'get_user_name user name', 'get user name getusername', null);
  insert.run(5, 'HTMLParser', 'class', 'src/parser/HTMLParser.ts', 1, 100, 'export class HTMLParser', 'Parses HTML documents', 'htmlparser html documents', 'html parser htmlparser', null);
  insert.run(6, 'OAuth2Client', 'class', 'src/auth/OAuth2Client.ts', 1, 80, 'export class OAuth2Client', 'OAuth 2.0 client', 'oauth2client oauth client', 'oauth 2 client oauth2client', null);
  insert.run(7, 'LoginController', 'class', 'src/auth/LoginController.java', 5, 120, 'public class LoginController', 'Handles auth login flow', 'logincontroller auth login', 'login controller logincontroller', null);
  insert.run(8, 'MAX_RETRIES', 'constant', 'src/config/constants.ts', 3, 3, 'export const MAX_RETRIES = 3', 'Maximum retry count', 'max_retries maximum retry', 'max retries maxretries', null);
  insert.run(9, 'configLoader', 'function', 'src/config/loader.js', 10, 50, 'function configLoader(path)', 'Loads configuration from file', 'configloader configuration file', 'config loader configloader', null);
  insert.run(10, 'DatabaseConnection', 'class', 'src/db/DatabaseConnection.java', 1, 200, 'public class DatabaseConnection', 'Database connection pool', 'databaseconnection database connection pool', 'database connection databaseconnection', null);
  // Entity where search term only appears in doc_comment (for weight validation)
  insert.run(11, 'HelperUtils', 'class', 'src/utils/HelperUtils.java', 1, 50, 'public class HelperUtils', 'Utility with auth helpers', 'helperutils utility auth helpers', 'helper utils helperutils', null);
  // Stale entity (should never appear)
  insert.run(12, 'OldAuthService', 'class', 'src/auth/OldAuthService.java', 1, 100, 'public class OldAuthService', 'Deprecated auth', 'oldauthservice deprecated auth', 'old auth service oldauthservice', 1704067200);
  insert.run(13, 'SecurityManager', 'class', 'src/security/SecurityManager.java', 1, 75, 'public class SecurityManager', 'Handles Auth2FA login flow', 'securitymanager auth2fa login', 'security manager securitymanager', null);

  return db;
}

// =============================================================================
// SCHEMA MIGRATION: LEGACY FTS LAYOUTS
// =============================================================================

describe('Schema migration for lexical fixes', () => {
  let testDir;

  afterAll(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('rebuilds legacy FTS tables, backfills aliases, and updates schema version', async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-schema-'));
    const dbPath = join(testDir, 'legacy.db');
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        signature TEXT,
        signature_hash TEXT,
        doc_comment TEXT,
        start_line INTEGER,
        end_line INTEGER,
        package TEXT,
        parent_class TEXT,
        search_text TEXT,
        summary TEXT,
        summary_embedding BLOB,
        parent_id TEXT,
        hierarchy_level INTEGER DEFAULT 0,
        code TEXT,
        stale_since INTEGER DEFAULT NULL
      );

      CREATE TABLE relationships (
        source_id TEXT,
        target_id TEXT,
        target_name TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        context_line INTEGER,
        full_import_path TEXT,
        is_static INTEGER DEFAULT 0,
        is_wildcard INTEGER DEFAULT 0
      );

      CREATE VIRTUAL TABLE entities_fts USING fts5(
        name,
        signature,
        doc_comment,
        content='entities',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );
    `);

    db.prepare(`
      INSERT INTO entities (id, file_path, type, name, signature, doc_comment, search_text, stale_since)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      '1',
      'src/user/UserService.java',
      'class',
      'UserService',
      'public class UserService',
      'User management service',
      'userservice user service',
      null
    );

    createGraphSchema(db);
    db.exec(`INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`);
    db.exec(`INSERT INTO entities_trigram(entities_trigram) VALUES('rebuild')`);

    const aliasRow = db.prepare(`SELECT name_alias FROM entities WHERE id = ?`).get('1');
    const ftsSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entities_fts'`).get().sql;
    const versionRow = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get();

    expect(aliasRow.name_alias).toBe('user service userservice');
    expect(ftsSql).toContain('name_alias');
    expect(ftsSql).toContain(`prefix='2 3 4'`);
    expect(versionRow.value).toBe(String(SCHEMA_VERSION));

    db.close();

    const graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
    const { results } = await graphSearch.bm25Search('user service');
    graphSearch.close();

    expect(results.some(r => r.name === 'UserService')).toBe(true);
  });
});

// =============================================================================
// FIX 1: WEIGHTED BM25 / BM25F
// =============================================================================

describe('Fix 1: Weighted BM25 / BM25F', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-fix1-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should rank name matches higher than doc_comment-only matches', async () => {
    // "auth" appears in AuthService's name but only in HelperUtils' doc_comment
    const { results } = await graphSearch.bm25Search('auth', { limit: 10 });
    const authIdx = results.findIndex(r => r.name === 'AuthService');
    const helperIdx = results.findIndex(r => r.name === 'HelperUtils');
    expect(authIdx).toBeGreaterThanOrEqual(0);
    if (helperIdx >= 0) {
      expect(authIdx).toBeLessThan(helperIdx);
    }
  });

  it('should detect 4-column FTS5 schema', () => {
    expect(graphSearch._ftsColumnCount).toBe(4);
  });
});

// =============================================================================
// FIX 2: SANITIZATION + TRIGRAM CORRECTNESS
// =============================================================================

describe('Fix 2: Sanitization + Trigram Correctness', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-fix2-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should strip + from FTS5 queries without crashing', async () => {
    const { results } = await graphSearch.bm25Search('a+b');
    // Should not throw; may or may not return results
    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle embedded double quotes in queries', async () => {
    const { results } = await graphSearch.bm25Search('foo"bar');
    expect(Array.isArray(results)).toBe(true);
  });

  it('should sanitize all FTS5 special characters from input', () => {
    const sanitized = graphSearch.sanitizeFtsQuery('hello:world*"test"^2~3(group)+end-dash');
    // The output wraps tokens in quotes and adds * for prefix — that's intentional FTS5 syntax.
    // But the INPUT special chars (: * ^ ~ ( ) +) should be stripped before wrapping.
    // Verify the raw input chars don't appear as literal content within quoted tokens:
    // Each token should be a plain alphanumeric word
    const tokens = sanitized.match(/"([^"]+)"/g)?.map(t => t.slice(1, -1)) || [];
    for (const token of tokens) {
      expect(token).toMatch(/^[a-zA-Z0-9]+$/);
    }
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('test');
  });

  it('should handle trigram search with embedded quotes', async () => {
    // This should not throw even though the query has quotes
    expect(graphSearch.hasTrigram).toBe(true);
    const { results } = await graphSearch.bm25Search('Auth"test', { limit: 5 });
    expect(Array.isArray(results)).toBe(true);
  });
});

// =============================================================================
// FIX 3: FTS5 ERROR LOGGING PARITY
// =============================================================================

describe('Fix 3: FTS5 Error Logging Parity', () => {
  let testDir, graphSearch, logMessages;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-fix3-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
    // Override log to capture messages
    logMessages = [];
    graphSearch.log = (msg) => logMessages.push(msg);
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should log FTS5 errors in bm25Search', async () => {
    // Force an FTS5 error by breaking the prepared statement
    const origStmt = graphSearch._stmtFts5;
    graphSearch._stmtFts5 = { all: () => { throw new Error('test FTS5 error'); } };

    logMessages.length = 0;
    const { results } = await graphSearch.bm25Search('test');
    graphSearch._stmtFts5 = origStmt;

    expect(logMessages.some(m => m.includes('[bm25Search]') && m.includes('FTS5'))).toBe(true);
  });
});

// =============================================================================
// FIX 4: NARROW IDENTIFIER ROUTING
// =============================================================================

describe('Fix 4: Narrow Identifier Routing', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-fix4-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('isStrictIdentifierQuery', () => {
    it('should match PascalCase', () => {
      expect(graphSearch.isStrictIdentifierQuery('UserService')).toBe(true);
      expect(graphSearch.isStrictIdentifierQuery('HTMLParser')).toBe(true);
      expect(graphSearch.isStrictIdentifierQuery('AuthDTO')).toBe(true);
    });

    it('should match camelCase', () => {
      expect(graphSearch.isStrictIdentifierQuery('getUserName')).toBe(true);
      expect(graphSearch.isStrictIdentifierQuery('authService')).toBe(true);
    });

    it('should match snake_case', () => {
      expect(graphSearch.isStrictIdentifierQuery('get_user_name')).toBe(true);
      expect(graphSearch.isStrictIdentifierQuery('user_id')).toBe(true);
    });

    it('should match SCREAMING_SNAKE_CASE', () => {
      expect(graphSearch.isStrictIdentifierQuery('MAX_RETRIES')).toBe(true);
      expect(graphSearch.isStrictIdentifierQuery('HTTP_STATUS')).toBe(true);
    });

    it('should match all-uppercase code identifiers', () => {
      expect(graphSearch.isStrictIdentifierQuery('JSON')).toBe(true);
      expect(graphSearch.isStrictIdentifierQuery('URL')).toBe(true);
      expect(graphSearch.isStrictIdentifierQuery('API')).toBe(true);
      expect(graphSearch.isStrictIdentifierQuery('IO')).toBe(true);
    });

    it('should match dotted identifiers', () => {
      expect(graphSearch.isStrictIdentifierQuery('foo.bar')).toBe(true);
      expect(graphSearch.isStrictIdentifierQuery('auth.service')).toBe(true);
    });

    it('should NOT match generic lowercase words', () => {
      expect(graphSearch.isStrictIdentifierQuery('cache')).toBe(false);
      expect(graphSearch.isStrictIdentifierQuery('error')).toBe(false);
      expect(graphSearch.isStrictIdentifierQuery('token')).toBe(false);
      expect(graphSearch.isStrictIdentifierQuery('login')).toBe(false);
    });

    it('should NOT match multi-word queries', () => {
      expect(graphSearch.isStrictIdentifierQuery('how does auth work')).toBe(false);
      expect(graphSearch.isStrictIdentifierQuery('user service')).toBe(false);
    });

    it('should NOT match single uppercase letter', () => {
      expect(graphSearch.isStrictIdentifierQuery('A')).toBe(false);
    });
  });

  it('should use name restriction for PascalCase and still return results', async () => {
    const { results } = await graphSearch.bm25Search('AuthService');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('AuthService');
  });

  it('should fall back to unrestricted FTS5 when name restriction finds nothing', async () => {
    const result = await graphSearch.bm25Search('Auth2FA');
    const names = result.results.map(r => r.name);

    expect(names).toContain('SecurityManager');
    expect(result.lexicalMeta.restrictedAttempted).toBe(true);
    expect(result.lexicalMeta.restrictedFallback).toBe(true);
    expect(result.lexicalMeta.identifierRestricted).toBe(false);
  });

  it('should apply name restriction in bm25SearchRaw too', async () => {
    const { results } = await graphSearch.bm25SearchRaw('UserService', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('UserService');
  });
});

// =============================================================================
// FIX 5: FTS5 PREFIX INDEXES
// =============================================================================

describe('Fix 5: FTS5 Prefix Indexes', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-fix5-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should handle short prefix queries efficiently', async () => {
    const { results } = await graphSearch.bm25Search('aut');
    expect(results.length).toBeGreaterThan(0);
    // Should find AuthService, OAuth2Client via prefix
    const names = results.map(r => r.name);
    expect(names.some(n => n.includes('Auth') || n.includes('auth'))).toBe(true);
  });

  it('should create FTS5 prefix indexes in the schema', () => {
    const row = graphSearch.db.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'entities_fts'
    `).get();

    expect(row.sql).toContain(`prefix='2 3 4'`);
  });

  it('should handle 2-char prefix queries', async () => {
    const { results } = await graphSearch.bm25Search('db');
    expect(Array.isArray(results)).toBe(true);
  });
});

// =============================================================================
// FIX 6: PATH-AWARE LEXICAL SIGNAL
// =============================================================================

describe('Fix 6: Path-Aware Lexical Signal', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-fix6-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('applyPathBoost', () => {
    it('should give 1.5x for exact basename match', () => {
      const result = { file: 'src/auth/authservice.java' };
      const boost = graphSearch.applyPathBoost(result, ['authservice']);
      expect(boost).toBe(1.5);
    });

    it('should give 1.25x when basename contains token', () => {
      const result = { file: 'src/auth/AuthServiceImpl.java' };
      const boost = graphSearch.applyPathBoost(result, ['auth']);
      // 'authserviceimpl'.includes('auth') = true
      expect(boost).toBe(1.25);
    });

    it('should give 1.1x when directory segment contains token', () => {
      const result = { file: 'src/auth/LoginController.java' };
      const boost = graphSearch.applyPathBoost(result, ['auth']);
      // basename is 'logincontroller', no match. dir 'auth' contains 'auth'
      expect(boost).toBe(1.1);
    });

    it('should return 1.0 when no path match', () => {
      const result = { file: 'src/utils/helpers.js' };
      const boost = graphSearch.applyPathBoost(result, ['database']);
      expect(boost).toBe(1.0);
    });

    it('should skip tokens shorter than 2 chars', () => {
      const result = { file: 'src/a/b.js' };
      const boost = graphSearch.applyPathBoost(result, ['a']);
      expect(boost).toBe(1.0);
    });

    it('should handle missing file path', () => {
      const boost = graphSearch.applyPathBoost({}, ['auth']);
      expect(boost).toBe(1.0);
    });
  });

  describe('extractQueryTokens', () => {
    it('should split path-like queries for path boosting', () => {
      expect(graphSearch.extractQueryTokens('auth/service')).toEqual(
        expect.arrayContaining(['auth/service', 'auth', 'service', 'authservice'])
      );
    });

    it('should split dotted and snake_case queries for path boosting', () => {
      expect(graphSearch.extractQueryTokens('auth.service')).toEqual(
        expect.arrayContaining(['auth.service', 'auth', 'service', 'authservice'])
      );
      expect(graphSearch.extractQueryTokens('get_user_name')).toEqual(
        expect.arrayContaining(['get_user_name', 'get', 'user', 'name', 'getusername'])
      );
    });
  });
});

// =============================================================================
// FIX 7: NORMALIZED IDENTIFIER ALIAS FIELD
// =============================================================================

describe('Fix 7: Normalized Identifier Alias', () => {
  describe('normalizeIdentifier', () => {
    it('should split PascalCase: UserService', () => {
      expect(normalizeIdentifier('UserService')).toBe('user service userservice');
    });

    it('should split camelCase: getUserName', () => {
      expect(normalizeIdentifier('getUserName')).toBe('get user name getusername');
    });

    it('should split snake_case: get_user_name', () => {
      expect(normalizeIdentifier('get_user_name')).toBe('get user name getusername');
    });

    it('should split acronym boundaries: HTMLParser', () => {
      expect(normalizeIdentifier('HTMLParser')).toBe('html parser htmlparser');
    });

    it('should split digit boundaries: OAuth2Client', () => {
      expect(normalizeIdentifier('OAuth2Client')).toBe('oauth 2 client oauth2client');
    });

    it('should split dotted: auth.service', () => {
      expect(normalizeIdentifier('auth.service')).toBe('auth service authservice');
    });

    it('should handle digit prefix: v2Handler', () => {
      expect(normalizeIdentifier('v2Handler')).toBe('v 2 handler v2handler');
    });

    it('should handle empty/null input', () => {
      expect(normalizeIdentifier('')).toBe('');
      expect(normalizeIdentifier(null)).toBe('');
    });

    it('should deduplicate tokens', () => {
      // 'test' split is just ['test'], collapsed is 'test' — should not duplicate
      const result = normalizeIdentifier('test');
      expect(result).toBe('test');
    });
  });

  describe('name_alias in FTS5 search', () => {
    let testDir, graphSearch;

    beforeAll(async () => {
      testDir = mkdtempSync(join(tmpdir(), 'lexical-fix7-'));
      const dbPath = join(testDir, 'test.db');
      const db = createLexicalTestDb(dbPath);
      db.close();
      graphSearch = new GraphSearch(dbPath);
      await graphSearch.init();
    });

    afterAll(() => {
      graphSearch?.close();
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should find UserService via split query "user service"', async () => {
      const { results } = await graphSearch.bm25Search('user service');
      const names = results.map(r => r.name);
      expect(names).toContain('UserService');
    });
  });
});

// =============================================================================
// FIX 8: IDENTIFIER VARIANT EXPANSION
// =============================================================================

describe('Fix 8: Identifier Variant Expansion', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-fix8-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('expandIdentifierQuery', () => {
    it('should expand camelCase to split tokens', () => {
      const result = graphSearch.expandIdentifierQuery('getUserName');
      expect(result).toBe('"get" "user" "name"*');
    });

    it('should expand PascalCase', () => {
      const result = graphSearch.expandIdentifierQuery('UserService');
      expect(result).toBe('"user" "service"*');
    });

    it('should expand snake_case', () => {
      const result = graphSearch.expandIdentifierQuery('get_user_name');
      expect(result).toBe('"get" "user" "name"*');
    });

    it('should return null for single-token identifiers', () => {
      expect(graphSearch.expandIdentifierQuery('auth')).toBeNull();
      expect(graphSearch.expandIdentifierQuery('cache')).toBeNull();
    });

    it('should expand digit boundaries', () => {
      const result = graphSearch.expandIdentifierQuery('OAuth2Client');
      expect(result).toBe('"oauth" "2" "client"*');
    });
  });
});

// =============================================================================
// FIX 9: ABBREVIATION EXPANSION DICTIONARY
// =============================================================================

describe('Fix 9: Abbreviation Expansion Dictionary', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-fix9-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('expandAbbreviations', () => {
    it('should expand auth to authentication and authorize', () => {
      const result = graphSearch.expandAbbreviations('auth');
      expect(result).toContain('"auth"*');
      expect(result).toContain('"authentication"*');
      expect(result).toContain('"authorize"*');
      expect(result).toContain(' OR ');
    });

    it('should expand cfg to config and configuration', () => {
      const result = graphSearch.expandAbbreviations('cfg');
      expect(result).toContain('"config"*');
      expect(result).toContain('"configuration"*');
    });

    it('should expand repo', () => {
      const result = graphSearch.expandAbbreviations('repo');
      expect(result).toContain('"repository"*');
    });

    it('should return null for unknown abbreviations', () => {
      expect(graphSearch.expandAbbreviations('foobar')).toBeNull();
      expect(graphSearch.expandAbbreviations('UserService')).toBeNull();
    });

    it('should not expand queries with more than 2 words', () => {
      expect(graphSearch.expandAbbreviations('auth cfg repo')).toBeNull();
    });

    it('should preserve the non-abbreviation terms in two-word queries', () => {
      const result = graphSearch.expandAbbreviations('cfg loader');
      expect(result).toBe('("cfg"* OR "config"* OR "configuration"*) "loader"*');
    });
  });
});

// =============================================================================
// FIX 11: LEXICAL PATH OBSERVABILITY
// =============================================================================

describe('Fix 11: Lexical Path Observability', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-fix11-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return searchQuality field', async () => {
    const result = await graphSearch.bm25Search('AuthService');
    expect(result.searchQuality).toBeDefined();
    expect(['exact', 'fuzzy', 'fallback']).toContain(result.searchQuality);
  });

  it('should return lexicalMeta with expected fields', async () => {
    const result = await graphSearch.bm25Search('AuthService');
    expect(result.lexicalMeta).toBeDefined();
    expect(result.lexicalMeta.searchQuality).toBeDefined();
    expect(result.lexicalMeta.lexicalPath).toBeDefined();
    expect(typeof result.lexicalMeta.identifierRestricted).toBe('boolean');
    expect(typeof result.lexicalMeta.restrictedAttempted).toBe('boolean');
    expect(typeof result.lexicalMeta.restrictedFallback).toBe('boolean');
    expect(typeof result.lexicalMeta.abbreviationExpanded).toBe('boolean');
    expect(typeof result.lexicalMeta.variantExpanded).toBe('boolean');
    expect(typeof result.lexicalMeta.definitionFirstUsed).toBe('boolean');
    expect(typeof result.lexicalMeta.definitionFirstTopHit).toBe('boolean');
  });

  it('should report exact quality for FTS5 results', async () => {
    const result = await graphSearch.bm25Search('AuthService');
    expect(result.searchQuality).toBe('exact');
    expect(result.lexicalMeta.lexicalPath).toBe('fts5');
  });

  it('should report identifierRestricted=true for PascalCase', async () => {
    const result = await graphSearch.bm25Search('AuthService');
    expect(result.lexicalMeta.identifierRestricted).toBe(true);
    expect(result.lexicalMeta.restrictedAttempted).toBe(true);
    expect(result.lexicalMeta.restrictedFallback).toBe(false);
  });

  it('should report identifierRestricted=false for generic words', async () => {
    const result = await graphSearch.bm25Search('service');
    expect(result.lexicalMeta.identifierRestricted).toBe(false);
  });

  it('should report fts5 as lexicalPath for abbreviation-expanded results', async () => {
    const result = await graphSearch.bm25Search('cfg');
    expect(result.lexicalMeta.lexicalPath).toBe('fts5');
    expect(result.lexicalMeta.abbreviationExpanded).toBe(true);
  });

  it('should report restricted fallback when name-restricted search misses', async () => {
    const result = await graphSearch.bm25Search('Auth2FA');
    expect(result.lexicalMeta.restrictedAttempted).toBe(true);
    expect(result.lexicalMeta.restrictedFallback).toBe(true);
    expect(result.lexicalMeta.identifierRestricted).toBe(false);
  });
});

// =============================================================================
// INTEGRATION: VALIDATION MATRIX (from plan)
// =============================================================================

describe('Validation Matrix', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-validation-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('exact identifier: AuthService at top', async () => {
    const { results } = await graphSearch.bm25Search('AuthService');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('AuthService');
  });

  it('prefix identifier: Auth finds AuthService', async () => {
    const { results } = await graphSearch.bm25Search('Auth');
    const names = results.map(r => r.name);
    expect(names.some(n => n.includes('Auth'))).toBe(true);
  });

  it('cross-style identifier: getUserName and get_user_name', async () => {
    // Both should return results via alias field
    const r1 = await graphSearch.bm25Search('getUserName');
    const r2 = await graphSearch.bm25Search('get_user_name');
    expect(r1.results.length).toBeGreaterThan(0);
    expect(r2.results.length).toBeGreaterThan(0);
  });

  it('split query: user service ranks UserService strongly', async () => {
    const { results } = await graphSearch.bm25Search('user service');
    expect(results.length).toBeGreaterThan(0);
    expect(results.slice(0, 3).map(r => r.name)).toContain('UserService');
  });

  it('malformed query: foo"bar does not crash', async () => {
    const { results } = await graphSearch.bm25Search('foo"bar');
    expect(Array.isArray(results)).toBe(true);
  });

  it('malformed query: a+b does not crash', async () => {
    const { results } = await graphSearch.bm25Search('a+b');
    expect(Array.isArray(results)).toBe(true);
  });

  it('stale entities are never returned', async () => {
    const { results } = await graphSearch.bm25Search('OldAuthService');
    const names = results.map(r => r.name);
    expect(names).not.toContain('OldAuthService');
  });
});

// =============================================================================
// DEDUPLICATION & HELPER TESTS
// =============================================================================

describe('_mapRow and _mergeRows helpers', () => {
  let testDir, graphSearch;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'lexical-helpers-'));
    const dbPath = join(testDir, 'test.db');
    const db = createLexicalTestDb(dbPath);
    db.close();
    graphSearch = new GraphSearch(dbPath);
    await graphSearch.init();
  });

  afterAll(() => {
    graphSearch?.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('_mapRow should map all fields correctly', () => {
    const row = {
      id: '1', file_path: 'src/foo.js', type: 'class', name: 'Foo',
      signature: 'class Foo', doc_comment: 'A foo', start_line: 1,
      end_line: 10, package: 'pkg', parent_class: null, score: -5.5,
    };
    const result = graphSearch._mapRow(row, 'fts5', 0.9);
    expect(result.id).toBe('1');
    expect(result.file).toBe('src/foo.js');
    expect(result.score).toBeCloseTo(5.5 * 0.9);
    expect(result.source).toBe('fts5');
    expect(result.name).toBe('Foo');
  });

  it('_mergeRows should deduplicate by id', () => {
    const results = [{ id: '1', name: 'Foo' }];
    const newRows = [
      { id: '1', file_path: 'a', type: 't', name: 'Foo', signature: '', doc_comment: '', start_line: 1, end_line: 2, package: '', parent_class: '', score: -1 },
      { id: '2', file_path: 'b', type: 't', name: 'Bar', signature: '', doc_comment: '', start_line: 1, end_line: 2, package: '', parent_class: '', score: -2 },
    ];
    graphSearch._mergeRows(results, newRows, 'test', 1.0);
    expect(results.length).toBe(2); // '1' deduped, '2' added
    expect(results[1].name).toBe('Bar');
  });
});
