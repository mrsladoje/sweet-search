#!/usr/bin/env node
// $0 VACUITY PRE-SCREEN — find tasks whose FAIL_TO_PASS list was harvested from a run in
// which those tests ALREADY PASSED.
//
// WHY. A vacuous task grades "resolved" for a rollout that did nothing, so it cannot detect
// a regression. `SLATE-A-RESIDUE-RESULTS.md` §7.6 found 2 of 17 rotation tasks vacuous and
// 2 of 5 CONTROL tasks — a control set defined as "always solves in both arms" is close to a
// filter FOR tasks that cannot fail, and concentrates them 2.9x. That section asked for a
// free check. A null arm is free of model spend but still costs a container per task; this
// costs nothing at all and needs no repository.
//
// THE SIGNAL. A FAIL_TO_PASS entry is supposed to name a test that FAILS at base. When the
// harvesting run was green, the captured string carries the runner's own success marker
// straight into the task record:
//
//   redboltz__mqtt_cpp-466  "10/25 Test #10: pubsub ......  Passed    0.68 sec"   <- ctest
//   statamic__cms-9029      "it runs without hooks (3 ms)"                        <- jest
//
// CALIBRATION. On the 17-task rotation, where a null arm established the ground truth
// independently, this recovers BOTH known vacuous tasks and raises ZERO false alarms.
//
// LIMITS, STATED. Two positives is a small calibration set, and the detector can only see
// vacuity that arose this way — a task vacuous for some other reason will not be flagged and
// this data cannot bound how often that happens. So: use it to ORDER a null-arm sweep and to
// veto a candidate control outright. The null arm stays the authority.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const MARKERS = [
  [/\bPassed\b/, 'ctest "Passed"'],
  [/\bPASS\b/, 'jest/tap "PASS"'],
  [/\bok\s+\d+/, 'TAP "ok N"'],
  [/✓|✔/, 'check mark'],
  [/\(\d+(?:\.\d+)?\s*m?s\)/, 'timing "(N ms)"'],
];

function scan(file) {
  const tasks = JSON.parse(readFileSync(file, 'utf8'));
  const out = [];
  for (const t of tasks) {
    const raw = t.FAIL_TO_PASS;
    let arr = [];
    try { arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]'); } catch { arr = []; }
    const hits = new Set();
    for (const e of arr) for (const [re, name] of MARKERS) if (re.test(String(e))) hits.add(name);
    out.push({ id: t.instance_id, n: arr.length, hits: [...hits], flagged: hits.size > 0 });
  }
  return out;
}

const CACHE = '/root/sweet-search-private/eval/task-completion-bench/select/.cache';
// HO2 is FROZEN. It is scanned for a COUNT only — no instance ids, no test strings, nothing
// per-task — because a vacuous task in a held-out set silently inflates both arms and that is
// a validity fact worth having, while the identities are not ours to look at.
const POOLS = [
  ['rotation (calibration)', `${CACHE}/tasks_full_luna_rotate20.json`, 'full'],
  ['multilingual', `${CACHE}/tasks_full_multilingual.json`, 'full'],
  ['heldout -> DEV-RET', `${CACHE}/tasks_full_heldout.json`, 'full'],
  ['heldout reserve', `${CACHE}/tasks_full_heldout_reserve.json`, 'full'],
  ['heldout2 reserve', `${CACHE}/tasks_full_heldout2_reserve.json`, 'full'],
  ['HO2 (FROZEN)', `${CACHE}/tasks_full_heldout2.json`, 'count-only'],
];

for (const [label, file, mode] of POOLS) {
  if (!existsSync(file)) { console.log(`\n=== ${label}: file absent, skipped`); continue; }
  const rows = scan(file);
  const flagged = rows.filter(r => r.flagged);
  const pct = rows.length ? (100 * flagged.length / rows.length).toFixed(1) : '0.0';
  console.log(`\n=== ${label}  —  ${flagged.length}/${rows.length} flagged (${pct}%)`);
  if (mode === 'count-only') { console.log('    aggregate only by held-out discipline; instance ids deliberately not printed'); continue; }
  for (const r of flagged) console.log(`    ${r.id.padEnd(46)} F2P=${String(r.n).padStart(3)}  ${r.hits.join(', ')}`);
  if (!flagged.length) console.log('    none');
}
