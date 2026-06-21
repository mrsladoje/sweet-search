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
    // Build-time bounded context. P0.0 (2026-05-09) declared the surface;
    // P0 (this commit) wired stats / decontamination / splits / manifests.
    // Remaining stubs (P6.2-P11.5) still throw with a phase pointer so any
    // accidental runtime use fails loudly. The contract test asserts both:
    // declared surface stays stable, and pending stubs surface their phase.
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

      // §0.5 dual-layer overfit-control infrastructure (P0, added 2026-05-09)
      expect(m.openThresholdout).toBeTypeOf('function');
      expect(m.initBudgetLog).toBeTypeOf('function');
      expect(m.readBudgetUsage).toBeTypeOf('function');
      expect(m.BudgetExhaustedError).toBeTypeOf('function');
      expect(m.benjaminiHochberg).toBeTypeOf('function');
      expect(m.survivors).toBeTypeOf('function');
      expect(m.runThresholdSensitivity).toBeTypeOf('function');
      expect(m.lengthPenalisedScore).toBeTypeOf('function');
      expect(m.truncateToTokens).toBeTypeOf('function');
      expect(m.truncationCheck).toBeTypeOf('function');

      // Decontamination (P0)
      expect(m.nGramDecontaminate).toBeTypeOf('function');
      expect(m.embeddingDecontaminate).toBeTypeOf('function');
      expect(m.llmDecontaminate).toBeTypeOf('function');
      expect(m.buildLeakageCorpus).toBeTypeOf('function');
      expect(m.checkLeakage).toBeTypeOf('function');
      expect(m.loadWhitelist).toBeTypeOf('function');

      // Held-out model panel campaign-end gate (§11.11, P0)
      expect(m.assertReleaseTag).toBeTypeOf('function');
      expect(m.loadHompFromManifest).toBeTypeOf('function');
      expect(m.computeTransferGap).toBeTypeOf('function');
      expect(m.writeHompReport).toBeTypeOf('function');

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

    it('pending stubs throw with a phase pointer when invoked', async () => {
      const m = await import('../../core/prompt-optimization/index.js');
      expect(() => m.runGepaCampaign()).toThrow(/lands in P10/);
      expect(() => m.runSynthesis()).toThrow(/SYSTEM_PROMPT_OPT_PLAN/);
      expect(() => m.applyEvaluatorExclusion()).toThrow(/§8\.9\.1/);
    });

    it('P0 implementations are wired (not stubs)', async () => {
      const m = await import('../../core/prompt-optimization/index.js');
      // Stats: paired permutation produces a sane p-value.
      const perm = m.pairedPermutationTest({ a: [1, 1, 0, 1, 0], b: [0, 1, 0, 0, 0], iterations: 200, seed: 42 });
      expect(perm.observedDiff).toBeCloseTo(0.4, 6);
      expect(perm.pValue).toBeGreaterThan(0);
      expect(perm.pValue).toBeLessThanOrEqual(1);
      // Stats: bootstrap CI brackets the observed diff.
      const ci = m.pairedBootstrapCI({ a: [1, 1, 0, 1, 0], b: [0, 1, 0, 0, 0], iterations: 200, seed: 42 });
      expect(ci.observedDiff).toBeCloseTo(0.4, 6);
      expect(ci.ciLow).toBeLessThanOrEqual(ci.observedDiff);
      expect(ci.ciHigh).toBeGreaterThanOrEqual(ci.observedDiff);
      // Stats: PL ranks consistent winner first.
      const pl = m.plackettLuceFit({
        items: ['T1', 'T2', 'T3'],
        rankings: [['T1', 'T2'], ['T1', 'T3'], ['T2', 'T3'], ['T1', 'T2', 'T3']],
      });
      expect(pl.rank.T1).toBe(1);
      // Decontamination: n-gram catches an exact 50-char hit.
      const needle = 'a'.repeat(60);
      const result = m.nGramDecontaminate({
        probes: [{ id: 'p1', needle }],
        corpus: ['x'.repeat(20) + needle.slice(0, 50) + 'y'.repeat(20)],
      });
      expect(result.flagged).toHaveLength(1);
      expect(result.clean).toHaveLength(0);
      // Manifests: load returns parsed JSON with merged repos.
      const manifest = m.loadManifest();
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest._repos.fastify).toBeDefined();

      // §0.5 framework — manifest carries HOMP, leakage-gate, thresholdout,
      // and judge-panel sections (added 2026-05-09).
      expect(manifest.heldOutModels).toBeDefined();
      expect(Array.isArray(manifest.heldOutModels.panel)).toBe(true);
      expect(manifest.heldOutModels.panel.length).toBeGreaterThanOrEqual(2);
      expect(manifest.thresholdout).toBeDefined();
      expect(manifest.thresholdout.totalBudget).toBe(26);
      expect(manifest.leakageGate).toBeDefined();
      expect(manifest.judgePanel).toBeDefined();
      // Run-config: TOML parses into nested sections + arrays.
      const cfg = m.loadRunConfig();
      expect(cfg.campaign_id).toBe('prompt-evolution-2026-05');
      expect(cfg.evaluatees.pool).toEqual(['deepseek-v4-flash', 'minimax-m2.7', 'kimi-k2.5', 'qwen3.6-plus']);
      expect(cfg.gepa.generations_max).toBe(30);
    });

    it('buildSplits --check matches on-disk artifacts', async () => {
      const m = await import('../../core/prompt-optimization/splits/build-splits.mjs');
      const result = m.buildSplits({ check: true });
      expect(result.ok).toBe(true);
    });
  });
});
