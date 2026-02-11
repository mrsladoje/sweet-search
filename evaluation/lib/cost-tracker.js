/**
 * Sweet Search Cost Tracker
 *
 * Tracks API costs for embedding and reranking calls.
 * Supports Voyage, Jina, and Mistral providers.
 *
 * Pricing as of January 2026:
 * - Voyage Code 3: $0.18/1M input tokens (embeddings)
 * - Voyage 3.5: $0.06/1M input tokens
 * - Voyage 3.5 Lite: $0.02/1M input tokens
 * - Voyage Rerank-2-lite: $0.05/1M tokens
 * - Jina Reranker v3: $0.018/1M tokens
 * - Mistral Codestral Embed: $0.20/1M tokens
 */

// API pricing per token (as of January 2026)
const PRICING = {
  voyage: {
    'voyage-code-3': 0.18 / 1_000_000,      // $0.18 per 1M input tokens (updated)
    'voyage-3.5': 0.06 / 1_000_000,          // $0.06 per 1M input tokens
    'voyage-3.5-lite': 0.02 / 1_000_000,     // $0.02 per 1M input tokens
    embed: 0.18 / 1_000_000,                 // Default embed pricing (voyage-code-3)
    rerank: 0.05 / 1_000_000,                // Voyage rerank-2-lite
  },
  jina: {
    embed: 0.02 / 1_000_000,      // jina-embeddings-v3
    rerank: 0.018 / 1_000_000,    // jina-reranker-v3
  },
  mistral: {
    embed: 0.20 / 1_000_000,      // codestral-embed-2505
    rerank: 0,                     // Mistral doesn't have reranker
  },
  flashrank: {
    embed: 0,                      // Local, no cost
    rerank: 0,                     // Local, no cost
  },
  local: {
    embed: 0,                      // Xenova/ONNX local
    rerank: 0,                     // Local FlashRank
  },
};

// Average tokens per query (estimated from typical code search workloads)
const AVG_TOKENS_PER_QUERY = 15;         // Short queries like "AuthService"
const AVG_TOKENS_PER_DOCUMENT = 150;     // Code chunks for reranking

/**
 * CostTracker - Tracks API costs for embedding and reranking
 */
export class CostTracker {
  constructor() {
    this.unknownProviders = new Set(); // Track unknown providers (init before reset)
    this.reset();
  }

  /**
   * Reset all tracked costs
   */
  reset() {
    this.costs = {
      embed: 0,
      rerank: 0,
      total: 0,
    };
    this.calls = {
      embed: 0,
      embedCached: 0,
      rerank: 0,
      rerankSkipped: 0,
    };
    this.tokens = {
      embed: 0,
      rerank: 0,
    };
    this.unknownProviders.clear();
  }

  /**
   * Track an embedding API call
   *
   * @param {number} tokens - Number of input tokens (or estimate from query length)
   * @param {string} provider - Provider name ('voyage', 'jina', 'mistral', 'local')
   * @param {boolean} cached - Whether the embedding was served from cache
   */
  trackEmbedding(tokens, provider = 'voyage', cached = false) {
    // Validate tokens is non-negative
    if (tokens < 0) {
      console.warn(`[CostTracker] Negative tokens value: ${tokens}, using 0`);
      tokens = 0;
    }

    if (cached) {
      this.calls.embedCached++;
      return; // No cost for cache hits
    }

    const pricing = PRICING[provider];
    if (!pricing) {
      this.unknownProviders.add(provider);
      console.warn(`[CostTracker] Unknown embedding provider '${provider}', using Voyage pricing ($${(PRICING.voyage.embed * 1_000_000).toFixed(2)}/1M tokens) as fallback`);
    }
    const effectivePricing = pricing || PRICING.voyage;
    const cost = tokens * effectivePricing.embed;

    this.costs.embed += cost;
    this.costs.total += cost;
    this.calls.embed++;
    this.tokens.embed += tokens;
  }

  /**
   * Track embedding from query stats
   *
   * @param {object} stats - Query stats from SweetSearch { embedding: { source, tokens } }
   */
  trackEmbeddingFromStats(stats) {
    if (!stats?.embedding) return;

    const { source, tokens, provider } = stats.embedding;
    const isCached = source === 'vocabulary' || source === 'lru' || source === 'semantic';
    const actualProvider = provider || 'voyage';
    const actualTokens = tokens || AVG_TOKENS_PER_QUERY;

    this.trackEmbedding(actualTokens, actualProvider, isCached);
  }

