#!/usr/bin/env node
// TARE-on-corrected-candidate: runs the adversarial paraphrase robustness
// check that the original round 7 confirm skipped (because the corrupted
// gpt5_5 score had pushed taskScore below the wouldEnter gate).
//
// 1. K=3 adversarial paraphrases of the variant prompt (TARE_GENERATOR_ROTATION
//    slot 0 = Kimi K2.6, slots 1-2 = Sonnet 4.6).
// 2. Each paraphrase scored on the screen probe set (first 8 of the round's
//    probeSet, both panels) via the real evaluateCandidate.
// 3. sharpness + sharpnessScore computed by paretoGatedTare.
// 4. Re-runs Pareto admission with the now-measured sharpnessScore.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRealEvaluateCandidate } from '../../../sweep/gepa-evaluate.mjs';
import { buildCandidate } from '../../../sweep/gepa-scoring.mjs';
import { attemptParetoAdmission } from '../../../sweep/gepa-pareto.mjs';
import { paretoGatedTare } from '../../../sweep/tare.mjs';
import { generateAdversarialParaphrases } from '../../../sweep/gepa-mutate.mjs';
import { withMutatorCallDefaults } from '../../../sweep/gepa-cli.mjs';
import { runJudge } from '../../../../../eval/agent-read-workflows/judge-runner.js';
import { DEFAULTS } from '../../../sweep/p7-shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const RUN_DIR = __dirname;
const TARGET_HASH = '0xb44adf7c5563cd99';

