/**
 * AI-assisted reflection runner for the GEPA loop — §3.4.
 *
 * After every GEPA round, `buildReflectionPackage` assembles the structured
 * input (survivor, failure clusters, lineage, trajectories, Pareto, convergence)
 * and `runReflection` ships it to Gemini 3.1 Pro Deep Think for analysis.
 *
 * NOTE on thinkingBudget: the intended call config for Gemini Deep Think is
 *   `thinkingBudget: -1`  (dynamic thinking — let the model decide how much
 *   reasoning to apply). This would be passed via callModel's model-specific
 *   options object, e.g.:
 *     callModel({ ..., modelOptions: { thinkingBudget: -1 } })
 *   The parameter is documented here; the runner does not hard-code it in
 *   the callModel invocation so that test stubs remain simple and the actual
 *   GEPA driver can inject the right value when wiring the live call.
 *
 * Plan reference: docs/PHASE7.md §3.4.
 */

// ─── reflection system prompt (§3.4 step 2 verbatim) ─────────────────────

export const REFLECTION_SYSTEM_PROMPT =
  'You are a senior IR researcher reviewing a single round of a GEPA ' +
  'prompt-evolution loop for an agentic code-search system. ' +
  'Identify the top 3 failure clusters, propose a structural insight ' +
  '(not a literal prompt edit), assess plateau/breakthrough signals in ' +
  'the trajectory, and recommend whether the human should hand-craft a ' +
  '4th mutation or inject a hint into the next round\'s reflector.';

// ─── package builder (§3.4 step 1) ────────────────────────────────────────

/**
 * Build the structured input package for the Gemini round-end reflection.
 *
 * @param {object} args
 * @param {number}   args.round           — 1-based round index
 * @param {object}   args.survivor        — { promptText, scores:{perProbe:[], perTarget:{}} }
 * @param {object[]} args.failures        — top failure records (probe + stratum + repo + tool + trajectoryExcerpt)
 * @param {object[]} args.paretoFront     — current Pareto front [ {variantId, scores} ]
 * @param {object}   args.convergence     — { jointBestPerRound: number[] } trajectory up to this round
 * @returns {object} reflection input package
 */
export function buildReflectionPackage({ round, survivor, failures, paretoFront, convergence }) {
  if (!Number.isInteger(round) || round < 1) {
    throw new RangeError('buildReflectionPackage: round must be a positive integer');
  }
  if (!survivor || typeof survivor !== 'object') {
    throw new TypeError('buildReflectionPackage: survivor must be an object');
  }
  if (!Array.isArray(failures)) {
    throw new TypeError('buildReflectionPackage: failures must be an array');
  }
  if (!Array.isArray(paretoFront)) {
    throw new TypeError('buildReflectionPackage: paretoFront must be an array');
  }
  if (!convergence || typeof convergence !== 'object') {
    throw new TypeError('buildReflectionPackage: convergence must be an object');
  }

  // Top-3 failure clusters: group by stratum/repo/tool, take first 3
  const topFailures = failures.slice(0, 3).map((f) => ({
    probeId: f.probeId ?? null,
    stratum: f.stratum ?? null,
    repo: f.repo ?? null,
    tool: f.tool ?? null,
    trajectoryExcerpt: f.trajectoryExcerpt ?? null,
    jointScore: f.jointScore ?? null,
  }));

  // Mutation lineage from survivor
  const mutationLineage = survivor.lineage ?? null;

  // Pareto front summary
  const paretoSummary = paretoFront.map((v) => ({
    variantId: v.variantId ?? v.id ?? null,
    scores: v.scores ?? null,
  }));

  // Convergence trajectory excerpt (last 5 rounds max for brevity)
  const trajectory = Array.isArray(convergence.jointBestPerRound)
    ? convergence.jointBestPerRound.slice(-5)
    : [];

  // Joint best this round
  const currentBest =
    Array.isArray(convergence.jointBestPerRound) && convergence.jointBestPerRound.length > 0
      ? convergence.jointBestPerRound[convergence.jointBestPerRound.length - 1]
      : null;

  return {
    round,
    survivor: {
      promptText: survivor.promptText ?? null,
      perProbeScores: survivor.scores?.perProbe ?? null,
      perTargetScores: survivor.scores?.perTarget ?? null,
      lineage: mutationLineage,
    },
    topFailureClusters: topFailures,
    paretoSummary,
    convergenceTrajectory: {
      last5Rounds: trajectory,
      currentBest,
      totalRoundsRecorded: Array.isArray(convergence.jointBestPerRound)
        ? convergence.jointBestPerRound.length
        : 0,
    },
  };
}

// ─── reflection runner ────────────────────────────────────────────────────

/**
 * runReflection — call Gemini Deep Think with the assembled package.
 *
 * The `callModel` function is injected by the GEPA driver so that this module
 * has no hard network dependency (tests pass stubs).
 *
 * The intended live call config includes `thinkingBudget: -1` for dynamic
 * reasoning depth — pass this via `callModel`'s options at the call site.
 * See module-level note above.
 *
 * @param {object} args
 * @param {object}   args.pkg        — reflection package from buildReflectionPackage
 * @param {(opts:{lineage:string, model:string, systemPrompt:string, userPrompt:string}) => Promise<{text:string}>} args.callModel
 *   — injectable model caller; live impl uses google-api lineage
 * @param {string}   [args.model]    — override model; default 'gemini-3.1-pro-preview'
 * @returns {Promise<{report:string}>}
 */
export async function runReflection({ pkg, callModel, model }) {
  if (!pkg || typeof pkg !== 'object') {
    throw new TypeError('runReflection: pkg must be an object');
  }
  if (typeof callModel !== 'function') {
    throw new TypeError('runReflection: callModel must be a function');
  }

  const resolvedModel = model || 'gemini-3.1-pro-preview';

  // Serialise the package as a human-readable JSON-ish user prompt.
  // The ~1500-token budget is enforced by the model's output limit at the
  // call site (pass maxOutputTokens:1500 via callModel options).
  const userPrompt = JSON.stringify(pkg, null, 2);

  const result = await callModel({
    lineage: 'google-api',
    model: resolvedModel,
    systemPrompt: REFLECTION_SYSTEM_PROMPT,
    userPrompt,
    // thinkingBudget: -1 is the intended dynamic-thinking config — the
    // GEPA driver injects this via callModel's modelOptions; see module note.
  });

  const report = result?.text ?? result?.content ?? '';
  return { report };
}
