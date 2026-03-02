import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import {
  applyTokenBudget,
  loadChunkTexts,
  computeTokenEstimates,
  expandResults,
} from '../core/graph-expansion.js';

// =========================================================================
// 1. estimateTokenCount (internal, tested via computeTokenEstimates)
// =========================================================================

describe('estimateTokenCount (via computeTokenEstimates)', () => {
  it('empty/whitespace text → 0 tokens', () => {
    const readFileLines = vi.fn().mockReturnValue('');
    const results = [{ is_expanded: true, file_path: 'x.js', start_line: 1, end_line: 1 }];
    const estimates = computeTokenEstimates(results, { readFileLines });
    // Empty string splits to no tokens → not set in map (fallback used instead)
    expect(estimates.has(0)).toBe(false);
  });

  it('single word → 1 token', () => {
    const readFileLines = vi.fn().mockReturnValue('return');
    const results = [{ is_expanded: true, file_path: 'x.js', start_line: 1, end_line: 1 }];
    const estimates = computeTokenEstimates(results, { readFileLines });
    expect(estimates.get(0)).toBe(1);
  });

  it('multi-word code → correct word count', () => {
    const code = 'const x = foo(bar, baz);';
    const readFileLines = vi.fn().mockReturnValue(code);
    const results = [{ is_expanded: true, file_path: 'x.js', start_line: 1, end_line: 1 }];
    const estimates = computeTokenEstimates(results, { readFileLines });
    // 'const' 'x' '=' 'foo(bar,' 'baz);' → 5 words
    expect(estimates.get(0)).toBe(5);
  });

  it('multi-line code block → correct count', () => {
    const code = 'function add(a, b) {\n  return a + b;\n}';
    const readFileLines = vi.fn().mockReturnValue(code);
    const results = [{ is_expanded: true, file_path: 'x.js', start_line: 1, end_line: 3 }];
    const estimates = computeTokenEstimates(results, { readFileLines });
    // 'function' 'add(a,' 'b)' '{' 'return' 'a' '+' 'b;' '}' → 9
    expect(estimates.get(0)).toBe(9);
  });

  it('whitespace-only text → 0 tokens (applyTokenBudget treats as fallback)', () => {
    const readFileLines = vi.fn().mockReturnValue('   \n  \t  \n  ');
    const results = [{ is_expanded: true, file_path: 'x.js', start_line: 1, end_line: 3 }];
    const estimates = computeTokenEstimates(results, { readFileLines });
    // Text is truthy so it's in the map, but word count is 0
    expect(estimates.get(0)).toBe(0);
    // In applyTokenBudget, `0 || fallback` correctly uses language multiplier
  });
});

// =========================================================================
// 2. loadChunkTexts
// =========================================================================

