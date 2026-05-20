/**
 * LI segment batch merge / compaction.
 *
 * The reconcile write path (`application/production-li-delta.mjs`) seals one
 * new SSLX segment per tick that has any add op, so segment count grows
 * ~1/tick forever. The per-segment `li_segment` handler only drops
 * tombstoned docs *within* a segment — it never reduces the segment count.
 * This module is the missing segment-count bound: it merges many small
 * live segments into `ceil(liveDocs / SEGMENT_SIZE)` segments, dropping
 * tombstoned docs, while leaving already-full sealed segments untouched
 * (those are handled by the per-segment stale-ratio path).
 *
 * Publish safety (no mixed-epoch / no ENOENT for in-flight readers):
 *   1. Sweep crash orphans (segment files not referenced by the manifest
 *      and not already quarantined) — makes a crashed prior merge idempotent.
 *   2. Sweep the quarantine journal — physically delete consumed segment
 *      files whose grace window has elapsed.
 *   3. Write the merged segment files under unique new names via
 *      `*.compacting.tmp` + rename (new names never collide with live ones,
 *      so a reader on the OLD manifest never sees a half-written file).
 *   4. Atomically publish `manifest.json` (tmp + rename) listing the kept
 *      full segments + the new merged segments only.
 *   5. Quarantine the consumed small-segment files (+ stale sidecars) — they
 *      stay readable for any reader still mid-`_loadSegmented` on the old
 *      manifest; physical deletion is deferred to a later pass once the
 *      grace window has elapsed.
 *
 * Crash recovery:
 *   - crash before (4): old manifest still references the old segments; the
 *     new files are orphans cleaned by step 1 on the next run.
 *   - crash after (4) before (5): new manifest is live; old files become
 *     orphans cleaned by step 1 on the next run (>= 1 tick later, well past
 *     any reader load window).
 *   - crash after (5): the quarantine sweep (step 2) finishes the deletion.
 *
 * Segment naming is collision-proof via a monotonic `nextSeq` persisted in
 * the manifest (see `nextSegmentSeq`); the write path uses the same counter.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { LateInteractionIndex } from '../../ranking/late-interaction-index.js';
import { STALE_SIDECAR_EXT, nextSegmentSeq, LI_SEGMENT_SIZE } from './li-segment-state.mjs';

export { nextSegmentSeq, LI_SEGMENT_SIZE };

/** Default quarantine grace before a consumed segment file is unlinked. */
export const LI_MERGE_GRACE_MS = 60_000;
const QUARANTINE_FILE = 'pending-delete.jsonl';

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); return true; } catch { return false; }
}

async function writeJsonAtomic(filePath, payload) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fsp.rename(tmp, filePath);
}

/**
 * Resolve the segmented LI layout from the stub. Returns null for legacy /
 * missing / corrupt indices (callers skip — nothing to merge).
 */
export function resolveSegmentedLayout(stateDir) {
  const stubPath = path.join(stateDir, 'codebase-late-interaction.db');
  if (!fs.existsSync(stubPath)) return null;
  const stub = readJson(stubPath);
  if (!stub || stub.format !== 'segmented' || !stub.segmentDir) return null;
  const segmentDir = path.resolve(stateDir, stub.segmentDir);
  const manifestPath = path.join(segmentDir, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (!manifest || !Array.isArray(manifest.segments)) return null;
  return { stubPath, segmentDir, manifestPath, manifest };
}

function quarantinePath(segmentDir) {
  return path.join(segmentDir, QUARANTINE_FILE);
}

function readQuarantine(segmentDir) {
  const p = quarantinePath(segmentDir);
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry && Array.isArray(entry.paths)) out.push(entry);
    } catch { /* skip torn line */ }
  }
  return out;
}

