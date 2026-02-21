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

import Database from 'better-sqlite3';
import { DB_PATHS, PROJECT_ROOT, EMBEDDING_CONFIG } from './config.js';
import { generateEmbeddings, truncateForHNSW } from './embedding-service.js';
import { BinaryVocabulary } from './vocabulary-utils.js';

// ---------------------------------------------------------------------------
// Constants (also consumed by vocab-warmup-orchestrator.js)
// ---------------------------------------------------------------------------

export const DATA_DIR = path.join(PROJECT_ROOT, '.sweet-search');

export const ARTIFACT_PATHS = {
  identifiersBin: path.join(DATA_DIR, 'vocab-identifiers.bin'),
  identifiersMeta: path.join(DATA_DIR, 'vocab-identifiers.meta.json'),
  semanticSeedsBin: path.join(DATA_DIR, 'vocab-semantic-seeds.bin'),
  semanticSeedsMeta: path.join(DATA_DIR, 'vocab-semantic-seeds.meta.json'),
  communities: path.join(DATA_DIR, 'communities.json'),
  dynamicVocab: path.join(DATA_DIR, 'vocab-dynamic.json'),
};

const DEFAULT_TIME_BUDGET_MS = 2000;

// ---------------------------------------------------------------------------
// Re-export orchestrator functions for backward compatibility
// ---------------------------------------------------------------------------

export { runFullWarmup, saveBinaryArtifact } from './vocab-warmup-orchestrator.js';

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

    // SQLite optimization PRAGMAs for warmup
    db.pragma('mmap_size = 30000000000');
    db.pragma('cache_size = -100000');

    // Check FTS5 table exists
    const ftsCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entities_fts'"
    ).get();
    if (!ftsCheck) {
      return { queriesRun: 0, elapsedMs: Math.round(performance.now() - start), skip: 'no FTS5 table' };
    }

    // Optimize FTS5 index
    try {
      db.exec("INSERT INTO entities_fts(entities_fts) VALUES('optimize')");
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }

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

        // Escape FTS5 special chars
        const safeTerm = term.replace(/['"*()]/g, '');
        if (!safeTerm) continue;

        try {
          const row = matchStmt.get(safeTerm);
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
      const idList = matchedIds.slice(0, 20).join(',');
      try {
        db.prepare(
          `SELECT count(*) FROM relationships WHERE source_id IN (${idList})`
        ).get();
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
 * @param {object} [options] - { hnswIndex, dimension }
 * @returns {Promise<{embeddingsGenerated: number, hnswTraversals: number, elapsedMs: number, embeddings: Map}>}
 */
export async function warmSemantic(hubEntities, communityPhrases, options = {}) {
  const start = performance.now();
  const { hnswIndex, dimension } = options;
  let embeddingsGenerated = 0;
  let hnswTraversals = 0;

  // Collect all texts to embed
  const textsToEmbed = [];
  const textLabels = []; // parallel array tracking origin

  // Track A: Hub entity embeddings using enriched text format (F4)
  // Query entity metadata from code-graph.db for scope/type context
  const entityMeta = _loadEntityMetadata(hubEntities);
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
    allEmbeddings = await generateEmbeddings(textsToEmbed);
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
      await searcher.search(query, { mode: 'hybrid', k: 5 });
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

  // Load identifier binary
  const idBinVocab = new BinaryVocabulary();
  let idTerms = [];
  try {
    // BinaryVocabulary uses its own fixed paths, so we load custom paths here
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
          const emb = new Float32Array(buf.buffer, buf.byteOffset + offset, dim);
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
 * @returns {Map<string, {type: string, file_path: string, language: string|null, parentType: string|null, parentSymbol: string|null}>}
 */
export function _loadEntityMetadata(hubEntities) {
  const meta = new Map();
  if (!hubEntities || hubEntities.length === 0) return meta;

  const dbPath = DB_PATHS.codeGraph;
  if (!existsSync(dbPath)) return meta;

  let db;
  try {
    db = new Database(dbPath, { readonly: true, timeout: 5000 });
    // Fetch entity + any parent relationship for scope context
    const stmt = db.prepare(
      `SELECT e.name, e.type, e.file_path,
              p.name AS parent_name, p.type AS parent_type
       FROM entities e
       LEFT JOIN relationships r ON r.source_id = e.id AND r.type IN ('childOf','memberOf','nestedIn')
       LEFT JOIN entities p ON p.id = r.target_id
       WHERE e.name = ? ORDER BY r.type LIMIT 1`
    );
    for (const ent of hubEntities) {
      const term = typeof ent === 'string' ? ent : ent.term;
      if (!term) continue;
      try {
        const row = stmt.get(term);
        if (row) {
          // Infer language from file extension
          const ext = row.file_path ? path.extname(row.file_path).slice(1) : null;
          meta.set(term, {
            type: row.type,
            file_path: row.file_path,
            language: ext || null,
            parentType: row.parent_type || null,
            parentSymbol: row.parent_name || null,
          });
        }
      } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }
  finally { if (db) try { db.close(); } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  } }

  return meta;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// Import runFullWarmup for the default export object.
// This dynamic import pattern avoids issues: the re-export above handles
// named exports, but we need a reference for the default export object.
// We use a lazy getter so the circular dep resolves at call time.
import { runFullWarmup } from './vocab-warmup-orchestrator.js';

export default {
  warmLexical,
  warmSemantic,
  warmHybrid,
  warmFromCache,
  runFullWarmup,
};
