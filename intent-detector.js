/**
 * Query Intent Detection
 *
 * Detects user intent from query patterns to apply targeted ranking boosts.
 * Latency: <1ms (regex patterns only)
 *
 * Part of RANKING_FIX_PLAN Strategy #5 (P1 - Zero Latency)
 */

// =============================================================================
// INTENT PATTERNS
// =============================================================================

/**
 * Regex patterns for detecting query intent.
 * Patterns are ordered by specificity within each intent category.
 */
const INTENT_PATTERNS = {
  definition: [
    /^(def|define|class|interface|struct|enum|type)\s+/i,
    /(definition|declaration|where\s+is.*defined)/i,
    /^[A-Z][a-zA-Z0-9]*$/,  // PascalCase identifier (likely class/interface)
    /^[A-Z][A-Z0-9_]+$/,    // SCREAMING_CASE (likely constant/enum)
  ],
  usage: [
    /(uses?|usage|references?|calls?)\s+(of|to)\s+/i,
    /who\s+(calls?|uses?|imports?)/i,
    /(example|how\s+to\s+use)/i,
    /usages?\s+of\s+/i,
  ],
  conceptual: [
    /^how\s+(does|do|is|are|can|to)/i,
    /^what\s+(is|are|does)/i,
    /^why\s+(does|do|is|are)/i,
    /^when\s+(should|to|does)/i,
    /^where\s+(is|are|should)/i,
    /\?$/,  // Ends with question mark
  ],
  structural: [
    /what\s+(calls?|does)\s+/i,
    /implementations?\s+of/i,
    /subclass(es)?\s+of/i,
    /extends?\s+/i,
  ],
};

// =============================================================================
// INTENT-SPECIFIC BOOST FACTORS
// =============================================================================

/**
 * Boost factors for entity types based on detected intent.
 * Higher values = stronger preference for that entity type.
 *
 * @example
 * - "definition" intent + "class" entity type = 2.0x boost
 * - "usage" intent + "call" entity type = 1.8x boost
 */
const INTENT_BOOSTS = {
  definition: {
    class: 2.0,
    interface: 2.0,
    struct: 2.0,
    enum: 1.8,
    function: 1.5,
    method: 1.3,
    constant: 1.2,
    _default: 1.0,
  },
  usage: {
    call: 1.8,
    reference: 1.6,
    import: 1.4,
    method: 1.2,
    _default: 1.0,
  },
  conceptual: {
    // Conceptual queries don't strongly favor any type
    _default: 1.0,
  },
  structural: {
    class: 1.5,
    interface: 1.5,
    _default: 1.0,
  },
  general: {
    _default: 1.0,
  },
};

// =============================================================================
// INTENT DETECTION FUNCTIONS
// =============================================================================

/**
 * Detect the intent of a search query.
 *
 * @param {string} query - The search query
 * @returns {{intent: string, confidence: number, patterns: string[]}}
 *
 * @example
 * detectIntent("class AuthService")
 * // => { intent: 'definition', confidence: 0.85, patterns: ['definition:^(def|define|class|interface|struct|enum|type)\\s+'] }
 *
 * detectIntent("how does auth work")
 * // => { intent: 'conceptual', confidence: 0.85, patterns: ['conceptual:^how\\s+(does|do|is|are|can|to)'] }
 *
 * detectIntent("find all usages")
 * // => { intent: 'general', confidence: 0.5, patterns: [] }
 */
export function detectIntent(query) {
  if (!query || typeof query !== 'string') {
    return { intent: 'general', confidence: 0, patterns: [] };
  }

  const trimmed = query.trim();
  const matchedPatterns = [];

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        matchedPatterns.push(`${intent}:${pattern.source}`);
        // Return first match (patterns are ordered by specificity)
        return {
          intent,
          confidence: 0.85,
          patterns: matchedPatterns,
        };
      }
    }
  }

  return { intent: 'general', confidence: 0.5, patterns: [] };
}

/**
 * Get the boost factor for an entity type given an intent.
 *
 * @param {string} intent - Detected intent ('definition', 'usage', 'conceptual', 'structural', 'general')
 * @param {string} entityType - Entity type ('class', 'method', 'function', etc.)
 * @returns {number} Boost factor (1.0 = no boost)
 *
 * @example
 * getIntentBoost('definition', 'class')     // => 2.0
 * getIntentBoost('definition', 'method')    // => 1.3
 * getIntentBoost('usage', 'call')           // => 1.8
 * getIntentBoost('general', 'anything')     // => 1.0
 */
export function getIntentBoost(intent, entityType) {
  const boosts = INTENT_BOOSTS[intent] || INTENT_BOOSTS.general;
  return boosts[entityType] || boosts._default || 1.0;
}

/**
 * Apply intent-based boosts to search results.
 *
 * Modifies scores in-place by multiplying with intent-specific boost factors.
 * Results are sorted by new scores after boosting.
 *
 * @param {Array<{score: number, type: string, [key: string]: any}>} results - Search results with score and type
 * @param {string} query - Original query for intent detection
 * @returns {Array} Results with intent boosts applied and sorted by score
 *
 * @example
 * const results = [
 *   { name: 'AuthService', type: 'class', score: 10.0 },
 *   { name: 'authenticate', type: 'method', score: 9.5 },
 * ];
 *
 * applyIntentBoosts(results, 'class AuthService');
 * // AuthService score becomes 20.0 (10.0 * 2.0 boost)
 * // authenticate score becomes 12.35 (9.5 * 1.3 boost)
 */
export function applyIntentBoosts(results, query) {
  const { intent, confidence } = detectIntent(query);

  if (intent === 'general' || confidence < 0.7) {
    return results; // No boost for general/low-confidence
  }

  const boosted = results.map(result => {
    const boost = getIntentBoost(intent, result.type);
    return {
      ...result,
      score: result.score * boost,
      intentBoost: boost,
      detectedIntent: intent,
    };
  });

  // Re-sort by boosted score
  boosted.sort((a, b) => b.score - a.score);

  return boosted;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default { detectIntent, getIntentBoost, applyIntentBoosts };
