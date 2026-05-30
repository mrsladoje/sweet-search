/**
 * Phase 7 — OP-E System-Aware Merge (2026-05-30), replacing OP-2 trajectory-crossover
 * in slot 2.
 *
 * GEPA ships TWO proposal operators — Reflective Mutation AND System-Aware Merge
 * (Agrawal et al. 2025, Appendix D.1): it "identifies distinct optimization lineages
 * that have learnt complementary strategies (by evolving distinct modules) and merges
 * them by picking the best version of different modules from each lineage." GEPA+Merge
 * beats GEPA by up to +5%.
 *
 * Our prior OP-2 trajectory-crossover BLENDED two routings into indecision (gen-2
 * post-mortem). System-Aware Merge instead composes complementary edits at the MODULE
 * granularity with NO within-module blending. Our prompts are sectioned by markdown
 * `##` headers, so a "module" = one `##` section. The merge selects, per section, the
 * WHOLE version from whichever lineage evolved it best — never rewriting inside a
 * section. This composes (cheap-lineage routing/stopping) + (other-lineage coverage)
 * into one prompt.
 *
 * Model-dependent (GEPA: helped GPT-4.1-Mini, hurt Qwen3-8B), so it is gated behind
 * the cost-mismatch pair selector (fires rarely) + the 0.15 admission cap + held-out
 * gates — i.e. introduced as a minority of the proposal budget, per the research.
 */

import { validateMutation } from './token-validator.mjs';
import { EVENT_KINDS, isNearDuplicate } from './p7-shared.mjs';

/**
 * Split a prompt into `##`-header sections. The text before the first `##` is the
 * '(preamble)' section. Pure + exported for tests.
 *
 * @param {string} prompt
 * @returns {{ header: string, body: string }[]}
 */
export function splitSections(prompt) {
  const lines = String(prompt ?? '').split('\n');
  const sections = [];
  let cur = { header: '(preamble)', lines: [] };
  for (const ln of lines) {
    if (/^##\s+/.test(ln)) {
      sections.push(cur);
      cur = { header: ln.replace(/^##\s+/, '').trim(), lines: [ln] };
    } else {
      cur.lines.push(ln);
    }
  }
  sections.push(cur);
  return sections.map((s) => ({ header: s.header, body: s.lines.join('\n').replace(/\s+$/, '') }));
}

/**
 * Build the OP-E system + user prompt. A = the cheaper/winning lineage (the merge
 * baseline whose tokens we validate against); B = the other lineage contributing
 * complementary sections.
 *
 * @param {object} params
 * @param {string} params.promptA  — winning lineage (cheaper at fixed accuracy)
 * @param {string} params.promptB  — other lineage
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildSystemAwareMergePrompt({ promptA, promptB }) {
  const headersA = splitSections(promptA).map((s) => s.header).filter((h) => h !== '(preamble)');
  const headersB = splitSections(promptB).map((s) => s.header).filter((h) => h !== '(preamble)');

  const systemPrompt =
    `You are an expert prompt engineer performing a SYSTEM-AWARE MERGE of two agent ` +
    `system-prompt candidates that evolved from different lineages and learnt ` +
    `COMPLEMENTARY strengths in different sections.` +
    `\n\n## Task\n` +
    `Both prompts are organised into \`##\` sections. Produce ONE merged prompt by ` +
    `selecting, for EACH section, the single better WHOLE version from candidate A or ` +
    `candidate B — the one that routes more decisively, stops sooner, or states the ` +
    `rule more cleanly. Candidate A is the more cost-efficient lineage; prefer A's ` +
    `version unless B's section is clearly better for that concern.` +
    `\n\n## Hard constraints\n` +
    `- MODULE-WISE selection ONLY. Do NOT blend, average, or write new prose INSIDE a ` +
    `section — take a section verbatim from A or from B. (Blending two routings into ` +
    `one is the failure this operator exists to avoid.)\n` +
    `- Keep every section present in A; you may additionally pull a section that exists ` +
    `only in B if it adds a complementary capability.\n` +
    `- Tokens wrapped in [[ ]] are PROTECTED: output them character-for-character with ` +
    `NO whitespace inside the brackets. Do NOT invent new [[…]] tokens. Use only tokens ` +
    `that appear in A or B.\n` +
    `- Preserve code fences and regex patterns byte-identically.\n\n` +
    `Output ONLY the merged prompt text. No preamble, no explanation.`;

  const userPrompt =
    `## Candidate A — winning / cost-efficient lineage (sections: ${headersA.join(', ') || 'n/a'})\n` +
    `\`\`\`\n${promptA}\n\`\`\`\n\n` +
    `## Candidate B — other lineage (sections: ${headersB.join(', ') || 'n/a'})\n` +
    `\`\`\`\n${promptB}\n\`\`\`\n\n` +
    `Merged prompt (best whole version of each section):`;

  return { systemPrompt, userPrompt };
}

/**
 * Run OP-E System-Aware Merge. Mirrors the OP-1..OP-5 contract.
 *
 * @returns {Promise<{ mutated: string, accepted: boolean, rejection?: object }>}
 */
export async function runSystemAwareMerge({ promptA, promptB, callModel, reflector }) {
  if (typeof callModel !== 'function') throw new TypeError('runSystemAwareMerge: callModel must be a function');
  if (typeof promptA !== 'string' || typeof promptB !== 'string') throw new TypeError('runSystemAwareMerge: promptA and promptB must be strings');

  const { systemPrompt, userPrompt } = buildSystemAwareMergePrompt({ promptA, promptB });
  const result = await callModel({ lineage: 'moonshot', model: reflector ?? 'kimi-k2.6', systemPrompt, userPrompt });

  if (result.isError) {
    return { mutated: promptA, accepted: false, rejection: { reason: 'model-error', detail: result.text } };
  }
  // Validate against A (the winning lineage we merge from) for token preservation.
  const validation = validateMutation({ source: promptA, mutated: result.text ?? '', op: 'system-aware-merge' });
  if (!validation.ok) {
    return {
      mutated: promptA,
      accepted: false,
      rejection: { _kind: EVENT_KINDS.MUTATION_REJECTION, op: 'system-aware-merge', failures: validation.failures },
    };
  }
  // Divergence gate (2026-05-30): on a dominant-lineage front the merge tends to
  // return the winner (A) verbatim — a no-op clone that wastes a screen+confirm slot
  // (gen-3 round 1). Reject a merge that is ≈ either parent so runOpWithRetry can
  // re-prompt for a genuine cross-lineage composition; if it keeps cloning, the slot
  // ends rejected (unscreened) rather than admitting a duplicate.
  if (isNearDuplicate(validation.normalized, promptA) || isNearDuplicate(validation.normalized, promptB)) {
    return {
      mutated: promptA,
      accepted: false,
      rejection: {
        _kind: EVENT_KINDS.MUTATION_REJECTION,
        op: 'system-aware-merge',
        reason: 'merge-noop-clone',
        failures: [{ reason: 'merge-noop-clone', detail: 'merged output is ≈ a parent (no cross-lineage section swap) — pull at least one section from the other candidate' }],
      },
    };
  }
  return { mutated: validation.normalized, accepted: true };
}