describe('loadChunkTexts', () => {
  let db;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE vectors (id TEXT PRIMARY KEY, text TEXT, embedding BLOB, metadata TEXT);
      INSERT INTO vectors (id, text) VALUES ('v1', 'function hello() { return "hi"; }');
      INSERT INTO vectors (id, text) VALUES ('v2', 'class Foo extends Bar { constructor() { super(); } }');
      INSERT INTO vectors (id, text) VALUES ('v3', 'import os\ndef main():\n    print("hello")');
    `);
  });

  afterAll(() => db.close());

  it('returns Map with correct texts for known IDs', () => {
    const result = loadChunkTexts(db, ['v1', 'v2', 'v3']);
    expect(result.size).toBe(3);
    expect(result.get('v1')).toContain('function hello');
    expect(result.get('v2')).toContain('class Foo');
    expect(result.get('v3')).toContain('import os');
  });

  it('missing IDs → not in Map', () => {
    const result = loadChunkTexts(db, ['v1', 'missing']);
    expect(result.size).toBe(1);
    expect(result.has('v1')).toBe(true);
    expect(result.has('missing')).toBe(false);
  });

  it('null DB → empty Map', () => {
    const result = loadChunkTexts(null, ['v1']);
    expect(result.size).toBe(0);
  });

  it('empty IDs → empty Map', () => {
    const result = loadChunkTexts(db, []);
    expect(result.size).toBe(0);
  });

  it('DB error (no vectors table) → empty Map', () => {
    const badDb = new Database(':memory:');
    // No vectors table
    const result = loadChunkTexts(badDb, ['v1']);
    expect(result.size).toBe(0);
    badDb.close();
  });
});

// =========================================================================
// 3. computeTokenEstimates
// =========================================================================

describe('computeTokenEstimates', () => {
  let codebaseDb;

  beforeAll(() => {
    codebaseDb = new Database(':memory:');
    codebaseDb.exec(`
      CREATE TABLE vectors (id TEXT PRIMARY KEY, text TEXT, embedding BLOB, metadata TEXT);
      INSERT INTO vectors (id, text) VALUES ('orig1', 'public class AuthService implements IAuth { private final DB db; public AuthService(DB db) { this.db = db; } }');
      INSERT INTO vectors (id, text) VALUES ('orig2', 'def process(data):\n    result = transform(data)\n    return result');
    `);
  });

  afterAll(() => codebaseDb.close());

  it('original results use codebaseDb text', () => {
    const results = [
      { id: 'orig1', score: 1, start_line: 1, end_line: 5 },
      { id: 'orig2', score: 0.8, start_line: 1, end_line: 3 },
    ];
    const estimates = computeTokenEstimates(results, { codebaseDb });
    expect(estimates.has(0)).toBe(true);
    expect(estimates.has(1)).toBe(true);
    // orig1 is a long Java line — word-split gives reasonable count
    expect(estimates.get(0)).toBeGreaterThan(5);
    // orig2 is 3 lines of Python
    expect(estimates.get(1)).toBeGreaterThan(3);
  });

  it('expanded results use readFileLines callback', () => {
    const readFileLines = vi.fn((fp, s, e) => {
      if (fp === 'src/a.java') return 'public void foo() {\n  bar();\n}';
      return null;
    });

    const results = [
      { id: 'orig1', score: 1 },
      { is_expanded: true, file_path: 'src/a.java', start_line: 10, end_line: 12, score: 0.5 },
      { is_expanded: true, file_path: 'src/missing.js', start_line: 1, end_line: 5, score: 0.3 },
    ];

    const estimates = computeTokenEstimates(results, { codebaseDb, readFileLines });

    // orig1 found in DB
    expect(estimates.has(0)).toBe(true);
    // expanded with file found
    expect(estimates.has(1)).toBe(true);
    expect(readFileLines).toHaveBeenCalledWith('src/a.java', 10, 12);
    // expanded with missing file → readFileLines returns null → not in map
    expect(estimates.has(2)).toBe(false);
  });

  it('no codebaseDb → empty for originals', () => {
    const results = [
      { id: 'orig1', score: 1 },
    ];
    const estimates = computeTokenEstimates(results, {});
    expect(estimates.has(0)).toBe(false);
  });

  it('no readFileLines → empty for expanded', () => {
    const results = [
      { is_expanded: true, file_path: 'src/a.js', start_line: 1, end_line: 5, score: 0.5 },
    ];
    const estimates = computeTokenEstimates(results, { codebaseDb });
    expect(estimates.has(0)).toBe(false);
  });
});

// =========================================================================
// 4. fallbackTokenEstimate (tested via applyTokenBudget without codebaseDb)
// =========================================================================

describe('fallbackTokenEstimate (via applyTokenBudget)', () => {
  it('Java file (.java) → 15 tokens/line', () => {
    const results = [{ id: 'x', file_path: 'src/Foo.java', start_line: 1, end_line: 10, score: 1 }];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(150); // 10 lines × 15
  });

  it('Python file (.py) → 8 tokens/line', () => {
    const results = [{ id: 'x', file_path: 'src/main.py', start_line: 1, end_line: 10, score: 1 }];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(80); // 10 lines × 8
  });

  it('Go file (.go) → 12 tokens/line', () => {
    const results = [{ id: 'x', file_path: 'src/main.go', start_line: 1, end_line: 10, score: 1 }];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(120); // 10 lines × 12
  });

  it('TypeScript file (.ts) → 10 tokens/line', () => {
    const results = [{ id: 'x', file_path: 'src/app.ts', start_line: 1, end_line: 10, score: 1 }];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(100); // 10 lines × 10
  });

  it('unknown extension → 10 tokens/line (default)', () => {
    const results = [{ id: 'x', file_path: 'src/data.xyz', start_line: 1, end_line: 10, score: 1 }];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(100); // 10 lines × 10
  });

  it('metadata.language takes precedence over extension', () => {
    const results = [{
      id: 'x', file_path: 'src/Foo.txt', start_line: 1, end_line: 10, score: 1,
      metadata: { language: 'java' },
    }];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(150); // metadata says java → 15/line
  });

  it('Ruby file (.rb) → 9 tokens/line', () => {
    const results = [{ id: 'x', file_path: 'src/app.rb', start_line: 1, end_line: 10, score: 1 }];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(90); // 10 lines × 9
  });

  it('Kotlin (.kt) → 14 tokens/line via EXT_TO_LANG', () => {
    const results = [{ id: 'x', file_path: 'src/App.kt', start_line: 1, end_line: 10, score: 1 }];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(140); // 10 lines × 14
  });

  it('C++ (.cc) → 12 tokens/line via EXT_TO_LANG', () => {
    const results = [{ id: 'x', file_path: 'src/main.cc', start_line: 1, end_line: 10, score: 1 }];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(120); // 10 lines × 12
  });
});

// =========================================================================
// 5. applyTokenBudget with accurate token estimates
// =========================================================================

describe('applyTokenBudget with token estimates', () => {
  let codebaseDb;

  beforeAll(() => {
    codebaseDb = new Database(':memory:');
    codebaseDb.exec(`
      CREATE TABLE vectors (id TEXT PRIMARY KEY, text TEXT, embedding BLOB, metadata TEXT);
    `);
    // Java chunk: many tokens (verbose)
    const javaText = 'public class AuthenticationServiceImpl implements IAuthenticationService { '
      + 'private final DatabaseConnection databaseConnection; '
      + 'private final TokenGenerator tokenGenerator; '
      + 'public AuthenticationServiceImpl(DatabaseConnection db, TokenGenerator tg) { '
      + 'this.databaseConnection = db; this.tokenGenerator = tg; } '
      + 'public AuthToken authenticate(String username, String password) { '
      + 'User user = databaseConnection.findUser(username); '
      + 'if (user == null) { throw new AuthenticationException("User not found"); } '
      + 'if (!user.checkPassword(password)) { throw new AuthenticationException("Invalid password"); } '
      + 'return tokenGenerator.generateToken(user); } }';
    codebaseDb.prepare('INSERT INTO vectors (id, text) VALUES (?, ?)').run('java1', javaText);

    // Python chunk: fewer tokens (concise)
    const pythonText = 'def auth(u, p):\n    user = db.find(u)\n    if not user:\n        raise Error("nope")\n    return token(user)';
    codebaseDb.prepare('INSERT INTO vectors (id, text) VALUES (?, ?)').run('python1', pythonText);
  });

  afterAll(() => codebaseDb.close());

  it('Java chunk consumes more budget than Python chunk with same line count', () => {
    // Both have 10 lines — without fix, both would be 100 tokens (10 lines × 10)
    const results = [
      { id: 'java1', score: 1, file_path: 'Foo.java', start_line: 1, end_line: 10 },
      { id: 'python1', score: 0.9, file_path: 'bar.py', start_line: 1, end_line: 10 },
    ];
    const { stats } = applyTokenBudget(results, 100000, { codebaseDb });

    // With accurate estimates from DB text, Java chunk should use more tokens
    // than the Python chunk, even though both span 10 lines
    // Java text has ~40+ words, Python ~15 words
    // Total should NOT be 200 (the old flat ×10 result)
    expect(stats.total.tokens).not.toBe(200);
  });

  it('budget cutoff differs with accurate estimates vs flat heuristic', () => {
    // Set a tight budget that would include both under flat ×10 (200 tokens)
    // but should exclude the verbose Java chunk under accurate estimates
    const results = [
      { id: 'java1', score: 1, file_path: 'Foo.java', start_line: 1, end_line: 10 },
      { id: 'python1', score: 0.9, file_path: 'bar.py', start_line: 1, end_line: 10 },
    ];

    // Get accurate token counts to set a budget between them
    const withAccurate = applyTokenBudget(results, 100000, { codebaseDb });
    const javaTokens = withAccurate.stats.original.tokens - applyTokenBudget(
      [results[1]], 100000, { codebaseDb }
    ).stats.original.tokens;

    // Budget enough for Python but not Python+Java
    const tightBudget = javaTokens - 1; // just below Java alone
    const { results: budgeted } = applyTokenBudget(results, tightBudget, { codebaseDb });

    // With tight budget, only Java (first result, always included) fits
    expect(budgeted.length).toBe(1);
  });
});

// =========================================================================
// 6. applyTokenBudget without codebaseDb uses language fallback (not flat ×10)
// =========================================================================

describe('applyTokenBudget without codebaseDb', () => {
  it('uses language-specific multipliers, not flat ×10', () => {
    const javaResult = { id: 'j', file_path: 'src/Foo.java', start_line: 1, end_line: 10, score: 1 };
    const pyResult = { id: 'p', file_path: 'src/bar.py', start_line: 1, end_line: 10, score: 0.9 };

    const { stats } = applyTokenBudget([javaResult, pyResult], 100000);

    // Java: 10 lines × 15 = 150, Python: 10 lines × 8 = 80
    // Under old flat ×10: both would be 100, total 200
    expect(stats.total.tokens).toBe(230); // 150 + 80
    expect(stats.original.tokens).toBe(230);
  });

  it('Java result shows ~15/line in stats, not 10/line', () => {
    const results = [
      { id: 'j', file_path: 'src/Foo.java', start_line: 1, end_line: 10, score: 1 },
    ];
    const { stats } = applyTokenBudget(results, 100000);
    expect(stats.original.tokens).toBe(150); // 15 × 10 lines
  });
});

// =========================================================================
// 7. applyTokenBudget stats accuracy
// =========================================================================

describe('applyTokenBudget stats with mixed categories', () => {
  it('stats reflect per-category accurate counts', () => {
    const readFileLines = vi.fn()
      .mockReturnValueOnce('public interface IService { void process(); }') // expanded hop1
      .mockReturnValueOnce('class Base {\n  int x;\n}'); // expanded hop2

    const results = [
      { id: 'orig', score: 1, file_path: 'src/Foo.java', start_line: 1, end_line: 10 },
      { id: 'h1', score: 0.5, file_path: 'src/IService.java', start_line: 1, end_line: 5,
        is_expanded: true, expansion: {} },
      { id: 'h2', score: 0.3, file_path: 'src/Base.java', start_line: 1, end_line: 3,
        is_expanded: true, expansion: { hops: 2 } },
    ];

    const { stats } = applyTokenBudget(results, 100000, { readFileLines });

    // orig: fallback (Java 15/line × 10 lines = 150)
    expect(stats.original.count).toBe(1);
    expect(stats.original.tokens).toBe(150);

    // hop1: readFileLines returns text → word count
    expect(stats.hop1.count).toBe(1);
    expect(stats.hop1.tokens).toBeGreaterThan(0);

    // hop2: readFileLines returns text → word count
    expect(stats.hop2.count).toBe(1);
    expect(stats.hop2.tokens).toBeGreaterThan(0);

    expect(stats.total.count).toBe(3);
    expect(stats.total.tokens).toBe(stats.original.tokens + stats.hop1.tokens + stats.hop2.tokens);
  });
});

// =========================================================================
// 8. expandResults threading
// =========================================================================

describe('expandResults threads codebaseDb and readFileLines', () => {
  let graphDb, codebaseDb;

  beforeAll(() => {
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

    ie.run('seed', 'src/seed.py', 'class', 'Seed', 'class Seed', 1, 20, null);
    ie.run('dep', 'src/dep.py', 'class', 'Dep', 'class Dep', 1, 15, null);
    ir.run('seed', 'dep', 'Dep', 'imports', 1.0);

    codebaseDb = new Database(':memory:');
    codebaseDb.exec(`
      CREATE TABLE vectors (id TEXT PRIMARY KEY, text TEXT, embedding BLOB, metadata TEXT);
      INSERT INTO vectors (id, text) VALUES ('seed', 'class Seed:\n    def __init__(self):\n        self.x = 1');
    `);
  });

  afterAll(() => {
    graphDb.close();
    codebaseDb.close();
  });

  it('budget stats differ from flat ×10 when codebaseDb provided', () => {
    const readFileLines = vi.fn((fp, s, e) => {
      if (fp === 'src/dep.py') return 'class Dep:\n    pass';
      return null;
    });

    const results = [{ id: 'seed', score: 10, file_path: 'src/seed.py', start_line: 1, end_line: 20 }];

    const expanded = expandResults(graphDb, results, {
      expandMode: '1hop',
      tokenBudget: 100000,
      codebaseDb,
      readFileLines,
    });

    const stats = expanded._budgetStats;
    expect(stats).toBeDefined();

    // seed: 20 lines, old flat = 200, but with codebaseDb text 'class Seed...' → ~8 words
    // So original tokens should NOT be 200
    expect(stats.original.tokens).not.toBe(200);
    expect(stats.original.tokens).toBeGreaterThan(0);

    // dep: expanded, readFileLines returns 'class Dep:\n    pass' → ~3 words
    expect(stats.hop1.tokens).toBeGreaterThan(0);
    // Old flat would be 150 (15 lines × 10)
    expect(stats.hop1.tokens).not.toBe(150);
  });

  it('without codebaseDb, falls back to language-specific multipliers', () => {
    const results = [{ id: 'seed', score: 10, file_path: 'src/seed.py', start_line: 1, end_line: 20 }];

    const expanded = expandResults(graphDb, results, {
      expandMode: '1hop',
      tokenBudget: 100000,
      // no codebaseDb, no readFileLines
    });

    const stats = expanded._budgetStats;
    // Python: 20 lines × 8 = 160 (not the old 200)
    expect(stats.original.tokens).toBe(160);
  });
});
