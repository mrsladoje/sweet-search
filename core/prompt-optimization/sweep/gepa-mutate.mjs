/**
 * Phase 7 — GEPA mutation orchestration (§3.2).
 *
 * OP-1 Reflective rewrite lives HERE (inline), per the wave-2 spec: it reads up
 * to N=5 worst-probe traces and asks Kimi K2.6 for a single targeted edit,
 * validated by the LANDED token-validator. On mature fronts these traces are
 * efficiency-focused (native-relative calls/tokens), falling back to accuracy
 * failures only when no efficiency data exists. OP-2..OP-5 are delegated to
 * their landed operator modules. The TARE adversarial paraphraser also lives
 * here (Sonnet 4.6, §3.3 step 3a).
 *
 * Every model call goes through the injectable `callModel` seam
 * (default = judge-runner.runJudge; tests pass a deterministic stub) so this
 * module is fully unit-testable without network.
 */

import { validateMutation, extractTokens } from './token-validator.mjs';
import { EVENT_KINDS } from './p7-shared.mjs';
import { runTrajectoryCrossover } from './op-trajectory-crossover.mjs';
import { runPersonaPivot } from './op-persona-pivot.mjs';
import { runToolMask } from './op-tool-mask.mjs';
import { runPruner } from './op-pruner.mjs';
import { runNoMatchSufficiency } from './op-nomatch-sufficiency.mjs';
import { runSystemAwareMerge } from './op-systemaware-merge.mjs';
import { runBudgetVoiEdit } from './op-budget-voi.mjs';

// ─── OP-1 Reflective rewrite (inline) ───────────────────────────────────────

export const REFLECTIVE_SYSTEM_PROMPT_BASE =
  'You are an expert prompt engineer performing a reflective rewrite of an ' +
  'agent system prompt for an agentic code-search tool. You will be shown the ' +
  'current prompt and up to 5 traces. These traces usually show probes where ' +
  'the answer was correct but the agent wasted tool calls or tokens versus a ' +
  'native rg+Read baseline; they may fall back to low-accuracy failures when ' +
  'needed. Diagnose the single dominant inefficiency or failure pattern and ' +
  'propose ONE targeted edit that addresses it.\n\n' +
  '## Hard constraints\n' +
  '- Tokens wrapped in [[ ]] are PROTECTED: output them character-for-character ' +
  'with NO whitespace inside the brackets, at the SAME multiplicity as the ' +
  'source. Do NOT invent new [[...]] tokens.\n' +
  '- Code fences and regex patterns are protected.\n' +
  '- Keep the edit surgical — do not rewrite sections unrelated to the failures.\n\n' +
  'Output ONLY the rewritten prompt text. No preamble, no explanation.';

// Back-compat alias: the original export name. Older code paths and tests
// asserting on REFLECTIVE_SYSTEM_PROMPT (the base preamble without the
// per-candidate contract) keep working unchanged.
export const REFLECTIVE_SYSTEM_PROMPT = REFLECTIVE_SYSTEM_PROMPT_BASE;

/**
 * Render the per-candidate TOKEN PRESERVATION CONTRACT block (§3.2.1).
 *
 * Multiplicity drift on [[tokens]] was the dominant reason the Kimi K2.6
 * reflector burned mutation slots during gen-1 round 1 (e.g. round-1 OP-1
 * Slot 1 rejected with multiplicity-changed on [[ss-find]] / [[ss-grep]] /
 * [[ss-trace]] each shifting by ±1). We anchor the reflector to the exact
 * counts the §3.2.1 validator will check, computed via the same extractor
 * the validator uses — so the embedded contract CANNOT drift from the
 * downstream check.
 *
 * Returns '' when the candidate carries no [[tokens]] (the contract would
 * be vacuous and noisy).
 */
export function buildTokenContract(candidate) {
  if (typeof candidate !== 'string') throw new TypeError('buildTokenContract: candidate must be a string');
  const tokens = extractTokens(candidate);
  if (tokens.size === 0) return '';
  const lines = [...tokens.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tok, count]) => `  ${tok} × ${count}`);
  return (
    '\n\n## TOKEN PRESERVATION CONTRACT\n' +
    'Your output MUST contain exactly these [[token]] mentions at exactly these counts (no more, no fewer):\n' +
    lines.join('\n') + '\n\n' +
    'Do NOT consolidate, delete, duplicate, alias, or rename any of these. ' +
    'If you want to revise the section that mentions one of these tokens, keep the original mention(s) verbatim and add new content alongside rather than replacing. ' +
    'A mutation that changes any count by even one will be rejected by the token validator and waste this slot.'
  );
}

