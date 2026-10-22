/**
 * Regression test for warm-server hot-reload (release-gate C2 = FALSE).
 *
 * A long-running warm server reuses ONE SweetSearch instance. `search()` calls
 * `_refreshManifestPins()` on every query; when the reconcile-manifest epoch has
 * advanced (the maintainer just reconciled an edit), it reloads the changed
 * artifacts and re-pins the repos — so the running server observes updates
 * WITHOUT a restart. This guards that trigger: epoch bump ⇒ reload; no change ⇒
 * no redundant reload.
 *
 * The collaborators that touch real artifacts/DBs are stubbed so the test is
 * fast and deterministic; the assertion is purely on the epoch-driven trigger.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import SweetSearch from '../../core/search/sweet-search.js';

let sandbox;
let stateDir;

function writeManifest(epoch) {
  writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({ epoch }), 'utf-8');
}

function makeSearcher() {
  // Point every artifact path inside the sandbox so construction never touches
  // the real repo, then neutralize the side-effecting collaborators.
  const searcher = new SweetSearch({
    projectRoot: sandbox,
    codebaseDbPath: join(stateDir, 'codebase.db'),
    graphDbPath: join(stateDir, 'code-graph.db'),
    hnswPath: join(stateDir, 'codebase-hnsw.idx'),
    binaryHnswPath: join(stateDir, 'codebase-binary-hnsw.idx'),
    sparseGramIndexPath: join(stateDir, 'codebase-sparse-grams.idx'),
  });
  searcher._reloadManifestArtifacts = vi.fn(async () => {});
  searcher._syncManifestPaths = () => {};
  searcher._clearCodebaseChunkTypeCache = () => {};
  searcher.graphSearch = { refreshManifestEpoch: () => null };
  searcher.codeGraphRepo = { refreshManifestEpoch: () => null };
  searcher.codebaseRepo = { getManifestEpoch: () => null, refreshManifestEpoch: () => null };
  // Simulate a server that already initialised + pinned the starting epoch.
  searcher.grepInitialized = true;
  searcher._artifactManifestEpoch = 1;
  return searcher;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'ss-hot-reload-'));
  stateDir = join(sandbox, '.sweet-search');
  mkdirSync(stateDir, { recursive: true });
  writeManifest(1);
});

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('SweetSearch._refreshManifestPins — warm hot-reload trigger', () => {
  it('reloads artifacts when the reconcile epoch advances', async () => {
    const searcher = makeSearcher();

    // Maintainer reconciled an edit and republished the manifest at epoch 2.
    writeManifest(2);
    await searcher._refreshManifestPins();

    expect(searcher._reloadManifestArtifacts).toHaveBeenCalledTimes(1);
    expect(searcher._artifactManifestEpoch).toBe(2);
  });

  it('does NOT reload when the epoch is unchanged (no redundant per-query work)', async () => {
    const searcher = makeSearcher();

    // Same epoch as the pinned one — a normal query with no new reconcile.
    await searcher._refreshManifestPins();

    expect(searcher._reloadManifestArtifacts).not.toHaveBeenCalled();
    expect(searcher._artifactManifestEpoch).toBe(1);
  });

  it('reloads again on each subsequent epoch advance', async () => {
    const searcher = makeSearcher();

    writeManifest(2);
    await searcher._refreshManifestPins();
    writeManifest(3);
    await searcher._refreshManifestPins();

    expect(searcher._reloadManifestArtifacts).toHaveBeenCalledTimes(2);
    expect(searcher._artifactManifestEpoch).toBe(3);
  });

  // A grep call reloads only the sparse grams. It recorded the new epoch for every artifact,
  // so the next semantic search kept the old dense and LI indexes (found 2026-10-22).
  it('reloads everything on a semantic search after a grep call saw the new epoch', async () => {
    const searcher = makeSearcher();
    searcher._grepArtifactEpoch = 1;

    writeManifest(2);
    await searcher._refreshManifestPins({ reloadScope: 'grep' });
    expect(searcher._reloadManifestArtifacts).toHaveBeenLastCalledWith(expect.anything(), { reloadScope: 'grep' });
    expect(searcher._artifactManifestEpoch).toBe(1);

    await searcher._refreshManifestPins({ reloadScope: 'all' });
    expect(searcher._reloadManifestArtifacts).toHaveBeenCalledTimes(2);
    expect(searcher._reloadManifestArtifacts).toHaveBeenLastCalledWith(expect.anything(), { reloadScope: 'all' });
    expect(searcher._artifactManifestEpoch).toBe(2);

    await searcher._refreshManifestPins({ reloadScope: 'grep' });
    expect(searcher._reloadManifestArtifacts).toHaveBeenCalledTimes(2);
  });
});

// HNSW compaction rewrites the index file and clears its stale bitmap but publishes no epoch.
describe('SweetSearch._refreshManifestPins — HNSW file rewritten at the same epoch', () => {
  function hnswSearcher() {
    const searcher = makeSearcher();
    searcher.initialized = true;
    searcher.hasBinaryHnswIndex = true;
    searcher.use3Stage = true;
    searcher._reloadBinaryHnsw = vi.fn(async () => {});
    writeFileSync(join(stateDir, 'codebase-binary-hnsw.idx'), 'graph v1');
    return searcher;
  }

  it('reloads the graph alone when the file changed', async () => {
    const searcher = hnswSearcher();
    searcher._binaryHnswIdentity = 'identity-at-load';
    await searcher._refreshManifestPins();
    expect(searcher._reloadBinaryHnsw).toHaveBeenCalledTimes(1);
    expect(searcher._reloadManifestArtifacts).not.toHaveBeenCalled();
  });

  it('does not reload an unchanged file, nor on a grep call', async () => {
    const searcher = hnswSearcher();
    const { statSync } = await import('node:fs');
    const st = statSync(join(stateDir, 'codebase-binary-hnsw.idx'), { bigint: true });
    searcher._binaryHnswIdentity = `${st.ino}:${st.size}:${st.mtimeNs}`;
    await searcher._refreshManifestPins();
    expect(searcher._reloadBinaryHnsw).not.toHaveBeenCalled();

    searcher._binaryHnswIdentity = 'identity-at-load';
    await searcher._refreshManifestPins({ reloadScope: 'grep' });
    expect(searcher._reloadBinaryHnsw).not.toHaveBeenCalled();
  });
});

// Each reload replaced the index without closing it: the old one keeps its file open (it reads
// graph sections lazily), so every reload leaked a descriptor and kept the replaced file alive.
describe('SweetSearch._reloadBinaryHnsw — closes the replaced index', () => {
  it('closes the old index after the grace period, not during it', async () => {
    const { buildHnswIndex } = await import('../../core/indexing/artifact-builder.js');
    const indexPath = join(stateDir, 'codebase-binary-hnsw.idx');
    const vec = (i) => Float32Array.from({ length: 768 }, (_, k) => Math.sin(i * 31 + k));
    const { index } = await buildHnswIndex([0, 1, 2].map((i) => ({ id: `v${i}`, embedding: vec(i), metadata: {} })), { indexPath });
    await index.save(indexPath);
    index.close();

    vi.useFakeTimers();
    try {
      const searcher = makeSearcher();
      searcher.binaryHnswPath = indexPath;
      const old = { close: vi.fn(), stalePath: `${indexPath}.stale.bin` };
      searcher.binaryHnswIndex = old;
      await searcher._reloadBinaryHnsw();
      expect(searcher.binaryHnswIndex).not.toBe(old);
      expect(old.close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(120_000);
      expect(old.close).toHaveBeenCalledTimes(1);
      searcher.binaryHnswIndex.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

// A new epoch reloaded the HNSW index even when its file had not changed (a tick without
// vector changes): the per-search stale-bitmap read already covers retirements.
describe('SweetSearch._reloadManifestArtifacts — HNSW only when its file changed', () => {
  it('skips an unchanged index file and reloads a changed one', async () => {
    const searcher = new SweetSearch({
      projectRoot: sandbox,
      codebaseDbPath: join(stateDir, 'codebase.db'),
      graphDbPath: join(stateDir, 'code-graph.db'),
      binaryHnswPath: join(stateDir, 'codebase-binary-hnsw.idx'),
      sparseGramIndexPath: join(stateDir, 'codebase-sparse-grams.idx'),
    });
    searcher._syncManifestPaths = () => {};
    const { buildHnswIndex } = await import('../../core/indexing/artifact-builder.js');
    const vec = (i) => Float32Array.from({ length: 768 }, (_, k) => Math.sin(i * 31 + k));
    const { index } = await buildHnswIndex([0, 1].map((i) => ({ id: `v${i}`, embedding: vec(i), metadata: {} })), { indexPath: join(stateDir, 'codebase-binary-hnsw.idx') });
    await index.save(join(stateDir, 'codebase-binary-hnsw.idx'));
    index.close();
    searcher.hasBinaryHnswIndex = true;
    searcher.use3Stage = true;
    searcher._reloadBinaryHnsw = vi.fn(async () => {});
    const { statSync } = await import('node:fs');
    const st = statSync(join(stateDir, 'codebase-binary-hnsw.idx'), { bigint: true });
    searcher._binaryHnswIdentity = `${st.ino}:${st.size}:${st.mtimeNs}`;
    searcher.binaryHnswPath = join(stateDir, 'codebase-binary-hnsw.idx');
    searcher.lateInteractionIndex = { indexPath: join(stateDir, 'absent-li.db') };

    await searcher._reloadManifestArtifacts({ epoch: 2 });
    expect(searcher._reloadBinaryHnsw).not.toHaveBeenCalled();

    searcher._binaryHnswIdentity = 'older';
    await searcher._reloadManifestArtifacts({ epoch: 3 });
    expect(searcher._reloadBinaryHnsw).toHaveBeenCalledTimes(1);
  });
});
