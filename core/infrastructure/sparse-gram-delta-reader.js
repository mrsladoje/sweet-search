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
    return opts.segments
      .map((segmentPath) => parseDeltaSegment(baseArtifactPath, segmentPath, maxEpoch))
      .filter(Boolean)
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
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!record.fileId) continue;
      latest.set(record.fileId, { record, segmentPath: seg.path, epoch: seg.epoch });
    }
  }
  return latest;
}
