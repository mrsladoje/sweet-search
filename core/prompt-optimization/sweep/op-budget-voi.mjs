/**
 * Phase 7 — OP-D Budget / Value-of-Information early-exit operator (2026-05-30).
 *
 * The literature-sanctioned way around our "no hard caps" rule: don't CAP calls —
 * install a positive value-of-information self-check + a selective-verification
 * early-exit so the agent CHOOSES to stop double-checking once confidence is high.
 * (BATS arXiv:2511.17006: budget-awareness flips deepen-vs-branch behavior; AVA
 * TMLR 2026: VoI-guided expansion + verification cascade with early exits "reduces
 * cost at matched reliability".) Targets literal-lookup over-search (re-searching to
 * "double-check" a correct top-ranked hit — 1.83× native; post-mortem).
 *
 * A CONSTRAINED reflective: it may add/strengthen ONLY a budget/VoI/early-exit
 * sufficiency clause — never new search instructions or query broadening (which
 * raises cost), never a blunt "stop after N". Slot-3 rotation member alongside
 * OP-B no-match-sufficiency, tool-mask, and pruner.
 */

import { validateMutation } from './token-validator.mjs';
import { EVENT_KINDS } from './p7-shared.mjs';

function renderTraces(traces) {
  return (traces || [])
    .slice(0, 5)
    .map((f, i) => {
      const mtpc = typeof f.meanTokensPerCall === 'number' ? `, avg ~${f.meanTokensPerCall} tok/call` : '';
      const callLine = (typeof f.calls === 'number')
        ? `Spent ${f.calls} tool calls${typeof f.nativeCalls === 'number' ? ` vs ${f.nativeCalls} native` : ''}${mtpc}\n`
        : '';
      return (
        `### Over-search trace ${i + 1} — probe ${f.probeId} (${f.stratum ?? '?'} / ${f.repo ?? '?'})\n` +
        `Target: ${f.target ?? '?'}\n` +
        callLine +
        `Query: ${f.query ?? '(unknown)'}\n` +
        `Tool calls: ${JSON.stringify(f.toolCalls ?? [])}\n` +
        `Agent answer: ${f.answer ?? '(none)'}`
      );
    })
    .join('\n\n');
}

/**
 * Build the OP-D system + user prompt.
 *
 * @param {object}   params
 * @param {string}   params.candidate
 * @param {object[]} params.traces   — literal-lookup (or general) over-search traces
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildBudgetVoiPrompt({ candidate, traces }) {
  const systemPrompt =
    `You are an expert prompt engineer reducing an agentic code-search prompt's ` +
    `OVER-SEARCH — redundant tool calls made after the answer was already in hand ` +
    `(e.g. re-running a search to "double-check" a correct top-ranked hit).` +
    `\n\n## Your edit (exactly one targeted change)\n` +
    `Add or strengthen ONE positive value-of-information / early-exit rule, such as:\n` +
    `- "Results are ranked — if a single tool call returns an exact, unambiguous match ` +
    `for the query, report it (confirming with at most one [[ss-read]]); do NOT re-search ` +
    `to double-check a hit that already matches."\n` +
    `- "Before each additional tool call, state what NEW information it would add that you ` +
    `do not already have; if none, stop and answer."\n` +
    `\n## Hard constraints\n` +
    `- Emit ONLY a value-of-information / early-exit / budget-awareness sufficiency clause. ` +
    `Do NOT add new search instructions, new tools, or query broadening — that raises cost.\n` +
    `- NO blunt hard caps ("stop after N calls"). It must be a self-assessed VoI condition.\n` +
    `- Keep the edit surgical; do not rewrite unrelated sections.\n` +
    `- Tokens wrapped in [[ ]] are PROTECTED: output character-for-character with NO ` +
    `whitespace inside the brackets, at the SAME multiplicity. Do NOT invent new [[…]] ` +
    `tokens. Code fences and regex patterns are protected.\n\n` +
    `Output ONLY the rewritten prompt text. No preamble, no explanation.`;

  const traceBlocks = renderTraces(traces);
  const userPrompt =
    `## Current prompt\n\`\`\`\n${candidate}\n\`\`\`\n\n` +
    `## Over-search traces\n${traceBlocks || '(none provided — add a general value-of-information early-exit rule: trust an exact ranked top hit, and require each extra call to add new information)'}\n\n` +
    `Rewrite the prompt with ONE added/strengthened VoI early-exit rule that cuts redundant double-checking without losing accuracy. Output only the new prompt:`;

  return { systemPrompt, userPrompt };
}

/**
 * Run OP-D Budget/VoI early-exit. Mirrors the OP-1..OP-5 contract.
 *
 * @returns {Promise<{ mutated: string, accepted: boolean, rejection?: object }>}
 */
export async function runBudgetVoiEdit({ candidate, traces, callModel, reflector }) {
  if (typeof callModel !== 'function') throw new TypeError('runBudgetVoiEdit: callModel must be a function');
  if (typeof candidate !== 'string') throw new TypeError('runBudgetVoiEdit: candidate must be a string');

  const { systemPrompt, userPrompt } = buildBudgetVoiPrompt({ candidate, traces });
  const result = await callModel({ lineage: 'moonshot', model: reflector ?? 'kimi-k2.6', systemPrompt, userPrompt });

  if (result.isError) {
    return { mutated: candidate, accepted: false, rejection: { reason: 'model-error', detail: result.text } };
  }
  const validation = validateMutation({ source: candidate, mutated: result.text ?? '', op: 'budget-voi' });
  if (!validation.ok) {
    return {
      mutated: candidate,
      accepted: false,
      rejection: { _kind: EVENT_KINDS.MUTATION_REJECTION, op: 'budget-voi', failures: validation.failures },
    };
  }
  return { mutated: validation.normalized, accepted: true };
}
