// c08-mechanism: re-derive (1) first usage-bearing request size per subagent, (2) pre-first-working-ss-* request
// count and ideal cost per sweet Explore subagent (imputing zero-usage requests from neighbours), (3) total requests.
import fs from 'node:fs'; import path from 'node:path';
const ROOT='/root/sweet-search-private/eval/task-completion-bench/results'; const run=process.argv[2]||'fp-claudecode-tab-20260826';
const PRICE={in:0.10,cache:0.01,out:0.60};
const TYPES={a3d311866bfc0b7cb:'Explore',a0d415047c0776a3e:'Explore',a484cf2677177e8ef:'Explore',abd536db90e42b25d:'Explore',a41e46d3e2671aa14:'Explore',a04ad28e63dd30186:'Explore',a8d5f1d037a62e83b:'general-purpose',a914bc3d20e9a67cc:'general-purpose',abf1061910955a4c6:'Explore',a61852622b2fb2c36:'general-purpose',a38e681945774a613:'Explore'};
const walk=(d,out=[])=>{let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return out}for(const x of e){const p=path.join(d,x.name);x.isDirectory()?walk(p,out):out.push(p)}return out};
const jl=f=>fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const SS_RE=/(^|[\s;&|(`'"\/])ss-(search|grep|find|read|semantic|trace|batch)(\s|$)/, ABS_RE=/\/bin\/ss-(search|grep|find|read|semantic|trace|batch)/;
const HELP_RE=/ss-[a-z]+\s+(--help|-h)(\s|$)/, HUNT_RE=/(command -v ss-|which ss-|type ss-|-name ['"]?ss-)/;
function parse(f){const recs=jl(f);const order=[];const by=new Map();const results=new Map();
 for(const r of recs){const m=r.message;if(!m)continue;if(Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_result'&&!results.has(b.tool_use_id)){const c=b.content;results.set(b.tool_use_id,typeof c==='string'?c:Array.isArray(c)?c.map(x=>x.text||'').join('\n'):'')}
  if(m.role!=='assistant'||!m.id)continue;let g=by.get(m.id);if(!g){g={blocks:[],ids:new Set(),usage:null,best:-1};by.set(m.id,g);order.push(m.id)}
  for(const b of (m.content||[])){if(b.type==='tool_use'&&b.id){if(g.ids.has(b.id))continue;g.ids.add(b.id)}g.blocks.push(b)}
  const u=m.usage;if(!u)continue;const cached=u.cache_read_input_tokens||0,cw=u.cache_creation_input_tokens||0;const inp=(u.input_tokens||0)+cached+cw,out=u.output_tokens||0;if(inp+out>g.best){g.best=inp+out;g.usage={in:inp,cached,cw,out,raw:u.input_tokens||0}}}
 return {reqs:order.map(id=>by.get(id)),results}}
function impute(reqs){const T=reqs.map(r=>r.usage?{...r.usage}:null);const outs=T.filter(Boolean).map(t=>t.out).sort((a,b)=>a-b);const med=outs.length?outs[outs.length>>1]:0;
 for(let i=0;i<T.length;i++)if(!T[i]){let p=i-1;while(p>=0&&!T[p])p--;let n=i+1;while(n<T.length&&!T[n])n++;const pi=p>=0?T[p].in:null,ni=n<T.length?T[n].in:null;const inp=pi!=null&&ni!=null?Math.round((pi+ni)/2):(pi??ni??0);T[i]={in:inp,cached:Math.max(0,inp-500),cw:0,out:med,imp:true}}return T}
// ideal (cache-normalised) cost: first request all at 'in' price; later requests: new tokens at in, previously-seen at cache. Approximate ideal as: in*0.10 for the delta vs previous context + cache*0.01 for previous context + out*0.60
function idealCost(T){let c=0,prev=0;for(const t of T){const newer=Math.max(0,t.in-prev);c+=newer*PRICE.in/1e6+Math.min(t.in,prev)*PRICE.cache/1e6+t.out*PRICE.out/1e6;prev=t.in}return c}
const state=path.join(ROOT,run,'agent-state');const rows=[];let sweetSideTotal=0,sweetSideReq=0,sweetSideUsage=0;
for(const cell of fs.readdirSync(state).sort()){const mm=cell.match(/^(.*)-(native|sweet)$/);if(!mm)continue;const [,task,arm]=mm;
 const subs=walk(path.join(state,cell)).filter(f=>f.endsWith('.jsonl')&&f.includes('/subagents/'));
 for(const f of subs){const id=path.basename(f,'.jsonl').replace('agent-','');const P=parse(f);const T=impute(P.reqs);const firstU=P.reqs.find(r=>r.usage);
  // find first request with a WORKING ss-* call (not help/hunt, exit 0)
  let firstOk=null;P.reqs.forEach((r,i)=>{if(firstOk!=null)return;for(const b of r.blocks){if(b.type!=='tool_use'||b.name!=='Bash')continue;const cmd=String(b.input?.command||'');if(!(SS_RE.test(cmd)||ABS_RE.test(cmd))||HELP_RE.test(cmd)||HUNT_RE.test(cmd))continue;const res=String(P.results.get(b.id)||'');if(!/^Exit code [1-9]/m.test(res)){firstOk=i;break}}});
  const preT=firstOk==null?T:T.slice(0,firstOk);const preCost=firstOk==null?null:idealCost(preT);const total=idealCost(T);
  const bg=(()=>{return null})();
  rows.push({arm,task,id,type:arm==='sweet'?(TYPES[id]||'?'):'-',requests:P.reqs.length,usageReqs:P.reqs.filter(r=>r.usage).length,firstUsageIn:firstU?firstU.usage.in:null,firstUsageIdx:P.reqs.indexOf(firstU),firstOkSSReq:firstOk,preSSRequests:firstOk,preSSCostUsd:preCost==null?null:+preCost.toFixed(6),totalImputedUsd:+total.toFixed(6)});
  if(arm==='sweet'){sweetSideTotal+=total;sweetSideReq+=P.reqs.length;sweetSideUsage+=P.reqs.filter(r=>r.usage).length}}}
for(const r of rows.filter(r=>r.arm==='sweet'))console.log(JSON.stringify(r));
const ex=rows.filter(r=>r.arm==='sweet'&&r.type==='Explore');
console.log('\nsweet Explore n=',ex.length,'requests total',ex.reduce((a,r)=>a+r.requests,0),'usage-bearing',ex.reduce((a,r)=>a+r.usageReqs,0),'preSS requests',ex.reduce((a,r)=>a+(r.preSSRequests||0),0),'preSS $',ex.reduce((a,r)=>a+(r.preSSCostUsd||0),0).toFixed(6),'total imputed $',ex.reduce((a,r)=>a+r.totalImputedUsd,0).toFixed(6));
const gp=rows.filter(r=>r.arm==='sweet'&&r.type==='general-purpose');
console.log('sweet GP n=',gp.length,'requests',gp.reduce((a,r)=>a+r.requests,0),'preSS requests',gp.reduce((a,r)=>a+(r.preSSRequests||0),0),'total imputed $',gp.reduce((a,r)=>a+r.totalImputedUsd,0).toFixed(6));
console.log('sweet sidechain total imputed $',sweetSideTotal.toFixed(6),'requests',sweetSideReq,'usage-bearing',sweetSideUsage);
// native Explore first-request sizes for comparison (by first usage-bearing request)
const nat=rows.filter(r=>r.arm==='native');console.log('\nnative subagents first usage-bearing request sizes (sorted):',nat.map(r=>r.firstUsageIn).sort((a,b)=>a-b).join(','));
console.log('sweet subagents first usage-bearing request sizes:',rows.filter(r=>r.arm==='sweet').map(r=>`${r.id}:${r.type}:${r.firstUsageIn}@${r.firstUsageIdx}`).join(' '));
// sweet main-thread arm total (recorded usage) for denominator
let mainTotal=0,mainN=0;for(const cell of fs.readdirSync(state).sort()){if(!cell.endsWith('-sweet'))continue;const mains=walk(path.join(state,cell)).filter(f=>f.endsWith('.jsonl')&&f.includes('/claude-home/projects/')&&!f.includes('/subagents/'));for(const f of mains){const P=parse(f);mainTotal+=idealCost(P.reqs.filter(r=>r.usage).map(r=>r.usage));mainN++}}
console.log('sweet main transcripts',mainN,'(includes relaunch duplicates) ideal $',mainTotal.toFixed(4));
