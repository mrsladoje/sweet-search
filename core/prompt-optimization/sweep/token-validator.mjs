/**
 * Phase 7 — §3.2.1 Token validator.
 *
 * Validates that a mutation preserves every [[token]] from the source at the
 * same multiplicity, rejects unmapped OP-4 aliases, and rejects surplus tokens.
 * Whitespace inside brackets is normalised as a fix (not a failure) unless the
 * post-normalisation token set still doesn't match.
 */

import { PROTECTED_TOKEN_RE, OP4_ALIASES, MUTATION_REJECTION_REASONS } from './p7-shared.mjs';

// ─── normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise whitespace inside [[ ]] brackets.
 * `[[  ss-search ]]` → `[[ss-search]]`
 * `[[ TOOL_ALPHA ]]` → `[[TOOL_ALPHA]]`
 */
export function normalizeBrackets(text) {
  if (typeof text !== 'string') throw new TypeError('normalizeBrackets: string required');
  return text.replace(/\[\[\s*([^[\]]+?)\s*\]\]/g, (_, inner) => `[[${inner.trim()}]]`);
}

// ─── extraction ───────────────────────────────────────────────────────────────

/**
 * Extract all [[…]] tokens from text (after bracket-normalisation).
 * Returns a Map<normalizedToken, count> recording multiplicity.
 */
export function extractTokens(text) {
  if (typeof text !== 'string') throw new TypeError('extractTokens: string required');
  const normalized = normalizeBrackets(text);
  const map = new Map();
  // Use a fresh regex each call (avoid lastIndex state pollution from the shared global RE)
  const re = new RegExp(PROTECTED_TOKEN_RE.source, 'g');
  for (const m of normalized.matchAll(re)) {
    // m[0] is already normalised because we ran normalizeBrackets first
    const tok = m[0];
    map.set(tok, (map.get(tok) ?? 0) + 1);
  }
  return map;
}

// ─── OP-4 alias detection ─────────────────────────────────────────────────────

/** True iff the bracket-normalised token text is an OP-4 alias. */
function isAlias(token) {
  // token is like [[TOOL_ALPHA]]
  const inner = token.slice(2, -2); // strip [[ ]]
  return OP4_ALIASES.includes(inner);
}

// ─── main validator ───────────────────────────────────────────────────────────

/**
 * Validate that `mutated` faithfully preserves the [[tokens]] from `source`.
 *
 * @param {object} params
 * @param {string} params.source   — original candidate text
 * @param {string} params.mutated  — LLM-produced mutation
 * @param {string} [params.op]     — operator id (e.g. 'tool-mask'); affects alias check
 *
 * @returns {{ ok: boolean, normalized: string, failures: Array<{reason: string, token: string}> }}
 */
export function validateMutation({ source, mutated, op = '' }) {
  if (typeof source !== 'string') throw new TypeError('validateMutation: source must be string');
  if (typeof mutated !== 'string') throw new TypeError('validateMutation: mutated must be string');

  const failures = [];

  // Step 1: extract source tokens with multiplicity
  const sourceTokens = extractTokens(source);

  // Step 2: normalise mutated whitespace first (this is the "fix", not a failure)
  const normalized = normalizeBrackets(mutated);

  // Step 3: extract mutated tokens after normalisation
  const mutatedTokens = extractTokens(normalized);

  // Step 4: check every source token present at same multiplicity
  for (const [tok, srcCount] of sourceTokens) {
    const mutCount = mutatedTokens.get(tok) ?? 0;
    if (mutCount === 0) {
      failures.push({ reason: 'missing-token', token: tok });
    } else if (mutCount !== srcCount) {
      failures.push({ reason: 'multiplicity-changed', token: tok });
    }
  }

  // Step 5: reject surviving OP-4 aliases (unless op === 'tool-mask-premap')
  // 'tool-mask-premap' is the pre-back-mapping stage where aliases are intentional
  if (op !== 'tool-mask-premap') {
    for (const tok of mutatedTokens.keys()) {
      if (isAlias(tok)) {
        failures.push({ reason: 'unmapped-alias', token: tok });
      }
    }
  }

  // Step 6: reject surplus [[…]] tokens not in source
  for (const tok of mutatedTokens.keys()) {
    if (!sourceTokens.has(tok) && !isAlias(tok)) {
      failures.push({ reason: 'surplus-token', token: tok });
    }
  }

  return {
    ok: failures.length === 0,
    normalized,
    failures,
  };
}
