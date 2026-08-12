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
//                             [--exclude id1,id2] [--quiet-evidence]
//
// --exclude drops named tasks and prints the whole report a second time without them. A task
// whose issue text is empty (mransan__ocaml-protoc-202: zero characters) is answered correctly
// by refusing, which costs almost nothing, so leaving it in flatters whichever arm refuses.
// The honest publication carries BOTH views, which is why this is a first-class flag rather
// than a hand-edited number (D-5).
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ROWS = args.find(a => !a.startsWith('--'));
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const B = +arg('boot', 10000);
const EXCLUDE = new Set(String(arg('exclude', '')).split(',').map(s => s.trim()).filter(Boolean));
if (!ROWS) { console.error('usage: analyze-run.mjs <rows.json> [--ledger <f>] [--boot N] [--exclude ids]'); process.exit(2); }

const raw = JSON.parse(readFileSync(ROWS, 'utf8'));
const allRows = Array.isArray(raw) ? raw : (raw.rows || []);

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const wilson = (k, n) => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n; const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };

// ---- grader evidence gate (D-1) ----
// A row is only counted once its grading log proved the suite actually executed. The two
// evidence-free causes are NOT interchangeable and are reported separately:
//   task-wide       no patch on that task produced a test result → image/grader defect. The
//                   task cannot contribute a solve number at all until it is regraded.
//   patch-specific  a sibling row on the same task DID run tests → that patch broke the
//                   build, which is a real agent failure and stays in the denominator.
function evidenceAudit(rows) {
  const byTask = new Map();
  for (const r of rows) {
    if (r.gradeable == null) continue;
    const a = byTask.get(r.taskId) || { total: 0, blind: 0 };
    a.total++; if (r.noTestEvidence) a.blind++;
    byTask.set(r.taskId, a);
  }
  const taskWide = new Set(), patchSpecific = [];
  for (const [id, a] of byTask) if (a.blind && a.blind === a.total) taskWide.add(id);
  for (const r of rows) if (r.noTestEvidence && !taskWide.has(r.taskId)) patchSpecific.push(`${r.taskId}/${r.arm}/r${r.rep}`);
  // Rows published as gradeable with no evidence at all: the Phase-0 stop-rule violation.
  const unproven = rows.filter(r => r.gradeable === true && r.noTestEvidence === true)
    .map(r => `${r.taskId}/${r.arm}/r${r.rep}`);
  return { taskWide, patchSpecific, unproven };
}

function report(rows, label) {
  const ev = evidenceAudit(rows);
  // Aggregate reps: per (taskId, arm) → mean costs, resolved = any rep resolved (graded).
  const cell = new Map();  // key `${task}|${arm}` -> {task, arm, real:[], ideal:[], resolved}
  for (const r of rows) {
    const k = `${r.taskId}|${r.arm}`;
    let c = cell.get(k); if (!c) { c = { task: r.taskId, arm: r.arm, real: [], ideal: [], brk: [], brkRows: 0, rewrites: 0, resolved: false, resReps: 0, gradedReps: 0, calls: [] }; cell.set(k, c); }
    if (r.costRealizedUsd != null) c.real.push(r.costRealizedUsd);
    if (r.idealCostUsd != null) c.ideal.push(r.idealCostUsd);
    // break-priced: cache-normalized AND aware that deleting/reordering context breaks the prefix
    // cache. Falls back to idealCost for rows collected before the column existed.
    if (r.breakPricedCostUsd != null) { c.brk.push(r.breakPricedCostUsd); c.brkRows++; }
    else if (r.idealCostUsd != null) c.brk.push(r.idealCostUsd);   // legacy row: column not collected
    c.rewrites += r.contextRewrites || 0;
    if (r.calls != null) c.calls.push(r.calls);
    if (r.resolved) { c.resolved = true; c.resReps++; }
    // Resolved-REP denominator: a rep counts once its grade rests on executed tests. A
    // task-wide evidence failure is not a rep the agent lost, so it is excluded; a
    // patch-specific build break is, so it stays as an unresolved rep.
    if (r.gradeable === true || (r.noTestEvidence && !ev.taskWide.has(r.taskId))) c.gradedReps++;
  }
  const byTask = new Map();
  for (const c of cell.values()) {
    let t = byTask.get(c.task); if (!t) { t = { id: c.task }; byTask.set(c.task, t); }
    t[c.arm] = { real: mean(c.real), ideal: mean(c.ideal), brk: mean(c.brk), brkRows: c.brkRows, rewrites: c.rewrites, resolved: c.resolved, resReps: c.resReps, gradedReps: c.gradedReps, calls: mean(c.calls) };
  }
  const paired = [...byTask.values()].filter(t => t.native && t.sweet);   // paired only
  // Tasks with no test evidence anywhere carry no solve information; they are held out of
  // the solve tables and named, rather than silently scored zero for both arms.
  const tasks = paired.filter(t => !ev.taskWide.has(t.id));
  const held = paired.filter(t => ev.taskWide.has(t.id));

  // ---- resolution parity ----
  const nRes = tasks.filter(t => t.native.resolved).length, sRes = tasks.filter(t => t.sweet.resolved).length;
  const both = tasks.filter(t => t.native.resolved && t.sweet.resolved);
  const onlyN = tasks.filter(t => t.native.resolved && !t.sweet.resolved).length;
  const onlySw = tasks.filter(t => !t.native.resolved && t.sweet.resolved).length;
  const neither = tasks.filter(t => !t.native.resolved && !t.sweet.resolved).length;
  const [nlo, nhi] = wilson(nRes, tasks.length), [slo, shi] = wilson(sRes, tasks.length);
  const repsOf = arm => [tasks.reduce((a, t) => a + t[arm].resReps, 0), tasks.reduce((a, t) => a + t[arm].gradedReps, 0)];
  const [nrR, nrN] = repsOf('native'), [srR, srN] = repsOf('sweet');

  console.log(`\n=== A/B run report${label ? ' — ' + label : ''}: ${rows.length} rows, ${tasks.length} paired tasks ===\n`);
  if (ev.unproven.length) {
    console.log(`*** STOP-RULE VIOLATION: ${ev.unproven.length} row(s) are gradeable=true with no test evidence. ***`);
    console.log(`    ${ev.unproven.join(', ')}\n`);
  }
  if (held.length) {
    console.log(`GRADER EVIDENCE (D-1): ${held.length} task(s) held out of the solve tables — no patch on any arm or rep`);
    console.log(`  produced a single framework test result, so their recorded zeros are grading unknowns, not failures:`);
    console.log(`  ${held.map(t => t.id).join(', ')}\n`);
  }
  if (ev.patchSpecific.length) console.log(`  build broken by the patch (counted UNRESOLVED, kept in the denominator): ${ev.patchSpecific.join(', ')}\n`);
  console.log('RESOLUTION (parity check):');
  console.log(`  native ${nRes}/${tasks.length} [${(100 * nlo).toFixed(0)}–${(100 * nhi).toFixed(0)}%]   sweet ${sRes}/${tasks.length} [${(100 * slo).toFixed(0)}–${(100 * shi).toFixed(0)}%]`);
  console.log(`  resolved REPS  native ${nrR}/${nrN}   sweet ${srR}/${srN}   << task solve above uses any-rep; a task carried by ONE rep is unstable`);
  console.log(`  both=${both.length}  native-only=${onlyN}  sweet-only=${onlySw}  neither=${neither}`);
  return { tasks, both };
}

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

