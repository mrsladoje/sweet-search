/**
 * Phase 7 — GEPA mutation orchestration (§3.2).
 *
 * OP-1 Reflective rewrite lives HERE (inline), per the wave-2 spec: it reads up
 * to N=5 worst-probe failure traces (joint ≤ 0.4) and asks Kimi K2.6 for a
 * single targeted edit, validated by the LANDED token-validator. OP-2..OP-5 are
 * delegated to their landed operator modules. The TARE adversarial paraphraser
 * also lives here (Sonnet 4.6, §3.3 step 3a).
 *
 * Every model call goes through the injectable `callModel` seam
 * (default = judge-runner.runJudge; tests pass a deterministic stub) so this
 * module is fully unit-testable without network.
 */

import { validateMutation } from './token-validator.mjs';
import { EVENT_KINDS } from './p7-shared.mjs';
import { runTrajectoryCrossover } from './op-trajectory-crossover.mjs';
import { runPersonaPivot } from './op-persona-pivot.mjs';
import { runToolMask } from './op-tool-mask.mjs';
import { runPruner } from './op-pruner.mjs';

// ─── OP-1 Reflective rewrite (inline) ───────────────────────────────────────

export const REFLECTIVE_SYSTEM_PROMPT =
  'You are an expert prompt engineer performing a reflective rewrite of an ' +
  'agent system prompt for an agentic code-search tool. You will be shown the ' +
  'current prompt and up to 5 failure traces (probes where the JOINT score ' +
  'across both target models was <= 0.4). Diagnose the single dominant failure ' +
  'pattern and propose ONE targeted edit that addresses it.\n\n' +
  '## Hard constraints\n' +
  '- Tokens wrapped in [[ ]] are PROTECTED: output them character-for-character ' +
  'with NO whitespace inside the brackets, at the SAME multiplicity as the ' +
  'source. Do NOT invent new [[...]] tokens.\n' +
  '- Code fences and regex patterns are protected.\n' +
  '- Keep the edit surgical — do not rewrite sections unrelated to the failures.\n\n' +
  'Output ONLY the rewritten prompt text. No preamble, no explanation.';

/**
 * Build the OP-1 reflective system + user prompt from a candidate + its worst
 * failure traces (from gepa-scoring.topFailures).
 */
export function buildReflectivePrompt({ candidate, failures }) {
  const traceBlocks = (failures || [])
    .slice(0, 5)
    .map((f, i) =>
      `### Failure ${i + 1} — probe ${f.probeId} ` +
      `(${f.stratum ?? '?'} / ${f.repo ?? '?'}) joint=${f.jointScore}\n` +
      `Query: ${f.query ?? '(unknown)'}\n` +
      `Tool calls: ${JSON.stringify(f.toolCalls ?? [])}\n` +
      `Agent answer: ${f.answer ?? '(none)'}\n` +
      `Expected files: ${JSON.stringify(f.expectedFiles ?? [])}`,
    )
    .join('\n\n');

  const userPrompt =
    `## Current prompt\n\`\`\`\n${candidate}\n\`\`\`\n\n` +
    `## Worst failures (joint <= 0.4)\n${traceBlocks || '(none provided — propose a general robustness edit)'}\n\n` +
    `Rewrite the prompt to address the dominant failure pattern. Output only the new prompt:`;

  return { systemPrompt: REFLECTIVE_SYSTEM_PROMPT, userPrompt };
}

/**
 * Run OP-1 Reflective rewrite. Mirrors the OP-2..OP-5 contract:
 *   → { mutated, accepted, rejection? }
 */
export async function runReflectiveRewrite({ candidate, failures, callModel, reflector }) {
  if (typeof callModel !== 'function') throw new TypeError('runReflectiveRewrite: callModel must be a function');
  if (typeof candidate !== 'string') throw new TypeError('runReflectiveRewrite: candidate must be a string');

  const { systemPrompt, userPrompt } = buildReflectivePrompt({ candidate, failures });
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
 * Generate K adversarial paraphrases of `prompt` (Sonnet 4.6, §3.3). Each is
 * token-validated; a paraphrase that corrupts a [[token]] falls back to the
 * source so TARE never measures sharpness against a broken variant.
 */
export async function generateAdversarialParaphrases({ prompt, k, callModel }) {
  if (typeof callModel !== 'function') throw new TypeError('generateAdversarialParaphrases: callModel must be a function');
  const out = [];
  for (let i = 0; i < k; i++) {
    const result = await callModel({
      lineage: 'anthropic-api',
      model: 'claude-sonnet-4-6',
      systemPrompt: TARE_PARAPHRASE_SYSTEM_PROMPT,
      userPrompt: `## Prompt\n\`\`\`\n${prompt}\n\`\`\`\n\nAdversarial paraphrase #${i + 1}:`,
    });
    if (result.isError) {
      out.push(prompt);
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

/**
 * Generate the 3 slot mutations for a round (§3.2 slot composition).
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
 * @returns {Promise<object[]>} one result per slot: { sourceOp, parentHash, mutated, accepted, rejection? }
 */
export async function generateMutations({ slots, parent, failures, probeById, round, callModel, rng, reflectionHint }) {
  const results = [];
  for (const slot of slots) {
    let res;
    switch (slot.op) {
      case 'reflective':
        res = await runReflectiveRewrite({ candidate: parent.prompt, failures, callModel });
        break;
      case 'trajectory-crossover': {
        const { probeId, winner, loser } = slot.pair;
        const probe = probeById?.[probeId] || { id: probeId, query: undefined };
        res = await runTrajectoryCrossover({
          probe,
          promptA: winner.prompt,
          promptB: loser.prompt,
          trajectoryA: pickTrajForProbe(winner, probeId, 'sonnet'),
          trajectoryB: pickTrajForProbe(loser, probeId, 'gpt5_5'),
          reflectionHint,
          callModel,
        });
        // OP-2 improves from promptA (the winner): lineage parent is the winner.
        res = { ...res, parentHashOverride: winner.hash };
        break;
      }
      case 'persona-pivot':
        res = await runPersonaPivot({ candidate: parent.prompt, round, callModel });
        break;
      case 'tool-mask':
        res = await runToolMask({ candidate: parent.prompt, callModel, rng });
        break;
      case 'pruner':
        res = await runPruner({ candidate: parent.prompt, callModel, minTokens: 120 });
        break;
      default:
        res = { mutated: parent.prompt, accepted: false, rejection: { reason: `unknown-op:${slot.op}` } };
    }
    results.push({
      sourceOp: slot.op,
      parentHash: res.parentHashOverride ?? parent.hash,
      mutated: res.mutated,
      accepted: res.accepted,
      rejection: res.rejection,
    });
  }
  return results;
}
