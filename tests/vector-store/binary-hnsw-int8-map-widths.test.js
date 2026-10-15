/**
 * Int8 rows read from a private mapping of the index file (K3), and indexes
 * whose codes and int8 rows use other prefix widths than the configured one
 * (K4). The mapping must give the same rows as a read, a write into a mapped
 * row must not reach the file it came from, and a save after that write must
 * keep it. A width-512 code with width-768 int8 rows must search with the
 * index's own widths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';
import { buildHnswIndex } from '../../core/indexing/artifact-builder.js';
import { nativeRescoreKernels } from '../../core/infrastructure/native-rescore.js';
import { truncateForHNSW, normalizedFloatToInt8, floatToBinary } from '../../core/infrastructure/quantization.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-hnsw-k34-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// Deterministic unit vectors (no Math.random): a small LCG.
function vectors(n, d, seed = 7) {
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

const hasMap = () => typeof nativeRescoreKernels()?.mapFileSection === 'function';

describe('int8 rows from a mapping of the index file (K3)', () => {
  it('maps the same rows a read gives, keeps writes private, and saves them', async () => {
    if (!hasMap()) return;
    const p = path.join(dir, 'a.idx');
    const vs = vectors(300, 768);
    const { index } = await buildHnswIndex(vs.map((e, i) => ({ id: `v${i}`, embedding: e, metadata: {} })), { indexPath: p });
    await index.save(p);
    const before = fs.readFileSync(p);

    const a = new BinaryHNSWIndex({ indexPath: p }); await a.load(p);
    for (let i = 0; i < 300; i += 37) {
      const want = normalizedFloatToInt8(truncateForHNSW(vs[i], 512));
      expect(Array.from(a.getInt8Vector(`v${i}`))).toEqual(Array.from(want));
    }
    // A write into a mapped row (an update of an existing node) stays in this process.
    const node = a.idToIndex.get('v5');
    const row = new Int8Array(512).fill(9);
    a._putInt8(node, row);
    expect(Array.from(a.getInt8Vector('v5'))).toEqual(Array.from(row));
    expect(fs.readFileSync(p).equals(before)).toBe(true);
    const b0 = new BinaryHNSWIndex({ indexPath: p }); await b0.load(p);
    expect(Array.from(b0.getInt8Vector('v5'))).not.toEqual(Array.from(row));

    // Saving over the mapped file publishes the write; the old mapping stays readable.
    await a.save(p);
    expect(Array.from(a.getInt8Vector('v6'))).toEqual(Array.from(normalizedFloatToInt8(truncateForHNSW(vs[6], 512))));
    const b = new BinaryHNSWIndex({ indexPath: p }); await b.load(p);
    expect(Array.from(b.getInt8Vector('v5'))).toEqual(Array.from(row));
  });
});

describe('code and int8 widths of the index (K4)', () => {
  it('builds 512-bit codes with 768-wide int8 rows and searches with them', async () => {
    const p = path.join(dir, 'w.idx');
    const vs = vectors(400, 768, 11);
    const { index } = await buildHnswIndex(vs.map((e, i) => ({ id: `v${i}`, embedding: e, metadata: {} })),
      { indexPath: p, floatDimension: 512, int8Dimension: 768 });
    await index.save(p);
    const a = new BinaryHNSWIndex({ indexPath: p }); await a.load(p);
    expect(a.floatDimension).toBe(512);
    expect(Array.from(a.getInt8Vector('v3'))).toEqual(Array.from(normalizedFloatToInt8(truncateForHNSW(vs[3], 768))));
    const q = vs[42];
    const r = a.searchCascade(floatToBinary(truncateForHNSW(q, 512)), 50, { queryFloat: q });
    if (!r) return;  // no native addon
    expect(Array.from(r.queryInt8)).toEqual(Array.from(normalizedFloatToInt8(truncateForHNSW(q, 768))));
    const st = r.int8Stage(r.count);
    expect(st.materialize(1)[0].id).toBe('v42');
  });

  it('makes the query code at the index width when the given code has another width', async () => {
    const p = path.join(dir, 'w768.idx');
    const vs = vectors(300, 768, 5);
    const { index } = await buildHnswIndex(vs.map((e, i) => ({ id: `v${i}`, embedding: e, metadata: {} })),
      { indexPath: p, floatDimension: 768 });
    await index.save(p);
    const a = new BinaryHNSWIndex({ indexPath: p }); await a.load(p);
    expect(a.dimension).toBe(96);
    const q = vs[17];
    const r = a.searchCascade(floatToBinary(truncateForHNSW(q, 512)), 20, { queryFloat: q });
    if (!r) return;
    expect(r.int8Stage(r.count).materialize(1)[0].id).toBe('v17');
  });
});