/**
 * Build the OP-1 reflective system + user prompt from a candidate + its worst
 * inefficiency/failure traces. The system prompt is the
 * BASE preamble plus a per-candidate TOKEN PRESERVATION CONTRACT block listing
 * every [[token]] with its exact required multiplicity (§3.2.1).
 */
export function buildReflectivePrompt({ candidate, failures, contrastive = null }) {
  const traceBlocks = (failures || [])
    .slice(0, 5)
    .map((f, i) => {
      // OP-C: surface mean processed-tokens-per-call (result-size re-billed each
      // turn) so the reflector attacks bloated results, not just call count.
      const mtpc = typeof f.meanTokensPerCall === 'number' ? ` avg ~${f.meanTokensPerCall} tok/call (re-billed every turn)` : '';
      const nativeLine = typeof f.nativeRelativeOverall === 'number'
        ? `Native-relative: overall=${f.nativeRelativeOverall.toFixed(3)} ` +
          `accuracy=${f.desirability?.accuracy?.toFixed?.(3) ?? '?'} ` +
          `calls=${f.desirability?.calls?.toFixed?.(3) ?? '?'} ` +
          `tokens=${f.desirability?.tokens?.toFixed?.(3) ?? '?'}; ` +
          `calls ${f.calls ?? '?'} vs native ${f.nativeCalls ?? '?'}; ` +
          `tokens ${f.tokensForScoring ?? f.tokens ?? '?'} vs native ${f.nativeTokensForScoring ?? f.nativeTokens ?? '?'}${mtpc}\n`
        : (typeof f.callDeviation === 'number'
            ? `Efficiency: calls=${f.calls ?? '?'} callDeviation=${f.callDeviation}; tokens=${f.tokens ?? '?'}${mtpc}\n`
            : '');
      return (
        `### Trace ${i + 1} — probe ${f.probeId} ` +
        `(${f.stratum ?? '?'} / ${f.repo ?? '?'}) joint=${f.jointScore}\n` +
        `Target: ${f.target ?? '?'}\n` +
        nativeLine +
        `Query: ${f.query ?? '(unknown)'}\n` +
        `Tool calls: ${JSON.stringify(f.toolCalls ?? [])}\n` +
        `Agent answer: ${f.answer ?? '(none)'}\n` +
        `Expected files: ${JSON.stringify(f.expectedFiles ?? [])}`
      );
    })
    .join('\n\n');

  // OP-C contrastive block: a cheap-vs-expensive pair on the SAME kind of query
  // (both correct) gives the reflector a behavioral handle instead of a scalar.
  const contrastiveBlock = (contrastive && contrastive.cheap && contrastive.expensive)
    ? `\n\n## Contrastive trace — SAME kind of query (${contrastive.stratum ?? '?'}, ${contrastive.target ?? '?'}), very different cost\n` +
      `Both answers were CORRECT — the gap is efficiency you control through the prompt, not the model.\n` +
      `CHEAP — ${contrastive.cheap.probeId}: ${contrastive.cheap.calls} tool calls, $${(contrastive.cheap.costUsd ?? 0).toFixed(4)}\n` +
      `  query: ${contrastive.cheap.query ?? '(unknown)'}\n` +
      `  tool calls: ${JSON.stringify(contrastive.cheap.toolCalls ?? [])}\n` +
      `EXPENSIVE — ${contrastive.expensive.probeId}: ${contrastive.expensive.calls} tool calls, $${(contrastive.expensive.costUsd ?? 0).toFixed(4)} ` +
      `(${((contrastive.expensive.costUsd ?? 0) / Math.max(contrastive.cheap.costUsd ?? 0, 1e-9)).toFixed(1)}× the cheap path)\n` +
      `  query: ${contrastive.expensive.query ?? '(unknown)'}\n` +
      `  tool calls: ${JSON.stringify(contrastive.expensive.toolCalls ?? [])}\n` +
      `PRIMARY goal of your edit: make the expensive path behave like the cheap one — fewer/narrower tool calls and an earlier stop once the answer is in hand — WITHOUT losing accuracy. Do NOT just add caveats (that widens results and raises cost).`
    : '';

  const userPrompt =
    `## Current prompt\n\`\`\`\n${candidate}\n\`\`\`\n\n` +
    `## Worst inefficiency/failure traces\n${traceBlocks || '(none provided — propose a compact routing edit that reduces calls/tokens without harming accuracy)'}` +
    `${contrastiveBlock}\n\n` +
    `Rewrite the prompt to address the dominant inefficiency or failure pattern. Output only the new prompt:`;

  const systemPrompt = REFLECTIVE_SYSTEM_PROMPT_BASE + buildTokenContract(candidate);
  return { systemPrompt, userPrompt };
}

