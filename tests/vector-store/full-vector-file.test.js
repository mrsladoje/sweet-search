/**
 * Full-vector file beside the binary HNSW index (core/vector-store/
 * full-vector-file.js): the final rescore reads full embeddings from a
 * memory-mapped, append-only file instead of SQLite. These tests cover the
 * fresh build, appends on a loaded index (new nodes and re-added ids), nodes
 * without a vector, removal when a save has no vectors, the generation check,
 * and an index saved before the file existed. Rows are stored as f16 (round
 * to nearest, ties to even); scores must equal the sequential f64 dot of the
 * query with the f16-rounded vector exactly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';
import { nativeRescoreKernels } from '../../core/infrastructure/native-rescore.js';
import { f32ToF16, f16ToF32 } from '../../core/vector-store/full-vector-file.js';

const native = Boolean(nativeRescoreKernels());
const DIM = 12;

let dir;
let indexPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-fullvec-'));
  indexPath = path.join(dir, 'codebase-binary-hnsw.idx');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const dataPath = () => indexPath.replace('.idx', '.fullvec.bin');
const mapPath = () => indexPath.replace('.idx', '.fullvec.map');

function vec(i, salt = 0) {
  const v = new Float32Array(DIM);
  for (let d = 0; d < DIM; d++) v[d] = Math.sin(i * 7.1 + d * 1.3 + salt) / (d + 1);
  return v;
}

// The stored row: each value rounded to f16.
function half(v) {
  return Float32Array.from(v, (x) => f16ToF32(f32ToF16(x)));
}

// Score of a stored row: the sequential f64 dot with the f16-rounded vector.
function dot(q, v) {
  const h = half(v);
  let s = 0;
  for (let d = 0; d < q.length; d++) s += q[d] * h[d];
  return s;
}

function makeIndex() {
  return new BinaryHNSWIndex({ indexPath, dimension: 1, floatDimension: 8, M: 2, efSearch: 4 });
}

async function build(n, full = (i) => vec(i)) {
  const idx = makeIndex();
  idx.resetForBuild();
  for (let i = 0; i < n; i++) {
    await idx.add(`doc-${i}`, new Uint8Array([i & 0xff]), { n: i }, null, full(i));
  }
  await idx.save(indexPath);
  return idx;
}

async function loaded() {
  const idx = makeIndex();
  await idx.load(indexPath);
  return idx;
}

const query = Float64Array.from({ length: DIM }, (_, d) => Math.cos(d * 0.7) * 0.3);

describe.skipIf(!native)('full-vector file', () => {
  it('scores a fresh build exactly as the sequential dot, across buffer flushes', async () => {
    await build(1300);
    const idx = await loaded();
    const ids = ['doc-0', 'doc-511', 'doc-512', 'doc-1299', 'doc-7'];
    const got = idx.fullDotScores(query, ids);
    expect(got.found).toBe(5);
    expect(got.scores).toEqual(ids.map((id) => dot(query, vec(Number(id.slice(4))))));
    expect(fs.statSync(dataPath()).size).toBe(64 + 1300 * DIM * 2);
  });

  it('appends new nodes and re-added ids without rewriting old rows', async () => {
    await build(20);
    const before = fs.readFileSync(dataPath());
    const idx = await loaded();
    await idx.add('doc-new', new Uint8Array([3]), {}, null, vec(100));
    await idx.add('doc-4', new Uint8Array([4]), {}, null, vec(4, 9));
    await idx.save(indexPath);
    const after = fs.readFileSync(dataPath());
    expect(after.length).toBe(before.length + 2 * DIM * 2);
    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    const re = await loaded();
    const got = re.fullDotScores(query, ['doc-new', 'doc-4', 'doc-5']);
    expect(got.scores).toEqual([dot(query, vec(100)), dot(query, vec(4, 9)), dot(query, vec(5))]);
  });

  it('scores null for a candidate without a row and serves the others', async () => {
    await build(10, (i) => (i === 3 ? null : vec(i)));
    const idx = await loaded();
    expect(idx.fullDotScores(query, ['doc-1', 'doc-3', 'doc-2', null, 'no-such-id', 'doc-1'])).toEqual({
      scores: [dot(query, vec(1)), null, dot(query, vec(2)), null, null, dot(query, vec(1))],
      found: 2,
    });
    expect(idx.fullDotScores(query, ['doc-1', 'doc-2'])).toEqual({ scores: [dot(query, vec(1)), dot(query, vec(2))], found: 2 });
  });

  it('removes the files when a rebuild at the same path has no vectors', async () => {
    await build(10);
    expect(fs.existsSync(mapPath())).toBe(true);
    await build(10, () => null);
    expect(fs.existsSync(mapPath())).toBe(false);
    expect(fs.existsSync(dataPath())).toBe(false);
    expect((await loaded()).fullDotScores(query, ['doc-1'])).toBeNull();
  });

  it('rejects a map from another build (generation check)', async () => {
    await build(10);
    const oldMap = fs.readFileSync(mapPath());
    await build(10, (i) => vec(i, 5));
    fs.writeFileSync(mapPath(), oldMap);
    expect((await loaded()).fullDotScores(query, ['doc-1'])).toBeNull();
  });

  it('copies a node vector out for compaction', async () => {
    await build(10);
    const idx = await loaded();
    expect(Array.from(idx.fullVectorOf(idx.idToIndex.get('doc-6')))).toEqual(Array.from(half(vec(6))));
  });

  it('an index saved without the file stays without it until a full rebuild', async () => {
    await build(10);
    fs.rmSync(mapPath());
    fs.rmSync(dataPath());
    const idx = await loaded();
    expect(idx.fullDotScores(query, ['doc-1'])).toBeNull();
    await idx.add('doc-1', new Uint8Array([1]), {}, null, vec(1, 3));
    await idx.save(indexPath);
    expect(fs.existsSync(mapPath())).toBe(false);
    await build(10);
    expect((await loaded()).fullDotScores(query, ['doc-1']).scores).toEqual([dot(query, vec(1))]);
  });

  it('rounds to the nearest f16, ties to even, and widens back exactly', () => {
    expect(f32ToF16(1)).toBe(0x3c00);
    expect(f32ToF16(-2)).toBe(0xc000);
    expect(f32ToF16(65504)).toBe(0x7bff);
    expect(f32ToF16(65520)).toBe(0x7c00);                 // halfway to 65536: ties to even -> infinity
    expect(f32ToF16(1 + 2 ** -11)).toBe(0x3c00);           // halfway, even neighbour below
    expect(f32ToF16(1 + 3 * 2 ** -11)).toBe(0x3c02);       // halfway, even neighbour above
    expect(f32ToF16(2 ** -24)).toBe(0x0001);
    expect(f32ToF16(2 ** -25)).toBe(0x0000);
    for (let h = 0; h < 0x7c00; h += 37) expect(f32ToF16(f16ToF32(h))).toBe(h);
  });
});
