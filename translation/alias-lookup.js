/**
 * Alias Lookup - T2 Translation Tier
 *
 * Provides O(1) lookup of native language terms to English equivalents
 * using a pre-computed reverse index.
 *
 * Performance: <1ms per lookup (HashMap-based)
 *
 * @module translation/alias-lookup
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { normalizeNFC } from '../training/features/unicode-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// DICTIONARY LOADING
// =============================================================================

let cachedDictionary = null;
let cachedReverseIndex = null;

/**
 * Load the alias dictionary from JSON file
 *
 * @returns {Object} Parsed dictionary
 */
export function loadDictionary() {
  if (cachedDictionary) return cachedDictionary;

  const dictPath = join(__dirname, 'alias-dictionary.json');

  if (!existsSync(dictPath)) {
    console.warn(`[AliasDictionary] Dictionary not found: ${dictPath}`);
    return { identifiers: {}, concepts: {} };
  }

  try {
    const content = readFileSync(dictPath, 'utf-8');
    cachedDictionary = JSON.parse(content);
    return cachedDictionary;
  } catch (err) {
    console.error(`[AliasDictionary] Failed to load: ${err.message}`);
    return { identifiers: {}, concepts: {} };
  }
}

/**
 * Build reverse index for fast lookups
 * Maps: native term → [{ type, english, lang }, ...]
 *
 * @param {Object} dictionary - The alias dictionary
 * @returns {Map<string, Array>} Reverse index map
 */
export function buildReverseIndex(dictionary) {
  const reverse = new Map();

  // Index concepts
  if (dictionary.concepts) {
    for (const [english, translations] of Object.entries(dictionary.concepts)) {
      for (const [lang, terms] of Object.entries(translations)) {
        for (const term of terms) {
          const normalized = normalizeNFC(term.toLowerCase());
          if (!reverse.has(normalized)) reverse.set(normalized, []);
          reverse.get(normalized).push({
            type: 'concept',
            english,
            lang,
            original: term,
          });
        }
      }
    }
  }

  // Index identifiers
  if (dictionary.identifiers) {
    for (const [identifier, translations] of Object.entries(dictionary.identifiers)) {
      for (const [lang, terms] of Object.entries(translations)) {
        for (const term of terms) {
          const normalized = normalizeNFC(term.toLowerCase());
          if (!reverse.has(normalized)) reverse.set(normalized, []);
          reverse.get(normalized).push({
            type: 'identifier',
            english: identifier,
            lang,
            original: term,
          });
        }
      }
    }
  }

  return reverse;
}

/**
 * Get the reverse index (cached)
 */
export function getReverseIndex() {
  if (cachedReverseIndex) return cachedReverseIndex;

  const dict = loadDictionary();
  cachedReverseIndex = buildReverseIndex(dict);
  return cachedReverseIndex;
}

// =============================================================================
// LOOKUP FUNCTIONS
// =============================================================================

/**
 * Look up a native language term and return English equivalents
 *
 * @param {string} term - Native language term to look up
 * @returns {Array<{type: string, english: string, lang: string}>} Matches
 *
 * @example
 * lookupTerm('аутентификација')
 * // [{ type: 'concept', english: 'authentication', lang: 'sr' }]
 */
export function lookupTerm(term) {
  if (!term) return [];

  const index = getReverseIndex();
  const normalized = normalizeNFC(term.toLowerCase());

  return index.get(normalized) || [];
}

/**
 * Look up a query and expand all matching terms to English
 *
 * @param {string} query - Full query to expand
 * @returns {{ expanded: string[], matches: Array, unchanged: string[] }}
 *
 * @example
 * lookupQuery('сервис аутентификације')
 * // { expanded: ['AuthService', 'authentication'], matches: [...], unchanged: [] }
 */
