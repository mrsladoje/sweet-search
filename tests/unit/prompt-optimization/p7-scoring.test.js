/**
 * Spec-conformance regression tests for gepa-scoring.mjs (PHASE7 §3.1, §3.7.1).
 *
 * Asserts the SPEC behavior introduced by M3 + CC1 + B6 propagation:
 *   - M3 — scoreCandidateOnProbes acquires the bucket with the static estimate
 *          (inTokens = estimateTokens(prompt) + estimateTokens(query); a fixed
 *          output estimate) AND reconciles to the real
 *          r.usage.agent.{input_tokens,output_tokens} per (probe,target).
 *   - M3 backward-compat — a stub returning NO usage → reconcile NOT called, no
 *          throw, detail[pid][target].usage === null.
 *   - CC1 — detail[pid][target].usage carries the threaded usage object.
 *   - B6 — an evaluateCandidate that throws AllJudgesFailedError PROPAGATES
 *          through scoreCandidateOnProbes (never swallowed to 0).
 *   - The maximin / score_sonnet / score_gpt5_5 outputs stay correct.
 *
 * NO network: a stub evaluateCandidate + a fake bucket are injected.
 */

import { describe, expect, it } from 'vitest';

import {
  agentTokenCount,
  computeFinalScoreFor,
  scoreCandidateOnProbes,
  toProbeRun,
} from '../../../core/prompt-optimization/sweep/gepa-scoring.mjs';
import { AllJudgesFailedError } from '../../../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { estimateTokens } from '../../../core/prompt-optimization/sweep/variant-loader.mjs';

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeProbe(i) {
  return {
    id: `p${i}`,
    repo: 'demo',
    language: 'js',
    stratum: 'literal-lookup',
    difficulty: 'easy',
    query: `find thing number ${i}`,
    expectedFiles: [`f${i}.js`],
    expectedSymbols: [`sym${i}`],
    expectedFacts: [],
    expectedNoMatch: false,
    max_turns: 3,
  };
}

/** A fake token bucket that records every acquire + reconcile call per target. */
function makeFakeBucket() {
  const make = () => {
    const acquires = [];
    const reconciles = [];
    return {
      acquires,
      reconciles,
      async acquire(args) { acquires.push(args); return { ...args }; },
      reconcile(args) { reconciles.push(args); return args; },
    };
  };
  return { sonnet: make(), gpt5_5: make() };
}

const PROMPT = 'x'.repeat(800); // estimateTokens = 200

// ─── M3 — acquire with estimate, reconcile with actuals ───────────────────────

