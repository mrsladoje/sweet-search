/**
 * Indexer Build - Code graph building, vector schema, vector insertion, pipelined embed+write.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import { DB_PATHS, EMBEDDING_CONFIG, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { GraphExtractor, createGraphSchema, insertGraph, rebuildGraphFts } from '../graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../graph/relationship-resolver.js';
import { populatePageRankColumn } from '../graph/structural-pagerank.js';
import { getEmbeddings, getModelInfo } from '../embedding/embedding-service.js';
import { configureJournalMode, checkpointWal, atomicSwapDatabase, log, logProgress } from './indexer-utils.js';
import { assignStructuralIds } from '../incremental-indexing/domain/chunk-identity.mjs';
import { chunkInputHashes } from '../incremental-indexing/domain/encoder-input.mjs';
import { migrateVectorsSchema } from '../incremental-indexing/infrastructure/schema-migrations.mjs';

// =============================================================================
// CHUNK ENRICHMENT — scope chains + imports from code-graph.db
// =============================================================================

function closeWithOptimize(db, label) {
  try {
    db.pragma('optimize');
  } catch (err) {
    log(`SQLite optimize skipped for ${label}: ${err.message}`, 'dim');
  } finally {
    db.close();
  }
}

/**
 * Enrich chunks with scope chain and import context from the code graph.
 * Queries entities (by file path + line range overlap) and import relationships,
 * then calls ASTChunker.enrichEmbeddingText() to rebuild each chunk's embedding_text.
 *
 * @param {Array} chunks - All chunks from ASTChunker.parseFile()
 * @param {typeof import('../../ast-chunker.js').ASTChunker} ASTChunker - ASTChunker class (for static method)
 * @returns {Promise<number>} Number of chunks enriched
 */
async function enrichChunksFromGraph(chunks, ASTChunker) {
  const Database = (await import('better-sqlite3')).default;
  const { applyReadPragmas } = await import('../infrastructure/db-utils.js');
  const db = new Database(DB_PATHS.codeGraph, { readonly: true });
  applyReadPragmas(db);

  try {
    // Pre-fetch entities and imports grouped by file
    const entityStmt = db.prepare(
      'SELECT type, name, start_line, end_line FROM entities WHERE file_path = ? ORDER BY start_line ASC'
    );
    const importStmt = db.prepare(
      `SELECT DISTINCT target_name FROM relationships
       WHERE source_id = ? AND type IN ('imports', 'plainImport')
       ORDER BY target_name`
    );

    // Cache per-file lookups
    const entityCache = new Map();
    const importCache = new Map();

    let enriched = 0;

    for (const chunk of chunks) {
      const filePath = chunkFilePath(chunk);
      if (!filePath) continue;

      // Only enrich chunks with a known symbol (skip generic 'unknown' text chunks)
      const symbol = chunk.metadata?.symbol;
      if (!symbol || symbol === 'unknown') continue;

      // Get entities for this file (cached)
      if (!entityCache.has(filePath)) {
        entityCache.set(filePath, entityStmt.all(filePath));
      }
      const entities = entityCache.get(filePath);

      // Get imports for this file (cached)
      if (!importCache.has(filePath)) {
        // Replicate GraphExtractor.makeId(filePath, 'file', basename) to get the exact source_id
        const key = `${filePath}:file:${path.basename(filePath)}`;
        const fileEntityId = createHash('sha256').update(key).digest('hex').slice(0, 16);
        const importRows = importStmt.all(fileEntityId);
        importCache.set(filePath, importRows.map(r => r.target_name));
      }
      const imports = importCache.get(filePath);

      // Build scope chain: find entities whose line range contains this chunk
      const chunkStart = chunk.metadata?.line_start || 0;
      const chunkEnd = chunk.metadata?.line_end || chunkStart;
      const scopeChain = [];

      for (const entity of entities) {
        // Entity contains this chunk (or overlaps significantly)
        if (entity.start_line <= chunkStart && entity.end_line >= chunkEnd) {
          scopeChain.push(entity.name);
        }
      }

      // Only enrich if we found scope or import context
      if (scopeChain.length > 0 || imports.length > 0) {
        ASTChunker.enrichEmbeddingText(chunk, scopeChain, imports);
        enriched++;
      }
    }

    return enriched;
  } finally {
    db.close();
  }
}