/**
 * Run OP-1 Reflective rewrite. Mirrors the OP-2..OP-5 contract:
 *   → { mutated, accepted, rejection? }
 */
export async function runReflectiveRewrite({ candidate, failures, contrastive = null, callModel, reflector }) {
  if (typeof callModel !== 'function') throw new TypeError('runReflectiveRewrite: callModel must be a function');
  if (typeof candidate !== 'string') throw new TypeError('runReflectiveRewrite: candidate must be a string');

  const { systemPrompt, userPrompt } = buildReflectivePrompt({ candidate, failures, contrastive });
  const result = await callModel({ lineage: 'moonshot', model: reflector ?? 'kimi-k2.6', systemPrompt, userPrompt });

  if (result.isError) {
    return { mutated: candidate, accepted: false, rejection: { reason: 'model-error', detail: result.text } };
  }
  const raw = result.text ?? '';
  const validation = validateMutation({ source: candidate, mutated: raw, op: 'reflective' });
  if (!validation.ok) {
    return {
      mutated: candidate,
      accepted: false,
      rejection: { _kind: EVENT_KINDS.MUTATION_REJECTION, op: 'reflective', failures: validation.failures },
    };
  }
  return { mutated: validation.normalized, accepted: true };
}

// ─── TARE adversarial paraphraser (§3.3 step 3a) ────────────────────────────

export const TARE_PARAPHRASE_SYSTEM_PROMPT =
  'Generate an adversarial paraphrase of the prompt below. Preserve task ' +
  'semantics exactly, but vary register, syntax, and vocabulary maximally. ' +
  'Preserve [[tokens]] verbatim with no whitespace inside the brackets, at the ' +
  'same multiplicity. Do not invent new [[...]] tokens. Output ONLY the ' +
  'paraphrased prompt, no preamble.';

/**
 * Per-paraphrase generator lineage rotation (§C2 / B4).
 *
 * §C2 / §2.1 require the TARE K=3 set to include ≥1 NON-Anthropic paraphrase:
 * Sonnet is itself a TARGET, so an all-Sonnet set measures only in-family
 * invariance — exactly the brittleness the gate exists to catch. We rotate
 * slot 0 through a non-Anthropic generator (Kimi K2.6 / moonshot family) while
 * keeping the rest on Sonnet, so the K=3 set spans ≥2 families.
 *
 * Each entry: { lineage, model }. Slot 0 is non-Anthropic by construction.
 */
export const TARE_GENERATOR_ROTATION = Object.freeze([
  { lineage: 'moonshot', model: 'kimi-k2.6' },        // non-Anthropic (§C2 requirement)
  { lineage: 'anthropic-api', model: 'claude-sonnet-4-6' },
  { lineage: 'anthropic-api', model: 'claude-sonnet-4-6' },
]);

/**
 * Deterministic, family-free structural paraphrase fallback (B4). When the
 * non-Anthropic LLM generator errors, we still want a non-Anthropic paraphrase
 * in the K=3 set rather than collapsing back to Sonnet. This applies a
 * lightweight, token-preserving structural transform (sentence reordering of
 * non-[[token]] lines) so the set retains a genuinely out-of-family variant.
 * It NEVER touches [[tokens]] (it only reorders whole lines) and is validated
 * downstream like any other paraphrase.
 */
export function structuralParaphrase(prompt) {
  const lines = String(prompt).split('\n');
  // Reverse the order of contiguous prose blocks (blank-line separated) while
  // keeping each block's internal lines intact — a maximal-register-shift,
  // semantics-preserving, token-preserving structural edit.
  const blocks = [];
  let cur = [];
  for (const ln of lines) {
    if (ln.trim() === '') { blocks.push(cur); blocks.push(['']); cur = []; }
    else cur.push(ln);
  }
  if (cur.length) blocks.push(cur);
  const reordered = blocks.reverse().flat();
  return reordered.join('\n');
}

