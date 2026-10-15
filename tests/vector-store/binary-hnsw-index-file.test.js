/**
 * Binary HNSW index file (format 3): one file per index, published by one
 * atomic rename. Covers the round trip (nodes, metadata, graph, int8 rows,
 * entry point), the header-only readers, rejection of other files, the
 * lazy parts of a load (code slab, scan-size graph) and writes after a load.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BinaryHNSWIndex,
  readIndexHeader,
  readIndexIdsSync,
  binaryHnswIndexExists,
} from '../../core/vector-store/binary-hnsw-index.js';

let dir;
let indexPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-hnsw-file-'));
  indexPath = path.join(dir, 'codebase-binary-hnsw.idx');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeIndex() {
  return new BinaryHNSWIndex({ indexPath, dimension: 8, floatDimension: 64, M: 4, efSearch: 16 });
}

function code(i) {
  const b = new Uint8Array(8);
  for (let j = 0; j < 8; j++) b[j] = (i * 37 + j * 11) & 0xff;
  return b;
}

async function buildAndSave(n, { int8 = true } = {}) {
  const idx = makeIndex();
  await idx.init();
  for (let i = 0; i < n; i++) {
    await idx.add(`doc-${i}`, code(i), { name: `doc-${i}`, line: i },
      int8 ? new Int8Array([i % 100, -(i % 100), 3]) : null);
  }
  await idx.save(indexPath);
  return idx;
}

async function loadIndex() {
  const idx = makeIndex();
  await idx.load(indexPath);
  return idx;
}

describe('BinaryHNSW index file (format 3)', () => {
  it('writes one file with a header the readers can use', async () => {
    await buildAndSave(40);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('codebase-binary-hnsw.idx'))).toEqual(['codebase-binary-hnsw.idx']);
    const { header } = readIndexHeader(indexPath);
    expect(header).toMatchObject({ format: 3, count: 40, dimension: 8, M: 4, int8Dim: 3, int8Count: 40 });
    expect(binaryHnswIndexExists(indexPath)).toBe(true);
    expect(readIndexIdsSync(indexPath)).toEqual({
      ids: Array.from({ length: 40 }, (_, i) => `doc-${i}`),
      int8Ids: Array.from({ length: 40 }, (_, i) => `doc-${i}`),
    });
  });

  it('save → load round-trips nodes, metadata, graph, int8 rows and entry point', async () => {
    const a = await buildAndSave(300);
    const b = await loadIndex();
    expect(b.size).toBe(300);
    expect(b.entryPoint).toBe(a.entryPoint);
    expect(b.maxLevel).toBe(a.maxLevel);
    expect(b.nodeId(7)).toBe('doc-7');
    expect(b.nodeMetadata(7)).toEqual({ name: 'doc-7', line: 7 });
    expect(Array.from(b.nodeBinary(9))).toEqual(Array.from(code(9)));
    expect(Array.from(b.getInt8Vector('doc-5'))).toEqual([5, -5, 3]);
    // A node absent from a level is a hole in the built graph and null after a load.
    const dense = (g) => g.map((level) => Array.from(level, (x) => x ?? null));
    expect(dense(b.graph)).toEqual(dense(a.graph));
    expect(b.getStats()).toEqual(a.getStats());
    for (let q = 0; q < 20; q++) {
      const ra = await a.search(code(q * 13 + 1), 10);
      const rb = await b.search(code(q * 13 + 1), 10);
      expect(rb.results).toEqual(ra.results);
    }
  });

  it('round-trips an empty index and an index without int8 rows', async () => {
    await buildAndSave(0);
    const e = await loadIndex();
    expect(e.size).toBe(0);
    expect(e.entryPoint).toBe(-1);
    expect((await e.search(code(1), 5)).results).toEqual([]);

    await buildAndSave(10, { int8: false });
    const b = await loadIndex();
    expect(b.int8Count()).toBe(0);
    expect(b.getInt8Vector('doc-1')).toBeUndefined();
    expect(readIndexHeader(indexPath).header.int8Dim).toBe(0);
  });

  it('a load leaves out the code slab and the scan-size graph until a write needs them', async () => {
    await buildAndSave(50);
    const b = await loadIndex();
    if (!b._native) return; // no addon: the JS walk loads both
    expect(b._slab).toBeNull();
    expect(b._graphFrozen.onDisk).toBe(true);
    // A write reads them from the file and keeps the index consistent.
    await b.add('doc-new', code(999), { name: 'new' }, new Int8Array([1, 2, 3]));
    expect(b._slab).not.toBeNull();
    expect(b._file).toBeNull();
    await b.save(indexPath);
    const c = await loadIndex();
    expect(c.size).toBe(51);
    expect(c.nodeId(50)).toBe('doc-new');
    expect((await c.search(code(999), 1)).results[0].id).toBe('doc-new');
    expect(Array.from(c.getInt8Vector('doc-new'))).toEqual([1, 2, 3]);
  });

  it('re-adding an id overwrites its code, metadata and int8 row', async () => {
    await buildAndSave(20);
    const b = await loadIndex();
    await b.add('doc-3', code(500), { name: 'changed' }, new Int8Array([9, 9, 9]));
    expect(b.size).toBe(20);
    expect(b.nodeMetadata(3)).toEqual({ name: 'changed' });
    expect(Array.from(b.nodeBinary(3))).toEqual(Array.from(code(500)));
    expect(Array.from(b.getInt8Vector('doc-3'))).toEqual([9, 9, 9]);
  });

  it('rejects files that are not format-3 index files', async () => {
    fs.writeFileSync(indexPath, '{"version":2,"count":3}\n');
    expect(readIndexHeader(indexPath)).toBeNull();
    expect(binaryHnswIndexExists(indexPath)).toBe(false);
    await expect(loadIndex()).rejects.toThrow(/not an index file/);
  });

  it('rejects a truncated index file', async () => {
    await buildAndSave(200);
    // Cut into the code slab, which every load reads.
    const { dataStart } = readIndexHeader(indexPath);
    fs.truncateSync(indexPath, dataStart + 100);
    await expect(loadIndex()).rejects.toThrow(/truncated/);
  });

  it('rejects an index file cut in its last section (the graph tail)', async () => {
    await buildAndSave(300);
    fs.truncateSync(indexPath, fs.statSync(indexPath).size - 100);
    await expect(loadIndex()).rejects.toThrow(/truncated/);
  });

  it('an int8 row of another width is an error', async () => {
    await buildAndSave(5);
    const b = await loadIndex();
    await expect(b.add('x', code(1), {}, new Int8Array([1, 2]))).rejects.toThrow(/width/);
  });
});
