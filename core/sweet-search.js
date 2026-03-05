#!/usr/bin/env node
/**
 * Sweet Search v2.3 - Unified Search Pipeline with Auto-Warm Server
 * Server: /tmp/sweet-search.sock (Unix), port 9876 (TCP)
 * See search-server.js for server implementation.
 *
 * SOLID refactor: Functions extracted into search-fusion, search-boost,
 * search-format, search-semantic, search-hybrid, search-postprocess,
 * search-server, search-cli modules and wired back via prototype.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { DB_PATHS, PERFORMANCE_TARGETS, LOGGING, BINARY_HNSW_CONFIG, HCGS_CONFIG, LATE_INTERACTION_CONFIG, EMBEDDING_CONFIG, SEISMIC_CONFIG, CASCADE_CONFIG, loadProjectConfig, shouldUseLocalReranker } from './config.js';
import { getGlobalLocalReranker } from './local-reranker.js';
import { QueryRouter, routeQuery } from './query-router.js';
import { GraphSearch } from './graph-search.js';
import { SYMBOL_KIND_WEIGHTS, DEFINITION_TYPES } from './constants.js';
import { HNSWIndex } from './hnsw-index.js';
import { BinaryHNSWIndex } from './binary-hnsw-index.js';
import { Reranker } from './flashrank.js';
import { LateInteractionIndex } from './late-interaction-index.js';
import { getEmbedding, getBinaryEmbedding, truncateForHNSW, floatToInt8, int8CosineSimilarity, warmup as warmupEmbedding, isWarm, registerAutoPersistOnExit } from './embedding-service.js';
import { recordQueryTelemetry } from './embedding-cache.js';
import Database from 'better-sqlite3';
import { TranslationFallback, queryNeedsTranslation } from '../translation/index.js';
import { expandResults } from './graph-expansion.js';
import { applyMMR, shouldApplyMMR, getLambdaForIntent, MMR_CONFIG } from './mmr.js';
import { QualityScorer, setRepoMapModule } from './quality-scorer.js';
import { pageRank, loadGraph, buildAdjacency } from './repo-map.js';
import { classifyIntent, getIntentPolicy } from './intent-router.js';

// SOLID extracted modules
import * as fusion from './search-fusion.js';
import * as boost from './search-boost.js';
import * as format from './search-format.js';
import * as semantic from './search-semantic.js';
import * as hybrid from './search-hybrid.js';
import * as postprocess from './search-postprocess.js';

export { ROUTE_ALPHAS } from './search-fusion.js';

export class SweetSearch {
  constructor(options = {}) {
    const projectRoot = options.projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
    const projectConfig = loadProjectConfig(projectRoot);
    const projectCascade = projectConfig.cascade || {};
    const envOrProject = (envKey, cascadeKey, configKey) =>
      process.env[envKey] != null ? CASCADE_CONFIG[configKey] : projectCascade[cascadeKey];

    this.graphSearch = new GraphSearch(options.graphDbPath || DB_PATHS.codeGraph);
    this.hnswIndex = new HNSWIndex({ indexPath: options.hnswPath || DB_PATHS.hnswIndex });
    this.binaryHnswIndex = new BinaryHNSWIndex({ indexPath: options.binaryHnswPath || DB_PATHS.binaryHnswIndex });
    this.reranker = new Reranker(options);
    this.lateInteractionIndex = new LateInteractionIndex(options.lateInteractionOptions || {});
    this.router = new QueryRouter();
    this.codebaseDbPath = options.codebaseDbPath || DB_PATHS.codebase;
    this.verbose = options.verbose ?? LOGGING.verbose;
    this.timing = options.timing ?? LOGGING.timing;
    this.use3Stage = options.use3Stage ?? true;
    this.stage1Candidates = options.stage1Candidates ?? BINARY_HNSW_CONFIG.retrieval.stage1Candidates;
    this.stage2Candidates = options.stage2Candidates ?? BINARY_HNSW_CONFIG.retrieval.stage2Candidates;
    this.stage3Candidates = options.stage3Candidates ?? BINARY_HNSW_CONFIG.retrieval.stage3Candidates;
    this.useLateInteraction = options.useLateInteraction ?? LATE_INTERACTION_CONFIG.enabled;
    this.lateInteractionBlendWeight = options.lateInteractionBlendWeight ?? LATE_INTERACTION_CONFIG.blendWeight ?? 0.3;
    this.returnSummaryFirst = options.returnSummaryFirst ?? HCGS_CONFIG.returnSummaryFirst;
    this.summaryTokenBudget = options.summaryTokenBudget ?? HCGS_CONFIG.summaryTokenBudget;
    this.fullCodeTokenBudget = options.fullCodeTokenBudget ?? HCGS_CONFIG.fullCodeTokenBudget;
    this.enableTranslationFallback = options.enableTranslationFallback ?? true;
    this.translationFallback = new TranslationFallback(options.translation || {});
    // SEISMIC sparse vector path (lazy-loaded when SEISMIC_CONFIG.enabled)
    this._seismicIndex = null;
    this.qualityWeight = options.qualityWeight ?? 0;
    // Cascade scoring (Section 26): MaxSim → gate → conditional CE
    this.cascadeEnabled = options.cascadeEnabled
      ?? envOrProject('SWEET_SEARCH_CASCADE_ENABLED', 'enabled', 'enabled')
      ?? CASCADE_CONFIG.enabled;
    this.cascadeCeTopK = options.cascadeCeTopK
      ?? envOrProject('SWEET_SEARCH_CASCADE_CE_TOP_K', 'ceTopK', 'ceTopK')
      ?? CASCADE_CONFIG.ceTopK;
    this.cascadeGateThreshold = options.cascadeGateThreshold
      ?? envOrProject('SWEET_SEARCH_CASCADE_GATE_THRESHOLD', 'gateThreshold', 'gateThreshold')
      ?? CASCADE_CONFIG.gateThreshold;
    this.cascadeForceFullCE = options.cascadeForceFullCE
      ?? envOrProject('SWEET_SEARCH_FORCE_FULL_CE', 'forceFullCrossEncoder', 'forceFullCrossEncoder')
      ?? CASCADE_CONFIG.forceFullCrossEncoder;
    setRepoMapModule({ pageRank, loadGraph, buildAdjacency });
    this._qualityScorer = null;
    this._codebaseDb = null;
    this.initialized = false;
  }

  /** Lazy read-only connection to codebase.db (for token estimation). */
  get codebaseDb() {
    if (!this._codebaseDb && this.hasCodebaseIndex) {
      try {
        this._codebaseDb = new Database(this.codebaseDbPath, { readonly: true });
      } catch {
        // Fall back to language multipliers if DB can't be opened
      }
    }
    return this._codebaseDb;
  }

  /** Initialize all search components */
  async init() {
    if (this.initialized) return;
    const start = Date.now();

    this.hasGraphIndex = existsSync(DB_PATHS.codeGraph);
    this.hasHnswIndex = existsSync(DB_PATHS.hnswIndex.replace('.idx', '.meta.json'));
    this.hasBinaryHnswIndex = existsSync(DB_PATHS.binaryHnswIndex.replace('.idx', '.meta.json'));
    this.hasCodebaseIndex = existsSync(this.codebaseDbPath);
    this.hasLateInteractionIndex = existsSync(this.lateInteractionIndex.indexPath);

    if (!this.hasGraphIndex && !this.hasCodebaseIndex) {
      throw new Error('No search indexes found. Run indexing first.');
    }

    if (this.hasBinaryHnswIndex && this.use3Stage) {
      try {
        await this.binaryHnswIndex.load();
        const stats = this.binaryHnswIndex.getStats();
        this.log(`BinaryHNSW: Loaded ${stats.totalVectors} vectors (${stats.memorySizeMB} MB)`);
      } catch (err) {
        this.log(`BinaryHNSW: Failed to load: ${err.message}`);
        this.hasBinaryHnswIndex = false;
      }
    }

    if (this.hasHnswIndex) {
      try {
        await this.hnswIndex.load();
        this.log(`HNSW: Loaded ${this.hnswIndex.getStats().totalVectors} vectors`);
      } catch (err) {
        this.log(`HNSW: Failed to load: ${err.message}`);
        this.hasHnswIndex = false;
      }
    }

    if (this.hasLateInteractionIndex && this.useLateInteraction) {
      try {
        await this.lateInteractionIndex.init();
        const stats = this.lateInteractionIndex.getStats();
        this.log(`LateInteraction: Loaded ${stats.documents} documents (${stats.estimatedSizeMB} MB, ${stats.avgTokensPerDoc} avg tokens)`);
      } catch (err) {
        this.log(`LateInteraction: Failed to load: ${err.message}`);
        this.hasLateInteractionIndex = false;
      }
    }

    await warmupEmbedding({ initVocabulary: true, initSemanticCache: true });

    if (shouldUseLocalReranker()) {
      try {
        const localReranker = getGlobalLocalReranker();
        await localReranker.init();
        this.log('LocalReranker: Pre-initialized (gte-reranker-modernbert-base INT8)');
      } catch (err) {
        this.log(`LocalReranker: Pre-init failed: ${err.message}`);
      }
    }

    if (this.enableTranslationFallback) {
      await this.translationFallback.init();
      this.log('TranslationFallback: Initialized');
    }

    this.initialized = true;
    this.log(`SweetSearch: Initialized in ${Date.now() - start}ms`);
  }

  /** Main search entry point. */
  async search(query, options = {}) {
    await this.init();
    const {
      k = 10, mode = 'auto', expand = true, rerank = true,
      fusion: fusionOpt = 'cc', useLateInteraction = this.useLateInteraction,
      translate = 'auto', graphExpand = 'none', graphExpandOptions = {},
      adaptiveHop2 = true, intent = 'none', qualityWeight = this.qualityWeight,
    } = options;

    const start = Date.now();
    const stats = { query };

    // P2.2: Intent-aware retrieval routing
    let effectiveGraphExpand = graphExpand;
    let intentResult;
    let intentPolicy = null;
    if (intent === 'auto') {
      intentResult = classifyIntent(query);
    } else if (intent && intent !== 'none') {
      intentResult = { intent, confidence: 1, scores: {} };
    }
    if (intentResult) {
      intentPolicy = getIntentPolicy(intentResult.intent);
      stats.intent = {
        classified: intentResult.intent, confidence: intentResult.confidence,
        expandMode: intentPolicy.expandMode, maxResults: intentPolicy.maxResults,
      };
      if (graphExpand === 'none' && intentPolicy.expandMode !== 'none') {
        effectiveGraphExpand = intentPolicy.expandMode;
      }
    }

    // Step 1: Route query
    const routing = mode === 'auto' ? routeQuery(query) : null;
    let searchMode;
    if (mode === 'auto') {
      searchMode = routing.mode;
      stats.routing = { mode: routing.mode, confidence: routing.confidence, latency_us: routing.routingLatency_us };
    } else {
      searchMode = mode;
      stats.routing = { mode, forced: true };
    }
    this.log(`Search mode: ${searchMode}`);

    // Step 2: Execute search based on mode
    let results;
    let semanticStats = null;

    switch (searchMode) {
      case 'structural':
        results = await this.structuralSearch(query, routing, options);
        stats.path = 'structural';
        stats.structuralType = routing.structuralType;
        stats.targetEntity = routing.targetEntity;
        break;
      case 'lexical': {
        const lexResult = await this.lexicalSearch(query, { k, expand });
        results = lexResult.results;
        stats.path = 'lexical';
        stats.confidence = lexResult.stats?.confidence;
        stats.lexicalMode = lexResult.stats?.mode;
        // When expansion was deferred (ambiguous + expand=true), ensure
        // postprocess expansion runs by promoting graphExpand from 'none'.
        if (stats.confidence === 'ambiguous' && expand && effectiveGraphExpand === 'none') {
          effectiveGraphExpand = '1hop';
        }
        break;
      }
      case 'semantic': {
        const semanticResult = await this.semanticSearch(query, { k, rerank, useLateInteraction });
        results = semanticResult.results;
        semanticStats = semanticResult.stats;
        stats.path = 'semantic';
        break;
      }
      case 'hybrid':
      default: {
        const hybridResult = await this.hybridSearchV2(query, { k, useLateInteraction, routing });
        results = hybridResult.results || hybridResult;
        semanticStats = hybridResult.semanticStats || null;
        stats.path = 'hybrid';
        stats.fusion = hybridResult.fusionStats?.method || 'cc';
        stats.fusionFallback = hybridResult.fusionStats?.fallbackReason || null;
        stats.lexicalLatencyMs = hybridResult.fusionStats?.lexicalLatencyMs ?? null;
        break;
      }
    }

    // Step 3: Post-retrieval processing (delegated to extracted module)
    return this._applyPostRetrieval(results, query, options, {
      stats, semanticStats, searchMode, effectiveGraphExpand, intentPolicy, start,
    });
  }

  /** Internal search without translation fallback (to avoid recursion) */
  async searchWithoutFallback(query, options = {}) {
    const originalEnable = this.enableTranslationFallback;
    this.enableTranslationFallback = false;
    try {
      return await this.search(query, { ...options, translate: 'false' });
    } finally {
      this.enableTranslationFallback = originalEnable;
    }
  }

  /** Structural search path (GraphRAG structural queries) */
  async structuralSearch(query, routing, options = {}) {
    const { structuralType, targetEntity } = routing;
    const start = performance.now();
    let result;
    switch (structuralType) {
      case 'callers': result = await this.graphSearch.findCallers(targetEntity); break;
      case 'callees': result = await this.graphSearch.findCallees(targetEntity); break;
      case 'implementations': result = await this.graphSearch.findImplementations(targetEntity); break;
      case 'impact': result = await this.graphSearch.findImpact(targetEntity); break;
      default: return [];
    }
    const elapsed = performance.now() - start;
    this.log(`Structural (${structuralType}): ${elapsed.toFixed(1)}ms, ${result.results.length} results`);
    return result.results.map(r => ({ ...r, searchPath: 'structural', structuralType }));
  }

  /** Lexical search path (FTS5/BM25 + Graph) */
  async lexicalSearch(query, options = {}) {
    const { k = 10, expand = true } = options;
    if (!this.hasGraphIndex) {
      this.log('Lexical search unavailable: no graph index');
      return { results: [], stats: { confidence: 'exact' } };
    }
    const { results, stats } = await this.graphSearch.graphExpandedSearch(query, {
      k, expand, deferExpansion: expand,
    });
    this.log(`Lexical: ${stats.bm25_ms}ms BM25, ${stats.graph_ms || 0}ms graph (confidence: ${stats.confidence})`);
    return {
      results: results.map(r => ({ ...r, searchPath: 'lexical' })),
      stats,
    };
  }

  /** Semantic search dispatcher. Delegates to 3Stage or Standard based on config. */
  async semanticSearch(query, options = {}) {
    const { k = 10, rerank = true, useLateInteraction = this.useLateInteraction } = options;
    if (this.hasBinaryHnswIndex && this.use3Stage) {
      return this.semanticSearch3Stage(query, { k, rerank, useLateInteraction });
    }
    return this.semanticSearchStandard(query, { k, rerank });
  }

  /** O(N) vector scan fallback (when HNSW not available). Filters stale entities. */
  async vectorScan(queryEmbedding, limit = 100) {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const dbBuffer = await fs.readFile(this.codebaseDbPath);
    const db = new SQL.Database(dbBuffer);
    const stmt = db.prepare('SELECT id, embedding, text, metadata FROM vectors');
    const candidates = [];

    const staleEntityIds = new Set();
    if (this.hasGraphIndex) {
      try {
        const graphDbBuffer = await fs.readFile(DB_PATHS.codeGraph);
        const graphDb = new SQL.Database(graphDbBuffer);
        const columns = graphDb.exec("PRAGMA table_info(entities)");
        const hasStaleColumn = columns.length > 0 &&
          columns[0].values.some(col => col[1] === 'stale_since');
        if (hasStaleColumn) {
          const staleStmt = graphDb.prepare('SELECT id FROM entities WHERE stale_since IS NOT NULL');
          while (staleStmt.step()) { staleEntityIds.add(staleStmt.getAsObject().id); }
          staleStmt.free();
        }
        graphDb.close();
      } catch (err) { this.log(`A1: Could not load stale entity list: ${err.message}`); }
    }

    while (stmt.step()) {
      const row = stmt.getAsObject();
      const embeddingBuffer = row.embedding;
      const embedding = new Float32Array(embeddingBuffer.buffer, embeddingBuffer.byteOffset, embeddingBuffer.length / 4);
      const score = this.cosineSimilarity(queryEmbedding, Array.from(embedding));
      let metadata = {};
      try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch (err) {
        if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      }
      candidates.push({ id: row.id, content: row.text || '', score, metadata, entity_id: metadata.entity_id || null });
    }
    stmt.free();
    db.close();

    const activeResults = candidates.filter(r => {
      if (r.entity_id && staleEntityIds.has(r.entity_id)) return false;
      if (r.metadata?.entity_id && staleEntityIds.has(r.metadata.entity_id)) return false;
      return true;
    });
    this.log(`A1: Vector scan found ${candidates.length} candidates, ${activeResults.length} active (${staleEntityIds.size} stale entities filtered)`);
    return activeResults.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Load document content for reranking */
  async loadDocumentContent(candidates) {
    return candidates.map(c => {
      const content = c.content || c.text || '';
      const name = c.name || c.metadata?.name || '';
      const file = c.file || c.metadata?.file || '';
      return `${file} ${name}\n${content}`.slice(0, 1000);
    });
  }

  /** Cosine similarity */
  cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // approximateLateInteractionScore removed — replaced by real per-token MaxSim via LateOn-Code
  // in search-semantic.js (Phase 4 of LATE_INTERACTION.md)

  /** Log message (if verbose). Uses stderr to avoid corrupting JSON output. */
  log(message) { if (this.verbose) console.error(`[SweetSearch] ${message}`); }

  /** Log performance stats */
  logPerformance(stats) {
    const target = PERFORMANCE_TARGETS.latency;
    let status = 'OK';
    if (stats.path === 'lexical' && stats.total_ms > target.lexicalP50 * 2) status = 'SLOW';
    if (stats.path === 'semantic' && stats.total_ms > target.semanticP50 * 2) status = 'SLOW';
    console.error(`[Perf] ${stats.path} | ${stats.total_ms}ms | ${status}`);
  }

  /** Close all connections */
  close() {
    this.graphSearch.close();
    this._codebaseDb?.close();
    this._codebaseDb = null;
  }
}

