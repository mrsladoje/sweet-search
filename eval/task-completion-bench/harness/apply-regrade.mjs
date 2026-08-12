#!/usr/bin/env node
// apply-regrade.mjs — write a corrected rows file from an offline regrade, without touching
// the original rows.json. Phase-0 tool: a repaired grader must be able to restate a recorded
// run's solve column from the retained patches alone, with the old value kept beside the new
// one so any reader can see exactly what moved and why.
//
// Input verdicts: [{ cell, run, arm, rep, verdict: FULL|NO|UNSTABLE|NO-TEST-EVIDENCE,
//                    nFull, nRuns, survivingFailures[] }]
// `verdict` is the MAJORITY over repeated grading runs; UNSTABLE means the repeats disagreed,
// which is not a solve and not a failure — it is an unusable cell, and it is recorded as such
// rather than rounded to whichever side is convenient.
//
// Usage: node apply-regrade.mjs <verdicts.json> --task <instance_id> --run <results/<run>>
//          [--rows rows.json] [--out rows-regraded.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const VERDICTS = args.find(a => !a.startsWith('--'));
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const TASK = arg('task');
const RUN = arg('run');
if (!VERDICTS || !TASK || !RUN) {
  console.error('usage: apply-regrade.mjs <verdicts.json> --task <id> --run <results/<run>> [--rows f] [--out f]');
  process.exit(2);
}
const ROWS_IN = path.isAbsolute(arg('rows', '')) ? arg('rows') : path.join(RUN, arg('rows', 'rows.json'));
const OUT = path.isAbsolute(arg('out', '')) ? arg('out') : path.join(RUN, arg('out', 'rows-regraded.json'));

const verdicts = JSON.parse(readFileSync(VERDICTS, 'utf8'));
const rows = JSON.parse(readFileSync(ROWS_IN, 'utf8'));
const runId = path.basename(RUN);
const byCell = new Map(verdicts.filter(v => v.run === runId).map(v => [`${v.arm}|${v.rep}`, v]));
if (!byCell.size) { console.error(`no verdicts for run ${runId} in ${VERDICTS}`); process.exit(3); }

let changed = 0;
for (const r of rows) {
  if (r.taskId !== TASK) continue;
  const v = byCell.get(`${r.arm}|${r.rep}`);
  if (!v) { console.error(`  no verdict for ${r.arm}/r${r.rep} — left untouched`); continue; }
  r.regradedAt = '2026-08-12';
  r.regradeVerdict = v.verdict;
  r.regradeFullRuns = `${v.nFull}/${v.nRuns}`;
  r.regradeSurvivingFailures = v.survivingFailures || [];
  // Keep the pre-repair values under explicit names. The published zeros were produced by a
  // grader that never ran a test, so they are not a prior measurement to average against —
  // they are retained only so the correction is auditable.
  r.preRegradeGradeable = r.gradeable ?? null;
  r.preRegradeResolved = r.resolved ?? null;
  r.preRegradeF2pFrac = r.f2pFrac ?? null;
  if (v.verdict === 'FULL' || v.verdict === 'NO') {
    r.gradeable = true;
    r.noTestEvidence = false;
    r.resolved = v.verdict === 'FULL';
    r.f2pFrac = v.f2pFrac ?? (v.verdict === 'FULL' ? 1 : (v.f2pFracObserved ?? null));
    r.resolveStatus = v.verdict;
  } else {
    // UNSTABLE or no evidence: the cell cannot carry a solve claim in either direction.
    r.gradeable = false;
    r.resolved = null;
    r.f2pFrac = null;
    r.resolveStatus = v.verdict;
    r.noTestEvidence = v.verdict === 'NO-TEST-EVIDENCE';
  }
  changed++;
}
writeFileSync(OUT, JSON.stringify(rows, null, 2));
console.log(`[apply-regrade] ${runId}: restated ${changed} ${TASK} row(s) -> ${OUT}`);
for (const r of rows.filter(x => x.taskId === TASK)) {
  console.log(`   ${r.arm}/r${r.rep}: resolved ${r.preRegradeResolved} -> ${r.resolved}   (${r.resolveStatus}, ${r.regradeFullRuns} full)`);
}
