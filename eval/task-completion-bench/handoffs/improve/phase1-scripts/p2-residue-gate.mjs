#!/usr/bin/env node
// P2 $0 GATE — executes P2-RESIDUE-PREREGISTRATION.md §2.
//
// THE IDEA. Take the agent's own final diff. For each line it REMOVED, extract the literal
// stem it replaced. Then ask the base tree: does that stem still occur somewhere the agent
// did not touch? If so, the agent transformed one instance of a pattern and left its twins.
//
// This is deliberately the string half only. No structural twins, no near-duplicate hashing.
//
// THE BAR THAT DECIDES IT IS SPECIFICITY, NOT SENSITIVITY. Finding `countBy` is easy; doing
// it without burying a correct rollout in false residues is the whole problem. So the sweep
// scores RESOLVED rollouts as negative controls and reports residues-per-rollout on them.
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RESULTS='/root/sweet-search-private/eval/task-completion-bench/results';
const GOLDEN='/root/.ss-eval/golden';
const specs=JSON.parse(readFileSync('/root/hint-ladder/tasks-L0.json','utf8'));
const BASE=Object.fromEntries(specs.map(t=>[t.instance_id,t.base_commit]));
const goldenDirs=readdirSync(GOLDEN);
const goldenFor=id=>{const sha=BASE[id]; if(!sha)return null;
  const hit=goldenDirs.find(d=>d.endsWith('@'+sha)); return hit?path.join(GOLDEN,hit):null;};

// A stem worth chasing: the distinctive literal a removed line contained. Skip anything too
// short or too generic to be a pattern instance — those are what generate the noise the
// specificity bar exists to catch.
const MIN_STEM=12;

