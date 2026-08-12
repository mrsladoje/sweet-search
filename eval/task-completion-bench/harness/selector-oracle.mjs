#!/usr/bin/env node
// selector-oracle.mjs — the CEILING for an arm-selection policy (candidate C-2), recomputed
// from a rows file instead of transcribed by hand.
//
// The oracle sees each task's outcome and picks the better arm: more resolved reps wins, and
// a tie is broken by lower cost. It is NOT a policy — nothing can know this at runtime. It is
// the upper bound any router could reach on THESE rows, so it says whether an adaptive
// control plane is worth building at all. If the oracle barely beats native, no predictor can.
//
// Tasks with no test evidence on any arm are EXCLUDED from the solve counts and named: a
// grading unknown must not be laundered into a selectable win.
//
// Usage: node selector-oracle.mjs <rows.json> [--cost idealCostUsd] [--exclude ids]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ROWS = args.find(a => !a.startsWith('--'));
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const COST = arg('cost', 'idealCostUsd');
const EXCLUDE = new Set(String(arg('exclude', '')).split(',').map(s => s.trim()).filter(Boolean));
if (!ROWS) { console.error('usage: selector-oracle.mjs <rows.json> [--cost field] [--exclude ids]'); process.exit(2); }

const rows = JSON.parse(readFileSync(ROWS, 'utf8')).filter(r => !EXCLUDE.has(r.taskId));
const cells = new Map();                       // `${task}|${arm}` -> {res, reps, cost[]}
const blind = new Map();                       // task -> {total, blind}
for (const r of rows) {
  const k = `${r.taskId}|${r.arm}`;
  const c = cells.get(k) || { task: r.taskId, arm: r.arm, res: 0, reps: 0, cost: [] };
  c.reps++; if (r.resolved) c.res++;
  if (r[COST] != null) c.cost.push(r[COST]);
  cells.set(k, c);
  if (r.gradeable != null) {
    const b = blind.get(r.taskId) || { total: 0, blind: 0 };
    b.total++; if (r.noTestEvidence) b.blind++;
    blind.set(r.taskId, b);
  }
}
const held = [...blind.entries()].filter(([, b]) => b.blind && b.blind === b.total).map(([t]) => t);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

const tasks = new Map();
for (const c of cells.values()) {
  const t = tasks.get(c.task) || { id: c.task };
  t[c.arm] = { res: c.res, reps: c.reps, cost: mean(c.cost) };
  tasks.set(c.task, t);
}
const paired = [...tasks.values()].filter(t => t.native && t.sweet);
const scored = paired.filter(t => !held.includes(t.id));

const tot = { native: { cost: 0, res: 0, reps: 0, tasks: 0 }, sweet: { cost: 0, res: 0, reps: 0, tasks: 0 }, oracle: { cost: 0, res: 0, reps: 0, tasks: 0 } };
const picks = [];
for (const t of paired) {
  for (const arm of ['native', 'sweet']) {
    tot[arm].cost += t[arm].cost;
    if (held.includes(t.id)) continue;
    tot[arm].res += t[arm].res; tot[arm].reps += t[arm].reps;
    if (t[arm].res > 0) tot[arm].tasks++;
  }
  // Oracle choice: more resolved reps, then cheaper. On a held-out (evidence-free) task the
  // solve side is unknowable, so it falls back to the cheaper arm and contributes no solve.
  const better = held.includes(t.id) || t.native.res === t.sweet.res
    ? (t.native.cost <= t.sweet.cost ? 'native' : 'sweet')
    : (t.native.res > t.sweet.res ? 'native' : 'sweet');
  tot.oracle.cost += t[better].cost;
  if (!held.includes(t.id)) {
    tot.oracle.res += t[better].res; tot.oracle.reps += t[better].reps;
    if (t[better].res > 0) tot.oracle.tasks++;
  }
  picks.push({ id: t.id, pick: better, n: `${t.native.res}/${t.native.reps}`, s: `${t.sweet.res}/${t.sweet.reps}`, held: held.includes(t.id) });
}

const pct = (a, b) => b ? ((b - a) / b * 100) : 0;
console.log(`\n=== C-2 selector oracle (${COST}) — ${ROWS.split('/').slice(-2).join('/')} ===`);
if (held.length) console.log(`held out, no test evidence on any arm: ${held.join(', ')}  (cost still summed, solve NOT counted)`);
console.log(`paired tasks ${paired.length} | scored for solve ${scored.length}\n`);
console.log(`  native  $${tot.native.cost.toFixed(6)}   tasks ${tot.native.tasks}/${scored.length}   reps ${tot.native.res}/${tot.native.reps}`);
console.log(`  sweet   $${tot.sweet.cost.toFixed(6)}   tasks ${tot.sweet.tasks}/${scored.length}   reps ${tot.sweet.res}/${tot.sweet.reps}   (${pct(tot.sweet.cost, tot.native.cost) >= 0 ? '−' : '+'}${Math.abs(pct(tot.sweet.cost, tot.native.cost)).toFixed(1)}% vs native)`);
console.log(`  ORACLE  $${tot.oracle.cost.toFixed(6)}   tasks ${tot.oracle.tasks}/${scored.length}   reps ${tot.oracle.res}/${tot.oracle.reps}   (${pct(tot.oracle.cost, tot.native.cost) >= 0 ? '−' : '+'}${Math.abs(pct(tot.oracle.cost, tot.native.cost)).toFixed(1)}% vs native)`);
const single = picks.filter(p => !p.held && p.pick === 'sweet' && +p.s.split('/')[0] === 1 && +p.n.split('/')[0] === 0);
console.log(`\n  per-task picks (native reps | sweet reps):`);
for (const p of picks) console.log(`    ${p.pick === 'native' ? 'N' : 'S'}  ${p.id.padEnd(42)} ${p.n} | ${p.s}${p.held ? '   << held out, no test evidence' : ''}`);
if (single.length) console.log(`\n  ${single.length} of the oracle's sweet-side gains rest on a SINGLE resolved rep: ${single.map(p => p.id).join(', ')}`);
console.log('');
