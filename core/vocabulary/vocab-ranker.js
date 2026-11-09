/**
 * Vocabulary Ranker Module
 *
 * Scores and classifies mined vocabulary terms for cache pre-warming.
 * Two ranking streams:
 *
 * Stream A: Identifier Ranking (BM25 + PageRank + heuristic multipliers)
 *   → Produces scored, classified identifiers for lexical + semantic warmup
 *
 * Stream B: Community Phrase Ranking (c-TF-IDF scores + PageRank boost)
 *   → Produces NL query phrases with question variants for semantic warmup
 *
 * Pure computation module — no I/O, no external dependencies.
 */

/**
 * BM25 tuning constants for prewarm vocabulary ranking only.
 * NOTE: These are NOT used for live FTS5 search. SQLite FTS5 uses its own
 * built-in BM25 defaults (k1=1.2, b=0.75). Column weights are configured
 * via bm25() arguments in graph-search.js. Do not add custom rescoring
 * unless benchmark data proves a real win — column weights and lexical
 * normalization matter far more than k1/b tuning.
 */
const K1 = 1.5;   // Higher saturation for code (many repeated identifiers)
const B = 0.5;     // Lower length penalty (code file sizes vary widely)

/** Heuristic multipliers applied on top of BM25 score */
const MULTIPLIERS = {
  exports:    3.0,  // Public API surface
  pagerank:   2.5,  // High code-graph connectivity (PageRank > 0.1)
  filepath:   2.0,  // Appears in file/directory names
  crossfile:  1.5,  // Appears in multiple files
  named:      1.2,  // camelCase / PascalCase named entity
  dependency: 1.0,  // Appears in dependency names
  string:     0.8,  // String literal / error message
  private:    0.3,  // Single occurrence, private scope
};

/** Depth presets: { identifiers, phrases } caps */
const DEPTH_CUTOFFS = {
  light:  { identifiers: 200,  phrases: 100 },
  medium: { identifiers: 1000, phrases: 500 },
  deep:   { identifiers: 2000, phrases: 1000 },
};

const DEFAULT_PHRASES_PER_COMMUNITY = 15;

const QUESTION_TEMPLATES = [
  phrase => `how does ${phrase} work`,
  phrase => `where is ${phrase}`,
  phrase => `what handles ${phrase}`,
  phrase => `find ${phrase}`,
];

const RE_PASCAL_CASE = /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/;
const RE_SCREAMING_SNAKE = /^[A-Z][A-Z0-9_]+$/;
const RE_CAMEL_CASE = /^[a-z]+(?:[A-Z][a-z]+)+$/;
const RE_SNAKE_CASE = /^[a-z][a-z0-9_]+$/;
const RE_DOTTED_PATH = /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+$/;

// Code-like tokens: contain uppercase transitions, underscores, dots, or digits mixed with letters
const RE_CODE_TOKEN = /[A-Z]{2}|[a-z][A-Z]|_|\.\w|[a-z]\d|\d[a-z]/;

/**
 * NOTE: In prewarm mining this is source-bucket rarity (import/export/graph-entity...)
 * unless caller supplies a real `options.totalFiles`.
 * @param {number} totalDocs - N (total buckets, or total files if provided)
 * @param {number} docFreq - df (bucket frequency)
 */
function computeIDF(totalDocs, docFreq) {
  return Math.log((totalDocs) / (1 + docFreq));
}

/**
 * @param {number} tf - term frequency (occurrences across mining)
 * @param {number} idf - precomputed IDF
 * @param {number} docLen - approximate document length (source count)
 * @param {number} avgDocLen - average document length
 */
function bm25Score(tf, idf, docLen, avgDocLen) {
  const numerator = tf * (K1 + 1);
  const denominator = tf + K1 * (1 - B + B * (docLen / avgDocLen));
  return idf * (numerator / denominator);
}

/**
 * @param {object} termInfo - { term, score, source, type, sources }
 * @param {number} pageRankScore - PageRank score for this term (0 if absent)
 */
