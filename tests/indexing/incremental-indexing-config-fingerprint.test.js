/**
 * Index-format detection after an upgrade.
 *
 * Contract under test:
 *   - `config-fingerprint.js` records every setting that decides the on-disk
 *     index format (dense + LI encoders, chunker, enrichment, sparse weights),
 *     and a change to ANY of them fails validation.
 *   - A stored fingerprint that lacks a field (index built before that field
 *     existed) counts as a mismatch, so every existing index rebuilds once.
 *   - The reconcile daemon's baseline gate treats a mismatch as not-ready
 *     (`config-fingerprint-mismatch`): the tick is a no-op and writes nothing,
 *     so it never mixes old- and new-format chunks.
 *   - `reconcile status|tick` and the search notice name the changed fields
 *     and tell the user to run `sweet-search index`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildConfigFingerprint,
  diffConfigFingerprint,
  validateConfigFingerprint,
  STATE_VERSION,
} from '../../core/indexing/config-fingerprint.js';
import { CHUNKING_VERSION, ENRICHMENT_VERSION } from '../../core/indexing/ast-chunker.js';
import {
  hasCompleteBaseIndex,
  baselineStatus,
  indexFormatStatus,
  CONFIG_FINGERPRINT_MISMATCH,
  INDEX_REBUILD_REQUIRED,
} from '../../core/incremental-indexing/infrastructure/baseline-readiness.mjs';
import {
  formatIndexFormatNotice,
  formatBaselineNotice,
} from '../../core/incremental-indexing/infrastructure/staleness-display.mjs';
import { runReconcileV2Tick } from '../../core/indexing/index-maintainer.mjs';
import { handleIncrementalCli } from '../../core/incremental-indexing/application/operator-cli.mjs';
import { createVectorSchema } from '../../core/indexing/indexer-build.js';
import { emitIndexFormatNotice } from '../../core/search/cli-decoration.js';

const NEW_FIELDS = ['liModel', 'liQuantization', 'chunkingVersion', 'enrichmentVersion', 'sparseGramWeightsId'];

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value), 'utf-8');
}

/** A complete baseline (manifest + merkle + vectors DB) with the given fingerprint. */
function seedBaseline(stateDir, fingerprint, files = {}) {
  writeJson(join(stateDir, 'reconcile-manifest.json'), {
    epoch: 1,
    publishedAt: new Date().toISOString(),
    vectors: { path: 'codebase.db', epoch: 1 },
  });
  writeJson(join(stateDir, 'merkle-state.json'), {
    version: STATE_VERSION,
    config_fingerprint: fingerprint,
    files,
    lastIndex: new Date().toISOString(),
    stats: { totalFiles: Object.keys(files).length },
  });
  const db = new Database(join(stateDir, 'codebase.db'));
  try { createVectorSchema(db); } finally { db.close(); }
}

/** A fingerprint as the release before this change wrote it (no new fields). */
function legacyFingerprint() {
  const fp = { ...buildConfigFingerprint() };
  for (const key of NEW_FIELDS) delete fp[key];
  return fp;
}

describe('config fingerprint', () => {
  it('records the index-format fields', () => {
    const fp = buildConfigFingerprint();
    for (const key of NEW_FIELDS) expect(fp).toHaveProperty(key);
    expect(fp.chunkingVersion).toBe(CHUNKING_VERSION);
    expect(fp.enrichmentVersion).toBe(ENRICHMENT_VERSION);
    expect(fp.sparseGramWeightsId).toBe('common-code-bigram-v1');
  });

  it('round-trips through JSON and validates', () => {
    const stored = JSON.parse(JSON.stringify(buildConfigFingerprint()));
    expect(validateConfigFingerprint(stored)).toEqual({ valid: true });
    expect(diffConfigFingerprint(stored)).toEqual([]);
  });

  const EXPECTED_REASONS = {
    provider: 'provider_changed',
    model: 'model_changed',
    dimension: 'dimension_changed',
    hnswDimension: 'hnsw_dimension_changed',
    pipelineVersion: 'pipeline_version_changed',
    hashAlgorithm: 'hash_algorithm_changed',
    liModel: 'li_model_changed',
    liQuantization: 'li_quantization_changed',
    chunkingVersion: 'chunking_version_changed',
    enrichmentVersion: 'enrichment_version_changed',
    sparseGramWeightsId: 'sparse_gram_weights_changed',
  };

  for (const [field, reason] of Object.entries(EXPECTED_REASONS)) {
    it(`a change to ${field} fails validation`, () => {
      const stored = { ...buildConfigFingerprint(), [field]: 'something-else' };
      const result = validateConfigFingerprint(stored);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(reason);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({ field, previous: 'something-else' });
    });
  }

  it('a state-version change fails validation', () => {
    const result = validateConfigFingerprint({ ...buildConfigFingerprint(), version: '2.3' });
    expect(result).toMatchObject({ valid: false, reason: 'state_version_changed' });
  });

  it('a legacy fingerprint without the new fields is a mismatch that names each missing field', () => {
    const result = validateConfigFingerprint(legacyFingerprint());
    expect(result.valid).toBe(false);
    expect(result.changes.map((c) => c.field)).toEqual(NEW_FIELDS);
    for (const change of result.changes) expect(change.previous).toBeNull();
  });

  it('a missing fingerprint is a mismatch', () => {
    expect(validateConfigFingerprint(undefined)).toMatchObject({ valid: false, reason: 'no_fingerprint' });
  });
});

