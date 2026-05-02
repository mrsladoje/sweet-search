/**
 * Indexer ANN - HNSW, late interaction, and quantized artifact building.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import { existsSync, openSync, fsyncSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';

import { DB_PATHS, HNSW_CONFIG, BINARY_HNSW_CONFIG } from '../infrastructure/config/index.js';
import { HNSWIndex } from '../vector-store/hnsw-index.js';
import { LateInteractionIndex } from '../ranking/late-interaction-index.js';
import { truncateForHNSW, getEmbeddings, getModelInfo, fisherYatesShuffle } from '../embedding/embedding-service.js';
import { buildFromCodebaseDb as buildQuantizedArtifacts, shouldSkipArtifactRebuild, updateArtifactState, ARTIFACT_THRESHOLDS } from './artifact-builder.js';
import { log, logProgress } from './indexer-utils.js';
import { JAVA_FAMILY } from './ast-chunker.js';

// =============================================================================
// DURABLE WRITE HELPERS (Phase E — fsync ordering for checkpoint safety)
// =============================================================================

const CHECKPOINT_INTERVAL_SEC = 30;
const MIN_VECTORS_BETWEEN_SAVES = 1000;

/**
 * v6.2: language-family-conditioned LI input routing.
 *
 * Per-language ablation on GenCodeSearchNet (May 2026, see
 * docs/JS_CHUNK_BLEEDING_ANALYSIS.md) determined that different
 * languages benefit from different metadata richness in the late-
 * interaction MaxSim input. v6.2 picks empirically:
 *
 *   chunk.li_text  (simple, per-lang path policy in chunker):
 *     - python (no path; at 97% ceiling, path duplicated funcname)
 *     - JAVA_FAMILY: java, php, csharp/c#, kotlin, scala
 *       (slug-stripped path; framework signal preserved, hashed-slug
 *       noise removed)
 *
 *   chunk.embedding_text (greedy enriched; Scope + Defines + Uses):
 *     - javascript, typescript, jsx, tsx (closures + imports help)
 *     - ruby, go, c, cpp, c++, rust
 *     - any unknown language as the safe fallback
 *
 * The Java-family set is sourced from ast-chunker.js so that the
 * routing here and the path-policy logic inside the chunker can never
 * drift out of sync.
 */
export function pickLiInput(chunk) {
  const lang = chunk?.metadata?.language;
  if (lang === 'python' || JAVA_FAMILY.has(lang)) {
    return chunk.li_text || chunk.embedding_text || chunk.text || chunk.content || '';
  }
  return chunk.embedding_text || chunk.li_text || chunk.text || chunk.content || '';
}

