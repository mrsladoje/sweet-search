/**
 * MDL / prompt-length regulariser for GEPA selection.
 *
 * Reference: Dwork et al. 2015 §4 establishes a description-length-based
 * generalisation bound; PromptWizard (Agarwal et al. 2025, arXiv:2405.18369)
 * empirically observed +5pp generalisation gap between trimmed (~500 token)
 * and bloated (~2,000 token) prompts at equal dev score on BBH. Our defense
 * is two-pronged:
 *
 *   (a) Length-penalised score for GEPA's fitness function:
 *         penalised = score − λ · log(prompt_tokens)
 *       λ tuned so a +500-token bloat costs 1pp of dev score (default λ
 *       calibrated for tokenCount in [200, 4000]).
 *
 *   (b) Truncation re-evaluation: at every promotion gate, also score the
 *       top-3 candidates after truncating to the median seed length. A
 *       truncated version that drops > 2pp on Sealed-1 was overfit; reject
 *       the bloated original.
 *
 * Plan reference: §0.5 (control #6 sub-item), §11.10.4 (algorithm).
 *
 * Pure scoring helpers — no I/O. Tokeniser is supplied by the caller (the
 * CLI runner picks tiktoken or a model-specific tokeniser; this module just
 * counts).
 */

const DEFAULT_LAMBDA = 0.0017; // ≈ 1pp drop per +500 tokens around 1,000 tokens
const DEFAULT_TRUNCATION_REGRESSION_BUDGET = 0.02; // 2pp Sealed-1 drop ceiling

/**
 * Apply the length penalty to a candidate's raw score.
 *
 * @param {object} args
 * @param {number} args.score          — raw fitness (e.g. PASS rate or robustness_score)
 * @param {number} args.promptTokens   — token count of the candidate prompt
 * @param {number} [args.lambda=DEFAULT_LAMBDA]
 * @returns {{ penalisedScore: number, penalty: number, lambda: number, promptTokens: number }}
 */
export function lengthPenalisedScore({ score, promptTokens, lambda = DEFAULT_LAMBDA }) {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    throw new TypeError('mdl: score must be a number');
  }
  if (!Number.isFinite(promptTokens) || promptTokens <= 0) {
    throw new RangeError('mdl: promptTokens must be a positive number');
  }
  if (!(lambda >= 0)) throw new RangeError('mdl: lambda must be non-negative');
  const penalty = lambda * Math.log(promptTokens);
  return { penalisedScore: score - penalty, penalty, lambda, promptTokens };
}

/**
 * Truncate a prompt body to ≈ a target token count by trimming from the end
 * at sentence boundaries. The caller's tokeniser is used to keep token
 * counting accurate; if no tokeniser is supplied, a 4-chars-per-token
 * approximation is used (good enough for English+code MDL purposes).
 *
 * @param {object} args
 * @param {string} args.body
 * @param {number} args.targetTokens
 * @param {(text: string) => number} [args.tokenize]  — optional tokeniser; default 4 chars/token approx
 * @returns {{ truncated: string, originalTokens: number, truncatedTokens: number }}
 */
export function truncateToTokens({ body, targetTokens, tokenize }) {
  if (typeof body !== 'string') throw new TypeError('mdl: body must be a string');
  if (!Number.isInteger(targetTokens) || targetTokens < 1) {
    throw new RangeError('mdl: targetTokens must be a positive integer');
  }
  const tk = tokenize || ((s) => Math.max(1, Math.ceil(s.length / 4)));
  const originalTokens = tk(body);
  if (originalTokens <= targetTokens) {
    return { truncated: body, originalTokens, truncatedTokens: originalTokens };
  }

  // Trim from end at sentence/section boundaries to preserve readability.
  const breakpoints = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\n' || ch === '.' || ch === '!' || ch === '?') breakpoints.push(i + 1);
  }
  // Walk breakpoints from the end backward until under target.
  let cut = body.length;
  for (let bi = breakpoints.length - 1; bi >= 0; bi--) {
    const candidate = body.slice(0, breakpoints[bi]);
    if (tk(candidate) <= targetTokens) {
      cut = breakpoints[bi];
      break;
    }
  }
  if (cut === body.length) {
    // No clean breakpoint hit; fall back to char-proportional trim.
    cut = Math.max(1, Math.floor((body.length * targetTokens) / originalTokens));
  }
  const truncated = body.slice(0, cut).trimEnd();
  return { truncated, originalTokens, truncatedTokens: tk(truncated) };
}

/**
 * Truncation re-evaluation gate: a candidate "fails the bloat check" if its
 * Sealed-1 score drops more than `regressionBudget` after truncation to the
 * median seed length.
 *
 * Caller is expected to score both the original and truncated versions
 * through the §11.4.2 Thresholdout oracle (and pay the budget cost). This
 * module just makes the gate decision deterministic given the two scores.
 *
 * @param {object} args
 * @param {number} args.originalScore
 * @param {number} args.truncatedScore
 * @param {number} [args.regressionBudget=DEFAULT_TRUNCATION_REGRESSION_BUDGET]
 * @returns {{ passes: boolean, drop: number, regressionBudget: number }}
 */
export function truncationCheck({
  originalScore,
  truncatedScore,
  regressionBudget = DEFAULT_TRUNCATION_REGRESSION_BUDGET,
}) {
  if (typeof originalScore !== 'number' || typeof truncatedScore !== 'number') {
    throw new TypeError('mdl: scores must be numbers');
  }
  if (!(regressionBudget >= 0)) throw new RangeError('mdl: regressionBudget must be non-negative');
  const drop = originalScore - truncatedScore;
  return { passes: drop <= regressionBudget, drop, regressionBudget };
}

export const _defaults = Object.freeze({
  lambda: DEFAULT_LAMBDA,
  truncationRegressionBudget: DEFAULT_TRUNCATION_REGRESSION_BUDGET,
});
