import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { transcriptMetricsFromFile } from '/root/sweet-search-private/eval/task-completion-bench/harness/claude-code-accounting.mjs';
function walk(d,pred,out=[],depth=0){if(depth>9)return out;let e;try{e=readdirSync(d,{withFileTypes:true})}catch{return out}
for(const x of e){const p=path.join(d,x.name); if(x.isDirectory())walk(p,pred,out,depth+1); else if(pred(p,x.name))out.push(p)}return out}
const R='/root/sweet-search-private/eval/task-completion-bench/results';
for(const [run,h] of [['fp-codex-tab-20260826','codex'],['fp-opencode-tab-20260826','opencode'],['fp-claudecode-tab-20260826','claude-code']]){
  const root=path.join(R,run,'agent-state');
  let rolls=0, shrinkRolls=0, shrinkTurns=0, maxIn=0, capHits=0;
  for(const cell of readdirSync(root)){
    const dir=path.join(root,cell);
    let files;
    if(h==='codex') files=walk(dir,(p,n)=>n.startsWith('rollout-')&&n.endsWith('.jsonl'));
    else if(h==='opencode') files=walk(dir,(p,n)=>n==='attempt-1.stdout.ndjson');
    else files=walk(dir,(p,n)=>n.endsWith('.jsonl')&&/\/projects\//.test(p)&&!/\/subagents\//.test(p));
    for(const f of files){
      let turns=[];
      try{
        if(h==='codex'){ for(const l of readFileSync(f,'utf8').split('\n')){ if(!l)continue; let o;try{o=JSON.parse(l)}catch{continue}
            const p=o.payload||{}; if((p.type||o.type)==='token_count'&&p.info?.last_token_usage) turns.push(p.info.last_token_usage.input_tokens||0) } }
        else if(h==='opencode'){ for(const l of readFileSync(f,'utf8').split('\n')){ if(!l)continue; let o;try{o=JSON.parse(l)}catch{continue}
            if(o.type!=='step_finish')continue; const tk=o.part?.tokens||{},c=tk.cache||{}; turns.push((tk.input||0)+(c.read||0)+(c.write||0)) } }
        else { turns=(transcriptMetricsFromFile(f).turns||[]).map(t=>t.in||0); }
      }catch{}
      if(!turns.length) continue;
      rolls++; let sh=0;
      for(let i=1;i<turns.length;i++) if(turns[i] < turns[i-1]*0.9) sh++;   // >10% shrink = a rewrite/compaction
      if(sh){shrinkRolls++; shrinkTurns+=sh}
      maxIn=Math.max(maxIn, ...turns);
    }
  }
  console.log(`${h.padEnd(12)} rollouts=${rolls}  rollouts with a >10% context SHRINK: ${shrinkRolls}  shrink turns: ${shrinkTurns}  max context seen: ${maxIn}`);
}
