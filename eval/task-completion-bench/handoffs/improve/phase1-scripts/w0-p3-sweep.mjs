#!/usr/bin/env node
// SLATE-B W0 gate — P3: THE SWEEP.
//
// Runs the frozen delta parser and classifier over every recorded failure screen and
// answers the two halves of P3's falsifier 2 plus falsifier 3.
//
// FALSIFIER 2a — Dashbitco replay. Every Dashbitco failure screen is classified, and the
//   verdicts must agree across harnesses and reps: the same assertion, the same delta,
//   the same answer. Inconsistency here means the classifier is reading harness noise.
//
// FALSIFIER 2b — the negative controls. The kill condition is "mislabels a solved-cell
//   failure as stale". Operationally, on a cell that ended RESOLVED:
//     FALSE STALE  = a failure called STALE-CANDIDATE that is GONE from the cell's last
//                    screen. It went green, so the agent fixed it in code; calling it an
//                    obsolete assertion would have licensed shipping a repairable break.
//     CORRECT      = a failure called STALE-CANDIDATE that is STILL failing at the end of
//                    a cell that resolved anyway. That is precisely the Dashbitco r1
//                    shape, where shipping red was right, so counting it as an error
//                    would make the gate unpassable by construction.
//   Both are reported; only the first is the kill condition.
//
// FALSIFIER 3 — the ss-oracle trigger census: how often an agent already goes and reads
//   a test file to learn what it pins. Fewer than five realistic triggers demotes
//   ss-oracle to a P3 adapter rather than a tool.
//
// Inputs are restricted to what the agent could see: the issue text, its own patch, and
// its own test output. The task file's `patch`, `test_patch`, FAIL_TO_PASS and
// PASS_TO_PASS fields are never read — reading them would breach P3's kill condition
// "needs hidden/gold facts".
//
// $0: recorded artifacts only.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseScreen, classify } from './w0-p3-delta.mjs';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const RESULTS = process.env.RESULTS || path.join(BENCH, 'results');
const IN = process.env.IN || '/root/w0-p3-screens.json';
const OUT = process.env.OUT || '/root/w0-p3-verdicts.json';

const cells = JSON.parse(readFileSync(IN, 'utf8'));
const BLOCKED = new Set(Object.keys(JSON.parse(
  readFileSync(path.join(BENCH, 'harness/task-blocklist.json'), 'utf8')).tasks));

