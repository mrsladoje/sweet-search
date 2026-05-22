/**
 * Phase 7 — OP-3 Persona / Constraint Pivot + AST-ification (§3.2).
 *
 * Two-mode operator:
 *   (a) Standard structural-format pivot — bullets → numbered lists, paragraphs
 *       → strict pseudocode layout, etc.
 *   (b) AST-ification of routing constraints (fires when candidate has ≥3
 *       conditional routing rules in prose). Converts prose routing rules into
 *       pseudocode blocks labelled "# routing policy pseudocode — NOT executable
 *       code". Prefers decision tables over fenced ```python``` blocks.
 *
 * Generator rotation (GPT-5.5 review §C2): Sonnet 4.6 is default; every 3rd
 * round uses Kimi K2.6 or GPT-5.5 to diversify the paraphrase family.
 *
 * Also exports STATEFUL_SUMMARY_RULE (§3.2.3 verbatim).
 */

import { validateMutation } from './token-validator.mjs';
import { EVENT_KINDS } from './p7-shared.mjs';

// ─── §3.2.3 stateful summarisation rule (verbatim) ───────────────────────────

export const STATEFUL_SUMMARY_RULE =
  "Before your 3rd tool call (or before your final answer, whichever comes first), " +
  "you MUST output a `<state_summary>` block containing exactly: " +
  "(1) one sentence summarising what you've established so far, " +
  "(2) one sentence stating your current blind spot or open question.";

// ─── conditional-rule counter ─────────────────────────────────────────────────

// Patterns that indicate a conditional routing rule in prose
const CONDITIONAL_PATTERNS = [
  /\bif\b.*\bthen\b/gi,
  /\bwhen\b.{1,80}(?:use|call|invoke|prefer|route)/gi,
  /\bfor\b.{1,60}(?:queries|tasks|requests).{0,40}(?:use|call|invoke)/gi,
  /\bunless\b/gi,
  /\botherwise\b/gi,
  /\belse\b/gi,
  /^\s*[-*]\s+(?:if|when|for|unless)/gim,
];

/**
 * Count the number of distinct conditional routing rules found in the candidate
 * text. Used to decide whether mode (b) AST-ification should fire.
 *
 * @param {string} text
 * @returns {number}
 */
export function countConditionalRules(text) {
  if (typeof text !== 'string') return 0;
  let total = 0;
  for (const pattern of CONDITIONAL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    const matches = text.match(re);
    if (matches) total += matches.length;
  }
  return total;
}

// ─── generator picker ─────────────────────────────────────────────────────────

/**
 * Pick the generator config for this round.
 * - Default: claude-sonnet-4-6 via anthropic-api
 * - Every 3rd round (1-based): alternates Kimi K2.6 then GPT-5.5
 *
 * @param {number} round  — 1-based round number
 * @returns {{ lineage: string, model: string }}
 */
export function pickGenerator(round) {
  if (typeof round !== 'number' || !Number.isFinite(round)) {
    return { lineage: 'anthropic-api', model: 'claude-sonnet-4-6' };
  }
  if (round % 3 === 0) {
    // Alternates: round 3→ kimi, round 6→ gpt5.5, round 9→ kimi, …
    const cycle = Math.floor((round / 3) - 1) % 2;
    return cycle === 0
      ? { lineage: 'moonshot', model: 'kimi-k2.6' }
      : { lineage: 'openai-api', model: 'gpt-5.5' };
  }
  return { lineage: 'anthropic-api', model: 'claude-sonnet-4-6' };
}

// ─── prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the system + user prompt for OP-3.
 *
 * @param {object} params
 * @param {string}  params.candidate  — current candidate prompt text
 * @param {'a'|'b'} params.mode       — 'a' = format pivot, 'b' = AST-ification
 * @param {object}  [params.generator]— {lineage, model}
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildPersonaPivotPrompt({ candidate, mode, generator }) {
  const modeInstruction =
    mode === 'b'
      ? `Convert ALL prose routing rules and conditional logic into pseudocode blocks.
LABEL every pseudocode block with the comment: # routing policy pseudocode — NOT executable code
PREFER decision tables over fenced \`\`\`python\`\`\` blocks for high-level routing.
If you must use a fenced block, it MUST carry the label: # routing policy pseudocode — NOT executable code
Do NOT alter syntax/indentation/logic of pseudocode or fenced code blocks already present.
Preserve all natural-language sections that are NOT conditional routing rules.`
      : `Restructure the prompt's surface format only (e.g. bullets → numbered lists, dense
paragraphs → strict pseudocode layout, or vice-versa). Do NOT alter any operational rule
or [[token]]. The meaning must be identical; only the structural presentation changes.`;

  const systemPrompt =
    `You are an expert prompt engineer performing a structural persona/constraint pivot.` +
    `\n\n## Task\n${modeInstruction}` +
    `\n\n## Hard constraints (apply to BOTH modes)\n` +
    `- Tokens wrapped in [[ ]] are PROTECTED. Output them character-for-character with NO` +
    ` whitespace inside the brackets. Do NOT translate, paraphrase, or remove them.\n` +
    `- Code fences (\`\`\`...\`\`\`) and regex patterns are protected — do not modify their content.\n` +
    `- Every [[token]] that appears in the source MUST appear in your output at the SAME multiplicity.\n` +
    `- Do NOT invent new [[…]] tokens.\n\n` +
    `Output ONLY the restructured prompt text. No preamble, no explanation.`;

  const userPrompt =
    `## Candidate prompt to restructure\n\`\`\`\n${candidate}\n\`\`\`\n\nRestructured prompt:`;

  return { systemPrompt, userPrompt };
}

// ─── async runner ─────────────────────────────────────────────────────────────

/**
 * Run OP-3 Persona / Constraint Pivot.
 *
 * @param {object}   params
 * @param {string}   params.candidate   — current candidate text
 * @param {number}   [params.round=1]   — 1-based round number (for generator rotation)
 * @param {Function} params.callModel   — async ({lineage, model, systemPrompt, userPrompt}) => {text, isError}
 *
 * @returns {Promise<{ mutated: string, accepted: boolean, generator: object, mode: 'a'|'b', rejection?: object }>}
 */
export async function runPersonaPivot({ candidate, round = 1, callModel }) {
  if (typeof callModel !== 'function') throw new TypeError('runPersonaPivot: callModel must be a function');
  if (typeof candidate !== 'string') throw new TypeError('runPersonaPivot: candidate must be a string');

  const mode = countConditionalRules(candidate) >= 3 ? 'b' : 'a';
  const generator = pickGenerator(round);

  const { systemPrompt, userPrompt } = buildPersonaPivotPrompt({ candidate, mode, generator });

  const result = await callModel({
    lineage: generator.lineage,
    model: generator.model,
    systemPrompt,
    userPrompt,
  });

  if (result.isError) {
    return {
      mutated: candidate,
      accepted: false,
      generator,
      mode,
      rejection: { reason: 'model-error', detail: result.text },
    };
  }

  const rawMutated = result.text ?? '';
  const validation = validateMutation({ source: candidate, mutated: rawMutated, op: 'persona-pivot' });

  if (!validation.ok) {
    return {
      mutated: candidate,
      accepted: false,
      generator,
      mode,
      rejection: {
        _kind: EVENT_KINDS.MUTATION_REJECTION,
        op: 'persona-pivot',
        failures: validation.failures,
      },
    };
  }

  return {
    mutated: validation.normalized,
    accepted: true,
    generator,
    mode,
  };
}
