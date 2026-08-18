#!/usr/bin/env node
// Read the hint-ladder runs and print resolution per task per condition.
//
// The only number that matters here is a SOLVE FLIP. At two or three reps a cost delta is
// noise, and this experiment was never about cost — it asks whether delivered information
// changes the outcome at all. Cost is printed anyway, because a level that flips nothing
// and costs more is worse than neutral, and because a level whose cost does not move at all
// is a sign the extra text never reached the model.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = process.env.RESULTS || '/root/sweet-search-private/eval/task-completion-bench/results';
const STAMP = process.env.STAMP || '20260818';
const LEVELS = (process.env.LEVELS || 'L0,L1,L2,L3').split(',');

const load = (lvl) => {
  const f = path.join(RESULTS, `hl-${lvl}-${STAMP}`, 'rows.json');
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  return Array.isArray(j) ? j : j.rows;
};

const data = {};
for (const l of LEVELS) { const r = load(l); if (r) data[l] = r; }
const have = Object.keys(data);
if (!have.length) { console.log('no runs found'); process.exit(0); }

const tasks = [...new Set(have.flatMap(l => data[l].map(r => r.taskId)))].sort();
const cell = (l, t) => {
  const rs = (data[l] || []).filter(r => r.taskId === t);
  if (!rs.length) return null;
  return {
    solved: rs.filter(r => r.resolved).length,
    n: rs.length,
    gradeable: rs.filter(r => r.gradeable !== false).length,
    cost: rs.reduce((a, r) => a + (r.idealCostUsd || 0), 0) / rs.length,
    calls: rs.reduce((a, r) => a + (r.calls || 0), 0) / rs.length,
    f2p: rs.reduce((a, r) => a + (r.f2pFrac || 0), 0) / rs.length,
  };
};

const w = (s, n) => String(s).padEnd(n);
console.log(`hint ladder — sweet arm, opencode/luna, stamp ${STAMP}\n`);
console.log(w('task', 42) + have.map(l => w(l, 12)).join('') + '  reading');
for (const t of tasks) {
  const cs = have.map(l => cell(l, t));
  const flip = cs.some((c, i) => c && i > 0 && cs[0] && c.solved > cs[0].solved);
  const base = cs[0];
  const note = !base ? '' : base.solved === base.n ? 'control (was solved)'
    : flip ? '*** FLIPPED ***' : 'no flip at any level';
  console.log(w(t, 42) + cs.map(c => w(c ? `${c.solved}/${c.n}` : '-', 12)).join('') + '  ' + note);
}

// Aggregate only over tasks that appear at EVERY level shown. A level that ran a different
// task set has a different denominator, and averaging across it silently compares a run that
// carried three solved controls with one that did not.
const common = tasks.filter(t => have.every(l => cell(l, t)));
console.log(`\naggregates over the ${common.length} task(s) present at every level`);
console.log(`${w('', 42)}${have.map(l => w(l, 12)).join('')}`);
for (const [label, get] of [
  ['mean f2p fraction', (c) => c.f2p.toFixed(3)],
  ['mean ideal cost $', (c) => c.cost.toFixed(5)],
  ['mean tool calls', (c) => c.calls.toFixed(1)],
]) {
  console.log(w(label, 42) + have.map(l => {
    const cs = common.map(t => cell(l, t)).filter(Boolean);
    if (!cs.length) return w('-', 12);
    return w(get({
      f2p: cs.reduce((a, c) => a + c.f2p, 0) / cs.length,
      cost: cs.reduce((a, c) => a + c.cost, 0) / cs.length,
      calls: cs.reduce((a, c) => a + c.calls, 0) / cs.length,
    }), 12);
  }).join(''));
}

// Gate 0 for this experiment: prove the treatment was actually delivered. The hint reaches
// the model only through `problem_statement`, so its arrival is visible as a step up in
// prompt tokens on exactly the tasks that carry a hint. A level whose input tokens match the
// baseline never rendered, and its result is an accidental A/A — the ~$11 mistake the
// micro-smoke protocol exists to prevent.
console.log('\nDELIVERY CHECK — mean prompt tokens on the FIRST model turn (a hint must raise it)');
const firstTurnIn = (lvl, task) => {
  const f = path.join(RESULTS, `hl-${lvl}-${STAMP}`, 'turns', `${task}-sweet.jsonl`);
  if (!existsSync(f)) return null;
  const ins = readFileSync(f, 'utf8').trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(r => r && r.t === 1 && typeof r.in === 'number').map(r => r.in);
  return ins.length ? Math.round(ins.reduce((a, b) => a + b, 0) / ins.length) : null;
};
console.log(w('task', 42) + have.map(l => w(l, 12)).join('') + '  delta vs L0');
for (const t of tasks) {
  const vs = have.map(l => firstTurnIn(l, t));
  const d = (vs[0] != null && vs[1] != null) ? vs.slice(1).map(v => v == null ? '-' : `${v - vs[0] > 0 ? '+' : ''}${v - vs[0]}`).join(' ') : '';
  console.log(w(t, 42) + vs.map(v => w(v ?? '-', 12)).join('') + '  ' + d);
}

// f2pFrac is the honest partial-credit read: a task can go 0/2 solved at every level and
// still show the hint moving the model closer, which is a different verdict from "the hint
// did nothing". Print it per target so a partial move is visible rather than rounded away.
console.log('\nper-target f2p fraction (partial credit — solve requires 1.000 and no p2p break)');
console.log(w('task', 42) + have.map(l => w(l, 12)).join(''));
for (const t of tasks) {
  const cs = have.map(l => cell(l, t));
  if (cs[0] && cs[0].solved === cs[0].n) continue;
  console.log(w(t, 42) + cs.map(c => w(c ? c.f2p.toFixed(3) : '-', 12)).join(''));
}
