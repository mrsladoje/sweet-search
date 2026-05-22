/**
 * Phase 7 — OP-4 Tool-Signature Masking (§3.2, Gemini §A3, §12 q6).
 *
 * Temporarily aliases [[ss-search/ss-find/ss-semantic/ss-trace]] to
 * [[TOOL_ALPHA/BETA/GAMMA/DELTA]] (random permutation per call), asks Kimi to
 * optimize the prompt purely on tool-behaviour descriptions, then maps aliases
 * back. Domain-stripping in the system prompt prevents ghost-context leakage
 * (§A3): the reflector never sees the words "code/repository/search/semantic/
 * regex" — only "database/regex-anchor/vector-similarity/graph-traversal".
 */

import { mulberry32, randInt } from '../stats/rng.mjs';
import { OP4_ALIASES, EVENT_KINDS } from './p7-shared.mjs';
import { validateMutation } from './token-validator.mjs';

// The four maskable tool tokens (order matches OP4_ALIASES for reference, but
// the alias assignment is randomised per call via makeAliasMap).
const MASKABLE_TOOLS = ['ss-search', 'ss-find', 'ss-semantic', 'ss-trace'];

// ─── alias map ────────────────────────────────────────────────────────────────

/**
 * Build a fresh random alias map: tool-token → alias-token.
 * Uses a Fisher-Yates shuffle on the TOOL_ALPHA/BETA/GAMMA/DELTA alias list
 * driven by the provided RNG so results are deterministic given a seed.
 *
 * @param {Function} rng — () => number in [0,1) from mulberry32
 * @returns {Map<string, string>}  e.g. Map { '[[ss-search]]' → '[[TOOL_BETA]]', … }
 */
export function makeAliasMap(rng) {
  if (typeof rng !== 'function') throw new TypeError('makeAliasMap: rng must be a function');

  // Shuffle aliases with Fisher-Yates
  const aliases = [...OP4_ALIASES];
  for (let i = aliases.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [aliases[i], aliases[j]] = [aliases[j], aliases[i]];
  }

  const map = new Map();
  for (let i = 0; i < MASKABLE_TOOLS.length; i++) {
    map.set(`[[${MASKABLE_TOOLS[i]}]]`, `[[${aliases[i]}]]`);
  }
  return map;
}

// ─── mask / unmask ────────────────────────────────────────────────────────────

/**
 * Replace tool tokens with their aliases in `text`.
 * @param {string} text
 * @param {Map<string, string>} aliasMap
 * @returns {string}
 */
export function applyMask(text, aliasMap) {
  if (typeof text !== 'string') throw new TypeError('applyMask: text must be string');
  let result = text;
  for (const [tool, alias] of aliasMap) {
    // Escape brackets for safe regex usage
    const escaped = tool.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    result = result.replace(new RegExp(escaped, 'g'), alias);
  }
  return result;
}

/**
 * Replace aliases back with their original tool tokens.
 * @param {string} text
 * @param {Map<string, string>} aliasMap
 * @returns {string}
 */
export function unMask(text, aliasMap) {
  if (typeof text !== 'string') throw new TypeError('unMask: text must be string');
  let result = text;
  for (const [tool, alias] of aliasMap) {
    const escaped = alias.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    result = result.replace(new RegExp(escaped, 'g'), tool);
  }
  return result;
}

// ─── prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the domain-stripped OP-4 prompt.
 *
 * DOMAIN-STRIPPED: the system prompt must NEVER contain the words
 * code/repository/search/semantic/regex. Tools are framed as generic
 * database (ALPHA) / regex-anchor (BETA) / vector-similarity (GAMMA) /
 * graph-traversal (DELTA).
 *
 * @param {{ maskedCandidate: string }} params
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildToolMaskPrompt({ maskedCandidate }) {
  const systemPrompt =
    `You are an expert prompt engineer optimising an agent system prompt.` +
    `\n\nThe agent has access to four tools identified only by their functional roles:` +
    `\n  [[TOOL_ALPHA]] — a generic database lookup tool for exact key/value retrieval` +
    `\n  [[TOOL_BETA]]  — a regex-anchor pattern-matching tool for structured key lookups` +
    `\n  [[TOOL_GAMMA]] — a vector-similarity tool for fuzzy/conceptual matching` +
    `\n  [[TOOL_DELTA]] — a graph-traversal tool for relationship and dependency analysis` +
    `\n\nYour task: improve the system prompt so that an agent can correctly choose among` +
    ` these four tools based SOLELY on the descriptions in the prompt — not on the tool` +
    ` names themselves.` +
    `\n\n## Constraints` +
    `\n- [[TOOL_ALPHA]], [[TOOL_BETA]], [[TOOL_GAMMA]], [[TOOL_DELTA]] are PROTECTED tokens.` +
    ` Output them verbatim with NO whitespace inside the brackets.` +
    `\n- Every protected token that appears in the source MUST appear in your output at the` +
    ` SAME multiplicity.` +
    `\n- Do NOT add or remove protected tokens.` +
    `\n- Keep the prompt focused on tool-behaviour descriptions and routing logic only.\n\n` +
    `Output ONLY the improved system-prompt text. No preamble, no explanation.`;

  const userPrompt =
    `## System prompt to improve\n\`\`\`\n${maskedCandidate}\n\`\`\`\n\nImproved system prompt:`;

  return { systemPrompt, userPrompt };
}

// ─── async runner ─────────────────────────────────────────────────────────────

/**
 * Run OP-4 Tool-Signature Masking.
 *
 * @param {object}   params
 * @param {string}   params.candidate   — original candidate text
 * @param {Function} params.callModel   — async ({lineage, model, systemPrompt, userPrompt}) => {text, isError}
 * @param {Function} [params.rng]       — () => number; default mulberry32(Date.now())
 *
 * @returns {Promise<{ mutated: string, accepted: boolean, aliasMap: Map, rejection?: object }>}
 */
export async function runToolMask({ candidate, callModel, rng }) {
  if (typeof callModel !== 'function') throw new TypeError('runToolMask: callModel must be a function');
  if (typeof candidate !== 'string') throw new TypeError('runToolMask: candidate must be a string');

  const resolvedRng = typeof rng === 'function' ? rng : mulberry32(Date.now() >>> 0);
  const aliasMap = makeAliasMap(resolvedRng);

  // Step 1: mask tool tokens
  const maskedCandidate = applyMask(candidate, aliasMap);

  // Step 2: build domain-stripped prompt and call Kimi
  const { systemPrompt, userPrompt } = buildToolMaskPrompt({ maskedCandidate });

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
      aliasMap,
      rejection: { reason: 'model-error', detail: result.text },
    };
  }

  const rawMasked = result.text ?? '';

  // Step 3: unmask aliases back to real tool tokens
  const unmasked = unMask(rawMasked, aliasMap);

  // Step 4: validate — the source for comparison is the original candidate.
  // op='tool-mask' (not 'tool-mask-premap') so surviving aliases are rejected.
  const validation = validateMutation({ source: candidate, mutated: unmasked, op: 'tool-mask' });

  if (!validation.ok) {
    return {
      mutated: candidate,
      accepted: false,
      aliasMap,
      rejection: {
        _kind: EVENT_KINDS.MUTATION_REJECTION,
        op: 'tool-mask',
        failures: validation.failures,
      },
    };
  }

  return {
    mutated: validation.normalized,
    accepted: true,
    aliasMap,
  };
}
