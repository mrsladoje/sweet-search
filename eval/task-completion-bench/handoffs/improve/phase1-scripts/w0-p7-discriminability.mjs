#!/usr/bin/env node
// W0-P7 secondary: is the VISIBLE suite able to reject a wrong patch?
//
// A forge selects candidates by running tests locally. That only works where the visible
// canonical suite actually discriminates. The harness's own `run_tests` wrapper emits a
// uniform verdict line in every language, so this is exact rather than estimated:
//
//     [run_tests verdict] status=PASS scope=full exit=0
//
// A task is NON-discriminable if some rollout finished with a full-scope PASS and still
// failed grading — the visible suite said yes to a wrong patch.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', 'claude-code': 'sb-claudecode-20260811' };
const EXCLUDE = 'dotnet__yarp-2825';
const walk = (d, o = []) => { let e = []; try { e = readdirSync(d, { withFileTypes: true }); } catch { return o; }
  for (const x of e) { const p = path.join(d, x.name); x.isDirectory() ? walk(p, o) : o.push(p); } return o; };
const VERDICT = /\[run_tests verdict\] status=(\w+) scope=(\w+)/g;

const perTask = new Map();
const rows = [];
for (const [harness, run] of Object.entries(RUNS)) {
  const rr = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
  for (const row of rr) {
    if (row.taskId === EXCLUDE) continue;
    const cell = path.join(RESULTS, run, 'agent-state', `${row.taskId}-${row.arm}`);
    const cand = walk(cell).filter(f =>
      harness === 'opencode' ? f.endsWith('attempt-1.stdout.ndjson')
      : harness === 'claude-code' ? (f.endsWith('.jsonl') && f.includes('/claude-home/projects/') && !f.includes('/subagents/'))
      : /rollout-.*\.jsonl$/.test(f)).sort();
    const file = (harness === 'codex' && row.rolloutFile && existsSync(row.rolloutFile)) ? row.rolloutFile : cand[row.rep];
    if (!file || !existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    let m, last = null, n = 0;
    VERDICT.lastIndex = 0;
    while ((m = VERDICT.exec(text))) { last = { status: m[1], scope: m[2] }; n++; }
    const greenFull = !!last && last.status === 'PASS' && last.scope === 'full';
    const falseGreen = greenFull && !row.resolved;
    rows.push({ harness, task: row.taskId, arm: row.arm, rep: row.rep, resolved: !!row.resolved,
      testRuns: n, finalVerdict: last ? `${last.status}/${last.scope}` : 'none', greenFull, falseGreen });
    if (!perTask.has(row.taskId)) perTask.set(row.taskId, { falseGreen: 0, n: 0 });
    const t = perTask.get(row.taskId); t.n++; if (falseGreen) t.falseGreen++;
  }
}

console.log(`rollouts=${rows.length}`);
console.log(`final verdict never emitted: ${rows.filter(r => r.finalVerdict === 'none').length}`);
console.log(`ended green on the FULL visible suite: ${rows.filter(r => r.greenFull).length}`);
console.log(`FALSE GREEN (visible suite passed, grading failed): ${rows.filter(r => r.falseGreen).length}\n`);
console.log('per task — falseGreen / rollouts   (a task with ANY false green is NOT locally selectable)');
for (const [task, t] of [...perTask].sort((a, b) => b[1].falseGreen - a[1].falseGreen)) {
  console.log(`  ${task.padEnd(42)} ${String(t.falseGreen).padStart(2)}/${t.n}  ${t.falseGreen ? 'NOT discriminable' : 'discriminable'}`);
}
const bad = [...perTask].filter(([, t]) => t.falseGreen > 0).length;
console.log(`\ntasks where the visible suite cannot reject a wrong patch: ${bad}/${perTask.size}`);
