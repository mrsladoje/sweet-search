/**
 * Tombstone bitmap (`*.stale.bin`).
 *
 * Plan § 7.3 (Float HNSW), § 7.5 (LI segments), § 34.4 (SIMD-ready layout).
 *
 * Each bit marks one element (HNSW key, LI doc, etc.) as stale. Files are
 * **64-byte aligned** so AVX-512 / AVX2 / NEON masking kernels can scan
 * eight bytes at a time without unaligned-load penalties.
 *
 * Layout:
 *
 *   header (16 bytes):
 *     0..3   magic  = 'SSTB'
 *     4..7   version = uint32 (1)
 *     8..15  capacity bits = uint64 (little-endian)
 *
 *   payload:
 *     ceil(capacity_bits / 8) bytes, padded up to a 64-byte boundary.
 *
 * The header is part of the 64-byte alignment promise: callers that mmap
 * the file and pass the payload pointer to a SIMD kernel must skip the
 * first 64 bytes, not the first 16. Phase 6 implements the native SIMD
 * masking kernel; Phase 3 ships the scalar JS path under the same layout.
 */

import {
  BITS_PER_BYTE,
  byteAndMask,
  createBitmap,
  loadBitmap as loadBitmapView,
  resizeBitmap,
  saveBitmap,
  setBit,
} from '../../infrastructure/tombstone-bitmap-reader.js';

export { createBitmap, resizeBitmap, saveBitmap, setBit };

/**
 * Load a tombstone bitmap from disk. Returns `null` if the file does not
 * exist (caller treats every key as live). The payload is a private copy:
 * this writer mutates it, the query-time reader shares a view.
 *
 * @returns {{capacity:number, payload:Buffer}|null}
 */
export function loadBitmap(filePath) {
  const bitmap = loadBitmapView(filePath);
  if (!bitmap) return null;
  return { capacity: bitmap.capacity, payload: Buffer.from(bitmap.payload) };
}

export function clearBit(bitmap, index) {
  if (index < 0 || index >= bitmap.capacity) {
    throw new RangeError(`clearBit: ${index} outside bitmap capacity ${bitmap.capacity}`);
  }
  const { byte, mask } = byteAndMask(index);
  bitmap.payload[byte] &= ~mask & 0xFF;
}

export function isSet(bitmap, index) {
  if (index < 0 || index >= bitmap.capacity) return false;
  const { byte, mask } = byteAndMask(index);
  return (bitmap.payload[byte] & mask) !== 0;
}

/**
 * Population count. Plan § 7.3 tombstone_fraction = count / total.
 *
 * @param {{capacity:number, payload:Buffer}} bitmap
 * @returns {number}
 */
export function popcount(bitmap) {
  let count = 0;
  const buf = bitmap.payload;
  const fullBytes = Math.floor(bitmap.capacity / BITS_PER_BYTE);
  const wordBytes = fullBytes - (fullBytes % 4);
  // popcount via Brian Kernighan's algorithm, 32 bits at a time. Only
  // count bytes covered by capacity; 64-byte alignment padding is not data.
  for (let i = 0; i < wordBytes; i += 4) {
    let x = buf.readUInt32LE(i);
    while (x !== 0) {
      x &= x - 1;
      count += 1;
    }
  }
  for (let i = wordBytes; i < fullBytes; i++) {
    let b = buf[i];
    while (b !== 0) {
      b &= b - 1;
      count += 1;
    }
  }
  const tailBits = bitmap.capacity % BITS_PER_BYTE;
  if (tailBits > 0) {
    let b = buf[fullBytes] & ((1 << tailBits) - 1);
    while (b !== 0) {
      b &= b - 1;
      count += 1;
    }
  }
  return count;
}

/**
 * Filter a list of candidate indices by the bitmap. SIMD-ready in v6;
 * scalar fallback here.
 *
 * @param {{capacity:number, payload:Buffer}} bitmap
 * @param {number[]} candidates
 * @returns {number[]}
 */
export function filterLive(bitmap, candidates) {
  const live = [];
  for (const idx of candidates) {
    if (!isSet(bitmap, idx)) live.push(idx);
  }
  return live;
}

/**
 * Compute the tombstone fraction for the watermark scheduler.
 *
 * @param {{capacity:number, payload:Buffer}} bitmap
 * @param {number} liveTotal     Total live elements (not bitmap capacity).
 * @returns {number}
 */
export function tombstoneFraction(bitmap, liveTotal) {
  const tombstoned = popcount(bitmap);
  const denom = liveTotal + tombstoned;
  if (denom === 0) return 0;
  return tombstoned / denom;
}
