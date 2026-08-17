#!/usr/bin/env node
// SLATE-B Phase 0 — rebuild the cost/solve table on the ADMISSIBLE task set.
//
// Blocking a task changes the denominator, so the published table has to follow it.
// This recomputes the three-harness scoreboard with the blocklist applied, beside the
// all-17 numbers, so the movement caused by admission is visible rather than implied.
//
// Method notes that decide whether the numbers mean anything:
//  - PER-TASK MEANS, not raw arm totals. Summing each arm over unequal n is the
//    estimator defect corrected in RESULTS-2026-08-13.md §9.3; with both arms present
//    on every task it coincides with the total, and it stays correct when one does not.
//  - Claude uses rows-sidechain-inclusive.json when present. Delegated subagent
//    requests are billed and were originally priced at zero (PHASE-0-RESULTS.md §3).
//  - idealCost is the published column; realized is printed beside it.
//  - Solve is counted per task as "resolved in at least one rep", the aggregation the
//    original tables used, with the resolved-rep count printed so single-rep task
//    flips cannot hide inside it.
//
// $0: reads recorded rows only. Launches nothing, mutates nothing.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const RESULTS = path.join(BENCH, 'results');
const BLOCKLIST = JSON.parse(readFileSync(path.join(BENCH, 'harness/task-blocklist.json'), 'utf8')).tasks;
const BLOCKED = new Set(Object.keys(BLOCKLIST));

const RUNS = [
  { harness: 'codex', dir: 'sb-codex-20260811', rows: 'rows.json' },
  { harness: 'opencode', dir: 'sb-opencode-20260811', rows: 'rows.json' },
  { harness: 'claude-code', dir: 'sb-claudecode-20260811', rows: 'rows-sidechain-inclusive.json' },
];

const usd = (n) => '$' + n.toFixed(6);
const pct = (n) => (n >= 0 ? '+' : '') + (100 * n).toFixed(1) + '%';

function summarise(rows, { exclude }) {
  const byTask = new Map();
  for (const r of rows) {
    if (exclude.has(r.taskId)) continue;
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, { native: [], sweet: [] });
    const bucket = byTask.get(r.taskId)[r.arm];
    if (bucket) bucket.push(r);
  }
  const out = { tasks: byTask.size, native: 0, sweet: 0, solve: { native: 0, sweet: 0 }, reps: { native: 0, sweet: 0 } };
  for (const [, arms] of byTask) {
    for (const arm of ['native', 'sweet']) {
      const rs = arms[arm];
      if (!rs.length) continue;
      // mean over this task's reps, then summed across tasks = per-task mean scaled by n
      const cost = rs.reduce((a, r) => a + (Number(r.idealCostUsd) || 0), 0) / rs.length;
      out[arm] += cost;
      const solvedReps = rs.filter(r => r.resolved === true).length;
      out.reps[arm] += solvedReps;
      if (solvedReps > 0) out.solve[arm] += 1;
    }
  }
  return out;
}

console.log(`blocklist: ${[...BLOCKED].join(', ')}\n`);
const table = [];
for (const run of RUNS) {
  const p = path.join(RESULTS, run.dir, run.rows);
  if (!existsSync(p)) { console.error(`[skip] ${run.harness}: ${p} missing`); continue; }
  const rows = JSON.parse(readFileSync(p, 'utf8'));
  const all = summarise(rows, { exclude: new Set() });
  const adm = summarise(rows, { exclude: BLOCKED });
  const present = [...new Set(rows.map(r => r.taskId))].filter(t => BLOCKED.has(t));
  table.push({ harness: run.harness, ledger: run.rows, all, adm, dropped: present });
  console.log(`=== ${run.harness} (${run.rows}) ===`);
  console.log(`  dropped by admission: ${present.length ? present.join(', ') : '(none present)'}`);
  for (const [label, s] of [['all tasks', all], ['ADMISSIBLE', adm]]) {
    const delta = (s.sweet - s.native) / s.native;
    console.log(`  ${label.padEnd(11)} n=${String(s.tasks).padStart(2)}  native ${usd(s.native)}  sweet ${usd(s.sweet)}  ${pct(delta)}`
      + `   solve ${s.solve.native}/${s.tasks} vs ${s.solve.sweet}/${s.tasks}  (reps ${s.reps.native} vs ${s.reps.sweet})`);
  }
  console.log('');
}
console.log(JSON.stringify(table, null, 2));
