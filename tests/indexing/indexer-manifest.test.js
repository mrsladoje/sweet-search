import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultIndexerManifestPaths,
  publishIndexerManifest,
} from '../../core/indexing/indexer-manifest.js';
import { updateIncrementalStatePhase } from '../../core/indexing/indexer-phases.js';
import { contentHashSync } from '../../core/incremental-indexing/infrastructure/hashing.mjs';
import { readManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import { FALLBACK_WEIGHTS_ID } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';

describe('indexer manifest publication', () => {
  let stateDir;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-indexer-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('publishes a reconcile manifest with legacy index artifact paths', () => {
    const manifest = publishIndexerManifest({ stateDir });

    expect(manifest.epoch).toBe(1);
    expect(manifest.codeGraph.path).toBe('code-graph.db');
    expect(manifest.vectors.path).toBe('codebase.db');
    expect(manifest.binaryHnsw.path).toBe('codebase-binary-hnsw.idx');
    expect(manifest.lateInteraction.manifest).toBe('codebase-late-interaction.db.segments/manifest.json');
    expect(readManifest(stateDir).epoch).toBe(1);
  });

  it('increments from the previously published epoch', () => {
    publishIndexerManifest({ stateDir });
    const second = publishIndexerManifest({ stateDir });

    expect(second.epoch).toBe(2);
    expect(readManifest(stateDir).epoch).toBe(2);
  });

  it('allows callers to override tier descriptors while retaining defaults', () => {
    const manifest = publishIndexerManifest({
      stateDir,
      epoch: 7,
      tiers: {
        sparseGram: { base: 'custom-sparse.idx', deltas: ['d/7-0.ssgrmdelta'] },
      },
    });

    expect(manifest.epoch).toBe(7);
    expect(manifest.sparseGram.base).toBe('custom-sparse.idx');
    expect(manifest.sparseGram.deltas).toEqual(['d/7-0.ssgrmdelta']);
    expect(manifest.vectors.path).toBe(defaultIndexerManifestPaths().vectors);
  });

  it('resets stale reconcile descriptors to legacy indexer artifact paths', () => {
    publishIndexerManifest({
      stateDir,
      epoch: 3,
      tiers: {
        codeGraph: { path: 'code-graph.next.db' },
        vectors: { path: 'nested/codebase.next.db' },
        binaryHnsw: { path: 'codebase-binary-hnsw.next.idx' },
        lateInteraction: { manifest: 'codebase-late-interaction.next.db.segments/manifest.json' },
        sparseGram: {
          base: 'codebase-sparse-grams.next.idx',
          deltas: ['codebase-sparse-grams.idx.deltas/3-stale.ssgrmdelta'],
          weightsId: 'old-weights',
        },
      },
    });

    const manifest = publishIndexerManifest({ stateDir });

    expect(manifest.epoch).toBe(4);
    expect(manifest.codeGraph.path).toBe('code-graph.db');
    expect(manifest.vectors.path).toBe('codebase.db');
    expect(manifest.binaryHnsw.path).toBe('codebase-binary-hnsw.idx');
    expect(manifest.lateInteraction.manifest).toBe('codebase-late-interaction.db.segments/manifest.json');
    expect(manifest.sparseGram).toMatchObject({
      base: 'codebase-sparse-grams.idx',
      deltas: [],
      weightsId: FALLBACK_WEIGHTS_ID,
    });
  });

  it('publishes the sparse artifact weight identity from the completed build', () => {
    const manifest = publishIndexerManifest({
      stateDir,
      sparseGramResult: { weightsId: 'corpus-bigram-v1-feedfacecafebeef' },
    });

    expect(manifest.sparseGram.weightsId).toBe('corpus-bigram-v1-feedfacecafebeef');
  });

  it('publishes sparse artifact weight identity from native snake_case results', () => {
    const manifest = publishIndexerManifest({
      stateDir,
      sparseGramResult: { weights_id: 'corpus-bigram-v1-native' },
    });

    expect(manifest.sparseGram.weightsId).toBe('corpus-bigram-v1-native');
  });

  it('updateIncrementalStatePhase publishes the manifest after a successful legacy index run', async () => {
    await updateIncrementalStatePhase({
      dryRun: false,
      fullReindex: false,
      incrementalInfo: null,
      allFiles: [],
      vectorStats: { chunks: 0, embeddings: 0 },
      graphStats: { entities: 0, relationships: 0 },
      sparseGramResult: { weightsId: 'corpus-bigram-v1-0123456789abcdef' },
      manifestStateDir: stateDir,
    });

    expect(readManifest(stateDir)?.epoch).toBe(1);
    expect(readManifest(stateDir)?.sparseGram.weightsId).toBe('corpus-bigram-v1-0123456789abcdef');
  });

  it('full-reindex fallback persists the complete stat tuple without downgrading state', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-full-reindex-state-'));
    const previousProjectRoot = process.env.SWEET_SEARCH_PROJECT_ROOT;
    const previousDataDir = process.env.SWEET_SEARCH_DATA_DIR;
    process.env.SWEET_SEARCH_PROJECT_ROOT = projectRoot;
    process.env.SWEET_SEARCH_DATA_DIR = '.sweet-search';
    vi.resetModules();

    try {
      const relativeFile = 'src/sample.js';
      const absoluteFile = path.join(projectRoot, relativeFile);
      fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
      const bytes = Buffer.from([0xff, 0x61, 0x00, 0x62]);
      fs.writeFileSync(absoluteFile, bytes);
      const stat = fs.statSync(absoluteFile, { bigint: true });

      const { updateIncrementalStatePhase: isolatedPhase } = await import('../../core/indexing/indexer-phases.js');
      await isolatedPhase({
        dryRun: false,
        fullReindex: true,
        incrementalInfo: null,
        allFiles: [relativeFile],
        vectorStats: { chunks: 1, embeddings: 1 },
        graphStats: { entities: 1, relationships: 0 },
        manifestStateDir: path.join(projectRoot, '.sweet-search'),
      });

      const state = JSON.parse(
        fs.readFileSync(path.join(projectRoot, '.sweet-search', 'merkle-state.json'), 'utf-8'),
      );

      expect(state.files[relativeFile]).toMatchObject({
        hash: contentHashSync(bytes),
        size: stat.size.toString(),
        mtime_ns: stat.mtimeNs.toString(),
        inode: stat.ino.toString(),
      });
      expect(typeof state.files[relativeFile].size).toBe('string');
    } finally {
      if (previousProjectRoot === undefined) delete process.env.SWEET_SEARCH_PROJECT_ROOT;
      else process.env.SWEET_SEARCH_PROJECT_ROOT = previousProjectRoot;
      if (previousDataDir === undefined) delete process.env.SWEET_SEARCH_DATA_DIR;
      else process.env.SWEET_SEARCH_DATA_DIR = previousDataDir;
      vi.resetModules();
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
