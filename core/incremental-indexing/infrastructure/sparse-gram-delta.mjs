/**
 * Sparse-gram per-file delta overlay (SSGRMIDX v3).
 *
 * Plan § 7.6. The cold-build artifact `codebase-sparse-grams.idx` is
 * immutable; the reconcile path writes per-file changes to
 * `codebase-sparse-grams.idx.deltas/{epoch}-{seq}.ssgrmdelta` and the
 * query path mmaps base ∪ deltas.
 *
 * Delta record (one per file, one JSON line — easy to parse; the native
 * mmap-friendly binary form is Phase 6 work). Each record is keyed by
 * the stable `file_id = xxhash3(canonical_path)` and carries:
 *
 *   {
 *     "fileId":       "<hex>",
 *     "filePath":     "<relative path>",
 *     "contentHash":  "<hex>",
 *     "deleted":      false,
 *     "symbolMask":   <int>,
 *     "weightsId":    "<id>",      // must match base artifact's weights id
 *     "grams":        [ [gramId, freq], ... ]
 *   }
 *
 * The reader unions in two passes:
 *   1. For each file_id with a newer delta record, mask the base
 *      postings for that file_id and read the delta record instead.
 *   2. If `deleted=true`, the file_id is excluded from postings entirely.
 *
 * The delta directory grows over time; the watermark scheduler
 * (`domain/watermark-scheduler.mjs`) triggers compaction when the
 * `delta_size_ratio` or `delta_segment_count` thresholds cross. Compaction
 * reads the latest delta record per file, merges with base postings for
 * unchanged files, and emits a new base under `*.next`.
 *
 * Source-file retokenization for unchanged files is **forbidden** by plan
 * § 7.6: the compactor copies postings, it does not re-gram.
 */

import fs from 'node:fs';
import path from 'node:path';
import { contentHashSync } from './hashing.mjs';
import { DEFAULT_SPARSE_GRAM_WEIGHTS_ID } from './manifest.mjs';

export const DELTA_DIR_SUFFIX = '.deltas';
export const DELTA_FILE_EXT = '.ssgrmdelta';
/**
 * Versioned hardcoded common-code bigram-weight table. Plan § 7.6 empty-/
 * tiny-codebase bootstrap. The actual bigram weights live in the Rust
 * native crate (`crates/sweet-search-native/src/sparse_gram.rs`); this
 * module only carries the *identifier* of the fallback table so the
 * reconciler can stamp deltas with the same `weightsId` the base artifact
 * used.
 */
export const FALLBACK_WEIGHTS_ID = DEFAULT_SPARSE_GRAM_WEIGHTS_ID;

/**
 * Compute the canonical `file_id` for a path. Plan § 7.6 step 2.
 *
 * @param {string} canonicalPath
 * @returns {string}
 */
export function fileIdFor(canonicalPath) {
  return contentHashSync(String(canonicalPath));
}

function deltaDirFor(baseArtifactPath) {
  return baseArtifactPath + DELTA_DIR_SUFFIX;
}

function deltaSegmentPath(baseArtifactPath, epoch, seq) {
  return path.join(deltaDirFor(baseArtifactPath), `${epoch}-${seq}${DELTA_FILE_EXT}`);
}

/**
 * Append a delta record to the active delta segment. Each call writes one
 * line of JSON. The reconciler is the single writer; appending is atomic
 * per call (single `fs.appendFileSync`).
 *
 * @param {string} baseArtifactPath  Path to the immutable base sparse-gram artifact.
 * @param {number} epoch
 * @param {object} record    `{ fileId, filePath, contentHash, deleted, symbolMask, weightsId, grams }`
 */
export function appendDeltaRecord(baseArtifactPath, epoch, record) {
  if (!Number.isInteger(epoch)) {
    throw new Error('appendDeltaRecord: epoch must be an integer');
  }
  if (!record || !record.fileId) {
    throw new Error('appendDeltaRecord: record.fileId is required');
  }
  const deltaDir = deltaDirFor(baseArtifactPath);
  fs.mkdirSync(deltaDir, { recursive: true });
  const filePath = deltaSegmentPath(baseArtifactPath, epoch, 0);
  const fd = fs.openSync(filePath, 'a');
  try {
    fs.writeSync(fd, JSON.stringify(record) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    const dirFd = fs.openSync(deltaDir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch {
    // Some test/container filesystems reject directory fsync; the data fsync
    // above is the required durability boundary.
  }
}

/**
 * Enumerate delta segment files (sorted by epoch, then sequence).
 *
 * @param {string} baseArtifactPath
 * @param {{maxEpoch?:number}} [opts]
 * @returns {Array<{path:string, epoch:number, seq:number}>}
 */
export function listDeltaSegments(baseArtifactPath, opts = {}) {
  const dir = deltaDirFor(baseArtifactPath);
  if (!fs.existsSync(dir)) return [];
  const maxEpoch = Number.isInteger(opts.maxEpoch) ? opts.maxEpoch : Infinity;
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(DELTA_FILE_EXT)) continue;
    const match = name.match(/^(\d+)-(\d+)\.ssgrmdelta$/);
    if (!match) continue;
    const epoch = Number(match[1]);
    if (epoch > maxEpoch) continue;
    out.push({
      path: path.join(dir, name),
      epoch,
      seq: Number(match[2]),
    });
  }
  return out.sort((a, b) => (a.epoch - b.epoch) || (a.seq - b.seq));
}

/**
 * Read all delta records and resolve them to the latest record per fileId.
 * Plan § 7.6 step 4: writing the same `(fileId, contentHash)` twice is a
 * no-op at query merge time; the *last* record wins.
 *
 * @param {string} baseArtifactPath
 * @param {{maxEpoch?:number}} [opts]
 * @returns {Map<string, {record:object, segmentPath:string, epoch:number}>}
 */
export function resolveLatestRecords(baseArtifactPath, opts = {}) {
  const latest = new Map();
  for (const seg of listDeltaSegments(baseArtifactPath, opts)) {
    const raw = fs.readFileSync(seg.path, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue; // skip torn / corrupt lines; the compactor will rewrite
      }
      if (!record.fileId) continue;
      latest.set(record.fileId, { record, segmentPath: seg.path, epoch: seg.epoch });
    }
  }
  return latest;
}

