/**
 * Baseline-readiness gate for the default-on incremental maintainer.
 *
 * Product contract under test: the incremental reconciler must NEVER be the
 * first index builder for a non-empty repo. Until the normal full indexing path
 * produces a complete baseline, the maintainer stays dormant and reports
 * `waiting_for_initial_index`; it must not create partial DBs/artifacts or
 * enqueue the whole tree. Once a complete baseline exists (including a valid
 * empty one) reconcile runs normally.
 *
 * Covers `infrastructure/baseline-readiness.mjs` plus the two policy gates that
 * use it: the maintainer tick (`index-maintainer.mjs::runReconcileV2Tick`) and
 * the operator CLI (`operator-cli.mjs` reconcile status/tick).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  hasCompleteBaseIndex,
  baselineStatus,
  WAITING_FOR_INITIAL_INDEX,
} from '../../core/incremental-indexing/infrastructure/baseline-readiness.mjs';
import { runReconcileV2Tick } from '../../core/indexing/index-maintainer.mjs';
import { handleIncrementalCli } from '../../core/incremental-indexing/application/operator-cli.mjs';
import { createVectorSchema } from '../../core/indexing/indexer-build.js';

// A `config_fingerprint` shaped like the one the full indexer's
// incremental-tracker writes. Its mere presence is what distinguishes a real
// full index from a reconciler-only partial run.
const FULL_INDEX_FINGERPRINT = Object.freeze({
  provider: 'test',
  model: 'fake',
  dimension: 8,
  hnswDimension: 8,
  pipelineVersion: 2,
  hashAlgorithm: 'xxhash64',
  version: '2.4',
});

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

/** A bare manifest at the given epoch (only the fields readiness inspects). */
function writeManifestJson(stateDir, epoch, vectorsPath = 'codebase.db') {
  writeJson(join(stateDir, 'reconcile-manifest.json'), {
    epoch,
    publishedAt: new Date().toISOString(),
    vectors: { path: vectorsPath, epoch },
  });
}

/** A merkle-state with a full-index `config_fingerprint` and the given files. */
function writeMerkleState(stateDir, files = {}, { withFingerprint = true } = {}) {
  const state = { version: '2.4', files, lastIndex: new Date().toISOString(), stats: { totalFiles: Object.keys(files).length } };
  if (withFingerprint) state.config_fingerprint = FULL_INDEX_FINGERPRINT;
  writeJson(join(stateDir, 'merkle-state.json'), state);
}

/** A real (empty) SQLite vectors DB so readiness + maintenance reads succeed. */
function writeEmptyVectorsDb(stateDir) {
  const db = new Database(join(stateDir, 'codebase.db'));
  try {
    createVectorSchema(db);
  } finally {
    db.close();
  }
}

/** Merkle entry that exactly matches a file on disk (so dirty-scan sees no change). */
function merkleEntryFor(absPath, epoch = 1) {
  const stat = statSync(absPath, { bigint: true });
  return {
    hash: 'deadbeef',
    size: stat.size.toString(),
    mtime_ns: stat.mtimeNs.toString(),
    inode: stat.ino.toString(),
    epoch,
    chunkIds: [],
  };
}

describe('hasCompleteBaseIndex', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'ss-baseline-'));
  });
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

  it('is not ready when the state dir does not exist', () => {
    const r = hasCompleteBaseIndex(join(stateDir, 'nope'));
    expect(r).toEqual({ ready: false, reason: 'no-state-dir' });
  });

  it('is not ready right after init (state dir + config.json only, no manifest)', () => {
    writeJson(join(stateDir, 'config.json'), { profile: 'core' });
    expect(hasCompleteBaseIndex(stateDir)).toEqual({ ready: false, reason: 'no-manifest' });
  });

  it('is not ready when the manifest epoch is 0 (never published)', () => {
    writeManifestJson(stateDir, 0);
    writeMerkleState(stateDir, {});
    writeEmptyVectorsDb(stateDir);
    expect(hasCompleteBaseIndex(stateDir).reason).toBe('manifest-epoch-zero');
  });

  it('is not ready when merkle-state is absent', () => {
    writeManifestJson(stateDir, 1);
    writeEmptyVectorsDb(stateDir);
    expect(hasCompleteBaseIndex(stateDir).reason).toBe('no-merkle-state');
  });

  it('is NOT ready for a reconciler-only baseline (no config_fingerprint)', () => {
    // This is exactly the partial state the old default-on bug produced:
    // a manifest at epoch 1 + a reconciler-written merkle WITHOUT a fingerprint.
    writeManifestJson(stateDir, 1);
    writeMerkleState(stateDir, { 'src/a.js': { hash: 'x', epoch: 1 } }, { withFingerprint: false });
    writeEmptyVectorsDb(stateDir);
    expect(hasCompleteBaseIndex(stateDir).reason).toBe('no-config-fingerprint');
  });

  it('is not ready when the vectors DB is missing', () => {
    writeManifestJson(stateDir, 1);
    writeMerkleState(stateDir, {});
    expect(hasCompleteBaseIndex(stateDir).reason).toBe('missing-vectors-db');
  });

  it('is READY for a complete baseline (manifest + fingerprint + vectors db)', () => {
    writeManifestJson(stateDir, 1);
    writeMerkleState(stateDir, { 'src/a.js': { hash: 'x', epoch: 1 } });
    writeEmptyVectorsDb(stateDir);
    expect(hasCompleteBaseIndex(stateDir)).toEqual({ ready: true, reason: 'ready' });
  });

  it('counts a valid EMPTY baseline (zero tracked files) as ready', () => {
    writeManifestJson(stateDir, 1);
    writeMerkleState(stateDir, {}); // full index ran, produced empty-but-valid index
    writeEmptyVectorsDb(stateDir);
    expect(hasCompleteBaseIndex(stateDir).ready).toBe(true);
  });

  it('rejects a corrupt manifest', () => {
    writeFileSync(join(stateDir, 'reconcile-manifest.json'), '{ not valid json', 'utf-8');
    writeMerkleState(stateDir, {});
    writeEmptyVectorsDb(stateDir);
    expect(hasCompleteBaseIndex(stateDir).reason).toBe('no-manifest');
  });

  it('rejects a corrupt merkle-state', () => {
    writeManifestJson(stateDir, 1);
    writeFileSync(join(stateDir, 'merkle-state.json'), '{ broken', 'utf-8');
    writeEmptyVectorsDb(stateDir);
    expect(hasCompleteBaseIndex(stateDir).reason).toBe('no-merkle-state');
  });
});

