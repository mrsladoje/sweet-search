#!/usr/bin/env node

/**
 * HCGS - Hierarchical Code Graph Summary Generator (Parallel Edition)
 *
 * Generates bottom-up summaries for code entities:
 * 1. Methods/Fields -> one-line summaries (parallel within level)
 * 2. Classes/Interfaces -> aggregated from children
 * 3. Packages/Files -> aggregated from classes
 *
 * Based on Code-Craft paper (April 2025) showing 82% improvement in retrieval precision.
 *
 * Features:
 * - Parallel generation within hierarchy levels (p-limit concurrency control)
 * - Provider fallback chain (Cerebras -> Ollama -> Transformers.js -> Static)
 * - Transactional batch storage
 * - Progress reporting
 * - O(1) parent->child lookup via childrenByParent index
 *
 * Storage Format:
 * - `summary` column: Plain text summary string
 * - `summary_embedding` column: Binary embedding (Uint8Array via floatToBinary)
 *   Format: 1-bit per dimension, sign-based quantization (positive -> 1, negative -> 0)
 *   Size: dimension/8 bytes (e.g., 1024d -> 128 bytes)
 *   Distance metric: Hamming distance for fast similarity search
 *   Note: Summary embeddings are currently generated but NOT used in search.
 *         Future use: Enable hybrid search over summaries + code content.
 *
 * @module hcgs-generator
 */

import pLimit from 'p-limit';
import { DB_PATHS, HCGS_CONFIG } from '../infrastructure/config/index.js';
import { floatToBinary } from '../infrastructure/quantization.js';
import {
  generateSummary,
  createSummaryPrompt,
  generateWithRetry,
  generateStaticSummary,
  getSummaryProvider,
} from '../infrastructure/llm-provider.js';
import {
  getEntitiesNeedingSummary,
  storeSummariesBatch,
  getChildSummaries as getChildSummariesFromDb,
  getSummaryStats,
} from './summary-manager.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const HIERARCHY_LEVELS = {
  'method': 2,
  'field': 2,
  'rpc': 2,
  'function': 1,
  'component': 1,
  'class': 1,
  'interface': 1,
  'enum': 1,
  'service': 1,
  'message': 1,
  'file': 0,
  'package': 0,
};

// Parallel processing configuration
const DEFAULT_CONCURRENCY = 5;  // Max concurrent LLM calls
const PROGRESS_INTERVAL = 20;   // Log progress every N entities
const BATCH_STORAGE_SIZE = 50;  // Store summaries in batches of N

/**
 * Get adaptive token limit based on entity type
 * Complexity-aware: simple methods get brief summaries, complex classes get detailed ones
 */
