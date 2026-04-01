import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import { expandResults, applyTokenBudget, loadChunkTexts, computeTokenEstimates } from '../../core/graph/graph-expansion.js';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Integration tests for token estimation.
 *
 * These tests use realistic multi-language code samples stored in both
 * a codebase.db (vectors table) and on-disk files to verify that the
 * full pipeline — from expandResults through accurate token estimation
 * to budget cutoff — works correctly across languages.
 */

// Realistic code samples per language
const CODE_SAMPLES = {
  java: {
    fileName: 'AuthService.java',
    text: [
      'package com.example.auth;',
      '',
      'import java.util.Optional;',
      'import com.example.model.User;',
      'import com.example.token.TokenGenerator;',
      '',
      'public class AuthService implements IAuthService {',
      '    private final UserRepository userRepository;',
      '    private final TokenGenerator tokenGenerator;',
      '',
      '    public AuthService(UserRepository userRepository, TokenGenerator tokenGenerator) {',
      '        this.userRepository = userRepository;',
      '        this.tokenGenerator = tokenGenerator;',
      '    }',
      '',
      '    @Override',
      '    public Optional<AuthToken> authenticate(String username, String password) {',
      '        Optional<User> user = userRepository.findByUsername(username);',
      '        if (user.isEmpty()) {',
      '            return Optional.empty();',
      '        }',
      '        if (!user.get().verifyPassword(password)) {',
      '            throw new AuthenticationException("Invalid credentials");',
      '        }',
      '        return Optional.of(tokenGenerator.generateToken(user.get()));',
      '    }',
      '}',
    ],
    startLine: 1,
    endLine: 27,
  },
  python: {
    fileName: 'auth.py',
    text: [
      'from db import get_user',
      'from token import gen_token',
      '',
      'def authenticate(username, password):',
      '    user = get_user(username)',
      '    if not user:',
      '        return None',
      '    if not user.check_password(password):',
      '        raise AuthError("bad creds")',
      '    return gen_token(user)',
    ],
    startLine: 1,
    endLine: 10,
  },
  go: {
    fileName: 'auth.go',
    text: [
      'package auth',
      '',
      'import (',
      '    "errors"',
      '    "example.com/model"',
      ')',
      '',
      'func Authenticate(repo UserRepo, username string, password string) (*Token, error) {',
      '    user, err := repo.FindByUsername(username)',
      '    if err != nil {',
      '        return nil, err',
      '    }',
      '    if !user.VerifyPassword(password) {',
      '        return nil, errors.New("invalid credentials")',
      '    }',
      '    return GenerateToken(user), nil',
      '}',
    ],
    startLine: 1,
    endLine: 17,
  },
  ruby: {
    fileName: 'auth.rb',
    text: [
      'class AuthService',
      '  def initialize(repo, generator)',
      '    @repo = repo',
      '    @generator = generator',
      '  end',
      '',
      '  def authenticate(username, password)',
      '    user = @repo.find_by_username(username)',
      '    raise AuthError unless user&.verify_password(password)',
      '    @generator.generate_token(user)',
      '  end',
      'end',
    ],
    startLine: 1,
    endLine: 12,
  },
};

