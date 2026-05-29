import fs from 'node:fs';
import { nativeRelativeScore, normalizeNativeBaselineByTarget, taskScore as taskScoreFn } from '/Users/admin/Projects/sweet-search-private/core/prompt-optimization/sweep/eas.mjs';
import { reportingFront } from '/Users/admin/Projects/sweet-search-private/core/prompt-optimization/sweep/gepa-pareto.mjs';
import { agentUsageBreakdown } from '/Users/admin/Projects/sweet-search-private/core/prompt-optimization/sweep/gepa-scoring.mjs';

const REPO = '/Users/admin/Projects/sweet-search-private';
const TID = { '0x9b99587f0b0db9a7': 'T1', '0x53f8a0f707141e25': 'T2', '0x57d1d3600aaf18a8': 'T3', '0x8a5b03ae012beaab': 'T4', '0xbd963c90431665da': 'T5', '0x931d9c97e9bc9ea0': 'T6', '0xfb2c890b60452b75': 'T7', '0x0a07d83504e451d8': 'T8' };
const PATCH = new Set(['T3:cpp-004', 'T3:kotlin-002', 'T3:ruby-001', 'T3:js-008', 'T3:js-005', 'T4:ruby-002', 'T5:cpp-008', 'T5:ts-002', 'T8:js-009']);
const SEEDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const bd = (it, ot, cr, cc) => agentUsageBreakdown({ agent: { input_tokens: it, output_tokens: ot, cache_read_tokens: cr, cache_creation_tokens: cc } });

const cells = {}; // cells[seed][probe][target] = {score, calls, processedInput, output, src}
const put = (seed, probe, target, score, calls, b, src) => {
  if (!b) return;
  ((cells[seed] = cells[seed] || {})[probe] = cells[seed][probe] || {})[target] = { score, calls, processedInput: b.processedInput, output: b.output, src };
};

// 1. Fresh Sonnet (+ any gpt5_5 patch rows) from the rescore run
const son = fs.existsSync('/tmp/gen1b-rescore-results.json') ? load('/tmp/gen1b-rescore-results.json') : [];
let deadCount = 0;
for (const r of son) {
  if (r.dead) { deadCount++; continue; }
  if (r.target === 'sonnet') put(r.seed, r.probe, 'sonnet', r.score, r.toolCalls, bd(r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_creation_tokens), 'fresh-sonnet');
}

// 2. GPT patches → median over reps. Source A: the 4 new (from rescore run). Source B: T3's 5 (from diagnostic).
const gptPatchRuns = {};
for (const r of son) if (r.target === 'gpt5_5' && !r.dead) (gptPatchRuns[`${r.seed}:${r.probe}`] = gptPatchRuns[`${r.seed}:${r.probe}`] || []).push({ score: r.score, calls: r.toolCalls, it: r.input_tokens, ot: r.output_tokens, cr: r.cache_read_tokens, cc: r.cache_creation_tokens });
if (fs.existsSync('/tmp/t3-diag-results.json')) for (const r of load('/tmp/t3-diag-results.json')) if (!r.error) (gptPatchRuns[`T3:${r.probe}`] = gptPatchRuns[`T3:${r.probe}`] || []).push({ score: r.score, calls: r.toolCalls, it: r.agent?.input_tokens, ot: r.agent?.output_tokens, cr: r.agent?.cache_read_tokens, cc: r.agent?.cache_creation_tokens });
for (const [k, runs] of Object.entries(gptPatchRuns)) {
  const [seed, probe] = k.split(':');
  const ss = runs.map((x) => x.score).filter((s) => typeof s === 'number');
  const bds = runs.map((x) => bd(x.it, x.ot, x.cr, x.cc)).filter(Boolean);
  if (!ss.length || !bds.length) continue;
  put(seed, probe, 'gpt5_5', median(ss), Math.round(median(runs.map((x) => x.calls || 0))), { processedInput: median(bds.map((b) => b.processedInput)), output: median(bds.map((b) => b.output)) }, 'patched');
}

