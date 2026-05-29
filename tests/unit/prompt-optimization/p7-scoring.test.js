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
  agentUsageBreakdown,
  computeFinalScoreFor,
  mapWithConcurrency,
  runCostLatencyFields,
  scoreCandidateOnProbes,
  toProbeRun,
} from '../../../core/prompt-optimization/sweep/gepa-scoring.mjs';
import { AllJudgesFailedError } from '../../../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { estimateTokens } from '../../../core/prompt-optimization/sweep/variant-loader.mjs';

// ─── agentUsageBreakdown — cache-naive {processedInput, output} ─────────────

describe('agentUsageBreakdown — cache-naive', () => {
  it('Anthropic: adds cache_read + cache_creation back (input_tokens excludes them)', () => {
    // input(fresh)=5000, cache_read=60000 (> input → not a subset), cache_creation=1000
    const b = agentUsageBreakdown({ agent: {
      input_tokens: 5000, output_tokens: 2000, cache_read_tokens: 60000, cache_creation_tokens: 1000,
    } });
    expect(b).toEqual({ processedInput: 66000, output: 2000 });
  });

  it('OpenAI: cache reads are a subset of input_tokens → not double-counted', () => {
    const b = agentUsageBreakdown({ agent: {
      input_tokens: 70000, output_tokens: 2000, cached_input_tokens: 60000,
    } });
    expect(b).toEqual({ processedInput: 70000, output: 2000 });
  });

  it('is invariant to cache warmth: cold (all cache_creation) vs warm (all cache_read) → same processedInput', () => {
    const cold = agentUsageBreakdown({ agent: { input_tokens: 5000, output_tokens: 2000, cache_read_tokens: 0, cache_creation_tokens: 61000 } });
    const warm = agentUsageBreakdown({ agent: { input_tokens: 5000, output_tokens: 2000, cache_read_tokens: 61000, cache_creation_tokens: 0 } });
    expect(cold.processedInput).toBe(66000);
    expect(warm.processedInput).toBe(66000);
    expect(cold.output).toBe(warm.output);
  });

  it('returns null when no agent usage present', () => {
    expect(agentUsageBreakdown(null)).toBeNull();
    expect(agentUsageBreakdown({})).toBeNull();
  });

  it('legacy total_tokens shape → all attributed to processedInput', () => {
    expect(agentUsageBreakdown({ agent: { total_tokens: 12345 } })).toEqual({ processedInput: 12345, output: 0 });
  });
});

// ─── runCostLatencyFields — per-(probe,target) event telemetry ──────────────

describe('runCostLatencyFields', () => {
  it('emits cache-naive cost, realized cost, and deterministic latency for a known target', () => {
    const usage = { agent: { input_tokens: 5000, output_tokens: 2000, cache_read_tokens: 60000, cache_creation_tokens: 1000 } };
    const f = runCostLatencyFields({ usage, target: 'sonnet', toolCalls: 4 });
    expect(f.processed_input).toBe(66000);
    expect(f.output).toBe(2000);
    expect(f.cost_usd).toBeCloseTo((66000 * 3 + 2000 * 15) / 1e6, 12); // cache-naive
    expect(f.realized_usd).toBeCloseTo(66750 / 1e6, 12);               // cache-aware < naive
    expect(f.realized_usd).toBeLessThan(f.cost_usd);
    expect(f.est_latency_s).toBeCloseTo(4 * 0.8 + 2000 / 55, 10);
  });

  it('returns all-null when usage is absent', () => {
    expect(runCostLatencyFields({ usage: null, target: 'sonnet', toolCalls: 1 })).toEqual({
      processed_input: null, output: null, cost_usd: null, realized_usd: null, est_latency_s: null,
    });
  });
});

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
    const entries = [];
    return {
      acquires,
      reconciles,
      entries,
      async acquire(args) { acquires.push(args); const e = { ...args }; entries.push(e); return e; },
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
    expect(bucket.sonnet.reconciles[0]).toMatchObject({ inTokens: 11111, outTokens: 333 });
    expect(bucket.gpt5_5.reconciles[0]).toMatchObject({ inTokens: 22222, outTokens: 444 });
    // reconcile targets THIS call's acquire entry (correctness under concurrency).
    expect(bucket.sonnet.reconciles[0].entry).toBe(bucket.sonnet.entries[0]);
    expect(bucket.gpt5_5.reconciles[0].entry).toBe(bucket.gpt5_5.entries[0]);
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

// ─── bounded-concurrency parallelization (agent pool) ─────────────────────────

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    // Later items resolve sooner — output must still be in input order.
    const out = await mapWithConcurrency([30, 10, 20, 5], 4, (ms, i) =>
      new Promise((r) => setTimeout(() => r(`${i}:${ms}`), ms)));
    expect(out).toEqual(['0:30', '1:10', '2:20', '3:5']);
  });

  it('never exceeds the concurrency limit in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // actually parallel, not serialized
  });

  it('limit=1 is a plain in-order sequential map', async () => {
    const seen = [];
    await mapWithConcurrency([1, 2, 3], 1, async (x) => { seen.push(x); });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('scoreCandidateOnProbes — concurrency is result-equivalent to sequential', () => {
  // Deterministic stub: score depends only on (probe, target), so parallel vs
  // sequential MUST produce byte-identical aggregates + ordering.
  const probes = [makeProbe(1), makeProbe(2), makeProbe(3), makeProbe(4), makeProbe(5)];
  const evaluateCandidate = async ({ probe, target }) => {
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8))); // jitter completion order
    const base = Number(probe.id.slice(1)) / 10;
    return {
      score: target === 'sonnet' ? base : Math.min(1, base + 0.1),
      toolCalls: 2, finalAnswerEmitted: true, usedReadOrGrep: true,
      trajectory: { toolCalls: [], answer: '' }, wallMs: 1,
      usage: { agent: { input_tokens: 100, output_tokens: 10 }, judges: [] },
    };
  };

  it('concurrency=10 yields the same probeIds/scores/perProbeMaximin as concurrency=1', async () => {
    const seq = await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate, concurrency: 1 });
    const par = await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate, concurrency: 10 });
    expect(par.probeIds).toEqual(seq.probeIds);
    expect(par.scores).toEqual(seq.scores);
    expect(par.perProbeMaximin).toEqual(seq.perProbeMaximin);
    expect(par.score_sonnet).toEqual(seq.score_sonnet);
    expect(par.score_gpt5_5).toEqual(seq.score_gpt5_5);
    expect(par.runsByTarget.sonnet.map((r) => r.score)).toEqual(seq.runsByTarget.sonnet.map((r) => r.score));
  });

  it('runs agent evaluations in parallel up to the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const probeEval = async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { score: 0.5, toolCalls: 1, finalAnswerEmitted: true, usedReadOrGrep: true, trajectory: { toolCalls: [], answer: '' }, wallMs: 1 };
    };
    await scoreCandidateOnProbes({ candidate: { prompt: PROMPT }, probes, evaluateCandidate: probeEval, concurrency: 6 });
    // 5 probes × 2 targets = 10 units; with limit 6, peak should exceed the
    // sequential ceiling of 1 and stay ≤ 6.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
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