describe('baselineStatus', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'ss-baseline-status-'));
  });
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

  it('labels a missing baseline as waiting_for_initial_index', () => {
    const s = baselineStatus(stateDir);
    expect(s.ready).toBe(false);
    expect(s.state).toBe(WAITING_FOR_INITIAL_INDEX);
  });

  it('labels a complete baseline as indexed', () => {
    writeManifestJson(stateDir, 1);
    writeMerkleState(stateDir, {});
    writeEmptyVectorsDb(stateDir);
    expect(baselineStatus(stateDir).state).toBe('indexed');
  });
});

describe('runReconcileV2Tick baseline gate', () => {
  let projectRoot;
  let stateDir;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-gate-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    // Non-empty repo.
    writeFileSync(join(projectRoot, 'src', 'a.js'), 'export const a = 1;\n');
    writeFileSync(join(projectRoot, 'src', 'b.js'), 'export const b = 2;\n');
    // Post-init: state dir exists with config.json only — NO baseline.
    writeJson(join(stateDir, 'config.json'), { profile: 'core' });
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  it('skips and creates NO artifacts/queue before a baseline exists', async () => {
    const result = await runReconcileV2Tick({ projectRoot, stateDir });
    expect(result).toMatchObject({ skipped: true, reason: WAITING_FOR_INITIAL_INDEX });

    // No partial DBs / artifacts, and no dirty queue — the state dir is
    // untouched except for the config.json it started with.
    expect(readdirSync(stateDir).sort()).toEqual(['config.json']);
    for (const artifact of [
      'codebase.db',
      'code-graph.db',
      'reconcile-manifest.json',
      'merkle-state.json',
      'index-maintainer-queue.jsonl',
      'codebase-hnsw.usearch',
    ]) {
      expect(existsSync(join(stateDir, artifact))).toBe(false);
    }
  });

  it('proceeds (no longer skipped) once a complete baseline exists', async () => {
    // Establish a complete baseline whose merkle matches the files on disk, so
    // dirty-scan finds nothing changed and the tick reconciles 0 files (no
    // encoder/model calls needed to prove the gate opened).
    writeManifestJson(stateDir, 1);
    writeMerkleState(stateDir, {
      'src/a.js': merkleEntryFor(join(projectRoot, 'src', 'a.js')),
      'src/b.js': merkleEntryFor(join(projectRoot, 'src', 'b.js')),
    });
    writeEmptyVectorsDb(stateDir);

    const result = await runReconcileV2Tick({ projectRoot, stateDir });
    expect(result.skipped).toBeFalsy();
    expect(result.epoch).toBe(2); // bumped from baseline epoch 1
    expect(result.files_processed).toBe(0); // nothing changed
  });
});

describe('operator reconcile CLI baseline gate', () => {
  let projectRoot;
  let stateDir;
  let logs;
  let originalLog;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-op-gate-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(projectRoot, 'a.js'), 'export const a = 1;\n');
    logs = [];
    originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
  });
  afterEach(() => {
    console.log = originalLog;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // Pass --state-dir explicitly: the CLI realpaths --project-root, which on
  // macOS rewrites /var/folders → /private/var/folders and would not match the
  // stateDir these tests write to.
  it('reconcile status reports waiting_for_initial_index when no baseline', async () => {
    await handleIncrementalCli('reconcile', ['status', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    const payload = JSON.parse(logs.join('\n'));
    expect(payload.baseline.ready).toBe(false);
    expect(payload.baseline.state).toBe(WAITING_FOR_INITIAL_INDEX);
  });

  it('reconcile tick refuses (skipped, no artifacts) when no baseline', async () => {
    await handleIncrementalCli('reconcile', ['tick', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    const payload = JSON.parse(logs.join('\n'));
    expect(payload.skipped).toBe(true);
    expect(payload.reason).toBe(WAITING_FOR_INITIAL_INDEX);
    expect(existsSync(join(stateDir, 'codebase.db'))).toBe(false);
    expect(existsSync(join(stateDir, 'reconcile-manifest.json'))).toBe(false);
  });

  it('reconcile status reports indexed once a baseline exists', async () => {
    writeManifestJson(stateDir, 1);
    writeMerkleState(stateDir, {});
    writeEmptyVectorsDb(stateDir);
    await handleIncrementalCli('reconcile', ['status', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    const payload = JSON.parse(logs.join('\n'));
    expect(payload.baseline.ready).toBe(true);
    expect(payload.baseline.state).toBe('indexed');
  });
});
