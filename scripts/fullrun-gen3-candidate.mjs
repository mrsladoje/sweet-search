#!/usr/bin/env node
/**
 * GEN-3 full-run validation: score a candidate on ALL 40 dev probes at 3 reps ×
 * both targets via the REAL scoring path (buildCandidate → native-relative
 * Maximin finalScore), so the number is directly comparable to T2's 0.2942.
 *
 * Cost-staged decision rule (the screen already proved A's mechanism + accuracy):
 *   - A finalScore clearly > 0.2942  → A beats T2 (the plateau is broken).
 *   - A finalScore clearly < ~0.27   → A loses; T2 holds.
 *   - marginal (≈0.27–0.32)          → re-run T2 at 3 reps (CANDS=T2) to disambiguate,
 *                                       since T2's 0.2942 was a 2-rep (possibly lucky) draw.
 *
 *   node scripts/fullrun-gen3-candidate.mjs            # A (default)
 *   CANDS=A,T2 node scripts/fullrun-gen3-candidate.mjs # + T2 control
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidate } from '../core/prompt-optimization/sweep/gepa-scoring.mjs';
import { makeRealEvaluateCandidate } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPS = 3;
const CONC = 6;
const CANDS = (process.env.CANDS || 'A').split(',').map((s) => s.trim()).filter(Boolean);

const body = (md) => { const m = md.split(/^---\s*$/m); return (m.length >= 3 ? m.slice(2).join('---') : md).trim(); };
function promptFor(id) {
  if (id === 'T2') {
    const front = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen2-initial-front.json'), 'utf8'));
    return front.find((x) => x.id === 'T2').prompt;
  }
  return fs.readFileSync(path.join(REPO, `core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/${id}.md`), 'utf8');
}

const probesRaw = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
const probes = Array.isArray(probesRaw) ? probesRaw : (probesRaw.probes || probesRaw.dev || []);
const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-native-baseline-dev-3panel.json'), 'utf8'));
const _evalRaw = makeRealEvaluateCandidate({ agentProvider: 'api' });
// Empty-retry: GPT-5.5 (and occasionally other providers) intermittently return a
// transient EMPTY response (0 tokens) that scores 0 and corrupts the accuracy mean.
// A 0-token reply is an API failure, not the agent's answer — retry ≤3× before
// accepting it. The screen/capture scripts already did this; the fullrun path did
// NOT, which tanked M's measured gpt to 0.696 (true ≈0.980) on 2026-05-31.
const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const evaluateCandidate = async (args) => {
  let res = null;
  for (let a = 0; a < 3; a++) {
    res = await _evalRaw(args);
    const ag = res.usage?.agent;
    if (ag && _num(ag.input_tokens) + _num(ag.output_tokens) > 0) break;
  }
  return res;
};

const T2_REF = 0.2942;
const out = {};
for (const id of CANDS) {
  console.error(`\n=== full run ${id}: ${probes.length} probes × 2 targets × ${REPS} reps (conc ${CONC}) ===`);
  const cand = await buildCandidate({
    id, prompt: promptFor(id), sourceOp: 'gen3-seed', parentHash: null,
    probes, weights: probes.map(() => 1), evaluateCandidate,
    nativeBaselineByTarget: baseline, concurrency: CONC, repeats: REPS,
  });
  // per-stratum mean score + calls (from detail)
  const byStratum = {};
  for (const p of probes) {
    const d = cand.detail[p.id]; const s = p.stratum || '?';
    (byStratum[s] = byStratum[s] || { n: 0, son: [], gpt: [], sonCalls: [], gptCalls: [] });
    byStratum[s].n++; byStratum[s].son.push(d.sonnet.score); byStratum[s].gpt.push(d.gpt5_5.score);
    byStratum[s].sonCalls.push(d.sonnet.traj?.toolCalls?.length ?? 0); byStratum[s].gptCalls.push(d.gpt5_5.traj?.toolCalls?.length ?? 0);
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  out[id] = { finalScore: cand.finalScore, taskScore: cand.taskScore, costUsd: cand.costUsd, accuracyFactor: cand.accuracyFactor, efficiencyScore: cand.efficiencyScore, score_sonnet: cand.score_sonnet, score_gpt5_5: cand.score_gpt5_5, tokenCount: cand.tokenCount, detail: cand.detail };
  console.error(`\n${id}: finalScore=${cand.finalScore.toFixed(4)}  taskScore=${cand.taskScore.toFixed(4)}  cost$=${(cand.costUsd ?? 0).toFixed(4)}  acc=${(cand.accuracyFactor ?? 0).toFixed(3)}  eff=${(cand.efficiencyScore ?? 0).toFixed(3)}  (sonnet ${cand.score_sonnet.toFixed(3)} / gpt ${cand.score_gpt5_5.toFixed(3)})`);
  console.error(`   vs T2 ${T2_REF}: ${cand.finalScore > T2_REF ? 'BEATS by +' + (cand.finalScore - T2_REF).toFixed(4) : 'below by ' + (cand.finalScore - T2_REF).toFixed(4)}`);
  for (const [s, v] of Object.entries(byStratum)) {
    console.error(`   [${s}] n=${v.n} sonScore=${mean(v.son).toFixed(3)} gptScore=${mean(v.gpt).toFixed(3)} sonCalls=${mean(v.sonCalls).toFixed(1)} gptCalls=${mean(v.gptCalls).toFixed(1)}`);
  }
}
const outPath = path.join(REPO, 'core/prompt-optimization/data/results/p7-gen3-fullrun.json');
fs.writeFileSync(outPath, JSON.stringify({ reps: REPS, t2Ref: T2_REF, candidates: out }, null, 2));
console.error(`\nwrote ${outPath}`);
