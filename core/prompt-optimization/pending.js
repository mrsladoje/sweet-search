/**
 * prompt-optimization — pending public-API stubs for surfaces that have not
 * landed yet (post-P0).
 *
 * P0 (this commit): wires real implementations for stats, decontamination,
 * splits, manifests. Those are exported directly by `index.js`.
 *
 * Remaining stubs (throw on call) cover P6.2 / P6.3 / P8 / P9 / P10 / P10.5 /
 * P11 / P11.5 / §8.9.4 / §8.9.1 / §8.9.3. See docs/SYSTEM_PROMPT_OPT_PLAN.md
 * for which phase lands each surface.
 */

const NOT_IMPLEMENTED = (name, phase) => () => {
  throw new Error(
    `[prompt-optimization] ${name}() not yet implemented — lands in ${phase} per docs/SYSTEM_PROMPT_OPT_PLAN.md`
  );
};

// ── Optimization (P9, P10, P10.5) ────────────────────────────────────────────

export const runGepaCampaign = NOT_IMPLEMENTED('runGepaCampaign', 'P10');
export const runDspyCampaign = NOT_IMPLEMENTED('runDspyCampaign', 'P9');
export const runSynthesis = NOT_IMPLEMENTED('runSynthesis', 'P10.5');

// ── Evaluation (P8, P11, P11.5) ──────────────────────────────────────────────

export const runVariantSlate = NOT_IMPLEMENTED('runVariantSlate', 'P8');
export const runFourBaselines = NOT_IMPLEMENTED('runFourBaselines', 'P11.5');
export const runCrossHarness = NOT_IMPLEMENTED('runCrossHarness', 'P11');

// ── Statistics — pre-registered analysis decisions (post-P0) ─────────────────

export const applyEvaluatorExclusion = NOT_IMPLEMENTED('applyEvaluatorExclusion', '§8.9.1');

// ── Judges (P6.3, P11.5) ─────────────────────────────────────────────────────

export const runPrpPairwise = NOT_IMPLEMENTED('runPrpPairwise', 'P6.3');
export const validateJudgeIAA = NOT_IMPLEMENTED('validateJudgeIAA', 'P6.3');

// ── Failure modes (P8.5, §13.6) ──────────────────────────────────────────────

export const detectFailureModes = NOT_IMPLEMENTED('detectFailureModes', 'P8.5/§13.6');
export const tagProposalClass = NOT_IMPLEMENTED('tagProposalClass', '§8.9.4');

// ── Telemetry (§8.9.1, §8.9.3) ───────────────────────────────────────────────

export const emitPortabilityDossier = NOT_IMPLEMENTED('emitPortabilityDossier', '§8.9.1');
export const appendBudgetTelemetry = NOT_IMPLEMENTED('appendBudgetTelemetry', '§8.9.3');