/**
 * Generate K adversarial paraphrases of `prompt` (§3.3 / §C2). The generators
 * are ROTATED across families so the K=3 set always contains ≥1 NON-Anthropic
 * paraphrase (B4): slot 0 = Kimi K2.6 (moonshot) with a deterministic
 * structural fallback if it errors; slots 1..K-1 = Sonnet 4.6 (the §3.3 default).
 * Each paraphrase is token-validated; one that corrupts a [[token]] falls back
 * to the source so TARE never measures sharpness against a broken variant.
 */
export async function generateAdversarialParaphrases({ prompt, k, callModel }) {
  if (typeof callModel !== 'function') throw new TypeError('generateAdversarialParaphrases: callModel must be a function');
  const out = [];
  for (let i = 0; i < k; i++) {
    const gen = TARE_GENERATOR_ROTATION[i % TARE_GENERATOR_ROTATION.length];
    const result = await callModel({
      lineage: gen.lineage,
      model: gen.model,
      systemPrompt: TARE_PARAPHRASE_SYSTEM_PROMPT,
      userPrompt: `## Prompt\n\`\`\`\n${prompt}\n\`\`\`\n\nAdversarial paraphrase #${i + 1}:`,
    });
    if (result.isError) {
      // For the non-Anthropic slot, fall back to the family-free structural
      // paraphrase (NOT the Sonnet source) so the set keeps ≥1 OOF variant.
      const fallbackRaw = gen.lineage !== 'anthropic-api' ? structuralParaphrase(prompt) : prompt;
      const fv = validateMutation({ source: prompt, mutated: fallbackRaw, op: 'tare-paraphrase' });
      out.push(fv.ok ? fv.normalized : prompt);
      continue;
    }
    const validation = validateMutation({ source: prompt, mutated: result.text ?? '', op: 'tare-paraphrase' });
    out.push(validation.ok ? validation.normalized : prompt);
  }
  return out;
}

// ─── per-round mutation generation (slot composition) ───────────────────────

function pickTrajForProbe(incumbent, probeId, fallbackTarget) {
  const d = incumbent?.detail?.[probeId];
  if (!d) return { target: fallbackTarget, toolCalls: [], answer: '' };
  // Tag with the better-scoring target's trajectory.
  const target = d.sonnet.score >= d.gpt5_5.score ? 'sonnet' : 'gpt5_5';
  const traj = d[target]?.traj || { toolCalls: [], answer: '' };
  return { target, toolCalls: traj.toolCalls, answer: traj.answer };
}

// ─── retry-until-success wrapper (§3.2.x — added 2026-05-27) ────────────────

/**
 * Default per-slot retry cap. Empirical evidence from gen-1 rounds 2-6:
 * Kimi (and to a lesser extent Gemini DeepThink) drift on token-preservation
 * in roughly 1 of 3 attempts. With N=5 retries and a per-attempt failure-aware
 * hint, the joint probability that ALL 5 fail is < 0.5% — slots almost never
 * burn outright. The cap exists only to bound cost on a truly broken API.
 */
export const DEFAULT_OP_MAX_ATTEMPTS = 5;

/**
 * Build a retry-hint string from the prior attempt's rejection. Pure function,
 * exported for tests. The hint is folded into the operator's user prompt by
 * the harness caller so the LLM gets explicit per-attempt feedback.
 */
export function buildRetryHint(rejection, nextAttempt) {
  if (!rejection || typeof rejection !== 'object') {
    return `Attempt ${nextAttempt}: previous attempt did not produce a usable mutation.`;
  }
  if (rejection.reason === 'model-error') {
    return `Attempt ${nextAttempt}: prior call hit a model/HTTP error. Be concise and ensure your output finishes cleanly inside the required tags.`;
  }
  const failures = Array.isArray(rejection.failures) ? rejection.failures : [];
  // OP-E merge that returned ≈ a parent — re-prompt for a genuine section swap.
  if (rejection.reason === 'merge-noop-clone' || failures.some((f) => f.reason === 'merge-noop-clone')) {
    return `Attempt ${nextAttempt}: your previous merge returned one candidate essentially unchanged. You MUST take at least one whole \`##\` section VERBATIM from the OTHER candidate so the merge genuinely composes both lineages — do not just echo candidate A.`;
  }
  if (failures.length === 0) {
    const r = rejection.reason ?? 'unspecified';
    return `Attempt ${nextAttempt}: prior output rejected (${r}). Preserve every [[token]] from the source at exactly its source multiplicity, and ensure protected fenced/pseudocode blocks survive byte-identically.`;
  }
  const grouped = {};
  for (const f of failures) {
    const r = f.reason ?? '?';
    (grouped[r] = grouped[r] ?? []).push(f.token ?? f.block?.slice?.(0, 60) ?? '?');
  }
  const parts = Object.entries(grouped).map(([reason, tokens]) => `${reason} on ${tokens.slice(0, 8).join(', ')}${tokens.length > 8 ? `, +${tokens.length - 8} more` : ''}`);
  return `Attempt ${nextAttempt}: prior output rejected by the token validator. Specifically: ${parts.join('; ')}. These are HARD constraints. Preserve every [[token]] from the source at EXACTLY its source multiplicity and do NOT alter any fenced/pseudocode block byte-identically.`;
}

