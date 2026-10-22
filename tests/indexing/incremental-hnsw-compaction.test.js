/**
 * Binary HNSW compaction (hnsw-compaction.mjs, binaryHnswHandler): the maintainer
 * folds the delta rows into a new base and drops retired nodes. A small base is
 * rebuilt flat inline; a large one is built with a graph in a child process while
 * ticks keep appending and retiring, then published through a journal that a
 * crash rolls forward.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { binaryHnswHandler, __hnswTesting } from '../../core/incremental-indexing/application/maintenance-handlers.mjs';
import {
  compactionPaths, rollForwardHnswCompaction,
} from '../../core/incremental-indexing/infrastructure/hnsw-compaction.mjs';
import { markBinaryStale } from '../../core/incremental-indexing/application/production-reconciler-helpers.mjs';
import { BinaryHNSWIndex, EXACT_SCAN_MAX_VECTORS } from '../../core/vector-store/binary-hnsw-index.js';
import { buildHnswIndex } from '../../core/indexing/artifact-builder.js';
import { deltaPathFor } from '../../core/vector-store/hnsw-delta-file.js';
import { floatToBinary, normalizedFloatToInt8, truncateForHNSW } from '../../core/infrastructure/quantization.js';
import { isSet } from '../../core/infrastructure/tombstone-bitmap-reader.js';

function vectors(n, d = 768, seed = 11) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(d);
    let q = 0;
    for (let j = 0; j < d; j++) { v[j] = rnd(); q += v[j] * v[j]; }
    q = Math.sqrt(q);
    for (let j = 0; j < d; j++) v[j] /= q;
    out.push(v);
  }
  return out;
}
const id = (i) => `c${String(i).padStart(4, '0')}`;
const item = (i, v) => {
  const t = truncateForHNSW(v, 512);
  return { id: id(i), binary: floatToBinary(t), metadata: { file: `${id(i)}.js` }, int8: normalizedFloatToInt8(t), full: v };
};
const qb = (v) => floatToBinary(truncateForHNSW(v, 512));

describe('binary HNSW compaction', () => {
  let stateDir;
  let indexPath;
  let vs;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-hnsw-compact-'));
    indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
  });
  afterEach(async () => {
    const build = __hnswTesting.build();
    if (build && !build.done) build.child?.kill('SIGKILL');
    // Drop a leftover build so the next test starts clean.
    if (build) await binaryHnswHandler({}, { stateDir }).catch(() => {});
    __hnswTesting.setGraphMin(EXACT_SCAN_MAX_VECTORS);
    vi.restoreAllMocks();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  /** A graph base of `n` vectors and a codebase.db naming them live. */
  async function setup(n, total) {
    vs = vectors(total);
    const { index } = await buildHnswIndex(vs.slice(0, n).map((e, i) => ({ id: id(i), embedding: e, metadata: { file: `${id(i)}.js` } })), { indexPath });
    await index.save(indexPath);
    index.close();
    const db = new Database(path.join(stateDir, 'codebase.db'));
    db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, epoch_retired INTEGER)');
    const ins = db.prepare('INSERT INTO vectors (id, epoch_retired) VALUES (?, NULL)');
    for (let i = 0; i < n; i++) ins.run(id(i));
    db.close();
  }

  /** One maintainer tick: append vectors [from, to) as delta rows, retire `retire`. */
  async function tick(from, to, retire = []) {
    const index = new BinaryHNSWIndex({ indexPath });
    await index.load(indexPath);
    const db = new Database(path.join(stateDir, 'codebase.db'));
    const ins = db.prepare('INSERT INTO vectors (id, epoch_retired) VALUES (?, NULL)');
    for (let i = from; i < to; i++) ins.run(id(i));
    const ret = db.prepare('UPDATE vectors SET epoch_retired = 2 WHERE id = ?');
    for (const i of retire) ret.run(id(i));
    db.close();
    index.appendDelta(Array.from({ length: to - from }, (_, k) => item(from + k, vs[from + k])));
    for (const i of retire) markBinaryStale(index, id(i));
    index.close();
  }

  function liveIds() {
    const db = new Database(path.join(stateDir, 'codebase.db'), { readonly: true });
    try { return db.prepare('SELECT id FROM vectors WHERE epoch_retired IS NULL ORDER BY id').all().map((r) => r.id); }
    finally { db.close(); }
  }

  /** The ids a search can return: nodes without a stale mark. */
  async function visible() {
    const index = new BinaryHNSWIndex({ indexPath });
    await index.load(indexPath);
    const stale = index._loadStaleBitmap();
    const out = [];
    for (let i = 0; i < index.size; i++) if (!(stale && isSet(stale, i))) out.push(index.nodeId(i));
    const info = { graphless: index.graphless, deltaCount: index.deltaCount, size: index.size };
    index.close();
    return { ids: out.sort(), ...info };
  }

  async function expectFindsEachLive(sample) {
    const index = new BinaryHNSWIndex({ indexPath });
    await index.load(indexPath);
    for (const i of sample) {
      const res = (await index.search(qb(vs[i]), 3)).results;
      expect(res[0].id).toBe(id(i));
    }
    index.close();
  }

  function leftovers() {
    const p = compactionPaths(indexPath);
    return [p.staged, p.journal, p.deltaNext, p.staleNext].filter((f) => fs.existsSync(f));
  }

  it('folds a small index into a flat base inline, with the same answers as a full build of the live set', async () => {
    await setup(200, 260);
    const retired = [3, 50, 120, 199, 210, 255];
    await tick(200, 260, retired);
    const daemon = new BinaryHNSWIndex({ indexPath });
    await daemon.load(indexPath);

    const out = await binaryHnswHandler({}, { stateDir });
    expect(out).toMatchObject({ tier: 'binary_hnsw', graph: false, foldedDelta: 60, kept: 254, dropped: 6 });
    const after = await visible();
    expect(after).toMatchObject({ graphless: true, deltaCount: 0, size: 254 });
    expect(after.ids).toEqual(liveIds());
    expect(fs.existsSync(deltaPathFor(indexPath))).toBe(false);
    expect(fs.existsSync(`${indexPath}.stale.bin`)).toBe(false);
    expect(leftovers()).toEqual([]);
    // The daemon's loaded delta belongs to the old base: it must reload, not tail-read.
    expect(daemon.refreshDelta()).toBe(false);
    daemon.close();

    // Recall: identical to a full build over the live set (scores, and ids per score).
    const livePath = path.join(stateDir, 'live.idx');
    const live = liveIds().map((x) => Number(x.slice(1)));
    const { index: full } = await buildHnswIndex(live.map((i) => ({ id: id(i), embedding: vs[i], metadata: {} })), { indexPath: livePath });
    const compacted = new BinaryHNSWIndex({ indexPath });
    await compacted.load(indexPath);
    const shape = (rs) => {
      const last = rs[rs.length - 1].score;
      return { scores: rs.map((r) => r.score), ids: rs.filter((r) => r.score !== last).map((r) => `${r.score}:${r.id}`).sort() };
    };
    for (const q of vectors(12, 768, 5)) {
      expect(shape((await compacted.search(qb(q), 15)).results)).toEqual(shape((await full.search(qb(q), 15)).results));
    }
    compacted.close();
    full.close();

    // Nothing left to fold: the next run skips.
    expect(await binaryHnswHandler({}, { stateDir })).toMatchObject({ skipped: 'no-stale-vectors' });
  });

  it('builds a graph base in a child process while a tick appends and retires, then carries the tick over', async () => {
    __hnswTesting.setGraphMin(100);
    await setup(300, 400);
    await tick(300, 340, [5, 305]);

    const started = await binaryHnswHandler({}, { stateDir });
    expect(started).toMatchObject({ requeue: true, background: 'started', snapshotCount: 340 });
    // A tick during the build: new rows past the snapshot, a retire before and after it.
    await tick(340, 370, [7, 320, 345]);
    expect(await binaryHnswHandler({}, { stateDir })).toMatchObject({ requeue: true });

    const build = __hnswTesting.build();
    for (let t = 0; t < 600 && !build.done; t++) await new Promise((r) => setTimeout(r, 50));
    expect(build.done).toBe(true);
    expect(build.error).toBeNull();

    const out = await binaryHnswHandler({}, { stateDir });
    expect(out).toMatchObject({ tier: 'binary_hnsw', graph: true, background: true, carriedDelta: 30 });
    const after = await visible();
    expect(after.graphless).toBe(false);
    expect(after.deltaCount).toBe(30);
    expect(after.ids).toEqual(liveIds());
    expect(leftovers()).toEqual([]);
    await expectFindsEachLive([0, 99, 250, 310, 339, 341, 369]);

    // A tick after the publish appends to the new base's delta.
    await tick(370, 400, [341]);
    expect((await visible()).ids).toEqual(liveIds());
    await expectFindsEachLive([371, 399]);
  }, 60000);

  it('rolls a publish forward after a crash between its renames', async () => {
    await setup(150, 190);
    await tick(150, 190, [10, 160]);
    const realRename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      if (b === indexPath && String(a).endsWith('.compact.idx')) throw new Error('crash before the commit point');
      return realRename(a, b);
    });
    await expect(binaryHnswHandler({}, { stateDir })).rejects.toThrow('crash before the commit point');
    vi.restoreAllMocks();
    expect(fs.existsSync(compactionPaths(indexPath).journal)).toBe(true);

    expect(rollForwardHnswCompaction(indexPath)).toBe(true);
    const after = await visible();
    expect(after).toMatchObject({ graphless: true, deltaCount: 0, size: 188 });
    expect(after.ids).toEqual(liveIds());
    expect(leftovers()).toEqual([]);
    await expectFindsEachLive([0, 149, 151, 189]);
  });
});