describe('baseline gate on a fingerprint mismatch', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkdtempSync(join(tmpdir(), 'ss-fp-gate-')); });
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

  it('is ready when the fingerprint matches', () => {
    seedBaseline(stateDir, buildConfigFingerprint());
    expect(hasCompleteBaseIndex(stateDir)).toEqual({ ready: true, reason: 'ready' });
  });

  it('returns config-fingerprint-mismatch with the changed fields', () => {
    seedBaseline(stateDir, { ...buildConfigFingerprint(), liModel: 'lateon-code-old' });
    const r = hasCompleteBaseIndex(stateDir);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe(CONFIG_FINGERPRINT_MISMATCH);
    expect(r.changes.map((c) => c.field)).toEqual(['liModel']);
    expect(baselineStatus(stateDir).state).toBe(INDEX_REBUILD_REQUIRED);
  });

  it('returns config-fingerprint-mismatch for a legacy (pre-upgrade) baseline', () => {
    seedBaseline(stateDir, legacyFingerprint());
    expect(hasCompleteBaseIndex(stateDir).reason).toBe(CONFIG_FINGERPRINT_MISMATCH);
  });
});

describe('daemon tick under a fingerprint mismatch', () => {
  let projectRoot;
  let stateDir;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-fp-tick-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'a.js'), 'export const a = 1;\n');
    // A file the old index never saw: an unguarded tick would enqueue + embed it.
    writeFileSync(join(projectRoot, 'src', 'new.js'), 'export const b = 2;\n');
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  it('is a no-op: skipped, and no artifact or queue changes', async () => {
    const st = statSync(join(projectRoot, 'src', 'a.js'), { bigint: true });
    seedBaseline(stateDir, legacyFingerprint(), {
      'src/a.js': { hash: 'x', size: st.size.toString(), mtime_ns: st.mtimeNs.toString(), inode: st.ino.toString(), epoch: 1, chunkIds: [] },
    });
    const before = Object.fromEntries(readdirSync(stateDir).map((f) => [f, readFileSync(join(stateDir, f))]));

    const result = await runReconcileV2Tick({ projectRoot, stateDir });
    expect(result).toMatchObject({ skipped: true, reason: INDEX_REBUILD_REQUIRED, baseline: CONFIG_FINGERPRINT_MISMATCH });

    const after = readdirSync(stateDir).sort();
    expect(after).toEqual(Object.keys(before).sort());
    for (const f of after) expect(readFileSync(join(stateDir, f)).equals(before[f])).toBe(true);
  });
});