/**
 * Run an operator with up to `maxAttempts` retries, surfacing per-attempt
 * failure-aware retry hints to the underlying callModel via `req.retryHint`.
 * `opCall` is a factory: it takes a wrapped callModel and returns the operator
 * promise. This way each operator runner stays unchanged — we only thread a
 * `retryHint` field through their existing `callModel` injection point.
 *
 * Result extends the underlying operator result with:
 *   attempts: number — how many attempts were made (1..maxAttempts)
 *   priorFailures: array — rejections from EACH non-final attempt (for traj)
 */
export async function runOpWithRetry(opCall, callModel, opts = {}) {
  const max = opts.maxAttempts ?? DEFAULT_OP_MAX_ATTEMPTS;
  if (typeof opCall !== 'function') throw new TypeError('runOpWithRetry: opCall must be a function');
  if (typeof callModel !== 'function') throw new TypeError('runOpWithRetry: callModel must be a function');

  const priorFailures = [];
  let lastRejection = null;

  for (let attempt = 1; attempt <= max; attempt++) {
    const hint = attempt > 1 ? buildRetryHint(lastRejection, attempt) : undefined;
    const wrappedCallModel = (req) => callModel({ ...req, retryHint: hint });
    const res = await opCall(wrappedCallModel);
    if (res.accepted) {
      return { ...res, attempts: attempt, priorFailures };
    }
    lastRejection = res.rejection;
    priorFailures.push({ attempt, rejection: res.rejection });
  }

  return {
    mutated: undefined,
    accepted: false,
    rejection: lastRejection ?? { reason: 'all-retries-failed' },
    attempts: max,
    priorFailures,
  };
}

/**
 * Generate the 3 slot mutations for a round (§3.2 slot composition).
 *
 * Each operator call is wrapped in `runOpWithRetry` (default 5 attempts) so
 * a transient model-error or multiplicity-changed rejection no longer burns
 * the slot — the wrapper passes a failure-aware retry hint to the next attempt.
 *
 * m8 (documented deferral): OP-2 here consumes only the winner-vs-loser pair
 * carried on `slot.pair` (from gepa-pareto.findCrossoverPair). The TRUE balanced
 * OP-2 pair (each incumbent winning one production target, losing the other) is
 * now detectable via gepa-pareto.findBalancedPair, and op-trajectory-crossover
 * already supports the balanced construction; wiring that signal through the slot
 * plan is a minimal follow-up (no behavioural change today — winner-vs-loser is
 * a valid, narrower OP-2 input).
 *
 * @param {object} args
 * @param {object[]} args.slots      — from gepa-pareto.planSlots
 * @param {object}   args.parent     — selected parent candidate
 * @param {object[]} args.failures   — parent's worst-probe traces (OP-1 input)
 * @param {object}   args.probeById  — id → probe record (for crossover query)
 * @param {number}   args.round
 * @param {Function} args.callModel
 * @param {Function} args.rng        — () => number (OP-4 alias randomisation)
 * @param {string}   [args.reflectionHint] — latest manual-reflection hard negative (OP-2)
 * @param {number}   [args.maxAttemptsPerSlot] — override default retry cap
 * @returns {Promise<object[]>} one result per slot: { sourceOp, parentHash, mutated, accepted, rejection?, attempts, priorFailures }
 */
