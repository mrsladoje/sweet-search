import fs from 'node:fs';
const rows = fs.readFileSync('/tmp/fp-inv/p1/rollouts.ndjson','utf8').trim().split('\n').map(JSON.parse);
const repair = new Set(fs.readFileSync('/root/fresh-run/repair-tasks.txt','utf8').trim().split('\n').map(s=>s.trim()).filter(Boolean));
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const f6=x=>x.toFixed(6);
console.log('=== CONCURRENCY: the 11 repair tasks, fp (CONC=2, surviving) vs rp (CONC=1) ===');
const fp = rows.filter(r=>r.harness==='opencode'&&r.runId.startsWith('fp-')&&r.arm==='sweet'&&repair.has(r.taskId));
const rp = rows.filter(r=>r.harness==='opencode'&&r.runId.startsWith('rp-')&&r.arm==='sweet');
console.log(`  fp surviving sweet rollouts on the 11 repair tasks: ${fp.length}; rp rollouts: ${rp.length}`);
console.log(`  ideal $: fp=${f6(mean(fp.map(r=>r.ideal)))} rp=${f6(mean(rp.map(r=>r.ideal)))}  (${(100*(mean(rp.map(r=>r.ideal))/mean(fp.map(r=>r.ideal))-1)).toFixed(2)}%)`);
console.log(`  realized $: fp=${f6(mean(fp.map(r=>r.real)))} rp=${f6(mean(rp.map(r=>r.real)))}`);
console.log(`  cacheHit: fp=${(mean(fp.map(r=>r.cachedTok/Math.max(1,r.inTok)))).toFixed(4)} rp=${(mean(rp.map(r=>r.cachedTok/Math.max(1,r.inTok)))).toFixed(4)}`);
console.log(`  turns: fp=${mean(fp.map(r=>r.nTurns)).toFixed(2)} rp=${mean(rp.map(r=>r.nTurns)).toFixed(2)}  solved: fp=${fp.filter(r=>r.resolved===true).length}/${fp.length} rp=${rp.filter(r=>r.resolved===true).length}/${rp.length}`);
console.log('  per-form:');
for(const form of ['tab','none','pipe']){
  const a=fp.filter(r=>r.form===form), b=rp.filter(r=>r.form===form);
  console.log(`    ${form}: fp n=${a.length} $${f6(mean(a.map(r=>r.real)))} solved=${a.filter(r=>r.resolved===true).length} | rp n=${b.length} $${f6(mean(b.map(r=>r.real)))} solved=${b.filter(r=>r.resolved===true).length}`);
}
console.log('\n=== SUBSTITUTION EFFECT: opencode sweet cell with fp-only (where it exists) vs merged ===');
for(const form of ['tab','none','pipe']){
  const merged = rows.filter(r=>r.harness==='opencode'&&r.epoch==='C'&&r.arm==='sweet'&&r.form===form&&(repair.has(r.taskId)?r.runId.startsWith('rp-'):!r.runId.startsWith('rp-')));
  const fponly = rows.filter(r=>r.harness==='opencode'&&r.runId.startsWith('fp-')&&r.arm==='sweet'&&r.form===form);
  console.log(`  ${form}: merged n=${merged.length} $${f6(mean(merged.map(r=>r.real)))} solved=${merged.filter(r=>r.resolved===true).length} | fp-only n=${fponly.length} $${f6(mean(fponly.map(r=>r.real)))} solved=${fponly.filter(r=>r.resolved===true).length} (${(100*fponly.filter(r=>r.resolved===true).length/fponly.length).toFixed(1)}%)`);
}
console.log('\n=== degenReran census, all runs ===');
for(const runId of [...new Set(rows.map(r=>r.runId))]){
  const s=rows.filter(r=>r.runId===runId&&r.degenReran);
  if(s.length) console.log(`  ${runId}: ${s.length} (` + ['native','sweet'].map(a=>`${a} ${s.filter(r=>r.arm===a).length}`).join(', ') + ')');
}
