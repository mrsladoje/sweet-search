/**
 * Vocabulary Warmup Orchestrator (Step 4e / 5 of Vocabulary Prewarm)
 *
 * Full warmup pipeline: mine -> detect communities -> rank -> warm -> persist.
 * Extracted from vocab-warmer.js for SOLID single-responsibility.
 *
 * This module imports from ./vocab-warmer.js which re-exports from here
 * (circular).  Safe ONLY because every access to ARTIFACT_PATHS / DATA_DIR
 * is inside a function body (runtime), never at module scope.
 *
 * WARNING: Do NOT read ARTIFACT_PATHS or DATA_DIR at the top level here.
 * They are `export const` in vocab-warmer.js and will be in the Temporal
 * Dead Zone during the circular module resolution.  Function declarations
 * (warmLexical etc.) are hoisted and safe to import.
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

import { DB_PATHS, PROJECT_ROOT, EMBEDDING_CONFIG } from './config.js';
import { detectCommunities, computeGraphHash } from './community-detector.js';
import { mineAll, computeNLContentHash } from './vocab-miner.js';
import { rankAll } from './vocab-ranker.js';
import {
  warmLexical,
  warmSemantic,
  warmHybrid,
  ARTIFACT_PATHS,
  DATA_DIR,
} from './vocab-warmer.js';

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
 * @returns {Promise<{terms: number, phrases: number, communities: number, timing: object}>}
 */
export async function runFullWarmup(options = {}) {
  const start = performance.now();
  const localWarmup = options.localWarmup || false;
  const provider = options.provider || null;

  // Apply provider override for this warmup session
  const _restoreProvider = _applyProviderOverride(provider, localWarmup);

  try { return await _runFullWarmupInner(options, start); }
  finally { _restoreProvider(); }
}

/**
 * Apply a temporary provider override to EMBEDDING_CONFIG.
 * Returns a restore function that MUST be called (in a finally block) to undo the mutation.
 * @returns {() => void}
 */
function _applyProviderOverride(provider, localWarmup) {
  if (provider && EMBEDDING_CONFIG) {
    const saved = EMBEDDING_CONFIG.provider;
    EMBEDDING_CONFIG.provider = provider;
    return () => { EMBEDDING_CONFIG.provider = saved; };
  }
  if (localWarmup && EMBEDDING_CONFIG) {
    const saved = EMBEDDING_CONFIG.provider;
    EMBEDDING_CONFIG.provider = 'local';
    return () => { EMBEDDING_CONFIG.provider = saved; };
  }
  return () => {}; // no-op
}

async function _runFullWarmupInner(options, start) {
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
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    communities = [];
  }
  timing.communities = Math.round(performance.now() - commStart);

  // -----------------------------------------------------------------------
  // Step 2: Mine terms (F3: check NL content hash for incremental gating)
  // -----------------------------------------------------------------------
  let skipNLMining = false;
  if (incremental && existsSync(ARTIFACT_PATHS.communities)) {
    try {
      const cached = JSON.parse(await fs.readFile(ARTIFACT_PATHS.communities, 'utf-8'));
      // Only skip NL mining if BOTH graph hash AND NL hash are unchanged.
      // If graph hash changed, communities were re-detected — NL content
      // must be re-mined against the new community structure even if file
      // contents haven't changed (different files per community).
      const graphUnchanged = cached.graphHash && cached.graphHash === graphHash;
      if (graphUnchanged && cached.nlHash && communities.length > 0) {
        const currentNLHash = computeNLContentHash(communities, PROJECT_ROOT);
        if (currentNLHash === cached.nlHash) {
          skipNLMining = true;
        }
      }
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
  }

  const mineStart = performance.now();
  let minedResult;
  try {
    minedResult = mineAll(PROJECT_ROOT, dbPath, communities, {
      deep: depth === 'deep',
      skipNL: skipNLMining,
    });
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
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
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
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
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
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
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    timing.semantic = Math.round(performance.now() - semStart);
  }

  // 4c. Hybrid warmup (select representative queries weighted by community size -- F6)
  if (modes.includes('hybrid') && options.searcher) {
    const hybStart = performance.now();
    try {
      // F6: Weight by community entity count, select top-1 per community + cross-community
      const commSizeMap = new Map();
      for (const c of communities) {
        commSizeMap.set(c.id, c.entityCount || c.entityIds?.length || 1);
      }
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

      await warmHybrid(repQueries, options.searcher);
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    timing.hybrid = Math.round(performance.now() - hybStart);
  }

  // -----------------------------------------------------------------------
  // Step 5: Persist artifacts
  // -----------------------------------------------------------------------
  const persistStart = performance.now();
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });

    // F5: Persist communities.json with phrases[] and topEntities[]
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

    // F3: Compute NL content hash for incremental gating
    let nlHash = '';
    try {
      nlHash = computeNLContentHash(communities, PROJECT_ROOT);
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }

    await fs.writeFile(ARTIFACT_PATHS.communities, JSON.stringify({
      graphHash,
      nlHash,
      communities: enrichedCommunities,
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
export async function saveBinaryArtifact(binPath, metaPath, embeddingMap) {
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
