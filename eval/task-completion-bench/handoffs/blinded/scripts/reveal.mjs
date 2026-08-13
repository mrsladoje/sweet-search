// REVEAL: join opaque IDs to provenance and to grader outcomes; score Gate B and Gate C.
import fs from 'node:fs';
const OUT = '/root/blinded-work';
const RES = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claudecode: 'sb-claudecode-20260811' };
const sealed = JSON.parse(fs.readFileSync(`${OUT}/SEALED-identity.json`, 'utf8'));
const verd = JSON.parse(fs.readFileSync(`${OUT}/contract-verdicts.json`, 'utf8'));
const ref = JSON.parse(fs.readFileSync(`${OUT}/referee-ranking.json`, 'utf8'));

// label lookup from the run ledger (rows.json `resolved`), which is the canonical outcome.
// NOTE: the per-arm report.json disagrees with it on 32/96 rows, always report=false/rows=true;
// report.json predates the grader repairs, so rows.json is authoritative.
const label = {};
for (const [k, run] of Object.entries(RUNS)) {
  const raw = JSON.parse(fs.readFileSync(`${RES}/${run}/rows.json`, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.rows;
  for (const r of rows) label[`${k}/${r.arm}/r${r.rep}|${r.taskId}`] = !!r.resolved;
}

const rows = {};
for (const [task, m] of Object.entries(sealed)) {
  rows[task] = {};
  for (const [oid, info] of Object.entries(m)) {
    const correct = info.prov === 'GOLD' ? true : label[`${info.prov}|${task}`];
    rows[task][oid] = { prov: info.prov, correct, verdict: verd[task][oid]?.verdict, why: verd[task][oid]?.why };
  }
}
fs.writeFileSync(`${OUT}/REVEALED.json`, JSON.stringify(rows, null, 1));

// ---- Gate B scoring ----
console.log('=== GATE B ===');
let discriminating = 0, falseRejects = 0;
const gb = [];
for (const [task, m] of Object.entries(rows)) {
  let tp = 0, fp = 0, tn = 0, fn = 0, undec = 0, badReject = 0;
  const correctSet = [], wrongSet = [];
  for (const [oid, r] of Object.entries(m)) {
    (r.correct ? correctSet : wrongSet).push(oid);
    if (r.verdict === 'ACCEPT') { r.correct ? tp++ : fp++; }
    else if (r.verdict === 'REJECT') { if (r.correct) { badReject++; fn++; } else tn++; }
    else undec++;
  }
  // "correct discrimination" = at least one wrong candidate separated from the accepted ones,
  // with no accepted candidate rejected, and no wrong candidate ACCEPTed.
  const separated = (tn > 0 || (correctSet.length > 0 && wrongSet.length > 0 && fp === 0 && wrongSet.some(o => m[o].verdict !== 'ACCEPT')));
  const clean = badReject === 0 && fp === 0;
  const disc = separated && clean;
  if (disc) discriminating++;
  falseRejects += badReject;
  gb.push({ task, nCorrect: correctSet.length, nWrong: wrongSet.length, ACCEPT_correct: tp, ACCEPT_wrong: fp, REJECT_wrong: tn, REJECT_correct: badReject, UNDECIDED: undec, discriminates: disc });
}
console.table ? console.table(gb) : console.log(JSON.stringify(gb, null, 1));
console.log(`discriminating tasks = ${discriminating}/8  (bar: >=3)`);
console.log(`rejections of an accepted patch = ${falseRejects}  (bar: 0)`);

// ---- Gate C scoring ----
console.log('\n=== GATE C ===');
let sel = 0, elimCorrect = 0;
const gc = [];
for (const [task, r] of Object.entries(ref)) {
  const m = rows[task];
  const top = r.ranking[0]?.oid;
  const topCorrect = top ? m[top].correct : false;
  if (topCorrect) sel++;
  const goldOid = Object.entries(m).find(([, v]) => v.prov === 'GOLD')?.[0];
  const goldRank = r.ranking.findIndex(x => x.oid === goldOid) + 1;
  const elim = r.eliminated.filter(o => m[o].correct);
  elimCorrect += elim.length;
  // rank quality: mean rank of correct candidates among the ranked survivors
  const ranks = r.ranking.map((x, i) => ({ i: i + 1, correct: m[x.oid].correct }));
  const cr = ranks.filter(x => x.correct).map(x => x.i);
  gc.push({
    task, poolCorrect: Object.values(m).filter(v => v.correct).length, ranked: r.ranking.length,
    top, topCorrect, goldOid, goldRank: goldRank || 'not-ranked',
    meanRankOfCorrect: cr.length ? +(cr.reduce((a, b) => a + b, 0) / cr.length).toFixed(2) : null,
    eliminatedCorrect: elim.length, distinctAddedSets: r.distinctAddedLineSets, degenerate: r.degenerate,
  });
}
console.table ? console.table(gc) : console.log(JSON.stringify(gc, null, 1));
console.log(`correct selections = ${sel}/8 = ${(100 * sel / 8).toFixed(1)}%  (bar: >=80% i.e. 7/8)`);
console.log(`accepted patches eliminated at step 1 = ${elimCorrect}  (bar: 0)`);

console.log('\n=== per-candidate detail ===');
for (const [task, m] of Object.entries(rows)) {
  console.log('\n' + task);
  for (const [oid, r] of Object.entries(m))
    console.log(`  ${oid} ${String(r.prov).padEnd(20)} correct=${String(r.correct).padEnd(9)} contract=${r.verdict}`);
}
