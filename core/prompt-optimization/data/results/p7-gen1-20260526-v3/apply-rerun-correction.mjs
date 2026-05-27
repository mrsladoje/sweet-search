#!/usr/bin/env node
// Applies the corrected round-7 round-7 outcome (rerun + TARE) to canonical
// state: pareto-current.json + gepa-trajectory.jsonl. NO new measurements
// fired — uses the in-memory results already captured by:
//   - rerun-failed-gpt5_5.result.json (corrected finalScore + score_*)
//   - tare-rerun-candidate.result.json (measured sharpnessScore)
// Atomic write of pareto-current.json (write to .tmp, rename). Trajectory
// gets new amendment events appended at the tail.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attemptParetoAdmission } from '../../../sweep/gepa-pareto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN_DIR = __dirname;
const TARGET_HASH = '0xb44adf7c5563cd99';
const PARENT_HASH = '0x06e10aca321f2927';

async function readJsonl(p) {
  const txt = await fs.readFile(p, 'utf8');
  return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const paretoPath = path.join(RUN_DIR, 'pareto-current.json');
  const trajPath = path.join(RUN_DIR, 'gepa-trajectory.jsonl');

  const pareto = JSON.parse(await fs.readFile(paretoPath, 'utf8'));
  const rerun = JSON.parse(await fs.readFile(path.join(RUN_DIR, 'rerun-failed-gpt5_5.result.json'), 'utf8'));
  const tare = JSON.parse(await fs.readFile(path.join(RUN_DIR, 'tare-rerun-candidate.result.json'), 'utf8'));
  const promptBank = await readJsonl(path.join(RUN_DIR, 'prompt-bank.jsonl'));

  const promptEntry = promptBank.find((r) => r._kind === 'prompt' && r.hash === TARGET_HASH);
  if (!promptEntry) throw new Error(`prompt-bank: ${TARGET_HASH} not found`);

  // Build the new front entry. scores/detail are intentionally empty — the
  // aggregate has been recomputed from the rerun's per-probe measurements
  // (24 live + 56 cached). If a gen-2 run needs scores/detail for OP-1 / OP-2,
  // re-measure live (see _amendment.note).
  const cs = rerun.candidate_summary;
  const newMember = {
    id: 'T2-r1-reflective-r3-reflective-r7-trajectory-crossover',
    hash: TARGET_HASH,
    prompt: promptEntry.text,
    tokenCount: cs.tokenCount,
    sourceOp: 'trajectory-crossover',
    parentHash: PARENT_HASH,
    scores: {},
    detail: {},
    probeIds: pareto.probeSetIds,
    score_sonnet: cs.score_sonnet,
    score_gpt5_5: cs.score_gpt5_5,
    taskScore: cs.taskScore,
    efficiencyFactor: cs.efficiencyFactor,
    lengthPenalty: cs.lengthPenalty,
    finalScore: cs.finalScore,
    nativeRelative: {
      factor: cs.finalScore + cs.lengthPenalty,
      _amendment: 'rerun-corrected — perTargetFactor not preserved by surgical rerun',
    },
    sharpnessScore: tare.tare_sharpnessScore,
    _amendment: {
      kind: 'rerun-correction',
      reason: '24/40 gpt5_5 confirm calls in round 7 returned 200 OK with no usage block (OpenRouter credit exhaustion); silent-failure fallback to neutral efficiency drove finalScore from genuine ~0.575 down to recorded 0.273',
      rerun_timestamp: rerun.timestamp,
      tare_timestamp: tare.timestamp,
      live_rerun_calls: rerun.live_calls,
      cached_rerun_calls: rerun.cached_calls,
      tare_sharpness: tare.tare_sharpness,
      note: 'scores{} and detail{} maps are empty in this synthesized entry. Gen-2 runs that need per-probe data (OP-1 reflective, OP-2 crossover) should re-measure this prompt live.',
    },
  };

  // Re-run admission against the original front (drop the candidate if already
  // present — defensive).
  const baseFront = (pareto.front || []).filter((m) => m.hash !== TARGET_HASH);
  const adm = attemptParetoAdmission({ candidate: newMember, front: baseFront });
  console.log(`[apply] admission verdict: ${adm.admitted ? 'ADMITTED' : 'REJECTED ('+adm.reason+')'}`);
  console.log(`[apply]   incumbent baseline: ${adm.incumbent}`);
  console.log(`[apply]   evicted: ${JSON.stringify(adm.evicted)}`);
  if (!adm.admitted) {
    console.error('[apply] FATAL: admission unexpectedly rejected — refusing to mutate canonical state.');
    process.exit(1);
  }

  // Patience: per gepa.mjs lines 469-473, patienceCounter resets when
  // best-now strictly improves on prev-best by > DEFAULTS.patienceDelta.
  // Going from 0.4235 → 0.5745 is a clear improvement → reset to 0.
  const newJointBest = adm.newFront.reduce((hi, m) => (m.finalScore > hi ? m.finalScore : hi), -Infinity);
  const prevJointBest = (pareto.convergence || []).slice(-1)[0] ?? -Infinity;
  const patienceReset = newJointBest - prevJointBest > 0.0001;
  const newPatience = patienceReset ? 0 : pareto.patienceCounter;

  // Convergence trail: replace the last entry (which was logged with the
  // corrupted result) with the corrected joint-best.
  const conv = (pareto.convergence || []).slice();
  if (conv.length > 0) conv[conv.length - 1] = newJointBest;

  const newPareto = {
    ...pareto,
    front: adm.newFront,
    patienceCounter: newPatience,
    convergence: conv,
    _amendment: {
      kind: 'rerun-correction',
      timestamp: new Date().toISOString(),
      affected_round: 7,
      affected_candidate: TARGET_HASH,
      prev_jointBest: prevJointBest,
      new_jointBest: newJointBest,
      patience_reset: patienceReset,
    },
  };

  // Atomic write.
  const tmpPath = paretoPath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(newPareto, null, 2));
  await fs.rename(tmpPath, paretoPath);
  console.log(`[apply] wrote ${paretoPath} (atomic)`);
  console.log(`[apply]   front size: ${newPareto.front.length}`);
  console.log(`[apply]   jointBest: ${newJointBest.toFixed(4)} (was ${prevJointBest.toFixed(4)})`);
  console.log(`[apply]   patienceCounter: ${newPatience} (was ${pareto.patienceCounter})`);

  // Append amendment events to trajectory.
  const amendEvents = [
    {
      _kind: 'rerun-amendment',
      round: 7,
      mutation_hash: TARGET_HASH,
      reason: '24/40 gpt5_5 confirm calls returned 200 OK with no usage block (OpenRouter silent failure)',
      corrected_score_gpt5_5: cs.score_gpt5_5,
      corrected_score_sonnet: cs.score_sonnet,
      corrected_finalScore: cs.finalScore,
      prior_recorded_finalScore: 0.2731,
      live_rerun_calls: rerun.live_calls,
      cached_rerun_calls: rerun.cached_calls,
      timestamp: new Date().toISOString(),
    },
    {
      _kind: 'tare-adversarial-amendment',
      round: 7,
      mutation_hash: TARGET_HASH,
      sharpness: tare.tare_sharpness,
      sharpness_score: tare.tare_sharpnessScore,
      n_evaluations: tare.tare_evaluations.length,
      note: 'TARE ran AFTER the corrected scores via surgical script, not in-line during round 7. Original confirm taskScore failed wouldEnter gate due to silent-failure noise.',
      timestamp: new Date().toISOString(),
    },
    {
      _kind: 'pareto-update-amendment',
      round: 7,
      front: newPareto.front.map((f) => f.hash),
      added: TARGET_HASH,
      evicted: adm.evicted,
      incumbent_compared: adm.incumbent,
      timestamp: new Date().toISOString(),
    },
  ];
  const append = amendEvents.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.appendFile(trajPath, append);
  console.log(`[apply] appended ${amendEvents.length} amendment events to trajectory`);
  console.log('[apply] DONE');
}

main().catch((err) => {
  console.error('[apply] FATAL:', err);
  process.exit(1);
});
