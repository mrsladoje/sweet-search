/**
 * Phase 7 — GEPA joint-scoring helpers (§3.1, §3.7.1).
 *
 * Pure-ish numeric layer wiring the LANDED scoring primitives (eas.mjs) into
 * the GEPA loop's notion of a "candidate". The only async surface is
 * `scoreCandidateOnProbes` / `buildCandidate`, which delegate every agent run
 * to the injectable `evaluateCandidate` seam (default = real harness; tests +
 * dry-run pass a stub). No network, no I/O of its own.
 *
 * The joint pipeline per §3.7.1:
 *   per-target raw score → per-probe Maximin → weighted taskScore
 *   → EAS efficiencyFactor → finalScore (= taskScore × ef − lengthPenalty)
 *
 * Dynamic hard-negative probe weighting (§3.1) is computed by
 * `computeProbeWeights` (noise floor + 2-round stability gate, via
 * eas.probeWeight). Below `hardNegativeStartRound` every weight is 1.0.
 */

import {
  DEFAULTS,
  TARGET_LIST,
  callWindowFor,
  maximinPerProbe,
  hashContent,
  normalizeTarget,
} from './p7-shared.mjs';
import {
  taskScore,
  efficiencyFactor,
  nativeRelativeScore,
  lengthPenalty,
  finalScore,
  probeWeight,
  costUsd,
  estLatencySeconds,
  realizedCostUsd,
} from './eas.mjs';
import { estimateTokens } from './variant-loader.mjs';

// ─── small numeric helpers ──────────────────────────────────────────────────

