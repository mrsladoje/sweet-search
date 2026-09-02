// c06 mechanism re-derivation: per-cell moq patch census straight from the raw patches (agent output, never gold).
import fs from "node:fs";
const R="/root/sweet-search-private/eval/task-completion-bench/results";
const TASK="devlooped__moq-1262";
const runs=[["codex","fp-codex-tab-20260826",["sweet","native"]],["opencode","fp-opencode-tab-20260826",["native"]],["opencode","rp-oc-tab-20260827",["sweet"]],["claude-code","fp-claudecode-tab-20260826",["sweet","native"]]];
const out=[];
for (const [h,run,arms] of runs){
  const rows=JSON.parse(fs.readFileSync(`${R}/${run}/rows.json`,"utf8")).filter(r=>r.taskId===TASK);
  for (const arm of arms){ for (const rep of [0,1,2]){
    const pf = rep===0 ? `${R}/${run}/${arm}/patches.json` : `${R}/${run}/${arm}/rep-${rep}/patches.json`;
    if(!fs.existsSync(pf)){ out.push({h,run,arm,rep,missing:true}); continue; }
    const arr=JSON.parse(fs.readFileSync(pf,"utf8")); const ent=arr.find(e=>e.instance_id===TASK);
    const row=rows.find(r=>r.arm===arm&&r.rep===rep);
    const patch=ent?ent.patch||"":"";
    const files=[...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)/mg)].map(m=>m[2]);
    const newFiles=(patch.match(/^new file mode/mg)||[]).length;
    const hunks=(patch.match(/^@@ /mg)||[]).length;
    // hunk headers per file with function context
    const perFile={}; let cur=null;
    for (const line of patch.split("\n")){ const d=line.match(/^diff --git a\/(\S+) b\/(\S+)/); if(d){cur=d[2];perFile[cur]=[];continue;} const hh=line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@(.*)$/); if(hh&&cur){perFile[cur].push(`${hh[1]}->${hh[2]}${hh[3]}`);} }
    out.push({h,run,arm,rep,resolved:row?row.resolved:null,f2p:row?row.f2pFrac:null,rowHunks:row?row.patchHunks:null,hunks,newFiles,files,perFile});
  }}
}
for (const o of out){ if(o.missing){console.log(`${o.h} ${o.run} ${o.arm} r${o.rep} MISSING`);continue;} console.log(`${o.h.padEnd(11)} ${o.arm.padEnd(6)} r${o.rep} resolved=${o.resolved} f2p=${o.f2p} hunks=${o.hunks}(row ${o.rowHunks}) newFiles=${o.newFiles}`); for (const [f,hs] of Object.entries(o.perFile)) console.log(`     ${f.replace("src/Moq/","")}: ${hs.join(" | ")}`); }
// summary
const cells=out.filter(o=>!o.missing); const losers=cells.filter(c=>!c.resolved);
const F=(c,re)=>c.files.some(f=>re.test(f));
console.log("\nCELLS",cells.length,"solved",cells.length-losers.length,"losers",losers.length);
console.log("sweet losers/harness:",["codex","opencode","claude-code"].map(h=>`${h}=${losers.filter(c=>c.arm==="sweet"&&c.h===h).length}`).join(" "));
console.log("losers touching Match.cs or ExpressionComparer.cs:",losers.filter(c=>F(c,/Match\.cs$/)||F(c,/ExpressionComparer\.cs$/)).length);
console.log("losers touching MethodExpectation.cs:",losers.filter(c=>F(c,/MethodExpectation\.cs$/)).length, losers.filter(c=>F(c,/MethodExpectation\.cs$/)).map(c=>`${c.h[0]}:${c.arm[0]}${c.rep}`).join(" "));
console.log("losers touching SetupCollection.cs:",losers.filter(c=>F(c,/SetupCollection\.cs$/)).map(c=>`${c.h[0]}:${c.arm[0]}${c.rep}`).join(" "));
console.log("losers ONLY Match.cs:",losers.filter(c=>c.files.length===1&&F(c,/Match\.cs$/)).map(c=>`${c.h[0]}:${c.arm[0]}${c.rep}`).join(" "));
console.log("losers touching Match.cs (any):",losers.filter(c=>F(c,/Match\.cs$/)).length);
console.log("losers touching ExpressionComparer.cs (any):",losers.filter(c=>F(c,/ExpressionComparer\.cs$/)).length);
console.log("losers with new files:",losers.filter(c=>c.newFiles>0).length);
console.log("any cell touching a test/ path:",cells.filter(c=>c.files.some(f=>/tests?\//i.test(f))).length);
