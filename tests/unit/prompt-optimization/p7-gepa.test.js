/**
 * Unit tests for the GEPA loop driver (core/prompt-optimization/sweep/gepa.mjs
 * + gepa-scoring.mjs + gepa-pareto.mjs + gepa-mutate.mjs).
 *
 * Everything is STUBBED — a deterministic `evaluateCandidate` + `callModel`,
 * with persistence pointed at a tmp dir. NO network, NO real agents (no API
 * keys yet — see docs/PHASE7.md). Covers:
 *   - per-probe Maximin → finalScore integration (§3.7.1)
 *   - Pareto admission 0.15 cap rejection + pareto-rejection event (§3.7.1 step 9)
 *   - slot composition + OP-3/4/5 rotation (§3.2)
 *   - mutation-rejection logging on token-validation failure (§3.2.1)
 *   - persistence round-trip + --resume == fresh-run Pareto state (§7.4)
 *   - round-11 rotation triggers rebaselineFront (§3.1)
 *   - patience/plateau stop logic (§3.1)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runGepa, roundRng, makeDryRunEvaluate, makeDryRunCallModel } from '../../../core/prompt-optimization/sweep/gepa.mjs';
import {
  scoreCandidateOnProbes,
  computeFinalScoreFor,
  computeProbeWeights,
  topFailures,
  buildCandidate,
} from '../../../core/prompt-optimization/sweep/gepa-scoring.mjs';
import {
  attemptParetoAdmission,
  planSlots,
  slot3Op,
  findCrossoverPair,
  selectParent,
  plateauBreakthrough,
} from '../../../core/prompt-optimization/sweep/gepa-pareto.mjs';
import { runReflectiveRewrite, buildReflectivePrompt } from '../../../core/prompt-optimization/sweep/gepa-mutate.mjs';
import { loadTrajectory } from '../../../core/prompt-optimization/sweep/p7-persist.mjs';

// ─── fixtures ────────────────────────────────────────────────────────────────

let tmp;
beforeEach(() => { tmp = mkdtempSync(path.join(tmpdir(), 'p7-gepa-')); });
afterEach(() => { if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

function pathsFor(dir = tmp) {
  return {
    trajectory: path.join(dir, 'gepa-trajectory.jsonl'),
    promptBank: path.join(dir, 'prompt-bank.jsonl'),
    paretoCurrent: path.join(dir, 'pareto-current.json'),
  };
}

function makeProbe(i, stratum = 'literal-lookup') {
  return {
    id: `p${i}`,
    repo: 'demo',
    language: 'js',
    stratum,
    difficulty: 'easy',
    query: `find thing ${i}`,
    expectedFiles: [`f${i}.js`],
    expectedSymbols: [`sym${i}`],
    expectedFacts: [`fact ${i}`],
    expectedNoMatch: false,
    max_turns: 3,
  };
}

const TOKEN_PROMPT = (id) =>
  `You are variant ${id}. Use [[ss-search]] then [[ss-find]] to locate code. Report in [[agent-format]].`;

function variants(n = 2) {
  return Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, prompt: TOKEN_PROMPT(`T${i + 1}`) }));
}

/** Echo callModel that preserves [[tokens]] but yields a DISTINCT, deterministic
 *  mutation each time (appends a content-derived comment). */
function mutatingEcho() {
  return async ({ userPrompt }) => {
    const m = userPrompt.match(/```\n([\s\S]*?)\n```/);
    const body = m ? m[1] : userPrompt;
    let h = 0;
    for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) >>> 0;
    return { text: `${body}\n<!-- v:${h.toString(16).slice(0, 6)} -->`, isError: false };
  };
}

/** Length-rewarding evaluator → mutations (which grow the prompt) get admitted,
 *  so the Pareto front genuinely evolves across rounds (resume test). */
function lengthEvaluate() {
  return async ({ promptText }) => ({
    score: Math.min(0.95, 0.3 + promptText.length / 2000),
    toolCalls: 2,
    finalAnswerEmitted: true,
    usedReadOrGrep: true,
    trajectory: { toolCalls: [{ name: 'ss-search' }, { name: 'ss-search' }], answer: 'a' },
    wallMs: 1,
  });
}

