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
import { populationVariance, perProbeCostUsd } from './gepa-scoring.mjs';

// ─── per-probe (canonical-GEPA) search-front dominance ──────────────────────

/**
 * SEARCH-front dominance (2026-05-29 canonical-GEPA rewrite, replacing the old
 * scalar (finalScore × sharpnessScore) relation that collapsed the front to a
 * singleton; 2026-05-30 cost-aware extension below). `a` dominates `b` iff `a`
 * scores ≥ `b` on EVERY shared probe AND `a` is no more expensive than `b`, with
 * a strict win on at least one dimension — a true (per-probe accuracy, cost)
 * Pareto relation. It cannot collapse the front, because a candidate survives if
 * it wins ANY probe OR is cheaper, preserving the diversity mutation operators
 * need as parents.
 *
 * **Cost is part of the relation (2026-05-30).** Accuracy saturates on a mature
 * front, so an accuracy-ONLY relation let a PRICIER candidate dominate + EVICT a
 * cheaper equally-accurate incumbent: gen-2 round 2 evicted the cheap finalScore
 * leader T2 (0.294) for a costlier accuracy-dominator (0.211), regressing
 * joint_best 0.294→0.244. Folding cost in (a must be ≤ b's `costUsd` to dominate;
 * a strictly cheaper a is a dominating win) aligns the search front with the 2-D
 * (accuracy, cost) reporting front and stops cost-blind eviction. Sharpness is
 * still NOT in the relation (tie-breaker / reported reliability signal only).
 *
 * Fallback: when cost is absent on either side (dry-runs / pre-baseline fronts /
 * synthetic unit stubs) the relation degrades to the original accuracy-only form;
 * candidates lacking a per-probe score vector are compared on finalScore alone, so
 * the relation stays total for mixed-probe-set edge cases.
 */
export function dominates(a, b) {
  const pa = a?.scores;
  const pb = b?.scores;
  if (pa && pb && typeof pa === 'object' && typeof pb === 'object') {
    const probes = Object.keys(pa).filter((p) => typeof pa[p] === 'number' && typeof pb[p] === 'number');
    if (probes.length > 0) {
      let allGE = true;
      let anyGT = false;
      for (const p of probes) {
        if (pa[p] < pb[p]) { allGE = false; break; }
        if (pa[p] > pb[p]) anyGT = true;
      }
      if (!allGE) return false;
      // Cost as an additional minimize-objective (only when BOTH are comparable).
      const ca = a?.costUsd;
      const cb = b?.costUsd;
      if (typeof ca === 'number' && typeof cb === 'number') {
        if (ca > cb) return false;   // a is pricier → cannot dominate b
        if (ca < cb) anyGT = true;   // a is strictly cheaper → a dominating advantage
      }
      return anyGT;
    }
  }
  return typeof a?.finalScore === 'number' && typeof b?.finalScore === 'number' && a.finalScore > b.finalScore;
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
    // M1(b): deterministic displaced-incumbent selection. Among dominated
    // incumbents that PASS the 0.15 cap, pick by a STABLE key (lowest
    // finalScore, then id) instead of "first to pass" — otherwise the recorded
    // displaced incumbent is array-order-dependent and can differ on re-run,
    // making PARETO_UPDATE telemetry non-reproducible. If none pass, the
    // rejection records the LEAST-violating incumbent (also stably ordered).
    const stableKey = (inc) => [inc.finalScore, String(inc.id ?? '')];
    const lessStable = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]);
    const scored = dominated.map((inc) => ({ inc, adm: capFor(inc) }));
    const passing = scored.filter((s) => s.adm.ok);
    let chosen;
    if (passing.length > 0) {
      chosen = passing.reduce((best, s) =>
        lessStable(stableKey(s.inc), stableKey(best.inc)) ? s : best);
    } else {
      // No dominated incumbent passes → reject; pick the least-violating one,
      // tie-broken by the same stable key for reproducibility.
      chosen = scored.reduce((best, s) => {
        const db = maxDropOf(best.adm);
        const ds = maxDropOf(s.adm);
        if (ds !== db) return ds < db ? s : best;
        return lessStable(stableKey(s.inc), stableKey(best.inc)) ? s : best;
      });
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
  // M5: 2-objective-aware overflow trim. Evicting the lowest-finalScore member
  // collapses the (finalScore, 1−sharpness) front toward top-6-by-finalScore,
  // dropping a Pareto-optimal robust-but-lower-finalScore variant. Instead we
  // (1) prefer to evict a member DOMINATED within the candidate front, then
  // (2) fall back to the LEAST crowding-distance member over BOTH objectives,
  // which preserves the extremes (incl. the most-robust point).
  while (newFront.length > frontSize) {
    const victim = pickOverflowVictim(newFront);
    newFront = newFront.filter((x) => x !== victim);
    evicted.push(victim.id);
  }

  return { admitted: true, reason: null, target_degraded: [], drop: null, incumbent: baselineId, evicted, newFront };
}

