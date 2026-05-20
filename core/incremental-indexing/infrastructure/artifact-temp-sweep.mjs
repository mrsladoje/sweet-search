/**
 * Crash-orphan temp sweep for the reconcile state directory.
 *
 * Every per-tier writer in the incremental-indexing context stages its
 * output to a sibling temp path and then `rename`s it into the canonical
 * name:
 *   - HNSW / Binary HNSW sidecars: `<name>.tmp.<pid>`
 *   - manifest / merkle / metrics (production-reconciler, index-maintainer,
 *     operator-cli, production-li-delta): `<name>.tmp.<pid>`
 *   - reconcile manifest + LI segment manifest: `<name>.json.tmp`
 *   - sparse-gram + LI segment compaction: `<name>.compacting.tmp`
 *   - tombstone bitmaps: `<name>.bin.tmp`
 *   - LI stub self-heal: `<name>.selfheal.tmp`
 *
 * The rename is atomic and the writers unlink their own temp on an
 * in-process error, so under normal operation no temp survives a tick. A
 * `SIGKILL` between stage and rename, however, leaves the temp orphaned —
 * and because `*.tmp.<pid>` and sparse `*.compacting.tmp` carry
 * per-process / per-epoch names, repeated crashes leak monotonically.
 *
 * Readers never consult these paths (they read canonical names plus the
 * manifest-referenced delta/segment lists; `listDeltaSegments` and the LI
 * segment manifest both ignore non-canonical suffixes), so an orphan is a
 * disk-usage / operator-confusion problem, not a correctness one. This
 * sweep runs once at daemon startup, AFTER the state lock is held (so the
 * reconcile daemon is the single writer), and removes orphans older than a
 * grace window. The grace window protects a temp another writer might still
 * be mid-rename on — defensive belt-and-braces, since the lock already
 * excludes a second reconcile daemon.
 *
 * Safety contract:
 *   - Only files whose basename matches one of the reconcile staging-temp
 *     suffixes above are ever removed. Canonical artifacts (`*.usearch`,
 *     `*.meta.json`, `*.vectors.json`, `*.db`, `*.ssgrmdelta`, `*.sslx`,
 *     `reconcile-manifest.json`, `*.idx`, `*.stale.bin`, `merkle-state.json`,
 *     `*.jsonl`, …) never match.
 *   - The cold-build full-artifact stages owned by the *indexer* context
 *     (`*.db.tmp`, `*.idx.tmp`) are deliberately NOT matched — those are
 *     fixed-name (overwritten on the next cold build, so they don't leak)
 *     and may be a large in-flight build the reconcile daemon must not
 *     touch.
 *   - SQLite `-wal` / `-shm`, the dirty / processing / dead-letter queues,
 *     the lockfile, and reader heartbeats are never matched and never
 *     removed.
 *   - Directories are never removed; the LI self-heal owns `*.tmp.segments`
 *     directories, which this sweep refuses to recurse into.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_TMP_SWEEP_MAX_AGE_MS = 60_000;

// pid-suffixed staging temps: `foo.tmp.12345`
const PID_TMP_RE = /\.tmp\.\d+$/;

// Reconcile / maintenance staging-temp suffixes (explicit allowlist — see the
// module header for why this is an allowlist and not a `*.tmp` catch-all).
const ORPHAN_TEMP_SUFFIXES = [
  '.compacting.tmp', // sparse-gram + LI segment compaction
  '.selfheal.tmp',   // LI stub self-heal
  '.json.tmp',       // reconcile manifest + LI segment manifest
  '.bin.tmp',        // tombstone bitmaps
];

/**
 * True when a basename is a reconcile/maintenance crash-orphan staging temp
 * (and therefore safe to remove), false for canonical artifacts and
 * cold-build full-artifact stages.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isOrphanTempName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (PID_TMP_RE.test(name)) return true;
  for (const suffix of ORPHAN_TEMP_SUFFIXES) {
    if (name.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * True for the canonical artifact subdirs that hold compaction temps
 * (sparse-gram `*.deltas`, LI `*.segments`). Orphan / self-heal directories
 * (those containing `.tmp.`) are skipped so the sweep never recurses into a
 * `*.tmp.segments` directory the LI self-heal is responsible for migrating.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isScannableArtifactSubdir(name) {
  if (typeof name !== 'string') return false;
  if (name.includes('.tmp.')) return false;
  return name.endsWith('.deltas') || name.endsWith('.segments');
}

function sweepDir(dir, ctx) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isOrphanTempName(entry.name)) continue;
    const full = path.join(dir, entry.name);
    ctx.summary.scanned += 1;
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    // Clamp to >= 0: `mtimeMs` is a sub-millisecond float while `now` is an
    // integer, so a file written microseconds ago can read as "in the
    // future" and produce a spuriously negative age.
    const ageMs = Math.max(0, ctx.now - stat.mtimeMs);
    if (ageMs < ctx.maxAgeMs) {
      ctx.summary.skippedRecent += 1;
      continue;
    }
    try {
      fs.unlinkSync(full);
      ctx.summary.removed += 1;
      ctx.summary.bytesReclaimed += stat.size;
      ctx.summary.removedPaths.push(full);
    } catch {
      // Tolerate races / permission issues — best-effort cleanup.
    }
  }
}

/**
 * Remove crash-orphaned reconcile staging temps from the state directory.
 * Scans the top level plus immediate `*.deltas` / `*.segments` artifact
 * subdirs. Pure of environment access — callers thread `maxAgeMs` / `now`.
 *
 * @param {string} stateDir
 * @param {{maxAgeMs?:number, now?:number}} [opts]
 * @returns {{scanned:number, removed:number, skippedRecent:number, bytesReclaimed:number, removedPaths:string[]}}
 */
export function sweepStaleArtifactTemps(stateDir, opts = {}) {
  const summary = { scanned: 0, removed: 0, skippedRecent: 0, bytesReclaimed: 0, removedPaths: [] };
  if (!stateDir) return summary;
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) && opts.maxAgeMs >= 0
    ? opts.maxAgeMs
    : DEFAULT_TMP_SWEEP_MAX_AGE_MS;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const ctx = { maxAgeMs, now, summary };

  let topEntries;
  try {
    topEntries = fs.readdirSync(stateDir, { withFileTypes: true });
  } catch {
    return summary;
  }

  sweepDir(stateDir, ctx);
  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    if (!isScannableArtifactSubdir(entry.name)) continue;
    sweepDir(path.join(stateDir, entry.name), ctx);
  }
  return summary;
}
