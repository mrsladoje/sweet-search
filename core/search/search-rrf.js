/**
 * Multi-query parallel BM25F + Reciprocal Rank Fusion (RRF) tail fallback.
 *
 * Applies when the normal hybrid pipeline (lexical + semantic + CC fusion
 * + IAR + post-fusion boosts + demotions + MMR + existing rewrite-retry)
 * still leaves results weak — empty, low-confidence top-1, or no source
 * file in top-3.
 *
 * Why this design:
 *   - Long natural-language queries get tokenized by FTS5's sanitizer
 *     into AND-of-many-tokens (`"how" "does" "Fastify" "compile" ...`),
 *     and no chunk has all those tokens. Result: zero hits.
 *   - SOTA in 2025-2026 (Cognition SWE-grep, Polarity Omnigrep, Cody
 *     Deep Search, T2-RAGBench) is multi-query parallel retrieval with
 *     RRF fusion — fire one BM25 per content keyword, fuse by rank.
 *   - RRF (Cormack 2009) is corpus-agnostic and avoids the per-keyword
 *     score-normalization trap. A chunk that ranks high in MULTIPLE
 *     per-keyword queries floats up; a chunk that only matches one
 *     noisy keyword (e.g. "time" → setTimeout) stays mid-pack because
 *     it has a single 1/(k+rank) contribution.
 *
 * Why NOT a hand-curated stopword list:
 *   The earlier draft (Proposal C v1) added "time", "data", "value" etc.
 *   to a stopword list because Q4 ("registration time") matched
 *   `setTimeout`. That's the Clever Hans / corpus-overfit anti-pattern
 *   per the Mitra & Craswell neural-IR survey and Vespa's WAND article.
 *   RRF handles this structurally: "time" matches noisy chunks at
 *   rank 1, but those chunks DON'T also match "compile" + "schemas",
 *   so their RRF score stays low compared to a chunk that hits all
 *   three.
 *
 * Disable via `ablations: new Set(['no-rrf-fallback'])`.
 *
 * References:
 *   - Cormack et al. "Reciprocal Rank Fusion outperforms Condorcet and
 *     individual rank learning methods", SIGIR 2009.
 *   - Cognition SWE-grep blog (Oct 2025).
 *   - T2-RAGBench multi-query+RRF, EACL 2026.
 */

import { detectFileKind } from '../ranking/file-kind-ranking.js';

// Question-scaffolding stopwords ONLY. Generic English nouns (time, data,
// state, mode, value, etc.) intentionally NOT in this list — they may be
// the actual concept the user is asking about, and RRF naturally demotes
// them when they're noise (one rank-1 hit can't beat two rank-mid hits).
const QUERY_SCAFFOLD_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'could',
  'did', 'do', 'does', 'each', 'for', 'from', 'had', 'has', 'have',
  'how', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'should',
  'so', 'than', 'that', 'the', 'their', 'them', 'this', 'those',
  'to', 'too', 'use', 'using', 'was', 'were', 'what', 'when', 'where',
  'whether', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'would', 'you', 'your',
]);

// Standard RRF k constant from Cormack 2009. Higher k flattens the
// rank-position curve (less weight for top hits); lower k sharpens it.
// 60 is the published default and what most production systems use.
const RRF_K = 60;

const DEFAULT_PER_KEYWORD_LIMIT = 30;
const DEFAULT_CONFIDENCE_FLOOR = 0.35;

// RRF scores are tiny (~0.01-0.05). Map to a [base, base+range] band so
// fallback candidates compete mid-pack without overwhelming a strong
// fused top-1 from the encoder (typically 0.4-0.86).
const FALLBACK_BASE = 0.40;
const FALLBACK_RANGE = 0.20;

export function extractContentKeywords(query) {
  if (!query) return [];
  const tokens = String(query).match(/[A-Za-z_][A-Za-z0-9_]+/g) || [];
  const out = [];
  const seen = new Set();
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    const lower = tok.toLowerCase();
    if (QUERY_SCAFFOLD_STOPWORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(tok);
  }
  return out;
}