function getTokenLimitForType(type) {
  const limits = HCGS_CONFIG.summaryTokenLimits || {};
  return limits[type] || HCGS_CONFIG.defaultTokenLimit || 100;
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

/**
 * Build prompt for summary generation with adaptive token limits
 * @param {object} entity - The entity to summarize
 * @param {array} childSummaries - Summaries of child entities for context
 * @param {number} tokenLimit - Adaptive token limit based on entity type
 */
function buildSummaryPrompt(entity, childSummaries = [], tokenLimit = 100) {
  const type = entity.type;
  const name = entity.name;
  const signature = entity.signature || '';
  const docComment = entity.doc_comment || '';

  // Describe expected detail level based on token budget
  let detailLevel;
  if (tokenLimit <= 50) {
    detailLevel = 'a brief one-line';
  } else if (tokenLimit <= 100) {
    detailLevel = 'a concise 1-2 sentence';
  } else if (tokenLimit <= 150) {
    detailLevel = 'a clear 2-3 sentence';
  } else {
    detailLevel = 'a comprehensive';
  }

  let prompt = `Generate ${detailLevel} summary for this ${type}:\n\n`;
  prompt += `Name: ${name}\n`;

  if (signature) {
    prompt += `Signature: ${signature}\n`;
  }

  if (docComment) {
    // Include more context for complex entities
    const docLimit = tokenLimit >= 150 ? 500 : 200;
    prompt += `Documentation: ${docComment.slice(0, docLimit)}\n`;
  }

  if (childSummaries.length > 0) {
    prompt += `\nContains:\n`;
    // Show more children for complex entities
    const childLimit = tokenLimit >= 150 ? 15 : 10;
    for (const child of childSummaries.slice(0, childLimit)) {
      prompt += `- ${child.name}: ${child.summary}\n`;
    }
  }

  prompt += `\nRespond with ONLY the summary. No prefixes, no explanations.`;

  return prompt;
}

// =============================================================================
// SUMMARY GENERATION
// =============================================================================

/**
 * Generate summary for a single entity using the provider fallback chain
 * @param {object} entity - Entity to summarize
 * @param {array} childSummaries - Summaries of child entities
 * @returns {Promise<{summary: string, provider: string}>}
 */
async function generateEntitySummary(entity, childSummaries = []) {
  const entityType = entity.type || 'method';
  const tokenLimit = getTokenLimitForType(entityType);
  const prompt = buildSummaryPrompt(entity, childSummaries, tokenLimit);

  try {
    // Use the provider fallback chain from llm-provider.js
    const result = await generateSummary(prompt, {
      entity,
      maxTokens: tokenLimit,
    });
    return result;
  } catch (err) {
    // Ultimate fallback: static summary
    console.error(`  Warning: All providers failed for ${entity.name}: ${err.message}`);
    return {
      summary: generateStaticSummary(entity),
      provider: 'static',
    };
  }
}

// =============================================================================
// PARALLEL BATCH PROCESSING
// =============================================================================

/**
 * Generate summaries for all entities bottom-up with parallel processing
 * @param {object} options - Processing options
 * @param {number} options.concurrency - Max concurrent LLM calls (default: 5)
 * @param {boolean} options.verbose - Enable verbose logging
 * @param {boolean} options.dryRun - Preview without making changes
 * @param {boolean} options.skipEmbeddings - Skip embedding generation (default: true)
 *   Note: Summary embeddings are NOT used in search (see file header comment).
 *   Set to false only if future hybrid search over summaries is implemented.
 * @param {string} options.dbPath - Database path (defaults to DB_PATHS.codeGraph)
 * @returns {Promise<{generated: number, skipped: number, duration: number}>}
 */
async function generateAllSummaries(options = {}) {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    verbose = false,
    dryRun = false,
    skipEmbeddings = true,  // Default true: summary embeddings not used in search
    dbPath = DB_PATHS.codeGraph,
    embedFn = null,         // Injected: (text) => Promise<{embedding: Float32Array}>
  } = options;

  const startTime = Date.now();
  console.log('HCGS: Starting hierarchical summary generation...');

  // Detect available provider
  const provider = await getSummaryProvider();
  console.log(`HCGS: Using provider: ${provider.name} (concurrency: ${concurrency})`);

  // Log embedding skip status
  if (skipEmbeddings) {
    console.log('HCGS: Skipping summary embeddings (not used in search, saves API calls)');
  }

  // Get entities ordered by hierarchy level (deepest first)
  const entities = await getEntitiesNeedingSummary(dbPath);

  if (entities.length === 0) {
    console.log('HCGS: No entities without summaries found');
    return { generated: 0, skipped: 0, duration: 0 };
  }

  console.log(`HCGS: Found ${entities.length} entities to summarize`);

  // Group entities by hierarchy level
  const byLevel = new Map();
  for (const entity of entities) {
    const level = entity.hierarchy_level ?? HIERARCHY_LEVELS[entity.type] ?? 1;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(entity);
  }

  // Process levels in order (deepest first = highest number first)
  const levels = [...byLevel.keys()].sort((a, b) => b - a);

  // Cache for child summaries (for parent aggregation)
  // Maps entity.id -> { name, type, summary, parentId }
  const summaryCache = new Map();

  // Index for O(1) parent->children lookup (replaces O(N^2) scanning)
  // Maps parentId -> [childId1, childId2, ...]
  const childrenByParent = new Map();

  // Pending summaries to batch-store
  let pendingBatch = [];

  // Statistics
  let generated = 0;
  let skipped = 0;
  let totalProcessed = 0;

  // Create concurrency limiter
  const limit = pLimit(concurrency);

  for (const level of levels) {
    const entitiesAtLevel = byLevel.get(level);
    console.log(`HCGS: Processing level ${level} (${entitiesAtLevel.length} entities)...`);

    // Process all entities at this level in parallel (within concurrency limit)
    const results = await Promise.all(
      entitiesAtLevel.map((entity) =>
        limit(async () => {
          // Get child summaries from index (O(1) lookup via childrenByParent map)
          const childSummaries = [];
          if (entity.id) {
            const childIds = childrenByParent.get(entity.id) || [];
            for (const childId of childIds) {
              const cached = summaryCache.get(childId);
              if (cached) {
                childSummaries.push({
                  name: cached.name,
                  type: cached.type,
                  summary: cached.summary,
                });
              }
            }
          }

          if (verbose) {
            console.log(`  Summarizing ${entity.type}: ${entity.name}`);
          }

          // Generate summary
          let result;
          if (dryRun) {
            result = {
              summary: generateStaticSummary(entity),
              provider: 'static (dry-run)',
            };
          } else {
            result = await generateEntitySummary(entity, childSummaries);
          }

          if (!result.summary) {
            return { entity, success: false };
          }

          // Cache for parent aggregation
          summaryCache.set(entity.id, {
            name: entity.name,
            type: entity.type,
            summary: result.summary,
            parentId: entity.parent_id,
          });

          // Index this entity under its parent for O(1) child lookup
          if (entity.parent_id) {
            if (!childrenByParent.has(entity.parent_id)) {
              childrenByParent.set(entity.parent_id, []);
            }
            childrenByParent.get(entity.parent_id).push(entity.id);
          }

          // Generate embedding if not skipped
          // summary_embedding is stored as binary (Uint8Array) for space efficiency
          let embedding = null;
          if (!dryRun && !skipEmbeddings && embedFn) {
            try {
              const embeddingResult = await embedFn(result.summary);
              // embedFn returns { embedding: Float32Array, ... }
              // floatToBinary expects the float array, not the wrapper object
              if (embeddingResult?.embedding) {
                embedding = floatToBinary(embeddingResult.embedding);
              }
            } catch (embErr) {
              // Skip embedding if it fails
              if (verbose) {
                console.log(`    Warning: Embedding failed for ${entity.name}: ${embErr.message}`);
              }
            }
          }

          return {
            entity,
            success: true,
            summary: result.summary,
            embedding,
            provider: result.provider,
          };
        })
      )
    );

    // Process results and batch-store
    for (const result of results) {
      totalProcessed++;

      if (!result.success) {
        skipped++;
        continue;
      }

      generated++;

      if (!dryRun) {
        pendingBatch.push({
          id: result.entity.id,
          summary: result.summary,
          embedding: result.embedding,
        });

        // Store in batches
        if (pendingBatch.length >= BATCH_STORAGE_SIZE) {
          try {
            await storeSummariesBatch(dbPath, pendingBatch);
          } catch (err) {
            console.error(`  Error storing batch: ${err.message}`);
          }
          pendingBatch = [];
        }
      }

      // Progress reporting
      if (totalProcessed % PROGRESS_INTERVAL === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (totalProcessed / (Date.now() - startTime) * 1000).toFixed(1);
        console.log(`HCGS: Processed ${totalProcessed}/${entities.length} entities (${rate}/s, ${elapsed}s elapsed)`);
      }
    }
  }

  // Store any remaining pending summaries
  if (!dryRun && pendingBatch.length > 0) {
    try {
      await storeSummariesBatch(dbPath, pendingBatch);
    } catch (err) {
      console.error(`  Error storing final batch: ${err.message}`);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`HCGS: Generated ${generated} summaries, skipped ${skipped} (${(duration / 1000).toFixed(1)}s)`);

  return { generated, skipped, duration };
}

/**
 * Generate summaries for specific entities by ID
 * @param {number[]} entityIds - Entity IDs to summarize
 * @param {object} options - Processing options
 */
async function generateSummariesForEntities(entityIds, options = {}) {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    dbPath = DB_PATHS.codeGraph,
    skipEmbeddings = true,  // Default true: summary embeddings not used in search
  } = options;

  const Database = (await import('better-sqlite3')).default;
  const { applyReadPragmas } = await import('../infrastructure/db-utils.js');
  const db = new Database(dbPath, { readonly: true });
  applyReadPragmas(db);

  try {
    // Fetch entities by IDs
    const placeholders = entityIds.map(() => '?').join(',');
    const entities = db.prepare(`
      SELECT id, file_path, type, name, signature, doc_comment, parent_id, hierarchy_level
      FROM entities
      WHERE id IN (${placeholders})
      ORDER BY hierarchy_level DESC, type, name
    `).all(...entityIds);

    db.close();

    if (entities.length === 0) {
      console.log('HCGS: No matching entities found');
      return { generated: 0, skipped: 0 };
    }

    console.log(`HCGS: Generating summaries for ${entities.length} specific entities`);

    // Reuse main generation logic with filtered entities
    // For simplicity, mark these entities as needing summary and run generation
    const dbWrite = new Database(dbPath);
    const stmt = dbWrite.prepare(`UPDATE entities SET summary = NULL WHERE id = ?`);

    for (const entity of entities) {
      stmt.run(entity.id);
    }

    dbWrite.close();

    return await generateAllSummaries({ concurrency, dbPath, skipEmbeddings });
  } catch (err) {
    db.close();
    throw err;
  }
}

