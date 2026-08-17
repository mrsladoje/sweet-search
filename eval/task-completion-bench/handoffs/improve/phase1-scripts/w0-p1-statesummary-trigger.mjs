import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
const R='/root/sweet-search-private/eval/task-completion-bench/results';
const out=[];
for(const run of ['sb-codex-20260811','sb-opencode-20260811','sb-claudecode-20260811']){
  const AS=path.join(R,run,'agent-state'); if(!existsSync(AS))continue;
  for(const cell of readdirSync(AS)){
    if(!cell.endsWith('-sweet'))continue;
    const task=cell.replace(/-sweet$/,''); const files=[];
    const walk=(d,dep=0)=>{if(dep>7)return;let es;try{es=readdirSync(d,{withFileTypes:true})}catch{return}
      for(const e of es){const p=path.join(d,e.name);if(e.isDirectory()){if(!p.includes('subagents'))walk(p,dep+1)}
        else if(/rollout-.*\.jsonl$|attempt-1\.stdout\.ndjson$|^[0-9a-f-]{36}\.jsonl$/.test(e.name))files.push(p)}};
    walk(path.join(AS,cell));
    for(const f of files){let t;try{if(statSync(f).size>120e6)continue;t=readFileSync(f,'utf8')}catch{continue}
      const b=[...t.matchAll(/<state_summary>([\s\S]{0,600}?)<\/state_summary>/g)].map(m=>m[1]).filter(s=>!/exactly:/.test(s));
      if(b.length)out.push({run,task,last:b[b.length-1].replace(/\\n/g,' ').replace(/\s+/g,' ').trim()});}}}
// widest defensible net for "the thing I don't know is a CONTRACT someone else defines"
const WIDE=/\b(contract|signature|expects?|expected by|api shape|calling convention|what (?:is |gets )?passed)\b/i;
const EXT=/\b(installed|upstream|library|framework|dependency|third[- ]party|pytest|node_modules|site-packages)\b/i;
const wide=out.filter(o=>WIDE.test(o.last)), ext=out.filter(o=>EXT.test(o.last));
console.log(`sweet rollouts with a real terminal state_summary: ${out.length}`);
console.log(`  naming an EXTERNAL/dependency source (narrow): ${ext.length}`);
console.log(`  naming ANY unresolved contract/signature (wide upper bound): ${wide.length}`);
console.log(`\n--- the wide matches, to judge by eye ---`);
for(const o of wide) console.log(`  ${o.run.replace('sb-','').replace('-20260811','').padEnd(11)} ${o.task.slice(0,32).padEnd(32)} ${o.last.slice(0,130)}`);
