#!/usr/bin/env node
// analyze-run.mjs — paired A/B report for a counted run's rows.json.
//
// HEADLINE: paired REALIZED cost delta (sweet vs native) on both-solved tasks, with
// a paired-bootstrap 95% CI + two-sided p. Realized is the real money the user pays;
// pairing per task differences out the task-level cache-TTL noise (both arms run the
// same tests), leaving the genuine arm difference (incl. sweet keeping the cache warmer
// by navigating faster). idealCost (cache-normalized, strips even arm-timing to pure
// token shape) is reported BESIDE it, computed the same paired way.
//
// Usage: node analyze-run.mjs <rows.json> [--ledger <ledger.jsonl>] [--boot 10000]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ROWS = args.find(a => !a.startsWith('--'));
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const B = +arg('boot', 10000);
if (!ROWS) { console.error('usage: analyze-run.mjs <rows.json> [--ledger <f>] [--boot N]'); process.exit(2); }

const raw = JSON.parse(readFileSync(ROWS, 'utf8'));
const rows = Array.isArray(raw) ? raw : (raw.rows || []);

// Aggregate reps: per (taskId, arm) → mean costs, resolved = any rep resolved (graded).
const cell = new Map();  // key `${task}|${arm}` -> {task, arm, real:[], ideal:[], resolved}
for (const r of rows) {
  const k = `${r.taskId}|${r.arm}`;
  let c = cell.get(k); if (!c) { c = { task: r.taskId, arm: r.arm, real: [], ideal: [], resolved: false, calls: [] }; cell.set(k, c); }
  if (r.costRealizedUsd != null) c.real.push(r.costRealizedUsd);
  if (r.idealCostUsd != null) c.ideal.push(r.idealCostUsd);
  if (r.calls != null) c.calls.push(r.calls);
  if (r.resolved) c.resolved = true;
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const byTask = new Map();
for (const c of cell.values()) {
  let t = byTask.get(c.task); if (!t) { t = {}; byTask.set(c.task, t); }
  t[c.arm] = { real: mean(c.real), ideal: mean(c.ideal), resolved: c.resolved, calls: mean(c.calls) };
}
const tasks = [...byTask.values()].filter(t => t.native && t.sweet);   // paired only

// ---- resolution parity ----
const wilson = (k, n) => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n; const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const nRes = tasks.filter(t => t.native.resolved).length, sRes = tasks.filter(t => t.sweet.resolved).length;
const both = tasks.filter(t => t.native.resolved && t.sweet.resolved);
const onlyN = tasks.filter(t => t.native.resolved && !t.sweet.resolved).length;
const onlySw = tasks.filter(t => !t.native.resolved && t.sweet.resolved).length;
const neither = tasks.filter(t => !t.native.resolved && !t.sweet.resolved).length;
const [nlo, nhi] = wilson(nRes, tasks.length), [slo, shi] = wilson(sRes, tasks.length);

// ---- paired bootstrap on a per-task delta over a stratum ----
// Deterministic PRNG (mulberry32) — no Math.random (reproducible; workflow-safe).
function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function pairedBoot(stratum, field) {
  // per-task: native - sweet (positive = sweet cheaper); pctRed = (nat-sw)/nat
  const d = stratum.map(t => t.native[field] - t.sweet[field]);
  const natSum = stratum.reduce((a, t) => a + t.native[field], 0);
  const swSum = stratum.reduce((a, t) => a + t.sweet[field], 0);
  const pctRed = natSum ? (natSum - swSum) / natSum * 100 : 0;   // aggregate % reduction
  const obsMean = mean(d);
  const rng = mulberry32(0xC0FFEE ^ field.length ^ stratum.length);
  const means = [], pcts = [];
  for (let b = 0; b < B; b++) {
    let sd = 0, sn = 0, ss = 0;
    for (let i = 0; i < stratum.length; i++) { const j = (rng() * stratum.length) | 0; const t = stratum[j]; sd += t.native[field] - t.sweet[field]; sn += t.native[field]; ss += t.sweet[field]; }
    means.push(sd / stratum.length);
    pcts.push(sn ? (sn - ss) / sn * 100 : 0);
  }
  means.sort((a, b) => a - b); pcts.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * arr.length)))];
  // two-sided p: fraction of bootstrap means on the opposite side of 0 from the observed, ×2
  const opp = obsMean > 0 ? means.filter(m => m <= 0).length : means.filter(m => m >= 0).length;
  const p = Math.min(1, 2 * opp / B);
  return { natSum, swSum, pctRed, obsMean, ciMeanLo: q(means, 0.025), ciMeanHi: q(means, 0.975), ciPctLo: q(pcts, 0.025), ciPctHi: q(pcts, 0.975), p, n: stratum.length };
}

const fmt = x => (x >= 0 ? '+' : '') + x.toFixed(1);
console.log(`\n=== A/B run report: ${rows.length} rows, ${tasks.length} paired tasks ===\n`);
console.log('RESOLUTION (parity check):');
console.log(`  native ${nRes}/${tasks.length} [${(100 * nlo).toFixed(0)}–${(100 * nhi).toFixed(0)}%]   sweet ${sRes}/${tasks.length} [${(100 * slo).toFixed(0)}–${(100 * shi).toFixed(0)}%]`);
console.log(`  both=${both.length}  native-only=${onlyN}  sweet-only=${onlySw}  neither=${neither}`);

for (const [label, stratum] of [['BOTH-SOLVED (clean cost comparison)', both], ['ALL PAIRED', tasks]]) {
  if (!stratum.length) { console.log(`\n${label}: (no tasks)`); continue; }
  const R = pairedBoot(stratum, 'real');
  const I = pairedBoot(stratum, 'ideal');
  console.log(`\n${label}  (n=${stratum.length})`);
  console.log(`  ▶ HEADLINE  REALIZED  sweet ${R.pctRed >= 0 ? '−' : '+'}${Math.abs(R.pctRed).toFixed(1)}% vs native   ($${R.natSum.toFixed(2)} → $${R.swSum.toFixed(2)})`);
  console.log(`             paired Δ/task $${R.obsMean.toFixed(4)}  95% CI [$${R.ciMeanLo.toFixed(4)}, $${R.ciMeanHi.toFixed(4)}]  %CI [${fmt(R.ciPctLo)}%, ${fmt(R.ciPctHi)}%]  p=${R.p.toFixed(3)}`);
  console.log(`    idealCost  sweet ${I.pctRed >= 0 ? '−' : '+'}${Math.abs(I.pctRed).toFixed(1)}% vs native   ($${I.natSum.toFixed(2)} → $${I.swSum.toFixed(2)})   %CI [${fmt(I.ciPctLo)}%, ${fmt(I.ciPctHi)}%]  p=${I.p.toFixed(3)}`);
}
console.log('');
