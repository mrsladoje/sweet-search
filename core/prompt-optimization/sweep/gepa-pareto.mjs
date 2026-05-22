/**
 * Phase 7 — GEPA Pareto front management, parent selection, and per-round slot
 * planning (§3.1, §3.2, §3.7.1).
 *
 * Pure functions (no I/O, no async) so the front decisions are exhaustively
 * unit-testable. The 0.15 admission cap is delegated to the LANDED
 * `eas.paretoAdmissible` (anti-utopia-point fix per GPT-5.5 review §C1) — this
 * module only decides *which incumbent is displaced* and feeds it as the
 * baseline.
 */

import { DEFAULTS } from './p7-shared.mjs';
import { paretoAdmissible } from './eas.mjs';
import { populationVariance } from './gepa-scoring.mjs';

// ─── two-objective dominance (finalScore × sharpnessScore) ──────────────────

/**
 * Does `a` Pareto-dominate `b` on (finalScore max, sharpnessScore max)?
 * §3.7.1 step 8: the front orders on finalScore and 1−sharpness.
 */
export function dominates(a, b) {
  const fa = a.finalScore;
  const fb = b.finalScore;
  const sa = a.sharpnessScore ?? 1.0;
  const sb = b.sharpnessScore ?? 1.0;
  return fa >= fb && sa >= sb && (fa > fb || sa > sb);
}

// ─── admission (§3.7.1 step 9) ──────────────────────────────────────────────

/**
 * Decide whether `candidate` enters the Pareto front, honoring:
 *   1. Would-enter gate: an empty slot, or strictly beating ≥1 incumbent's
 *      finalScore (§3.3 cheap pre-check).
 *   2. Displaced-incumbent baseline: the dominated incumbent it would evict
 *      (lowest finalScore among those it dominates), else the current
 *      joint-best — NEVER per-target maxima (§3.7.1 step 9 anti-utopia fix).
 *   3. The 0.15 cap via eas.paretoAdmissible against that baseline.
 *
 * On admission, dominated incumbents are evicted; if the front still exceeds
 * `frontSize`, the lowest-finalScore members are evicted until it fits.
 *
 * @returns {{
 *   admitted: boolean,
 *   reason: string|null,                 // PARETO_REJECTION_REASONS on reject
 *   target_degraded: string[],
 *   drop: number|null,
 *   incumbent: string|null,              // id of the baseline incumbent compared
 *   evicted: string[],
 *   newFront: object[],
 * }}
 */
export function attemptParetoAdmission({
  candidate,
  front,
  cap = DEFAULTS.paretoAdmissionCap,
  frontSize = DEFAULTS.paretoFrontSize,
}) {
  const f = Array.isArray(front) ? front : [];

  // Dedup: a prompt already on the front never re-enters (a re-selected parent
  // can yield a byte-identical deterministic mutation across rounds).
  if (candidate.hash && f.some((inc) => inc.hash === candidate.hash)) {
    return { admitted: false, reason: 'dominated', target_degraded: [], drop: null, incumbent: null, evicted: [], newFront: f };
  }

  const wouldEnter = f.length < frontSize || f.some((inc) => candidate.finalScore > inc.finalScore);
  if (!wouldEnter) {
    return { admitted: false, reason: 'dominated', target_degraded: [], drop: null, incumbent: null, evicted: [], newFront: f };
  }

  const dominated = f.filter((inc) => dominates(candidate, inc));

  // Which incumbent does the candidate displace? (§3.7.1 step 9 — anti-utopia)
  //  - If it dominates ≥1 incumbent, it is admissible iff it passes the 0.15 cap
  //    against AT LEAST ONE of them (the displaced niche). Picking the most
  //    lenient dominated incumbent is the whole point of the anti-utopia fix:
  //    a genuine joint-improver must not be rejected just because some OTHER
  //    specialist incumbent (whose niche it is NOT taking) is higher on a target.
  //  - If it dominates none (added to a non-full front), compare to the
  //    joint-best incumbent.
  const capFor = (inc) =>
    paretoAdmissible({
      candidate: { score_sonnet: candidate.score_sonnet, score_gpt5_5: candidate.score_gpt5_5 },
      baseline: { score_sonnet: inc.score_sonnet, score_gpt5_5: inc.score_gpt5_5 },
      cap,
    });
  const maxDropOf = (adm) => Math.max(adm.drop.sonnet, adm.drop.gpt5_5);

  let baselineId = null;
  if (dominated.length > 0) {
    let chosen = null;
    for (const inc of dominated) {
      const adm = capFor(inc);
      if (adm.ok) { chosen = { inc, adm }; break; }
      if (!chosen || maxDropOf(adm) < maxDropOf(chosen.adm)) chosen = { inc, adm };
    }
    baselineId = chosen.inc.id;
    if (!chosen.adm.ok) {
      return { admitted: false, reason: '0.15-cap-violation', target_degraded: chosen.adm.target_degraded, drop: maxDropOf(chosen.adm), incumbent: baselineId, evicted: [], newFront: f };
    }
  } else if (f.length > 0) {
    const jointBest = f.reduce((hi, x) => (x.finalScore > hi.finalScore ? x : hi));
    baselineId = jointBest.id;
    const adm = capFor(jointBest);
    if (!adm.ok) {
      return { admitted: false, reason: '0.15-cap-violation', target_degraded: adm.target_degraded, drop: maxDropOf(adm), incumbent: baselineId, evicted: [], newFront: f };
    }
  }

  const evicted = dominated.map((d) => d.id);
  let newFront = f.filter((inc) => !dominated.includes(inc));
  newFront.push(candidate);
  while (newFront.length > frontSize) {
    const lo = newFront.reduce((m, x) => (x.finalScore < m.finalScore ? x : m));
    newFront = newFront.filter((x) => x !== lo);
    evicted.push(lo.id);
  }

  return { admitted: true, reason: null, target_degraded: [], drop: null, incumbent: baselineId, evicted, newFront };
}

