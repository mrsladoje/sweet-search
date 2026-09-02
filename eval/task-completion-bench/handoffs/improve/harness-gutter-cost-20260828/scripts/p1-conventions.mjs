#!/usr/bin/env node
// p1-conventions.mjs — claude transcript-selection conventions, delegation subsets,
// spend re-sum, contextRewrites, retries, and the medians.
import fs from 'node:fs';
import path from 'node:path';
const RES = '/root/sweet-search-private/eval/task-completion-bench/results';
const PRICE = { in: 0.10, cache: 0.01, out: 0.60 };
const rows = fs.readFileSync('/tmp/fp-inv/p1/rollouts.ndjson', 'utf8').trim().split('\n').map(JSON.parse);
const repair = new Set(fs.readFileSync('/root/fresh-run/repair-tasks.txt', 'utf8').trim().split('\n').map(s => s.trim()).filter(Boolean));
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f6 = x => x.toFixed(6);

function claudeTurns(file) {
  const byId = new Map(); const order = [];
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return { turns: [], reqs: 0, noUsage: 0 }; }
  let noUsage = 0;
  for (const l of txt.split('\n')) {
    if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
    const m = o.message; if (!m || o.type !== 'assistant' || !m.id) continue;
    if (!byId.has(m.id)) { byId.set(m.id, { best: -1, usage: null }); order.push(m.id); }
    const u = m.usage; if (!u) continue;
    const cached = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    const inp = (u.input_tokens || 0) + cached + cw, out = u.output_tokens || 0;
    const g = byId.get(m.id);
    if (inp + out > g.best) { g.best = inp + out; g.usage = { in: inp, cached, cacheWrite: cw, out }; }
  }
  const turns = [];
  for (const id of order) { const g = byId.get(id); if (!g.usage) { noUsage++; continue; } turns.push(g.usage); }
  return { turns, reqs: order.length, noUsage };
}
function priceReal(turns) {
  let real = 0, prevIn = 0, ideal = 0, brk = 0, rew = 0;
  for (const tu of turns) {
    const cw = Math.max(0, Math.min(tu.cacheWrite || 0, tu.in - (tu.cached || 0)));
    real += ((tu.in - (tu.cached || 0) - cw) * PRICE.in + cw * PRICE.in * 1.25 + (tu.cached || 0) * PRICE.cache + tu.out * PRICE.out) / 1e6;
    const newIn = Math.max(0, tu.in - prevIn);
    ideal += (newIn * PRICE.in + (tu.in - newIn) * PRICE.cache + tu.out * PRICE.out) / 1e6;
    let cacheable;
    if (tu.in < prevIn) { cacheable = 0; rew++; } else cacheable = Math.min(prevIn, tu.in);
    brk += ((tu.in - cacheable) * PRICE.in + cacheable * PRICE.cache + tu.out * PRICE.out) / 1e6;
    prevIn = tu.in;
  }
  return { real, ideal, brk, rew };
}
function sessionCost(f) {
  const pr = claudeTurns(f);
  const p = priceReal(pr.turns);
  let side = 0, subFiles = 0;
  const sdir = f.replace(/\.jsonl$/, '') + '/subagents';
  if (fs.existsSync(sdir)) for (const g of fs.readdirSync(sdir)) {
    if (!g.endsWith('.jsonl')) continue; subFiles++;
    side += priceReal(claudeTurns(path.join(sdir, g)).turns).real;
  }
  return { main: p.real, side, total: p.real + side, subFiles, ideal: p.ideal, brk: p.brk, rew: p.rew, out: pr.turns.reduce((a, t) => a + t.out, 0), turns: pr.turns.length };
}

