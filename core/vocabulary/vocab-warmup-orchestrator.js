/**
 * Vocabulary Warmup Orchestrator (Step 4e / 5 of Vocabulary Prewarm)
 *
 * Full warmup pipeline: mine -> detect communities -> rank -> warm -> persist.
 * Extracted from vocab-warmer.js for SOLID single-responsibility.
 *
 * Constants (ARTIFACT_PATHS, DATA_DIR) live in vocab-constants.js — a
 * dependency-free module shared by both this file and vocab-warmer.js.
 * This eliminates the previous circular import between this module and
 * vocab-warmer.js.
 *
 * Two entry points share the steps:
 *   - runFullWarmup: the full build's post-index warmup (and the MCP tool), in process.
 *   - refreshVocabulary: the maintainer's vocab_refresh job. Communities, mining and
 *     ranking (seconds of synchronous work on a large repo) run in a worker thread so the
 *     maintainer keeps reconciling edits; the embeddings go through the caller's encoder.
 */

import { existsSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Worker } from 'worker_threads';

import Database from 'better-sqlite3';
import { PROJECT_ROOT, EMBEDDING_CONFIG } from '../infrastructure/config/index.js';
import { applyReadPragmas } from '../infrastructure/db-utils.js';
import { detectCommunities, computeGraphHash } from '../graph/community-detector.js';
import { mineAll } from './vocab-miner.js';
import { rankAll } from './vocab-ranker.js';
import { warmLexical, warmSemantic, warmHybrid } from './vocab-warmer.js';
import { DATA_DIR, vocabArtifactPaths } from './vocab-constants.js';

function debugCatch(err) {
  if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
}

function resolveDirs(options) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const stateDir = options.stateDir || (options.projectRoot ? path.join(projectRoot, '.sweet-search') : DATA_DIR);
  return { projectRoot, stateDir, paths: vocabArtifactPaths(stateDir), dbPath: path.join(stateDir, 'code-graph.db') };
}

// ---------------------------------------------------------------------------
// 4e. Full Warmup Orchestrator (Heavy Tier)
// ---------------------------------------------------------------------------

/**
 * Full warmup pipeline: mine -> detect communities -> rank -> warm -> persist.
 *
 * @param {object} [options]
 * @param {'light'|'medium'|'deep'} [options.depth='medium']
 * @param {number} [options.top=1000]
 * @param {string[]} [options.modes=['lexical','semantic','hybrid']]
 * @param {boolean} [options.incremental=true]
 * @param {boolean} [options.dryRun=false]
 * @param {object} [options.hnswIndex] - HNSW index instance for semantic traversal
 * @param {object} [options.searcher] - SweetSearch instance for hybrid warmup
 * @param {string} [options.projectRoot] - Repository root (default: the configured one)
 * @param {string} [options.stateDir] - Index directory: code-graph.db is read and the
 *   artifacts are written there (default: <projectRoot>/.sweet-search)
 * @returns {Promise<{terms: number, phrases: number, communities: number, timing: object}>}
 */
export async function runFullWarmup(options = {}) {
  const start = performance.now();
  // P1.2 FIX: Compute effective provider without mutating global EMBEDDING_CONFIG.
  // Provider is passed explicitly through the call chain to generateEmbeddings().
  const effectiveProvider = options.provider || (options.localWarmup ? 'local' : null);
  const modes = options.modes || ['lexical', 'semantic'];
  const { projectRoot, stateDir, paths, dbPath } = resolveDirs(options);

  const computed = computeVocabulary({
    projectRoot, stateDir, depth: options.depth, top: options.top, incremental: options.incremental,
  });
  const { ranked, communityCount, timing } = computed;

  // Dry run: return stats without warming
  if (options.dryRun) {
    return {
      terms: ranked.identifiers.length,
      phrases: ranked.phrases.length,
      communities: communityCount,
      timing,
      dryRun: true,
      stats: ranked.stats,
    };
  }

  // -----------------------------------------------------------------------
  // Step 4: Warm each requested mode
  // -----------------------------------------------------------------------
  const lexicalTerms = ranked.identifiers.filter(
    i => i.warm_mode === 'lexical' || i.warm_mode === 'both'
  );

  // 4a. Lexical warmup
  if (modes.includes('lexical')) {
    const lexStart = performance.now();
    try {
      await warmLexical(lexicalTerms, dbPath);
    } catch (err) {
      debugCatch(err);
    }
    timing.lexical = Math.round(performance.now() - lexStart);
  }

  // 4b. Semantic warmup
  let semanticEmbeddings = new Map();
  if (modes.includes('semantic')) {
    const semStart = performance.now();
    semanticEmbeddings = await embedVocabulary(computed, {
      dbPath,
      hnswIndex: options.hnswIndex,
      provider: effectiveProvider,
    });
    timing.semantic = Math.round(performance.now() - semStart);
  }

  // 4c. Hybrid warmup (select representative queries weighted by community size -- F6)
  if (modes.includes('hybrid') && options.searcher) {
    const hybStart = performance.now();
    try {
      await warmHybrid(representativeQueries(ranked, computed.communitySizes), options.searcher);
    } catch (err) {
      debugCatch(err);
    }
    timing.hybrid = Math.round(performance.now() - hybStart);
  }

  // -----------------------------------------------------------------------
  // Step 5: Persist artifacts
  // -----------------------------------------------------------------------
  const persistStart = performance.now();
  try {
    await persistVocabulary(paths, computed, semanticEmbeddings, { graphEpoch: 0 });
  } catch (err) {
    // Persistence failure is non-fatal
    timing.persistError = err.message;
  }
  timing.persist = Math.round(performance.now() - persistStart);
  timing.total = Math.round(performance.now() - start);

  return {
    terms: ranked.identifiers.length,
    phrases: ranked.phrases.length,
    communities: communityCount,
    timing,
    stats: ranked.stats,
  };
}

