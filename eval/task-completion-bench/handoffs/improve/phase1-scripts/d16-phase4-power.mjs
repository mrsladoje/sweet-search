// D16 — PHASE 4 POWER ANALYSIS, from this corpus's own heterogeneity.
//
// HANDOFF-SLATE-A-RESIDUE §3.F asks the Phase 4 specification to carry "a power analysis for the
// effect sizes that actually matter (~5% cost, ~1 task solve)". Published guidance does not
// supply that number: the closest current work (arXiv:2607.12338) reports what FRACTION of an
// existing benchmark is enough to order two systems, not how many tasks a new corpus needs, and
// gives no effect-size-to-N formula. So the number has to come from our own recorded variance,
// which is the right source anyway — the spread that decides Phase 4's size is OUR task
// heterogeneity, not another benchmark's.
//
// WHAT IS COMPUTED
//   1. Paired per-task cost effect. For each task, the paired log ratio log(sweet/native), which
//      is the scale a "5% cost saving" is actually expressed on and which stops one +257% task
//      from dominating the mean the way a raw dollar difference does.
//   2. The standard deviation of that paired quantity, per harness, and pooled.
//   3. Required N for 80% and 90% power at a two-sided alpha of 0.05, over a sweep of effect
//      sizes, from the paired t-test formula  n = (z_{1-a/2} + z_{1-b})^2 * sd^2 / delta^2.
//   4. The same, with the single worst task removed, to size how much ONE tail task costs in
//      task budget. That is the concrete argument for stratifying Phase 4 on cost scale.
//   5. Solve: McNemar on discordant pairs, which is what "detect a 1-task solve difference"
//      really requires.
//
// Read-only over recorded rows. No model. $0.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = (process.argv[2] || 'sb-codex-20260811:codex,sb-opencode-20260811:opencode,screen-v3-20260812:claudecode')
  .split(',').map(s => { const [dir, h] = s.split(':'); return { dir, h }; });

// Inverse standard normal (Acklam). Needed for the z quantiles; no stats dependency available.
function qnorm(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= 1 - pl) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
const Z_A = qnorm(0.975), Z_80 = qnorm(0.80), Z_90 = qnorm(0.90);

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
// The cost column contract: breakPriced is the column an A/B is read on; fall back for legacy rows.
const costOf = r => r.breakPricedCostUsd ?? r.idealCostUsd ?? null;

const perHarness = [];
for (const { dir, h } of RUNS) {
  const f = path.join(R, dir, 'rows.json');
  if (!existsSync(f)) { console.log(`(skip ${dir} — absent)`); continue; }
  const rows = JSON.parse(readFileSync(f, 'utf8'));
  // Pair by task: mean cost per arm across reps, then the paired log ratio. Degenerate rows are
  // excluded — HANDOFF §1.5 #8 says to check the flag before reading a cost outlier.
  const byTask = new Map();
  for (const r of rows) {
    if (r.degenerate) continue;
    const c = costOf(r); if (c == null || !(c > 0)) continue;
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, { sweet: [], native: [], sr: [], nr: [] });
    const t = byTask.get(r.taskId);
    (r.arm === 'sweet' ? t.sweet : t.native).push(c);
    (r.arm === 'sweet' ? t.sr : t.nr).push(r.resolved ? 1 : 0);
  }
  const ratios = [], names = [], solve = [];
  for (const [id, t] of byTask) {
    if (!t.sweet.length || !t.native.length) continue;
    ratios.push(Math.log(mean(t.sweet) / mean(t.native))); names.push(id);
    solve.push({ id, s: mean(t.sr) > 0.5 ? 1 : 0, n: mean(t.nr) > 0.5 ? 1 : 0 });
  }
  if (ratios.length > 2) perHarness.push({ h, dir, ratios, names, solve });
}

const nFor = (delta, s, zb) => Math.ceil(((Z_A + zb) ** 2 * s * s) / (delta * delta));
const EFFECTS = [0.02, 0.05, 0.10, 0.15, 0.20];

console.log('=== D16 — Phase 4 power, from this corpus\'s own paired heterogeneity ===');
console.log('Quantity: per-task paired log(sweet/native) cost ratio on breakPricedCostUsd.');
console.log('A "5% cost effect" is log(0.95) = -0.0513 on this scale.\n');

const pooled = [];
for (const { h, dir, ratios, names } of perHarness) {
  const s = sd(ratios), m = mean(ratios);
  const worstI = ratios.map((v, i) => [Math.abs(v - m), i]).sort((a, b) => b[0] - a[0])[0][1];
  const trimmed = ratios.filter((_, i) => i !== worstI);
  const sT = sd(trimmed);
  pooled.push(...ratios);
  console.log(`-- ${h} (${dir}) --  ${ratios.length} paired tasks`);
  console.log(`   mean log-ratio ${m.toFixed(4)} (= ${((Math.exp(m) - 1) * 100).toFixed(1)}% cost)   sd ${s.toFixed(4)}`);
  console.log(`   widest task: ${names[worstI]} at ${((Math.exp(ratios[worstI]) - 1) * 100).toFixed(0)}%  ->  sd without it ${sT.toFixed(4)} (${((1 - sT / s) * 100).toFixed(0)}% lower)`);
  console.log(`   tasks needed for 80% power, alpha .05 two-sided:`);
  for (const e of EFFECTS) {
    const d = Math.abs(Math.log(1 - e));
    console.log(`      ${String(Math.round(e * 100)).padStart(3)}% cost effect  ->  n = ${String(nFor(d, s, Z_80)).padStart(5)}   (n = ${String(nFor(d, sT, Z_80)).padStart(5)} without that one task)`);
  }
  console.log('');
}

if (pooled.length) {
  const s = sd(pooled);
  console.log(`-- POOLED --  ${pooled.length} paired task-harness observations, sd ${s.toFixed(4)}`);
  console.log('   effect     n @80%    n @90%');
  for (const e of EFFECTS) {
    const d = Math.abs(Math.log(1 - e));
    console.log(`   ${String(Math.round(e * 100)).padStart(3)}% cost   ${String(nFor(d, s, Z_80)).padStart(7)}   ${String(nFor(d, s, Z_90)).padStart(7)}`);
  }
}

console.log('\n=== SOLVE: what "detect a one-task difference" actually costs ===');
console.log('McNemar on discordant pairs. Only tasks where the two arms DISAGREE carry information,');
console.log('so the required N is set by how rare disagreement is, not by the number of tasks.\n');
for (const { h, solve } of perHarness) {
  const disc = solve.filter(x => x.s !== x.n).length;
  const rate = disc / solve.length;
  console.log(`  ${h.padEnd(10)} discordant ${disc}/${solve.length} = ${(rate * 100).toFixed(1)}%`);
  // To see a 2:1 split of discordant pairs (p=2/3) at 80% power you need ~b discordant pairs:
  //   n_disc = (Z_A*0.5 + Z_80*sqrt(p(1-p)))^2 / (p-0.5)^2   for the binomial sign test form.
  for (const p of [0.70, 0.80]) {
    const nd = Math.ceil(((Z_A * 0.5 + Z_80 * Math.sqrt(p * (1 - p))) ** 2) / ((p - 0.5) ** 2));
    console.log(`     to call a ${Math.round(p * 100)}/${Math.round((1 - p) * 100)} split of flips: ${nd} discordant pairs -> ${rate > 0 ? Math.ceil(nd / rate) : '∞'} tasks at this discordance rate`);
  }
}
console.log('\nREAD: the cost line sizes the corpus; the solve line is usually the binding one, and it');
console.log('is the reason a task set sized for cost cannot also settle solve.');