/**
 * Pick which member to evict when the front overflows (M5). Two-objective aware
 * over (finalScore max, taskScore max):
 *   1. If any member is dominated by another in the current set, evict the
 *      lowest-finalScore dominated one (it is strictly Pareto-inferior).
 *   2. Else evict the member with the SMALLEST crowding distance — the most
 *      redundant interior point — so the boundary extremes (highest finalScore
 *      AND highest accuracy) are retained. Boundary points get +∞ crowding
 *      and are never evicted while an interior point exists. Deterministic ties
 *      break on lowest finalScore then id.
 *
 * @param {object[]} members
 * @returns {object} the member to evict
 */
export function pickOverflowVictim(members) {
  const stable = (a, b) => (a.finalScore !== b.finalScore ? a.finalScore < b.finalScore : String(a.id ?? '') < String(b.id ?? ''));
  // (1) dominated members first.
  const dominatedSet = members.filter((m) => members.some((o) => o !== m && dominates(o, m)));
  if (dominatedSet.length > 0) {
    return dominatedSet.reduce((lo, x) => (stable(x, lo) ? x : lo));
  }
  // (2) crowding distance over both objectives.
  const crowd = crowdingDistances(members);
  let victim = members[0];
  let best = crowd.get(victim);
  for (const m of members) {
    const c = crowd.get(m);
    if (c < best || (c === best && stable(m, victim))) { victim = m; best = c; }
  }
  return victim;
}

/**
 * NSGA-II-style crowding distance over the two overflow-trim objectives
 * (finalScore, taskScore). 2026-05-29: the 2nd axis is taskScore (joint-Maximin
 * accuracy), NOT sharpness — sharpness left the scoring objective set entirely,
 * and preserving the accuracy boundary keeps the most-accurate variant during an
 * overflow trim. Boundary (min/max) members on either objective receive Infinity
 * so they are never the smallest-crowding victim while an interior member exists.
 *
 * @param {object[]} members
 * @returns {Map<object, number>}
 */