/**
 * Generate summaries for entities in specific files.
 * This is the targeted entry point for incremental indexing.
 *
 * Workflow:
 * 1. Mark entities in specified files for regeneration (summary = NULL)
 * 2. Run generateAllSummaries which will only process NULL-summary entities
 * 3. Unchanged files' entities retain their existing summaries
 *
 * @param {string[]} filePaths - File paths whose entities need regeneration
 * @param {object} options - Processing options
 * @param {string} [options.dbPath] - Database path (defaults to DB_PATHS.codeGraph)
 * @param {number} [options.concurrency] - Max concurrent LLM calls
 * @param {boolean} [options.skipEmbeddings] - Skip embedding generation
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @returns {Promise<{generated: number, skipped: number, marked: number, duration: number}>}
 */
async function generateSummariesForFiles(filePaths, options = {}) {
  const {
    dbPath = DB_PATHS.codeGraph,
    concurrency = DEFAULT_CONCURRENCY,
    skipEmbeddings = true,  // Default true: summary embeddings not used in search
    verbose = false,
  } = options;

  if (!filePaths || filePaths.length === 0) {
    console.log('HCGS: No files specified for summary regeneration');
    return { generated: 0, skipped: 0, marked: 0, duration: 0 };
  }

  const startTime = Date.now();
  console.log(`HCGS: Regenerating summaries for ${filePaths.length} files...`);

  // Step 1: Mark entities in specified files for regeneration
  const { markForRegeneration } = await import('./summary-manager.js');  // intra-graph
  const markResult = await markForRegeneration(dbPath, filePaths);

  if (markResult.marked === 0) {
    console.log('HCGS: No entities found in specified files');
    return { generated: 0, skipped: 0, marked: 0, duration: Date.now() - startTime };
  }

  console.log(`HCGS: Marked ${markResult.marked} entities for regeneration`);

  // Step 2: Run summary generation (only processes NULL-summary entities)
  const result = await generateAllSummaries({
    dbPath,
    concurrency,
    skipEmbeddings,
    verbose,
  });

  return {
    ...result,
    marked: markResult.marked,
  };
}

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Get summary statistics (delegates to summary-manager)
 * @param {string} dbPath - Database path
 * @returns {Promise<object>}
 */