function fsyncFile(filePath) {
  const fd = openSync(filePath, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function fsyncDirectory(dirPath) {
  try {
    const fd = openSync(dirPath, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch (_err) {
    // Directory fsync not supported on all platforms (Windows) — best effort
  }
}

function writeCheckpointSidecar(sidecarPath, data) {
  writeFileSync(sidecarPath, JSON.stringify(data, null, 2));
}

function readCheckpointSidecar(sidecarPath) {
  if (!existsSync(sidecarPath)) return null;
  try {
    return JSON.parse(readFileSync(sidecarPath, 'utf-8'));
  } catch (_err) { return null; }
}

function cleanupCheckpoint(indexPath) {
  const checkpointPath = `${indexPath}.checkpoint`;
  const sidecarPath = `${indexPath}.checkpoint.json`;
  try { unlinkSync(checkpointPath); } catch (_e) { /* noop */ }
  try { unlinkSync(sidecarPath); } catch (_e) { /* noop */ }
}

// =============================================================================
// SQLITE VECTOR STREAMING (Phase B — eliminates O(n*d) in-memory arrays)
// =============================================================================

/**
 * Stream vectors from SQLite in the specified order.
 * For 'sequential' order, reads by rowid (no temp table needed).
 * For 'shuffle' or 'diversity', pre-computes order in a temp table.
 */
// Alias rows (dedup sibling pointers) are filtered out of HNSW construction.
// Inserting them with the exemplar's duplicate embedding floods top-K with
// ties and displaces higher-quality matches. Sibling promotion at query
// time (search/dedup/sibling-expander.js) restores alias IDs in the ranked
// list at the exemplar's rank position.
const ALIAS_FILTER_SQL = "json_extract(metadata, '$.exemplarId') IS NULL";

function* streamVectorsFromDb(db, _dim, order = 'sequential') {
  if (order !== 'sequential') {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS hnsw_order (pos INTEGER PRIMARY KEY, vector_rowid INTEGER)');
    db.exec('DELETE FROM hnsw_order');

    const rowidRows = db
      .prepare(`SELECT rowid FROM vectors WHERE ${ALIAS_FILTER_SQL} ORDER BY rowid`)
      .all();
    let indices = rowidRows.map((r) => r.rowid);

    if (order === 'shuffle') {
      fisherYatesShuffle(indices);
    } else if (order === 'diversity') {
      const pathRows = db
        .prepare(`SELECT rowid, file_path FROM vectors WHERE ${ALIAS_FILTER_SQL} ORDER BY rowid`)
        .all();
      const filePaths = pathRows.map((r) => r.file_path);
      const permutationPositions = diversityFirstPermutationRowids(filePaths);
      indices = permutationPositions.map((pos) => pathRows[pos - 1]?.rowid).filter(Boolean);
    }

    const insertOrder = db.prepare('INSERT INTO hnsw_order (pos, vector_rowid) VALUES (?, ?)');
    db.transaction(() => {
      for (let pos = 0; pos < indices.length; pos++) {
        insertOrder.run(pos, indices[pos]);
      }
    })();

    const stmt = db.prepare(`
      SELECT v.rowid as rowid, v.id, v.file_path, v.embedding, v.metadata
      FROM hnsw_order o
      JOIN vectors v ON v.rowid = o.vector_rowid
      ORDER BY o.pos
    `);
    for (const row of stmt.iterate()) {
      yield {
        rowid: row.rowid,
        id: row.id,
        file: row.file_path,
        embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
      };
    }

    db.exec('DROP TABLE IF EXISTS temp.hnsw_order');
  } else {
    const stmt = db.prepare(
      `SELECT rowid, id, file_path, embedding, metadata FROM vectors WHERE ${ALIAS_FILTER_SQL} ORDER BY rowid`,
    );
    for (const row of stmt.iterate()) {
      yield {
        rowid: row.rowid,
        id: row.id,
        file: row.file_path,
        embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
      };
    }
  }
}

/**
 * Pure decision function — should the hybrid CPU+GPU LI dispatcher arm?
 *
 * Exported for direct unit testing without constructing the full
 * `buildLateInteractionIndex` pipeline. The runtime call site in the
 * encoder-selection block reimplements the same conditions inline; if
 * you change one, change both.
 *
 * Hybrid is a no-op when the Metal command queue is contended by a
 * parallel embed phase (the GPU encoder starves behind embed's continuous
 * command stream), so we refuse to arm it and fall through to the
 * single-encoder path. Users who want hybrid must set
 * `SWEET_SEARCH_PARALLEL_LI=0` OR `SWEET_SEARCH_EMBED_USE_CPU=1` so Metal
 * is either sequential or exclusively held by LI.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env] - Environment to read flags from (defaults to process.env)
 * @param {boolean} [options.parallelLateInteraction] - Whether the pipeline runs LI in parallel with embed
 * @returns {{ armed: boolean, reason: string }}
 */
export function decideHybridDispatcher({
  env = process.env,
  parallelLateInteraction = false,
} = {}) {
  const hybridEnv = (env.SWEET_SEARCH_LI_HYBRID ?? '').trim().toLowerCase();
  const hybridEnabled = hybridEnv === '1' || hybridEnv === 'true' || hybridEnv === 'on';
  if (!hybridEnabled) {
    return { armed: false, reason: 'not-enabled' };
  }
  // SWEET_SEARCH_LI_USE_CPU implies single-encoder CPU path — skip the
  // bidirectional cursor (which would still try to use the GPU encoder).
  if (env.SWEET_SEARCH_LI_USE_CPU === '1') {
    return { armed: false, reason: 'cpu-only-forced' };
  }
  // Metal is contended when BOTH parallelLateInteraction is on AND embed
  // is NOT forced onto the CPU ORT path. Either condition unblocks hybrid.
  const metalContendedByEmbed =
    parallelLateInteraction === true
    && env.SWEET_SEARCH_EMBED_USE_CPU !== '1';
  if (metalContendedByEmbed) {
    return { armed: false, reason: 'metal-contended-by-embed' };
  }
  return { armed: true, reason: 'ok' };
}

function estimateLateInteractionTokens(text, maxLength = 2048) {
  const charsPerToken = Number(process.env.SWEET_SEARCH_LI_CHARS_PER_TOKEN || 4);
  const batchingSafety = Number(process.env.SWEET_SEARCH_LI_BATCHING_SAFETY || 1.15);
  const est = Math.ceil((text.length / charsPerToken) * batchingSafety);
  return Math.max(1, Math.min(est, maxLength));
}

function buildLateInteractionBatches(chunks, options = {}) {
  const batchSizeCap = Math.max(1, options.batchSize ?? 8);
  // Upper cap lets short-chunk batches grow past the baseline `batchSize`
  // when there's token-budget headroom. The baseline batchSize is tuned for
  // max-length chunks (2048 tokens); short chunks (typical 100-300 tokens)
  // leave most of the GPU's SIMT groups idle at that batch count, so we
  // let the bucketer pack more of them per dispatch. Default 4x baseline
  // keeps short-chunk batches GPU-saturated without unbounded memory use.
  const batchSizeUpperCap = Math.max(
    batchSizeCap,
    options.batchSizeUpperCap ?? batchSizeCap * 4,
  );
  const tokenBudget = Math.max(1, options.tokenBudget ?? 8_192);
  const maxLength = options.maxLength ?? 2_048;
  // Attention budget (seq_len² × batch) bounds per-batch *compute work* on
  // top of the token budget (seq_len × batch, which bounds *memory*). Without
  // this, ascending-sorted tail batches pack e.g. 32 × 2048 tokens of hidden
  // state per layer, which overflows the last-level cache and forces every
  // transformer layer to spill to DRAM. Attention is O(seq²), so the same
  // token_budget yields ~100× more FLOPs for a seq=2048 batch vs seq=100 —
  // progress crawls on the long-chunk tail even though the device is fully fed.
  //
  // In the live indexing path, `planAllocation()` computes a cache-aware
  // attention budget from the detected last-level cache (see
  // indexer-pool.js:detectLastLevelCacheBytes) and passes it in via options.
  // The fallback default below only fires when this function is called
  // without an explicit `attentionBudget` (tests, one-off tools). It uses
  // `floor(batchSizeCap/2) × maxLength²`, which lands batch≈batchSizeCap/2
  // at seq=maxLength — not cache-aware, but safe as a stand-in.
  // Override via options.attentionBudget or SWEET_SEARCH_LI_ATTENTION_BUDGET
  // env var. Set either to 0 to disable the cap entirely (Infinity).
  //
  // Precedence (WARNING — env wins over the planner-computed value):
  //   1. If either is explicitly 0 → disabled (Infinity)
  //   2. Otherwise, env var (if >0) wins
  //   3. Otherwise, options.attentionBudget (the cache-aware value from
  //      planAllocation() in indexer-pool.js) wins
  //   4. Otherwise, a conservative tokens²-based fallback
  //
  // Note: `planAllocation()` ALSO reads SWEET_SEARCH_LI_ATTENTION_BUDGET when
  // computing its own value; the second read here exists because some call
  // sites (tests, one-off tools) bypass planAllocation and need the env var
  // respected. Keep these two read sites in sync if you add new env logic.
  const envAttentionBudget = parseInt(
    process.env.SWEET_SEARCH_LI_ATTENTION_BUDGET || '',
    10,
  );
  let attentionBudget;
  if (options.attentionBudget === 0 || envAttentionBudget === 0) {
    attentionBudget = Infinity;
  } else if (Number.isFinite(envAttentionBudget) && envAttentionBudget > 0) {
    attentionBudget = envAttentionBudget;
  } else if (options.attentionBudget != null && options.attentionBudget > 0) {
    attentionBudget = options.attentionBudget;
  } else {
    attentionBudget = Math.max(1, Math.floor(batchSizeCap / 2)) * maxLength * maxLength;
  }
  const indexed = chunks.map((chunk) => {
    const text = pickLiInput(chunk);
    return {
      chunk,
      text,
      estTokens: estimateLateInteractionTokens(text, maxLength),
    };
  });
  indexed.sort((a, b) => a.estTokens - b.estTokens);

  const batches = [];
  let i = 0;
  while (i < indexed.length) {
    let batchSize = 1;
    while (i + batchSize < indexed.length) {
      const candidateLongest = indexed[i + batchSize].estTokens;
      const candidateCount = batchSize + 1;
      if (candidateCount > batchSizeUpperCap) break;
      // Memory cap — linear in seq_len (hidden state ~ batch × seq × hidden_size)
      if (candidateLongest * candidateCount > tokenBudget) break;
      // Compute cap — quadratic in seq_len (attention ~ batch × seq²)
      if (candidateLongest * candidateLongest * candidateCount > attentionBudget) break;
      batchSize = candidateCount;
    }
    batches.push({ items: indexed.slice(i, i + batchSize) });
    i += batchSize;
  }

  return batches;
}

/** Diversity-first permutation returning 1-based rowid indices */
function diversityFirstPermutationRowids(filePaths) {
  const buckets = new Map();
  for (let i = 0; i < filePaths.length; i++) {
    const dir = filePaths[i] ? filePaths[i].replace(/\/[^/]+$/, '') : '_unknown';
    if (!buckets.has(dir)) buckets.set(dir, []);
    buckets.get(dir).push(i + 1); // 1-based rowid
  }
  const dirs = [...buckets.keys()];
  fisherYatesShuffle(dirs);
  const order = [];
  let remaining = filePaths.length;
  while (remaining > 0) {
    for (const dir of dirs) {
      const bucket = buckets.get(dir);
      if (bucket.length > 0) { order.push(bucket.shift()); remaining--; }
    }
  }
  return order;
}

// =============================================================================
// INSERTION ORDER TUNING
// =============================================================================

// NOTE: applyInsertionOrder and diversityFirstPermutation (in-memory array permutation)
// removed in Phase B. Insertion order is now handled via SQLite temp tables in
// streamVectorsFromDb() and diversityFirstPermutationRowids().

// =============================================================================
// PHASE 3: HNSW INDEX (Incremental)
// =============================================================================

export async function incrementalUpdateHNSW(dbPath, changedFiles, dryRun = false) {
  log('\n━━━ Phase 3: HNSW Index (Incremental) ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping HNSW incremental update', 'magenta');
    return;
  }

  const modelInfo = getModelInfo();
  const hnswDim = modelInfo.hnswDimension;

  log('Loading existing HNSW index...', 'yellow');
  const index = new HNSWIndex({
    dimension: hnswDim,
    M: HNSW_CONFIG.M,
    efConstruction: HNSW_CONFIG.efConstruction,
    efSearch: HNSW_CONFIG.efSearch,
  });

  let existingCount = 0;
  try {
    await index.load();
    existingCount = index.nextKey;
    log(`✓ Loaded existing index with ${existingCount} vectors`, 'green');
  } catch (err) {
    log(`No existing index found, creating new one`, 'yellow');
    await index.init();
  }

  let removed = 0;
  if (changedFiles && changedFiles.length > 0) {
    log(`Removing entries for ${changedFiles.length} changed files...`, 'yellow');

    const changedFileSet = new Set(changedFiles);
    const idsToRemove = [];
    for (const [id, metadata] of index.metadata.entries()) {
      if (metadata.file && changedFileSet.has(metadata.file)) {
        idsToRemove.push(id);
      }
    }

    for (const id of idsToRemove) {
      await index.remove(id);
      removed++;
    }

    log(`✓ Removed ${removed} old entries`, 'green');
  }

  // Read new vectors for changed files from SQLite
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath, { readonly: true });

  const changedFileSet = new Set(changedFiles || []);
  const placeholders = [...changedFileSet].map(() => '?').join(',');
  const stmt = changedFileSet.size > 0
    ? db.prepare(`SELECT rowid, id, file_path, embedding, metadata FROM vectors WHERE ${ALIAS_FILTER_SQL} AND file_path IN (${placeholders}) ORDER BY rowid`)
    : db.prepare(`SELECT rowid, id, file_path, embedding, metadata FROM vectors WHERE ${ALIAS_FILTER_SQL} ORDER BY rowid`);

  const rows = changedFileSet.size > 0 ? stmt.all(...changedFileSet) : [];
  const totalNew = changedFileSet.size > 0 ? rows.length : 0;

  log(`Adding ${totalNew} new entries...`, 'yellow');
  let added = 0;

  for (const row of rows) {
    const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
    if (!embedding || embedding.length === 0) continue;

    const truncatedEmbedding = truncateForHNSW(embedding);
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};

    await index.add(row.id, truncatedEmbedding, {
      file: row.file_path,
      name: metadata?.symbol,
      type: metadata?.chunk_type,
    });

    added++;

    if (added % 500 === 0 || added === totalNew) {
      logProgress(added, totalNew, 'Adding to HNSW');
    }
  }

  db.close();

  log('\nSaving merged HNSW index...', 'yellow');
  await index.save();

  const stats = index.getStats();
  log(`✓ HNSW index saved (${stats.totalVectors} total vectors, +${added} -${removed})`, 'green');
  log(`  Engine: ${stats.engine}, Dimension: ${hnswDim}d (Matryoshka)`, 'dim');
}

// =============================================================================
// PHASE 3: HNSW INDEX (Full Rebuild)
// =============================================================================

export async function buildHNSWIndex(dbPath, dryRun = false) {
  log('\n━━━ Phase 3: HNSW Index ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping HNSW index', 'magenta');
    return;
  }

  const Database = (await import('better-sqlite3')).default;
  const orderMode = BINARY_HNSW_CONFIG.insertionOrder || 'sequential';
  // Non-sequential orders require temp tables → can't use readonly
  const db = new Database(dbPath, orderMode === 'sequential' ? { readonly: true } : {});

  const totalVectors = db
    .prepare(`SELECT COUNT(*) as c FROM vectors WHERE ${ALIAS_FILTER_SQL}`)
    .get().c;
  if (totalVectors === 0) {
    db.close();
    log('No chunks to index', 'yellow');
    return;
  }

  const modelInfo = getModelInfo();
  const hnswDim = modelInfo.hnswDimension;

  const index = new HNSWIndex({
    dimension: hnswDim,
    M: HNSW_CONFIG.M,
    efConstruction: HNSW_CONFIG.efConstruction,
    efSearch: HNSW_CONFIG.efSearch,
    maxElements: Math.max(totalVectors * 2, HNSW_CONFIG.maxElements),
  });

  // Checkpoint resume is only safe with sequential order — non-sequential
  // orders shuffle the stream so rowid is not a reliable resume boundary.
  const canCheckpoint = orderMode === 'sequential';

  const indexPath = DB_PATHS.hnswIndex;
  const usearchPath = indexPath.replace('.idx', '.usearch');
  const checkpointPath = `${usearchPath}.checkpoint`;
  const sidecarPath = `${usearchPath}.checkpoint.json`;
  const sidecar = canCheckpoint ? readCheckpointSidecar(sidecarPath) : null;

  let resumeFromRowId = 0;

  await index.init();

  if (sidecar && existsSync(checkpointPath)) {
    try {
      if (index.index) {
        // Load raw USearch graph from checkpoint
        index.index.load(checkpointPath);
        resumeFromRowId = sidecar.lastRowId || 0;

        // Rebuild JS-side metadata (idMap, reverseMap, metadata, nextKey) for
        // vectors already in the checkpoint. Without this, add() reuses keys
        // from 0 and the final .meta.json would be incomplete.
        const metaStmt = db.prepare(
          'SELECT id, file_path, metadata FROM vectors WHERE rowid <= ? ORDER BY rowid'
        );
        let restoredKey = 0;
        for (const row of metaStmt.iterate(resumeFromRowId)) {
          const meta = row.metadata ? JSON.parse(row.metadata) : {};
          const key = restoredKey++;
          index.idMap.set(row.id, key);
          index.reverseMap.set(key, row.id);
          index.metadata.set(row.id, {
            file: row.file_path,
            name: meta?.symbol,
            type: meta?.chunk_type,
          });
        }
        index.nextKey = restoredKey;

        log(`Resuming from checkpoint: ${sidecar.vectorsAdded} vectors, skipping rowid <= ${resumeFromRowId}`, 'green');
      }
    } catch (err) {
      log(`Checkpoint found but could not load, starting fresh: ${err.message}`, 'yellow');
      resumeFromRowId = 0;
      // Reset any partial metadata restoration
      index.idMap.clear();
      index.reverseMap.clear();
      index.metadata.clear();
      index.nextKey = 0;
    }
  }

  // Discard stale checkpoint from a previous non-sequential build
  if (!canCheckpoint) {
    cleanupCheckpoint(usearchPath);
  }

  log(`Building HNSW index (${modelInfo.dimension}d → ${hnswDim}d Matryoshka, M=${HNSW_CONFIG.M}, order=${orderMode})...`, 'yellow');

  let added = resumeFromRowId > 0 ? (sidecar?.vectorsAdded || 0) : 0;
  let lastCheckpointTime = Date.now();
  let vectorsSinceCheckpoint = 0;

  // try/finally guarantees the DB handle closes and stale checkpoint files
  // get cleaned up even when the build loop throws. Without this, a failed
  // build leaves .checkpoint + .checkpoint.json on disk and the NEXT run
  // silently resumes from an indeterminate state (M5 fix).
  let buildCompleted = false;
  try {
    for (const row of streamVectorsFromDb(db, hnswDim, orderMode)) {
      // Skip already-checkpointed vectors on resume (only valid for sequential order)
      if (resumeFromRowId > 0 && row.rowid <= resumeFromRowId) continue;

      if (!row.embedding || row.embedding.length === 0) continue;

      const truncatedEmbedding = truncateForHNSW(row.embedding);

      await index.add(row.id, truncatedEmbedding, {
        file: row.file,
        name: row.metadata?.symbol,
        type: row.metadata?.chunk_type,
      });

      added++;
      vectorsSinceCheckpoint++;

      // Time-based checkpoint: bounded data loss on crash (~30s max)
      // Only for sequential order where rowid-based resume is valid.
      if (canCheckpoint) {
        const elapsed = (Date.now() - lastCheckpointTime) / 1000;
        if (elapsed >= CHECKPOINT_INTERVAL_SEC && vectorsSinceCheckpoint >= MIN_VECTORS_BETWEEN_SAVES) {
          if (!index.useFallback && index.index) {
            index.index.save(checkpointPath);
            fsyncFile(checkpointPath);
            writeCheckpointSidecar(sidecarPath, {
              vectorsAdded: added,
              lastRowId: row.rowid,
              version: row.rowid,
              timestamp: new Date().toISOString(),
              elapsedMs: Date.now() - lastCheckpointTime,
            });
            fsyncFile(sidecarPath);
            fsyncDirectory(path.dirname(checkpointPath));
            log(`  checkpoint: ${added}/${totalVectors} vectors`, 'dim');
          }
          lastCheckpointTime = Date.now();
          vectorsSinceCheckpoint = 0;
        }
      }

      if (added % 500 === 0 || added === totalVectors) {
        logProgress(added, totalVectors, 'Building HNSW');
      }
    }

    await index.save();
    buildCompleted = true;

    // Clean up checkpoint files after successful completion
    cleanupCheckpoint(usearchPath);

    const stats = index.getStats();
    log(`\n✓ HNSW index built: ${stats.totalVectors} vectors (${hnswDim}d)`, 'green');
    log(`  Using fallback: ${stats.useFallback}`, 'dim');
  } finally {
    try { db.close(); } catch (_err) { /* already closed */ }
    if (!buildCompleted) {
      // Build threw mid-stream. Remove stale checkpoint files so the next
      // run starts from a known-good "no-resume" state rather than
      // resuming against a different/new vector DB.
      cleanupCheckpoint(usearchPath);
    }
  }
}

