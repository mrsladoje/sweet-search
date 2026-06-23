import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { FloatVectorStore } from '../../core/vector-store/float-vector-store.js';

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
function hnswVectorIds(stateDir) {
  const p = join(stateDir, 'codebase-binary-hnsw.vectors.json');
  if (!existsSync(p)) return new Set();
  return new Set(readJson(p).filter((v) => v && v.id != null).map((v) => v.id));
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
      'codebase-binary-hnsw.idx', 'codebase-binary-hnsw.meta.json',
      'codebase-binary-hnsw.vectors.json', 'codebase-binary-hnsw.graph.json',
      'codebase-binary-hnsw.int8.json', 'codebase-binary-hnsw.stale.bin',
      'codebase-float-vectors.bin', 'merkle-state.json',
      // The chunk-cutoff cache (lever E.6, now DEFAULT-ON) is persisted by
      // persistManifest in the SAME step that advances the merkle (see
      // production-reconciler.mjs:1219). A torn tick that never advanced the
      // merkle therefore never wrote the cutoff cache for that tick either, so a
      // faithful crash residue must drop it alongside the merkle. Otherwise a
      // stale cutoff signature would short-circuit applyVectorDelta BEFORE the
      // per-file torn-row repair — an inconsistent residue that cannot occur in
      // production (cutoff cache + merkle co-persist atomically).
      'reconcile-cutoff-cache.json',
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
    expect(hnswVectorIds(stateDir)).toEqual(liveIds);
    expect(await floatStoreIds(stateDir)).toEqual(liveIds);
    expect(await liDocIds(stateDir)).toEqual(liveIds);

    // Crash residue: downstream tiers + merkle gone; codebase.db keeps the rows
    // (epoch_written stays = the un-published tick's epoch).
    simulateCrashResidue();
    expect(existsSync(join(stateDir, 'merkle-state.json'))).toBe(false);
    expect(hnswVectorIds(stateDir)).toEqual(new Set()); // HNSW lost

    // Restart tick: the file is re-reconciled (no merkle ⇒ not skipped); the
    // committed rows hash-match an exact reuse, so WITHOUT the torn-row repair
    // nothing would be re-added. With it, every live row returns to HNSW + LI.
    enqueue(stateDir, rel);
    await tick();

    const liveAfter = liveVectorIds(stateDir);
    // The live SET is preserved (same row ids — repaired under their existing
    // ids, not re-encoded into fresh ones).
    expect(liveAfter).toEqual(liveIds);
    expect(hnswVectorIds(stateDir)).toEqual(liveAfter); // missing-node hole closed
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
    expect(hnswVectorIds(stateDir)).toEqual(liveIds);
    expect(await liDocIds(stateDir)).toEqual(liveIds);
    const liIdx = new LateInteractionIndex({ indexPath: join(stateDir, 'codebase-late-interaction.db'), loadExisting: true });
    await liIdx.init();
    expect(liIdx.documents.size).toBe(liveIds.size);
  });
});
