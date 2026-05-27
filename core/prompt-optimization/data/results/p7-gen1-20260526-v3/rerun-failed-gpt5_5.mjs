#!/usr/bin/env node
// Surgical rerun: re-measures only the 24 (probe, gpt5_5) pairs that silently
// failed for trajectory-crossover 0xb44adf7c5563cd99 during round 7 confirm.
// All 40 sonnet + 16 good gpt5_5 measurements are reused from the trajectory.
// Writes a report; does NOT mutate pareto-current.json or trajectory.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRealEvaluateCandidate } from '../../../sweep/gepa-evaluate.mjs';
import { buildCandidate } from '../../../sweep/gepa-scoring.mjs';
import { attemptParetoAdmission } from '../../../sweep/gepa-pareto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const RUN_DIR = __dirname;
const TARGET_HASH = '0xb44adf7c5563cd99';

async function readJsonl(p) {
  const txt = await fs.readFile(p, 'utf8');
  return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const probesFile = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
  const probes = Array.isArray(probesFile) ? probesFile : probesFile.probes;
  const nativeBaseline = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'core/prompt-optimization/data/p7-native-baseline-dev-3panel.json'), 'utf8'));
  const promptBank = await readJsonl(path.join(RUN_DIR, 'prompt-bank.jsonl'));
  const traj = await readJsonl(path.join(RUN_DIR, 'gepa-trajectory.jsonl'));
  const pareto = JSON.parse(await fs.readFile(path.join(RUN_DIR, 'pareto-current.json'), 'utf8'));

  const promptEntry = promptBank.find((r) => r._kind === 'prompt' && r.hash === TARGET_HASH);
  if (!promptEntry) throw new Error(`prompt not found for ${TARGET_HASH}`);
  const promptText = promptEntry.text;
  console.log(`[rerun] loaded variant prompt: ${promptText.length} chars, hash=${TARGET_HASH}`);

  // Pull existing round-7 confirm events for this variant.
  const confirms = traj.filter((e) => e._kind === 'confirm' && e.round === 7 && e.mutation_hash === TARGET_HASH);
  console.log(`[rerun] found ${confirms.length} prior confirm events (expect 80)`);

  // Build cache: (probe_id|target) → mock evaluateCandidate result for the GOOD measurements only.
  const cache = new Map();
  const toRerun = []; // [{probe_id, target='gpt5_5'}]
  for (const e of confirms) {
    const key = `${e.probe_id}|${e.target}`;
    const raw = e.target === 'sonnet' ? e.raw_sonnet : e.raw_gpt5_5;
    const ot = e.output_tokens || 0;
    const it = e.input_tokens || 0;
    const cr = e.cache_read_tokens || 0;
    const cc = e.cache_creation_tokens || 0;
    const billable = Math.max(0, it - (cr > 0 && cr <= it ? cr : 0));
    const work = billable + cc + ot;
    if (work === 0) {
      // Failed: re-measure
      toRerun.push({ probe_id: e.probe_id, target: e.target });
      continue;
    }
    // Good: reuse. Reconstruct the shape evaluateCandidate returns.
    // usedReadOrGrep ↔ evidence_adequacy_penalty (null/0 means evidence OK OR no answer; with tool_calls>0 it must mean evidence OK).
    // usedNativeSearch ↔ native_search_penalty > 0.
    const evidencePen = e.evidence_adequacy_penalty;
    const nativePen = e.native_search_penalty;
    cache.set(key, {
      score: raw,
      toolCalls: e.tool_calls,
      finalAnswerEmitted: raw > 0 || e.tool_calls > 0,
      usedReadOrGrep: (evidencePen == null || evidencePen === 0) && e.tool_calls > 0,
      usedSweetSearch: e.tool_calls > 0 && !(nativePen > 0),
      usedNativeSearch: nativePen > 0,
      usedNativeRead: false,
      trajectory: { toolCalls: [], answer: '[cached from prior confirm]' },
      wallMs: e.wall_ms || 0,
      usage: {
        agent: {
          model_id: e.model_id,
          api_path: e.api_path,
          temperature: e.temperature ?? null,
          input_tokens: it,
          output_tokens: ot,
          cache_read_tokens: cr,
          cache_creation_tokens: cc,
          retry_count: e.retry_count ?? 0,
        },
        judges: [],
        repo_commit: e.repo_commit,
        probe_hash: e.probe_hash,
        token_count_prompt: e.token_count_prompt,
      },
    });
  }
  console.log(`[rerun] cache: ${cache.size} good measurements; ${toRerun.length} to re-measure (all gpt5_5)`);
  if (toRerun.length === 0) {
    console.log('[rerun] nothing to do');
    return;
  }

  // Shim: dispatches to cache or real evaluator.
  const realEval = makeRealEvaluateCandidate({
    agentProvider: 'api',
    models: { sonnet: 'claude-sonnet-4-6', gpt5_5: 'gpt-5.5-instant' },
  });
  let liveCalls = 0;
  const evaluateCandidate = async ({ promptText: pt, probe, target }) => {
    const key = `${probe.id}|${target}`;
    if (cache.has(key)) return cache.get(key);
    liveCalls += 1;
    console.log(`[rerun] live measurement ${liveCalls}/${toRerun.length}: ${key}`);
    const t0 = Date.now();
    const r = await realEval({ promptText: pt, probe, target });
    const ms = Date.now() - t0;
    const ot = r.usage?.agent?.output_tokens ?? null;
    const tc = r.toolCalls ?? null;
    console.log(`[rerun]   → score=${r.score} tool_calls=${tc} output_tokens=${ot} ${ms}ms`);
    return r;
  };

  const probeIds = probes.map((p) => p.id);
  const weights = probeIds.map(() => 1);

  console.log('\n[rerun] calling buildCandidate (concurrency=6) ...');
  const t0 = Date.now();
  const candidate = await buildCandidate({
    id: `${TARGET_HASH}-RERUN`,
    prompt: promptText,
    sourceOp: 'trajectory-crossover-rerun',
    parentHash: 'T2-r1-reflective-r3-reflective',
    probes,
    weights,
    evaluateCandidate,
    nativeBaselineByTarget: nativeBaseline,
    concurrency: 6,
  });
  const elapsedMs = Date.now() - t0;
  console.log(`\n[rerun] buildCandidate done in ${elapsedMs}ms; ${liveCalls} live calls`);

  // Recompute admission against current Pareto front (excluding self).
  const front = (pareto.front || []).filter((m) => m.hash !== TARGET_HASH);
  const adm = attemptParetoAdmission({ candidate, front });

  const result = {
    timestamp: new Date().toISOString(),
    target_hash: TARGET_HASH,
    elapsed_ms: elapsedMs,
    live_calls: liveCalls,
    cached_calls: cache.size,
    candidate_summary: {
      score_sonnet: candidate.score_sonnet,
      score_gpt5_5: candidate.score_gpt5_5,
      taskScore: candidate.taskScore,
      efficiencyFactor: candidate.efficiencyFactor,
      lengthPenalty: candidate.lengthPenalty,
      finalScore: candidate.finalScore,
      sharpnessScore: candidate.sharpnessScore,
      tokenCount: candidate.tokenCount,
    },
    prior_front: pareto.front.map((m) => ({ hash: m.hash, finalScore: m.finalScore, score_sonnet: m.score_sonnet, score_gpt5_5: m.score_gpt5_5 })),
    pareto_admission: {
      admitted: adm.admitted,
      reason: adm.reason,
      target_degraded: adm.target_degraded,
      drop: adm.drop,
      incumbent: adm.incumbent,
      evicted: adm.evicted,
    },
    new_front_finalScores: adm.newFront.map((m) => ({ hash: m.hash, finalScore: m.finalScore })),
  };

  const outPath = path.join(RUN_DIR, 'rerun-failed-gpt5_5.result.json');
  await fs.writeFile(outPath, JSON.stringify(result, null, 2));
  console.log(`\n[rerun] result written to ${outPath}`);
  console.log('\n--- RESULT ---');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[rerun] FATAL:', err);
  process.exit(1);
});