console.log('=== A. CLAUDE TRANSCRIPT-SELECTION CONVENTIONS (fp-claudecode-*, epoch C) ===');
const CC = [['tab', 'fp-claudecode-tab-20260826'], ['none', 'fp-claudecode-none-20260826'], ['pipe', 'fp-claudecode-pipe-20260826']];
const spendTotals = { rowMatched: 0, dearest3: 0, everyDollar: 0 };
for (const [form, runId] of CC) {
  const rr = JSON.parse(fs.readFileSync(path.join(RES, runId, 'rows.json'), 'utf8'));
  for (const arm of ['native', 'sweet']) {
    const cellRows = rr.filter(r => r.arm === arm);
    if (!cellRows.length) continue;
    // enumerate EVERY session in the whole cell (all reps, all project dirs)
    const all = [];
    for (const r of cellRows) {
      const base = path.join(RES, runId, 'agent-state', `${r.taskId}-${r.arm}`, 'claude-home', 'projects');
      let dirs = []; try { dirs = fs.readdirSync(base); } catch {}
      for (const d of dirs) {
        const m = d.match(/-r(\d+)-/); if (!m) continue;
        for (const f of fs.readdirSync(path.join(base, d))) {
          if (!f.endsWith('.jsonl')) continue;
          all.push({ taskId: r.taskId, rep: +m[1], file: path.join(base, d, f) });
        }
      }
    }
    // dedupe
    const seen = new Set(); const sessions = [];
    for (const a of all) { if (seen.has(a.file)) continue; seen.add(a.file); sessions.push(a); }
    for (const s of sessions) Object.assign(s, sessionCost(s.file));
    // per task: 3 dearest
    const byTask = new Map();
    for (const s of sessions) { if (!byTask.has(s.taskId)) byTask.set(s.taskId, []); byTask.get(s.taskId).push(s); }
    let dearest3 = 0, everyDollar = 0, nTask = 0, extra = 0;
    for (const [t, ss] of byTask) {
      nTask++;
      ss.sort((a, b) => b.total - a.total);
      for (let i = 0; i < Math.min(3, ss.length); i++) dearest3 += ss[i].total;
      for (const s of ss) everyDollar += s.total;
      if (ss.length > 3) extra += ss.length - 3;
    }
    const rowMatched = rows.filter(r => r.runId === runId && r.arm === arm).reduce((a, r) => a + r.real + (r.sideReal || 0), 0);
    const n = cellRows.length;
    console.log(`${form}/${arm}: n=${n} tasks=${nTask} sessions=${sessions.length} extraSessions=${extra}`);
    console.log(`   rowMatched  total=$${rowMatched.toFixed(6)} perRollout=$${f6(rowMatched / n)}`);
    console.log(`   dearest3    total=$${dearest3.toFixed(6)} perRollout=$${f6(dearest3 / n)}`);
    console.log(`   everyDollar total=$${everyDollar.toFixed(6)} perRollout=$${f6(everyDollar / n)}`);
    spendTotals.rowMatched += rowMatched; spendTotals.dearest3 += dearest3; spendTotals.everyDollar += everyDollar;
  }
}
console.log(`CLAUDE FP TOTALS: rowMatched=$${spendTotals.rowMatched.toFixed(4)} dearest3=$${spendTotals.dearest3.toFixed(4)} everyDollar=$${spendTotals.everyDollar.toFixed(4)}`);

console.log('\n=== B. DELEGATION SUBSETS (claude epoch C, sweet TAB vs native), 3 definitions ===');
{
  const sw = rows.filter(r => r.harness === 'claude-code' && r.epoch === 'C' && r.form === 'tab' && r.arm === 'sweet');
  const na = rows.filter(r => r.harness === 'claude-code' && r.epoch === 'C' && r.form === 'tab' && r.arm === 'native');
  const key = r => `${r.taskId}|${r.rep}`;
  const swM = new Map(sw.map(r => [key(r), r])), naM = new Map(na.map(r => [key(r), r]));
  const pairs = [...swM.keys()].filter(k => naM.has(k));
  // def 1: task level (no rollout of either arm delegated)
  const delegTasks = new Set([...sw, ...na].filter(r => (r.subFiles || 0) > 0).map(r => r.taskId));
  const tasksClean = [...new Set(na.map(r => r.taskId))].filter(t => !delegTasks.has(t));
  // def 2: rep-matched rollout pairs where neither delegated
  const pairsClean = pairs.filter(k => (swM.get(k).subFiles || 0) === 0 && (naM.get(k).subFiles || 0) === 0);
  // def 3: 22 tasks minus moq-1262 (the leave-one-out max)
  function report(label, taskList) {
    const S = taskList.map(t => mean(sw.filter(r => r.taskId === t).map(r => r.real)));
    const N = taskList.map(t => mean(na.filter(r => r.taskId === t).map(r => r.real)));
    const d = S.map((s, i) => s - N[i]);
    console.log(`  ${label}: tasks=${taskList.length} main-only Δ=${(100 * mean(d) / mean(N)).toFixed(2)}% (mean Δ=$${f6(mean(d))}, native base $${f6(mean(N))})`);
  }
  console.log(`  delegating task set (either arm) size=${delegTasks.size}; tasks with NO delegation anywhere=${tasksClean.length} (${tasksClean.join(', ')})`);
  report('def1 task-level clean', tasksClean);
  const allTasks = [...new Set(na.map(r => r.taskId))].sort();
  report('all 22 tasks (main-only)', allTasks);
  report('22 minus moq-1262 (LOO)', allTasks.filter(t => t !== 'devlooped__moq-1262'));
  // def2 unpaired means over clean rollout pairs
  const sD = pairsClean.map(k => swM.get(k).real), nD = pairsClean.map(k => naM.get(k).real);
  console.log(`  def2 rollout-pair clean: pairs=${pairsClean.length} main-only Δ=${(100 * (mean(sD) - mean(nD)) / mean(nD)).toFixed(2)}% (sweet $${f6(mean(sD))} vs native $${f6(mean(nD))})`);
  // how many tasks does def2 touch
  console.log(`  def2 touches ${new Set(pairsClean.map(k => k.split('|')[0])).size} distinct tasks`);
}

