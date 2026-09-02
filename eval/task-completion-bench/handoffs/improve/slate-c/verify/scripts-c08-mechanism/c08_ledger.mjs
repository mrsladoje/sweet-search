// c08-mechanism: ledger-footed re-derivation of the dilution and the added-cost terms.
// Uses the ledger's own costFromTurns (ideal, cache-normalised) and the ledger's request grouping.
import fs from 'node:fs'; import path from 'node:path';
import { costFromTurns } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';
const PRICE={in:0.10,cache:0.01,out:0.60};
const ROOT='/root/sweet-search-private/eval/task-completion-bench/results'; const run='fp-claudecode-tab-20260826';
const TYPES={a3d311866bfc0b7cb:'Explore',a0d415047c0776a3e:'Explore',a484cf2677177e8ef:'Explore',abd536db90e42b25d:'Explore',a41e46d3e2671aa14:'Explore',a04ad28e63dd30186:'Explore',a8d5f1d037a62e83b:'general-purpose',a914bc3d20e9a67cc:'general-purpose',abf1061910955a4c6:'Explore',a61852622b2fb2c36:'general-purpose',a38e681945774a613:'Explore'};
const walk=(d,out=[])=>{let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return out}for(const x of e){const p=path.join(d,x.name);x.isDirectory()?walk(p,out):out.push(p)}return out};
const jl=f=>fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const SS_RE=/(^|[\s;&|(`'"\/])ss-(search|grep|find|read|semantic|trace|batch)(\s|$)/, ABS_RE=/\/bin\/ss-(search|grep|find|read|semantic|trace|batch)/;
const HELP_RE=/ss-[a-z]+\s+(--help|-h)(\s|$)/, HUNT_RE=/(command -v ss-|which ss-|type ss-|-name ['"]?ss-)/;
function parse(f){const recs=jl(f);const order=[];const by=new Map();const results=new Map();
 for(const r of recs){const m=r.message;if(!m)continue;if(Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_result'&&!results.has(b.tool_use_id)){const c=b.content;results.set(b.tool_use_id,typeof c==='string'?c:Array.isArray(c)?c.map(x=>x.text||'').join('\n'):'')}
  if(m.role!=='assistant'||!m.id)continue;let g=by.get(m.id);if(!g){g={blocks:[],ids:new Set(),usage:null,best:-1};by.set(m.id,g);order.push(m.id)}
  for(const b of (m.content||[])){if(b.type==='tool_use'&&b.id){if(g.ids.has(b.id))continue;g.ids.add(b.id)}g.blocks.push(b)}
  const u=m.usage;if(!u)continue;const cached=u.cache_read_input_tokens||0,cw=u.cache_creation_input_tokens||0;const inp=(u.input_tokens||0)+cached+cw,out=u.output_tokens||0;if(inp+out>g.best){g.best=inp+out;g.usage={in:inp,cached,cacheWrite:cw,out}}}
 return {reqs:order.map(id=>by.get(id)),results}}
const hasUsage=r=>r.usage&&(r.usage.in||r.usage.out);
function impute(reqs){const T=reqs.map(r=>hasUsage(r)?{...r.usage}:null);const outs=T.filter(Boolean).map(t=>t.out).sort((a,b)=>a-b);const med=outs.length?outs[outs.length>>1]:0;
 for(let i=0;i<T.length;i++)if(!T[i]){let p=i-1;while(p>=0&&!T[p])p--;let n=i+1;while(n<T.length&&!T[n])n++;const pi=p>=0?T[p].in:null,ni=n<T.length?T[n].in:null;const inp=pi!=null&&ni!=null?Math.round((pi+ni)/2):(pi??ni??0);T[i]={in:inp,cached:Math.max(0,inp-500),cacheWrite:0,out:med,imputed:true}}return T}
const state=path.join(ROOT,run,'agent-state');const out=[];
let side={Explore:{n:0,req:0,zero:0,pre:0,preUsd:0,failReq:0,failUsd:0,totUsd:0,recUsd:0},'general-purpose':{n:0,req:0,zero:0,pre:0,preUsd:0,failReq:0,failUsd:0,totUsd:0,recUsd:0}};
let nativeSide={req:0,zero:0,totUsd:0,recUsd:0,n:0};
for(const cell of fs.readdirSync(state).sort()){const mm=cell.match(/^(.*)-(native|sweet)$/);if(!mm)continue;const [,task,arm]=mm;
 for(const f of walk(path.join(state,cell)).filter(f=>f.endsWith('.jsonl')&&f.includes('/subagents/'))){
  const id=path.basename(f,'.jsonl').replace('agent-','');const P=parse(f);const T=impute(P.reqs);
  const tot=costFromTurns(T,PRICE).idealUsd; const rec=costFromTurns(P.reqs.filter(hasUsage).map(r=>r.usage),PRICE).idealUsd;
  if(arm==='native'){nativeSide.n++;nativeSide.req+=T.length;nativeSide.zero+=T.filter(t=>t.imputed).length;nativeSide.totUsd+=tot;nativeSide.recUsd+=rec;continue}
  const type=TYPES[id]||'?';const S=side[type];S.n++;S.req+=T.length;S.zero+=T.filter(t=>t.imputed).length;S.totUsd+=tot;S.recUsd+=rec;
  // per-request classification of ss-* calls
  let firstOk=null;const reqHasOk=[],reqHasSS=[];
  P.reqs.forEach((r,i)=>{let ok=false,any=false;for(const b of r.blocks){if(b.type!=='tool_use'||b.name!=='Bash')continue;const cmd=String(b.input?.command||'');const isSS=(SS_RE.test(cmd)||ABS_RE.test(cmd))&&!HUNT_RE.test(cmd);if(!isSS)continue;any=true;const res=String(P.results.get(b.id)||'');if(!/^Exit code [1-9]/m.test(res)&&!HELP_RE.test(cmd))ok=true}reqHasOk.push(ok);reqHasSS.push(any);if(firstOk==null&&ok)firstOk=i});
  // cost of requests strictly before the first working ss-* call: marginal ideal cost = total minus cost with those requests removed is not additive; use per-request marginal from costFromTurns sequence
  const perReq=[];{let prev=0;for(const t of T){const newIn=Math.max(0,t.in-prev);const resent=t.in-newIn;perReq.push((newIn*PRICE.in+resent*PRICE.cache+t.out*PRICE.out)/1e6);prev=t.in}}
  const preIdx=firstOk==null?[]:[...Array(firstOk).keys()];const preUsd=preIdx.reduce((a,i)=>a+perReq[i],0);
  const failIdx=P.reqs.map((_,i)=>i).filter(i=>i>=(firstOk??0)&&reqHasSS[i]&&!reqHasOk[i]);const failUsd=failIdx.reduce((a,i)=>a+perReq[i],0);
  S.pre+=preIdx.length;S.preUsd+=preUsd;S.failReq+=failIdx.length;S.failUsd+=failUsd;
  out.push({id,type,task,requests:T.length,zeroUsage:T.filter(t=>t.imputed).length,firstOkReq:firstOk,preReq:preIdx.length,preUsd:+preUsd.toFixed(6),failReqAfter:failIdx.length,failUsd:+failUsd.toFixed(6),totalImputedUsd:+tot.toFixed(6),recordedUsd:+rec.toFixed(6)});
 }}
for(const o of out)console.log(JSON.stringify(o));
console.log('\nSWEET SIDE by type:',JSON.stringify(side,(k,v)=>typeof v==='number'?+v.toFixed(6):v));
console.log('NATIVE SIDE:',JSON.stringify(nativeSide,(k,v)=>typeof v==='number'?+v.toFixed(6):v));
// main-thread sweet arm total from rows.json main-only columns
const rows=JSON.parse(fs.readFileSync(path.join(ROOT,run,'rows.json'),'utf8'));
const sw=rows.filter(r=>r.arm==='sweet');const mainIdeal=sw.reduce((a,r)=>a+(r.idealCostMainOnlyUsd||0),0);const mainReal=sw.reduce((a,r)=>a+(r.costRealizedMainOnlyUsd||0),0);
console.log('sweet main-only: idealCostMainOnlyUsd sum',mainIdeal.toFixed(4),'costRealizedMainOnlyUsd sum',mainReal.toFixed(4),'rows with main-only null',sw.filter(r=>r.idealCostMainOnlyUsd==null).length);
const sideTot=side.Explore.totUsd+side['general-purpose'].totUsd;
console.log('sweet arm inclusive imputed ideal = main',mainIdeal.toFixed(4),'+ side',sideTot.toFixed(4),'=',(mainIdeal+sideTot).toFixed(4),' per rollout',((mainIdeal+sideTot)/66).toFixed(6));
// added-cost variants for 8 Explore launches with the measured request counts
const exReqs=out.filter(o=>o.type==='Explore').map(o=>o.requests);
for(const [label,tok] of [['guide only (1,516 tok)',1516],['guide+frame via CLAUDE.md hierarchy (2,270 tok)',2270],['guide in body + guide via rules + frame (3,727 tok)',3727]]){
  const usd=exReqs.reduce((a,n)=>a+(tok*PRICE.in+(n-1)*tok*PRICE.cache)/1e6,0);
  console.log(`added cost, ${label}: $${usd.toFixed(6)} over 66 rollouts = $${(usd/66).toFixed(7)}/rollout (Explore requests: ${exReqs.join('+')}=${exReqs.reduce((a,b)=>a+b,0)})`);
}
