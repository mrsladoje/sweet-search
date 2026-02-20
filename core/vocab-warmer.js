/**
 * Vocabulary Warmer Module (Step 4 of Vocabulary Prewarm)
 *
 * Per-mode warmup functions that exercise caches and indexes with
 * real codebase vocabulary. Three warmup tracks:
 *
 *   warmLexical    – FTS5 page cache via MATCH queries
 *   warmSemantic   – Embedding generation + HNSW traversal
 *   warmHybrid     – Full hybrid pipeline with representative queries
 *   warmFromCache  – Light tier: load cached artifacts, no embedding gen
 *   runFullWarmup  – Heavy tier: mine → detect → rank → warm → persist
 *
 * All functions return timing/stats objects. Failures never crash the caller.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

import { DB_PATHS, PROJECT_ROOT, EMBEDDING_CONFIG } from './config.js';
import { generateEmbeddings, truncateForHNSW } from './embedding-service.js';
import { detectCommunities, computeGraphHash } from './community-detector.js';
import { mineAll } from './vocab-miner.js';
import { rankAll } from './vocab-ranker.js';
import { BinaryVocabulary } from './vocabulary-utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(PROJECT_ROOT, '.sweet-search');

const ARTIFACT_PATHS = {
  identifiersBin: path.join(DATA_DIR, 'vocab-identifiers.bin'),
  identifiersMeta: path.join(DATA_DIR, 'vocab-identifiers.meta.json'),
  semanticSeedsBin: path.join(DATA_DIR, 'vocab-semantic-seeds.bin'),
  semanticSeedsMeta: path.join(DATA_DIR, 'vocab-semantic-seeds.meta.json'),
  communities: path.join(DATA_DIR, 'communities.json'),
  dynamicVocab: path.join(DATA_DIR, 'vocab-dynamic.json'),
};

const DEFAULT_TIME_BUDGET_MS = 2000;

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
    } catch { /* read-only or already optimized */ }

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
        } catch {
          // Invalid FTS5 query syntax — skip
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
      } catch { /* table may not exist */ }
    }
  } catch (err) {
    // Warmup failures are non-fatal
    return { queriesRun, elapsedMs: Math.round(performance.now() - start), error: err.message };
  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
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

  // Track A: Hub entity names
  if (hubEntities && hubEntities.length > 0) {
    for (const ent of hubEntities) {
      const term = typeof ent === 'string' ? ent : ent.term;
      if (term) {
        textsToEmbed.push(term);
        textLabels.push('hub');
      }
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

  // Build a map of text → embedding for persistence
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
      } catch {
        // HNSW traversal failure — non-fatal
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
    } catch {
      // Individual query failures are non-fatal
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
  } catch { /* no cached identifiers */ }

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
  } catch { /* no cached seeds */ }

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
      } catch { break; }
    }
  }

  return {
    fts5Queries,
    hnswTraversals,
    elapsedMs: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// 4e. Full Warmup Orchestrator (Heavy Tier)
// ---------------------------------------------------------------------------

/**
 * Full warmup pipeline: mine → detect communities → rank → warm → persist.
 *
 * @param {object} [options]
 * @param {'light'|'medium'|'deep'} [options.depth='medium']
 * @param {number} [options.top=1000]
 * @param {string[]} [options.modes=['lexical','semantic','hybrid']]
 * @param {boolean} [options.incremental=true]
 * @param {boolean} [options.dryRun=false]
 * @param {object} [options.hnswIndex] - HNSW index instance for semantic traversal
 * @param {object} [options.searcher] - SweetSearch instance for hybrid warmup
 * @returns {Promise<{terms: number, phrases: number, communities: number, timing: object}>}
 */
export async function runFullWarmup(options = {}) {
  const start = performance.now();
  const depth = options.depth || 'medium';
  const top = options.top || 1000;
  const modes = options.modes || ['lexical', 'semantic'];
  const incremental = options.incremental !== false;
  const dryRun = options.dryRun || false;

  const timing = {};
  const dbPath = DB_PATHS.codeGraph;

  // -----------------------------------------------------------------------
  // Step 1: Detect communities (or load cached if incremental + unchanged)
  // -----------------------------------------------------------------------
  let communities = [];
  let graphHash = '';

  const commStart = performance.now();
  try {
    let useCached = false;
    if (incremental && existsSync(ARTIFACT_PATHS.communities)) {
      const cached = JSON.parse(await fs.readFile(ARTIFACT_PATHS.communities, 'utf-8'));
      if (cached.graphHash && existsSync(dbPath)) {
        const currentHash = computeGraphHash(dbPath);
        if (currentHash === cached.graphHash) {
          communities = cached.communities || [];
          graphHash = cached.graphHash;
          useCached = true;
        }
      }
    }

    if (!useCached && existsSync(dbPath)) {
      const result = detectCommunities(dbPath, { timeoutMs: 3000 });
      communities = result.communities || [];
      graphHash = result.graphHash;
    }
  } catch (err) {
    // Community detection failure is non-fatal
    communities = [];
  }
  timing.communities = Math.round(performance.now() - commStart);

  // -----------------------------------------------------------------------
  // Step 2: Mine terms
  // -----------------------------------------------------------------------
  const mineStart = performance.now();
  let minedResult;
  try {
    minedResult = mineAll(PROJECT_ROOT, dbPath, communities, {
      deep: depth === 'deep',
    });
  } catch {
    minedResult = { terms: [], pageRankScores: new Map(), communityPhrases: [] };
  }
  timing.mining = Math.round(performance.now() - mineStart);

  // -----------------------------------------------------------------------
  // Step 3: Rank
  // -----------------------------------------------------------------------
  const rankStart = performance.now();
  let ranked;
  try {
    ranked = rankAll(
      minedResult.terms,
      minedResult.communityPhrases,
      minedResult.pageRankScores,
      { depth, topN: top }
    );
  } catch {
    ranked = { identifiers: [], phrases: [], stats: {} };
  }
  timing.ranking = Math.round(performance.now() - rankStart);

  // -----------------------------------------------------------------------
  // Dry run: return stats without warming
  // -----------------------------------------------------------------------
  if (dryRun) {
    return {
      terms: ranked.identifiers.length,
      phrases: ranked.phrases.length,
      communities: communities.length,
      timing,
      dryRun: true,
      stats: ranked.stats,
    };
  }

  // -----------------------------------------------------------------------
  // Step 4: Warm each requested mode
  // -----------------------------------------------------------------------

  // Partition identifiers by warm_mode
  const lexicalTerms = ranked.identifiers.filter(
    i => i.warm_mode === 'lexical' || i.warm_mode === 'both'
  );
  const semanticTerms = ranked.identifiers.filter(
    i => i.warm_mode === 'both'
  );

  // 4a. Lexical warmup
  if (modes.includes('lexical')) {
    const lexStart = performance.now();
    try {
      await warmLexical(lexicalTerms);
    } catch { /* non-fatal */ }
    timing.lexical = Math.round(performance.now() - lexStart);
  }

  // 4b. Semantic warmup
  let semanticEmbeddings = new Map();
  if (modes.includes('semantic')) {
    const semStart = performance.now();
    try {
      const semResult = await warmSemantic(
        semanticTerms,
        ranked.phrases,
        { hnswIndex: options.hnswIndex }
      );
      if (semResult.embeddings) {
        semanticEmbeddings = semResult.embeddings;
      }
    } catch { /* non-fatal */ }
    timing.semantic = Math.round(performance.now() - semStart);
  }

  // 4c. Hybrid warmup (select representative queries from phrases)
  if (modes.includes('hybrid') && options.searcher) {
    const hybStart = performance.now();
    try {
      // Select top 10-20 representative queries, weighted by community size
      const repQueries = ranked.phrases.slice(0, 15).map(p => ({
        query: p.phrase,
        communityId: p.communityId,
      }));
      await warmHybrid(repQueries, options.searcher);
    } catch { /* non-fatal */ }
    timing.hybrid = Math.round(performance.now() - hybStart);
  }

  // -----------------------------------------------------------------------
  // Step 5: Persist artifacts
  // -----------------------------------------------------------------------
  const persistStart = performance.now();
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Persist communities.json
    await fs.writeFile(ARTIFACT_PATHS.communities, JSON.stringify({
      graphHash,
      communities,
      createdAt: new Date().toISOString(),
    }));

    // Persist vocab-dynamic.json (full ranked term list)
    await fs.writeFile(ARTIFACT_PATHS.dynamicVocab, JSON.stringify({
      identifiers: ranked.identifiers,
      phrases: ranked.phrases,
      stats: ranked.stats,
      depth,
      createdAt: new Date().toISOString(),
    }));

    // Persist identifier embeddings as binary (if we generated any)
    if (semanticEmbeddings.size > 0) {
      // Split hub entities and phrases into separate bins
      const hubEmbeddings = new Map();
      const phraseEmbeddings = new Map();

      for (const [text, emb] of semanticEmbeddings) {
        // If text matches a hub entity term, put in identifiers bin
        const isHub = semanticTerms.some(
          t => (typeof t === 'string' ? t : t.term) === text
        );
        if (isHub) {
          hubEmbeddings.set(text, emb);
        } else {
          phraseEmbeddings.set(text, emb);
        }
      }

      if (hubEmbeddings.size > 0) {
        await saveBinaryArtifact(
          ARTIFACT_PATHS.identifiersBin,
          ARTIFACT_PATHS.identifiersMeta,
          hubEmbeddings
        );
      }

      if (phraseEmbeddings.size > 0) {
        await saveBinaryArtifact(
          ARTIFACT_PATHS.semanticSeedsBin,
          ARTIFACT_PATHS.semanticSeedsMeta,
          phraseEmbeddings
        );
      }
    }
  } catch (err) {
    // Persistence failure is non-fatal
    timing.persistError = err.message;
  }
  timing.persist = Math.round(performance.now() - persistStart);
  timing.total = Math.round(performance.now() - start);

  return {
    terms: ranked.identifiers.length,
    phrases: ranked.phrases.length,
    communities: communities.length,
    timing,
    stats: ranked.stats,
  };
}