describe('token estimation integration', () => {
  let graphDb, codebaseDb, tmpDir;

  beforeAll(() => {
    // Create temp dir for on-disk files
    tmpDir = path.join(os.tmpdir(), `token-est-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Write sample files to disk
    for (const [lang, sample] of Object.entries(CODE_SAMPLES)) {
      const filePath = path.join(tmpDir, sample.fileName);
      writeFileSync(filePath, sample.text.join('\n'), 'utf-8');
    }

    // Create graph DB
    graphDb = new Database(':memory:');
    graphDb.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, file_path TEXT NOT NULL, type TEXT NOT NULL,
        name TEXT NOT NULL, signature TEXT, start_line INTEGER, end_line INTEGER,
        stale_since INTEGER DEFAULT NULL
      );
      CREATE TABLE relationships (
        source_id TEXT, target_id TEXT, target_name TEXT NOT NULL,
        type TEXT NOT NULL, weight REAL DEFAULT 1.0
      );
    `);

    const ie = graphDb.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const ir = graphDb.prepare('INSERT INTO relationships VALUES (?, ?, ?, ?, ?)');

    // Java entity (seed)
    ie.run('java-auth', path.join(tmpDir, 'AuthService.java'), 'class', 'AuthService',
      'class AuthService implements IAuthService', 1, 27, null);
    // Python entity (1-hop)
    ie.run('py-auth', path.join(tmpDir, 'auth.py'), 'function', 'authenticate',
      'def authenticate(username, password)', 1, 10, null);
    // Go entity (1-hop)
    ie.run('go-auth', path.join(tmpDir, 'auth.go'), 'function', 'Authenticate',
      'func Authenticate(...)', 1, 17, null);
    // Ruby entity (2-hop from Python)
    ie.run('rb-auth', path.join(tmpDir, 'auth.rb'), 'class', 'AuthService',
      'class AuthService', 1, 12, null);

    // Relationships
    ir.run('java-auth', 'py-auth', 'authenticate', 'calls', 1.0);
    ir.run('java-auth', 'go-auth', 'Authenticate', 'imports', 1.0);
    ir.run('py-auth', 'rb-auth', 'AuthService', 'extends', 1.5);

    // Create codebase DB with vector texts
    codebaseDb = new Database(':memory:');
    codebaseDb.exec(`
      CREATE TABLE vectors (id TEXT PRIMARY KEY, text TEXT, embedding BLOB, metadata TEXT);
    `);
    codebaseDb.prepare('INSERT INTO vectors (id, text) VALUES (?, ?)').run(
      'java-auth', CODE_SAMPLES.java.text.join('\n')
    );
  });

  afterAll(() => {
    graphDb.close();
    codebaseDb.close();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Integration: Full pipeline with real data
  // =========================================================================

  describe('full pipeline: expandResults with accurate tokens', () => {
    it('produces different budget stats than flat ×10 heuristic', () => {
      const readFileLines = (filePath, startLine, endLine) => {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          return lines.slice((startLine || 1) - 1, endLine || startLine).join('\n');
        } catch {
          return null;
        }
      };

      const results = [{
        id: 'java-auth',
        score: 10,
        file_path: path.join(tmpDir, 'AuthService.java'),
        start_line: 1,
        end_line: 27,
      }];

      // With codebaseDb + readFileLines (accurate)
      const accurate = expandResults(graphDb, results, {
        expandMode: '1hop',
        tokenBudget: 100000,
        codebaseDb,
        readFileLines,
      });

      // Without (fallback to language multipliers)
      const fallback = expandResults(graphDb, results, {
        expandMode: '1hop',
        tokenBudget: 100000,
      });

      const accStats = accurate._budgetStats;
      const fbStats = fallback._budgetStats;

      // Both should have results
      expect(accurate.length).toBeGreaterThan(1);
      expect(fallback.length).toBeGreaterThan(1);

      // The original (seed) token counts should differ:
      // - Accurate: word-split of actual Java text
      // - Fallback: 27 lines × 15 (Java) = 405
      expect(accStats.original.tokens).not.toBe(fbStats.original.tokens);

      // Fallback for Java should be 27 × 15 = 405
      expect(fbStats.original.tokens).toBe(405);

      // Accurate count is based on word-split of real text (should be different from 405)
      expect(accStats.original.tokens).toBeGreaterThan(0);
    });

    it('readFileLines provides text for expanded entities', () => {
      const readFileLines = (filePath, startLine, endLine) => {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          return lines.slice((startLine || 1) - 1, endLine || startLine).join('\n');
        } catch {
          return null;
        }
      };

      const results = [{
        id: 'java-auth',
        score: 10,
        file_path: path.join(tmpDir, 'AuthService.java'),
        start_line: 1,
        end_line: 27,
      }];

      const expanded = expandResults(graphDb, results, {
        expandMode: '1hop',
        tokenBudget: 100000,
        codebaseDb,
        readFileLines,
      });

      const stats = expanded._budgetStats;

      // Hop1 results (Python + Go) should have token counts from file reads
      expect(stats.hop1.count).toBeGreaterThan(0);
      expect(stats.hop1.tokens).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Integration: Budget cutoff with mixed languages
  // =========================================================================

  describe('budget cutoff with mixed-language results', () => {
    it('Java is more expensive per line than Python (language-aware)', () => {
      // Same line count, different languages
      const javaResult = {
        id: 'j', file_path: 'src/Foo.java', start_line: 1, end_line: 10, score: 1,
      };
      const pyResult = {
        id: 'p', file_path: 'src/bar.py', start_line: 1, end_line: 10, score: 0.9,
      };

      const { stats } = applyTokenBudget([javaResult, pyResult], 100000);

      // Java: 150, Python: 80 → Java costs 87.5% more per line
      const javaTokens = 150;
      const pyTokens = 80;
      expect(stats.total.tokens).toBe(javaTokens + pyTokens);
    });

    it('tight budget excludes verbose Java but keeps concise Python', () => {
      // Budget = 160: Python (80) fits, Java (150) only as first result
      const pyResult = {
        id: 'p', file_path: 'src/bar.py', start_line: 1, end_line: 10, score: 1,
      };
      const javaResult = {
        id: 'j', file_path: 'src/Foo.java', start_line: 1, end_line: 10, score: 0.9,
      };

      const { results: budgeted } = applyTokenBudget([pyResult, javaResult], 160);

      // Python (80) fits, then Java (150) would push to 230 > 160 → excluded
      expect(budgeted.length).toBe(1);
      expect(budgeted[0].id).toBe('p');
    });

    it('under old flat ×10, both would fit in budget 210', () => {
      // Under old heuristic: both 10 lines × 10 = 100 each, total 200 ≤ 210
      // Under new: Java 150 + Python 80 = 230 > 210
      const javaResult = {
        id: 'j', file_path: 'src/Foo.java', start_line: 1, end_line: 10, score: 1,
      };
      const pyResult = {
        id: 'p', file_path: 'src/bar.py', start_line: 1, end_line: 10, score: 0.9,
      };

      const { results: budgeted } = applyTokenBudget([javaResult, pyResult], 210);

      // Java (150) first, then Python (150+80=230>210) → only Java
      expect(budgeted.length).toBe(1);
      expect(budgeted[0].id).toBe('j');
    });
  });

  // =========================================================================
  // Integration: loadChunkTexts with realistic data
  // =========================================================================

  describe('loadChunkTexts with realistic codebase.db', () => {
    it('returns full text for indexed chunks', () => {
      const texts = loadChunkTexts(codebaseDb, ['java-auth']);
      expect(texts.size).toBe(1);
      expect(texts.get('java-auth')).toContain('public class AuthService');
      expect(texts.get('java-auth')).toContain('Optional<AuthToken>');
    });

    it('batch query handles mix of present and absent IDs', () => {
      const texts = loadChunkTexts(codebaseDb, ['java-auth', 'nonexistent-id', 'also-missing']);
      expect(texts.size).toBe(1);
      expect(texts.has('java-auth')).toBe(true);
      expect(texts.has('nonexistent-id')).toBe(false);
    });
  });

  // =========================================================================
  // Integration: computeTokenEstimates with real file reads
  // =========================================================================

  describe('computeTokenEstimates with real files', () => {
    it('reads actual file contents for expanded results', () => {
      const pyPath = path.join(tmpDir, 'auth.py');
      const readFileLines = (filePath, startLine, endLine) => {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          return lines.slice((startLine || 1) - 1, endLine || startLine).join('\n');
        } catch {
          return null;
        }
      };

      const results = [
        { id: 'java-auth', score: 1, file_path: path.join(tmpDir, 'AuthService.java'), start_line: 1, end_line: 27 },
        { is_expanded: true, file_path: pyPath, start_line: 1, end_line: 10, score: 0.5 },
      ];

      const estimates = computeTokenEstimates(results, { codebaseDb, readFileLines });

      // Original (java-auth) from DB
      expect(estimates.has(0)).toBe(true);
      const javaTokens = estimates.get(0);
      expect(javaTokens).toBeGreaterThan(20); // Real Java class has many words

      // Expanded (Python) from file
      expect(estimates.has(1)).toBe(true);
      const pyTokens = estimates.get(1);
      expect(pyTokens).toBeGreaterThan(5);
      expect(pyTokens).toBeLessThan(javaTokens); // Python is more concise
    });
  });

  // =========================================================================
  // Integration: 2-hop expansion with accurate tokens
  // =========================================================================

  describe('2-hop expansion with accurate token estimation', () => {
    it('2-hop budget respects accurate token counts from files', () => {
      const readFileLines = (filePath, startLine, endLine) => {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          return lines.slice((startLine || 1) - 1, endLine || startLine).join('\n');
        } catch {
          return null;
        }
      };

      const results = [{
        id: 'java-auth',
        score: 10,
        file_path: path.join(tmpDir, 'AuthService.java'),
        start_line: 1,
        end_line: 27,
      }];

      const expanded = expandResults(graphDb, results, {
        expandMode: '2hop',
        adaptiveHop2: true,
        hop2TokenBudget: 100000,
        tokenBudget: 100000,
        codebaseDb,
        readFileLines,
      });

      // Should include seed + 1-hop (Python, Go) + potentially 2-hop (Ruby)
      expect(expanded.length).toBeGreaterThanOrEqual(3);

      const stats = expanded._budgetStats;
      expect(stats.original.count).toBe(1);
      expect(stats.hop1.count).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Integration: Backward compatibility
  // =========================================================================

  describe('backward compatibility', () => {
    it('existing tests calling applyTokenBudget without codebaseDb still work', () => {
      // This mimics what adaptive-expansion.test.js does
      const results = [
        { id: 'orig1', score: 10, start_line: 1, end_line: 50, file_path: 'src/a.js' },
        { id: 'exp1', score: 5, start_line: 1, end_line: 20, is_expanded: true, expansion: {}, file_path: 'src/b.js' },
      ];

      // No codebaseDb/readFileLines → uses language fallback
      const { results: budgeted, stats } = applyTokenBudget(results, 100000);

      expect(budgeted.length).toBe(2);
      // JS: 50 lines × 10 = 500, 20 lines × 10 = 200
      expect(stats.original.tokens).toBe(500);
      expect(stats.hop1.tokens).toBe(200);
    });

    it('expandResults without codebaseDb matches fallback behavior', () => {
      const results = [{ id: 'java-auth', score: 10, file_path: path.join(tmpDir, 'AuthService.java'), start_line: 1, end_line: 27 }];

      const expanded = expandResults(graphDb, results, {
        expandMode: '1hop',
        tokenBudget: 100000,
        // No codebaseDb, no readFileLines
      });

      const stats = expanded._budgetStats;

      // Java fallback: 27 lines × 15 = 405
      expect(stats.original.tokens).toBe(405);
    });
  });

  // =========================================================================
  // Integration: Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('result with no file extension falls back to default 10/line', () => {
      const results = [{ id: 'x', file_path: 'Makefile', start_line: 1, end_line: 10, score: 1 }];
      const { stats } = applyTokenBudget(results, 100000);
      expect(stats.original.tokens).toBe(100); // 10 × 10 (default)
    });

    it('result with no line range gets 1 token minimum', () => {
      const results = [{ id: 'x', file_path: 'src/x.js', score: 1 }];
      const { stats } = applyTokenBudget(results, 100000);
      // start_line=0, end_line=0 → max(1, 1) × 10 = 10
      expect(stats.original.tokens).toBe(10);
    });

    it('readFileLines returning null falls back to language multiplier', () => {
      const readFileLines = vi.fn().mockReturnValue(null);
      const results = [
        { is_expanded: true, file_path: 'src/Missing.java', start_line: 1, end_line: 10, score: 0.5, expansion: {} },
      ];

      const { stats } = applyTokenBudget(results, 100000, { readFileLines });

      // null from readFileLines → fallback to Java 15/line × 10 = 150
      expect(stats.hop1.tokens).toBe(150);
    });

    it('codebaseDb missing vector ID falls back to language multiplier', () => {
      const results = [
        { id: 'nonexistent', file_path: 'src/Foo.java', start_line: 1, end_line: 10, score: 1 },
      ];

      const { stats } = applyTokenBudget(results, 100000, { codebaseDb });

      // ID not in vectors table → fallback to Java 15/line × 10 = 150
      expect(stats.original.tokens).toBe(150);
    });
  });
});
