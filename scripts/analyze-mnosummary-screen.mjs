#!/usr/bin/env node
/**
 * Analyze the MNoSummary / LiteralSpan vs M* screen.
 * Key questions:
 *   1) MECHANISM: did MNoSummary actually stop emitting <state_summary>? (vs Mstar)
 *   2) LITERAL (clean-signal stratum): does MNoSummary cut $ at EQUAL calls + EQUAL accuracy?
 *   3) REGRESSION TRIPWIRE (multi-file/no-match): did removing the summary blow up call-count
 *      (over-search) or raw-shell rate?
 *   4) LiteralSpan vs MNoSummary: does the routing change help, and does raw-shell rise?
 *
 *   node scripts/analyze-mnosummary-screen.mjs [resultsFile]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(REPO, 'core/prompt-optimization/data/results/mnosummary-screen.json');
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const runs = (d.runs || []).filter((r) => r.target === 'sonnet');

const RAW = ['grep', 'rg', 'egrep', 'fgrep', 'find', 'fd', 'cat', 'less', 'more', 'ls', 'head', 'tail', 'sed', 'awk', 'wc', 'tree', 'nl', 'cut'];
const isRaw = (cmd) => {
  if (typeof cmd !== 'string') return false;
  return cmd.split(/&&|\|\||;/).some((seg) => RAW.includes((seg.trim().split(/\s+/)[0] || '').replace(/^.*\//, '')));
};
const rawCalls = (r) => (r.toolCalls || []).filter((c) => isRaw(c.input?.command)).length;
const emitsSummary = (r) => /state_summary/i.test(String(r.answer || ''));

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0; };
const CANDS = [...new Set(runs.map((r) => r.cand))];
const STRATA = ['literal-lookup', 'multi-file-flow', 'no-match', 'behavioral'];

console.log(`\n══════ SCREEN ANALYSIS (sonnet, ${runs.length} runs) ══════`);
console.log('cands:', CANDS.join(', '), '| reps:', d.targetReps?.sonnet);

// 1) MECHANISM CHECK
console.log('\n── 1) MECHANISM: <state_summary> emission rate (in final answer) ──');
for (const c of CANDS) {
  const rs = runs.filter((r) => r.cand === c);
  console.log(`  ${c.padEnd(12)} ${(100 * rs.filter(emitsSummary).length / rs.length).toFixed(0)}% of runs (${rs.filter(emitsSummary).length}/${rs.length})`);
}

// 2+3) PER CAND × STRATUM
console.log('\n── 2/3) PER cand × stratum:  acc | calls | $/run | raw%  ──');
for (const s of STRATA) {
  const any = runs.filter((r) => r.stratum === s);
  if (!any.length) continue;
  console.log(`\n  [${s}]`);
  for (const c of CANDS) {
    const rs = runs.filter((r) => r.cand === c && r.stratum === s);
    if (!rs.length) continue;
    const rawPct = 100 * rs.reduce((x, r) => x + rawCalls(r), 0) / Math.max(1, rs.reduce((x, r) => x + (r.callCount || 0), 0));
    console.log(`    ${c.padEnd(12)} acc=${mean(rs.map((r) => r.score)).toFixed(3)}  calls=${mean(rs.map((r) => r.callCount)).toFixed(2)}±${sd(rs.map((r) => r.callCount)).toFixed(1)}  \$=${mean(rs.map((r) => r.cost || 0)).toFixed(4)}±${sd(rs.map((r) => r.cost || 0)).toFixed(3)}  raw=${rawPct.toFixed(1)}%  (n=${rs.length})`);
  }
}

// 4) PAIRED LITERAL comparison vs Mstar (per-probe paired delta — the clean signal)
console.log('\n── 4) PAIRED literal-lookup deltas vs Mstar (per-probe means) ──');
const litProbes = [...new Set(runs.filter((r) => r.stratum === 'literal-lookup').map((r) => r.probeId))].sort();
const base = 'Mstar';
for (const c of CANDS.filter((x) => x !== base)) {
  let dCost = [], dCalls = [], dAcc = [];
  for (const p of litProbes) {
    const b = runs.filter((r) => r.cand === base && r.probeId === p);
    const x = runs.filter((r) => r.cand === c && r.probeId === p);
    if (!b.length || !x.length) continue;
    dCost.push(mean(x.map((r) => r.cost || 0)) - mean(b.map((r) => r.cost || 0)));
    dCalls.push(mean(x.map((r) => r.callCount)) - mean(b.map((r) => r.callCount)));
    dAcc.push(mean(x.map((r) => r.score)) - mean(b.map((r) => r.score)));
  }
  const bCost = mean(runs.filter((r) => r.cand === base && r.stratum === 'literal-lookup').map((r) => r.cost || 0));
  console.log(`  ${c} vs Mstar (literal):  Δ$ = ${mean(dCost) >= 0 ? '+' : ''}${mean(dCost).toFixed(4)}/run (${(100 * mean(dCost) / bCost).toFixed(1)}%)   Δcalls = ${mean(dCalls) >= 0 ? '+' : ''}${mean(dCalls).toFixed(2)}   Δacc = ${mean(dAcc) >= 0 ? '+' : ''}${mean(dAcc).toFixed(3)}`);
  console.log(`     per-probe Δ$: ${litProbes.map((p, i) => `${p}:${dCost[i] >= 0 ? '+' : ''}${(dCost[i] || 0).toFixed(3)}`).join('  ')}`);
}

// 5) overall per-cand
console.log('\n── 5) OVERALL per cand (all 8 probes) ──');
for (const c of CANDS) {
  const rs = runs.filter((r) => r.cand === c);
  console.log(`  ${c.padEnd(12)} acc=${mean(rs.map((r) => r.score)).toFixed(3)}  calls=${mean(rs.map((r) => r.callCount)).toFixed(2)}  \$=${mean(rs.map((r) => r.cost || 0)).toFixed(4)}/run  total\$=${rs.reduce((x, r) => x + (r.cost || 0), 0).toFixed(3)}`);
}
