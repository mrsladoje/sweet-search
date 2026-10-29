/**
 * Binary HNSW compaction: fold the delta rows into a new base and drop the
 * retired nodes, without stopping the maintainer's ticks.
 *
 * A base of at most EXACT_SCAN_MAX_VECTORS live nodes is built flat (no graph:
 * search scans it exactly), which takes a second or so, inline. A larger one
 * needs the graph (minutes at 1M nodes), so a child process builds it from a
 * snapshot (the first `snapshotCount` nodes) while ticks keep appending delta
 * rows and retiring nodes; the maintainer then publishes it:
 *   1. stage: the new base (`<name>.compact.idx` + its full-vector files), the
 *      delta rows added after the snapshot re-encoded for the new base
 *      (`<index>.delta.next`), the stale bitmap renumbered for it
 *      (`<index>.stale.bin.next`);
 *   2. journal (`<index>.compact.json`): the removes and renames that swap them in;
 *   3. run the journal: remove the old stale bitmap first (so it never applies to
 *      the renumbered nodes), move the full-vector files, the index (the commit
 *      point), the delta, the bitmap; then delete the journal.
 * A crash mid-way is rolled forward from the journal (rollForwardHnswCompaction,
 * run before the maintainer opens the index). Between the steps a reader may
 * see retired nodes or miss the full-vector stage for a moment, never live
 * nodes hidden.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { BinaryHNSWIndex, hnswBuildThreads, readIndexIdsSync } from '../../vector-store/binary-hnsw-index.js';
import { readIndexHeader } from '../../vector-store/index-file-header.js';
import { deltaHeader, deltaPathFor, encodeDeltaRecord } from '../../vector-store/hnsw-delta-file.js';
import { FullVectorWriter, NO_ROW, fullVectorPaths } from '../../vector-store/full-vector-file.js';
import { createBitmap, isSet, saveBitmap, setBit } from './tombstone-bitmap.mjs';
import { startBackgroundBuild } from './background-build.mjs';

export function compactionPaths(indexPath) {
  const staged = path.join(path.dirname(indexPath), `${path.basename(indexPath, '.idx')}.compact.idx`);
  return {
    staged,
    journal: `${indexPath}.compact.json`,
    deltaNext: `${deltaPathFor(indexPath)}.next`,
    staleNext: `${indexPath}.stale.bin.next`,
  };
}

/**
 * Live vector ids from codebase.db (`epoch_retired IS NULL`): the liveness
 * authority, so a retire whose stale bit never landed is still dropped. null
 * when the database or the column is missing (the stale bitmap decides then).
 */