// =============================================================================
// PHASE 1: CODE GRAPH INDEXING
// =============================================================================

export async function buildCodeGraph(files, dryRun = false) {
  log('\n━━━ Phase 1: Code Graph ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping code graph', 'magenta');
    return { entities: 0, relationships: 0 };
  }

  const GRAPH_BATCH_SIZE = 100;

  log('Building code graph database...', 'yellow');
  await fs.mkdir(path.dirname(DB_PATHS.codeGraph), { recursive: true });

  const tmpPath = DB_PATHS.codeGraph + '.tmp';

  try {
    await fs.unlink(tmpPath);
  } catch (err) {
    // Temp file doesn't exist
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(tmpPath);

  configureJournalMode(db, tmpPath, false);

  const hasFts5 = createGraphSchema(db);

  const extractor = new GraphExtractor();
  let entityBatch = [];
  let relBatch = [];

  let processed = 0;
  let errors = 0;
  let totalEntities = 0;
  let totalRelationships = 0;
  let graphFlushed = false;

  for (let i = 0; i < files.length; i++) {
    try {
      const filePath = path.join(PROJECT_ROOT, files[i]);
      const content = await fs.readFile(filePath, 'utf-8');
      const { entities, relationships } = await extractor.extractFromFile(files[i], content);

      // Element-wise append, not push(...spread): a single generated mega-file
      // (e.g. libsql's 250k-line SQLite amalgamation) can yield 65k+ entities,
      // and spreading that many args into push() overflows the call stack.
      for (let k = 0; k < entities.length; k++) entityBatch.push(entities[k]);
      for (let k = 0; k < relationships.length; k++) relBatch.push(relationships[k]);
      processed++;
    } catch (err) {
      errors++;
    }

    // Flush batch every GRAPH_BATCH_SIZE files or at the end. FTS5 sync is
    // deferred to ONE rebuild after the loop — 'rebuild' reconstructs the
    // whole index from the entities table, so per-batch rebuilds were
    // O(entities × batches) work discarded by the next batch.
    if ((i + 1) % GRAPH_BATCH_SIZE === 0 || i === files.length - 1) {
      if (entityBatch.length > 0 || relBatch.length > 0) {
        insertGraph(db, entityBatch, relBatch, hasFts5, { syncFts: false });
        graphFlushed = true;
        totalEntities += entityBatch.length;
        totalRelationships += relBatch.length;
        entityBatch = [];
        relBatch = [];
      }
    }

    if (processed % 50 === 0 || i === files.length - 1) {
      logProgress(processed, files.length, 'Extracting');
    }
  }

  // Single FTS5 rebuild at the exact point the last per-batch rebuild used to
  // run (before relationship resolution, whose entity updates were never
  // reflected in FTS).
  if (graphFlushed && hasFts5) {
    rebuildGraphFts(db);
  }

  log(`\n✓ Extracted ${totalEntities} entities, ${totalRelationships} relationships`, 'green');
  if (errors > 0) {
    log(`⚠ ${errors} files had errors`, 'yellow');
  }

  log('Resolving relationship targets...', 'yellow');
  const resolutionStats = resolveRelationshipTargets(db);

  log('Computing entity PageRank for structural ranking...', 'yellow');
  try {
    const prStats = populatePageRankColumn(db);
    log(`✓ PageRank populated: ${prStats.written}/${prStats.entities} entities in ${prStats.ms}ms`, 'green');
  } catch (err) {
    log(`⚠ PageRank population failed (non-fatal): ${err.message}`, 'yellow');
  }

  // Update query planner statistics before closing (SQLite 3.46+).
  // Best-effort only; failure should not strand the temp DB handle.
  closeWithOptimize(db, 'code graph build');

  await atomicSwapDatabase(tmpPath, DB_PATHS.codeGraph);

  const stats = await fs.stat(DB_PATHS.codeGraph);
  const dbSize = (stats.size / 1024 / 1024).toFixed(2);
  log(`✓ Code graph saved: ${DB_PATHS.codeGraph} (${dbSize} MB)`, 'green');

  return {
    entities: totalEntities,
    relationships: totalRelationships,
    resolved: resolutionStats.resolved,
    unresolvedTotal: resolutionStats.total - resolutionStats.resolved
  };
}

