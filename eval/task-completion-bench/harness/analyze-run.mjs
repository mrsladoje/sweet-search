#!/usr/bin/env node
// analyze-run.mjs — paired A/B report for a counted run's rows.json.
//
// SOLE COST HEADLINE: raw, untrimmed realized dollars summed over every recorded row.
// Paired both-solved/all-task bootstrap blocks remain secondary analyses; diagnostic
// flags never remove billed work from the headline. Any matched-pair or whole-task
// removal is explicitly labelled exploratory and post hoc.
//
// Usage: node analyze-run.mjs <rows.json> [--ledger <ledger.jsonl>] [--boot 10000]
//                             [--exclude id1,id2] [--quiet-evidence]
//                             [--ledger-basis current|legacy-cachewrite-claudecode-only]
//
// LEDGER BASIS. Every cost figure below names the basis it is priced on, because the same
// run priced two ways gives two different sweet-versus-native percentages. On the fresh pool
// the difference is 0.79 points on opencode and 0.29 on codex — a quarter of the gap under
// discussion, not a rounding detail. `current` charges the provider's 1.25x prompt-cache-write
// rate on all three harnesses. `legacy-cachewrite-claudecode-only` reproduces the basis
// published before 2026-09-02, where only claude-code supplied a cache-write count, and reads
// the costRealizedNoCacheWriteUsd column every runner now writes. Use it for disclosure rows
// that restate an old number; never for a headline.
//
// --exclude drops named tasks in an exploratory sensitivity report. A task
// whose issue text is empty (mransan__ocaml-protoc-202: zero characters) is answered correctly
// by refusing, which costs almost nothing, so leaving it in flatters whichever arm refuses.
// The raw untrimmed headline still remains primary and visible.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ROWS = args.find(a => !a.startsWith('--'));
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const B = +arg('boot', 10000);
const EXCLUDE = new Set(String(arg('exclude', '')).split(',').map(s => s.trim()).filter(Boolean));
if (!ROWS) { console.error('usage: analyze-run.mjs <rows.json> [--ledger <f>] [--boot N] [--exclude ids] [--ledger-basis current|legacy-cachewrite-claudecode-only]'); process.exit(2); }

const BASIS_MODE = String(arg('ledger-basis', 'current'));
if (!['current', 'legacy-cachewrite-claudecode-only'].includes(BASIS_MODE)) {
  console.error(`analyze-run: unknown --ledger-basis "${BASIS_MODE}" (current | legacy-cachewrite-claudecode-only)`); process.exit(2);
}
const LEGACY_BASIS = BASIS_MODE === 'legacy-cachewrite-claudecode-only';

const raw = JSON.parse(readFileSync(ROWS, 'utf8'));
const allRowsRaw = Array.isArray(raw) ? raw : (raw.rows || []);

// The realized column the whole report reads. On the legacy basis it is swapped for the
// column the runners write for exactly this purpose; a row that predates that column has no
// legacy figure, so it goes null and every block that needs completeness says "unavailable"
// rather than silently mixing two bases in one sum.
const allRows = LEGACY_BASIS
  ? allRowsRaw.map(r => ({
    ...r,
    costRealizedUsd: r.costRealizedNoCacheWriteUsd ?? null,
    costRealizedMainOnlyUsd: r.costRealizedNoCacheWriteMainOnlyUsd ?? null,
  }))
  : allRowsRaw;

// One label, printed beside every cost figure. Rows carry their own `ledgerBasis`; if they
// disagree with each other the run pooled two ledgers and no cost figure from it is
// comparable, so say so loudly instead of averaging them.
const rowBases = [...new Set(allRowsRaw.map(r => r.ledgerBasis).filter(Boolean))];
const BASIS_LABEL = LEGACY_BASIS
  ? 'cache-write-1.25x-claudecode-only (LEGACY, disclosure only)'
  : (rowBases.length === 1 ? rowBases[0]
    : rowBases.length === 0 ? 'UNLABELLED ROWS — basis unknown, pre-2026-09-02 collection'
      : `MIXED (${rowBases.join(' + ')}) — NOT COMPARABLE`);
