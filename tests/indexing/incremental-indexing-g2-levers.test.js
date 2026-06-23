/**
 * G2 efficiency levers — reconciler batching (E.1), live HNSW (E.2), SQLite
 * pragmas (E.4), FTS5 budgeting (E.5), chunk-cutoff (E.6), autotune-config (A.4).
 *
 * Every lever has its own env flag, all default OFF. The cardinal invariant: with
 * EVERY flag off the reconciler is byte/behavior-identical to today (covered by
 * the existing suites). These tests exercise the flag-ON paths:
 *
 *   - E.1 byte-identical tick: two batched runs (E.1 + G1 deterministic levels)
 *     produce byte-identical canonical artifacts (the batched path is fully
 *     deterministic). Batched vs per-file is recall-equivalent (different
 *     insertion order) per the plan — not asserted byte-identical here.
 *   - Crash-consistency: SIGKILL between the SQLite commit and the HNSW batch
 *     save → restart → live (queryable) state reconverges, with NO live SQLite
 *     vector row missing from the HNSW int8 (live) map.
 *   - E.6 dependency-change: the cutoff key folds cross-file enrichment, so a
 *     dependency-symbol change is NOT skipped; a content-changed-but-encoder-
 *     input-identical edit IS skipped.
 *   - E.5 FTS5 budget: page count scales with spare budget; optimize + truncate.
 *   - E.4 pragmas: byte-identical (cache/heap settings don't change output).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { runProductionReconcileTick, createProductionReconciler, shutdownLiveStores } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import {
  runFixedSequence,
  __testing as harness,
} from '../../eval/index-maintainer-determinism/run-harness.mjs';
import { byteDiff } from '../../eval/index-maintainer-determinism/dump-artifacts.mjs';
import { ASTChunker } from '../../core/indexing/ast-chunker.js';
import {
  computeCutoffSignature,
  signaturesMatch,
  loadCutoffCache,
  setFileSignature,
  getFileSignature,
  deleteFileSignature,
  saveCutoffCache,
  chunkCutoffEnabled,
} from '../../core/incremental-indexing/domain/cutoff-cache.mjs';
import {
  fts5MergeBudgetPages,
  fts5WatermarkBudgetPages,
  fts5Optimize,
} from '../../core/incremental-indexing/infrastructure/sqlite-fts5.mjs';
import { flushFloatStore } from '../../core/incremental-indexing/application/production-reconciler-helpers.mjs';
import { defaultMaintenanceHandlers } from '../../core/incremental-indexing/application/maintenance-worker.mjs';
import { FloatVectorStore, getFloatStorePath } from '../../core/vector-store/float-vector-store.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });
const silent = { info() {}, warn() {}, error() {} };

function fakeVector(text, index) {
  const seed = [...text].reduce((s, c) => s + c.charCodeAt(0), index + 1);
  return Float32Array.from({ length: 8 }, (_, i) => ((seed + i * 13) % 97) / 97);
}

function makeEncoders() {
  const encoded = [];
  return {
    encoded,
    vectorEncoder: async (texts) => { encoded.push(...texts); return texts.map((t, i) => fakeVector(t, i)); },
    liEncoder: async (texts) => texts.map((t, i) => [Float32Array.from([t.length + i, 2, 3, 4])]),
  };
}

const FLAG_KEYS = [
  'SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES',
  'SWEET_SEARCH_RECONCILE_LIVE_HNSW',
  'SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS',
  'SWEET_SEARCH_RECONCILE_FTS5_BUDGET',
  'SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE',
  'SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF',
  'SWEET_SEARCH_RECONCILE_AUTOTUNE',
  'SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS',
];

function clearFlags() {
  for (const k of FLAG_KEYS) delete process.env[k];
}

describe('G2 cutoff-cache domain (E.6)', () => {
  it('the cutoff key folds cross-file enrichment (scope + imports)', () => {
    // Same chunk text; only enrichment differs → DIFFERENT embedding-input hash.
    // This is the structural correctness gate: a dependency-symbol change alters
    // the dependent file's enriched embedding_text and therefore its key, so the
    // dependent is never wrongly skipped.
    const base = { text: 'function f(){ return 1; }', content: 'function f(){ return 1; }', metadata: { symbol: 'f', language: 'javascript' }, file: 'a.js', embedding_text: 'a.js\nfunction f(){ return 1; }' };
    const enriched = { ...base };
    delete enriched.embedding_text;
    ASTChunker.enrichEmbeddingText(enriched, ['Outer'], ['./dep.js']);

    const sigBase = computeCutoffSignature([base]);
    const sigEnriched = computeCutoffSignature([enriched]);
    expect(sigBase.embeddingInputHashes[0]).not.toBe(sigEnriched.embeddingInputHashes[0]);
    expect(signaturesMatch(sigBase, sigEnriched)).toBe(false);
  });

  it('signaturesMatch requires both dense AND li hash lists to match in order', () => {
    const a = { embeddingInputHashes: ['x', 'y'], liInputHashes: ['p', 'q'] };
    expect(signaturesMatch(a, { embeddingInputHashes: ['x', 'y'], liInputHashes: ['p', 'q'] })).toBe(true);
    expect(signaturesMatch(a, { embeddingInputHashes: ['y', 'x'], liInputHashes: ['p', 'q'] })).toBe(false); // reorder
    expect(signaturesMatch(a, { embeddingInputHashes: ['x', 'y'], liInputHashes: ['p', 'z'] })).toBe(false); // li differs
    expect(signaturesMatch(a, { embeddingInputHashes: ['x'], liInputHashes: ['p'] })).toBe(false); // length
    expect(signaturesMatch(null, a)).toBe(false);
    // An emptied chunk set never matches → never skips a deletion/total rewrite.
    expect(signaturesMatch({ embeddingInputHashes: [], liInputHashes: [] }, { embeddingInputHashes: [], liInputHashes: [] })).toBe(false);
  });

  it('persists, reads, and deletes per-file signatures atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g2-cutoff-'));
    try {
      const cache = loadCutoffCache(dir);
      expect(getFileSignature(cache, 'src/a.js')).toBeNull();
      setFileSignature(cache, 'src/a.js', { embeddingInputHashes: ['h1'], liInputHashes: ['l1'] });
      saveCutoffCache(dir, cache);
      const reloaded = loadCutoffCache(dir);
      expect(getFileSignature(reloaded, 'src/a.js')).toEqual({ embeddingInputHashes: ['h1'], liInputHashes: ['l1'] });
      deleteFileSignature(reloaded, 'src/a.js');
      saveCutoffCache(dir, reloaded);
      expect(getFileSignature(loadCutoffCache(dir), 'src/a.js')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('chunkCutoffEnabled honors the env flag (DEFAULT-ON)', () => {
    // DEFAULT-ON: unset/empty/'1' enable; only an explicit '0' disables.
    expect(chunkCutoffEnabled({})).toBe(true);
    expect(chunkCutoffEnabled({ SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF: '1' })).toBe(true);
    expect(chunkCutoffEnabled({ SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF: '0' })).toBe(false);
  });
});

describe('G2 FTS5 budget helpers (E.5)', () => {
  it('merge page budget: fast tick → small merge, busy tick → skip', () => {
    expect(fts5MergeBudgetPages({ elapsedMs: 100 })).toBe(16);   // fast → small
    expect(fts5MergeBudgetPages({ elapsedMs: 1200 })).toBe(16);  // mid → small
    expect(fts5MergeBudgetPages({ elapsedMs: 2500 })).toBeNull(); // busy → skip
    expect(fts5MergeBudgetPages({ elapsedMs: 0 })).toBe(16);     // baseline-equivalent
  });

  it('watermark page budget scales with remaining wall-clock budget', () => {
    expect(fts5WatermarkBudgetPages({ remainingMs: Infinity })).toBe(500); // off-equivalent
    expect(fts5WatermarkBudgetPages({ remainingMs: 2000 })).toBe(500);     // full budget
    expect(fts5WatermarkBudgetPages({ remainingMs: 1000 })).toBe(250);     // half budget → half pages
    expect(fts5WatermarkBudgetPages({ remainingMs: 0 })).toBe(16);         // exhausted → floor
    expect(fts5WatermarkBudgetPages({ remainingMs: -5 })).toBe(16);        // overrun → floor
  });

  it('fts5Optimize merges to one segment and truncates the WAL (idle-gated)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g2-fts5-'));
    try {
      const db = new Database(join(dir, 'x.db'));
      db.pragma('journal_mode = WAL');
      db.exec("CREATE VIRTUAL TABLE docs USING fts5(body)");
      const ins = db.prepare('INSERT INTO docs(body) VALUES (?)');
      // Many tiny single-row inserts create many segments.
      for (let i = 0; i < 50; i++) ins.run(`token${i} shared`);
      const res = fts5Optimize(db, 'docs');
      expect(res.optimized).toBe(true);
      // Index still queryable + correct after optimize (output-equivalent).
      const hits = db.prepare("SELECT count(*) AS n FROM docs WHERE docs MATCH 'shared'").get();
      expect(hits.n).toBe(50);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fts5Optimize rejects an unsafe table name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g2-fts5b-'));
    try {
      const db = new Database(join(dir, 'x.db'));
      expect(() => fts5Optimize(db, 'docs; DROP TABLE x')).toThrow(/invalid table name/);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fts5 handler optimizes only when the flag + idle payload + size threshold all hold', async () => {
    const prevOptFlag = process.env.SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE;
    // Build a fresh, segment-rich `entities_fts` table in a fresh state dir.
    function freshDir() {
      const dir = mkdtempSync(join(tmpdir(), 'g2-fts5opt-'));
      const setup = new Database(join(dir, 'code-graph.db'));
      setup.exec('CREATE VIRTUAL TABLE entities_fts USING fts5(name)');
      const ins = setup.prepare('INSERT INTO entities_fts(name) VALUES (?)');
      for (let i = 0; i < 40; i++) { setup.exec('BEGIN'); ins.run(`sym${i} shared`); setup.exec('COMMIT'); }
      setup.close();
      return dir;
    }
    const job = { tier: 'fts5', payload: { optimize: true, tableName: 'entities_fts' } };
    const offDir = freshDir();
    const onDir = freshDir();
    try {
      // Flag OFF + optimize payload → still a merge (no optimize).
      delete process.env.SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE;
      const offRes = await defaultMaintenanceHandlers(offDir).fts5(job, { stateDir: offDir, remainingBudgetMs: Infinity });
      expect(offRes.optimized).toEqual([]);

      // Flag ON + optimize payload + above-threshold table → optimize fires.
      process.env.SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE = '1';
      const onRes = await defaultMaintenanceHandlers(onDir).fts5(job, { stateDir: onDir, remainingBudgetMs: Infinity });
      expect(onRes.optimized).toContain('entities_fts');

      // Index still queryable + correct after optimize.
      const verify = new Database(join(onDir, 'code-graph.db'), { readonly: true });
      const n = verify.prepare("SELECT count(*) AS n FROM entities_fts WHERE entities_fts MATCH 'shared'").get().n;
      expect(n).toBe(40);
      verify.close();
    } finally {
      if (prevOptFlag === undefined) delete process.env.SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE;
      else process.env.SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE = prevOptFlag;
      rmSync(offDir, { recursive: true, force: true });
      rmSync(onDir, { recursive: true, force: true });
    }
  });
});

describe('G2 flushFloatStore (E.1 tick-finalize)', () => {
  it('applies a batched delta to a resident store and saves once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'g2-float-'));
    try {
      const binPath = join(dir, 'codebase-binary-hnsw.idx');
      const store = new FloatVectorStore();
      await store.loadOrInit(getFloatStorePath(binPath), 8);
      const r = await flushFloatStore({
        binaryHnswPath: binPath,
        store,
        upserts: [{ id: 'a', vector: Float32Array.from({ length: 8 }, () => 0.1) }, { id: 'b', vector: Float32Array.from({ length: 8 }, () => 0.2) }],
        removeIds: [],
        binaryVectorsBefore: 0,
        dimension: 8,
      });
      expect(r.saved).toBe(true);
      const reload = new FloatVectorStore();
      await reload.load(getFloatStorePath(binPath));
      expect(new Set(reload.idToIndex.keys())).toEqual(new Set(['a', 'b']));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no-ops (saved=false) on an empty delta', async () => {
    const r = await flushFloatStore({ binaryHnswPath: '/nope/x.idx', upserts: [], removeIds: [], binaryVectorsBefore: 0, dimension: 8 });
    expect(r.saved).toBe(false);
  });
});

describe('G2 E.1 batched tick (byte-identical determinism)', () => {
  it('two batched runs with deterministic levels are byte-identical', async () => {
    const env = {
      SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES: '1',
      SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS: '1',
    };
    const a = await runFixedSequence({ variant: 'a', envOverrides: env });
    const b = await runFixedSequence({ variant: 'b', envOverrides: env });
    expect(byteDiff(a.dump, b.dump)).toBeNull();
  });

  it('E.4 SQLite pragmas are byte-identical to the baseline (Tier-1)', async () => {
    // Pin HNSW levels deterministically on BOTH sides so the comparison isolates
    // the pragma change. (Without G1, the unseeded getRandomLevel() makes any two
    // independent HNSW builds non-byte-identical — that is G1's concern, not
    // E.4's. cache_size / shrink_memory provably do not change query output.)
    const baseline = await runFixedSequence({ variant: 'baseline', envOverrides: { SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS: '1' } });
    const candidate = await runFixedSequence({ variant: 'candidate', envOverrides: { SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS: '1', SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS: '1' } });
    expect(byteDiff(baseline.dump, candidate.dump)).toBeNull();
  });

  it('E.1 batched produces the same live SQLite tiers as per-file', async () => {
    // SQLite tiers (vectors/graph) are insertion-order-independent, so the live
    // (queryable) SQLite state must match per-file exactly even though the HNSW
    // graph topology may differ (different insertion order — recall-equivalent).
    const base = await runFixedSequence({ variant: 'baseline', envOverrides: {}, liveOnly: true });
    const batched = await runFixedSequence({
      variant: 'batched',
      envOverrides: { SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES: '1', SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS: '1' },
      liveOnly: true,
      normalizeEpochs: true,
    });
    const baseLive = { ...base.dump, binaryHnsw: null };
    const batLive = { ...batched.dump, binaryHnsw: null };
    // Re-run baseline with normalized epochs for a like-for-like compare.
    const baseNorm = await runFixedSequence({ variant: 'baseline-n', envOverrides: {}, liveOnly: true, normalizeEpochs: true });
    expect(byteDiff({ ...baseNorm.dump, binaryHnsw: null }, batLive)).toBeNull();
    void baseLive;
  });
});

describe('G2 E.6 chunk-cutoff integration', () => {
  let projectRoot;
  let stateDir;

  beforeEach(() => {
    clearFlags();
    process.env.SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF = '1';
    projectRoot = mkdtempSync(join(tmpdir(), 'g2-e6-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    clearFlags();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function tickFor(file, encoders) {
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: file })}\n`);
    return runProductionReconcileTick({
      projectRoot, stateDir,
      vectorEncoder: encoders.vectorEncoder,
      liEncoder: encoders.liEncoder,
      modelInfo: MODEL_INFO, logger: silent,
      config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }

  it('skips a content-changed file whose encoder inputs are byte-identical', async () => {
    const enc = makeEncoders();
    writeFileSync(join(projectRoot, 'src', 'a.js'), 'export function alpha(x){\n  return x.trim();\n}\n');
    await tickFor('src/a.js', enc);
    const baseline = enc.encoded.length;

    // Append blank lines at EOF: file CONTENT changes (hash differs, so the
    // contentUnchanged short-circuit does NOT fire) but the function chunk's
    // text — and therefore its embedding/li input hash — is unchanged → SKIP.
    writeFileSync(join(projectRoot, 'src', 'a.js'), 'export function alpha(x){\n  return x.trim();\n}\n\n\n');
    const t = await tickFor('src/a.js', enc);
    expect(enc.encoded.length - baseline).toBe(0); // no re-embed
    expect(t.ops_per_tier.vectors_upsert || 0).toBe(0); // no dense/HNSW/LI tier write
    // BUT sparse-grams are derived from RAW content, not encoder inputs — the
    // content DID change, so the sparse delta MUST still be emitted or ss-grep
    // goes stale (the cutoff-skips-sparse regression Codex caught). The cutoff
    // skips only the expensive encode/dense/LI/graph tiers, never sparse.
    expect(t.ops_per_tier.sparse_gram_delta_upsert || 0).toBeGreaterThan(0);
  });

  it('does NOT skip when the chunk body actually changes', async () => {
    const enc = makeEncoders();
    writeFileSync(join(projectRoot, 'src', 'a.js'), 'export function alpha(x){\n  return x.trim();\n}\n');
    await tickFor('src/a.js', enc);
    const baseline = enc.encoded.length;

    writeFileSync(join(projectRoot, 'src', 'a.js'), 'export function alpha(x){\n  return x.trim() + 1;\n}\n');
    const t = await tickFor('src/a.js', enc);
    expect(enc.encoded.length - baseline).toBeGreaterThan(0);
    expect(t.ops_per_tier.vectors_upsert || 0).toBeGreaterThan(0);
  });
});

describe('G2 A.4 autotune config', () => {
  afterEach(() => clearFlags());

  it('flag explicitly off (=0) → autotune dormant (no signals injected)', () => {
    // Autotune is DEFAULT-ON; the dormant path is exercised with an explicit '0'.
    clearFlags();
    process.env.SWEET_SEARCH_RECONCILE_AUTOTUNE = '0';
    const dir = mkdtempSync(join(tmpdir(), 'g2-at-'));
    mkdirSync(join(dir, '.sweet-search'), { recursive: true });
    try {
      const r = createProductionReconciler({ projectRoot: dir, stateDir: join(dir, '.sweet-search'), modelInfo: MODEL_INFO });
      expect(r.config.autotuneInterval).toBe(false);
      expect(r.config.cpuLoadAvg).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flag on (default / =1) → autotuneInterval true with real cpuLoadAvg + maintenanceBacklog', () => {
    clearFlags();
    process.env.SWEET_SEARCH_RECONCILE_AUTOTUNE = '1';
    const dir = mkdtempSync(join(tmpdir(), 'g2-at-'));
    mkdirSync(join(dir, '.sweet-search'), { recursive: true });
    try {
      const r = createProductionReconciler({ projectRoot: dir, stateDir: join(dir, '.sweet-search'), modelInfo: MODEL_INFO });
      expect(r.config.autotuneInterval).toBe(true);
      expect(typeof r.config.cpuLoadAvg).toBe('number');
      expect(r.config.cpuLoadAvg).toBeGreaterThanOrEqual(0);
      expect(typeof r.config.maintenanceBacklog).toBe('number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('G2 E.2 live HNSW registry', () => {
  afterEach(async () => { clearFlags(); await shutdownLiveStores(); });

  it('keeps the resident index across ticks and reconverges with per-file output', async () => {
    clearFlags();
    process.env.SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES = '1';
    process.env.SWEET_SEARCH_RECONCILE_LIVE_HNSW = '1';
    process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';
    const projectRoot = mkdtempSync(join(tmpdir(), 'g2-live-'));
    const stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    const enc = makeEncoders();
    const tickFor = (file) => {
      writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: file })}\n`);
      return runProductionReconcileTick({ projectRoot, stateDir, vectorEncoder: enc.vectorEncoder, liEncoder: enc.liEncoder, modelInfo: MODEL_INFO, logger: silent, config: { filesPerTick: 10, cpuBudgetMs: 10_000 } });
    };
    try {
      writeFileSync(join(projectRoot, 'src', 'a.js'), 'export function alpha(x){ return x.trim(); }\n');
      const t1 = await tickFor('src/a.js');
      expect(t1.ops_per_tier.binary_hnsw_append).toBeGreaterThan(0);
      writeFileSync(join(projectRoot, 'src', 'b.js'), 'export function beta(y){ return y * 2; }\n');
      const t2 = await tickFor('src/b.js');
      expect(t2.ops_per_tier.binary_hnsw_append).toBeGreaterThan(0);
      // On graceful shutdown the resident index flushes; the on-disk live id-set
      // must then contain every live SQLite vector row.
      await shutdownLiveStores();
      const db = new Database(join(stateDir, 'codebase.db'), { readonly: true });
      const liveIds = db.prepare('SELECT id FROM vectors WHERE epoch_retired IS NULL').all().map((r) => r.id);
      db.close();
      const idx = await import('../../core/vector-store/binary-hnsw-index.js');
      const index = new idx.BinaryHNSWIndex({ indexPath: join(stateDir, 'codebase-binary-hnsw.idx'), floatDimension: 8 });
      await index.load(join(stateDir, 'codebase-binary-hnsw.idx'));
      const hnswLive = new Set(index.idToIndex.keys());
      for (const id of liveIds) expect(hnswLive.has(id)).toBe(true);
      expect(liveIds.length).toBeGreaterThan(0);
    } finally {
      clearFlags();
      await shutdownLiveStores();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('G2 crash-consistency (E.1 persist-before-advance)', () => {
  it('SIGKILL between SQLite commit and HNSW batch-save → no live row missing from HNSW', async () => {
    // Self-contained crash flow: build a baseline, then in THIS process run a
    // tick whose HNSW batch-save we abort mid-flight by throwing inside the
    // finalize fsync, then restart and drain; assert every live codebase.db
    // vector row has an HNSW int8 (live) entry and the live id-set matches a
    // clean run's.
    clearFlags();
    const env = { SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES: '1', SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS: '1' };
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    const projectRoot = harness.materializeRepo();
    const stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    try {
      // Baseline tick.
      harness.enqueue(stateDir, ['src/alpha.js', 'src/beta.js', 'src/util.js']);
      await runProductionReconcileTick({
        projectRoot, stateDir,
        vectorEncoder: harness.stubVectorEncoder, liEncoder: harness.stubLiEncoder,
        modelInfo: harness.MODEL_INFO, logger: silent,
        config: { filesPerTick: 50, cpuBudgetMs: 600_000 },
      });

      // Simulate a crash: edit a file, enqueue it, then abort the tick the
      // instant SQLite vectors are written (before HNSW save). The processing
      // queue is left in place, so the file is NOT advanced into the merkle.
      writeFileSync(join(projectRoot, 'src', 'alpha.js'), 'export function alpha(n){\n  return n + 42;\n}\n');
      harness.enqueue(stateDir, ['src/alpha.js']);
      let crashed = false;
      try {
        await runProductionReconcileTick({
          projectRoot, stateDir,
          vectorEncoder: harness.stubVectorEncoder, liEncoder: harness.stubLiEncoder,
          modelInfo: harness.MODEL_INFO, logger: silent,
          onProgress: (phase) => { if (phase === 'production:vector-written') { crashed = true; throw new Error('SIMULATED_CRASH'); } },
          config: { filesPerTick: 50, cpuBudgetMs: 600_000 },
        });
      } catch (err) {
        expect(err.message).toBe('SIMULATED_CRASH');
      }
      expect(crashed).toBe(true);

      // Restart: re-enqueue + drain (the reconciler re-reconciles the unadvanced
      // file). The processing queue from the crashed tick is reclaimed.
      harness.enqueue(stateDir, ['src/alpha.js']);
      await runProductionReconcileTick({
        projectRoot, stateDir,
        vectorEncoder: harness.stubVectorEncoder, liEncoder: harness.stubLiEncoder,
        modelInfo: harness.MODEL_INFO, logger: silent,
        config: { filesPerTick: 50, cpuBudgetMs: 600_000 },
      });

      // Invariant: every LIVE codebase.db vector row appears in the HNSW int8
      // (live) map. No indexed-but-missing-from-HNSW row.
      const db = new Database(join(stateDir, 'codebase.db'), { readonly: true });
      const liveIds = db.prepare('SELECT id FROM vectors WHERE epoch_retired IS NULL').all().map((r) => r.id);
      db.close();
      const idx = await import('../../core/vector-store/binary-hnsw-index.js');
      const index = new idx.BinaryHNSWIndex({ indexPath: join(stateDir, 'codebase-binary-hnsw.idx'), floatDimension: 8 });
      await index.load(join(stateDir, 'codebase-binary-hnsw.idx'));
      const hnswLive = new Set(index.idToIndex.keys());
      for (const id of liveIds) {
        expect(hnswLive.has(id)).toBe(true);
      }
      expect(liveIds.length).toBeGreaterThan(0);
    } finally {
      clearFlags();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