// =============================================================================
// PHASE 2: VECTOR EMBEDDINGS
// =============================================================================

export function createVectorSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      embedding BLOB NOT NULL,
      text TEXT,
      metadata TEXT,
      session_id TEXT,
      tags TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_session ON vectors(session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_file_path ON vectors(file_path)');
  migrateVectorsSchema(db);
}

export function ensureVectorSchema(db) {
  const columns = db.prepare("PRAGMA table_info(vectors)").all();
  const hasFilePath = columns.some(col => col.name === 'file_path');

  if (!hasFilePath) {
    log('  Migrating schema: adding file_path column...', 'dim');
    db.exec('ALTER TABLE vectors ADD COLUMN file_path TEXT');

    const rows = db.prepare('SELECT id, metadata FROM vectors').all();
    const updateStmt = db.prepare('UPDATE vectors SET file_path = ? WHERE id = ?');

    const migrate = db.transaction(() => {
      for (const row of rows) {
        try {
          const metadata = JSON.parse(row.metadata || '{}');
          if (metadata.file) {
            updateStmt.run(metadata.file, row.id);
          }
        } catch (e) {
          // Skip rows with invalid metadata
        }
      }
    });
    migrate();

    db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_file_path ON vectors(file_path)');
    log('  Schema migration complete', 'dim');
  }
  migrateVectorsSchema(db);
}

export function buildInsertItems(chunks, embeddings, modelInfo, annotations = null, options = {}) {
  const items = [];
  const chunkAnnotations = annotations || annotateChunksForVectorInsert(chunks);
  const epochWritten = Number.isInteger(options.epochWritten) ? options.epochWritten : 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];

    if (!embedding || embedding.length === 0) continue;
    const ann = chunkAnnotations[i];
    const filePath = chunkFilePath(chunk);

    items.push({
      id: chunk.id,
      filePath,
      embeddingBlob: embedding instanceof Float32Array
        ? Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
        : Buffer.from(new Float32Array(embedding).buffer),
      text: (chunk.text || chunk.content || '').slice(0, 2000),
      metadata: JSON.stringify({
        file: filePath,
        type: chunk.metadata?.chunk_type || 'code',
        name: chunk.metadata?.symbol || null,
        startLine: chunk.metadata?.line_start || null,
        endLine: chunk.metadata?.line_end || null,
        language: chunk.metadata?.language || null,
        provider: modelInfo.provider,
        dimension: embedding.length,
        // Dedup metadata (absent when dedup phase didn't run).
        simhash: chunk.metadata?.simhash ?? null,
        clusterId: chunk.metadata?.clusterId ?? null,
        exemplarId: chunk.metadata?.exemplarId ?? null,
        isExemplar: chunk.metadata?.isExemplar ?? null,
      }),
      sessionId: `codebase-v22-${modelInfo.provider}`,
      tags: JSON.stringify(['codebase', chunk.metadata?.language || 'unknown']),
      createdAt: new Date().toISOString(),
      chunkStructId: ann?.chunkStructId || '',
      chunkTextHash: ann?.hashes?.chunk_text_hash || '',
      embeddingInputHash: ann?.hashes?.embedding_input_hash || '',
      liInputHash: ann?.hashes?.li_input_hash || '',
      metadataFingerprint: ann?.hashes?.metadata_fingerprint || '',
      logicalChunkId: ann?.chunkStructId || chunk.id,
      epochWritten,
      epochRetired: null,
    });
  }
  return items;
}

function chunkFilePath(chunk) {
  return firstSafeRelativePath(
    chunk?.metadata?.relative_path,
    chunk?.metadata?.path,
    chunk?.metadata?.file_path,
    chunk?.file,
    chunk?.metadata?.file,
  ) || '';
}

function firstSafeRelativePath(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
    if (!normalized || normalized === '.' || normalized.startsWith('/')) continue;
    if (/^[A-Za-z]:\//.test(normalized)) continue;
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) continue;
    return normalized;
  }
  return null;
}

