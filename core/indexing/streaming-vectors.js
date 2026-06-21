/**
 * Streaming vectors + late-interaction builder (bounded-memory full rebuild).
 *
 * WHY THIS EXISTS
 * ---------------
 * The default in-memory vectors path (`buildVectorIndex` ‖ `buildLateInteractionIndex`
 * driven from `buildVectorsAndArtifactsPhase`) materialises the ENTIRE chunk
 * corpus at once: `chunkFiles()` returns every chunk + every embed-text, dedup
 * annotates them in place, the embed pass holds all exemplar embeddings + insert
 * rows, and the LI pass keeps every doc's per-token slab in `this.documents`.
 * Peak heap is O(repo). On large repositories (e.g. tursodatabase/libsql ≈ 431k
 * chunks, swc-project/swc ≈ 217k chunks / 180k exemplars) that blows the default
 * ~4 GB Node heap / a RAM-limited box and the indexer crashes — regardless of
 * the encoder backend (CUDA, Metal, CoreML, or ORT-CPU), because the hogs live
 * in the JS layer, not the model.
 *
 * WHAT THIS DOES
 * --------------
 * Streams the same pipeline in bounded windows so peak heap is O(window):
 *
 *   1. PARSE+SPILL  — parse files in file-windows (reusing `chunkFiles`), compute
 *      dedup fingerprints, apply the LI skip policy (content in hand), and spill
 *      each chunk to a temp SQLite store. Only lightweight per-chunk records
 *      (id, text length, path/hash, fingerprint, li-keep flag) stay resident.
 *   2. DEDUP        — cluster the resident fingerprints GLOBALLY (identical to the
 *      in-memory path — needed so dup-heavy repos keep their 94%-alias short-cut
 *      instead of re-embedding everything) and annotate the lightweight records.
 *   3. EMBED        — stream exemplars in chunk-range windows, hydrate from the
 *      store, and insert via the UNCHANGED `pipelinedEmbedAndInsert`
 *      (→ `callLocalModelBucketed`: the cache-aware compute-batching the README
 *      documents is untouched).
 *   4. ALIAS        — stream aliases in windows, copy exemplar vectors via the
 *      UNCHANGED `insertAliasVectors`.
 *   5. LI           — hand LI-lite records (exemplar token-text only) to the
 *      UNCHANGED `buildLateInteractionIndex` in bounded build mode, so per-token
 *      slabs are flushed to segments and evicted (peak O(one segment)).
 *
 * On-disk output is byte-for-byte the same format the in-memory path produces
 * (codebase.db vectors + atomic swap; SSLX-v3 LI segments). Small repos and
 * incremental runs keep the original in-memory path untouched (see the gate in
 * buildVectorsAndArtifactsPhase), so benchmark indexes are unaffected.
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import {
  DB_PATHS,
  EMBEDDING_CONFIG,
  PROJECT_ROOT,
  DEDUP_CONFIG,
  LATE_INTERACTION_CONFIG,
} from '../infrastructure/config/index.js';
import {
  isDedupAvailable,
  computeFingerprints,
  clusterFingerprints,
} from '../infrastructure/index.js';
import { annotateDedupClusters } from './dedup/dedup-phase.js';
import {
  chunkFiles,
  createVectorSchema,
  pipelinedEmbedAndInsert,
  insertAliasVectors,
} from './indexer-build.js';
import { buildLateInteractionIndex } from './indexer-ann.js';
import {
  configureJournalMode,
  checkpointWal,
  atomicSwapDatabase,
  log,
  logProgress,
} from './indexer-utils.js';

// Files parsed per chunkFiles() call. Bounds the transient parse working set.
const PARSE_FILE_WINDOW = Number(process.env.SWEET_SEARCH_STREAM_PARSE_FILES) || 2000;
// Aliases hydrated per insert window. Bounds the transient alias working set.
// Alias rows just copy the exemplar's vector + deterministic metadata, so the
// window size does NOT affect the resulting index — only peak memory.
const HYDRATE_CHUNK_WINDOW = Number(process.env.SWEET_SEARCH_STREAM_HYDRATE_CHUNKS) || 50_000;
// Exemplars embedded per call. The embedding written for a chunk is determined
// by callLocalModelBucketed's bucketing over the set it's handed, so to keep the
// index BYTE-IDENTICAL to the in-memory path (which embeds all exemplars in one
// call) the streaming path must also embed all exemplars in ONE call whenever
// they fit. This window is sized well above any repo that could have indexed
// in-memory before (~4 GB heap OOMs in-memory well under this exemplar count),
// so every repo with a valid "before" gets the identical single embed call.
// Only a repo too huge to ever have indexed in-memory splits into multiple
// embed windows — and that repo has no prior index to differ from. On CPU the
// per-chunk embedding is batch-independent (identical even when windowed); the
// single call only matters for GPU FP-reassociation across batch shapes.
const EMBED_WINDOW = Number(process.env.SWEET_SEARCH_STREAM_EMBED_WINDOW) || 200_000;

// ── small replicas of indexer-build internals (kept private here) ──

/** Mirror of chunkFiles()'s embed-text cap (ast-chunker getEmbedTextCap). */
function embedTextCap() {
  const v = parseInt(process.env.SWEET_SEARCH_EMBED_TEXT_CAP || '', 10);
  return Number.isFinite(v) && v >= 500 ? v : 2000;
}

