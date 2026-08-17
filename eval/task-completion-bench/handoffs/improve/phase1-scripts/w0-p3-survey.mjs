#!/usr/bin/env node
// SLATE-B W0 gate — P3: FORMAT SURVEY.
//
// The delta parser has to read failure screens from every language in the slate. Before
// writing it, this prints what a failing screen actually looks like per task, plus the
// harness trailer the agent already receives. Two things are being established:
//   - which expected/actual shapes must be parsed, and
//   - whether the existing `[run_tests baseline-diff]` trailer already answers the
//     "is this failure mine?" question, which would change what P3 has to add.
// $0: reads the extracted screens only.
import { readFileSync } from 'node:fs';

const cells = JSON.parse(readFileSync(process.env.IN || '/root/w0-p3-screens.json', 'utf8'));
const FAIL = /^\s*\d+\)\s|FAILED|FAIL\b|✗|✖|not ok |AssertionError|Error:|error:|Failure|failed/m;

const byTask = new Map();
for (const c of cells) for (const s of c.screens) {
  const v = /\[run_tests verdict\] status=(\w+)/.exec(s.out)?.[1];
  const bd = /\[run_tests baseline-diff\] ([^\n]*)/.exec(s.out)?.[1];
  const rec = byTask.get(c.taskId) || { fails: [], verdicts: {}, bdIntroduced: {} };
  if (v) rec.verdicts[v] = (rec.verdicts[v] || 0) + 1;
  if (bd) {
    const k = /introduced_failures=(\S+)/.exec(bd)?.[1] ?? '?';
    rec.bdIntroduced[k] = (rec.bdIntroduced[k] || 0) + 1;
  }
  if (v === 'FAIL' && FAIL.test(s.out)) rec.fails.push({ c, s });
  byTask.set(c.taskId, rec);
}

for (const [task, rec] of [...byTask].sort()) {
  console.log(`\n${'='.repeat(78)}\n${task}`);
  console.log(`  verdicts ${JSON.stringify(rec.verdicts)}   baseline-diff introduced_failures ${JSON.stringify(rec.bdIntroduced)}`);
  const ex = rec.fails[0];
  if (!ex) { console.log('  no FAIL screen with a recognisable failure marker'); continue; }
  console.log(`  sample: ${ex.c.harness} ${ex.c.arm} r${ex.c.rep} screen i=${ex.s.i}`);
  const body = ex.s.out.replace(/^\[run_tests\][\s\S]*?--- output tail ---\n/, '');
  const at = body.search(FAIL);
  console.log(body.slice(Math.max(0, at - 200), at + 1200).split('\n').map(l => '   | ' + l).join('\n'));
}
