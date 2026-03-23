/**
 * Indexer Build - Code graph building, vector schema, vector insertion, pipelined embed+write.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import { DB_PATHS, EMBEDDING_CONFIG, PROJECT_ROOT } from './config.js';
import { GraphExtractor, createGraphSchema, insertGraph } from './graph-extractor.js';
import { resolveRelationshipTargets } from './relationship-resolver.js';
import { getEmbeddings, getModelInfo } from './embedding-service.js';
import { configureJournalMode, atomicSwapDatabase, log, logProgress } from './indexer-utils.js';

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
 * @param {typeof import('../ast-chunker.js').ASTChunker} ASTChunker - ASTChunker class (for static method)
 * @returns {Promise<number>} Number of chunks enriched
 */
async function enrichChunksFromGraph(chunks, ASTChunker) {
  const Database = (await import('better-sqlite3')).default;
  const { applyReadPragmas } = await import('./db-utils.js');
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
      const filePath = chunk.file || chunk.metadata?.path;
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

  const extractor = new GraphExtractor();
  const allEntities = [];
  const allRelationships = [];

  let processed = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const filePath = path.join(PROJECT_ROOT, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const { entities, relationships } = await extractor.extractFromFile(file, content);

      allEntities.push(...entities);
      allRelationships.push(...relationships);
      processed++;

      if (processed % 50 === 0 || processed === files.length) {
        logProgress(processed, files.length, 'Extracting');
      }
    } catch (err) {
      errors++;
    }
  }

  log(`\n✓ Extracted ${allEntities.length} entities, ${allRelationships.length} relationships`, 'green');
  if (errors > 0) {
    log(`⚠ ${errors} files had errors`, 'yellow');
  }

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
  insertGraph(db, allEntities, allRelationships, hasFts5);

  log('Resolving relationship targets...', 'yellow');
  const resolutionStats = resolveRelationshipTargets(db);

  // Update query planner statistics before closing (SQLite 3.46+).
  // Best-effort only; failure should not strand the temp DB handle.
  closeWithOptimize(db, 'code graph build');

  await atomicSwapDatabase(tmpPath, DB_PATHS.codeGraph);

  const stats = await fs.stat(DB_PATHS.codeGraph);
  const dbSize = (stats.size / 1024 / 1024).toFixed(2);
  log(`✓ Code graph saved: ${DB_PATHS.codeGraph} (${dbSize} MB)`, 'green');

  return {
    entities: allEntities.length,
    relationships: allRelationships.length,
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
}

export function buildInsertItems(chunks, embeddings, modelInfo) {
  const items = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];

    if (!embedding || embedding.length === 0) continue;

    items.push({
      id: chunk.id,
      filePath: chunk.file,
      embeddingBlob: embedding instanceof Float32Array
        ? Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
        : Buffer.from(new Float32Array(embedding).buffer),
      text: (chunk.text || chunk.content || '').slice(0, 2000),
      metadata: JSON.stringify({
        file: chunk.file,
        type: chunk.metadata?.chunk_type || 'code',
        name: chunk.metadata?.symbol || null,
        startLine: chunk.metadata?.line_start || null,
        endLine: chunk.metadata?.line_end || null,
        language: chunk.metadata?.language || null,
        provider: modelInfo.provider,
        dimension: embedding.length,
      }),
      sessionId: `codebase-v22-${modelInfo.provider}`,
      tags: JSON.stringify(['codebase', chunk.metadata?.language || 'unknown']),
      createdAt: new Date().toISOString(),
    });
  }
  return items;
}

