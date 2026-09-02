import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { transcriptMetricsFromFile } from '/root/sweet-search-private/eval/task-completion-bench/harness/claude-code-accounting.mjs';
function walk(d,pred,out=[],depth=0){if(depth>9)return out;let e;try{e=readdirSync(d,{withFileTypes:true})}catch{return out}
for(const x of e){const p=path.join(d,x.name); if(x.isDirectory())walk(p,pred,out,depth+1); else if(pred(p,x.name))out.push(p)}return out}
const R='/root/sweet-search-private/eval/task-completion-bench/results';
const cfg=[['fp-codex-tab-20260826','codex'],['fp-opencode-tab-20260826','opencode'],['fp-claudecode-tab-20260826','claude-code']];
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:0};
for(const [run,h] of cfg){
  const root=path.join(R,run,'agent-state');
  for(const arm of ['sweet','native']){
    const first=[],all=[];
    for(const cell of readdirSync(root)){
      if(!cell.endsWith('-'+arm)) continue;
      const dir=path.join(root,cell);
      let files;
      if(h==='codex') files=walk(dir,(p,n)=>n.startsWith('rollout-')&&n.endsWith('.jsonl'));
      else if(h==='opencode') files=walk(dir,(p,n)=>n==='attempt-1.stdout.ndjson');
      else files=walk(dir,(p,n)=>n.endsWith('.jsonl')&&/\/projects\//.test(p)&&!/\/subagents\//.test(p));
      for(const f of files){
        let t1=null;
        try{
          if(h==='codex'){ for(const l of readFileSync(f,'utf8').split('\n')){ if(!l)continue; let o;try{o=JSON.parse(l)}catch{continue}
              const p=o.payload||{}; if((p.type||o.type)==='token_count'&&p.info?.last_token_usage){t1=p.info.last_token_usage.input_tokens;break} } }
          else if(h==='opencode'){ for(const l of readFileSync(f,'utf8').split('\n')){ if(!l)continue; let o;try{o=JSON.parse(l)}catch{continue}
              if(o.type!=='step_finish')continue; const tk=o.part?.tokens||{},c=tk.cache||{}; t1=(tk.input||0)+(c.read||0)+(c.write||0); break } }
          else { const m=transcriptMetricsFromFile(f); if(m.turns?.length) t1=m.turns[0].in; }
        }catch{}
        if(t1) first.push(t1);
      }
    }
    console.log(`${h.padEnd(12)} ${arm.padEnd(7)} n=${String(first.length).padStart(3)}  turn-1 input tokens: median ${med(first)}  mean ${(first.reduce((a,b)=>a+b,0)/first.length).toFixed(0)}  min ${Math.min(...first)}  max ${Math.max(...first)}`);
  }
}
