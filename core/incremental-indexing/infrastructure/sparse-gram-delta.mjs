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
 * (`domain/watermark-scheduler.mjs`) triggers maintenance when the
 * `delta_size_ratio` or `delta_segment_count` thresholds cross
 * (maintenance-handlers.mjs sparseGramHandler): past the size ratio the base is
 * rebuilt from the corpus on disk and the deltas emptied (a fold); past the
 * segment count the segments are merged into one, latest record per file.
 *
 * Segments a fold or merge consumed are retired, not unlinked: they leave the
 * writer's listing at once (listDeltaSegments, so no later merge or manifest
 * reads them) but stay on disk for a grace period (PENDING_DELETE_FILE), because
 * a reader may hold a manifest that still lists them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { contentHashSync } from './hashing.mjs';
import { DEFAULT_SPARSE_GRAM_WEIGHTS_ID } from './manifest.mjs';

export const DELTA_DIR_SUFFIX = '.deltas';
export const DELTA_FILE_EXT = '.ssgrmdelta';
/** Retired segments awaiting deletion: `{ [segment file name]: retiredAtMs }`. */
export const PENDING_DELETE_FILE = '.pending-delete.json';
/** How long a retired segment stays on disk for readers holding an older manifest. */
export const DELTA_DELETE_GRACE_MS = 60_000;
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
 * `sync: false` skips the file and directory fsync: the caller syncs the
 * returned segment (syncDeltaSegments) before it publishes a manifest that
 * lists it, once per tick instead of once per file.
 *
 * @param {string} baseArtifactPath  Path to the immutable base sparse-gram artifact.
 * @param {number} epoch
 * @param {object} record    `{ fileId, filePath, contentHash, deleted, symbolMask, weightsId, grams }`
 * @param {{sync?: boolean}} [opts]
 * @returns {string} the segment file written to
 */
export function appendDeltaRecord(baseArtifactPath, epoch, record, { sync = true } = {}) {
  if (!Number.isInteger(epoch)) {
    throw new Error('appendDeltaRecord: epoch must be an integer');
  }
  if (!record || !record.fileId) {
    throw new Error('appendDeltaRecord: record.fileId is required');
  }
  const deltaDir = deltaDirFor(baseArtifactPath);
  fs.mkdirSync(deltaDir, { recursive: true });
  // Never append to a retired segment: no reader or merge would see the record.
  const retired = readPendingDeletes(baseArtifactPath);
  let seq = 0;
  while (retired.has(path.basename(deltaSegmentPath(baseArtifactPath, epoch, seq)))) seq += 1;
  const filePath = deltaSegmentPath(baseArtifactPath, epoch, seq);
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
  if (sync) syncDeltaSegments([filePath]);
  return filePath;
}

/** fsync each segment, then their directories (best effort where a filesystem rejects it). */
export function syncDeltaSegments(segmentPaths) {
  const dirs = new Set();
  for (const p of segmentPaths) {
    const fd = fs.openSync(p, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    dirs.add(path.dirname(p));
  }
  for (const dir of dirs) {
    try {
      const dirFd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {
      // Some test/container filesystems reject directory fsync; the data fsync
      // above is the required durability boundary.
    }
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
  const retired = readPendingDeletes(baseArtifactPath);
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(DELTA_FILE_EXT) || retired.has(name)) continue;
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

function pendingDeletePath(baseArtifactPath) {
  return path.join(deltaDirFor(baseArtifactPath), PENDING_DELETE_FILE);
}

/** Retired segment names -> retirement time (ms). */
export function readPendingDeletes(baseArtifactPath) {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(pendingDeletePath(baseArtifactPath), 'utf8'))));
  } catch {
    return new Map();
  }
}

function writePendingDeletes(baseArtifactPath, pending) {
  const file = pendingDeletePath(baseArtifactPath);
  if (pending.size === 0) {
    try { fs.unlinkSync(file); } catch { /* none */ }
    return;
  }
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(pending)));
  fs.renameSync(tmp, file);
}

/** Retire segments (absolute paths): out of the writer's listing now, deleted after the grace. */
export function retireDeltaSegments(baseArtifactPath, segmentPaths, now = Date.now()) {
  if (segmentPaths.length === 0) return;
  const pending = readPendingDeletes(baseArtifactPath);
  for (const p of segmentPaths) pending.set(path.basename(p), now);
  writePendingDeletes(baseArtifactPath, pending);
}

/** Retired segments, and how many have passed the grace. */
export function pendingDeleteStats(baseArtifactPath, { now = Date.now(), graceMs = DELTA_DELETE_GRACE_MS } = {}) {
  const pending = readPendingDeletes(baseArtifactPath);
  let due = 0;
  for (const at of pending.values()) if (now - at >= graceMs) due += 1;
  return { pending: pending.size, due };
}

/**
 * Delete the retired segments past the grace, except the names in `keep` (a manifest still
 * lists them); returns how many went.
 */
export function sweepRetiredDeltaSegments(baseArtifactPath, { now = Date.now(), graceMs = DELTA_DELETE_GRACE_MS, keep = null } = {}) {
  const pending = readPendingDeletes(baseArtifactPath);
  let removed = 0;
  for (const [name, at] of pending) {
    if (now - at < graceMs || keep?.has(name)) continue;
    try { fs.unlinkSync(path.join(deltaDirFor(baseArtifactPath), name)); } catch { /* already gone */ }
    pending.delete(name);
    removed += 1;
  }
  if (removed > 0) writePendingDeletes(baseArtifactPath, pending);
  return removed;
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
 * Merge the listed delta segments into one: the latest record per fileId, in a new
 * segment `{maxEpoch}-{seq}` with `seq > 0` (sorts after any `{maxEpoch}-0` the reconciler
 * wrote; later ticks use higher epochs). Written as `*.compacting.tmp`, fsynced, renamed;
 * the consumed segments are then retired (retireDeltaSegments), so a reader holding a
 * manifest that lists them still finds them during the grace.
 *
 * Deleted-file records (`deleted: true`) are kept: they suppress base postings at query
 * time. `{ dropTombstones: true }` discards them (only when the base no longer holds the
 * file).
 *
 * @param {string} baseArtifactPath
 * @param {{dropTombstones?:boolean, now?:number}} [opts]
 * @returns {{
 *   compactedPath: string|null,
 *   consumedSegmentPaths: string[],
 *   recordsWritten: number,
 *   tombstonedDropped: number,
 *   skipped: 'too-few-segments'|null,
 * }}
 */
export function compactDeltaSegments(baseArtifactPath, opts = {}) {
  const dropTombstones = !!opts.dropTombstones;
  const segments = listDeltaSegments(baseArtifactPath);
  if (segments.length <= 1) {
    return {
      compactedPath: null,
      consumedSegmentPaths: [],
      recordsWritten: 0,
      tombstonedDropped: 0,
      skipped: 'too-few-segments',
    };
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

  const consumedSegmentPaths = segments
    .filter((seg) => seg.path !== targetPath)
    .map((seg) => seg.path);
  retireDeltaSegments(baseArtifactPath, consumedSegmentPaths, opts.now);

  return {
    compactedPath: targetPath,
    consumedSegmentPaths,
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