async function readJsonl(p) {
  const txt = await fs.readFile(p, 'utf8');
  return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  // ── inputs ──
  const probesFile = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
  const allProbes = Array.isArray(probesFile) ? probesFile : probesFile.probes;
  const nativeBaseline = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'core/prompt-optimization/data/p7-native-baseline-dev-3panel.json'), 'utf8'));
  const promptBank = await readJsonl(path.join(RUN_DIR, 'prompt-bank.jsonl'));
  const pareto = JSON.parse(await fs.readFile(path.join(RUN_DIR, 'pareto-current.json'), 'utf8'));
  const rerunResult = JSON.parse(await fs.readFile(path.join(RUN_DIR, 'rerun-failed-gpt5_5.result.json'), 'utf8'));

  const promptEntry = promptBank.find((r) => r._kind === 'prompt' && r.hash === TARGET_HASH);
  if (!promptEntry) throw new Error(`prompt not found for ${TARGET_HASH}`);
  const promptText = promptEntry.text;

  // probeSet order matters: use the run's stored probeSetIds (same order the
  // round-7 confirm + screen used) so screen-slice = first 8 here.
  const byId = Object.fromEntries(allProbes.map((p) => [p.id, p]));
  const probeSet = (pareto.probeSetIds || allProbes.map((p) => p.id)).map((id) => byId[id]).filter(Boolean);
  if (probeSet.length === 0) throw new Error('empty probeSet after lookup');
  const screenProbes = probeSet.slice(0, DEFAULTS.screenProbes);
  console.log(`[tare] probeSet=${probeSet.length}, screenProbes=${screenProbes.length} (first 8): ${screenProbes.map((p) => p.id).join(', ')}`);

  // ── injectables ──
  const evaluateCandidate = makeRealEvaluateCandidate({
    agentProvider: 'api',
    models: { sonnet: 'claude-sonnet-4-6', gpt5_5: 'gpt-5.5-instant' },
  });
  const callModel = (req) => runJudge(withMutatorCallDefaults(req));

  const taskScore = rerunResult.candidate_summary.taskScore;
  const finalScore = rerunResult.candidate_summary.finalScore;
  console.log(`[tare] candidate ${TARGET_HASH} taskScore=${taskScore.toFixed(4)} finalScore=${finalScore.toFixed(4)}`);

  // ── paretoGatedTare ──
  // Pass front task-scores; the gate checks wouldEnterParetoByTaskScore.
  // We don't have stored front taskScores in pareto-current.json so use a
  // best-effort estimate from score_sonnet/score_gpt5_5 (these were ~0.99 for
  // all 3 incumbents, so the gate WILL fire — wouldEnter=true).
  const frontTaskScores = (pareto.front || []).map((m) => ({
    taskScore: Math.min(m.score_sonnet ?? 0, m.score_gpt5_5 ?? 0),
  }));
  console.log(`[tare] front taskScores (estimated min(sonnet,gpt5_5)):`, frontTaskScores.map((f) => f.taskScore.toFixed(3)));

  let paraphraseLog = [];
  const generateParaphrases = async (prompt, k) => {
    console.log(`[tare] generating K=${k} adversarial paraphrases via LLM mutator...`);
    const t0 = Date.now();
    const out = await generateAdversarialParaphrases({ prompt, k, callModel });
    const ms = Date.now() - t0;
    console.log(`[tare]   → ${out.length} paraphrases in ${ms}ms`);
    out.forEach((p, i) => {
      const same = p === prompt;
      paraphraseLog.push({ idx: i, length: p.length, identical_to_source: same, preview: p.slice(0, 120) });
      console.log(`[tare]   paraphrase ${i + 1}: ${p.length} chars${same ? ' (identical-to-source → token-validate-fail fallback)' : ''}`);
    });
    return out;
  };

  let evalCount = 0;
  const evalLog = [];
  const evaluate = async (promptText) => {
    evalCount += 1;
    const t0 = Date.now();
    console.log(`[tare] evaluate ${evalCount} (screen ${screenProbes.length}x2) ...`);
    const sc = await buildCandidate({
      id: `tare-${evalCount}`,
      prompt: promptText,
      sourceOp: 'manual',
      parentHash: TARGET_HASH,
      probes: screenProbes,
      weights: screenProbes.map(() => 1),
      evaluateCandidate,
      nativeBaselineByTarget: nativeBaseline,
      concurrency: 6,
    });
    const ms = Date.now() - t0;
    console.log(`[tare]   → taskScore=${sc.taskScore.toFixed(4)} sonnet=${sc.score_sonnet.toFixed(3)} gpt5.5=${sc.score_gpt5_5.toFixed(3)} (${ms}ms)`);
    evalLog.push({ idx: evalCount, taskScore: sc.taskScore, score_sonnet: sc.score_sonnet, score_gpt5_5: sc.score_gpt5_5, wallMs: ms });
    return sc.taskScore;
  };

  console.log('\n[tare] running paretoGatedTare ...');
  const t0 = Date.now();
  const tare = await paretoGatedTare({
    candidate: { prompt: promptText, taskScore },
    front: frontTaskScores,
    generateParaphrases,
    evaluate,
  });
  const tareMs = Date.now() - t0;

  console.log('\n[tare] result:', tare.ran ? `sharpness=${tare.sharpness.toFixed(3)} sharpnessScore=${tare.sharpnessScore.toFixed(3)}` : 'GATE-SKIPPED');

  // ── re-admission with measured sharpness ──
  let admission = null;
  if (tare.ran) {
    const candidate = {
      id: `${TARGET_HASH}-RERUN+TARE`,
      hash: TARGET_HASH,
      score_sonnet: rerunResult.candidate_summary.score_sonnet,
      score_gpt5_5: rerunResult.candidate_summary.score_gpt5_5,
      finalScore: rerunResult.candidate_summary.finalScore,
      sharpnessScore: tare.sharpnessScore,
    };
    const front = (pareto.front || []).filter((m) => m.hash !== TARGET_HASH);
    const adm = attemptParetoAdmission({ candidate, front });
    admission = {
      admitted: adm.admitted,
      reason: adm.reason,
      target_degraded: adm.target_degraded,
      drop: adm.drop,
      incumbent: adm.incumbent,
      evicted: adm.evicted,
    };
    console.log(`\n[tare] re-admission with sharpnessScore=${tare.sharpnessScore.toFixed(3)}: ${adm.admitted ? 'ADMITTED' : 'REJECTED'}${adm.reason ? ' ('+adm.reason+')' : ''}`);
  }

  const out = {
    timestamp: new Date().toISOString(),
    target_hash: TARGET_HASH,
    elapsed_ms: tareMs,
    tare_ran: tare.ran,
    tare_sharpness: tare.ran ? tare.sharpness : null,
    tare_sharpnessScore: tare.ran ? tare.sharpnessScore : null,
    tare_evaluations: tare.ran ? tare.evaluations.map((e, i) => ({ idx: i, score: e.score, prompt_len: e.prompt.length })) : null,
    paraphrases: paraphraseLog,
    screen_evaluations: evalLog,
    re_admission: admission,
  };
  const outPath = path.join(RUN_DIR, 'tare-rerun-candidate.result.json');
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[tare] result written to ${outPath}`);
}

main().catch((err) => {
  console.error('[tare] FATAL:', err);
  process.exit(1);
});
