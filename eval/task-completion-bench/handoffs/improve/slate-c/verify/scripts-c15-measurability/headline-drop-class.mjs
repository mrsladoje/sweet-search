import fs from "node:fs";
const B="/root/sweet-search-private/eval/task-completion-bench/results/";
const CLASS=["accenture__sfmc-devtools-1974","devlooped__moq-1262","hotmeteor__spectator-181","mathnet__mathnet-numerics-1072"];
function load(r){return JSON.parse(fs.readFileSync(B+r+"/rows.json","utf8"));}
function merge(base,repair){
  const rows=load(base).slice();
  if(repair){const rep=load(repair);
    for(const x of rep){const i=rows.findIndex(y=>y.taskId===x.taskId&&y.arm===x.arm&&y.rep===x.rep);
      if(i>=0) rows[i]=x; else rows.push(x);}}
  return rows;
}
function stats(rows,drop){
  const out={};
  for(const arm of ["native","sweet"]){
    const sel=rows.filter(r=>r.arm===arm&&!drop.includes(r.taskId));
    const n=sel.length, solved=sel.filter(r=>r.resolved===true).length;
    const withCost=sel.filter(r=>r.costRealizedUsd!=null);
    const cost=withCost.reduce((a,b)=>a+Number(b.costRealizedUsd),0)/(withCost.length||1);
    out[arm]={n,solved,costN:withCost.length,cost};
  }
  const d=(out.sweet.cost-out.native.cost)/out.native.cost*100;
  return {...out,deltaPct:d};
}
const cells=[["codex","fp-codex-tab-20260826",null],["opencode","fp-opencode-tab-20260826","rp-oc-tab-20260827"],["claude-code","fp-claudecode-tab-20260826",null]];
for(const [name,base,rep] of cells){
  const rows=merge(base,rep);
  const per={};
  for(const t of CLASS){const a={};for(const arm of ["native","sweet"]){const s=rows.filter(r=>r.taskId===t&&r.arm===arm);a[arm]=s.filter(r=>r.resolved===true).length+"/"+s.length;}per[t]=a;}
  const all=stats(rows,[]), noAcc=stats(rows,[CLASS[0]]), noClass=stats(rows,CLASS);
  console.log("==== "+name+"  rows="+rows.length);
  for(const t of CLASS) console.log("   "+t.padEnd(36)+" native "+per[t].native+"  sweet "+per[t].sweet);
  const fmt=(l,s)=>"   "+l.padEnd(14)+" native "+s.native.solved+"/"+s.native.n+" $"+s.native.cost.toFixed(6)+"(n="+s.native.costN+")  sweet "+s.sweet.solved+"/"+s.sweet.n+" $"+s.sweet.cost.toFixed(6)+"(n="+s.sweet.costN+")  sweet-vs-native "+s.deltaPct.toFixed(2)+"%";
  console.log(fmt("ALL",all)); console.log(fmt("drop accenture",noAcc)); console.log(fmt("drop 4-class",noClass));
}
