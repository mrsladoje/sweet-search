/**
 * Read-only sparse-gram delta helpers for query-time overlay resolution.
 *
 * The reconcile writer lives under incremental-indexing. Search only needs to
 * resolve the latest append-only delta record per file, so that read contract
 * belongs in infrastructure instead of importing the writer bounded context.
 */

import fs from 'node:fs';
import path from 'node:path';

export const SPARSE_DELTA_DIR_SUFFIX = '.deltas';
export const SPARSE_DELTA_FILE_EXT = '.ssgrmdelta';

function deltaDirFor(baseArtifactPath) {
  return baseArtifactPath + SPARSE_DELTA_DIR_SUFFIX;
}

function parseDeltaSegment(baseArtifactPath, segmentPath, maxEpoch) {
  if (typeof segmentPath !== 'string' || !segmentPath.endsWith(SPARSE_DELTA_FILE_EXT)) return null;
  const deltaRoot = path.resolve(deltaDirFor(baseArtifactPath));
  const resolved = path.isAbsolute(segmentPath)
    ? segmentPath
    : path.join(path.dirname(baseArtifactPath), segmentPath);
  const normalized = path.resolve(resolved);
  if (normalized !== deltaRoot && !normalized.startsWith(deltaRoot + path.sep)) return null;
  const match = path.basename(normalized).match(/^(\d+)-(\d+)\.ssgrmdelta$/);
  if (!match) return null;
  const epoch = Number(match[1]);
  if (epoch > maxEpoch) return null;
  if (!fs.existsSync(normalized)) return null;
  return {
    path: normalized,
    epoch,
    seq: Number(match[2]),
  };
}

export function listSparseGramDeltaSegments(baseArtifactPath, opts = {}) {
  const maxEpoch = Number.isInteger(opts.maxEpoch) ? opts.maxEpoch : Infinity;
  if (Array.isArray(opts.segments)) {
    // A manifest segment arrives both state-dir-joined and as written (resolveDeltaSegments),
    // and both resolve to one file. Reading a file a second time re-applies the same records in
    // the same order, so each file is listed once.
    const seen = new Set();
    return opts.segments
      .map((segmentPath) => parseDeltaSegment(baseArtifactPath, segmentPath, maxEpoch))
      .filter((seg) => seg && !seen.has(seg.path) && seen.add(seg.path))
      .sort((a, b) => (a.epoch - b.epoch) || (a.seq - b.seq));
  }

  const dir = deltaDirFor(baseArtifactPath);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const segment = parseDeltaSegment(baseArtifactPath, path.join(dir, name), maxEpoch);
    if (segment) out.push(segment);
  }
  return out.sort((a, b) => (a.epoch - b.epoch) || (a.seq - b.seq));
}

// One delta record per line; torn or corrupt lines are skipped (the compactor rewrites them).
function forEachDeltaRecord(text, onRecord) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!record.fileId) continue;
    onRecord(record);
  }
}

export function resolveLatestSparseGramDeltaRecords(baseArtifactPath, opts = {}) {
  const latest = new Map();
  for (const seg of listSparseGramDeltaSegments(baseArtifactPath, opts)) {
    let raw;
    try {
      raw = fs.readFileSync(seg.path, 'utf-8');
    } catch (err) {
      // TOCTOU: a concurrent compaction/rotation can unlink a segment between
      // listing (existsSync in parseDeltaSegment) and this read. A vanished
      // segment is benign at query time — skip it rather than failing the whole
      // overlay resolution. Surface any other error (EACCES, EISDIR, ...).
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    forEachDeltaRecord(raw, (record) => {
      latest.set(record.fileId, { record, segmentPath: seg.path, epoch: seg.epoch });
    });
  }
  return latest;
}

// Bytes before the read position that must still be there unchanged for a segment to count
// as only appended to.
const SEGMENT_TAIL_CHECK_BYTES = 64;

function readBytes(fd, start, end) {
  const buf = Buffer.allocUnsafe(Math.max(0, end - start));
  let off = 0;
  while (off < buf.length) {
    const n = fs.readSync(fd, buf, off, buf.length - off, start + off);
    if (n === 0) break;
    off += n;
  }
  return off === buf.length ? buf : buf.subarray(0, off);
}

function openSegment(segPath) {
  try {
    return fs.openSync(segPath, 'r');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * The records resolveLatestSparseGramDeltaRecords reads, for a long-lived reader (the search
 * daemon) that keeps its own latest-per-fileId state between calls.
 *
 * Segments are append-only (appendDeltaRecord), and compaction writes a NEW file. So when every
 * segment of the previous call is still listed first, in the same order, with the same inode and
 * the same bytes before where the last call stopped, only the new bytes are read. Any other
 * change reads every segment again from the start, after `onReset()`.
 *
 * `onRecord(record, seg)` gets the records in file order, exactly as a full read would apply them
 * to a Map keyed by fileId: a full read and (previous state + these calls) give the same Map.
 * A last line without its newline (a write in progress) is applied, and read again next call.
 *
 * @param {object|null} cursor  the cursor a previous call returned, or null for a full read
 * @returns {object} the cursor for the next call
 */
export function readSparseGramDeltaRecordsSince(baseArtifactPath, opts = {}, cursor = null, { onReset, onRecord }) {
  const segs = listSparseGramDeltaSegments(baseArtifactPath, opts);
  const fds = new Map();
  try {
    let prev = cursor?.segments || null;
    if (prev && (prev.length > segs.length || prev.some((s, i) => s.path !== segs[i].path))) prev = null;
    if (prev) {
      for (const s of prev) {
        const fd = openSegment(s.path);
        if (fd === null) { prev = null; break; }
        fds.set(s.path, fd);
        const st = fs.fstatSync(fd);
        if (st.ino !== s.ino || st.size < s.consumed
            || !readBytes(fd, s.consumed - s.check.length, s.consumed).equals(s.check)) {
          prev = null;
          break;
        }
      }
    }
    if (!prev) onReset();
    const next = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      let fd = fds.get(seg.path);
      if (fd === undefined) {
        fd = openSegment(seg.path);
        if (fd === null) continue; // vanished since the listing: skipped, as a full read does
        fds.set(seg.path, fd);
      }
      const st = fs.fstatSync(fd);
      const from = prev && i < prev.length ? prev[i].consumed : 0;
      const buf = readBytes(fd, from, st.size);
      forEachDeltaRecord(buf.toString('utf-8'), (record) => onRecord(record, seg));
      // Stop at the last newline: a torn last line is read again next call.
      const consumed = from + buf.lastIndexOf(0x0a) + 1;
      const check = readBytes(fd, Math.max(0, consumed - SEGMENT_TAIL_CHECK_BYTES), consumed);
      next.push({ path: seg.path, ino: st.ino, consumed, check });
    }
    return { segments: next };
  } finally {
    for (const fd of fds.values()) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}
