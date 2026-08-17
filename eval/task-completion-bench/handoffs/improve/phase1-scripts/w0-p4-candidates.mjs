// The 16 candidate state machines the narrow detector finds across all 457 golden
// checkouts, and what the two rules can do with each. Kept as an artifact because the
// prevalence claim in the write-up rests on this list being inspectable.
import { readFileSync, readdirSync, statSync } from "node:fs"; import path from "node:path";
import { analyze } from "/root/w0-p4-statecheck.mjs";
const GOLDEN="/root/.ss-eval/golden";
const EXT=new Set([".swift",".rs",".ts",".js",".java",".kt",".go",".py",".cs",".rb",".ex",".dart",".php",".scala",".c",".cpp",".h",".hpp",".m",".mm"]);
const SKIP=new Set([".git","node_modules","vendor","target","build","dist",".build","Pods","__pycache__","deps","_build","third_party"]);
const RE=/\bswitch\s*\(?\s*(?:self|this)[.$]?(?:state|_state|\.state)\b|\bmatch\s+self\.state\b/g;
function* walk(d,k=0){ if(k>12) return; let es; try{es=readdirSync(d,{withFileTypes:true});}catch{return;}
 for(const e of es){ if(SKIP.has(e.name)) continue; const p=path.join(d,e.name);
  if(e.isDirectory()){ yield* walk(p,k+1); continue;} if(e.isFile()&&EXT.has(path.extname(e.name))) yield p; } }
console.log("repo".padEnd(34)+"file".padEnd(60)+"ops  esEdges  armedPairs  findings");
for(const repo of readdirSync(GOLDEN)){ let s; try{s=statSync(path.join(GOLDEN,repo));}catch{continue;} if(!s.isDirectory()) continue;
 for(const f of walk(path.join(GOLDEN,repo))){ let st; try{st=statSync(f);}catch{continue;} if(st.size>2e6) continue;
  let t; try{t=readFileSync(f,"utf8");}catch{continue;} RE.lastIndex=0; if((t.match(RE)||[]).length<3) continue;
  let r; try{r=analyze(t);}catch{ console.log(repo.split("@")[0].padEnd(34)+path.relative(path.join(GOLDEN,repo),f).padEnd(60)+"PARSE THREW"); continue; }
  const fire=(r.ops?.length&&r.esEdges?.length&&r.pairs?.some(p=>p.armed))?"  <- both rules can fire":"";
  console.log(repo.split("@")[0].padEnd(34)+path.relative(path.join(GOLDEN,repo),f).padEnd(60)+
    String(r.ops?.length??0).padEnd(5)+String(r.esEdges?.length??0).padEnd(9)+
    String(r.pairs?.filter(p=>p.armed).length??0).padEnd(12)+String(r.findings?.length??0)+fire); } }