// =============================================================================
// PHASE 4: LATE INTERACTION INDEX
// =============================================================================

export async function buildLateInteractionIndex(chunks, dryRun = false, filesToRemove = [], options = {}) {
  const {
    poolFactor = 1,
    extendedSkiplist = false,
    loadFromPath = DB_PATHS.lateInteraction,
    saveToPath = loadFromPath,
    finalIndexPath = loadFromPath, // post-swap stub path; drives basename inside stub
    stagingSegmentDir = null,       // where staged segments live on disk (distinct from final)
    fullRebuild = false,
    workerCount = 1,
    threadsPerWorker = 0,
    batchSize = 8,
    batchSizeUpperCap = batchSize * 4,
    tokenBudget = 8_192,
    attentionBudget = null,
    segmentSize = null, // override SSLX-v3 segment threshold (default 10k)
    projectRoot,        // honored by LI skip policy for .sweet-search.config.json excludes
  } = options;
  log('\n━━━ Phase 4: Late Interaction Index (LateOn-Code) ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping late interaction index', 'magenta');
    return;
  }

  // Apply LI skip policy: last-mile guard before the slow encoder runs.
  // The embed indexer has already dropped glob-excluded files at discovery
  // time using the same loadProjectConfig() excludes; this pass adds the
  // LI-specific check globs can't do: content-based @generated markers.
  // Disable via SWEET_SEARCH_LI_SKIP_DISABLE=1.
  let skippedSummary = null;
  if (Array.isArray(chunks) && chunks.length > 0) {
    const { applyIndexingChunkPolicy } = await import('./indexing-file-policy.js');
    const { kept, stats } = applyIndexingChunkPolicy(chunks, { projectRoot });
    if (stats.totalSkipped > 0) {
      const breakdown = [
        stats.excluded > 0 ? `${stats.excluded} excluded` : null,
        stats.generated > 0 ? `${stats.generated} generated` : null,
      ].filter(Boolean).join(', ');
      log(`LI skip policy: dropped ${stats.totalSkipped} chunks across ${stats.skippedFiles} files (${breakdown}); kept ${kept.length} chunks across ${stats.keptFiles} files`, 'dim');
      chunks = kept;
      skippedSummary = stats;
    }
  }

  const hasChunks = Array.isArray(chunks) && chunks.length > 0;
  const hasRemovals = Array.isArray(filesToRemove) && filesToRemove.length > 0;
  if (!hasChunks && !hasRemovals) {
    log('No chunks to index', 'yellow');
    return;
  }

  const { LATE_INTERACTION_CONFIG, EMBEDDING_CONFIG } = await import('../infrastructure/config/index.js');
  if (!LATE_INTERACTION_CONFIG.enabled) {
    log('LateInteraction: Disabled via config', 'yellow');
    return;
  }

  // Default to the product LI quantization, with env vars available for A/B overrides.
  const defaultQuantBits = LATE_INTERACTION_CONFIG.quantization === 'int4' ? 4 : 8;
  const quantBits = parseInt(process.env.SWEET_SEARCH_LI_QUANT_BITS || String(defaultQuantBits), 10);
  const whtSeed = parseInt(process.env.SWEET_SEARCH_LI_WHT_SEED || '0', 10);
  const whtOrdering = process.env.SWEET_SEARCH_LI_WHT_ORDERING || 'natural';

  const liIndex = new LateInteractionIndex({
    tokenDim: LATE_INTERACTION_CONFIG.tokenDimension,
    maxTokens: 512,
    useInt8: quantBits !== 32,
    quantBits,
    whtSeed,
    whtOrdering,
    modelId: LATE_INTERACTION_CONFIG.model,
    indexPath: fullRebuild ? saveToPath : loadFromPath,
    loadExisting: !fullRebuild,
    ...(segmentSize ? { segmentSize } : {}),
  });
  if (quantBits !== defaultQuantBits || whtSeed !== 0) {
    log(`LI config: quantBits=${quantBits}, whtSeed=${whtSeed}, whtOrdering=${whtOrdering}, poolFactor=${poolFactor}`, 'cyan');
  }

  await liIndex.init();

  // Isolate the write target BEFORE any add() calls can flush segments.
  // Without this, _flushSegment() during add() writes into the live
  // .segments directory, corrupting the served index on a failed rebuild.
  //
  // Staging is a two-part operation: (1) the stub file is written to
  // stagedPath = finalPath + '.tmp', and (2) segment files go into a
  // DISTINCT directory (stagingSegmentDir) that does NOT collide with the
  // live {finalPath}.segments directory. The stub's on-disk `segmentDir`
  // field records the post-swap basename (derived from finalIndexPath) so
  // atomic promote only needs to rename the stub + segments directory.
  if (saveToPath !== loadFromPath) {
    liIndex.resetForSave(saveToPath, {
      stagingSegmentDir: stagingSegmentDir || (saveToPath + '-stage.segments'),
      finalIndexPath,
    });
  }

  let removed = 0;
  if (filesToRemove && filesToRemove.length > 0) {
    log(`Removing entries for ${filesToRemove.length} changed/deleted files...`, 'yellow');

    // Chunk IDs are formatted `${file}:${lineStart}-${lineEnd}:${chunkIndex}`.
    // The trailing `:N-N:N` suffix is stripped from the right — NOT with
    // `split(':')[0]`, which on Windows would split on the drive-letter
    // colon (`C:\...`) and lose most of the path (L8 fix).
    const ID_SUFFIX_PATTERN = /:\d+-\d+:\d+$/;
    const fileFromId = (id) => {
      const m = ID_SUFFIX_PATTERN.exec(id);
      return m ? id.slice(0, m.index) : id;
    };

    for (const [id, doc] of liIndex.documents.entries()) {
      const docFile = doc.metadata?.file || fileFromId(id);
      if (filesToRemove.includes(docFile)) {
        liIndex.documents.delete(id);
        removed++;
      }
    }

    log(`  Removed ${removed} existing entries`, 'dim');
  }

  // Dedup partition: aliases whose Jaccard-to-exemplar clears the LI-reuse
  // threshold (default 0.95) skip LI encoding and use the exemplar's
  // per-token matrix via the alias sidecar. Aliases that fall short of that
  // strict threshold — clustered for bi-encoder purposes but not near-exact
  // enough to share per-token vectors — are encoded normally.
  const { DEDUP_CONFIG: _LI_DEDUP_CONFIG } = await import('../infrastructure/index.js');
  const liReuseEnabled = _LI_DEDUP_CONFIG.enabled && _LI_DEDUP_CONFIG.liReuseEnabled;
  let aliasChunks = [];
  let liIneligibleAliases = 0;
  if (liReuseEnabled && Array.isArray(chunks)) {
    const exemplarChunks = [];
    for (const chunk of chunks) {
      if (chunk.metadata?.exemplarId && chunk.metadata?.liReuseEligible) {
        aliasChunks.push(chunk);
      } else {
        exemplarChunks.push(chunk);
        if (chunk.metadata?.exemplarId && !chunk.metadata?.liReuseEligible) {
          liIneligibleAliases++;
        }
      }
    }
    if (aliasChunks.length > 0 || liIneligibleAliases > 0) {
      const extra = liIneligibleAliases > 0
        ? `, ${liIneligibleAliases} below LI reuse τ (encoding normally)`
        : '';
      log(`LateInteraction dedup: encoding ${exemplarChunks.length} exemplars, aliasing ${aliasChunks.length} LI-eligible siblings${extra}`, 'cyan');
      chunks = exemplarChunks;
    }
  }
  const totalChunks = hasChunks ? chunks.length : 0;
  let totalAdded = 0;

  const encodeOpts = {};
  if (poolFactor > 1) encodeOpts.poolFactor = poolFactor;
  if (extendedSkiplist) encodeOpts.extendedSkiplist = true;

  const poolLabel = poolFactor > 1 ? `, pool=${poolFactor}` : '';
  const skipLabel = extendedSkiplist ? ', skiplist=extended' : '';
  if (!hasChunks) {
    log('LateInteraction: No new chunks to encode; applying removals only', 'dim');
  } else {
    const batchLabel = batchSizeUpperCap && batchSizeUpperCap > batchSize
      ? `batch<=${batchSize}→${batchSizeUpperCap}`
      : `batch<=${batchSize}`;
    const attnLabel = (attentionBudget && attentionBudget > 0)
      ? `, attn<=${(attentionBudget / 1_000_000).toFixed(0)}M`
      : '';
    log(`LateInteraction: Encoding ${totalChunks} chunks with ${LATE_INTERACTION_CONFIG.model} (${LATE_INTERACTION_CONFIG.tokenDimension}d${poolLabel}${skipLabel}, ${batchLabel}, tokens<=${tokenBudget}${attnLabel})...`, 'yellow');
    const batches = buildLateInteractionBatches(chunks, {
      batchSize,
      batchSizeUpperCap: batchSizeUpperCap,
      tokenBudget,
      attentionBudget,
      maxLength: LATE_INTERACTION_CONFIG.activeModel?.maxDocLength || 2048,
    });

    // ── Hybrid CPU+GPU dispatch (OPT-IN, experimental) ──
    //
    // Default routes all LI through whichever single encoder is available
    // (native GPU preferred when present, ORT INT8 CPU fallback otherwise).
    //
    // Setting SWEET_SEARCH_LI_HYBRID=1 enables a smart bidirectional dispatcher
    // that runs the GPU and CPU encoders in parallel, with the GPU pulling
    // longest batches from the back of the length-sorted batch list and the
    // CPU pulling shortest from the front. They meet in the middle.
    //
    // This is OPT-IN because in the default pipeline (parallel embedding +
    // LI phases) the GPU device queue is shared, and the embedding phase's
    // continuous Metal command stream effectively starves the LI GPU encoder.
    // Hybrid is only useful when:
    //   - You also disable parallel-models (SWEET_SEARCH_PARALLEL_LI=0), AND
    //   - You bump the libuv pool (SWEET_SEARCH_UV_THREADPOOL_SIZE=64), AND
    //   - Your hardware separates CPU and GPU memory (avoids unified-memory
    //     bandwidth contention). On unified-memory systems, parallel CPU+GPU
    //     inference fights for the same DRAM and the contention overhead
    //     usually erases the parallelism win.
    let liPool = null;
    let useHybrid = false;
    let gpuEncoder = null;
    let cpuEncoder = null;
    let singleEncoder = null;

    // Hybrid dispatcher decision — see `decideHybridDispatcher` above for
    // the full policy. Logs a diagnostic when hybrid was enabled but
    // declined because the Metal queue is contended by parallel embed.
    // This is the common user trap — setting `SWEET_SEARCH_LI_HYBRID=1`
    // alone on default config silently degrades instead of parallelizing
    // (see tests/diagnose-hybrid-hang.js).
    const hybridDecision = decideHybridDispatcher({
      env: process.env,
      parallelLateInteraction: EMBEDDING_CONFIG.parallelLateInteraction === true,
    });
    if (!hybridDecision.armed && hybridDecision.reason === 'metal-contended-by-embed') {
      log(
        'LateInteraction hybrid: ignored — SWEET_SEARCH_LI_HYBRID requires SWEET_SEARCH_PARALLEL_LI=0 '
        + 'OR SWEET_SEARCH_EMBED_USE_CPU=1 (Metal queue is shared with parallel embed phase)',
        'yellow'
      );
    }
    const hybridDisabled = !hybridDecision.armed;

    if (!hybridDisabled) {
      try {
        const { isNativeInferenceAvailable } = await import('../infrastructure/native-inference.js');
        const liModelMod = await import('../ranking/late-interaction-model.js');
        // Probe ORT availability — only attempt if the module exposes both
        // the explicit GPU/CPU encoders and a pipeline loader (the indexer
        // tests mock encodeDocuments only). getLateInteractionPipeline
        // returns null if the ORT model files / onnxruntime-node aren't
        // installed.
        const hasHybridApi = typeof liModelMod.encodeDocumentsGpu === 'function'
          && typeof liModelMod.encodeDocumentsCpu === 'function'
          && typeof liModelMod.getLateInteractionPipeline === 'function';
        if (hasHybridApi && isNativeInferenceAvailable()) {
          const ortPipeline = await liModelMod.getLateInteractionPipeline().catch(() => null);
          if (ortPipeline?.session) {
            useHybrid = true;
            gpuEncoder = (texts) => liModelMod.encodeDocumentsGpu(texts, encodeOpts);
            cpuEncoder = (texts) => liModelMod.encodeDocumentsCpu(texts, encodeOpts);
            log('LateInteraction: hybrid CPU+GPU dispatch enabled (smart routing: long→GPU, short→CPU)', 'dim');
          }
        }
      } catch {
        // hybrid probe failed for any reason — fall through to single-encoder path
      }
    }

    if (!useHybrid) {
      if (workerCount > 1 && threadsPerWorker > 0) {
        try {
          const { LateInteractionPool } = await import('./indexer-pool.js');
          liPool = new LateInteractionPool({
            workers: workerCount,
            threadsPerWorker,
          });
          await liPool.init();
          singleEncoder = (texts) => liPool.encodeDocuments(texts, encodeOpts);
          log(`LateInteraction: using ${workerCount} workers x ${threadsPerWorker} threads`, 'dim');
        } catch (err) {
          log(`LateInteraction pool init failed, falling back to inline: ${err.message}`, 'yellow');
        }
      }
      if (!singleEncoder) {
        const { encodeDocuments } = await import('../ranking/late-interaction-model.js');
        singleEncoder = (texts) => encodeDocuments(texts, encodeOpts);
      }
    }

    // Shared finalizer for one batch's results.
    // Profile: tracks finalize cost (single-threaded JS work inside liIndex.add).
    // Set SWEET_SEARCH_LI_PROFILE=1 to print rolling stats.
    const profile = process.env.SWEET_SEARCH_LI_PROFILE === '1';
    const stats = {
      finalizeMs: 0, finalizeChunks: 0,
      encodeMs: 0, encodeBatches: 0,
      gpuMs: 0, gpuBatches: 0,
      cpuMs: 0, cpuBatches: 0,
      wallStart: Date.now(),
    };
    const printStats = () => {
      if (!profile) return;
      const wall = (Date.now() - stats.wallStart) / 1000;
      const parRatio = wall > 0 ? (stats.encodeMs / 1000 / wall).toFixed(2) : '-';
      const gpuRate = stats.gpuBatches ? (stats.gpuMs / stats.gpuBatches).toFixed(0) : '-';
      const cpuRate = stats.cpuBatches ? (stats.cpuMs / stats.cpuBatches).toFixed(0) : '-';
      log(`[LI prof] wall=${wall.toFixed(0)}s | gpu=${stats.gpuBatches}b avg ${gpuRate}ms | cpu=${stats.cpuBatches}b avg ${cpuRate}ms | parRatio=${parRatio}x (perfect=2.00)`, 'dim');
    };
    const finalizeBatchResults = async (batchItems, tokenArrays) => {
      const t0 = profile ? Date.now() : 0;
      for (let j = 0; j < batchItems.length; j++) {
        const chunk = batchItems[j].chunk;
        const tokens = tokenArrays[j];
        if (tokens && tokens.length > 0) {
          await liIndex.add(chunk.id, tokens, {
            file: chunk.file,
            name: chunk.metadata?.symbol,
            type: chunk.metadata?.chunk_type,
            startLine: chunk.metadata?.line_start || null,
            endLine: chunk.metadata?.line_end || null,
            ...(poolFactor > 1 ? { _pooledUpstream: true } : {}),
          });
          totalAdded++;
        }
      }
      if (profile) {
        stats.finalizeMs += Date.now() - t0;
        stats.finalizeChunks += batchItems.length;
        if (Math.floor((totalAdded - batchItems.length) / 800) !== Math.floor(totalAdded / 800)) printStats();
      }
      logProgress(totalAdded, totalChunks, 'LateInteraction');
    };

    try {
      if (profile) stats.wallStart = Date.now(); // reset to first batch
      if (useHybrid) {
        // ── Smart bidirectional routing ──
        //
        // The bucketer (`buildLateInteractionBatches`) sorts batches ASCENDING
        // by token length, so `batches[0]` has the shortest chunks and
        // `batches[N-1]` the longest. The general-shape per-batch profile is:
        // CPU is competitive or faster on tiny sequences (where GPU kernel-
        // launch overhead dominates), and the GPU pulls ahead substantially
        // on long sequences where attention is compute-bound.
        //
        // Round-robin dispatching is *anti-optimal*: it sends short batches
        // to the slow-on-shorts GPU and long batches to the slow-on-longs CPU.
        // Smart routing has the GPU pull from the END (longest) and the CPU
        // from the BEGINNING (shortest); they meet in the middle. Dynamic
        // self-balancing emerges naturally — if either device finishes faster
        // it starts pulling medium-length batches from the middle.
        //
        // JavaScript is single-threaded, so the `if/decrement` and `if/increment`
        // pairs are atomic between await boundaries — no race on the cursors.
        let front = 0;
        let back = batches.length - 1;
        const runGpu = async () => {
          while (true) {
            if (back < front) break;
            const myIdx = back--;
            const batch = batches[myIdx];
            if (profile && stats.gpuBatches < 3) console.log(`[GPU] CLAIM idx=${myIdx} items=${batch.items.length} maxLen=${Math.max(...batch.items.map(b => b.estTokens))}`);
            const t0 = profile ? Date.now() : 0;
            const tokenArrays = await gpuEncoder(batch.items.map(({ text }) => text));
            if (profile && stats.gpuBatches < 3) console.log(`[GPU] DONE  idx=${myIdx} took=${Date.now()-t0}ms`);
            if (profile) {
              const dt = Date.now() - t0;
              stats.encodeMs += dt; stats.encodeBatches++;
              stats.gpuMs += dt; stats.gpuBatches++;
            }
            await finalizeBatchResults(batch.items, tokenArrays);
          }
        };
        const runCpu = async () => {
          while (true) {
            if (front > back) break;
            const myIdx = front++;
            const batch = batches[myIdx];
            const t0 = profile ? Date.now() : 0;
            const tokenArrays = await cpuEncoder(batch.items.map(({ text }) => text));
            if (profile) {
              const dt = Date.now() - t0;
              stats.encodeMs += dt; stats.encodeBatches++;
              stats.cpuMs += dt; stats.cpuBatches++;
            }
            await finalizeBatchResults(batch.items, tokenArrays);
          }
        };
        await Promise.all([runGpu(), runCpu()]);
      } else {
        const waveSize = liPool ? liPool.numWorkers : 1;
        for (let i = 0; i < batches.length; i += waveSize) {
          const wave = batches.slice(i, i + waveSize);
          const waveResults = await Promise.all(
            wave.map(({ items }) => singleEncoder(items.map(({ text }) => text)))
          );
          for (let waveIdx = 0; waveIdx < wave.length; waveIdx++) {
            await finalizeBatchResults(wave[waveIdx].items, waveResults[waveIdx]);
          }
        }
      }
    } finally {
      if (liPool) await liPool.shutdown();
    }
  }

  // Dedup: register alias pointers. Aliases reuse their exemplar's per-token
  // matrix at MaxSim time, so no encoder work was done for them above.
  if (aliasChunks.length > 0) {
    let registered = 0;
    let orphaned = 0;
    for (const alias of aliasChunks) {
      const exemplarId = alias.metadata?.exemplarId;
      const clusterId = alias.metadata?.clusterId;
      if (!exemplarId || !clusterId) continue;
      if (!liIndex.documents.has(exemplarId)) {
        orphaned++;
        continue;
      }
      liIndex.addAlias(alias.id, exemplarId, clusterId, {
        file: alias.file,
        name: alias.metadata?.symbol,
        type: alias.metadata?.chunk_type,
        startLine: alias.metadata?.line_start || null,
        endLine: alias.metadata?.line_end || null,
      });
      registered++;
    }
    log(`LateInteraction dedup: registered ${registered} alias pointer(s)${orphaned > 0 ? `, ${orphaned} orphaned (exemplar absent)` : ''}`, 'dim');
  }

  // If paths matched (no staging), resetForSave was not called above; set path now.
  if (saveToPath === loadFromPath) {
    liIndex.indexPath = saveToPath;
  }
  await liIndex.save();

  const liStats = liIndex.getStats();
  log(`\n✓ Late interaction index built: ${liStats.documents} docs, ${liStats.totalTokens} tokens (model: ${liStats.modelId})`, 'green');
  log(`  Avg tokens/doc: ${liStats.avgTokensPerDoc}, Dim: ${liStats.tokenDim}d, Size: ${liStats.estimatedSizeMB} MB`, 'dim');

  return { ...liStats, added: totalAdded, removed, saveToPath };
}