console.log('\n=== C. MEDIANS of paired per-task deltas (claude epoch C) ===');
{
  const sw = rows.filter(r => r.harness === 'claude-code' && r.epoch === 'C' && r.form === 'tab' && r.arm === 'sweet');
  const na = rows.filter(r => r.harness === 'claude-code' && r.epoch === 'C' && r.form === 'tab' && r.arm === 'native');
  const tasks = [...new Set(na.map(r => r.taskId))].sort();
  for (const [lbl, key] of [['inclusive', r => r.real + (r.sideReal || 0)], ['main-only', r => r.real]]) {
    const d = tasks.map(t => mean(sw.filter(r => r.taskId === t).map(key)) - mean(na.filter(r => r.taskId === t).map(key)));
    const s = [...d].sort((a, b) => a - b);
    const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    console.log(`  ${lbl}: mean=$${f6(mean(d))} median=$${f6(med)} cheaper=${d.filter(x => x < 0).length}/${d.length}`);
  }
}

console.log('\n=== D. contextRewrites and retries ===');
{
  const rew = rows.filter(r => r.rewrites > 0);
  console.log(`  rollouts with contextRewrites>0 in MY reconstruction: ${rew.length}`);
  for (const r of rew) console.log(`    ${r.runId} ${r.taskId} ${r.arm} r${r.rep}: rewrites=${r.rewrites} ideal=${f6(r.ideal)} brk=${f6(r.brk)} diff=${f6(r.brk - r.ideal)}`);
  // rows.json's own contextRewrites for epoch C
  for (const runId of [...new Set(rows.filter(r => r.epoch === 'C').map(r => r.runId))]) {
    const rr = JSON.parse(fs.readFileSync(path.join(RES, runId, 'rows.json'), 'utf8'));
    const nz = rr.filter(r => (r.contextRewrites || 0) > 0);
    if (nz.length) console.log(`    rows.json ${runId}: ${nz.length} rows with contextRewrites>0`);
  }
  // codex/opencode candidate counts
  for (const h of ['codex', 'opencode']) {
    const s = rows.filter(r => r.harness === h && r.epoch === 'C');
    console.log(`  ${h} epoch C: rows=${s.length} rows with >1 attempt/candidate=${s.filter(r => (r.candidates || 1) > 1).length} degenReran=${s.filter(r => r.degenReran).length}`);
  }
}

console.log('\n=== E. SPEND RE-SUM, three conventions ===');
{
  const codex = rows.filter(r => r.epoch === 'C' && r.harness === 'codex').reduce((a, r) => a + r.real, 0);
  const oc = rows.filter(r => r.epoch === 'C' && r.harness === 'opencode').reduce((a, r) => a + r.real, 0);
  console.log(`  codex (all 3 runs, every row)      = $${codex.toFixed(4)}`);
  console.log(`  opencode (all 6 runs, every row)   = $${oc.toFixed(4)}`);
  console.log(`  claude rowMatched                  = $${spendTotals.rowMatched.toFixed(4)}`);
  console.log(`  claude dearest3 (published)        = $${spendTotals.dearest3.toFixed(4)}`);
  console.log(`  claude everyDollar                 = $${spendTotals.everyDollar.toFixed(4)}`);
  console.log(`  TOTAL rowMatched  = $${(codex + oc + spendTotals.rowMatched).toFixed(4)}`);
  console.log(`  TOTAL dearest3    = $${(codex + oc + spendTotals.dearest3).toFixed(4)}`);
  console.log(`  TOTAL everyDollar = $${(codex + oc + spendTotals.everyDollar).toFixed(4)}`);
  // the 12-cell table sum (66-rollout cells only)
  const cellSum = [
    ['codex', 'tab', 'native'], ['codex', 'tab', 'sweet'], ['codex', 'none', 'sweet'], ['codex', 'pipe', 'sweet'],
    ['opencode', 'tab', 'native'], ['opencode', 'tab', 'sweet'], ['opencode', 'none', 'sweet'], ['opencode', 'pipe', 'sweet'],
  ].reduce((a, [h, form, arm]) => {
    let s;
    if (h === 'opencode') s = rows.filter(r => r.harness === h && r.epoch === 'C' && r.arm === arm && r.form === form && (arm === 'native' ? !r.runId.startsWith('rp-') : (repair.has(r.taskId) ? r.runId.startsWith('rp-') : !r.runId.startsWith('rp-'))));
    else s = rows.filter(r => r.harness === h && r.epoch === 'C' && r.arm === arm && r.form === form);
    return a + s.reduce((x, r) => x + r.real, 0);
  }, 0);
  console.log(`  12-cell table sum: codex+opencode cells = $${cellSum.toFixed(4)}; + claude dearest3 $${spendTotals.dearest3.toFixed(4)} = $${(cellSum + spendTotals.dearest3).toFixed(4)}`);
}
