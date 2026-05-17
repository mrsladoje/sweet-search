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

import fs from 'node:fs';
import path from 'node:path';

const HEADER_MAGIC = Buffer.from('SSTB', 'ascii');
const HEADER_VERSION = 1;
const HEADER_RESERVED = 64; // bytes reserved before payload (alignment)
const BITS_PER_BYTE = 8;

function payloadByteOffset() {
  return HEADER_RESERVED;
}

function payloadByteLength(capacityBits) {
  const minBytes = Math.ceil(capacityBits / BITS_PER_BYTE);
  // Round up to 64-byte alignment so SIMD reads at the tail are safe.
  return Math.ceil(minBytes / 64) * 64;
}

/**
 * Create or open a tombstone bitmap. Returns an in-memory bitmap object;
 * callers persist with `saveBitmap`.
 *
 * @param {number} capacityBits
 * @returns {{capacity:number, payload:Buffer}}
 */
export function createBitmap(capacityBits) {
  if (!Number.isInteger(capacityBits) || capacityBits <= 0) {
    throw new Error(`createBitmap: capacityBits must be a positive integer, got ${capacityBits}`);
  }
  return {
    capacity: capacityBits,
    payload: Buffer.alloc(payloadByteLength(capacityBits)),
  };
}

/**
 * Load a tombstone bitmap from disk. Returns `null` if the file does not
 * exist (caller treats every key as live).
 *
 * @param {string} filePath
 * @returns {{capacity:number, payload:Buffer}|null}
 */
export function loadBitmap(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath);
  if (raw.length < HEADER_RESERVED) {
    throw new Error(`loadBitmap: ${filePath} too short (${raw.length} bytes)`);
  }
  if (!raw.subarray(0, 4).equals(HEADER_MAGIC)) {
    throw new Error(`loadBitmap: ${filePath} magic mismatch`);
  }
  const version = raw.readUInt32LE(4);
  if (version !== HEADER_VERSION) {
    throw new Error(`loadBitmap: unsupported version ${version}`);
  }
  const capacity = Number(raw.readBigUInt64LE(8));
  const expectedLength = HEADER_RESERVED + payloadByteLength(capacity);
  if (raw.length < expectedLength) {
    throw new Error(`loadBitmap: ${filePath} truncated payload (${raw.length} bytes, expected ${expectedLength})`);
  }
  const payload = raw.subarray(HEADER_RESERVED, HEADER_RESERVED + payloadByteLength(capacity));
  return {
    capacity,
    payload: Buffer.from(payload),
  };
}

/**
 * Persist the bitmap atomically (`*.tmp` + fsync + rename).
 *
 * @param {string} filePath
 * @param {{capacity:number, payload:Buffer}} bitmap
 */
export function saveBitmap(filePath, bitmap) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  const header = Buffer.alloc(HEADER_RESERVED);
  HEADER_MAGIC.copy(header, 0);
  header.writeUInt32LE(HEADER_VERSION, 4);
  header.writeBigUInt64LE(BigInt(bitmap.capacity), 8);
  const out = Buffer.concat([header, bitmap.payload]);

  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, out);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  try {
    const dirFd = fs.openSync(path.dirname(filePath), 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch {
    // Best-effort: some tmpfs/container filesystems reject directory fsync.
  }
}

/**
 * Resize a bitmap (used when the underlying graph grows past capacity).
 * Preserves existing bits.
 *
 * @param {{capacity:number, payload:Buffer}} bitmap
 * @param {number} newCapacityBits
 */
export function resizeBitmap(bitmap, newCapacityBits) {
  if (newCapacityBits <= bitmap.capacity) return bitmap;
  const fresh = Buffer.alloc(payloadByteLength(newCapacityBits));
  bitmap.payload.copy(fresh, 0, 0, bitmap.payload.length);
  bitmap.capacity = newCapacityBits;
  bitmap.payload = fresh;
  return bitmap;
}

function byteAndMask(index) {
  const byte = index >>> 3;
  const mask = 1 << (index & 7);
  return { byte, mask };
}

export function setBit(bitmap, index) {
  if (index < 0 || index >= bitmap.capacity) {
    throw new RangeError(`setBit: ${index} outside bitmap capacity ${bitmap.capacity}`);
  }
  const { byte, mask } = byteAndMask(index);
  bitmap.payload[byte] |= mask;
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
