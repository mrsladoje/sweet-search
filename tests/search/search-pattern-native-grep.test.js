/**
 * Native-grep independence tests for ss-grep / ss-pattern.
 *
 * These prove that bareGrep() and patternSearch() do NOT require ripgrep when
 * native in-process grep can serve the request, and that the fallback error is
 * actionable when neither engine is available.
 *
 * Why a dedicated file: it mocks the ripgrep module so `rg` appears unavailable
 * (isRipgrepAvailable → false, runners throw if invoked). Co-locating this with
 * search-pattern.test.js would corrupt that suite's real rg-availability probe.
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Force ripgrep to look unavailable and make every rg runner throw — any test
// that reaches ripgrep fails loudly, proving the native path is independent.
vi.mock('../../core/search/search-pattern-ripgrep.js', async (importOriginal) => {
  const actual = await importOriginal();
  const boom = () => { throw new Error('ripgrep must not be invoked on the native grep path'); };
  return {
    ...actual,
    isRipgrepAvailable: () => Promise.resolve(false),
    runRipgrepJson: boom,
    runRipgrepFilesWithMatches: boom,
    runRipgrepJsonStreaming: boom,
  };
});

// Keep patternSearch's query encoder out of the way (no model load needed).
vi.mock('../../core/ranking/late-interaction-model.js', () => ({
  encodeQuery: vi.fn(async () => []),
}));

import { bareGrep, patternSearch, getChunkLocationMap } from '../../core/search/index.js';
import { isNativeGrepAvailable } from '../../core/infrastructure/native-sparse-gram.js';
import {
  appendDeltaRecord,
  fileIdFor,
  FALLBACK_WEIGHTS_ID,
} from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';

function sparseDeltaPin(basePath, epoch) {
  return {
    sparseGramDeltas: [`${path.basename(basePath)}.deltas/${epoch}-0.ssgrmdelta`],
    sparseGramWeightsId: FALLBACK_WEIGHTS_ID,
  };
}

/** A mock sparse-gram index exposing the native unified-search methods. */
function makeUnifiedIndex(fullResult) {
  return {
    searchFull: vi.fn(() => fullResult),
    searchLines: vi.fn(() => ({ ...fullResult, matches: fullResult.matches.map(m => ({ file: m.file, line: m.line })) })),
  };
}

// =============================================================================
// 1. bareGrep serves a plain regex via native unified search, no ripgrep
// =============================================================================

describe('bareGrep — native path requires no ripgrep', () => {
  it('returns native matches with nativeGrepUsed:true and never calls rg', async () => {
    const index = makeUnifiedIndex({
      matches: [{ file: 'src/a.js', line: 1, column: 7, matchText: 'AuthService', content: 'class AuthService {}' }],
      candidateFiles: 1,
      totalFiles: 1,
      scannedFiles: 1,
    });
    const searcher = { projectRoot: '/proj', sparseGramIndex: index };

    const res = await bareGrep.call(searcher, 'AuthService', null, { regex: 'AuthService' });

    expect(res.stats.path).toBe('grep');
    expect(res.stats.nativeGrepUsed).toBe(true);
    expect(res.stats.grepStrategy).toBe('unified_grep_all');
    expect(res.results.map(r => r.file)).toEqual(['src/a.js']);
    expect(res.results[0].matchText).toBe('AuthService');
    expect(res.results[0].content).toBe('class AuthService {}');
    expect(index.searchFull).toHaveBeenCalled();
  });
});

// =============================================================================
// 2. patternSearch serves candidate generation via native search, no ripgrep
// =============================================================================

describe('patternSearch — native path requires no ripgrep', () => {
  it('runs the pattern pipeline without ripgrep when native search is available', async () => {
    const index = makeUnifiedIndex({
      matches: [],
      candidateFiles: 0,
      totalFiles: 1,
      scannedFiles: 1,
    });
    const searcher = {
      verbose: false,
      projectRoot: '/proj',
      hasLateInteractionIndex: true,
      sparseGramIndex: index,
      lateInteractionIndex: {
        documents: new Map(),
        init: vi.fn(),
        hasTokens: vi.fn(() => new Set()),
        scoreWithLateInteraction: vi.fn(async () => []),
      },
      getChunkLocationMap,
    };

    const res = await patternSearch.call(searcher, 'auth service', null, { regex: 'AuthService', k: 5 });

    expect(res.results).toEqual([]);
    expect(res.stats.path).toBe('pattern');
    expect(res.stats.grepMatches).toBe(0);
    expect(String(res.stats.grepStrategy)).toMatch(/^unified_/);
    expect(index.searchLines).toHaveBeenCalled();
  });
});

// =============================================================================
// 3. Clear, actionable error when neither native nor ripgrep is available
// =============================================================================