/**
 * Compute the delta-size ratio used by the watermark scheduler.
 *
 *   delta_size_ratio = sum(delta file sizes) / (base file size + sum)
 *
 * @param {string} baseArtifactPath
 * @returns {{ratio:number, deltaSegments:number, deltaBytes:number, baseBytes:number}}
 */
export function deltaSizeStats(baseArtifactPath) {
  let deltaBytes = 0;
  let deltaSegments = 0;
  for (const seg of listDeltaSegments(baseArtifactPath)) {
    try {
      const stat = fs.statSync(seg.path);
      deltaBytes += stat.size;
      deltaSegments += 1;
    } catch {
      // ignore vanished files
    }
  }
  let baseBytes = 0;
  if (fs.existsSync(baseArtifactPath)) {
    baseBytes = fs.statSync(baseArtifactPath).size;
  }
  const ratio = deltaBytes / Math.max(1, baseBytes + deltaBytes);
  return { ratio, deltaSegments, deltaBytes, baseBytes };
}

/**
 * Compact the delta directory in place.
 *
 * Reads all delta segments, resolves the latest record per fileId, writes
 * a single new segment that supersedes them, then deletes the segments
 * the compaction consumed.
 *
 * Naming: the new segment uses `{maxEpoch}-{seq}` with `seq > 0` so it
 * sorts AFTER any existing `{maxEpoch}-0` segment the reconciler wrote.
 * Future reconcile ticks at epoch > maxEpoch keep monotonic ordering.
 *
 * Atomicity: write `*.compacting.tmp`, fsync, rename to the final name,
 * THEN delete the consumed segments. A crash between rename and delete
 * leaves the compacted file in place; the next round consumes everything
 * including the compacted file and resolves to the same records (the
 * compacted file's seq is highest, so its records win).
 *
 * Deleted-file records (`deleted: true`) are preserved by default — they
 * suppress base postings at query time. Pass `{ dropTombstones: true }`
 * to discard them; only safe when the caller has confirmed the matching
 * fileId is gone from the base artifact too.
 *
 * @param {string} baseArtifactPath
 * @param {{dropTombstones?:boolean}} [opts]
 * @returns {{
 *   compactedPath: string|null,
 *   consumedSegments: number,
 *   recordsWritten: number,
 *   tombstonedDropped: number,
 *   skipped: 'too-few-segments'|null,
 * }}
 */
export function compactDeltaSegments(baseArtifactPath, opts = {}) {
  const dropTombstones = !!opts.dropTombstones;
  const segments = listDeltaSegments(baseArtifactPath);
  if (segments.length <= 1) {
    return { compactedPath: null, consumedSegments: 0, recordsWritten: 0, tombstonedDropped: 0, skipped: 'too-few-segments' };
  }
  const maxEpoch = segments[segments.length - 1].epoch;
  const maxSeqAtMaxEpoch = segments
    .filter((s) => s.epoch === maxEpoch)
    .reduce((m, s) => Math.max(m, s.seq), -1);
  const compactSeq = Math.max(maxSeqAtMaxEpoch + 1, 1);

  const latest = new Map();
  for (const seg of segments) {
    const raw = fs.readFileSync(seg.path, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record;
      try { record = JSON.parse(trimmed); } catch { continue; }
      if (!record.fileId) continue;
      latest.set(record.fileId, record);
    }
  }

  let tombstonedDropped = 0;
  if (dropTombstones) {
    for (const [fileId, rec] of latest) {
      if (rec.deleted) {
        latest.delete(fileId);
        tombstonedDropped += 1;
      }
    }
  }

  const deltaDir = deltaDirFor(baseArtifactPath);
  const targetName = `${maxEpoch}-${compactSeq}${DELTA_FILE_EXT}`;
  const targetPath = path.join(deltaDir, targetName);
  const tmpPath = targetPath + '.compacting.tmp';

  const fd = fs.openSync(tmpPath, 'w');
  try {
    for (const record of latest.values()) {
      fs.writeSync(fd, JSON.stringify(record) + '\n');
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
  try {
    const dirFd = fs.openSync(deltaDir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch { /* best-effort dir fsync */ }

  let consumed = 0;
  for (const seg of segments) {
    if (seg.path === targetPath) continue;
    try { fs.unlinkSync(seg.path); consumed += 1; } catch { /* tolerate concurrent deletion */ }
  }

  return {
    compactedPath: targetPath,
    consumedSegments: consumed,
    recordsWritten: latest.size,
    tombstonedDropped,
    skipped: null,
  };
}

/**
 * Mark a file as deleted from the indexed corpus. Plan § 22.8.
 *
 * @param {string} baseArtifactPath
 * @param {number} epoch
 * @param {string} canonicalPath
 */
export function recordFileDeletion(baseArtifactPath, epoch, canonicalPath, weightsId = FALLBACK_WEIGHTS_ID) {
  appendDeltaRecord(baseArtifactPath, epoch, {
    fileId: fileIdFor(canonicalPath),
    filePath: canonicalPath,
    contentHash: '',
    deleted: true,
    symbolMask: 0,
    weightsId,
    grams: [],
  });
}
