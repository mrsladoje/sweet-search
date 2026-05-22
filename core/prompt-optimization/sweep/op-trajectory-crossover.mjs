/**
 * Phase 7 — OP-2 Contrastive Trajectory Crossover (§3.2, GPT-5.5 review §B3).
 *
 * Finds probes where one target wins (≥0.8) and another fails (≤0.4), then
 * asks Kimi to merge the winning target's tool-call trajectory with the
 * structural strengths of the losing candidate. Trajectories are target-tagged
 * so the operator explicitly identifies whether the bottleneck is Sonnet-only,
 * GPT-only, or joint before asking for the merge.
 *
 * The most recent manual-reflection hint is passed as a HARD NEGATIVE
 * constraint (anti-schizophrenia, §B3): Kimi must NOT resurface behaviours
 * already penalised by the human.
 */

import { validateMutation } from './token-validator.mjs';
import { EVENT_KINDS } from './p7-shared.mjs';

// ─── bottleneck classifier ────────────────────────────────────────────────────

/**
 * Given two trajectory records (or nulls), classify the bottleneck.
 * @param {{ target: string } | null} winA  — winning trajectory (target A)
 * @param {{ target: string } | null} winB  — winning trajectory (target B)
 * @returns {'sonnet-only' | 'gpt-only' | 'joint'}
 */
function classifyBottleneck(winA, winB) {
  const hasSonnet = !!(winA?.target === 'sonnet' || winB?.target === 'sonnet');
  const hasGpt = !!(winA?.target === 'gpt5_5' || winB?.target === 'gpt5_5');
  if (hasSonnet && hasGpt) return 'joint';
  if (hasSonnet) return 'sonnet-only';
  return 'gpt-only';
}

// ─── prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the system + user prompt for OP-2.
 *
 * @param {object} params
 * @param {object}  params.probe           — probe record (id, query)
 * @param {string}  params.promptA         — candidate A (the "winning" prompt text)
 * @param {string}  params.promptB         — candidate B (the "losing" prompt text)
 * @param {object}  params.trajectoryA     — { target, toolCalls, answer } from winning run
 * @param {object}  params.trajectoryB     — { target, toolCalls, answer } from losing run
 * @param {string}  [params.reflectionHint]— latest manual-reflection hard negative
 * @param {string}  [params.bottleneck]    — override bottleneck label
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildTrajectoryCrossoverPrompt({
  probe,
  promptA,
  promptB,
  trajectoryA,
  trajectoryB,
  reflectionHint,
  bottleneck,
}) {
  const inferredBottleneck =
    bottleneck ?? classifyBottleneck(trajectoryA ?? null, trajectoryB ?? null);

  const bottleneckNote =
    inferredBottleneck === 'joint'
      ? 'Both Sonnet and GPT-5.5 have winning trajectories on this probe. Merge behaviours COMPATIBLE WITH BOTH — do not privilege either target\'s exploration cadence.'
      : inferredBottleneck === 'sonnet-only'
      ? 'BOTTLENECK: Sonnet-only. GPT-5.5 is failing and needs different support. Do NOT import Sonnet\'s exploration cadence wholesale.'
      : 'BOTTLENECK: GPT-only. Sonnet is winning; import GPT-specific structural strengths.';

  const hardNegative = reflectionHint
    ? `\n\n## HARD NEGATIVE CONSTRAINT (DO NOT VIOLATE)\n${reflectionHint}\nYou MUST NOT re-introduce any behaviour, phrasing, or structural pattern that has already been penalised by the human reviewer above. This constraint overrides all other guidance.`
    : '';

  const systemPrompt =
    `You are an expert prompt engineer performing a contrastive trajectory crossover.` +
    `\n\nYour task: given two system-prompt candidates (A = winning, B = losing) and their` +
    ` agent execution trajectories on a specific probe, write an improved system-prompt` +
    ` candidate that merges the routing strengths of candidate A with the structural` +
    ` strengths of candidate B.` +
    `\n\n## Bottleneck analysis\n${bottleneckNote}` +
    hardNegative +
    `\n\n## Protected tokens\nTokens wrapped in [[ ]] (e.g. [[ss-search]], [[ss-find]]) MUST appear` +
    ` verbatim with NO whitespace inside the brackets. Do NOT add, remove, or rename them.` +
    ` Output them character-for-character as they appear in the source candidates.` +
    `\n\nOutput ONLY the merged system-prompt text. No preamble, no explanation.`;

  const trajALabel = trajectoryA?.target ? ` (target: ${trajectoryA.target})` : '';
  const trajBLabel = trajectoryB?.target ? ` (target: ${trajectoryB.target})` : '';

  const userPrompt =
    `## Probe\nID: ${probe?.id ?? 'unknown'}\nQuery: ${probe?.query ?? '(unknown)'}\n\n` +
    `## Candidate A — WINNING${trajALabel}\n\`\`\`\n${promptA}\n\`\`\`\n\n` +
    `## Candidate A winning trajectory${trajALabel}\n` +
    `Tool calls: ${JSON.stringify(trajectoryA?.toolCalls ?? [])}\n` +
    `Answer: ${trajectoryA?.answer ?? '(none)'}\n\n` +
    `## Candidate B — LOSING${trajBLabel}\n\`\`\`\n${promptB}\n\`\`\`\n\n` +
    `## Candidate B trajectory${trajBLabel}\n` +
    `Tool calls: ${JSON.stringify(trajectoryB?.toolCalls ?? [])}\n` +
    `Answer: ${trajectoryB?.answer ?? '(none)'}\n\n` +
    `Write the merged system-prompt candidate below:`;

  return { systemPrompt, userPrompt };
}

