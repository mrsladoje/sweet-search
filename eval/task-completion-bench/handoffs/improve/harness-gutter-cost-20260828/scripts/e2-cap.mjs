import fs from "node:fs";
import { load, cellRows } from "./e2-cells.mjs";
const d = load(); const R = d.rollouts;
for (const [e,f] of [["A","native"],["A","pipe"],["B","native"],["B","tab"],["C","native"],["C","tab"]]) {
  const c = cellRows(R, { epoch:e, harness:"codex", form:f });
  const sizes = [];
  for (const rec of c) {
    let t; try { t = fs.readFileSync(rec.transcript,"utf8"); } catch { continue; }
    for (const l of t.split("\n")) { if(!l) continue; let o; try{o=JSON.parse(l)}catch{continue}
      const p=o.payload||{}; if(p.type!=="function_call_output"&&p.type!=="custom_tool_call_output") continue;
      const s = typeof p.output==="string"?p.output:JSON.stringify(p.output||"");
      sizes.push(Buffer.byteLength(s,"utf8")); }
  }
  sizes.sort((a,b)=>a-b);
  const q = p => sizes[Math.min(sizes.length-1, Math.floor(p*sizes.length))];
  console.log(`codex ${e}/${f}\toutputs ${sizes.length}\tp50 ${q(.5)}B\tp90 ${q(.9)}B\tp99 ${q(.99)}B\tmax ${sizes[sizes.length-1]}B`);
}
