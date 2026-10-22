import { afterEach, beforeEach, describe, expect, it, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { FloatVectorStore } from '../../core/vector-store/float-vector-store.js';
import { readIndexIdsSync } from '../../core/vector-store/binary-hnsw-index.js';
import { isSet, loadBitmap } from '../../core/incremental-indexing/infrastructure/tombstone-bitmap.mjs';

// These tests cover the float-512 store, which is written only with
// SS_FIX_FLOAT512=1 (off by default).
const savedFloat512 = process.env.SS_FIX_FLOAT512;
beforeAll(() => { process.env.SS_FIX_FLOAT512 = '1'; });
afterAll(() => {
  if (savedFloat512 === undefined) delete process.env.SS_FIX_FLOAT512;
  else process.env.SS_FIX_FLOAT512 = savedFloat512;
});


const MODEL_INFO = Object.freeze({
  provider: 'test', model: 'fake-crash', dimension: 8, hnswDimension: 8,
});
const silentLogger = { info() {}, warn() {}, error() {} };

function fakeVector(text, index) {
  const seed = [...text].reduce((s, ch) => s + ch.charCodeAt(0), index + 1);
  return Float32Array.from({ length: 8 }, (_, i) => ((seed + i * 13) % 97) / 97);
}
async function vectorEncoder(texts) { return texts.map((t, i) => fakeVector(t, i)); }
async function liEncoder(texts) {
  return texts.map((t, i) => [
    Float32Array.from([t.length + i, 2, 3, 4]),
    Float32Array.from([t.length + i + 1, 3, 4, 5]),
  ]);
}

function readJson(p) { return JSON.parse(readFileSync(p, 'utf-8')); }
function enqueue(stateDir, rel) {
  writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: rel })}\n`);
}
function liveVectorIds(stateDir) {
  const db = new Database(join(stateDir, 'codebase.db'), { readonly: true });
  try {
    return new Set(db.prepare('SELECT id FROM vectors WHERE epoch_retired IS NULL').all().map((r) => r.id));
  } finally { db.close(); }
}
async function hnswVectorIds(stateDir) {
  const found = readIndexIdsSync(join(stateDir, 'codebase-binary-hnsw.idx'));
  if (!found) return new Set();
  return new Set(found.ids.filter((id) => id != null));
}
async function floatStoreIds(stateDir) {
  const store = new FloatVectorStore();
  const loaded = await store.load(join(stateDir, 'codebase-float-vectors.bin'));
  if (!loaded) return new Set();
  return new Set(store.idToIndex.keys());
}
async function liDocIds(stateDir) {
  const idx = new LateInteractionIndex({ indexPath: join(stateDir, 'codebase-late-interaction.db'), loadExisting: true });
  await idx.init();
  return new Set(idx.documents.keys());
}

/**
 * Task #4 — default per-file path crash-consistency. A SIGKILL after the SQLite
 * vector COMMIT but before the dependent tiers (HNSW, LI) persist leaves the row
 * durable in codebase.db while the HNSW node + LI doc were never written, and
 * the merkle never advanced. On the next tick the committed row hash-matches an
 * exact reuse → without the torn-row repair, the chunk is QUERYABLE via
 * SQLite/FTS yet permanently MISSING from the HNSW + LI search indexes.
 *
 * The full SIGKILL end-to-end proof lives in the determinism harness
 * (`eval/index-maintainer-determinism/run-harness.mjs --kill-after-tick 2`,
 * liveDiff null). This unit test reproduces the exact torn state in-process and
 * asserts the next tick re-adds the live row to HNSW + the float store + LI.
 */
describe('crash-consistency: torn SQLite-committed row is re-added to HNSW + LI', () => {
  let projectRoot;
  let stateDir;
  let rel;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-crash-recover-'));
    stateDir = join(projectRoot, '.sweet-search');
    rel = 'src/sample.js';
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(projectRoot, rel), [
      'export function alphaThing(input) {',
      '  return input.trim();',
      '}',
      '',
    ].join('\n'));
  });

  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  async function tick() {
    return runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: silentLogger, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }

  /**
   * Reproduce the torn state: SQLite vectors committed (epoch_written = E) but
   * the HNSW / float / LI artifacts and the merkle were never written/advanced
   * (publishedEpoch < E). We get this exact shape by running ONE tick and then
   * deleting the downstream-tier artifacts + the merkle, leaving codebase.db
   * intact — precisely "committed SQLite, lost downstream tiers, un-advanced
   * merkle".
   */
  function simulateCrashResidue() {
    for (const name of [
      'codebase-binary-hnsw.idx', 'codebase-binary-hnsw.stale.bin',
      'codebase-float-vectors.bin', 'merkle-state.json',
    ]) {
      try { unlinkSync(join(stateDir, name)); } catch { /* ok if absent */ }
    }
    rmSync(join(stateDir, 'codebase-late-interaction.db'), { force: true });
    rmSync(join(stateDir, 'codebase-late-interaction.db.segments'), { recursive: true, force: true });
  }

  it('re-adds the committed-but-orphaned row to HNSW, float store, and LI on the next tick', async () => {
    // Tick 1: full clean index of the file.
    enqueue(stateDir, rel);
    await tick();

    const liveIds = liveVectorIds(stateDir);
    expect(liveIds.size).toBeGreaterThan(0);
    // Sanity: a clean tick put every live row in HNSW + float + LI.
    expect(await hnswVectorIds(stateDir)).toEqual(liveIds);
    expect(await floatStoreIds(stateDir)).toEqual(liveIds);
    expect(await liDocIds(stateDir)).toEqual(liveIds);

    // Crash residue: downstream tiers + merkle gone; codebase.db keeps the rows
    // (epoch_written stays = the un-published tick's epoch).
    simulateCrashResidue();
    expect(existsSync(join(stateDir, 'merkle-state.json'))).toBe(false);
    expect(await hnswVectorIds(stateDir)).toEqual(new Set()); // HNSW lost

    // Restart tick: the file is re-reconciled (no merkle ⇒ not skipped); the
    // committed rows hash-match an exact reuse, so WITHOUT the torn-row repair
    // nothing would be re-added. With it, every live row returns to HNSW + LI.
    enqueue(stateDir, rel);
    await tick();

    const liveAfter = liveVectorIds(stateDir);
    // The live SET is preserved (same row ids — repaired under their existing
    // ids, not re-encoded into fresh ones).
    expect(liveAfter).toEqual(liveIds);
    expect(await hnswVectorIds(stateDir)).toEqual(liveAfter); // missing-node hole closed
    expect(await floatStoreIds(stateDir)).toEqual(liveAfter);
    expect(await liDocIds(stateDir)).toEqual(liveAfter); // LI hole closed
    // No duplicate LI docs (retire+add keeps it exactly-once).
    const liIdx = new LateInteractionIndex({ indexPath: join(stateDir, 'codebase-late-interaction.db'), loadExisting: true });
    await liIdx.init();
    expect(liIdx.documents.size).toBe(liveAfter.size);

    // The merkle now records the file's chunk ids (a torn add produced no fresh
    // newIds; the repair still records the recovered ids).
    const merkle = readJson(join(stateDir, 'merkle-state.json'));
    expect(merkle.files[rel]).toBeTruthy();
    expect(merkle.files[rel].chunkIds.length).toBe(liveAfter.size);
  });

  it('non-crash re-tick (merkle intact) does NOT trigger the repair (no needless re-add)', async () => {
    // Two clean ticks with no residue: the second tick must be a pure reuse —
    // the torn-row repair must never fire, so HNSW/LI membership equals the live
    // set and no duplicate work happens.
    enqueue(stateDir, rel);
    await tick();
    const liveIds = liveVectorIds(stateDir);

    // Force a re-reconcile WITHOUT a crash: invalidate only the merkle HASH so
    // the file is processed again, but keep the merkle epoch intact (so prior
    // rows are NOT seen as torn) — mirrors a benign re-queue of an unchanged
    // file whose recorded hash drifted.
    const merklePath = join(stateDir, 'merkle-state.json');
    const merkle = readJson(merklePath);
    merkle.files[rel].hash = 'stale-hash-force-reconcile';
    writeFileSync(merklePath, JSON.stringify(merkle, null, 2));

    enqueue(stateDir, rel);
    await tick();

    // Live set + membership unchanged; no duplicate LI docs.
    expect(await hnswVectorIds(stateDir)).toEqual(liveIds);
    expect(await liDocIds(stateDir)).toEqual(liveIds);
    const liIdx = new LateInteractionIndex({ indexPath: join(stateDir, 'codebase-late-interaction.db'), loadExisting: true });
    await liIdx.init();
    expect(liIdx.documents.size).toBe(liveIds.size);
  });
});

// A full build writes its rows at epoch 0 and a merkle without an epoch. The first tick after
// it treated those rows as torn, and its repair re-added the chunk the same tick had retired:
// the edited file's old chunk stayed live in LI (found on a fixture repo, 2026-10-22).
describe('first tick after a full build', () => {
  let projectRoot;
  let stateDir;
  const rel = 'src/sample.js';

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-first-tick-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(projectRoot, rel), 'export function alphaThing(input) {\n  return input.trim();\n}\n');
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  async function tick() {
    return runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: silentLogger, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }

  // HNSW nodes not marked stale (a retired node stays in the graph until compaction).
  function hnswLiveIds() {
    const indexPath = join(stateDir, 'codebase-binary-hnsw.idx');
    const { ids } = readIndexIdsSync(indexPath);
    const stale = existsSync(`${indexPath}.stale.bin`) ? loadBitmap(`${indexPath}.stale.bin`) : null;
    return new Set(ids.filter((id, node) => id != null && !(stale && isSet(stale, node))));
  }

  // Give the indexed state the shape a full build leaves: rows at epoch 0, no merkle epoch.
  function asFullBuild() {
    const db = new Database(join(stateDir, 'codebase.db'));
    try { db.prepare('UPDATE vectors SET epoch_written = 0').run(); } finally { db.close(); }
    const merklePath = join(stateDir, 'merkle-state.json');
    const merkle = readJson(merklePath);
    delete merkle.epoch;
    writeFileSync(merklePath, JSON.stringify(merkle, null, 2));
  }

  it('keeps no retired chunk of an edited file in LI, HNSW or the float store', async () => {
    enqueue(stateDir, rel);
    await tick();
    const before = liveVectorIds(stateDir);
    asFullBuild();

    writeFileSync(join(projectRoot, rel), 'export function alphaThing(input) {\n  return input.trim().toLowerCase();\n}\n');
    enqueue(stateDir, rel);
    await tick();

    const live = liveVectorIds(stateDir);
    expect([...live].some((id) => before.has(id))).toBe(false);
    expect(await liDocIds(stateDir)).toEqual(live);
    expect(hnswLiveIds()).toEqual(live);
    expect(await floatStoreIds(stateDir)).toEqual(live);
  });

  it('does not re-add a torn row that the restart tick retires because the file changed', async () => {
    enqueue(stateDir, rel);
    await tick();
    const before = liveVectorIds(stateDir);
    // A tick that never published: its rows are newer than any merkle epoch.
    unlinkSync(join(stateDir, 'merkle-state.json'));

    writeFileSync(join(projectRoot, rel), 'export function alphaThing(input) {\n  return input.trim().toUpperCase();\n}\n');
    enqueue(stateDir, rel);
    await tick();

    const live = liveVectorIds(stateDir);
    expect([...live].some((id) => before.has(id))).toBe(false);
    expect(await liDocIds(stateDir)).toEqual(live);
    expect(hnswLiveIds()).toEqual(live);
    expect(await floatStoreIds(stateDir)).toEqual(live);
  });
});

// Tombstones were written per file during the tick, before the index save and the COMMIT.
// When the tick then failed, SQLite rolled back but the marks stayed: the still-live rows
// were hidden from vector and LI search (for good, if the file was reverted meanwhile).
describe('a tick that fails before its COMMIT', () => {
  let projectRoot;
  let stateDir;
  const rel = 'src/sample.js';
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-failed-tick-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(projectRoot, rel), 'export function alphaThing(input) {\n  return input.trim();\n}\n');
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  async function tick() {
    return runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: silentLogger, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }
  function hnswLiveIds() {
    const indexPath = join(stateDir, 'codebase-binary-hnsw.idx');
    const { ids } = readIndexIdsSync(indexPath);
    const stale = existsSync(`${indexPath}.stale.bin`) ? loadBitmap(`${indexPath}.stale.bin`) : null;
    return new Set(ids.filter((id, node) => id != null && !(stale && isSet(stale, node))));
  }

  it('leaves no tombstone on rows that stayed live', async () => {
    enqueue(stateDir, rel);
    await tick();
    const live = liveVectorIds(stateDir);

    writeFileSync(join(projectRoot, rel), 'export function alphaThing(input) {\n  return input.trim().toLowerCase();\n}\n');
    enqueue(stateDir, rel);
    const { BinaryHNSWIndex } = await import('../../core/vector-store/binary-hnsw-index.js');
    const save = BinaryHNSWIndex.prototype.save;
    BinaryHNSWIndex.prototype.save = async () => { throw new Error('disk full'); };
    try {
      await tick().catch(() => {});
    } finally {
      BinaryHNSWIndex.prototype.save = save;
    }

    expect(liveVectorIds(stateDir)).toEqual(live); // rolled back
    expect(hnswLiveIds()).toEqual(live);
    expect(await liDocIds(stateDir)).toEqual(live);
  });
});