describe('scoreCandidateOnProbes — M3 token-bucket reconcile (§7.7)', () => {
  it('acquires with the static estimate and reconciles to the real usage per (probe,target)', async () => {
    const probes = [makeProbe(1)];
    const usageTable = {
      sonnet: { input_tokens: 11111, output_tokens: 333 },
      gpt5_5: { input_tokens: 22222, output_tokens: 444 },
    };
    const evaluateCandidate = async ({ probe, target }) => ({
      score: target === 'sonnet' ? 0.6 : 0.7,
      toolCalls: 2,
      finalAnswerEmitted: true,
      usedReadOrGrep: true,
      trajectory: { toolCalls: [{ name: 'ss-search' }], answer: 'a' },
      wallMs: 1,
      usage: { agent: { model_id: 'm', api_path: 'p', ...usageTable[target] }, judges: [], repo_commit: null, probe_hash: '0x0', token_count_prompt: 200 },
    });

    const bucket = makeFakeBucket();
    await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate, bucket });

    const expectedInEst = estimateTokens(PROMPT) + estimateTokens(probes[0].query);
    // acquire was charged the estimate, with the fixed 2000 output estimate.
    expect(bucket.sonnet.acquires).toHaveLength(1);
    expect(bucket.sonnet.acquires[0]).toMatchObject({ inTokens: expectedInEst, outTokens: 2000, target: 'sonnet' });
    expect(bucket.gpt5_5.acquires[0]).toMatchObject({ inTokens: expectedInEst, outTokens: 2000, target: 'gpt5_5' });

    // reconcile swapped estimate→actual using the real agent usage.
    expect(bucket.sonnet.reconciles).toHaveLength(1);
    expect(bucket.sonnet.reconciles[0]).toEqual({ inTokens: 11111, outTokens: 333 });
    expect(bucket.gpt5_5.reconciles[0]).toEqual({ inTokens: 22222, outTokens: 444 });
  });

  it('a stub returning NO usage → reconcile NOT called, no throw, detail usage === null', async () => {
    const probes = [makeProbe(1), makeProbe(2)];
    const evaluateCandidate = async ({ target }) => ({
      score: target === 'sonnet' ? 0.5 : 0.6,
      toolCalls: 2,
      finalAnswerEmitted: true,
      usedReadOrGrep: true,
      trajectory: { toolCalls: [{ name: 'ss-search' }], answer: 'a' },
      wallMs: 1,
      // NO usage field — dry-run / test stub
    });

    const bucket = makeFakeBucket();
    const scored = await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate, bucket });

    // acquire still happens (gating); reconcile must NOT (no usage to reconcile).
    expect(bucket.sonnet.acquires).toHaveLength(2);
    expect(bucket.sonnet.reconciles).toHaveLength(0);
    expect(bucket.gpt5_5.reconciles).toHaveLength(0);

    // detail carries usage:null for each (probe,target).
    expect(scored.detail.p1.sonnet.usage).toBeNull();
    expect(scored.detail.p1.gpt5_5.usage).toBeNull();
    expect(scored.detail.p2.sonnet.usage).toBeNull();
  });

  it('only reconciles the targets whose usage has numeric tokens', async () => {
    const probes = [makeProbe(1)];
    const evaluateCandidate = async ({ target }) => ({
      score: 0.5,
      toolCalls: 2,
      finalAnswerEmitted: true,
      usedReadOrGrep: true,
      trajectory: { toolCalls: [], answer: '' },
      wallMs: 1,
      usage: target === 'sonnet'
        ? { agent: { input_tokens: 5000, output_tokens: 100 }, judges: [] }
        : { agent: { input_tokens: null, output_tokens: null }, judges: [] }, // gpt5_5: codex surfaces no usage
    });
    const bucket = makeFakeBucket();
    await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate, bucket });
    expect(bucket.sonnet.reconciles).toHaveLength(1);
    // gpt5_5 agent usage is all-null → no reconcile.
    expect(bucket.gpt5_5.reconciles).toHaveLength(0);
  });

  it('works with no bucket at all (null) — no acquire/reconcile, no throw', async () => {
    const probes = [makeProbe(1)];
    const evaluateCandidate = async ({ target }) => ({
      score: target === 'sonnet' ? 0.4 : 0.9,
      toolCalls: 2, finalAnswerEmitted: true, usedReadOrGrep: true,
      trajectory: { toolCalls: [], answer: '' }, wallMs: 1,
      usage: { agent: { input_tokens: 1, output_tokens: 1 }, judges: [] },
    });
    const scored = await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate, bucket: null });
    expect(scored.perProbeMaximin).toEqual([0.4]); // min(0.4, 0.9)
  });
});

// ─── CC1 — usage threaded into detail ─────────────────────────────────────────

describe('scoreCandidateOnProbes — CC1 usage in detail[pid][target]', () => {
  it('carries the full usage object through detail', async () => {
    const probes = [makeProbe(1)];
    const usageObj = {
      agent: { model_id: 'claude-sonnet-4-6', api_path: 'claude-cli', input_tokens: 12000, output_tokens: 800, retry_count: 0 },
      judges: [{ model: 'deepseek-v4-flash', lineage: 'deepseek-api', input_tokens: 100, output_tokens: 10, retry_count: 0, isError: false }],
      repo_commit: 'abc123',
      probe_hash: '0xdeadbeefdeadbeef',
      token_count_prompt: 200,
    };
    const evaluateCandidate = async ({ target }) => ({
      score: 0.5, toolCalls: 2, finalAnswerEmitted: true, usedReadOrGrep: true,
      trajectory: { toolCalls: [], answer: '' }, wallMs: 1,
      usage: target === 'sonnet' ? usageObj : { ...usageObj, agent: { ...usageObj.agent, model_id: 'gpt-5.5-instant', api_path: 'codex-exec', input_tokens: null, output_tokens: null } },
    });
    const scored = await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate });
    expect(scored.detail.p1.sonnet.usage).toEqual(usageObj);
    expect(scored.detail.p1.sonnet.usage.agent.model_id).toBe('claude-sonnet-4-6');
    expect(scored.detail.p1.gpt5_5.usage.agent.api_path).toBe('codex-exec');
  });
});

// ─── core scoring outputs stay correct ────────────────────────────────────────