// 3. Reused gen-1b GPT for all non-patched cells
const g1b = fs.readFileSync(`${REPO}/core/prompt-optimization/data/results/p7-gen1b-round0/gepa-trajectory.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e._kind === 'seed' && e.target === 'gpt5_5');
for (const e of g1b) {
  const seed = TID[e.mutation_hash]; if (!seed) continue;
  if (PATCH.has(`${seed}:${e.probe_id}`)) continue;          // patched separately
  if (cells[seed]?.[e.probe_id]?.gpt5_5) continue;            // already set
  put(seed, e.probe_id, 'gpt5_5', e.score, e.tool_calls, bd(e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_creation_tokens), 'reused-gen1b');
}

// 4. Score each seed
const baseline = normalizeNativeBaselineByTarget(load(`${REPO}/core/prompt-optimization/data/p7-native-baseline-dev-3panel.json`));
const rows = [];
for (const seed of SEEDS) {
  const cs = cells[seed] || {};
  const perTarget = { sonnet: [], gpt5_5: [] };
  const maximin = [];
  let nSon = 0, nGpt = 0, patched = 0;
  for (const probe of Object.keys(cs)) {
    const c = cs[probe];
    if (c.sonnet) { perTarget.sonnet.push({ probeId: probe, score: c.sonnet.score, calls: c.sonnet.calls, processedInput: c.sonnet.processedInput, output: c.sonnet.output }); nSon++; }
    if (c.gpt5_5) { perTarget.gpt5_5.push({ probeId: probe, score: c.gpt5_5.score, calls: c.gpt5_5.calls, processedInput: c.gpt5_5.processedInput, output: c.gpt5_5.output }); nGpt++; if (c.gpt5_5.src === 'patched') patched++; }
    if (c.sonnet && c.gpt5_5) maximin.push(Math.min(c.sonnet.score, c.gpt5_5.score));
  }
  if (!perTarget.sonnet.length || !perTarget.gpt5_5.length) { rows.push({ seed, incomplete: true, nSon, nGpt }); continue; }
  let nr;
  try { nr = nativeRelativeScore({ perTarget, baselineByTarget: baseline }); }
  catch (e) { rows.push({ seed, error: String(e.message).slice(0, 80), nSon, nGpt }); continue; }
  const costs = []; const costSon = []; const costGpt = [];
  for (const t of Object.keys(nr.breakdown)) for (const rr of nr.breakdown[t].runs) if (typeof rr.costUsd === 'number') { costs.push(rr.costUsd); (t === 'sonnet' ? costSon : costGpt).push(rr.costUsd); }
  const ts = taskScoreFn({ perProbeMaximin: maximin, weights: maximin.map(() => 1) });
  const meanCost = costs.reduce((a, b) => a + b, 0) / costs.length;
  rows.push({
    seed, taskScore: ts, costUsd: meanCost,
    costSonnet: costSon.reduce((a, b) => a + b, 0) / costSon.length,
    costGpt: costGpt.reduce((a, b) => a + b, 0) / costGpt.length,
    accuracyFactor: nr.accuracyFactor, efficiencyScore: nr.efficiencyFactor,
    finalScore: nr.factor, nSon, nGpt, patched,
  });
}

// 5. Report
console.log(`\nfresh-sonnet cells: ${son.filter((r) => r.target === 'sonnet' && !r.dead).length}  dead: ${deadCount}  gpt-patch runs: ${Object.keys(gptPatchRuns).length} cells`);
console.log('\n=== gen-1b RESCORE under cache-naive $ (Maximin accuracy × efficiency) ===');
console.log('seed  taskScore  cost$(total)  cost$son  cost$gpt  accF   effF   finalScore  son/gpt  patched');
for (const r of [...rows].sort((a, b) => (b.finalScore ?? -1) - (a.finalScore ?? -1))) {
  if (r.incomplete || r.error) { console.log(`${r.seed}  INCOMPLETE/ERR (${r.error || ''}) son=${r.nSon} gpt=${r.nGpt}`); continue; }
  console.log(`${r.seed}   ${r.taskScore.toFixed(4)}    ${r.costUsd.toExponential(3)}  ${r.costSonnet.toExponential(2)} ${r.costGpt.toExponential(2)}  ${r.accuracyFactor.toFixed(3)} ${r.efficiencyScore.toFixed(3)}  ${r.finalScore.toFixed(4)}    ${r.nSon}/${r.nGpt}  ${r.patched}`);
}
const front = reportingFront(rows.filter((r) => !r.incomplete && !r.error));
console.log('\n=== 2-D (accuracy, cost-$) REPORTING FRONT ===');
console.log('non-dominated:', front.map((r) => `${r.seed}(acc=${r.taskScore.toFixed(3)},$=${r.costUsd.toExponential(2)})`).join('  '));
fs.writeFileSync('/tmp/gen1b-rescore-final.json', JSON.stringify(rows, null, 2));
console.log('\nwrote /tmp/gen1b-rescore-final.json');
