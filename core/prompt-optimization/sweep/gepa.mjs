/** Phase 7 GEPA loop driver: selection, mutation, mixed screen, confirm,
 * TARE, Pareto update, rotation/rebaseline, persistence, and resume. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, EVENT_KINDS, TARGET_LIST, hashContent } from './p7-shared.mjs';
import {
  appendFsynced,
  atomicWriteJSON,
  loadTrajectory,
  loadParetoCurrent,
  resumeState,
  trajectoryPath,
  promptBankPath,
  paretoCurrentPath,
} from './p7-persist.mjs';
import { rebaselineFront } from './pareto-rebaseline.mjs';
import { paretoGatedTare } from './tare.mjs';
import { buildCandidate, computeProbeWeights, topFailures, topInefficiencies, contrastiveInefficiencyPair, scoreCandidateOnProbes, runCostLatencyFields } from './gepa-scoring.mjs';
import { selectScreenProbes } from './gepa-screening.mjs';
import {
  planSlots,
  selectParent,
  attemptParetoAdmission,
  buildFrontFrom,
  lowestVarianceProbes,
  plateauBreakthrough,
  reportingFront,
} from './gepa-pareto.mjs';
import { generateMutations, generateAdversarialParaphrases } from './gepa-mutate.mjs';
import { buildReplayMap, makeResumeReplayEvaluate, buildConfirmEvent } from './gepa-finalize.mjs';
import { makeLogger } from './gepa-logger.mjs';
import { mulberry32 } from '../stats/rng.mjs';

export { makeLogger } from './gepa-logger.mjs';
export { makeDryRunEvaluate, makeDryRunCallModel } from './gepa-dry-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
export const SMOKE_PROBES_PATH = path.join(REPO_ROOT, 'core', 'prompt-optimization', 'data', 'p7-smoke-probes.json');

// ─── deterministic per-round RNG (resume-safe) ──────────────────────────────

/**
 * Per-round RNG derived from (seed, round) so a resumed run reproduces the
 * exact randomness of a fresh run for any not-yet-executed round.
 */
export function roundRng(seed, round) {
  const s = (Math.imul(seed >>> 0, 2654435761) ^ Math.imul(round, 40503)) >>> 0;
  return mulberry32(s);
}

// ─── helpers ────────────────────────────────────────────────────────────────

export function normalizeVariant(v) {
  return { id: v.id, prompt: v.prompt ?? v.body ?? '' };
}

function jointBestFinal(front) {
  return front.reduce((hi, x) => Math.max(hi, x.finalScore), -Infinity);
}

// ─── the loop ───────────────────────────────────────────────────────────────

/**
 * Run the GEPA loop. Returns the final state ({ front, convergence, rounds,
 * stoppedReason, probeSetIds }). All randomness, time, persistence paths, the
 * agent evaluator, and the model caller are injectable.
 *
 * @param {object} opts — see inline defaults; `evaluateCandidate` + `callModel`
 *   + `variants` + `devProbes` are required for a real run (the CLI supplies them).
 */
