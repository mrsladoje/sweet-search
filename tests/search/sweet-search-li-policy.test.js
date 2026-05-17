/**
 * Construction-time test for SweetSearch's persisted-LI-policy bridge.
 *
 * The class previously read `LATE_INTERACTION_CONFIG.model` directly to
 * compute the search-rerank policy via `activeConfigModel`. After Phase 4
 * a user could persist `runtime.li.model = 'lateon-code-edge'` in
 * `.sweet-search/config.json` and the constructor would still see the
 * standard 'lateon-code' default until something else mutated the global.
 * This test pins the new contract: SweetSearch's ctor must call
 * applyPersistedLiModel(projectRoot) BEFORE consulting the active model.
 *
 * The test does NOT call init()/search() — those load HNSW + ONNX models.
 * We only construct the searcher, capture the apply report, and assert.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SweetSearch } from '../../core/search/sweet-search.js';
import { LATE_INTERACTION_CONFIG } from '../../core/infrastructure/config/ranking.js';
import { FALLBACK_WEIGHTS_ID } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';

let projectRoot;
let savedModel;
let savedEnv;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'ss-ctor-li-'));
  savedModel = LATE_INTERACTION_CONFIG.model;
  savedEnv = process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
  delete process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
});

afterEach(() => {
  LATE_INTERACTION_CONFIG.model = savedModel;
  if (savedEnv === undefined) delete process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
  else process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL = savedEnv;
  rmSync(projectRoot, { recursive: true, force: true });
});

function writeConfig(model) {
  const dir = join(projectRoot, '.sweet-search');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    version: 1,
    profile: 'full',
    runtime: { li: { model, searchReranking: 'auto' } },
  }), 'utf-8');
}

describe('SweetSearch ctor — persisted LI model bridge', () => {
  it('applies persisted edge model to LATE_INTERACTION_CONFIG before reading it', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig('lateon-code-edge');

    const searcher = new SweetSearch({ projectRoot });

    // The bridge must have run and switched the global.
    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code-edge');
    // Bridge report is exposed as a private field for diagnostics.
    expect(searcher._liModelApply.applied).toBe('lateon-code-edge');
    expect(searcher._liModelApply.source).toBe('persisted');
    expect(searcher._liModelApply.changed).toBe(true);
  });

  it('persisted=none disables LI globally for the constructed searcher', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig('none');

    const searcher = new SweetSearch({ projectRoot });

    expect(LATE_INTERACTION_CONFIG.model).toBe(false);
    expect(LATE_INTERACTION_CONFIG.enabled).toBe(false);
    // Constructor's tentative resolveSearchRerankPolicy result must agree:
    // edge "off" + "false model" → useLateInteraction is false.
    expect(searcher.useLateInteraction).toBe(false);
  });

  it('explicit env var overrides persisted config in the ctor too', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig('lateon-code-edge');
    process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL = 'lateon-code';

    const searcher = new SweetSearch({ projectRoot });

    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code');
    expect(searcher._liModelApply.source).toBe('env');
  });

  it('no persisted config + no env → keeps the built-in default', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    // No .sweet-search/config.json written.
    const searcher = new SweetSearch({ projectRoot });
    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code');
    expect(searcher._liModelApply.source).toBe('default');
  });

  it('explicit lateInteractionOptions.modelId overrides the default for query encoding', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';

    const searcher = new SweetSearch({
      projectRoot,
      lateInteractionOptions: { modelId: 'lateon-code-edge' },
    });

    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code-edge');
    expect(searcher._liModelApply.source).toBe('option');
    expect(searcher._liModelApply.applied).toBe('lateon-code-edge');
  });
});

describe('SweetSearch manifest refresh', () => {
  function writeManifest(stateDir, epoch, overrides = {}) {
    writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({
      epoch,
      publishedAt: '2026-05-16T00:00:00.000Z',
      codeGraph: { path: 'code-graph.db', epoch },
      vectors: { path: 'codebase.db', epoch },
      hnsw: { path: 'codebase-hnsw.idx', stale: 'codebase-hnsw.idx.stale.bin', epoch },
      binaryHnsw: { path: 'codebase-binary-hnsw.idx', stale: 'codebase-binary-hnsw.idx.stale.bin', epoch },
      lateInteraction: { manifest: 'codebase-late-interaction.db.segments/manifest.json', epoch },
      sparseGram: { base: 'codebase-sparse-grams.idx', deltas: [], weightsId: FALLBACK_WEIGHTS_ID, epoch },
      ...overrides,
    }), 'utf-8');
  }

  it('retargets long-lived readers and reloads artifact handles when the manifest epoch advances', async () => {
    const stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    writeManifest(stateDir, 1);

    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: join(stateDir, 'code-graph.db'),
      hnswPath: join(stateDir, 'codebase-hnsw.idx'),
      binaryHnswPath: join(stateDir, 'codebase-binary-hnsw.idx'),
      codebaseDbPath: join(stateDir, 'codebase.db'),
      lateInteractionOptions: {
        indexPath: join(stateDir, 'codebase-late-interaction.db'),
      },
    });
    const reloads = [];
    searcher.initialized = true;
    searcher._artifactManifestEpoch = 1;
    searcher._reloadManifestArtifacts = async (manifest) => {
      reloads.push(manifest.epoch);
    };
    searcher._chunkLocationMap = new Map([['old.js', []]]);
    searcher._chunkLocationMapSize = 1;
    searcher._chunkLocationMapIndex = searcher.lateInteractionIndex;
    searcher._codebaseChunkTypeMap = new Map([['old.js', []]]);
    searcher.sparseGramIndex = { stale: true };

    writeManifest(stateDir, 2, {
      codeGraph: { path: 'code-graph.next.db', epoch: 2 },
      vectors: { path: 'codebase.next.db', epoch: 2 },
      hnsw: { path: 'codebase-hnsw.next.idx', stale: 'codebase-hnsw.next.idx.stale.bin', epoch: 2 },
      binaryHnsw: { path: 'codebase-binary-hnsw.next.idx', stale: 'codebase-binary-hnsw.next.idx.stale.bin', epoch: 2 },
      lateInteraction: { manifest: 'codebase-late-interaction.next.db.segments/manifest.json', epoch: 2 },
      sparseGram: { base: 'codebase-sparse-grams.next.idx', deltas: [], weightsId: FALLBACK_WEIGHTS_ID, epoch: 2 },
    });

    try {
      await searcher._refreshManifestPins();

      expect(reloads).toEqual([2]);
      expect(searcher.manifestEpoch).toBe(2);
      expect(searcher.codebaseDbPath).toBe(join(stateDir, 'codebase.next.db'));
      expect(searcher.graphDbPath).toBe(join(stateDir, 'code-graph.next.db'));
      expect(searcher.hnswPath).toBe(join(stateDir, 'codebase-hnsw.next.idx'));
      expect(searcher.hnswIndex.stalePath).toBe(join(stateDir, 'codebase-hnsw.next.idx.stale.bin'));
      expect(searcher.binaryHnswPath).toBe(join(stateDir, 'codebase-binary-hnsw.next.idx'));
      expect(searcher.binaryHnswIndex.stalePath).toBe(join(stateDir, 'codebase-binary-hnsw.next.idx.stale.bin'));
      expect(searcher.lateInteractionIndex.indexPath).toBe(join(stateDir, 'codebase-late-interaction.next.db'));
      expect(searcher.sparseGramIndexPath).toBe(join(stateDir, 'codebase-sparse-grams.next.idx'));
      expect(searcher.sparseGramIndex).toBeNull();
      expect(searcher._chunkLocationMap).toBeNull();
      expect(searcher._codebaseChunkTypeMap).toBeNull();
    } finally {
      searcher.close();
    }
  });

  it('clears codebase-derived grep caches when the manifest epoch advances on the same DB path', async () => {
    const stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    writeManifest(stateDir, 1);

    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: join(stateDir, 'code-graph.db'),
      hnswPath: join(stateDir, 'codebase-hnsw.idx'),
      binaryHnswPath: join(stateDir, 'codebase-binary-hnsw.idx'),
      codebaseDbPath: join(stateDir, 'codebase.db'),
      lateInteractionOptions: {
        indexPath: join(stateDir, 'codebase-late-interaction.db'),
      },
    });
    searcher.initialized = true;
    searcher._artifactManifestEpoch = 1;
    searcher._reloadManifestArtifacts = async () => {};
    searcher._codebaseChunkTypeMap = new Map([['src/stale.js', []]]);

    writeManifest(stateDir, 2);

    try {
      await searcher._refreshManifestPins({ reloadScope: 'grep' });

      expect(searcher.manifestEpoch).toBe(2);
      expect(searcher.codebaseDbPath).toBe(join(stateDir, 'codebase.db'));
      expect(searcher._codebaseChunkTypeMap).toBeNull();
    } finally {
      searcher.close();
    }
  });

  it('wraps search execution in a reconcile reader heartbeat', async () => {
    const stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    writeManifest(stateDir, 4);

    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: join(stateDir, 'code-graph.db'),
      hnswPath: join(stateDir, 'codebase-hnsw.idx'),
      binaryHnswPath: join(stateDir, 'codebase-binary-hnsw.idx'),
      codebaseDbPath: join(stateDir, 'codebase.db'),
      lateInteractionOptions: { indexPath: join(stateDir, 'codebase-late-interaction.db') },
    });
    let pinnedPayload = null;
    searcher.init = async () => {};
    searcher._refreshManifestPins = async function refreshManifestPins() {
      this.manifestEpoch = 4;
    };
    searcher.hybridSearchV2 = async () => ({
      results: [{ id: 'r1', file: 'src/a.js', score: 1 }],
      fusionStats: {},
    });
    searcher._applyPostRetrieval = async () => {
      const readerDir = join(stateDir, 'readers');
      const files = readdirSync(readerDir);
      expect(files).toHaveLength(1);
      pinnedPayload = JSON.parse(readFileSync(join(readerDir, files[0]), 'utf-8'));
      return { results: [], stats: { path: 'hybrid' } };
    };

    try {
      await searcher.search('auth query', { mode: 'hybrid' });

      expect(pinnedPayload).toMatchObject({
        epoch: 4,
        meta: { tool: 'search', mode: 'hybrid', query: 'auth query' },
      });
      const readerDir = join(stateDir, 'readers');
      expect(existsSync(readerDir) ? readdirSync(readerDir) : []).toEqual([]);
    } finally {
      searcher.close();
    }
  });

  it('keeps reading the state-dir manifest after vectors retarget to a nested path', async () => {
    const stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(stateDir, 'nested'), { recursive: true });
    writeManifest(stateDir, 1, {
      vectors: { path: 'nested/codebase.db', epoch: 1 },
    });

    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: join(stateDir, 'code-graph.db'),
      hnswPath: join(stateDir, 'codebase-hnsw.idx'),
      binaryHnswPath: join(stateDir, 'codebase-binary-hnsw.idx'),
      codebaseDbPath: join(stateDir, 'codebase.db'),
      lateInteractionOptions: {
        indexPath: join(stateDir, 'codebase-late-interaction.db'),
      },
    });
    const reloads = [];
    searcher.initialized = true;
    searcher._artifactManifestEpoch = 1;
    searcher._reloadManifestArtifacts = async (manifest) => {
      reloads.push(manifest.epoch);
    };

    try {
      await searcher._refreshManifestPins();
      expect(searcher.codebaseDbPath).toBe(join(stateDir, 'nested/codebase.db'));
      expect(searcher.manifestEpoch).toBe(1);

      writeManifest(stateDir, 2, {
        vectors: { path: 'nested/codebase.db', epoch: 2 },
      });
      await searcher._refreshManifestPins();

      expect(searcher.manifestEpoch).toBe(2);
      expect(searcher._artifactManifestEpoch).toBe(2);
      expect(searcher.codebaseRepo.getManifestEpoch()).toBe(2);
      expect(reloads).toEqual([2]);
    } finally {
      searcher.close();
    }
  });

  it('reloads artifact handles when the first manifest appears after initialization', async () => {
    const stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });

    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: join(stateDir, 'code-graph.db'),
      hnswPath: join(stateDir, 'codebase-hnsw.idx'),
      binaryHnswPath: join(stateDir, 'codebase-binary-hnsw.idx'),
      codebaseDbPath: join(stateDir, 'codebase.db'),
      lateInteractionOptions: {
        indexPath: join(stateDir, 'codebase-late-interaction.db'),
      },
    });
    const reloads = [];
    searcher.initialized = true;
    searcher._artifactManifestEpoch = null;
    searcher._reloadManifestArtifacts = async (manifest) => {
      reloads.push(manifest.epoch);
    };

    writeManifest(stateDir, 1, {
      codeGraph: { path: 'code-graph.first.db', epoch: 1 },
      vectors: { path: 'codebase.first.db', epoch: 1 },
      hnsw: { path: 'codebase-hnsw.first.idx', stale: 'codebase-hnsw.first.idx.stale.bin', epoch: 1 },
      binaryHnsw: { path: 'codebase-binary-hnsw.first.idx', stale: 'codebase-binary-hnsw.first.idx.stale.bin', epoch: 1 },
      lateInteraction: { manifest: 'codebase-late-interaction.first.db.segments/manifest.json', epoch: 1 },
      sparseGram: { base: 'codebase-sparse-grams.first.idx', deltas: [], weightsId: FALLBACK_WEIGHTS_ID, epoch: 1 },
    });

    try {
      await searcher._refreshManifestPins();

      expect(reloads).toEqual([1]);
      expect(searcher._artifactManifestEpoch).toBe(1);
      expect(searcher.codebaseDbPath).toBe(join(stateDir, 'codebase.first.db'));
      expect(searcher.lateInteractionIndex.indexPath).toBe(join(stateDir, 'codebase-late-interaction.first.db'));
    } finally {
      searcher.close();
    }
  });
});
