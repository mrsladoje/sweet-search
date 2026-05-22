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
  maximinPerProbe,
  hashContent,
} from './p7-shared.mjs';
import {
  taskScore,
  efficiencyFactor,
  lengthPenalty,
  finalScore,
  probeWeight,
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

/** Map an evaluateCandidate result + probe → the ProbeRun shape EAS expects. */
export function toProbeRun(evalResult, probe) {
  return {
    stratum: probe.stratum,
    calls: evalResult.toolCalls,
    finalAnswerEmitted: !!evalResult.finalAnswerEmitted,
    usedReadOrGrep: !!evalResult.usedReadOrGrep,
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
 * Concurrency is gated through the optional `bucket` (token-bucket per target)
 * so a live run never 429-storms (§7.7). Sequential awaiting keeps the loop
 * deterministic for resume; the bucket enforces the rate ceiling.
 *
 * M3 — token-bucket actuals reconciliation: `acquire` is charged the measured
 * static estimate (prompt + query tokens in; a fixed output estimate), and after
 * `evaluateCandidate` returns, the bucket's most-recent entry is reconciled to
 * the real `r.usage.agent.{input_tokens,output_tokens}` so heavy multi-file
 * probes throttle correctly. Backward-compatible: the dry-run / test stubs
 * return NO `usage` field, so reconcile is skipped and `detail[*].usage` is null.
 *
 * @param {object} args
 * @param {{ prompt: string }} args.candidate
 * @param {object[]} args.probes
 * @param {(a:{promptText:string,probe:object,target:string})=>Promise<object>} args.evaluateCandidate
 * @param {{ sonnet?: {acquire:Function,reconcile?:Function}, gpt5_5?: {acquire:Function,reconcile?:Function} }|null} [args.bucket]
 */
export async function scoreCandidateOnProbes({ candidate, probes, evaluateCandidate, bucket = null }) {
  if (typeof evaluateCandidate !== 'function') {
    throw new TypeError('scoreCandidateOnProbes: evaluateCandidate must be a function');
  }
  const perProbeMaximin = [];
  const probeIds = [];
  const runsByTarget = { sonnet: [], gpt5_5: [] };
  const scores = {};
  const detail = {};
  const sonnetScores = [];
  const gptScores = [];
  // Reasonable per-call output estimate for the token bucket. The agent answer
  // is short relative to its ~12K-token input window; reconcile() corrects it
  // to the real output count once usage is available.
  const OUT_TOKENS_EST = 2000;

  for (const probe of probes) {
    const runs = {};
    const usageByTarget = {};
    for (const target of TARGET_LIST) {
      const inEst = estimateTokens(candidate.prompt) + estimateTokens(probe.query || '');
      if (bucket && bucket[target] && typeof bucket[target].acquire === 'function') {
        await bucket[target].acquire({ inTokens: inEst, outTokens: OUT_TOKENS_EST, target });
      }
      const r = await evaluateCandidate({ promptText: candidate.prompt, probe, target });
      runs[target] = r;
      usageByTarget[target] = r.usage ?? null;
      // M3 reconcile estimate→actual when the runner surfaced real usage. The
      // dry-run / test stubs omit usage → skip (no-op, no throw).
      const agentUsage = r.usage?.agent;
      if (
        bucket && bucket[target] && typeof bucket[target].reconcile === 'function' &&
        agentUsage &&
        (typeof agentUsage.input_tokens === 'number' || typeof agentUsage.output_tokens === 'number')
      ) {
        bucket[target].reconcile({
          inTokens: typeof agentUsage.input_tokens === 'number' ? agentUsage.input_tokens : undefined,
          outTokens: typeof agentUsage.output_tokens === 'number' ? agentUsage.output_tokens : undefined,
        });
      }
      runsByTarget[target].push(toProbeRun(r, probe));
    }
    const mm = maximinPerProbe(runs.sonnet.score, runs.gpt5_5.score);
    probeIds.push(probe.id);
    perProbeMaximin.push(mm);
    scores[probe.id] = mm;
    sonnetScores.push(runs.sonnet.score);
    gptScores.push(runs.gpt5_5.score);
    detail[probe.id] = {
      sonnet: { score: runs.sonnet.score, traj: runs.sonnet.trajectory || { toolCalls: [], answer: '' }, usage: usageByTarget.sonnet },
      gpt5_5: { score: runs.gpt5_5.score, traj: runs.gpt5_5.trajectory || { toolCalls: [], answer: '' }, usage: usageByTarget.gpt5_5 },
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
 * @returns {{ taskScore:number, efficiencyFactor:number, lengthPenalty:number, finalScore:number }}
 */
export function computeFinalScoreFor({ perProbeMaximin, weights, runsByTarget, tokenCount }) {
  const ts = taskScore({ perProbeMaximin, weights });
  const ef = efficiencyFactor({ perTarget: runsByTarget }).factor;
  const lp = lengthPenalty(tokenCount);
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
}) {
  const tokenCount = estimateTokens(prompt);
  const scored = await scoreCandidateOnProbes({ candidate: { prompt }, probes, evaluateCandidate, bucket });
  const fs = computeFinalScoreFor({
    perProbeMaximin: scored.perProbeMaximin,
    weights: weights ?? scored.probeIds.map(() => 1),
    runsByTarget: scored.runsByTarget,
    tokenCount,
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
