#!/usr/bin/env node
/**
 * Paired stats for the task-completion pilot. Resolve-rate: McNemar (paired
 * binary) + a power/N projection. Efficiency (calls/cost/wall/ss/steps):
 * paired bootstrap 95% CIs over tasks. Variance pilot ⇒ the main output is the
 * discordance + per-metric SD that powers the headline N.
 *
 * Usage: node eval/task-completion-bench/stats/task-stats.mjs <rows.json>
 */
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8')).filter(r => r.rep === 0);
const byTask = {};
for (const r of rows) (byTask[r.taskId] ||= {})[r.arm] = r;
const pairs = Object.entries(byTask).filter(([, a]) => a.native && a.sweet).map(([id, a]) => ({ id, repo: a.native.repo, n: a.native, s: a.sweet }));
const n = pairs.length;

// ---- resolve-rate (gradeable only) ----
const gradeable = pairs.filter(p => p.n.gradeable !== false && p.s.gradeable !== false && p.n.resolved != null && p.s.resolved != null);
let b = 0, c = 0, both = 0, neither = 0; // b: native✓sweet✗, c: sweet✓native✗
for (const p of gradeable) {
  const nr = !!p.n.resolved, sr = !!p.s.resolved;
  if (nr && !sr) b++; else if (sr && !nr) c++; else if (nr && sr) both++; else neither++;
}
const nativeRes = gradeable.filter(p => p.n.resolved).length;
const sweetRes = gradeable.filter(p => p.s.resolved).length;
// McNemar exact (binomial on discordant pairs)
function binomTwoSided(k, m) { // P(X<=min or >=max) under Bin(m,0.5)
  if (m === 0) return 1;
  const logC = (m, k) => { let s = 0; for (let i = 0; i < k; i++) s += Math.log(m - i) - Math.log(i + 1); return s; };
  let p = 0; for (let i = 0; i <= m; i++) p += Math.exp(logC(m, i) - m * Math.log(2));
  let tail = 0; const lo = Math.min(k, m - k), hi = Math.max(k, m - k);
  for (let i = 0; i <= m; i++) { const pi = Math.exp(logC(m, i) - m * Math.log(2)); if (i <= lo || i >= hi) tail += pi; }
  return Math.min(1, tail);
}
const mcnemarP = binomTwoSided(c, b + c);

// ---- efficiency: paired bootstrap 95% CI over tasks ----
function bootCI(deltas, B = 20000) {
  const N = deltas.length; if (!N) return { mean: NaN, lo: NaN, hi: NaN };
  const mean = deltas.reduce((a, x) => a + x, 0) / N;
  const means = [];
  // deterministic-ish bootstrap: index via a simple LCG seeded fixed (no Math.random per env rules)
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < B; i++) { let s = 0; for (let j = 0; j < N; j++) s += deltas[Math.floor(rnd() * N)]; means.push(s / N); }
  means.sort((a, x) => a - x);
  return { mean, lo: means[Math.floor(0.025 * B)], hi: means[Math.floor(0.975 * B)], sd: Math.sqrt(deltas.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, N - 1)) };
}
const metrics = ['calls', 'ss', 'nativeGrep', 'costRealizedUsd', 'costNaiveUsd', 'wallMs', 'stepsToFirstEdit'];
const eff = {};
for (const m of metrics) {
  const deltas = pairs.map(p => (p.s[m] ?? 0) - (p.n[m] ?? 0)).filter(x => Number.isFinite(x));
  eff[m] = bootCI(deltas);
}
// costContentUsd (unique context charged once — PLAN.md §3 B4) is null on adapters with
// aggregate-only usage, so it gets pair-complete filtering instead of the `?? 0` default:
// coercing a missing content cost to $0 would read as "this arm introduced no context".
const contentPairs = pairs.filter(p => Number.isFinite(p.s.costContentUsd) && Number.isFinite(p.n.costContentUsd));
eff.costContentUsd = bootCI(contentPairs.map(p => p.s.costContentUsd - p.n.costContentUsd));

// ---- CLEAN EFFICIENCY: co-solved subset (outcome-matched) ----
// Restrict to tasks where BOTH arms resolved. This controls for the 'gave-up-early'
// confound: an arm that quits early logs fewer calls/lower cost but didn't solve the
// task, which deflates aggregate efficiency. On the co-solved set the outcome is held
// fixed (both ✓), so any call/cost Δ reflects genuine efficiency, not early-quitting.
const coSolved = gradeable.filter(p => !!p.n.resolved && !!p.s.resolved);
const coN = coSolved.length;
const cleanMetrics = ['calls', 'costRealizedUsd'];
const cleanEff = {};
for (const m of cleanMetrics) {
  const deltas = coSolved.map(p => (p.s[m] ?? 0) - (p.n[m] ?? 0)).filter(x => Number.isFinite(x));
  cleanEff[m] = bootCI(deltas);
}

