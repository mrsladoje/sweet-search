/**
 * Search Boost Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains all post-fusion boost logic: definition, syntax, position, kind hierarchy.
 *
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 */

import { SYMBOL_KIND_WEIGHTS, DEFINITION_TYPES } from '../infrastructure/constants.js';

const IDENTIFIER_AGREEMENT_STOPWORDS = new Set([
  'and', 'are', 'can', 'does', 'for', 'from', 'get', 'has', 'have',
  'how', 'into', 'new', 'not', 'other', 'return', 'returns', 'set',
  'should', 'that', 'the', 'this', 'true', 'use', 'used', 'using',
  'was', 'were', 'what', 'when', 'where', 'which', 'with', 'you',
]);

// =============================================================================
// BOOST_POLICY (static property on SweetSearch)
// =============================================================================

export const BOOST_POLICY = {
  definition_strong: {
    definitionBoost: 2.0,
    syntaxBoost: 1.8,
    kindHierarchy: true,
    positionBoost: true,
  },
  definition_mild: {
    // PHASE_1_FIXES: Increased from 1.5/1.3 to 1.8/1.5 per research
    definitionBoost: 1.8,
    syntaxBoost: 1.5,
    kindHierarchy: true,
    positionBoost: true,
  },
  general: {
    // PHASE_1_FIXES: Aggressive boosts restored per research (90.5% vs 90.0%)
    // Reference: https://opensourceconnections.com/blog/2022/12/16/approaches-to-field-boost-tuning-with-learning-to-rank/
    definitionBoost: 1.8,
    syntaxBoost: 1.8,
    kindHierarchy: true,
    positionBoost: false,
  },
  none: {
    definitionBoost: 1.0,
    syntaxBoost: 1.0,
    kindHierarchy: true,  // Keep mild type priors
    positionBoost: false,
  },
  structural: {
    definitionBoost: 1.0,
    syntaxBoost: 1.0,
    kindHierarchy: false,
    positionBoost: false,
  },
};

// =============================================================================
// Boost intent mapping
// =============================================================================

/**
 * Map router mode to boost intent (PHASE_1_FIXES Change 3)
 *
 * Replaces intent-detector.js with query router as single source of truth.
 * Pure function — does not reference `this`. On prototype for call-site convenience.
 *
 * @param {string} routerMode - Mode from query router
 * @param {number} routerConfidence - Confidence score from router
 * @returns {string} Boost intent
 */
export function getBoostIntent(routerMode, routerConfidence) {
  // High confidence identifier query -> strong definition boosts
  if (routerMode === 'lexical' && routerConfidence >= 0.8) {
    return 'definition_strong';
  }

  // Lower confidence lexical -> mild boosts
  if (routerMode === 'lexical') {
    return 'definition_mild';
  }

  // Hybrid/mixed -> minimal boosts (avoid oversteering)
  if (routerMode === 'hybrid') {
    return 'general';
  }

  // Semantic/conceptual -> no definition boosts
  if (routerMode === 'semantic') {
    return 'none';
  }

  // Structural -> handled by graph traversal
  if (routerMode === 'structural') {
    return 'structural';
  }

  return 'general';
}

// =============================================================================
// Post-fusion boosts
// =============================================================================

/**
 * Apply post-fusion boosts uniformly (PHASE_1_FIXES Change 4)
 *
 * Applied AFTER fusion so both lexical and semantic paths benefit equally.
 * Boost intensity controlled by router confidence.
 *
 * Uses `this` — calls this.getBoostIntent, this.extractQueryTokens,
 *   this.computeDefinitionBoost, this.computeSyntaxBoost, this.computePositionBoost.
 *
 * NOTE: References SweetSearch.BOOST_POLICY — we import BOOST_POLICY locally
 * and reference it directly since the static property is wired separately.
 */