export function crowdingDistances(members) {
  const dist = new Map(members.map((m) => [m, 0]));
  if (members.length <= 2) {
    for (const m of members) dist.set(m, Infinity);
    return dist;
  }
  const objectives = [
    (m) => m.finalScore,
    (m) => (typeof m.taskScore === 'number' ? m.taskScore : m.finalScore),
  ];
  for (const obj of objectives) {
    const sorted = [...members].sort((a, b) => obj(a) - obj(b));
    const lo = obj(sorted[0]);
    const hi = obj(sorted[sorted.length - 1]);
    const range = hi - lo || 1;
    dist.set(sorted[0], Infinity);
    dist.set(sorted[sorted.length - 1], Infinity);
    for (let i = 1; i < sorted.length - 1; i++) {
      const prev = dist.get(sorted[i]);
      if (prev === Infinity) continue;
      dist.set(sorted[i], prev + (obj(sorted[i + 1]) - obj(sorted[i - 1])) / range);
    }
  }
  return dist;
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

// ─── 2-D (accuracy, cost) reporting front — HAL-style (2026-05-29) ──────────

/**
 * The 2-D accuracy–cost reporting front — SEPARATE from the per-probe search
 * front (which exists to preserve parent diversity). Objectives: maximize
 * taskScore (joint-Maximin accuracy), minimize costUsd (cache-naive dollars).
 * Returns the non-dominated set sorted by accuracy desc — the deployable
 * cost/accuracy trade-off for the paper figure + final-prompt selection. Under a
 * saturated-accuracy regime this degenerates into a spread along cost at
 * accuracy ≈ 1, which is exactly the intended "optimize cost at fixed accuracy"
 * behavior. Candidates missing either coordinate are ignored.
 * (HAL: Kapoor et al., ICLR 2026.)
 */
export function reportingFront(candidates) {
  const pts = (candidates || []).filter(
    (c) => typeof c?.taskScore === 'number' && typeof c?.costUsd === 'number',
  );
  const nd = pts.filter((c) => !pts.some((o) =>
    o !== c
    && o.taskScore >= c.taskScore && o.costUsd <= c.costUsd
    && (o.taskScore > c.taskScore || o.costUsd < c.costUsd),
  ));
  nd.sort((a, b) => b.taskScore - a.taskScore || a.costUsd - b.costUsd);
  return nd;
}

/**
 * Upper convex hull of the reporting front in (cost x, accuracy y) space,
 * INCLUDING the origin (0,0): "deploy nothing" gets 0 accuracy at 0 cost, and one
 * can randomize between any two hull agents to reach intermediate points, so the
 * achievable region is the convex hull and its upper boundary is the true
 * deployable frontier (HAL convex-hull convention). Returns hull points
 * `{ cost, acc, ref }` ordered by ascending cost; interior agents reachable by
 * interpolation are excluded. (HAL: Kapoor et al., ICLR 2026.)
 */
export function reportingConvexHull(candidates) {
  const pts = [
    { cost: 0, acc: 0, ref: null },
    ...reportingFront(candidates).map((c) => ({ cost: c.costUsd, acc: c.taskScore, ref: c })),
  ].sort((a, b) => a.cost - b.cost || a.acc - b.acc);
  // Monotone upper hull: keep counter-clockwise turns; pop a point that lies on or
  // below the chord through its neighbours (cross ≥ 0 ⇒ not above ⇒ redundant).
  const hull = [];
  for (const p of pts) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      const cross = (b.cost - a.cost) * (p.acc - a.acc) - (b.acc - a.acc) * (p.cost - a.cost);
      if (cross >= 0) hull.pop();
      else break;
    }
    hull.push(p);
  }
  return hull;
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
 * Find the OP-2 crossover pair (§3.2 slot 2). 2026-05-29 COST-AWARE rewrite:
 * accuracy saturates on a mature front, so the legacy accuracy mismatch (one
 * incumbent ≥0.8, another ≤0.4 on the same probe) essentially never exists and
 * OP-2 silently degraded to a 2nd reflective every round. The pair-finder now
 * selects on a per-probe COST mismatch among incumbents that BOTH solve the probe
 * (joint score ≥ minAccuracy) — so we never crown a "cheap because it gave up"
 * prompt as the exemplar:
 *   - WINNER (candidate A, lineage source) = the CHEAPEST such incumbent; its
 *     efficient routing is the strength the crossover propagates.
 *   - LOSER  (candidate B) = the PRICIEST such incumbent (≥ minCostRatio× the
 *     winner's per-probe $); its coverage is kept but its wasteful routing is what
 *     the merge fixes.
 * Picks the probe with the LARGEST absolute $ gap (most cost to recover);
 * deterministic by probeId on ties.
 *
 * Fallback: the legacy accuracy mismatch, used ONLY when NO incumbent exposes
 * per-probe cost data (dry-runs / pre-baseline fronts / pure-accuracy unit stubs),
 * so the relation stays useful in an accuracy-spread regime.
 *
 * @returns {{ probeId:string, winner:object, loser:object, costWinner?:number, costLoser?:number }|null}
 */
export function findCrossoverPair({
  front,
  probeIds,
  minAccuracy = DEFAULTS.crossoverMinAccuracy,
  minCostRatio = DEFAULTS.crossoverMinCostRatio,
}) {
  const f = front || [];
  let anyCostData = false;
  let best = null; // { probeId, winner, loser, costWinner, costLoser, gap }

  for (const pid of probeIds) {
    const withCost = f
      .filter((inc) => typeof inc.scores?.[pid] === 'number' && inc.scores[pid] >= minAccuracy)
      .map((inc) => ({ inc, cost: perProbeCostUsd(inc, pid) }))
      .filter((x) => typeof x.cost === 'number' && x.cost > 0);
    if (withCost.length > 0) anyCostData = true;
    if (withCost.length < 2) continue;
    withCost.sort((a, b) => (a.cost - b.cost) || String(a.inc.id ?? '').localeCompare(String(b.inc.id ?? '')));
    const cheap = withCost[0];
    const pricey = withCost[withCost.length - 1];
    if (cheap.inc === pricey.inc || pricey.cost < cheap.cost * minCostRatio) continue;
    const gap = pricey.cost - cheap.cost;
    if (!best || gap > best.gap || (gap === best.gap && String(pid) < String(best.probeId))) {
      best = { probeId: pid, winner: cheap.inc, loser: pricey.inc, costWinner: cheap.cost, costLoser: pricey.cost, gap };
    }
  }

  if (best) {
    return { probeId: best.probeId, winner: best.winner, loser: best.loser, costWinner: best.costWinner, costLoser: best.costLoser };
  }
  // Accuracy fallback only when the front carries no per-probe cost at all.
  if (anyCostData) return null;
  for (const pid of probeIds) {
    const winners = f.filter((inc) => typeof inc.scores?.[pid] === 'number' && inc.scores[pid] >= 0.8);
    const losers = f.filter((inc) => typeof inc.scores?.[pid] === 'number' && inc.scores[pid] <= 0.4);
    if (winners.length && losers.length && winners[0] !== losers[0]) {
      return { probeId: pid, winner: winners[0], loser: losers[0] };
    }
  }
  return null;
}

/**
 * m8 — detect a TRUE OP-2 balanced pair: two incumbents where each WINS one
 * production target and LOSES the other on the same probe (e.g. A wins on
 * Sonnet, B wins on GPT-5.5). A balanced crossover of such a pair can construct
 * a genuinely joint-improving child, vs the winner-vs-loser pair `findCrossoverPair`
 * returns (which only carries one direction). Requires per-target detail on the
 * incumbents (inc.detail[pid][target].score); returns null when unavailable.
 *
 * NOTE: the wiring in gepa-mutate.generateMutations currently consumes only the
 * winner-vs-loser pair from `findCrossoverPair`; this helper exposes the balanced
 * signal so a follow-up can pass both per-target trajectories of one candidate to
 * OP-2. Kept side-effect-free + tested; the orchestration upgrade is a documented
 * follow-up (the OP-2 operator already supports the balanced construction).
 *
 * @returns {{ probeId:string, sonnetWinner:object, gptWinner:object }|null}
 */
export function findBalancedPair({ front, probeIds }) {
  const f = front || [];
  for (const pid of probeIds) {
    const withDetail = f.filter((inc) => inc.detail?.[pid]?.sonnet && inc.detail?.[pid]?.gpt5_5);
    let sonnetWinner = null;
    let gptWinner = null;
    for (const inc of withDetail) {
      const sScore = inc.detail[pid].sonnet.score;
      const gScore = inc.detail[pid].gpt5_5.score;
      // A "Sonnet specialist on this probe": clearly better on Sonnet than GPT.
      if (sScore >= 0.8 && gScore <= 0.4 && (!sonnetWinner || sScore > sonnetWinner.detail[pid].sonnet.score)) sonnetWinner = inc;
      // A "GPT specialist on this probe": clearly better on GPT than Sonnet.
      if (gScore >= 0.8 && sScore <= 0.4 && (!gptWinner || gScore > gptWinner.detail[pid].gpt5_5.score)) gptWinner = inc;
    }
    if (sonnetWinner && gptWinner && sonnetWinner !== gptWinner) {
      return { probeId: pid, sonnetWinner, gptWinner };
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
  let slot3 = slot3Op(round, rotationRound);
  // m7: explicit guard so OP-5 Pruner never runs before round 3 (it needs the
  // AST-ified routing from OP-3 to exist before it can safely prune). Today this
  // is emergent from SLOT3_CYCLE ordering + runPruner's minTokens no-op, but make
  // it explicit so a future reordering can't silently prune a tiny round-1 prompt.
  if (slot3 === 'pruner' && round < 3) slot3 = 'persona-pivot';
  slots.push({ op: slot3 });
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
