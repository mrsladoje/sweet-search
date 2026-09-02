import fs from 'node:fs';
const rows = fs.readFileSync('/tmp/fp-inv/p1/rollouts.ndjson','utf8').trim().split('\n').map(JSON.parse);
const repair = new Set(fs.readFileSync('/root/fresh-run/repair-tasks.txt','utf8').trim().split('\n').map(s=>s.trim()).filter(Boolean));
const mean = a=>a.reduce((x,y)=>x+y,0)/a.length;
function cell(h,form,arm){
  if(h==='opencode') return rows.filter(r=>r.harness===h&&r.epoch==='C'&&r.arm===arm&&r.form===form&&(arm==='native'?!r.runId.startsWith('rp-'):(repair.has(r.taskId)?r.runId.startsWith('rp-'):!r.runId.startsWith('rp-'))));
  return rows.filter(r=>r.harness===h&&r.epoch==='C'&&r.arm===arm&&r.form===form);
}
console.log('=== cost per rollout by REP INDEX within a cell (inclusive realized) ===');
for(const h of ['codex','opencode','claude-code'])
 for(const form of ['tab','none','pipe']){
  const s=cell(h,form,'sweet'); if(!s.length) continue;
  const by=[0,1,2].map(k=>s.filter(r=>r.rep===k));
  const m=by.map(a=>a.length?mean(a.map(r=>r.real+(r.sideReal||0))):NaN);
  const spread=(Math.max(...m)-Math.min(...m))/Math.min(...m)*100;
  console.log(`  ${h} ${form}: n=${by.map(a=>a.length).join('/')} $=${m.map(x=>x.toFixed(6)).join(' / ')} spread=${spread.toFixed(1)}%`);
 }
console.log('\n=== solve counts per cell (check vs FRESH-POOL) ===');
for(const h of ['codex','opencode','claude-code']){
  for(const [form,arm] of [['tab','native'],['tab','sweet'],['none','sweet'],['pipe','sweet']]){
    const s=cell(h,form,arm);
    console.log(`  ${h} ${form}/${arm}: n=${s.length} solved=${s.filter(r=>r.resolved===true).length} unresolvedNull=${s.filter(r=>r.resolved==null).length} f2pNull=${s.filter(r=>r.f2pFrac==null).length} testResultsNull=${s.filter(r=>r.testResults==null).length}`);
  }
}
