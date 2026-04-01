/**
 * Graph Configuration — code graph, BM25 tuning.
 * Split from core/config.js during DDD migration.
 */

// =============================================================================
// CODE GRAPH CONFIGURATION
// =============================================================================

export const GRAPH_CONFIG = {
  relationshipWeights: {
    extends: 2.0,
    implements: 1.8,
    overrides: 1.5,
    calls: 1.0,
    uses: 0.5,
    throws: 0.6,
    imports: 0.3,
  },
  expansion: {
    maxHops: 2,
    maxExpanded: 30,
  },
};
