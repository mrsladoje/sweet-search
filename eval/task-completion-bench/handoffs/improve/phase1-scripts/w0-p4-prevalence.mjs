// Sensitivity check on the falsifier-3 prevalence number. The narrow detector requires the
// literal `switch self.state`. If that regex is what makes the shape look rare, the kill
// verdict is an artifact of my own strictness, so a deliberately GENEROUS detector is run
// beside it: any file that declares an enum or union whose name mentions a state and then
// branches on it three or more times, in any of the corpus languages.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
const GOLDEN = "/root/.ss-eval/golden";
const EXT = new Set([".swift",".rs",".ts",".js",".java",".kt",".go",".py",".cs",".rb",".ex",".dart",".php",".scala",".c",".cpp",".h",".hpp",".m",".mm"]);
const SKIP = new Set([".git","node_modules","vendor","target","build","dist",".build","Pods","__pycache__","deps","_build","third_party"]);
const NARROW = /\bswitch\s*\(?\s*(?:self|this)[.$]?(?:state|_state|\.state)\b|\bmatch\s+self\.state\b/g;
// generous: an enum/union/sealed/type whose name mentions State, plus 3+ branch statements
const DECL = /\b(?:enum|sealed\s+class|sealed\s+interface|union|type)\s+([A-Za-z_]\w*State\w*|State)\b/;
const BRANCH = /\b(?:switch|match|when)\s*[\(\s]/g;
function* walk(dir, d=0){ if(d>12) return; let es; try{es=readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const e of es){ if(SKIP.has(e.name)) continue; const p=path.join(dir,e.name);
    if(e.isDirectory()){ yield* walk(p,d+1); continue; }
    if(e.isFile() && EXT.has(path.extname(e.name))) yield p; } }
const repos = readdirSync(GOLDEN).filter(d=>{try{return statSync(path.join(GOLDEN,d)).isDirectory();}catch{return false;}});
let files=0, narrow=0, generous=0; const gExt={}, gRepo=new Set(), nRepo=new Set();
for(const repo of repos){ for(const f of walk(path.join(GOLDEN,repo))){
  let st; try{st=statSync(f);}catch{continue;} if(st.size>2*1024*1024) continue; files++;
  let t; try{t=readFileSync(f,"utf8");}catch{continue;}
  NARROW.lastIndex=0; if((t.match(NARROW)||[]).length>=3){ narrow++; nRepo.add(repo); }
  BRANCH.lastIndex=0;
  if(DECL.test(t) && (t.match(BRANCH)||[]).length>=3){ generous++; gExt[path.extname(f)]=(gExt[path.extname(f)]||0)+1; gRepo.add(repo); }
}}
console.log("files read              ", files);
console.log("narrow detector         ", narrow, "files in", nRepo.size, "repos  = 1 in", Math.round(files/Math.max(narrow,1)));
console.log("generous detector       ", generous, "files in", gRepo.size, "repos  = 1 in", Math.round(files/Math.max(generous,1)));
console.log("generous by language    ", JSON.stringify(Object.fromEntries(Object.entries(gExt).sort((a,b)=>b[1]-a[1]).slice(0,12))));
