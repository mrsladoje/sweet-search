#!/usr/bin/env node
// E4 — claude-code solve matrix over the fresh-pool runs.
// Read-only. Emits JSON on stdout.
import fs from 'node:fs';
const BASE = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = {
  tab:  'fp-claudecode-tab-20260826',
  none: 'fp-claudecode-none-20260826',
  pipe: 'fp-claudecode-pipe-20260826',
};
const rowsOf = (id) => JSON.parse(fs.readFileSync(`${BASE}/${id}/rows.json`, 'utf8'));

const cells = {};           // task -> arm -> {reps:[{rep,resolved,f2pFrac,...}]}
const armOf = (form, arm) => arm === 'native' ? 'native' : form.toUpperCase();
const problems = [];
for (const [form, id] of Object.entries(RUNS)) {
  const rows = rowsOf(id);
  const nullResolved = rows.filter(r => r.resolved == null).length;
  if (nullResolved) problems.push(`${id}: ${nullResolved} rows with resolved==null`);
  for (const r of rows) {
    // native arm only lives in the tab run
    if (r.arm === 'native' && form !== 'tab') { problems.push(`${id}: unexpected native row`); }
    const a = armOf(form, r.arm);
    cells[r.taskId] ??= {};
    cells[r.taskId][a] ??= [];
    cells[r.taskId][a].push({
      run: id, rep: r.rep, resolved: !!r.resolved, f2pFrac: r.f2pFrac ?? null,
      calls: r.calls, ss: r.ss, toolCounts: r.toolCounts, patchHunks: r.patchHunks,
      patchFiles: r.patchFiles, exitReason: r.exitReason, predOk: r.predOk,
      ranTests: r.ranTests, stepsToFirstEdit: r.stepsToFirstEdit,
      rtLaunched: r.rtLaunched, rtVerdicts: r.rtVerdicts, rtNoVerdict: r.rtNoVerdict,
      rtEndedUnverified: r.rtEndedUnverified, wallMs: r.wallMs, nudges: r.nudges,
      sidechainCount: r.sidechainCount, degenerate: r.degenerate,
      costRealizedUsd: r.costRealizedUsd,
    });
  }
}
const ARMS = ['native', 'TAB', 'NONE', 'PIPE'];
const tasks = Object.keys(cells).sort();
const out = { arms: ARMS, problems, tasks: {} , summary:{} };
for (const t of tasks) {
  const rec = { solvedByArm: {}, repsByArm: {}, detail: cells[t] };
  for (const a of ARMS) {
    const reps = cells[t][a] || [];
    rec.repsByArm[a] = reps.length;
    rec.solvedByArm[a] = reps.filter(x => x.resolved).length;
    if (reps.length !== 3) problems.push(`${t} ${a}: ${reps.length} reps (expected 3)`);
  }
  const maj = a => rec.solvedByArm[a] >= 2 ? 1 : 0;
  rec.majorityByArm = Object.fromEntries(ARMS.map(a => [a, maj(a)]));
  const allSolved = ARMS.every(a => rec.solvedByArm[a] === 3);
  const allDead   = ARMS.every(a => rec.solvedByArm[a] === 0);
  const majSet = new Set(ARMS.map(a => maj(a)));
  rec.klass = allSolved ? 'solved-everywhere' : allDead ? 'dead-everywhere'
            : majSet.size > 1 ? 'discordant-majority' : 'partial-concordant';
  out.tasks[t] = rec;
}
for (const a of ARMS) out.summary[a] = tasks.reduce((s,t)=>s+out.tasks[t].solvedByArm[a],0);
out.summary.classCounts = {};
for (const t of tasks) out.summary.classCounts[out.tasks[t].klass] = (out.summary.classCounts[out.tasks[t].klass]||0)+1;
out.problems = problems;
console.log(JSON.stringify(out, null, 1));
