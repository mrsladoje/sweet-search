/**
 * Barrel Contract Tests — DDD Fix Plan Phase 1
 *
 * These tests ensure each domain barrel exports its public API.
 * If a public export is removed, the corresponding test will fail,
 * preventing silent barrel regressions.
 */
import { describe, it, expect } from 'vitest';

describe('Domain Barrel Contracts', () => {
  describe('core/embedding', () => {
    it('exports public API', async () => {
      const m = await import('../../core/embedding/index.js');
      // Core embedding functions
      expect(m.getEmbedding).toBeTypeOf('function');
      expect(m.getEmbeddings).toBeTypeOf('function');
      expect(m.generateEmbedding).toBeTypeOf('function');
      expect(m.generateEmbeddings).toBeTypeOf('function');
      expect(m.embed).toBeTypeOf('function');
      // Binary/int8
      expect(m.getBinaryEmbedding).toBeTypeOf('function');
      expect(m.getInt8Embedding).toBeTypeOf('function');
      // Cache
      expect(m.queryCache).toBeDefined();
      expect(m.clearCache).toBeTypeOf('function');
      expect(m.cacheStats).toBeDefined();
      // Telemetry
      expect(m.flushTelemetry).toBeTypeOf('function');
      expect(m.getTelemetryReport).toBeTypeOf('function');
      // Rate limiting
      expect(m.RateLimiter).toBeTypeOf('function');
      expect(m.circuitBreaker).toBeDefined();
      // Local model
      expect(m.callLocalModel).toBeTypeOf('function');
      expect(m.unloadLocalModel).toBeTypeOf('function');
      expect(m.isLocalModelLoaded).toBeTypeOf('function');
      // Vocabulary / semantic cache
      expect(m.Vocabulary).toBeTypeOf('function');
      expect(m.SemanticCache).toBeTypeOf('function');
      expect(m.LRUCache).toBeTypeOf('function');
      // Default export (facade)
      expect(m.default).toBeDefined();
    });
  });

  describe('core/graph', () => {
    it('exports public API', async () => {
      const m = await import('../../core/graph/index.js');
      expect(m.GraphExtractor).toBeTypeOf('function');
      expect(m.GraphSearch).toBeTypeOf('function');
      // Graph operations
      expect(m.insertGraph).toBeTypeOf('function');
      expect(m.loadGraph).toBeTypeOf('function');
      expect(m.createGraphSchema).toBeTypeOf('function');
      // Expansion
      expect(m.expandOneHop).toBeTypeOf('function');
      expect(m.expandSecondHop).toBeTypeOf('function');
      expect(m.expandSecondHopAdaptive).toBeTypeOf('function');
      // Community detection
      expect(m.communityDetector).toBeDefined();
      expect(m.detectCommunities).toBeTypeOf('function');
      expect(m.leidenCommunities).toBeTypeOf('function');
      // Repo map
      expect(m.repoMap).toBeDefined();
      expect(m.generateRepoMap).toBeTypeOf('function');
      // Summary manager
      expect(m.summaryManager).toBeDefined();
      // Relationship resolver
      expect(m.relationshipResolver).toBeDefined();
    });
  });

  describe('core/indexing', () => {
    // The indexing barrel transitively loads tree-sitter WASM grammars
    // which cause SyntaxError in vitest's transform pipeline.
    // We verify exports at the sub-module level instead.
    it('exports incremental tracker', async () => {
      const m = await import('../../core/indexing/incremental-tracker.js');
      expect(m.getChangedFiles).toBeTypeOf('function');
      expect(m.updateState).toBeTypeOf('function');
    });

    it('exports document chunker', async () => {
      const m = await import('../../core/indexing/document-chunker.js');
      expect(m.DocumentChunker).toBeTypeOf('function');
    });

    it('exports indexer-ann', async () => {
      const m = await import('../../core/indexing/indexer-ann.js');
      expect(m.buildHNSWIndex).toBeTypeOf('function');
      expect(m.incrementalUpdateHNSW).toBeTypeOf('function');
      expect(m.buildLateInteractionIndex).toBeTypeOf('function');
      expect(m.buildQuantizedArtifactsPhase).toBeTypeOf('function');
    });
  });

  describe('core/infrastructure', () => {
    it('exports config', async () => {
      const m = await import('../../core/infrastructure/index.js');
      expect(m.PROJECT_ROOT).toBeTypeOf('string');
      expect(m.DB_PATHS).toBeDefined();
      expect(m.EMBEDDING_CONFIG).toBeDefined();
      expect(m.RERANK_CONFIG).toBeDefined();
      expect(m.HNSW_CONFIG).toBeDefined();
      expect(m.GRAPH_CONFIG).toBeDefined();
      expect(m.FILE_PATTERNS).toBeDefined();
      expect(m.PERFORMANCE_TARGETS).toBeDefined();
      expect(m.ROUTING_CONFIG).toBeDefined();
      // Previously missing from default export
      expect(m.MODEL_DELIVERY_CONFIG).toBeDefined();
      expect(m.CASCADE_CONFIG).toBeDefined();
      expect(m.AGENTIC_GITIGNORE_ALLOWLIST).toBeDefined();
      expect(m.loadProjectConfig).toBeTypeOf('function');
      expect(m.getVoyageApiKey).toBeTypeOf('function');
      expect(m.getJinaApiKey).toBeTypeOf('function');
    });

    it('exports shared utilities', async () => {
      const m = await import('../../core/infrastructure/index.js');
      // DB
      expect(m.applyReadPragmas).toBeTypeOf('function');
      // Model management
      expect(m.fetchModel).toBeTypeOf('function');
      expect(m.getModelCacheDir).toBeTypeOf('function');
      expect(m.MODEL_REGISTRY).toBeDefined();
      expect(m.getModelEntry).toBeTypeOf('function');
      expect(m.getModelsForProfile).toBeTypeOf('function');
      // Native
      expect(m.resolveNativeAddon).toBeTypeOf('function');
      expect(m.resolveNativeBinary).toBeTypeOf('function');
      expect(m.getPlatformInfo).toBeTypeOf('function');
      // Tokenizer
      expect(m.createTokenizer).toBeTypeOf('function');
      // ONNX
      expect(m.initOrt).toBeTypeOf('function');
      expect(m.buildFeed).toBeTypeOf('function');
      expect(m.withOnnxMutex).toBeTypeOf('function');
      expect(m.buildSessionOptions).toBeTypeOf('function');
      // CoreML
      expect(m.isAppleSilicon).toBeTypeOf('function');
      expect(m.isCoreMLProviderAvailable).toBeTypeOf('function');
      // Language
      expect(m.getLanguageByPath).toBeTypeOf('function');
      expect(m.getTreeSitterProvider).toBeTypeOf('function');
      expect(m.detectProjectBoundary).toBeTypeOf('function');
      // Constants
      expect(m.SYMBOL_KIND_WEIGHTS).toBeDefined();
      expect(m.DEFINITION_TYPES).toBeDefined();
      // LLM
      expect(m.generateWithRetry).toBeTypeOf('function');
    });

    it('config default export includes all properties', async () => {
      const m = await import('../../core/infrastructure/index.js');
      const cfg = m.config;
      expect(cfg).toBeDefined();
      const required = [
        'PROJECT_ROOT', 'DB_PATHS', 'MODEL_DELIVERY_CONFIG',
        'EMBEDDING_PROVIDERS', 'EMBEDDING_CONFIG', 'RERANK_CONFIG',
        'CASCADE_CONFIG', 'LATE_INTERACTION_CONFIG', 'HNSW_CONFIG',
        'GRAPH_CONFIG', 'ROUTING_CONFIG', 'FILE_PATTERNS',
        'AGENTIC_GITIGNORE_ALLOWLIST', 'PERFORMANCE_TARGETS', 'LOGGING',
        'loadProjectConfig', 'getVoyageApiKey', 'getJinaApiKey',
      ];
      for (const key of required) {
        expect(cfg[key], `config.${key} should be defined`).toBeDefined();
      }
    });
  });

  describe('core/query', () => {
    it('exports public API', async () => {
      const m = await import('../../core/query/index.js');
      expect(m.QueryRouter).toBeTypeOf('function');
      expect(m.IntentDetector).toBeDefined();
      expect(m.classifyIntent).toBeTypeOf('function');
      expect(m.getIntentPolicy).toBeTypeOf('function');
      expect(m.INTENTS).toBeDefined();
      expect(m.routeQuery).toBeTypeOf('function');
      expect(m.detectIntent).toBeTypeOf('function');
    });
  });

  describe('core/ranking', () => {
    it('exports public API', async () => {
      const m = await import('../../core/ranking/index.js');
      // Rerankers
      expect(m.FlashRankReranker).toBeTypeOf('function');
      expect(m.VoyageReranker).toBeTypeOf('function');
      expect(m.JinaReranker).toBeTypeOf('function');
      expect(m.LocalReranker).toBeTypeOf('function');
      // Quality scoring
      expect(m.QualityScorer).toBeTypeOf('function');
      // Cascade
      expect(m.cascadedScore).toBeTypeOf('function');
      expect(m.computeAdaptiveK).toBeTypeOf('function');
      expect(m.isDecisive).toBeTypeOf('function');
      // MMR
      expect(m.applyMMR).toBeTypeOf('function');
      expect(m.shouldApplyMMR).toBeTypeOf('function');
      // Late interaction
      expect(m.LateInteractionIndex).toBeTypeOf('function');
    });
  });

  describe('core/search', () => {
    it('exports public API', async () => {
      const m = await import('../../core/search/index.js');
      expect(m.SweetSearch).toBeTypeOf('function');
      expect(m.default).toBeDefined();
      expect(m.ROUTE_ALPHAS).toBeDefined();
      expect(m.runCli).toBeTypeOf('function');
      expect(m.startServer).toBeTypeOf('function');
      expect(m.queryServer).toBeTypeOf('function');
      expect(m.warmSession).toBeTypeOf('function');
      expect(m.WarmupMetrics).toBeTypeOf('function');
    });
  });

  describe('core/vector-store', () => {
    it('exports public API', async () => {
      const m = await import('../../core/vector-store/index.js');
      expect(m.HNSWIndex).toBeTypeOf('function');
      expect(m.BinaryHNSWIndex).toBeTypeOf('function');
      expect(m.FloatVectorStore).toBeTypeOf('function');
      expect(m.SeismicIndex).toBeTypeOf('function');
      // SIMD distance functions
      expect(m.wasmHammingDistance).toBeTypeOf('function');
      expect(m.wasmInt8Cosine).toBeTypeOf('function');
      expect(m.wasmInt8Dot).toBeTypeOf('function');
      // Heaps
      expect(m.TypedMinHeap).toBeTypeOf('function');
      expect(m.TypedMaxHeap).toBeTypeOf('function');
      expect(m.TopKHeap).toBeTypeOf('function');
    });
  });

  describe('core/vocabulary', () => {
    it('exports public API', async () => {
      const m = await import('../../core/vocabulary/index.js');
      expect(m.vocabMiner).toBeDefined();
      expect(m.vocabWarmer).toBeDefined();
      expect(m.BinaryVocabulary).toBeTypeOf('function');
      expect(m.splitIdentifier).toBeTypeOf('function');
      expect(m.STOP_WORDS).toBeDefined();
      expect(m.mineAll).toBeTypeOf('function');
      expect(m.rankAll).toBeTypeOf('function');
      expect(m.warmupFull).toBeTypeOf('function');
    });
  });

  describe('core/prompt-optimization', () => {
    // Build-time bounded context (P0.0 DDD layout). Real implementations
    // land across P0/P6/P8/P10/P11 per docs/SYSTEM_PROMPT_OPT_PLAN.md.
    // For now the barrel re-exports stubs that throw — the contract test
    // verifies the public-API surface is declared so future replacements
    // can't silently shrink it.
    it('exports public API surface', async () => {
      const m = await import('../../core/prompt-optimization/index.js');

      // Optimization (P9, P10, P10.5)
      expect(m.runGepaCampaign).toBeTypeOf('function');
      expect(m.runDspyCampaign).toBeTypeOf('function');
      expect(m.runSynthesis).toBeTypeOf('function');

      // Evaluation (P6.2, P6.3, P8, P11, P11.5)
      expect(m.runVariantSlate).toBeTypeOf('function');
      expect(m.runQueryShapeSweep).toBeTypeOf('function');
      expect(m.runFourBaselines).toBeTypeOf('function');
      expect(m.runCrossHarness).toBeTypeOf('function');

      // Statistics (P0)
      expect(m.pairedPermutationTest).toBeTypeOf('function');
      expect(m.pairedBootstrapCI).toBeTypeOf('function');
      expect(m.plackettLuceFit).toBeTypeOf('function');
      expect(m.applyEvaluatorExclusion).toBeTypeOf('function');

      // Decontamination (P0)
      expect(m.nGramDecontaminate).toBeTypeOf('function');
      expect(m.embeddingDecontaminate).toBeTypeOf('function');
      expect(m.llmDecontaminate).toBeTypeOf('function');

      // Judges (P6.3, P11.5)
      expect(m.runPrpPairwise).toBeTypeOf('function');
      expect(m.validateJudgeIAA).toBeTypeOf('function');

      // Failure modes (P8.5, §13.6)
      expect(m.detectFailureModes).toBeTypeOf('function');
      expect(m.tagProposalClass).toBeTypeOf('function');

      // Telemetry (§8.9.1, §8.9.3)
      expect(m.emitPortabilityDossier).toBeTypeOf('function');
      expect(m.appendBudgetTelemetry).toBeTypeOf('function');

      // Manifests / splits (P0)
      expect(m.loadManifest).toBeTypeOf('function');
      expect(m.buildSplits).toBeTypeOf('function');
      expect(m.loadRunConfig).toBeTypeOf('function');
    });

    it('stubs throw with a phase pointer when invoked', async () => {
      const m = await import('../../core/prompt-optimization/index.js');
      expect(() => m.runGepaCampaign()).toThrow(/not yet implemented/);
      expect(() => m.loadManifest()).toThrow(/SYSTEM_PROMPT_OPT_PLAN/);
    });
  });
});
