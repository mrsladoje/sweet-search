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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
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
  pickOverflowVictim,
  crowdingDistances,
} from '../../../core/prompt-optimization/sweep/gepa-pareto.mjs';
import { runReflectiveRewrite, buildReflectivePrompt, generateAdversarialParaphrases, TARE_GENERATOR_ROTATION, runOpWithRetry, buildRetryHint, generateMutations } from '../../../core/prompt-optimization/sweep/gepa-mutate.mjs';
import { augmentSystemForHarness, extractRewrittenPrompt, summariseToolCalls } from '../../../core/prompt-optimization/sweep/op-harness-caller.mjs';
import { findBalancedPair } from '../../../core/prompt-optimization/sweep/gepa-pareto.mjs';
import { loadTrajectory } from '../../../core/prompt-optimization/sweep/p7-persist.mjs';
import { createTokenBucket, RATE_LIMITS } from '../../../core/prompt-optimization/sweep/p7-token-bucket.mjs';
import { JUDGE_PANEL } from '../../../core/prompt-optimization/sweep/gepa-evaluate.mjs';

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
      // taskScore present (a real front member always carries it; M4 TARE gates
      // on the joint Maximin taskScore, not finalScore).
      { id: 'V_S', prompt: 'specialist', finalScore: 0.5, taskScore: 0.55, sharpnessScore: 0.9, score_sonnet: 0.95, score_gpt5_5: 0.5, scores: { p1: 0.9, p2: 0.9 }, detail: {} },
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

  it('buildReflectivePrompt embeds an exact-count TOKEN PRESERVATION CONTRACT per [[token]]', () => {
    // Candidate with KNOWN multiplicities: ss-search × 3, ss-find × 2, ss-grep × 1, no-match × 1
    const candidate =
      'Use [[ss-search]] first. [[ss-search]] is the default. ' +
      'If [[ss-search]] misses, try [[ss-find]] with a regex. ' +
      '[[ss-find]] supports `\\b<symbol>\\b`. Fall back to [[ss-grep]] for literals. ' +
      'Conclude [[no-match]] only after verifying absence.';
    const { systemPrompt } = buildReflectivePrompt({ candidate, failures: [] });
    expect(systemPrompt).toMatch(/TOKEN PRESERVATION CONTRACT/);
    expect(systemPrompt).toContain('[[ss-search]] × 3');
    expect(systemPrompt).toContain('[[ss-find]] × 2');
    expect(systemPrompt).toContain('[[ss-grep]] × 1');
    expect(systemPrompt).toContain('[[no-match]] × 1');
    // The contract must list each [[token]] EXACTLY ONCE inside the contract section.
    const contractSection = systemPrompt.split('TOKEN PRESERVATION CONTRACT')[1];
    expect((contractSection.match(/\[\[ss-search\]\]/g) ?? []).length).toBe(1);
    expect((contractSection.match(/\[\[ss-find\]\]/g) ?? []).length).toBe(1);
  });

  it('buildReflectivePrompt omits the contract block when candidate has no [[tokens]]', () => {
    const { systemPrompt } = buildReflectivePrompt({ candidate: 'plain prose with no tokens', failures: [] });
    expect(systemPrompt).not.toMatch(/TOKEN PRESERVATION CONTRACT/);
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

// ─── B2 — CONFIRM forensic metadata + real JUDGE_PANEL (§7.4 / §D4) ──────────

describe('B2 — CONFIRM event forensic metadata (§7.4/§D4)', () => {
  it('threads usage metadata into CONFIRM and logs the REAL JUDGE_PANEL (not a literal)', async () => {
    const probes = [makeProbe(1, 'multi-file-flow')];
    // A real-shaped evaluator that surfaces the §CC1 `usage` object.
    const evaluateCandidate = async ({ target }) => ({
      score: target === 'sonnet' ? 0.7 : 0.72,
      toolCalls: 4,
      finalAnswerEmitted: true,
      usedReadOrGrep: true,
      trajectory: { toolCalls: [{ name: 'ss-search' }, { name: 'ss-search' }, { name: 'ss-read' }, { name: 'ss-find' }], answer: 'the answer' },
      wallMs: 4112,
      usage: {
        agent: {
          model_id: target === 'sonnet' ? 'claude-sonnet-4-6-x' : 'gpt-5.5-instant',
          api_path: target === 'sonnet' ? 'claude-cli' : 'codex-exec',
          temperature: null,
          input_tokens: 11842, output_tokens: 1893, cache_read_tokens: 4096, retry_count: 0,
        },
        judges: JUDGE_PANEL.map((j) => ({ ...j, input_tokens: 10, output_tokens: 5, retry_count: 0, isError: false })),
        repo_commit: '52904f6',
        probe_hash: '0xc0ffee',
        token_count_prompt: 1820,
      },
    });
    const paths = pathsFor();
    await runGepa({
      runId: 'b2', variants: variants(1), devProbes: probes,
      evaluateCandidate, callModel: mutatingEcho(),
      maxRounds: 1, patience: 99, screenProbeCount: 1, paths, verbose: false,
    });
    const ev = loadTrajectory(paths.trajectory).filter((e) => e._kind === 'confirm');
    expect(ev.length).toBeGreaterThan(0);
    const c = ev[0];
    // full §7.4 field set present
    for (const field of [
      'probe_hash', 'model_id', 'api_path', 'temperature', 'tool_schema_version', 'repo_commit',
      'input_tokens', 'output_tokens', 'cache_read_tokens', 'retry_count', 'wall_ms',
      'token_count_prompt', 'expected_call_window', 'call_deviation_penalty',
      'evidence_adequacy_penalty', 'result_bytes', 'judge_panel',
    ]) {
      expect(c).toHaveProperty(field);
    }
    expect(c.repo_commit).toBe('52904f6');
    expect(c.input_tokens).toBe(11842);
    expect(c.token_count_prompt).toBe(1820);
    expect(c.tool_schema_version).toBe('ss-v3');
    expect(c.expected_call_window).toEqual([3, 6]); // multi-file-flow window
    // judge_panel matches the REAL JUDGE_PANEL constant (not the old literal)
    expect(c.judge_panel).toEqual(JUDGE_PANEL.map((j) => j.model));
    expect(c.judge_panel).toContain('abab6.5s-chat'); // the real MiniMax id, NOT 'minimax-m2.7'
  });

  it('falls back to null forensic fields when the evaluator omits usage (dry-run/stub)', async () => {
    const paths = pathsFor();
    await runGepa({
      runId: 'b2null', variants: variants(1), devProbes: [makeProbe(1)],
      evaluateCandidate: makeDryRunEvaluate(), callModel: mutatingEcho(),
      maxRounds: 1, patience: 99, screenProbeCount: 1, paths, verbose: false,
    });
    const c = loadTrajectory(paths.trajectory).find((e) => e._kind === 'confirm');
    expect(c.model_id).toBeNull();
    expect(c.input_tokens).toBeNull();
    expect(c.repo_commit).toBeNull();
    // panel is ALWAYS the real constant even on a stub run
    expect(c.judge_panel).toEqual(JUDGE_PANEL.map((j) => j.model));
  });
});

// ─── B4 — TARE adversarial paraphrases include ≥1 non-Anthropic (§C2) ────────

describe('B4 — TARE generator family rotation (§C2)', () => {
  it('the K=3 generator set contains ≥1 non-anthropic lineage', () => {
    const lineages = TARE_GENERATOR_ROTATION.slice(0, 3).map((g) => g.lineage);
    expect(lineages.some((l) => l !== 'anthropic-api')).toBe(true);
    // slot 0 is the non-Anthropic generator by construction
    expect(lineages[0]).not.toBe('anthropic-api');
  });

  it('generateAdversarialParaphrases routes ≥1 of K=3 calls through a non-anthropic lineage', async () => {
    const seen = [];
    const callModel = async ({ lineage }) => {
      seen.push(lineage);
      // echo a token-preserving paraphrase
      return { text: 'You are X. Use [[ss-search]] then [[ss-find]] to locate code. Report in [[agent-format]].', isError: false };
    };
    await generateAdversarialParaphrases({ prompt: TOKEN_PROMPT('X'), k: 3, callModel });
    expect(seen.length).toBe(3);
    expect(seen.some((l) => l !== 'anthropic-api')).toBe(true);
  });

  it('the non-anthropic slot falls back to a family-free structural paraphrase on error (not the Sonnet source)', async () => {
    const callModel = async ({ lineage }) => ({ text: '', isError: lineage !== 'anthropic-api' });
    const src = 'Line A with [[ss-search]].\n\nLine B with [[ss-find]].';
    const out = await generateAdversarialParaphrases({ prompt: src, k: 1, callModel });
    expect(out.length).toBe(1);
    // structural paraphrase reorders blocks → differs from the source but keeps tokens
    expect(out[0]).toContain('[[ss-search]]');
    expect(out[0]).toContain('[[ss-find]]');
  });
});

// ─── B1/B3 — kill-9 mid-round recovery: no double-eval + front == fresh ──────

describe('B1/B3 — mid-round kill-9 recovery (§7.4)', () => {
  it('a kill mid-round-3-confirm leaves a stale checkpoint at round 2 and partial round-3 rows', async () => {
    const devProbes = [makeProbe(1), makeProbe(2), makeProbe(3)];
    const dir = mkdtempSync(path.join(tmpdir(), 'p7-kill-'));
    const paths = pathsFor(dir);

    let throwAfter = Infinity;
    let confirmCalls = 0;
    const baseEval = lengthEvaluate();
    const evaluateCandidate = async (args) => {
      // count only confirm-pass calls (full dev × 2) in round 3
      const r = await baseEval(args);
      return r;
    };

    // Run 2 clean rounds first (establishes the round-2 checkpoint).
    await runGepa({
      runId: 'k', variants: variants(3), devProbes,
      evaluateCandidate, callModel: mutatingEcho(),
      maxRounds: 2, patience: 99, screenProbeCount: 2, seed: 7, paths, verbose: false,
    });

    // Resume into round 3 but throw partway through the confirm pass.
    let calls = 0;
    const throwingEval = async (args) => {
      calls += 1;
      if (calls > 8) throw new Error('kill-9 mid round-3 confirm');
      return baseEval(args);
    };
    await expect(runGepa({
      runId: 'k', variants: variants(3), devProbes,
      evaluateCandidate: throwingEval, callModel: mutatingEcho(),
      maxRounds: 3, resume: true, patience: 99, screenProbeCount: 2, seed: 7, paths, verbose: false,
    })).rejects.toThrow(/kill-9/);

    // Checkpoint still says round 2 (round 3 never completed atomically).
    const ckpt = JSON.parse(fs.readFileSync(paths.paretoCurrent, 'utf8'));
    expect(ckpt.lastCompletedRound).toBe(2);
    // But partial round-3 rows ARE on disk (durable JSONL).
    const r3 = loadTrajectory(paths.trajectory).filter((e) => e.round === 3 && (e._kind === 'screen' || e._kind === 'confirm'));
    expect(r3.length).toBeGreaterThan(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it('a kill mid-round-3 then resume reaches the SAME front as a fresh uninterrupted run', async () => {
    const devProbes = [makeProbe(1), makeProbe(2), makeProbe(3)];
    const common = {
      variants: variants(3), devProbes,
      callModel: mutatingEcho(), seed: 13, patience: 99, screenProbeCount: 2, verbose: false,
    };

    const freshDir = mkdtempSync(path.join(tmpdir(), 'p7-kf-'));
    const fresh = await runGepa({ ...common, runId: 'kf', maxRounds: 3, evaluateCandidate: lengthEvaluate(), paths: pathsFor(freshDir) });

    // 2 clean rounds, then resume into 3 and throw partway.
    const dir = mkdtempSync(path.join(tmpdir(), 'p7-ki-'));
    const paths = pathsFor(dir);
    await runGepa({ ...common, runId: 'ki', maxRounds: 2, evaluateCandidate: lengthEvaluate(), paths });
    let calls = 0;
    await expect(runGepa({
      ...common, runId: 'ki', maxRounds: 3, resume: true,
      evaluateCandidate: async (a) => { calls += 1; if (calls > 6) throw new Error('kill'); return lengthEvaluate()(a); },
      paths,
    })).rejects.toThrow(/kill/);

    // Final resume completes round 3. The recovered front MUST match the fresh
    // run's front exactly (correctness preserved through the crash + replay).
    const resumed = await runGepa({ ...common, runId: 'ki', maxRounds: 3, resume: true, evaluateCandidate: lengthEvaluate(), paths });
    const sig = (r) => r.front.map((f) => `${f.hash}:${f.finalScore.toFixed(6)}`).sort();
    expect(sig(resumed)).toEqual(sig(fresh));
    expect(resumed.rounds).toBe(fresh.rounds);

    rmSync(freshDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  // Regression (2026-05-26): seed ablation is ~80% of gen-1 cost. A crash
  // mid-ablation USED to vaporise every completed seed because the original
  // resume guard hard-failed when pareto-current.json was missing, and the
  // seed loop emitted no B1-replayable per-(probe,target) rows. The new
  // contract: SEED rows are persisted after each successful mkCandidate, and
  // `--resume` without a checkpoint re-enters the seed loop with B1 replaying
  // already-paid calls for $0. (Real production crash that motivated this fix:
  // 5/15 seeds completed, ~$35-45 sunk, lost on the 6th candidate's score.)
  it('a kill mid-ablation then resume reaches the SAME front as a fresh run', async () => {
    const devProbes = [makeProbe(1), makeProbe(2), makeProbe(3)];
    const common = {
      variants: variants(4), devProbes,
      callModel: mutatingEcho(), seed: 21, patience: 99, screenProbeCount: 2, verbose: false,
    };

    const freshDir = mkdtempSync(path.join(tmpdir(), 'p7-mab-f-'));
    let freshLiveCalls = 0;
    const fresh = await runGepa({
      ...common, runId: 'mabf', maxRounds: 1,
      evaluateCandidate: async (a) => { freshLiveCalls += 1; return lengthEvaluate()(a); },
      paths: pathsFor(freshDir),
    });

    // Interrupt the SEED ablation: 4 seeds × 3 probes × 2 targets = 24 calls.
    // Throwing after the 13th call lands mid-3rd-seed (seeds 1+2 fully scored,
    // seed 3 partial, seed 4 untouched).
    const dir = mkdtempSync(path.join(tmpdir(), 'p7-mab-i-'));
    const paths = pathsFor(dir);
    let calls = 0;
    await expect(runGepa({
      ...common, runId: 'mab', maxRounds: 1,
      evaluateCandidate: async (a) => { calls += 1; if (calls > 13) throw new Error('kill mid-ablation'); return lengthEvaluate()(a); },
      paths,
    })).rejects.toThrow(/kill mid-ablation/);

    // Exactly 2 seeds' worth of SEED rows on disk (seed 3 threw before its
    // rows were appended; the appendEvent loop runs only AFTER mkCandidate
    // completes for a seed). No pareto-current.json yet (round 1 not done).
    const seedRowsAfterCrash = loadTrajectory(paths.trajectory).filter((e) => e._kind === 'seed');
    const completedSeedHashes = new Set(seedRowsAfterCrash.map((e) => e.mutation_hash));
    expect(completedSeedHashes.size).toBe(2);
    expect(seedRowsAfterCrash.length).toBe(2 * devProbes.length * 2);
    expect(existsSync(paths.paretoCurrent)).toBe(false);

    // Resume — count LIVE eval calls. B1 must replay the 12 cached seed-ablation
    // calls; the remaining 2 seeds (12 calls) run live, AND round 1 still runs
    // live in both fresh and resumed. The invariant is: resumed lives = fresh
    // lives − 12 (the savings = exactly the cached-seed (probe,target) calls).
    let resumedLiveCalls = 0;
    const resumed = await runGepa({
      ...common, runId: 'mab', maxRounds: 1, resume: true,
      evaluateCandidate: async (a) => { resumedLiveCalls += 1; return lengthEvaluate()(a); },
      paths,
    });
    const savings = freshLiveCalls - resumedLiveCalls;
    expect(savings).toBe(2 * devProbes.length * 2); // 12 — exactly 2 cached seeds × 3 probes × 2 targets

    // The recovered front MUST match the fresh front exactly (correctness
    // preserved through the crash + replay).
    const sig = (r) => r.front.map((f) => `${f.hash}:${f.finalScore.toFixed(6)}`).sort();
    expect(sig(resumed)).toEqual(sig(fresh));
    expect(resumed.rounds).toBe(fresh.rounds);

    rmSync(freshDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  // The legacy guard is still required for runs that crashed BEFORE any seed
  // completed (zero replayable rows on disk) — we cannot safely fabricate a
  // partial front, so the original m2/M9 fail-fast applies.
  it('refuses to resume when neither a checkpoint nor any SEED rows exist', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'p7-mab-empty-'));
    const paths = pathsFor(dir);
    // Touch an empty trajectory so the file exists but has no events.
    fs.writeFileSync(paths.trajectory, '');
    await expect(runGepa({
      runId: 'empty', variants: variants(2), devProbes: [makeProbe(1)],
      evaluateCandidate: lengthEvaluate(), callModel: mutatingEcho(),
      maxRounds: 1, resume: true, patience: 99, screenProbeCount: 1, seed: 7, paths, verbose: false,
    })).rejects.toThrow(/no checkpoint .* 0 seed event/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('fsyncSync is actually invoked during a run (durability primitive, §7.4 step 2)', async () => {
    const spy = vi.spyOn(fs, 'fsyncSync');
    const paths = pathsFor();
    await runGepa({
      runId: 'fsync', variants: variants(1), devProbes: [makeProbe(1)],
      evaluateCandidate: makeDryRunEvaluate(), callModel: mutatingEcho(),
      maxRounds: 1, patience: 99, screenProbeCount: 1, paths, verbose: false,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─── M1(a) — PARETO_UPDATE appended AFTER the atomic checkpoint ──────────────

describe('M1(a) — pareto-update ordering vs checkpoint', () => {
  it('the pareto-update event is appended after the round checkpoint (no orphan on crash)', async () => {
    // length-rewarding evaluator → mutation gets ADMITTED → a pareto-update fires
    const paths = pathsFor();
    await runGepa({
      runId: 'm1a', variants: variants(2), devProbes: [makeProbe(1), makeProbe(2)],
      evaluateCandidate: lengthEvaluate(), callModel: mutatingEcho(),
      maxRounds: 1, patience: 99, screenProbeCount: 2, paths, verbose: false,
    });
    const ev = loadTrajectory(paths.trajectory);
    const pu = ev.filter((e) => e._kind === 'pareto-update' && e.round === 1);
    expect(pu.length).toBeGreaterThan(0);
    // The checkpoint reflects the admitted front, and the on-disk pareto-update's
    // front hashes are a subset of the checkpointed front (single source of truth).
    const ckpt = JSON.parse(fs.readFileSync(paths.paretoCurrent, 'utf8'));
    const ckptHashes = new Set(ckpt.front.map((f) => f.hash));
    for (const h of pu[pu.length - 1].front) expect(ckptHashes.has(h)).toBe(true);
  });
});

// ─── M1(b) — deterministic displaced-incumbent selection ─────────────────────

describe('M1(b) — deterministic displaced incumbent', () => {
  it('picks the same displaced incumbent regardless of front array order', () => {
    const A = { id: 'A', finalScore: 0.40, sharpnessScore: 0.9, score_sonnet: 0.6, score_gpt5_5: 0.5, scores: {} };
    const B = { id: 'B', finalScore: 0.30, sharpnessScore: 0.9, score_sonnet: 0.55, score_gpt5_5: 0.5, scores: {} };
    // candidate dominates BOTH and passes the cap against both → ambiguous "first
    // to pass" would be order-dependent; the stable key (lowest finalScore) picks B.
    const candidate = { id: 'C', finalScore: 0.6, sharpnessScore: 1.0, score_sonnet: 0.62, score_gpt5_5: 0.6, scores: {} };
    const r1 = attemptParetoAdmission({ candidate, front: [A, B], frontSize: 6 });
    const r2 = attemptParetoAdmission({ candidate, front: [B, A], frontSize: 6 });
    expect(r1.admitted).toBe(true);
    expect(r2.admitted).toBe(true);
    expect(r1.incumbent).toBe(r2.incumbent);
    expect(r1.incumbent).toBe('B'); // lowest-finalScore dominated incumbent
  });
});

// ─── M4 — TARE sharpness tracks taskScore, ignores EAS/length variation ──────

describe('M4 — TARE sharpness uses joint Maximin (taskScore), not finalScore', () => {
  it('sharpness ignores EAS-factor / length variation across paraphrases', async () => {
    const probes = [makeProbe(1), makeProbe(2)];
    // The candidate WOULD enter the front (front taskScore lower than candidate's).
    const initialFront = [
      { id: 'inc', prompt: 'inc-prompt', finalScore: 0.1, taskScore: 0.2, sharpnessScore: 1.0, score_sonnet: 0.2, score_gpt5_5: 0.2, scores: { p1: 0.2, p2: 0.2 }, detail: {} },
    ];
    // Constant per-target SCORE (→ identical taskScore for every paraphrase) but
    // a callModel whose paraphrases differ wildly in LENGTH (→ different
    // finalScore via length penalty, identical taskScore). If TARE used
    // finalScore, sharpness would be > 0; on taskScore it must be ~0.
    const evaluateCandidate = async () => ({
      score: 0.8, toolCalls: 2, finalAnswerEmitted: true, usedReadOrGrep: true,
      trajectory: { toolCalls: [{ name: 'ss-search' }, { name: 'ss-search' }], answer: 'a' }, wallMs: 1,
    });
    // Paraphrases that preserve tokens but vary length massively.
    let n = 0;
    const callModel = async ({ userPrompt }) => {
      const m = userPrompt.match(/```\n([\s\S]*?)\n```/);
      const body = m ? m[1] : userPrompt;
      n += 1;
      const pad = '\n<!-- ' + 'x'.repeat(n * 400) + ' -->';
      return { text: body + pad, isError: false };
    };
    const paths = pathsFor();
    await runGepa({
      runId: 'm4', variants: [], devProbes: probes, initialFront,
      evaluateCandidate, callModel,
      maxRounds: 1, patience: 99, screenProbeCount: 2, paths, verbose: false,
    });
    const tare = loadTrajectory(paths.trajectory).find((e) => e._kind === 'tare-adversarial');
    expect(tare).toBeDefined();
    // taskScore is constant across all paraphrases → sharpness ≈ 0 despite the
    // length-driven finalScore divergence the old code would have measured.
    expect(tare.sharpness).toBeCloseTo(0, 6);
    expect(tare.sharpness_score).toBeCloseTo(1, 6);
  });
});

// ─── M5 — front-overflow trim keeps a robust lower-finalScore Pareto point ───

describe('M5 — 2-objective-aware overflow trim', () => {
  it('crowdingDistances marks boundary members Infinity', () => {
    const members = [
      { id: 'lowF-hiRobust', finalScore: 0.40, sharpnessScore: 0.99 },
      { id: 'mid', finalScore: 0.50, sharpnessScore: 0.60 },
      { id: 'hiF-loRobust', finalScore: 0.60, sharpnessScore: 0.30 },
    ];
    const d = crowdingDistances(members);
    expect(d.get(members[0])).toBe(Infinity); // boundary on both objectives
    expect(d.get(members[2])).toBe(Infinity);
    expect(d.get(members[1])).toBeLessThan(Infinity); // interior → finite
  });

  it('overflow evicts a dominated member and retains a robust lower-finalScore point', () => {
    const robustLowF = { id: 'robust', finalScore: 0.45, sharpnessScore: 0.99, score_sonnet: 0.6, score_gpt5_5: 0.6, scores: {} };
    const dominated = { id: 'dom', finalScore: 0.50, sharpnessScore: 0.40, score_sonnet: 0.6, score_gpt5_5: 0.6, scores: {} };
    const dominator = { id: 'best', finalScore: 0.80, sharpnessScore: 0.90, score_sonnet: 0.7, score_gpt5_5: 0.7, scores: {} };
    // dominator dominates `dominated` (higher on both objectives). pickOverflowVictim
    // must evict `dominated`, NOT the robust lower-finalScore Pareto point.
    const victim = pickOverflowVictim([robustLowF, dominated, dominator]);
    expect(victim.id).toBe('dom');
  });

  it('attemptParetoAdmission overflow retains the robust lower-finalScore variant', () => {
    // Build a full front of 6 where every member is mutually NON-dominated (each
    // higher-finalScore member is lower-robustness, a proper trade-off front), so
    // the 7th candidate dominates NONE and the front genuinely OVERFLOWS → the
    // 2-objective trim (not lowest-finalScore) must keep the robust boundary point.
    const robust = { id: 'robust', finalScore: 0.40, sharpnessScore: 1.00, score_sonnet: 0.55, score_gpt5_5: 0.55, scores: {} };
    const fillers = Array.from({ length: 5 }, (_, i) => ({
      // finalScore rises, sharpness falls → strictly trade-off, none dominated.
      id: `F${i}`, finalScore: 0.50 + i * 0.05, sharpnessScore: 0.95 - i * 0.10, score_sonnet: 0.6, score_gpt5_5: 0.6, scores: {},
    }));
    const front = [robust, ...fillers];
    // Candidate: an interior trade-off point that beats ≥1 incumbent's finalScore
    // (so it would-enter) but dominates none → front grows to 7 → must trim 1.
    const candidate = { id: 'C', finalScore: 0.62, sharpnessScore: 0.45, score_sonnet: 0.62, score_gpt5_5: 0.6, scores: {} };
    const res = attemptParetoAdmission({ candidate, front, frontSize: 6 });
    expect(res.admitted).toBe(true);
    expect(res.newFront.length).toBe(6);
    const ids = res.newFront.map((f) => f.id);
    expect(ids).toContain('robust'); // the robust boundary point survives the trim
    // A lowest-finalScore trim (the old behaviour) would have evicted `robust`
    // (finalScore 0.40, the minimum); the crowding trim keeps it as a boundary.
  });
});

// ─── m7 — pruner never planned before round 3 ───────────────────────────────

describe('m7 — pruner round-3 guard', () => {
  it('planSlots never returns pruner before round 3 even if the cycle lands on it', () => {
    // round 3's natural slot3 is pruner; rounds 1/2 must NEVER be pruner.
    for (let round = 1; round <= 2; round++) {
      const slots = planSlots({ round, front: [{ id: 'A', scores: { p1: 0.9 } }], probeIds: ['p1'] });
      expect(slots[2].op).not.toBe('pruner');
    }
    expect(planSlots({ round: 3, front: [{ id: 'A', scores: { p1: 0.9 } }], probeIds: ['p1'] })[2].op).toBe('pruner');
  });
});

// ─── m8 — per-target balanced-pair detection ────────────────────────────────

describe('m8 — findBalancedPair detects per-target balanced wins', () => {
  it('finds a probe where one incumbent wins Sonnet and another wins GPT-5.5', () => {
    const sonnetSpecialist = { id: 'S', detail: { p1: { sonnet: { score: 0.9 }, gpt5_5: { score: 0.2 } } } };
    const gptSpecialist = { id: 'G', detail: { p1: { sonnet: { score: 0.3 }, gpt5_5: { score: 0.85 } } } };
    const pair = findBalancedPair({ front: [sonnetSpecialist, gptSpecialist], probeIds: ['p1'] });
    expect(pair).toMatchObject({ probeId: 'p1' });
    expect(pair.sonnetWinner.id).toBe('S');
    expect(pair.gptWinner.id).toBe('G');
  });

  it('returns null when no balanced pair exists', () => {
    const both = { id: 'B', detail: { p1: { sonnet: { score: 0.9 }, gpt5_5: { score: 0.9 } } } };
    expect(findBalancedPair({ front: [both], probeIds: ['p1'] })).toBeNull();
  });
});

// ─── M2 — resume primes the token bucket (anti-429-storm, §7.7) ──────────────

describe('M2 — token-bucket prime on resume (§7.7)', () => {
  it('primeForResume forces ~one WINDOW_MS cooldown on the next acquire (fake clock)', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    // Build the bucket exactly as gepa-cli does for the gpt5_5 target (Tier 2).
    const bucket = createTokenBucket({ rpm: RATE_LIMITS.openai_gpt5_5[2].rpm, itpm: RATE_LIMITS.openai_gpt5_5[2].tpm, now });
    let sleptMs = 0;
    bucket._setSleep(async (ms) => { sleptMs += ms; clock += ms; });

    // A fresh acquire with NO prime would not block.
    bucket.primeForResume(); // M2: gepa-cli/gepa.mjs invoke this on --resume
    await bucket.acquire({ inTokens: 12_000, outTokens: 2_000, target: 'gpt5_5' });

    // The synthetic prime load forced a cooldown of ~one rolling window.
    expect(sleptMs).toBeGreaterThan(0);
    expect(sleptMs).toBeLessThanOrEqual(60_000);
  });
});

// ─── retry-until-success wrapper + harness primitives (2026-05-27) ──────────

describe('runOpWithRetry — per-slot retry until success (§3.2.x)', () => {
  it('returns first successful attempt with attempts=1 + no priorFailures', async () => {
    const callModel = vi.fn(async () => ({ text: '[[ss-search]] [[ss-find]] [[agent-format]] ok-once', isError: false }));
    const opCall = (cm) => runReflectiveRewrite({ candidate: TOKEN_PROMPT('X'), failures: [], callModel: cm });
    const res = await runOpWithRetry(opCall, callModel);
    expect(res.accepted).toBe(true);
    expect(res.attempts).toBe(1);
    expect(res.priorFailures).toEqual([]);
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it('retries on multiplicity-changed and accepts when a later attempt validates', async () => {
    let n = 0;
    const callModel = vi.fn(async () => {
      n += 1;
      if (n < 3) return { text: 'no protected tokens', isError: false };
      return { text: '[[ss-search]] [[ss-find]] [[agent-format]] ok-third', isError: false };
    });
    const opCall = (cm) => runReflectiveRewrite({ candidate: TOKEN_PROMPT('X'), failures: [], callModel: cm });
    const res = await runOpWithRetry(opCall, callModel);
    expect(res.accepted).toBe(true);
    expect(res.attempts).toBe(3);
    expect(res.priorFailures).toHaveLength(2);
    expect(callModel).toHaveBeenCalledTimes(3);
  });

  it('threads a retryHint into the second+ attempt callModel req', async () => {
    const seenReqs = [];
    const callModel = vi.fn(async (req) => {
      seenReqs.push({ retryHint: req.retryHint });
      if (seenReqs.length === 1) return { text: 'broken', isError: false };
      return { text: '[[ss-search]] [[ss-find]] [[agent-format]] ok', isError: false };
    });
    const opCall = (cm) => runReflectiveRewrite({ candidate: TOKEN_PROMPT('X'), failures: [], callModel: cm });
    await runOpWithRetry(opCall, callModel);
    expect(seenReqs[0].retryHint).toBeUndefined();
    expect(seenReqs[1].retryHint).toMatch(/Attempt 2/);
    expect(seenReqs[1].retryHint).toMatch(/missing-token|multiplicity-changed/i);
  });

  it('exhausts maxAttempts and returns the last rejection when all fail', async () => {
    const callModel = vi.fn(async () => ({ text: 'no tokens', isError: false }));
    const opCall = (cm) => runReflectiveRewrite({ candidate: TOKEN_PROMPT('X'), failures: [], callModel: cm });
    const res = await runOpWithRetry(opCall, callModel, { maxAttempts: 3 });
    expect(res.accepted).toBe(false);
    expect(res.attempts).toBe(3);
    expect(res.priorFailures).toHaveLength(3);
    expect(callModel).toHaveBeenCalledTimes(3);
  });

  it('buildRetryHint surfaces specific token failures for the next attempt', () => {
    const rej = { failures: [{ reason: 'multiplicity-changed', token: '[[ss-find]]' }, { reason: 'missing-token', token: '[[ss-grep]]' }] };
    const hint = buildRetryHint(rej, 2);
    expect(hint).toMatch(/Attempt 2/);
    expect(hint).toMatch(/multiplicity-changed/);
    expect(hint).toMatch(/\[\[ss-find\]\]/);
    expect(hint).toMatch(/missing-token/);
    expect(hint).toMatch(/\[\[ss-grep\]\]/);
  });

  it('buildRetryHint handles model-error rejections distinctly', () => {
    const hint = buildRetryHint({ reason: 'model-error', detail: 'HTTP 502' }, 4);
    expect(hint).toMatch(/Attempt 4/);
    expect(hint).toMatch(/model.*error/i);
  });
});

describe('generateMutations integrates retry-loop end-to-end', () => {
  it('a mutation that fails twice then succeeds carries attempts=3 in the result', async () => {
    let n = 0;
    const callModel = async () => {
      n += 1;
      return n < 3
        ? { text: 'no tokens', isError: false }
        : { text: '[[ss-search]] [[ss-find]] [[agent-format]] mut-v' + n, isError: false };
    };
    const front = [{ id: 'P', hash: 'h', prompt: TOKEN_PROMPT('P'), finalScore: 0.5 }];
    const slots = [{ op: 'reflective', kind: 'primary' }];
    const muts = await generateMutations({ slots, parent: front[0], failures: [], probeById: {}, round: 1, callModel, rng: () => 0.5, maxAttemptsPerSlot: 5 });
    expect(muts).toHaveLength(1);
    expect(muts[0].accepted).toBe(true);
    expect(muts[0].attempts).toBe(3);
    expect(muts[0].priorFailures).toHaveLength(2);
  });
});

describe('opencode harness primitives', () => {
  it('augmentSystemForHarness adds tag, repo-paths, and anti-overfit clauses', () => {
    const augmented = augmentSystemForHarness('base operator system prompt');
    expect(augmented).toMatch(/base operator system prompt/);
    expect(augmented).toMatch(/REWRITTEN_PROMPT/);
    expect(augmented).toMatch(/ANTI-OVERFITTING/);
    expect(augmented).toMatch(/HARNESS INVESTIGATION/);
    expect(augmented).toMatch(/p7-dev-probes\.json/);
  });

  it('extractRewrittenPrompt picks the LAST block when multiple present', () => {
    const stream = 'reasoning... <REWRITTEN_PROMPT>draft v1</REWRITTEN_PROMPT> more reasoning <REWRITTEN_PROMPT>final v2 [[ss-search]]</REWRITTEN_PROMPT>';
    const r = extractRewrittenPrompt(stream);
    expect(r.found).toBe(true);
    expect(r.allBlocks).toHaveLength(2);
    expect(r.text).toBe('final v2 [[ss-search]]');
  });

  it('extractRewrittenPrompt returns empty + found=false when no tags', () => {
    const r = extractRewrittenPrompt('just some text without tags');
    expect(r.found).toBe(false);
    expect(r.text).toBe('');
  });

  it('summariseToolCalls counts tool_use events from opencode JSONL stream', () => {
    const stream = [
      JSON.stringify({ type: 'step_start' }),
      JSON.stringify({ type: 'tool_use', part: { tool: 'bash' } }),
      JSON.stringify({ type: 'tool_use', part: { tool: 'bash' } }),
      JSON.stringify({ type: 'tool_use', part: { tool: 'read' } }),
      JSON.stringify({ type: 'step_finish' }),
    ].join('\n');
    const s = summariseToolCalls(stream);
    expect(s.count).toBe(3);
    expect(s.tools.bash).toBe(2);
    expect(s.tools.read).toBe(1);
  });
});
