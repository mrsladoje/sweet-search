/**
 * Vocabulary Warmer Module (Step 4 of Vocabulary Prewarm)
 *
 * Per-mode warmup functions that exercise caches and indexes with
 * real codebase vocabulary. Three warmup tracks:
 *
 *   warmLexical    - FTS5 page cache via MATCH queries
 *   warmSemantic   - Embedding generation + HNSW traversal
 *   warmHybrid     - Full hybrid pipeline with representative queries
 *   warmFromCache  - Light tier: load cached artifacts, no embedding gen
 *
 * The heavy-tier orchestrator (runFullWarmup, saveBinaryArtifact) lives in
 * ./vocab-warmup-orchestrator.js and is re-exported here for backward compat.
 *
 * All functions return timing/stats objects. Failures never crash the caller.
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { applyReadPragmas } from '../infrastructure/db-utils.js';

import Database from 'better-sqlite3';
import { DB_PATHS, EMBEDDING_CONFIG } from '../infrastructure/config/index.js';
import { generateEmbeddings, truncateForHNSW } from '../embedding/embedding-service.js';

// ---------------------------------------------------------------------------
// Constants — imported from vocab-constants.js (shared with orchestrator,
// no circular dependency).  Re-exported for backward compatibility.
// ---------------------------------------------------------------------------

import { DATA_DIR, ARTIFACT_PATHS } from './vocab-constants.js';
export { DATA_DIR, ARTIFACT_PATHS };

const DEFAULT_TIME_BUDGET_MS = 2000;

// ---------------------------------------------------------------------------
// Backward-compatible orchestrator wrappers.
// Dynamic import avoids a static warmup-orchestrator <-> warmer cycle.
// ---------------------------------------------------------------------------

export async function runFullWarmup(options = {}) {
  const mod = await import('./vocab-warmup-orchestrator.js');
  return mod.runFullWarmup(options);
}

export async function saveBinaryArtifact(binPath, metaPath, embeddingMap) {
  const mod = await import('./vocab-warmup-orchestrator.js');
  return mod.saveBinaryArtifact(binPath, metaPath, embeddingMap);
}

// ---------------------------------------------------------------------------
// 4a. Lexical Warmup
// ---------------------------------------------------------------------------

/**
 * Warm FTS5 page cache by executing MATCH queries with real codebase identifiers.
 *
 * @param {Array<{term: string, score: number}>} terms - PageRank-ranked identifiers
 * @param {string} [dbPath] - Path to code-graph.db
 * @returns {Promise<{queriesRun: number, elapsedMs: number}>}
 */
export async function warmLexical(terms, dbPath) {
  const start = performance.now();
  const resolvedPath = dbPath || DB_PATHS.codeGraph;
  let queriesRun = 0;

  if (!terms || terms.length === 0 || !existsSync(resolvedPath)) {
    return { queriesRun: 0, elapsedMs: Math.round(performance.now() - start) };
  }

  let db;
  try {
    db = new Database(resolvedPath, { readonly: true, timeout: 5000 });
    applyReadPragmas(db);

    // Check FTS5 table exists
    const ftsCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entities_fts'"
    ).get();
    if (!ftsCheck) {
      return { queriesRun: 0, elapsedMs: Math.round(performance.now() - start), skip: 'no FTS5 table' };
    }

    // Keep warmup read-only; skip FTS5 optimize (write operation).

    // Prepare statements
    const matchStmt = db.prepare(
      'SELECT rowid FROM entities_fts WHERE name MATCH ? LIMIT 1'
    );

    // Run MATCH queries in a read transaction for top-N terms
    const topTerms = terms.slice(0, 50);
    const matchedIds = [];

    const runQueries = db.transaction(() => {
      for (const entry of topTerms) {
        const term = typeof entry === 'string' ? entry : entry.term;
        if (!term || term.length < 2) continue;

        // Wrap in FTS5 double-quoted phrase to neutralise all operator chars
        // (AND, OR, NOT, NEAR, -, +, ^, etc.). Internal double-quotes are
        // escaped by doubling them per the FTS5 string-literal spec.
        const safeTerm = term.replace(/"/g, '""'); // escape internal quotes for FTS5
        if (!safeTerm) continue;

        try {
          const row = matchStmt.get('"' + safeTerm + '"');
          queriesRun++;
          if (row) matchedIds.push(row.rowid);
        } catch (err) {
          if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
        }

        // Time budget check
        if (performance.now() - start > DEFAULT_TIME_BUDGET_MS) break;
      }
    });

    runQueries();

    // Touch relationship table to warm join pages
    if (matchedIds.length > 0) {
      const subset = matchedIds.slice(0, 20);
      const placeholders = subset.map(() => '?').join(',');
      try {
        db.prepare(
          `SELECT count(*) FROM relationships WHERE source_id IN (${placeholders})`
        ).get(...subset);
      } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
    }
  } catch (err) {
    // Warmup failures are non-fatal
    return { queriesRun, elapsedMs: Math.round(performance.now() - start), error: err.message };
  } finally {
    if (db) try { db.close(); } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
  }

  return { queriesRun, elapsedMs: Math.round(performance.now() - start) };
}