function annotateChunksForVectorInsert(chunks) {
  const annotations = new Array(chunks.length);
  const byFile = new Map();
  for (let i = 0; i < chunks.length; i++) {
    const filePath = chunkFilePath(chunks[i]);
    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath).push(i);
  }
  for (const [filePath, indices] of byFile.entries()) {
    const fileChunks = indices.map((idx) => chunks[idx]);
    const ids = assignStructuralIds(fileChunks, filePath);
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      annotations[idx] = {
        ...ids[i],
        // Full indexing never persists dedup_fingerprint (only the reconcile
        // delta writer does) — skip that hash.
        hashes: chunkInputHashes(chunks[idx], { includeDedup: false }),
      };
    }
  }
  return annotations;
}

function vectorInsertColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(vectors)').all().map((c) => c.name));
  return [
    'id',
    'file_path',
    'embedding',
    'text',
    'metadata',
    'session_id',
    'tags',
    'created_at',
    'chunk_struct_id',
    'chunk_text_hash',
    'embedding_input_hash',
    'li_input_hash',
    'metadata_fingerprint',
    'logical_chunk_id',
    'epoch_written',
    'epoch_retired',
  ].filter((column) => columns.has(column));
}

function vectorInsertValue(item, column) {
  switch (column) {
    case 'id': return item.id;
    case 'file_path': return item.filePath;
    case 'embedding': return item.embeddingBlob;
    case 'text': return item.text;
    case 'metadata': return item.metadata;
    case 'session_id': return item.sessionId;
    case 'tags': return item.tags;
    case 'created_at': return item.createdAt;
    case 'chunk_struct_id': return item.chunkStructId ?? '';
    case 'chunk_text_hash': return item.chunkTextHash ?? '';
    case 'embedding_input_hash': return item.embeddingInputHash ?? '';
    case 'li_input_hash': return item.liInputHash ?? '';
    case 'metadata_fingerprint': return item.metadataFingerprint ?? '';
    case 'logical_chunk_id': return item.logicalChunkId ?? item.chunkStructId ?? item.id;
    case 'epoch_written': return item.epochWritten ?? 0;
    case 'epoch_retired': return item.epochRetired ?? null;
    default: return item[column];
  }
}

function prepareVectorInsert(db) {
  const columns = vectorInsertColumns(db);
  const quoted = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  return {
    columns,
    stmt: db.prepare(`INSERT OR REPLACE INTO vectors (${quoted}) VALUES (${placeholders})`),
  };
}

/**
 * Insert alias rows that reuse their exemplar's embedding instead of running
 * the embedding model. The exemplar must already be in the `vectors` table;
 * call this AFTER pipelinedEmbedAndInsert has written the exemplar rows.
 * Returns the number of alias rows inserted.
 */
