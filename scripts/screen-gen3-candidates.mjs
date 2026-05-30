#!/usr/bin/env node
/**
 * GEN-3 candidate SCREEN (cost-conscious GO/NO-GO kill-filter).
 *
 * Runs the chosen candidates on the 12-probe FAILURE-MODE subset at 5 reps ×
 * both targets, capturing the PER-REP tool-call-count distribution (the
 * mechanism signal — does the no-match spiral collapse?) + cache-naive $ +
 * per-rep accuracy (tripwire: must not regress on literal/multi-file/behavioral).
 *
 * This is NOT the promotion gate — the full 40×3-rep run is. We judge GO/NO-GO
 * on: (a) no-match call-count distribution (target ≤~6, vs known spiral 12–19),
 * and (b) accuracy holding ~1.0 on the literal/multi-file/behavioral tripwires.
 * T2 is referenced from its existing 2-rep front data (re-run at 3 reps in the
 * full stage) to save spend; the no-match win is an ABSOLUTE property of A/D.
 *
 *   node scripts/screen-gen3-candidates.mjs            # A,D  (default)
 *   CANDS=A,B,C,D node scripts/screen-gen3-candidates.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRealEvaluateCandidate } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { runCostLatencyFields } from '../core/prompt-optimization/sweep/gepa-scoring.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPS = 5;
const CONC = 6;
const TARGETS = ['sonnet', 'gpt5_5'];
const CANDS = (process.env.CANDS || 'A,D').split(',').map((s) => s.trim()).filter(Boolean);

// 12-probe failure-mode subset (5 no-match + 3 literal + 2 multi-file + 2 behavioral).
const SCREEN = {
  'csharp-008': 'no-match', 'kotlin-009': 'no-match', 'python-009': 'no-match', 'ruby-008': 'no-match', 'rust-010': 'no-match',
  'ts-003': 'literal-lookup', 'rust-001': 'literal-lookup', 'java-001': 'literal-lookup',
  'cpp-004': 'multi-file-flow', 'csharp-004': 'multi-file-flow',
  'js-008': 'behavioral', 'python-007': 'behavioral',
};
const SCREEN_IDS = Object.keys(SCREEN);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const median = (xs) => { const s = xs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const prompts = Object.fromEntries(CANDS.map((k) => [k, fs.readFileSync(path.join(REPO, `core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/${k}.md`), 'utf8')]));
const probesRaw = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
const allProbes = Array.isArray(probesRaw) ? probesRaw : (probesRaw.probes || probesRaw.dev || []);
const probes = SCREEN_IDS.map((id) => { const p = allProbes.find((x) => x.id === id); if (!p) throw new Error(`probe ${id} not in dev set`); return p; });

// T2 reference (existing front data) — per-probe sonnet/gpt call counts + score.
const front = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen2-initial-front.json'), 'utf8'));
const t2 = front.find((x) => x.id === 'T2');
const t2ref = {};
for (const id of SCREEN_IDS) {
  const d = t2.detail?.[id];
  t2ref[id] = d ? { sonCalls: d.sonnet?.traj?.toolCalls?.length ?? '?', gptCalls: d.gpt5_5?.traj?.toolCalls?.length ?? '?', sonScore: d.sonnet?.score, gptScore: d.gpt5_5?.score } : null;
}

const evalC = makeRealEvaluateCandidate({ agentProvider: 'api' });

async function runCell(promptText, probe, target) {
  const reps = [];
  for (let r = 0; r < REPS; r++) {
    let res = null;
    for (let a = 0; a < 3; a++) {
      res = await evalC({ promptText, probe, target });
      const ag = res.usage?.agent;
      if (ag && (num(ag.input_tokens) + num(ag.output_tokens)) > 0) break;
    }
    const calls = res.toolCalls ?? (res.trajectory?.toolCalls?.length ?? 0);
    const clf = runCostLatencyFields({ usage: res.usage, target, toolCalls: calls });
    reps.push({ score: res.score, calls, cost: clf.cost_usd ?? 0, realized: clf.realized_usd ?? 0 });
  }
  return reps;
}

// Build the task list and run with bounded concurrency.
const tasks = [];
for (const k of CANDS) for (const p of probes) for (const t of TARGETS) tasks.push({ k, p, t });
const results = {}; // results[cand][probeId][target] = [{score,calls,cost}...]
let cur = 0;
const worker = async () => {
  for (let i = cur++; i < tasks.length; i = cur++) {
    const { k, p, t } = tasks[i];
    const reps = await runCell(prompts[k], p, t);
    ((results[k] = results[k] || {})[p.id] = results[k][p.id] || {})[t] = reps;
    const calls = reps.map((r) => r.calls);
    console.error(`✓ ${k}.${p.id}.${t} score=[${reps.map((r) => r.score).join(',')}] calls=[${calls.join(',')}] [${i + 1}/${tasks.length}]`);
  }
};
console.error(`SCREEN: ${CANDS.join(',')} × ${probes.length} probes × ${TARGETS.length} targets × ${REPS} reps = ${tasks.length} cells, conc=${CONC}`);
await Promise.all(Array.from({ length: CONC }, worker));

// ── report ──
const lines = [];
const p = (s) => { lines.push(s); console.log(s); };
p('\n════════ GEN-3 CANDIDATE SCREEN ════════');
p(`reps=${REPS} | probes=${probes.length} | candidates=${CANDS.join(',')} | T2 ref = existing 2-rep front data\n`);
for (const k of CANDS) {
  p(`\n###### Candidate ${k} ######`);
  for (const stratum of ['no-match', 'literal-lookup', 'multi-file-flow', 'behavioral']) {
    const ids = SCREEN_IDS.filter((id) => SCREEN[id] === stratum);
    p(`\n  [${stratum}]`);
    for (const id of ids) {
      for (const t of TARGETS) {
        const reps = results[k][id][t];
        const calls = reps.map((r) => r.calls);
        const scores = reps.map((r) => r.score);
        const ref = t2ref[id] ? (t === 'sonnet' ? `T2≈${t2ref[id].sonCalls}c/${t2ref[id].sonScore}` : `T2≈${t2ref[id].gptCalls}c/${t2ref[id].gptScore}`) : 'T2=?';
        p(`    ${id}.${t.padEnd(6)} score med=${median(scores).toFixed(2)} [${scores.join(',')}]  calls med=${median(calls)} [${calls.join(',')}] $${mean(reps.map((r) => r.cost)).toFixed(4)}  (${ref})`);
      }
    }
  }
  // stratum summaries
  const summ = (stratum, target) => {
    const ids = SCREEN_IDS.filter((id) => SCREEN[id] === stratum);
    const allCalls = ids.flatMap((id) => results[k][id][target].map((r) => r.calls));
    const allScore = ids.flatMap((id) => results[k][id][target].map((r) => r.score));
    return { calls: mean(allCalls).toFixed(1), minScore: Math.min(...allScore).toFixed(2), cost: mean(ids.flatMap((id) => results[k][id][target].map((r) => r.cost))).toFixed(4) };
  };
  p(`\n  SUMMARY ${k}:`);
  for (const stratum of ['no-match', 'literal-lookup', 'multi-file-flow', 'behavioral']) {
    for (const t of TARGETS) {
      const s = summ(stratum, t);
      p(`    ${stratum}/${t.padEnd(6)}: meanCalls=${s.calls}  minScore=${s.minScore}  meanCost=$${s.cost}`);
    }
  }
}
const outPath = path.join(REPO, 'core/prompt-optimization/data/results/p7-gen3-screen.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ reps: REPS, screen: SCREEN, t2ref, results }, null, 2));
fs.writeFileSync(path.join(REPO, 'core/prompt-optimization/data/results/p7-gen3-screen.report.txt'), lines.join('\n'));
p(`\nwrote ${outPath}`);
