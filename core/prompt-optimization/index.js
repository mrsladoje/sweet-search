// Barrel — prompt-optimization domain (P0.0 DDD layout, 2026-05-09)
//
// Build-time bounded context that owns GEPA/DSPy prompt-evolution campaigns,
// variant slate evaluation, query-shape sweeps, statistical analysis,
// decontamination filters, LLM-as-judge protocols, failure-mode detection,
// portability telemetry, and cross-harness validation.
//
// Integration seam: scripts/init.js consumes the optimized canonical-policy
// artifact (core/prompt-optimization/data/output/canonical-policy.md) and
// writes it into AGENTS.md / CLAUDE.md / GEMINI.md / .cursor/rules/sweet-search.mdc /
// .claude/rules/sweet-search.md. The runtime engine has zero dependency on
// this context — see docs/DDD_ARCHITECTURE.md (Dependency Matrix).
//
// Allowed imports:
//   - infrastructure (any depth)
//   - search barrel only (declared exception, max 2 sites — embedded-MCP
//     cross-harness mode)
//   - ranking barrel only (declared exception, max 2 sites — B4 oracle-
//     retrieval baseline)
//
// Forbidden imports: indexing, query, graph, vocabulary, vector-store,
// embedding, and any non-barrel internal file of any other domain.

// ── P0: real implementations ─────────────────────────────────────────────────

export { pairedPermutationTest } from './stats/paired-permutation.mjs';
export { pairedBootstrapCI } from './stats/bootstrap-ci.mjs';
export { plackettLuceFit, plackettLuceFitWithBootstrap } from './stats/plackett-luce.mjs';

export { nGramDecontaminate } from './decontamination/n-gram-filter.mjs';
export { embeddingDecontaminate } from './decontamination/embedding-filter.mjs';
export { llmDecontaminate } from './decontamination/llm-filter.mjs';

export { loadManifest, loadRunConfig } from './manifests.mjs';
export { buildSplits, stratifiedSplit } from './splits/build-splits.mjs';

// ── Pending stubs (post-P0 phases) ───────────────────────────────────────────

export * from './pending.js';