// STEM EXTRACTION, SECOND DESIGN.
//
// The first design took the whole removed line. It scored 0 on the one case this lever
// exists for, and the reason is the point: on `underscore`, the line the agent replaced is
//     if (_.has(result, key)) result[key].push(value); else result[key] = [value];
// while its twin thirteen lines below is
//     if (_.has(result, key)) result[key]++;          else result[key] = 1;
// Those are not the same literal. They share the CALL, not the line. A whole-line stem can
// never see a family whose members differ in their bodies — which is every interesting family.
//
// So the stem is the minimal token the edit actually changed: diff the removed line against
// the added line that replaced it, and keep the removed side of the first differing span,
// trimmed to a token boundary. On underscore that yields `_.has(` — which finds the twin.
// Whether it finds only the twin is exactly what the specificity bar decides.
function pairLines(patch){
  const out=[]; const lines=String(patch||'').split('\n');
  for(let i=0;i<lines.length;i++){
    if(!lines[i].startsWith('-')||lines[i].startsWith('---'))continue;
    let j=i+1; while(j<lines.length&&lines[j].startsWith('-'))j++;
    if(j<lines.length&&lines[j].startsWith('+')&&!lines[j].startsWith('+++'))
      out.push([lines[i].slice(1),lines[j].slice(1)]);
  }
  return out;
}
function minimalChangedToken(a,b){
  let s=0; while(s<a.length&&s<b.length&&a[s]===b[s])s++;
  let ea=a.length,eb=b.length;
  while(ea>s&&eb>s&&a[ea-1]===b[eb-1]){ea--;eb--;}
  let tok=a.slice(s,ea);
  // widen left to a token boundary so `has(` does not match `hasOwnProperty(`
  let L=s; while(L>0&&/[\w.$]/.test(a[L-1]))L--;
  tok=a.slice(L,ea).trim();
  return tok;
}
function stemsFrom(patch){
  const out=new Set();
  for(const [rm,add] of pairLines(patch)){
    const tok=minimalChangedToken(rm,add);
    if(tok.length>=6&&!/^[\s(){}\[\];,.]*$/.test(tok))out.add(tok);
  }
  // whole-line stems still count when the line was deleted outright (no + partner)
  for(const line of String(patch||'').split('\n')){
    if(!line.startsWith('-')||line.startsWith('---'))continue;
    const body=line.slice(1).trim();
    if(body.length<MIN_STEM)continue;
    if(/^[)}\]{(\s;,]*$/.test(body))continue;
    if(/^(\/\/|#|\*|\/\*)/.test(body))continue;
    out.add(body);
  }
  return [...out];
}
// Files the agent already edited are not residues — it dealt with them.
function touchedFiles(patch){
  return new Set([...String(patch||'').matchAll(/^\+\+\+ b\/(\S+)/gm)].map(m=>m[1]));
}

function residues(dir, patch){
  const stems=stemsFrom(patch), touched=touchedFiles(patch);
  const found=[];
  for(const stem of stems){
    let out='';
    try{
      out=execFileSync('grep',['-rnF','--binary-files=without-match',
        '--exclude-dir=.git','--exclude-dir=node_modules','--exclude-dir=.sweet-search',
        stem,'.'],{cwd:dir,encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000});
    }catch{ continue; }                                    // grep exit 1 = no match
    for(const hit of out.split('\n').filter(Boolean)){
      const m=hit.match(/^\.\/(.+?):(\d+):/); if(!m)continue;
      // The site the agent edited is in `touched`; a residue is the SAME stem living on
      // in a file it never opened, or elsewhere in a file it only partly changed.
      found.push({file:m[1],line:+m[2],stem:stem.slice(0,70),inTouchedFile:touched.has(m[1])});
    }
  }
  return found;
}

const rows=[];
for(const run of (process.argv[2]||'rb-opencode-20260824,rb-claudecode-20260824').split(',')){
  const rj=path.join(RESULTS,run,'rows.json'); if(!existsSync(rj))continue;
  const R=JSON.parse(readFileSync(rj,'utf8'));
  for(const arm of ['sweet']){                              // sweet-only: this is a sweet tool
    for(const rep of [0,1,2]){
      const d=rep===0?path.join(RESULTS,run,arm):path.join(RESULTS,run,arm,`rep-${rep}`);
      const pf=path.join(d,'patches.json'); if(!existsSync(pf))continue;
      for(const p of JSON.parse(readFileSync(pf,'utf8'))){
        if(!p.patch)continue;
        const g=goldenFor(p.instance_id); if(!g)continue;
        const row=R.find(r=>r.taskId===p.instance_id&&r.arm===arm&&r.rep===rep);
        const tmp=mkdtempSync(path.join(tmpdir(),'p2-'));
        try{
          execFileSync('bash',['-c',`cp -a ${JSON.stringify(g)}/. ${JSON.stringify(tmp)}/`],{timeout:120000});
          // APPLY THE AGENT'S PATCH FIRST. The audit runs on the tree AFTER the edit — that is
          // the whole idea. Grepping the base tree finds every replaced stem still sitting at
          // its original line, which is true by construction and measures nothing.
          // The patch file lives OUTSIDE the tree: a copy inside it becomes a grep hit for
          // every stem in the patch, which is what the previous pass measured.
          const pf2=tmp+'.patch';
          writeFileSync(pf2,p.patch.endsWith('\n')?p.patch:p.patch+'\n');
          try{ execFileSync('git',['apply','--whitespace=nowarn',pf2],{cwd:tmp,timeout:60000,stdio:'ignore'}); }
          catch{ rows.push({run:run.replace(/-2026\d+/,''),task:p.instance_id,rep,
                   resolved:!!row?.resolved,error:'patch did not apply'});
                 rmSync(tmp,{recursive:true,force:true}); rmSync(tmp+'.patch',{force:true}); continue; }
          const f=residues(tmp,p.patch);
          rows.push({run:run.replace(/-2026\d+/,''),task:p.instance_id,rep,
            resolved:!!row?.resolved, residues:f.length,
            residuesOutsideTouched:f.filter(x=>!x.inTouchedFile).length,
            sample:f.slice(0,2).map(x=>`${x.file}:${x.line} ${x.stem}`)});
        }catch(e){ rows.push({run,task:p.instance_id,rep,resolved:!!row?.resolved,error:String(e.message).slice(0,60)}); }
        finally{ rmSync(tmp,{recursive:true,force:true}); rmSync(tmp+'.patch',{force:true}); }
      }
    }
  }
}

const ok=rows.filter(r=>!r.error);
const res=ok.filter(r=>r.resolved), unres=ok.filter(r=>!r.resolved);
const mean=(a,k)=>a.length?(a.reduce((s,x)=>s+x[k],0)/a.length).toFixed(2):'n/a';
console.log(`rollouts scored: ${ok.length}  (errors ${rows.length-ok.length})`);
console.log(`\nSPECIFICITY — residues on rollouts that RESOLVED (negative controls), n=${res.length}`);
console.log(`   all residues/rollout            ${mean(res,'residues')}`);
console.log(`   residues in UNTOUCHED files     ${mean(res,'residuesOutsideTouched')}   <-- the pre-registered bar: <=0.5 pass, >2.0 kill`);
console.log(`\nfor contrast — rollouts that FAILED, n=${unres.length}`);
console.log(`   residues in UNTOUCHED files     ${mean(unres,'residuesOutsideTouched')}`);
console.log(`\nSENSITIVITY — underscore, the task the lever exists for:`);
for(const r of ok.filter(r=>r.task.includes('underscore'))){
  console.log(`   ${r.run} rep${r.rep} resolved=${String(r.resolved).padEnd(5)} residues=${r.residues} outsideTouched=${r.residuesOutsideTouched}  ${r.sample[0]||''}`);
}
console.log(`\nworst offenders on resolved rollouts:`);
res.sort((a,b)=>b.residuesOutsideTouched-a.residuesOutsideTouched).slice(0,5)
  .forEach(r=>console.log(`   ${r.task.slice(0,34)} rep${r.rep}  ${r.residuesOutsideTouched}  ${r.sample[0]||''}`));
