#!/usr/bin/env node
// SLATE-B Phase 0 / D1 — dotnet__yarp-2825 OUT-OF-SAMPLE gold re-verification.
//
// WHY THIS EXISTS. PHASE-0-RESULTS.md §2.3 established that grading the gold patch 8
// times failed the PASS_TO_PASS gate in 4 of those 8 runs, derived an 11-test flaky
// set from those gold runs, and reported "gold grades FULL 8 of 8 after exclusion".
// That 8/8 is IN-SAMPLE: the set was fitted on exactly the runs it was then checked
// against, so it is guaranteed to fit them and says nothing about the next run.
//
// This probe FREEZES that 11-test set (it is never re-derived here) and grades gold
// on a fresh batch of runs. The question is only: does the frozen exclusion hold
// out of sample, or does gold keep finding new timing-flaky tests outside it?
//
// Reads: the frozen set from the 2026-08-12 stability directory.
// Writes: results/phase0-reverify-20260817/ ONLY. No existing artifact is touched,
// and no agent patch is graded or inspected — this is about the task, not the arms.
//
// Usage on the box:  nohup node /root/p0b-yarp-reverify.mjs > /root/yarp-reverify.log 2>&1 &
// Env: GOLD_RUNS (default 8).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const BENCH = '/root/sweet-search-private/eval/task-completion-bench';
const RESULTS = path.join(BENCH, 'results');
const FROZEN = path.join(RESULTS, 'phase0-regrade-20260812', 'stability', 'flaky-set.json');
const OUT = path.join(RESULTS, 'phase0-reverify-20260817');
const VENV_PY = path.join(BENCH, '.venv-grade/bin/python');
const SR_EVAL_DIR = '/root/swe-rebench-tools/SWE-rebench-V2';
const RUNNER = path.join(BENCH, 'harness/sr-eval.py');
const TASK_ID = 'dotnet__yarp-2825';
const GOLD_RUNS = +(process.env.GOLD_RUNS || 8);

mkdirSync(OUT, { recursive: true });
const spec = JSON.parse(readFileSync(path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json'), 'utf8'))
  .find(t => t.instance_id === TASK_ID);
const F2P = new Set(spec.FAIL_TO_PASS || []);

// The frozen set. Loaded, never recomputed — recomputing it here would reproduce the
// original in-sample error with more steps.
const frozen = new Set(JSON.parse(readFileSync(FROZEN, 'utf8')).flaky);
console.log(`[frozen] ${frozen.size} PASS_TO_PASS test(s) excluded, from the 2026-08-12 gold-only derivation`);
console.log(`[task] ${TASK_ID}  F2P=${F2P.size}  fresh gold runs=${GOLD_RUNS}\n`);

function gradeGold(label) {
  const dir = path.join(OUT, label);
  mkdirSync(dir, { recursive: true });
  const tasksPath = path.join(dir, 'tasks.json');
  const reportPath = path.join(dir, 'report.json');
  writeFileSync(tasksPath, JSON.stringify([spec]));
  const args = [RUNNER, '--json', tasksPath, '--max-workers', '1',
    '--reapply-install-seds', '--report-json', reportPath, '--network', 'none', '--golden-eval'];
  const t0 = Date.now();
  try {
    execFileSync(VENV_PY, args, {
      cwd: dir,
      env: { ...process.env, SR_EVAL_DIR, PYTHONPATH: path.join(SR_EVAL_DIR, 'lib') },
      stdio: ['ignore', 'ignore', 'ignore'], timeout: 3600000,
    });
  } catch { /* non-zero exit just means not FULL; the report is the source of truth */ }
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  if (!existsSync(reportPath)) return { n: 0, f2pPass: 0, p2pFails: [], mins, noReport: true };
  const it = (JSON.parse(readFileSync(reportPath, 'utf8')).items || [])[0] || {};
  return {
    n: it.n_test_results ?? 0,
    f2pPass: (it.from_fail_to_pass || []).length,
    p2pFails: it.failed_from_pass_to_pass || [],
    mins,
  };
}

const runs = [];
for (let i = 0; i < GOLD_RUNS; i++) {
  const r = gradeGold(`gold-${i}`);
  // A failure INSIDE the frozen set is expected and excluded. A failure OUTSIDE it is
  // the finding: it means the exclusion does not generalise and the gate is still noise.
  r.escaped = r.p2pFails.filter(t => !frozen.has(t));
  r.fullAfterExclusion = !r.noReport && r.f2pPass === F2P.size && r.escaped.length === 0;
  runs.push(r);
  writeFileSync(path.join(OUT, 'reverify-runs.json'),
    JSON.stringify({ frozenSetSize: frozen.size, frozenFrom: FROZEN, runs }, null, 2));
  console.log(`[gold ${i}] ${r.mins}m n=${r.n} f2p=${r.f2pPass}/${F2P.size} `
    + `p2pFails=${r.p2pFails.length} escaped=${r.escaped.length} `
    + `${r.fullAfterExclusion ? 'FULL' : 'NOT-FULL'}`
    + (r.escaped.length ? `\n           escaped: ${r.escaped.slice(0, 4).join('\n                    ')}` : ''));
}

const full = runs.filter(r => r.fullAfterExclusion).length;
const escapedAll = [...new Set(runs.flatMap(r => r.escaped))].sort();
const summary = {
  task: TASK_ID,
  frozenSetSize: frozen.size,
  goldRuns: GOLD_RUNS,
  goldFullAfterFrozenExclusion: full,
  escapedTests: escapedAll,
  nTestResults: runs.map(r => r.n),
  // The bar: the frozen exclusion has to hold on every fresh run. Anything less means a
  // single grading of this task is still a coin flip and the solve column cannot use it.
  verdict: full === GOLD_RUNS ? 'STABLE — frozen exclusion holds out of sample'
    : `UNSTABLE — gold is FULL in only ${full}/${GOLD_RUNS} fresh runs; ${escapedAll.length} test(s) escaped the frozen set`,
};
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.verdict} ===`);
if (escapedAll.length) {
  console.log(`\n${escapedAll.length} test(s) failed gold OUTSIDE the frozen set:`);
  for (const t of escapedAll) console.log(`   ${t}`);
}
console.log(`\nwritten: ${path.join(OUT, 'summary.json')}`);