function computeHeuristicMultiplier(termInfo, pageRankScore) {
  const sources = termInfo.sources || (termInfo.source ? [termInfo.source] : []);
  const type = termInfo.type || '';

  let multiplier = 1.0;

  if (type === 'export' || type === 'exports' || sources.includes('exports')) {
    multiplier = Math.max(multiplier, MULTIPLIERS.exports);
  }

  if (pageRankScore > 0.1) {
    multiplier = Math.max(multiplier, MULTIPLIERS.pagerank);
  }

  if (type === 'filepath' || sources.includes('filepath') || sources.includes('filename')) {
    multiplier = Math.max(multiplier, MULTIPLIERS.filepath);
  }

  if (sources.length > 1 || type === 'crossfile') {
    multiplier = Math.max(multiplier, MULTIPLIERS.crossfile);
  }

  if (RE_CAMEL_CASE.test(termInfo.term) || RE_PASCAL_CASE.test(termInfo.term)) {
    multiplier = Math.max(multiplier, MULTIPLIERS.named);
  }

  if (type === 'dependency' || sources.includes('dependency')) {
    multiplier = Math.max(multiplier, MULTIPLIERS.dependency);
  }

  if (type === 'string' || type === 'error' || sources.includes('string')) {
    multiplier = Math.max(multiplier, MULTIPLIERS.string);
  }

  const totalOccurrences = termInfo.score || 1;
  if (totalOccurrences <= 1 && (type === 'private' || sources.length <= 1)) {
    // Only apply private penalty if no stronger signal
    if (multiplier <= 1.0) {
      multiplier = MULTIPLIERS.private;
    }
  }

  return multiplier;
}

/**
 * Classify how a term should be pre-warmed in the embedding cache.
 *
 * - "lexical": exact FTS5 match is sufficient (code identifiers, paths)
 * - "semantic": needs embedding (natural language phrases)
 * - "both": high-value hub entity worth caching both ways
 *
 * @param {number} [pageRankScore=0] - optional PageRank score for the term
 * @returns {'lexical' | 'semantic' | 'both'}
 */
export function classifyWarmMode(term, pageRankScore = 0) {
  // High-PageRank hub entity → cache both lexical and semantic
  if (pageRankScore > 0.1) return 'both';

  // PascalCase (e.g., UserService, AuthController)
  if (RE_PASCAL_CASE.test(term)) return 'lexical';

  // SCREAMING_SNAKE (e.g., MAX_RETRIES, DEFAULT_TIMEOUT)
  if (RE_SCREAMING_SNAKE.test(term)) return 'lexical';

  // Dotted path (e.g., config.database.host)
  if (RE_DOTTED_PATH.test(term)) return 'lexical';

  if (RE_SNAKE_CASE.test(term)) return 'lexical';

  if (RE_CAMEL_CASE.test(term)) return 'lexical';

  const tokens = term.split(/\s+/).filter(t => t.length > 0);

  if (tokens.length <= 2) {
    if (tokens.some(t => RE_CODE_TOKEN.test(t))) return 'lexical';
    // Single-word terms default to lexical (likely an identifier)
    if (tokens.length === 1) return 'lexical';
  }

  // NL phrase: 3+ tokens, mostly lowercase with no code tokens
  if (tokens.length >= 3) {
    const codeTokenCount = tokens.filter(t => RE_CODE_TOKEN.test(t)).length;
    if (codeTokenCount === 0) return 'semantic';
    if (codeTokenCount <= 1) return 'both';
  }

  // Default: lexical (safer for code search)
  return 'lexical';
}

/**
 * @param {Array<{term: string, score: number, source: string, type: string, sources?: string[]}>} minedTerms
 *   Output from vocab-miner.js
 * @param {Map<string, number>} pageRankScores
 *   Entity name → PageRank score (from repo-map.js)
 * @param {object} [options]
 * @param {'light'|'medium'|'deep'} [options.depth='medium']
 * @param {number} [options.topN] - explicit cap (overrides depth)
 * @param {number} [options.totalFiles] - total files in codebase (for IDF; estimated if absent)
 * @returns {{ identifiers: Array<{term: string, score: number, warm_mode: string, sources: string[], type: string}>, totalMined: number }}
 */