export function insertVectors(db, chunks, embeddings, modelInfo) {
  const BATCH_INSERT_SIZE = 2000;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vectors (id, file_path, embedding, text, metadata, session_id, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBatch = db.transaction((items) => {
    for (const item of items) {
      stmt.run(
        item.id,
        item.filePath,
        item.embeddingBlob,
        item.text,
        item.metadata,
        item.sessionId,
        item.tags,
        item.createdAt
      );
    }
  });

  const items = buildInsertItems(chunks, embeddings, modelInfo);

  for (let i = 0; i < items.length; i += BATCH_INSERT_SIZE) {
    insertBatch(items.slice(i, i + BATCH_INSERT_SIZE));
  }
}

export async function pipelinedEmbedAndInsert(db, allChunks, texts, batchSize, modelInfo, logProgressFn, embeddingOptions = {}, logFn, writeFlushRows = 128) {
  const embeddings = [];
  let writeBuffer = [];

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vectors (id, file_path, embedding, text, metadata, session_id, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBatch = db.transaction((items) => {
    for (const item of items) {
      stmt.run(item.id, item.filePath, item.embeddingBlob, item.text, item.metadata, item.sessionId, item.tags, item.createdAt);
    }
  });

  function flushWriteBuffer() {
    if (writeBuffer.length === 0) return;
    insertBatch(writeBuffer);
    writeBuffer = [];
  }

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchChunks = allChunks.slice(i, i + batchSize);

    // Overlap: flush accumulated writes while embedding is in-flight
    const batchResultsPromise = getEmbeddings(batch, embeddingOptions);

    if (writeBuffer.length >= writeFlushRows) {
      flushWriteBuffer();
    }

    const batchResults = await batchResultsPromise;
    const batchEmbeddings = batchResults.map(r => r.embedding);
    embeddings.push(...batchEmbeddings);

    const batchItems = buildInsertItems(batchChunks, batchEmbeddings, modelInfo);
    writeBuffer.push(...batchItems);

    logProgressFn(Math.min(i + batchSize, texts.length), texts.length, 'Embedding');
  }

  // Flush remaining buffered writes
  flushWriteBuffer();

  return embeddings;
}

/**
 * Parse and enrich files into chunks + embedding texts.
 * Extracted so both vector and late interaction encoding can share chunks
 * when running in parallel mode (see PARALLEL_INDEXING_PLAN.md).
 */
export async function chunkFiles(files) {
  const { ASTChunker } = await import('../ast-chunker.js');
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
        log(`✓ Enriched ${enriched}/${allChunks.length} chunks with scope/import context`, 'green');
      }
    } catch (err) {
      log(`⚠ Chunk enrichment skipped: ${err.message}`, 'yellow');
    }
  }

  const texts = allChunks.map(chunk => {
    if (chunk.embedding_text) {
      return chunk.embedding_text.slice(0, 2000);
    }
    return `${chunk.file} ${chunk.metadata?.symbol || ''}\n${(chunk.text || chunk.content || '').slice(0, 1500)}`;
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

  log('Generating embeddings...', 'yellow');

  const batchSize = EMBEDDING_CONFIG.indexerBatchSize;
  const writeFlushRows = EMBEDDING_CONFIG.indexerWriteFlushRows;
  const embeddingOptions = { useCache: false };
  let effectiveEmbeddingDimension = modelInfo.dimension;

  log(`Indexer: batchSize=${batchSize}, writeFlushRows=${writeFlushRows}`, 'dim');

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

  let embeddings;

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

    embeddings = await pipelinedEmbedAndInsert(db, allChunks, texts, batchSize, modelInfo, logProgress, embeddingOptions, log, writeFlushRows);

    closeWithOptimize(db, 'vector full rebuild');

    log(`\n✓ Generated ${embeddings.length} embeddings (${effectiveEmbeddingDimension}d)`, 'green');

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

    embeddings = await pipelinedEmbedAndInsert(db, allChunks, texts, batchSize, modelInfo, logProgress, embeddingOptions, log, writeFlushRows);

    log(`\n✓ Generated ${embeddings.length} embeddings (${effectiveEmbeddingDimension}d)`, 'green');

    const newCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get().count;

    closeWithOptimize(db, 'vector incremental update');

    const vectorStats = await fs.stat(DB_PATHS.codebase);
    const dbSize = (vectorStats.size / 1024 / 1024).toFixed(2);
    log(`✓ Updated codebase.db (${dbSize} MB, ${newCount} vectors)`, 'green');
    log(`  Previous: ${previousCount}, Added: ${allChunks.length}, Current: ${newCount}`, 'dim');
  }

  return { chunks: allChunks.length, embeddings: embeddings.length, allChunks, allEmbeddings: embeddings };
}
