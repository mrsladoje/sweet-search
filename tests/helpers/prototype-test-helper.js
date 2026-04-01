/**
 * Prototype Test Helper for SweetSearch
 *
 * SweetSearch uses a SOLID extraction pattern: pure functions live in separate
 * modules (search-fusion.js, search-boost.js, etc.) and are wired onto the
 * SweetSearch prototype via Object.assign in sweet-search.js (lines 364-391).
 *
 * Because those functions reference `this` (for logging, config, or calling
 * sibling methods), tests need a mock object whose prototype chain includes
 * them. The pattern is:
 *
 *   const mock = Object.create(SweetSearch.prototype);
 *   mock.verbose = false;
 *   mock.log = () => {};
 *   mock.someMethod(args);   // `this` resolves correctly
 *
 * USE `createMockSearcher()` for prototype-bound functions such as:
 *   robustCCFusion, hybridSearchV2, applyPostFusionBoosts, shouldFallbackToRRF,
 *   quantileNormalize, getBoostIntent, semanticSearch3Stage, formatResults, etc.
 *
 * USE direct imports for pure (stateless) functions that do NOT reference `this`:
 *   getResultKey, minMaxNormalize, variance
 *   (These are also on the prototype for convenience, but can be tested standalone.)
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sweetSearchPath = path.join(__dirname, '..', '..', 'core', 'search', 'sweet-search.js');

let _SweetSearch = null;

/**
 * Lazily load and cache the SweetSearch class.
 * @returns {Promise<Function>} The SweetSearch constructor
 */
async function loadSweetSearch() {
  if (!_SweetSearch) {
    const mod = await import(sweetSearchPath);
    _SweetSearch = mod.default || mod.SweetSearch;
  }
  return _SweetSearch;
}

/**
 * Create a mock object backed by SweetSearch.prototype with sensible defaults.
 *
 * @param {object} [overrides] - Properties to merge onto the mock (e.g. verbose, custom stubs)
 * @returns {Promise<object>} A mock searcher with all prototype methods available
 */
export async function createMockSearcher(overrides = {}) {
  const Cls = await loadSweetSearch();
  const mock = Object.create(Cls.prototype);

  // Sensible defaults so prototype methods don't throw on logging calls
  mock.verbose = false;
  mock.log = () => {};
  mock.logPerformance = () => {};

  Object.assign(mock, overrides);
  return mock;
}

/**
 * Return a minimal searchContext object suitable for _applyPostRetrieval testing.
 *
 * @returns {object} A searchContext with all required fields at neutral defaults
 */
export function createMinimalSearchContext() {
  return {
    stats: {},
    semanticStats: null,
    searchMode: 'hybrid',
    effectiveGraphExpand: 'none',
    intentPolicy: null,
    start: Date.now(),
  };
}
