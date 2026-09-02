#!/usr/bin/env node
// p1-analyse.mjs — validation + cell table + paired deltas + bootstrap CI.
import fs from 'node:fs';
const rows = fs.readFileSync('/tmp/fp-inv/p1/rollouts.ndjson', 'utf8').trim().split('\n').map(JSON.parse);
const repair = new Set(fs.readFileSync('/root/fresh-run/repair-tasks.txt', 'utf8').trim().split('\n').map(s => s.trim()).filter(Boolean));
const pool = fs.readFileSync('/root/fresh-run/pool.txt', 'utf8').trim().split('\n').map(s => s.trim()).filter(Boolean);
const f6 = x => (x == null ? 'null' : x.toFixed(6));

// ---------- 1. validation against rows.json ----------
console.log('=== 1. VALIDATION: my reconstruction vs rows.json ===');
for (const h of ['codex', 'opencode', 'claude-code']) {
  const rs = rows.filter(r => r.harness === h);
  let nI = 0, maxI = 0, nR = 0, maxR = 0, nM = 0, maxM = 0, nS = 0, maxS = 0, worstI = null, worstM = null;
  for (const r of rs) {
    if (r.rowIdeal != null) { const e = Math.abs(r.ideal - r.rowIdeal); nI++; if (e > maxI) { maxI = e; worstI = r; } }
    if (r.rowReal != null && h !== 'claude-code') { const e = Math.abs(r.real - r.rowReal); nR++; if (e > maxR) maxR = e; }
    if (r.rowMainOnly != null) { const e = Math.abs(r.real - r.rowMainOnly); nM++; if (e > maxM) { maxM = e; worstM = r; } }
    if (r.rowSide != null) { const e = Math.abs(r.sideReal - r.rowSide); nS++; if (e > maxS) maxS = e; }
  }
  console.log(`${h}: ideal n=${nI} maxAbsErr=${maxI.toExponential(3)}${worstI ? ' @' + worstI.runId + '/' + worstI.taskId + '/' + worstI.arm + '/r' + worstI.rep : ''}`);
  if (nR) console.log(`  realized n=${nR} maxAbsErr=${maxR.toExponential(3)}`);
  if (nM) console.log(`  mainOnly n=${nM} maxAbsErr=${maxM.toExponential(3)}${worstM ? ' @' + worstM.runId + '/' + worstM.taskId + '/r' + worstM.rep : ''}`);
  if (nS) console.log(`  sidechain n=${nS} maxAbsErr=${maxS.toExponential(3)}`);
}
// how many claude rows carry null costRealizedUsd (the ledger nulls)
{
  const cc = rows.filter(r => r.harness === 'claude-code' && r.epoch === 'C');
  for (const arm of ['native', 'sweet']) {
    for (const form of ['tab', 'none', 'pipe']) {
      const s = cc.filter(r => r.arm === arm && r.form === form);
      if (!s.length) continue;
      console.log(`  claude ${form}/${arm}: n=${s.length} nullRealized=${s.filter(r => r.rowReal == null).length} nullMainOnly=${s.filter(r => r.rowMainOnly == null).length} degenReran=${s.filter(r => r.degenReran).length} candidates>1=${s.filter(r => r.candidates > 1).length}`);
    }
  }
}

