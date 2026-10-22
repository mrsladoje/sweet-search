/**
 * Delta file beside the binary HNSW index: the vectors the index maintainer
 * added since the index file (the base) was written.
 *
 * The maintainer used to insert each new vector into the graph and rewrite the
 * whole index file every tick (121 MB at 100k vectors). It now appends the new
 * rows here instead; they become nodes past the base with no graph links. Up to
 * the exact-scan size search scans every node, delta rows included; above it,
 * search walks the base graph and scans the delta rows exactly. Compaction
 * folds the delta into a new base.
 *
 * File `<index>.delta`:
 *   header (32 bytes): magic 'SSHNSWD1', generation u32 (the base it extends),
 *                      code width u32, reserved
 *   records, back to back: payload length u32, crc32 of the payload u32, payload
 *     payload: json length u32 | json utf-8 { id, m: metadata, r: full-vector
 *              row (-1: none), i: int8 width (0: none) } | code bytes | int8 bytes
 * Append-only within a generation, fsynced per tick. A reader takes the records
 * up to the first incomplete or corrupt one (a torn tail after a crash); the
 * writer truncates that tail before it appends. A file whose generation is not
 * the base's belongs to an older base and is ignored.
 */
import fs from 'fs';
import { crc32 } from 'zlib';

export const DELTA_MAGIC = Buffer.from('SSHNSWD1', 'ascii');
export const DELTA_HEADER = 32;

export function deltaPathFor(indexPath) {
  return `${indexPath}.delta`;
}

/** A delta file header for `generation` and code width `dimension`. */
export function deltaHeader(generation, dimension) {
  const h = Buffer.alloc(DELTA_HEADER);
  DELTA_MAGIC.copy(h, 0);
  h.writeUInt32LE(generation >>> 0, 8);
  h.writeUInt32LE(dimension, 12);
  return h;
}

/** One record: { id, metadata, code: Uint8Array, int8: Int8Array|null, fullRow }. */
export function encodeDeltaRecord(rec) {
  const json = Buffer.from(JSON.stringify({
    id: rec.id,
    m: rec.metadata ?? {},
    r: Number.isInteger(rec.fullRow) ? rec.fullRow : -1,
    i: rec.int8 ? rec.int8.length : 0,
  }), 'utf-8');
  const code = Buffer.from(rec.code.buffer, rec.code.byteOffset, rec.code.byteLength);
  const int8 = rec.int8 ? Buffer.from(rec.int8.buffer, rec.int8.byteOffset, rec.int8.byteLength) : Buffer.alloc(0);
  const payload = Buffer.alloc(4 + json.length + code.length + int8.length);
  payload.writeUInt32LE(json.length, 0);
  json.copy(payload, 4);
  code.copy(payload, 4 + json.length);
  int8.copy(payload, 4 + json.length + code.length);
  const head = Buffer.alloc(8);
  head.writeUInt32LE(payload.length, 0);
  head.writeUInt32LE(crc32(payload) >>> 0, 4);
  return Buffer.concat([head, payload]);
}

/**
 * Records of `buf` (a whole delta file or its tail starting at a record
 * boundary) from byte `from`, up to the first incomplete or corrupt one.
 * Returns { records, end } (end: offset after the last good record).
 */
export function parseDeltaRecords(buf, from, dimension) {
  const records = [];
  let at = from;
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32LE(at);
    const crc = buf.readUInt32LE(at + 4);
    if (len < 4 || at + 8 + len > buf.length) break;
    const payload = buf.subarray(at + 8, at + 8 + len);
    if ((crc32(payload) >>> 0) !== crc) break;
    const jsonLen = payload.readUInt32LE(0);
    if (4 + jsonLen + dimension > len) break;
    let head;
    try { head = JSON.parse(payload.toString('utf-8', 4, 4 + jsonLen)); } catch { break; }
    const codeAt = 4 + jsonLen;
    const int8Len = head.i | 0;
    if (codeAt + dimension + int8Len !== len) break;
    const code = new Uint8Array(dimension);
    code.set(payload.subarray(codeAt, codeAt + dimension));
    let int8 = null;
    if (int8Len > 0) {
      int8 = new Int8Array(int8Len);
      int8.set(new Int8Array(payload.buffer, payload.byteOffset + codeAt + dimension, int8Len));
    }
    records.push({ id: head.id, metadata: head.m ?? {}, fullRow: head.r, code, int8 });
    at += 8 + len;
  }
  return { records, end: at };
}

