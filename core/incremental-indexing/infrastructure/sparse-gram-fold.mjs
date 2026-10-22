/**
 * Sparse-gram base fold: rebuild the base from the corpus on disk and empty the
 * deltas, without stopping the maintainer's ticks.
 *
 * The build reads every indexed file, so on a large corpus it runs in a child
 * process (background-build.mjs) from a snapshot: the delta segments listed when
 * the fold started. Ticks keep appending records meanwhile, extracted with the
 * old base's weights. The new base has new weights (the weights id hashes the
 * artifact), and readers drop delta records of another weights id, so the
 * maintainer's publish re-extracts the latest record per file of the segments
 * added after the snapshot from the file on disk with the new base, writes them
 * as one new segment, and retires every older segment (they stay on disk for the
 * grace period, for readers holding the older manifest). The caller then
 * publishes the manifest with the new weights id and delta list.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import {
  DELTA_DIR_SUFFIX, DELTA_FILE_EXT, fileIdFor, listDeltaSegments, retireDeltaSegments,
} from './sparse-gram-delta.mjs';
import { contentHashSync } from './hashing.mjs';
import {
  buildSparseGramIndexArtifact, extractSparseGramDeltaRecord, getSparseGramAllFiles, loadSparseGramIndex,
} from '../../infrastructure/native-sparse-gram.js';
import { collectFileSymbolMasksFromDb, resolveSparseGramWeightsId } from '../../indexing/indexer-sparse-gram.js';
import { GREP_MAX_FILE_SIZE } from '../../indexing/grep-corpus.js';

/** Latest record per fileId over `segmentPaths`, in order (later wins). */
function latestRecordsOf(segmentPaths) {
  const latest = new Map();
  for (const p of segmentPaths) {
    let raw;
    try { raw = fs.readFileSync(p, 'utf-8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record;
      try { record = JSON.parse(trimmed); } catch { continue; }
      if (record.fileId) latest.set(record.fileId, record);
    }
  }
  return latest;
}

function readableFile(projectRoot, rel) {
  try {
    const st = fs.lstatSync(path.join(projectRoot, rel));
    return st.isFile() && st.size > 0 && st.size <= GREP_MAX_FILE_SIZE;
  } catch {
    return false;
  }
}

/**
 * Build the folded base into `${base}.next`: the base's files plus the files the
 * snapshot `segments` added, minus the ones they deleted and the ones gone from
 * disk, gram'd from disk with the full build's builder and symbol masks.
 * Returns { stagedPath, files, weightsId }.
 */
export async function buildSparseGramFold({ stateDir, base, projectRoot, segments }) {
  const files = new Set(getSparseGramAllFiles(loadSparseGramIndex(base)) || []);
  for (const record of latestRecordsOf(segments).values()) {
    if (!record.filePath) continue;
    if (record.deleted) files.delete(record.filePath);
    else files.add(record.filePath);
  }
  const kept = [...files].filter((rel) => readableFile(projectRoot, rel)).sort();
  let masks = kept.map(() => 0);
  const dbPath = path.join(stateDir, 'codebase.db');
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try { masks = collectFileSymbolMasksFromDb(db, kept); } finally { db.close(); }
  }
  const staged = `${base}.next`;
  const built = buildSparseGramIndexArtifact({ projectRoot, files: kept, fileSymbolMasks: masks, outputPath: staged });
  const weightsId = await resolveSparseGramWeightsId(built, staged);
  return { stagedPath: staged, files: kept.length, weightsId };
}

/**
 * Swap the staged base in (see the module comment). `segments`: the snapshot the
 * build folded. Returns { retiredSegments, carriedRecords, carriedPath }.
 */
export function publishSparseGramFold({ base, stagedPath, segments, projectRoot, weightsId }) {
  const snapshot = new Set(segments);
  const post = listDeltaSegments(base).filter((seg) => !snapshot.has(seg.path));
  const carried = latestRecordsOf(post.map((seg) => seg.path));
  fs.renameSync(stagedPath, base);

  let carriedPath = null;
  if (carried.size > 0) {
    const index = loadSparseGramIndex(base);
    const lines = [];
    for (const record of carried.values()) {
      const rel = record.filePath;
      let content = null;
      if (!record.deleted && rel && readableFile(projectRoot, rel)) {
        try { content = fs.readFileSync(path.join(projectRoot, rel), 'utf8'); } catch { content = null; }
      }
      if (content === null) {
        lines.push({ ...record, fileId: record.fileId || fileIdFor(rel), deleted: true, weightsId, grams: [] });
        continue;
      }
      const extracted = extractSparseGramDeltaRecord({ index, content });
      if (!extracted) throw new Error(`sparse_gram fold: cannot re-extract ${rel}`);
      lines.push({
        ...record,
        contentHash: contentHashSync(content),
        deleted: false,
        weightsId: extracted.weightsId || weightsId,
        grams: [...new Set(extracted.grams || [])].sort().map((gram) => [gram, 1]),
      });
    }
    // After every segment the ticks wrote (`{maxEpoch}-{seq}`, a seq no file in the
    // directory holds, retired ones included), so later ticks' epochs sort after it.
    const dir = `${base}${DELTA_DIR_SUFFIX}`;
    const epoch = post[post.length - 1].epoch;
    let seq = 1;
    for (const name of fs.readdirSync(dir)) {
      const m = name.match(/^(\d+)-(\d+)\.ssgrmdelta/);
      if (m && Number(m[1]) === epoch) seq = Math.max(seq, Number(m[2]) + 1);
    }
    carriedPath = path.join(dir, `${epoch}-${seq}${DELTA_FILE_EXT}`);
    const tmp = `${carriedPath}.fold.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, carriedPath);
  }
  const retired = [...segments, ...post.map((seg) => seg.path)];
  retireDeltaSegments(base, retired);
  return { retiredSegments: retired.length, carriedRecords: carried.size, ...(carriedPath ? { carriedPath } : {}) };
}
