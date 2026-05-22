/**
 * Phase 7 — OP-5 The Pruner (§3.2, Gemini 3rd-pass §C1).
 *
 * Removes ~20% of PROSE-ONLY content from the candidate while preserving every
 * [[token]], every operational rule, and every pseudocode/fenced block.
 *
 * Also exports STATEFUL_SUMMARY_RULE (§3.2.3) — re-exported here for
 * convenience; canonical source is op-persona-pivot.mjs.
 */

import { validateMutation } from './token-validator.mjs';
import { EVENT_KINDS } from './p7-shared.mjs';

// Re-export so consumers can import from either operator file
export { STATEFUL_SUMMARY_RULE } from './op-persona-pivot.mjs';

// ─── prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the pruner system + user prompt.
 *
 * @param {{ candidate: string }} params
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildPrunerPrompt({ candidate }) {
  const systemPrompt =
    `You are an expert prompt engineer performing a precision pruning pass.` +
    `\n\n## Task\nRemove approximately 20% of the words from the prompt below.` +
    ` Restrict ALL deletions to natural-language PROSE sections only.` +
    `\n\nEliminate:\n- Redundant adjectives and filler phrases\n- Repetitive restatements` +
    ` of the same rule\n- Over-qualified hedges that do not add operational meaning\n\n` +
    `## Hard constraints (MUST NOT violate)\n` +
    `- DO NOT alter the syntax, indentation, or logic of any pseudocode, if/then blocks,` +
    ` or fenced code blocks (delimited by \`\`\`).\n` +
    `- Preserve every [[token]] verbatim and at the SAME multiplicity as the source.\n` +
    `- Preserve every behavioural rule (routing decisions, tool-selection criteria,` +
    ` output-format requirements).\n` +
    `- Preserve every regex pattern and file-path template.\n` +
    `- If the prompt is already minimal (very short or mostly pseudocode with little` +
    ` removable prose), output it UNCHANGED and prepend the single line: PRUNER_SKIP\n\n` +
    `Output ONLY the pruned prompt (or PRUNER_SKIP + unchanged prompt). No explanation.`;

  const userPrompt =
    `## Prompt to prune\n\`\`\`\n${candidate}\n\`\`\`\n\nPruned prompt:`;

  return { systemPrompt, userPrompt };
}

// ─── async runner ─────────────────────────────────────────────────────────────

/**
 * Run OP-5 The Pruner.
 *
 * @param {object}   params
 * @param {string}   params.candidate   — current candidate text
 * @param {Function} params.callModel   — async ({lineage, model, systemPrompt, userPrompt}) => {text, isError}
 * @param {number}   [params.minTokens] — skip pruning when candidate has ≤ minTokens whitespace-split tokens
 *
 * @returns {Promise<{ mutated: string, accepted: boolean, skipped?: boolean, rejection?: object }>}
 */
export async function runPruner({ candidate, callModel, minTokens }) {
  if (typeof callModel !== 'function') throw new TypeError('runPruner: callModel must be a function');
  if (typeof candidate !== 'string') throw new TypeError('runPruner: candidate must be a string');

  // Skip when candidate is below the minimum size threshold
  if (typeof minTokens === 'number' && Number.isFinite(minTokens)) {
    const tokenCount = candidate.trim().split(/\s+/).length;
    if (tokenCount <= minTokens) {
      return { mutated: candidate, accepted: true, skipped: true };
    }
  }

  const { systemPrompt, userPrompt } = buildPrunerPrompt({ candidate });

  const result = await callModel({
    lineage: 'moonshot',
    model: 'kimi-k2.6',
    systemPrompt,
    userPrompt,
  });

  if (result.isError) {
    return {
      mutated: candidate,
      accepted: false,
      rejection: { reason: 'model-error', detail: result.text },
    };
  }

  const rawMutated = result.text ?? '';

  // Handle model's PRUNER_SKIP signal — return unchanged candidate as accepted.
  // Trim first so leading whitespace before the sentinel is tolerated.
  const trimmed = rawMutated.trimStart();
  if (trimmed.startsWith('PRUNER_SKIP')) {
    const afterSkip = trimmed.slice('PRUNER_SKIP'.length).trim();
    // If after stripping the sentinel there's no usable body, fall back to original.
    const recovered = afterSkip.length > 10 ? afterSkip : candidate;
    return { mutated: recovered, accepted: true, skipped: true };
  }

  const validation = validateMutation({ source: candidate, mutated: rawMutated, op: 'pruner' });

  if (!validation.ok) {
    return {
      mutated: candidate,
      accepted: false,
      rejection: {
        _kind: EVENT_KINDS.MUTATION_REJECTION,
        op: 'pruner',
        failures: validation.failures,
      },
    };
  }

  return {
    mutated: validation.normalized,
    accepted: true,
  };
}
