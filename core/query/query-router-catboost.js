/**
 * CatBoost Query Router - Production ML Router with Reject Option
 *
 * This router uses the trained CatBoost model (v45_depth4) with proper
 * uncertainty-based reject option to improve utility accuracy.
 *
 * Performance: ~50μs inference (vs 1.8μs ID3, but higher accuracy)
 * Utility Accuracy: 98%+ on 255-query benchmark (3-class, with reject option)
 */

// Import the trained CatBoost router
import { routeQueryCatBoost, LABELS } from '../training/query-router/output/v46_router_d4.js';

// Import the feature extractor (must match training features)
import { extractAllFeatures } from '../training/query-router/features/extractor.js';

// =============================================================================
// REJECT OPTION CONFIGURATION
// =============================================================================
// When model confidence/margin is low, fall back to HYBRID (safe max-recall)
// Thresholds tuned to maximize utility accuracy on 315-query benchmark

const REJECT_OPTION = {
  enabled: true,  // Improves utility from 92.7% to 94.3%

  // Per-class thresholds: different classes need different treatment
  // LEXICAL needs aggressive rejection (foreign identifiers look like English)
  // STRUCTURAL needs strict thresholds (very few false positives)
  // SEMANTIC is fairly safe, moderate thresholds
  thresholds: {
    LEXICAL: { confidence: 0.92, margin: 0.40 },   // Aggressive - catch foreign identifiers
    SEMANTIC: { confidence: 0.75, margin: 0.25 },  // Moderate
  },
};

/** Maximum query length to prevent DoS attacks */
const MAX_QUERY_LENGTH = 100000; // 100KB

// =============================================================================
// SOFTMAX AND POST-PROCESSING
// =============================================================================

/**
 * Compute softmax probabilities from raw scores.
 * Uses stable softmax to avoid numerical overflow.
 *
 * @param {number[]} scores - Raw scores from CatBoost
 * @returns {number[]} - Probability distribution
 */
function softmax(scores) {
  const maxScore = Math.max(...scores);
  const expScores = scores.map(s => Math.exp(s - maxScore));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  return expScores.map(e => e / sumExp);
}

/**
 * Apply reject option: route to HYBRID when uncertain.
 *
 * @param {{mode: string, confidence: number, scores: number[]}} result - CatBoost result
 * @returns {string} - Final routing mode
 */
function applyRejectOption(result) {
  if (!REJECT_OPTION.enabled) return result.mode;

  const { mode, scores } = result;

  // Already HYBRID - no change
  if (mode === 'HYBRID') return mode;

  // Compute softmax probabilities from scores
  const probs = softmax(scores);
  const modeIdx = LABELS.indexOf(mode);
  const confidence = probs[modeIdx];

  // Get thresholds for this prediction class
  const thresholds = REJECT_OPTION.thresholds[mode];
  if (!thresholds) return mode;

  // Check confidence threshold
  if (confidence < thresholds.confidence) {
    return 'HYBRID';
  }

  // Check margin (difference between top-1 and top-2)
  const sorted = [...probs].sort((a, b) => b - a);
  const margin = sorted[0] - sorted[1];
  if (margin < thresholds.margin) {
    return 'HYBRID';
  }

  return mode;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Extract features for CatBoost routing.
 *
 * @param {string} query - The query to route
 * @returns {number[]|null} - Feature vector for CatBoost, or null for invalid input
 */
export function extractCatBoostFeatures(query) {
  // Input validation
  if (query == null || typeof query !== 'string') {
    return null;
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return null;
  }
  return extractAllFeatures(query);
}

/**
 * Route query using CatBoost ML model with reject option.
 *
 * @param {string} query - The search query
 * @returns {{mode: string, confidence: number, rawMode: string, rejected: boolean, scores: number[], error?: string}}
 */
export function routeQueryCatBoostWithReject(query) {
  // Input validation
  if (query == null || typeof query !== 'string') {
    return {
      mode: 'hybrid',
      confidence: 0,
      rawMode: 'hybrid',
      rejected: false,
      scores: [0, 0, 0],
      probs: [0.33, 0.33, 0.34],
      method: 'invalid_input',
      error: 'Query must be a non-null string',
    };
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return {
      mode: 'hybrid',
      confidence: 0,
      rawMode: 'hybrid',
      rejected: false,
      scores: [0, 0, 0],
      probs: [0.33, 0.33, 0.34],
      method: 'query_too_long',
      error: `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`,
    };
  }

  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return {
      mode: 'hybrid',
      confidence: 0,
      rawMode: 'hybrid',
      rejected: false,
      scores: [0, 0, 0],
      probs: [0.33, 0.33, 0.34],
      method: 'empty_query',
    };
  }

  const features = extractAllFeatures(trimmed);
  const result = routeQueryCatBoost(features);

  // Compute proper confidence from softmax
  const probs = softmax(result.scores);
  const modeIdx = LABELS.indexOf(result.mode);
  const confidence = probs[modeIdx];

  // Apply reject option
  const finalMode = applyRejectOption({ ...result, confidence });
  const rejected = finalMode !== result.mode;

  return {
    mode: finalMode.toLowerCase(),
    confidence,
    rawMode: result.mode.toLowerCase(),
    rejected,
    scores: result.scores,
    probs,
    method: 'catboost',
  };
}

/**
 * Route query using CatBoost (simplified interface, compatible with ID3 router).
 *
 * @param {number[]} features - Pre-extracted features (if available)
 * @returns {{mode: string, confidence: number, method: string}}
 */
export function routeQueryML(features) {
  const result = routeQueryCatBoost(features);

  // Compute proper confidence from softmax
  const probs = softmax(result.scores);
  const modeIdx = LABELS.indexOf(result.mode);
  const confidence = probs[modeIdx];

  // Apply reject option
  const finalMode = applyRejectOption({ ...result, confidence });

  return {
    mode: finalMode.toLowerCase(),
    confidence,
    method: 'catboost',
  };
}

// Re-export LABELS for compatibility
export { LABELS };

// Confidence threshold for fallback (not used directly with reject option)
export const ML_CONFIDENCE_THRESHOLD = 0.5;

export default {
  routeQueryCatBoostWithReject,
  routeQueryML,
  extractCatBoostFeatures,
  LABELS,
  ML_CONFIDENCE_THRESHOLD,
};