/**
 * The maintainer's refresh: compute the vocabulary of the live graph in a worker thread,
 * encode the hub and phrase texts the current artifacts do not hold with `embed`, and
 * publish every artifact by rename. Without `embed` only communities.json (and the state)
 * is written. `graphEpoch` is the graph epoch read before the run.
 *
 * @param {{projectRoot: string, stateDir: string, embed?: Function, graphEpoch?: number,
 *   depth?: string, top?: number}} options
 */
export async function refreshVocabulary(options) {
  const start = performance.now();
  const { projectRoot, stateDir, paths, dbPath } = resolveDirs(options);
  const computed = await computeVocabularyInWorker({
    projectRoot, stateDir, depth: options.depth, top: options.top, incremental: true,
  });
  const { timing } = computed;
  let semanticEmbeddings = new Map();
  if (options.embed) {
    const semStart = performance.now();
    semanticEmbeddings = await embedVocabulary(computed, { dbPath, embed: options.embed });
    timing.semantic = Math.round(performance.now() - semStart);
  }
  const persistStart = performance.now();
  await persistVocabulary(paths, computed, semanticEmbeddings, { graphEpoch: options.graphEpoch ?? 0 });
  timing.persist = Math.round(performance.now() - persistStart);
  timing.total = Math.round(performance.now() - start);
  return {
    terms: computed.ranked.identifiers.length,
    phrases: computed.ranked.phrases.length,
    communities: computed.communityCount,
    encoded: semanticEmbeddings.encoded ?? 0,
    timing,
  };
}

function computeVocabularyInWorker(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./vocab-compute-worker.js', import.meta.url), { workerData: input });
    worker.unref();
    let settled = false;
    worker.once('message', (msg) => {
      settled = true;
      if (msg?.ok) resolve(msg.result);
      else reject(new Error(msg?.error || 'vocabulary worker failed'));
    });
    worker.once('error', (err) => { if (!settled) { settled = true; reject(err); } });
    worker.once('exit', (code) => {
      if (!settled) { settled = true; reject(new Error(`vocabulary worker exited with code ${code}`)); }
    });
  });
}

/**
 * Steps 1-3 and the communities document: detect communities (or reuse them when the
 * graph is unchanged), mine, rank, enrich the communities with their phrases and top
 * entities. Synchronous and self-contained (it runs in the refresh worker); the result is
 * plain data.
 */
