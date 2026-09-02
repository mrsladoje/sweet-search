import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { transcriptMetricsFromFile } from '/root/sweet-search-private/eval/task-completion-bench/harness/claude-code-accounting.mjs';
function walk(d,pred,out=[],depth=0){if(depth>9)return out;let e;try{e=readdirSync(d,{withFileTypes:true})}catch{return out}
for(const x of e){const p=path.join(d,x.name); if(x.isDirectory())walk(p,pred,out,depth+1); else if(pred(p,x.name))out.push(p)}return out}
const P={in:0.10,cache:0.01,out:0.60};
const turnCost=(t,prev)=>{const nw=Math.max(0,t.in-prev); return (nw*P.in+(t.in-nw)*P.cache+t.out*P.out)/1e6};
const R='/root/sweet-search-private/eval/task-completion-bench/results';
// --- A. turn-position cost profile (sweet arm, all three harnesses) ---
console.log('=== A. where in the rollout the money goes (sweet arm, ideal price) ===');
for(const [run,h] of [['fp-codex-tab-20260826','codex'],['fp-opencode-tab-20260826','opencode'],['fp-claudecode-tab-20260826','claude-code']]){
  const root=path.join(R,run,'agent-state');
  let firstQ=0,lastQ=0,tot=0,n=0,firstTurn=0,lastTurn=0;
  for(const cell of readdirSync(root)){
    if(!cell.endsWith('-sweet')) continue;
    const dir=path.join(root,cell);
    let files;
    if(h==='codex') files=walk(dir,(p,n)=>n.startsWith('rollout-')&&n.endsWith('.jsonl'));
    else if(h==='opencode') files=walk(dir,(p,n)=>n==='attempt-1.stdout.ndjson');
    else files=walk(dir,(p,n)=>n.endsWith('.jsonl')&&/\/projects\//.test(p)&&!/\/subagents\//.test(p));
    for(const f of files){
      let T=[];
      try{
        if(h==='codex'){ for(const l of readFileSync(f,'utf8').split('\n')){ if(!l)continue; let o;try{o=JSON.parse(l)}catch{continue}
            const p=o.payload||{}; if((p.type||o.type)==='token_count'&&p.info?.last_token_usage){const u=p.info.last_token_usage;
              T.push({in:u.input_tokens||0,out:(u.output_tokens||0)+(u.reasoning_output_tokens||0)})} } }
        else if(h==='opencode'){ for(const l of readFileSync(f,'utf8').split('\n')){ if(!l)continue; let o;try{o=JSON.parse(l)}catch{continue}
            if(o.type!=='step_finish')continue; const tk=o.part?.tokens||{},c=tk.cache||{}; T.push({in:(tk.input||0)+(c.read||0)+(c.write||0),out:(tk.output||0)+(tk.reasoning||0)}) } }
        else { T=(transcriptMetricsFromFile(f).turns||[]).map(t=>({in:t.in||0,out:t.out||0})); }
      }catch{}
      if(T.length<8) continue;
      n++; let prev=0; const costs=[];
      for(const t of T){ costs.push(turnCost(t,prev)); prev=t.in; }
      const q=Math.floor(T.length/4);
      const s=costs.reduce((a,b)=>a+b,0); tot+=s;
      firstQ+=costs.slice(0,q).reduce((a,b)=>a+b,0);
      lastQ+=costs.slice(-q).reduce((a,b)=>a+b,0);
      firstTurn+=costs[0]; lastTurn+=costs[costs.length-1];
    }
  }
  console.log(`${h.padEnd(12)} n=${n}  first quarter of turns = ${(100*firstQ/tot).toFixed(1)}% of cost   last quarter = ${(100*lastQ/tot).toFixed(1)}%   ratio last:first = ${(lastQ/firstQ).toFixed(2)}x`);
}
// --- B. claude-code subagents ---
console.log('\n=== B. claude-code subagent (sidechain) accounting ===');
{
  const root=path.join(R,'fp-claudecode-tab-20260826','agent-state');
  for(const arm of ['sweet','native']){
    let cells=0,cellsWithSub=0,subFiles=0,subTurns=0,subCost=0,subTurn1=[],mainCost=0,noUsage=0;
    for(const cell of readdirSync(root)){
      if(!cell.endsWith('-'+arm)) continue; cells++;
      const dir=path.join(root,cell);
      const subs=walk(dir,(p,n)=>/\/subagents\//.test(p)&&n.endsWith('.jsonl'));
      const mains=walk(dir,(p,n)=>n.endsWith('.jsonl')&&/\/projects\//.test(p)&&!/\/subagents\//.test(p));
      for(const f of mains){ const T=(transcriptMetricsFromFile(f).turns||[]); let prev=0; for(const t of T){mainCost+=turnCost({in:t.in||0,out:t.out||0},prev); prev=t.in||0} }
      if(subs.length) cellsWithSub++;
      for(const f of subs){ subFiles++;
        const m=transcriptMetricsFromFile(f); const T=m.turns||[];
        if(!T.length){noUsage++; continue}
        subTurns+=T.length; subTurn1.push(T[0].in||0);
        let prev=0; for(const t of T){ subCost+=turnCost({in:t.in||0,out:t.out||0},prev); prev=t.in||0 }
      }
    }
    const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:0};
    console.log(`${arm.padEnd(7)} cells=${cells}  cells that delegated=${cellsWithSub}  subagent transcripts=${subFiles} (${noUsage} with no usage record)`);
    console.log(`        subagent turns=${subTurns}  subagent ideal cost total=$${subCost.toFixed(6)}  main ideal cost total=$${mainCost.toFixed(6)}  sidechain share=${(100*subCost/(subCost+mainCost)).toFixed(1)}%`);
    console.log(`        subagent turn-1 input tokens: median ${med(subTurn1)}  min ${Math.min(...subTurn1)}  max ${Math.max(...subTurn1)}`);
  }
}
