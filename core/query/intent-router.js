/**
 * Intent-Aware Retrieval Routing
 *
 * Lightweight query classifier that detects search intent (API lookup, bug fix,
 * refactor, security, general) using keyword heuristics with position weighting.
 * Each intent maps to a retrieval policy that tunes graph expansion, result
 * limits, and chunk-type / edge-type preferences.
 */

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export const INTENTS = {
  API_LOOKUP: 'api_lookup',
  BUG_FIX: 'bug_fix',
  REFACTOR: 'refactor',
  SECURITY: 'security',
  GENERAL: 'general',
};

// ---------------------------------------------------------------------------
// Keyword banks (lowercase)
// ---------------------------------------------------------------------------

const INTENT_KEYWORDS = {
  [INTENTS.API_LOOKUP]: [
    'how to use', 'api', 'endpoint', 'interface', 'method signature',
    'import', 'export', 'function', 'class', 'type',
  ],
  [INTENTS.BUG_FIX]: [
    'bug', 'fix', 'error', 'crash', 'fail', 'broken', 'issue',
    'debug', 'exception', 'typeerror', 'undefined',
  ],
  [INTENTS.REFACTOR]: [
    'refactor', 'rename', 'move', 'extract', 'cleanup', 'reorganize',
    'simplify', 'split', 'merge',
  ],
  [INTENTS.SECURITY]: [
    'security', 'vulnerability', 'auth', 'authentication', 'authorization',
    'injection', 'xss', 'csrf', 'sanitize', 'encrypt', 'credential',
    'password', 'token',
  ],
};

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify the intent of a search query using keyword heuristics.
 *
 * Scoring: each keyword match contributes a base score of 1.0 multiplied by
 * a position weight (earlier occurrences score higher). Multi-word keywords
 * receive a 1.5× bonus. The intent with the highest total score wins; its
 * confidence is the ratio of the winning score to the sum of all scores,
 * clamped to [0, 1].
 *
 * @param {string} query - The user search query
 * @returns {{ intent: string, confidence: number, scores: Record<string, number> }}
 */
export function classifyIntent(query) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { intent: INTENTS.GENERAL, confidence: 0, scores: {} };
  }

  const lower = query.toLowerCase();
  const queryLen = lower.length || 1;
  const scores = {};

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      const idx = lower.indexOf(kw);
      if (idx === -1) continue;

      // Position weight: earlier matches score higher (1.0 → 0.5)
      const positionWeight = 1.0 - 0.5 * (idx / queryLen);
      // Multi-word bonus
      const multiWordBonus = kw.includes(' ') ? 1.5 : 1.0;

      score += positionWeight * multiWordBonus;
    }
    if (score > 0) scores[intent] = score;
  }

  const entries = Object.entries(scores);
  if (entries.length === 0) {
    return { intent: INTENTS.GENERAL, confidence: 0, scores: {} };
  }

  entries.sort((a, b) => b[1] - a[1]);
  const [bestIntent, bestScore] = entries[0];
  const totalScore = entries.reduce((sum, [, s]) => sum + s, 0);
  const confidence = Math.min(1, bestScore / totalScore);

  return { intent: bestIntent, confidence, scores };
}

// ---------------------------------------------------------------------------
// Retrieval Policies
// ---------------------------------------------------------------------------

const POLICIES = {
  [INTENTS.API_LOOKUP]: {
    chunkTypeBoosts: { declaration: 1.3, signature: 1.3, export: 1.2 },
    edgeTypePriority: ['imports', 'exports', 'uses'],
    expandMode: '1hop',
    maxResults: 10,
    rerankerWeight: 0.6,
  },
  [INTENTS.BUG_FIX]: {
    chunkTypeBoosts: { function_body: 1.3, method: 1.2, block: 1.1 },
    edgeTypePriority: ['calls', 'uses', 'imports'],
    expandMode: '2hop',
    maxResults: 20,
    rerankerWeight: 0.7,
  },
  [INTENTS.REFACTOR]: {
    chunkTypeBoosts: { class: 1.3, method: 1.2, function: 1.2 },
    edgeTypePriority: ['extends', 'implements', 'calls', 'uses'],
    expandMode: '2hop',
    maxResults: 15,
    rerankerWeight: 0.5,
  },
  [INTENTS.SECURITY]: {
    chunkTypeBoosts: { validation: 1.3, middleware: 1.2, config: 1.1 },
    edgeTypePriority: ['imports', 'uses', 'calls'],
    expandMode: '1hop',
    maxResults: 10,
    rerankerWeight: 0.8,
  },
  [INTENTS.GENERAL]: {
    chunkTypeBoosts: {},
    edgeTypePriority: ['imports', 'calls', 'uses'],
    expandMode: '1hop',
    maxResults: 10,
    rerankerWeight: 0.6,
  },
};

/**
 * Get the retrieval policy for a given intent.
 *
 * @param {string} intent - One of the INTENTS values
 * @returns {{
 *   chunkTypeBoosts: Record<string, number>,
 *   edgeTypePriority: string[],
 *   expandMode: 'none' | '1hop' | '2hop',
 *   maxResults: number,
 *   rerankerWeight: number,
 * }}
 */
export function getIntentPolicy(intent) {
  return POLICIES[intent] || POLICIES[INTENTS.GENERAL];
}
