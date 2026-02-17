/**
 * Indexer Build - Code graph building, vector schema, vector insertion, pipelined embed+write.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import { DB_PATHS, EMBEDDING_CONFIG, PROJECT_ROOT } from './config.js';
import { GraphExtractor, createGraphSchema, insertGraph } from './graph-extractor.js';
import { resolveRelationshipTargets } from './relationship-resolver.js';
import { getEmbeddings, getModelInfo } from './embedding-service.js';
import { configureJournalMode, atomicSwapDatabase, log, logProgress } from './indexer-utils.js';

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

  db.close();

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

export async function pipelinedEmbedAndInsert(db, allChunks, texts, batchSize, modelInfo, logProgressFn, embeddingOptions = {}, logFn) {
  const BATCH_INSERT_SIZE = 2000;
  const embeddings = [];
  let prevBatchItems = null;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vectors (id, file_path, embedding, text, metadata, session_id, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBatch = db.transaction((items) => {
    for (const item of items) {
      stmt.run(item.id, item.filePath, item.embeddingBlob, item.text, item.metadata, item.sessionId, item.tags, item.createdAt);
    }
  });

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchChunks = allChunks.slice(i, i + batchSize);

    const batchResultsPromise = getEmbeddings(batch, embeddingOptions);

    if (prevBatchItems && prevBatchItems.length > 0) {
      for (let j = 0; j < prevBatchItems.length; j += BATCH_INSERT_SIZE) {
        insertBatch(prevBatchItems.slice(j, j + BATCH_INSERT_SIZE));
      }
    }

    const batchResults = await batchResultsPromise;
    const batchEmbeddings = batchResults.map(r => r.embedding);
    embeddings.push(...batchEmbeddings);

    prevBatchItems = buildInsertItems(batchChunks, batchEmbeddings, modelInfo);

    if ((i + batchSize) % 100 === 0 || i + batchSize >= texts.length) {
      logProgressFn(Math.min(i + batchSize, texts.length), texts.length, 'Embedding');
    }
  }

  if (prevBatchItems && prevBatchItems.length > 0) {
    for (let j = 0; j < prevBatchItems.length; j += BATCH_INSERT_SIZE) {
      insertBatch(prevBatchItems.slice(j, j + BATCH_INSERT_SIZE));
    }
  }

  return embeddings;
}

export async function buildVectorIndex(files, dryRun = false, options = {}) {
  log('\n━━━ Phase 2: Vector Embeddings ━━━', 'bright');

  const { fullRebuild = false, filesToRemove = [], sqliteFastMode = false } = options;

  if (dryRun) {
    log('DRY RUN: Skipping vector indexing', 'magenta');
    return { chunks: 0, embeddings: 0 };
  }

  const modelInfo = getModelInfo();
  log(`Using: ${modelInfo.provider} (${modelInfo.model})`, 'cyan');
  log(`Dimensions: ${modelInfo.dimension}d full → ${modelInfo.hnswDimension}d HNSW`, 'dim');

  const { ASTChunker } = await import('../ast-chunker.js');
  const chunker = new ASTChunker();

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

  log('Generating embeddings...', 'yellow');

  const texts = allChunks.map(chunk => {
    // Use contextualized embedding_text when available (from AST chunker)
    if (chunk.embedding_text) {
      return chunk.embedding_text.slice(0, 2000);
    }
    // Fallback for chunks without embedding_text
    const text = `${chunk.file} ${chunk.metadata?.symbol || ''}\n${(chunk.text || chunk.content || '').slice(0, 1500)}`;
    return text;
  });

  const batchSize = EMBEDDING_CONFIG.batchSize;
  const embeddingOptions = { useCache: false };
  let effectiveEmbeddingDimension = modelInfo.dimension;

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

    embeddings = await pipelinedEmbedAndInsert(db, allChunks, texts, batchSize, modelInfo, logProgress, embeddingOptions, log);

    db.close();

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

    embeddings = await pipelinedEmbedAndInsert(db, allChunks, texts, batchSize, modelInfo, logProgress, embeddingOptions, log);

    log(`\n✓ Generated ${embeddings.length} embeddings (${effectiveEmbeddingDimension}d)`, 'green');

    const newCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get().count;

    db.close();

    const vectorStats = await fs.stat(DB_PATHS.codebase);
    const dbSize = (vectorStats.size / 1024 / 1024).toFixed(2);
    log(`✓ Updated codebase.db (${dbSize} MB, ${newCount} vectors)`, 'green');
    log(`  Previous: ${previousCount}, Added: ${allChunks.length}, Current: ${newCount}`, 'dim');
  }

  return { chunks: allChunks.length, embeddings: embeddings.length, allChunks, allEmbeddings: embeddings };
}