export function readLiveVectorIds(stateDir) {
  const dbPath = path.join(stateDir, 'codebase.db');
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    return new Set(db.prepare('SELECT id FROM vectors WHERE epoch_retired IS NULL').raw().all().map((r) => r[0]));
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Build the compacted base into the staged path from the first `snapshotCount`
 * nodes of the index (all of them when omitted) that are live. Flat unless
 * `graph`. Returns { stagedPath, count, snapshotCount, dropped }.
 */
export async function buildCompactedBase({ indexPath, stateDir, snapshotCount = null, graph = false, onProgress = () => {} }) {
  const existing = new BinaryHNSWIndex({ indexPath });
  await existing.load(indexPath);
  try {
    const n = Math.min(snapshotCount ?? existing.size, existing.size);
    const liveIds = readLiveVectorIds(stateDir);
    const stale = existing._loadStaleBitmap();
    const live = [];
    for (let i = 0; i < n; i++) {
      const id = existing.nodeId(i);
      if (liveIds ? !liveIds.has(id) : (stale && isSet(stale, i))) continue;
      if (existing.idToIndex.get(id) !== i) continue; // a later node holds the id
      live.push({ id, node: i });
    }
    // A fixed order (by id), so a rebuild of the same live set is reproducible.
    live.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const { staged } = compactionPaths(indexPath);
    const fresh = new BinaryHNSWIndex({
      indexPath: staged,
      dimension: existing.dimension,
      floatDimension: existing.floatDimension,
      M: existing.M,
      efConstruction: existing.efConstruction,
      efSearch: existing.efSearch,
      maxElements: Math.max(existing.maxElements, live.length),
    });
    fresh.resetForBuild();
    let done = 0;
    for (const v of live) {
      const binary = existing.nodeBinary(v.node);
      const int8 = existing.nodeInt8(v.node) || null;
      const full = existing.fullVectorOf(v.node);
      const meta = existing.nodeMetadata(v.node);
      fresh.addFlat(v.id, new Uint8Array(binary), meta, int8 ? new Int8Array(int8) : null, full);
      if (++done % 1000 === 0) onProgress('maintenance:binary-hnsw:add');
    }
    // Background work: a quarter of the cores (the lists do not depend on the thread count).
    if (graph) await fresh.linkGraph({ threads: Math.max(1, Math.floor(hnswBuildThreads() / 4)), background: true });
    fresh._cleanBuild = true;
    await fresh.save(staged);
    fresh.close();
    return { stagedPath: staged, count: live.length, snapshotCount: n, dropped: n - live.length };
  } finally {
    existing.close();
  }
}

function fsyncPath(p) {
  const fd = fs.openSync(p, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeDurable(p, bytes) {
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, bytes);
  fsyncPath(tmp);
  fs.renameSync(tmp, p);
}

/** Run (or finish) a publish journal: idempotent removes and renames. */
function runJournal(journalPath, steps) {
  for (const [op, a, b] of steps) {
    if (op === 'rm') fs.rmSync(a, { force: true });
    else if (op === 'mv' && fs.existsSync(a)) fs.renameSync(a, b);
  }
  fs.rmSync(journalPath, { force: true });
}

/** Finish a publish a crash interrupted. True when there was one. */
export function rollForwardHnswCompaction(indexPath) {
  const { journal } = compactionPaths(indexPath);
  let steps;
  try { steps = JSON.parse(fs.readFileSync(journal, 'utf8')).steps; } catch { return false; }
  if (!Array.isArray(steps)) { fs.rmSync(journal, { force: true }); return false; }
  runJournal(journal, steps);
  return true;
}

/** Remove what a build left staged (an abandoned or failed one). */
export function discardStagedCompaction(indexPath) {
  const p = compactionPaths(indexPath);
  const full = fullVectorPaths(p.staged);
  for (const f of [p.staged, full.data, full.map, `${full.data}.build`, p.deltaNext, p.staleNext]) fs.rmSync(f, { force: true });
}

/**
 * Swap a staged base in (see the module comment). The nodes of the index from
 * `snapshotCount` on (delta rows added while the base was built) move to the
 * new base's delta; the stale marks are renumbered by id. With `baseGeneration`
 * (the base the build started from), a base replaced since discards the build.
 * Returns { count, carriedDelta, stale } or { skipped: 'base-replaced' }.
 */
export async function publishCompactedBase({ indexPath, stagedPath, snapshotCount, baseGeneration = null }) {
  const current = new BinaryHNSWIndex({ indexPath });
  await current.load(indexPath);
  const paths = compactionPaths(indexPath);
  try {
    if (baseGeneration !== null && current.generation !== baseGeneration) {
      discardStagedCompaction(indexPath);
      return { skipped: 'base-replaced' };
    }
    const stagedHeader = readIndexHeader(stagedPath)?.header;
    if (!stagedHeader) throw new Error(`binary_hnsw: staged base missing: ${stagedPath}`);
    const stagedIds = readIndexIdsSync(stagedPath).ids;
    const base2 = stagedIds.length;
    const dim = stagedHeader.dimension;
    const stale = current._loadStaleBitmap();
    const staleIds = new Set();
    if (stale) for (let i = 0; i < current.size; i++) if (isSet(stale, i)) staleIds.add(current.nodeId(i));

    // Delta rows added after the snapshot, re-encoded for the new base. Their full
    // vectors move into the new base's full-vector file.
    const post = [];
    for (let i = Math.min(snapshotCount, current.size); i < current.size; i++) post.push(i);
    const stagedFull = fullVectorPaths(stagedPath);
    let writer = post.length > 0 && fs.existsSync(stagedFull.map) ? FullVectorWriter.resume(stagedPath, base2) : null;
    const fulls = post.map((node) => current.fullVectorOf(node));
    if (writer) {
      post.forEach((_, j) => writer.put(base2 + j, fulls[j]));
      writer._flush();
      if (writer.fd !== null) fs.fsyncSync(writer.fd);
      writer.close();
      if (writer.broken) writer = null;
    }
    if (post.length > 0) {
      const encoded = post.map((node, j) => {
        const row = writer ? writer.nodeRow[base2 + j] : NO_ROW;
        const int8 = current.nodeInt8(node);
        return encodeDeltaRecord({
          id: current.nodeId(node),
          metadata: current.nodeMetadata(node),
          code: new Uint8Array(current.nodeBinary(node)),
          int8: int8 ? new Int8Array(int8) : null,
          fullRow: row === undefined || row === NO_ROW ? -1 : row,
        });
      });
      writeDurable(paths.deltaNext, Buffer.concat([deltaHeader(stagedHeader.generation ?? 0, dim), ...encoded]));
    }

    const total = base2 + post.length;
    let marks = 0;
    if (staleIds.size > 0 && total > 0) {
      const bitmap = createBitmap(total);
      for (let j = 0; j < base2; j++) if (staleIds.has(stagedIds[j])) { setBit(bitmap, j); marks++; }
      post.forEach((node, j) => { if (staleIds.has(current.nodeId(node))) { setBit(bitmap, base2 + j); marks++; } });
      if (marks > 0) saveBitmap(paths.staleNext, bitmap);
    }

    const live = fullVectorPaths(indexPath);
    const delta = deltaPathFor(indexPath);
    const staleBin = `${indexPath}.stale.bin`;
    const steps = [
      ['rm', staleBin],
      fs.existsSync(stagedFull.data) ? ['mv', stagedFull.data, live.data] : ['rm', live.data],
      fs.existsSync(stagedFull.map) ? ['mv', stagedFull.map, live.map] : ['rm', live.map],
      ['mv', stagedPath, indexPath],
      post.length > 0 ? ['mv', paths.deltaNext, delta] : ['rm', delta],
      ...(marks > 0 ? [['mv', paths.staleNext, staleBin]] : []),
    ];
    writeDurable(paths.journal, JSON.stringify({ steps }));
    runJournal(paths.journal, steps);
    return { count: base2, carriedDelta: post.length, stale: marks };
  } finally {
    current.close();
  }
}

/**
 * Start a child process that builds a graph base (buildCompactedBase with
 * graph) from the first `snapshotCount` nodes. Returns a job whose `done`
 * becomes true when it ends ({ result } or { error }).
 */
export function startBackgroundCompaction({ indexPath, stateDir, snapshotCount }) {
  const job = startBackgroundBuild('binary_hnsw', { indexPath, stateDir, snapshotCount });
  job.indexPath = indexPath;
  job.snapshotCount = snapshotCount;
  // The base the snapshot belongs to: a full build that replaced it meanwhile
  // makes the result stale (publishCompactedBase then discards it).
  job.baseGeneration = readIndexHeader(indexPath)?.header?.generation ?? null;
  return job;
}
