import fs from "node:fs";
const R="/root/sweet-search-private/eval/task-completion-bench/results";
const price={in:0.10,cached:0.01,out:0.60};
const cost=r=>((r.in-(r.cached||0))*price.in+(r.cached||0)*price.cached+(r.out||0)*price.out)/1e6;
for (const [h,run] of [["codex","fp-codex-tab-20260826"],["opencode","rp-oc-tab-20260827"],["opencode-native","fp-opencode-tab-20260826"],["claude-code","fp-claudecode-tab-20260826"]]){
  for (const arm of ["sweet","native"]){
    const f=`${R}/${run}/turns/devlooped__moq-1262-${arm}.jsonl`; if(!fs.existsSync(f)){console.log(h,arm,"no turns file");continue;}
    const t=fs.readFileSync(f,"utf8").trim().split("\n").map(l=>JSON.parse(l));
    const costs=t.map(cost); const tot=costs.reduce((a,b)=>a+b,0); const last=t[t.length-1];
    const sorted=[...costs].sort((a,b)=>a-b); const med=sorted[Math.floor(sorted.length/2)];
    const extra=((last.in-(last.cached||0))*price.in+(last.cached||0)*price.cached+300*price.out)/1e6;
    console.log(`${h} ${arm}: requests=${t.length} total=$${tot.toFixed(6)} mean/request=$${(tot/t.length).toFixed(6)} median/request=$${med.toFixed(6)} last in=${last.in} cached=${last.cached} out=${last.out}; one extra request at final context (300 out tok) ~ $${extra.toFixed(6)}`);
  }
}
const rows=JSON.parse(fs.readFileSync(`${R}/fp-codex-tab-20260826/rows.json`,"utf8"));
const r0=rows.find(r=>r.taskId==="devlooped__moq-1262"&&r.arm==="sweet");
console.log("duration-like keys:",Object.keys(r0).filter(k=>/dur|time|sec|ms|wall/i.test(k)).map(k=>k+"="+JSON.stringify(r0[k])).join(" "));
const tasks=JSON.parse(fs.readFileSync(`${R}/fp-codex-tab-20260826/sweet/tasks.json`,"utf8")); const arr=Array.isArray(tasks)?tasks:Object.values(tasks);
let fenced=0, ids=[]; for (const t of arr){ const n=(t.problem_statement.match(/```/g)||[]).length; if(n>=2){fenced++; ids.push(t.instance_id);} }
console.log("tasks=",arr.length,"with a fenced block=",fenced); console.log(ids.join(", "));
const langs={}; for (const t of arr){ langs[t.language]=(langs[t.language]||0)+1; } console.log("languages:",JSON.stringify(langs));
// median wall time per task family if a duration field exists
const dk=Object.keys(r0).find(k=>/durationMs|wallMs|elapsedMs|durationSec/i.test(k));
if(dk){ const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];}; const moq=rows.filter(r=>r.taskId==="devlooped__moq-1262").map(r=>r[dk]); console.log(dk,"moq median=",med(moq),"pool median=",med(rows.map(r=>r[dk]).filter(x=>x!=null))); }
