/**
 * TARE — adversarial paraphrase selection gate (Pareto-gated, Phase 7).
 *
 * Reference: TARE (NeurIPS 2025, arXiv:2509.24130).
 * Plan reference: docs/PHASE7.md §3.3, §3.7.1 steps 7–8.
 *
 * The key optimisation vs. naive TARE: only run the expensive paraphrase
 * generation + evaluation when the candidate would enter the Pareto front
 * by task score alone. This saves ~70% of the TARE budget (§3.3).
 *
 * All LLM calls (generateParaphrases, evaluate) are injectable so this module
 * contains zero I/O and remains fully unit-testable.
 */

import { DEFAULTS } from './p7-shared.mjs';

// ─── sharpness ─────────────────────────────────────────────────────────────────

/**
 * Paraphrase sharpness: range of joint scores across candidate + paraphrases.
 * §3.7.1 step 7: sharpness = max(scores) − min(scores)
 *
 * @param {number[]} scores
 * @returns {number}
 */
export function sharpness(scores) {
  if (!Array.isArray(scores) || scores.length === 0) {
    throw new TypeError('sharpness: scores must be a non-empty array');
  }
  for (let i = 0; i < scores.length; i++) {
    if (typeof scores[i] !== 'number' || !Number.isFinite(scores[i])) {
      throw new TypeError(`sharpness: scores[${i}] must be a finite number`);
    }
  }
  return Math.max(...scores) - Math.min(...scores);
}

/**
 * Sharpness Pareto objective: higher is better for a robust prompt.
 * §3.7.1 step 8: sharpness_objective = 1 − sharpness
 *
 * @param {number} s — sharpness value from `sharpness()`
 * @returns {number}
 */
export function sharpnessObjective(s) {
  if (typeof s !== 'number' || !Number.isFinite(s)) {
    throw new TypeError('sharpnessObjective: s must be a finite number');
  }
  return 1 - s;
}

// ─── Pareto-entry gate ────────────────────────────────────────────────────────

/**
 * Would this candidate enter the Pareto front by task score alone?
 *
 * True iff the candidate's taskScore strictly exceeds at least one incumbent's
 * taskScore — i.e., it could Pareto-dominate at least one member on that axis.
 * Empty front → always true (no incumbents to compete against).
 *
 * §3.3 Pareto-gated TARE flow.
 *
 * @param {object} args
 * @param {number} args.candidateTaskScore
 * @param {{ taskScore: number }[]} args.front
 * @returns {boolean}
 */
export function wouldEnterParetoByTaskScore({ candidateTaskScore, front }) {
  if (typeof candidateTaskScore !== 'number' || !Number.isFinite(candidateTaskScore)) {
    throw new TypeError('wouldEnterParetoByTaskScore: candidateTaskScore must be a finite number');
  }
  if (!Array.isArray(front)) {
    throw new TypeError('wouldEnterParetoByTaskScore: front must be an array');
  }
  if (front.length === 0) return true;
  return front.some((inc) => {
    if (typeof inc.taskScore !== 'number') {
      throw new TypeError('wouldEnterParetoByTaskScore: each front element must have a numeric taskScore');
    }
    return candidateTaskScore > inc.taskScore;
  });
}

// ─── Pareto-gated TARE ────────────────────────────────────────────────────────

/**
 * Pareto-gated TARE adversarial paraphrase selection gate.
 * §3.3.
 *
 * Flow:
 *  1. Check if candidate would enter the Pareto front by task score.
 *     → If not: return {ran:false} immediately (no paraphrases generated).
 *  2. Generate K adversarial paraphrases of candidate.prompt.
 *  3. Evaluate candidate + each paraphrase → joint score.
 *  4. Compute sharpness = max(scores) − min(scores) over all K+1 evaluations.
 *  5. Return {ran:true, sharpness, sharpnessScore, evaluations}.
 *
 * @param {object} args
 * @param {{ prompt: string, taskScore: number }} args.candidate
 * @param {{ taskScore: number }[]} args.front
 * @param {(prompt: string, k: number) => Promise<string[]>} args.generateParaphrases
 * @param {(promptText: string) => Promise<number>} args.evaluate — returns joint score
 * @returns {Promise<
 *   { ran: false } |
 *   { ran: true, sharpness: number, sharpnessScore: number,
 *     evaluations: { prompt: string, score: number }[] }
 * >}
 */
export async function paretoGatedTare({ candidate, front, generateParaphrases, evaluate }) {
  if (candidate == null || typeof candidate !== 'object') {
    throw new TypeError('paretoGatedTare: candidate must be an object');
  }
  if (typeof candidate.prompt !== 'string') {
    throw new TypeError('paretoGatedTare: candidate.prompt must be a string');
  }
  if (typeof candidate.taskScore !== 'number' || !Number.isFinite(candidate.taskScore)) {
    throw new TypeError('paretoGatedTare: candidate.taskScore must be a finite number');
  }
  if (typeof generateParaphrases !== 'function') {
    throw new TypeError('paretoGatedTare: generateParaphrases must be a function');
  }
  if (typeof evaluate !== 'function') {
    throw new TypeError('paretoGatedTare: evaluate must be a function');
  }

  // Gate: skip TARE for candidates that cannot enter the Pareto front.
  const wouldEnter = wouldEnterParetoByTaskScore({ candidateTaskScore: candidate.taskScore, front });
  if (!wouldEnter) {
    return { ran: false };
  }

  // Generate K adversarial paraphrases (K = DEFAULTS.tareParaphrases = 3).
  const paraphrases = await generateParaphrases(candidate.prompt, DEFAULTS.tareParaphrases);
  if (!Array.isArray(paraphrases)) {
    throw new TypeError('paretoGatedTare: generateParaphrases must return an array of strings');
  }

  // Evaluate original + all paraphrases.
  const allPrompts = [candidate.prompt, ...paraphrases];
  const evaluations = await Promise.all(
    allPrompts.map(async (prompt) => ({ prompt, score: await evaluate(prompt) })),
  );

  const scores = evaluations.map((e) => e.score);
  const s = sharpness(scores);

  return {
    ran: true,
    sharpness: s,
    sharpnessScore: sharpnessObjective(s),
    evaluations,
  };
}
