#!/usr/bin/env node
// SLATE-B W0 gate — P3: IS THE QUIET REAL, AND IS THE VERDICT CONSISTENT?
//
// Two things the sweep cannot claim on its own.
//
// 1. COVERAGE. "Zero false stale classifications" is worth nothing if the parser simply
//    read almost nothing. The sweep read 13 of 184 failing screens, so every unread
//    screen is attributed here to one of:
//      NO-FAILURE-BLOCK — a FAIL verdict with no failing test in it at all (a build
//                         break, a missing dependency, a harness timeout). Nothing to
//                         classify; the finish gate would report the failure verbatim.
//      NO-DELTA         — a real failing test that carries no expected/actual pair (an
//                         uncaught exception, ENOENT, a segfault). Correct silence: the
//                         stale question is not even askable.
//      SHAPE-MISS       — the screen DOES carry expected/actual language and the parser
//                         still found nothing. This is the only bucket that is a defect,
//                         and it is printed in full so it can be judged by eye.
//
// 2. CONSISTENCY. Falsifier 2a asks for consistent classification across the Dashbitco
//    screens. Consistency means the same failure with the same delta gets the same
//    verdict — NOT that every screen of a task agrees, because the screens capture
//    different trees. Claude sweet r0 mangled the advertised-type list at screen 19, so
//    a verdict of REAL there and STALE-CANDIDATE at screen 10 is the classifier working,
//    not disagreeing with itself. Grouping by (task, test, delta) is what tells those
//    two situations apart.
//
// $0: reads the sweep output only.
import { readFileSync } from 'node:fs';
import { parseScreen } from './w0-p3-delta.mjs';

const IN = process.env.IN || '/root/w0-p3-screens.json';
const V = process.env.V || '/root/w0-p3-verdicts.json';
const cells = JSON.parse(readFileSync(V, 'utf8'));
const rawCells = new Map(JSON.parse(readFileSync(IN, 'utf8'))
  .map(c => [`${c.run}|${c.arm}|${c.rep}|${c.taskId}`, c]));

const FAILBLOCK = /^\s*\d+\)\s|^FAILED|✗|✖|not ok |AssertionError|XCTAssert\w* failed|\[ FAIL|Failure →|^\s*Error:/m;
const DELTA_LANG = /expected:|Expected:|\+ expected - actual|is not equal to|to (?:deeply )?equal|Passed in:|left:\s|E\s+AssertionError: assert /;

let n = { PARSED: 0, 'NO-FAILURE-BLOCK': 0, 'NO-DELTA': 0, 'SHAPE-MISS': 0 };
const misses = [];
const byTask = {};
for (const c of cells) {
  if (c.blocked) continue;
  const raw = rawCells.get(`${c.run}|${c.arm}|${c.rep}|${c.taskId}`);
  for (let k = 0; k < c.screens.length; k++) {
    const s = c.screens[k];
    if (s.verdict !== 'FAIL' && !s.hasFailureMarker) continue;
    const text = raw?.screens?.[k]?.out ?? '';
    let cat;
    if (s.failures.length) cat = 'PARSED';
    else if (!FAILBLOCK.test(text)) cat = 'NO-FAILURE-BLOCK';
    else if (!DELTA_LANG.test(text)) cat = 'NO-DELTA';
    else cat = 'SHAPE-MISS';
    n[cat]++;
    (byTask[c.taskId] ||= {})[cat] = ((byTask[c.taskId] || {})[cat] || 0) + 1;
    if (cat === 'SHAPE-MISS') misses.push({ cell: `${c.harness}/${c.arm}/r${c.rep}/${c.taskId}`, i: s.i, text });
  }
}

console.log('P3 coverage audit — why each failing screen was or was not read\n');
console.log(`  ${JSON.stringify(n)}`);
console.log('\n  per task:');
for (const [t, v] of Object.entries(byTask).sort()) console.log(`    ${t.padEnd(42)} ${JSON.stringify(v)}`);

console.log(`\n  SHAPE-MISS screens (${misses.length}) — the only defect bucket:`);
for (const m of misses.slice(0, 12)) {
  const at = m.text.search(DELTA_LANG);
  console.log(`\n    ${m.cell} screen ${m.i}`);
  console.log(m.text.slice(Math.max(0, at - 300), at + 700).split('\n').map(l => '      | ' + l).join('\n'));
}
if (misses.length > 12) console.log(`\n    ... ${misses.length - 12} more`);

// ------------------------------------------------------------------ consistency
console.log(`\n${'='.repeat(78)}\nCONSISTENCY — same task, same test, same delta must get the same verdict\n`);
const groups = new Map();
for (const c of cells) {
  for (const s of c.screens) for (const f of s.failures) {
    const key = [c.taskId, f.sig, JSON.stringify((f.changed || []).slice().sort())].join(' :: ');
    const g = groups.get(key) || { key, verdicts: new Set(), cells: [] };
    g.verdicts.add(f.verdict);
    g.cells.push(`${c.harness}/${c.arm}/r${c.rep}`);
    groups.set(key, g);
  }
}
let inconsistent = 0;
for (const g of groups.values()) {
  const bad = g.verdicts.size > 1;
  if (bad) inconsistent++;
  console.log(`  ${bad ? 'SPLIT' : 'ok   '} ${[...g.verdicts].join('/')}  x${g.cells.length}  ${g.key.slice(0, 150)}`);
}
console.log(`\n  distinct (task, test, delta) groups: ${groups.size}; groups with more than one verdict: ${inconsistent}`);