const basisNote = () => `  ledger basis: ${BASIS_LABEL}`;

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
    let c = cell.get(k); if (!c) { c = { task: r.taskId, arm: r.arm, rows: 0, real: [], ideal: [], brk: [], brkRows: 0, rewrites: 0, resolved: false, resReps: 0, gradedReps: 0, calls: [] }; cell.set(k, c); }
    c.rows++;
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
    t[c.arm] = {
      real: c.real.length ? mean(c.real) : null,
      ideal: c.ideal.length ? mean(c.ideal) : null,
      brk: c.brk.length ? mean(c.brk) : null,
      realComplete: c.real.length === c.rows,
      idealComplete: c.ideal.length === c.rows,
      brkComplete: c.brk.length === c.rows,
      brkRows: c.brkRows,
      rewrites: c.rewrites,
      resolved: c.resolved,
      resReps: c.resReps,
      gradedReps: c.gradedReps,
      calls: c.calls.length ? mean(c.calls) : null,
    };
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

function rowLevelRealized(rows, { label, headline = false } = {}) {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${headline ? 'SOLE COST HEADLINE' : 'EXPLORATORY SENSITIVITY'} — ${label}`);
  console.log('  estimand: sum of costRealizedUsd over every listed row (no task-cell averaging)');
  console.log(basisNote());
  const cw = rows.map(r => r.cacheWriteTokens).filter(Number.isFinite);
  if (cw.length) console.log(`  cache-write tokens/row: mean ${Math.round(cw.reduce((a, b) => a + b, 0) / cw.length)} over ${cw.length}/${rows.length} row(s)`);
  const arms = [...new Set(rows.map(r => r.arm).filter(Boolean))].sort();
  if (!arms.length) console.log('  unavailable: no rows');
  for (const arm of arms) {
    const armRows = rows.filter(r => r.arm === arm);
    const known = armRows.filter(r => Number.isFinite(r.costRealizedUsd));
    if (known.length !== armRows.length) {
      console.log(`  ${arm}: unavailable (${armRows.length - known.length}/${armRows.length} row(s) missing realized cost)`);
      continue;
    }
    const total = known.reduce((sum, r) => sum + r.costRealizedUsd, 0);
    console.log(`  ${arm}: ${armRows.length} row(s), $${total.toFixed(6)} raw realized`);
  }
  console.log('='.repeat(78));
}

function completePairedMetric(stratum, field) {
  const completeness = `${field}Complete`;
  const missing = stratum.filter(t => !Number.isFinite(t.native[field]) || !Number.isFinite(t.sweet[field])
    || t.native[completeness] !== true || t.sweet[completeness] !== true);
  return missing.length ? { result: null, missing } : { result: pairedBoot(stratum, field), missing: [] };
}

function costBlocks({ tasks, both }) {
for (const [label, stratum] of [
  ['BOTH-SOLVED (descriptive post-treatment stratum; not a causal estimate)', both],
  ['ALL PAIRED', tasks],
]) {
  if (!stratum.length) { console.log(`\n${label}: (no tasks)`); continue; }
  console.log(`\n${label}  (n=${stratum.length})`);
  console.log(basisNote());
  const { result: R, missing: missingR } = completePairedMetric(stratum, 'real');
  if (R) {
    console.log(`    realized   sweet ${R.pctRed >= 0 ? '−' : '+'}${Math.abs(R.pctRed).toFixed(1)}% vs native   ($${R.natSum.toFixed(6)} → $${R.swSum.toFixed(6)})`);
    console.log(`               paired Δ/task $${R.obsMean.toFixed(4)}  95% CI [$${R.ciMeanLo.toFixed(4)}, $${R.ciMeanHi.toFixed(4)}]  %CI [${fmt(R.ciPctLo)}%, ${fmt(R.ciPctHi)}%]  p=${R.p.toFixed(3)}`);
  } else console.log(`    realized   unavailable (${missingR.length}/${stratum.length} paired task(s) have missing row costs)`);
  const { result: I, missing: missingI } = completePairedMetric(stratum, 'ideal');
  if (I) console.log(`    idealCost  sweet ${I.pctRed >= 0 ? '−' : '+'}${Math.abs(I.pctRed).toFixed(1)}% vs native   ($${I.natSum.toFixed(6)} → $${I.swSum.toFixed(6)})   %CI [${fmt(I.ciPctLo)}%, ${fmt(I.ciPctHi)}%]  p=${I.p.toFixed(3)}`);
  else console.log(`    idealCost  unavailable (${missingI.length}/${stratum.length} paired task(s) have missing row costs)`);
  const { result: BK, missing: missingBK } = completePairedMetric(stratum, 'brk');
  const rw = stratum.reduce((a, t) => a + (t.native.rewrites || 0) + (t.sweet.rewrites || 0), 0);
  const measured = stratum.some(t => (t.native.brkRows || 0) + (t.sweet.brkRows || 0) > 0);
  if (BK) {
    console.log(`    breakPriced sweet ${BK.pctRed >= 0 ? '−' : '+'}${Math.abs(BK.pctRed).toFixed(1)}% vs native   ($${BK.natSum.toFixed(6)} → $${BK.swSum.toFixed(6)})   %CI [${fmt(BK.ciPctLo)}%, ${fmt(BK.ciPctHi)}%]  p=${BK.p.toFixed(3)}`
      + (rw ? `   << ${rw} context rewrites: READ THIS ROW, idealCost is blind to the cache break`
            : (measured ? '   (== idealCost: context measured append-only)'
                        : '   (legacy rows: column not collected, mirrored from idealCost)')));
  } else console.log(`    breakPriced unavailable (${missingBK.length}/${stratum.length} paired task(s) have missing row costs)`);
}
console.log('');
}

// ---- output/content diagnostics (item 6) ----
// Raw, untrimmed realized cost is the sole headline. Flags are descriptive:
// arm-blind classification prevents explicit arm conditioning but does not imply
// equal flag rates or cost effects. Any removal is post-hoc sensitivity only.
function degenerationReport(rows) {
  const uninstrumented = rows.filter(r => typeof r.degenerate !== 'boolean'
    || !r.degeneration || typeof r.degeneration !== 'object'
    || r.degenerationInstrumentationComplete !== true
    || r.degeneration.instrumentation?.complete !== true);
  if (uninstrumented.length) {
    console.log(`\n${'='.repeat(78)}`);
    console.log(`DIAGNOSTIC INSTRUMENTATION INCOMPLETE: ${uninstrumented.length}/${rows.length} row(s) missing a verdict, structured detail, or explicit complete-instrumentation attestation.`);
    console.log('  Fail closed: flags and exclusion sensitivities are not reported; raw untrimmed cost remains the sole headline.');
    console.log(`  examples: ${uninstrumented.slice(0, 5).map(r => `${r.taskId ?? '?'}/${r.arm ?? '?'}/r${r.rep ?? '?'}`).join(', ')}`);
    console.log('='.repeat(78));
    return { flagged: [], collected: false };
  }
  const flagged = rows.filter(r => r.degenerate === true);
  console.log(`\n${'='.repeat(78)}`);
  console.log(`DIAGNOSTIC FLAGS (arm-blind, descriptive, never a saving): ${flagged.length} of ${rows.length} rollouts`);
  if (!flagged.length) {
    console.log('  none; no exclusion sensitivity is needed.');
    return { flagged, collected: true };
  }
  const arms = [...new Set(flagged.map(r => r.arm).filter(Boolean))].sort();
  for (const arm of arms) {
    const armRows = flagged.filter(r => r.arm === arm);
    const known = armRows.filter(r => Number.isFinite(r.costRealizedUsd));
    const cost = known.length === armRows.length
      ? `$${known.reduce((sum, r) => sum + r.costRealizedUsd, 0).toFixed(6)}`
      : `unavailable (${armRows.length - known.length}/${armRows.length} flagged row(s) missing realized cost)`;
    console.log(`  ${arm}: ${armRows.length} flag(s); ${cost} raw row-level realized cost associated with flags`);
  }
  for (const r of flagged) {
    const d = r.degeneration;
    const cost = Number.isFinite(r.costRealizedUsd) ? `$${r.costRealizedUsd.toFixed(6)}` : 'realized cost unavailable';
    console.log(`    ${r.taskId}/${r.arm}/r${r.rep}  ${cost}`
      + `  [${(d.reasons || []).join(', ') || 'flagged'}]`
      + (Number.isFinite(d.billedVsRetainedRatio) ? `  billed/visible-estimate=${d.billedVsRetainedRatio}x` : ''));
  }
  return { flagged, collected: true };
}

function pairBalance(rows) {
  const arms = [...new Set(rows.map(r => r.arm).filter(Boolean))].sort();
  const groups = new Map();
  const malformed = [];
  for (const r of rows) {
    if (r.taskId == null || r.rep == null || !r.arm) { malformed.push(r); continue; }
    const key = JSON.stringify([r.taskId, r.rep]);
    if (!groups.has(key)) groups.set(key, new Map());
    const byArm = groups.get(key);
    byArm.set(r.arm, (byArm.get(r.arm) || 0) + 1);
  }
  const incomplete = [...groups.entries()].filter(([, byArm]) => arms.length < 2
    || arms.some(arm => byArm.get(arm) !== 1) || byArm.size !== arms.length);
  return { ok: !malformed.length && !incomplete.length && arms.length >= 2, arms, incomplete, malformed };
}

function diagnosticSensitivities(rows, flagged) {
  const balance = pairBalance(rows);
  if (!balance.ok) {
    console.log(`\nEXPLORATORY DIAGNOSTIC SENSITIVITIES NOT RUN: taskId×rep pairing is incomplete or duplicated (${balance.incomplete.length} incomplete, ${balance.malformed.length} malformed).`);
    console.log('Raw untrimmed cost remains the sole headline.');
    return;
  }
  const flaggedPairs = new Set(flagged.map(r => JSON.stringify([r.taskId, r.rep])));
  const matchedKept = rows.filter(r => !flaggedPairs.has(JSON.stringify([r.taskId, r.rep])));
  console.log(`\n${'='.repeat(78)}`);
  console.log(`EXPLORATORY POST-HOC MATCHED-PAIR SENSITIVITY: remove ${flaggedPairs.size} taskId×rep pair(s), both arms (${rows.length - matchedKept.length} rows).`);
  console.log('This is not a corrected estimate and never replaces the raw headline.');
  rowLevelRealized(matchedKept, { label: 'MATCHED taskId×rep pairs retained; both arms removed together' });
  costBlocks(report(matchedKept, 'EXPLORATORY MATCHED-PAIR DIAGNOSTIC SENSITIVITY'));

  const flaggedTasks = new Set(flagged.map(r => r.taskId));
  const taskKept = rows.filter(r => !flaggedTasks.has(r.taskId));
  console.log(`\n${'='.repeat(78)}`);
  console.log(`EXPLORATORY POST-HOC WHOLE-TASK SENSITIVITY: remove ${flaggedTasks.size} flagged task(s), all arms and reps (${rows.length - taskKept.length} rows).`);
  console.log('This is not a corrected estimate and never replaces the raw headline.');
  rowLevelRealized(taskKept, { label: 'WHOLE flagged tasks removed; all arms and reps removed together' });
  costBlocks(report(taskKept, 'EXPLORATORY WHOLE-TASK DIAGNOSTIC SENSITIVITY'));
}

// ---- driver ----
rowLevelRealized(allRows, { label: 'RAW UNTRIMMED REALIZED COST; all recorded rows', headline: true });
costBlocks(report(allRows, 'RAW — NO DIAGNOSTIC EXCLUSION'));
const degen = degenerationReport(allRows);
if (degen.collected && degen.flagged.length) diagnosticSensitivities(allRows, degen.flagged);
if (EXCLUDE.size) {
  const kept = allRows.filter(r => !EXCLUDE.has(r.taskId));
  const dropped = new Set(allRows.filter(r => EXCLUDE.has(r.taskId)).map(r => r.taskId));
  console.log('='.repeat(78));
  console.log(`EXPLORATORY USER-REQUESTED TASK SENSITIVITY: ${dropped.size} task(s) excluded — ${[...dropped].join(', ')}`);
  console.log('This is not a headline and never replaces raw untrimmed cost.');
  console.log('='.repeat(78));
  if (dropped.size !== EXCLUDE.size) console.log(`  note: ${[...EXCLUDE].filter(i => !dropped.has(i)).join(', ')} not present in these rows`);
  rowLevelRealized(kept, { label: 'USER-REQUESTED TASK EXCLUSION' });
  costBlocks(report(kept, 'EXPLORATORY EXCLUSION OF ' + [...dropped].join(', ')));
}