/**
 * Decide whether the keyword fallback should run. Tightened (2026-05-05)
 * after a 20-query probe found the original triggers fired too eagerly.
 *
 * The earlier two-clause trigger (`low_confidence` ∨ `no_source_in_top3`)
 * caused regressions on queries where the encoder DID produce a real
 * named source symbol just below the score floor (e.g. `getServerInstance`
 * at score 0.32 lost to a 1-line `[typeAlias: HttpKeys]` injected by RRF).
 *
 * New rule: RRF fires only when top-3 has NO "good source candidate" —
 * defined as an implementation-file chunk with a real named entity. That
 * captures the genuine "retrieval is lost" case (only docs / tests /
 * unlabelled chunks) without sacrificing borderline-confidence wins.
 *
 *   - empty                   → fire (always)
 *   - top-1 in docs/tests AND no good source candidate → fire
 *   - all top-3 are unlabelled chunks (no symbol name) → fire
 *   - otherwise               → don't fire
 *
 * The previous standalone `low_confidence` trigger (top-1 score < floor)
 * was removed — encoder scores below 0.35 are common on long NL queries
 * even when the answer IS the encoder's top-1.
 */
export function shouldRunFallback(results, opts = {}) {
  if (!Array.isArray(results) || results.length === 0) return 'empty';
  const window = results.slice(0, Math.min(3, results.length));
  const hasGoodSource = window.some(r => {
    const file = r.metadata?.file || r.file || r.file_path || '';
    if (detectFileKind(file) !== 'implementation') return false;
    const name = r.metadata?.name || r.name;
    return name && String(name).trim().length > 0;
  });
  if (!hasGoodSource) return 'no_good_source_in_top3';
  return null;
}

function chunkKey(r) {
  const m = r.metadata || {};
  const file = m.file || r.file || r.file_path;
  const sl = m.startLine ?? r.startLine;
  const el = m.endLine ?? r.endLine;
  return `${file}|${sl}|${el}`;
}

/**
 * Compute Reciprocal Rank Fusion across per-keyword BM25 result lists.
 *
 * For each chunk, RRF score = sum over all keywords k of 1 / (RRF_K + rank_k)
 * where rank_k is the chunk's 1-indexed position in keyword k's results.
 * Chunks not present in a keyword's results contribute 0 for that keyword.
 *
 * This naturally rewards chunks that appear in MULTIPLE per-keyword queries
 * over chunks that only appear at rank 1 of a single noisy keyword.
 *
 * @param {Array<Array>} perKeywordResults - one array of BM25 hits per keyword
 * @returns {Map<string, { result, rrf, perKeywordRanks: Map<string, number> }>}
 */
export function fuseRRF(perKeywordResults) {
  const acc = new Map();
  for (let kIdx = 0; kIdx < perKeywordResults.length; kIdx++) {
    const list = perKeywordResults[kIdx] || [];
    for (let r = 0; r < list.length; r++) {
      const item = list[r];
      const key = chunkKey(item);
      const rank = r + 1;                          // 1-indexed
      const contrib = 1 / (RRF_K + rank);
      if (!acc.has(key)) {
        acc.set(key, {
          result: item,
          rrf: 0,
          keywordsHit: new Set(),
        });
      }
      const entry = acc.get(key);
      entry.rrf += contrib;
      entry.keywordsHit.add(kIdx);
    }
  }
  return acc;
}

/**
 * Run multi-query BM25F + RRF fallback against the existing fused list.
 *
 * Fires when shouldRunFallback returns a reason. Extracts content
 * keywords, fires one BM25F query per keyword via the existing
 * `graphSearch.bm25SearchRaw` (which already uses the 4-column FTS5
 * with weighted BM25), fuses with RRF, normalizes RRF scores to a
 * mid-pack band, and merges into the existing candidate set.
 *
 * @param {Array} fused - current candidate list
 * @param {string} query
 * @param {object} opts
 * @returns {Promise<{ results: Array, stats: object }>}
 */