export function applyPostFusionBoosts(fusedResults, query, routerMode, routerConfidence, options = {}) {
  const boostIntent = this.getBoostIntent(routerMode, routerConfidence);
  const policy = BOOST_POLICY[boostIntent] || BOOST_POLICY.general;

  const queryLower = query.toLowerCase().trim();
  const queryTokens = this.extractQueryTokens(query);
  const agentFormats = new Set(['agent', 'agent_preview', 'agent_full', 'agent_full_xl']);
  const allowIdentifierAgreement = !agentFormats.has(options.format);

  return fusedResults.map(result => {
    let totalBoost = 1.0;
    const boostDetails = [];

    // 1. Definition Boost (based on filename/name match)
    if (policy.definitionBoost > 1.0) {
      const defBoost = this.computeDefinitionBoost(result, queryLower, queryTokens);
      if (defBoost > 1.0) {
        const scaledBoost = 1.0 + (defBoost - 1.0) * (policy.definitionBoost - 1.0);
        totalBoost *= scaledBoost;
        boostDetails.push(`def:${scaledBoost.toFixed(2)}`);
      }
    }

    // 2. Syntax Boost (definition patterns in signature)
    if (policy.syntaxBoost > 1.0) {
      const synBoost = this.computeSyntaxBoost(result, queryTokens);
      if (synBoost > 1.0) {
        const scaledBoost = 1.0 + (synBoost - 1.0) * (policy.syntaxBoost - 1.0);
        totalBoost *= scaledBoost;
        boostDetails.push(`syntax:${scaledBoost.toFixed(2)}`);
      }
    }

    // 2.5 Identifier agreement: prefer symbols/files whose meaningful
    // identifier words are named by the natural-language query.
    const idBoost = allowIdentifierAgreement
      ? this.computeIdentifierAgreementBoost?.(result, query)
      : 1.0;
    if (idBoost > 1.0) {
      totalBoost *= idBoost;
      boostDetails.push(`id:${idBoost.toFixed(2)}`);
    }

    // 3. Symbol Kind Hierarchy (always mild)
    if (policy.kindHierarchy) {
      const kindWeight = SYMBOL_KIND_WEIGHTS[result.type] || 0.5;
      const kindBoost = 0.7 + 0.3 * kindWeight; // Softer: 0.7-1.0 range
      totalBoost *= kindBoost;
      if (kindWeight !== 1.0) {
        boostDetails.push(`kind:${kindBoost.toFixed(2)}`);
      }
    }

    // 4. Position Boost (only for strong definition intent)
    if (policy.positionBoost && result.startLine != null) {
      const posBoost = this.computePositionBoost(result);
      if (posBoost > 1.0) {
        totalBoost *= posBoost;
        boostDetails.push(`pos:${posBoost.toFixed(2)}`);
      }
    }

    // P0 FIX: Cap total boost to prevent over-promotion (max stacking = 4.68x theoretical)
    const cappedBoost = Math.min(totalBoost, 3.0);
    if (cappedBoost < totalBoost) {
      boostDetails.push(`capped:${totalBoost.toFixed(2)}→3.0`);
    }

    return {
      ...result,
      score: result.score * cappedBoost,
      _originalScore: result.score,
      _boostFactor: totalBoost,
      _boostDetails: boostDetails,
    };
  }).sort((a, b) => b.score - a.score);
}

function envFloat(name, fallback, min = 0, max = 1) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function splitIdentifierTerms(value) {
  return String(value || '')
    .replace(/_[0-9a-f]{8}(?=\.[^.]+$|$)/gi, '')
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(stemIdentifierTerm)
    .filter(term => term.length >= 3 && !IDENTIFIER_AGREEMENT_STOPWORDS.has(term));
}

function stemIdentifierTerm(term) {
  if (term.endsWith('ies') && term.length > 4) return `${term.slice(0, -3)}y`;
  for (const suffix of ['ing', 'ers', 'ied', 'ed', 'es', 's']) {
    if (term.endsWith(suffix) && term.length > suffix.length + 3) {
      return term.slice(0, -suffix.length);
    }
  }
  return term;
}

/**
 * Boost candidates whose symbol/file identifier terms agree with query terms.
 *
 * This is intentionally small and corpus-agnostic: it only helps when the
 * candidate exposes meaningful identifier words, and it never fabricates a
 * match from comments or benchmark labels.
 */
