import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = path.join(os.tmpdir(), `sweet-search-indexer-phases-${process.pid}`);
const lateInteractionPath = path.join(tmpRoot, 'codebase-late-interaction.db');

const mockBuildVectorIndex = vi.fn();
const mockChunkFiles = vi.fn();
const mockBuildHNSWIndex = vi.fn();
const mockIncrementalUpdateHNSW = vi.fn();
const mockBuildLateInteractionIndex = vi.fn();
const mockBuildQuantizedArtifactsPhase = vi.fn();

vi.mock('../core/config.js', () => ({
  DB_PATHS: {
    lateInteraction: lateInteractionPath,
  },
  PROJECT_ROOT: process.cwd(),
  EMBEDDING_CONFIG: {
    parallelLateInteraction: true,
  },
}));

vi.mock('../core/indexer-build.js', () => ({
  buildCodeGraph: vi.fn(),
  buildVectorIndex: mockBuildVectorIndex,
  chunkFiles: mockChunkFiles,
}));

vi.mock('../core/indexer-ann.js', () => ({
  incrementalUpdateHNSW: mockIncrementalUpdateHNSW,
  buildHNSWIndex: mockBuildHNSWIndex,
  buildLateInteractionIndex: mockBuildLateInteractionIndex,
  buildQuantizedArtifactsPhase: mockBuildQuantizedArtifactsPhase,
}));

vi.mock('../core/incremental-tracker.js', () => ({
  getChangedFiles: vi.fn(),
  updateState: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock('../core/summary-manager.js', () => ({
  backupSummaries: vi.fn(),
  restoreSummaries: vi.fn(),
  markForRegeneration: vi.fn(),
}));

describe('buildVectorsAndArtifactsPhase', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(tmpRoot, { recursive: true });
    await fs.writeFile(lateInteractionPath, 'old-li-index');

    mockChunkFiles.mockResolvedValue({
      allChunks: [{ id: 'chunk-1', file: 'src/a.ts', text: 'x', metadata: {} }],
      texts: ['x'],
    });
    mockBuildVectorIndex.mockResolvedValue({
      chunks: 1,
      embeddings: 1,
      allChunks: [{ id: 'chunk-1', file: 'src/a.ts', text: 'x', metadata: {} }],
      allEmbeddings: [[0.1, 0.2]],
    });
    mockBuildLateInteractionIndex.mockImplementation(async (_chunks, _dryRun, _filesToRemove, options = {}) => {
      await fs.writeFile(options.saveToPath, 'new-li-index');
      return { documents: 1, saveToPath: options.saveToPath };
    });
    mockBuildHNSWIndex.mockResolvedValue(undefined);
    mockIncrementalUpdateHNSW.mockResolvedValue(undefined);
    mockBuildQuantizedArtifactsPhase.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('does not promote staged LI index when vector build fails', async () => {
    mockBuildVectorIndex.mockRejectedValueOnce(new Error('vector boom'));

    const { buildVectorsAndArtifactsPhase } = await import('../core/indexer-phases.js');

    await expect(buildVectorsAndArtifactsPhase({
      filesToIndex: ['src/a.ts'],
      dryRun: false,
      fullReindex: true,
      incrementalInfo: null,
      forceArtifacts: false,
      hcgsPromise: null,
      noLateInteraction: false,
      lateInteractionPool: 1,
      lateInteractionExtendedSkiplist: false,
      sqliteFastMode: false,
    })).rejects.toThrow('vector boom');

    await expect(fs.readFile(lateInteractionPath, 'utf8')).resolves.toBe('old-li-index');
    await expect(fs.access(lateInteractionPath + '.tmp')).rejects.toThrow();
  });

  it('invalidates existing LI index when LI rebuild fails after vector success', async () => {
    mockBuildLateInteractionIndex.mockRejectedValueOnce(new Error('li boom'));

    const { buildVectorsAndArtifactsPhase } = await import('../core/indexer-phases.js');

    const result = await buildVectorsAndArtifactsPhase({
      filesToIndex: ['src/a.ts'],
      dryRun: false,
      fullReindex: true,
      incrementalInfo: null,
      forceArtifacts: false,
      hcgsPromise: null,
      noLateInteraction: false,
      lateInteractionPool: 1,
      lateInteractionExtendedSkiplist: false,
      sqliteFastMode: false,
    });

    expect(result.lateInteractionResult).toEqual({
      error: 'li boom',
      invalidated: true,
    });
    await expect(fs.access(lateInteractionPath)).rejects.toThrow();
    await expect(fs.access(lateInteractionPath + '.tmp')).rejects.toThrow();
  });

  it('promotes staged LI index only after vector and HNSW succeed', async () => {
    const { buildVectorsAndArtifactsPhase } = await import('../core/indexer-phases.js');

    const result = await buildVectorsAndArtifactsPhase({
      filesToIndex: ['src/a.ts'],
      dryRun: false,
      fullReindex: true,
      incrementalInfo: null,
      forceArtifacts: false,
      hcgsPromise: null,
      noLateInteraction: false,
      lateInteractionPool: 1,
      lateInteractionExtendedSkiplist: false,
      sqliteFastMode: false,
    });

    expect(result.lateInteractionResult).toEqual({
      documents: 1,
      saveToPath: lateInteractionPath + '.tmp',
    });
    await expect(fs.readFile(lateInteractionPath, 'utf8')).resolves.toBe('new-li-index');
    await expect(fs.access(lateInteractionPath + '.tmp')).rejects.toThrow();
  });
});
