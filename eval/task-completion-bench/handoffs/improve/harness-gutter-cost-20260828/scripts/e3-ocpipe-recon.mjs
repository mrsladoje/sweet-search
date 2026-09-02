// e3-ocpipe-recon.mjs — reconcile the one cell where my reconstruction and the published
// figure disagree: opencode PIPE ($0.008865 here vs $0.008764 published).
import { readFileSync } from 'node:fs';
const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const rec = readFileSync('/tmp/fp-inv/e3/rollouts.ndjson', 'utf8').trim().split('\n').map(JSON.parse);
const REPAIR = new Set(readFileSync('/root/fresh-run/repair-tasks.txt', 'utf8').trim().split('\n').filter(Boolean));

for (const form of ['tab', 'none', 'pipe']) {
  const fp = JSON.parse(readFileSync(`${R}/fp-opencode-${form}-20260826/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
  const rp = JSON.parse(readFileSync(`${R}/rp-oc-${form}-20260827/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
  const mine = rec.filter(r => r.h === 'opencode' && r.form === form && r.arm === 'sweet');
  const sum = a => a.reduce((s, r) => s + (r.costRealizedUsd || 0), 0);
  const fpNon = fp.filter(r => !REPAIR.has(r.taskId));
  const fpRep = fp.filter(r => REPAIR.has(r.taskId));
  const A = sum(fpNon) + sum(rp);                       // rp REPLACES fp on repair tasks
  const B = sum(fp) + sum(rp.filter(r => !fp.some(f => f.taskId === r.taskId && f.rep === r.rep)));  // fp kept, rp only backfills
  const C = sum(fp) + sum(rp);                          // both pooled (wrong, n>66)
  console.log(`opencode ${form.toUpperCase().padEnd(4)}  mine=$${(mine.reduce((s, r) => s + r.realUsd, 0) / 66).toFixed(6)}`,
    `A(replace,n=${fpNon.length + rp.length})=$${(A / (fpNon.length + rp.length)).toFixed(6)}`,
    `B(backfill,n=${fp.length + rp.filter(r => !fp.some(f => f.taskId === r.taskId && f.rep === r.rep)).length})=$${(B / (fp.length + rp.filter(r => !fp.some(f => f.taskId === r.taskId && f.rep === r.rep)).length)).toFixed(6)}`,
    `C(pooled,n=${fp.length + rp.length})=$${(C / (fp.length + rp.length)).toFixed(6)}`);
}

// Per-task, PIPE only: mine vs rows(replace)
console.log('\nPIPE per-task, mine vs rows(A):');
const fp = JSON.parse(readFileSync(`${R}/fp-opencode-pipe-20260826/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
const rp = JSON.parse(readFileSync(`${R}/rp-oc-pipe-20260827/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
const tasks = [...new Set([...fp, ...rp].map(r => r.taskId))].sort();
for (const t of tasks) {
  const src = REPAIR.has(t) ? rp : fp;
  const rows = src.filter(r => r.taskId === t);
  const mine = rec.filter(r => r.h === 'opencode' && r.form === 'pipe' && r.arm === 'sweet' && r.task === t);
  const a = rows.reduce((s, r) => s + (r.costRealizedUsd || 0), 0);
  const b = mine.reduce((s, r) => s + r.realUsd, 0);
  const flag = Math.abs(a - b) > 1e-6 ? '   <== DIFF' : '';
  console.log(`  ${t.padEnd(42)} rows n=${rows.length} $${a.toFixed(6)}   mine n=${mine.length} $${b.toFixed(6)}${flag}`);
}
