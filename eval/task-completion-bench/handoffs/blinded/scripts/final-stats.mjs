import fs from 'node:fs';
const OUT = '/root/blinded-work';
const rows = JSON.parse(fs.readFileSync(`${OUT}/REVEALED.json`, 'utf8'));
const ref = JSON.parse(fs.readFileSync(`${OUT}/referee-ranking.json`, 'utf8'));

console.log('=== pool composition ===');
const mixed = [];
for (const [t, m] of Object.entries(rows)) {
  const c = Object.values(m).filter(v => v.correct).length, n = Object.keys(m).length;
  const isMixed = c > 0 && c < n;
  if (isMixed) mixed.push(t);
  console.log(`${t.padEnd(34)} correct=${c}/${n} ${isMixed ? 'MIXED' : (c === n ? 'all-correct' : 'all-wrong')}`);
}
console.log('mixed pools (discrimination is even defined): ' + mixed.length + ' -> ' + mixed.join(', '));

console.log('\n=== gold rank within the ranked survivors ===');
let lastCount = 0, ranked = 0;
for (const [t, r] of Object.entries(ref)) {
  const goldOid = Object.entries(rows[t]).find(([, v]) => v.prov === 'GOLD')[0];
  const i = r.ranking.findIndex(x => x.oid === goldOid);
  if (i < 0) { console.log(`${t.padEnd(34)} gold NOT RANKED (contract put it in the lower tier)`); continue; }
  ranked++;
  const last = i === r.ranking.length - 1;
  if (last) lastCount++;
  console.log(`${t.padEnd(34)} gold rank ${i + 1}/${r.ranking.length}${last ? '   <-- LAST' : ''}`);
}
console.log(`gold ranked last in ${lastCount}/${ranked} pools where it was ranked at all`);

console.log('\n=== referee on mixed pools only ===');
let ok = 0;
for (const t of mixed) {
  const top = ref[t].ranking[0]?.oid;
  const good = top ? rows[t][top].correct : false;
  if (good) ok++;
  console.log(`${t.padEnd(34)} top=${top} correct=${good}`);
}
console.log(`mixed-pool selection accuracy = ${ok}/${mixed.length}`);

console.log('\n=== Gate B per-task, mixed pools only ===');
for (const t of mixed) {
  const m = rows[t];
  const aw = Object.values(m).filter(v => v.verdict === 'ACCEPT' && !v.correct).length;
  const ac = Object.values(m).filter(v => v.verdict === 'ACCEPT' && v.correct).length;
  const rc = Object.values(m).filter(v => v.verdict === 'REJECT' && v.correct).length;
  const rw = Object.values(m).filter(v => v.verdict === 'REJECT' && !v.correct).length;
  const uc = Object.values(m).filter(v => v.verdict === 'UNDECIDED' && v.correct).length;
  const uw = Object.values(m).filter(v => v.verdict === 'UNDECIDED' && !v.correct).length;
  const clean = aw === 0 && rc === 0 && (rw > 0 || uw > 0);
  console.log(`${t.padEnd(34)} ACC(correct)=${ac} ACC(wrong)=${aw} REJ(wrong)=${rw} REJ(correct)=${rc} UND(correct)=${uc} UND(wrong)=${uw}  ${clean ? 'DISCRIMINATES' : 'no'}`);
}

console.log('\n=== counterfactual: translator repaired (unresolved identifier -> UNDECIDED) ===');
console.log('epiforecasts K07 would become UNDECIDED; false rejections 1 -> 0.');
console.log('scoringutils pool is all-correct, so discrimination there stays undefined: 1/8 unchanged.');