  /**
   * Track a reranking API call
   *
   * @param {number} tokens - Number of tokens (query + documents)
   * @param {string} provider - Provider name ('voyage', 'jina', 'flashrank')
   * @param {boolean} skipped - Whether reranking was skipped (score spread analysis)
   */
  trackRerank(tokens, provider = 'voyage', skipped = false) {
    // Validate tokens is non-negative
    if (tokens < 0) {
      console.warn(`[CostTracker] Negative tokens value: ${tokens}, using 0`);
      tokens = 0;
    }

    if (skipped) {
      this.calls.rerankSkipped++;
      return; // No cost when skipped
    }

    const pricing = PRICING[provider];
    if (!pricing) {
      this.unknownProviders.add(provider);
      console.warn(`[CostTracker] Unknown rerank provider '${provider}', using Voyage pricing ($${(PRICING.voyage.rerank * 1_000_000).toFixed(4)}/1M tokens) as fallback`);
    }
    const effectivePricing = pricing || PRICING.voyage;
    const cost = tokens * effectivePricing.rerank;

    this.costs.rerank += cost;
    this.costs.total += cost;
    this.calls.rerank++;
    this.tokens.rerank += tokens;
  }

  /**
   * Track reranking from query stats
   *
   * @param {object} stats - Query stats from SweetSearch { rerank: { provider, skipped, documents } }
   */
  trackRerankFromStats(stats) {
    if (!stats?.rerank) return;

    const { provider, skipped, documents, tokens } = stats.rerank;
    const actualProvider = provider || 'flashrank';
    const actualTokens = tokens || (documents || 10) * AVG_TOKENS_PER_DOCUMENT;

    this.trackRerank(actualTokens, actualProvider, skipped);
  }

  /**
   * Track all costs from a query's stats object
   *
   * @param {object} stats - Full query stats from SweetSearch
   */
  trackFromStats(stats) {
    this.trackEmbeddingFromStats(stats);
    this.trackRerankFromStats(stats);
  }

  /**
   * Get cost statistics
   *
   * @returns {object} Cost statistics including unknownProviders array
   */
  getStats() {
    const totalQueries = this.calls.embed + this.calls.embedCached;

    return {
      costs: {
        embed: Math.round(this.costs.embed * 1_000_000) / 1_000_000,  // Round to 6 decimals
        rerank: Math.round(this.costs.rerank * 1_000_000) / 1_000_000,
        total: Math.round(this.costs.total * 1_000_000) / 1_000_000,
      },
      avgCostPerQuery: totalQueries > 0
        ? Math.round((this.costs.total / totalQueries) * 1_000_000) / 1_000_000
        : 0,
      calls: { ...this.calls },
      tokens: { ...this.tokens },
      efficiency: {
        embedCacheRate: totalQueries > 0
          ? Math.round((this.calls.embedCached / totalQueries) * 100) / 100
          : 0,
        rerankSkipRate: (this.calls.rerank + this.calls.rerankSkipped) > 0
          ? Math.round((this.calls.rerankSkipped / (this.calls.rerank + this.calls.rerankSkipped)) * 100) / 100
          : 0,
      },
      unknownProviders: [...this.unknownProviders],
    };
  }

  /**
   * Get list of unknown providers encountered
   * Useful for debugging and adding missing provider pricing
   *
   * @returns {string[]} Array of unknown provider names
   */
  getUnknownProviders() {
    return [...this.unknownProviders];
  }

  /**
   * Format costs as human-readable string
   *
   * @returns {string} Formatted cost summary
   */
  format() {
    const stats = this.getStats();
    const lines = [
      `Cost Summary:`,
      `  Embedding: $${stats.costs.embed.toFixed(6)} (${stats.calls.embed} API calls, ${stats.calls.embedCached} cached)`,
      `  Reranking: $${stats.costs.rerank.toFixed(6)} (${stats.calls.rerank} API calls, ${stats.calls.rerankSkipped} skipped)`,
      `  Total: $${stats.costs.total.toFixed(6)}`,
      `  Avg/query: $${stats.avgCostPerQuery.toFixed(6)}`,
      `  Cache hit rate: ${(stats.efficiency.embedCacheRate * 100).toFixed(1)}%`,
      `  Rerank skip rate: ${(stats.efficiency.rerankSkipRate * 100).toFixed(1)}%`,
    ];
    return lines.join('\n');
  }
}

/**
 * Estimate cost for a query without actually making API calls
 *
 * @param {string} query - The search query
 * @param {object} options - { cached, rerankSkipped, provider, numDocuments }
 * @returns {object} Estimated costs
 */
export function estimateQueryCost(query, options = {}) {
  const {
    cached = false,
    rerankSkipped = false,
    provider = 'voyage',
    numDocuments = 10,
  } = options;

  const pricing = PRICING[provider] || PRICING.voyage;

  // Estimate tokens (roughly 1 token per 4 characters for English)
  const queryTokens = Math.ceil(query.length / 4);
  const docTokens = numDocuments * AVG_TOKENS_PER_DOCUMENT;

  const embedCost = cached ? 0 : queryTokens * pricing.embed;
  const rerankCost = rerankSkipped ? 0 : (queryTokens + docTokens) * pricing.rerank;

  return {
    embed: embedCost,
    rerank: rerankCost,
    total: embedCost + rerankCost,
    tokens: {
      query: queryTokens,
      documents: docTokens,
    },
  };
}

export default CostTracker;