describe('scoreCandidateOnProbes — core outputs (§3.7.1)', () => {
  it('returns perProbeMaximin / scores / score_sonnet / score_gpt5_5', async () => {
    const probes = [makeProbe(1), makeProbe(2)];
    const table = {
      'p1|sonnet': 0.6, 'p1|gpt5_5': 0.9, // maximin 0.6
      'p2|sonnet': 0.8, 'p2|gpt5_5': 0.4, // maximin 0.4
    };
    const evaluateCandidate = async ({ probe, target }) => ({
      score: table[`${probe.id}|${target}`],
      toolCalls: 2, finalAnswerEmitted: true, usedReadOrGrep: true,
      trajectory: { toolCalls: [], answer: '' }, wallMs: 1,
    });
    const scored = await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate });
    expect(scored.perProbeMaximin).toEqual([0.6, 0.4]);
    expect(scored.scores).toEqual({ p1: 0.6, p2: 0.4 });
    expect(scored.score_sonnet).toBeCloseTo(0.7, 10);
    expect(scored.score_gpt5_5).toBeCloseTo(0.65, 10);
  });
});

describe('computeFinalScoreFor — native-relative scoring', () => {
  it('counts marginal agent tokens without double-counting cached Codex input', () => {
    expect(agentTokenCount({ agent: { input_tokens: 55008, cache_read_tokens: 36480, output_tokens: 460 } })).toBe(18988);
    expect(agentTokenCount({ agent: { input_tokens: 6, cache_read_tokens: 109269, output_tokens: 770 } })).toBe(776);
    expect(toProbeRun({
      score: 1,
      toolCalls: 2,
      finalAnswerEmitted: true,
      usedReadOrGrep: true,
      usage: { agent: { input_tokens: 41505, cache_read_tokens: 31872, output_tokens: 595 } },
    }, makeProbe(1)).tokens).toBe(10228);
  });

  it('counts Anthropic cache-creation tokens as work (rolling-cache fix)', () => {
    // Cached Sonnet: input_tokens collapses to ~0, bulk of unique input lands in
    // cache_creation. Without counting it the run reads as output-only (degenerate).
    expect(agentTokenCount({
      agent: { input_tokens: 8, cache_read_tokens: 14390, cache_creation_tokens: 7100, output_tokens: 1519 },
    })).toBe(8 + 7100 + 1519);
    // GPT path is unchanged: no cache_creation field → term is 0.
    expect(agentTokenCount({
      agent: { input_tokens: 35987, cache_read_tokens: 28777, output_tokens: 845 },
    })).toBe(35987 - 28777 + 845);
    // accepts the provider-native field name too
    expect(agentTokenCount({
      agent: { input_tokens: 8, cache_read_input_tokens: 14390, cache_creation_input_tokens: 7100, output_tokens: 1519 },
    })).toBe(8 + 7100 + 1519);
  });

  it('uses native-relative accuracy/calls/tokens when a baseline is provided', () => {
    const fs = computeFinalScoreFor({
      perProbeMaximin: [0.95],
      weights: [1],
      tokenCount: 0,
      runsByTarget: {
        sonnet: [{ probeId: 'p1', score: 0.95, stratum: 'literal-lookup', calls: 2, tokens: 650, finalAnswerEmitted: true, usedReadOrGrep: true }],
        gpt5_5: [{ probeId: 'p1', score: 0.96, stratum: 'literal-lookup', calls: 1, tokens: 500, finalAnswerEmitted: true, usedReadOrGrep: true }],
      },
      nativeBaselineByTarget: {
        sonnet: { p1: { score: 0.9, calls: 4, tokens: 1000 } },
        gpt5_5: { p1: { score: 0.9, calls: 4, tokens: 1000 } },
      },
    });
    expect(fs.taskScore).toBeCloseTo(0.95, 10);
    expect(fs.nativeRelative.factor).toBeCloseTo(1, 10);
    expect(fs.finalScore).toBeCloseTo(1, 10);
  });
});

// ─── B6 — AllJudgesFailedError propagation ────────────────────────────────────

describe('scoreCandidateOnProbes — B6 propagation (never swallow to 0)', () => {
  it('propagates AllJudgesFailedError thrown by evaluateCandidate', async () => {
    const probes = [makeProbe(1)];
    const evaluateCandidate = async () => {
      throw new AllJudgesFailedError([
        { model: 'deepseek-v4-flash', lineage: 'deepseek-api', error: 'empty-text-200' },
      ]);
    };
    await expect(
      scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate }),
    ).rejects.toBeInstanceOf(AllJudgesFailedError);
  });

  it('does NOT coerce a failed probe to a 0 score (no silent corruption)', async () => {
    const probes = [makeProbe(1)];
    let threw = false;
    const evaluateCandidate = async () => { throw new AllJudgesFailedError([]); };
    try {
      await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(AllJudgesFailedError);
    }
    expect(threw).toBe(true);
  });
});