// =============================================================================
// PHASE 5: BINARY HNSW + INT8 QUANTIZED ARTIFACTS
// =============================================================================

export async function buildQuantizedArtifactsPhase(dryRun = false, options = {}) {
  log('\n━━━ Phase 5: Binary HNSW + Int8 Artifacts ━━━', 'bright');

  const { changedFiles = 0, force = false } = options;

  if (dryRun) {
    log('DRY RUN: Skipping quantized artifact building', 'magenta');
    return { binaryHnsw: null, int8: null };
  }

  try {
    if (!existsSync(DB_PATHS.codebase)) {
      log('⚠ Skipping quantized artifacts: codebase.db not found', 'yellow');
      return { binaryHnsw: null, int8: null };
    }

    const skipCheck = await shouldSkipArtifactRebuild({ changedFiles, force });

    if (skipCheck.shouldSkip) {
      log(`Skipping binary artifacts (only ${changedFiles} files changed, threshold is ${ARTIFACT_THRESHOLDS.skipThreshold})`, 'yellow');
      log('  Float HNSW will serve search until next rebuild', 'dim');
      log(`  Accumulated changes: ${skipCheck.accumulatedTotal || changedFiles}`, 'dim');

      await updateArtifactState({
        rebuilt: false,
        changedFiles,
        previousState: skipCheck.state,
      });

      return { binaryHnsw: null, int8: null, skipped: true, reason: skipCheck.reason };
    }

    log('Building quantized artifacts from codebase.db...', 'yellow');
    log(`  Reason: ${skipCheck.reason}`, 'dim');
    log('  Binary HNSW: 32x memory reduction, Hamming distance', 'dim');
    log('  Int8 vectors: 4x memory reduction, stored in .int8.json sidecar', 'dim');

    const result = await buildQuantizedArtifacts(DB_PATHS.codebase, {
      hnswIndexPath: DB_PATHS.binaryHnswIndex,
      onProgress: (phase, current, total) => {},
    });

    const int8Count = result.hnsw.int8VectorCount || result.hnsw.totalVectors;
    const int8SizeMB = ((int8Count * (result.hnsw.floatDimension || 512)) / 1024 / 1024).toFixed(2);

    log(`\n✓ Binary HNSW: ${result.hnsw.totalVectors} vectors (${result.hnsw.buildTimeMs}ms, ${result.hnsw.vectorsPerSecond} vec/s)`, 'green');
    log(`✓ Int8 vectors: ${int8Count} vectors (~${int8SizeMB} MB) → ${result.hnsw.int8SidecarPath}`, 'green');

    await updateArtifactState({
      rebuilt: true,
      changedFiles,
      previousState: skipCheck.state,
    });

    return {
      binaryHnsw: result.hnsw,
      int8: {
        count: int8Count,
        sizeMB: int8SizeMB,
        path: result.hnsw.int8SidecarPath,
      },
    };
  } catch (err) {
    log(`⚠ Quantized artifact building failed: ${err.message}`, 'yellow');
    log('  3-stage retrieval will fall back to float HNSW', 'dim');
    return { binaryHnsw: null, int8: null, error: err.message };
  }
}
