/**
 * Phase 7 — MAP-Elites behavioral-descriptor archive (OPT-IN search substrate).
 *
 * Quality-Diversity (QD) alternative to the per-probe Pareto front
 * (`gepa-pareto.mjs`). Recommended by `project_p7_operator_research_2026_05`
 * ("OP-A Behavior-Descriptor MAP-Elites archive") as the structural fix for the
 * three failure modes the plain cost-aware Pareto substrate exhibits once
 * accuracy saturates:
 *
 *   1. FRONT COLLAPSE — per-probe `dominates()` reduces to "cheapest wins" when
 *      every front member scores ~1.0 on every probe, so one member dominates
 *      all and the non-dominated set collapses to a singleton (observed gen-3
 *      run p7-gen3-r1b). MAP-Elites bins by BEHAVIOR, so distinct behavioral
 *      niches each keep an elite — the front cannot collapse to one point.
 *   2. lengthPenalty BLIND SPOT — `dominates()` compares `scores` + `costUsd`
 *      but ignores `lengthPenalty`, so it can evict the higher-FINALSCORE member
 *      for a marginally-cheaper-but-longer one (the r1b merge evicted A despite
 *      A's higher finalScore). In-bin competition here uses `finalScore`, which
 *      INCLUDES lengthPenalty — the blind spot is closed by construction.
 *   3. PARENT STARVATION — `selectParent()` is finalScore-weighted, biasing
 *      parent selection toward the champion, so the search never leaves the
 *      champion's behavioral neighborhood (the gen-2 plateau root cause per
 *      `project_p7_gen2_postmortem`). MAP-Elites samples parents UNIFORMLY
 *      across occupied bins, so cheap-but-distinct behaviors get equal airtime.
 *
 * SAFETY: this module is pure (no I/O, no async). It is engaged ONLY when the
 * caller sets `selectionMode === 'map-elites'`. The default `'pareto'` path in
 * gepa.mjs never imports/invokes any of this — the existing substrate stays
 * byte-identical. Resume-determinism is preserved WITHOUT new persistence: the
 * archive is a DERIVED VIEW over the checkpointed `front` list (re-binning is
 * pure + deterministic), so a resumed run re-binning `ckpt.front` reaches the
 * same archive as an uninterrupted one.
 *
 * Descriptor rationale + tuning: see docs/PHASE7.md §3.8 (MAP-Elites amendment).
 */

import { DEFAULTS } from './p7-shared.mjs';

// ─── tool-family classification (mirrors gepa-evaluate.classifyToolUse) ─────
//
// Kept LOCAL + tiny so this module stays dependency-light (gepa-evaluate.mjs
// pulls in the whole agent runtime). The regexes are byte-identical to
// gepa-evaluate.mjs's SS_TOOL_RE / NATIVE_SEARCH_RE / NATIVE_READ_RE; a unit
// test pins them equal so they can't drift.
const SS_TOOL_RE = /\bss-(search|find|semantic|trace|grep|read)\b/i;
const NATIVE_SEARCH_RE = /\b(rg|ripgrep|grep|egrep|fgrep|ag|ack)\b/i;
const NATIVE_READ_RE = /\b(cat|head|tail|less|more|nl)\b/i;

/**
 * True iff a single tool-call entry ({name, input:{command}}) used a NATIVE
 * shell search/read family (grep/find/cat/…) rather than an `ss-*` tool. The ss
 * guard wins first (ss-grep / ss-read are NOT native). `find`/`xargs`/`ls` are
 * caught by NATIVE_SEARCH_RE's neighbours below for the no-match spiral signal.
 */
function isNativeFallbackCall(tc) {
  const name = typeof tc?.name === 'string' ? tc.name : '';
  const cmd = typeof tc?.input?.command === 'string' ? tc.input.command : '';
  const hay = `${name} ${cmd}`;
  if (SS_TOOL_RE.test(hay)) return false;
  if (NATIVE_SEARCH_RE.test(hay)) return true;
  // The no-match spiral defects into find/xargs/ls/cat after index probes empty
  // (DIVERSE-SEED RESEARCH 2026-05-31: 67% of A's raw shell is in no-match).
  if (/\b(find|xargs|ls)\b/i.test(hay)) return true;
  if (name === 'Read' || NATIVE_READ_RE.test(hay)) return true;
  return false;
}

const TARGETS = ['sonnet', 'gpt5_5'];

