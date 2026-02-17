/**
 * Tests for P0.2 — Contextualized Embedding Text Generation.
 *
 * Verifies that AST chunker, document chunker, and the indexer pipeline
 * produce and consume the `embedding_text` field correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ASTChunker } from '../ast-chunker.js';
import { buildDocChunk } from '../core/chunking/chunk-builder.js';

// ---------------------------------------------------------------------------
// ASTChunker.buildChunk — embedding_text field
// ---------------------------------------------------------------------------

describe('ASTChunker.buildChunk embedding_text', () => {
  let chunker;

  beforeEach(() => {
    chunker = new ASTChunker({ projectRoot: '/project' });
  });

  it('includes embedding_text field in chunk output', () => {
    const chunk = chunker.buildChunk(
      'function hello() {}', '/project/src/index.js',
      'javascript', 'function', 'hello', 0, 0
    );
    expect(chunk).toHaveProperty('embedding_text');
    expect(typeof chunk.embedding_text).toBe('string');
  });

  it('embedding_text includes relative file path', () => {
    const chunk = chunker.buildChunk(
      'function hello() {}', '/project/src/utils.js',
      'javascript', 'function', 'hello', 0, 0
    );
    expect(chunk.embedding_text).toContain('src/utils.js');
  });

  it('embedding_text includes symbol name when available', () => {
    const chunk = chunker.buildChunk(
      'class UserService {}', '/project/src/service.js',
      'javascript', 'class', 'UserService', 0, 0
    );
    expect(chunk.embedding_text).toContain('UserService');
    expect(chunk.embedding_text).toContain('class');
  });

  it('embedding_text omits symbol line when symbol is unknown', () => {
    const chunk = chunker.buildChunk(
      'some code', '/project/src/misc.js',
      'javascript', 'code', 'unknown', 0, 0
    );
    // Should have the path header but NOT a "code: unknown" line
    expect(chunk.embedding_text).toContain('src/misc.js');
    expect(chunk.embedding_text).not.toContain('code: unknown');
  });

  it('embedding_text includes language', () => {
    const chunk = chunker.buildChunk(
      'def foo(): pass', '/project/src/main.py',
      'python', 'function', 'foo', 0, 0
    );
    expect(chunk.embedding_text).toContain('# Language: python');
  });

  it('embedding_text omits language line for text', () => {
    const chunk = chunker.buildChunk(
      'generic content here plus more', '/project/data/notes.txt',
      'text', 'code', 'unknown', 0, 0
    );
    expect(chunk.embedding_text).not.toContain('# Language: text');
  });

  it('embedding_text preserves full code content', () => {
    const code = 'function add(a, b) {\n  return a + b;\n}';
    const chunk = chunker.buildChunk(
      code, '/project/src/math.js',
      'javascript', 'function', 'add', 0, 2
    );
    expect(chunk.embedding_text).toContain(code.trim());
  });

  it('content and text fields remain unchanged', () => {
    const code = '  function hello() {}  ';
    const chunk = chunker.buildChunk(
      code, '/project/src/index.js',
      'javascript', 'function', 'hello', 0, 0
    );
    // text and content should be trimmed code only
    expect(chunk.text).toBe(code.trim());
    expect(chunk.content).toBe(code.trim());
    // embedding_text should be longer (has headers)
    expect(chunk.embedding_text.length).toBeGreaterThan(chunk.text.length);
  });

  it('embedding_text is capped at 2000 characters', () => {
    const longCode = 'x'.repeat(3000);
    const chunk = chunker.buildChunk(
      longCode, '/project/src/big.js',
      'javascript', 'function', 'bigFn', 0, 0
    );
    expect(chunk.embedding_text.length).toBeLessThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// ASTChunker.enrichEmbeddingText — scope and import enrichment
// ---------------------------------------------------------------------------

describe('ASTChunker.enrichEmbeddingText', () => {
  let chunker;

  beforeEach(() => {
    chunker = new ASTChunker({ projectRoot: '/project' });
  });

  it('adds scope chain to embedding_text', () => {
    const chunk = chunker.buildChunk(
      'this.name = name;', '/project/src/user.js',
      'javascript', 'method', 'constructor', 0, 0
    );
    ASTChunker.enrichEmbeddingText(chunk, ['UserService', 'constructor'], null);
    expect(chunk.embedding_text).toContain('# Scope: UserService > constructor');
  });

  it('adds imports to embedding_text', () => {
    const chunk = chunker.buildChunk(
      'const db = new Database();', '/project/src/repo.js',
      'javascript', 'function', 'init', 0, 0
    );
    ASTChunker.enrichEmbeddingText(chunk, null, ['Database', 'Logger', 'Config']);
    expect(chunk.embedding_text).toContain('# Uses: Database, Logger, Config');
  });

  it('limits imports to 5 entries', () => {
    const chunk = chunker.buildChunk(
      'code', '/project/src/a.js',
      'javascript', 'function', 'fn', 0, 0
    );
    const manyImports = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    ASTChunker.enrichEmbeddingText(chunk, null, manyImports);
    expect(chunk.embedding_text).toContain('# Uses: A, B, C, D, E');
    expect(chunk.embedding_text).not.toContain('F');
  });

  it('includes Defines line with chunk_type and symbol', () => {
    const chunk = chunker.buildChunk(
      'class Foo {}', '/project/src/foo.js',
      'javascript', 'class', 'Foo', 0, 0
    );
    ASTChunker.enrichEmbeddingText(chunk, ['Module'], ['Bar']);
    expect(chunk.embedding_text).toContain('# Defines: class Foo');
  });

  it('does not mutate content or text fields', () => {
    const code = 'const x = 1;';
    const chunk = chunker.buildChunk(
      code, '/project/src/x.js',
      'javascript', 'variable', 'x', 0, 0
    );
    const originalText = chunk.text;
    const originalContent = chunk.content;
    ASTChunker.enrichEmbeddingText(chunk, ['Module'], ['y']);
    expect(chunk.text).toBe(originalText);
    expect(chunk.content).toBe(originalContent);
  });

  it('returns the mutated chunk for chaining', () => {
    const chunk = chunker.buildChunk(
      'code here', '/project/src/c.js',
      'javascript', 'function', 'fn', 0, 0
    );
    const result = ASTChunker.enrichEmbeddingText(chunk, [], []);
    expect(result).toBe(chunk);
  });
});

// ---------------------------------------------------------------------------
// buildDocChunk — document chunker embedding_text
// ---------------------------------------------------------------------------

describe('buildDocChunk embedding_text', () => {
  it('includes embedding_text field', () => {
    const chunk = buildDocChunk(
      'Some documentation text here.', '/project/docs/guide.md',
      'markdown', 'section', 'Introduction', 0, 5, '/project'
    );
    expect(chunk).toHaveProperty('embedding_text');
    expect(typeof chunk.embedding_text).toBe('string');
  });

  it('embedding_text includes relative file path', () => {
    const chunk = buildDocChunk(
      'Content here for the test.', '/project/docs/api.md',
      'markdown', 'section', 'API Reference', 0, 10, '/project'
    );
    expect(chunk.embedding_text).toContain('docs/api.md');
  });

  it('embedding_text includes section symbol', () => {
    const chunk = buildDocChunk(
      'Details about authentication.', '/project/docs/auth.md',
      'markdown', 'section', 'Authentication', 0, 5, '/project'
    );
    expect(chunk.embedding_text).toContain('Authentication');
  });

  it('content and text remain unchanged in doc chunks', () => {
    const content = '  Hello world  ';
    const chunk = buildDocChunk(
      content, '/project/docs/readme.md',
      'markdown', 'section', 'Intro', 0, 1, '/project'
    );
    expect(chunk.text).toBe(content.trim());
    expect(chunk.content).toBe(content.trim());
  });

  it('embedding_text is capped at 2000 characters', () => {
    const longText = 'word '.repeat(600);
    const chunk = buildDocChunk(
      longText, '/project/docs/big.md',
      'markdown', 'section', 'Big', 0, 100, '/project'
    );
    expect(chunk.embedding_text.length).toBeLessThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// Integration: parseFile produces chunks with embedding_text
// ---------------------------------------------------------------------------

describe('parseFile integration — embedding_text', () => {
  it('JavaScript file chunks include embedding_text', async () => {
    const chunker = new ASTChunker({ projectRoot: '/project' });
    const code = `function greet(name) {
  console.log("Hello " + name);
}

function farewell(name) {
  console.log("Bye " + name);
}`;
    const chunks = await chunker.parseFile('/project/src/greet.js', code);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk).toHaveProperty('embedding_text');
      expect(chunk.embedding_text).toContain('src/greet.js');
    }
  });

  it('Python file chunks include embedding_text', async () => {
    const chunker = new ASTChunker({ projectRoot: '/project' });
    const code = `class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b`;
    const chunks = await chunker.parseFile('/project/src/calc.py', code);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk).toHaveProperty('embedding_text');
      expect(chunk.embedding_text).toContain('# Language: python');
    }
  });
});
