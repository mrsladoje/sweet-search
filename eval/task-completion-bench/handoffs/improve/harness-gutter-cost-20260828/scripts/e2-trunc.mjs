import fs from "node:fs";
import { load, cellRows, mean } from "./e2-cells.mjs";
const d = load(); const R = d.rollouts;
const M=(rs,f)=>mean(rs.map(f));
console.log("harness\tepoch\tform\tn\ttruncCalls/rollout\trolloutsWithTrunc");
for (const h of ["codex"]) for (const [e,fs_] of [["A",["native","pipe"]],["B",["native","tab"]],["C",["native","tab","none","pipe"]]]) for (const f of fs_) {
  const c = cellRows(R, { epoch:e, harness:h, form:f }); if(!c.length) continue;
  console.log([h,e,f,c.length,M(c,r=>r.truncCalls).toFixed(2),c.filter(r=>r.truncCalls>0).length+"/"+c.length].join("\t"));
}
// pre-truncation tool tokens vs what actually landed in context
console.log("\ncodex epoch C: tool tokens PRODUCED (codex Original token count) vs context actually grown");
for (const f of ["native","tab","none","pipe"]) {
  const c = cellRows(R,{epoch:"C",harness:"codex",form:f});
  const produced = M(c, r => Object.values(r.famTokens||{}).reduce((a,b)=>a+b,0));
  console.log(`${f}\tproduced ${produced.toFixed(0)} tok/rollout\tcontext grown (newIn) ${M(c,r=>r.tokNewIn).toFixed(0)}\tfirstTurn ${M(c,r=>r.firstTurnIn).toFixed(0)}\tmodel output ${M(c,r=>r.tokOut).toFixed(0)}\timplied delivered = newIn-firstTurn-output = ${(M(c,r=>r.tokNewIn)-M(c,r=>r.firstTurnIn)-M(c,r=>r.tokOut)).toFixed(0)}`);
}
