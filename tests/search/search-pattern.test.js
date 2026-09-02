/**
 * Pattern Search Unit + Integration Tests
 *
 * Tests for core/search-pattern.js — the ColGrep-style hybrid regex + semantic
 * ranking module.
 *
 * Pure helper functions are tested directly. The prototype-bound `patternSearch`
 * is tested via `.call(mockThis, ...)` with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';

import {
  bareGrep,
  buildChunkLocationMap,
  chunkRipgrepFiles,
  extractLiteralClauses,
  extractLiteralClausesHeuristic,
  extractRegexTokens,
  extractRequiredLiteralsHeuristic,
  findChunkForLine,
  isRipgrepCodePath,
  mapMatchesToChunks,
  mergeRegexIntoQuery,
  normalizeLiteralClauses,
  normalizeSearchPath,
  generateRegexMatches,
  ensureSparseGramIndex,
  querySparseGramCandidates,
  readFileRange,
  getChunkLocationMap,
  patternSearch,
  isRipgrepAvailable,
  _resetRgCache,
  runRipgrep,
} from '../../core/search/index.js';

import {
  resolveSparseSymbolMask,
  SPARSE_SYMBOL_MASKS,
} from '../../core/infrastructure/native-sparse-gram.js';
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

// =============================================================================
// extractRequiredLiteralsHeuristic
// =============================================================================

describe('extractRequiredLiteralsHeuristic', () => {
  it('extracts fixed literals from concatenated regex fragments', () => {
    expect(extractRequiredLiteralsHeuristic('class\\s+Auth\\w+Service')).toEqual([
      'class',
      'Auth',
      'Service',
    ]);
  });

  it('returns no literals for alternation patterns to avoid false negatives', () => {
    expect(extractRequiredLiteralsHeuristic('(get|set)Config')).toEqual([]);
    expect(extractRequiredLiteralsHeuristic('foo|bar')).toEqual([]);
  });

  it('keeps surrounding literals around character classes and quantifiers', () => {
    expect(extractRequiredLiteralsHeuristic('import\\s+{[^}]+}\\s+from\\s+react')).toEqual([
      'import',
      'from',
      'react',
    ]);
  });
});

describe('extractLiteralClausesHeuristic', () => {
  it('wraps heuristic literals in a single AND clause', () => {
    expect(extractLiteralClausesHeuristic('class\\s+Auth\\w+Service')).toEqual([
      ['class', 'Auth', 'Service'],
    ]);
  });

  it('returns no clauses when the heuristic finds no safe literals', () => {
    expect(extractLiteralClausesHeuristic('foo|bar')).toEqual([]);
  });
});

describe('extractLiteralClauses', () => {
  it('falls back to the heuristic extractor when forced', () => {
    expect(extractLiteralClauses('class\\s+Auth\\w+Service', { forceHeuristic: true })).toEqual({
      clauses: [['class', 'Auth', 'Service']],
      source: 'heuristic',
    });
  });
});

// =============================================================================
// querySparseGramCandidates
// =============================================================================

describe('querySparseGramCandidates', () => {
  it('does not reuse a loaded sparse gram reader for a different requested path', () => {
    const loaded = { queryLiterals: vi.fn() };
    const searcher = {
      sparseGramIndex: loaded,
      _sparseGramLoadedPath: path.join(os.tmpdir(), 'old-sparse.idx'),
      sparseGramIndexPath: path.join(os.tmpdir(), 'old-sparse.idx'),
    };

    const missingPath = path.join(os.tmpdir(), `missing-sparse-${Date.now()}.idx`);

    expect(ensureSparseGramIndex(searcher, { sparseGramIndexPath: missingPath })).toBeNull();
    expect(searcher.sparseGramIndex).toBeNull();
    expect(searcher._sparseGramLoadedPath).toBeNull();
  });

  it('returns disabled when gram index is disabled', () => {
    const searcher = {
      sparseGramIndex: {
        queryLiterals: vi.fn(),
      },
    };

    expect(querySparseGramCandidates(searcher, [['auth']], { gramIndex: false })).toEqual({
      eligible: false,
      reason: 'disabled',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    });
    expect(searcher.sparseGramIndex.queryLiterals).not.toHaveBeenCalled();
  });

  it('returns not_eligible when native query is not eligible', () => {
    const searcher = {
      sparseGramIndex: {
        queryLiterals: vi.fn().mockReturnValue({ eligible: false, files: [] }),
      },
    };

    expect(querySparseGramCandidates(searcher, [['auth']])).toEqual({
      eligible: false,
      reason: 'not_eligible',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    });
  });

  it('returns candidate files from the native sparse gram index', () => {
    const result = {
      eligible: true,
      files: ['src/auth.js', 'docs/guide.md', 'src/session.js'],
      totalFiles: 42,
      candidateFiles: 3,
      gramsUsed: 5,
    };
    const searcher = {
      // Pin the index path away from the repo so a live sparse-delta overlay
      // in this working tree cannot leak files into the mocked result.
      sparseGramIndexPath: path.join(os.tmpdir(), 'sweet-search-absent-sparse.idx'),
      sparseGramIndex: {
        queryLiterals: vi.fn().mockReturnValue(result),
      },
    };

    expect(querySparseGramCandidates(searcher, [['AuthService']])).toEqual({
      ...result,
      denseGramsTouched: 0,
      reason: 'ok',
      candidateFiles: 2,
      files: ['src/auth.js', 'src/session.js'],
      sparseGramsTouched: 0,
    });
    expect(searcher.sparseGramIndex.queryLiterals).toHaveBeenCalledWith(['AuthService'], 0, 0);
  });

  it('reports too_broad when gram candidates are too broad', () => {
    const searcher = {
      sparseGramIndexPath: path.join(os.tmpdir(), 'sweet-search-absent-sparse.idx'),
      sparseGramIndex: {
        queryLiterals: vi.fn().mockReturnValue({
          eligible: true,
          files: Array.from({ length: 700 }, (_, i) => `src/file-${i}.js`),
          totalFiles: 1000,
        }),
      },
    };

    expect(querySparseGramCandidates(searcher, [['AuthService']], { maxGramCandidateFiles: 500 })).toEqual({
      eligible: false,
      reason: 'too_broad',
      totalFiles: 1000,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 700,
      files: null,
    });
  });

  it('returns an eligible empty candidate set without broad fallback', () => {
    const searcher = {
      sparseGramIndexPath: path.join(os.tmpdir(), 'sweet-search-absent-sparse.idx'),
      sparseGramIndex: {
        queryLiterals: vi.fn().mockReturnValue({
          eligible: true,
          files: [],
          totalFiles: 10,
          gramsUsed: 1,
        }),
      },
    };

    expect(querySparseGramCandidates(searcher, [['AbsentNeedle']])).toEqual({
      eligible: true,
      reason: 'ok',
      totalFiles: 10,
      gramsUsed: 1,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: [],
    });
  });

  it('generateRegexMatches short-circuits known-empty sparse candidates', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-empty-'));
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src', 'hit.js'), 'export const absentNeedle = 1;\n');
    try {
      const searcher = {
        sparseGramIndexPath: path.join(os.tmpdir(), 'sweet-search-absent-sparse.idx'),
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: [],
            totalFiles: 1,
            gramsUsed: 1,
          }),
          getAllFiles: vi.fn().mockReturnValue(['src/hit.js']),
        },
      };

      const result = await generateRegexMatches(searcher, 'absentNeedle', tmpDir, {
        fixedString: true,
        lightweightParse: true,
      });

      expect(result.matchingFiles).toEqual([]);
      expect(result.indexedMatches).toEqual([]);
      expect(result.stats.plannerRoute).toBe('empty_gram_candidates');
      expect(result.stats.filesScanned).toBe(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('overlays sparse-gram delta records onto native candidates', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-overlay-'));
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 5, {
        fileId: fileIdFor('src/new.js'),
        filePath: 'src/new.js',
        contentHash: 'new',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });
      appendDeltaRecord(basePath, 5, {
        fileId: fileIdFor('src/old.js'),
        filePath: 'src/old.js',
        contentHash: '',
        deleted: true,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });

      const searcher = {
        sparseGramIndexPath: basePath,
        manifestEpoch: 5,
        ...sparseDeltaPin(basePath, 5),
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: ['src/old.js', 'src/base.js'],
            totalFiles: 2,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']])).toEqual({
        eligible: true,
        reason: 'ok',
        totalFiles: 3,
        gramsUsed: 1,
        denseGramsTouched: 0,
        sparseGramsTouched: 0,
        candidateFiles: 2,
        files: ['src/base.js', 'src/new.js'],
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('uses sparse-gram delta grams instead of scanning every changed file for every query', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-overlay-grams-'));
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 5, {
        fileId: fileIdFor('src/new.js'),
        filePath: 'src/new.js',
        contentHash: 'new',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [['nee', 1], ['eed', 1]],
      });

      const searcher = {
        sparseGramIndexPath: basePath,
        manifestEpoch: 5,
        ...sparseDeltaPin(basePath, 5),
        sparseGramIndex: {
          extractLiteralCoveringGrams: vi.fn((literals) => ({
            eligible: true,
            grams: literals[0] === 'Needle' ? ['nee'] : ['abs'],
            weightsId: FALLBACK_WEIGHTS_ID,
          })),
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: [],
            totalFiles: 1,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']]).files).toEqual(['src/new.js']);
      expect(querySparseGramCandidates(searcher, [['Absent']]).files).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('normalizes absolute sparse base candidates before applying tombstone deltas', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-overlay-abs-'));
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 5, {
        fileId: fileIdFor('src/new.js'),
        filePath: 'src/new.js',
        contentHash: 'new',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });
      appendDeltaRecord(basePath, 5, {
        fileId: fileIdFor('src/old.js'),
        filePath: 'src/old.js',
        contentHash: '',
        deleted: true,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });

      const searcher = {
        projectRoot: tmpDir,
        sparseGramIndexPath: basePath,
        manifestEpoch: 5,
        ...sparseDeltaPin(basePath, 5),
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: [path.join(tmpDir, 'src/old.js'), path.join(tmpDir, 'src/base.js')],
            totalFiles: 2,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']]).files).toEqual([
        'src/base.js',
        'src/new.js',
      ]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('normalizes sparse delta absolute paths through project-root realpaths', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-overlay-link-'));
    const realRoot = path.join(tmpDir, 'real');
    const linkRoot = path.join(tmpDir, 'link');
    await fs.mkdir(path.join(realRoot, 'src'), { recursive: true });
    fsSync.symlinkSync(realRoot, linkRoot, 'dir');
    const basePath = path.join(linkRoot, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 5, {
        fileId: fileIdFor('src/new.js'),
        filePath: path.join(realRoot, 'src/new.js'),
        contentHash: 'new',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });
      appendDeltaRecord(basePath, 5, {
        fileId: fileIdFor('src/old.js'),
        filePath: path.join(realRoot, 'src/old.js'),
        contentHash: '',
        deleted: true,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });

      const searcher = {
        projectRoot: linkRoot,
        sparseGramIndexPath: basePath,
        manifestEpoch: 5,
        ...sparseDeltaPin(basePath, 5),
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: [path.join(realRoot, 'src/old.js'), path.join(realRoot, 'src/base.js')],
            totalFiles: 2,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']]).files).toEqual([
        'src/base.js',
        'src/new.js',
      ]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('pins sparse-gram deltas to the reader manifest epoch', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-pin-'));
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 6, {
        fileId: fileIdFor('src/future.js'),
        filePath: 'src/future.js',
        contentHash: 'future',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });

      const searcher = {
        sparseGramIndexPath: basePath,
        manifestEpoch: 5,
        ...sparseDeltaPin(basePath, 6),
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: ['src/base.js'],
            totalFiles: 1,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']]).files).toEqual(['src/base.js']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('honors the manifest sparse-gram delta allowlist instead of scanning stale segments', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-manifest-deltas-'));
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 7, {
        fileId: fileIdFor('src/listed.js'),
        filePath: 'src/listed.js',
        contentHash: 'listed',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });
      await fs.writeFile(
        path.join(`${basePath}.deltas`, '7-1.ssgrmdelta'),
        JSON.stringify({
          fileId: fileIdFor('src/stale-unlisted.js'),
          filePath: 'src/stale-unlisted.js',
          contentHash: 'stale',
          deleted: false,
          symbolMask: 0,
          weightsId: FALLBACK_WEIGHTS_ID,
          grams: [],
        }) + '\n',
      );
      await fs.writeFile(path.join(tmpDir, 'reconcile-manifest.json'), JSON.stringify({
        epoch: 7,
        sparseGram: {
          base: 'codebase-sparse-grams.idx',
          epoch: 7,
          weightsId: FALLBACK_WEIGHTS_ID,
          deltas: ['codebase-sparse-grams.idx.deltas/7-0.ssgrmdelta'],
        },
      }));

      const searcher = {
        sparseGramIndexPath: basePath,
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: ['src/base.js'],
            totalFiles: 1,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']]).files).toEqual([
        'src/base.js',
        'src/listed.js',
      ]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not scan sparse-gram delta directories without a manifest allowlist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-no-manifest-scan-'));
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 7, {
        fileId: fileIdFor('src/unpublished.js'),
        filePath: 'src/unpublished.js',
        contentHash: 'unpublished',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });

      const searcher = {
        sparseGramIndexPath: basePath,
        manifestEpoch: 7,
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: ['src/base.js'],
            totalFiles: 1,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']]).files).toEqual(['src/base.js']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('honors manifest delta allowlists when the sparse base path is nested', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-nested-manifest-'));
    const artifactDir = path.join(tmpDir, 'artifacts');
    const basePath = path.join(artifactDir, 'codebase-sparse-grams.idx');
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 7, {
        fileId: fileIdFor('src/listed.js'),
        filePath: 'src/listed.js',
        contentHash: 'listed',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });
      await fs.writeFile(
        path.join(`${basePath}.deltas`, '7-1.ssgrmdelta'),
        JSON.stringify({
          fileId: fileIdFor('src/stale-unlisted.js'),
          filePath: 'src/stale-unlisted.js',
          contentHash: 'stale',
          deleted: false,
          symbolMask: 0,
          weightsId: FALLBACK_WEIGHTS_ID,
          grams: [],
        }) + '\n',
      );
      await fs.writeFile(path.join(tmpDir, 'reconcile-manifest.json'), JSON.stringify({
        epoch: 7,
        sparseGram: {
          base: 'artifacts/codebase-sparse-grams.idx',
          epoch: 7,
          weightsId: FALLBACK_WEIGHTS_ID,
          deltas: ['artifacts/codebase-sparse-grams.idx.deltas/7-0.ssgrmdelta'],
        },
      }));

      const searcher = {
        _manifestStateDir: tmpDir,
        sparseGramIndexPath: basePath,
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: ['src/base.js'],
            totalFiles: 1,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']]).files).toEqual([
        'src/base.js',
        'src/listed.js',
      ]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not follow manifest sparse-gram delta paths outside the delta directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-manifest-escape-'));
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    try {
      await fs.mkdir(path.join(tmpDir, 'outside'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'outside', '7-9.ssgrmdelta'),
        JSON.stringify({
          fileId: fileIdFor('src/escaped.js'),
          filePath: 'src/escaped.js',
          contentHash: 'escaped',
          deleted: false,
          symbolMask: 0,
          weightsId: FALLBACK_WEIGHTS_ID,
          grams: [],
        }) + '\n',
      );
      await fs.writeFile(path.join(tmpDir, 'reconcile-manifest.json'), JSON.stringify({
        epoch: 7,
        sparseGram: {
          base: 'codebase-sparse-grams.idx',
          epoch: 7,
          weightsId: FALLBACK_WEIGHTS_ID,
          deltas: ['codebase-sparse-grams.idx.deltas/../outside/7-9.ssgrmdelta'],
        },
      }));

      const searcher = {
        sparseGramIndexPath: basePath,
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: ['src/base.js'],
            totalFiles: 1,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']]).files).toEqual(['src/base.js']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('ignores sparse-gram deltas stamped with a different weightsId than the base manifest', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-weights-'));
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    await fs.writeFile(path.join(tmpDir, 'reconcile-manifest.json'), JSON.stringify({
      epoch: 5,
      sparseGram: { base: 'codebase-sparse-grams.idx', epoch: 5, weightsId: 'base-v2', deltas: [] },
    }));
    try {
      appendDeltaRecord(basePath, 5, {
        fileId: fileIdFor('src/new.js'),
        filePath: 'src/new.js',
        contentHash: 'new',
        deleted: false,
        symbolMask: 0,
        weightsId: 'base-v1',
        grams: [],
      });
      appendDeltaRecord(basePath, 5, {
        fileId: fileIdFor('src/old.js'),
        filePath: 'src/old.js',
        contentHash: '',
        deleted: true,
        symbolMask: 0,
        weightsId: 'base-v1',
        grams: [],
      });

      const searcher = {
        sparseGramIndexPath: basePath,
        manifestEpoch: 5,
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: ['src/old.js', 'src/base.js'],
            totalFiles: 2,
            gramsUsed: 1,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']]).files).toEqual([
        'src/old.js',
        'src/base.js',
      ]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not use sparse deltas as a complete candidate set when the base index is unavailable', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-no-base-'));
    const basePath = path.join(tmpDir, 'missing-sparse-grams.idx');
    try {
      appendDeltaRecord(basePath, 3, {
        fileId: fileIdFor('src/new.js'),
        filePath: 'src/new.js',
        contentHash: 'new',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });

      expect(querySparseGramCandidates({
        sparseGramIndexPath: basePath,
        manifestEpoch: 3,
      }, [['Needle']])).toEqual({
        eligible: false,
        reason: 'not_loaded',
        totalFiles: 0,
        gramsUsed: 0,
        denseGramsTouched: 0,
        sparseGramsTouched: 0,
        candidateFiles: 0,
        files: null,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('falls back instead of returning overlay-only candidates when native sparse narrowing is ineligible', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-ineligible-'));
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.writeFile(basePath, 'base');
    try {
      appendDeltaRecord(basePath, 4, {
        fileId: fileIdFor('src/new.js'),
        filePath: 'src/new.js',
        contentHash: 'new',
        deleted: false,
        symbolMask: 0,
        weightsId: FALLBACK_WEIGHTS_ID,
        grams: [],
      });

      const searcher = {
        sparseGramIndexPath: basePath,
        manifestEpoch: 4,
        ...sparseDeltaPin(basePath, 4),
        sparseGramIndex: {
          queryLiterals: vi.fn().mockReturnValue({
            eligible: false,
            totalFiles: 10,
            files: [],
            gramsUsed: 1,
            denseGramsTouched: 2,
            sparseGramsTouched: 3,
          }),
        },
      };

      expect(querySparseGramCandidates(searcher, [['Needle']])).toEqual({
        eligible: false,
        reason: 'not_eligible',
        totalFiles: 10,
        gramsUsed: 1,
        denseGramsTouched: 2,
        sparseGramsTouched: 3,
        candidateFiles: 0,
        files: null,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips unified native sparse search when deltas must be overlaid', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-sg-e2e-'));
    const srcDir = path.join(tmpDir, 'src');
    const basePath = path.join(tmpDir, 'codebase-sparse-grams.idx');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'new.js'), 'export const freshNeedle = 1;\n');
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

      const searcher = {
        projectRoot: tmpDir,
        sparseGramIndexPath: basePath,
        manifestEpoch: 7,
        ...sparseDeltaPin(basePath, 7),
        sparseGramIndex: {
          searchFull: vi.fn().mockReturnValue({
            eligible: true,
            totalFiles: 1,
            candidateFiles: 0,
            matches: [],
            scannedFiles: 0,
          }),
          queryLiterals: vi.fn().mockReturnValue({
            eligible: true,
            files: [],
            totalFiles: 1,
            gramsUsed: 1,
          }),
          getAllFiles: vi.fn().mockReturnValue([]),
        },
      };

      const result = await generateRegexMatches(searcher, 'freshNeedle', tmpDir, {
        sparseGramIndexPath: basePath,
        lightweightParse: true,
      });

      expect(searcher.sparseGramIndex.searchFull).not.toHaveBeenCalled();
      expect(result.matchingFiles).toEqual(['src/new.js']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// buildChunkLocationMap
// =============================================================================

describe('buildChunkLocationMap', () => {
  function makeLiIndex(docs) {
    return {
      documents: new Map(
        docs.map(d => [d.id, { metadata: d.meta, tokens: new Int8Array(10), numTokens: 1, dim: 10 }])
      ),
    };
  }

  it('builds map with sorted intervals per file', () => {
    const liIndex = makeLiIndex([
      { id: 'c1', meta: { file: 'a.js', startLine: 10, endLine: 20 } },
      { id: 'c2', meta: { file: 'a.js', startLine: 1, endLine: 9 } },
      { id: 'c3', meta: { file: 'b.js', startLine: 5, endLine: 15 } },
    ]);

    const map = buildChunkLocationMap(liIndex);

    expect(map.size).toBe(2);
    expect(map.get('a.js')).toHaveLength(2);
    // Should be sorted by startLine
    expect(map.get('a.js')[0].id).toBe('c2');
    expect(map.get('a.js')[1].id).toBe('c1');
    expect(map.get('b.js')).toHaveLength(1);
  });

  it('skips entries missing startLine or endLine', () => {
    const liIndex = makeLiIndex([
      { id: 'c1', meta: { file: 'a.js', startLine: 1 } },
      { id: 'c2', meta: { file: 'a.js', endLine: 10 } },
      { id: 'c3', meta: { file: 'a.js' } },
      { id: 'c4', meta: { file: 'a.js', startLine: 1, endLine: 10 } },
    ]);

    const map = buildChunkLocationMap(liIndex);

    expect(map.get('a.js')).toHaveLength(1);
    expect(map.get('a.js')[0].id).toBe('c4');
  });

  it('skips entries without file', () => {
    const liIndex = makeLiIndex([
      { id: 'c1', meta: { startLine: 1, endLine: 10 } },
      { id: 'c2', meta: {} },
    ]);

    const map = buildChunkLocationMap(liIndex);
    expect(map.size).toBe(0);
  });

  it('includes alias pointer spans in the chunk location map', () => {
    const liIndex = makeLiIndex([
      { id: 'exemplar', meta: { file: 'src/exemplar.js', startLine: 1, endLine: 5 } },
    ]);
    liIndex.aliasPointers = new Map([
      ['alias', {
        exemplarId: 'exemplar',
        metadata: { file: 'src/alias.js', startLine: 10, endLine: 12, type: 'function', name: 'aliasFn' },
      }],
    ]);

    const map = buildChunkLocationMap(liIndex);

    expect(map.get('src/exemplar.js')?.[0]?.id).toBe('exemplar');
    expect(map.get('src/alias.js')?.[0]).toMatchObject({
      id: 'alias',
      startLine: 10,
      endLine: 12,
      type: 'function',
      name: 'aliasFn',
    });
  });

  it('returns empty map for empty index', () => {
    const liIndex = makeLiIndex([]);
    const map = buildChunkLocationMap(liIndex);
    expect(map.size).toBe(0);
  });
});

// =============================================================================
// findChunkForLine
// =============================================================================

describe('findChunkForLine', () => {
  const intervals = [
    { startLine: 1, endLine: 10, id: 'c1' },
    { startLine: 11, endLine: 25, id: 'c2' },
    { startLine: 30, endLine: 50, id: 'c3' },
    { startLine: 55, endLine: 100, id: 'c4' },
  ];

  it('finds chunk at exact startLine', () => {
    expect(findChunkForLine(intervals, 1)).toBe('c1');
    expect(findChunkForLine(intervals, 11)).toBe('c2');
    expect(findChunkForLine(intervals, 30)).toBe('c3');
    expect(findChunkForLine(intervals, 55)).toBe('c4');
  });

  it('finds chunk at exact endLine', () => {
    expect(findChunkForLine(intervals, 10)).toBe('c1');
    expect(findChunkForLine(intervals, 25)).toBe('c2');
    expect(findChunkForLine(intervals, 50)).toBe('c3');
    expect(findChunkForLine(intervals, 100)).toBe('c4');
  });

  it('finds chunk at midpoint', () => {
    expect(findChunkForLine(intervals, 5)).toBe('c1');
    expect(findChunkForLine(intervals, 18)).toBe('c2');
    expect(findChunkForLine(intervals, 40)).toBe('c3');
    expect(findChunkForLine(intervals, 75)).toBe('c4');
  });

  it('returns null for gap between chunks', () => {
    expect(findChunkForLine(intervals, 27)).toBeNull();
    expect(findChunkForLine(intervals, 52)).toBeNull();
  });

  it('returns null for line before first chunk', () => {
    const gapped = [{ startLine: 5, endLine: 10, id: 'c1' }];
    expect(findChunkForLine(gapped, 1)).toBeNull();
  });

  it('returns null for line after last chunk', () => {
    expect(findChunkForLine(intervals, 101)).toBeNull();
  });

  it('finds a containing parent interval when later overlapping siblings end before the line', () => {
    const overlapping = [
      { startLine: 1, endLine: 100, id: 'parent' },
      { startLine: 20, endLine: 25, id: 'child-a' },
      { startLine: 30, endLine: 35, id: 'child-b' },
    ];

    expect(findChunkForLine(overlapping, 90)).toBe('parent');
    expect(findChunkForLine(overlapping, 22)).toBe('child-a');
  });

  it('returns null for undefined/null/empty intervals', () => {
    expect(findChunkForLine(undefined, 5)).toBeNull();
    expect(findChunkForLine(null, 5)).toBeNull();
    expect(findChunkForLine([], 5)).toBeNull();
  });

  it('works with single-line chunks', () => {
    const singleLine = [
      { startLine: 5, endLine: 5, id: 's1' },
      { startLine: 10, endLine: 10, id: 's2' },
    ];
    expect(findChunkForLine(singleLine, 5)).toBe('s1');
    expect(findChunkForLine(singleLine, 10)).toBe('s2');
    expect(findChunkForLine(singleLine, 7)).toBeNull();
  });
});

// =============================================================================
// mapMatchesToChunks
// =============================================================================

describe('mapMatchesToChunks', () => {
  const locationMap = new Map([
    ['src/auth.js', [
      { startLine: 1, endLine: 20, id: 'auth-c1' },
      { startLine: 21, endLine: 50, id: 'auth-c2' },
    ]],
    ['src/db.js', [
      { startLine: 1, endLine: 100, id: 'db-c1' },
    ]],
  ]);

  it('maps matches to correct chunk IDs', () => {
    const matches = [
      { file: 'src/auth.js', line: 5, content: 'class AuthService {' },
      { file: 'src/auth.js', line: 30, content: 'login()' },
      { file: 'src/db.js', line: 50, content: 'query()' },
    ];

    const { chunkIds, unindexed } = mapMatchesToChunks(matches, locationMap);

    expect(chunkIds.size).toBe(3);
    expect(chunkIds.has('auth-c1')).toBe(true);
    expect(chunkIds.has('auth-c2')).toBe(true);
    expect(chunkIds.has('db-c1')).toBe(true);
    expect(unindexed).toHaveLength(0);
  });

  it('reports unindexed for unknown files', () => {
    const matches = [
      { file: 'src/unknown.js', line: 1, content: 'foo' },
    ];

    const { chunkIds, unindexed } = mapMatchesToChunks(matches, locationMap);

    expect(chunkIds.size).toBe(0);
    expect(unindexed).toHaveLength(1);
    expect(unindexed[0].file).toBe('src/unknown.js');
  });

  it('reports unindexed for lines in gaps', () => {
    const matches = [
      { file: 'src/auth.js', line: 200, content: 'past end' },
    ];

    const { chunkIds, unindexed } = mapMatchesToChunks(matches, locationMap);

    expect(chunkIds.size).toBe(0);
    expect(unindexed).toHaveLength(1);
  });

  it('deduplicates chunk IDs from multiple matches in same chunk', () => {
    const matches = [
      { file: 'src/auth.js', line: 5, content: 'line 5' },
      { file: 'src/auth.js', line: 10, content: 'line 10' },
      { file: 'src/auth.js', line: 15, content: 'line 15' },
    ];

    const { chunkIds } = mapMatchesToChunks(matches, locationMap);

    expect(chunkIds.size).toBe(1);
    expect(chunkIds.has('auth-c1')).toBe(true);
  });

  it('handles empty matches array', () => {
    const { chunkIds, unindexed } = mapMatchesToChunks([], locationMap);
    expect(chunkIds.size).toBe(0);
    expect(unindexed).toHaveLength(0);
  });

  it('handles empty location map', () => {
    const matches = [{ file: 'src/auth.js', line: 5, content: 'foo' }];
    const { chunkIds, unindexed } = mapMatchesToChunks(matches, new Map());
    expect(chunkIds.size).toBe(0);
    expect(unindexed).toHaveLength(1);
  });
});

// =============================================================================
// readFileRange (with per-search file cache)
// =============================================================================

describe('readFileRange', () => {
  it('reads lines from a real file', () => {
    const cache = new Map();
    // Read line 1 of this test file
    const thisFile = path.resolve(import.meta.dirname, 'search-pattern.test.js');
    const result = readFileRange(cache, thisFile, 1, 3);
    expect(result).toContain('Pattern Search');
    // Cache should have been populated
    expect(cache.size).toBe(1);
  });

  it('caches file reads — second call uses cache', () => {
    const cache = new Map();
    const thisFile = path.resolve(import.meta.dirname, 'search-pattern.test.js');

    const result1 = readFileRange(cache, thisFile, 1, 1);
    const result2 = readFileRange(cache, thisFile, 2, 2);

    // Both succeed, cache only has one entry (same file)
    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
    expect(cache.size).toBe(1);
  });

  it('returns null for non-existent file', () => {
    const cache = new Map();
    const result = readFileRange(cache, '/nonexistent/file.js', 1, 1);
    expect(result).toBeNull();
  });
});

// =============================================================================
// getChunkLocationMap (cached on this)
// =============================================================================

describe('getChunkLocationMap', () => {
  it('builds map on first call and caches it', () => {
    const mockThis = {
      lateInteractionIndex: {
        documents: new Map([
          ['c1', { metadata: { file: 'a.js', startLine: 1, endLine: 10 } }],
        ]),
      },
    };

    const map1 = getChunkLocationMap.call(mockThis);
    expect(map1.size).toBe(1);
    expect(mockThis._chunkLocationMap).toBe(map1);

    // Second call returns cached
    const map2 = getChunkLocationMap.call(mockThis);
    expect(map2).toBe(map1);
  });

  it('rebuilds when document count changes', () => {
    const docs = new Map([
      ['c1', { metadata: { file: 'a.js', startLine: 1, endLine: 10 } }],
    ]);
    const mockThis = {
      lateInteractionIndex: { documents: docs },
    };

    const map1 = getChunkLocationMap.call(mockThis);
    expect(map1.size).toBe(1);

    // Add a document — should rebuild
    docs.set('c2', { metadata: { file: 'b.js', startLine: 1, endLine: 5 } });
    const map2 = getChunkLocationMap.call(mockThis);
    expect(map2).not.toBe(map1);
    expect(map2.size).toBe(2);
  });

  it('rebuilds when alias pointer count changes without a new token document', () => {
    const docs = new Map([
      ['c1', { metadata: { file: 'a.js', startLine: 1, endLine: 10 } }],
    ]);
    const aliases = new Map();
    const mockThis = {
      lateInteractionIndex: { documents: docs, aliasPointers: aliases },
    };

    const map1 = getChunkLocationMap.call(mockThis);
    expect(map1.has('alias.js')).toBe(false);

    aliases.set('alias-c1', {
      targetId: 'c1',
      metadata: { file: 'alias.js', startLine: 20, endLine: 25 },
    });
    const map2 = getChunkLocationMap.call(mockThis);

    expect(map2).not.toBe(map1);
    expect(map2.get('alias.js')?.[0]?.id).toBe('alias-c1');
  });

  it('rebuilds when the late-interaction index object changes with the same document count', () => {
    const firstIndex = {
      documents: new Map([
        ['old', { metadata: { file: 'old.js', startLine: 1, endLine: 10 } }],
      ]),
    };
    const secondIndex = {
      documents: new Map([
        ['new', { metadata: { file: 'new.js', startLine: 20, endLine: 30 } }],
      ]),
    };
    const mockThis = {
      lateInteractionIndex: firstIndex,
    };

    const map1 = getChunkLocationMap.call(mockThis);
    expect(map1.get('old.js')?.[0]?.id).toBe('old');

    mockThis.lateInteractionIndex = secondIndex;
    const map2 = getChunkLocationMap.call(mockThis);

    expect(map2).not.toBe(map1);
    expect(map2.has('old.js')).toBe(false);
    expect(map2.get('new.js')?.[0]?.id).toBe('new');
  });
});

// =============================================================================
// isRipgrepAvailable (race-safe)
// =============================================================================

describe('isRipgrepAvailable', () => {
  beforeEach(() => {
    _resetRgCache();
  });

  it('returns a boolean', async () => {
    const result = await isRipgrepAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('returns same promise on concurrent calls', () => {
    const p1 = isRipgrepAvailable();
    const p2 = isRipgrepAvailable();
    // Same promise object — no double spawn
    expect(p1).toBe(p2);
  });
});

// =============================================================================
// patternSearch (prototype-bound, tested via .call with mocked deps)
// =============================================================================

// Resolve rg availability once (top-level await is fine in ESM)
const rgAvailable = await isRipgrepAvailable();

describe('patternSearch', () => {
  it('throws if regex is not provided', async () => {
    const mockThis = { verbose: false };
    await expect(
      patternSearch.call(mockThis, 'auth', null, {})
    ).rejects.toThrow('requires a regex');
  });

  it('throws if regex is empty string', async () => {
    const mockThis = { verbose: false };
    await expect(
      patternSearch.call(mockThis, 'auth', null, { regex: '' })
    ).rejects.toThrow('requires a regex');
  });

  it('throws if LI index not available', async () => {
    const mockThis = {
      verbose: false,
      hasLateInteractionIndex: false,
    };
    await expect(
      patternSearch.call(mockThis, 'auth', null, { regex: 'class.*' })
    ).rejects.toThrow('late interaction index');
  });

  // WAS "fails fast when the LI index lacks line span metadata" — it asserted a throw that
  // was removed on 2026-09-02. Crashing here is the one answer an agent cannot act on: the
  // index it was handed is the only index it has, and it cannot re-index the repository
  // mid-task. It fired on mathnet in the fresh pool. getChunkLocationMap now rebuilds the
  // spans from the codebase vector rows; when even that is empty every match routes to the
  // unindexed path and the agent still gets its grep results, unranked.
  it.skipIf(!rgAvailable)('degrades to unranked results when no chunk line spans exist', async () => {
    const mockThis = {
      verbose: false,
      hasLateInteractionIndex: true,
      lateInteractionIndex: {
        documents: new Map([
          ['c1', { metadata: { file: 'a.js' }, tokens: new Int8Array(10), numTokens: 1, dim: 10, min: 0, scale: 1 }],
        ]),
        aliasPointers: new Map(),
        init: vi.fn(),
        hasTokens: () => new Set(),
      },
      getChunkLocationMap() {
        return new Map();
      },
    };

    const result = await patternSearch.call(mockThis, 'auth', null, { regex: 'class.*', k: 5 });
    expect(result).toBeTruthy();
    expect(Array.isArray(result.results)).toBe(true);
    // Nothing could be ranked, so nothing claims to be indexed.
    expect(result.results.every(r => !r.indexed)).toBe(true);
  });

  it.skipIf(!rgAvailable)('returns empty results when grep finds no matches', async () => {
    // This tests the full pipeline with a regex that won't match anything
    const regex = ['ZZZZNOTFOUND', 'XYZZY', 'NEVERMATCHES', '42'].join('_');
    const mockLiIndex = {
      documents: new Map([
        ['c1', { metadata: { file: 'a.js', startLine: 1, endLine: 10 }, tokens: new Int8Array(10), numTokens: 1, dim: 10, min: 0, scale: 1 }],
      ]),
      init: vi.fn(),
      hasTokens: vi.fn().mockReturnValue(new Set()),
      scoreWithLateInteraction: vi.fn().mockResolvedValue([]),
    };

    const mockThis = {
      verbose: false,
      hasLateInteractionIndex: true,
      lateInteractionIndex: mockLiIndex,
      _chunkLocationMap: null,
      _chunkLocationMapSize: 0,
      getChunkLocationMap,
    };

    // Use a regex that won't match any file in the project
    const result = await patternSearch.call(
      mockThis, 'some query', null,
      { regex, k: 5 }
    );

    expect(result.results).toEqual([]);
    expect(result.stats.path).toBe('pattern');
    expect(result.stats.grepMatches).toBe(0);
    // 120 s of PATIENCE, no weakened assertion: this case runs a real ripgrep
    // over the WHOLE repository looking for a pattern that cannot match, so it
    // pays for a full scan every time. In a ~170-file worker pool that shares
    // CPU with several process-spawning integration files, the 30 s default was
    // a coin flip; alone it finishes in a couple of seconds.
  }, 120_000);

  it.skipIf(!rgAvailable)('returns results with correct stats shape', async () => {
    const regex = ['ZZZZNOTFOUND', 'XYZZY', '42'].join('_');
    const mockLiIndex = {
      documents: new Map([
        ['c1', { metadata: { file: 'a.js', startLine: 1, endLine: 10 }, tokens: new Int8Array(10), numTokens: 1, dim: 10, min: 0, scale: 1 }],
      ]),
      init: vi.fn(),
      hasTokens: vi.fn().mockReturnValue(new Set()),
      scoreWithLateInteraction: vi.fn().mockResolvedValue([]),
    };

    const mockThis = {
      verbose: false,
      hasLateInteractionIndex: true,
      lateInteractionIndex: mockLiIndex,
      _chunkLocationMap: null,
      _chunkLocationMapSize: 0,
      getChunkLocationMap,
    };

    const result = await patternSearch.call(
      mockThis, 'query', null,
      { regex, k: 5 }
    );

    // Verify stats shape
    expect(result.stats).toHaveProperty('path', 'pattern');
    expect(result.stats).toHaveProperty('regex');
    expect(result.stats).toHaveProperty('grepMatches');
    expect(result.stats).toHaveProperty('candidateGenTime_ms');
    expect(result.stats).toHaveProperty('grepTime_ms');
    expect(result.stats).toHaveProperty('literalFilterTime_ms');
    expect(result.stats).toHaveProperty('gramLookupTime_ms');
    expect(result.stats).toHaveProperty('encodeTime_ms');
    expect(result.stats).toHaveProperty('filesConsidered');
    expect(result.stats).toHaveProperty('filesScanned');
    expect(result.stats).toHaveProperty('filesSkipped');
    expect(result.stats).toHaveProperty('dirtyOverlayFiles');
    expect(result.stats).toHaveProperty('candidateFilesBeforeFilter');
    expect(result.stats).toHaveProperty('candidateFilesAfterFilter');
    expect(result.stats).toHaveProperty('candidateReductionRatio');
    expect(result.stats).toHaveProperty('literalExtractionHit');
    expect(result.stats).toHaveProperty('gramLookupReason');
    expect(result.stats).toHaveProperty('parallelTime_ms');
    expect(result.stats).toHaveProperty('total_ms');
    expect(typeof result.stats.total_ms).toBe('number');
  });
});

describe('bareGrep', () => {
  it('throws if regex is not provided', async () => {
    await expect(
      bareGrep.call({ projectRoot: process.cwd() }, '', null, {})
    ).rejects.toThrow('requires a regex');
  });

  it.skipIf(!rgAvailable)('returns empty grep results when no files match', async () => {
    const impossiblePattern = ['ZZZZ', 'UNLIKELY', 'MATCH', 'PATTERN', 'QXJ_7319'].join('__');
    const result = await bareGrep.call(
      { projectRoot: process.cwd(), sparseGramIndex: null },
      impossiblePattern,
      null,
      { regex: impossiblePattern, maxMatches: 10 }
    );

    expect(result.results).toEqual([]);
    expect(result.stats.path).toBe('grep');
    expect(result.stats.totalMatches).toBe(0);
  });

  it.skipIf(!rgAvailable)('matches raw ripgrep on the same corpus', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-grep-'));
    try {
      await fs.writeFile(path.join(tmpDir, 'a.js'), 'class AuthService {}\nconst x = new AuthService();\n');
      await fs.writeFile(path.join(tmpDir, 'b.js'), 'const y = 1;\n');

      const regex = 'AuthService';
      const grepResult = await bareGrep.call(
        { projectRoot: tmpDir, sparseGramIndex: null },
        regex,
        null,
        { regex, gramIndex: false }
      );
      const rgMatches = await runRipgrep(regex, tmpDir, { maxMatches: 0 });

      const grepKeys = grepResult.results.map(r => `${r.file}:${r.line}:${r.column}`);
      const rgKeys = rgMatches.map(r => `${r.file}:${r.line}:${r.column || 1}`);

      expect(grepKeys).toEqual(rgKeys);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it.skipIf(!rgAvailable)('filters grep results by symbol type using indexed chunk metadata', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-grep-type-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'a.js'),
        'function authHandler() {}\nconst authValue = authHandler();\nclass AuthBox {}\n'
      );

      const mockRepo = {
        iterateVectors: function* () {
          yield {
            file_path: 'a.js',
            metadata: JSON.stringify({
              type: 'function',
              name: 'authHandler',
              startLine: 1,
              endLine: 2,
            }),
          };
          yield {
            file_path: 'a.js',
            metadata: JSON.stringify({
              type: 'class',
              name: 'AuthBox',
              startLine: 3,
              endLine: 3,
            }),
          };
        },
      };

      const grepResult = await bareGrep.call(
        {
          projectRoot: tmpDir,
          sparseGramIndex: null,
          codebaseRepo: mockRepo,
        },
        'Auth',
        null,
        { regex: 'Auth', gramIndex: false, type: 'class' }
      );

      expect(grepResult.results).toHaveLength(1);
      expect(grepResult.results[0].line).toBe(3);
      expect(grepResult.stats.symbolType).toBe('class');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// chunkRipgrepFiles
// =============================================================================

describe('chunkRipgrepFiles', () => {
  it('returns empty array for empty input', () => {
    expect(chunkRipgrepFiles([])).toEqual([]);
  });

  it('returns single batch for array under 500 files', () => {
    const files = Array.from({ length: 100 }, (_, i) => `src/file-${i}.js`);
    const batches = chunkRipgrepFiles(files);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(100);
  });

  it('returns single batch for exactly 500 files', () => {
    const files = Array.from({ length: 500 }, (_, i) => `src/file-${i}.js`);
    const batches = chunkRipgrepFiles(files);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(500);
  });

  it('returns two batches for 501 files', () => {
    const files = Array.from({ length: 501 }, (_, i) => `src/file-${i}.js`);
    const batches = chunkRipgrepFiles(files);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toHaveLength(1);
  });

  it('splits on byte limit before file count limit for very long paths', () => {
    // Each path is ~1KB, so 96KB limit is hit around 96 files
    const longSegment = 'a'.repeat(1000);
    const files = Array.from({ length: 200 }, (_, i) => `${longSegment}/file-${i}.js`);
    const batches = chunkRipgrepFiles(files);
    expect(batches.length).toBeGreaterThan(1);
    // First batch should have fewer than 500 files (byte limit hit first)
    expect(batches[0].length).toBeLessThan(500);
  });

  it('never splits a single file across batches', () => {
    const files = ['src/a.js'];
    const batches = chunkRipgrepFiles(files);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(['src/a.js']);
  });

  it('preserves all files across batches', () => {
    const files = Array.from({ length: 1200 }, (_, i) => `src/file-${i}.js`);
    const batches = chunkRipgrepFiles(files);
    const allFiles = batches.flat();
    expect(allFiles).toEqual(files);
  });
});

// =============================================================================
// normalizeLiteralClauses
// =============================================================================

describe('normalizeLiteralClauses', () => {
  it('returns empty array for null input', () => {
    expect(normalizeLiteralClauses(null)).toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    expect(normalizeLiteralClauses(undefined)).toEqual([]);
  });

  it('filters out literals shorter than 3 chars', () => {
    const result = normalizeLiteralClauses([['ab', 'abc', 'a']]);
    expect(result).toEqual([['abc']]);
  });

  it('deduplicates identical literals within a clause', () => {
    const result = normalizeLiteralClauses([['auth', 'auth', 'service']]);
    expect(result).toEqual([['auth', 'service']]);
  });

  it('deduplicates identical clauses across the array', () => {
    const result = normalizeLiteralClauses([
      ['auth', 'service'],
      ['auth', 'service'],
      ['other', 'clause'],
    ]);
    expect(result).toEqual([
      ['auth', 'service'],
      ['other', 'clause'],
    ]);
  });

  it('trims whitespace from literals', () => {
    const result = normalizeLiteralClauses([['  auth  ', '  service  ']]);
    expect(result).toEqual([['auth', 'service']]);
  });

  it('rejects non-string elements', () => {
    const result = normalizeLiteralClauses([[42, null, undefined, 'valid']]);
    expect(result).toEqual([['valid']]);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeLiteralClauses('not-an-array')).toEqual([]);
    expect(normalizeLiteralClauses(42)).toEqual([]);
  });

  it('skips non-array clauses', () => {
    const result = normalizeLiteralClauses(['not-a-clause', ['valid', 'clause']]);
    expect(result).toEqual([['valid', 'clause']]);
  });
});

// =============================================================================
// extractRegexTokens
// =============================================================================

describe('extractRegexTokens', () => {
  it('extracts readable tokens from class regex', () => {
    expect(extractRegexTokens('class\\s+\\w+')).toEqual(['class']);
  });

  it('extracts multiple tokens from export async function regex', () => {
    expect(extractRegexTokens('export async function\\s+\\w+')).toEqual([
      'export',
      'async',
      'function',
    ]);
  });

  it('extracts tokens from alternation', () => {
    expect(extractRegexTokens('foo|bar')).toEqual(['foo', 'bar']);
  });

  it('returns empty array for wildcard-only pattern', () => {
    expect(extractRegexTokens('.*')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractRegexTokens('')).toEqual([]);
  });

  it('drops single-character tokens', () => {
    // 'x' is single char, should be dropped
    expect(extractRegexTokens('x\\s+longtoken')).toEqual(['longtoken']);
  });
});

// =============================================================================
// mergeRegexIntoQuery
// =============================================================================

describe('mergeRegexIntoQuery', () => {
  it('appends novel tokens from regex to query', () => {
    const result = mergeRegexIntoQuery('find auth', 'class\\s+Service\\w+');
    expect(result).toContain('find auth');
    expect(result).toContain('class');
    expect(result).toContain('service');
  });

  it('does not duplicate tokens already in query', () => {
    const result = mergeRegexIntoQuery('class service', 'class\\s+Service\\w+');
    // Both 'class' and 'service' already in query
    expect(result).toBe('class service');
  });

  it('returns original query when regex yields no tokens', () => {
    const result = mergeRegexIntoQuery('my query', '.*');
    expect(result).toBe('my query');
  });

  it('appends only novel tokens', () => {
    const result = mergeRegexIntoQuery('find class', 'class\\s+Service\\w+');
    // 'class' already present, 'service' is novel
    expect(result).toContain('find class');
    expect(result).toContain('service');
    expect(result).not.toMatch(/class.*class/); // no duplication
  });
});

// =============================================================================
// resolveSparseSymbolMask
// =============================================================================

describe('resolveSparseSymbolMask', () => {
  it('returns correct bit for function', () => {
    expect(resolveSparseSymbolMask('function')).toBe(SPARSE_SYMBOL_MASKS.function);
  });

  it('returns correct bit for class', () => {
    expect(resolveSparseSymbolMask('class')).toBe(SPARSE_SYMBOL_MASKS.class);
  });

  it('returns correct bit for method', () => {
    expect(resolveSparseSymbolMask('method')).toBe(SPARSE_SYMBOL_MASKS.method);
  });

  it('returns correct bit for import', () => {
    expect(resolveSparseSymbolMask('import')).toBe(SPARSE_SYMBOL_MASKS.import);
  });

  it('returns correct bit for type', () => {
    expect(resolveSparseSymbolMask('type')).toBe(SPARSE_SYMBOL_MASKS.type);
  });

  it('returns correct bit for interface', () => {
    expect(resolveSparseSymbolMask('interface')).toBe(SPARSE_SYMBOL_MASKS.type);
  });

  it('returns correct bit for enum', () => {
    expect(resolveSparseSymbolMask('enum')).toBe(SPARSE_SYMBOL_MASKS.type);
  });

  it('returns correct bit for typedef', () => {
    expect(resolveSparseSymbolMask('typedef')).toBe(SPARSE_SYMBOL_MASKS.type);
  });

  it('returns correct bit for other', () => {
    expect(resolveSparseSymbolMask('other')).toBe(SPARSE_SYMBOL_MASKS.other);
  });

  it('returns correct bit for unknown string (falls through to other)', () => {
    expect(resolveSparseSymbolMask('variable')).toBe(SPARSE_SYMBOL_MASKS.other);
  });

  it('returns 0 for empty string', () => {
    expect(resolveSparseSymbolMask('')).toBe(0);
  });

  it('returns 0 for non-string input (number)', () => {
    expect(resolveSparseSymbolMask(42)).toBe(0);
  });

  it('returns 0 for non-string input (null)', () => {
    expect(resolveSparseSymbolMask(null)).toBe(0);
  });

  it('returns 0 for non-string input (undefined)', () => {
    expect(resolveSparseSymbolMask(undefined)).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(resolveSparseSymbolMask('Function')).toBe(SPARSE_SYMBOL_MASKS.function);
    expect(resolveSparseSymbolMask('CLASS')).toBe(SPARSE_SYMBOL_MASKS.class);
  });

  it('handles whitespace-padded input', () => {
    expect(resolveSparseSymbolMask('  function  ')).toBe(SPARSE_SYMBOL_MASKS.function);
  });
});

// =============================================================================
// isRipgrepCodePath
// =============================================================================

describe('isRipgrepCodePath', () => {
  it('returns true for .js files', () => {
    expect(isRipgrepCodePath('src/app.js')).toBe(true);
  });

  it('returns true for .ts files', () => {
    expect(isRipgrepCodePath('lib/index.ts')).toBe(true);
  });

  it('returns true for .py files', () => {
    expect(isRipgrepCodePath('scripts/run.py')).toBe(true);
  });

  it('returns true for .rs files', () => {
    expect(isRipgrepCodePath('src/lib.rs')).toBe(true);
  });

  it('returns false for .md files', () => {
    expect(isRipgrepCodePath('docs/README.md')).toBe(false);
  });

  it('returns false for .png files', () => {
    expect(isRipgrepCodePath('assets/logo.png')).toBe(false);
  });

  it('returns false for .bin files', () => {
    expect(isRipgrepCodePath('data/file.bin')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isRipgrepCodePath('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isRipgrepCodePath(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRipgrepCodePath(undefined)).toBe(false);
  });
});

// =============================================================================
// normalizeSearchPath
// =============================================================================

describe('normalizeSearchPath', () => {
  it('returns null for empty/null path', () => {
    expect(normalizeSearchPath('/project', '')).toBeNull();
    expect(normalizeSearchPath('/project', null)).toBeNull();
    expect(normalizeSearchPath('/project', undefined)).toBeNull();
  });

  it('passes through relative path', () => {
    expect(normalizeSearchPath('/project', 'src/auth.js')).toBe('src/auth.js');
  });

  it('makes absolute path relative to searchDir', () => {
    expect(normalizeSearchPath('/project', '/project/src/auth.js')).toBe('src/auth.js');
  });

  it('strips leading ./', () => {
    expect(normalizeSearchPath('/project', './src/auth.js')).toBe('src/auth.js');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizeSearchPath('/project', 'src\\auth\\service.js')).toBe('src/auth/service.js');
  });

  it('normalizes absolute paths that use the realpath spelling of a symlinked search root', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-normalize-'));
    try {
      const realRoot = path.join(base, 'real');
      const linkRoot = path.join(base, 'link');
      await fs.mkdir(path.join(realRoot, 'src'), { recursive: true });
      await fs.writeFile(path.join(realRoot, 'src', 'auth.js'), 'export const auth = true;\n');
      fsSync.symlinkSync(realRoot, linkRoot, 'dir');

      expect(normalizeSearchPath(linkRoot, path.join(realRoot, 'src', 'auth.js'))).toBe('src/auth.js');
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