async function getStats(dbPath = DB_PATHS.codeGraph) {
  return getSummaryStats(dbPath);
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'generate';

  // Parse options
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const skipEmbeddings = args.includes('--no-embeddings');

  // Parse concurrency
  let concurrency = DEFAULT_CONCURRENCY;
  const concurrencyArg = args.find(a => a.startsWith('--concurrency='));
  if (concurrencyArg) {
    concurrency = parseInt(concurrencyArg.split('=')[1], 10) || DEFAULT_CONCURRENCY;
  }

  const dbPath = DB_PATHS.codeGraph;

  try {
    switch (command) {
      case 'generate':
      case 'gen': {
        if (skipEmbeddings) {
          console.log('Info: Skipping embedding generation for faster processing.');
        }

        // Lazy-load embedding function only when embeddings are needed
        let embedFn = null;
        if (!skipEmbeddings) {
          const { getEmbedding } = await import('../embedding/embedding-service.js');
          embedFn = getEmbedding;
        }

        await generateAllSummaries({
          concurrency,
          verbose,
          dryRun,
          skipEmbeddings,
          embedFn,
          dbPath,
        });

        break;
      }

      case 'stats': {
        const stats = await getStats(dbPath);
        console.log('\nHCGS Summary Statistics:');
        console.log('========================');
        console.log(`Total entities: ${stats.total}`);
        console.log(`With summary: ${stats.withSummary} (${stats.total > 0 ? ((stats.withSummary / stats.total) * 100).toFixed(1) : 0}%)`);
        console.log(`Without summary: ${stats.withoutSummary}`);
        console.log('\nBy type:');
        for (const [type, data] of Object.entries(stats.byType)) {
          const pct = data.total > 0 ? ((data.withSummary / data.total) * 100).toFixed(0) : 0;
          console.log(`  ${type}: ${data.withSummary}/${data.total} (${pct}%)`);
        }
        break;
      }

      case 'clear': {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(dbPath);
        db.exec(`UPDATE entities SET summary = NULL, summary_embedding = NULL`);
        db.close();
        console.log('HCGS: All summaries cleared');
        break;
      }

      case 'test': {
        // Test summary generation on a single entity
        const Database = (await import('better-sqlite3')).default;
        const { applyReadPragmas: applyRP } = await import('../infrastructure/db-utils.js');
        const db = new Database(dbPath, { readonly: true });
        applyRP(db);

        const entity = db.prepare(`
          SELECT id, file_path, type, name, signature, doc_comment
          FROM entities
          WHERE type = 'method'
          LIMIT 1
        `).get();

        db.close();

        if (entity) {
          console.log(`Testing summary generation for: ${entity.name}`);
          console.log(`Signature: ${entity.signature || '(none)'}`);
          console.log(`Doc: ${entity.doc_comment?.slice(0, 100) || '(none)'}`);

          const result = await generateEntitySummary(entity, []);
          console.log(`\nGenerated summary (${result.provider}): ${result.summary}`);
        } else {
          console.log('No entities found to test');
        }
        break;
      }

      default:
        console.log(`
HCGS - Hierarchical Code Graph Summary Generator (Parallel Edition)

Usage:
  hcgs-generator.js generate [options]    Generate summaries in parallel
  hcgs-generator.js stats                 Show statistics
  hcgs-generator.js clear                 Clear all summaries
  hcgs-generator.js test                  Test on single entity

Options:
  --concurrency=N    Max concurrent LLM calls (default: 5)
  --dry-run          Preview without making changes
  --verbose, -v      Enable verbose logging
  --no-embeddings    Skip embedding generation for faster processing

Environment:
  CEREBRAS_API_KEY   Cerebras GLM-4.6 (primary, ~1000 tok/s)
  OLLAMA running     Fallback to local Ollama + Qwen2.5-Coder
  (none required)    Falls back to static summaries
        `);
    }
  } catch (err) {
    console.error('Error:', err.message);
    if (verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Exported for stub CLI forwarding during DDD migration
export { main as _cliMain };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export {
  generateEntitySummary,
  generateAllSummaries,
  generateSummariesForEntities,
  generateSummariesForFiles,
  getStats as getSummaryStats,
  buildSummaryPrompt,
  getTokenLimitForType,
  HIERARCHY_LEVELS,
};
