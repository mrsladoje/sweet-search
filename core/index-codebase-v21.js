#!/usr/bin/env node

/**
 * Codebase Indexer v2.3
 *
 * Full indexing pipeline for Sweet Search:
 * 1. Code Graph: Extract entities and relationships, build FTS5 index
 * 2. Vector Embeddings: Generate embeddings with transformers.js
 * 3. HNSW Index: Build in-memory ANN index for fast semantic search
 *
 * Incremental Mode (default - RECOMMENDED):
 * - Code graph: ALWAYS full rebuild (relationships span files) - ensures GraphRAG accuracy
 * - Summaries: Auto-regenerated for changed files (uses Cerebras GLM-4.6 for speed)
 * - Vectors: Only changed files reindexed
 * - HNSW: Rebuilt from changed files
 *
 * GraphRAG Guarantee:
 * Code graph is ALWAYS fully rebuilt to ensure structural queries work correctly.
 * "what calls X", "implementations of Y", "impact of changing Z" all rely on this.
 *
 * Usage:
 *   node index-codebase-v21.js                  # Incremental (default)
 *   node index-codebase-v21.js --full           # Full reindex
 *   node index-codebase-v21.js --graph-only     # Only code graph
 *   node index-codebase-v21.js --vectors-only   # Only vectors + HNSW
 *   node index-codebase-v21.js --dry-run        # Preview only
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import fg from 'fast-glob';

import { DB_PATHS, FILE_PATTERNS, EMBEDDING_CONFIG, HNSW_CONFIG, PROJECT_ROOT, setQuietMode as setGlobalQuietMode, isQuietMode as isGlobalQuietMode } from './config.js';
import { GraphExtractor, createGraphSchema, insertGraph } from './graph-extractor.js';
import { resolveRelationshipTargets } from './relationship-resolver.js';
import { HNSWIndex } from './hnsw-index.js';
import { ColBERTIndex } from './colbert-index.js';
import { getChangedFiles, updateState, getStats as getIncrementalStats } from './incremental-tracker.js';
import { getEmbeddings, truncateForHNSW, warmup as warmupEmbeddings, getModelInfo } from './embedding-service.js';
import { backupSummaries, restoreSummaries, markForRegeneration } from './summary-manager.js';
import { buildFromCodebaseDb as buildQuantizedArtifacts, getArtifactStats, shouldSkipArtifactRebuild, updateArtifactState, ARTIFACT_THRESHOLDS } from './artifact-builder.js';

const glob = fg.glob || fg;

// =============================================================================
// COLORS AND LOGGING (quiet-mode aware)
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Global quiet mode flag (set during arg parsing in main())
let quietMode = false;

// =============================================================================
// ATOMIC DATABASE SWAP (Windows/WSL EBUSY Handling)
// =============================================================================

/**
 * Atomically swap a temporary database file to its final location.
 * Handles Windows/WSL EBUSY errors with retry logic.
 *
 * Pattern:
 * 1. Rename existing -> .bak (if exists)
 * 2. Rename temp -> final
 * 3. Delete .bak on success
 * 4. Restore .bak on failure
 *
 * @param {string} tmpPath - Path to the temporary database file
 * @param {string} finalPath - Path to the final database location
 * @returns {Promise<boolean>} - True if swap succeeded
 * @throws {Error} - If swap fails after all retries
 */
