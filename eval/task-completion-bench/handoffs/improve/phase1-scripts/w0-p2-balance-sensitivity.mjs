#!/usr/bin/env node
// SLATE-B W0 gate — P2: POST-HOC sensitivity check on one extractor rule.
//
// READ THIS BEFORE QUOTING THE NUMBER. The gate verdict is the one produced by the
// extractor as it stood when the replay ran. This script measures a rule that was
// identified AFTER seeing the false-positive list, so its result is a design note for
// the eventual ss-audit, NOT part of the gate. Reporting it as the gate number would be
// tuning the instrument to the evidence it is supposed to weigh.
//
// The rule: every false positive on a resolved cell was the single stem `user, solution)`
// — an argument-list tail with an unbalanced closing paren, i.e. a span that begins in
// the middle of an expression. A stem that is not bracket-balanced is not a reference to
// anything, so it cannot be residue. That is statable without looking at the data; it
// simply was not stated in time.
//
// Usage: node w0-p2-balance-sensitivity.mjs   ($0, reads the saved replay output)
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const IN = process.env.IN || '/root/w0-p2-residue.json';
const RESULTS = process.env.RESULTS || path.join(BENCH, 'results');
const rows = JSON.parse(readFileSync(IN, 'utf8'));
const BLOCKED = new Set(Object.keys(JSON.parse(
  readFileSync(path.join(BENCH, 'harness/task-blocklist.json'), 'utf8')).tasks));

const resolvedOf = new Map();
for (const run of [...new Set(rows.map(r => r.run))]) {
  const raw = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
  for (const x of (Array.isArray(raw) ? raw : raw.rows)) resolvedOf.set(`${run}|${x.arm}|${x.rep}|${x.taskId}`, !!x.resolved);
}

export function balanced(stem) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const ch of stem) {
    if ('([{'.includes(ch)) stack.push(ch);
    else if (pairs[ch]) { if (stack.pop() !== pairs[ch]) return false; }
  }
  return stack.length === 0;
}

const admissible = rows.filter(r => r.status === 'OK' && !BLOCKED.has(r.id))
  .map(r => ({ ...r, resolved: resolvedOf.get(`${r.run}|${r.arm}|${r.rep}|${r.id}`) }));

const count = (pop, filt) => {
  let cells = 0, items = 0;
  for (const r of pop) {
    const det = (r.span_touched?.detail || []).filter(d => filt(d.stem));
    if (det.length) cells++;
    items += det.length;
  }
  return { cells, items };
};

const resolved = admissible.filter(r => r.resolved === true);
const unresolved = admissible.filter(r => r.resolved === false);

console.log('P2 — post-hoc effect of requiring a bracket-balanced stem\n');
console.log('population'.padEnd(34) + 'as-run (cells/items)'.padEnd(24) + 'balanced-only (cells/items)');
for (const [name, pop] of [['RESOLVED (false positives)', resolved], ['UNRESOLVED', unresolved], ['ALL admissible', admissible]]) {
  const a = count(pop, () => true), b = count(pop, balanced);
  console.log(name.padEnd(34) + `${a.cells}/${a.items}`.padEnd(24) + `${b.cells}/${b.items}`);
}

const us = admissible.filter(r => /underscore/.test(r.id) && r.resolved === false);
const stillFinds = us.filter(r => (r.span_touched?.detail || [])
  .some(d => balanced(d.stem) && d.hits.some(h => h.symbol === 'countBy'))).length;
console.log(`\nthe rule must not cost the trace P2 exists for:`);
console.log(`  losing Underscore cells still naming countBy under the rule: ${stillFinds}/${us.length}`);
console.log(`  (stem ${JSON.stringify('_.has(result, key)')} balanced = ${balanced('_.has(result, key)')};`
  + ` ${JSON.stringify('user, solution)')} balanced = ${balanced('user, solution)')})`);