export function mean(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Population variance (matches the §3.1 "variance across the Pareto front"). */
export function populationVariance(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const m = mean(arr);
  return mean(arr.map((x) => (x - m) * (x - m)));
}

export function agentTokenCount(usage) {
  const agent = usage?.agent;
  if (!agent || typeof agent !== 'object') return null;
  const cached = typeof agent.cache_read_tokens === 'number' && Number.isFinite(agent.cache_read_tokens)
    ? agent.cache_read_tokens
    : (typeof agent.cached_input_tokens === 'number' && Number.isFinite(agent.cached_input_tokens) ? agent.cached_input_tokens : null);
  // Anthropic reports first-occurrence (cache-write) tokens in a SEPARATE
  // `cache_creation_input_tokens` field, excluded from `input_tokens`. Under the
  // agent's rolling cache, that is where the bulk of unique input lands — so it
  // MUST be counted as work, else cached Sonnet runs collapse to output-only and
  // their token desirability is degenerate. OpenAI has no such field (first
  // occurrence is an uncached cache-miss already inside prompt_tokens), so this
  // term is 0 for GPT and the OpenAI accounting is unchanged.
  const cacheCreation = typeof agent.cache_creation_tokens === 'number' && Number.isFinite(agent.cache_creation_tokens)
    ? agent.cache_creation_tokens
    : (typeof agent.cache_creation_input_tokens === 'number' && Number.isFinite(agent.cache_creation_input_tokens) ? agent.cache_creation_input_tokens : 0);
  if (typeof agent.input_tokens === 'number' || typeof agent.output_tokens === 'number') {
    const input = typeof agent.input_tokens === 'number' && Number.isFinite(agent.input_tokens) ? agent.input_tokens : 0;
    const output = typeof agent.output_tokens === 'number' && Number.isFinite(agent.output_tokens) ? agent.output_tokens : 0;
    // Codex/OpenAI reports cached input as a subset of input_tokens; Claude
    // reports cache reads separately. Subtract only when it is clearly included.
    const billableInput = cached != null && cached > 0 && cached <= input ? input - cached : input;
    const work = billableInput + cacheCreation + output;
    return work > 0 ? work : null;
  }
  if (typeof agent.total_tokens === 'number' && Number.isFinite(agent.total_tokens)) return agent.total_tokens;
  if (typeof agent.totalTokens === 'number' && Number.isFinite(agent.totalTokens)) return agent.totalTokens;
  let seen = false;
  let total = 0;
  for (const key of ['prompt_tokens', 'completion_tokens']) {
    if (typeof agent[key] === 'number' && Number.isFinite(agent[key])) {
      total += agent[key];
      seen = true;
    }
  }
  return seen && total > 0 ? total : null;
}

function _num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function _numOrNull(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/**
 * Cache-NAIVE usage breakdown for the 2026-05-29 dollar-cost metric.
 *
 * Returns { processedInput, output } where `processedInput` counts EVERY input
 * token the model processed this trajectory at the full uncached rate — the
 * cache discount is a deployment property, excluded so the metric is invariant
 * to cache warmth / request ordering (which probe "pays" cache_creation under
 * concurrency is otherwise random, making the old work-token scalar
 * non-reproducible). Anthropic `input_tokens` EXCLUDES cache reads + writes →
 * add them back. OpenAI `input_tokens` INCLUDES cached tokens (a subset) → do
 * NOT double-count. `output` (reasoning/thinking + tool-call args + final
 * answer) is generation — never cached — and already captured by output_tokens,
 * so it carries the "decision/reasoning" cost the cache problem never touched.
 *
 * @returns {{ processedInput:number, output:number }|null}
 */
export function agentUsageBreakdown(usage) {
  const agent = usage?.agent;
  if (!agent || typeof agent !== 'object') return null;
  if (!(typeof agent.input_tokens === 'number' || typeof agent.output_tokens === 'number')) {
    // Legacy/aggregate shapes (total_tokens / prompt_tokens+completion_tokens):
    // no input/output split available → attribute the scalar work to input.
    const scalar = agentTokenCount(usage);
    return scalar == null ? null : { processedInput: scalar, output: 0 };
  }
  const input = _num(agent.input_tokens);
  const output = _num(agent.output_tokens);
  const cacheRead = _numOrNull(agent.cache_read_tokens ?? agent.cached_input_tokens);
  const cacheCreation = _num(agent.cache_creation_tokens ?? agent.cache_creation_input_tokens);
  // OpenAI reports cached input as a SUBSET of input_tokens (cacheRead ≤ input);
  // Anthropic reports cache reads + creation SEPARATELY from input_tokens.
  const cacheReadIsSubset = cacheRead != null && cacheRead > 0 && cacheRead <= input;
  const processedInput = input + cacheCreation + (cacheReadIsSubset ? 0 : (cacheRead ?? 0));
  const total = processedInput + output;
  return total > 0 ? { processedInput, output } : null;
}

/**
 * Per-(probe,target) cost + latency telemetry for trajectory events (2026-05-29).
 *   cost_usd      — cache-naive optimization metric (what the front/selection use)
 *   realized_usd  — cache-aware deployment figure (reported, NOT optimized)
 *   est_latency_s — deterministic latency diagnostic (turns + output/throughput)
 * All null when usage / prices for the target are unavailable.
 */
export function runCostLatencyFields({ usage, target, toolCalls }) {
  const bd = agentUsageBreakdown(usage);
  let tkey = null;
  try { tkey = normalizeTarget(target); } catch { tkey = null; }
  const prices = tkey ? DEFAULTS.targetPrices?.[tkey] : null;
  const latency = tkey ? DEFAULTS.targetLatency?.[tkey] : null;
  return {
    processed_input: bd?.processedInput ?? null,
    output: bd?.output ?? null,
    cost_usd: (bd && prices) ? costUsd({ processedInput: bd.processedInput, output: bd.output, prices }) : null,
    realized_usd: prices ? realizedCostUsd({ agent: usage?.agent, prices }) : null,
    est_latency_s: (bd && latency) ? estLatencySeconds({ turns: toolCalls ?? 0, output: bd.output, latency }) : null,
  };
}

/** Map an evaluateCandidate result + probe → the ProbeRun shape EAS expects. */
export function toProbeRun(evalResult, probe) {
  const breakdown = agentUsageBreakdown(evalResult.usage);
  return {
    probeId: probe.id,
    stratum: probe.stratum,
    score: evalResult.score,
    calls: evalResult.toolCalls,
    tokens: agentTokenCount(evalResult.usage),
    processedInput: breakdown?.processedInput ?? null,
    output: breakdown?.output ?? null,
    finalAnswerEmitted: !!evalResult.finalAnswerEmitted,
    usedReadOrGrep: !!evalResult.usedReadOrGrep,
    usedNativeSearch: !!evalResult.usedNativeSearch,
    ...(Array.isArray(probe.expected_call_window)
      ? { expected_call_window: probe.expected_call_window }
      : {}),
  };
}

// ─── per-candidate evaluation ───────────────────────────────────────────────

/**
 * Run `evaluateCandidate` for a candidate prompt across every probe × both
 * targets, returning the per-probe Maximin vector, per-target run arrays (for
 * EAS), per-target aggregate scores (for the 0.15 admission cap), and a compact
 * per-probe detail map (used by OP-2 trajectory crossover + reflection traces).
 *
 * Concurrency: `concurrency` (default 1) bounds how many agent trajectories run
 * at once. Units are flattened to (probe × target) so the pool fills with up to
 * `concurrency` trajectories of ANY target ("N agents in flight, of all kinds").
 * Results are reassembled in probe order, so the output is deterministic for
 * resume regardless of completion order. The optional per-target `bucket`
 * (token-bucket) still enforces the provider rate ceiling so a live run never
 * 429-storms (§7.7). `concurrency: 1` reproduces the original sequential path.
 *
 * M3 — token-bucket actuals reconciliation: `acquire` is charged the static
 * estimate (prompt + query tokens in; a fixed output estimate) and returns this
 * call's entry; after `evaluateCandidate` returns, that SPECIFIC entry is
 * reconciled to the real `r.usage.agent.{input_tokens,output_tokens}` (passing
 * the entry keeps reconcile correct under concurrency). Backward-compatible: the
 * dry-run / test stubs return NO `usage`, so reconcile is skipped and `detail[*].usage` is null.
 *
 * @param {object} args
 * @param {{ prompt: string }} args.candidate
 * @param {object[]} args.probes
 * @param {(a:{promptText:string,probe:object,target:string})=>Promise<object>} args.evaluateCandidate
 * @param {{ sonnet?: {acquire:Function,reconcile?:Function}, gpt5_5?: {acquire:Function,reconcile?:Function} }|null} [args.bucket]
 * @param {number} [args.concurrency=1]
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min((limit | 0) || 1, items.length || 1));
  async function lane() {
    for (let i = cursor++; i < items.length; i = cursor++) {
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

export async function scoreCandidateOnProbes({ candidate, probes, evaluateCandidate, bucket = null, concurrency = 1 }) {
  if (typeof evaluateCandidate !== 'function') {
    throw new TypeError('scoreCandidateOnProbes: evaluateCandidate must be a function');
  }
  // Reasonable per-call output estimate for the token bucket. The agent answer
  // is short relative to its ~12K-token input window; reconcile() corrects it
  // to the real output count once usage is available.
  const OUT_TOKENS_EST = 2000;

  // Flatten to (probe × target) units; the bounded pool runs up to `concurrency`
  // agent trajectories of any target concurrently.
  const tasks = [];
  for (const probe of probes) {
    for (const target of TARGET_LIST) tasks.push({ probe, target });
  }
  const taskResults = await mapWithConcurrency(tasks, concurrency, async ({ probe, target }) => {
    const inEst = estimateTokens(candidate.prompt) + estimateTokens(probe.query || '');
    let entry = null;
    if (bucket && bucket[target] && typeof bucket[target].acquire === 'function') {
      entry = await bucket[target].acquire({ inTokens: inEst, outTokens: OUT_TOKENS_EST, target });
    }
    const r = await evaluateCandidate({ promptText: candidate.prompt, probe, target });
    // M3 reconcile estimate→actual on THIS call's entry (safe under concurrency).
    const agentUsage = r.usage?.agent;
    if (
      bucket && bucket[target] && typeof bucket[target].reconcile === 'function' &&
      agentUsage &&
      (typeof agentUsage.input_tokens === 'number' || typeof agentUsage.output_tokens === 'number')
    ) {
      bucket[target].reconcile({
        inTokens: typeof agentUsage.input_tokens === 'number' ? agentUsage.input_tokens : undefined,
        outTokens: typeof agentUsage.output_tokens === 'number' ? agentUsage.output_tokens : undefined,
        entry,
      });
    }
    return { probeId: probe.id, target, r };
  });

  // Reassemble in probe order — deterministic for resume regardless of completion order.
  const runByProbe = new Map();
  for (const { probeId, target, r } of taskResults) {
    if (!runByProbe.has(probeId)) runByProbe.set(probeId, {});
    runByProbe.get(probeId)[target] = r;
  }

  const perProbeMaximin = [];
  const probeIds = [];
  const runsByTarget = { sonnet: [], gpt5_5: [] };
  const scores = {};
  const detail = {};
  const sonnetScores = [];
  const gptScores = [];
  for (const probe of probes) {
    const runs = runByProbe.get(probe.id);
    for (const target of TARGET_LIST) runsByTarget[target].push(toProbeRun(runs[target], probe));
    const mm = maximinPerProbe(runs.sonnet.score, runs.gpt5_5.score);
    probeIds.push(probe.id);
    perProbeMaximin.push(mm);
    scores[probe.id] = mm;
    sonnetScores.push(runs.sonnet.score);
    gptScores.push(runs.gpt5_5.score);
    detail[probe.id] = {
      sonnet: { score: runs.sonnet.score, traj: runs.sonnet.trajectory || { toolCalls: [], answer: '' }, usage: runs.sonnet.usage ?? null },
      gpt5_5: { score: runs.gpt5_5.score, traj: runs.gpt5_5.trajectory || { toolCalls: [], answer: '' }, usage: runs.gpt5_5.usage ?? null },
    };
  }

  return {
    perProbeMaximin,
    probeIds,
    runsByTarget,
    scores,
    detail,
    score_sonnet: mean(sonnetScores),
    score_gpt5_5: mean(gptScores),
  };
}

/**
 * Compose the §3.7.1 final score from a scored candidate.
 *
 * @returns {{ taskScore:number, efficiencyFactor:number, lengthPenalty:number, finalScore:number, nativeRelative?:object }}
 */
export function computeFinalScoreFor({ perProbeMaximin, weights, runsByTarget, tokenCount, nativeBaselineByTarget = null }) {
  const ts = taskScore({ perProbeMaximin, weights });
  const ef = efficiencyFactor({ perTarget: runsByTarget }).factor;
  const lp = lengthPenalty(tokenCount);
  if (nativeBaselineByTarget) {
    const nr = nativeRelativeScore({ perTarget: runsByTarget, baselineByTarget: nativeBaselineByTarget });
    // Candidate-level mean cache-naive $ across all (probe,target) runs — the cost
    // axis of the 2-D reporting front + the deployment-cost figure denominator.
    const costs = [];
    for (const t of Object.keys(nr.breakdown)) {
      for (const r of nr.breakdown[t].runs) if (typeof r.costUsd === 'number') costs.push(r.costUsd);
    }
    const meanCostUsd = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
    return {
      taskScore: ts,
      efficiencyFactor: ef,
      lengthPenalty: lp,
      finalScore: nr.factor - lp,
      nativeRelative: nr,
      accuracyFactor: nr.accuracyFactor,   // decoupled accuracy gate (own axis)
      efficiencyScore: nr.efficiencyFactor, // decoupled efficiency (calls × cost)
      meanCostUsd,
    };
  }
  const fs = finalScore({ taskScore: ts, efficiencyFactor: ef, lengthPenalty: lp });
  return { taskScore: ts, efficiencyFactor: ef, lengthPenalty: lp, finalScore: fs };
}

/**
 * Build a fully-scored candidate object: the unit of currency the GEPA loop
 * (and the Pareto front) passes around.
 *
 * `weights` must be aligned to `probes` (same order). `sharpnessScore` defaults
 * to 1.0 (robust) until TARE measures it (§3.7.1 step 8).
 */
export async function buildCandidate({
  id,
  prompt,
  sourceOp,
  parentHash,
  probes,
  weights,
  evaluateCandidate,
  bucket = null,
  nativeBaselineByTarget = null,
  concurrency = 1,
}) {
  const tokenCount = estimateTokens(prompt);
  const scored = await scoreCandidateOnProbes({ candidate: { prompt }, probes, evaluateCandidate, bucket, concurrency });
  const fs = computeFinalScoreFor({
    perProbeMaximin: scored.perProbeMaximin,
    weights: weights ?? scored.probeIds.map(() => 1),
    runsByTarget: scored.runsByTarget,
    tokenCount,
    nativeBaselineByTarget,
  });
  return {
    id,
    hash: hashContent(prompt),
    prompt,
    tokenCount,
    sourceOp,
    parentHash: parentHash ?? null,
    scores: scored.scores,
    detail: scored.detail,
    probeIds: scored.probeIds,
    score_sonnet: scored.score_sonnet,
    score_gpt5_5: scored.score_gpt5_5,
    taskScore: fs.taskScore,
    efficiencyFactor: fs.efficiencyFactor,
    lengthPenalty: fs.lengthPenalty,
    finalScore: fs.finalScore,
    nativeRelative: fs.nativeRelative ?? null,
    // Decoupled axes (2026-05-29): taskScore (accuracy) and costUsd are the 2-D
    // reporting-front objectives; accuracyFactor is the floored gate, efficiencyScore
    // is the accuracy-free efficiency. sharpnessScore is a tie-breaker/reliability
    // signal ONLY — it is NOT part of the search-front dominance relation.
    accuracyFactor: fs.accuracyFactor ?? null,
    efficiencyScore: fs.efficiencyScore ?? null,
    costUsd: fs.meanCostUsd ?? null,
    sharpnessScore: 1.0,
  };
}

// ─── dynamic hard-negative probe weighting (§3.1) ───────────────────────────

/**
 * Per-probe weights from cross-Pareto-front variance.
 * Below `hardNegativeStartRound` (round 5) every weight is 1.0 (§3.1).
 * Otherwise weight = eas.probeWeight(variance across front, roundsEvaluated)
 * which applies the 2-round stability gate + 0.05 noise floor + [0.1,2.0] clip.
 *
 * @returns {number[]} aligned to `probeIds`
 */
export function computeProbeWeights({ front, probeIds, round, roundsEvaluatedByProbe = {} }) {
  if (round < DEFAULTS.hardNegativeStartRound) {
    return probeIds.map(() => 1.0);
  }
  return probeIds.map((pid) => {
    const acrossFront = (front || [])
      .map((inc) => inc.scores?.[pid])
      .filter((v) => typeof v === 'number');
    const variance = acrossFront.length >= 2 ? populationVariance(acrossFront) : 0;
    const roundsEvaluated = roundsEvaluatedByProbe[pid] ?? 0;
    return probeWeight({ variance, roundsEvaluated });
  });
}

// ─── failure-trace extraction (OP-1 reflection input) ───────────────────────

/**
 * The N worst probes for a candidate (joint Maximin ≤ 0.4), with compact
 * trajectory excerpts from the weaker target — the OP-1 reflective input (§3.2).
 */
export function topFailures({ candidate, probes, limit = 5 }) {
  const byId = Object.fromEntries((probes || []).map((p) => [p.id, p]));
  const rows = [];
  for (const pid of Object.keys(candidate.scores || {})) {
    const js = candidate.scores[pid];
    if (typeof js !== 'number' || js > 0.4) continue;
    const probe = byId[pid] || {};
    const d = candidate.detail?.[pid];
    const worseTarget = d ? (d.sonnet.score <= d.gpt5_5.score ? 'sonnet' : 'gpt5_5') : 'sonnet';
    const traj = d?.[worseTarget]?.traj || { toolCalls: [], answer: '' };
    rows.push({
      probeId: pid,
      stratum: probe.stratum ?? null,
      repo: probe.repo ?? null,
      query: probe.query ?? null,
      jointScore: js,
      target: worseTarget,
      toolCalls: traj.toolCalls,
      answer: traj.answer,
      expectedFiles: probe.expectedFiles ?? [],
    });
  }
  rows.sort((a, b) => a.jointScore - b.jointScore);
  return rows.slice(0, limit);
}

function nativeRunsByProbe(candidate, pid) {
  const out = [];
  const breakdown = candidate.nativeRelative?.breakdown;
  if (!breakdown || typeof breakdown !== 'object') return out;
  for (const target of TARGET_LIST) {
    const row = breakdown[target]?.runs?.find((r) => r.probeId === pid);
    if (row) out.push({ target, row });
  }
  return out;
}

/**
 * Minimum native-relative `desirability.overall` for a probe to be surfaced as
 * an inefficiency. At or above this, the probe is already near-native efficient
 * and surfacing it would give OP-1 fake "improve this" pressure — exactly the
 * failure mode the original `topFailures()` accuracy-only signal exhibited on
 * a saturated front. Probes at or above the threshold are SKIPPED ENTIRELY by
 * the native-relative path (no fallthrough to the heuristic call-window path);
 * the heuristic path runs only when a probe has no native-relative rows at all.
 * If every probe is gated out this way, `topInefficiencies` returns [] and
 * `runGepa` falls back to `topFailures()`.
 */
export const INEFFICIENCY_OVERALL_THRESHOLD = 0.6;

/**
 * The N worst native-relative inefficiency traces for OP-1 reflection.
 *
 * Accuracy on the mature front is often saturated, so `topFailures()` can return
 * an empty set and leave the reflector with no useful pressure. This extractor
 * ranks probes by low native-relative desirability, prioritising calls/tokens
 * waste even when the answer is already correct. Probes whose native-relative
 * `desirability.overall` is at or above `INEFFICIENCY_OVERALL_THRESHOLD` are
 * NOT surfaced — they are near-native efficient and would only invite OP-1 to
 * polish already-good traces.
 */
export function topInefficiencies({ candidate, probes, limit = 5, threshold = INEFFICIENCY_OVERALL_THRESHOLD }) {
  const byId = Object.fromEntries((probes || []).map((p) => [p.id, p]));
  const rows = [];

  for (const pid of Object.keys(candidate.scores || {})) {
    const probe = byId[pid] || {};
    const nativeRows = nativeRunsByProbe(candidate, pid);
    if (nativeRows.length > 0) {
      nativeRows.sort((a, b) => (a.row.desirability?.overall ?? 1) - (b.row.desirability?.overall ?? 1));
      const { target, row } = nativeRows[0];
      const overall = row.desirability?.overall ?? 1;
      if (overall >= threshold) {
        // Probe is near-native efficient. Skip — DO NOT fall through to the
        // heuristic path. If every probe is in this state, the result set is
        // [] and `runGepa` falls back to `topFailures()` rather than surfacing
        // false pressure on a saturated candidate.
        continue;
      }
      const traj = candidate.detail?.[pid]?.[target]?.traj || { toolCalls: [], answer: '' };
      rows.push({
        probeId: pid,
        stratum: probe.stratum ?? null,
        repo: probe.repo ?? null,
        query: probe.query ?? null,
        jointScore: candidate.scores[pid],
        target,
        toolCalls: traj.toolCalls,
        answer: traj.answer,
        expectedFiles: probe.expectedFiles ?? [],
        nativeRelativeOverall: row.desirability?.overall ?? null,
        desirability: row.desirability ?? null,
        calls: row.calls,
        nativeCalls: row.nativeCalls,
        costUsd: row.costUsd,
        nativeCostUsd: row.nativeCostUsd,
        processedInput: row.processedInput,
        output: row.output,
      });
      continue;
    }

    const d = candidate.detail?.[pid];
    if (!d) continue;
    let worst = null;
    for (const target of TARGET_LIST) {
      const traj = d[target]?.traj || { toolCalls: [], answer: '' };
      const calls = Array.isArray(traj.toolCalls) ? traj.toolCalls.length : 0;
      let lo = 0;
      let hi = Infinity;
      try { [lo, hi] = callWindowFor(probe); } catch { /* unknown stratum */ }
      const deviation = Math.max(0, lo - calls) + Math.max(0, calls - hi);
      const tokens = agentTokenCount(d[target]?.usage);
      const score = deviation * 1000 + (tokens ?? 0);
      if (!worst || score > worst.score) worst = { target, traj, calls, tokens, deviation, score };
    }
    if (!worst || (worst.deviation <= 0 && !(worst.tokens > 0))) continue;
    rows.push({
      probeId: pid,
      stratum: probe.stratum ?? null,
      repo: probe.repo ?? null,
      query: probe.query ?? null,
      jointScore: candidate.scores[pid],
      target: worst.target,
      toolCalls: worst.traj.toolCalls,
      answer: worst.traj.answer,
      expectedFiles: probe.expectedFiles ?? [],
      calls: worst.calls,
      tokens: worst.tokens,
      callWindow: Array.isArray(probe.expected_call_window) ? probe.expected_call_window : null,
      callDeviation: worst.deviation,
    });
  }

  rows.sort((a, b) => {
    const ao = typeof a.nativeRelativeOverall === 'number' ? a.nativeRelativeOverall : Infinity;
    const bo = typeof b.nativeRelativeOverall === 'number' ? b.nativeRelativeOverall : Infinity;
    if (ao !== bo) return ao - bo;
    const ac = (a.desirability?.calls ?? 1) + (a.desirability?.cost ?? 1);
    const bc = (b.desirability?.calls ?? 1) + (b.desirability?.cost ?? 1);
    if (ac !== bc) return ac - bc;
    return (b.callDeviation ?? 0) - (a.callDeviation ?? 0);
  });
  return rows.slice(0, limit);
}