export function rankIdentifiers(minedTerms, pageRankScores, options = {}) {
  const depth = options.depth || 'medium';
  const cutoff = options.topN || DEPTH_CUTOFFS[depth]?.identifiers || DEPTH_CUTOFFS.medium.identifiers;

  if (!minedTerms || minedTerms.length === 0) {
    return { identifiers: [], totalMined: 0 };
  }

  const termMap = new Map(); // term → { tf, sources: Set, type, docFreq }
  for (const entry of minedTerms) {
    const key = entry.term;
    if (!termMap.has(key)) {
      termMap.set(key, {
        term: key,
        tf: 0,
        sources: new Set(),
        type: entry.type || '',
        docFreq: 0,
      });
    }
    const agg = termMap.get(key);
    agg.tf += (entry.score || 1);
    if (entry.source) agg.sources.add(entry.source);
    if (entry.sources) {
      for (const s of entry.sources) agg.sources.add(s);
    }
    // Approximate docFreq from unique sources
    agg.docFreq = agg.sources.size;
  }

  const totalFiles = options.totalFiles || estimateTotalSourceBuckets(termMap);
  const terms = [...termMap.values()];

  // Average "document length" ≈ average source count per term
  const totalDocLen = terms.reduce((sum, t) => sum + t.sources.size, 0);
  const avgDocLen = terms.length > 0 ? totalDocLen / terms.length : 1;

  for (const t of terms) {
    t.idf = computeIDF(totalFiles, t.docFreq);
  }

  const scored = [];
  for (const t of terms) {
    const prScore = pageRankScores?.get(t.term) || 0;
    const bm25 = bm25Score(t.tf, t.idf, t.sources.size, avgDocLen);
    const heuristic = computeHeuristicMultiplier(
      { term: t.term, score: t.tf, sources: [...t.sources], type: t.type },
      prScore
    );
    const finalScore = bm25 * heuristic * (1 + prScore);
    const warmMode = classifyWarmMode(t.term, prScore);

    scored.push({
      term: t.term,
      score: finalScore,
      warm_mode: warmMode,
      sources: [...t.sources],
      type: t.type,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const identifiers = scored.slice(0, cutoff);

  return { identifiers, totalMined: minedTerms.length };
}

/**
 * Estimate total source-bucket count from term source diversity.
 * This is an approximation used when real file counts are unavailable.
 * Pass `options.totalFiles` to rankIdentifiers() for true file-based BM25 IDF.
 */
function estimateTotalSourceBuckets(termMap) {
  const allSources = new Set();
  for (const t of termMap.values()) {
    for (const s of t.sources) allSources.add(s);
  }
  // Source-type buckets are small but stable; keep floor at 1.
  return Math.max(allSources.size, 1);
}

/**
 * @param {Array<{communityId: number, phrases: Array<{text: string, score: number, type?: string}>}>} communityPhrases
 *   Output from vocab-miner.js
 * @param {Map<string, number>} pageRankScores
 *   Entity name → PageRank score
 * @param {object} [options]
 * @param {number} [options.maxPhrasesPerCommunity] - K per community (default 15)
 * @param {number} [options.maxTotalPhrases] - total cap (default from depth)
 * @param {'light'|'medium'|'deep'} [options.depth='medium']
 * @returns {{ phrases: Array<{phrase: string, communityId: number, score: number, variants: string[]}>, totalMined: number }}
 */
export function rankCommunityPhrases(communityPhrases, pageRankScores, options = {}) {
  const depth = options.depth || 'medium';
  const maxPerCommunity = options.maxPhrasesPerCommunity || DEFAULT_PHRASES_PER_COMMUNITY;
  const maxTotal = options.maxTotalPhrases || DEPTH_CUTOFFS[depth]?.phrases || DEPTH_CUTOFFS.medium.phrases;

  if (!communityPhrases || communityPhrases.length === 0) {
    return { phrases: [], totalMined: 0 };
  }

  // Pre-filter high-PR entities ONCE before the phrase loop (O(N*M) → O(N+M)).
  // Build a pre-lowercased array so each phrase only iterates the small filtered set.
  const highPrEntities = []; // { nameLower: string, score: number }
  if (pageRankScores) {
    for (const [entity, prScore] of pageRankScores) {
      if (prScore > 0.01) {
        highPrEntities.push({ nameLower: entity.toLowerCase(), score: prScore });
      }
    }
  }

  let totalMined = 0;
  const allPhrases = []; // { phrase, communityId, score }

  for (const community of communityPhrases) {
    const cid = community.communityId;
    const phrases = community.phrases || [];
    totalMined += phrases.length;

    const scored = phrases.map(p => {
      let boost = 0;
      if (highPrEntities.length > 0) {
        // Uses pre-lowercased filtered set — avoids repeated toLowerCase() on all N entries.
        const textLower = p.text.toLowerCase();
        for (const { nameLower, score: prScore } of highPrEntities) {
          if (textLower.includes(nameLower)) {
            boost = Math.max(boost, prScore);
          }
        }
      }
      return {
        phrase: p.text,
        communityId: cid,
        score: (p.score || 0) * (1 + boost),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    allPhrases.push(...scored.slice(0, maxPerCommunity));
  }

  const deduped = deduplicatePhrases(allPhrases);

  deduped.sort((a, b) => b.score - a.score);
  const topPhrases = deduped.slice(0, maxTotal);

  const withVariants = topPhrases.map(p => ({
    phrase: p.phrase,
    communityId: p.communityId,
    score: p.score,
    variants: QUESTION_TEMPLATES.map(fn => fn(p.phrase)),
  }));

  return { phrases: withVariants, totalMined };
}

/**
 * When the same phrase appears in multiple communities, keeps only the
 * highest-scoring occurrence.
 */
function deduplicatePhrases(phrases) {
  const best = new Map(); // normalized phrase → best entry
  for (const p of phrases) {
    const key = p.phrase.toLowerCase().trim();
    const existing = best.get(key);
    if (!existing || p.score > existing.score) {
      best.set(key, p);
    }
  }
  return [...best.values()];
}

/**
 * @param {Array} minedTerms - from vocab-miner.js
 * @param {Array} communityPhrases - from vocab-miner.js
 * @param {Map<string, number>} pageRankScores - from repo-map.js
 * @param {object} [options]
 * @param {'light'|'medium'|'deep'} [options.depth='medium']
 * @param {number} [options.topN] - explicit identifier cap
 * @param {number} [options.maxPhrasesPerCommunity]
 * @param {number} [options.maxTotalPhrases]
 * @param {number} [options.totalFiles]
 * @returns {{ identifiers: Array, phrases: Array }}
 */
export function rankAll(minedTerms, communityPhrases, pageRankScores, options = {}) {
  const { identifiers, totalMined: idTotal } = rankIdentifiers(
    minedTerms, pageRankScores, options
  );
  const { phrases, totalMined: phTotal } = rankCommunityPhrases(
    communityPhrases, pageRankScores, options
  );

  return {
    identifiers,
    phrases,
    stats: {
      totalIdentifiersMined: idTotal,
      totalPhrasesMined: phTotal,
      identifiersReturned: identifiers.length,
      phrasesReturned: phrases.length,
      depth: options.depth || 'medium',
    },
  };
}

export const _internals = {
  computeIDF,
  bm25Score,
  computeHeuristicMultiplier,
  deduplicatePhrases,
  estimateTotalSourceBuckets,
  estimateTotalFiles: estimateTotalSourceBuckets,
  MULTIPLIERS,
  DEPTH_CUTOFFS,
  QUESTION_TEMPLATES,
  K1,
  B,
};