export function computeVocabulary(options = {}) {
  const depth = options.depth || 'medium';
  const top = options.top || 1000;
  const incremental = options.incremental !== false;
  const { projectRoot, paths, dbPath } = resolveDirs(options);
  const timing = {};

  let cached = null;
  if (incremental && existsSync(paths.communities)) {
    try { cached = JSON.parse(readFileSync(paths.communities, 'utf-8')); } catch (err) { debugCatch(err); }
  }

  // Step 1: Detect communities (or load cached if incremental + unchanged)
  let communities = [];
  let graphHash = '';
  let relationshipCount = null;
  const commStart = performance.now();
  try {
    let useCached = false;
    if (cached?.graphHash && existsSync(dbPath)) {
      if (computeGraphHash(dbPath) === cached.graphHash) {
        communities = cached.communities || [];
        graphHash = cached.graphHash;
        useCached = true;
      }
    }
    if (!useCached && existsSync(dbPath)) {
      const result = detectCommunities(dbPath, { timeoutMs: 3000 });
      communities = result.communities || [];
      graphHash = result.graphHash;
      relationshipCount = result.relationshipCount ?? null;
    }
  } catch (err) {
    debugCatch(err);
    communities = [];
  }
  timing.communities = Math.round(performance.now() - commStart);

  // Step 2: Mine terms
  const mineStart = performance.now();
  let minedResult;
  try {
    minedResult = mineAll(projectRoot, dbPath, communities, { deep: depth === 'deep' });
  } catch (err) {
    debugCatch(err);
    minedResult = { terms: [], pageRankScores: new Map(), communityPhrases: [] };
  }
  timing.mining = Math.round(performance.now() - mineStart);

  // Step 3: Rank
  const rankStart = performance.now();
  let ranked;
  try {
    ranked = rankAll(
      minedResult.terms,
      minedResult.communityPhrases,
      minedResult.pageRankScores,
      {
        depth,
        topN: top,
        ...(minedResult.totalFiles > 0 ? { totalFiles: minedResult.totalFiles } : {}),
      }
    );
  } catch (err) {
    debugCatch(err);
    ranked = { identifiers: [], phrases: [], stats: {} };
  }
  timing.ranking = Math.round(performance.now() - rankStart);

  // F5: communities.json with phrases[] and topEntities[]
  const enrichedCommunities = communities.map(comm => {
    // Find matching ranked phrases for this community
    const commPhrases = (ranked.phrases || [])
      .filter(p => p.communityId === comm.id)
      .slice(0, 20)
      .map(p => p.phrase);
    // Top entities by score: match ranked identifiers whose term name
    // appears in this community's entity names (from detectCommunities).
    const nameSet = comm.entityNames ? new Set(comm.entityNames.map(n => n.toLowerCase())) : new Set();
    const commTopEntities = nameSet.size > 0
      ? (ranked.identifiers || [])
          .filter(id => nameSet.has(id.term.toLowerCase()))
          .slice(0, 10)
          .map(id => id.term)
      : [];
    return {
      ...comm,
      phrases: commPhrases,
      topEntities: commTopEntities,
    };
  });

  const communitySizes = communities.map(c => [c.id, c.entityCount || c.entityIds?.length || 1]);
  return {
    ranked,
    relationshipCount,
    communityCount: communities.length,
    communitySizes,
    communitiesJson: JSON.stringify({
      graphHash,
      communities: enrichedCommunities,
      createdAt: new Date().toISOString(),
    }),
    timing,
  };
}

/** Hub and phrase embeddings for the semantic artifacts (empty on failure). */
async function embedVocabulary(computed, { dbPath, hnswIndex, provider, embed } = {}) {
  const semanticTerms = computed.ranked.identifiers.filter(i => i.warm_mode === 'both');
  // P0.3 FIX: Open a single shared DB for entity metadata queries
  let sharedDb = null;
  try {
    if (existsSync(dbPath)) {
      sharedDb = new Database(dbPath, { readonly: true, timeout: 5000 });
      applyReadPragmas(sharedDb);
    }
  } catch (err) {
    debugCatch(err);
  }
  try {
    const semResult = await warmSemantic(
      semanticTerms,
      computed.ranked.phrases,
      {
        hnswIndex,
        ...(provider && { provider }),
        ...(sharedDb && { db: sharedDb }),
        ...(embed && { embed }),
        // A text embedded by the previous run is not encoded again.
        reuse: await loadArtifactEmbeddings(vocabArtifactPaths(path.dirname(dbPath))),
      }
    );
    const map = semResult.embeddings || new Map();
    map.encoded = semResult.embeddingsGenerated ?? 0;
    map.hubTexts = semResult.hubTexts || new Map();
    return map;
  } catch (err) {
    debugCatch(err);
    return new Map();
  } finally {
    if (sharedDb) try { sharedDb.close(); } catch (err) { debugCatch(err); }
  }
}

/** F6: top-1 phrase per community weighted by community size, then cross-community fill. */
function representativeQueries(ranked, communitySizes) {
  const commSizeMap = new Map(communitySizes);
  // Sort phrases by community size * score (not just global score)
  const weightedPhrases = (ranked.phrases || []).map(p => ({
    ...p,
    weightedScore: (p.score || 0) * Math.log2(1 + (commSizeMap.get(p.communityId) || 1)),
  }));
  weightedPhrases.sort((a, b) => b.weightedScore - a.weightedScore);

  // Select top-1 phrase per community, then fill remaining slots
  const seenCommunities = new Set();
  const repQueries = [];
  for (const p of weightedPhrases) {
    if (repQueries.length >= 20) break;
    if (!seenCommunities.has(p.communityId)) {
      seenCommunities.add(p.communityId);
      repQueries.push({ query: p.phrase, communityId: p.communityId });
    }
  }
  // Fill remaining slots with cross-community phrases
  for (const p of weightedPhrases) {
    if (repQueries.length >= 20) break;
    if (!repQueries.some(r => r.query === p.phrase)) {
      repQueries.push({ query: p.phrase, communityId: p.communityId });
    }
  }
  return repQueries;
}

