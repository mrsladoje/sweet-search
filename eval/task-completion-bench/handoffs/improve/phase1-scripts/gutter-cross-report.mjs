#!/usr/bin/env node
// Cross-harness gutter A/B. Executes GUTTER-AB-PREREGISTRATION.md.
// Reports BOTH pre-registered outcomes: resolution, and edit-anchor failures — the quantity
// the tab was adopted to fix. Resolution alone must not overturn an anchor regression.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const R='/root/sweet-search-private/eval/task-completion-bench/results';
const TASKS=['jashkenas__underscore-2757','pytask-dev__pytask-210','rstudio-education__gradethis-161',
  'teleporthq__teleport-code-generators-291','ontodev__robot-710','epiforecasts__scoringutils-229'];
const CONTROLS=new Set(['ontodev__robot-710','epiforecasts__scoringutils-229']);
const CELLS={
  codex:      { TAB:['rb-codex-20260825','sweet'], PIPE:['gab-pipe-20260825','sweet'], NONE:['gab-none-20260825','sweet'], 'native(ref)':['rb-codex-20260825','native'] },
  opencode:   { TAB:['rb-opencode-20260824','sweet'], PIPE:['gx-oc-pipe-20260825','sweet'], NONE:['gx-oc-none-20260825','sweet'], 'native(ref)':['rb-opencode-20260824','native'] },
  'claude-code':{ TAB:['rb-claudecode-20260824','sweet'], PIPE:['gx-cc-pipe-20260825','sweet'], NONE:['gx-cc-none-20260825','sweet'], 'native(ref)':['rb-claudecode-20260824','native'] },
};
const walk=(d,o=[])=>{let e=[];try{e=readdirSync(d,{withFileTypes:true})}catch{return o}
  for(const x of e){const p=path.join(d,x.name);x.isDirectory()?walk(p,o):o.push(p)}return o};
const jl=f=>readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);

// Anchor failures + gutter census, per harness trace format.
function traceStats(run,arm,harness){
  const dir=path.join(R,run,'agent-state'); if(!existsSync(dir))return null;
  let tab=0,pipe=0,anchor=0,edits=0;
  for(const cell of readdirSync(dir)){
    if(!cell.endsWith('-'+arm))continue;
    const task=cell.replace(/-(native|sweet)$/,''); if(!TASKS.includes(task))continue;
    for(const f of walk(path.join(dir,cell))){
      let recs=null;
      if(harness==='opencode'&&f.endsWith('attempt-1.stdout.ndjson'))recs='oc';
      else if(harness==='claude-code'&&f.endsWith('.jsonl')&&f.includes('/claude-home/projects/')&&!f.includes('/subagents/'))recs='cc';
      else if(harness==='codex'&&/rollout-.*\.jsonl$/.test(f))recs='cx';
      if(!recs)continue;
      const uses=new Map();
      for(const d of jl(f)){
        let out='',isEdit=false,inp='';
        if(recs==='oc'){ if(d.type!=='tool_use')continue; const p=d.part||{},st=p.state||{};
          inp=JSON.stringify(st.input??{}); out=typeof st.output==='string'?st.output:JSON.stringify(st.output??'');
          isEdit=/apply_patch|^edit$|^write$/.test(p.tool||''); if(isEdit&&st.status==='error')anchor++;
          if(isEdit)edits++; }
        else if(recs==='cx'){ const p=d.payload||{},t=p.type||d.type;
          if(t==='function_call'||t==='custom_tool_call'){ uses.set(p.call_id||p.id,String(p.arguments??p.input??'')); continue; }
          if(t!=='function_call_output'&&t!=='custom_tool_call_output')continue;
          const raw=p.output; out=typeof raw==='string'?raw:Array.isArray(raw)?raw.map(x=>x.text||'').join('\n'):JSON.stringify(raw??''); }
        else { const m=d.message; if(!m)continue;
          for(const b of (Array.isArray(m.content)?m.content:[])){
            if(b.type==='tool_use')uses.set(b.id,b.name);
            if(b.type==='tool_result'){ const c=b.content;
              const t2=typeof c==='string'?c:Array.isArray(c)?c.map(x=>x.text||'').join('\n'):JSON.stringify(c);
              if(['Edit','MultiEdit','Write'].includes(uses.get(b.tool_use_id))){ edits++;
                if(b.is_error&&/String to replace not found/i.test(t2))anchor++; }
              out+='\n'+t2; } }
        }
        for(const ln of String(out).split('\\n').join('\n').split('\n')){
          if(/^\s*\d+\t/.test(ln))tab++; else if(/^\s*\d+\|\s/.test(ln))pipe++;
        }
      }
    }
  }
  return {tab,pipe,anchor,edits};
}

for(const [harness,conds] of Object.entries(CELLS)){
  const got={};
  for(const [name,[run,arm]] of Object.entries(conds)){
    const f=path.join(R,run,'rows.json'); if(!existsSync(f))continue;
    const rows=JSON.parse(readFileSync(f,'utf8')).filter(r=>r.arm===arm&&TASKS.includes(r.taskId));
    if(!rows.length)continue;
    if(rows.some(r=>r.resolved===undefined||r.resolved===null)){ console.log(`  [${harness}/${name}] SKIPPED — ${rows.filter(r=>r.resolved==null).length} rows not graded yet`); continue; }
    const by={}; rows.forEach(r=>{(by[r.taskId]=by[r.taskId]||[]).push(!!r.resolved)});
    got[name]={by,rows,solved:rows.filter(r=>r.resolved).length,n:rows.length,
      cost:rows.reduce((a,b)=>a+(b.realFromTurnsUsd||0),0),
      trace:name==='native(ref)'?null:traceStats(run,arm,harness)};
  }
  const names=Object.keys(got); if(!names.length){console.log(`\n===== ${harness.toUpperCase()}: no graded cells yet =====`);continue;}
  console.log(`\n===== ${harness.toUpperCase()} =====`);
  console.log('task'.padEnd(44)+names.map(n=>n.padStart(13)).join(''));
  for(const t of TASKS){
    console.log(t.padEnd(44)+names.map(n=>{const v=got[n].by[t];return v?`${v.filter(Boolean).length}/${v.length}`.padStart(13):'-'.padStart(13);}).join('')+(CONTROLS.has(t)?'  <- control':''));
  }
  for(const n of names){
    const a=got[n];
    const ctl=TASKS.filter(t=>CONTROLS.has(t)).flatMap(t=>a.by[t]||[]);
    const tr=a.trace;
    console.log(`${n.padEnd(14)} total ${String(a.solved).padStart(2)}/${a.n}  controls ${ctl.filter(Boolean).length}/${ctl.length}  $/roll $${(a.cost/a.n).toFixed(6)}`
      + (tr?`   gutter[tab=${tr.tab} pipe=${tr.pipe}]  ANCHOR-FAILURES ${tr.anchor}/${tr.edits} edits`:''));
  }
}
