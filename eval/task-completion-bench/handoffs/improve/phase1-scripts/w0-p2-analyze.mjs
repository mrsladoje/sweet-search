#!/usr/bin/env node
// SLATE-B W0 gate — P2: SCORE the residue replay.
//
// Two questions, and the gate kills P2 on either:
//   1. Does the audit surface the countBy twin on every losing Underscore sweet patch?
//   2. Does it flood already-resolved cells with residue nobody should act on?
//
// The noise number is the one to distrust. A residue list that is quiet because the
// extractor is broken looks exactly like a residue list that is quiet because the work
// was clean. So this reports the STEM YIELD alongside the hit counts: a cell with many
// derived stems and no hits is real silence; a cell with zero stems derived from a
// large patch is a suspect extractor, and is listed by name.
//
// Usage: node w0-p2-analyze.mjs   ($0, reads /root/w0-p2-residue.json)
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const IN = process.env.IN || '/root/w0-p2-residue.json';
const RESULTS = process.env.RESULTS || path.join(BENCH, 'results');
const rows = JSON.parse(readFileSync(IN, 'utf8'));

const BLOCKED = new Set(Object.keys(JSON.parse(
  readFileSync(path.join(BENCH, 'harness/task-blocklist.json'), 'utf8')).tasks));

// resolved status per cell, from the run's own rows.json
const resolvedOf = new Map();
for (const run of [...new Set(rows.map(r => r.run))]) {
  const raw = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
  for (const x of (Array.isArray(raw) ? raw : raw.rows))
    resolvedOf.set(`${run}|${x.arm}|${x.rep}|${x.taskId}`, !!x.resolved);
}
for (const r of rows) r.resolved = resolvedOf.get(`${r.run}|${r.arm}|${r.rep}|${r.id}`);

const ok = rows.filter(r => r.status === 'OK');
const admissible = ok.filter(r => !BLOCKED.has(r.id));

console.log('P2 residue replay — scoring\n');
console.log(`rows=${rows.length}  OK=${ok.length}  `
  + `EMPTY_PATCH=${rows.filter(r => r.status === 'EMPTY_PATCH').length}  `
  + `ERROR=${rows.filter(r => r.status === 'ERROR').length}  `
  + `apply-failed=${ok.filter(r => r.applied === false).length}`);
console.log(`admissible (blocklist applied)=${admissible.length}\n`);

// ---------------------------------------------------------------- 1. sensitivity

console.log('=== 1. SENSITIVITY — the trace P2 exists to catch ===\n');
const us = ok.filter(r => /underscore/.test(r.id)).sort((a, b) => a.harness.localeCompare(b.harness) || a.rep - b.rep);
let sensPass = 0, sensNeed = 0;
for (const r of us) {
  const det = r.span_touched?.detail || [];
  const namesCountBy = det.some(d => d.hits.some(h => h.symbol === 'countBy'));
  const losing = r.resolved === false;
  if (losing) { sensNeed++; if (namesCountBy) sensPass++; }
  console.log(`  ${r.harness.padEnd(11)} rep${r.rep}  resolved=${String(r.resolved).padEnd(5)} `
    + `residue=${det.length} item(s)  namesCountBy=${namesCountBy}`
    + `${losing ? (namesCountBy ? '   <- REQUIRED, met' : '   <- REQUIRED, MISSED') : (namesCountBy ? '   <- false positive on a WIN' : '')}`);
}
console.log(`\n  losing Underscore sweet cells naming countBy: ${sensPass}/${sensNeed}`);
console.log(`  winning Underscore sweet cells with any residue: `
  + `${us.filter(r => r.resolved && (r.span_touched?.detail || []).length).length}/${us.filter(r => r.resolved).length}`);

// ---------------------------------------------------------------- 2. specificity

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
const quant = (xs, q) => xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0;

function noiseTable(pop, label) {
  console.log(`\n--- ${label} (n=${pop.length}) ---`);
  console.log('granularity/scope'.padEnd(20) + 'cells w/ residue'.padEnd(18)
    + 'median'.padEnd(8) + 'p90'.padEnd(6) + 'max'.padEnd(6) + 'total items');
  for (const gran of ['span', 'line']) {
    for (const scope of ['touched', 'repo']) {
      const counts = pop.map(r => r[`${gran}_${scope}`]?.items || 0);
      const withAny = counts.filter(c => c > 0).length;
      console.log(`${(gran + '/' + scope).padEnd(20)}`
        + `${(withAny + ' (' + pct(withAny, pop.length) + ')').padEnd(18)}`
        + `${String(quant(counts, 0.5)).padEnd(8)}${String(quant(counts, 0.9)).padEnd(6)}`
        + `${String(Math.max(0, ...counts)).padEnd(6)}${counts.reduce((a, b) => a + b, 0)}`);
    }
  }
}

console.log('\n\n=== 2. SPECIFICITY — what the audit would say on work that was already right ===');
const resolvedCells = admissible.filter(r => r.resolved === true);
const unresolvedCells = admissible.filter(r => r.resolved === false);
noiseTable(resolvedCells, 'RESOLVED admissible sweet cells — every item here is a false positive');
noiseTable(unresolvedCells, 'UNRESOLVED admissible sweet cells');
noiseTable(admissible, 'ALL admissible sweet cells');

// ---------------------------------------------------------------- 3. is the silence real

console.log('\n\n=== 3. IS THE SILENCE REAL — guarding against a quiet-because-broken extractor ===\n');
const noStem = admissible.filter(r => (r.stemsSpan || 0) === 0);
console.log(`cells with ZERO derived stems: ${noStem.length}/${admissible.length}`);
console.log('  (a large patch with no stems means the extractor, not the agent, was quiet)');
for (const r of noStem.slice(0, 40))
  console.log(`    ${r.harness.padEnd(11)} rep${r.rep} ${r.id.padEnd(42)} touchedFiles=${(r.touched || []).length}`);
const stemYield = admissible.map(r => r.stemsSpan || 0);
console.log(`\nstems per cell: median=${quant(stemYield, 0.5)} p90=${quant(stemYield, 0.9)} max=${Math.max(0, ...stemYield)} total=${stemYield.reduce((a, b) => a + b, 0)}`);

// ---------------------------------------------------------------- 4. the actual list

console.log('\n\n=== 4. EVERY RESIDUE ITEM ON A RESOLVED CELL (the false-positive list, in full) ===\n');
let fp = 0;
for (const r of resolvedCells) {
  const det = r.span_touched?.detail || [];
  if (!det.length) continue;
  console.log(`  ${r.harness} rep${r.rep} ${r.id}`);
  for (const d of det) {
    fp++;
    console.log(`     stem ${JSON.stringify(d.stem)}  (${d.n} hit${d.n > 1 ? 's' : ''})`);
    for (const h of d.hits.slice(0, 3)) console.log(`        ${h.file}:${h.line} symbol=${h.symbol} | ${h.text.slice(0, 110)}`);
  }
}
console.log(`\n  total false-positive residue items on resolved cells: ${fp}`);
console.log(`  resolved cells that would see ANY residue: `
  + `${resolvedCells.filter(r => (r.span_touched?.detail || []).length).length}/${resolvedCells.length}`);
