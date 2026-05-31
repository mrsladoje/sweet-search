#!/usr/bin/env node
/**
 * M re-score / trajectory capture — asymmetric by target:
 *   - GPT-5.5: ALL 40 probes × 3 reps (RELIABLE scores — the fullrun's 0.696 was a
 *     transient empty-run episode; a clean 24-run sample showed true gpt ≈ 0.996).
 *   - Sonnet : ALL 40 probes × 1 rep (we already trust Sonnet ≈1.0; we only lack the
 *     TRAJECTORIES — capture them for future analysis + to inspect the 0.990 dip).
 * Empty-retry (≤3 attempts) on BOTH so no captured trajectory comes back empty.
 * Persists full per-probe trajectories + answers + usage.
 *
 *   CANDS=M node scripts/rescore-M-gpt.mjs
 *   GPT_REPS=3 SONNET_REPS=1 CANDS=M node scripts/rescore-M-gpt.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRealEvaluateCandidate } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { runCostLatencyFields } from '../core/prompt-optimization/sweep/gepa-scoring.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONC = Number(process.env.CONC) || 4;
const MAX_EMPTY_ATTEMPTS = 3;
const TARGET_REPS = { gpt5_5: Number(process.env.GPT_REPS) || 3, sonnet: Number(process.env.SONNET_REPS) || 1 };
const CANDS = (process.env.CANDS || 'M').split(',').map((s) => s.trim()).filter(Boolean);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const promptFor = (id) => fs.readFileSync(path.join(REPO, `core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/${id}.md`), 'utf8');
const probesRaw = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
const probesAll = Array.isArray(probesRaw) ? probesRaw : (probesRaw.probes || probesRaw.dev || []);
const idSet = process.env.PROBES ? new Set(process.env.PROBES.split(',').map((s) => s.trim())) : null;
const strSet = process.env.PROBE_STRATA ? new Set(process.env.PROBE_STRATA.split(',').map((s) => s.trim())) : null;
const probes = (idSet || strSet) ? probesAll.filter((p) => (idSet && idSet.has(p.id)) || (strSet && strSet.has(p.stratum))) : probesAll;
const prompts = Object.fromEntries(CANDS.map((k) => [k, promptFor(k)]));
const evalC = makeRealEvaluateCandidate({ agentProvider: 'api' });

const tasks = [];
for (const k of CANDS) {
  for (const [target, reps] of Object.entries(TARGET_REPS)) {
    for (const p of probes) for (let r = 0; r < reps; r++) tasks.push({ k, p, r, target });
  }
}

const out = [];
let cur = 0;
const worker = async () => {
  for (let i = cur++; i < tasks.length; i = cur++) {
    const { k, p, r, target } = tasks[i];
    let res = null; let emptyAttempts = 0;
    for (let a = 0; a < MAX_EMPTY_ATTEMPTS; a++) {
      res = await evalC({ promptText: prompts[k], probe: p, target });
      const ag = res.usage?.agent;
      if (ag && num(ag.input_tokens) + num(ag.output_tokens) > 0) break;
      emptyAttempts++;
    }
    const ag = res.usage?.agent || {};
    const callCount = res.toolCalls ?? (res.trajectory?.toolCalls?.length ?? 0);
    const clf = runCostLatencyFields({ usage: res.usage, target, toolCalls: callCount });
    out.push({
      cand: k, target, probeId: p.id, stratum: p.stratum, rep: r,
      score: res.score, callCount, cost: clf.cost_usd ?? 0,
      inTok: num(ag.input_tokens), outTok: num(ag.output_tokens),
      emptyAttempts, stillEmpty: num(ag.input_tokens) + num(ag.output_tokens) === 0,
      answer: typeof res.trajectory?.answer === 'string' ? res.trajectory.answer.slice(0, 4000) : (res.trajectory?.answer ?? null),
      toolCalls: (res.trajectory?.toolCalls ?? []).map((c) => ({ name: c.name, input: c.input })),
    });
    console.error(`✓ ${k}.${target}.${p.id}.r${r} score=${res.score} calls=${callCount} emptyRetries=${emptyAttempts}${out[out.length - 1].stillEmpty ? ' STILL-EMPTY' : ''} [${out.length}/${tasks.length}]`);
  }
};
console.error(`M RE-SCORE: ${CANDS.join(',')} × ${probes.length} probes — gpt5_5×${TARGET_REPS.gpt5_5}, sonnet×${TARGET_REPS.sonnet} (≤${MAX_EMPTY_ATTEMPTS} empty-retries) = ${tasks.length} cells, conc=${CONC}`);
await Promise.all(Array.from({ length: CONC }, worker));

out.sort((a, b) => a.target.localeCompare(b.target) || a.probeId.localeCompare(b.probeId) || a.rep - b.rep);
const outPath = path.join(REPO, 'core/prompt-optimization/data/results/', process.env.OUT || 'M-rescore-trajectories.json');
fs.writeFileSync(outPath, JSON.stringify({ targetReps: TARGET_REPS, cands: CANDS, captured: new Date().toISOString(), runs: out }, null, 2));

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log('\n════════ M RE-SCORE (gpt5_5 reliable / sonnet trajectories) ════════');
for (const k of CANDS) {
  for (const target of Object.keys(TARGET_REPS)) {
    const rows = out.filter((x) => x.cand === k && x.target === target);
    if (!rows.length) continue;
    const retried = rows.filter((x) => x.emptyAttempts > 0); const stillEmpty = rows.filter((x) => x.stillEmpty);
    console.log(`\n${k} / ${target} (×${TARGET_REPS[target]}):  cells=${rows.length}  needed-retry=${retried.length}  still-empty=${stillEmpty.length}`);
    console.log(`   OVERALL accuracy = ${mean(rows.map((x) => x.score)).toFixed(4)}${target === 'gpt5_5' ? '  (fullrun was 0.696)' : '  (fullrun 0.990; 1 rep here — trajectories are the goal)'}`);
    for (const s of ['multi-file-flow', 'literal-lookup', 'behavioral', 'no-match']) {
      const ss = rows.filter((x) => x.stratum === s);
      if (ss.length) console.log(`   [${s}] acc=${mean(ss.map((x) => x.score)).toFixed(3)} (n=${ss.length})  retries=${ss.filter((x) => x.emptyAttempts > 0).length}`);
    }
  }
}
console.log(`\nwrote ${outPath} (full trajectories + answers, both targets)`);
