#!/usr/bin/env node
/**
 * Diagnose M's GPT-5.5 accuracy crater (fullrun: gpt 0.696 vs A's 1.000): is it
 * INFRA empty-runs (GPT-5.5 returns 0 tokens → scored 0, a known transient) or
 * REAL incomplete answers (M under-searches → wrong)?
 *
 * For each (cand × probe) on gpt5_5, run R INDEPENDENT times with NO empty-retry
 * masking, recording per run: empty? (agent in+out tokens == 0), isError, call
 * count, judge score, and the actual answer text. Then:
 *   - high empty-rate + non-empty runs score ~1.0  → INFRA (M is fine; fullrun undercounted)
 *   - non-empty runs score LOW (real answers, wrong) → REAL under-searching (M rejected)
 * A is the control (fullrun gpt 1.0 → expect ~0 empties, ~1.0 scores).
 *
 *   CANDS=M,A R=3 node scripts/analyze-gpt-failures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRealEvaluateCandidate } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONC = Number(process.env.CONC) || 4;
const R = Number(process.env.R) || 3;
const CANDS = (process.env.CANDS || 'M,A').split(',').map((s) => s.trim()).filter(Boolean);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const promptFor = (id) => fs.readFileSync(path.join(REPO, `core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/${id}.md`), 'utf8');
const probesRaw = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
const allProbes = Array.isArray(probesRaw) ? probesRaw : (probesRaw.probes || probesRaw.dev || []);

// Sample where the crater is: 5 multi-file (gpt 0.529) + 2 literal (0.700) + 1 no-match (0.970 control).
const pick = (stratum, n) => allProbes.filter((p) => (p.stratum || '?') === stratum).slice(0, n);
const SAMPLE = (process.env.PROBES
  ? process.env.PROBES.split(',').map((s) => s.trim()).map((id) => allProbes.find((p) => p.id === id))
  : [...pick('multi-file-flow', 5), ...pick('literal-lookup', 2), ...pick('no-match', 1)]).filter(Boolean);

const prompts = Object.fromEntries(CANDS.map((k) => [k, promptFor(k)]));
const evalC = makeRealEvaluateCandidate({ agentProvider: 'api' });

const tasks = [];
for (const k of CANDS) for (const p of SAMPLE) for (let r = 0; r < R; r++) tasks.push({ k, p, r });

const out = [];
let cur = 0;
const worker = async () => {
  for (let i = cur++; i < tasks.length; i = cur++) {
    const { k, p, r } = tasks[i];
    const res = await evalC({ promptText: prompts[k], probe: p, target: 'gpt5_5' }); // ONE run, no retry
    const ag = res.usage?.agent || {};
    const inTok = num(ag.input_tokens); const outTok = num(ag.output_tokens);
    const empty = inTok + outTok === 0;
    const ans = typeof res.trajectory?.answer === 'string' ? res.trajectory.answer : (res.trajectory?.answer ?? '');
    out.push({
      cand: k, probeId: p.id, stratum: p.stratum, rep: r,
      empty, isError: !!res.isError, callCount: res.toolCalls ?? (res.trajectory?.toolCalls?.length ?? 0),
      score: res.score, inTok, outTok, answerLen: String(ans).length, answer: String(ans).slice(0, 500),
    });
    console.error(`✓ ${k}.${p.id}.r${r} ${empty ? 'EMPTY' : 'ok '} calls=${res.toolCalls ?? 0} score=${res.score} ansLen=${String(ans).length} [${out.length}/${tasks.length}]`);
  }
};
console.error(`GPT-FAILURE ANALYSIS: ${CANDS.join(',')} × ${SAMPLE.length} probes × ${R} runs (gpt5_5, no retry) = ${tasks.length} runs`);
await Promise.all(Array.from({ length: CONC }, worker));

const outPath = path.join(REPO, 'core/prompt-optimization/data/results/gpt-failure-analysis.json');
fs.writeFileSync(outPath, JSON.stringify({ cands: CANDS, R, sample: SAMPLE.map((p) => p.id), runs: out }, null, 2));

// ── summary ──
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log('\n════════ GPT-5.5 FAILURE ANALYSIS ════════');
for (const k of CANDS) {
  const rows = out.filter((x) => x.cand === k);
  const empties = rows.filter((x) => x.empty);
  const nonEmpty = rows.filter((x) => !x.empty);
  console.log(`\n${k}:  runs=${rows.length}  EMPTY=${empties.length} (${(100 * empties.length / rows.length).toFixed(0)}%)  non-empty=${nonEmpty.length}`);
  console.log(`   mean score ALL=${mean(rows.map((x) => x.score)).toFixed(3)}   mean score NON-EMPTY=${mean(nonEmpty.map((x) => x.score)).toFixed(3)}`);
  // per stratum non-empty score
  for (const s of ['multi-file-flow', 'literal-lookup', 'no-match']) {
    const ss = nonEmpty.filter((x) => x.stratum === s);
    if (ss.length) console.log(`   [${s}] non-empty score=${mean(ss.map((x) => x.score)).toFixed(3)} (n=${ss.length})  emptyRate=${(100 * out.filter((x) => x.cand === k && x.stratum === s && x.empty).length / out.filter((x) => x.cand === k && x.stratum === s).length).toFixed(0)}%`);
  }
}
console.log(`\nwrote ${outPath}`);