export async function generateMutations({ slots, parent, failures, contrastive = null, noMatchTraces = null, literalTraces = null, probeById, round, callModel, rng, reflectionHint, maxAttemptsPerSlot }) {
  const retryOpts = { maxAttempts: maxAttemptsPerSlot ?? DEFAULT_OP_MAX_ATTEMPTS };
  const results = [];
  for (const slot of slots) {
    let res;
    let parentHashOverride;
    switch (slot.op) {
      case 'reflective':
        res = await runOpWithRetry(
          (cm) => runReflectiveRewrite({ candidate: parent.prompt, failures, contrastive, callModel: cm }),
          callModel, retryOpts,
        );
        break;
      case 'system-aware-merge': {
        // OP-E: module-wise (## section) merge of the cost-mismatch pair — winner
        // (cheap) is the merge baseline, loser (expensive) contributes complementary
        // sections. No within-section blending (the trajectory-crossover failure).
        const { winner, loser } = slot.pair;
        parentHashOverride = winner.hash;
        res = await runOpWithRetry(
          (cm) => runSystemAwareMerge({ promptA: winner.prompt, promptB: loser.prompt, callModel: cm }),
          callModel, retryOpts,
        );
        break;
      }
      case 'trajectory-crossover': {
        const { probeId, winner, loser, costWinner, costLoser } = slot.pair;
        const probe = probeById?.[probeId] || { id: probeId, query: undefined };
        parentHashOverride = winner.hash;
        const trajA = pickTrajForProbe(winner, probeId, 'sonnet');
        const trajB = pickTrajForProbe(loser, probeId, 'gpt5_5');
        // When the pair was selected on a cost mismatch (cost-aware finder), make
        // cost the PRIMARY objective in the merge prompt; an accuracy-fallback pair
        // carries no cost fields → costContext stays undefined (legacy behaviour).
        const costContext = (typeof costWinner === 'number' && typeof costLoser === 'number')
          ? { costWinner, costLoser, callsWinner: trajA.toolCalls?.length, callsLoser: trajB.toolCalls?.length }
          : undefined;
        res = await runOpWithRetry(
          (cm) => runTrajectoryCrossover({
            probe,
            promptA: winner.prompt,
            promptB: loser.prompt,
            trajectoryA: trajA,
            trajectoryB: trajB,
            reflectionHint,
            costContext,
            callModel: cm,
          }),
          callModel, retryOpts,
        );
        break;
      }
      case 'persona-pivot':
        res = await runOpWithRetry(
          (cm) => runPersonaPivot({ candidate: parent.prompt, round, callModel: cm }),
          callModel, retryOpts,
        );
        break;
      case 'no-match-sufficiency':
        // OP-B: fed the parent's worst no-match traces; falls back to the general
        // worst-inefficiency set when this parent has no no-match spiral (so the
        // slot still produces a sufficiency-focused edit rather than burning).
        res = await runOpWithRetry(
          (cm) => runNoMatchSufficiency({
            candidate: parent.prompt,
            noMatchTraces: (Array.isArray(noMatchTraces) && noMatchTraces.length) ? noMatchTraces : failures,
            callModel: cm,
          }),
          callModel, retryOpts,
        );
        break;
      case 'tool-mask':
        res = await runOpWithRetry(
          (cm) => runToolMask({ candidate: parent.prompt, callModel: cm, rng }),
          callModel, retryOpts,
        );
        break;
      case 'pruner':
        res = await runOpWithRetry(
          (cm) => runPruner({ candidate: parent.prompt, callModel: cm, minTokens: 120 }),
          callModel, retryOpts,
        );
        break;
      case 'budget-voi':
        // OP-D: VoI/early-exit edit fed the parent's literal-lookup over-search traces
        // (falls back to the general worst-inefficiency set when none).
        res = await runOpWithRetry(
          (cm) => runBudgetVoiEdit({
            candidate: parent.prompt,
            traces: (Array.isArray(literalTraces) && literalTraces.length) ? literalTraces : failures,
            callModel: cm,
          }),
          callModel, retryOpts,
        );
        break;
      default:
        res = { mutated: parent.prompt, accepted: false, rejection: { reason: `unknown-op:${slot.op}` }, attempts: 0, priorFailures: [] };
    }
    results.push({
      sourceOp: slot.op,
      parentHash: parentHashOverride ?? parent.hash,
      mutated: res.mutated,
      accepted: res.accepted,
      rejection: res.rejection,
      attempts: res.attempts,
      priorFailures: res.priorFailures,
    });
  }
  return results;
}