// Prototype wiring (extracted module functions)
Object.assign(SweetSearch.prototype, {
  getResultKey: fusion.getResultKey,
  minMaxNormalize: fusion.minMaxNormalize,
  quantileNormalize: fusion.quantileNormalize,
  convexCombination: fusion.convexCombination,
  shouldFallbackToRRF: fusion.shouldFallbackToRRF,
  rrfFusion: fusion.rrfFusion,
  robustCCFusion: fusion.robustCCFusion,
  variance: fusion.variance,
  getBoostIntent: boost.getBoostIntent,
  applyPostFusionBoosts: boost.applyPostFusionBoosts,
  computeDefinitionBoost: boost.computeDefinitionBoost,
  computeSyntaxBoost: boost.computeSyntaxBoost,
  computePositionBoost: boost.computePositionBoost,
  extractQueryTokens: boost.extractQueryTokens,
  formatResults: format.formatResults,
  formatStructuralResults: format.formatStructuralResults,
  formatSummaryFirst: format.formatSummaryFirst,
  formatMiddleRes: format.formatMiddleRes,
  enrichWithSummaries: format.enrichWithSummaries,
  semanticSearch3Stage: semantic.semanticSearch3Stage,
  semanticSearchStandard: semantic.semanticSearchStandard,
  shouldSkipRerank: semantic.shouldSkipRerank,
  getAdaptiveCandidateCount: semantic.getAdaptiveCandidateCount,
  hybridSearchV2: hybrid.hybridSearchV2,
  hybridSearch: hybrid.hybridSearch,
  _applyPostRetrieval: postprocess.applyPostRetrieval,
});

SweetSearch.BOOST_POLICY = boost.BOOST_POLICY;

// Module-level singleton (warm cache)
let _warmSearcher = null;
let _warmInitPromise = null;

/** Get or create a warm SweetSearch instance (singleton). */
export async function getWarmSearcher(options = {}) {
  if (_warmSearcher && _warmSearcher.initialized) return _warmSearcher;
  if (_warmInitPromise) { await _warmInitPromise; return _warmSearcher; }
  _warmSearcher = new SweetSearch(options);
  _warmInitPromise = _warmSearcher.init();
  await _warmInitPromise;
  return _warmSearcher;
}

/** Quick search using warm cache (for programmatic use) */
export async function warmSearch(query, options = {}) {
  const searcher = await getWarmSearcher();
  return searcher.search(query, options);
}

// CLI guard
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const { runCli } = await import('./search-cli.js');
  await runCli(args);
}

export default SweetSearch;
/** @deprecated Use SweetSearch instead. SmartSearch is a legacy alias. */
export { SweetSearch as SmartSearch };
