// p3-ops-per-envelope: on opencode, count OPERATIONS (not envelopes) per model step, both arms.
// Sweet chains ss-* ops with && inside one bash tool call; native issues one op per tool call.
// Uses rows.json openCodeRawAttempts[].stdout to pick the graded transcript (trap 5).
import fs from 'node:fs';
const BASE='/root/sweet-search-private/eval/task-completion-bench/results/';
const repair=new Set(fs.readFileSync('/root/fresh-run/repair-tasks.txt','utf8').split('\n').filter(Boolean));
function rowsOf(run){ return JSON.parse(fs.readFileSync(BASE+run+'/rows.json','utf8')); }
function transcriptOf(row){
  const att=(row.openCodeRawAttempts||[]).map(a=>a.stdout).filter(Boolean);
  if(!att.length) return null; const f=att[att.length-1]; return f.startsWith('/')?f:('/root/sweet-search-private/eval/task-completion-bench/'+f);
}
function countOps(cmd){
  // split a shell line into ops on && ; | and newlines; count ss-* ops and other ops
  const parts=cmd.split(/&&|\|\||;|\n|\|/).map(s=>s.trim()).filter(Boolean);
  let ss=0, other=0; for(const p of parts){ if(/^(\S*\/)?ss-(read|search|grep|find|semantic|trace|batch|files)\b/.test(p)||/\bss-(read|search|grep|find|semantic|trace)\b/.test(p)) ss++; else other++; }
  return {ss, other, parts:parts.length};
}
function analyse(file){
  const lines=fs.readFileSync(file,'utf8').split('\n');
  const seen=new Map(); let steps=0;
  for(const l of lines){ if(!l) continue; let o; try{o=JSON.parse(l);}catch{continue;}
    if(o.type==='step_finish'||o.type==='step-finish') steps++;
    if(o.type==='tool_use'){ const p=o.part||{}; const id=p.callID||p.callId||p.id; const tool=p.tool; const input=(p.state&&p.state.input)||{};
      seen.set(id,{tool,input}); } }
  let envelopes=0, ops=0, ssOps=0, nativeToolCalls=0, bashEnv=0, bashMulti=0;
  for(const {tool,input} of seen.values()){
    envelopes++;
    if(tool==='bash'){ bashEnv++; const c=countOps(String(input.command||'')); ops+=c.parts; ssOps+=c.ss; if(c.parts>1) bashMulti++; }
    else { ops++; nativeToolCalls++; }
  }
  return {steps, envelopes, ops, ssOps, bashEnv, bashMulti, nativeToolCalls};
}
const agg={};
function add(arm,r){ const a=agg[arm]||(agg[arm]={n:0,steps:0,envelopes:0,ops:0,ssOps:0,bashEnv:0,bashMulti:0,nativeToolCalls:0}); a.n++; for(const k of Object.keys(r)) a[k]+=r[k]; }
// native + non-repair sweet from fp-opencode-tab; repair sweet from rp-oc-tab
for(const row of rowsOf('fp-opencode-tab-20260826')){
  if(row.arm==='sweet' && repair.has(row.taskId)) continue;
  const f=transcriptOf(row); if(!f||!fs.existsSync(f)) continue; add(row.arm, analyse(f));
}
for(const row of rowsOf('rp-oc-tab-20260827')){ if(row.arm!=='sweet') continue; const f=transcriptOf(row); if(!f||!fs.existsSync(f)) continue; add('sweet', analyse(f)); }
for(const [arm,a] of Object.entries(agg)){
  console.log(arm, 'rollouts='+a.n, 'steps/rollout='+(a.steps/a.n).toFixed(2), 'envelopes/rollout='+(a.envelopes/a.n).toFixed(2), 'ops/rollout='+(a.ops/a.n).toFixed(2), 'ssOps/rollout='+(a.ssOps/a.n).toFixed(2), 'envelopes/step='+(a.envelopes/a.steps).toFixed(3), 'ops/step='+(a.ops/a.steps).toFixed(3), 'bash envelopes with >1 op: '+a.bashMulti+'/'+a.bashEnv+' ('+(100*a.bashMulti/Math.max(1,a.bashEnv)).toFixed(1)+'%)');
}
