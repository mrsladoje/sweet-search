/**
 * Tests for core/incremental-indexing/infrastructure/tombstone-bitmap.mjs
 *
 * Plan § 7.3 / § 7.5 / § 34.4:
 *   - 64-byte aligned payload for SIMD masking.
 *   - Header magic + version round-trip via save / load.
 *   - popcount and filterLive accurate.
 *   - Resize preserves existing bits.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createBitmap,
  saveBitmap,
  loadBitmap,
  resizeBitmap,
  setBit,
  clearBit,
  isSet,
  popcount,
  filterLive,
  tombstoneFraction,
} from '../../core/incremental-indexing/infrastructure/tombstone-bitmap.mjs';

describe('tombstone-bitmap / shape', () => {
  it('createBitmap rejects non-positive capacities', () => {
    expect(() => createBitmap(0)).toThrow();
    expect(() => createBitmap(-1)).toThrow();
    expect(() => createBitmap(1.5)).toThrow();
  });

  it('payload length is rounded up to 64-byte alignment', () => {
    expect(createBitmap(1).payload.length).toBe(64);
    expect(createBitmap(512).payload.length).toBe(64);  // 64 bytes covers 512 bits
    expect(createBitmap(513).payload.length).toBe(128); // bump to next 64-byte boundary
    expect(createBitmap(4096).payload.length).toBe(512);
  });

  it('set/isSet/clear round-trip', () => {
    const b = createBitmap(1024);
    expect(isSet(b, 7)).toBe(false);
    setBit(b, 7);
    setBit(b, 1023);
    expect(isSet(b, 7)).toBe(true);
    expect(isSet(b, 1023)).toBe(true);
    expect(isSet(b, 8)).toBe(false);
    clearBit(b, 7);
    expect(isSet(b, 7)).toBe(false);
  });

  it('rejects out-of-range indices on set', () => {
    const b = createBitmap(64);
    expect(() => setBit(b, 64)).toThrow(RangeError);
    expect(() => setBit(b, -1)).toThrow(RangeError);
  });
});

describe('tombstone-bitmap / persistence', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-bm-'));
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('save + load round-trips the bitmap and rejects non-existent files as null', () => {
    expect(loadBitmap(path.join(dir, 'missing.bin'))).toBeNull();
    const b = createBitmap(1024);
    setBit(b, 5);
    setBit(b, 999);
    const target = path.join(dir, 'bm.bin');
    saveBitmap(target, b);

    const back = loadBitmap(target);
    expect(back.capacity).toBe(1024);
    expect(isSet(back, 5)).toBe(true);
    expect(isSet(back, 999)).toBe(true);
    expect(isSet(back, 6)).toBe(false);
  });

  it('rejects mismatched magic / version', () => {
    const target = path.join(dir, 'bm.bin');
    fs.writeFileSync(target, Buffer.alloc(128, 0));
    expect(() => loadBitmap(target)).toThrow(/magic/);
  });
});

describe('tombstone-bitmap / resize', () => {
  it('grows capacity and preserves existing bits', () => {
    const b = createBitmap(64);
    setBit(b, 5);
    setBit(b, 63);
    resizeBitmap(b, 4096);
    expect(b.capacity).toBe(4096);
    expect(isSet(b, 5)).toBe(true);
    expect(isSet(b, 63)).toBe(true);
    expect(isSet(b, 4095)).toBe(false);
    setBit(b, 4095);
    expect(isSet(b, 4095)).toBe(true);
  });

  it('shrink is a no-op (we never lose tombstone information)', () => {
    const b = createBitmap(1024);
    setBit(b, 5);
    resizeBitmap(b, 64);
    expect(b.capacity).toBe(1024);
    expect(isSet(b, 5)).toBe(true);
  });
});

describe('tombstone-bitmap / popcount and filterLive', () => {
  it('popcount counts set bits including across 32-bit boundaries', () => {
    const b = createBitmap(2048);
    for (const i of [0, 7, 31, 32, 63, 64, 1024, 2047]) setBit(b, i);
    expect(popcount(b)).toBe(8);
  });

  it('filterLive drops tombstoned indices', () => {
    const b = createBitmap(64);
    setBit(b, 5);
    setBit(b, 10);
    expect(filterLive(b, [1, 5, 10, 12])).toEqual([1, 12]);
  });

  it('tombstoneFraction matches the popcount/(popcount+live) ratio', () => {
    const b = createBitmap(64);
    setBit(b, 1);
    setBit(b, 2);
    setBit(b, 3);
    // 3 tombstones, 5 live → 3/(3+5) = 0.375
    expect(tombstoneFraction(b, 5)).toBeCloseTo(0.375, 5);
  });
});