describe('grep engine fallback errors', () => {
  it('bareGrep names both engines when native and ripgrep are unavailable', async () => {
    // gramIndex:false forces ensureSparseGramIndex → null (no native engine).
    await expect(
      bareGrep.call({ projectRoot: '/proj', sparseGramIndex: null }, 'foo', null, { regex: 'foo', gramIndex: false }),
    ).rejects.toThrow(/native grep is unavailable[\s\S]*ripgrep is not installed/);
  });

  it('bareGrep explains that fixed-string queries need the ripgrep fallback', async () => {
    await expect(
      bareGrep.call({ projectRoot: '/proj', sparseGramIndex: null }, 'foo', null,
        { regex: 'foo', fixedString: true, gramIndex: false }),
    ).rejects.toThrow(/fixed-string and glob queries use the ripgrep fallback/);
  });

  it('patternSearch names both engines when native and ripgrep are unavailable', async () => {
    const searcher = {
      verbose: false,
      projectRoot: '/proj',
      hasLateInteractionIndex: true,
      sparseGramIndex: null,
      lateInteractionIndex: { documents: new Map(), init: vi.fn() },
      getChunkLocationMap,
    };
    await expect(
      patternSearch.call(searcher, 'auth', null, { regex: 'AuthService', gramIndex: false }),
    ).rejects.toThrow(/native grep is unavailable[\s\S]*ripgrep is not installed/);
  });
});

// =============================================================================
// 4. Incremental sparse overlay still works on the native path (add + delete)
//    + 5. a candidate that vanished mid-reconcile is benign (no crash)
//    These exercise the REAL native grep engine, so they are gated on it.
// =============================================================================

const dNative = isNativeGrepAvailable() ? describe : describe.skip;

dNative('bareGrep — native sparse delta overlay (real native grep, no ripgrep)', () => {
  it('sees added/updated files and hides deleted files, without searchFull', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-native-overlay-'));
    const srcDir = path.join(tmpDir, 'src');
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'new.js'), 'export const freshNeedle = 1;\n');
    await fs.writeFile(path.join(srcDir, 'old.js'), 'export const freshNeedle = 2;\n');
    await fs.writeFile(path.join(srcDir, 'base.js'), 'export const unrelated = 0;\n');
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 7, {
        fileId: fileIdFor('src/new.js'),
        filePath: 'src/new.js',
        contentHash: 'fresh',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });
      appendDeltaRecord(basePath, 7, {
        fileId: fileIdFor('src/old.js'),
        filePath: 'src/old.js',
        contentHash: '',
        deleted: true,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });

      // queryLiterals returns the base candidates; getAllFiles is the base
      // all-files list. The overlay layers the deltas on top of both.
      const index = {
        searchFull: vi.fn(),
        searchLines: vi.fn(),
        queryLiterals: vi.fn(() => ({
          eligible: true,
          files: ['src/old.js', 'src/base.js'],
          totalFiles: 2,
          gramsUsed: 1,
        })),
        getAllFiles: vi.fn(() => ['src/old.js', 'src/base.js']),
      };
      const searcher = {
        projectRoot: tmpDir,
        sparseGramIndexPath: basePath,
        manifestEpoch: 7,
        ...sparseDeltaPin(basePath, 7),
        sparseGramIndex: index,
      };

      const res = await bareGrep.call(searcher, 'freshNeedle', null, {
        regex: 'freshNeedle',
        sparseGramIndexPath: basePath,
      });

      const files = res.results.map(r => r.file);
      expect(files).toContain('src/new.js');     // added file is visible
      expect(files).not.toContain('src/old.js'); // deleted file is hidden
      expect(res.stats.nativeGrepUsed).toBe(true);
      // Unified search is bypassed when deltas must be overlaid.
      expect(index.searchFull).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('tolerates a candidate file deleted mid-reconcile (no reader crash)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-native-vanish-'));
    const srcDir = path.join(tmpDir, 'src');
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'real.js'), 'export const reconcileNeedle = 1;\n');
    // src/vanished.js intentionally not created — it disappears before grep.
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 7, {
        fileId: fileIdFor('src/real.js'),
        filePath: 'src/real.js',
        contentHash: 'real',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });

      const index = {
        searchFull: vi.fn(),
        searchLines: vi.fn(),
        queryLiterals: vi.fn(() => ({
          eligible: true,
          files: ['src/real.js', 'src/vanished.js'],
          totalFiles: 2,
          gramsUsed: 1,
        })),
        getAllFiles: vi.fn(() => ['src/real.js', 'src/vanished.js']),
      };
      const searcher = {
        projectRoot: tmpDir,
        sparseGramIndexPath: basePath,
        manifestEpoch: 7,
        ...sparseDeltaPin(basePath, 7),
        sparseGramIndex: index,
      };

      const res = await bareGrep.call(searcher, 'reconcileNeedle', null, {
        regex: 'reconcileNeedle',
        sparseGramIndexPath: basePath,
      });

      const files = res.results.map(r => r.file);
      expect(files).toContain('src/real.js');
      expect(files).not.toContain('src/vanished.js');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
