import fs from 'node:fs';
const [cell,arm,id]=process.argv.slice(2);
// handcheck-claude.mjs <cell> <arm> <id>: compares the normalised trace with an independent regex read of the raw session JSONL (read-only).
const T='/Users/admin/Projects/sweet-search-final-tuning/core/prompt-optimization/data/results/final-tuning-trace/'+cell+'.trace.jsonl';
const L=fs.readFileSync(T,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const roll=L.find(r=>r.type==='rollout'&&r.arm===arm&&r.id===id);
const reqs=L.filter(r=>r.type!=='rollout'&&r.arm===arm&&r.id===id);
const run=fs.readFileSync('/Users/admin/Projects/sweet-search-private/core/prompt-optimization/data/results/r282-'+cell+'/runs.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse).find(r=>r.arm===arm&&r.id===id);
// independent raw read: regex the raw session file for message ids + usage numbers
const raw=fs.readFileSync(roll.sessionFile,'utf8').split('\n').filter(l=>l.includes('"type":"assistant"'));
const seen=new Map();
for(const l of raw){const id_=/"id":"(msg_[A-Za-z0-9]+)"/.exec(l)?.[1];const g=k=>+(new RegExp('"usage":\\{[^}]*?"'+k+'":(\\d+)').exec(l)?.[1]??0);
  const u=[g('input_tokens'),g('cache_read_input_tokens'),g('cache_creation_input_tokens'),g('output_tokens')]; if(!seen.has(id_)||u.reduce((a,b)=>a+b)>seen.get(id_).reduce((a,b)=>a+b)) seen.set(id_,u);}
console.log(`\n=== ${cell} ${arm} ${id}  session ${roll.sessionId}  (${roll.cwd.split('/').pop()})`);
console.log('raw store: assistant records',raw.length,'unique message ids',seen.size,'| trace requests',reqs.length);
let i=0; const P=cell.includes('opus')?{in:4,cache:.2,out:20}:{in:2,cache:.2,out:10}; let sumRaw=0;
const ids=[...seen.keys()];
for(const r of reqs){ const u=seen.get(ids[i]); const c=(u[0]*P.in+u[2]*P.in*1.25+u[1]*P.cache+u[3]*P.out)/1e6; sumRaw+=c;
  const ok=u[0]===r.tok.inUncached&&u[1]===r.tok.cacheRead&&u[2]===r.tok.cacheWrite&&u[3]===r.tok.out;
  console.log(` req${r.req} raw[in,cr,cw,out]=${u.join(',')}  trace=${[r.tok.inUncached,r.tok.cacheRead,r.tok.cacheWrite,r.tok.out].join(',')}  ${ok?'MATCH':'DIFF'}  cost ${r.costUsd.toFixed(6)} (raw recompute ${c.toFixed(6)})  calls: ${r.calls.map(x=>`${x.tool}${x.sub&&x.sub!=='shell'?':'+x.sub:''}[${x.argText.slice(0,60).replace(/\n/g,' ')}] -> ${x.resultChars}ch`).join(' | ')||'(final answer, '+r.textOutChars+' chars)'}`); i++; }
console.log(`sum raw-recompute ${sumRaw.toFixed(6)}  trace sum ${roll.costUsdSum}  runner costRealizedUsd ${run.costRealizedUsd}  reconDiffPct ${roll.reconDiffPct}  | runner calls ${run.calls} trace calls ${roll.calls} | runner toolKinds ${JSON.stringify(run.toolKinds)} | prefixTokens ${roll.prefixTokens}`);
