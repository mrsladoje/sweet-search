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
  GATE_CONFIG_PATH, REASON_F2P_TOO_MANY, REASON_P2P_EMPTY,
  auditTaskSet, gateViolations, loadGateConfig, taskCounts, warnOnGateViolations,
} from '../harness/task-gates.mjs';

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

console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
