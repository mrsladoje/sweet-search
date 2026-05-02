import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mockState = vi.hoisted(() => ({
  rows: [],
}));

vi.mock('../../core/infrastructure/codebase-repository.js', () => ({
  CodebaseRepository: class {
    getChunksByFilePath(filePath) {
      return mockState.rows.filter(r => r.file_path === filePath);
    }
  },
}));

vi.mock('../../core/infrastructure/config/index.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    DB_PATHS: { ...(actual.DB_PATHS || {}), codebase: ':memory:' },
    LATE_INTERACTION_CONFIG: { ...(actual.LATE_INTERACTION_CONFIG || {}), enabled: false },
  };
});

const {
  readSemantic,
  __resetReadSemanticCachesForTests,
} = await import('../../core/search/search-read-semantic.js');
const { __resetReadCachesForTests } = await import('../../core/search/search-read.js');

let TMP;

beforeEach(() => {
  mockState.rows = [];
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
  TMP = mkdtempSync(path.join(tmpdir(), 'sweet-search-rsem-indexed-'));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mockState.rows = [];
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
});

function writeTmp(rel, content) {
  const abs = path.join(TMP, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

function addChunk(id, filePath, metadata, dbText = 'TRUNCATED DB TEXT') {
  mockState.rows.push({
    id,
    file_path: filePath,
    text: dbText,
    metadata: JSON.stringify(metadata),
  });
}

describe('readSemantic — indexed chunk path', () => {
  it('selects symbol-matching spans and re-reads exact text from disk', async () => {
    const text = [
      'function authenticateUser(req) {',
      '  return req.headers.authorization;',
      '}',
      '',
      'function renderPage() {',
      '  return "<html>";',
      '}',
      '',
    ].join('\n');
    writeTmp('src/auth.js', text);
    addChunk('auth', 'src/auth.js', {
      language: 'javascript',
      symbol: 'authenticateUser',
      chunk_type: 'function',
      line_start: 1,
      line_end: 3,
    });
    addChunk('render', 'src/auth.js', {
      language: 'javascript',
      symbol: 'renderPage',
      chunk_type: 'function',
      line_start: 5,
      line_end: 7,
    });

    const r = await readSemantic({
      path: 'src/auth.js',
      query: 'how does authenticateUser handle headers',
      topK: 1,
      contextLines: 0,
      projectRoot: TMP,
    });

    expect(r.ok).toBe(true);
    expect(r.indexed).toBe(true);
    expect(r.fellBack).toBe(false);
    expect(r.spans).toHaveLength(1);
    expect(r.spans[0].chunkIds).toEqual(['auth']);
    expect(r.spans[0].text).toBe('function authenticateUser(req) {\n  return req.headers.authorization;\n}\n');
    expect(r.spans[0].text).not.toContain('TRUNCATED DB TEXT');
  });

  it('expands context and merges adjacent selected chunks', async () => {
    const text = [
      'const setup = true;',
      'function firstHandler() {',
      '  return "shared token";',
      '}',
      'function secondHandler() {',
      '  return "shared token";',
      '}',
      'const done = true;',
      '',
    ].join('\n');
    writeTmp('src/handlers.js', text);
    addChunk('first', 'src/handlers.js', {
      language: 'javascript',
      symbol: 'firstHandler',
      chunk_type: 'function',
      line_start: 2,
      line_end: 4,
    });
    addChunk('second', 'src/handlers.js', {
      language: 'javascript',
      symbol: 'secondHandler',
      chunk_type: 'function',
      line_start: 5,
      line_end: 7,
    });

    const r = await readSemantic({
      path: 'src/handlers.js',
      query: 'shared token',
      topK: 2,
      contextLines: 0,
      projectRoot: TMP,
    });

    expect(r.spans).toHaveLength(1);
    expect(r.spans[0].startLine).toBe(2);
    expect(r.spans[0].endLine).toBe(7);
    expect(new Set(r.spans[0].chunkIds)).toEqual(new Set(['first', 'second']));
  });

  it('enforces maxChars on indexed spans and marks truncation', async () => {
    const text = [
      'function hugeMatch() {',
      `  return "${'x'.repeat(500)}";`,
      '}',
      '',
    ].join('\n');
    writeTmp('src/huge.js', text);
    addChunk('huge', 'src/huge.js', {
      language: 'javascript',
      symbol: 'hugeMatch',
      chunk_type: 'function',
      line_start: 1,
      line_end: 3,
    });

    const r = await readSemantic({
      path: 'src/huge.js',
      query: 'hugeMatch',
      maxChars: 80,
      projectRoot: TMP,
    });

    expect(r.spans).toHaveLength(1);
    expect(r.spans[0].text.length).toBeLessThanOrEqual(80);
    expect(r.spans[0].truncated).toBe(true);
    expect(r.charsReturned).toBeLessThanOrEqual(80);
  });
});
