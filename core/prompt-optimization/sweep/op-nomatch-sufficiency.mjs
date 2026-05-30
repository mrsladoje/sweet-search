/**
 * Phase 7 — OP-B No-Match Sufficiency operator (2026-05-30).
 *
 * Productionizes the hand-built gen-3 "Candidate A" win: on no-match / negative-
 * result queries the agent SPIRALS (12–19 tool calls hunting a feature that does
 * not exist) before concluding absence — the single largest cost outlier (4.7×
 * native; post-mortem). This operator is a CONSTRAINED reflective rewrite: fed the
 * parent's worst no-match trajectories, it may add/strengthen exactly ONE positive
 * SUFFICIENCY rule that lets the agent confidently conclude absence sooner.
 *
 * It REPLACES OP-3 persona-pivot in the slot-3 rotation (persona-pivot was
 * demonstrated to be pure-noise reformatting — gen-2 round 4). Per SOTA research
 * (SCOPE arXiv:2512.15374 Dual-Stream Routing; AVA early-exit; the "no hard caps"
 * rule), the edit is framed as a positive sufficiency/coverage condition, NEVER a
 * blunt "stop after N", and is forbidden from adding new search instructions or
 * broadening queries (which is precisely what makes a generic reflective rewrite
 * RAISE cost).
 *
 * Every model call goes through the injectable `callModel` seam (the real path
 * routes to opencode + gemini-3.1-pro-preview, which ignores lineage/model).
 */

import { validateMutation } from './token-validator.mjs';
import { EVENT_KINDS } from './p7-shared.mjs';

/**
 * Render the no-match trajectory traces the operator reflects on. Accepts the
 * inefficiency/failure row shape produced by topInefficiencies / topFailures.
 */
function renderTraces(traces) {
  return (traces || [])
    .slice(0, 5)
    .map((f, i) => {
      const mtpc = typeof f.meanTokensPerCall === 'number' ? `, avg ~${f.meanTokensPerCall} tok/call (re-billed every turn)` : '';
      const callLine = (typeof f.calls === 'number')
        ? `Spent ${f.calls} tool calls${typeof f.nativeCalls === 'number' ? ` vs ${f.nativeCalls} native` : ''}${mtpc}\n`
        : '';
      return (
        `### No-match trace ${i + 1} — probe ${f.probeId} (${f.stratum ?? '?'} / ${f.repo ?? '?'})\n` +
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
 * Build the OP-B system + user prompt.
 *
 * @param {object}   params
 * @param {string}   params.candidate     — current candidate prompt text
 * @param {object[]} params.noMatchTraces — worst no-match (or fallback) traces
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildNoMatchSufficiencyPrompt({ candidate, noMatchTraces }) {
  const systemPrompt =
    `You are an expert prompt engineer tightening an agentic code-search prompt's ` +
    `STOPPING behavior on no-match / negative-result queries.` +
    `\n\nYou will see traces where the agent spiralled — making far more tool calls than ` +
    `necessary — before concluding that a feature/symbol is ABSENT. Accuracy on these is ` +
    `already correct; the waste is the long tail of redundant searches after the answer ` +
    `("it isn't here") was already determinable.` +
    `\n\n## Your edit (exactly one targeted change)\n` +
    `Add or strengthen ONE positive SUFFICIENCY rule that lets the agent conclude absence ` +
    `sooner and stop. Frame it as a COVERAGE condition, e.g. "once a natural-language ` +
    `[[ss-search]] and a broad [[ss-grep]] over the plausible locations BOTH return nothing, ` +
    `conclude the feature is absent, report it, and stop." A confirmed negative is a complete ` +
    `answer — a destination, not a failure to keep working around.` +
    `\n\n## Hard constraints\n` +
    `- Emit ONLY a stopping/sufficiency clause. Do NOT add new search instructions, new tools, ` +
    `new query-shaping rules, or anything that BROADENS searching — that raises cost.\n` +
    `- NO blunt hard caps ("stop after N calls"). The rule must be a positive coverage/sufficiency ` +
    `condition the agent can self-assess.\n` +
    `- Keep the edit surgical — do not rewrite unrelated sections.\n` +
    `- Tokens wrapped in [[ ]] are PROTECTED: output them character-for-character with NO ` +
    `whitespace inside the brackets, at the SAME multiplicity as the source. Do NOT invent new ` +
    `[[…]] tokens. Code fences and regex patterns are protected.\n\n` +
    `Output ONLY the rewritten prompt text. No preamble, no explanation.`;

  const traceBlocks = renderTraces(noMatchTraces);
  const userPrompt =
    `## Current prompt\n\`\`\`\n${candidate}\n\`\`\`\n\n` +
    `## No-match spiral traces\n${traceBlocks || '(none provided — add a general coverage-conditioned absence/sufficiency rule that lets the agent stop once two complementary searches come back empty)'}\n\n` +
    `Rewrite the prompt with ONE added/strengthened sufficiency rule that collapses the no-match spiral without losing accuracy. Output only the new prompt:`;

  return { systemPrompt, userPrompt };
}

/**
 * Run OP-B No-Match Sufficiency. Mirrors the OP-1..OP-5 contract:
 *   → { mutated, accepted, rejection? }
 *
 * @param {object}   params
 * @param {string}   params.candidate
 * @param {object[]} [params.noMatchTraces]
 * @param {Function} params.callModel
 * @param {string}   [params.reflector]
 */
export async function runNoMatchSufficiency({ candidate, noMatchTraces, callModel, reflector }) {
  if (typeof callModel !== 'function') throw new TypeError('runNoMatchSufficiency: callModel must be a function');
  if (typeof candidate !== 'string') throw new TypeError('runNoMatchSufficiency: candidate must be a string');

  const { systemPrompt, userPrompt } = buildNoMatchSufficiencyPrompt({ candidate, noMatchTraces });
  const result = await callModel({ lineage: 'moonshot', model: reflector ?? 'kimi-k2.6', systemPrompt, userPrompt });

  if (result.isError) {
    return { mutated: candidate, accepted: false, rejection: { reason: 'model-error', detail: result.text } };
  }
  const validation = validateMutation({ source: candidate, mutated: result.text ?? '', op: 'no-match-sufficiency' });
  if (!validation.ok) {
    return {
      mutated: candidate,
      accepted: false,
      rejection: { _kind: EVENT_KINDS.MUTATION_REJECTION, op: 'no-match-sufficiency', failures: validation.failures },
    };
  }
  return { mutated: validation.normalized, accepted: true };
}