/**
 * Write the artifacts. Every file is published by rename, the binaries before
 * communities.json and the state last: readers read each file whole from disk when they
 * use it, so they see the old or the new file.
 */
async function persistVocabulary(paths, computed, semanticEmbeddings, { graphEpoch }) {
  await fs.mkdir(path.dirname(paths.communities), { recursive: true });
  if (semanticEmbeddings.size > 0) {
    // Hub entities go to the identifiers bin under their term (warmFromCache runs the
    // terms as FTS5 queries), with the enriched text that was embedded (the reuse key);
    // phrases and their variants go to the seeds bin under their own text.
    const hubTexts = semanticEmbeddings.hubTexts || new Map();
    const hubEmbeddings = new Map();
    const hubEmbeddedTexts = [];
    const hubTextSet = new Set();
    for (const [term, text] of hubTexts) {
      const emb = semanticEmbeddings.get(text);
      if (!emb) continue;
      hubEmbeddings.set(term, emb);
      hubEmbeddedTexts.push(text);
      hubTextSet.add(text);
    }
    const phraseEmbeddings = new Map();
    for (const [text, emb] of semanticEmbeddings) {
      if (!hubTextSet.has(text)) phraseEmbeddings.set(text, emb);
    }
    if (hubEmbeddings.size > 0) {
      await saveBinaryArtifact(paths.identifiersBin, paths.identifiersMeta, hubEmbeddings, { texts: hubEmbeddedTexts });
    }
    if (phraseEmbeddings.size > 0) {
      await saveBinaryArtifact(paths.semanticSeedsBin, paths.semanticSeedsMeta, phraseEmbeddings);
    }
  }

  await writeFileAtomic(paths.communities, computed.communitiesJson);

  // The maintainer's vocab_refresh watermark compares the graph against this run.
  let liveRelationships = computed.relationshipCount;
  if (liveRelationships === null) {
    try { liveRelationships = JSON.parse(await fs.readFile(paths.state, 'utf-8')).liveRelationships ?? null; } catch { /* first run */ }
  }
  await writeFileAtomic(paths.state, JSON.stringify({
    ranAt: Date.now(),
    graphEpoch: Number.isInteger(graphEpoch) ? graphEpoch : 0,
    liveRelationships,
  }));
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
 * Meta JSON: { version, dimension, termCount, terms: [...], texts?: [...], createdAt }
 * `texts[i]` is the text embedded for `terms[i]` when the two differ (hub entities).
 *
 * @param {string} binPath
 * @param {string} metaPath
 * @param {Map<string, Array<number>|Float32Array>} embeddingMap
 * @param {{texts?: string[]}} [options]
 */
export async function saveBinaryArtifact(binPath, metaPath, embeddingMap, { texts = null } = {}) {
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
  await writeFileAtomic(binPath, fullBuffer);

  // Write metadata sidecar
  await writeFileAtomic(metaPath, JSON.stringify({
    version: 1,
    dimension,
    termCount: terms.length,
    terms,
    ...(texts ? { texts } : {}),
    createdAt: new Date().toISOString(),
  }, null, 2));
}

/** Write by temp file + rename, so a reader never sees a partial file. */
async function writeFileAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * The embeddings stored in the identifier and seed artifacts, by embedded text (empty when
 * there are none or they do not parse). Each is `dimension` floats, as saveBinaryArtifact
 * wrote it.
 */
export async function loadArtifactEmbeddings(paths) {
  const out = new Map();
  for (const [binPath, metaPath] of [[paths.identifiersBin, paths.identifiersMeta], [paths.semanticSeedsBin, paths.semanticSeedsMeta]]) {
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      const buf = await fs.readFile(binPath);
      const dim = buf.readUInt32LE(8);
      const count = buf.readUInt32LE(12);
      const keys = meta.texts ?? meta.terms;
      if (buf.toString('latin1', 0, 4) !== 'SSWV' || dim !== meta.dimension || count !== keys?.length) continue;
      for (let i = 0; i < count; i++) {
        const emb = new Float32Array(dim);
        for (let j = 0; j < dim; j++) emb[j] = buf.readFloatLE(32 + (i * dim + j) * 4);
        out.set(keys[i], emb);
      }
    } catch { /* no artifact */ }
  }
  return out;
}
