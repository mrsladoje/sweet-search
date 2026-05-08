/**
 * prompt-optimization — pending public-API stubs (P0.0 DDD layout)
 *
 * Real implementations land in P0 (BEIR/CoIR scaffolding), P6 (query-shape
 * discovery), P8 (variant slate evaluation), P9 (DSPy MIPROv2 baseline),
 * P10 (GEPA campaign + synthesis), P11 (cross-harness validation), and
 * P11.5 (four-baseline gate). See docs/SYSTEM_PROMPT_OPT_PLAN.md.
 *
 * Each stub throws so the barrel is callable and the contract test can
 * verify the surface exists, while accidental runtime use fails loudly.
 */

const NOT_IMPLEMENTED = (name) => () => {
  throw new Error(
    `[prompt-optimization] ${name}() not yet implemented — see docs/SYSTEM_PROMPT_OPT_PLAN.md for the phase that lands it`
  );
};

// ── Optimization (P9, P10, P10.5) ────────────────────────────────────────────

export const runGepaCampaign = NOT_IMPLEMENTED('runGepaCampaign');
export const runDspyCampaign = NOT_IMPLEMENTED('runDspyCampaign');
export const runSynthesis = NOT_IMPLEMENTED('runSynthesis');

// ── Evaluation (P6.2, P6.3, P8, P11, P11.5) ──────────────────────────────────

export const runVariantSlate = NOT_IMPLEMENTED('runVariantSlate');
export const runQueryShapeSweep = NOT_IMPLEMENTED('runQueryShapeSweep');
export const runFourBaselines = NOT_IMPLEMENTED('runFourBaselines');
export const runCrossHarness = NOT_IMPLEMENTED('runCrossHarness');

// ── Statistics (P0) ──────────────────────────────────────────────────────────

export const pairedPermutationTest = NOT_IMPLEMENTED('pairedPermutationTest');
export const pairedBootstrapCI = NOT_IMPLEMENTED('pairedBootstrapCI');
export const plackettLuceFit = NOT_IMPLEMENTED('plackettLuceFit');
export const applyEvaluatorExclusion = NOT_IMPLEMENTED('applyEvaluatorExclusion');

// ── Decontamination (P0) ─────────────────────────────────────────────────────

export const nGramDecontaminate = NOT_IMPLEMENTED('nGramDecontaminate');
export const embeddingDecontaminate = NOT_IMPLEMENTED('embeddingDecontaminate');
export const llmDecontaminate = NOT_IMPLEMENTED('llmDecontaminate');

// ── Judges (P6.3, P11.5) ─────────────────────────────────────────────────────

export const runPrpPairwise = NOT_IMPLEMENTED('runPrpPairwise');
export const validateJudgeIAA = NOT_IMPLEMENTED('validateJudgeIAA');

// ── Failure modes (P8.5, §13.6) ──────────────────────────────────────────────

export const detectFailureModes = NOT_IMPLEMENTED('detectFailureModes');
export const tagProposalClass = NOT_IMPLEMENTED('tagProposalClass');

// ── Telemetry (§8.9.1, §8.9.3) ───────────────────────────────────────────────

export const emitPortabilityDossier = NOT_IMPLEMENTED('emitPortabilityDossier');
export const appendBudgetTelemetry = NOT_IMPLEMENTED('appendBudgetTelemetry');

// ── Manifests / splits (P0) ──────────────────────────────────────────────────

export const loadManifest = NOT_IMPLEMENTED('loadManifest');
export const buildSplits = NOT_IMPLEMENTED('buildSplits');
export const loadRunConfig = NOT_IMPLEMENTED('loadRunConfig');