// ---------------------------------------------------------------------------
// 4b. Semantic Warmup
// ---------------------------------------------------------------------------

/**
 * Pre-compute embeddings for hub entities and community phrases, warm HNSW.
 *
 * Track A: Hub entity embeddings (enrichEmbeddingText format)
 * Track B: Community phrase + question variant embeddings
 *
 * @param {Array<{term: string}>} hubEntities - High-PageRank entities (warm_mode "both")
 * @param {Array<{phrase: string, variants?: string[]}>} communityPhrases
 * @param {object} [options] - { hnswIndex, dimension, provider, db }
 * @param {string} [options.provider] - Embedding provider override (passed to generateEmbeddings)
 * @param {import('better-sqlite3').Database} [options.db] - Pre-opened code-graph.db to reuse
 * @returns {Promise<{embeddingsGenerated: number, hnswTraversals: number, elapsedMs: number, embeddings: Map}>}
 */
export async function warmSemantic(hubEntities, communityPhrases, options = {}) {
  const start = performance.now();
  const { hnswIndex, dimension, provider, db } = options;
  let embeddingsGenerated = 0;
  let hnswTraversals = 0;

  // Collect all texts to embed
  const textsToEmbed = [];
  const textLabels = []; // parallel array tracking origin

  // Track A: Hub entity embeddings using enriched text format (F4)
  // Query entity metadata from code-graph.db for scope/type context
  const entityMeta = _loadEntityMetadata(hubEntities, { db });
  if (hubEntities && hubEntities.length > 0) {
    for (const ent of hubEntities) {
      const term = typeof ent === 'string' ? ent : ent.term;
      if (!term) continue;
      const meta = entityMeta.get(term);
      // F4: Build enriched text matching indexer's enrichEmbeddingText() output
      // Format: # file_path \n # Scope: parent > symbol \n # Defines: type symbol
      const parts = [];
      if (meta) {
        if (meta.file_path) parts.push(`# ${meta.file_path}`);
        if (meta.parentSymbol) {
          parts.push(`# Scope: ${meta.parentType || 'unknown'} ${meta.parentSymbol} > ${term}`);
        }
        parts.push(`# Defines: ${meta.type || 'symbol'} ${term}`);
        if (meta.language) parts.push(`# Language: ${meta.language}`);
      }
      parts.push(term);
      const enrichedText = parts.join('\n');
      textsToEmbed.push(enrichedText);
      textLabels.push('hub');
    }
  }

  // Track B: Community phrases + variants
  if (communityPhrases && communityPhrases.length > 0) {
    for (const cp of communityPhrases) {
      const phrase = typeof cp === 'string' ? cp : cp.phrase;
      if (phrase) {
        textsToEmbed.push(phrase);
        textLabels.push('phrase');
      }
      // Also embed question variants
      const variants = cp.variants || [];
      for (const v of variants) {
        textsToEmbed.push(v);
        textLabels.push('variant');
      }
    }
  }

  if (textsToEmbed.length === 0) {
    return { embeddingsGenerated: 0, hnswTraversals: 0, elapsedMs: Math.round(performance.now() - start) };
  }

  // Generate embeddings (provider-agnostic via embedding-service)
  let allEmbeddings;
  try {
    allEmbeddings = provider
      ? await generateEmbeddings(textsToEmbed, provider)
      : await generateEmbeddings(textsToEmbed);
    embeddingsGenerated = allEmbeddings.length;
  } catch (err) {
    return {
      embeddingsGenerated: 0,
      hnswTraversals: 0,
      elapsedMs: Math.round(performance.now() - start),
      error: err.message,
    };
  }

  // Build a map of text -> embedding for persistence
  const embeddingMap = new Map();
  for (let i = 0; i < textsToEmbed.length; i++) {
    if (allEmbeddings[i]) {
      embeddingMap.set(textsToEmbed[i], allEmbeddings[i]);
    }
  }

  // Warm HNSW traversal paths if index is available
  if (hnswIndex && typeof hnswIndex.search === 'function') {
    const hnswDim = dimension || EMBEDDING_CONFIG.hnswDimension;
    for (const emb of allEmbeddings) {
      if (!emb) continue;
      try {
        const truncated = emb.length > hnswDim ? truncateForHNSW(emb) : emb;
        await hnswIndex.search(truncated, 10);
        hnswTraversals++;
      } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
    }
  }

  return {
    embeddingsGenerated,
    hnswTraversals,
    elapsedMs: Math.round(performance.now() - start),
    embeddings: embeddingMap,
  };
}