// ---------------------------------------------------------------------------
// Binary Artifact Persistence
// ---------------------------------------------------------------------------

/**
 * Save embeddings as a binary artifact + JSON metadata sidecar.
 *
 * Binary format:
 *   Header (32 bytes): "SSWV" magic, version(u32), dimension(u32), count(u32), 20 bytes padding
 *   Body: count * dimension * 4 bytes (Float32Array)
 *
 * Meta JSON: { version, dimension, termCount, terms: [...], createdAt }
 *
 * @param {string} binPath
 * @param {string} metaPath
 * @param {Map<string, Array<number>|Float32Array>} embeddingMap
 */
async function saveBinaryArtifact(binPath, metaPath, embeddingMap) {
  const terms = [...embeddingMap.keys()];
  if (terms.length === 0) return;

  // Determine dimension from first embedding
  const firstEmb = embeddingMap.get(terms[0]);
  const dimension = Math.min(firstEmb.length, EMBEDDING_CONFIG.hnswDimension || 512);

  // Header: 32 bytes
  const header = Buffer.alloc(32);
  Buffer.from('SSWV').copy(header, 0);       // magic
  header.writeUInt32LE(1, 4);                 // version
  header.writeUInt32LE(dimension, 8);         // dimension
  header.writeUInt32LE(terms.length, 12);     // count
  // bytes 16-31: padding (zeros)

  // Body: embeddings
  const body = Buffer.alloc(terms.length * dimension * 4);
  for (let i = 0; i < terms.length; i++) {
    const emb = embeddingMap.get(terms[i]);
    const offset = i * dimension * 4;
    for (let j = 0; j < dimension; j++) {
      body.writeFloatLE(emb[j] || 0, offset + j * 4);
    }
  }

  const fullBuffer = Buffer.concat([header, body]);
  await fs.mkdir(path.dirname(binPath), { recursive: true });
  await fs.writeFile(binPath, fullBuffer);

  // Write metadata sidecar
  await fs.writeFile(metaPath, JSON.stringify({
    version: 1,
    dimension,
    termCount: terms.length,
    terms,
    createdAt: new Date().toISOString(),
  }, null, 2));
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
