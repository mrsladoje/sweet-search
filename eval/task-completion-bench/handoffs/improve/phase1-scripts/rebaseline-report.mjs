#!/usr/bin/env node
// Post-repair re-baseline report. Executes REBASELINE-PREREGISTRATION.md.
// Cost is SIDECHAIN-INCLUSIVE by the settled definition: claude-code native uses subagents
// far more than sweet, so the main-transcript column reads the wrong sign.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { turnsFromTranscriptFile } from '/root/sweet-search-private/eval/task-completion-bench/harness/claude-code-accounting.mjs';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { opencode: 'rb-opencode-20260824', 'claude-code': 'rb-claudecode-20260824' };
const walk = (d, o = []) => { let e = []; try { e = readdirSync(d, { withFileTypes: true }); } catch { return o; }
  for (const x of e) { const p = path.join(d, x.name); x.isDirectory() ? walk(p, o) : o.push(p); } return o; };

// per (harness, arm, task) -> reps
const D = {};
const sideByCell = {};
for (const [h, run] of Object.entries(RUNS)) {
  const rows = JSON.parse(readFileSync(path.join(R, run, 'rows.json'), 'utf8'));
  // claude sidechains, per rollout, keyed by cell+rep in file order
  if (h === 'claude-code') {
    for (const cell of readdirSync(path.join(R, run, 'agent-state'))) {
      const subs = walk(path.join(R, run, 'agent-state', cell)).filter(f => f.includes('/subagents/') && f.endsWith('.jsonl')).sort();
      for (const f of subs) {
        const arm = cell.endsWith('-sweet') ? 'sweet' : 'native';
        sideByCell[cell] = (sideByCell[cell] || 0)
          + costFromTurns(turnsFromTranscriptFile(f), priceFor('openai/gpt-5.6-luna')).realFromTurnsUsd;
      }
    }
  }
  for (const r of rows) {
    const k = `${h}|${r.arm}`;
    D[k] = D[k] || { tasks: {}, n: 0, solved: 0, cost: 0, calls: 0, lost: 0 };
    const t = D[k].tasks[r.taskId] = D[k].tasks[r.taskId] || [];
    t.push(!!r.resolved);
    D[k].n++; if (r.resolved) D[k].solved++;
    D[k].cost += r.realFromTurnsUsd ?? r.breakPricedCostUsd ?? 0;
    D[k].calls += r.calls || 0;
  }
}
// fold claude sidechain totals in at the arm level
for (const [cell, usd] of Object.entries(sideByCell)) {
  const arm = cell.endsWith('-sweet') ? 'sweet' : 'native';
  D[`claude-code|${arm}`].cost += usd;
  D[`claude-code|${arm}`].side = (D[`claude-code|${arm}`].side || 0) + usd;
}

const maj = v => v.filter(Boolean).length * 2 > v.length;
const pct = x => (x >= 0 ? '+' : '') + (100 * x).toFixed(1) + '%';
const usd = x => '$' + x.toFixed(6);

console.log('=== INTEGRITY ===');
let lost = 0;
for (const k of Object.keys(D)) { const d = D[k];
  for (const [t, v] of Object.entries(d.tasks)) if (v.length !== 3) { console.log(`  LOST ${k} ${t} ${v.length}/3`); lost += 3 - v.length; } }
console.log(`  rollouts 156 expected, ${Object.values(D).reduce((a, b) => a + b.n, 0)} recorded, ${lost} lost (void threshold: >8)\n`);

for (const h of Object.keys(RUNS)) {
  const n = D[`${h}|native`], s = D[`${h}|sweet`];
  const tasks = [...new Set([...Object.keys(n.tasks), ...Object.keys(s.tasks)])].sort();
  console.log(`===== ${h.toUpperCase()} =====`);
  console.log('task'.padEnd(44), 'native  sweet');
  let sWin = 0, nWin = 0;
  for (const t of tasks) {
    const nv = n.tasks[t] || [], sv = s.tasks[t] || [];
    const a = nv.filter(Boolean).length, b = sv.filter(Boolean).length;
    if (b > a) sWin++; else if (a > b) nWin++;
    console.log(t.padEnd(44), `${a}/${nv.length}${maj(nv) ? '*' : ' '}`.padStart(6), `${b}/${sv.length}${maj(sv) ? '*' : ' '}`.padStart(7));
  }
  const nMaj = Object.values(n.tasks).filter(maj).length, sMaj = Object.values(s.tasks).filter(maj).length;
  console.log('-'.repeat(60));
  console.log(`rollouts solved     native ${n.solved}/${n.n}      sweet ${s.solved}/${s.n}     delta ${s.solved - n.solved}`);
  console.log(`tasks majority      native ${nMaj}/${tasks.length}       sweet ${sMaj}/${tasks.length}`);
  console.log(`tasks where an arm solved MORE reps:  sweet ${sWin}  native ${nWin}  tied ${tasks.length - sWin - nWin}`);
  console.log(`cost (fully loaded) native ${usd(n.cost)}  sweet ${usd(s.cost)}` + (n.side ? `   [sidechains: native ${usd(n.side)} sweet ${usd(s.side || 0)}]` : ''));
  console.log(`$/rollout           native ${usd(n.cost / n.n)}  sweet ${usd(s.cost / s.n)}   ${pct((s.cost / s.n) / (n.cost / n.n) - 1)}`);
  console.log(`calls/rollout       native ${(n.calls / n.n).toFixed(1)}          sweet ${(s.calls / s.n).toFixed(1)}`);
  const d = Math.abs(s.solved - n.solved);
  console.log(`\nPRE-REGISTERED RULE: |delta| = ${d}; bar is >=6 rollouts.`);
  if (d < 6) console.log(`  -> NO MEASURABLE RESOLUTION DIFFERENCE. Cost-per-solved is NOT reported, by pre-registration.`);
  else console.log(`  -> difference clears the bar.  $/solved  native ${usd(n.cost / n.solved)}  sweet ${usd(s.cost / s.solved)}  ${pct((s.cost / s.solved) / (n.cost / n.solved) - 1)}`);
  // paired sign test over tasks
  const k = Math.min(sWin, nWin), m = sWin + nWin;
  let p = 0; const C = (a, b) => { let r = 1; for (let i = 0; i < b; i++) r = r * (a - i) / (i + 1); return r; };
  for (let i = 0; i <= k; i++) p += C(m, i) * Math.pow(0.5, m);
  console.log(`  paired sign test over tasks: ${sWin} sweet-better vs ${nWin} native-better, two-sided p ~ ${m ? Math.min(1, 2 * p).toFixed(3) : 'n/a'}\n`);
}
