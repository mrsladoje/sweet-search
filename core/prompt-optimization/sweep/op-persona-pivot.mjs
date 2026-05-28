/**
 * Phase 7 — OP-3 Persona / Constraint Pivot + compact router tables (§3.2).
 *
 * Two-mode operator:
 *   (a) Standard structural-format pivot - bullets, numbered lists, prose, and
 *       compact tables.
 *   (b) Router-table consolidation (fires when candidate has >=3 conditional
 *       routing rules in prose). Converts scattered conditions into a compact
 *       decision table and explicitly avoids AST/procedure/pseudocode blocks.
 *
 * Generator rotation (GPT-5.5 review §C2): Sonnet 4.6 is default; every 3rd
 * round uses Kimi K2.6 or GPT-5.5 to diversify the paraphrase family.
 *
 * Also exports STATEFUL_SUMMARY_RULE (§3.2.3 verbatim).
 */

import { validateMutation } from './token-validator.mjs';
import { EVENT_KINDS } from './p7-shared.mjs';

// MUST stay byte-identical with the router-table detection in
// op-pruner.mjs:extractProtectedBlocks. We DO NOT import that module
// (op-pruner re-exports STATEFUL_SUMMARY_RULE from this file, so importing
// the other direction creates a circular dependency). If the pruner's
// detection regex changes, update this one too — there is a regression test
// in p7-persona-pivot.test.js that pipes mode-b output through
// extractProtectedBlocks to catch drift.
function containsRouterTable(text) {
  if (typeof text !== 'string') return false;
  for (const line of text.split('\n')) {
    if (/^\s*\|/.test(line) && /query signal/i.test(line) && /first call/i.test(line)) return true;
  }
  return false;
}

// ─── §3.2.3 stateful summarisation rule (verbatim) ───────────────────────────

export const STATEFUL_SUMMARY_RULE =
  "Before your third sweet-search query in the current search iteration " +
  "(we can have multiple search iterations in a session) — or before your final answer, whichever comes first, " +
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
 * text. Used to decide whether mode (b) router-table consolidation should fire.
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
 * @param {'a'|'b'} params.mode       — 'a' = format pivot, 'b' = router table
 * @param {object}  [params.generator]— {lineage, model}
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildPersonaPivotPrompt({ candidate, mode, generator }) {
  const modeInstruction =
    mode === 'b'
      ? `Convert scattered prose routing rules and conditional logic into a compact router table.
The table header row MUST contain the LITERAL column names "Query signal" and "First call" (case-insensitive).
Use exactly these four columns: Query signal | First call | Follow-up | Stop condition.
An automated validator checks the header — a mutation that paraphrases the column names (e.g. "Query type", "Primary tool") will be REJECTED and waste this slot.
Consolidate duplicate conditions and delete redundant restatements.
Do NOT create ASTs, procedure blocks, pseudocode blocks, flowcharts, or fenced code.
Do NOT alter syntax/indentation/logic of any code fences already present.
Preserve all natural-language sections that are NOT conditional routing rules.`
      : `Restructure the prompt's surface format only (e.g. bullets → numbered lists, dense
paragraphs → compact tables, or vice-versa). Do NOT alter any operational rule
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

  // Mode-b silent-failure gate: the operator's whole point is to produce a
  // router table that OP-5 can later protect. If the mutator paraphrased the
  // header columns away from "Query signal | First call | …" the table will
  // NOT be picked up by op-pruner.extractProtectedBlocks and a downstream
  // OP-5 pass would silently delete the routing rules as "extra prose". This
  // is the round-7 silent-failure pattern transplanted to OP-3. Reject so
  // the slot can retry rather than admitting a candidate whose routing logic
  // is one prune away from extinction.
  if (mode === 'b' && !containsRouterTable(validation.normalized)) {
    return {
      mutated: candidate,
      accepted: false,
      generator,
      mode,
      rejection: {
        _kind: EVENT_KINDS.MUTATION_REJECTION,
        op: 'persona-pivot',
        reason: 'router-table-header-missing',
        failures: [{ reason: 'router-table-header-missing', detail: 'mode-b output lacks a markdown table whose header contains "Query signal" and "First call"' }],
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
