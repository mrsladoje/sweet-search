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
});