export function lookupQuery(query) {
  if (!query) return { expanded: [], matches: [], unchanged: [] };

  const index = getReverseIndex();
  const normalized = normalizeNFC(query.toLowerCase());
  const expanded = new Set();
  const matches = [];
  const unchanged = [];

  // First, try exact full query match
  if (index.has(normalized)) {
    const fullMatches = index.get(normalized);
    for (const match of fullMatches) {
      expanded.add(match.english);
      matches.push({ ...match, matchType: 'full' });
    }
    return { expanded: [...expanded], matches, unchanged: [] };
  }

  // Split into words and try each
  const words = query.split(/\s+/).filter(w => w.length > 0);

  for (const word of words) {
    const wordNorm = normalizeNFC(word.toLowerCase());
    if (index.has(wordNorm)) {
      const wordMatches = index.get(wordNorm);
      for (const match of wordMatches) {
        expanded.add(match.english);
        matches.push({ ...match, matchType: 'word', word });
      }
    } else {
      unchanged.push(word);
    }
  }

  // If no matches found, return original words as unchanged
  if (matches.length === 0) {
    return { expanded: [], matches: [], unchanged: words };
  }

  return { expanded: [...expanded], matches, unchanged };
}

/**
 * Expand a native language query to an English search query
 *
 * @param {string} query - Native language query
 * @returns {string|null} Expanded English query, or null if no expansion possible
 *
 * @example
 * expandToEnglish('сервис за аутентификацију')
 * // "AuthService authentication"
 */
export function expandToEnglish(query) {
  const result = lookupQuery(query);

  if (result.expanded.length === 0) {
    return null;
  }

  // Combine expanded terms
  return result.expanded.join(' ');
}

/**
 * Get all possible translations for an English term
 *
 * @param {string} englishTerm - English term (identifier or concept)
 * @param {string} [type] - 'identifier', 'concept', or undefined for both
 * @returns {Object} Map of language -> translations
 */
export function getTranslations(englishTerm, type) {
  const dict = loadDictionary();
  const results = {};

  if (!type || type === 'identifier') {
    if (dict.identifiers?.[englishTerm]) {
      for (const [lang, terms] of Object.entries(dict.identifiers[englishTerm])) {
        if (!results[lang]) results[lang] = [];
        results[lang].push(...terms);
      }
    }
  }

  if (!type || type === 'concept') {
    if (dict.concepts?.[englishTerm]) {
      for (const [lang, terms] of Object.entries(dict.concepts[englishTerm])) {
        if (!results[lang]) results[lang] = [];
        results[lang].push(...terms);
      }
    }
  }

  return results;
}

// =============================================================================
// ALIAS LOOKUP CLASS
// =============================================================================

/**
 * AliasLookup class for use in fallback pipeline
 */
export class AliasLookup {
  constructor(options = {}) {
    this.maxExpansions = options.maxExpansions ?? 5;
    this.preferIdentifiers = options.preferIdentifiers ?? true;
  }

  /**
   * Initialize the lookup (loads dictionary)
   */
  async init() {
    // Force load and build index
    getReverseIndex();
    return this;
  }

  /**
   * Process a query through alias lookup
   *
   * @param {string} query - Query to process
   * @returns {{ original: string, expanded: string[], hasMatches: boolean, matches: Array }}
   */
  process(query) {
    const result = lookupQuery(query);

    // Sort by type if preferring identifiers
    if (this.preferIdentifiers) {
      result.matches.sort((a, b) => {
        if (a.type === 'identifier' && b.type !== 'identifier') return -1;
        if (a.type !== 'identifier' && b.type === 'identifier') return 1;
        return 0;
      });
    }

    // Limit expansions
    const expanded = result.expanded.slice(0, this.maxExpansions);

    return {
      original: query,
      expanded,
      hasMatches: expanded.length > 0,
      matches: result.matches,
      unchanged: result.unchanged,
    };
  }

  /**
   * Generate search queries from alias expansion
   *
   * @param {string} query - Original query
   * @returns {string[]} Array of search query variants to try
   */
  generateSearchQueries(query) {
    const result = this.process(query);
    const queries = [];

    if (!result.hasMatches) {
      return [query]; // No expansion possible
    }

    // Primary: all expanded terms
    if (result.expanded.length > 0) {
      queries.push(result.expanded.join(' '));
    }

    // Individual identifiers (high priority)
    for (const match of result.matches) {
      if (match.type === 'identifier') {
        queries.push(match.english);
      }
    }

    // Concept combinations
    const concepts = result.matches
      .filter(m => m.type === 'concept')
      .map(m => m.english);
    if (concepts.length > 0) {
      queries.push(concepts.join(' '));
    }

    // Dedupe while preserving order
    return [...new Set(queries)];
  }
}

export default AliasLookup;
