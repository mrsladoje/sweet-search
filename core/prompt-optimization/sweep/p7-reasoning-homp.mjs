/**
 * Reasoning-mode operational HOMP gate — §3.5.2.
 *
 * After GEPA convergence, the unified winning prompt is replayed under
 * reasoning-on configurations:
 *
 *   Class A (operational): Sonnet 4.6 with extended-thinking ON
 *     (Anthropic API `thinking: { type: 'enabled', budget_tokens: 8000 }`)
 *   Class B (operational): GPT-5.5 reasoning variant (non-instant tier)
 *
 * Pass criterion: each class must score ≥ 0.7 × baseFinalScore on the
 * held-out probes (DEFAULTS.hompPassRatio).
 *
 * The runners (`runSonnetThinking`, `runGptReasoning`) are injected so that
 * this module has no hard network dependency; tests supply stubs.
 *
 * Plan reference: docs/PHASE7.md §3.5.2.
 */

import { DEFAULTS } from './p7-shared.mjs';

/**
 * Run the reasoning-mode operational HOMP gate.
 *
 * @param {object} args
 * @param {string}   args.winnerPrompt          — the unified winning system prompt text
 * @param {object[]} args.heldoutProbes          — the 30 held-out probe records
 * @param {(prompt:string, probes:object[]) => Promise<{score:number}>} args.runSonnetThinking
 *   — runs winner under Sonnet 4.6 extended-thinking ON; returns aggregate score
 * @param {(prompt:string, probes:object[]) => Promise<{score:number}>} args.runGptReasoning
 *   — runs winner under GPT-5.5 reasoning (non-instant); returns aggregate score
 * @param {(rawScore:number, probe:object) => number} [args.scoreFn]
 *   — optional per-result score normaliser; unused by the gate itself but
 *     available for callers that need custom aggregation before passing `score`
 * @param {number}   args.baseFinalScore         — final_score from the GEPA run (Maximin × EAS)
 * @returns {Promise<{
 *   sonnetThinking: { score: number, pass: boolean },
 *   gptReasoning:   { score: number, pass: boolean },
 *   pass: boolean,
 * }>}
 */
export async function runReasoningHomp({
  winnerPrompt,
  heldoutProbes,
  runSonnetThinking,
  runGptReasoning,
  scoreFn,   // part of the documented signature; callers may aggregate with it before passing score (not used by the gate itself)
  baseFinalScore,
}) {
  if (typeof winnerPrompt !== 'string' || winnerPrompt.length === 0) {
    throw new TypeError('runReasoningHomp: winnerPrompt must be a non-empty string');
  }
  if (!Array.isArray(heldoutProbes) || heldoutProbes.length === 0) {
    throw new TypeError('runReasoningHomp: heldoutProbes must be a non-empty array');
  }
  if (typeof runSonnetThinking !== 'function') {
    throw new TypeError('runReasoningHomp: runSonnetThinking must be a function');
  }
  if (typeof runGptReasoning !== 'function') {
    throw new TypeError('runReasoningHomp: runGptReasoning must be a function');
  }
  if (typeof baseFinalScore !== 'number' || !Number.isFinite(baseFinalScore)) {
    throw new TypeError('runReasoningHomp: baseFinalScore must be a finite number');
  }

  const threshold = DEFAULTS.hompPassRatio * baseFinalScore;

  const [sonnetResult, gptResult] = await Promise.all([
    runSonnetThinking(winnerPrompt, heldoutProbes),
    runGptReasoning(winnerPrompt, heldoutProbes),
  ]);

  const sonnetScore = sonnetResult.score;
  const gptScore = gptResult.score;

  const sonnetPass = sonnetScore >= threshold;
  const gptPass = gptScore >= threshold;

  return {
    sonnetThinking: { score: sonnetScore, pass: sonnetPass },
    gptReasoning: { score: gptScore, pass: gptPass },
    pass: sonnetPass && gptPass,
  };
}