async function atomicSwapDatabase(tmpPath, finalPath) {
  const bakPath = finalPath + '.bak';
  const MAX_RETRIES = 5;
  const RETRY_DELAY = 500;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Remove stale backup if exists (from previous failed run)
      try {
        await fs.unlink(bakPath);
      } catch (err) {
        // No stale backup, that's fine
      }

      // Backup existing if present
      let hadOriginal = false;
      if (existsSync(finalPath)) {
        await fs.rename(finalPath, bakPath);
        hadOriginal = true;
      }

      // Swap in new
      await fs.rename(tmpPath, finalPath);

      // Clean up backup on success
      if (hadOriginal) {
        try {
          await fs.unlink(bakPath);
        } catch (err) {
          // E2 FIX: Log backup cleanup errors (except ENOENT - file already removed)
          if (err.code !== 'ENOENT') {
            logError(`WARN: Failed to clean up backup ${bakPath}: ${err.message}`);
          }
        }
      }

      return true;
    } catch (err) {
      if (err.code === 'EBUSY' && attempt < MAX_RETRIES - 1) {
        logError(`Database busy, retry ${attempt + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
        continue;
      }

      // Restore backup on failure if we had one
      if (existsSync(bakPath) && !existsSync(finalPath)) {
        try {
          await fs.rename(bakPath, finalPath);
          log(`⚠ Swap failed, restored from backup: ${err.message}`, 'yellow');
        } catch (restoreErr) {
          logError(`CRITICAL: Swap failed AND restore failed: ${restoreErr.message}`);
        }
      }
      throw err;
    }
  }
  return false;
}

/**
 * Set quiet mode - suppresses progress bars and non-essential logs.
 * Essential for daemon operation to prevent multi-MB stdout/stderr buffers.
 * Also sets the global config quiet mode for downstream modules (e.g., LOGGING.timing).
 */
function setQuietMode(enabled) {
  quietMode = enabled;
  setGlobalQuietMode(enabled);
}

/**
 * Check if quiet mode is enabled.
 */
function isQuietMode() {
  return quietMode;
}

function log(message, color = 'reset') {
  if (quietMode) return;
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logProgress(current, total, label) {
  if (quietMode) return;
  const percent = ((current / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.floor(current / total * 30));
  const empty = '░'.repeat(30 - bar.length);
  process.stdout.write(`\r${colors.cyan}${label}: [${bar}${empty}] ${percent}% (${current}/${total})${colors.reset}`);
  if (current === total) {
    process.stdout.write('\n');
  }
}

/**
 * Log error/warning messages even in quiet mode (for daemon safety).
 * These go to stderr to avoid polluting structured output.
 */
function logError(message) {
  console.error(`[indexer] ${message}`);
}

// =============================================================================
// STDIN FILE LIST READING (for --files-from-stdin)
// =============================================================================

/**
 * WSL UNC path pattern: //wsl.localhost/<distro>/... or //wsl$/<distro>/...
 * Examples:
 *   //wsl.localhost/Ubuntu-24.04/home/user/project/file.js -> /home/user/project/file.js
 *   //wsl$/Ubuntu/home/user/project/file.js -> /home/user/project/file.js
 */
const WSL_UNC_PATTERN = /^\/\/wsl(?:\.localhost|\$)\/[^/]+/;

/**
 * Strip WSL UNC prefix from path, returning the underlying Linux path.
 * Also handles backslash-style UNC paths (\\wsl.localhost\...).
 * @param {string} filePath - Path that may have WSL UNC prefix
 * @returns {string} - Linux path without WSL UNC prefix
 */
function stripWslUncPrefix(filePath) {
  if (!filePath) return filePath;

  // First convert backslashes to forward slashes for consistent matching
  let normalized = filePath.replace(/\\/g, '/');

  // Match //wsl.localhost/<distro> or //wsl$/<distro>
  const match = normalized.match(WSL_UNC_PATTERN);
  if (match) {
    // Return everything after the //wsl.localhost/<distro> prefix
    return normalized.slice(match[0].length);
  }

  return filePath;
}

/**
 * Read file paths from stdin (newline-delimited).
 * Used by index-maintainer daemon for targeted incremental indexing.
 *
 * Validates and normalizes paths:
 * - Strips WSL UNC prefixes (//wsl.localhost/<distro>/... -> /...)
 * - Converts absolute paths to repo-relative
 * - Filters out paths outside the project
 * - Removes empty lines and duplicates
 *
 * @returns {Promise<string[]>} Array of repo-relative file paths
 */
async function readFilesFromStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    const timeout = setTimeout(() => {
      // If stdin is a TTY and no data after 100ms, assume no input
      if (process.stdin.isTTY) {
        resolve([]);
      }
    }, 100);

    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (chunk) => {
      clearTimeout(timeout);
      data += chunk;
    });

    process.stdin.on('end', () => {
      clearTimeout(timeout);

      const lines = data
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      // Normalize and validate paths
      const validPaths = [];
      const seenPaths = new Set();

      for (let line of lines) {
        // Step 1: Strip WSL UNC prefix if present
        // //wsl.localhost/Ubuntu-24.04/home/user/project -> /home/user/project
        line = stripWslUncPrefix(line);

        let normalizedPath = line;

        // Step 2: Convert absolute paths to repo-relative
        if (path.isAbsolute(line)) {
          if (line.startsWith(PROJECT_ROOT)) {
            normalizedPath = path.relative(PROJECT_ROOT, line);
          } else {
            // Path is outside project, skip it
            if (!quietMode) {
              logError(`Skipping path outside project: ${line}`);
            }
            continue;
          }
        }

        // Remove leading ./ if present
        if (normalizedPath.startsWith('./')) {
          normalizedPath = normalizedPath.slice(2);
        }

        // Skip duplicates
        if (seenPaths.has(normalizedPath)) {
          continue;
        }
        seenPaths.add(normalizedPath);

        validPaths.push(normalizedPath);
      }

      resolve(validPaths);
    });

    process.stdin.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // If stdin is a pipe, it will emit 'end' when done
    // If it's a TTY, we handle it with the timeout above
    if (process.stdin.isTTY) {
      // No piped input, resolve empty
      clearTimeout(timeout);
      resolve([]);
    }
  });
}

// =============================================================================
// FILE DISCOVERY
// =============================================================================

async function discoverFiles() {
  log('\n━━━ Discovering Files ━━━', 'bright');

  const files = await glob(FILE_PATTERNS.include, {
    ignore: FILE_PATTERNS.exclude,
    cwd: PROJECT_ROOT,
    absolute: false,
    onlyFiles: true,
  });

  log(`✓ Found ${files.length} files to index`, 'green');

  // Group by type
  const byType = {};
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || '.other';
    byType[ext] = (byType[ext] || 0) + 1;
  }

  log('  File types: ' + Object.entries(byType).map(([ext, count]) => `${ext}(${count})`).join(', '), 'dim');

  return files;
}

// =============================================================================
// PHASE 1: CODE GRAPH INDEXING
// =============================================================================

async function buildCodeGraph(files, dryRun = false) {
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

  // Create and populate database using better-sqlite3 (native FTS5 trigram support)
  log('Building code graph database...', 'yellow');

  await fs.mkdir(path.dirname(DB_PATHS.codeGraph), { recursive: true });

  // ATOMIC REBUILD: Build to temp file first, then swap
  // This ensures if the process crashes mid-build, the original database remains intact
  const tmpPath = DB_PATHS.codeGraph + '.tmp';

  // Remove temp file if exists (from previous failed run)
  try {
    await fs.unlink(tmpPath);
  } catch (err) {
    // Temp file doesn't exist, that's fine
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(tmpPath);

  // Disable WAL mode for Windows filesystem compatibility (WSL + drvfs)
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = NORMAL');

  const hasFts5 = createGraphSchema(db);
  insertGraph(db, allEntities, allRelationships, hasFts5);

  // Phase 1b: Resolve relationship targets
  log('Resolving relationship targets...', 'yellow');
  const resolutionStats = resolveRelationshipTargets(db);

  db.close();

  // ATOMIC SWAP with EBUSY retry logic for Windows/WSL
  await atomicSwapDatabase(tmpPath, DB_PATHS.codeGraph);

  // Get file size
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
// PHASE 2: VECTOR EMBEDDINGS (Using Multi-Provider Embedding Service)
// =============================================================================

/**
 * Create vector table schema with file_path column for efficient deletion.
 */
function createVectorSchema(db) {
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

/**
 * Ensure schema has file_path column (for migration from old schema).
 */
function ensureVectorSchema(db) {
  // Check if file_path column exists
  const columns = db.prepare("PRAGMA table_info(vectors)").all();
  const hasFilePath = columns.some(col => col.name === 'file_path');

  if (!hasFilePath) {
    log('  Migrating schema: adding file_path column...', 'dim');

    // Add the column
    db.exec('ALTER TABLE vectors ADD COLUMN file_path TEXT');

    // Populate from metadata JSON
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

    // Create index
    db.exec('CREATE INDEX IF NOT EXISTS idx_vectors_file_path ON vectors(file_path)');

    log('  Schema migration complete', 'dim');
  }
}

/**
 * Insert vectors into database.
 */
function insertVectors(db, chunks, embeddings, modelInfo) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO vectors (id, file_path, embedding, text, metadata, session_id, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
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

  const items = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];

    if (!embedding || embedding.length === 0) continue;

    items.push({
      id: chunk.id,
      filePath: chunk.file,
      embeddingBlob: Buffer.from(new Float32Array(embedding).buffer),
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

  insertMany(items);
}

/**
 * Build vector index for semantic search.
 *
 * Supports two modes:
 * 1. Full rebuild: Deletes DB and rebuilds from scratch (atomic swap)
 * 2. Incremental: Removes vectors for changed/deleted files, inserts new vectors
 *
 * @param {string[]} files - Files to index (all files for full, changed files for incremental)
 * @param {boolean} dryRun - If true, skip actual indexing
 * @param {Object} options - Additional options
 * @param {boolean} options.fullRebuild - If true, rebuild from scratch
 * @param {string[]} options.filesToRemove - Files to remove vectors for (deleted files)
 */
async function buildVectorIndex(files, dryRun = false, options = {}) {
  log('\n━━━ Phase 2: Vector Embeddings ━━━', 'bright');

  const { fullRebuild = false, filesToRemove = [] } = options;

  if (dryRun) {
    log('DRY RUN: Skipping vector indexing', 'magenta');
    return { chunks: 0, embeddings: 0 };
  }

  // Show active provider
  const modelInfo = getModelInfo();
  log(`Using: ${modelInfo.provider} (${modelInfo.model})`, 'cyan');
  log(`Dimensions: ${modelInfo.dimension}d full → ${modelInfo.hnswDimension}d HNSW`, 'dim');

  // Import chunker
  const { ASTChunker } = await import('../ast-chunker.js');
  const chunker = new ASTChunker();

  // Parse files into chunks
  log('Parsing files into chunks...', 'yellow');
  const allChunks = [];
  let processed = 0;

  for (const file of files) {
    try {
      const filePath = path.join(PROJECT_ROOT, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const chunks = await chunker.parseFile(file, content);

      // Track chunk indices within file for collision-proof IDs
      let chunkIndex = 0;
      for (const chunk of chunks) {
        // ID format: file:lineStart-lineEnd:chunkIndex
        // - lineStart-lineEnd provides range context
        // - chunkIndex ensures uniqueness even with overlapping ranges
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

  // Generate embeddings using multi-provider service
  log('Generating embeddings...', 'yellow');

  // Prepare texts for batch embedding
  const texts = allChunks.map(chunk => {
    const text = `${chunk.file} ${chunk.metadata?.symbol || ''}\n${(chunk.text || chunk.content || '').slice(0, 1500)}`;
    return text;
  });

  // Use the embedding service (handles batching, rate limiting, fallback)
  const batchSize = EMBEDDING_CONFIG.batchSize;
  const embeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await getEmbeddings(batch);
    embeddings.push(...batchResults.map(r => r.embedding));

    if ((i + batchSize) % 100 === 0 || i + batchSize >= texts.length) {
      logProgress(Math.min(i + batchSize, texts.length), texts.length, 'Embedding');
    }
  }

  log(`\n✓ Generated ${embeddings.length} embeddings (${modelInfo.dimension}d)`, 'green');

  // Save to SQLite (for O(N) fallback search) using better-sqlite3
  await fs.mkdir(path.dirname(DB_PATHS.codebase), { recursive: true });

  const Database = (await import('better-sqlite3')).default;

  if (fullRebuild) {
    // FULL REBUILD: Atomic swap pattern - build to temp, then swap
    log('Full rebuild: Creating new database...', 'yellow');

    const tmpPath = DB_PATHS.codebase + '.tmp';

    // Remove temp file if exists (from previous failed run)
    try {
      await fs.unlink(tmpPath);
    } catch (err) {
      // Temp file doesn't exist, that's fine
    }

    const db = new Database(tmpPath);

    // Disable WAL mode for Windows filesystem compatibility (WSL + drvfs)
    db.pragma('journal_mode = DELETE');
    db.pragma('synchronous = NORMAL');

    createVectorSchema(db);
    insertVectors(db, allChunks, embeddings, modelInfo);

    db.close();

    // ATOMIC SWAP with EBUSY retry logic for Windows/WSL
    await atomicSwapDatabase(tmpPath, DB_PATHS.codebase);

    const vectorStats = await fs.stat(DB_PATHS.codebase);
    const dbSize = (vectorStats.size / 1024 / 1024).toFixed(2);
    log(`✓ Saved codebase.db (${dbSize} MB, ${allChunks.length} vectors)`, 'green');

  } else {
    // INCREMENTAL UPDATE: Remove vectors for changed files, insert new vectors
    log('Incremental update: Updating existing database...', 'yellow');

    let db;
    let previousCount = 0;

    // Check if database exists
    if (existsSync(DB_PATHS.codebase)) {
      db = new Database(DB_PATHS.codebase);
      db.pragma('journal_mode = DELETE');
      db.pragma('synchronous = NORMAL');

      // Ensure schema is up-to-date (adds file_path column if missing)
      ensureVectorSchema(db);

      // Get count before changes
      previousCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get().count;

      // Step 1: Remove vectors for files being reindexed (changed files)
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
      // Database doesn't exist, create new one
      log('No existing database, creating new...', 'yellow');
      db = new Database(DB_PATHS.codebase);
      db.pragma('journal_mode = DELETE');
      db.pragma('synchronous = NORMAL');
      createVectorSchema(db);
    }

    // Step 2: Insert new vectors
    insertVectors(db, allChunks, embeddings, modelInfo);

    // Get count after changes
    const newCount = db.prepare('SELECT COUNT(*) as count FROM vectors').get().count;

    db.close();

    const vectorStats = await fs.stat(DB_PATHS.codebase);
    const dbSize = (vectorStats.size / 1024 / 1024).toFixed(2);
    log(`✓ Updated codebase.db (${dbSize} MB, ${newCount} vectors)`, 'green');
    log(`  Previous: ${previousCount}, Added: ${allChunks.length}, Current: ${newCount}`, 'dim');
  }

  return { chunks: allChunks.length, embeddings: embeddings.length, allChunks, allEmbeddings: embeddings };
}

// =============================================================================
// PHASE 3: HNSW INDEX
// =============================================================================

/**
 * Incrementally update HNSW index by:
 * 1. Loading existing index
 * 2. Removing entries for files being reindexed
 * 3. Adding new entries from changed files
 * 4. Saving merged index
 */
async function incrementalUpdateHNSW(newChunks, newEmbeddings, changedFiles, dryRun = false) {
  log('\n━━━ Phase 3: HNSW Index (Incremental) ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping HNSW incremental update', 'magenta');
    return;
  }

  if (!newChunks || !newEmbeddings || newChunks.length === 0) {
    log('No new chunks to add', 'yellow');
    return;
  }

  const modelInfo = getModelInfo();
  const hnswDim = modelInfo.hnswDimension;

  // Step 1: Load existing HNSW index
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

  // Step 2: Remove entries for files being reindexed
  let removed = 0;
  if (changedFiles && changedFiles.length > 0) {
    log(`Removing entries for ${changedFiles.length} changed files...`, 'yellow');

    // Create set of changed file paths for fast lookup
    const changedFileSet = new Set(changedFiles);

    // Collect IDs to remove (iterate over metadata map)
    const idsToRemove = [];
    for (const [id, metadata] of index.metadata.entries()) {
      if (metadata.file && changedFileSet.has(metadata.file)) {
        idsToRemove.push(id);
      }
    }

    // Remove entries
    for (const id of idsToRemove) {
      await index.remove(id);
      removed++;
    }

    log(`✓ Removed ${removed} old entries`, 'green');
  }

  // Step 3: Add new entries from changed files
  log(`Adding ${newChunks.length} new entries...`, 'yellow');
  let added = 0;

  for (let i = 0; i < newChunks.length; i++) {
    const chunk = newChunks[i];
    const embedding = newEmbeddings[i];

    if (!embedding || embedding.length === 0) continue;

    // Truncate to HNSW dimension using Matryoshka
    const truncatedEmbedding = truncateForHNSW(embedding);

    await index.add(chunk.id, truncatedEmbedding, {
      file: chunk.file,
      name: chunk.metadata?.symbol,
      type: chunk.metadata?.chunk_type,
    });

    added++;

    if (added % 500 === 0 || i === newChunks.length - 1) {
      logProgress(added, newChunks.length, 'Adding to HNSW');
    }
  }

  // Step 4: Save merged index
  log('\nSaving merged HNSW index...', 'yellow');
  await index.save();

  const stats = index.getStats();
  log(`✓ HNSW index saved (${stats.totalVectors} total vectors, +${added} -${removed})`, 'green');
  log(`  Engine: ${stats.engine}, Dimension: ${hnswDim}d (Matryoshka)`, 'dim');
}

// =============================================================================
// PHASE 3: HNSW INDEX
// =============================================================================

async function buildHNSWIndex(chunks, embeddings, dryRun = false) {
  log('\n━━━ Phase 3: HNSW Index ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping HNSW index', 'magenta');
    return;
  }

  if (!chunks || !embeddings || chunks.length === 0) {
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
    maxElements: Math.max(chunks.length * 2, HNSW_CONFIG.maxElements),
  });

  await index.init();

  log(`Building HNSW index (${modelInfo.dimension}d → ${hnswDim}d Matryoshka, M=${HNSW_CONFIG.M})...`, 'yellow');

  let added = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];

    if (!embedding || embedding.length === 0) continue;

    // Truncate to HNSW dimension using Matryoshka
    const truncatedEmbedding = truncateForHNSW(embedding);

    await index.add(chunk.id, truncatedEmbedding, {
      file: chunk.file,
      name: chunk.metadata?.symbol,
      type: chunk.metadata?.chunk_type,
    });

    added++;

    if (added % 500 === 0 || i === chunks.length - 1) {
      logProgress(added, chunks.length, 'Building HNSW');
    }
  }

  // Save index
  await index.save();

  const stats = index.getStats();
  log(`\n✓ HNSW index built: ${stats.totalVectors} vectors (${hnswDim}d)`, 'green');
  log(`  Using fallback: ${stats.useFallback}`, 'dim');
}

// =============================================================================
// PHASE 4: COLBERT INDEX (Late Interaction)
// =============================================================================

/**
 * Build ColBERT index with pseudo-token embeddings.
 *
 * Strategy: Split each chunk into lines, embed each line separately.
 * This approximates token-level embeddings for MaxSim scoring.
 *
 * Storage: ~64 bytes per token (64-dim int8) = ~2-5MB for typical codebase
 */
async function buildColBERTIndex(chunks, dryRun = false, filesToRemove = []) {
  log('\n━━━ Phase 4: ColBERT Index ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping ColBERT index', 'magenta');
    return;
  }

  if (!chunks || chunks.length === 0) {
    log('No chunks to index', 'yellow');
    return;
  }

  const colbert = new ColBERTIndex({
    tokenDim: 64,
    maxTokens: 32,  // Max 32 "tokens" (lines) per document
    useInt8: true,
  });

  await colbert.init();

  // Handle incremental updates: Remove entries for files being reindexed
  if (filesToRemove && filesToRemove.length > 0) {
    log(`Removing entries for ${filesToRemove.length} changed/deleted files...`, 'yellow');

    let removed = 0;
    for (const [id, doc] of colbert.documents.entries()) {
      // Check if this document belongs to a file being reindexed
      // Document ID format: "file/path.ext:lineStart-lineEnd:chunkIndex"
      // Extract file path (everything before first colon)
      const docFile = doc.metadata?.file || id.split(':')[0];
      if (filesToRemove.includes(docFile)) {
        colbert.documents.delete(id);
        removed++;
      }
    }

    log(`  Removed ${removed} existing entries`, 'dim');
  }

  // Configuration
  const MAX_LINES_PER_CHUNK = 16;  // Limit lines per chunk for efficiency
  const MIN_LINE_LENGTH = 10;      // Skip very short lines
  const MAX_LINE_LENGTH = 200;     // Truncate very long lines

  log(`ColBERT: Extracting pseudo-tokens from ${chunks.length} chunks...`, 'yellow');

  // Collect all lines with their chunk references
  const allLines = [];
  const lineToChunk = [];  // Maps line index to chunk index

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const text = chunk.text || chunk.content || '';

    // Split into lines and filter
    const lines = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length >= MIN_LINE_LENGTH)
      .slice(0, MAX_LINES_PER_CHUNK)
      .map(line => line.slice(0, MAX_LINE_LENGTH));

    for (const line of lines) {
      allLines.push(line);
      lineToChunk.push(i);
    }
  }

  log(`  Extracted ${allLines.length} lines from ${chunks.length} chunks`, 'dim');

  if (allLines.length === 0) {
    log('No valid lines found for ColBERT indexing', 'yellow');
    return;
  }

  // Batch embed all lines
  log('ColBERT: Generating line embeddings...', 'yellow');

  const batchSize = EMBEDDING_CONFIG.batchSize;
  const lineEmbeddings = [];

  for (let i = 0; i < allLines.length; i += batchSize) {
    const batch = allLines.slice(i, i + batchSize);
    const results = await getEmbeddings(batch);
    lineEmbeddings.push(...results.map(r => r.embedding));

    if ((i + batchSize) % 500 === 0 || i + batchSize >= allLines.length) {
      logProgress(Math.min(i + batchSize, allLines.length), allLines.length, 'ColBERT Embedding');
    }
  }

  // Group embeddings by chunk
  log('\nColBERT: Building token index...', 'yellow');

  const chunkTokens = new Map();  // chunk index -> array of embeddings

  for (let i = 0; i < lineEmbeddings.length; i++) {
    const chunkIdx = lineToChunk[i];
    if (!chunkTokens.has(chunkIdx)) {
      chunkTokens.set(chunkIdx, []);
    }
    chunkTokens.get(chunkIdx).push(lineEmbeddings[i]);
  }

  // Add to ColBERT index
  let added = 0;
  for (const [chunkIdx, tokens] of chunkTokens) {
    const chunk = chunks[chunkIdx];
    await colbert.add(chunk.id, tokens, {
      file: chunk.file,
      name: chunk.metadata?.symbol,
    });
    added++;

    if (added % 500 === 0 || added === chunkTokens.size) {
      logProgress(added, chunkTokens.size, 'ColBERT Indexing');
    }
  }

  // Save index
  await colbert.save();

  const colbertStats = colbert.getStats();
  log(`\n✓ ColBERT index built: ${colbertStats.documents} docs, ${colbertStats.totalTokens} tokens`, 'green');
  log(`  Avg tokens/doc: ${colbertStats.avgTokensPerDoc}, Size: ${colbertStats.estimatedSizeMB} MB`, 'dim');

  return colbertStats;
}

// =============================================================================
// PHASE 5: BINARY HNSW + INT8 QUANTIZED ARTIFACTS
// =============================================================================

/**
 * Build Binary HNSW + Int8 quantized artifacts for 3-stage retrieval.
 *
 * This phase reads embeddings from codebase.db and builds:
 * 1. Binary HNSW index (32x memory reduction, Hamming distance)
 * 2. Int8 vectors database (4x memory reduction, for rescoring)
 *
 * These artifacts enable the 3-stage retrieval pipeline:
 *   Stage 1: Binary HNSW (1000 candidates, ~100μs)
 *   Stage 2: Int8 rescore (100 candidates, ~1ms)
 *   Stage 3: Rerank (top 20 → k)
 *
 * OPTIMIZATION: Skips rebuild for small changes (< threshold files).
 * Float HNSW serves search in between binary rebuilds.
 *
 * @param {boolean} dryRun - If true, skip actual building
 * @param {object} options - Build options
 * @param {number} options.changedFiles - Number of files changed in this indexing run
 * @param {boolean} options.force - Force rebuild regardless of thresholds (--force-artifacts)
 */
async function buildQuantizedArtifactsPhase(dryRun = false, options = {}) {
  log('\n━━━ Phase 5: Binary HNSW + Int8 Artifacts ━━━', 'bright');

  const { changedFiles = 0, force = false } = options;

  if (dryRun) {
    log('DRY RUN: Skipping quantized artifact building', 'magenta');
    return { binaryHnsw: null, int8: null };
  }

  try {
    // Check if codebase.db exists
    if (!existsSync(DB_PATHS.codebase)) {
      log('⚠ Skipping quantized artifacts: codebase.db not found', 'yellow');
      return { binaryHnsw: null, int8: null };
    }

    // Check threshold: skip rebuild for small incremental updates
    const skipCheck = await shouldSkipArtifactRebuild({ changedFiles, force });

    if (skipCheck.shouldSkip) {
      log(`Skipping binary artifacts (only ${changedFiles} files changed, threshold is ${ARTIFACT_THRESHOLDS.skipThreshold})`, 'yellow');
      log('  Float HNSW will serve search until next rebuild', 'dim');
      log(`  Accumulated changes: ${skipCheck.accumulatedTotal || changedFiles}`, 'dim');

      // Update state to accumulate changes
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
      // Note: int8DbPath is no longer used - int8 vectors are stored in .int8.json sidecar
      onProgress: (phase, current, total) => {
        // Progress is already logged by buildQuantizedArtifacts
      },
    });

    // buildFromCodebaseDb returns { hnsw, stats } where:
    //   hnsw: { totalVectors, buildTimeMs, vectorsPerSecond, path, int8SidecarPath, int8VectorCount, ... }
    //   stats: { totalVectors, floatDimension, binaryDimension, memoryReduction }
    const int8Count = result.hnsw.int8VectorCount || result.hnsw.totalVectors;
    const int8SizeMB = ((int8Count * (result.hnsw.floatDimension || 512)) / 1024 / 1024).toFixed(2);

    log(`\n✓ Binary HNSW: ${result.hnsw.totalVectors} vectors (${result.hnsw.buildTimeMs}ms, ${result.hnsw.vectorsPerSecond} vec/s)`, 'green');
    log(`✓ Int8 vectors: ${int8Count} vectors (~${int8SizeMB} MB) → ${result.hnsw.int8SidecarPath}`, 'green');

    // Update state: reset accumulated changes after rebuild
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

// =============================================================================
// PHASE RUNNER HELPER
// =============================================================================

/**
 * Run an indexing phase with consistent timing and error handling.
 * Provides structured logging and timing for each phase.
 *
 * @param {string} phaseName - Human-readable phase name
 * @param {Function} phaseFn - Async function to run
 * @param {Object} options - Phase options (passed to phaseFn)
 * @returns {Promise<{ success: boolean, result?: any, duration: number, error?: Error }>}
 */
async function runPhase(phaseName, phaseFn, options = {}) {
  const startTime = Date.now();
  log(`\n${colors.cyan}>>> ${phaseName}${colors.reset}`, 'cyan');

  try {
    const result = await phaseFn(options);
    const duration = Date.now() - startTime;
    log(`${colors.green}<<< ${phaseName} completed in ${duration}ms${colors.reset}`, 'green');
    return { success: true, result, duration };
  } catch (err) {
    const duration = Date.now() - startTime;
    log(`${colors.red}<<< ${phaseName} failed after ${duration}ms: ${err.message}${colors.reset}`, 'red');
    return { success: false, error: err, duration };
  }
}

// =============================================================================
// EXTRACTED PHASES
// =============================================================================

/**
 * Phase: Discover files to index.
 * Handles both stdin files and filesystem discovery.
 *
 * @param {Object} options
 * @param {boolean} options.filesFromStdin - Whether to read files from stdin
 * @param {boolean} options.quiet - Suppress progress output
 * @returns {Promise<{ allFiles: string[], stdinFiles: string[]|null }>}
 */
async function discoverFilesPhase(options = {}) {
  const { filesFromStdin = false, quiet = false } = options;

  let stdinFiles = null;

  // Handle --files-from-stdin: read targeted file list from stdin
  if (filesFromStdin) {
    log('\n--- Reading Files from stdin ---', 'bright');
    stdinFiles = await readFilesFromStdin();

    if (stdinFiles.length === 0) {
      log('No files provided via stdin', 'yellow');
      return { allFiles: [], stdinFiles: [], earlyExit: true, exitReason: 'no_stdin_input' };
    }

    log(`Received ${stdinFiles.length} files from stdin`, 'green');
    if (!quiet && stdinFiles.length <= 20) {
      for (const f of stdinFiles) {
        log(`    - ${f}`, 'dim');
      }
    }
  }

  // Discover all files (needed for graph rebuild, even in targeted mode)
  const allFiles = await discoverFiles();

  if (allFiles.length === 0) {
    log('No files to index', 'yellow');
    return { allFiles: [], stdinFiles, earlyExit: true, exitReason: 'no_files' };
  }

  return { allFiles, stdinFiles, earlyExit: false };
}

/**
 * Phase: Determine which files need indexing (incremental vs full).
 *
 * @param {Object} options
 * @param {string[]} options.allFiles - All discovered files
 * @param {string[]|null} options.stdinFiles - Files from stdin (if any)
 * @param {boolean} options.filesFromStdin - Whether stdin mode is active
 * @param {boolean} options.fullReindex - Whether full reindex is requested
 * @param {boolean} options.dryRun - Whether this is a dry run
 * @param {boolean} options.quiet - Suppress progress output
 * @returns {Promise<{ filesToIndex: string[], incrementalInfo: Object|null }>}
 */
async function determineFilesToIndexPhase(options = {}) {
  const { allFiles, stdinFiles, filesFromStdin, fullReindex, dryRun, quiet } = options;

  let filesToIndex = allFiles;
  let incrementalInfo = null;

  if (filesFromStdin && stdinFiles && stdinFiles.length > 0) {
    // Targeted mode: only index files from stdin (vectors + summaries)
    log('\n--- Targeted Indexing Mode ---', 'bright');

    // Filter stdin files to only include ones that exist in allFiles
    const allFilesSet = new Set(allFiles);
    const validStdinFiles = stdinFiles.filter(f => allFilesSet.has(f));

    if (validStdinFiles.length < stdinFiles.length) {
      const skipped = stdinFiles.length - validStdinFiles.length;
      log(`Skipped ${skipped} files (not found in codebase or excluded)`, 'yellow');
    }

    if (validStdinFiles.length === 0) {
      log('No valid files to index from stdin', 'yellow');
      return { filesToIndex: [], incrementalInfo: null, earlyExit: true, exitReason: 'no_valid_files' };
    }

    filesToIndex = validStdinFiles;
    log(`  Targeting ${filesToIndex.length} files for vector/summary updates`, 'green');
    log(`  Graph will still be fully rebuilt (${allFiles.length} files)`, 'dim');

    // Create a pseudo-incrementalInfo for downstream code
    incrementalInfo = {
      toIndex: filesToIndex,
      toRemove: [],
      unchanged: allFiles.filter(f => !validStdinFiles.includes(f)),
      currentHashes: {},  // Will be computed later if needed
    };

  } else if (!fullReindex && !dryRun) {
    log('\n--- Checking for Changes ---', 'bright');
    incrementalInfo = await getChangedFiles(allFiles, PROJECT_ROOT);

    if (incrementalInfo.toIndex.length === 0 && incrementalInfo.toRemove.length === 0) {
      log('No changes detected - index is up to date!', 'green');
      log(`  ${incrementalInfo.unchanged.length} files unchanged`, 'dim');
      return { filesToIndex: [], incrementalInfo, earlyExit: true, exitReason: 'no_changes' };
    }

    filesToIndex = incrementalInfo.toIndex;
    log(`  Changed/new: ${incrementalInfo.toIndex.length} files`, 'yellow');
    log(`  Removed: ${incrementalInfo.toRemove.length} files`, 'yellow');
    log(`  Unchanged: ${incrementalInfo.unchanged.length} files`, 'dim');

    if (incrementalInfo.toIndex.length < 20) {
      log('  Files to reindex:', 'dim');
      for (const f of incrementalInfo.toIndex.slice(0, 10)) {
        log(`    - ${f}`, 'dim');
      }
      if (incrementalInfo.toIndex.length > 10) {
        log(`    ... and ${incrementalInfo.toIndex.length - 10} more`, 'dim');
      }
    }
  } else if (fullReindex) {
    log('\n--- Full Reindex Mode ---', 'bright');
  }

  return { filesToIndex, incrementalInfo, earlyExit: false };
}

/**
 * Phase: Build code graph and prepare HCGS summaries.
 *
 * @param {Object} options
 * @param {string[]} options.allFiles - All files for graph building
 * @param {string[]} options.filesToIndex - Files to index (for HCGS)
 * @param {boolean} options.dryRun - Whether this is a dry run
 * @param {boolean} options.fullReindex - Whether full reindex is requested
 * @param {boolean} options.filesFromStdin - Whether stdin mode is active
 * @param {Object|null} options.incrementalInfo - Incremental info (if any)
 * @param {boolean} options.skipSummaryRegen - Deprecated flag (ignored)
 * @returns {Promise<{ graphStats: Object, hcgsPromise: Promise|null }>}
 */
async function buildCodeGraphWithHCGSPhase(options = {}) {
  const {
    allFiles,
    filesToIndex,
    dryRun,
    fullReindex,
    filesFromStdin,
    incrementalInfo,
    skipSummaryRegen,
  } = options;

  // ALWAYS backup existing summaries before rebuild
  let summaryBackup = { summaries: [], count: 0 };
  if (!dryRun) {
    summaryBackup = await backupSummaries(DB_PATHS.codeGraph);
    if (summaryBackup.count > 0) {
      log(`Backed up ${summaryBackup.count} existing summaries (with type validation)`, 'green');
    }
    if (summaryBackup.error) {
      log(`Backup partial: ${summaryBackup.error}`, 'yellow');
    }
  }

  // Deprecated flag warning
  if (skipSummaryRegen) {
    log('\nDEPRECATION: --skip-summary-regen is no longer needed', 'yellow');
    log('  Summaries are now ALWAYS automatically preserved across rebuilds', 'dim');
  }

  // Build code graph (always full rebuild for relationships)
  const graphStats = await buildCodeGraph(allFiles, dryRun);

  // ALWAYS restore summaries after rebuild
  if (!dryRun && summaryBackup.count > 0) {
    const restoreResult = await restoreSummaries(DB_PATHS.codeGraph, summaryBackup);
    log(`Restored ${restoreResult.restored} summaries (${restoreResult.skipped.total} skipped - entity removed/type changed)`, 'green');
  }

  // Prepare HCGS task (runs in parallel with vectors later)
  let hcgsPromise = null;

  const shouldRunHCGS = !dryRun && (
    fullReindex ||
    filesFromStdin ||
    (incrementalInfo && filesToIndex.length > 0)
  );

  if (shouldRunHCGS) {
    const hcgsMode = fullReindex ? 'Full Regeneration' : 'Changed Files';
    log(`\n--- Preparing HCGS Summaries (${hcgsMode}) ---`, 'bright');

    let entitiesToRegenerate = 0;

    try {
      if (!fullReindex && filesToIndex.length > 0) {
        // Mark changed file entities as needing summary regeneration
        const markResult = await markForRegeneration(DB_PATHS.codeGraph, filesToIndex);
        entitiesToRegenerate = markResult.marked;
        log(`Marked ${markResult.marked} entities for summary regeneration`, 'green');
      } else if (fullReindex) {
        entitiesToRegenerate = -1; // Flag to indicate "all"
        log('Will regenerate summaries for all entities', 'yellow');
      }
    } catch (e) {
      log(`Summary marking skipped: ${e.message}`, 'yellow');
    }

    // Create HCGS task (runs in parallel with vector indexing)
    if (entitiesToRegenerate !== 0) {
      hcgsPromise = (async () => {
        try {
          const { generateAllSummaries } = await import('./hcgs-generator.js');
          const summaryResult = await generateAllSummaries({
            dbPath: DB_PATHS.codeGraph,
            verbose: false,
          });
          return summaryResult;
        } catch (e) {
          log(`Summary regeneration failed: ${e.message}`, 'yellow');
          log('  Run manually: node hcgs-generator.js generate', 'dim');
          return { generated: 0, skipped: 0, error: e.message };
        }
      })();
    }
  }

  return { graphStats, hcgsPromise };
}

/**
 * Phase: Build vectors and HNSW indexes (runs in parallel with HCGS).
 *
 * @param {Object} options
 * @param {string[]} options.filesToIndex - Files to index
 * @param {boolean} options.dryRun - Whether this is a dry run
 * @param {boolean} options.fullReindex - Whether full reindex is requested
 * @param {Object|null} options.incrementalInfo - Incremental info (if any)
 * @param {boolean} options.forceArtifacts - Force artifact rebuild
 * @param {Promise|null} options.hcgsPromise - HCGS promise to run in parallel
 * @returns {Promise<{ vectorStats: Object, hcgsResult: Object|null }>}
 */
async function buildVectorsAndArtifactsPhase(options = {}) {
  const {
    filesToIndex,
    dryRun,
    fullReindex,
    incrementalInfo,
    forceArtifacts,
    hcgsPromise,
  } = options;

  // Build vectors
  const vectorOptions = {
    fullRebuild: fullReindex,
    filesToRemove: incrementalInfo?.toRemove || [],
  };

  const vectorPromise = buildVectorIndex(filesToIndex, dryRun, vectorOptions);

  // Wait for both HCGS and vectors to complete in parallel
  const runningTasks = [];
  if (hcgsPromise) runningTasks.push('HCGS Summaries');
  runningTasks.push('Vector Embeddings');

  if (runningTasks.length > 1) {
    log(`\n--- Running in Parallel: ${runningTasks.join(' + ')} ---`, 'bright');
    log('  (Independent stages running concurrently for faster indexing)', 'dim');
  }

  const [hcgsResult, vectorResult] = await Promise.all([
    hcgsPromise || Promise.resolve(null),
    vectorPromise,
  ]);

  // Log HCGS result
  if (hcgsResult && !hcgsResult.error) {
    log(`Summaries regenerated (${hcgsResult.generated} generated, ${hcgsResult.skipped} skipped)`, 'green');
  }

  const vectorStats = vectorResult || { chunks: 0, embeddings: 0 };

  // Build HNSW indexes
  if (!dryRun && vectorResult && vectorResult.allChunks && vectorResult.allEmbeddings) {
    if (incrementalInfo && !fullReindex) {
      // Incremental HNSW update
      const allFilesToRemoveFromHNSW = [
        ...incrementalInfo.toIndex,
        ...(incrementalInfo.toRemove || [])
      ];
      await incrementalUpdateHNSW(vectorResult.allChunks, vectorResult.allEmbeddings, allFilesToRemoveFromHNSW, dryRun);
    } else {
      // Full HNSW rebuild
      await buildHNSWIndex(vectorResult.allChunks, vectorResult.allEmbeddings, dryRun);
    }
  }

  // Build ColBERT index
  if (!dryRun && vectorResult && vectorResult.allChunks && vectorResult.allChunks.length > 0) {
    const filesToRemoveFromColBERT = incrementalInfo && !fullReindex
      ? [...incrementalInfo.toIndex, ...(incrementalInfo.toRemove || [])]
      : [];
    await buildColBERTIndex(vectorResult.allChunks, dryRun, filesToRemoveFromColBERT);
  }

  // Phase 5: Build Binary HNSW + Int8 quantized artifacts
  if (!dryRun && vectorStats.embeddings > 0) {
    await buildQuantizedArtifactsPhase(dryRun, {
      changedFiles: filesToIndex.length,
      force: forceArtifacts || fullReindex,
    });
  }

  return { vectorStats, hcgsResult };
}

/**
 * Phase: Update incremental state after successful indexing.
 *
 * @param {Object} options
 * @param {boolean} options.dryRun - Whether this is a dry run
 * @param {boolean} options.fullReindex - Whether full reindex is requested
 * @param {Object|null} options.incrementalInfo - Incremental info (if any)
 * @param {string[]} options.allFiles - All discovered files
 * @param {Object} options.vectorStats - Vector indexing stats
 * @param {Object} options.graphStats - Code graph stats
 * @returns {Promise<void>}
 */
async function updateIncrementalStatePhase(options = {}) {
  const { dryRun, fullReindex, incrementalInfo, allFiles, vectorStats, graphStats } = options;

  if (dryRun) return;

  if (incrementalInfo) {
    await updateState(incrementalInfo.currentHashes, {
      totalChunks: vectorStats.chunks,
      entities: graphStats.entities,
      relationships: graphStats.relationships
    });
    log('\nIncremental state updated', 'green');
  } else if (fullReindex) {
    // Compute hashes for full reindex
    const hashes = {};
    for (const file of allFiles) {
      try {
        const content = await fs.readFile(path.join(PROJECT_ROOT, file), 'utf-8');
        const crypto = await import('crypto');
        hashes[file] = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
      } catch (e) { /* skip */ }
    }
    await updateState(hashes, {
      totalChunks: vectorStats.chunks,
      entities: graphStats.entities,
      relationships: graphStats.relationships
    });
    log('\nIncremental state saved', 'green');
  }
}

/**
 * Phase: Print final summary of indexing results.
 *
 * @param {Object} options
 * @param {Object} options.graphStats - Code graph stats
 * @param {Object} options.vectorStats - Vector indexing stats
 * @param {string[]} options.filesToIndex - Files that were indexed
 * @param {string[]} options.allFiles - All discovered files
 * @param {Object|null} options.incrementalInfo - Incremental info (if any)
 * @param {boolean} options.vectorsOnly - Whether only vectors were indexed
 * @param {boolean} options.graphOnly - Whether only graph was indexed
 * @param {boolean} options.fullReindex - Whether full reindex was performed
 * @param {boolean} options.filesFromStdin - Whether stdin mode was used
 * @param {boolean} options.quiet - Whether quiet mode is enabled
 * @param {number} options.startTime - Start timestamp
 */
function printSummaryPhase(options) {
  const {
    graphStats,
    vectorStats,
    filesToIndex,
    allFiles,
    incrementalInfo,
    vectorsOnly,
    graphOnly,
    fullReindex,
    filesFromStdin,
    quiet,
    startTime,
  } = options;

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const mode = fullReindex ? 'FULL' : (incrementalInfo ? 'INCREMENTAL' : 'FULL');

  log(`\n${'='.repeat(50)}`, 'bright');
  log(`INDEXING COMPLETE (${mode})`, 'bright');
  log(`${'='.repeat(50)}`, 'bright');
  log(`Duration: ${duration}s`, 'dim');
  log(`Files indexed: ${filesToIndex.length}${incrementalInfo ? ` (of ${allFiles.length} total)` : ''}`, 'dim');

  if (!vectorsOnly) {
    log(`Entities: ${graphStats.entities}`, 'dim');
    log(`Relationships: ${graphStats.relationships}`, 'dim');
    if (graphStats.resolved !== undefined) {
      log(`  Resolved: ${graphStats.resolved}`, 'dim');
      if (graphStats.unresolvedTotal > 0) {
        log(`  Unresolved: ${graphStats.unresolvedTotal}`, 'dim');
      }
    }
  }

  if (!graphOnly) {
    log(`Chunks: ${vectorStats.chunks}`, 'dim');
    log(`Embeddings: ${vectorStats.embeddings}`, 'dim');
  }

  log('', 'reset');
  log('Indexes created:', 'green');
  if (!vectorsOnly) log(`  - ${DB_PATHS.codeGraph}`, 'green');
  if (!graphOnly) {
    log(`  - ${DB_PATHS.codebase}`, 'green');
    log(`  - ${DB_PATHS.hnswIndex}`, 'green');
    // Show quantized artifacts if they exist
    if (existsSync(DB_PATHS.binaryHnswIndex.replace('.idx', '.meta.json'))) {
      log(`  - ${DB_PATHS.binaryHnswIndex} (Binary HNSW, 32x smaller)`, 'green');
    }
    if (existsSync(DB_PATHS.int8Vectors)) {
      log(`  - ${DB_PATHS.int8Vectors} (Int8 vectors, 4x smaller)`, 'green');
    }
  }

  // Quiet mode: output structured result for daemon
  if (quiet) {
    console.log(JSON.stringify({
      success: true,
      filesProcessed: filesToIndex.length,
      entities: graphStats.entities,
      relationships: graphStats.relationships,
      chunks: vectorStats.chunks,
      embeddings: vectorStats.embeddings,
      durationSeconds: parseFloat(duration),
      mode: filesFromStdin ? 'targeted' : mode.toLowerCase(),
    }));
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const startTime = Date.now();

  // Parse arguments FIRST (before any logging) to handle --quiet
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const graphOnly = args.includes('--graph-only');
  const vectorsOnly = args.includes('--vectors-only');
  const fullReindex = args.includes('--full');
  const showStats = args.includes('--stats');
  const resolveOnly = args.includes('--resolve-only');
  const skipSummaryRegen = args.includes('--skip-summary-regen');
  const filesFromStdin = args.includes('--files-from-stdin');
  const quiet = args.includes('--quiet');
  const forceArtifacts = args.includes('--force-artifacts');

  // Set quiet mode before any logging
  if (quiet) {
    setQuietMode(true);
  }

  log(`${colors.bright}╔═══════════════════════════════════════════════════╗${colors.reset}`, 'bright');
  log(`${colors.bright}║   Sweet Search Codebase Indexer v2.3 (SOTA Dec'25) ║${colors.reset}`, 'bright');
  log(`${colors.bright}╚═══════════════════════════════════════════════════╝${colors.reset}`, 'bright');

  // Warn about --vectors-only since it skips code graph (breaks GraphRAG)
  if (vectorsOnly) {
    log('⚠ WARNING: --vectors-only skips code graph rebuild', 'yellow');
    log('  GraphRAG structural queries will use stale data', 'yellow');
    log('  Use default mode (no flags) to ensure full functionality', 'dim');
    log('', 'reset');
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage:
  node index-codebase-v21.js [options]

Options:
  (default)        Incremental (recommended) - FULL code graph + incremental vectors
                   Code graph always fully rebuilt for GraphRAG accuracy
  --full           Full reindex - rebuild everything from scratch.
                   Automatically runs HCGS summary regeneration for all entities.
  --graph-only     Only build code graph (Phase 1)
  --vectors-only   Only vectors + HNSW (SKIPS code graph, breaks GraphRAG!)
  --resolve-only   Only resolve relationship targets (no reindexing)
  --skip-summary-regen  [DEPRECATED] No longer needed - summaries are always preserved.
                       This flag is ignored; use it for backward compatibility only.
  --files-from-stdin   Read file paths from stdin (newline-delimited) for targeted indexing.
                       Only these files will have their vectors/summaries updated.
                       Graph is still fully rebuilt (relationships span files).
                       Automatically runs HCGS for the specified files.
  --force-artifacts    Force binary HNSW + Int8 artifact rebuild regardless of change count.
                       Default: skip rebuild if <${ARTIFACT_THRESHOLDS.skipThreshold} files changed (Float HNSW serves search).
  --quiet          Suppress progress bars and non-essential output (for daemon use).
                   Errors still go to stderr.
  --dry-run        Preview without indexing
  --stats          Show indexing statistics
  --help, -h       Show this help

HCGS Summary Regeneration:
  HCGS (Hierarchical Code Graph Summaries) automatically runs when:
    1. --full flag is set (regenerates ALL entity summaries)
    2. --files-from-stdin is used (regenerates summaries for stdin files)
    3. Incremental changes detected (regenerates summaries for changed files)

  Summaries use Cerebras GLM-4.6 for fast generation (~1000 tok/s), with fallback
  to Haiku/Ollama/static patterns when API key is not set.

Targeted Indexing (daemon mode):
  printf "A.java\\nB.java\\n" | node index-codebase-v21.js --files-from-stdin --quiet

  This only re-embeds/updates vectors and summaries for the specified files,
  while still rebuilding the graph (required for accurate relationships).

Note: Code graph is ALWAYS fully rebuilt (except with --vectors-only) to ensure
GraphRAG structural queries ("what calls X", "implementations of Y") are accurate.
This is intentional since relationships span across files.

Output:
  .sweet-search/code-graph.db      Code graph with FTS5 (lexical search)
  .sweet-search/codebase.db        Vector embeddings (semantic search)
  .sweet-search/codebase-hnsw.idx  HNSW index (fast ANN)
  .sweet-search/merkle-state.json  Incremental indexing state
`);
    process.exit(0);
  }

  // Show stats and exit
  if (showStats) {
    const stats = await getIncrementalStats();
    log('\nIndexing Statistics:', 'bright');
    log(`  Last indexed: ${stats.lastIndex || 'Never'}`, 'dim');
    log(`  Total files: ${stats.totalFiles}`, 'dim');
    log(`  Total chunks: ${stats.totalChunks}`, 'dim');
    log(`  Has state: ${stats.hasState}`, 'dim');
    return;
  }

  // Resolve-only mode: just run relationship resolution
  if (resolveOnly) {
    log('\n━━━ Resolve-Only Mode ━━━', 'bright');

    if (!existsSync(DB_PATHS.codeGraph)) {
      log('✗ Code graph database not found. Run indexing first.', 'red');
      process.exit(1);
    }

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(DB_PATHS.codeGraph);

    log('Resolving relationship targets...', 'yellow');
    const resolutionStats = resolveRelationshipTargets(db);

    db.close();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`\n${'━'.repeat(50)}`, 'bright');
    log(`RESOLUTION COMPLETE`, 'bright');
    log(`${'━'.repeat(50)}`, 'bright');
    log(`Duration: ${duration}s`, 'dim');
    log(`Resolved: ${resolutionStats.resolved}/${resolutionStats.total}`, 'dim');
    if (resolutionStats.ambiguous > 0) {
      log(`Ambiguous: ${resolutionStats.ambiguous}`, 'dim');
    }

    return;
  }

  try {
    // =========================================================================
    // PHASE 1: File Discovery
    // =========================================================================
    const discoveryResult = await runPhase('File Discovery', discoverFilesPhase, {
      filesFromStdin,
      quiet,
    });

    if (!discoveryResult.success) {
      throw discoveryResult.error;
    }

    const { allFiles, stdinFiles, earlyExit: discoveryEarlyExit, exitReason: discoveryExitReason } = discoveryResult.result;

    if (discoveryEarlyExit) {
      if (quiet) {
        console.log(JSON.stringify({ success: true, filesProcessed: 0, reason: discoveryExitReason }));
      }
      return;
    }

    // =========================================================================
    // PHASE 2: Determine Files to Index
    // =========================================================================
    const filesToIndexResult = await runPhase('Determine Files to Index', determineFilesToIndexPhase, {
      allFiles,
      stdinFiles,
      filesFromStdin,
      fullReindex,
      dryRun,
      quiet,
    });

    if (!filesToIndexResult.success) {
      throw filesToIndexResult.error;
    }

    const { filesToIndex, incrementalInfo, earlyExit, exitReason } = filesToIndexResult.result;

    if (earlyExit) {
      if (quiet && exitReason === 'no_valid_files') {
        console.log(JSON.stringify({ success: true, filesProcessed: 0, reason: exitReason }));
      }
      return;
    }

    // =========================================================================
    // PHASE 3: Code Graph + HCGS Preparation (if not --vectors-only)
    // =========================================================================
    let graphStats = { entities: 0, relationships: 0 };
    let hcgsPromise = null;

    if (!vectorsOnly) {
      const graphResult = await runPhase('Code Graph + HCGS Prep', buildCodeGraphWithHCGSPhase, {
        allFiles,
        filesToIndex,
        dryRun,
        fullReindex,
        filesFromStdin,
        incrementalInfo,
        skipSummaryRegen,
      });

      if (!graphResult.success) {
        throw graphResult.error;
      }

      graphStats = graphResult.result.graphStats;
      hcgsPromise = graphResult.result.hcgsPromise;
    }

    // =========================================================================
    // PHASE 4: Vectors + HNSW + Artifacts (if not --graph-only)
    // =========================================================================
    let vectorStats = { chunks: 0, embeddings: 0 };

    if (!graphOnly) {
      const vectorsResult = await runPhase('Vectors + HNSW + Artifacts', buildVectorsAndArtifactsPhase, {
        filesToIndex,
        dryRun,
        fullReindex,
        incrementalInfo,
        forceArtifacts,
        hcgsPromise,
      });

      if (!vectorsResult.success) {
        throw vectorsResult.error;
      }

      vectorStats = vectorsResult.result.vectorStats;
    } else if (hcgsPromise) {
      // If --graph-only but HCGS was prepared, wait for it
      const hcgsResult = await hcgsPromise;
      if (hcgsResult && !hcgsResult.error) {
        log(`Summaries regenerated (${hcgsResult.generated} generated, ${hcgsResult.skipped} skipped)`, 'green');
      }
    }

    // =========================================================================
    // PHASE 5: Update Incremental State
    // =========================================================================
    await runPhase('Update Incremental State', updateIncrementalStatePhase, {
      dryRun,
      fullReindex,
      incrementalInfo,
      allFiles,
      vectorStats,
      graphStats,
    });

    // =========================================================================
    // PHASE 6: Print Summary
    // =========================================================================
    printSummaryPhase({
      graphStats,
      vectorStats,
      filesToIndex,
      allFiles,
      incrementalInfo,
      vectorsOnly,
      graphOnly,
      fullReindex,
      filesFromStdin,
      quiet,
      startTime,
    });

  } catch (err) {
    // Always output errors (even in quiet mode) to stderr
    logError(`Fatal error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }

    // Quiet mode: output structured error for daemon
    if (quiet) {
      console.log(JSON.stringify({
        success: false,
        error: err.message,
      }));
    }

    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export {
  main,
  discoverFiles,
  buildCodeGraph,
  buildVectorIndex,
  buildHNSWIndex,
  buildColBERTIndex,
  buildQuantizedArtifactsPhase,
  // CLI support exports (for testing)
  readFilesFromStdin,
  setQuietMode,
  isQuietMode,
  // Schema functions (for testing)
  createVectorSchema,
  ensureVectorSchema,
  insertVectors,
  // Database utilities (for testing and external use)
  atomicSwapDatabase,
};
