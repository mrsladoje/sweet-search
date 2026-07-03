/**
 * NDJSON v2 sidecar format for the binary HNSW index.
 *
 * The monolithic JSON.stringify of .vectors.json / .graph.json / .int8.json
 * hit V8's ~512 MB string ceiling ("Invalid string length") past ~500k
 * vectors (libsql: 637,550) — the same failure the LI alias sidecar had,
 * fixed the same way in 2.6.9. These tests cover the v2 roundtrip, v1
 * back-compat, the truncation guards, and chunked-graph reconstruction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BinaryHNSWIndex,
  readVectorsSidecar,
  readGraphSidecar,
  readInt8Sidecar,
  int8SidecarCount,
  readVectorsSidecarSync,
  readGraphSidecarSync,
  readInt8SidecarSync,
} from '../../core/vector-store/binary-hnsw-index.js';

let dir;
let indexPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-hnsw-sidecar-'));
  indexPath = path.join(dir, 'codebase-binary-hnsw.idx');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function sidecar(ext) {
  return indexPath.replace('.idx', ext);
}

function makeIndex() {
  return new BinaryHNSWIndex({
    indexPath,
    dimension: 1,
    floatDimension: 8,
    M: 2,
    efSearch: 4,
  });
}

async function buildAndSave(n) {
  const idx = makeIndex();
  await idx.init();
  for (let i = 0; i < n; i++) {
    await idx.add(
      `doc-${i}`,
      new Uint8Array([i & 0xff]),
      { name: `doc-${i}` },
      new Int8Array([i, i + 1, i + 2])
    );
  }
  await idx.save(indexPath);
  return idx;
}

function readLines(p) {
  return fs.readFileSync(p, 'utf-8').split('\n').filter((l) => l.length > 0);
}

describe('BinaryHNSW NDJSON v2 sidecars', () => {
  it('save writes v2 headers with one record per line', async () => {
    await buildAndSave(5);

    const vecLines = readLines(sidecar('.vectors.json'));
    expect(JSON.parse(vecLines[0])).toEqual({ version: 2, count: 5 });
    expect(vecLines).toHaveLength(6);
    expect(JSON.parse(vecLines[1])).toEqual({
      id: 'doc-0',
      binary: [0],
      metadata: { name: 'doc-0' },
    });

    const graphHead = JSON.parse(readLines(sidecar('.graph.json'))[0]);
    expect(graphHead.version).toBe(2);
    expect(Array.isArray(graphHead.lengths)).toBe(true);
    expect(Number.isFinite(graphHead.chunks)).toBe(true);

    const int8Lines = readLines(sidecar('.int8.json'));
    expect(JSON.parse(int8Lines[0])).toEqual({ version: 2, count: 5 });
    expect(int8Lines).toHaveLength(6);
  });

  it('save → load round-trips vectors, graph, and int8', async () => {
    const built = await buildAndSave(12);

    const loaded = makeIndex();
    await loaded.load(indexPath);

    expect(loaded.vectors.map((v) => v.id)).toEqual(built.vectors.map((v) => v.id));
    for (let i = 0; i < built.vectors.length; i++) {
      expect(Array.from(loaded.vectors[i].binary)).toEqual(Array.from(built.vectors[i].binary));
      expect(loaded.vectors[i].metadata).toEqual(built.vectors[i].metadata);
    }

    // JSON round-trip normalizes sparse holes to null in both formats.
    expect(loaded.graph).toEqual(JSON.parse(JSON.stringify(built.graph)));
    expect(loaded.entryPoint).toBe(built.entryPoint);

    expect(loaded.int8Vectors.size).toBe(built.int8Vectors.size);
    for (const [id, vec] of built.int8Vectors) {
      expect(Array.from(loaded.int8Vectors.get(id))).toEqual(Array.from(vec));
    }

    const probe = built.vectors[3].binary;
    const a = await built.search(probe, 3);
    const b = await loaded.search(probe, 3);
    expect(b.results.map((r) => r.id)).toEqual(a.results.map((r) => r.id));
  });

  it('round-trips an empty index', async () => {
    await buildAndSave(0);
    const loaded = makeIndex();
    await loaded.load(indexPath);
    expect(loaded.vectors).toHaveLength(0);
    expect(loaded.int8Vectors.size).toBe(0);
  });

  it('loads v1 monolithic sidecars (back-compat, zero migration)', async () => {
    const built = await buildAndSave(8);

    // Rewrite the three big sidecars exactly as the pre-v2 save() did:
    // one monolithic JSON.stringify each. meta.json is untouched.
    const vectorsData = built.vectors.map((v) => ({
      id: v.id,
      binary: Array.from(v.binary),
      metadata: v.metadata,
    }));
    fs.writeFileSync(sidecar('.vectors.json'), JSON.stringify(vectorsData));
    fs.writeFileSync(sidecar('.graph.json'), JSON.stringify(built.graph));
    const int8Data = {};
    for (const [id, vec] of built.int8Vectors) int8Data[id] = Array.from(vec);
    fs.writeFileSync(sidecar('.int8.json'), JSON.stringify(int8Data));

    const loaded = makeIndex();
    await loaded.load(indexPath);

    expect(loaded.vectors.map((v) => v.id)).toEqual(built.vectors.map((v) => v.id));
    expect(loaded.graph).toEqual(JSON.parse(JSON.stringify(built.graph)));
    expect(loaded.int8Vectors.size).toBe(built.int8Vectors.size);
    expect(Array.from(loaded.int8Vectors.get('doc-2'))).toEqual([2, 3, 4]);
  });

  it('rejects a truncated v2 vectors sidecar instead of loading a silent subset', async () => {
    await buildAndSave(6);

    const lines = readLines(sidecar('.vectors.json'));
    fs.writeFileSync(sidecar('.vectors.json'), lines.slice(0, -1).join('\n') + '\n');

    const loaded = makeIndex();
    await expect(loaded.load(indexPath)).rejects.toThrow(/truncated|inconsistency/);
  });

  it('rejects a truncated v2 int8 sidecar', async () => {
    await buildAndSave(6);

    const lines = readLines(sidecar('.int8.json'));
    fs.writeFileSync(sidecar('.int8.json'), lines.slice(0, -1).join('\n') + '\n');

    const loaded = makeIndex();
    await expect(loaded.load(indexPath)).rejects.toThrow(/truncated int8 sidecar/);
  });

  it('reassembles chunked v2 graph records, preserving null holes', async () => {
    const p = path.join(dir, 'chunked.graph.json');
    const lines = [
      JSON.stringify({ version: 2, lengths: [5, 3], chunks: 3 }),
      JSON.stringify({ level: 0, start: 0, nodes: [[1], [0, 2], [1]] }),
      JSON.stringify({ level: 0, start: 3, nodes: [[4], [3]] }),
      JSON.stringify({ level: 1, start: 0, nodes: [null, [2], [1]] }),
    ];
    fs.writeFileSync(p, lines.join('\n') + '\n');

    const graph = await readGraphSidecar(p);
    expect(graph).toEqual([
      [[1], [0, 2], [1], [4], [3]],
      [null, [2], [1]],
    ]);
  });

  it('rejects a truncated v2 graph sidecar', async () => {
    const p = path.join(dir, 'truncated.graph.json');
    const lines = [
      JSON.stringify({ version: 2, lengths: [4], chunks: 2 }),
      JSON.stringify({ level: 0, start: 0, nodes: [[1], [0]] }),
    ];
    fs.writeFileSync(p, lines.join('\n') + '\n');

    await expect(readGraphSidecar(p)).rejects.toThrow(/truncated graph sidecar/);
  });

  it('int8SidecarCount reads only the header (v2) and the single line (v1)', async () => {
    await buildAndSave(7);
    expect(await int8SidecarCount(sidecar('.int8.json'))).toBe(7);

    const v1Path = path.join(dir, 'v1.int8.json');
    fs.writeFileSync(v1Path, JSON.stringify({ a: [1], b: [2], c: [3] }));
    expect(await int8SidecarCount(v1Path)).toBe(3);
  });

  it('sync tooling readers agree with the async readers on v2 files', async () => {
    const built = await buildAndSave(9);

    const vecAsync = await readVectorsSidecar(sidecar('.vectors.json'));
    expect(readVectorsSidecarSync(sidecar('.vectors.json'))).toEqual(vecAsync);

    const graphAsync = await readGraphSidecar(sidecar('.graph.json'));
    expect(readGraphSidecarSync(sidecar('.graph.json'))).toEqual(graphAsync);

    const int8Obj = readInt8SidecarSync(sidecar('.int8.json'));
    expect(Object.keys(int8Obj)).toHaveLength(built.int8Vectors.size);
    expect(int8Obj['doc-4']).toEqual([4, 5, 6]);

    // v1 payloads too
    const v1Int8 = path.join(dir, 'v1sync.int8.json');
    fs.writeFileSync(v1Int8, JSON.stringify({ a: [1, 2] }));
    expect(readInt8SidecarSync(v1Int8)).toEqual({ a: [1, 2] });
    const v1Vec = path.join(dir, 'v1sync.vectors.json');
    fs.writeFileSync(v1Vec, JSON.stringify([{ id: 'x', binary: [1], metadata: null }]));
    expect(readVectorsSidecarSync(v1Vec)).toEqual([{ id: 'x', binary: [1], metadata: null }]);
  });

  it('standalone readers handle v1 payloads', async () => {
    const vecPath = path.join(dir, 'v1.vectors.json');
    fs.writeFileSync(vecPath, JSON.stringify([{ id: 'x', binary: [7], metadata: null }]));
    expect(await readVectorsSidecar(vecPath)).toEqual([{ id: 'x', binary: [7], metadata: null }]);

    const int8Path = path.join(dir, 'v1b.int8.json');
    fs.writeFileSync(int8Path, JSON.stringify({ x: [1, 2] }));
    const out = new Map();
    await readInt8Sidecar(int8Path, out);
    expect(Array.from(out.get('x'))).toEqual([1, 2]);
  });
});
