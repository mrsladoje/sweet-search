// e4-claude-code-effort.mjs — effort profile per arm on claude-code: calls, run_tests cycles,
// edits, subagents, split by task class (solved-everywhere / hard).
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const CELLS = [['native', P.RUNS.TAB, 'native'], ['TAB', P.RUNS.TAB, 'sweet'], ['NONE', P.RUNS.NONE, 'sweet'], ['PIPE', P.RUNS.PIPE, 'sweet']];
const solveMatrix = JSON.parse(fs.readFileSync('/tmp/fp-inv/e4-claude-code/solve-matrix.json', 'utf8'));
const cls = t => solveMatrix.tasks[t].klass;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const rows = {};
for (const [form, runId, arm] of CELLS) rows[form] = JSON.parse(fs.readFileSync(`${BASE}/${runId}/rows.json`, 'utf8')).filter(r => r.arm === arm);
const groups = { all: () => true, easy: t => cls(t) === 'solved-everywhere', hard: t => cls(t) !== 'solved-everywhere', dead: t => cls(t) === 'dead-everywhere' };
console.log('group | form | n | calls | run_tests | edits | ss | nativeRead | nativeGrep | sidechains | solved');
for (const [gname, pred] of Object.entries(groups)) {
  for (const form of Object.keys(rows)) {
    const rs = rows[form].filter(r => pred(r.taskId));
    console.log([gname, form, rs.length,
      mean(rs.map(r => r.calls)).toFixed(1),
      mean(rs.map(r => r.rtLaunched || 0)).toFixed(2),
      mean(rs.map(r => r.toolCounts?.edit || 0)).toFixed(2),
      mean(rs.map(r => r.ss || 0)).toFixed(2),
      mean(rs.map(r => r.toolCounts?.nativeRead || 0)).toFixed(2),
      mean(rs.map(r => r.nativeGrep || 0)).toFixed(2),
      mean(rs.map(r => r.sidechainCount || 0)).toFixed(2),
      rs.filter(r => r.resolved).length + '/' + rs.length,
    ].join(' | '));
  }
}
const err = [];
for (const form of Object.keys(rows)) for (const r of rows[form]) if (r.exitReason !== 'model_stopped') err.push(`${form}/${r.taskId}/r${r.rep} exit=${r.exitReason} calls=${r.calls} resolved=${r.resolved}`);
console.log('\nnon-model_stopped exits:', JSON.stringify(err));