export function insertAliasVectors(db, aliases, modelInfo, options = {}) {
  if (!aliases || aliases.length === 0) return 0;

  const fetchExemplar = db.prepare(
    'SELECT embedding, metadata FROM vectors WHERE id = ?'
  );

  const { stmt, columns } = prepareVectorInsert(db);

  const insertBatch = db.transaction((items) => {
    for (const item of items) {
      stmt.run(...columns.map((column) => vectorInsertValue(item, column)));
    }
  });

  // Orphan guard: purge pre-existing alias rows whose exemplarId no longer
  // resolves to a live vectors row. This happens in incremental re-index
  // when a file containing an exemplar is deleted but alias files in
  // untouched paths still reference it.
  //
  // `skipOrphanPurge` is set by the streaming full-rebuild path, which calls
  // this once per window into a FRESH temp db: there are no pre-existing rows
  // to orphan, and the full-table json_extract scan would otherwise run once
  // per window (O(windows × table)). A from-scratch build can never produce
  // orphans, so skipping it is safe and keeps indexing fast.
  if (!options.skipOrphanPurge) {
    const orphanDelete = db.prepare(`
      DELETE FROM vectors
      WHERE json_extract(metadata, '$.exemplarId') IS NOT NULL
        AND json_extract(metadata, '$.exemplarId') NOT IN (
          SELECT id FROM vectors WHERE json_extract(metadata, '$.exemplarId') IS NULL
        )
    `);
    const orphansRemoved = orphanDelete.run().changes;
    if (orphansRemoved > 0) {
      log(`  ⚠ Purged ${orphansRemoved} orphan alias row(s) (exemplar absent)`, 'yellow');
    }
  }

  const items = [];
  const annotations = annotateChunksForVectorInsert(aliases);
  const nowIso = new Date().toISOString();
  let missing = 0;
  let dimension = null;

  for (let i = 0; i < aliases.length; i++) {
    const alias = aliases[i];
    const exemplarId = alias.metadata?.exemplarId;
    if (!exemplarId) continue;
    const row = fetchExemplar.get(exemplarId);
    if (!row || !row.embedding) {
      missing++;
      continue;
    }
    if (dimension === null) {
      dimension = Math.floor(row.embedding.length / 4);
    }
    const ann = annotations[i];
    const filePath = chunkFilePath(alias);

    items.push({
      id: alias.id,
      filePath,
      embeddingBlob: row.embedding, // copy exemplar's Float32 BLOB verbatim
      text: (alias.text || alias.content || '').slice(0, 2000),
      metadata: JSON.stringify({
        file: filePath,
        type: alias.metadata?.chunk_type || 'code',
        name: alias.metadata?.symbol || null,
        startLine: alias.metadata?.line_start || null,
        endLine: alias.metadata?.line_end || null,
        language: alias.metadata?.language || null,
        provider: modelInfo.provider,
        dimension: dimension ?? 0,
        simhash: alias.metadata?.simhash ?? null,
        clusterId: alias.metadata?.clusterId ?? null,
        exemplarId,
        isExemplar: false,
      }),
      sessionId: `codebase-v22-${modelInfo.provider}`,
      tags: JSON.stringify(['codebase', alias.metadata?.language || 'unknown']),
      createdAt: nowIso,
      chunkStructId: ann?.chunkStructId || '',
      chunkTextHash: ann?.hashes?.chunk_text_hash || '',
      embeddingInputHash: ann?.hashes?.embedding_input_hash || '',
      liInputHash: ann?.hashes?.li_input_hash || '',
      metadataFingerprint: ann?.hashes?.metadata_fingerprint || '',
      logicalChunkId: ann?.chunkStructId || alias.id,
      epochWritten: 0,
      epochRetired: null,
    });
  }

  const BATCH = 2000;
  for (let i = 0; i < items.length; i += BATCH) {
    insertBatch(items.slice(i, i + BATCH));
  }

  if (missing > 0) {
    log(`  ⚠ ${missing} alias(es) referenced exemplar not found in DB — skipped`, 'yellow');
  }

  return items.length;
}

export function insertVectorItems(db, items) {
  const BATCH_INSERT_SIZE = 2000;

  const { stmt, columns } = prepareVectorInsert(db);

  const insertBatch = db.transaction((items) => {
    for (const item of items) {
      stmt.run(...columns.map((column) => vectorInsertValue(item, column)));
    }
  });

  for (let i = 0; i < items.length; i += BATCH_INSERT_SIZE) {
    insertBatch(items.slice(i, i + BATCH_INSERT_SIZE));
  }
}

export function insertVectors(db, chunks, embeddings, modelInfo, annotations = null, options = {}) {
  insertVectorItems(db, buildInsertItems(chunks, embeddings, modelInfo, annotations, options));
}

