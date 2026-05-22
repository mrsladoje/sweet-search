/**
 * Unit tests for core/prompt-optimization/sweep/p7-reflect.mjs
 *
 * Covers:
 *  - buildReflectionPackage: output shape, top-3 failure slicing
 *  - REFLECTION_SYSTEM_PROMPT: constant present and contains key phrases
 *  - runReflection: calls callModel with google-api lineage + correct model
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildReflectionPackage,
  runReflection,
  REFLECTION_SYSTEM_PROMPT,
} from '../../../core/prompt-optimization/sweep/p7-reflect.mjs';

// ─── fixtures ────────────────────────────────────────────────────────────

const makeSurvivor = (overrides = {}) => ({
  promptText: 'You are a code search agent...',
  scores: {
    perProbe: [0.8, 0.6, 0.4],
    perTarget: { sonnet: 0.7, gpt5_5: 0.65 },
  },
  lineage: { operator: 'reflective', parentId: 'v3' },
  ...overrides,
});

const makeFailures = (n) =>
  Array.from({ length: n }, (_, i) => ({
    probeId: `probe-${i}`,
    stratum: 'multi-file-flow',
    repo: 'my-repo',
    tool: 'ss-search',
    trajectoryExcerpt: `Agent called wrong tool on probe ${i}`,
    jointScore: 0.2,
  }));

const makeConvergence = (rounds = 5) => ({
  jointBestPerRound: Array.from({ length: rounds }, (_, i) => 0.5 + i * 0.05),
});

// ─── buildReflectionPackage ───────────────────────────────────────────────

describe('buildReflectionPackage', () => {
  it('returns an object with all required top-level keys', () => {
    const pkg = buildReflectionPackage({
      round: 3,
      survivor: makeSurvivor(),
      failures: makeFailures(5),
      paretoFront: [{ variantId: 'v1', scores: { sonnet: 0.8 } }],
      convergence: makeConvergence(3),
    });
    expect(pkg).toHaveProperty('round', 3);
    expect(pkg).toHaveProperty('survivor');
    expect(pkg).toHaveProperty('topFailureClusters');
    expect(pkg).toHaveProperty('paretoSummary');
    expect(pkg).toHaveProperty('convergenceTrajectory');
  });

  it('survivor carries promptText, lineage, and per-probe/per-target scores', () => {
    const survivor = makeSurvivor();
    const pkg = buildReflectionPackage({
      round: 1,
      survivor,
      failures: [],
      paretoFront: [],
      convergence: makeConvergence(1),
    });
    expect(pkg.survivor.promptText).toBe(survivor.promptText);
    expect(pkg.survivor.lineage).toEqual(survivor.lineage);
    expect(pkg.survivor.perProbeScores).toEqual(survivor.scores.perProbe);
    expect(pkg.survivor.perTargetScores).toEqual(survivor.scores.perTarget);
  });

  it('topFailureClusters is capped at 3 even when more failures are provided', () => {
    const pkg = buildReflectionPackage({
      round: 2,
      survivor: makeSurvivor(),
      failures: makeFailures(10),
      paretoFront: [],
      convergence: makeConvergence(2),
    });
    expect(pkg.topFailureClusters).toHaveLength(3);
  });

  it('topFailureClusters is empty array when no failures', () => {
    const pkg = buildReflectionPackage({
      round: 1,
      survivor: makeSurvivor(),
      failures: [],
      paretoFront: [],
      convergence: makeConvergence(1),
    });
    expect(pkg.topFailureClusters).toHaveLength(0);
  });

  it('paretoSummary maps variantId and scores from front entries', () => {
    const paretoFront = [
      { variantId: 'v1', scores: { sonnet: 0.8 } },
      { variantId: 'v2', scores: { sonnet: 0.75 } },
    ];
    const pkg = buildReflectionPackage({
      round: 5,
      survivor: makeSurvivor(),
      failures: [],
      paretoFront,
      convergence: makeConvergence(5),
    });
    expect(pkg.paretoSummary).toHaveLength(2);
    expect(pkg.paretoSummary[0].variantId).toBe('v1');
  });

  it('convergenceTrajectory.last5Rounds contains at most 5 rounds', () => {
    const pkg = buildReflectionPackage({
      round: 10,
      survivor: makeSurvivor(),
      failures: [],
      paretoFront: [],
      convergence: makeConvergence(10),
    });
    expect(pkg.convergenceTrajectory.last5Rounds).toHaveLength(5);
  });

  it('convergenceTrajectory.totalRoundsRecorded reflects full history', () => {
    const pkg = buildReflectionPackage({
      round: 7,
      survivor: makeSurvivor(),
      failures: [],
      paretoFront: [],
      convergence: makeConvergence(7),
    });
    expect(pkg.convergenceTrajectory.totalRoundsRecorded).toBe(7);
  });

  it('throws when round is not a positive integer', () => {
    expect(() =>
      buildReflectionPackage({
        round: 0,
        survivor: makeSurvivor(),
        failures: [],
        paretoFront: [],
        convergence: makeConvergence(1),
      }),
    ).toThrow(/round must be a positive integer/);
  });
});

// ─── REFLECTION_SYSTEM_PROMPT ─────────────────────────────────────────────

describe('REFLECTION_SYSTEM_PROMPT', () => {
  it('is a non-empty string constant', () => {
    expect(typeof REFLECTION_SYSTEM_PROMPT).toBe('string');
    expect(REFLECTION_SYSTEM_PROMPT.length).toBeGreaterThan(50);
  });

  it('mentions senior IR researcher and GEPA', () => {
    expect(REFLECTION_SYSTEM_PROMPT).toMatch(/senior IR researcher/i);
    expect(REFLECTION_SYSTEM_PROMPT).toMatch(/GEPA/);
  });

  it('asks for failure clusters and structural insight', () => {
    expect(REFLECTION_SYSTEM_PROMPT).toMatch(/failure cluster/i);
    expect(REFLECTION_SYSTEM_PROMPT).toMatch(/structural insight/i);
  });

  it('asks for plateau/breakthrough signal assessment', () => {
    expect(REFLECTION_SYSTEM_PROMPT).toMatch(/plateau/i);
  });
});

// ─── runReflection ────────────────────────────────────────────────────────

describe('runReflection', () => {
  it('calls callModel with lineage=google-api and the default model', async () => {
    const callModel = vi.fn(async () => ({ text: 'reflection report text' }));
    const pkg = buildReflectionPackage({
      round: 1,
      survivor: makeSurvivor(),
      failures: makeFailures(2),
      paretoFront: [],
      convergence: makeConvergence(1),
    });

    await runReflection({ pkg, callModel });

    expect(callModel).toHaveBeenCalledOnce();
    const opts = callModel.mock.calls[0][0];
    expect(opts.lineage).toBe('google-api');
    expect(opts.model).toBe('gemini-3.1-pro-preview');
  });

  it('uses the REFLECTION_SYSTEM_PROMPT as systemPrompt', async () => {
    const callModel = vi.fn(async () => ({ text: 'report' }));
    const pkg = buildReflectionPackage({
      round: 2,
      survivor: makeSurvivor(),
      failures: [],
      paretoFront: [],
      convergence: makeConvergence(2),
    });

    await runReflection({ pkg, callModel });

    const opts = callModel.mock.calls[0][0];
    expect(opts.systemPrompt).toBe(REFLECTION_SYSTEM_PROMPT);
  });

  it('respects a custom model override', async () => {
    const callModel = vi.fn(async () => ({ text: 'report' }));
    const pkg = buildReflectionPackage({
      round: 3,
      survivor: makeSurvivor(),
      failures: [],
      paretoFront: [],
      convergence: makeConvergence(3),
    });

    await runReflection({ pkg, callModel, model: 'gemini-3.1-ultra' });

    const opts = callModel.mock.calls[0][0];
    expect(opts.model).toBe('gemini-3.1-ultra');
  });

  it('returns {report} with the model text', async () => {
    const callModel = vi.fn(async () => ({ text: 'Top 3 failures: ...' }));
    const pkg = buildReflectionPackage({
      round: 4,
      survivor: makeSurvivor(),
      failures: makeFailures(3),
      paretoFront: [],
      convergence: makeConvergence(4),
    });

    const result = await runReflection({ pkg, callModel });
    expect(result).toHaveProperty('report', 'Top 3 failures: ...');
  });

  it('handles callModel returning {content} instead of {text}', async () => {
    const callModel = vi.fn(async () => ({ content: 'content-style report' }));
    const pkg = buildReflectionPackage({
      round: 1,
      survivor: makeSurvivor(),
      failures: [],
      paretoFront: [],
      convergence: makeConvergence(1),
    });

    const result = await runReflection({ pkg, callModel });
    expect(result.report).toBe('content-style report');
  });

  it('throws when callModel is not a function', async () => {
    const pkg = buildReflectionPackage({
      round: 1,
      survivor: makeSurvivor(),
      failures: [],
      paretoFront: [],
      convergence: makeConvergence(1),
    });

    await expect(runReflection({ pkg, callModel: null })).rejects.toThrow(/callModel/);
  });

  it('throws when pkg is not an object', async () => {
    await expect(
      runReflection({ pkg: null, callModel: async () => ({ text: '' }) }),
    ).rejects.toThrow(/pkg/);
  });
});