export async function runGepa(opts = {}) {
  const {
    runId = 'p7-dry',
    variants = [],
    devProbes = [],
    rotationPool = [],
    evaluateCandidate,
    callModel,
    // mutatorCallModel (optional) routes mutator operator calls through a
    // separate code path (e.g. opencode + gemini-3.1-pro-preview harness).
    // TARE adversarial paraphrasing keeps using `callModel` (direct API) for
    // cost — paraphrases are short, deterministic, and don't benefit from
    // agentic tool access. Falls back to `callModel` when not supplied so
    // tests and dry-runs continue to work with a single stub.
    mutatorCallModel,
    maxAttemptsPerSlot,
    seed = 42,
    maxRounds = DEFAULTS.maxRounds,
    hardCap = DEFAULTS.hardCapRounds,
    patience = DEFAULTS.patienceRounds,
    rotationRound = DEFAULTS.rotationRound,
    rotationSwapCount = DEFAULTS.rotationSwapCount,
    screenProbeCount = DEFAULTS.screenProbes,
    screenProbeIds = [],
    frontSize = DEFAULTS.paretoFrontSize,
    paretoCap = DEFAULTS.paretoAdmissionCap,
    resume = false,
    bucket = null,
    nativeBaselineByTarget = null,
    concurrency = 1,
    repeats = DEFAULTS.repeats,
    reflectionMode = DEFAULTS.reflectionMode,
    now = () => Date.now(),
    reflectionHint,
  } = opts;

  if (typeof evaluateCandidate !== 'function') throw new TypeError('runGepa: evaluateCandidate is required');
  if (typeof callModel !== 'function') throw new TypeError('runGepa: callModel is required');
  const mutatorCm = typeof mutatorCallModel === 'function' ? mutatorCallModel : callModel;

  const paths = opts.paths || {
    trajectory: trajectoryPath(runId),
    promptBank: promptBankPath(runId),
    paretoCurrent: paretoCurrentPath(runId),
  };
  const log = opts.log || makeLogger({ logPath: opts.logPath ?? `/tmp/${runId}-run.log`, now, enabled: opts.verbose !== false });

  // persistence closures
  const appendEvent = (ev) => appendFsynced(paths.trajectory, ev);
  const seenPrompts = new Set();
  const recordPrompt = (hash, text) => {
    if (seenPrompts.has(hash)) return;
    seenPrompts.add(hash);
    appendFsynced(paths.promptBank, { _kind: 'prompt', hash, text });
  };
  // ── B1 resume-replay layer (§7.4 "no re-spending") ──
  // On resume, build a per-(round,kind,mutation_hash,probe,target) replay map
  // from the persisted trajectory and wrap evaluateCandidate so an already-paid
  // screen/confirm call replays its score instead of re-hitting the network.
  // For a fresh run the wrapper is an identity pass-through (empty maps).
  // §7.4 resume cross-check, computed once (also feeds the B1 replay layer).
  const rs = resume ? resumeState({ trajectoryPath: paths.trajectory }) : null;
  const replayLayer = resume
    ? makeResumeReplayEvaluate({
        evaluateCandidate,
        completedStepIds: rs.completedStepIds,
        replayMap: buildReplayMap(paths.trajectory),
      })
    : makeResumeReplayEvaluate({ evaluateCandidate, completedStepIds: new Set(), replayMap: new Map() });
  const replayEvaluate = replayLayer.evaluate;
  const enterStep = replayLayer.enterStep;
  const mkCandidate = (args) => buildCandidate({ ...args, evaluateCandidate: replayEvaluate, bucket, nativeBaselineByTarget, concurrency, repeats });

  // probe lookups (resume reconstructs probe records from ids)
  const allProbes = [...devProbes, ...rotationPool];
  const allById = Object.fromEntries(allProbes.map((p) => [p.id, p]));

  let front;
  let probeSet;
  let convergence;
  let patienceCounter;
  let roundsEvaluatedByProbe;
  let startRound;
  let maxRoundsEff = maxRounds;
  let plateauExtended = false;

  // 2026-05-26: mid-ablation resume. The original guard hard-failed when
  // pareto-current.json was missing — fine for end-of-round resume, but it
  // meant a crash anywhere in the seed-ablation phase (the $60–80 bulk of a
  // gen-1 run, ~80% of cost) vaporised every completed seed. The seed loop
  // now emits B1-replayable per-(probe,target) SEED rows after each successful
  // mkCandidate, so on `--resume` we can re-enter the seed loop and the B1
  // wrapper short-circuits every already-paid call to its cached score for $0.
  let midAblationResume = false;
  if (resume) {
    const ckpt = loadParetoCurrent(paths.paretoCurrent);
    for (const ev of loadTrajectory(paths.promptBank)) {
      if (ev._kind === 'prompt' && ev.hash) seenPrompts.add(ev.hash);
    }
    if (ckpt) {
      front = ckpt.front;
      probeSet = (ckpt.probeSetIds || devProbes.map((p) => p.id)).map((id) => allById[id]).filter(Boolean);
      convergence = ckpt.convergence || [];
      patienceCounter = ckpt.patienceCounter || 0;
      roundsEvaluatedByProbe = ckpt.roundsEvaluatedByProbe || {};
      plateauExtended = ckpt.plateauExtended ?? false;
      // Honor the caller's new maxRounds; only keep a stored plateau EXTENSION
      // (never shrink to the partial run's smaller cap).
      maxRoundsEff = plateauExtended ? Math.max(maxRounds, ckpt.maxRoundsEffective ?? maxRounds) : maxRounds;
      startRound = (ckpt.lastCompletedRound ?? rs.lastRound ?? 0) + 1;
      log(`resume: checkpoint round ${ckpt.lastCompletedRound}, trajectory lastRound ${rs.lastRound}, continuing from round ${startRound}`);
    } else {
      const seedRows = loadTrajectory(paths.trajectory).filter((ev) => ev._kind === EVENT_KINDS.SEED);
      if (seedRows.length === 0) {
        // No checkpoint AND no replayable SEED rows — same fail-fast as before
        // (m2 / M9): we cannot safely reconstruct a partial front, so refuse.
        const lastPareto = rs?.paretoUpdates?.length ? rs.paretoUpdates[rs.paretoUpdates.length - 1].round : 'none';
        throw new Error(
          `runGepa --resume: no checkpoint at ${paths.paretoCurrent} ` +
          `(trajectory has ${rs?.paretoUpdates?.length ?? 0} pareto-update event(s) and 0 seed event(s), last pareto round ${lastPareto}). ` +
          `pareto-current.json is the authoritative front snapshot; restore it before resuming.`,
        );
      }
      const cachedSeeds = new Set(seedRows.map((ev) => ev.mutation_hash));
      log(`resume: mid-ablation (${cachedSeeds.size} seed(s), ${seedRows.length} (probe,target) row(s) cached), re-entering seed loop`);
      midAblationResume = true;
    }
  }

  if (!resume && opts.initialFront) {
    // Test/seed injection: start from a pre-built front (skips the seeding eval).
    probeSet = devProbes.slice();
    convergence = [];
    patienceCounter = 0;
    roundsEvaluatedByProbe = {};
    startRound = 1;
    front = opts.initialFront;
    log(`injected front: ${front.length}/${frontSize}, joint_best=${jointBestFinal(front).toFixed(3)}`);
  } else if (!resume || midAblationResume) {
    probeSet = devProbes.slice();
    convergence = [];
    patienceCounter = 0;
    roundsEvaluatedByProbe = {};
    startRound = 1;
    // ── seed front from T_i variants (§4.3) ──
    const seeds = [];
    const seedWeights = probeSet.map(() => 1.0); // round 0 < hardNegativeStartRound
    for (const v0 of variants.map(normalizeVariant)) {
      // B1: set the resume-replay context to THIS seed's ablation pass. The
      // mutation_hash IS the candidate's content hash (hashContent(prompt) ===
      // cand.hash), so the per-(probe,target) SEED rows emitted below replay
      // perfectly on `--resume`. Mid-ablation crashes used to vaporise every
      // completed seed (~$30–60); now an already-paid call replays for $0.
      const seedHash = hashContent(v0.prompt);
      enterStep({ kind: EVENT_KINDS.SEED, round: 0, mutationHash: seedHash });
      const cand = await mkCandidate({ id: v0.id, prompt: v0.prompt, sourceOp: 'seed', parentHash: null, probes: probeSet, weights: seedWeights });
      for (const probe of probeSet) {
        for (const target of TARGET_LIST) {
          const d = cand.detail?.[probe.id]?.[target];
          if (!d) continue;
          appendEvent({
            _kind: EVENT_KINDS.SEED,
            round: 0,
            mutation_hash: cand.hash,
            probe_id: probe.id,
            target,
            score: d.score,
            tool_calls: d.traj?.toolCalls?.length ?? 0,
            reps: d.reps ?? 1,
            rep_scores: d.repScores ?? null,
            input_tokens: d.usage?.agent?.input_tokens ?? null,
            output_tokens: d.usage?.agent?.output_tokens ?? null,
            ...runCostLatencyFields({ usage: d.usage, target, toolCalls: d.traj?.toolCalls?.length ?? 0 }),
          });
        }
      }
      appendEvent({ _kind: EVENT_KINDS.MUTATION, round: 0, source_op: 'seed', new_prompt_hash: cand.hash, parent_hash: null });
      recordPrompt(cand.hash, cand.prompt);
      seeds.push(cand);
    }
    enterStep(null);
    front = buildFrontFrom(seeds, frontSize);
    appendEvent({ _kind: EVENT_KINDS.PARETO_UPDATE, round: 0, front: front.map((f) => f.hash), added: null, evicted: [] });
    log(`seeded front: ${front.length}/${frontSize} from ${seeds.length} variants, joint_best=${jointBestFinal(front).toFixed(3)}`);
  }

  let stoppedReason = 'max-rounds';
  let lastRoundRun = startRound - 1;

  for (let round = startRound; round <= maxRoundsEff && round <= hardCap; round++) {
    lastRoundRun = round;
    let pendingParetoEvent = null; // M1(a): appended only AFTER the checkpoint
    const btState = plateauBreakthrough(convergence) ? 'YES' : 'NO';
    log(`round ${round} start, fronts=${front.length}, patience=${patienceCounter}/${patience}, plateau-bt=${btState}`);

    // ── round-11 rotation + Pareto re-baseline BEFORE scoring mutations (§3.1) ──
    if (round === rotationRound && rotationPool.length > 0) {
      const activeIds = probeSet.map((p) => p.id);
      const retire = lowestVarianceProbes({ front, probeIds: activeIds, count: rotationSwapCount });
      const newProbes = rotationPool.slice(0, rotationSwapCount).filter((p) => !activeIds.includes(p.id));
      const before = front.map((f) => f.id);
      const rebaseEval = async (incumbent, probe) => {
        const r = await scoreCandidateOnProbes({ candidate: { prompt: incumbent.prompt }, probes: [probe], evaluateCandidate: replayEvaluate, bucket, concurrency, repeats });
        incumbent.detail = { ...(incumbent.detail || {}), ...r.detail };
        return r.perProbeMaximin[0];
      };
      const { updatedFront, runCount } = await rebaselineFront({ front, newProbes, evaluate: rebaseEval });
      front = updatedFront;
      for (const inc of front) for (const pid of retire) delete inc.scores[pid];
      probeSet = probeSet.filter((p) => !retire.includes(p.id)).concat(newProbes);
      for (const pid of retire) delete roundsEvaluatedByProbe[pid];
      appendEvent({
        _kind: EVENT_KINDS.PARETO_REBASELINE,
        round,
        before_front: before,
        after_rebaseline_scores: Object.fromEntries(front.map((f) => [f.id, f.scores])),
        evictions: retire,
        runs: runCount,
      });
      log(`round ${round} rebaseline: retired ${retire.length} low-variance probes, re-scored ${front.length} incumbents on ${newProbes.length} new (${runCount} runs)`);
    }

    const activeIds = probeSet.map((p) => p.id);
    const probeById = Object.fromEntries(probeSet.map((p) => [p.id, p]));
    const rRng = roundRng(seed, round);

    // ── 1 selection + 2 mutation portfolio ──
    const parent = selectParent({ front, rng: rRng });
    const slots = planSlots({ round, front, probeIds: activeIds, rotationRound });
    const inefficiencies = topInefficiencies({ candidate: parent, probes: probeSet, limit: 5 });
    const failures = inefficiencies.length > 0
      ? inefficiencies
      : topFailures({ candidate: parent, probes: probeSet, limit: 5 });
    // OP-C: contrastive cheap-vs-expensive reflection input (gated by reflectionMode
    // so the scalar/attributed/contrastive ablation is runnable; default contrastive).
    const contrastive = reflectionMode === 'contrastive'
      ? contrastiveInefficiencyPair({ candidate: parent, probes: probeSet })
      : null;
    const muts = await generateMutations({ slots, parent, failures, contrastive, probeById, round, callModel: mutatorCm, rng: rRng, reflectionHint, maxAttemptsPerSlot });

    const accepted = [];
    let slotIdx = 0;
    for (const m of muts) {
      slotIdx += 1;
      if (!m.accepted) {
        const reasons = (m.rejection?.failures || []).map((f) => f.reason).join(',') || m.rejection?.reason || 'token-validation';
        appendEvent({ _kind: EVENT_KINDS.MUTATION_REJECTION, round, source_op: m.sourceOp, parent_hash: m.parentHash, reason: reasons, failures: m.rejection?.failures ?? null, attempts: m.attempts ?? 1, prior_failures: m.priorFailures ?? null });
        const attemptsTag = (m.attempts && m.attempts > 1) ? ` after ${m.attempts} attempts` : '';
        log(`round ${round} mut ${slotIdx}/${muts.length} ${m.sourceOp} REJECTED${attemptsTag} (${reasons})`);
        continue;
      }
      const hash = hashContent(m.mutated);
      appendEvent({ _kind: EVENT_KINDS.MUTATION, round, source_op: m.sourceOp, new_prompt_hash: hash, parent_hash: m.parentHash, attempts: m.attempts ?? 1, prior_failures: m.priorFailures ?? null });
      recordPrompt(hash, m.mutated);
      accepted.push({ ...m, hash });
      const attemptsTag = (m.attempts && m.attempts > 1) ? ` (on attempt ${m.attempts})` : '';
      log(`round ${round} mut ${slotIdx}/${muts.length} ${m.sourceOp} on ${parent.id} → ${hash.slice(0, 10)}${attemptsTag}`);
    }

    // ── 3 screen (mixed 8 probes × 2 targets) ──
    let survivor = null;
    if (accepted.length > 0) {
      const screenProbes = selectScreenProbes({
        probeSet,
        count: screenProbeCount,
        round,
        seed,
        explicitIds: screenProbeIds,
      });
      const screenIds = screenProbes.map((p) => p.id);
      log(`round ${round} screen probes: ${screenIds.join(',')}`);
      const screenWeights = computeProbeWeights({ front, probeIds: screenIds, round, roundsEvaluatedByProbe });
      let best = null;
      for (const m of accepted) {
        // B1: set the resume-replay context to THIS mutation's screen pass so
        // already-paid screen scores replay instead of re-spending on resume.
        enterStep({ kind: EVENT_KINDS.SCREEN, round, mutationHash: hashContent(m.mutated) });
        const cand = await mkCandidate({ id: `${parent.id}-r${round}-${m.sourceOp}`, prompt: m.mutated, sourceOp: m.sourceOp, parentHash: m.parentHash, probes: screenProbes, weights: screenWeights });
        for (const pid of screenIds) {
          for (const target of TARGET_LIST) {
            const d = cand.detail[pid][target];
            appendEvent({
              _kind: EVENT_KINDS.SCREEN,
              round,
              mutation_hash: cand.hash,
              probe_id: pid,
              target,
              score: d.score,
              tool_calls: d.traj.toolCalls.length,
              reps: d.reps ?? 1,
              rep_scores: d.repScores ?? null,
              input_tokens: d.usage?.agent?.input_tokens ?? null,
              output_tokens: d.usage?.agent?.output_tokens ?? null,
              ...runCostLatencyFields({ usage: d.usage, target, toolCalls: d.traj.toolCalls.length }),
            });
          }
        }
        log(`round ${round} screen ${m.sourceOp} ${cand.hash.slice(0, 10)} final=${cand.finalScore.toFixed(3)}`);
        if (!best || cand.finalScore > best.finalScore) best = cand;
      }

      // ── 5 confirm (full dev × 2) ──
      const fullWeights = computeProbeWeights({ front, probeIds: activeIds, round, roundsEvaluatedByProbe });
      // B1: switch the resume-replay context to the survivor's confirm pass.
      enterStep({ kind: EVENT_KINDS.CONFIRM, round, mutationHash: hashContent(best.prompt) });
      survivor = await mkCandidate({ id: best.id, prompt: best.prompt, sourceOp: best.sourceOp, parentHash: best.parentHash, probes: probeSet, weights: fullWeights });
      for (const pid of activeIds) {
        for (const target of TARGET_LIST) {
          const d = survivor.detail[pid][target];
          appendEvent({
            ...buildConfirmEvent({ round, survivor, probe: probeById[pid], pid, target, d }),
            ...runCostLatencyFields({ usage: d.usage, target, toolCalls: d.traj?.toolCalls?.length ?? 0 }),
          });
        }
      }
      log(`round ${round} confirm ${activeIds.length}×2 sonnet=${survivor.score_sonnet.toFixed(3)} gpt5.5=${survivor.score_gpt5_5.toFixed(3)} final=${survivor.finalScore.toFixed(3)}`);

      // B1: TARE paraphrases are fresh prompts (no persisted score to replay);
      // clear the replay context so TARE evals always run live.
      enterStep(null);

      // ── 6 Pareto-gated TARE ──
      const screenWeightsForTare = computeProbeWeights({ front, probeIds: screenIds, round, roundsEvaluatedByProbe });
      // M4/m3: TARE sharpness + the would-enter gate operate on the JOINT
      // MAXIMIN task score (§3.7.1 step 7), NOT finalScore. Folding EAS-factor
      // and length-penalty variation into "sharpness" would measure composite
      // brittleness instead of ANSWER brittleness.
      const tare = await paretoGatedTare({
        candidate: { prompt: survivor.prompt, taskScore: survivor.taskScore },
        front: front.map((f) => ({ taskScore: f.taskScore })),
        generateParaphrases: (prompt, k) => generateAdversarialParaphrases({ prompt, k, callModel }),
        evaluate: async (promptText) => {
          const sc = await mkCandidate({ id: 'tare', prompt: promptText, sourceOp: 'manual', parentHash: survivor.hash, probes: screenProbes, weights: screenWeightsForTare });
          return sc.taskScore;
        },
      });
      if (tare.ran) {
        survivor.sharpnessScore = tare.sharpnessScore;
        appendEvent({ _kind: EVENT_KINDS.TARE_ADVERSARIAL, round, mutation_hash: survivor.hash, sharpness: tare.sharpness, sharpness_score: tare.sharpnessScore, n: tare.evaluations.length });
        log(`round ${round} tare sharpness=${tare.sharpness.toFixed(3)} → sharpness_score=${tare.sharpnessScore.toFixed(3)}`);
      }

      // ── 7 Pareto update (0.15 admission cap) ──
      // M1(a): the front mutates here, but the PARETO_UPDATE/PARETO_REJECTION
      // event is appended AFTER the atomic checkpoint below — so a crash between
      // the append and the checkpoint can never orphan a pareto-update the
      // checkpoint (the single source of truth on resume) doesn't reflect.
      const adm = attemptParetoAdmission({ candidate: survivor, front, cap: paretoCap, frontSize });
      if (adm.admitted) {
        front = adm.newFront;
        pendingParetoEvent = { _kind: EVENT_KINDS.PARETO_UPDATE, round, front: front.map((f) => f.hash), added: survivor.hash, evicted: adm.evicted };
        log(`round ${round} pareto: ADD ${survivor.hash.slice(0, 10)}${adm.evicted.length ? `, evict ${adm.evicted.join(',')}` : ''}`);
      } else {
        pendingParetoEvent = { _kind: EVENT_KINDS.PARETO_REJECTION, round, mutation_hash: survivor.hash, reason: adm.reason, target_degraded: adm.target_degraded?.[0] ?? null, drop: adm.drop, incumbent_being_compared: adm.incumbent };
        log(`round ${round} pareto: REJECT ${survivor.hash.slice(0, 10)} (${adm.reason})`);
      }
    } else {
      log(`round ${round} no accepted mutations — front unchanged`);
    }

    // ── 9 patience / plateau-breakthrough ──
    const bestNow = jointBestFinal(front);
    const prevBest = convergence.length > 0 ? convergence[convergence.length - 1] : -Infinity;
    convergence.push(bestNow);
    if (bestNow - prevBest <= DEFAULTS.patienceDelta) patienceCounter += 1;
    else patienceCounter = 0;

    for (const pid of activeIds) roundsEvaluatedByProbe[pid] = (roundsEvaluatedByProbe[pid] || 0) + 1;

    // checkpoint (atomic) — full resumable state (§7.4)
    atomicWriteJSON(paths.paretoCurrent, {
      runId,
      lastCompletedRound: round,
      maxRoundsEffective: maxRoundsEff,
      plateauExtended,
      patienceCounter,
      convergence,
      roundsEvaluatedByProbe,
      probeSetIds: probeSet.map((p) => p.id),
      front,
    });

    // M1(a): NOW the front is durably checkpointed — append the Pareto telemetry.
    // If a crash happens before this append, resume trusts ckpt.front (which
    // already reflects the admission) and simply re-derives; no orphaned row.
    if (pendingParetoEvent) appendEvent(pendingParetoEvent);

    log(`round ${round} summary: joint_best=${bestNow.toFixed(3)} n_pareto=${front.length} patience=${patienceCounter}/${patience}`);

    if (patienceCounter >= patience) {
      if (plateauBreakthrough(convergence) && !plateauExtended) {
        plateauExtended = true;
        maxRoundsEff = Math.min(hardCap, round + DEFAULTS.plateauExtendRounds);
        patienceCounter = 0;
        log(`round ${round} plateau-breakthrough: extending ${DEFAULTS.plateauExtendRounds} rounds (to ${maxRoundsEff})`);
      } else {
        stoppedReason = 'patience';
        log(`round ${round} STOP: patience ${patienceCounter}/${patience} exhausted`);
        break;
      }
    }
  }

  if (lastRoundRun >= hardCap) stoppedReason = stoppedReason === 'patience' ? 'patience' : 'hard-cap';

  return {
    runId,
    front,
    convergence,
    rounds: lastRoundRun,
    stoppedReason,
    probeSetIds: probeSet.map((p) => p.id),
    winner: front.slice().sort((a, b) => b.finalScore - a.finalScore)[0] ?? null,
    // 2-D (accuracy, cost-$) reporting front (HAL-style) — the deployable
    // cost/accuracy trade-off for the paper + final-prompt selection, separate
    // from the per-probe search `front` above.
    reportingFront: reportingFront(front),
  };
}

// ─── CLI (delegated to gepa-cli.mjs to keep this file < 500 lines) ──────────

if (import.meta.url === `file://${process.argv[1]}`) {
  // No top-level await here: gepa-cli.mjs imports THIS module, so awaiting its
  // import before this module finishes evaluating would deadlock the ESM cycle.
  // Deferring via .then() lets gepa.mjs finish (exports ready) first.
  import('./gepa-cli.mjs')
    .then(({ mainCli }) => mainCli(process.argv.slice(2)))
    .catch((e) => {
      console.error('gepa: fatal —', e?.stack || e?.message || e);
      process.exit(1);
    });
}
