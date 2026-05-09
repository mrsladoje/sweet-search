/**
 * Thresholdout — Reusable Holdout oracle for the Sealed-1 split.
 *
 * Implements the mechanism of Dwork, Feldman, Hardt, Pitassi, Reingold, Roth,
 * "The Reusable Holdout: Preserving Validity in Adaptive Data Analysis,"
 * Science 349 (6248), 636-638, 2015 (DOI 10.1126/science.aaa9375).
 *
 * Why this exists: §6.6 G1-G5 + §9.3 promotion gates + §6.4 ablation tie-breaks
 * collectively query the 40-probe Sealed-1 set hundreds of times across a
 * campaign. Without an oracle, generalisation error grows as O(√(k/n)); at
 * k≈100, n=40 that is ~50% effective error and the heldout is statistically
 * theatrical. The oracle returns DIFFER vs Dev only when the two scores
 * meaningfully diverge, and otherwise withholds the Sealed-1 score on
 * purpose — preventing the optimiser from chasing Sealed-1 noise.
 *
 * Plan reference: §0.5 (campaign-wide overfit framework), §11.4.2 (algorithm),
 * §0.5.4 (pre-registered query budget).
 *
 * IMPORTANT: this module is the ONLY legitimate accessor of
 * `core/prompt-optimization/data/splits/heldout_40.json`. ESLint
 * `no-restricted-imports` + `scripts/check-boundaries.js` flag any other
 * file that reads the Sealed-1 split directly.
 *
 * The wrapper takes pre-computed dev and Sealed-1 score vectors (means or
 * per-probe arrays). Score collection itself is the caller's job; this module
 * is pure given the inputs and a budget log path.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { dirname } from 'path';
import { mulberry32 } from './rng.mjs';

const DEFAULT_TAU = 0.05;
const DEFAULT_SIGMA = 0.03;

/**
 * Sample a Laplace(0, b) variate using the inverse-CDF method.
 *
 * U ~ Uniform(-0.5, 0.5)  →  X = -b · sign(U) · ln(1 - 2|U|)
 * Pure given the rng() handle.
 */
function laplace(rng, scale) {
  const u = rng() - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

function meanOf(xs) {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

function asMean(input) {
  if (typeof input === 'number') return input;
  if (Array.isArray(input)) {
    if (input.length === 0) throw new RangeError('thresholdout: empty score vector');
    return meanOf(input);
  }
  throw new TypeError('thresholdout: scores must be a number or a number array');
}

/**
 * Stateful budget log — append-only JSONL, one record per query.
 *
 * Schema per line:
 *   { ts, runId, queryId, candidateId, decision, devScore,
 *     s1Score (only on DIFFER), tau, sigma, budgetUsedAfter, budgetTotal }
 */
class BudgetLog {
  constructor({ path, runId, totalBudget }) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new TypeError('thresholdout: budget log path required');
    }
    if (typeof runId !== 'string' || runId.length === 0) {
      throw new TypeError('thresholdout: runId required');
    }
    if (!Number.isInteger(totalBudget) || totalBudget < 1) {
      throw new RangeError('thresholdout: totalBudget must be a positive integer');
    }
    this.path = path;
    this.runId = runId;
    this.totalBudget = totalBudget;
    this.used = this.#countExisting();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  }

  #countExisting() {
    if (!existsSync(this.path)) return 0;
    const text = readFileSync(this.path, 'utf8');
    if (text.length === 0) return 0;
    return text.split('\n').filter(Boolean).length;
  }

  remaining() {
    return Math.max(0, this.totalBudget - this.used);
  }

  /** Append one query record + return the new used count. Throws if exhausted. */
  consume(record) {
    if (this.used >= this.totalBudget) {
      throw new BudgetExhaustedError(
        `thresholdout: pre-registered budget of ${this.totalBudget} queries already consumed; ` +
          `further Sealed-1 reads require a NEW pre-registration tag (§0.5.4)`
      );
    }
    this.used += 1;
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        runId: this.runId,
        budgetUsedAfter: this.used,
        budgetTotal: this.totalBudget,
        ...record,
      }) + '\n';
    appendFileSync(this.path, line);
    return this.used;
  }
}