export async function pipelinedEmbedAndInsert(db, allChunks, texts, batchSize, modelInfo, logProgressFn, embeddingOptions = {}, logFn, writeFlushRows = 128) {
  let writeBuffer = [];
  let embeddingCount = 0;
  const allAnnotations = annotateChunksForVectorInsert(allChunks);

  const { stmt, columns } = prepareVectorInsert(db);

  const insertBatch = db.transaction((items) => {
    for (const item of items) {
      stmt.run(...columns.map((column) => vectorInsertValue(item, column)));
    }
  });

  function flushWriteBuffer() {
    if (writeBuffer.length === 0) return;
    insertBatch(writeBuffer);
    writeBuffer = [];
  }

  // When batchSize == texts.length (local model), the progress callback fires
  // from inside callLocalModelBucketed per internal sub-batch.
  const useInternalProgress = batchSize >= texts.length;
  const progressOptions = useInternalProgress
    ? { ...embeddingOptions, onProgress: (done, total) => logProgressFn(done, total, 'Embedding') }
    : embeddingOptions;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchChunks = allChunks.slice(i, i + batchSize);
    const batchAnnotations = allAnnotations.slice(i, i + batchSize);

    // Overlap: flush accumulated writes while embedding is in-flight
    const batchResultsPromise = getEmbeddings(batch, progressOptions);

    if (writeBuffer.length >= writeFlushRows) {
      flushWriteBuffer();
    }

    const batchResults = await batchResultsPromise;
    const batchEmbeddings = batchResults.map(r => r.embedding);
    embeddingCount += batchEmbeddings.length;

    const batchItems = buildInsertItems(batchChunks, batchEmbeddings, modelInfo, batchAnnotations);
    // NOT `writeBuffer.push(...batchItems)`: for local models batchSize ==
    // texts.length, so batchItems holds the WHOLE corpus in one batch. Spreading
    // 100k+ args into push() overflows the call stack (V8 caps spread args at
    // ~65k-125k) and crashed indexing on large repos (swc ~133k chunks, libsql).
    // Append element-by-element so it stays O(n) and stack-safe at any size.
    for (let k = 0; k < batchItems.length; k++) writeBuffer.push(batchItems[k]);

    if (!useInternalProgress) {
      logProgressFn(Math.min(i + batchSize, texts.length), texts.length, 'Embedding');
    }
  }

  // Flush remaining buffered writes
  flushWriteBuffer();

  return embeddingCount;
}

/**
 * Parse and enrich files into chunks + embedding texts.
 * Extracted so both vector and late interaction encoding can share chunks
 * when running in parallel mode (see PARALLEL_INDEXING_PLAN.md).
 */