export function computeIdentifierAgreementBoost(result, query) {
  const weight = envFloat('SWEET_SEARCH_IDENTIFIER_AGREEMENT_BOOST', 0.40, 0, 1);
  if (weight === 0) return 1.0;

  const queryTerms = new Set(splitIdentifierTerms(query));
  if (queryTerms.size === 0) return 1.0;

  const fileName = (result.file || result.path || result.metadata?.file || '')
    .split('/')
    .pop() || '';
  const candidateTerms = new Set([
    ...splitIdentifierTerms(result.name || result.metadata?.name || ''),
    ...splitIdentifierTerms(fileName),
  ]);
  if (candidateTerms.size === 0) return 1.0;

  let hits = 0;
  for (const queryTerm of queryTerms) {
    if (candidateTerms.has(queryTerm)) {
      hits++;
      continue;
    }
    if (queryTerm.length >= 5) {
      for (const candidateTerm of candidateTerms) {
        if (candidateTerm.includes(queryTerm) || queryTerm.includes(candidateTerm)) {
          hits++;
          break;
        }
      }
    }
  }
  if (hits === 0) return 1.0;

  const agreement = hits / Math.min(queryTerms.size, Math.max(2, candidateTerms.size));
  return 1.0 + weight * Math.min(1, agreement);
}

/**
 * Compute definition boost (PHASE_1_FIXES helper)
 */
export function computeDefinitionBoost(result, queryLower, queryTokens) {
  const isDefinitionType = DEFINITION_TYPES.has(result.type);
  const resultNameLower = (result.name || '').toLowerCase();
  const fileName = (result.file || '').split('/').pop() || '';
  const fileNameNoExt = fileName.replace(/\.[^.]+$/, '').toLowerCase();

  const filenameMatchesQuery = queryTokens.some(token =>
    fileNameNoExt === token || fileNameNoExt.includes(token)
  );
  const exactNameMatch = queryTokens.some(token => resultNameLower === token);

  if (filenameMatchesQuery && isDefinitionType) return 2.0;
  if (filenameMatchesQuery) return 1.3;
  if (exactNameMatch && isDefinitionType) return 1.5;
  if (isDefinitionType) return 1.2;
  return 1.0;
}

/**
 * Compute syntax boost (PHASE_1_FIXES helper)
 */
export function computeSyntaxBoost(result, queryTokens) {
  const signature = (result.signature || '').toLowerCase();
  if (!signature) return 1.0;

  const definitionPatterns = [
    /\b(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/,
    /\b(?:public|private|protected)?\s*interface\s+(\w+)/,
    /\b(?:public|private|protected)?\s*enum\s+(\w+)/,
    /\bclass\s+(\w+)/,
    /\bfunction\s+(\w+)/,
    /\bexport\s+(?:default\s+)?(?:class|function)\s+(\w+)/,
    /\binterface\s+(\w+)/,
    /\btype\s+(\w+)\s*=/,
  ];

  for (const pattern of definitionPatterns) {
    const match = signature.match(pattern);
    if (match && match[1]) {
      const definedName = match[1].toLowerCase();
      if (queryTokens.some(token => definedName === token || definedName.includes(token))) {
        return 1.8;
      }
    }
  }

  return 1.0;
}

/**
 * Compute position boost (PHASE_1_FIXES helper)
 */
export function computePositionBoost(result) {
  const startLine = result.startLine;
  if (startLine == null || startLine < 0) return 1.0;
  if (!DEFINITION_TYPES.has(result.type)) return 1.0;

  const rawPrior = 1 / (1 + startLine / 50);
  const positionPrior = Math.max(0.5, Math.min(1.0, rawPrior));
  return 1 + 0.3 * positionPrior;
}

/**
 * Extract query tokens for matching (PHASE_1_FIXES helper)
 */
export function extractQueryTokens(query) {
  const tokens = new Set();
  tokens.add(query.toLowerCase().trim());

  for (const word of query.split(/\s+/)) {
    if (word.length > 0) tokens.add(word.toLowerCase());
  }

  const camelParts = query.split(/(?=[A-Z])/);
  for (const part of camelParts) {
    if (part.length > 1) tokens.add(part.toLowerCase());
  }

  return Array.from(tokens);
}