/**
 * Reduce a candidate pool to a Pareto front of at most `frontSize` members —
 * used for the initial seeding pass (no 0.15 cap; the cap is an evolution-time
 * guard). Keeps the non-dominated set, then trims by finalScore.
 */
export function buildFrontFrom(candidates, frontSize = DEFAULTS.paretoFrontSize) {
  const nd = candidates.filter((c) => !candidates.some((o) => o !== c && dominates(o, c)));
  nd.sort((a, b) => b.finalScore - a.finalScore);
  return nd.slice(0, frontSize);
}

// ─── stochastic parent selection (§3.1 step 1) ──────────────────────────────

/**
 * Sample a parent from the front, weighted by finalScore (a proxy for the
 * §3.1 "per-probe wins on Maximin × EAS final_score"). Deterministic given
 * the injected `rng`.
 */
export function selectParent({ front, rng }) {
  if (!Array.isArray(front) || front.length === 0) {
    throw new RangeError('selectParent: front must be a non-empty array');
  }
  if (typeof rng !== 'function') throw new TypeError('selectParent: rng must be a function');
  const weights = front.map((f) => Math.max(f.finalScore, 0.01));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < front.length; i++) {
    r -= weights[i];
    if (r <= 0) return front[i];
  }
  return front[front.length - 1];
}

// ─── slot-3 rotation + crossover availability (§3.2) ────────────────────────

const SLOT3_CYCLE = ['persona-pivot', 'tool-mask', 'pruner']; // OP-3 → OP-4 → OP-5

/**
 * Slot-3 operator for `round` (1-based). Cycles OP-3 → OP-4 → OP-5; the cycle
 * resets at `rotationRound` so each new probe set gets fresh exposure to all
 * three structural operators (§3.2 slot composition).
 */
export function slot3Op(round, rotationRound = DEFAULTS.rotationRound) {
  const base = round >= rotationRound ? round - rotationRound : round - 1;
  const idx = ((base % SLOT3_CYCLE.length) + SLOT3_CYCLE.length) % SLOT3_CYCLE.length;
  return SLOT3_CYCLE[idx];
}

/**
 * Find a Pareto pair with the OP-2 mismatch: one incumbent wins (≥0.8) and
 * another fails (≤0.4) on the same dev probe (§3.2 slot 2).
 *
 * @returns {{ probeId:string, winner:object, loser:object }|null}
 */
export function findCrossoverPair({ front, probeIds }) {
  for (const pid of probeIds) {
    const winners = (front || []).filter((inc) => typeof inc.scores?.[pid] === 'number' && inc.scores[pid] >= 0.8);
    const losers = (front || []).filter((inc) => typeof inc.scores?.[pid] === 'number' && inc.scores[pid] <= 0.4);
    if (winners.length && losers.length && winners[0] !== losers[0]) {
      return { probeId: pid, winner: winners[0], loser: losers[0] };
    }
  }
  return null;
}

/**
 * Per-round 3-slot mutation plan (§3.2):
 *   slot 1 → OP-1 reflective (always)
 *   slot 2 → OP-2 trajectory-crossover when a mismatch pair exists, else 2nd OP-1
 *   slot 3 → OP-3/4/5 by `slot3Op(round)`
 */
export function planSlots({ round, front, probeIds, rotationRound = DEFAULTS.rotationRound }) {
  const slots = [{ op: 'reflective', kind: 'primary' }];
  const pair = findCrossoverPair({ front, probeIds });
  slots.push(pair ? { op: 'trajectory-crossover', pair } : { op: 'reflective', kind: 'secondary' });
  slots.push({ op: slot3Op(round, rotationRound) });
  return slots;
}

// ─── rotation: pick the easiest probes to retire (§3.1) ─────────────────────

/**
 * The `count` probes with the lowest score-variance across the front — the
 * "easy" probes everyone already mastered, retired at round-11 rotation (§3.1).
 */
export function lowestVarianceProbes({ front, probeIds, count }) {
  const scored = probeIds.map((pid) => {
    const s = (front || []).map((inc) => inc.scores?.[pid]).filter((v) => typeof v === 'number');
    return { pid, variance: s.length >= 2 ? populationVariance(s) : 0 };
  });
  scored.sort((a, b) => a.variance - b.variance);
  return scored.slice(0, count).map((x) => x.pid);
}

/**
 * Plateau-breakthrough rule (§3.1): when patience would trigger, extend if any
 * step-change ≥ `plateauBreakthroughDelta` (3pp) occurred in the last 8 rounds.
 */
export function plateauBreakthrough(convergence) {
  const w = (convergence || []).slice(-8);
  for (let i = 1; i < w.length; i++) {
    if (w[i] - w[i - 1] >= DEFAULTS.plateauBreakthroughDelta) return true;
  }
  return false;
}
