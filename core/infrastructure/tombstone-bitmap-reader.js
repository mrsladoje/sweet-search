/**
 * Tombstone bitmap helpers for query-time artifact filtering and soft-delete
 * writers that live outside the incremental-indexing bounded context.
 *
 * The writer lives in the incremental-indexing bounded context. Runtime
 * readers in ranking/vector-store cannot import that context without
 * violating dependency direction, so this infrastructure module owns the
 * stable on-disk bitmap layout used by those readers.
 */

import fs from 'node:fs';
import path from 'node:path';

const HEADER_MAGIC = Buffer.from('SSTB', 'ascii');
const HEADER_VERSION = 1;
const HEADER_RESERVED = 64;
const BITS_PER_BYTE = 8;

function payloadByteLength(capacityBits) {
  const minBytes = Math.ceil(capacityBits / BITS_PER_BYTE);
  return Math.ceil(minBytes / 64) * 64;
}

export function createBitmap(capacityBits) {
  if (!Number.isInteger(capacityBits) || capacityBits <= 0) {
    throw new Error(`createBitmap: capacityBits must be a positive integer, got ${capacityBits}`);
  }
  return {
    capacity: capacityBits,
    payload: Buffer.alloc(payloadByteLength(capacityBits)),
  };
}

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
  // View, not copy: `raw` is otherwise unreferenced, so this only keeps the
  // 64-byte header alive alongside the payload bytes.
  const payload = raw.subarray(HEADER_RESERVED, HEADER_RESERVED + payloadByteLength(capacity));
  return { capacity, payload };
}

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
    // Best effort: some container/tmpfs filesystems reject directory fsync.
  }
}

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

export function isSet(bitmap, index) {
  if (!bitmap || index < 0 || index >= bitmap.capacity) return false;
  const { byte, mask } = byteAndMask(index);
  return (bitmap.payload[byte] & mask) !== 0;
}

export function setBit(bitmap, index) {
  if (index < 0 || index >= bitmap.capacity) {
    throw new RangeError(`setBit: ${index} outside bitmap capacity ${bitmap.capacity}`);
  }
  const { byte, mask } = byteAndMask(index);
  bitmap.payload[byte] |= mask;
}

export function popcount(bitmap) {
  if (!bitmap) return 0;
  let count = 0;
  const buf = bitmap.payload;
  const fullBytes = Math.floor(bitmap.capacity / BITS_PER_BYTE);
  const wordBytes = fullBytes - (fullBytes % 4);
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