// ---------- 2. epoch-C cells ----------
function cellRows(harness, form, arm) {
  if (harness === 'opencode') {
    // merge: fp-* for non-repair tasks, rp-* for repair tasks (sweet arm only has rp-*)
    const out = [];
    for (const r of rows) {
      if (r.harness !== 'opencode' || r.epoch !== 'C' || r.arm !== arm || r.form !== form) continue;
      const isRepairRun = r.runId.startsWith('rp-');
      if (arm === 'native') { if (!isRepairRun) out.push(r); continue; }
      if (repair.has(r.taskId) ? isRepairRun : !isRepairRun) out.push(r);
    }
    return out;
  }
  return rows.filter(r => r.harness === harness && r.epoch === 'C' && r.arm === arm && r.form === form);
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

console.log('\n=== 2. EPOCH-C CELLS (my reconstruction) ===');
console.log('harness form arm  n  ideal$   real$    brk$   incl$   turns  outTok  ingestTok residentTok ctxInt firstIn  rewrites');
const cells = {};
for (const h of ['codex', 'opencode', 'claude-code']) {
  for (const form of ['tab', 'none', 'pipe']) {
    for (const arm of ['native', 'sweet']) {
      if (arm === 'native' && form !== 'tab') continue;
      const s = cellRows(h, form, arm);
      if (!s.length) continue;
      const incl = s.map(r => r.real + (r.sideReal || 0));
      const c = {
        n: s.length, ideal: mean(s.map(r => r.ideal)), real: mean(s.map(r => r.real)),
        brk: mean(s.map(r => r.brk)), incl: mean(incl),
        turns: mean(s.map(r => r.nTurns)), out: mean(s.map(r => r.outTok)),
        ingestTok: mean(s.map(r => r.ingestTok)), residentTok: mean(s.map(r => r.residentTok)),
        ctx: mean(s.map(r => r.ctxIntegral)), firstIn: mean(s.map(r => r.firstIn)),
        rew: s.reduce((a, r) => a + r.rewrites, 0),
        solved: s.filter(r => r.resolved === true).length,
        side: mean(s.map(r => r.sideReal || 0)),
        deleg: s.filter(r => (r.subFiles || 0) > 0).length,
        ingestUsd: mean(s.map(r => r.ingestUsd)), residentUsd: mean(s.map(r => r.residentUsd)),
        outputUsd: mean(s.map(r => r.outputUsd)),
        cw: mean(s.map(r => r.cacheWriteRawTok ?? r.cacheWriteTok ?? 0)),
        rows: s,
      };
      cells[`${h}|${form}|${arm}`] = c;
      console.log(`${h} ${form} ${arm} n=${c.n} ideal=${f6(c.ideal)} real=${f6(c.real)} brk=${f6(c.brk)} incl=${f6(c.incl)} turns=${c.turns.toFixed(2)} out=${Math.round(c.out)} ingT=${Math.round(c.ingestTok)} resT=${Math.round(c.residentTok)} ctx=${Math.round(c.ctx)} first=${Math.round(c.firstIn)} rew=${c.rew} solved=${c.solved} side=${f6(c.side)} delegRollouts=${c.deleg}`);
    }
  }
}

console.log('\n--- component split (per rollout, mean) ---');
for (const k of Object.keys(cells)) {
  const c = cells[k];
  const tot = c.ingestUsd + c.residentUsd + c.outputUsd;
  console.log(`${k}: INGEST ${f6(c.ingestUsd)} (${(100 * c.ingestUsd / (tot + c.side)).toFixed(1)}%) RESIDENT ${f6(c.residentUsd)} (${(100 * c.residentUsd / (tot + c.side)).toFixed(1)}%) OUTPUT ${f6(c.outputUsd)} (${(100 * c.outputUsd / (tot + c.side)).toFixed(1)}%) side ${f6(c.side)} | identity ideal=${f6(tot)} vs ${f6(c.ideal)} | surcharge real-ideal=${f6(c.real - c.ideal)} | cacheWriteTok=${Math.round(c.cw)}`);
}

// ---------- 3. paired per-task deltas + bootstrap ----------
function taskMeans(cell, key) {
  const m = new Map();
  for (const r of cell.rows) {
    if (!m.has(r.taskId)) m.set(r.taskId, []);
    m.get(r.taskId).push(key(r));
  }
  const out = new Map();
  for (const [t, a] of m) out.set(t, mean(a));
  return out;
}
function bootstrapPaired(tasks, deltas, base, seed, B = 20000) {
  // simple LCG for reproducibility
  let s = seed >>> 0;
  const rnd = () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
  const pct = [];
  for (let b = 0; b < B; b++) {
    let sd = 0, sb = 0;
    for (let i = 0; i < tasks.length; i++) {
      const j = Math.floor(rnd() * tasks.length);
      sd += deltas[j]; sb += base[j];
    }
    pct.push(100 * sd / sb);
  }
  pct.sort((a, b) => a - b);
  return [pct[Math.floor(0.025 * B)], pct[Math.floor(0.975 * B)]];
}

console.log('\n=== 3. PAIRED PER-TASK DELTA, epoch C (sweet TAB - native) ===');
for (const h of ['codex', 'opencode', 'claude-code']) {
  const sw = cells[`${h}|tab|sweet`], na = cells[`${h}|tab|native`];
  const key = r => r.real + (r.sideReal || 0);   // inclusive realized
  const S = taskMeans(sw, key), N = taskMeans(na, key);
  const tasks = [...N.keys()].filter(t => S.has(t)).sort();
  const deltas = tasks.map(t => S.get(t) - N.get(t));
  const base = tasks.map(t => N.get(t));
  const md = mean(deltas), mb = mean(base);
  const sorted = [...deltas].sort((a, b) => a - b);
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const ci = bootstrapPaired(tasks, deltas, base, 20260828);
  console.log(`${h}: tasks=${tasks.length} meanD=${f6(md)} pct=${(100 * md / mb).toFixed(2)}% CI=[${ci[0].toFixed(1)}%, ${ci[1].toFixed(1)}%] median=${f6(med)} cheaper=${deltas.filter(d => d < 0).length} dearer=${deltas.filter(d => d > 0).length}`);
  // leave-one-out on realized main-only
  const keyM = r => r.real;
  const SM = taskMeans(sw, keyM), NM = taskMeans(na, keyM);
  let lo = { t: null, v: 1e9 }, hi = { t: null, v: -1e9 };
  for (const drop of tasks) {
    const t2 = tasks.filter(t => t !== drop);
    const v = 100 * (mean(t2.map(t => SM.get(t) - NM.get(t)))) / mean(t2.map(t => NM.get(t)));
    if (v < lo.v) lo = { t: drop, v }; if (v > hi.v) hi = { t: drop, v };
  }
  const full = 100 * mean(tasks.map(t => SM.get(t) - NM.get(t))) / mean(tasks.map(t => NM.get(t)));
  console.log(`  LOO on realized MAIN-ONLY: full=${full.toFixed(2)}%  min drop ${lo.t} -> ${lo.v.toFixed(2)}%  max drop ${hi.t} -> ${hi.v.toFixed(2)}%`);
  // top 5 extreme tasks
  const pairs = tasks.map((t, i) => [t, deltas[i]]).sort((a, b) => b[1] - a[1]);
  console.log('  extremes: ' + pairs.slice(0, 3).map(p => `${p[0]} ${f6(p[1])}`).join(' | ') + ' ... ' + pairs.slice(-2).map(p => `${p[0]} ${f6(p[1])}`).join(' | '));
}

// ---------- 4. instruction file first-turn delta ----------
console.log('\n=== 4. INSTRUCTION-FILE FIRST-TURN DELTA (sweet - native), epoch C ===');
for (const h of ['codex', 'opencode', 'claude-code']) {
  const sw = cells[`${h}|tab|sweet`], na = cells[`${h}|tab|native`];
  const S = taskMeans(sw, r => r.firstIn), N = taskMeans(na, r => r.firstIn);
  const ds = [];
  const perRollout = new Map();
  for (const r of sw.rows) perRollout.set(`${r.taskId}|${r.rep}`, r.firstIn);
  const exact = [];
  for (const r of na.rows) {
    const k = `${r.taskId}|${r.rep}`;
    if (perRollout.has(k)) exact.push(perRollout.get(k) - r.firstIn);
  }
  for (const t of N.keys()) if (S.has(t)) ds.push(S.get(t) - N.get(t));
  ds.sort((a, b) => a - b); exact.sort((a, b) => a - b);
  console.log(`${h}: per-task n=${ds.length} min=${ds[0]} med=${ds[Math.floor(ds.length / 2)]} max=${ds[ds.length - 1]}`);
  console.log(`  per-rollout(rep-matched) n=${exact.length} min=${exact[0]} med=${exact[Math.floor(exact.length / 2)]} max=${exact[exact.length - 1]} distinct=${[...new Set(exact)].sort((a, b) => a - b).slice(0, 12).join(',')}`);
  // price it
  const tok = exact.length ? exact[Math.floor(exact.length / 2)] : 0;
  const T = cells[`${h}|tab|sweet`].turns;
  const usd = (tok * 0.10 + tok * (T - 1) * 0.01) / 1e6;
  console.log(`  price: ${tok} tok x (0.10 once + 0.01 x ${(T - 1).toFixed(2)} resends) = $${usd.toFixed(6)} = ${(100 * usd / cells[`${h}|tab|sweet`].incl).toFixed(2)}% of the sweet inclusive arm ($${f6(cells[`${h}|tab|sweet`].incl)})`);
}

// ---------- 5. output-token asymmetry ----------
console.log('\n=== 5. OUTPUT TOKENS (per turn / per rollout), epoch C ===');
for (const h of ['codex', 'opencode', 'claude-code']) {
  for (const arm of ['native', 'sweet']) {
    const c = cells[`${h}|tab|${arm}`];
    console.log(`${h} ${arm}: outTok/rollout=${Math.round(c.out)} turns=${c.turns.toFixed(2)} outTok/turn=${(c.out / c.turns).toFixed(1)} outUsd=${f6(c.outputUsd)}  (main only, sidechain out=${Math.round(mean(c.rows.map(r => r.sideOutTok || 0)))})`);
  }
}

// ---------- 6. claude-code delegation ----------
console.log('\n=== 6. CLAUDE-CODE DELEGATION ===');
for (const ep of ['A', 'B', 'C']) {
  for (const arm of ['native', 'sweet']) {
    const s = rows.filter(r => r.harness === 'claude-code' && r.epoch === ep && r.arm === arm && (ep !== 'C' || r.form === 'tab'));
    if (!s.length) continue;
    const deleg = s.filter(r => (r.subFiles || 0) > 0);
    console.log(`  epoch ${ep} ${arm}: n=${s.length} delegatingRollouts=${deleg.length} delegatingTaskCells=${new Set(deleg.map(r => r.taskId)).size} side$/rollout=${f6(mean(s.map(r => r.sideReal || 0)))} main$/rollout=${f6(mean(s.map(r => r.real)))} incl=${f6(mean(s.map(r => r.real + (r.sideReal || 0))))} subReqs=${s.reduce((a, r) => a + (r.subReqs || 0), 0)} subNoUsage=${s.reduce((a, r) => a + (r.subNoUsage || 0), 0)}`);
  }
  // non-delegating-task comparison
  const sw = rows.filter(r => r.harness === 'claude-code' && r.epoch === ep && r.arm === 'sweet' && (ep !== 'C' || r.form === 'tab'));
  const na = rows.filter(r => r.harness === 'claude-code' && r.epoch === ep && r.arm === 'native' && (ep !== 'C' || r.form === 'tab'));
  if (!sw.length || !na.length) continue;
  const delegTasks = new Set([...sw, ...na].filter(r => (r.subFiles || 0) > 0).map(r => r.taskId));
  const tasks = [...new Set(na.map(r => r.taskId))].filter(t => !delegTasks.has(t) && sw.some(r => r.taskId === t)).sort();
  const S = new Map(), N = new Map();
  for (const t of tasks) {
    S.set(t, mean(sw.filter(r => r.taskId === t).map(r => r.real)));
    N.set(t, mean(na.filter(r => r.taskId === t).map(r => r.real)));
  }
  const deltas = tasks.map(t => S.get(t) - N.get(t)), base = tasks.map(t => N.get(t));
  const pct = 100 * mean(deltas) / mean(base);
  const ci = bootstrapPaired(tasks, deltas, base, 20260828);
  console.log(`  epoch ${ep} NEITHER-DELEGATED tasks n=${tasks.length}: main-only Δ=${pct.toFixed(1)}% CI=[${ci[0].toFixed(1)}%, ${ci[1].toFixed(1)}%]`);
}

// ---------- 7. epoch-cell headline table (all epochs) ----------
console.log('\n=== 7. ALL-EPOCH CELL TABLE ===');
for (const ep of ['A', 'B', 'C']) {
  for (const h of ['codex', 'opencode', 'claude-code']) {
    for (const arm of ['native', 'sweet']) {
      const s = ep === 'C' ? cellRows(h, 'tab', arm) : rows.filter(r => r.harness === h && r.epoch === ep && r.arm === arm);
      if (!s.length) continue;
      console.log(`${ep} ${h} ${arm}: n=${s.length} solved=${s.filter(r => r.resolved === true).length} real=${f6(mean(s.map(r => r.real)))} ideal=${f6(mean(s.map(r => r.ideal)))} brk=${f6(mean(s.map(r => r.brk)))} incl=${f6(mean(s.map(r => r.real + (r.sideReal || 0))))} turns=${mean(s.map(r => r.nTurns)).toFixed(2)} calls=${mean(s.map(r => r.calls || 0)).toFixed(2)} ctx=${Math.round(mean(s.map(r => r.ctxIntegral)))} first=${Math.round(mean(s.map(r => r.firstIn)))}`);
    }
  }
}

// ---------- 8. spend re-sum ----------
console.log('\n=== 8. RUN SPEND (every rollout in rows.json of each run) ===');
let grand = 0;
for (const runId of [...new Set(rows.filter(r => r.epoch === 'C').map(r => r.runId))]) {
  const s = rows.filter(r => r.runId === runId);
  const h = s[0].harness;
  const sum = s.reduce((a, r) => a + r.real + (r.sideReal || 0), 0);
  const rowSum = s.reduce((a, r) => a + (r.rowReal ?? 0), 0);
  grand += sum;
  console.log(`${runId}: n=${s.length} myInclusiveSum=$${sum.toFixed(4)} rowsJsonRealizedSum=$${rowSum.toFixed(4)}`);
}
console.log(`GRAND epoch-C total (all 12 runs, every row incl. deleted/repair duplicates) = $${grand.toFixed(4)}`);