// ─── async runner ─────────────────────────────────────────────────────────────

/**
 * Run OP-2 Contrastive Trajectory Crossover.
 *
 * @param {object} params
 * @param {object}   params.probe
 * @param {string}   params.promptA
 * @param {string}   params.promptB
 * @param {object}   params.trajectoryA
 * @param {object}   params.trajectoryB
 * @param {string}   [params.reflectionHint]
 * @param {string}   [params.bottleneck]
 * @param {Function} params.callModel   — async ({lineage, model, systemPrompt, userPrompt}) => {text, isError}
 * @param {string}   [params.reflector] — model override (default: kimi-k2.6)
 *
 * @returns {Promise<{ mutated: string, accepted: boolean, rejection?: object }>}
 */
export async function runTrajectoryCrossover({
  probe,
  promptA,
  promptB,
  trajectoryA,
  trajectoryB,
  reflectionHint,
  bottleneck,
  callModel,
  reflector,
}) {
  if (typeof callModel !== 'function') throw new TypeError('runTrajectoryCrossover: callModel must be a function');

  const { systemPrompt, userPrompt } = buildTrajectoryCrossoverPrompt({
    probe,
    promptA,
    promptB,
    trajectoryA,
    trajectoryB,
    reflectionHint,
    bottleneck,
  });

  const result = await callModel({
    lineage: 'moonshot',
    model: reflector ?? 'kimi-k2.6',
    systemPrompt,
    userPrompt,
  });

  if (result.isError) {
    return {
      mutated: promptA,
      accepted: false,
      rejection: { reason: 'model-error', detail: result.text },
    };
  }

  const rawMutated = result.text ?? '';

  // Source for validation is promptA (the "winner" we're improving from)
  const validation = validateMutation({ source: promptA, mutated: rawMutated, op: 'trajectory-crossover' });

  if (!validation.ok) {
    return {
      mutated: promptA,
      accepted: false,
      rejection: {
        _kind: EVENT_KINDS.MUTATION_REJECTION,
        op: 'trajectory-crossover',
        failures: validation.failures,
      },
    };
  }

  return {
    mutated: validation.normalized,
    accepted: true,
  };
}
