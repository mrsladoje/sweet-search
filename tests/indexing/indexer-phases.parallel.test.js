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

<<<<<<< Updated upstream
vi.mock('../../core/config.js', () => ({
  DB_PATHS: {
    lateInteraction: lateInteractionPath,
=======
vi.mock('../../core/config.js', () => ({
  DB_PATHS: {
    lateInteraction: lateInteractionPath,
    vocabulary: path.join(tmpRoot, 'query-vocabulary.json'),
    codebase: path.join(tmpRoot, 'codebase.db'),
    codeGraph: path.join(tmpRoot, 'code-graph.db'),
    hnswIndex: path.join(tmpRoot, 'codebase-hnsw.idx'),
    binaryHnswIndex: path.join(tmpRoot, 'codebase-binary-hnsw.idx'),
    translationCache: path.join(tmpRoot, 'translation-cache.json'),
>>>>>>> Stashed changes
  },
  PROJECT_ROOT: process.cwd(),
  EMBEDDING_CONFIG: {
    parallelLateInteraction: true,
  },
<<<<<<< Updated upstream
}));

vi.mock('../../core/indexer-build.js', () => ({
  buildCodeGraph: vi.fn(),
  buildVectorIndex: mockBuildVectorIndex,
  chunkFiles: mockChunkFiles,
}));

vi.mock('../../core/indexer-ann.js', () => ({
  incrementalUpdateHNSW: mockIncrementalUpdateHNSW,
  buildHNSWIndex: mockBuildHNSWIndex,
  buildLateInteractionIndex: mockBuildLateInteractionIndex,
  buildQuantizedArtifactsPhase: mockBuildQuantizedArtifactsPhase,
}));

vi.mock('../../core/incremental-tracker.js', () => ({
  getChangedFiles: vi.fn(),
  updateState: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock('../../core/summary-manager.js', () => ({
  backupSummaries: vi.fn(),
  restoreSummaries: vi.fn(),
  markForRegeneration: vi.fn(),
=======
  EMBEDDING_PROVIDERS: {
    voyage: { enabled: false, priority: 1, rateLimit: { requestsPerMinute: 300, tokensPerMinute: 1000000, maxRetries: 3, retryDelay: 1000, backoffMultiplier: 2 } },
    mistral: { enabled: false, priority: 2, rateLimit: { requestsPerMinute: 100, maxRetries: 3, retryDelay: 1000, backoffMultiplier: 2 } },
    jina: { enabled: false, priority: 3, rateLimit: { requestsPerMinute: 500, maxRetries: 3, retryDelay: 500, backoffMultiplier: 2 } },
    local: { enabled: true, priority: 99 },
  },
  LATE_INTERACTION_CONFIG: { enabled: true, model: 'lateon-code' },
  HNSW_CONFIG: { dimension: 512, M: 16, efConstruction: 200, efSearch: 100, metric: 'cosine', maxElements: 100000 },
  BINARY_HNSW_CONFIG: { dimension: 64, M: 64, efConstruction: 800, efSearch: 400, metric: 'hamming', maxElements: 500000 },
  LOGGING: { verbose: false, timing: false, debug: false },
  setQuietMode: () => {},
  isQuietMode: () => false,
}));
vi.mock('../../core/infrastructure/config/index.js', () => ({
  DB_PATHS: {
    lateInteraction: lateInteractionPath,
    vocabulary: path.join(tmpRoot, 'query-vocabulary.json'),
    codebase: path.join(tmpRoot, 'codebase.db'),
    codeGraph: path.join(tmpRoot, 'code-graph.db'),
    hnswIndex: path.join(tmpRoot, 'codebase-hnsw.idx'),
    binaryHnswIndex: path.join(tmpRoot, 'codebase-binary-hnsw.idx'),
    translationCache: path.join(tmpRoot, 'translation-cache.json'),
  },
  PROJECT_ROOT: process.cwd(),
  EMBEDDING_CONFIG: {
    parallelLateInteraction: true,
  },
  EMBEDDING_PROVIDERS: {
    voyage: { enabled: false, priority: 1, rateLimit: { requestsPerMinute: 300, tokensPerMinute: 1000000, maxRetries: 3, retryDelay: 1000, backoffMultiplier: 2 } },
    mistral: { enabled: false, priority: 2, rateLimit: { requestsPerMinute: 100, maxRetries: 3, retryDelay: 1000, backoffMultiplier: 2 } },
    jina: { enabled: false, priority: 3, rateLimit: { requestsPerMinute: 500, maxRetries: 3, retryDelay: 500, backoffMultiplier: 2 } },
    local: { enabled: true, priority: 99 },
  },
  LATE_INTERACTION_CONFIG: { enabled: true, model: 'lateon-code' },
  HNSW_CONFIG: { dimension: 512, M: 16, efConstruction: 200, efSearch: 100, metric: 'cosine', maxElements: 100000 },
  BINARY_HNSW_CONFIG: { dimension: 64, M: 64, efConstruction: 800, efSearch: 400, metric: 'hamming', maxElements: 500000 },
  LOGGING: { verbose: false, timing: false, debug: false },
  setQuietMode: () => {},
  isQuietMode: () => false,
}));

vi.mock('../../core/indexer-build.js', () => ({
  buildCodeGraph: vi.fn(), buildVectorIndex: mockBuildVectorIndex, chunkFiles: mockChunkFiles,
}));
vi.mock('../../core/indexing/indexer-build.js', () => ({
  buildCodeGraph: vi.fn(), buildVectorIndex: mockBuildVectorIndex, chunkFiles: mockChunkFiles,
}));

vi.mock('../../core/indexer-ann.js', () => ({
  incrementalUpdateHNSW: mockIncrementalUpdateHNSW, buildHNSWIndex: mockBuildHNSWIndex,
  buildLateInteractionIndex: mockBuildLateInteractionIndex, buildQuantizedArtifactsPhase: mockBuildQuantizedArtifactsPhase,
}));
vi.mock('../../core/indexing/indexer-ann.js', () => ({
  incrementalUpdateHNSW: mockIncrementalUpdateHNSW, buildHNSWIndex: mockBuildHNSWIndex,
  buildLateInteractionIndex: mockBuildLateInteractionIndex, buildQuantizedArtifactsPhase: mockBuildQuantizedArtifactsPhase,
}));

vi.mock('../../core/incremental-tracker.js', () => ({
  getChangedFiles: vi.fn(), updateState: vi.fn(), getStats: vi.fn(),
}));
vi.mock('../../core/indexing/incremental-tracker.js', () => ({
  getChangedFiles: vi.fn(), updateState: vi.fn(), getStats: vi.fn(),
}));

vi.mock('../../core/summary-manager.js', () => ({
  backupSummaries: vi.fn(), restoreSummaries: vi.fn(), markForRegeneration: vi.fn(),
}));
vi.mock('../../core/graph/summary-manager.js', () => ({
  backupSummaries: vi.fn(), restoreSummaries: vi.fn(), markForRegeneration: vi.fn(),
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
    const { buildVectorsAndArtifactsPhase } = await import('../../core/indexer-phases.js');
=======
    const { buildVectorsAndArtifactsPhase } = await import('../../core/indexing/indexer-phases.js');
>>>>>>> Stashed changes

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

<<<<<<< Updated upstream
    const { buildVectorsAndArtifactsPhase } = await import('../../core/indexer-phases.js');
=======
    const { buildVectorsAndArtifactsPhase } = await import('../../core/indexing/indexer-phases.js');
>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
    const { buildVectorsAndArtifactsPhase } = await import('../../core/indexer-phases.js');
=======
    const { buildVectorsAndArtifactsPhase } = await import('../../core/indexing/indexer-phases.js');
>>>>>>> Stashed changes

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
