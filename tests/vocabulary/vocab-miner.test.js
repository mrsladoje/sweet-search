/**
 * Vocabulary Miner Tests
 *
 * Tests for splitIdentifier, mineStructural, mineSymbols,
 * mineCodeGraph, mineNLContent, mineGit, and mineAll.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Mock child_process for git commands (execFileSync used for shell-safe invocation)
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => ''),
}));

// Mock better-sqlite3 for code graph
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(() => ({
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(() => null),
        run: vi.fn(),
      })),
      exec: vi.fn(),
      close: vi.fn(),
    })),
  };
});

// Mock repo-map for code graph mining (shared fns for both stub and canonical path)
const { mockLoadGraph, mockBuildAdjacency, mockPageRank } = vi.hoisted(() => ({
  mockLoadGraph: vi.fn(() => ({ entities: [], relationships: [] })),
  mockBuildAdjacency: vi.fn(() => ({ outEdges: new Map(), allNodes: new Set() })),
  mockPageRank: vi.fn(() => new Map()),
}));
vi.mock('../../core/repo-map.js', () => ({
  loadGraph: mockLoadGraph,
  buildAdjacency: mockBuildAdjacency,
  pageRank: mockPageRank,
}));
vi.mock('../../core/graph/repo-map.js', () => ({
  loadGraph: mockLoadGraph,
  buildAdjacency: mockBuildAdjacency,
  pageRank: mockPageRank,
}));

import {
  splitIdentifier,
  mineStructural,
  mineSymbols,
  mineCodeGraph,
  mineNLContent,
  mineGit,
  mineAll,
} from '../../core/vocabulary/vocab-miner.js';

import { execFileSync } from 'child_process';
import { loadGraph, buildAdjacency, pageRank } from '../../core/graph/repo-map.js';

// ---------------------------------------------------------------------------
// splitIdentifier
// ---------------------------------------------------------------------------

describe('splitIdentifier', () => {
  it('splits camelCase', () => {
    expect(splitIdentifier('getUserData')).toEqual(['get', 'user', 'data']);
  });

  it('splits PascalCase', () => {
    expect(splitIdentifier('AuthController')).toEqual(['auth', 'controller']);
  });

  it('splits snake_case', () => {
    expect(splitIdentifier('http_server_utils')).toEqual(['http', 'server', 'utils']);
  });

  it('splits SCREAMING_SNAKE_CASE', () => {
    expect(splitIdentifier('MAX_RETRY_COUNT')).toEqual(['max', 'retry', 'count']);
  });

  it('splits kebab-case', () => {
    expect(splitIdentifier('my-component-name')).toEqual(['my', 'component', 'name']);
  });

  it('handles acronyms like XMLParser', () => {
    expect(splitIdentifier('XMLParser')).toEqual(['xml', 'parser']);
  });

  it('handles single character', () => {
    expect(splitIdentifier('x')).toEqual(['x']);
  });

  it('handles empty string', () => {
    expect(splitIdentifier('')).toEqual([]);
  });

  it('handles null/undefined', () => {
    expect(splitIdentifier(null)).toEqual([]);
    expect(splitIdentifier(undefined)).toEqual([]);
  });

  it('handles dotted path', () => {
    expect(splitIdentifier('config.database.host')).toEqual(['config', 'database', 'host']);
  });

  it('handles mixed case with numbers', () => {
    expect(splitIdentifier('getUser2Data')).toEqual(['get', 'user2', 'data']);
  });
});

// ---------------------------------------------------------------------------
// mineStructural
// ---------------------------------------------------------------------------

describe('mineStructural', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'miner-structural-'));
    // Create a basic project structure
    mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'src', 'AuthService.js'), 'export class AuthService {}');
    writeFileSync(path.join(tmpDir, 'src', 'user_helper.ts'), 'export function getUser() {}');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts terms from directory names', () => {
    const result = mineStructural(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('src');
    expect(termNames).toContain('tests');
  });

  it('extracts terms from source file names', () => {
    const result = mineStructural(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('AuthService');
  });

  it('extracts file name parts', () => {
    const result = mineStructural(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('auth');
  });

  it('extracts npm dependencies from package.json', () => {
    writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    }));
    const result = mineStructural(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('express');
    expect(termNames).toContain('vitest');
  });

  it('extracts env keys from .env.example', () => {
    writeFileSync(path.join(tmpDir, '.env.example'), 'DATABASE_URL=\nAPI_KEY=');
    const result = mineStructural(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('DATABASE_URL');
    expect(termNames).toContain('API_KEY');
  });

  it('returns terms sorted by score descending', () => {
    const result = mineStructural(tmpDir);
    for (let i = 1; i < result.terms.length; i++) {
      expect(result.terms[i].score).toBeLessThanOrEqual(result.terms[i - 1].score);
    }
  });

  it('handles nonexistent directory gracefully', () => {
    const result = mineStructural('/nonexistent/path');
    expect(result.terms).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// mineSymbols
// ---------------------------------------------------------------------------

describe('mineSymbols', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'miner-symbols-'));
    mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts import names from JS files', () => {
    writeFileSync(path.join(tmpDir, 'src', 'app.js'),
      "import { AuthService, UserModel } from './services';\n");
    const result = mineSymbols(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('AuthService');
    expect(termNames).toContain('UserModel');
  });

  it('extracts namespace and combo import names from JS files', () => {
    writeFileSync(path.join(tmpDir, 'src', 'imports.js'),
      "import * as React from 'react';\n" +
      "import lodash, { map as mapFn, filter } from 'lodash';\n");
    const result = mineSymbols(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('React');
    expect(termNames).toContain('lodash');
    expect(termNames).toContain('map');
    expect(termNames).toContain('filter');
  });

  it('extracts CommonJS require names from JS files', () => {
    writeFileSync(path.join(tmpDir, 'src', 'legacy.cjs'),
      "const path = require('path');\n" +
      "const { readFileSync, writeFile: wf } = require('fs');\n");
    const result = mineSymbols(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('path');
    expect(termNames).toContain('readFileSync');
    expect(termNames).toContain('writeFile');
    expect(termNames).toContain('fs');
  });

  it('extracts export names from JS files', () => {
    writeFileSync(path.join(tmpDir, 'src', 'service.js'),
      'export class PaymentService {}\nexport function processOrder() {}\n');
    const result = mineSymbols(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('PaymentService');
    expect(termNames).toContain('processOrder');
  });

  it('extracts SCREAMING_SNAKE constants', () => {
    writeFileSync(path.join(tmpDir, 'src', 'config.js'),
      'const MAX_RETRIES = 5;\nconst DEFAULT_TIMEOUT = 3000;\n');
    const result = mineSymbols(tmpDir);
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('MAX_RETRIES');
    expect(termNames).toContain('DEFAULT_TIMEOUT');
  });

  it('respects maxFiles option', () => {
    for (let i = 0; i < 5; i++) {
      writeFileSync(path.join(tmpDir, 'src', `file${i}.js`), `export const X${i} = ${i};`);
    }
    const result = mineSymbols(tmpDir, { maxFiles: 2 });
    expect(result.terms.length).toBeGreaterThan(0);
  });

  it('skips files exceeding maxFileSize', () => {
    writeFileSync(path.join(tmpDir, 'src', 'big.js'), 'x'.repeat(200));
    const result = mineSymbols(tmpDir, { maxFileSize: 100 });
    // The big file should be skipped, so no terms from it
    const termNames = result.terms.map(t => t.term);
    expect(termNames).not.toContain('x');
  });

  it('handles nonexistent directory gracefully', () => {
    const result = mineSymbols('/nonexistent/path');
    expect(result.terms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mineCodeGraph
// ---------------------------------------------------------------------------

describe('mineCodeGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when loadGraph fails', () => {
    loadGraph.mockImplementationOnce(() => { throw new Error('DB not found'); });
    const result = mineCodeGraph('/fake/code-graph.db');
    expect(result.terms).toEqual([]);
    expect(result.pageRankScores.size).toBe(0);
  });

  it('returns empty when no entities', () => {
    loadGraph.mockReturnValueOnce({ entities: [], relationships: [] });
    const result = mineCodeGraph('/fake/code-graph.db');
    expect(result.terms).toEqual([]);
  });

  it('mines entity names weighted by PageRank', () => {
    loadGraph.mockReturnValueOnce({
      entities: [
        { id: 1, name: 'AuthService', type: 'class', file_path: 'src/auth.js' },
        { id: 2, name: 'helper', type: 'function', file_path: 'src/util.js' },
      ],
      relationships: [{ source_id: 1, target_id: 2, type: 'calls' }],
    });
    buildAdjacency.mockReturnValueOnce({
      outEdges: new Map([[1, new Map([[2, true]])]]),
      allNodes: new Set([1, 2]),
    });
    pageRank.mockReturnValueOnce(new Map([[1, 0.8], [2, 0.2]]));

    const result = mineCodeGraph('/fake/code-graph.db');
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('AuthService');
    expect(termNames).toContain('helper');
    expect(result.pageRankScores.size).toBe(2);

    // AuthService should have higher score (higher PageRank)
    const authScore = result.terms.find(t => t.term === 'AuthService')?.score;
    const helperScore = result.terms.find(t => t.term === 'helper')?.score;
    expect(authScore).toBeGreaterThan(helperScore);
  });

  it('gives hub bonus for entities with high in-degree', () => {
    const entities = [
      { id: 1, name: 'HubEntity', type: 'class', file_path: 'src/hub.js' },
      { id: 2, name: 'LeafEntity', type: 'function', file_path: 'src/leaf.js' },
    ];
    // 6 edges pointing to HubEntity (in-degree > 5 triggers bonus)
    const relationships = Array.from({ length: 6 }, (_, i) => ({
      source_id: i + 10, target_id: 1, type: 'calls',
    }));

    loadGraph.mockReturnValueOnce({ entities, relationships });
    buildAdjacency.mockReturnValueOnce({
      outEdges: new Map([[1, new Map()], [2, new Map()]]),
      allNodes: new Set([1, 2]),
    });
    pageRank.mockReturnValueOnce(new Map([[1, 0.5], [2, 0.5]]));

    const result = mineCodeGraph('/fake/code-graph.db');
    const hubScore = result.terms.find(t => t.term === 'HubEntity')?.score;
    const leafScore = result.terms.find(t => t.term === 'LeafEntity')?.score;
    expect(hubScore).toBeGreaterThan(leafScore);
  });
});

// ---------------------------------------------------------------------------
// mineNLContent
// ---------------------------------------------------------------------------

describe('mineNLContent', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'miner-nl-'));
    mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty for no communities', () => {
    const result = mineNLContent([], tmpDir);
    expect(result.communityPhrases).toEqual([]);
  });

  it('returns empty for null communities', () => {
    const result = mineNLContent(null, tmpDir);
    expect(result.communityPhrases).toEqual([]);
  });

  it('extracts phrases from comments in community files', () => {
    writeFileSync(path.join(tmpDir, 'src', 'auth.js'),
      '// Handle user authentication and session management\n' +
      '// Validate JWT tokens before processing requests\n' +
      'function authenticate() {}\n');

    const communities = [
      { id: 0, entityIds: [1], fileIds: ['src/auth.js'] },
    ];
    const result = mineNLContent(communities, tmpDir);
    expect(result.communityPhrases.length).toBe(1);
    expect(result.communityPhrases[0].phrases.length).toBeGreaterThan(0);
  });

  it('extracts bigrams and trigrams', () => {
    writeFileSync(path.join(tmpDir, 'src', 'api.js'),
      '// cache invalidation strategy for distributed systems\n' +
      '// cache invalidation strategy pattern implementation\n');

    const communities = [
      { id: 0, entityIds: [1], fileIds: ['src/api.js'] },
    ];
    const result = mineNLContent(communities, tmpDir);
    const phrases = result.communityPhrases[0].phrases;
    const types = new Set(phrases.map(p => p.type));
    expect(types.has('unigram')).toBe(true);
    // Bigrams and trigrams only appear if enough tokens
    if (phrases.length > 1) {
      expect(types.has('bigram') || types.has('trigram')).toBe(true);
    }
  });

  it('redacts secret-like content', () => {
    writeFileSync(path.join(tmpDir, 'src', 'config.js'),
      '// API key: sk-abc123def456ghi789jkl012mno345\n' +
      '// Database connection string for development\n');

    const communities = [
      { id: 0, entityIds: [1], fileIds: ['src/config.js'] },
    ];
    const result = mineNLContent(communities, tmpDir);
    const allPhraseTexts = result.communityPhrases[0].phrases.map(p => p.text);
    // Secret-like content should not appear
    for (const text of allPhraseTexts) {
      expect(text).not.toContain('sk-abc');
    }
  });

  it('limits phrases to top 50 per community', () => {
    // Create a file with many distinct comments
    const lines = Array.from({ length: 100 }, (_, i) =>
      `// unique comment number ${i} about topic area ${i}`
    ).join('\n');
    writeFileSync(path.join(tmpDir, 'src', 'big.js'), lines);

    const communities = [
      { id: 0, entityIds: [1], fileIds: ['src/big.js'] },
    ];
    const result = mineNLContent(communities, tmpDir);
    expect(result.communityPhrases[0].phrases.length).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// mineGit
// ---------------------------------------------------------------------------

describe('mineGit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts terms from commit messages', () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args?.includes('--format=%s')) {
        return 'feat: add authentication\nfix: resolve login bug\nrefactor: clean up user service\n';
      }
      return '';
    });

    const result = mineGit('/fake/project');
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('authentication');
    expect(termNames).toContain('login');
  });

  it('extracts terms from branch names', () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args?.includes('branch')) {
        return 'feature/user-dashboard\nfix/payment-flow\nmain\n';
      }
      return '';
    });

    const result = mineGit('/fake/project');
    const termNames = result.terms.map(t => t.term);
    expect(termNames).toContain('user');
    expect(termNames).toContain('dashboard');
    expect(termNames).toContain('payment');
  });

  it('extracts hot file terms', () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args?.includes('--name-only')) {
        return 'src/AuthService.js\nsrc/AuthService.js\nsrc/AuthService.js\nsrc/UserModel.js\n';
      }
      return '';
    });

    const result = mineGit('/fake/project');
    const termNames = result.terms.map(t => t.term);
    // AuthService appears 3 times = hottest file
    expect(termNames).toContain('auth');
  });

  it('handles git not available gracefully', () => {
    execFileSync.mockImplementation(() => { throw new Error('git not found'); });
    const result = mineGit('/fake/project');
    expect(result.terms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mineAll
// ---------------------------------------------------------------------------

describe('mineAll', () => {
  let tmpDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(path.join(tmpdir(), 'miner-all-'));
    mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'src', 'App.js'), 'export class App {}');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges results from structural and symbol miners', () => {
    loadGraph.mockReturnValueOnce({ entities: [], relationships: [] });
    const result = mineAll(tmpDir, '/fake/db');
    expect(result.terms.length).toBeGreaterThan(0);
    expect(result.pageRankScores).toBeInstanceOf(Map);
    expect(typeof result.totalFiles).toBe('number');
    expect(result.totalFiles).toBeGreaterThan(0);
  });

  it('includes NL mining when communities provided', () => {
    writeFileSync(path.join(tmpDir, 'src', 'service.js'),
      '// Handle background job processing\nexport function processJob() {}\n');
    loadGraph.mockReturnValueOnce({ entities: [], relationships: [] });

    const communities = [
      { id: 0, entityIds: [1], fileIds: ['src/service.js'] },
    ];
    const result = mineAll(tmpDir, '/fake/db', communities);
    expect(result.communityPhrases.length).toBeGreaterThan(0);
  });

  it('skips NL mining when skipNL=true', () => {
    loadGraph.mockReturnValueOnce({ entities: [], relationships: [] });
    const communities = [{ id: 0, entityIds: [1], fileIds: ['src/App.js'] }];
    const result = mineAll(tmpDir, '/fake/db', communities, { skipNL: true });
    expect(result.communityPhrases).toEqual([]);
  });

  it('includes git mining in deep mode', () => {
    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args?.includes('--format=%s')) return 'add feature\n';
      return '';
    });
    loadGraph.mockReturnValueOnce({ entities: [], relationships: [] });

    const result = mineAll(tmpDir, '/fake/db', [], { deep: true });
    const sources = new Set(result.terms.map(t => t.source));
    expect(sources.has('git-commit')).toBe(true);
  });

  it('returns sorted terms by score', () => {
    loadGraph.mockReturnValueOnce({ entities: [], relationships: [] });
    const result = mineAll(tmpDir, '/fake/db');
    for (let i = 1; i < result.terms.length; i++) {
      expect(result.terms[i].score).toBeLessThanOrEqual(result.terms[i - 1].score);
    }
  });

  it('counts deeply nested source files for totalFiles', () => {
    loadGraph.mockReturnValueOnce({ entities: [], relationships: [] });
    const deepDir = path.join(tmpDir, 'a', 'b', 'c', 'd', 'e', 'f');
    mkdirSync(deepDir, { recursive: true });
    writeFileSync(path.join(deepDir, 'DeepFeature.ts'), 'export const deep = true;\n');

    const result = mineAll(tmpDir, '/fake/db');
    // Base fixture has src/App.js (1) + deeply nested DeepFeature.ts (1)
    expect(result.totalFiles).toBeGreaterThanOrEqual(2);
  });
});