// ---------------------------------------------------------------------------
// 4c. Hybrid Warmup
// ---------------------------------------------------------------------------

/**
 * Exercise the full hybrid pipeline with representative queries.
 *
 * @param {Array<{query: string, communityId?: number}>} representativeQueries - 10-20 queries
 * @param {object} [searcher] - SweetSearch instance (must be pre-initialized)
 * @returns {Promise<{queriesRun: number, elapsedMs: number}>}
 */
export async function warmHybrid(representativeQueries, searcher) {
  const start = performance.now();
  let queriesRun = 0;

  if (!representativeQueries || representativeQueries.length === 0) {
    return { queriesRun: 0, elapsedMs: Math.round(performance.now() - start) };
  }

  if (!searcher || typeof searcher.search !== 'function') {
    return { queriesRun: 0, elapsedMs: Math.round(performance.now() - start), skip: 'no searcher' };
  }

  for (const entry of representativeQueries) {
    const query = typeof entry === 'string' ? entry : entry.query;
    if (!query) continue;

    try {
      const result = await Promise.race([
        searcher.search(query, { mode: 'hybrid', k: 5 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('query timeout')), 5000)),
      ]);
      void result; // consumed for side-effect (cache warm); suppress unused-var linters
      queriesRun++;
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }

    // Don't let hybrid warmup run too long
    if (performance.now() - start > 30_000) break;
  }

  return { queriesRun, elapsedMs: Math.round(performance.now() - start) };
}

// ---------------------------------------------------------------------------
// 4d. Cache-Based Warmup (Light Tier)
// ---------------------------------------------------------------------------

/**
 * Light warmup: load cached binary artifacts and warm FTS5/HNSW without
 * generating new embeddings. Called during session preheat.
 *
 * @param {object} [options]
 * @param {number} [options.maxFts5Queries=50]
 * @param {number} [options.maxHnswTraversals=100]
 * @param {object} [options.hnswIndex] - HNSW index instance for traversal
 * @returns {Promise<{fts5Queries: number, hnswTraversals: number, elapsedMs: number}>}
 */
