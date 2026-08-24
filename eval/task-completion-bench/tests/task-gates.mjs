// Unit tests for the SELECTION-TIME TASK-REJECTION GATE. PLAN.md gate 3' —
// "task preflight gates".
//
// Two halves, one entry point (`node tests/task-gates.mjs`, exit 1 on fail):
//   1. select/task_gates.py  — the gate itself (run via its own --self-test)
//   2. harness/task-gates.mjs — run-pilot's defense-in-depth preflight WARN
// Both read thresholds from select/task-gates.json; the cross-language agreement
// assertions below are what keep that single-source claim honest.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATE_CONFIG_PATH, REASON_F2P_TOO_MANY, REASON_P2P_EMPTY, REASON_NAME_LOCKED,
  auditTaskSet, gateViolations, loadGateConfig, taskCounts, warnOnGateViolations,
  nameLockCensusOf, reportNameLockCensus,
} from '../harness/task-gates.mjs';
import { nameLockFor, NOISE } from '../select/name-lock.mjs';
import { mkdirSync } from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY_GATE = path.resolve(HERE, '../select/task_gates.py');

let ok = true;
const assert = (c, name, extra = '') => {
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra));
  if (!c) ok = false;
};

console.log('python gate (select/task_gates.py --self-test):');
{
  let out = '';
  let failed = false;
  try {
    out = execFileSync(process.env.PYTHON || 'python3', [PY_GATE, '--self-test'],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  } catch (e) { out = String(e.stdout || e.message); failed = true; }
  for (const line of out.trim().split('\n')) console.log('  | ' + line);
  assert(!failed && /ALL PASS/.test(out), 'python self-test passes');
}

console.log('\nthreshold single-sourcing:');
const config = loadGateConfig();
{
  assert(config !== null, `harness reads ${path.basename(GATE_CONFIG_PATH)}`);
  const py = JSON.parse(execFileSync(process.env.PYTHON || 'python3', [PY_GATE],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
  assert(py.max_fail_to_pass === config.maxFailToPass && py.min_pass_to_pass === config.minPassToPass,
    'python and JS load the IDENTICAL thresholds', `${JSON.stringify(py)} vs ${JSON.stringify(config)}`);
  assert(config.maxFailToPass === 100 && config.minPassToPass === 1,
    'thresholds are F2P<100 and P2P>=1', JSON.stringify(config));
}

console.log('\ncount extraction:');
{
  assert(taskCounts({ FAIL_TO_PASS: ['a', 'b'], PASS_TO_PASS: ['c'] }).f2p === 2, 'reads list lengths');
  assert(taskCounts({ n_fail_to_pass: 7, n_pass_to_pass: 3 }).p2p === 3, 'reads slim n_* fields');
  assert(taskCounts({}).f2p === 0 && taskCounts({}).p2p === 0, 'missing fields → 0/0');
  assert(taskCounts(null).f2p === 0, 'a null spec does not throw');
}

console.log('\nviolations (the motivating cases from PLAN.md §1.3):');
{
  const v = (f2p, p2p) => gateViolations({ FAIL_TO_PASS: Array(f2p).fill('t'), PASS_TO_PASS: Array(p2p).fill('u') })
    .map(x => x.code);
  assert(v(10, 12).length === 0, 'a healthy task (F2P=10, P2P=12) passes');
  assert(v(495, 952).join() === REASON_F2P_TOO_MANY, 'spectreconsole-1942 (F2P=495) → F2P violation');
  assert(v(293, 2171).join() === REASON_F2P_TOO_MANY, 'firefly-716 (F2P=293) → F2P violation');
  assert(v(21, 0).join() === REASON_P2P_EMPTY, 'btcpayserver-6251 (F2P=21, P2P=0) → P2P violation');
  assert(v(569, 0).join() === `${REASON_F2P_TOO_MANY},${REASON_P2P_EMPTY}`, 'both rules can fire at once');
  assert(v(33, 11).length === 0, 'jupytext-360 (F2P=33) is deliberately NOT caught');
  assert(v(100, 5).join() === REASON_F2P_TOO_MANY, 'the F2P boundary is >=, not >');
  assert(v(99, 5).length === 0, 'F2P=99 is kept');
  assert(v(1, 1).length === 0, 'P2P=1 is kept');
}

console.log('\nset audit + preflight WARN:');
{
  const specs = [
    { instance_id: 'ok-1', FAIL_TO_PASS: ['a'], PASS_TO_PASS: ['b'] },
    { instance_id: 'spectreconsole__spectre.console-1942', FAIL_TO_PASS: Array(495).fill('t'), PASS_TO_PASS: Array(952).fill('u') },
    { instance_id: 'btcpayserver__btcpayserver-6251', FAIL_TO_PASS: Array(21).fill('t'), PASS_TO_PASS: [] },
  ];
  const rows = auditTaskSet(specs);
  assert(rows.length === 2 && rows.every(r => r.instance_id !== 'ok-1'), 'audit flags only violators', `${rows.length}`);

  const lines = [];
  const warned = warnOnGateViolations(specs, { log: l => lines.push(l) });
  assert(warned.length === 2, 'warn returns the audit rows');
  assert(lines.some(l => /WARNING/.test(l) && /2\/3/.test(l)), 'header names the violating count', lines[0]);
  assert(lines.some(l => l.includes('spectreconsole__spectre.console-1942') && l.includes('FAIL_TO_PASS=495')),
    'each violator is named with its counts');
  // The whole point of WARN-not-refuse: old sets predate the gate.
  assert(warnOnGateViolations(specs, { log: () => {} }) !== undefined, 'warn never throws');
  assert(warnOnGateViolations([{ instance_id: 'ok', FAIL_TO_PASS: ['a'], PASS_TO_PASS: ['b'] }],
    { log: l => { throw new Error(`unexpected log: ${l}`); } }).length === 0, 'a clean set logs NOTHING');
}

console.log('\nunreadable config degrades safely:');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'task-gates-'));
  const bad = path.join(dir, 'task-gates.json');
  writeFileSync(bad, '{ not json');
  assert(loadGateConfig(bad) === null, 'malformed config → null');
  assert(loadGateConfig(path.join(dir, 'missing.json')) === null, 'missing config → null');
  writeFileSync(bad, JSON.stringify({ max_fail_to_pass: 'x', min_pass_to_pass: 1 }));
  assert(loadGateConfig(bad) === null, 'non-numeric threshold → null (never a silent 0)');
  const lines = [];
  const rows = warnOnGateViolations([{ instance_id: 'z', FAIL_TO_PASS: Array(999).fill('t'), PASS_TO_PASS: [] }],
    { log: l => lines.push(l), config: null });
  assert(rows.length === 0 && lines.length === 1 && /SKIPPED/.test(lines[0]),
    'no config → one warning, check skipped, run not blocked', lines.join('|'));
  assert(gateViolations({ FAIL_TO_PASS: Array(999).fill('t') }, null).length === 0,
    'gateViolations with no config returns [] rather than throwing');
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nname-lock: the rule');
{
  // A materialized "base tree" with a small vocabulary, so "invented" is decidable here.
  const base = mkdtempSync(path.join(tmpdir(), 'name-lock-base-'));
  mkdirSync(path.join(base, 'src'), { recursive: true });
  writeFileSync(path.join(base, 'src', 'readFile.ts'), 'export function readFile(p) { return p; }\n');

  const locked = nameLockFor({
    problem_statement: 'The library should be able to tell whether a path is a file.',
    patch: 'diff --git a/src/isFile.ts b/src/isFile.ts\n+export function isFile(p) { return true; }\n',
    test_patch: 'diff --git a/src/isFile.test.ts b/src/isFile.test.ts\n+import { isFile } from "./isFile.js";\n+expect(isFile("x")).toBe(true);\n',
  }, base);
  assert(locked.nameLocked, 'an identifier the test needs, the fix invents and the base never mentions IS a lock');
  assert(locked.locked.includes('isFile'), 'the locking identifier is named', JSON.stringify(locked.locked));
  assert(locked.relImports.includes('./isFile.js'),
    'a relative module import is reported — the FILE name is locked too, a stronger lock than a symbol');

  // The clause that separates a real lock from a spelled-out request. gradethis-161 solves
  // 2/2 everywhere and still shows an invented identifier, because the issue hands it over.
  const spelledOut = nameLockFor({
    problem_statement: 'Please add an `isFile` helper that returns true for regular files.',
    patch: 'diff --git a/src/isFile.ts b/src/isFile.ts\n+export function isFile(p) { return true; }\n',
    test_patch: 'diff --git a/src/isFile.test.ts b/src/isFile.test.ts\n+import { isFile } from "./isFile.js";\n',
  }, base);
  assert(!spelledOut.nameLocked, 'an identifier the ISSUE spells out is not a lock');

  const alreadyThere = nameLockFor({
    problem_statement: 'fix the reader',
    patch: 'diff --git a/src/readFile.ts b/src/readFile.ts\n+export function readFile(p) { return p + 1; }\n',
    test_patch: 'diff --git a/t.ts b/t.ts\n+expect(readFile("x")).toBe("x1");\n',
  }, base);
  assert(!alreadyThere.nameLocked, 'an identifier the base tree already contains is not invented');

  const plainWord = nameLockFor({
    problem_statement: 'trailing commas should be rejected',
    patch: 'diff --git a/a.ts b/a.ts\n+const comma = 1;\n',
    test_patch: 'diff --git a/b.ts b/b.ts\n+expect(comma).toBe(1);\n',
  }, base);
  assert(!plainWord.nameLocked, 'a one-word English noun is not an API name');
  assert(NOISE.has('describe') && NOISE.has('expect'),
    'test-framework vocabulary is noise — without it every task would look locked');
  rmSync(base, { recursive: true, force: true });
}

console.log('\nname-lock: the gate reads the STAMP, never a base tree');
{
  const cfg = loadGateConfig();
  assert(cfg && cfg.rejectNameLocked === true, 'reject_name_locked is on in task-gates.json');
  const healthy = { instance_id: 'a', FAIL_TO_PASS: ['t'], PASS_TO_PASS: ['u'] };
  assert(gateViolations(healthy).length === 0,
    'an UNSTAMPED record is NOT rejected — absent means not-yet-measured, and treating it as clean is the error this avoids');
  assert(gateViolations({ ...healthy, name_locked: false }).length === 0, 'a stamped-clean record passes');
  const v = gateViolations({ ...healthy, name_locked: true, name_locked_identifiers: ['isFile'] });
  assert(v.length === 1 && v[0].code === REASON_NAME_LOCKED, 'a stamped-locked record is rejected');
  assert(/isFile/.test(v[0].detail), 'the rejection names the identifier that locks it');
}

console.log('\nname-lock: the reported statistic');
{
  const set = [
    { instance_id: 'a', name_locked: false },
    { instance_id: 'b', name_locked: true },
    { instance_id: 'c' },
  ];
  const c = nameLockCensusOf(set);
  assert(c.total === 3 && c.stamped === 2 && c.unstamped === 1 && c.locked === 1,
    'stamped, unstamped and locked are counted separately', JSON.stringify(c));
  assert(c.lockedIds.join() === 'b', 'the locked task is named');
  const lines = [];
  reportNameLockCensus(set, { log: l => lines.push(l) });
  assert(lines.length === 1 && /1\/2/.test(lines[0]) && /1 unstamped/.test(lines[0]),
    'the census line reports the rate over STAMPED tasks and says how many are unmeasured', lines.join('|'));
  const none = [];
  reportNameLockCensus([{ instance_id: 'x' }], { log: l => none.push(l) });
  assert(none.length === 1 && /UNSTAMPED/.test(none[0]) && /never clean/.test(none[0]),
    'a wholly unstamped set says so rather than reporting 0%', none.join('|'));
}

console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