function _median(xs) {
  const s = xs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function _mean(xs) {
  const s = xs.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
}
function _callsOf(d) {
  const tc = d?.traj?.toolCalls;
  return Array.isArray(tc) ? tc.length : 0;
}

// ─── behavioral descriptors (computed from candidate.detail, NOT prompt text) ─

/**
 * Compute the 3 behavioral descriptors for a candidate from its per-(probe,
 * target) trajectories joined with probe strata. Text is deliberately NOT used
 * (text-binning recreates the cosmetic-diversity trap the postmortem named).
 *
 *   d1  medianToolCalls    — median total tool-calls-to-answer over ALL
 *                            (probe,target) runs. The postmortem shows candidate
 *                            ranking is monotonic in trajectory length, so this
 *                            is the cleanest single behavioral cost axis.
 *   d2  noMatchCalls       — mean tool-calls on no-match-stratum probes, taken
 *                            on the WORSE (more-spiraling) target per probe. This
 *                            is THE validated headroom lever (Candidate A halved
 *                            the no-match Sonnet spiral 16.2→6.4); it earns its
 *                            own axis. Falls back to d1's value when the probe set
 *                            has no no-match stratum (keeps the descriptor total).
 *   d3  nativeFallbackRate — fraction of (probe,target) runs that reached for a
 *                            native grep/find/cat family instead of ss-* (the
 *                            re-search / raw-shell-fallback signature; 67% of it
 *                            lives in the no-match spiral).
 *
 * @param {object} candidate  buildCandidate() output (needs `detail`)
 * @param {Record<string,{stratum?:string}>} [stratumById]  probe-id → probe record
 *        (or anything carrying `.stratum`); used to find the no-match probes.
 * @returns {{ medianToolCalls:number, noMatchCalls:number, nativeFallbackRate:number }}
 */
export function computeDescriptors(candidate, stratumById = {}) {
  const detail = candidate?.detail && typeof candidate.detail === 'object' ? candidate.detail : {};
  const allCalls = [];
  const noMatchPerProbe = [];
  let nativeRuns = 0;
  let totalRuns = 0;

  for (const pid of Object.keys(detail)) {
    const stratum = stratumById?.[pid]?.stratum ?? candidate?.stratumById?.[pid] ?? null;
    const perTargetCalls = [];
    for (const target of TARGETS) {
      const d = detail[pid]?.[target];
      if (!d) continue;
      const calls = _callsOf(d);
      allCalls.push(calls);
      perTargetCalls.push(calls);
      totalRuns += 1;
      const tcs = Array.isArray(d?.traj?.toolCalls) ? d.traj.toolCalls : [];
      if (tcs.some(isNativeFallbackCall)) nativeRuns += 1;
    }
    if (stratum === 'no-match' && perTargetCalls.length > 0) {
      // worse (more-spiraling) target = the binding behavior, model-agnostic.
      noMatchPerProbe.push(Math.max(...perTargetCalls));
    }
  }

  const medianToolCalls = _median(allCalls);
  return {
    medianToolCalls,
    noMatchCalls: noMatchPerProbe.length > 0 ? _mean(noMatchPerProbe) : medianToolCalls,
    nativeFallbackRate: totalRuns > 0 ? nativeRuns / totalRuns : 0,
  };
}

// ─── binning ────────────────────────────────────────────────────────────────

/**
 * Index of the bin `value` falls into for an ascending `edges` array.
 * Bin i covers (edges[i-1], edges[i]]; the last bin is (edges[last], ∞). So
 * `edges=[3,5,8,12]` ⇒ 5 bins: ≤3, (3,5], (5,8], (8,12], >12.
 */
export function binIndex(value, edges) {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  for (let i = 0; i < edges.length; i++) {
    if (v <= edges[i]) return i;
  }
  return edges.length;
}

/**
 * Discretize descriptors into an integer bin coordinate per axis and a stable
 * string key. `config` defaults to DEFAULTS.mapElites.bins.
 *
 * @returns {{ coord:[number,number,number], key:string }}
 */
export function binKey(descriptors, config = DEFAULTS.mapElites.bins) {
  const coord = [
    binIndex(descriptors.medianToolCalls, config.medianToolCalls),
    binIndex(descriptors.noMatchCalls, config.noMatchCalls),
    binIndex(descriptors.nativeFallbackRate, config.nativeFallbackRate),
  ];
  return { coord, key: coord.join(':') };
}

/** Squared Euclidean distance between two integer bin coordinates. */
function coordDist2(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

// ─── archive (derived VIEW over the front list) ─────────────────────────────

/**
 * Bin a `front` list into a MAP-Elites archive: `key → { key, coord, elite }`
 * where `elite` is the single best front member in that bin. "Best" = the
 * in-bin objective (`betterInBin`): accuracy non-regression THEN finalScore.
 * When two members collide in a bin only the better is the elite; the archive is
 * a SELECTION view, so the loser staying in `front` is harmless (it converges to
 * one-per-bin as evolution proceeds).
 *
 * Deterministic: ties (identical finalScore + taskScore) break on `id` then
 * `hash` so re-binning the same front always yields the same elites.
 *
 * @param {object[]} front
 * @param {Record<string,object>} stratumById  probe-id → probe record (for descriptors)
 * @param {object} [config]  DEFAULTS.mapElites
 * @returns {Map<string,{key:string,coord:number[],elite:object,descriptors:object}>}
 */
export function buildArchive(front, stratumById = {}, config = DEFAULTS.mapElites) {
  const archive = new Map();
  for (const member of Array.isArray(front) ? front : []) {
    const descriptors = computeDescriptors(member, stratumById);
    const { coord, key } = binKey(descriptors, config.bins);
    const incumbent = archive.get(key);
    if (!incumbent || betterInBin(member, incumbent.elite, config)) {
      archive.set(key, { key, coord, elite: member, descriptors });
    }
  }
  return archive;
}

/**
 * In-bin competition objective (2026-05-31): a challenger beats the bin's
 * incumbent iff it does NOT meaningfully regress accuracy (taskScore ≥
 * incumbent.taskScore − accuracyFloorSlack) AND has a strictly higher
 * `finalScore`. Using finalScore — which folds in lengthPenalty + the
 * native-relative efficiency factor — is the deliberate fix for the plain
 * `dominates()` lengthPenalty blind spot. The accuracy floor is the in-bin
 * analogue of the global 0.15 cap: it stops a "cheap because it gave up" prompt
 * from colonising an elite slot. Deterministic tie-break on id then hash so
 * archive admission is reproducible on resume.
 */
export function betterInBin(challenger, incumbent, config = DEFAULTS.mapElites) {
  if (!incumbent) return true;
  if (!challenger) return false;
  const slack = config.accuracyFloorSlack ?? 0.02;
  const cTask = typeof challenger.taskScore === 'number' ? challenger.taskScore : -Infinity;
  const iTask = typeof incumbent.taskScore === 'number' ? incumbent.taskScore : -Infinity;
  // Accuracy non-regression gate.
  if (cTask < iTask - slack) return false;
  const cFin = typeof challenger.finalScore === 'number' ? challenger.finalScore : -Infinity;
  const iFin = typeof incumbent.finalScore === 'number' ? incumbent.finalScore : -Infinity;
  if (cFin !== iFin) return cFin > iFin;
  // Exact finalScore tie → stable, content-deterministic order (never "newer wins").
  const cid = String(challenger.id ?? '');
  const iid = String(incumbent.id ?? '');
  if (cid !== iid) return cid < iid;
  return String(challenger.hash ?? '') < String(incumbent.hash ?? '');
}

// ─── archive admission (drop-in for attemptParetoAdmission) ─────────────────

/**
 * Place `candidate` into its behavioral bin and update the `front` list. Returns
 * the SAME shape as `attemptParetoAdmission` so gepa.mjs's downstream
 * checkpoint + event-append code is shared verbatim:
 *   { admitted, reason, target_degraded, drop, incumbent, evicted, newFront }
 *
 * Rules:
 *   - Empty bin → ALWAYS admit (colonising a new behavioral niche is the whole
 *     point of QD; never reject novelty on cost grounds).
 *   - Occupied bin → admit iff `betterInBin(candidate, elite)`; on admission the
 *     displaced elite is evicted from `front`.
 *   - Exact-hash + whitespace near-duplicate of any front member → reject (same
 *     anti-clone guard as the Pareto path; the loop also guards pre-screen).
 *   - frontSize safety cap: if colonising would overflow, evict the global
 *     lowest-finalScore elite (weakest niche) so the archive stays bounded.
 *
 * @param {object} args
 * @param {object} args.candidate
 * @param {object[]} args.front
 * @param {Record<string,object>} args.stratumById  probe-id → probe record
 * @param {(a:string,b:string)=>boolean} [args.isNearDuplicate]  injected from p7-shared
 * @param {number} [args.frontSize]
 * @param {object} [args.config]  DEFAULTS.mapElites
 */
export function attemptArchiveAdmission({
  candidate,
  front,
  stratumById = {},
  isNearDuplicate = () => false,
  frontSize = DEFAULTS.paretoFrontSize,
  config = DEFAULTS.mapElites,
}) {
  const f = Array.isArray(front) ? front : [];
  const reject = (reason) => ({ admitted: false, reason, target_degraded: [], drop: null, incumbent: null, evicted: [], newFront: f });

  // Anti-clone guards (parity with attemptParetoAdmission).
  if (candidate.hash && f.some((inc) => inc.hash === candidate.hash)) return reject('dominated');
  if (typeof candidate.prompt === 'string'
    && f.some((inc) => typeof inc.prompt === 'string' && isNearDuplicate(candidate.prompt, inc.prompt))) {
    return reject('near-duplicate');
  }

  const candKey = binKey(computeDescriptors(candidate, stratumById), config.bins).key;
  const archive = buildArchive(f, stratumById, config);
  const slot = archive.get(candKey);

  if (slot && slot.elite) {
    if (!betterInBin(candidate, slot.elite, config)) {
      // Loses its own bin → not admitted. `incumbent` records the bin elite it
      // failed to beat (telemetry parity with the Pareto displaced-incumbent).
      return { admitted: false, reason: 'dominated', target_degraded: [], drop: null, incumbent: slot.elite.id ?? null, evicted: [], newFront: f };
    }
    // Wins its bin → evict the displaced elite, insert the challenger.
    const newFront = f.filter((x) => x !== slot.elite);
    newFront.push(candidate);
    return { admitted: true, reason: null, target_degraded: [], drop: null, incumbent: slot.elite.id ?? null, evicted: [slot.elite.id], newFront };
  }

  // Empty bin → colonise. Respect the frontSize safety cap.
  let newFront = f.slice();
  const evicted = [];
  newFront.push(candidate);
  while (newFront.length > frontSize) {
    // Evict the weakest elite (lowest finalScore; stable on id) — the least
    // valuable niche. With this population this rarely fires.
    const victim = newFront.reduce((lo, x) => {
      const lf = typeof lo.finalScore === 'number' ? lo.finalScore : Infinity;
      const xf = typeof x.finalScore === 'number' ? x.finalScore : Infinity;
      if (xf !== lf) return xf < lf ? x : lo;
      return String(x.id ?? '') < String(lo.id ?? '') ? x : lo;
    }, newFront[0]);
    if (victim === candidate && newFront.length > 1) {
      // Never evict the just-admitted colonist while a weaker elite exists.
      const alt = newFront.filter((x) => x !== candidate).reduce((lo, x) => {
        const lf = typeof lo.finalScore === 'number' ? lo.finalScore : Infinity;
        const xf = typeof x.finalScore === 'number' ? x.finalScore : Infinity;
        return xf < lf ? x : lo;
      });
      newFront = newFront.filter((x) => x !== alt);
      evicted.push(alt.id);
    } else {
      newFront = newFront.filter((x) => x !== victim);
      evicted.push(victim.id);
    }
  }
  return { admitted: true, reason: null, target_degraded: [], drop: null, incumbent: null, evicted, newFront };
}

// ─── parent selection (uniform over occupied bins, optionally novelty-biased) ─

/**
 * Sample a parent UNIFORMLY across OCCUPIED behavioral bins (the champion-bias
 * fix). Deterministic given the injected `rng`: occupied bins are sorted by key
 * before sampling so the same (front, rng) always returns the same parent —
 * resume-safe.
 *
 * With `config.noveltyBias > 0`, bins are weighted by descriptor-space sparsity
 * (mean distance to other occupied bins, raised to `noveltyBias`) so isolated
 * behaviors get a gentle boost. `noveltyBias === 0` (default) is pure uniform.
 *
 * @param {object} args
 * @param {object[]} args.front
 * @param {()=>number} args.rng
 * @param {Record<string,object>} [args.stratumById]
 * @param {object} [args.config]  DEFAULTS.mapElites
 * @returns {object} the elite of the chosen bin
 */
export function selectParentMapElites({ front, rng, stratumById = {}, config = DEFAULTS.mapElites }) {
  if (!Array.isArray(front) || front.length === 0) {
    throw new RangeError('selectParentMapElites: front must be a non-empty array');
  }
  if (typeof rng !== 'function') throw new TypeError('selectParentMapElites: rng must be a function');
  const archive = buildArchive(front, stratumById, config);
  const cells = [...archive.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (cells.length === 0) {
    // Degenerate (no descriptors) — fall back to a deterministic pick.
    return front[0];
  }
  if (cells.length === 1) return cells[0].elite;

  const noveltyBias = config.noveltyBias ?? 0;
  let weights;
  if (noveltyBias > 0) {
    weights = cells.map((c) => {
      const others = cells.filter((o) => o !== c);
      const meanDist = others.length
        ? others.reduce((s, o) => s + Math.sqrt(coordDist2(c.coord, o.coord)), 0) / others.length
        : 1;
      // +1 floor so a duplicate-coordinate bin still has positive weight.
      return Math.pow(meanDist + 1, noveltyBias);
    });
  } else {
    weights = cells.map(() => 1);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < cells.length; i++) {
    r -= weights[i];
    if (r <= 0) return cells[i].elite;
  }
  return cells[cells.length - 1].elite;
}

// ─── coverage / QD telemetry (reporting only) ───────────────────────────────

/**
 * Archive coverage stats for logging + the convergence record:
 *   occupiedBins   — number of distinct behavioral niches held
 *   qdScore        — sum of elite finalScores (the QD-score; rewards BOTH
 *                    quality and coverage, the standard MAP-Elites health metric)
 *   bestFinalScore — the global champion's finalScore (so the existing
 *                    joint_best convergence signal is unchanged)
 *
 * @param {Map} archive  buildArchive() output
 */
export function archiveStats(archive) {
  const cells = archive instanceof Map ? [...archive.values()] : [];
  let qdScore = 0;
  let bestFinalScore = -Infinity;
  for (const c of cells) {
    const fs = typeof c.elite?.finalScore === 'number' ? c.elite.finalScore : 0;
    qdScore += fs;
    if (fs > bestFinalScore) bestFinalScore = fs;
  }
  return { occupiedBins: cells.length, qdScore, bestFinalScore: bestFinalScore === -Infinity ? null : bestFinalScore };
}

// ─── optional: island migration + reset-on-convergence (documented helpers) ─
//
// The research recommended an island model (2-3 archives, periodic elite
// migration) + CMA-ME reset-on-convergence. With a ≤6-member population both are
// borderline OVER-ENGINEERING (you cannot meaningfully shard ~5 elites into 3
// islands), so island ORCHESTRATION is a documented follow-up (PHASE7 §3.8
// "Risks & follow-ups"). These pure helpers exist so the scaffolding is tested
// and ready, but the default loop does NOT run them.

/**
 * Migrate the top `fraction` of one archive's elites into another (ring
 * migration). Returns a NEW front list for `dest` (does not mutate inputs).
 * Migrants compete via `betterInBin`, so a migrant only lands if it would win
 * (or colonise) its bin in the destination.
 */
export function migrateElites({ srcFront, destFront, stratumById = {}, fraction = 0.1, config = DEFAULTS.mapElites, isNearDuplicate = () => false }) {
  const src = (Array.isArray(srcFront) ? srcFront : []).slice().sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
  const k = Math.max(1, Math.round(src.length * fraction));
  let front = Array.isArray(destFront) ? destFront.slice() : [];
  for (const migrant of src.slice(0, k)) {
    const r = attemptArchiveAdmission({ candidate: migrant, front, stratumById, isNearDuplicate, config });
    if (r.admitted) front = r.newFront;
  }
  return front;
}

/**
 * CMA-ME-style reset signal: true when the archive has CONVERGED — coverage has
 * stalled (no new bin occupied) for `stallRounds` AND the QD-score gain over the
 * window is below `qdDelta`. A reset would re-seed the search (e.g. perturb the
 * champion into fresh bins). The loop's existing patience/plateau machinery is
 * the production stop; this is a finer-grained QD-specific signal, exposed for a
 * follow-up that wants archive-aware restarts.
 *
 * @param {Array<{occupiedBins:number, qdScore:number}>} history  per-round stats
 */
export function shouldResetArchive(history, { stallRounds = 5, qdDelta = 0.01 } = {}) {
  const w = (Array.isArray(history) ? history : []).slice(-stallRounds);
  if (w.length < stallRounds) return false;
  const coverageStalled = w.every((h) => h.occupiedBins === w[0].occupiedBins);
  const qdGain = (w[w.length - 1]?.qdScore ?? 0) - (w[0]?.qdScore ?? 0);
  return coverageStalled && qdGain < qdDelta;
}
