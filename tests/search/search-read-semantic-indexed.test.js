import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mockState = vi.hoisted(() => ({
  rows: [],
  instances: [],
}));

vi.mock('../../core/infrastructure/codebase-repository.js', () => ({
  CodebaseRepository: class {
    constructor(dbPath) {
      this.dbPath = dbPath;
      this.refreshes = 0;
      mockState.instances.push(this);
    }
    refreshManifestEpoch() {
      this.refreshes++;
      return 1;
    }
    getChunksByFilePath(filePath) {
      return mockState.rows.filter(r => r.file_path === filePath);
    }
    close() {}
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
  mockState.instances = [];
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
  TMP = mkdtempSync(path.join(tmpdir(), 'sweet-search-rsem-indexed-'));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mockState.rows = [];
  mockState.instances = [];
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

  it('refreshes the codebase manifest pin before reading indexed chunks', async () => {
    writeTmp('src/auth.js', 'function authenticateUser() {}\n');
    addChunk('auth', 'src/auth.js', {
      language: 'javascript',
      symbol: 'authenticateUser',
      chunk_type: 'function',
      line_start: 1,
      line_end: 1,
    });

    await readSemantic({
      path: 'src/auth.js',
      query: 'authenticateUser',
      topK: 1,
      contextLines: 0,
      projectRoot: TMP,
    });

    expect(mockState.instances).toHaveLength(1);
    expect(mockState.instances[0].refreshes).toBeGreaterThan(0);
  });

  it('matches indexed chunks when request path uses the realpath spelling of a symlinked project root', async () => {
    const realRoot = path.join(TMP, 'real');
    const linkRoot = path.join(TMP, 'link');
    mkdirSync(path.join(realRoot, 'src'), { recursive: true });
    symlinkSync(realRoot, linkRoot, 'dir');
    writeFileSync(path.join(realRoot, 'src/auth.js'), 'function authenticateUser() {}\n');
    addChunk('auth', 'src/auth.js', {
      language: 'javascript',
      symbol: 'authenticateUser',
      chunk_type: 'function',
      line_start: 1,
      line_end: 1,
    });

    const r = await readSemantic({
      path: path.join(realRoot, 'src/auth.js'),
      query: 'authenticateUser',
      topK: 1,
      contextLines: 0,
      projectRoot: linkRoot,
    });

    expect(r.indexed).toBe(true);
    expect(r.fellBack).toBe(false);
    expect(r.spans[0].chunkIds).toEqual(['auth']);
  });

  it('keeps a stable state-dir repository base when the reconcile manifest pins a vectors path', async () => {
    writeTmp('src/auth.js', 'function authenticateUser() {}\n');
    mkdirSync(path.join(TMP, '.sweet-search'), { recursive: true });
    writeFileSync(path.join(TMP, '.sweet-search', 'reconcile-manifest.json'), JSON.stringify({
      epoch: 5,
      vectors: { path: 'codebase-next.db', epoch: 5 },
    }));
    addChunk('auth', 'src/auth.js', {
      language: 'javascript',
      symbol: 'authenticateUser',
      chunk_type: 'function',
      line_start: 1,
      line_end: 1,
    });

    const r = await readSemantic({
      path: 'src/auth.js',
      query: 'authenticateUser',
      topK: 1,
      contextLines: 0,
      projectRoot: TMP,
    });

    expect(r.ok).toBe(true);
    expect(mockState.instances).toHaveLength(1);
    expect(mockState.instances[0].dbPath).toBe(path.join(TMP, '.sweet-search', 'codebase.db'));
  });

  it('does not move the repository manifest base into nested vectors directories', async () => {
    writeTmp('src/auth.js', 'function authenticateUser() {}\n');
    mkdirSync(path.join(TMP, '.sweet-search', 'nested'), { recursive: true });
    writeFileSync(path.join(TMP, '.sweet-search', 'reconcile-manifest.json'), JSON.stringify({
      epoch: 5,
      vectors: { path: 'nested/codebase.db', epoch: 5 },
    }));
    addChunk('auth', 'src/auth.js', {
      language: 'javascript',
      symbol: 'authenticateUser',
      chunk_type: 'function',
      line_start: 1,
      line_end: 1,
    });

    const first = await readSemantic({
      path: 'src/auth.js',
      query: 'authenticateUser',
      topK: 1,
      contextLines: 0,
      projectRoot: TMP,
    });
    writeFileSync(path.join(TMP, '.sweet-search', 'reconcile-manifest.json'), JSON.stringify({
      epoch: 6,
      vectors: { path: 'nested/codebase.db', epoch: 6 },
    }));
    const second = await readSemantic({
      path: 'src/auth.js',
      query: 'authenticateUser',
      topK: 1,
      contextLines: 0,
      projectRoot: TMP,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(mockState.instances).toHaveLength(1);
    expect(mockState.instances[0].dbPath).toBe(path.join(TMP, '.sweet-search', 'codebase.db'));
    expect(mockState.instances[0].refreshes).toBeGreaterThanOrEqual(2);
  });

  it('warns when disk source is newer than the semantic index manifest', async () => {
    writeTmp('src/auth.js', 'function authenticateUser() {}\n');
    mkdirSync(path.join(TMP, '.sweet-search'), { recursive: true });
    writeFileSync(path.join(TMP, '.sweet-search', 'reconcile-manifest.json'), JSON.stringify({
      epoch: 3,
      publishedAt: '2000-01-01T00:00:00.000Z',
    }));
    addChunk('auth', 'src/auth.js', {
      language: 'javascript',
      symbol: 'authenticateUser',
      chunk_type: 'function',
      line_start: 1,
      line_end: 1,
    });

    const r = await readSemantic({
      path: 'src/auth.js',
      query: 'authenticateUser',
      topK: 1,
      contextLines: 0,
      projectRoot: TMP,
    });

    expect(r.staleness).toMatchObject({
      stale: true,
      indexEpoch: 3,
      indexPublishedAt: '2000-01-01T00:00:00.000Z',
    });
    expect(r.warnings?.[0]).toContain('source file is newer than the semantic index');
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
