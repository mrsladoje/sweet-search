/**
 * Empty-repository handling for full indexing + default-on incremental.
 *
 * Two fixes are under test:
 *
 *   1. `indexer-empty-baseline.js` (wired into index-codebase-v21.js): a full /
 *      incremental index over a repo with no indexable files now writes a
 *      coherent zero-row baseline (empty codebase.db + code-graph.db + a
 *      reconcile-manifest at epoch >= 1 + a merkle-state carrying a
 *      config_fingerprint) instead of leaving nothing. That baseline is exactly
 *      what `hasCompleteBaseIndex` accepts as a "valid empty baseline", so:
 *        - search returns empty results cleanly (the graph+codebase existence
 *          check in SweetSearch.init passes; the tables are simply empty), and
 *        - the default-on reconcile maintainer's baseline gate opens, letting it
 *          grow the index from the first file the user creates. Without the
 *          baseline the gate stays at `waiting_for_initial_index` forever and the
 *          first file is never reconciled.
 *
 *   2. search-semantic.js Stage 2.5 SQLite fallback: when the direct-access float
 *      store is absent (e.g. an index bootstrapped purely via incremental
 *      reconcile), the fallback used to fail-loud on full-dim (768d) rows vs the
 *      512d query. It now matryoshka-truncates the stored vector to the query
 *      dimension so empty->first-file is fully searchable via hybrid/semantic.
 *
 * The producer->gate path is exercised end-to-end via a child-process full index
 * (fast: an empty repo early-exits before any model load). The reconcile
 * lifecycle uses injected fake encoders, mirroring
 * incremental-indexing-production-reconciler.test.js, so it stays deterministic
 * and model-free.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { createVectorSchema } from '../../core/indexing/indexer-build.js';
import { truncateForHNSW } from '../../core/embedding/embedding-service.js';
import { reconcileEnablement } from '../../core/incremental-indexing/domain/interval-autotune.mjs';
import { dirtyScanEnabled } from '../../core/incremental-indexing/application/dirty-scan.mjs';
import { launchMaintainer } from '../../core/indexing/maintainer-launcher.mjs';

const CLI = fileURLToPath(new URL('../../core/cli.js', import.meta.url));

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake-empty', dimension: 8, hnswDimension: 8 });
const silentLogger = { info() {}, warn() {}, error() {} };

function fakeVector(text, index) {
  const seed = [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), index + 1);
  return Float32Array.from({ length: 8 }, (_, i) => ((seed + i * 13) % 97) / 97);
}
async function vectorEncoder(texts) { return texts.map((t, i) => fakeVector(t, i)); }
async function liEncoder(texts) {
  return texts.map((t, i) => [Float32Array.from([t.length + i, 2, 3, 4]), Float32Array.from([t.length + i + 1, 3, 4, 5])]);
}

function readJson(p) { return JSON.parse(readFileSync(p, 'utf-8')); }
function enqueue(stateDir, filePath) {
  writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: filePath })}\n`);
}
function liveVectorCount(stateDir) {
  const db = new Database(join(stateDir, 'codebase.db'), { readonly: true });
  try { return db.prepare('SELECT COUNT(*) c FROM vectors WHERE epoch_retired IS NULL').get().c; }
  finally { db.close(); }
}

describe('empty-repo full index produces a valid baseline (producer -> gate)', () => {
  let projectRoot;
  let stateDir;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-empty-full-'));
    stateDir = join(projectRoot, '.sweet-search');
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  it('writes empty DBs + manifest + fingerprinted merkle that hasCompleteBaseIndex accepts', () => {
    const out = execFileSync(process.execPath, [CLI, 'index', '--full', '--quiet'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        SWEET_SEARCH_PROJECT_ROOT: projectRoot,
        HOME: join(projectRoot, 'home'),
        SWEET_SEARCH_RECONCILE_V2: '1',
      },
      encoding: 'utf-8',
    });

    // Quiet-mode JSON contract: success with zero files and a clear reason.
    const json = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
    expect(json).toMatchObject({ success: true, filesProcessed: 0, reason: 'no_files' });

    // Coherent zero-row baseline on disk.
    expect(existsSync(join(stateDir, 'codebase.db'))).toBe(true);
    expect(existsSync(join(stateDir, 'code-graph.db'))).toBe(true);
    const manifest = readJson(join(stateDir, 'reconcile-manifest.json'));
    expect(manifest.epoch).toBeGreaterThanOrEqual(1);
    const merkle = readJson(join(stateDir, 'merkle-state.json'));
    expect(merkle.config_fingerprint).toBeTruthy();
    expect(Object.keys(merkle.files)).toEqual([]);
    expect(liveVectorCount(stateDir)).toBe(0);

    // The whole point: the maintainer's baseline gate now opens.
    expect(hasCompleteBaseIndex(stateDir)).toEqual({ ready: true, reason: 'ready' });
  }, 60_000);

  it('does NOT clobber an existing merkle when a previously-indexed repo became empty', () => {
    // A repo that was indexed and then had every tracked file deleted: an empty
    // working tree must NOT reset merkle-state, or the maintainer would lose the
    // record of the deleted file and never retire its stale rows.
    mkdirSync(stateDir, { recursive: true });
    const db = new Database(join(stateDir, 'codebase.db'));
    try { createVectorSchema(db); } finally { db.close(); }
    writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({ epoch: 1, vectors: { path: 'codebase.db', epoch: 1 } }));
    writeFileSync(join(stateDir, 'merkle-state.json'), JSON.stringify({
      version: '2.4', files: { 'gone.js': { hash: 'x', epoch: 1 } }, config_fingerprint: { provider: 'test' }, stats: { totalFiles: 1 },
    }));

    execFileSync(process.execPath, [CLI, 'index', '--full', '--quiet'], {
      cwd: projectRoot,
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectRoot, HOME: join(projectRoot, 'home'), SWEET_SEARCH_RECONCILE_V2: '1' },
      encoding: 'utf-8',
    });

    // Merkle still records the deleted file, so the maintainer can clean it up.
    expect(Object.keys(readJson(join(stateDir, 'merkle-state.json')).files)).toEqual(['gone.js']);
  }, 60_000);
});

describe('reconcile lifecycle from a valid empty baseline', () => {
  let projectRoot;
  let stateDir;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-empty-recon-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    // A valid EMPTY baseline, shaped like what establishEmptyBaseline writes:
    // empty vectors DB + manifest at epoch 1 + merkle carrying a fingerprint.
    const db = new Database(join(stateDir, 'codebase.db'));
    try { createVectorSchema(db); } finally { db.close(); }
    writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({
      epoch: 1, publishedAt: new Date().toISOString(), vectors: { path: 'codebase.db', epoch: 1 },
    }));
    writeFileSync(join(stateDir, 'merkle-state.json'), JSON.stringify({
      version: '2.4', files: {}, config_fingerprint: { provider: 'test', version: '2.4' }, stats: { totalFiles: 0 },
    }));
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  async function tick() {
    return runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: silentLogger, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }

  it('starts ready, indexes the first created file, then returns to empty when it is deleted', async () => {
    expect(hasCompleteBaseIndex(stateDir).ready).toBe(true);
    expect(liveVectorCount(stateDir)).toBe(0);

    // First file created on the empty baseline.
    const file = join(projectRoot, 'src', 'auth.js');
    writeFileSync(file, 'export function authenticateUser(u, p) { return { user: u, ok: !!(u && p) }; }\n');
    enqueue(stateDir, 'src/auth.js');
    const added = await tick();
    expect(added.epoch).toBe(2);
    expect(added.files_processed).toBe(1);
    expect(added.ops_per_tier.vectors_upsert).toBeGreaterThan(0);
    expect(liveVectorCount(stateDir)).toBeGreaterThan(0);

    // Delete the last indexed file -> reconcile retires its rows, search empties.
    rmSync(file);
    enqueue(stateDir, 'src/auth.js');
    const removed = await tick();
    expect(removed.epoch).toBe(3);
    expect(removed.ops_per_tier.vectors_delete).toBeGreaterThan(0);
    expect(liveVectorCount(stateDir)).toBe(0);
  });
});

describe('reconcile-v2 opt-out', () => {
  it('reconcileEnablement reports disabled for 0/false/off and enabled by default', () => {
    expect(reconcileEnablement({ SWEET_SEARCH_RECONCILE_V2: '0' }).enabled).toBe(false);
    expect(reconcileEnablement({ SWEET_SEARCH_RECONCILE_V2: 'false' }).enabled).toBe(false);
    expect(reconcileEnablement({ SWEET_SEARCH_RECONCILE_V2: 'off' }).enabled).toBe(false);
    expect(reconcileEnablement({}).enabled).toBe(true);
  });

  it('dirtyScanEnabled honors the SCAN opt-out independently', () => {
    expect(dirtyScanEnabled({ SWEET_SEARCH_RECONCILE_SCAN: '0' })).toBe(false);
    expect(dirtyScanEnabled({})).toBe(true);
  });

  it('launchMaintainer does not spawn when reconcile-v2 is opted out', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'ss-optout-'));
    try {
      const r = launchMaintainer({ cwd: sandbox, env: { ...process.env, SWEET_SEARCH_RECONCILE_V2: '0' } });
      expect(r).toMatchObject({ spawned: false, reason: 'opted-out' });
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('Stage 2.5 SQLite-fallback dimension handling', () => {
  // The fix relies on matryoshka truncation: codebase.db stores full-dim (768d)
  // rows; the query + float store operate at hnswDimension (512d). Truncating the
  // stored row to the query dim makes the fallback comparable instead of a throw.
  it('truncateForHNSW reduces a full-dim row to the query dim and renormalizes', () => {
    const FULL = 768;
    const HNSW = 512;
    const docFull = Float32Array.from({ length: FULL }, (_, i) => Math.sin(1 + i * 0.3));
    const queryFull = Float32Array.from({ length: FULL }, (_, i) => Math.sin(2 + i * 0.3));

    const query = truncateForHNSW(queryFull, HNSW);
    const docTrunc = truncateForHNSW(docFull, HNSW);

    expect(docTrunc.length).toBe(HNSW);
    let norm = 0;
    for (const v of docTrunc) norm += v * v;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);

    // Two unit vectors -> dot product is a valid cosine in [-1, 1] (no throw).
    let dot = 0;
    for (let i = 0; i < HNSW; i++) dot += query[i] * docTrunc[i];
    expect(dot).toBeGreaterThanOrEqual(-1.0001);
    expect(dot).toBeLessThanOrEqual(1.0001);
  });

  it('is a no-op when the stored row already matches the query dimension', () => {
    const HNSW = 512;
    const v = Float32Array.from({ length: HNSW }, (_, i) => Math.cos(i * 0.1));
    expect(truncateForHNSW(v, HNSW)).toBe(v);
  });
});
