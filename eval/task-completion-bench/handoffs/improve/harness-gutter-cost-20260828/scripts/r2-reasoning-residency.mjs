// Does the previous turn's OUTPUT (incl. reasoning) reappear in the next turn's context?
// If reasoning items were dropped, newIn_t would fall short of out_{t-1} on turns with no tool result.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
function walk(d,pred,out=[],depth=0){if(depth>9)return out;let e;try{e=readdirSync(d,{withFileTypes:true})}catch{return out}
for(const x of e){const p=path.join(d,x.name); if(x.isDirectory())walk(p,pred,out,depth+1); else if(pred(p,x.name))out.push(p)}return out}
const R='/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/agent-state';
let pairs=0, ge=0, deficitSum=0, outSum=0, newInSum=0, reasonSum=0;
for(const cell of readdirSync(R)){
  if(!cell.endsWith('-sweet')) continue;
  for(const f of walk(path.join(R,cell),(p,n)=>n.startsWith('rollout-')&&n.endsWith('.jsonl'))){
    const T=[];
    for(const l of readFileSync(f,'utf8').split('\n')){ if(!l)continue; let o;try{o=JSON.parse(l)}catch{continue}
      const p=o.payload||{}; if((p.type||o.type)==='token_count'&&p.info?.last_token_usage){const u=p.info.last_token_usage;
        T.push({in:u.input_tokens||0,out:(u.output_tokens||0),reason:u.reasoning_output_tokens||0})} }
    for(let i=1;i<T.length;i++){
      const newIn=T[i].in-T[i-1].in; const prevOut=T[i-1].out+T[i-1].reason;
      pairs++; if(newIn>=prevOut) ge++; else deficitSum+=prevOut-newIn;
      outSum+=prevOut; newInSum+=Math.max(0,newIn); reasonSum+=T[i-1].reason;
    }
  }
}
console.log(`codex sweet, turn pairs=${pairs}`);
console.log(`  newIn_t >= (out+reasoning)_{t-1} on ${ge}/${pairs} = ${(100*ge/pairs).toFixed(1)}% of turn pairs`);
console.log(`  sum prev-output tokens = ${outSum} (of which reasoning ${reasonSum}); sum newIn = ${newInSum}`);
console.log(`  ratio sum(newIn)/sum(prevOut) = ${(newInSum/outSum).toFixed(2)}  -> >1 means prior output re-entered the prefix AND tool results were added on top`);
console.log(`  total shortfall where newIn < prevOut: ${deficitSum} tokens (${(100*deficitSum/outSum).toFixed(1)}% of prev output)`);
