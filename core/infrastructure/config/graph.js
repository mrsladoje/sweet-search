/**
 * Graph Configuration — code graph, HCGS, BM25 tuning.
 * Split from core/config.js during DDD migration.
 */

// =============================================================================
// HCGS CONFIGURATION (Hierarchical Code Graph Summaries)
// Reference: https://arxiv.org/abs/2504.08975 (Code-Craft paper, April 2025)
// =============================================================================

export const HCGS_CONFIG = {
  // Summary generation
  enabled: false,

  // Hierarchy levels (bottom-up order)
  levels: ['function', 'method', 'field', 'class', 'interface', 'enum', 'package', 'file'],

  // Adaptive summary token limits by entity type (SOTA December 2025)
  // Based on: Code-Craft paper + Qodo RAG recommendations
  // Key insight: complexity-aware lengths improve retrieval precision
  summaryTokenLimits: {
    // Leaf entities: brief descriptions (1-2 sentences)
    method: 80,       // "Validates user credentials against database and returns boolean result"
    function: 80,     // Same as method
    field: 40,        // "User ID for session tracking"
    rpc: 80,          // "gRPC endpoint for streaming events"

    // Container entities: purpose + responsibilities
    class: 150,       // Describe purpose, key methods, design patterns
    interface: 120,   // Contract description + key method signatures
    enum: 60,         // List values and their meaning
    service: 150,     // Service responsibilities + dependencies
    message: 80,      // Protobuf message structure

    // File/Package level: architectural overview
    file: 200,        // Main exports, dependencies, role in system
    package: 250,     // Package purpose + key classes + relationships
  },

  // Default for unknown types
  defaultTokenLimit: 100,

  // Legacy fallback (chars) - kept for backward compatibility
  maxSummaryLength: 500,        // ~100-125 tokens
  maxChildContext: 800,         // chars of child summaries to include

  // Model for summary generation (Claude Haiku is fast and cheap)
  model: 'claude-3-5-haiku-latest',

  // Batch processing
  batchSize: 20,

  // Cache settings
  cacheEnabled: true,

  // Token savings: return summary first, full code on "expand"
  returnSummaryFirst: false,
  summaryTokenBudget: 150,      // tokens per result in summary mode
  fullCodeTokenBudget: 1000,    // tokens per result in expanded mode
};

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
