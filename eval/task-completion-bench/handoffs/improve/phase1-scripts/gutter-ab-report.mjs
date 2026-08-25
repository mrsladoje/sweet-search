#!/usr/bin/env node
// Three-way: does the read gutter cost codex resolution?
//   TAB   = rb-codex-20260825 sweet   (the shipped default; baseline, not re-run)
//   PIPE  = gab-pipe-20260825         (SS_READ_GUTTER=pipe, the pre-116ca2b render)
//   NONE  = gab-none-20260825         (SS_READ_LINENUMS=0, no gutter at all)
// Native from rb-codex is shown for reference; it never calls ss-read so no arm touches it.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const R='/root/sweet-search-private/eval/task-completion-bench/results';
const TASKS=['jashkenas__underscore-2757','pytask-dev__pytask-210','rstudio-education__gradethis-161',
  'teleporthq__teleport-code-generators-291','ontodev__robot-710','epiforecasts__scoringutils-229'];
const CONTROLS=new Set(['ontodev__robot-710','epiforecasts__scoringutils-229']);
function load(run,arm){
  const f=path.join(R,run,'rows.json'); if(!existsSync(f))return null;
  const rows=JSON.parse(readFileSync(f,'utf8')).filter(r=>r.arm===arm&&TASKS.includes(r.taskId));
  const by={}; for(const r of rows){(by[r.taskId]=by[r.taskId]||[]).push(!!r.resolved);}
  return {by,n:rows.length,solved:rows.filter(r=>r.resolved).length,
    cost:rows.reduce((a,b)=>a+(b.realFromTurnsUsd||0),0)};
}
const arms={ TAB:load('rb-codex-20260825','sweet'), PIPE:load('gab-pipe-20260825','sweet'),
             NONE:load('gab-none-20260825','sweet'), 'native(ref)':load('rb-codex-20260825','native') };
const names=Object.keys(arms).filter(k=>arms[k]);
console.log('task'.padEnd(44)+names.map(n=>n.padStart(13)).join(''));
for(const t of TASKS){
  const cells=names.map(n=>{const v=arms[n].by[t]; return v?`${v.filter(Boolean).length}/${v.length}`.padStart(13):'-'.padStart(13);});
  console.log(t.padEnd(44)+cells.join('')+(CONTROLS.has(t)?'   <- control':''));
}
console.log('-'.repeat(44+13*names.length));
for(const n of names){
  const a=arms[n];
  const ctl=TASKS.filter(t=>CONTROLS.has(t)).flatMap(t=>a.by[t]||[]);
  const tgt=TASKS.filter(t=>!CONTROLS.has(t)).flatMap(t=>a.by[t]||[]);
  console.log(`${n.padEnd(14)} all ${String(a.solved).padStart(2)}/${String(a.n).padEnd(2)}   target-tasks ${tgt.filter(Boolean).length}/${tgt.length}   controls ${ctl.filter(Boolean).length}/${ctl.length}   $/rollout $${(a.cost/a.n).toFixed(6)}`);
}
const t=arms.TAB,p=arms.PIPE;
if(t&&p) console.log(`\nPIPE minus TAB on all six tasks: ${p.solved-t.solved} rollouts`);
if(t&&arms.NONE) console.log(`NONE minus TAB on all six tasks: ${arms.NONE.solved-t.solved} rollouts`);