/**
 * The delta records of `deltaPath` for a base of `generation`, read from byte
 * `fromBytes` (a record boundary; 0 = the whole file). null when there is no
 * file, or it belongs to another base. { records, end, ino, size }.
 */
export function readDelta(deltaPath, generation, dimension, fromBytes = 0) {
  let fd;
  try { fd = fs.openSync(deltaPath, 'r'); } catch { return null; }
  try {
    const st = fs.fstatSync(fd);
    if (st.size < DELTA_HEADER) return null;
    const head = Buffer.alloc(DELTA_HEADER);
    fs.readSync(fd, head, 0, DELTA_HEADER, 0);
    if (!head.subarray(0, 8).equals(DELTA_MAGIC) || head.readUInt32LE(8) !== (generation >>> 0)
      || head.readUInt32LE(12) !== dimension) return null;
    const start = Math.max(DELTA_HEADER, fromBytes);
    const tail = Buffer.alloc(Math.max(0, st.size - start));
    let got = 0;
    while (got < tail.length) {
      const n = fs.readSync(fd, tail, got, tail.length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    const { records, end } = parseDeltaRecords(tail.subarray(0, got), 0, dimension);
    return { records, end: start + end, ino: st.ino, size: st.size };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Append encoded records to the delta of a base of `generation`: creates the
 * file (atomically, header only) when it is absent or belongs to another base,
 * cuts a torn tail at `validEnd` (the reader's last good offset), writes, fsyncs.
 * Returns the new end offset.
 */
export function appendDelta(deltaPath, generation, dimension, validEnd, encoded) {
  let fresh = true;
  try {
    const fd = fs.openSync(deltaPath, 'r');
    try {
      const head = Buffer.alloc(DELTA_HEADER);
      fresh = !(fs.readSync(fd, head, 0, DELTA_HEADER, 0) === DELTA_HEADER
        && head.subarray(0, 8).equals(DELTA_MAGIC) && head.readUInt32LE(8) === (generation >>> 0)
        && head.readUInt32LE(12) === dimension);
    } finally {
      fs.closeSync(fd);
    }
  } catch { /* absent */ }
  if (fresh) {
    const tmp = `${deltaPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, deltaHeader(generation, dimension));
    fs.renameSync(tmp, deltaPath);
    validEnd = DELTA_HEADER;
  }
  const fd = fs.openSync(deltaPath, 'r+');
  try {
    const at = Math.max(DELTA_HEADER, validEnd);
    if (fs.fstatSync(fd).size !== at) fs.ftruncateSync(fd, at);
    const bytes = Buffer.concat(encoded);
    let off = 0;
    while (off < bytes.length) off += fs.writeSync(fd, bytes, off, bytes.length - off, at + off);
    fs.fsyncSync(fd);
    return at + bytes.length;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Number of complete records in the delta of a base of `generation` (0 without
 * one). Walks the length prefixes only: no checksum, no JSON.
 */
export function countDeltaRecords(deltaPath, generation, dimension) {
  let buf;
  try { buf = fs.readFileSync(deltaPath); } catch { return 0; }
  if (buf.length < DELTA_HEADER || !buf.subarray(0, 8).equals(DELTA_MAGIC)
    || buf.readUInt32LE(8) !== (generation >>> 0) || buf.readUInt32LE(12) !== dimension) return 0;
  let n = 0;
  for (let at = DELTA_HEADER; at + 8 <= buf.length;) {
    const len = buf.readUInt32LE(at);
    if (len < 4 || at + 8 + len > buf.length) break;
    at += 8 + len;
    n += 1;
  }
  return n;
}