/** Constant-score evaluator → flat convergence (patience test). */
function constantEvaluate(score = 0.5) {
  return async () => ({
    score,
    toolCalls: 2,
    finalAnswerEmitted: true,
    usedReadOrGrep: true,
    trajectory: { toolCalls: [{ name: 'ss-search' }, { name: 'ss-search' }], answer: 'x' },
    wallMs: 1,
  });
}

// ─── 1. per-probe Maximin → finalScore integration ──────────────────────────

describe('joint scoring integration (§3.7.1)', () => {
  it('per-probe Maximin → weighted taskScore → finalScore', async () => {
    const probes = [makeProbe(1), makeProbe(2)];
    // Fixed per (probe,target) scores so the math is hand-verifiable.
    const table = {
      'p1|sonnet': 0.6, 'p1|gpt5_5': 0.9, // maximin p1 = 0.6
      'p2|sonnet': 0.8, 'p2|gpt5_5': 0.4, // maximin p2 = 0.4
    };
    const evaluateCandidate = async ({ probe, target }) => ({
      score: table[`${probe.id}|${target}`],
      toolCalls: 2, // within literal-lookup [1,3] → ef=1
      finalAnswerEmitted: true,
      usedReadOrGrep: true,
      trajectory: { toolCalls: [{ name: 'ss-search' }, { name: 'ss-find' }], answer: 'a' },
      wallMs: 1,
    });

    const scored = await scoreCandidateOnProbes({ candidate: { prompt: 'x' }, probes, evaluateCandidate });
    expect(scored.perProbeMaximin).toEqual([0.6, 0.4]);
    expect(scored.score_sonnet).toBeCloseTo(0.7, 10); // mean(0.6,0.8)
    expect(scored.score_gpt5_5).toBeCloseTo(0.65, 10); // mean(0.9,0.4)

    const fs = computeFinalScoreFor({
      perProbeMaximin: scored.perProbeMaximin,
      weights: [1, 1],
      runsByTarget: scored.runsByTarget,
      tokenCount: 1000,
    });
    expect(fs.taskScore).toBeCloseTo(0.5, 10); // mean(0.6,0.4)
    expect(fs.efficiencyFactor).toBeCloseTo(1, 10); // calls in window, evidence ok
    expect(fs.lengthPenalty).toBeCloseTo(0.05, 10); // 0.05 × 1000/1000
    expect(fs.finalScore).toBeCloseTo(0.5 * 1 - 0.05, 10);
  });

  it('hard-negative weights are uniform before round 5, variance-driven after', () => {
    const front = [
      { scores: { p1: 0.9, p2: 0.9 } },
      { scores: { p1: 0.9, p2: 0.1 } }, // p2 variance 0.16, p1 zero variance
    ];
    const before = computeProbeWeights({ front, probeIds: ['p1', 'p2'], round: 4, roundsEvaluatedByProbe: { p1: 9, p2: 9 } });
    expect(before).toEqual([1, 1]);

    const after = computeProbeWeights({ front, probeIds: ['p1', 'p2'], round: 6, roundsEvaluatedByProbe: { p1: 9, p2: 9 } });
    // p1 variance 0 → max(0,0.05)=0.05 → clipped to floor 0.1; p2 variance 0.16 → 0.16
    expect(after[0]).toBeCloseTo(0.1, 10);
    expect(after[1]).toBeCloseTo(0.16, 10);
    expect(after[1]).toBeGreaterThan(after[0]);
  });
});

// ─── 2. Pareto admission 0.15 cap ───────────────────────────────────────────