export async function runRRFFallback(fused, query, opts = {}) {
  const ablations = opts.ablations;
  if (ablations && (ablations instanceof Set ? ablations.has('no-rrf-fallback') : Array.isArray(ablations) && ablations.includes('no-rrf-fallback'))) {
    return { results: fused, stats: { reason: null, keywords: [], injected: 0, boosted: 0, fusedCount: 0 } };
  }

  const reason = shouldRunFallback(fused, opts);
  if (!reason) {
    return { results: fused, stats: { reason: null, keywords: [], injected: 0, boosted: 0, fusedCount: 0 } };
  }

  const keywords = extractContentKeywords(query);
  if (keywords.length < 2) {
    return { results: fused, stats: { reason, keywords, injected: 0, boosted: 0, fusedCount: 0 } };
  }

  const searcher = opts.searcher;
  const graphSearch = searcher?.graphSearch;
  if (!graphSearch || typeof graphSearch.bm25SearchRaw !== 'function') {
    return { results: fused, stats: { reason, keywords, injected: 0, boosted: 0, fusedCount: 0 } };
  }

  // Fire BM25F per keyword in parallel. The existing bm25SearchRaw
  // handles the AND/prefix/trigram cascade for each individual keyword,
  // and uses the 4-column BM25F (`bm25(entities_fts, 10.0, 4.0, 5.0, 1.0)`).
  const perKeywordLimit = Math.max(10, Math.min(50, opts.perKeywordLimit ?? DEFAULT_PER_KEYWORD_LIMIT));
  const perKeyword = await Promise.all(
    keywords.map(async (kw) => {
      try {
        const r = await graphSearch.bm25SearchRaw(kw, perKeywordLimit);
        return r?.results || [];
      } catch {
        return [];
      }
    })
  );

  const fusedMap = fuseRRF(perKeyword);
  if (fusedMap.size === 0) {
    return { results: fused, stats: { reason, keywords, injected: 0, boosted: 0, fusedCount: 0 } };
  }

  // Sort by RRF score descending; cap the number we inject to avoid
  // flooding the candidate set when many chunks have small RRF scores.
  const ranked = [...fusedMap.values()].sort((a, b) => b.rrf - a.rrf);
  const injectCap = Math.max(5, Math.min(30, opts.injectCap ?? 20));
  const top = ranked.slice(0, injectCap);

  // Normalize RRF scores to [FALLBACK_BASE, FALLBACK_BASE + FALLBACK_RANGE]
  const maxRrf = top[0]?.rrf || 0;
  if (maxRrf <= 0) {
    return { results: fused, stats: { reason, keywords, injected: 0, boosted: 0, fusedCount: fusedMap.size } };
  }

  const existingByKey = new Map();
  for (const r of fused) existingByKey.set(chunkKey(r), r);

  let injected = 0;
  let boosted = 0;
  const additions = [];

  for (const { result, rrf, keywordsHit } of top) {
    const key = chunkKey(result);
    const norm = rrf / maxRrf;
    const fallbackScore = FALLBACK_BASE + FALLBACK_RANGE * norm;

    const exists = existingByKey.get(key);
    if (exists) {
      if ((exists.score || 0) < fallbackScore) {
        exists.score = fallbackScore;
        exists._rrfBoosted = true;
        exists._rrfHits = keywordsHit.size;
        boosted++;
      }
      continue;
    }

    additions.push({
      ...result,
      searchPath: 'rrf-fallback',
      score: fallbackScore,
      _rrfFallback: true,
      _rrfHits: keywordsHit.size,
      _rrfRaw: rrf,
    });
    injected++;
  }

  if (injected === 0 && boosted === 0) {
    return { results: fused, stats: { reason, keywords, injected: 0, boosted: 0, fusedCount: fusedMap.size } };
  }

  const merged = [...fused, ...additions].sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    results: merged,
    stats: { reason, keywords, injected, boosted, fusedCount: fusedMap.size },
  };
}