export class BudgetExhaustedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BudgetExhaustedError';
  }
}

/**
 * Open a Thresholdout oracle bound to a budget log file.
 *
 * @param {object} args
 * @param {string} args.budgetLogPath
 *   Append-only JSONL log. Pre-existing entries count toward the budget so
 *   the oracle is crash-safe and resumable.
 * @param {string} args.runId           — campaign run id (matches preregistration tag)
 * @param {number} args.totalBudget     — the §0.5.4 pre-registered cap (default 26)
 * @param {number} [args.tau=0.05]      — meaningful-divergence threshold
 * @param {number} [args.sigma=0.03]    — Laplace noise scale
 * @param {number} [args.seed=42]
 * @returns {{
 *   query: (args: {
 *     queryId: string, candidateId: string,
 *     devScore: number | number[], sealed1Score: number | number[],
 *   }) => { decision: 'AGREE' | 'DIFFER', devScore: number, sealed1Score: number | null,
 *           budgetUsedAfter: number, budgetTotal: number },
 *   remaining: () => number,
 * }}
 */
export function openThresholdout({
  budgetLogPath,
  runId,
  totalBudget = 26,
  tau = DEFAULT_TAU,
  sigma = DEFAULT_SIGMA,
  seed = 42,
}) {
  if (!(tau > 0)) throw new RangeError('thresholdout: tau must be positive');
  if (!(sigma > 0)) throw new RangeError('thresholdout: sigma must be positive');

  const log = new BudgetLog({ path: budgetLogPath, runId, totalBudget });
  const rng = mulberry32(seed);

  return {
    /**
     * One Thresholdout query.
     *
     * Algorithm (Dwork et al. 2015 §3, "Reusable Holdout"):
     *   noisyS1   = mean(sealed1) + Laplace(0, σ)
     *   noisyTau  = τ + Laplace(0, σ)
     *   if |noisyS1 − meanDev| > noisyTau   → return DIFFER, expose noisyS1
     *   else                                  → return AGREE, withhold s1
     *
     * The algorithm purposefully withholds Sealed-1 means when they don't
     * meaningfully differ from Dev, so the optimiser cannot iterate on
     * Sealed-1 noise. Only DIFFER outcomes leak Sealed-1 information.
     */
    query({ queryId, candidateId, devScore, sealed1Score }) {
      if (typeof queryId !== 'string' || queryId.length === 0) {
        throw new TypeError('thresholdout: queryId required');
      }
      if (typeof candidateId !== 'string' || candidateId.length === 0) {
        throw new TypeError('thresholdout: candidateId required');
      }

      const meanDev = asMean(devScore);
      const meanS1 = asMean(sealed1Score);
      const noisyS1 = meanS1 + laplace(rng, sigma);
      const noisyTau = tau + laplace(rng, sigma);
      const diverges = Math.abs(noisyS1 - meanDev) > Math.abs(noisyTau);
      const decision = diverges ? 'DIFFER' : 'AGREE';
      const exposedS1 = diverges ? noisyS1 : null;

      const budgetUsedAfter = log.consume({
        queryId,
        candidateId,
        decision,
        devScore: meanDev,
        sealed1Score: exposedS1,
        tau,
        sigma,
      });

      return {
        decision,
        devScore: meanDev,
        sealed1Score: exposedS1,
        budgetUsedAfter,
        budgetTotal: totalBudget,
      };
    },
    remaining: () => log.remaining(),
  };
}

/**
 * Read the existing budget consumption from a log file without opening
 * an oracle. Useful for pre-flight budget checks in the runbook.
 */
export function readBudgetUsage(path) {
  if (!existsSync(path)) return { used: 0, lines: [] };
  const text = readFileSync(path, 'utf8');
  if (text.length === 0) return { used: 0, lines: [] };
  const lines = text
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  return { used: lines.length, lines };
}

/**
 * Initialise an empty budget log (idempotent — does not overwrite).
 */
export function initBudgetLog(path) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, '');
  return { path, exists: true };
}