describe('Pareto admission 0.15 cap (§3.7.1 step 9)', () => {
  it('rejects a candidate that drops one target > 0.15 vs the displaced specialist', () => {
    const front = [
      { id: 'V_S', finalScore: 0.5, sharpnessScore: 0.9, score_sonnet: 0.95, score_gpt5_5: 0.5, scores: {} },
    ];
    const candidate = { id: 'V_C', finalScore: 0.78, sharpnessScore: 1.0, score_sonnet: 0.78, score_gpt5_5: 0.85, scores: {} };
    const res = attemptParetoAdmission({ candidate, front });
    expect(res.admitted).toBe(false);
    expect(res.reason).toBe('0.15-cap-violation');
    expect(res.target_degraded).toContain('sonnet');
    expect(res.incumbent).toBe('V_S');
    expect(res.drop).toBeGreaterThan(0.15);
  });

  it('admits the genuine joint-improver against a specialist front (worked example)', () => {
    const front = [
      { id: 'V_S', finalScore: 0.5, sharpnessScore: 1.0, score_sonnet: 0.91, score_gpt5_5: 0.5, scores: {} },
      { id: 'V_G', finalScore: 0.5, sharpnessScore: 1.0, score_sonnet: 0.5, score_gpt5_5: 0.91, scores: {} },
    ];
    const candidate = { id: 'V_C', finalScore: 0.75, sharpnessScore: 1.0, score_sonnet: 0.75, score_gpt5_5: 0.85, scores: {} };
    const res = attemptParetoAdmission({ candidate, front });
    expect(res.admitted).toBe(true);
    expect(res.newFront.map((f) => f.id)).toContain('V_C');
  });

  it('the driver logs a pareto-rejection event when the cap is violated', async () => {
    const probes = [makeProbe(1), makeProbe(2)];
    const initialFront = [
      { id: 'V_S', prompt: 'specialist', finalScore: 0.5, sharpnessScore: 0.9, score_sonnet: 0.95, score_gpt5_5: 0.5, scores: { p1: 0.9, p2: 0.9 }, detail: {} },
    ];
    // Mutations score 0.78 sonnet / 0.85 gpt → dominates V_S but drops sonnet 0.17.
    const evaluateCandidate = async ({ target }) => ({
      score: target === 'sonnet' ? 0.78 : 0.85,
      toolCalls: 2,
      finalAnswerEmitted: true,
      usedReadOrGrep: true,
      trajectory: { toolCalls: [{ name: 'ss-search' }], answer: 'a' },
      wallMs: 1,
    });
    const paths = pathsFor();
    await runGepa({
      runId: 'rej', variants: [], devProbes: probes, initialFront,
      evaluateCandidate, callModel: makeDryRunCallModel(),
      maxRounds: 1, patience: 99, screenProbeCount: 2, paths, verbose: false,
    });
    const ev = loadTrajectory(paths.trajectory);
    const rej = ev.filter((e) => e._kind === 'pareto-rejection');
    expect(rej.length).toBeGreaterThan(0);
    expect(rej[0].reason).toBe('0.15-cap-violation');
  });
});

// ─── 3. slot composition + OP rotation ──────────────────────────────────────

describe('slot composition + OP-3/4/5 rotation (§3.2)', () => {
  it('slot3Op cycles persona-pivot → tool-mask → pruner and resets at rotation', () => {
    expect(slot3Op(1)).toBe('persona-pivot');
    expect(slot3Op(2)).toBe('tool-mask');
    expect(slot3Op(3)).toBe('pruner');
    expect(slot3Op(4)).toBe('persona-pivot');
    // reset at rotationRound = 11
    expect(slot3Op(11, 11)).toBe('persona-pivot');
    expect(slot3Op(12, 11)).toBe('tool-mask');
    expect(slot3Op(13, 11)).toBe('pruner');
  });

  it('slot1 is always reflective; slot2 falls back to reflective without a crossover pair', () => {
    const front = [{ id: 'A', scores: { p1: 0.9 } }]; // no loser → no pair
    const slots = planSlots({ round: 1, front, probeIds: ['p1'] });
    expect(slots[0].op).toBe('reflective');
    expect(slots[1].op).toBe('reflective');
    expect(slots[2].op).toBe('persona-pivot');
  });

  it('slot2 becomes trajectory-crossover when an A-wins/B-fails pair exists', () => {
    const front = [
      { id: 'A', scores: { p1: 0.9 } }, // wins
      { id: 'B', scores: { p1: 0.3 } }, // fails
    ];
    expect(findCrossoverPair({ front, probeIds: ['p1'] })).toMatchObject({ probeId: 'p1' });
    const slots = planSlots({ round: 2, front, probeIds: ['p1'] });
    expect(slots[1].op).toBe('trajectory-crossover');
    expect(slots[2].op).toBe('tool-mask'); // round 2 slot3
  });

  it('selectParent is deterministic for a fixed rng', () => {
    const front = [
      { id: 'A', finalScore: 0.2 },
      { id: 'B', finalScore: 0.8 },
    ];
    const r1 = selectParent({ front, rng: roundRng(42, 1) });
    const r2 = selectParent({ front, rng: roundRng(42, 1) });
    expect(r1.id).toBe(r2.id);
  });
});