function costBlocks({ tasks, both }) {
for (const [label, stratum] of [['BOTH-SOLVED (clean cost comparison)', both], ['ALL PAIRED', tasks]]) {
  if (!stratum.length) { console.log(`\n${label}: (no tasks)`); continue; }
  const R = pairedBoot(stratum, 'real');
  const I = pairedBoot(stratum, 'ideal');
  console.log(`\n${label}  (n=${stratum.length})`);
  console.log(`  ▶ HEADLINE  REALIZED  sweet ${R.pctRed >= 0 ? '−' : '+'}${Math.abs(R.pctRed).toFixed(1)}% vs native   ($${R.natSum.toFixed(6)} → $${R.swSum.toFixed(6)})`);
  console.log(`             paired Δ/task $${R.obsMean.toFixed(4)}  95% CI [$${R.ciMeanLo.toFixed(4)}, $${R.ciMeanHi.toFixed(4)}]  %CI [${fmt(R.ciPctLo)}%, ${fmt(R.ciPctHi)}%]  p=${R.p.toFixed(3)}`);
  console.log(`    idealCost  sweet ${I.pctRed >= 0 ? '−' : '+'}${Math.abs(I.pctRed).toFixed(1)}% vs native   ($${I.natSum.toFixed(6)} → $${I.swSum.toFixed(6)})   %CI [${fmt(I.ciPctLo)}%, ${fmt(I.ciPctHi)}%]  p=${I.p.toFixed(3)}`);
  const BK = pairedBoot(stratum, 'brk');
  const rw = stratum.reduce((a, t) => a + (t.native.rewrites || 0) + (t.sweet.rewrites || 0), 0);
  const measured = stratum.some(t => (t.native.brkRows || 0) + (t.sweet.brkRows || 0) > 0);
  console.log(`    breakPriced sweet ${BK.pctRed >= 0 ? '−' : '+'}${Math.abs(BK.pctRed).toFixed(1)}% vs native   ($${BK.natSum.toFixed(6)} → $${BK.swSum.toFixed(6)})   %CI [${fmt(BK.ciPctLo)}%, ${fmt(BK.ciPctHi)}%]  p=${BK.p.toFixed(3)}`
    + (rw ? `   << ${rw} context rewrites: READ THIS ROW, idealCost is blind to the cache break`
          : (measured ? '   (== idealCost: context measured append-only)'
                      : '   (legacy rows: column not collected, mirrored from idealCost)')));
}
console.log('');
}

// ---- driver ----
costBlocks(report(allRows, EXCLUDE.size ? 'ALL TASKS' : ''));
if (EXCLUDE.size) {
  const kept = allRows.filter(r => !EXCLUDE.has(r.taskId));
  const dropped = new Set(allRows.filter(r => EXCLUDE.has(r.taskId)).map(r => r.taskId));
  console.log('='.repeat(78));
  console.log(`SENSITIVITY: same report with ${dropped.size} task(s) excluded — ${[...dropped].join(', ')}`);
  console.log('Both views are the publication; neither replaces the other.');
  console.log('='.repeat(78));
  if (dropped.size !== EXCLUDE.size) console.log(`  note: ${[...EXCLUDE].filter(i => !dropped.has(i)).join(', ')} not present in these rows`);
  costBlocks(report(kept, 'EXCLUDING ' + [...dropped].join(', ')));
}
