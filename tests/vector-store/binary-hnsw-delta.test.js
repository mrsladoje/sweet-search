import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';
import { buildHnswIndex } from '../../core/indexing/artifact-builder.js';
import { deltaPathFor } from '../../core/vector-store/hnsw-delta-file.js';
import { floatToBinary, normalizedFloatToInt8, truncateForHNSW } from '../../core/infrastructure/quantization.js';
import { nativeRescoreKernels } from '../../core/infrastructure/native-rescore.js';

// The maintainer appends new vectors to a delta file instead of inserting them into the
// graph and rewriting the whole index file every tick. Search must see base + delta exactly
// as it would see one index holding both.

function vectors(n, d = 768, seed = 7) {
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
const item = (id, v) => {
  const t = truncateForHNSW(v, 512);
  return { id, binary: floatToBinary(t), metadata: { file: `${id}.js` }, int8: normalizedFloatToInt8(t), full: v };
};

describe('binary HNSW delta file', () => {
  let dir;
  let saved;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-hnsw-delta-')); saved = process.env.SS_FIX_HNSW_SCAN; });
  afterEach(() => {
    if (saved === undefined) delete process.env.SS_FIX_HNSW_SCAN; else process.env.SS_FIX_HNSW_SCAN = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function baseIndex(vs, name = 'a.idx') {
    const p = path.join(dir, name);
    const { index } = await buildHnswIndex(vs.map((e, i) => ({ id: `v${i}`, embedding: e, metadata: {} })), { indexPath: p });
    await index.save(p);
    index.close();
    return p;
  }

  it('answers like one index holding base and delta, after a reload and through refreshDelta', async () => {
    const vs = vectors(600);
    const p = await baseIndex(vs.slice(0, 500));
    const daemon = new BinaryHNSWIndex({ indexPath: p });
    await daemon.load(p);

    const writer = new BinaryHNSWIndex({ indexPath: p });
    await writer.load(p);
    const before = fs.statSync(p).mtimeMs;
    expect(writer.appendDelta(vs.slice(500).map((v, i) => item(`v${500 + i}`, v)))).toBe(100);
    expect(fs.statSync(p).mtimeMs).toBe(before); // the index file is not rewritten
    expect(fs.existsSync(deltaPathFor(p))).toBe(true);
    writer.close();

    const reloaded = new BinaryHNSWIndex({ indexPath: p });
    await reloaded.load(p);
    expect(reloaded.size).toBe(600);
    expect(reloaded.deltaCount).toBe(100);
    expect(daemon.refreshDelta()).toBe(true);
    expect(daemon.size).toBe(600);

    const allP = await baseIndex(vs, 'all.idx');
    const all = new BinaryHNSWIndex({ indexPath: allP });
    await all.load(allP);
    // A full build stores the nodes in another order, so equal scores can tie-break
    // differently: compare the scores, and the ids per score (except the tie cut at k).
    const shape = (rs) => {
      const last = rs[rs.length - 1].score;
      return { scores: rs.map((r) => r.score), ids: rs.filter((r) => r.score !== last).map((r) => `${r.score}:${r.id}`).sort() };
    };
    for (const q of vectors(15, 768, 99)) {
      const qb = floatToBinary(truncateForHNSW(q, 512));
      const want = shape((await all.search(qb, 20)).results);
      expect(shape((await reloaded.search(qb, 20)).results)).toEqual(want);
      expect(shape((await daemon.search(qb, 20)).results)).toEqual(want);
    }
    // The delta rows carry int8 rows and full vectors for the later stages.
    const node = reloaded.idToIndex.get('v550');
    expect(reloaded.nodeInt8(node)).toBeTruthy();
    if (nativeRescoreKernels()) expect(reloaded.fullVectorOf(node)).not.toBeNull();
    for (const ix of [daemon, reloaded, all]) ix.close();
  });

  it('merges the delta into a graph walk (above the scan size the walk cannot reach it)', async () => {
    process.env.SS_FIX_HNSW_SCAN = '0';
    const vs = vectors(400);
    const p = await baseIndex(vs.slice(0, 300));
    const writer = new BinaryHNSWIndex({ indexPath: p });
    await writer.load(p);
    writer.appendDelta(vs.slice(300).map((v, i) => item(`v${300 + i}`, v)));
    for (let i = 300; i < 400; i += 17) {
      const qb = floatToBinary(truncateForHNSW(vs[i], 512));
      expect((await writer.search(qb, 5)).results[0].id).toBe(`v${i}`);
    }
    // The fused cascade walks the base only: it steps aside while delta rows exist.
    expect(writer.searchCascade(floatToBinary(truncateForHNSW(vs[0], 512)), 10, { queryFloat: vs[0] })).toBeNull();
    writer.close();
  });

  it('ignores a torn tail and appends after the last good record', async () => {
    const vs = vectors(60);
    const p = await baseIndex(vs.slice(0, 40));
    const w = new BinaryHNSWIndex({ indexPath: p });
    await w.load(p);
    w.appendDelta(vs.slice(40, 50).map((v, i) => item(`v${40 + i}`, v)));
    w.close();
    const size = fs.statSync(deltaPathFor(p)).size;
    fs.truncateSync(deltaPathFor(p), size - 7); // a crash in the middle of the last record

    const w2 = new BinaryHNSWIndex({ indexPath: p });
    await w2.load(p);
    expect(w2.deltaCount).toBe(9);
    w2.appendDelta(vs.slice(49, 60).map((v, i) => item(`v${49 + i}`, v)));
    w2.close();
    const r = new BinaryHNSWIndex({ indexPath: p });
    await r.load(p);
    expect(r.deltaCount).toBe(20);
    expect(r.nodeId(r.size - 1)).toBe('v59');
    r.close();
  });

  it('cuts a long torn tail before it appends, so no junk stays past the last record', async () => {
    const vs = vectors(45);
    const p = await baseIndex(vs.slice(0, 40));
    const w = new BinaryHNSWIndex({ indexPath: p });
    await w.load(p);
    w.appendDelta(vs.slice(40, 44).map((v, i) => item(`v${40 + i}`, v)));
    w.close();
    fs.appendFileSync(deltaPathFor(p), Buffer.alloc(9000, 0x5a)); // a torn multi-record write
    const w2 = new BinaryHNSWIndex({ indexPath: p });
    await w2.load(p);
    expect(w2.deltaCount).toBe(4);
    w2.appendDelta([item('v44', vs[44])]);
    expect(fs.statSync(deltaPathFor(p)).size).toBe(w2._delta.end);
    w2.close();
  });

  it('makes the daemon reload when the delta file was replaced, instead of reading its tail', async () => {
    const vs = vectors(80);
    const p = await baseIndex(vs.slice(0, 40));
    const w = new BinaryHNSWIndex({ indexPath: p });
    await w.load(p);
    w.appendDelta(vs.slice(40, 50).map((v, i) => item(`v${40 + i}`, v)));
    w.close();
    const daemon = new BinaryHNSWIndex({ indexPath: p });
    await daemon.load(p);
    // Another delta for the same base, with other rows and longer than the first.
    const copy = path.join(dir, 'b.idx');
    for (const ext of ['', '.fullvec.bin', '.fullvec.map']) if (fs.existsSync(p + ext)) fs.copyFileSync(p + ext, copy + ext);
    fs.rmSync(deltaPathFor(copy), { force: true });
    const other = new BinaryHNSWIndex({ indexPath: copy });
    await other.load(copy);
    other.appendDelta(vs.slice(50, 80).map((v, i) => item(`v${50 + i}`, v)));
    other.close();
    fs.renameSync(deltaPathFor(copy), deltaPathFor(p));
    expect(daemon.refreshDelta()).toBe(false);
    daemon.close();
  });

  it('pairs a delta with its base: a new base drops the old delta', async () => {
    const vs = vectors(30);
    const p = await baseIndex(vs.slice(0, 20));
    const w = new BinaryHNSWIndex({ indexPath: p });
    await w.load(p);
    w.appendDelta(vs.slice(20).map((v, i) => item(`v${20 + i}`, v)));
    const oldDelta = fs.readFileSync(deltaPathFor(p));
    await w.save(p); // folds the delta rows into the base (graph-linked)
    w.close();
    fs.writeFileSync(deltaPathFor(p), oldDelta); // a stale delta left by a crash
    const r = new BinaryHNSWIndex({ indexPath: p });
    await r.load(p);
    expect(r.size).toBe(30);
    expect(r.deltaCount).toBe(0);
    const qb = floatToBinary(truncateForHNSW(vs[25], 512));
    expect((await r.search(qb, 1)).results[0].id).toBe('v25');
    r.close();
  });

  it('searches a flat base (no graph) by exact scan, with or without the scan switch', async () => {
    process.env.SS_FIX_HNSW_SCAN = '0';
    const vs = vectors(120);
    const p = path.join(dir, 'flat.idx');
    const flat = new BinaryHNSWIndex({ indexPath: p });
    flat.resetForBuild();
    vs.forEach((v, i) => { const it = item(`v${i}`, v); flat.addFlat(it.id, it.binary, it.metadata, it.int8, it.full); });
    await flat.save(p);
    flat.close();
    const r = new BinaryHNSWIndex({ indexPath: p });
    await r.load(p);
    expect(r.graphless).toBe(true);
    for (let i = 0; i < 120; i += 13) {
      expect((await r.search(floatToBinary(truncateForHNSW(vs[i], 512)), 3)).results[0].id).toBe(`v${i}`);
    }
    r.close();
  });
});