// ─── 4. mutation-rejection logging ──────────────────────────────────────────

describe('mutation-rejection logging (§3.2.1)', () => {
  it('runReflectiveRewrite rejects when a [[token]] is dropped', async () => {
    const callModel = async () => ({ text: 'rewrite with no protected tokens at all', isError: false });
    const res = await runReflectiveRewrite({ candidate: TOKEN_PROMPT('X'), failures: [], callModel });
    expect(res.accepted).toBe(false);
    expect(res.rejection.failures.some((f) => f.reason === 'missing-token')).toBe(true);
  });

  it('the driver logs a mutation-rejection event for token-corrupting mutations', async () => {
    const callModel = async () => ({ text: 'no tokens here', isError: false }); // drops [[ss-search]] etc.
    const paths = pathsFor();
    await runGepa({
      runId: 'mr', variants: variants(2), devProbes: [makeProbe(1), makeProbe(2)],
      evaluateCandidate: makeDryRunEvaluate(), callModel,
      maxRounds: 1, patience: 99, screenProbeCount: 2, paths, verbose: false,
    });
    const ev = loadTrajectory(paths.trajectory);
    const rej = ev.filter((e) => e._kind === 'mutation-rejection');
    expect(rej.length).toBeGreaterThan(0);
    expect(rej.some((r) => String(r.reason).includes('missing-token'))).toBe(true);
  });

  it('buildReflectivePrompt embeds failure traces + protected-token rule', () => {
    const { systemPrompt, userPrompt } = buildReflectivePrompt({
      candidate: 'C', failures: [{ probeId: 'p9', stratum: 'behavioral', jointScore: 0.1, query: 'q', toolCalls: [], answer: 'a', expectedFiles: ['x.js'] }],
    });
    expect(systemPrompt).toMatch(/PROTECTED/);
    expect(userPrompt).toMatch(/p9/);
  });
});

// ─── 5. persistence + resume == fresh ───────────────────────────────────────

describe('persistence + resume (§7.4)', () => {
  it('a resumed run reaches the same Pareto front as a fresh run', async () => {
    const devProbes = [makeProbe(1), makeProbe(2), makeProbe(3)];
    const common = {
      variants: variants(3),
      devProbes,
      evaluateCandidate: lengthEvaluate(), // front genuinely evolves → non-trivial resume
      callModel: mutatingEcho(),
      seed: 42,
      patience: 99, // never stop early
      screenProbeCount: 2,
      verbose: false,
    };

    const freshDir = mkdtempSync(path.join(tmpdir(), 'p7-fresh-'));
    const fresh = await runGepa({ ...common, runId: 'fresh', maxRounds: 4, paths: pathsFor(freshDir) });

    // partial: run 2 rounds, then resume to round 4 in the same dir
    const resumeDir = mkdtempSync(path.join(tmpdir(), 'p7-res-'));
    await runGepa({ ...common, runId: 'res', maxRounds: 2, paths: pathsFor(resumeDir) });
    const resumed = await runGepa({ ...common, runId: 'res', maxRounds: 4, resume: true, paths: pathsFor(resumeDir) });

    const sig = (r) => r.front.map((f) => `${f.hash}:${f.finalScore.toFixed(6)}`).sort();
    expect(fresh.front.length).toBeGreaterThan(1); // the front actually evolved
    expect(sig(resumed)).toEqual(sig(fresh));
    expect(resumed.rounds).toBe(fresh.rounds);
    expect(resumed.convergence.map((x) => x.toFixed(6))).toEqual(fresh.convergence.map((x) => x.toFixed(6)));

    rmSync(freshDir, { recursive: true, force: true });
    rmSync(resumeDir, { recursive: true, force: true });
  });

  it('writes mutation/screen/confirm/pareto events to the trajectory', async () => {
    const paths = pathsFor();
    await runGepa({
      runId: 'persist', variants: variants(2), devProbes: [makeProbe(1), makeProbe(2)],
      evaluateCandidate: makeDryRunEvaluate(), callModel: mutatingEcho(),
      maxRounds: 1, patience: 99, screenProbeCount: 2, paths, verbose: false,
    });
    const kinds = new Set(loadTrajectory(paths.trajectory).map((e) => e._kind));
    expect(kinds.has('mutation')).toBe(true);
    expect(kinds.has('screen')).toBe(true);
    expect(kinds.has('confirm')).toBe(true);
    // prompt bank populated
    const bank = loadTrajectory(paths.promptBank);
    expect(bank.length).toBeGreaterThan(0);
    expect(bank.every((b) => b._kind === 'prompt' && b.hash && typeof b.text === 'string')).toBe(true);
  });
});

