import fs from "node:fs";
const R="/root/sweet-search-private/eval/task-completion-bench/results"; const TASK="devlooped__moq-1262";
const want=[["fp-codex-tab-20260826","sweet",1,["MethodExpectation.cs","ExpressionComparer.cs"]],["fp-codex-tab-20260826","sweet",2,null],["fp-codex-tab-20260826","native",1,null],["rp-oc-tab-20260827","sweet",0,["MethodExpectation.cs"]],["rp-oc-tab-20260827","sweet",2,null],["fp-opencode-tab-20260826","native",0,null],["fp-claudecode-tab-20260826","sweet",0,["SetupCollection.cs"]],["fp-codex-tab-20260826","sweet",0,null]];
for (const [run,arm,rep,only] of want){
  const pf=rep===0?`${R}/${run}/${arm}/patches.json`:`${R}/${run}/${arm}/rep-${rep}/patches.json`;
  const ent=JSON.parse(fs.readFileSync(pf,"utf8")).find(e=>e.instance_id===TASK);
  console.log(`\n########## ${run} ${arm} rep${rep} ##########`);
  const parts=ent.patch.split(/^(?=diff --git )/m);
  for (const p of parts){ const m=p.match(/^diff --git a\/(\S+)/); if(!m) continue; const f=m[1].split("/").pop(); if(only&&!only.includes(f)) { console.log(`--- ${f}: (skipped, ${(p.match(/^@@/mg)||[]).length} hunks)`); continue; } const lines=p.split("\n"); console.log(lines.slice(0,Math.min(lines.length,110)).join("\n")); if(lines.length>110) console.log(`... (${lines.length-110} more lines)`); }
}
