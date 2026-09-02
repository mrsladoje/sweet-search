// counterfactual.mjs — apply the epoch-B/C codex output cap (10,214 delivered bytes) to the
// epoch-A transcripts and re-price. Tests whether the harness cap, not the pool, flipped codex.
import fs from "node:fs";
import { load, cellRows, mean, bootCI } from "./e2-cells.mjs";
const d = load(); const R = d.rollouts;
const CAP = 10214;                 // measured hard ceiling on delivered bytes in epochs B and C
const M=(rs,f)=>mean(rs.map(f));
function excessBytes(rec) {
  let t; try { t = fs.readFileSync(rec.transcript,"utf8"); } catch { return 0; }
  let ex = 0;
  for (const l of t.split("\n")) { if(!l) continue; let o; try{o=JSON.parse(l)}catch{continue}
    const p=o.payload||{}; if(p.type!=="function_call_output"&&p.type!=="custom_tool_call_output") continue;
    const s = typeof p.output==="string"?p.output:JSON.stringify(p.output||"");
    const b = Buffer.byteLength(s,"utf8"); if (b > CAP) ex += b - CAP; }
  return ex;
}
const BPT = { native: 2.67, sweet: 3.69 };     // measured bytes/token, codex epoch C (its own counts)
for (const [form, arm] of [["native","native"],["pipe","sweet"]]) {
  const c = cellRows(R, { epoch:"A", harness:"codex", form });
  const rows = c.map(r => { const ex = excessBytes(r); const tok = ex / BPT[arm];
    // removing tokens that arrived at turn k saves ingest once + resident for the remaining turns.
    const save = tok * 0.10/1e6 + tok * (r.turns/2) * 0.01/1e6;
    return { taskId: r.taskId, ideal: r.idealUsd, ex, tok, save, adj: r.idealUsd - save }; });
  console.log(`codex A/${form}: over-cap bytes ${M(rows,r=>r.ex).toFixed(0)}/rollout = ${M(rows,r=>r.tok).toFixed(0)} tok; `
    + `ideal $${M(rows,r=>r.ideal).toFixed(6)} -> capped $${M(rows,r=>r.adj).toFixed(6)}`);
  globalThis[form] = rows;
}
const nat = globalThis.native, sw = globalThis.pipe;
const tasks = [...new Set(nat.map(r=>r.taskId))];
const dRaw = tasks.map(t => mean(sw.filter(r=>r.taskId===t).map(r=>r.ideal)) - mean(nat.filter(r=>r.taskId===t).map(r=>r.ideal)));
const dCap = tasks.map(t => mean(sw.filter(r=>r.taskId===t).map(r=>r.adj)) - mean(nat.filter(r=>r.taskId===t).map(r=>r.adj)));
const bRaw = mean(tasks.map(t => mean(nat.filter(r=>r.taskId===t).map(r=>r.ideal))));
const bCap = mean(tasks.map(t => mean(nat.filter(r=>r.taskId===t).map(r=>r.adj))));
const ci = bootCI(dCap);
console.log(`\nepoch A paired sweet-minus-native, as run:            ${(mean(dRaw)/bRaw*100).toFixed(1)}%`);
console.log(`epoch A paired, with the epoch-B/C output cap applied: ${(mean(dCap)/bCap*100).toFixed(1)}%  CI [${(ci[0]/bCap*100).toFixed(1)}%, ${(ci[1]/bCap*100).toFixed(1)}%]`);
console.log(`epoch C paired, as run:                                +0.3%`);