// Issue text only. Deliberately narrow — see the header.
const specs = JSON.parse(readFileSync(path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json'), 'utf8'));
const issueOf = new Map(specs.map(t => [t.instance_id, String(t.problem_statement || '')]));

// The agent's own patch. Only ADDED lines: what it authored, not what it removed.
const addedOf = new Map();
for (const run of [...new Set(cells.map(c => c.run))]) {
  for (const [rep, sub] of [[0, ''], [1, 'rep-1/']]) {
    for (const arm of ['native', 'sweet']) {
      const f = path.join(RESULTS, run, arm, sub + 'patches.json');
      if (!existsSync(f)) continue;
      for (const rec of Object.values(JSON.parse(readFileSync(f, 'utf8')))) {
        const added = String(rec.patch || '').split('\n')
          .filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n');
        addedOf.set(`${run}|${arm}|${rep}|${rec.instance_id}`, added);
      }
    }
  }
}

const resolvedOf = new Map();
for (const run of [...new Set(cells.map(c => c.run))]) {
  const raw = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
  for (const x of (Array.isArray(raw) ? raw : raw.rows)) resolvedOf.set(`${run}|${x.arm}|${x.rep}|${x.taskId}`, !!x.resolved);
}

const sig = (t) => String(t).toLowerCase().replace(/\(\d+(\.\d+)?m?s\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);

// ------------------------------------------------------------------- classify all
const out = [];
for (const c of cells) {
  const key = `${c.run}|${c.arm}|${c.rep}|${c.taskId}`;
  const issue = issueOf.get(c.taskId) || '';
  const added = addedOf.get(key) || '';
  const screens = c.screens.map(s => {
    const failures = parseScreen(s.out).map(f => ({ ...f, sig: sig(f.test), ...classify(f, issue, added) }));
    return {
      i: s.i,
      verdict: /\[run_tests verdict\] status=(\w+)/.exec(s.out)?.[1] ?? null,
      hasFailureMarker: /^\s*\d+\)\s|FAILED|✗|not ok |AssertionError|XCTAssert|\[ FAIL/m.test(s.out),
      failures,
    };
  });
  out.push({ ...c, calls: undefined, screens: screens, resolved: resolvedOf.get(key), blocked: BLOCKED.has(c.taskId) });
}
writeFileSync(OUT, JSON.stringify(out));

const admissible = out.filter(c => !c.blocked);
const sweetAdm = admissible.filter(c => c.arm === 'sweet');
const line = (s) => console.log(s);

line('P3 sweep — delta parser over every recorded failure screen\n');
line(`cells                       ${out.length}   (admissible ${admissible.length}, sweet admissible ${sweetAdm.length})`);
line(`screens                     ${out.reduce((n, c) => n + c.screens.length, 0)}`);
const failScreens = admissible.flatMap(c => c.screens.filter(s => s.verdict === 'FAIL' || s.hasFailureMarker));
line(`failing screens (admissible) ${failScreens.length}`);
line(`  of which the parser read   ${failScreens.filter(s => s.failures.length).length}`);
const vt = {};
for (const s of failScreens) for (const f of s.failures) vt[f.verdict] = (vt[f.verdict] || 0) + 1;
line(`parsed failures by verdict   ${JSON.stringify(vt)}`);

// ------------------------------------------------------ falsifier 2a: Dashbitco
line(`\n${'='.repeat(78)}\nFALSIFIER 2a — Dashbitco replay, every screen, every arm and rep\n`);
const dash = out.filter(c => c.taskId === 'dashbitco__nimble_options-43');
for (const c of dash.sort((a, b) => (a.arm + a.harness + a.rep).localeCompare(b.arm + b.harness + b.rep))) {
  const fails = c.screens.flatMap(s => s.failures.map(f => ({ i: s.i, ...f })));
  line(`  ${c.arm.padEnd(6)} ${c.harness.padEnd(11)} r${c.rep}  resolved=${String(c.resolved).padEnd(5)} screens=${c.screens.length} parsedFailures=${fails.length}`);
  for (const f of fails) line(`      screen ${String(f.i).padStart(2)}  ${f.verdict.padEnd(16)} ${f.why}`);
}
const dashSweetVerdicts = dash.filter(c => c.arm === 'sweet').flatMap(c => c.screens.flatMap(s => s.failures.map(f => f.verdict)));
line(`\n  sweet Dashbitco verdicts: ${JSON.stringify(dashSweetVerdicts)}`);
line(`  consistent across harnesses and reps: ${new Set(dashSweetVerdicts).size <= 1 ? 'YES' : 'NO'}`);

// -------------------------------------------- falsifier 2b: solved-cell controls
line(`\n${'='.repeat(78)}\nFALSIFIER 2b — negative controls on cells that RESOLVED\n`);
const resolvedCells = admissible.filter(c => c.resolved === true);
const sweetResolved = resolvedCells.filter(c => c.arm === 'sweet');
line(`  resolved admissible cells: ${resolvedCells.length}  (sweet ${sweetResolved.length}, native ${resolvedCells.length - sweetResolved.length})`);

let falseStale = 0, correctStale = 0, cellsWithFalse = new Set();
const falseList = [], correctList = [];
for (const c of resolvedCells) {
  const last = c.screens[c.screens.length - 1];
  const stillFailing = new Set((last?.failures || []).map(f => f.sig));
  const lastGreen = last && last.verdict === 'PASS';
  for (const s of c.screens) {
    for (const f of s.failures) {
      if (f.verdict !== 'STALE-CANDIDATE') continue;
      const gone = lastGreen || !stillFailing.has(f.sig);
      const row = { cell: `${c.harness}/${c.arm}/r${c.rep}/${c.taskId}`, screen: s.i, test: f.test.slice(0, 90), why: f.why };
      if (gone) { falseStale++; cellsWithFalse.add(row.cell); falseList.push(row); }
      else { correctStale++; correctList.push(row); }
    }
  }
}
line(`  FALSE stale  (failure later went green): ${falseStale}   on ${cellsWithFalse.size} cell(s)   <- KILL CONDITION`);
line(`  correct stale (still red at the end of a cell that resolved anyway): ${correctStale}`);
for (const r of falseList) line(`    FALSE  ${r.cell} screen ${r.screen}: ${r.test}\n           ${r.why}`);
for (const r of correctList) line(`    ok     ${r.cell} screen ${r.screen}: ${r.test}\n           ${r.why}`);

// ------------------------------------------------- falsifier 3: oracle triggers
line(`\n${'='.repeat(78)}\nFALSIFIER 3 — ss-oracle trigger census\n`);
const raw = JSON.parse(readFileSync(IN, 'utf8'));
const TESTPATH = /(^|[\s"'\/])(tests?|spec|__tests__)[\/\w.-]*|[\w.-]*_(test|spec)\.[\w]+|test_[\w.-]+\.[\w]+|[\w.-]+\.(test|spec)\.[\w]+/i;
const READY = /^(ss-read|ss-grep|ss-search|ss-find|Read |cat |sed -n|rg |grep |head |less )/;
let triggerCells = 0, triggerCalls = 0;
const perTask = {};
for (const c of raw) {
  if (BLOCKED.has(c.taskId)) continue;
  const hits = c.calls.filter(k => READY.test(k.cmd.trim()) && TESTPATH.test(k.cmd));
  if (hits.length) { triggerCells++; triggerCalls += hits.length; perTask[c.taskId] = (perTask[c.taskId] || 0) + hits.length; }
}
line(`  cells that read a test file at least once: ${triggerCells} of ${raw.filter(c => !BLOCKED.has(c.taskId)).length}`);
line(`  total test-file reads: ${triggerCalls}`);
line(`  by task: ${JSON.stringify(perTask)}`);
line(`\nwrote ${OUT}`);
