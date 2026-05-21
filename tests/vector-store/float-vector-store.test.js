import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FloatVectorStore } from '../../core/vector-store/float-vector-store.js';

// Incremental writer-side methods used by the reconcile maintainer to keep the
// Stage 2.5 float store (codebase-float-vectors.bin) in lockstep with the
// binary HNSW. The read hot path (get/batchScore) is exercised indirectly.

const DIM = 4;

function vec(...xs) {
  return Float32Array.from(xs);
}

describe('FloatVectorStore incremental maintenance', () => {
  let dir;
  let binPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ss-float-store-'));
    binPath = join(dir, 'codebase-float-vectors.bin');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('build → save → load round-trips ids and vectors', async () => {
    const store = new FloatVectorStore();
    store.build([
      { id: 'a', vector: vec(1, 0, 0, 0) },
      { id: 'b', vector: vec(0, 1, 0, 0) },
    ], DIM);
    await store.save(binPath);

    expect(existsSync(binPath)).toBe(true);
    expect(existsSync(binPath.replace(/\.bin$/, '.ids.json'))).toBe(true);

    const loaded = new FloatVectorStore();
    expect(await loaded.load(binPath)).toBe(true);
    expect(loaded.count).toBe(2);
    expect(loaded.dimension).toBe(DIM);
    expect([...loaded.idToIndex.keys()].sort()).toEqual(['a', 'b']);
    expect(Array.from(loaded.get('a'))).toEqual([1, 0, 0, 0]);
  });

  it('loadOrInit returns false and seeds an empty mutable store when absent', async () => {
    const store = new FloatVectorStore();
    const loaded = await store.loadOrInit(binPath, DIM);
    expect(loaded).toBe(false);
    expect(store.loaded).toBe(true);
    expect(store.count).toBe(0);
    expect(store.dimension).toBe(DIM);
  });

  it('loadOrInit loads an existing store and keeps its on-disk dimension', async () => {
    const seed = new FloatVectorStore();
    seed.build([{ id: 'a', vector: vec(1, 0, 0, 0) }], DIM);
    await seed.save(binPath);

    const store = new FloatVectorStore();
    // Pass a different seed dimension; the loaded header must win.
    const loaded = await store.loadOrInit(binPath, 999);
    expect(loaded).toBe(true);
    expect(store.dimension).toBe(DIM);
    expect(store.count).toBe(1);
  });

  it('applyDelta inserts new vectors into an empty store', async () => {
    const store = new FloatVectorStore();
    await store.loadOrInit(binPath, DIM);
    store.applyDelta({ upserts: [
      { id: 'a', vector: vec(1, 0, 0, 0) },
      { id: 'b', vector: vec(0, 1, 0, 0) },
    ] });
    await store.save(binPath);

    const loaded = new FloatVectorStore();
    await loaded.load(binPath);
    expect([...loaded.idToIndex.keys()].sort()).toEqual(['a', 'b']);
    expect(Array.from(loaded.get('b'))).toEqual([0, 1, 0, 0]);
  });

  it('applyDelta replaces a vector for an existing id (modify)', async () => {
    const store = new FloatVectorStore();
    store.build([{ id: 'a', vector: vec(1, 0, 0, 0) }], DIM);

    store.applyDelta({ upserts: [{ id: 'a', vector: vec(0, 0, 1, 0) }] });

    expect(store.count).toBe(1);
    expect(Array.from(store.get('a'))).toEqual([0, 0, 1, 0]);
  });

  it('applyDelta removes ids (delete) and survives a save/load cycle', async () => {
    const store = new FloatVectorStore();
    store.build([
      { id: 'a', vector: vec(1, 0, 0, 0) },
      { id: 'b', vector: vec(0, 1, 0, 0) },
      { id: 'c', vector: vec(0, 0, 1, 0) },
    ], DIM);

    store.applyDelta({ removeIds: ['b'] });
    await store.save(binPath);

    const loaded = new FloatVectorStore();
    await loaded.load(binPath);
    expect([...loaded.idToIndex.keys()].sort()).toEqual(['a', 'c']);
    expect(loaded.get('b')).toBeNull();
  });

  it('applyDelta applies removes and upserts together, preserving untouched ids', async () => {
    const store = new FloatVectorStore();
    store.build([
      { id: 'a', vector: vec(1, 0, 0, 0) },
      { id: 'b', vector: vec(0, 1, 0, 0) },
    ], DIM);

    store.applyDelta({
      removeIds: ['a'],
      upserts: [
        { id: 'b', vector: vec(0, 0, 0, 1) }, // replace
        { id: 'c', vector: vec(0, 0, 1, 0) }, // insert
      ],
    });

    expect([...store.idToIndex.keys()].sort()).toEqual(['b', 'c']);
    expect(Array.from(store.get('b'))).toEqual([0, 0, 0, 1]);
    expect(Array.from(store.get('c'))).toEqual([0, 0, 1, 0]);
  });

  it('applyDelta down to zero entries yields a valid loadable empty store', async () => {
    const store = new FloatVectorStore();
    store.build([{ id: 'a', vector: vec(1, 0, 0, 0) }], DIM);
    store.applyDelta({ removeIds: ['a'] });
    await store.save(binPath);

    const loaded = new FloatVectorStore();
    expect(await loaded.load(binPath)).toBe(true);
    expect(loaded.count).toBe(0);
    expect(loaded.get('a')).toBeNull();
  });

  it('load rejects a torn binary/ID-map pair (count mismatch)', async () => {
    const store = new FloatVectorStore();
    store.build([
      { id: 'a', vector: vec(1, 0, 0, 0) },
      { id: 'b', vector: vec(0, 1, 0, 0) },
      { id: 'c', vector: vec(0, 0, 1, 0) },
    ], DIM);
    await store.save(binPath);

    // Simulate a crash between the two atomic renames: stale ID map with fewer
    // entries than the binary header reports.
    const idsPath = binPath.replace(/\.bin$/, '.ids.json');
    expect(JSON.parse(readFileSync(idsPath, 'utf-8')).length).toBe(3);
    writeFileSync(idsPath, JSON.stringify(['a', 'b']));

    const loaded = new FloatVectorStore();
    expect(await loaded.load(binPath)).toBe(false);
    expect(loaded.loaded).toBe(false);
  });
});