// ─── 6. round-11 rotation triggers rebaselineFront ──────────────────────────

describe('mid-run rotation + re-baseline (§3.1)', () => {
  it('rotation re-baselines the front on new probes BEFORE scoring mutations', async () => {
    const devProbes = [makeProbe(1), makeProbe(2), makeProbe(3)];
    const rotationPool = [makeProbe(10), makeProbe(11)];
    const paths = pathsFor();
    const result = await runGepa({
      runId: 'rot', variants: variants(2), devProbes, rotationPool,
      evaluateCandidate: makeDryRunEvaluate(), callModel: mutatingEcho(),
      maxRounds: 2, rotationRound: 2, rotationSwapCount: 1,
      patience: 99, screenProbeCount: 2, paths, verbose: false,
    });
    const reb = loadTrajectory(paths.trajectory).filter((e) => e._kind === 'pareto-rebaseline');
    expect(reb.length).toBe(1);
    expect(reb[0].round).toBe(2);
    // a new probe id rotated in, an old one retired
    expect(result.probeSetIds).toContain('p10');
    expect(result.probeSetIds.length).toBe(3);
    // every incumbent now carries a score for the new probe (proof rebaselineFront ran)
    expect(result.front.every((inc) => 'p10' in inc.scores)).toBe(true);
  });
});

// ─── 7. patience / plateau stop ─────────────────────────────────────────────

describe('patience / plateau-breakthrough (§3.1)', () => {
  it('stops on flat convergence once patience is exhausted', async () => {
    const paths = pathsFor();
    const result = await runGepa({
      runId: 'pat', variants: variants(2), devProbes: [makeProbe(1), makeProbe(2)],
      evaluateCandidate: constantEvaluate(0.5), callModel: mutatingEcho(),
      maxRounds: 10, patience: 2, screenProbeCount: 2, paths, verbose: false,
    });
    expect(result.stoppedReason).toBe('patience');
    expect(result.rounds).toBeLessThan(10);
  });

  it('plateauBreakthrough detects a >=3pp step-change in the last 8 rounds', () => {
    expect(plateauBreakthrough([0.5, 0.5, 0.5, 0.54, 0.54])).toBe(true); // +0.04 step
    expect(plateauBreakthrough([0.5, 0.5, 0.51, 0.51, 0.515])).toBe(false); // all < 0.03
  });
});

// ─── buildCandidate smoke (ties scoring → candidate object) ──────────────────

describe('buildCandidate', () => {
  it('produces a fully-scored candidate with hash, scores, and finalScore', async () => {
    const probes = [makeProbe(1), makeProbe(2)];
    const cand = await buildCandidate({
      id: 'C1', prompt: TOKEN_PROMPT('C1'), sourceOp: 'seed', parentHash: null,
      probes, weights: [1, 1], evaluateCandidate: makeDryRunEvaluate(),
    });
    expect(cand.hash).toMatch(/^0x[0-9a-f]{16}$/);
    expect(Object.keys(cand.scores)).toEqual(['p1', 'p2']);
    expect(typeof cand.finalScore).toBe('number');
    expect(cand.sharpnessScore).toBe(1.0);
    expect(topFailures({ candidate: cand, probes }).length).toBeGreaterThanOrEqual(0);
  });
});