// ─── repeats + empty-run guard (2026-05-29) ─────────────────────────────────

describe('scoreCandidateOnProbes — repeats + empty-run retry', () => {
  const PROMPT_R = 'sys';
  // Per-(probe,target) call sequencer. 'DEAD' → a 0-token run (transient failure).
  // Live calls return input_tokens = 1000 + 500×callIndex so reps differ for the
  // token-median assertion.
  function makeRepStub(seqByCell) {
    const counts = {};
    return async ({ probe, target }) => {
      const k = `${probe.id}:${target}`;
      const seq = seqByCell[k] || [1];
      const c = counts[k] || 0; counts[k] = c + 1;
      const v = seq[Math.min(c, seq.length - 1)];
      if (v === 'DEAD') {
        return { score: 0, toolCalls: 0, finalAnswerEmitted: false, usedReadOrGrep: false, usedSweetSearch: false,
          trajectory: { toolCalls: [], answer: '' }, usage: { agent: { input_tokens: 0, output_tokens: 0 } } };
      }
      return { score: v, toolCalls: 3, finalAnswerEmitted: true, usedReadOrGrep: true, usedSweetSearch: true,
        trajectory: { toolCalls: [{ name: 'ss-search' }], answer: 'a' },
        usage: { agent: { input_tokens: 1000 + 500 * c, output_tokens: 200, cache_read_tokens: 0, cache_creation_tokens: 0 } } };
    };
  }

  it('repeats=2 aggregates score by median (= mean) and tokens by median', async () => {
    const r = await scoreCandidateOnProbes({
      candidate: { prompt: PROMPT_R }, probes: [makeProbe(1)], repeats: 2,
      evaluateCandidate: makeRepStub({ 'p1:sonnet': [0.4, 0.8], 'p1:gpt5_5': [1, 1] }),
    });
    const son = r.detail.p1.sonnet;
    expect(son.score).toBeCloseTo(0.6, 10);           // median(0.4, 0.8)
    expect(son.repScores).toEqual([0.4, 0.8]);
    expect(son.reps).toBe(2);
    expect(son.usage.agent.input_tokens).toBe(1250);  // median(1000, 1500)
    expect(r.detail.p1.gpt5_5.score).toBe(1);
  });

  it('repeats=1 returns the single live rep unchanged (+ telemetry)', async () => {
    const r = await scoreCandidateOnProbes({
      candidate: { prompt: PROMPT_R }, probes: [makeProbe(1)], repeats: 1,
      evaluateCandidate: makeRepStub({ 'p1:sonnet': [0.7], 'p1:gpt5_5': [0.9] }),
    });
    expect(r.detail.p1.sonnet.score).toBe(0.7);
    expect(r.detail.p1.sonnet.reps).toBe(1);
    expect(r.detail.p1.sonnet.usage.agent.input_tokens).toBe(1000);
  });

  it('retries a dead (0-token) run and uses the recovered live result — never scores it 0', async () => {
    const r = await scoreCandidateOnProbes({
      candidate: { prompt: PROMPT_R }, probes: [makeProbe(1)], repeats: 1,
      evaluateCandidate: makeRepStub({ 'p1:sonnet': ['DEAD', 'DEAD', 0.9], 'p1:gpt5_5': [1] }),
    });
    expect(r.detail.p1.sonnet.score).toBe(0.9);   // recovered on the 3rd attempt
    expect(r.detail.p1.sonnet.reps).toBe(1);
  });

  it('flags allDead when every retry stays dead (does not crash)', async () => {
    const r = await scoreCandidateOnProbes({
      candidate: { prompt: PROMPT_R }, probes: [makeProbe(1)], repeats: 1,
      evaluateCandidate: makeRepStub({ 'p1:sonnet': ['DEAD'], 'p1:gpt5_5': [1] }),
    });
    expect(r.detail.p1.sonnet.reps).toBe(0);                       // no live reps
    expect(Number.isFinite(r.detail.p1.sonnet.score)).toBe(true);  // didn't throw / NaN
  });
});
