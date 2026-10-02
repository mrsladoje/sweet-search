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
// Keyword matching
// ---------------------------------------------------------------------------
//
// Keywords match whole words only. Substring matching let "move" fire inside
// "moved" / "removed", "fix" inside "prefix", "auth" inside "author", "type"
// inside "typeerror", so a behaviour question ("mark pending transaction
// aborted when predicate is being moved or dropped") was routed as a refactor
// request at confidence 1.0.
//
// Inflection depends on what the keyword is evidence OF:
//   - Action intents (refactor, api lookup) name what the user wants to DO.
//     Only the base form and the plural / third-person "-s" count. A past or
//     progressive form ("moved", "merging", "extracted") describes what the
//     code does, which is a behaviour question, not a change request.
//   - Symptom intents (bug fix, security) name what the user SEES. Every
//     common inflection counts ("errors", "crashed", "failing").

const ACTION_SUFFIXES = ['s', 'es'];
const SYMPTOM_SUFFIXES = ['s', 'es', 'd', 'ed', 'ing', 'er', 'ers'];
const SYMPTOM_INTENTS = new Set([INTENTS.BUG_FIX, INTENTS.SECURITY]);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordRegex(kw, suffixes) {
  const alts = [`${escapeRegex(kw)}(?:${suffixes.join('|')})?`];
  if (suffixes.includes('ing')) {
    // e-drop: "sanitize" -> "sanitizing", "sanitized"
    if (kw.endsWith('e')) alts.push(`${escapeRegex(kw.slice(0, -1))}(?:ing|ed|er|ers)`);
    // consonant doubling: "debug" -> "debugging", "debugged"
    if (/[^aeiou][aeiou][bdgmnpt]$/.test(kw)) alts.push(`${escapeRegex(kw + kw.at(-1))}(?:ing|ed|er|ers)`);
  }
  return new RegExp(`(?<![a-z0-9_])(?:${alts.join('|')})(?![a-z0-9_])`);
}

const KEYWORD_MATCHERS = Object.fromEntries(
  Object.entries(INTENT_KEYWORDS).map(([intent, keywords]) => [
    intent,
    keywords.map(kw => ({
      kw,
      rx: keywordRegex(kw, SYMPTOM_INTENTS.has(intent) ? SYMPTOM_SUFFIXES : ACTION_SUFFIXES),
    })),
  ]),
);

// A behaviour question asks what the code DOES ("how does gin merge route
// groups", "where is the predicate moved"); refactor verbs inside it name the
// code's behaviour, not a change the user wants. A request phrased as a
// question ("how do I rename X", "how to move Y", "can we split Z") is still a
// request. Only the refactor intent is suppressed: lookup, bug and security
// words keep their meaning inside a question.
const QUESTION_START = /^(?:where|how|which|what|when|why|who|whose|does|do|did|is|are|was|were|can|could|should|will|would)\b/;
const REQUEST_QUESTION_START = /^(?:how (?:to|do (?:i|we|you)|can (?:i|we|you)|should (?:i|we)|would (?:i|we))|(?:can|could|should|shall) (?:i|we)|do (?:i|we))\b/;

export function isBehaviourQuestion(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  const asks = QUESTION_START.test(q) || q.endsWith('?');
  return asks && !REQUEST_QUESTION_START.test(q);
}

// Score at which one keyword counts as full evidence: a single keyword at the
// very start of the query (position weight 1.0). A lone keyword late in a long
// sentence is weaker evidence, and confidence says so.
const FULL_EVIDENCE_SCORE = 1.0;

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify the intent of a search query using keyword heuristics.
 *
 * Scoring: each keyword match (whole word, see keywordRegex) contributes a
 * base score of 1.0 multiplied by a position weight (earlier occurrences score
 * higher). Multi-word keywords receive a 1.5× bonus. The intent with the
 * highest total score wins.
 *
 * Confidence = share × strength, where share is the winning score over the
 * sum of all scores (how unambiguous the winner is) and strength is
 * min(1, winning score / FULL_EVIDENCE_SCORE) (how much evidence there is).
 * The old share-only confidence gave 1.0 to any single keyword anywhere.
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
  const behaviourQuestion = isBehaviourQuestion(lower);

  for (const [intent, matchers] of Object.entries(KEYWORD_MATCHERS)) {
    if (behaviourQuestion && intent === INTENTS.REFACTOR) continue;
    let score = 0;
    for (const { kw, rx } of matchers) {
      const m = rx.exec(lower);
      if (!m) continue;
      const idx = m.index;

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
  const share = bestScore / totalScore;
  const strength = Math.min(1, bestScore / FULL_EVIDENCE_SCORE);
  const confidence = Math.max(0, Math.min(1, share * strength));

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