/** Mirror of indexer-build.js chunkFilePath (not exported). */
function chunkFilePath(chunk) {
  for (const candidate of [
    chunk?.metadata?.relative_path,
    chunk?.metadata?.path,
    chunk?.metadata?.file_path,
    chunk?.file,
    chunk?.metadata?.file,
  ]) {
    if (typeof candidate !== 'string') continue;
    const n = candidate.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
    if (!n || n === '.' || n.startsWith('/')) continue;
    if (/^[A-Za-z]:\//.test(n)) continue;
    if (n === '..' || n.startsWith('../') || n.includes('/../')) continue;
    return n;
  }
  return '';
}

/** Mirror of chunkFiles()'s per-chunk embed-text derivation. */
function embedTextOf(chunk, cap) {
  if (chunk.embedding_text) return chunk.embedding_text.slice(0, cap);
  return `${chunkFilePath(chunk)} ${chunk.metadata?.symbol || ''}\n${(chunk.text || chunk.content || '').slice(0, 1500)}`;
}

// Dedup-annotation fields written by annotateDedupClusters onto a record's
// metadata; merged back into the hydrated chunk so downstream sees the same
// annotations the in-memory path would have set in place.
const DEDUP_FIELDS = ['simhash', 'isExemplar', 'exemplarId', 'clusterId', 'aliasJaccard', 'liReuseEligible'];

function mergeDedupMeta(chunk, recMeta) {
  const m = (chunk.metadata = chunk.metadata || {});
  for (const k of DEDUP_FIELDS) m[k] = recMeta[k];
  return chunk;
}

function* windows(n, size) {
  for (let i = 0; i < n; i += size) yield [i, Math.min(i + size, n)];
}

// ── temp spill store ──

async function openSpillStore() {
  const Database = (await import('better-sqlite3')).default;
  const storePath = DB_PATHS.codebase + '.staging-chunks.db';
  for (const p of [storePath, storePath + '-wal', storePath + '-shm']) {
    try { await fs.unlink(p); } catch { /* absent */ }
  }
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const db = new Database(storePath);
  // Fast, non-durable: this is a throwaway scratch file deleted at the end.
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.exec('CREATE TABLE c (seq INTEGER PRIMARY KEY, j TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO c (seq, j) VALUES (?, ?)');
  const insertMany = db.transaction((rows) => { for (const r of rows) insert.run(r.seq, r.j); });
  const readRange = db.prepare('SELECT seq, j FROM c WHERE seq >= ? AND seq < ? ORDER BY seq');
  return { db, storePath, insertMany, readRange };
}

// =============================================================================
// MAIN
// =============================================================================

/**
 * Build vectors (codebase.db) + the staged LI index for a full rebuild with
 * bounded memory. Returns `{ vectorStats, lateInteractionResult, liBuilt }`.
 * The caller (buildVectorsAndArtifactsPhase) promotes the staged LI index and
 * builds quantized artifacts from the swapped codebase.db, exactly as it does
 * for the in-memory path.
 *
 * @param {object} opts
 * @param {string[]} opts.filesToIndex
 * @param {object}   opts.modelInfo                getModelInfo()
 * @param {boolean}  opts.sqliteFastMode
 * @param {boolean}  opts.noLateInteraction
 * @param {object}   opts.li                       LI resource-plan knobs + staged paths
 */
export async function buildVectorsAndLiStreaming(opts) {
  const {
    filesToIndex,
    modelInfo,
    sqliteFastMode = false,
    noLateInteraction = false,
    li = {},
  } = opts;

  const cap = embedTextCap();
  const dedupOn = DEDUP_CONFIG.enabled && isDedupAvailable();
  const wantLi = !noLateInteraction && LATE_INTERACTION_CONFIG.enabled;

  log('\n━━━ Phase 2: Vectors + LI (streaming, bounded memory) ━━━', 'bright');
  log(`Streaming ${filesToIndex.length} files (parse window=${PARSE_FILE_WINDOW} files, hydrate window=${HYDRATE_CHUNK_WINDOW} chunks)`, 'dim');

  const store = await openSpillStore();
  try {
    // ── 1. PARSE + SPILL + FINGERPRINT + LI-SKIP ──
    const records = [];          // [{ id, _textLen, file, metadata, liKeep }]
    const fingerprints = [];     // parallel to records (freed after clustering)
    let seq = 0;
    let parsed = 0;

    const { applyIndexingChunkPolicy } = await import('./indexing-file-policy.js');

    for (const [fi, fj] of windows(filesToIndex.length, PARSE_FILE_WINDOW)) {
      const fileWindow = filesToIndex.slice(fi, fj);
      const { allChunks } = await chunkFiles(fileWindow);
      if (allChunks.length === 0) { parsed += fileWindow.length; continue; }

      // Fingerprints on raw text (matches runDedupPhase: c.text || c.content).
      let fps = null;
      if (dedupOn) {
        try {
          fps = computeFingerprints(allChunks.map((c) => c.text || c.content || ''), DEDUP_CONFIG);
        } catch { fps = null; }
      }

      // LI skip policy needs chunk content — apply it here, while we have it,
      // and remember the keep decision so the LI stage can run on LI-lite records.
      let liKeptIds = null;
      if (wantLi) {
        try {
          const { kept } = applyIndexingChunkPolicy(allChunks, { projectRoot: PROJECT_ROOT });
          liKeptIds = new Set(kept.map((c) => c.id));
        } catch { liKeptIds = null; }
      }

      const rows = new Array(allChunks.length);
      for (let k = 0; k < allChunks.length; k++) {
        const chunk = allChunks[k];
        rows[k] = { seq, j: JSON.stringify(chunk) };
        records.push({
          id: chunk.id,
          _textLen: (chunk.text || chunk.content || '').length,
          file: chunk.file,
          // Carry only the fields selectExemplar reads; annotateDedupClusters
          // writes the dedup annotation fields onto this same object.
          metadata: {
            relative_path: chunk.metadata?.relative_path,
            path: chunk.metadata?.path,
            file_path: chunk.metadata?.file_path,
            file: chunk.metadata?.file,
            hash: chunk.metadata?.hash,
          },
          liKeep: liKeptIds ? liKeptIds.has(chunk.id) : wantLi,
        });
        fingerprints.push(fps ? fps[k] : null);
        seq++;
      }
      store.insertMany(rows);

      parsed += fileWindow.length;
      logProgress(parsed, filesToIndex.length, 'Parsing+spill');
    }

    const totalChunks = records.length;
    log(`\n✓ Spilled ${totalChunks} chunks to disk (lightweight records resident only)`, 'green');
    if (totalChunks === 0) {
      return { vectorStats: { chunks: 0, embeddings: 0 }, lateInteractionResult: null, liBuilt: false };
    }

    // ── 2. GLOBAL DEDUP (on lightweight signatures) ──
    let dedupStats = null;
    if (dedupOn && fingerprints.every((f) => f)) {
      try {
        const clusters = clusterFingerprints(fingerprints, DEDUP_CONFIG);
        dedupStats = annotateDedupClusters(records, fingerprints, clusters, DEDUP_CONFIG);
        const pct = ((dedupStats.totalAliases / totalChunks) * 100).toFixed(1);
        log(`Dedup: ${dedupStats.clustersWithSiblings} clusters, ${dedupStats.totalAliases} aliases (${pct}% of ${totalChunks})`, 'cyan');
      } catch (e) {
        log(`Dedup skipped (${e.message}); embedding every chunk`, 'yellow');
      }
    }
    // Free the heaviest resident structure (≈0.5 KB/chunk) before embedding.
    fingerprints.length = 0;

    const exemplarSeqs = [];
    const aliasSeqs = [];
    for (let s = 0; s < records.length; s++) {
      if (records[s].metadata.exemplarId) aliasSeqs.push(s); else exemplarSeqs.push(s);
    }
    log(`Embedding ${exemplarSeqs.length} exemplars, copying vectors for ${aliasSeqs.length} aliases`, 'dim');

    // ── open codebase.db.tmp once; stream inserts; atomic-swap at the end ──
    const Database = (await import('better-sqlite3')).default;
    await fs.mkdir(path.dirname(DB_PATHS.codebase), { recursive: true });
    const tmpPath = DB_PATHS.codebase + '.tmp';
    for (const p of [tmpPath, tmpPath + '-wal', tmpPath + '-shm']) {
      try { await fs.unlink(p); } catch { /* absent */ }
    }
    const vdb = new Database(tmpPath);
    configureJournalMode(vdb, tmpPath, sqliteFastMode);
    createVectorSchema(vdb);

    const isLocal = modelInfo.provider === 'local';
    const writeFlushRows = EMBEDDING_CONFIG.indexerWriteFlushRows;
    const embeddingOptions = { useCache: false };
    let effectiveDim = modelInfo.dimension;
    if (modelInfo.isRemote) {
      const configuredOutputDim = parseInt(
        process.env.SWEET_SEARCH_INDEXING_OUTPUT_DIMENSION || `${modelInfo.hnswDimension}`, 10);
      if (Number.isFinite(configuredOutputDim) && configuredOutputDim > 0 && configuredOutputDim <= modelInfo.dimension) {
        embeddingOptions.providerOptions = {
          outputDimension: configuredOutputDim,
          inputType: 'document',
          concurrency: parseInt(process.env.SWEET_SEARCH_EMBEDDING_CONCURRENCY || '4', 10),
        };
        effectiveDim = configuredOutputDim;
      }
    }

    // Hydrate a specific list of seqs (batched IN query), merge dedup
    // annotations, and tag each chunk with its LI-keep flag. Returns chunks in
    // `seqs` order (= seq order = file order), so annotateChunksForVectorInsert's
    // per-file structural-id grouping stays correct (windows are cut at file
    // boundaries — see fileWindows). Hydrating ONLY the seqs a pass needs avoids
    // re-parsing the whole corpus (e.g. the embed pass parses 25k exemplar JSONs
    // for libsql, not all 431k) — the key "don't slow down" optimization.
    const HYDRATE_SUB = 4000;
    const hydrateSeqs = (seqs) => {
      const out = [];
      for (let i = 0; i < seqs.length; i += HYDRATE_SUB) {
        const batch = seqs.slice(i, i + HYDRATE_SUB);
        const rows = store.db
          .prepare(`SELECT seq, j FROM c WHERE seq IN (${batch.map(() => '?').join(',')})`)
          .all(...batch);
        const bySeq = new Map();
        for (const r of rows) bySeq.set(r.seq, r.j);
        for (const s of batch) {
          const j = bySeq.get(s);
          if (j === undefined) continue;
          const chunk = JSON.parse(j);
          if (dedupStats) mergeDedupMeta(chunk, records[s].metadata);
          chunk.__liKeep = records[s].liKeep; // transient; ignored by downstream
          out.push(chunk);
        }
      }
      return out;
    };

    // File-aligned windows over a seq list: cut at `size` but never mid-file,
    // so a file's chunks always land in one window.
    function* fileWindows(seqs, size) {
      let start = 0;
      while (start < seqs.length) {
        let end = Math.min(start + size, seqs.length);
        while (end < seqs.length && records[seqs[end]].file === records[seqs[end - 1]].file) end++;
        yield seqs.slice(start, end);
        start = end;
      }
    }

    // LI input is assembled DURING the embed/alias passes (no third parse pass).
    // Exemplars carry token text; LI-reuse-eligible aliases need only a pointer.
    const liExemplars = [];
    const liAliases = [];
    const liLite = (chunk, withText) => (withText
      ? { id: chunk.id, file: chunk.file, metadata: chunk.metadata || {}, li_greedy_text: chunk.li_greedy_text, embedding_text: chunk.embedding_text, li_text: chunk.li_text, text: chunk.text }
      : { id: chunk.id, file: chunk.file, metadata: chunk.metadata || {} });

    // ── 3. EMBED exemplars (only exemplar seqs hydrated; bucketing UNCHANGED) ──
    let embeddingCount = 0;
    let embeddedSoFar = 0;
    for (const win of fileWindows(exemplarSeqs, EMBED_WINDOW)) {
      const exemplars = hydrateSeqs(win);
      if (exemplars.length === 0) continue;
      const exemplarTexts = exemplars.map((c) => embedTextOf(c, cap));
      const batchSize = isLocal ? exemplarTexts.length : EMBEDDING_CONFIG.indexerBatchSize;
      embeddingCount += await pipelinedEmbedAndInsert(
        vdb, exemplars, exemplarTexts, batchSize, modelInfo,
        (done) => logProgress(embeddedSoFar + done, exemplarSeqs.length, 'Embedding'),
        embeddingOptions, log, writeFlushRows,
      );
      embeddedSoFar += exemplars.length;
      if (wantLi) for (const c of exemplars) if (c.__liKeep) liExemplars.push(liLite(c, true));
    }
    checkpointWal(vdb);
    log(`\n✓ Generated ${embeddingCount} embeddings (${effectiveDim}d)`, 'green');

    // ── 4. ALIAS inserts (only alias seqs hydrated; exemplar vectors present) ──
    if (aliasSeqs.length > 0) {
      let aliasInserted = 0;
      for (const win of fileWindows(aliasSeqs, HYDRATE_CHUNK_WINDOW)) {
        const aliases = hydrateSeqs(win);
        if (aliases.length === 0) continue;
        aliasInserted += insertAliasVectors(vdb, aliases, modelInfo, { skipOrphanPurge: true });
        if (wantLi) for (const c of aliases) if (c.__liKeep) liAliases.push(liLite(c, !c.metadata?.liReuseEligible));
      }
      log(`  ✓ Inserted ${aliasInserted} alias vector(s) (embeddings copied from exemplars)`, 'dim');
    }

    checkpointWal(vdb);
    try { vdb.pragma('optimize'); } catch { /* best effort */ }
    vdb.close();
    await atomicSwapDatabase(tmpPath, DB_PATHS.codebase);
    const vstat = await fs.stat(DB_PATHS.codebase);
    log(`✓ Saved codebase.db (${(vstat.size / 1024 / 1024).toFixed(2)} MB, ${totalChunks} vectors)`, 'green');

    const vectorStats = { chunks: totalChunks, embeddings: embeddingCount };

    // ── 5. LATE INTERACTION (LI-lite input + bounded build mode) ──
    // liExemplars/liAliases were assembled during the embed/alias passes above,
    // so no third parse pass. buildLateInteractionIndex partitions by
    // metadata.exemplarId — order in the input array doesn't matter.
    let lateInteractionResult = null;
    let liBuilt = false;
    if (wantLi) {
      const liChunks = liExemplars.concat(liAliases);

      try {
        lateInteractionResult = await buildLateInteractionIndex(liChunks, false, [], {
          poolFactor: li.poolFactor ?? 1,
          extendedSkiplist: li.extendedSkiplist ?? false,
          loadFromPath: li.loadFromPath ?? DB_PATHS.lateInteraction,
          saveToPath: li.saveToPath,
          finalIndexPath: li.finalIndexPath ?? DB_PATHS.lateInteraction,
          stagingSegmentDir: li.stagingSegmentDir,
          fullRebuild: true,
          workerCount: li.workerCount ?? 1,
          threadsPerWorker: li.threadsPerWorker ?? 0,
          batchSize: li.batchSize ?? 8,
          batchSizeUpperCap: li.batchSizeUpperCap,
          tokenBudget: li.tokenBudget ?? 8192,
          attentionBudget: li.attentionBudget ?? null,
          projectRoot: PROJECT_ROOT,
          buildEvict: true,
          skipPolicyAlreadyApplied: true,
        });
        liBuilt = true;
      } catch (err) {
        // Non-fatal: vectors (codebase.db) are already committed above, so a
        // failed LI build must not lose them. The caller invalidates/cleans the
        // staged LI index and continues — same contract as the in-memory path.
        log(`Late interaction build failed (non-fatal): ${err.message}`, 'yellow');
        lateInteractionResult = { error: err.message, invalidated: true };
        liBuilt = false;
      }
    }

    return { vectorStats, lateInteractionResult, liBuilt };
  } finally {
    try { store.db.close(); } catch { /* ignore */ }
    for (const p of [store.storePath, store.storePath + '-wal', store.storePath + '-shm']) {
      try { await fs.unlink(p); } catch { /* absent */ }
    }
  }
}
