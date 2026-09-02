import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { transcriptMetricsFromFile } from '/root/sweet-search-private/eval/task-completion-bench/harness/claude-code-accounting.mjs';
function walk(d,pred,out=[],depth=0){if(depth>9)return out;let e;try{e=readdirSync(d,{withFileTypes:true})}catch{return out}
for(const x of e){const p=path.join(d,x.name); if(x.isDirectory())walk(p,pred,out,depth+1); else if(pred(p,x.name))out.push(p)}return out}
const R='/root/sweet-search-private/eval/task-completion-bench/results';
console.log('harness      arm      rollouts  sum_in      resent      cached      hit%_of_resent  cacheWrite  turn1_uncached%');
for(const [run,h] of [['fp-codex-tab-20260826','codex'],['fp-opencode-tab-20260826','opencode'],['fp-claudecode-tab-20260826','claude-code']]){
  const root=path.join(R,run,'agent-state');
  for(const arm of ['sweet','native']){
    let rolls=0,sumIn=0,resent=0,cached=0,cw=0,ingest=0;
    for(const cell of readdirSync(root)){
      if(!cell.endsWith('-'+arm)) continue;
      const dir=path.join(root,cell);
      let files;
      if(h==='codex') files=walk(dir,(p,n)=>n.startsWith('rollout-')&&n.endsWith('.jsonl'));
      else if(h==='opencode') files=walk(dir,(p,n)=>n==='attempt-1.stdout.ndjson');
      else files=walk(dir,(p,n)=>n.endsWith('.jsonl')&&/\/projects\//.test(p)&&!/\/subagents\//.test(p));
      const cellRolls=[];
      for(const f of files){
        let T=[];
        try{
          if(h==='codex'){ for(const l of readFileSync(f,'utf8').split('\n')){ if(!l)continue; let o;try{o=JSON.parse(l)}catch{continue}
              const p=o.payload||{}; if((p.type||o.type)==='token_count'&&p.info?.last_token_usage){const u=p.info.last_token_usage; T.push({in:u.input_tokens||0,cached:u.cached_input_tokens||0,cw:0})} } }
          else if(h==='opencode'){ for(const l of readFileSync(f,'utf8').split('\n')){ if(!l)continue; let o;try{o=JSON.parse(l)}catch{continue}
              if(o.type!=='step_finish')continue; const tk=o.part?.tokens||{},c=tk.cache||{}; T.push({in:(tk.input||0)+(c.read||0)+(c.write||0),cached:c.read||0,cw:c.write||0}) } }
          else { T=(transcriptMetricsFromFile(f).turns||[]).map(t=>({in:t.in||0,cached:t.cached||0,cw:t.cacheWrite||0})); }
        }catch{}
        if(!T.length) continue;
        let prev=0,ing=0,res=0,ca=0,w=0,si=0;
        for(const t of T){const nw=Math.max(0,t.in-prev); ing+=nw; res+=t.in-nw; ca+=t.cached; w+=t.cw; si+=t.in; prev=t.in}
        cellRolls.push({ing,res,ca,w,si,score:ing*0.1+res*0.01});
      }
      cellRolls.sort((a,b)=>b.score-a.score);
      for(const r of cellRolls.slice(0,3)){rolls++; sumIn+=r.si; resent+=r.res; cached+=r.ca; cw+=r.w; ingest+=r.ing}
    }
    console.log(`${h.padEnd(12)} ${arm.padEnd(8)} ${String(rolls).padStart(6)}  ${String(sumIn).padStart(10)}  ${String(resent).padStart(10)}  ${String(cached).padStart(10)}  ${(100*cached/resent).toFixed(1).padStart(13)}%  ${String(cw).padStart(9)}   ${(100*(sumIn-cached)/sumIn).toFixed(1)}%`);
  }
}
