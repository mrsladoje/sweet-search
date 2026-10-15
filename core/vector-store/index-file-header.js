/**
 * Header of the binary HNSW index file (format 3; layout in
 * binary-hnsw-index.js, "INDEX FILE"). Kept apart from the index module so
 * that callers that only ask "is there an index, how many nodes" (scheduler,
 * status checks) do not load the index code.
 */

import { openSync, readSync, closeSync } from 'fs';

export const INDEX_MAGIC = Buffer.from('SSHNSW3\0', 'ascii');
export const SECTION_ALIGN = 64;

export const alignUp = (x) => Math.ceil(x / SECTION_ALIGN) * SECTION_ALIGN;

/**
 * Header of the open index file `fd`, or null when it is not a format-3
 * index: { header, dataStart } (dataStart = offset the section offsets are
 * relative to).
 */
export function readHeaderFd(fd) {
  const prefix = Buffer.alloc(INDEX_MAGIC.length + 4);
  if (readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length) return null;
  if (!prefix.subarray(0, INDEX_MAGIC.length).equals(INDEX_MAGIC)) return null;
  const headerLen = prefix.readUInt32LE(INDEX_MAGIC.length);
  const buf = Buffer.alloc(headerLen);
  if (readSync(fd, buf, 0, headerLen, prefix.length) !== headerLen) return null;
  return { header: JSON.parse(buf.toString('utf-8')), dataStart: alignUp(prefix.length + headerLen) };
}

/**
 * The header of an index file, or null when the file is missing or not a
 * format-3 index. Reads only the header bytes.
 * @returns {{ header: object, dataStart: number } | null}
 */
export function readIndexHeader(indexPath) {
  let fd;
  try {
    fd = openSync(indexPath, 'r');
  } catch {
    return null;
  }
  try {
    return readHeaderFd(fd);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** True when `indexPath` holds a loadable (format-3) index file. */
export function binaryHnswIndexExists(indexPath) {
  return readIndexHeader(indexPath) !== null;
}