// ---- power projection for resolve-rate (McNemar) ----
const pDisc = (b + c) / Math.max(1, gradeable.length);      // P(discordant pair)
function nForDelta(delta, pdisc, alpha = 0.05, power = 0.8) {
  // approx paired-binary sample size: n ≈ (z_a*sqrt(pdisc) + z_b*sqrt(pdisc - delta^2))^2 / delta^2  (simplified)
  const za = 1.96, zb = 0.84;
  if (pdisc <= 0) return Infinity;
  return Math.ceil(((za + zb) ** 2 * pdisc) / (delta * delta));
}

console.log(`\n=== TASK-COMPLETION PILOT STATS (n=${n} paired tasks; ${gradeable.length} gradeable) ===`);
console.log(`\n[resolve-rate]  native ${nativeRes}/${gradeable.length} (${(100 * nativeRes / gradeable.length || 0).toFixed(0)}%)  sweet ${sweetRes}/${gradeable.length} (${(100 * sweetRes / gradeable.length || 0).toFixed(0)}%)`);
console.log(`  discordant: native✓sweet✗ b=${b}, sweet✓native✗ c=${c}; both=${both} neither=${neither}; McNemar exact p=${mcnemarP.toFixed(3)}`);
console.log(`  Δresolve = ${((sweetRes - nativeRes) / Math.max(1, gradeable.length) * 100).toFixed(1)}pp  (CI not meaningful at this n — variance pilot)`);
console.log(`\n[power projection]  P(discordant pair)=${pDisc.toFixed(3)}  → tasks needed (80% power, α.05):`);
for (const d of [0.10, 0.05, 0.03, 0.02]) console.log(`    Δ=${(d * 100).toFixed(0)}pp → ~${nForDelta(d, pDisc)} gradeable tasks/arm`);
console.log(`\n[efficiency: sweet − native, paired bootstrap 95% CI over tasks]`);
const fmt = (m, v, scale = 1, unit = '') => `  ${m.padEnd(16)} Δ=${(v.mean * scale).toFixed(3)}${unit}  CI[${(v.lo * scale).toFixed(3)}, ${(v.hi * scale).toFixed(3)}]  sd=${(v.sd * scale || 0).toFixed(2)}  ${v.lo * v.hi > 0 ? 'SIG' : 'ns'}`;
console.log(fmt('calls', eff.calls));
console.log(fmt('ss', eff.ss));
console.log(fmt('nativeGrep', eff.nativeGrep));
console.log(fmt('cost_realized$', eff.costRealizedUsd));
console.log(fmt('cost_naive$', eff.costNaiveUsd));
if (contentPairs.length) console.log(fmt(`cost_content$(n=${contentPairs.length})`, eff.costContentUsd));
console.log(fmt('wall_s', eff.wallMs, 1 / 1000, 's'));
console.log(fmt('stepsToFirstEdit', eff.stepsToFirstEdit));

// ---- PRIMARY (outcome-INDEPENDENT) efficiency metric ----
// stepsToFirstEdit is recorded BEFORE the outcome is known, so the early-quit confound
// cannot bias it — it measures how fast an arm reaches its first edit regardless of
// whether the task is ultimately resolved. This is the cleanest single efficiency signal.
const sfe = eff.stepsToFirstEdit;
console.log(`\n[★ PRIMARY EFFICIENCY — stepsToFirstEdit] (outcome-INDEPENDENT: measured before outcome ⇒ no early-quit bias)`);
console.log(`  Δ(sweet − native) = ${sfe.mean.toFixed(3)} steps  95% CI[${sfe.lo.toFixed(3)}, ${sfe.hi.toFixed(3)}]  sd=${(sfe.sd || 0).toFixed(2)}  ${sfe.lo * sfe.hi > 0 ? 'SIG' : 'ns'}  (n=${n} paired)`);

// ---- CLEAN EFFICIENCY: co-solved subset (outcome-matched) ----
console.log(`\n[CLEAN EFFICIENCY — co-solved subset: BOTH arms resolved, n=${coN}] (paired bootstrap 95% CI; outcome held fixed)`);
if (coN === 0) {
  console.log(`  (no co-solved tasks — cannot compute outcome-matched efficiency at this n)`);
} else {
  const cfmt = (label, v, scale = 1, unit = '') => `  ${label.padEnd(16)} Δ=${(v.mean * scale).toFixed(3)}${unit}  CI[${(v.lo * scale).toFixed(3)}, ${(v.hi * scale).toFixed(3)}]  sd=${(v.sd * scale || 0).toFixed(2)}  ${v.lo * v.hi > 0 ? 'SIG' : 'ns'}`;
  console.log(cfmt('calls', cleanEff.calls));
  console.log(cfmt('cost_realized$', cleanEff.costRealizedUsd));
}

console.log(`\nCAVEAT: aggregate 'calls'/'cost' conflate efficiency with early-quitting (an arm that gives up logs fewer calls without solving) — co-solved + stepsToFirstEdit are the clean, confound-free signals.`);
console.log(`\nNOTE: this is a VARIANCE pilot — use P(discordant) + per-metric sd to set the headline N. Resolve Δ here is directional only.`);