function writeQuarantine(segmentDir, entries) {
  const p = quarantinePath(segmentDir);
  if (entries.length === 0) { safeUnlink(p); return; }
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

/**
 * Physically delete quarantined segment files whose grace window elapsed.
 * Entries still inside the grace window are retained verbatim.
 *
 * @returns {number} files unlinked
 */
export function sweepQuarantine(segmentDir, graceMs = LI_MERGE_GRACE_MS, now = Date.now()) {
  const entries = readQuarantine(segmentDir);
  if (entries.length === 0) return 0;
  const survivors = [];
  let deleted = 0;
  for (const entry of entries) {
    if (now - (entry.retiredAtMs || 0) > graceMs) {
      for (const rel of entry.paths) {
        if (safeUnlink(path.join(segmentDir, rel))) deleted += 1;
      }
    } else {
      survivors.push(entry);
    }
  }
  writeQuarantine(segmentDir, survivors);
  return deleted;
}

/**
 * Delete crash-orphan `*.bin` segment files (and orphan stale sidecars) that
 * the manifest does not reference and that are not currently quarantined.
 * Safe because no reader ever resolves a path the manifest does not list,
 * and the daemon is the single writer.
 *
 * @returns {number} files unlinked
 */
export function sweepOrphanSegments(segmentDir, manifest) {
  let names;
  try { names = fs.readdirSync(segmentDir); } catch { return 0; }
  const referenced = new Set((manifest.segments || []).map((s) => s.path));
  const quarantined = new Set();
  for (const entry of readQuarantine(segmentDir)) {
    for (const rel of entry.paths) quarantined.add(rel);
  }
  const isProtected = (segName) => referenced.has(segName) || quarantined.has(segName);
  let deleted = 0;
  for (const name of names) {
    if (name.endsWith(STALE_SIDECAR_EXT)) {
      const base = name.slice(0, -STALE_SIDECAR_EXT.length);
      if (!isProtected(base)) { if (safeUnlink(path.join(segmentDir, name))) deleted += 1; }
      continue;
    }
    if (!name.endsWith('.bin')) continue;
    if (!isProtected(name)) { if (safeUnlink(path.join(segmentDir, name))) deleted += 1; }
  }
  return deleted;
}

/**
 * Merge small live LI segments into fewer larger segments.
 *
 * Pass `sweepOnly: true` to run ONLY the cheap housekeeping sweeps (orphan +
 * quarantine) without loading or rewriting the index. The watermark uses this
 * for the `pending_delete` re-fire so a large index is not reloaded every tick
 * just to drain a few quarantined files.
 *
 * @param {string} stateDir
 * @param {{segmentSize?:number, graceMs?:number, minSmallSegments?:number, sweepOnly?:boolean}} [opts]
 * @returns {Promise<object>} summary, never throws on missing/legacy index
 */
export async function mergeLiSegments(stateDir, opts = {}) {
  const segmentSize = Number.isInteger(opts.segmentSize) && opts.segmentSize > 0 ? opts.segmentSize : LI_SEGMENT_SIZE;
  const graceMs = Number.isFinite(opts.graceMs) && opts.graceMs >= 0 ? opts.graceMs : LI_MERGE_GRACE_MS;
  const minSmall = Number.isInteger(opts.minSmallSegments) && opts.minSmallSegments > 0 ? opts.minSmallSegments : 2;

  const layout = resolveSegmentedLayout(stateDir);
  if (!layout) return { skipped: 'no-segmented-index' };
  const { stubPath, segmentDir, manifestPath, manifest } = layout;

  // Step 1 + 2: housekeeping that must run regardless of whether we merge.
  const orphansDeleted = sweepOrphanSegments(segmentDir, manifest);
  const quarantineDeleted = sweepQuarantine(segmentDir, graceMs);

  if (opts.sweepOnly) {
    return { swept: true, orphansDeleted, quarantineDeleted, segmentCount: manifest.segments.length };
  }

  const small = manifest.segments.filter((s) => Number.isFinite(s.count) && s.count < segmentSize);
  if (small.length < minSmall) {
    return { skipped: 'too-few-small-segments', orphansDeleted, quarantineDeleted, segmentCount: manifest.segments.length };
  }
  const keptFull = manifest.segments.filter((s) => !(Number.isFinite(s.count) && s.count < segmentSize));
  const smallNames = new Set(small.map((s) => s.path));
  const smallAbs = new Set(small.map((s) => path.join(segmentDir, s.path)));

  // Load the live docs (the loader drops tombstoned docs per the stale bitmap).
  const index = new LateInteractionIndex({ indexPath: stubPath, loadExisting: true, modelId: manifest.modelId || null });
  await index.init();

  const collected = [];
  for (const [docId, doc] of index.documents.entries()) {
    const pos = index._docSegmentPositions?.get(docId);
    if (!pos || !smallAbs.has(pos.segmentPath)) continue;
    collected.push({ segmentPath: pos.segmentPath, docIndex: pos.docIndex, docId, doc });
  }
  collected.sort((a, b) => (a.segmentPath < b.segmentPath ? -1 : a.segmentPath > b.segmentPath ? 1
    : a.docIndex - b.docIndex));

  // Writer used purely as the SSLX serializer (model/quant params copied verbatim).
  const writer = new LateInteractionIndex({
    indexPath: stubPath,
    loadExisting: false,
    tokenDim: index.tokenDim,
    maxTokens: index.maxTokens,
    useInt8: index.useInt8,
    quantBits: index.quantBits,
    modelId: index.modelId,
    poolFactor: index.poolFactor,
    whtSeed: index.whtSeed,
    whtOrdering: index.whtOrdering,
    matryoshkaDim: index.matryoshkaDim,
  });
  await writer.init();

  let seq = nextSegmentSeq(manifest);
  const newSegments = [];
  const writtenFinals = [];
  for (let i = 0; i < collected.length; i += segmentSize) {
    const batch = new Map();
    for (const { docId, doc } of collected.slice(i, i + segmentSize)) batch.set(docId, doc);
    const segName = `segment-${String(seq).padStart(4, '0')}.bin`;
    seq += 1;
    const finalPath = path.join(segmentDir, segName);
    const tmpPath = finalPath + '.compacting.tmp';
    await writer._writeSegmentFile(tmpPath, batch);
    fs.renameSync(tmpPath, finalPath);
    writtenFinals.push(finalPath);
    newSegments.push({ path: segName, count: batch.size });
  }

  // Step 4: atomic manifest publish (kept full segments + new merged segments).
  const nextManifest = {
    ...manifest,
    segments: [...keptFull, ...newSegments],
    nextSeq: seq,
  };
  nextManifest.totalDocuments = nextManifest.segments.reduce((sum, s) => sum + (s?.count || 0), 0);
  await writeJsonAtomic(manifestPath, nextManifest);

  // Step 5: quarantine the consumed small-segment files (+ stale sidecars).
  const consumedPaths = [];
  for (const name of smallNames) {
    consumedPaths.push(name);
    if (fs.existsSync(path.join(segmentDir, name + STALE_SIDECAR_EXT))) {
      consumedPaths.push(name + STALE_SIDECAR_EXT);
    }
  }
  if (consumedPaths.length > 0) {
    const journal = readQuarantine(segmentDir);
    journal.push({ retiredAtMs: Date.now(), paths: consumedPaths });
    writeQuarantine(segmentDir, journal);
  }

  return {
    tier: 'li_segments',
    mergedFrom: small.length,
    mergedInto: newSegments.length,
    keptFull: keptFull.length,
    keptDocs: collected.length,
    segmentCountBefore: manifest.segments.length,
    segmentCountAfter: nextManifest.segments.length,
    orphansDeleted,
    quarantineDeleted,
    quarantined: consumedPaths.length,
  };
}