describe('user-facing notices', () => {
  let projectRoot;
  let stateDir;
  let logs;
  let originalLog;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-fp-cli-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    logs = [];
    originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
  });
  afterEach(() => {
    console.log = originalLog;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('formatIndexFormatNotice names the changed field and the fix', () => {
    const notice = formatIndexFormatNotice([
      { field: 'liModel', label: 'late-interaction model', previous: 'lateon-code', current: 'lateon-code-edge' },
    ]);
    expect(notice).toContain('late-interaction model: lateon-code -> lateon-code-edge');
    expect(notice).toContain('run "sweet-search index"');
  });

  it('reconcile status reports index_rebuild_required with the changed field', async () => {
    seedBaseline(stateDir, { ...buildConfigFingerprint(), chunkingVersion: 0 });
    await handleIncrementalCli('reconcile', ['status', '--project-root', projectRoot, '--state-dir', stateDir]);
    const text = logs.join('\n');
    expect(text).toContain('chunking version: 0 -> ');
    expect(text).toContain('run "sweet-search index"');
  });

  it('reconcile tick refuses with index_rebuild_required', async () => {
    seedBaseline(stateDir, { ...buildConfigFingerprint(), enrichmentVersion: 0 });
    await handleIncrementalCli('reconcile', ['tick', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    const payload = JSON.parse(logs.join('\n'));
    expect(payload).toMatchObject({ skipped: true, reason: INDEX_REBUILD_REQUIRED });
    expect(payload.baseline.changes.map((c) => c.field)).toEqual(['enrichmentVersion']);
  });

  it('formatBaselineNotice keeps the waiting_for_initial_index text for other reasons', () => {
    expect(formatBaselineNotice({ reason: 'no-manifest' })).toContain('waiting_for_initial_index (no-manifest)');
  });
});

describe('indexFormatStatus (search-time prefix read)', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkdtempSync(join(tmpdir(), 'ss-fp-prefix-')); });
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

  it('returns null when there is no index', () => {
    expect(indexFormatStatus(stateDir)).toBeNull();
  });

  it('matches a current fingerprint', () => {
    seedBaseline(stateDir, buildConfigFingerprint());
    expect(indexFormatStatus(stateDir)).toEqual({ match: true, changes: [] });
  });

  it('reports a mismatch from the head of a large state file', () => {
    const files = {};
    for (let i = 0; i < 5000; i++) files[`src/f${i}.js`] = { hash: 'x'.repeat(16), size: '1', mtime_ns: '1', inode: '1', epoch: 1, chunkIds: [] };
    seedBaseline(stateDir, legacyFingerprint(), files);
    expect(statSync(join(stateDir, 'merkle-state.json')).size).toBeGreaterThan(64 * 1024);
    const status = indexFormatStatus(stateDir);
    expect(status.match).toBe(false);
    expect(status.changes.map((c) => c.field)).toEqual(NEW_FIELDS);
  });
});

describe('emitIndexFormatNotice (search banner channel)', () => {
  let stateDir;
  let written;
  let originalWrite;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'ss-fp-banner-'));
    written = [];
    originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  });
  afterEach(() => {
    process.stdout.write = originalWrite;
    rmSync(stateDir, { recursive: true, force: true });
  });

  const humanPolicy = { bannerEnabled: true, colorEnabled: false, decorationStream: 'stdout' };

  it('prints the notice on a mismatch', async () => {
    seedBaseline(stateDir, legacyFingerprint());
    await emitIndexFormatNotice(humanPolicy, stateDir);
    expect(written.join('')).toContain('run "sweet-search index"');
  });

  it('prints nothing when the index matches', async () => {
    seedBaseline(stateDir, buildConfigFingerprint());
    await emitIndexFormatNotice(humanPolicy, stateDir);
    expect(written).toEqual([]);
  });

  it('prints nothing when the banner is disabled (agents, pipes, --json)', async () => {
    seedBaseline(stateDir, legacyFingerprint());
    await emitIndexFormatNotice({ ...humanPolicy, bannerEnabled: false }, stateDir);
    expect(written).toEqual([]);
  });
});

describe('persisted LI model (runtime.li.model in .sweet-search/config.json)', () => {
  let projectRoot;
  let stateDir;
  let logs;
  let originalLog;
  let originalModel;
  let originalEnv;
  beforeEach(async () => {
    const { LATE_INTERACTION_CONFIG } = await import('../../core/infrastructure/config/index.js');
    originalModel = LATE_INTERACTION_CONFIG.model;
    originalEnv = process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
    delete process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-fp-edge-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    writeJson(join(stateDir, 'config.json'), { runtime: { li: { model: 'lateon-code-edge' } } });
    logs = [];
    originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
  });
  afterEach(async () => {
    const { LATE_INTERACTION_CONFIG } = await import('../../core/infrastructure/config/index.js');
    LATE_INTERACTION_CONFIG.model = originalModel;
    if (originalEnv === undefined) delete process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
    else process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL = originalEnv;
    console.log = originalLog;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('an edge-model index built by the indexer is NOT a mismatch for the daemon gate', async () => {
    // What the full indexer stamps after applyPersistedLiModel picked edge.
    seedBaseline(stateDir, { ...buildConfigFingerprint(), liModel: 'lateon-code-edge' });
    await handleIncrementalCli('reconcile', ['status', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    const payload = JSON.parse(logs.join('\n'));
    expect(payload.baseline).toMatchObject({ ready: true, state: 'indexed' });
  });

  it('the daemon tick applies the persisted model before its gate', async () => {
    seedBaseline(stateDir, { ...buildConfigFingerprint(), liModel: 'lateon-code-edge' });
    const { LATE_INTERACTION_CONFIG } = await import('../../core/infrastructure/config/index.js');
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    const result = await runReconcileV2Tick({ projectRoot, stateDir });
    expect(result.skipped).toBeFalsy();
    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code-edge');
  });
});