export async function warmFromCache(options = {}) {
  const start = performance.now();
  const maxFts5 = options.maxFts5Queries ?? 50;
  const maxHnsw = options.maxHnswTraversals ?? 100;
  let fts5Queries = 0;
  let hnswTraversals = 0;

  // Load identifier binary metadata
  let idTerms = [];
  try {
    if (existsSync(ARTIFACT_PATHS.identifiersBin) && existsSync(ARTIFACT_PATHS.identifiersMeta)) {
      const meta = JSON.parse(await fs.readFile(ARTIFACT_PATHS.identifiersMeta, 'utf-8'));
      idTerms = meta.terms || [];
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }

  // Load semantic seeds binary
  let seedEmbeddings = [];
  try {
    if (existsSync(ARTIFACT_PATHS.semanticSeedsBin) && existsSync(ARTIFACT_PATHS.semanticSeedsMeta)) {
      const meta = JSON.parse(await fs.readFile(ARTIFACT_PATHS.semanticSeedsMeta, 'utf-8'));
      const dim = meta.dimension || 256;
      const buf = await fs.readFile(ARTIFACT_PATHS.semanticSeedsBin);
      const headerSize = 32;
      const count = meta.termCount || 0;

      for (let i = 0; i < Math.min(count, maxHnsw); i++) {
        const offset = headerSize + i * dim * 4;
        if (offset + dim * 4 <= buf.length) {
          // P1.4 FIX: Guard against unaligned byteOffset from Buffer pool.
          const byteOff = buf.byteOffset + offset;
          let emb;
          if (byteOff % 4 === 0) {
            emb = new Float32Array(buf.buffer, byteOff, dim);
          } else {
            const copy = new Uint8Array(dim * 4);
            copy.set(buf.subarray(offset, offset + dim * 4));
            emb = new Float32Array(copy.buffer);
          }
          seedEmbeddings.push(Array.from(emb));
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }

  // Graceful fallback if nothing cached
  if (idTerms.length === 0 && seedEmbeddings.length === 0) {
    return { fts5Queries: 0, hnswTraversals: 0, elapsedMs: Math.round(performance.now() - start), skip: 'no cached artifacts' };
  }

  // FTS5 warmup with cached identifier names
  if (idTerms.length > 0) {
    const lexResult = await warmLexical(
      idTerms.slice(0, maxFts5).map(t => ({ term: t, score: 1 }))
    );
    fts5Queries = lexResult.queriesRun;
  }

  // HNSW traversal with cached embeddings
  const hnswIndex = options.hnswIndex;
  if (hnswIndex && typeof hnswIndex.search === 'function' && seedEmbeddings.length > 0) {
    for (const emb of seedEmbeddings.slice(0, maxHnsw)) {
      try {
        await hnswIndex.search(emb, 10);
        hnswTraversals++;
      } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
        break;
      }
    }
  }

  return {
    fts5Queries,
    hnswTraversals,
    elapsedMs: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * F4: Load entity metadata from code-graph.db for hub entities.
 * Fetches type, file_path, and parent scope info to build enriched
 * embedding text matching the indexer's enrichEmbeddingText() format:
 *   # file_path
 *   # Scope: parent_type > symbol  (or # Defines: type symbol)
 *   # Language: language
 *
 * @param {Array<{term: string}|string>} hubEntities
 * @param {object} [options]
 * @param {import('better-sqlite3').Database} [options.db] - Pre-opened DB to reuse (caller must close)
 * @returns {Map<string, {type: string, file_path: string, language: string|null, parentType: string|null, parentSymbol: string|null}>}
 */
export function _loadEntityMetadata(hubEntities, options = {}) {
  const meta = new Map();
  if (!hubEntities || hubEntities.length === 0) return meta;

  // Collect unique term names for a single batch query.
  const terms = [];
  for (const ent of hubEntities) {
    const term = typeof ent === 'string' ? ent : ent.term;
    if (term) terms.push(term);
  }
  if (terms.length === 0) return meta;

  // Reuse caller's DB connection if provided; otherwise open our own.
  const externalDb = options.db || null;
  let db = externalDb;
  try {
    if (!db) {
      const dbPath = DB_PATHS.codeGraph;
      if (!existsSync(dbPath)) return meta;
      db = new Database(dbPath, { readonly: true, timeout: 5000 });
      applyReadPragmas(db);
    }

    // Batch query: fetch all entities + parent scope in one shot.
    // Chunk into batches of 500 to stay within SQLite variable limits.
    const BATCH_SIZE = 500;
    for (let i = 0; i < terms.length; i += BATCH_SIZE) {
      const batch = terms.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const rows = db.prepare(
        `WITH ranked AS (
           SELECT
             e.name,
             e.type,
             e.file_path,
             p.name AS parent_name,
             p.type AS parent_type,
             ROW_NUMBER() OVER (
               PARTITION BY e.name
               ORDER BY
                 CASE r.type
                   WHEN 'childOf' THEN 1
                   WHEN 'memberOf' THEN 2
                   WHEN 'nestedIn' THEN 3
                   ELSE 4
                 END,
                 COALESCE(p.name, ''),
                 COALESCE(p.type, ''),
                 COALESCE(e.file_path, ''),
                 e.id,
                 COALESCE(p.id, 0)
             ) AS rn
           FROM entities e
           LEFT JOIN relationships r ON r.source_id = e.id AND r.type IN ('childOf','memberOf','nestedIn')
           LEFT JOIN entities p ON p.id = r.target_id
           WHERE e.name IN (${placeholders})
         )
         SELECT name, type, file_path, parent_name, parent_type
         FROM ranked
         WHERE rn = 1`
      ).all(...batch);

      for (const row of rows) {
        const ext = row.file_path ? path.extname(row.file_path).slice(1) : null;
        meta.set(row.name, {
          type: row.type,
          file_path: row.file_path,
          language: ext || null,
          parentType: row.parent_type || null,
          parentSymbol: row.parent_name || null,
        });
      }
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  } finally {
    // Only close if we opened it ourselves
    if (db && !externalDb) {
      try { db.close(); } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
    }
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  warmLexical,
  warmSemantic,
  warmHybrid,
  warmFromCache,
  runFullWarmup,
};
