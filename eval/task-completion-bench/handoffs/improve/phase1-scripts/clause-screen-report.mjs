#!/usr/bin/env node
// Clause screen report. Executes CLAUSE-SCREEN-PREREGISTRATION.md (+ amendment 1).
//
// Reads the three pilots as four conditions — NAT and C0 share the base pilot because the
// memory file only reaches the sweet arm.
import { readFileSync, existsSync } from 'node:fs';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const PILOTS = { base: 'cs-base-20260821', CG: 'cs-CG-20260821', C14: 'cs-C14-20260821' };
// The five tasks used to SELECT GALL in the first clause screen. Reported separately and
// never pooled into the headline — a gain located here is selection, not effect.
const SELECTION = new Set(['jashkenas__underscore-2757', 'teleporthq__teleport-code-generators-291',
  'akinsho__nvim-bufferline.lua-173', 'rstudio-education__gradethis-161', 'pytask-dev__pytask-210']);
const CONTROLS = new Set(['ontodev__robot-710', 'epiforecasts__scoringutils-229', 'oceanparcels__parcels-617']);
const REPS = 3;

const cond = {};   // cond -> task -> {solved, n, cost}
const load = (pilot, arm, name) => {
  const f = `${R}/${PILOTS[pilot]}/rows.json`;
  if (!existsSync(f)) return;
  for (const row of JSON.parse(readFileSync(f, 'utf8'))) {
    if (row.arm !== arm) continue;
    cond[name] = cond[name] || {};
    const t = cond[name][row.taskId] = cond[name][row.taskId] || { solved: 0, n: 0, cost: 0, calls: 0 };
    t.n++; if (row.resolved) t.solved++;
    t.cost += row.realFromTurnsUsd ?? row.breakPricedCostUsd ?? 0;
    t.calls += row.calls || 0;
  }
};
load('base', 'native', 'NAT');
load('base', 'sweet', 'C0');
load('CG', 'sweet', 'CG');
load('C14', 'sweet', 'C14');

const TASKS = [...new Set(Object.values(cond).flatMap(c => Object.keys(c)))].sort();
const NAMES = ['NAT', 'C0', 'CG', 'C14'];

// ---- integrity first: lost rollouts, before any result is read
console.log('=== INTEGRITY ===');
let lost = 0;
for (const c of NAMES) for (const t of TASKS) {
  const v = cond[c]?.[t]; const n = v?.n ?? 0;
  if (n !== REPS) { console.log(`  LOST  ${c.padEnd(4)} ${t.padEnd(44)} ${n}/${REPS} reps`); lost += REPS - n; }
}
console.log(`  rollouts expected ${NAMES.length * TASKS.length * REPS}, lost ${lost}` +
  `  (pre-registered discard threshold: >5)`);

// ---- solve matrix
const maj = (v) => v && v.n > 0 && v.solved * 2 > v.n;
console.log('\n=== SOLVE MATRIX (solved/reps; * = majority) ===');
console.log('task'.padEnd(44), NAMES.map(n => n.padStart(7)).join(''), '  group');
for (const t of TASKS) {
  const group = CONTROLS.has(t) ? 'control' : SELECTION.has(t) ? 'selection' : 'FRESH';
  const cells = NAMES.map(c => { const v = cond[c]?.[t]; return v ? `${v.solved}/${v.n}${maj(v) ? '*' : ' '}`.padStart(7) : '   -   '; });
  console.log(t.padEnd(44), cells.join(''), ' ', group);
}

// ---- aggregates
const agg = (filter, label) => {
  const ts = TASKS.filter(filter);
  console.log(`\n=== ${label} (${ts.length} tasks) ===`);
  console.log('cond   majority-solved   rollouts-solved      cost      $/rollout   calls/rollout');
  for (const c of NAMES) {
    let m = 0, s = 0, n = 0, cost = 0, calls = 0;
    for (const t of ts) { const v = cond[c]?.[t]; if (!v) continue; if (maj(v)) m++; s += v.solved; n += v.n; cost += v.cost; calls += v.calls; }
    console.log(c.padEnd(6), `${String(m).padStart(2)}/${ts.length}`.padStart(14),
      `${String(s).padStart(3)}/${String(n).padEnd(3)}`.padStart(18),
      `$${cost.toFixed(6)}`.padStart(12), `$${(cost / n).toFixed(6)}`.padStart(12),
      (calls / n).toFixed(1).padStart(12));
  }
  return ts;
};
agg(() => true, 'ALL 13 ADMISSIBLE');
agg(t => !SELECTION.has(t), 'UNUSED-BY-SELECTION (the honest number)');
agg(t => SELECTION.has(t), 'SELECTION TASKS (reported, never pooled)');
agg(t => CONTROLS.has(t), 'CONTROLS');

// ---- the pre-registered bar
console.log('\n=== PRE-REGISTERED BAR ===');
const majSet = (c, ts) => new Set(ts.filter(t => maj(cond[c]?.[t])));
for (const treat of ['CG', 'C14']) {
  const all = majSet(treat, TASKS), base = majSet('C0', TASKS);
  const gained = [...all].filter(t => !base.has(t));
  const lostT = [...base].filter(t => !all.has(t));
  const fresh = gained.filter(t => !SELECTION.has(t));
  const deltaCost = (() => {
    let a = 0, an = 0, b = 0, bn = 0;
    for (const t of TASKS) { const v = cond[treat]?.[t], w = cond.C0?.[t]; if (v) { a += v.cost; an += v.n; } if (w) { b += w.cost; bn += w.n; } }
    return 100 * ((a / an) / (b / bn) - 1);
  })();
  const pass = (all.size - base.size) >= 2 && lostT.length === 0 && fresh.length >= 1 && deltaCost <= 10;
  console.log(`${treat}:  majority ${base.size} -> ${all.size} (${all.size - base.size >= 0 ? '+' : ''}${all.size - base.size})` +
    `  gained=[${gained.join(', ') || 'none'}]  regressed=[${lostT.join(', ') || 'none'}]` +
    `  fresh-gains=${fresh.length}  cost ${deltaCost >= 0 ? '+' : ''}${deltaCost.toFixed(1)}%`);
  console.log(`      bar: >=+2 tasks AND zero regression AND >=1 fresh gain AND cost <=+10%  ->  ${pass ? 'PASS' : 'FAIL'}`);
}