export async function chunkFiles(files) {
  const { ASTChunker } = await import('./ast-chunker.js');
  const chunker = new ASTChunker({ projectRoot: PROJECT_ROOT });

  log('Parsing files into chunks...', 'yellow');
  const allChunks = [];
  let processed = 0;

  for (const file of files) {
    try {
      const filePath = path.join(PROJECT_ROOT, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const chunks = await chunker.parseFile(file, content);

      let chunkIndex = 0;
      for (const chunk of chunks) {
        const lineStart = chunk.metadata?.line_start || 0;
        const lineEnd = chunk.metadata?.line_end || lineStart;
        allChunks.push({
          ...chunk,
          file,
          id: `${file}:${lineStart}-${lineEnd}:${chunkIndex}`,
        });
        chunkIndex++;
      }

      processed++;
      if (processed % 50 === 0 || processed === files.length) {
        logProgress(processed, files.length, 'Parsing');
      }
    } catch (err) {
      // Skip files that can't be parsed
    }
  }

  log(`\n✓ Created ${allChunks.length} chunks`, 'green');

  if (existsSync(DB_PATHS.codeGraph) && allChunks.length > 0) {
    try {
      const enriched = await enrichChunksFromGraph(allChunks, ASTChunker);
      if (enriched > 0) {
        log(`✓ Added scope/import context to ${enriched} code chunks`, 'green');
      }
    } catch (err) {
      log(`⚠ Chunk enrichment skipped: ${err.message}`, 'yellow');
    }
  }

  // Embedding-text cap: defaults to 2000 (byte-identical to shipped). The
  // SWEET_SEARCH_EMBED_TEXT_CAP env var (see ast-chunker.js:getEmbedTextCap)
  // is honored by the chunk builders themselves; this final re-slice mirrors
  // the same cap so an ablation can raise the ceiling end-to-end.
  const _embCap = (() => {
    const v = parseInt(process.env.SWEET_SEARCH_EMBED_TEXT_CAP || '', 10);
    return Number.isFinite(v) && v >= 500 ? v : 2000;
  })();
  const texts = allChunks.map(chunk => {
    if (chunk.embedding_text) {
      return chunk.embedding_text.slice(0, _embCap);
    }
    return `${chunkFilePath(chunk)} ${chunk.metadata?.symbol || ''}\n${(chunk.text || chunk.content || '').slice(0, 1500)}`;
  });

  return { allChunks, texts };
}

export async function buildVectorIndex(files, dryRun = false, options = {}) {
  log('\n━━━ Phase 2: Vector Embeddings ━━━', 'bright');

  const { fullRebuild = false, filesToRemove = [], sqliteFastMode = false, preChunked } = options;

  if (dryRun) {
    log('DRY RUN: Skipping vector indexing', 'magenta');
    return { chunks: 0, embeddings: 0 };
  }

  const modelInfo = getModelInfo();
  log(`Using: ${modelInfo.provider} (${modelInfo.model})`, 'cyan');
  log(`Dimensions: ${modelInfo.dimension}d full → ${modelInfo.hnswDimension}d HNSW`, 'dim');

  let allChunks, texts;
  if (preChunked) {
    allChunks = preChunked.allChunks;
    texts = preChunked.texts;
    log(`Using ${allChunks.length} pre-chunked items`, 'dim');
  } else {
    ({ allChunks, texts } = await chunkFiles(files));
  }

  // Dedup: if chunks were annotated by runDedupPhase, embed only exemplars;
  // aliases get their exemplar's embedding copied after the main embed pass.
  let embedChunks = allChunks;
  let embedTexts = texts;
  let aliasChunks = [];
  const hasDedupAnnotations = allChunks.some(c => c.metadata && c.metadata.exemplarId !== undefined);
  if (hasDedupAnnotations) {
    const partExemplars = [];
    const partExemplarTexts = [];
    const partAliases = [];
    for (let i = 0; i < allChunks.length; i++) {
      if (allChunks[i].metadata?.exemplarId) {
        partAliases.push(allChunks[i]);
      } else {
        partExemplars.push(allChunks[i]);
        partExemplarTexts.push(texts[i]);
      }
    }
    if (partAliases.length > 0) {
      log(
        `Dedup: embedding ${partExemplars.length} exemplars, copying vectors for ${partAliases.length} aliases`,
        'dim',
      );
      embedChunks = partExemplars;
      embedTexts = partExemplarTexts;
      aliasChunks = partAliases;
    }
  }

  log('Generating embeddings...', 'yellow');

  // For local models, send all texts in one call so callLocalModelBucketed can
  // globally sort by length and build maximally uniform batches.  Padding waste
  // from mixed-length batches is the #1 bottleneck (measured: 5.5x slower than
  // uniform batches).  Remote APIs still use small batches for rate-limiting.
  const isLocal = modelInfo.provider === 'local';
  const batchSize = isLocal ? embedTexts.length : EMBEDDING_CONFIG.indexerBatchSize;
  const writeFlushRows = EMBEDDING_CONFIG.indexerWriteFlushRows;
  const embeddingOptions = { useCache: false };
  let effectiveEmbeddingDimension = modelInfo.dimension;

  log(`Indexer: batchSize=${isLocal ? 'all(' + embedTexts.length + ')' : batchSize}, writeFlushRows=${writeFlushRows}`, 'dim');

  if (modelInfo.isRemote) {
    const configuredOutputDim = parseInt(
      process.env.SWEET_SEARCH_INDEXING_OUTPUT_DIMENSION || `${modelInfo.hnswDimension}`,
      10
    );
    if (
      Number.isFinite(configuredOutputDim) &&
      configuredOutputDim > 0 &&
      configuredOutputDim <= modelInfo.dimension
    ) {
      embeddingOptions.providerOptions = {
        outputDimension: configuredOutputDim,
        inputType: 'document',
        concurrency: parseInt(process.env.SWEET_SEARCH_EMBEDDING_CONCURRENCY || '4', 10),
      };
      effectiveEmbeddingDimension = configuredOutputDim;
      log(`Server-side embedding dimension: ${modelInfo.dimension}d → ${configuredOutputDim}d`, 'dim');
    }
  }

  await fs.mkdir(path.dirname(DB_PATHS.codebase), { recursive: true });
  const Database = (await import('better-sqlite3')).default;

  let embeddingCount;

  if (fullRebuild) {
    log('Full rebuild: Creating new database...', 'yellow');

    const tmpPath = DB_PATHS.codebase + '.tmp';

    try {
      await fs.unlink(tmpPath);
    } catch (err) {
      // Temp file doesn't exist
    }

    const db = new Database(tmpPath);

    const journalMode = configureJournalMode(db, tmpPath, sqliteFastMode);
    if (sqliteFastMode) log('SQLite fast-build mode enabled (benchmarking only)', 'yellow');
    else if (journalMode === 'WAL') log('SQLite WAL mode enabled', 'dim');

    createVectorSchema(db);

    embeddingCount = await pipelinedEmbedAndInsert(db, embedChunks, embedTexts, batchSize, modelInfo, logProgress, embeddingOptions, log, writeFlushRows);
    if (aliasChunks.length > 0) {
      const aliasInserted = insertAliasVectors(db, aliasChunks, modelInfo);
      log(`  ✓ Inserted ${aliasInserted} alias vector(s) (embeddings copied from exemplars)`, 'dim');
    }

    // Flush WAL before closing — ensures all inserts are durable in the main DB file
    checkpointWal(db);
    closeWithOptimize(db, 'vector full rebuild');

    log(`\n✓ Generated ${embeddingCount} embeddings (${effectiveEmbeddingDimension}d)`, 'green');

    await atomicSwapDatabase(tmpPath, DB_PATHS.codebase);

    const vectorStats = await fs.stat(DB_PATHS.codebase);
    const dbSize = (vectorStats.size / 1024 / 1024).toFixed(2);
    log(`✓ Saved codebase.db (${dbSize} MB, ${allChunks.length} vectors)`, 'green');

  } else {
    log('Incremental update: Updating existing database...', 'yellow');

    let db;
    let previousCount = 0;

    if (existsSync(DB_PATHS.codebase)) {
      db = new Database(DB_PATHS.codebase);
      const journalModeIncr = configureJournalMode(db, DB_PATHS.codebase, sqliteFastMode);
      if (sqliteFastMode) log('SQLite fast-build mode enabled (benchmarking only)', 'yellow');
      else if (journalModeIncr === 'WAL') log('SQLite WAL mode enabled', 'dim');

      ensureVectorSchema(db);

      previousCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get().count;

      const allFilesToRemove = [...new Set([...files, ...filesToRemove])];
      if (allFilesToRemove.length > 0) {
        log(`Removing vectors for ${allFilesToRemove.length} files...`, 'yellow');

        const deleteByFile = db.prepare('DELETE FROM vectors WHERE file_path = ?');
        const deleteMany = db.transaction((filePaths) => {
          let removed = 0;
          for (const filePath of filePaths) {
            const result = deleteByFile.run(filePath);
            removed += result.changes;
          }
          return removed;
        });

        const removed = deleteMany(allFilesToRemove);
        log(`  Removed ${removed} old vectors`, 'dim');
      }
    } else {
      log('No existing database, creating new...', 'yellow');
      db = new Database(DB_PATHS.codebase);
      const journalModeNew = configureJournalMode(db, DB_PATHS.codebase, sqliteFastMode);
      if (sqliteFastMode) log('SQLite fast-build mode enabled (benchmarking only)', 'yellow');
      else if (journalModeNew === 'WAL') log('SQLite WAL mode enabled', 'dim');
      createVectorSchema(db);
    }

    embeddingCount = await pipelinedEmbedAndInsert(db, embedChunks, embedTexts, batchSize, modelInfo, logProgress, embeddingOptions, log, writeFlushRows);
    if (aliasChunks.length > 0) {
      const aliasInserted = insertAliasVectors(db, aliasChunks, modelInfo);
      log(`  ✓ Inserted ${aliasInserted} alias vector(s) (embeddings copied from exemplars)`, 'dim');
    }

    // Flush WAL before downstream reads (HNSW build streams from this DB)
    checkpointWal(db);

    log(`\n✓ Generated ${embeddingCount} embeddings (${effectiveEmbeddingDimension}d)`, 'green');

    const newCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get().count;

    closeWithOptimize(db, 'vector incremental update');

    const vectorStats = await fs.stat(DB_PATHS.codebase);
    const dbSize = (vectorStats.size / 1024 / 1024).toFixed(2);
    log(`✓ Updated codebase.db (${dbSize} MB, ${newCount} vectors)`, 'green');
    log(`  Previous: ${previousCount}, Added: ${allChunks.length}, Current: ${newCount}`, 'dim');
  }

  return { chunks: allChunks.length, embeddings: embeddingCount };
}
