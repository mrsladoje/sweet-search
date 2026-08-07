#!/usr/bin/env node
// $0 GATE for lever #1 (auto-await authoritative tests).
// Census all 72 raw codex rollouts for detached run_tests -> poll turns.
// A "poll turn" = a model request whose sole tool action is write_stdin/wait on a
// still-running session (produces no edit/search/read). Eliminating it (shim blocks
// internally, returns final result in one call) is solve-neutral by construction.
// Luna rates: input $0.10/M (new), cached $0.01/M, output $0.60/M. input_tokens INCLUDES cached.
import fs from 'fs';
const RAW = process.argv[2];
const IN=0.10e-6, CA=0.01e-6, OUT=0.60e-6;
const lines = fs.readFileSync(RAW,'utf8').split(/\n/);

// split into rollouts by marker
const rollouts=[]; let cur=null;
for(const l of lines){
  const m=l.match(/^===TASKARM:(.+):R(\d+)===$/);
  if(m){ cur={key:m[1], rep:+m[2], ev:[]}; rollouts.push(cur); continue; }
  if(cur && l.startsWith('{')){ let j; try{j=JSON.parse(l)}catch{continue} cur.ev.push(j); }
}

function classify(input){
  // input is the JS snippet string the model emitted
  if(typeof input!=='string') input=JSON.stringify(input);
  const isWrite = /write_stdin/.test(input);
  const isWait  = /\bwait\b/.test(input) && !/exec_command/.test(input);
  const rtCmd   = /run_tests/.test(input);
  const cmdMatch= input.match(/cmd:\s*"((?:[^"\\]|\\.)*)"/);
  const cmd = cmdMatch? cmdMatch[1] : '';
  const isRtExec = /(^|[^\w])run_tests([^\w]|$)/.test(cmd) || (rtCmd && /exec_command/.test(input) && !cmd);
  if(isWrite) return 'poll';           // write_stdin => polling a running session
  if(isRtExec) return 'run_tests';     // launches the suite
  return 'other';                      // search/read/edit/etc
}

let tot={reqs:0,cost:0}, poll={reqs:0,cost:0,new:0,cached:0,out:0}, rt={reqs:0,cost:0};
const perRollout=[];
for(const r of rollouts){
  // zip: each custom_tool_call gets the NEXT token_count.last_token_usage as its request cost
  let pendingCall=null, rr={key:r.key,rep:r.rep,reqs:0,polls:0,rtLaunch:0,pollCost:0,totCost:0};
  const wait_fncalls=[];
  for(const e of r.ev){
    const p=e.payload; if(!p) continue;
    if(p.type==='custom_tool_call' && p.name==='exec'){ pendingCall={cls:classify(p.input)}; }
    else if(p.type==='function_call' && p.name==='wait'){ pendingCall={cls:'poll'}; }
    else if(p.type==='token_count' && p.info && p.info.last_token_usage){
      const u=p.info.last_token_usage;
      const inTok=u.input_tokens||0, ca=u.cached_input_tokens||0, o=(u.output_tokens||0)+(u.reasoning_output_tokens||0);
      const newIn=Math.max(0,inTok-ca);
      const cost=newIn*IN + ca*CA + o*OUT;
      tot.reqs++; tot.cost+=cost; rr.reqs++; rr.totCost+=cost;
      const cls = pendingCall? pendingCall.cls : 'other';
      if(cls==='poll'){ poll.reqs++; poll.cost+=cost; poll.new+=newIn; poll.cached+=ca; poll.out+=o; rr.polls++; rr.pollCost+=cost; }
      if(cls==='run_tests'){ rt.reqs++; rt.cost+=cost; rr.rtLaunch++; }
      pendingCall=null;
    }
  }
  perRollout.push(rr);
}

const pct=(a,b)=>(100*a/b).toFixed(1)+'%';
console.log('=== POLL CENSUS over',rollouts.length,'rollouts ===');
console.log('total model requests (token_count events):',tot.reqs,' ideal $'+tot.cost.toFixed(6));
console.log('run_tests launches:',rt.reqs,' $'+rt.cost.toFixed(6));
console.log('POLL turns:',poll.reqs, '('+pct(poll.reqs,tot.reqs)+' of requests)');
console.log('POLL ideal cost: $'+poll.cost.toFixed(6),'('+pct(poll.cost,tot.cost)+' of spend)');
console.log('  poll tokens: new='+poll.new+' cached='+poll.cached+' out='+poll.out);
console.log('  -> eliminating polls saves ~$'+poll.cost.toFixed(6),'(solve-neutral if output byte-identical)');
// top offenders
perRollout.sort((a,b)=>b.pollCost-a.pollCost);
console.log('\n=== top 12 rollouts by poll cost ===');
console.log('key\trep\treqs\tpolls\tpoll$\ttot$');
for(const r of perRollout.slice(0,12)) console.log(`${r.key}\tr${r.rep}\t${r.reqs}\t${r.polls}\t$${r.pollCost.toFixed(5)}\t$${r.totCost.toFixed(5)}`);
// arm split
const armAgg={};
for(const r of perRollout){ const arm=r.key.endsWith('-sweet')?'sweet':'native'; (armAgg[arm]=armAgg[arm]||{polls:0,pollCost:0,reqs:0,tot:0}); armAgg[arm].polls+=r.polls; armAgg[arm].pollCost+=r.pollCost; armAgg[arm].reqs+=r.reqs; armAgg[arm].tot+=r.totCost; }
console.log('\n=== by arm ===');
for(const [a,v] of Object.entries(armAgg)) console.log(`${a}: polls=${v.polls} pollReq%=${pct(v.polls,v.reqs)} poll$=$${v.pollCost.toFixed(5)} pollSpend%=${pct(v.pollCost,v.tot)}`);
