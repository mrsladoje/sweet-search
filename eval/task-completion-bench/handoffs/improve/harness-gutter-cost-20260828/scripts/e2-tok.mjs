import { load, cellRows, mean } from "./e2-cells.mjs";
const d = load(); const R = d.rollouts;
for (const form of ["tab","native"]) {
  const c = cellRows(R, { epoch: "C", harness: "codex", form });
  const B = {}, T = {};
  for (const r of c) { for (const [k,v] of Object.entries(r.famBytes||{})) B[k]=(B[k]||0)+v;
    for (const [k,v] of Object.entries(r.famTokens||{})) T[k]=(T[k]||0)+v; }
  console.log("--- codex", form, "n="+c.length, "(codex reports its own token count per tool output) ---");
  let tb=0, tt=0;
  for (const k of Object.keys(B)) { if (!T[k]) continue;
    console.log(`${k}\t${(B[k]/c.length).toFixed(0)} B/rollout\t${(T[k]/c.length).toFixed(0)} tok/rollout\t${(B[k]/T[k]).toFixed(2)} B/tok`);
    tb+=B[k]; tt+=T[k]; }
  console.log(`TOTAL\t${(tb/c.length).toFixed(0)} B/rollout\t${(tt/c.length).toFixed(0)} tok/rollout\t${(tb/tt).toFixed(2)} B/tok`);
  const ss = Object.keys(T).filter(k=>k.startsWith("ss-")).reduce((a,k)=>a+T[k],0);
  console.log(`ss-* total\t${(ss/c.length).toFixed(0)} tok/rollout`);
}
