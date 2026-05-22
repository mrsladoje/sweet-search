/**
 * Unit tests for core/prompt-optimization/sweep/p7-reasoning-homp.mjs
 *
 * Covers:
 *  - pass at exactly 0.7× baseFinalScore (boundary)
 *  - fail when either class is just below 0.7× baseFinalScore
 *  - both-fail case
 *  - overall pass requires both classes to pass
 *  - input validation
 */

import { describe, it, expect, vi } from 'vitest';
import { runReasoningHomp } from '../../../core/prompt-optimization/sweep/p7-reasoning-homp.mjs';
import { DEFAULTS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

const WINNER = 'You are a code-search agent. [[ss-search]]...';
const HELD_OUT = Array.from({ length: 30 }, (_, i) => ({ id: `held-${i}` }));
const BASE_SCORE = 0.80; // GEPA final_score
const THRESHOLD = DEFAULTS.hompPassRatio * BASE_SCORE; // 0.7 * 0.80 = 0.56

describe('runReasoningHomp', () => {
  it('both classes pass when scores are exactly at the 0.7× threshold', async () => {
    const runSonnetThinking = vi.fn(async () => ({ score: THRESHOLD }));
    const runGptReasoning = vi.fn(async () => ({ score: THRESHOLD }));

    const result = await runReasoningHomp({
      winnerPrompt: WINNER,
      heldoutProbes: HELD_OUT,
      runSonnetThinking,
      runGptReasoning,
      baseFinalScore: BASE_SCORE,
    });

    expect(result.sonnetThinking.pass).toBe(true);
    expect(result.gptReasoning.pass).toBe(true);
    expect(result.pass).toBe(true);
  });

  it('sonnet fails when score is just below 0.7× threshold', async () => {
    const justBelow = THRESHOLD - 0.001;
    const runSonnetThinking = vi.fn(async () => ({ score: justBelow }));
    const runGptReasoning = vi.fn(async () => ({ score: THRESHOLD + 0.1 }));

    const result = await runReasoningHomp({
      winnerPrompt: WINNER,
      heldoutProbes: HELD_OUT,
      runSonnetThinking,
      runGptReasoning,
      baseFinalScore: BASE_SCORE,
    });

    expect(result.sonnetThinking.pass).toBe(false);
    expect(result.gptReasoning.pass).toBe(true);
    expect(result.pass).toBe(false);
  });

  it('gpt reasoning fails when score is just below 0.7× threshold', async () => {
    const justBelow = THRESHOLD - 0.001;
    const runSonnetThinking = vi.fn(async () => ({ score: THRESHOLD + 0.1 }));
    const runGptReasoning = vi.fn(async () => ({ score: justBelow }));

    const result = await runReasoningHomp({
      winnerPrompt: WINNER,
      heldoutProbes: HELD_OUT,
      runSonnetThinking,
      runGptReasoning,
      baseFinalScore: BASE_SCORE,
    });

    expect(result.sonnetThinking.pass).toBe(true);
    expect(result.gptReasoning.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it('both fail when both scores are below the threshold', async () => {
    const runSonnetThinking = vi.fn(async () => ({ score: 0 }));
    const runGptReasoning = vi.fn(async () => ({ score: 0 }));

    const result = await runReasoningHomp({
      winnerPrompt: WINNER,
      heldoutProbes: HELD_OUT,
      runSonnetThinking,
      runGptReasoning,
      baseFinalScore: BASE_SCORE,
    });

    expect(result.sonnetThinking.pass).toBe(false);
    expect(result.gptReasoning.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it('returns correct score values in the result', async () => {
    const runSonnetThinking = vi.fn(async () => ({ score: 0.65 }));
    const runGptReasoning = vi.fn(async () => ({ score: 0.72 }));

    const result = await runReasoningHomp({
      winnerPrompt: WINNER,
      heldoutProbes: HELD_OUT,
      runSonnetThinking,
      runGptReasoning,
      baseFinalScore: BASE_SCORE,
    });

    expect(result.sonnetThinking.score).toBeCloseTo(0.65, 5);
    expect(result.gptReasoning.score).toBeCloseTo(0.72, 5);
  });

  it('calls both runners exactly once', async () => {
    const runSonnetThinking = vi.fn(async () => ({ score: 0.9 }));
    const runGptReasoning = vi.fn(async () => ({ score: 0.9 }));

    await runReasoningHomp({
      winnerPrompt: WINNER,
      heldoutProbes: HELD_OUT,
      runSonnetThinking,
      runGptReasoning,
      baseFinalScore: BASE_SCORE,
    });

    expect(runSonnetThinking).toHaveBeenCalledOnce();
    expect(runGptReasoning).toHaveBeenCalledOnce();
  });

  it('passes the winnerPrompt and heldoutProbes to each runner', async () => {
    const runSonnetThinking = vi.fn(async () => ({ score: 0.9 }));
    const runGptReasoning = vi.fn(async () => ({ score: 0.9 }));

    await runReasoningHomp({
      winnerPrompt: WINNER,
      heldoutProbes: HELD_OUT,
      runSonnetThinking,
      runGptReasoning,
      baseFinalScore: BASE_SCORE,
    });

    expect(runSonnetThinking.mock.calls[0][0]).toBe(WINNER);
    expect(runSonnetThinking.mock.calls[0][1]).toBe(HELD_OUT);
    expect(runGptReasoning.mock.calls[0][0]).toBe(WINNER);
    expect(runGptReasoning.mock.calls[0][1]).toBe(HELD_OUT);
  });

  it('uses DEFAULTS.hompPassRatio (0.7) as the multiplier', () => {
    expect(DEFAULTS.hompPassRatio).toBe(0.7);
  });

  it('throws when winnerPrompt is empty', async () => {
    await expect(
      runReasoningHomp({
        winnerPrompt: '',
        heldoutProbes: HELD_OUT,
        runSonnetThinking: async () => ({ score: 0 }),
        runGptReasoning: async () => ({ score: 0 }),
        baseFinalScore: 0.8,
      }),
    ).rejects.toThrow(/winnerPrompt/);
  });

  it('throws when heldoutProbes is empty', async () => {
    await expect(
      runReasoningHomp({
        winnerPrompt: WINNER,
        heldoutProbes: [],
        runSonnetThinking: async () => ({ score: 0 }),
        runGptReasoning: async () => ({ score: 0 }),
        baseFinalScore: 0.8,
      }),
    ).rejects.toThrow(/heldoutProbes/);
  });

  it('throws when baseFinalScore is not finite', async () => {
    await expect(
      runReasoningHomp({
        winnerPrompt: WINNER,
        heldoutProbes: HELD_OUT,
        runSonnetThinking: async () => ({ score: 0 }),
        runGptReasoning: async () => ({ score: 0 }),
        baseFinalScore: NaN,
      }),
    ).rejects.toThrow(/baseFinalScore/);
  });
});
