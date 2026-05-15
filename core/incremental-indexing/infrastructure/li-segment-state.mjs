/**
 * LI segment state and per-segment tombstone tracking.
 *
 * Plan § 7.5. Sweet-search's late-interaction index ships as SSLX v3
 * segments of ≤ 10 K docs each. The newest segment is the "growing"
 * write target; sealed segments are immutable. Edits to docs in a sealed
 * segment produce two writes:
 *
 *   - the old doc's bit is set in the sealed segment's `*.stale.bin`,
 *   - the new doc is appended to the growing segment.
 *
 * This module tracks per-segment stale counts and decides which segments
 * cross the per-segment watermark (`stale_doc_ratio > 0.20` per plan
 * § 7.5 step 3 / `domain/watermark-scheduler.mjs`).
 *
 * The stale bitmap for each segment lives at `<segmentPath>.stale.bin`
 * and uses the layout in `infrastructure/tombstone-bitmap.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createBitmap, loadBitmap, saveBitmap,
  resizeBitmap, setBit, popcount, isSet, filterLive,
} from './tombstone-bitmap.mjs';

export const STALE_SIDECAR_EXT = '.stale.bin';

function staleSidecarPath(segmentPath) {
  return segmentPath + STALE_SIDECAR_EXT;
}

/**
 * Per-segment state object that the LI tier uses while applying deltas.
 *
 * @param {string} segmentPath
 * @param {number} docCount
 */
export function openSegmentState(segmentPath, docCount) {
  let bitmap = loadBitmap(staleSidecarPath(segmentPath));
  if (!bitmap) {
    bitmap = createBitmap(Math.max(1, docCount));
  } else if (bitmap.capacity < docCount) {
    bitmap = resizeBitmap(bitmap, docCount);
  }
  return {
    segmentPath,
    docCount,
    bitmap,
  };
}

/**
 * Mark a doc tombstoned. Persists the bitmap to disk so a daemon crash
 * before manifest publish does not lose the tombstone state.
 *
 * @param {object} segmentState
 * @param {number} docIndex
 */
export function tombstoneDoc(segmentState, docIndex) {
  setBit(segmentState.bitmap, docIndex);
}

/**
 * Persist the stale bitmap to disk via atomic temp+rename.
 *
 * @param {object} segmentState
 */
export function persistSegmentState(segmentState) {
  saveBitmap(staleSidecarPath(segmentState.segmentPath), segmentState.bitmap);
}

/**
 * Compute the stale_doc_ratio for the watermark check.
 *
 * @param {object} segmentState
 * @returns {number}
 */
export function staleDocRatio(segmentState) {
  if (segmentState.docCount === 0) return 0;
  return popcount(segmentState.bitmap) / segmentState.docCount;
}

/**
 * Enumerate segment paths in a segments directory. Returns paths sorted
 * lexicographically (caller is responsible for any ordering they need
 * beyond that).
 *
 * @param {string} segmentsDir
 * @returns {string[]}
 */
export function listSegments(segmentsDir) {
  if (!fs.existsSync(segmentsDir)) return [];
  return fs
    .readdirSync(segmentsDir)
    .filter((n) => n.endsWith('.bin') && !n.endsWith(STALE_SIDECAR_EXT))
    .sort()
    .map((n) => path.join(segmentsDir, n));
}

/**
 * For each segment in the directory, evaluate its current stale ratio.
 * The watermark scheduler (`domain/watermark-scheduler.mjs`) consumes
 * the returned array via `liSegments` input.
 *
 * @param {string} segmentsDir
 * @param {Map<string, number>} [docCountsBySegment]   Optional override.
 * @returns {Array<{segmentId:string, staleDocRatio:number}>}
 */
export function evaluateSegmentRatios(segmentsDir, docCountsBySegment = new Map()) {
  const out = [];
  for (const segmentPath of listSegments(segmentsDir)) {
    const docCount = docCountsBySegment.get(segmentPath) ?? 0;
    if (docCount === 0) continue;
    const state = openSegmentState(segmentPath, docCount);
    out.push({
      segmentId: path.basename(segmentPath),
      staleDocRatio: staleDocRatio(state),
    });
  }
  return out;
}

/**
 * Filter a candidate doc-index list by the segment's stale bitmap. Used
 * by the LI scorer (plan § 7.5 step 5).
 *
 * @param {object} segmentState
 * @param {number[]} candidates
 * @returns {number[]}
 */
export function filterLiveDocs(segmentState, candidates) {
  return filterLive(segmentState.bitmap, candidates);
}

/**
 * Check whether a doc index is alive (false) or tombstoned (true).
 *
 * @param {object} segmentState
 * @param {number} docIndex
 * @returns {boolean}
 */
export function isDocTombstoned(segmentState, docIndex) {
  return isSet(segmentState.bitmap, docIndex);
}
