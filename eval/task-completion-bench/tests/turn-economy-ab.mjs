// Tests for the turn-economy A/B adjudicator (stats/turn-economy-ab.mjs).
//
// The adjudicator decides whether a $42 pilot counts as a WIN. Two properties matter
// more than the arithmetic:
//   1. it REFUSES incomplete data instead of quietly deciding on a selected subset;
//   2. the operations gate is actually WIRED — a run that shotguns extra probes must
//      REVERT, not pass because the gate was left "pending".
// Both are asserted below against synthetic fixture runs. Offline, zero spend.
//
// `node tests/turn-economy-ab.mjs` — exit 1 on any failure.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'stats', 'turn-economy-ab.mjs');

let failures = 0, n = 0;
function check(label, cond, extra = '') {
  n++;
  if (!cond) { failures++; console.error(`FAIL ${label}${extra ? '\n  ' + extra : ''}`); }
}

const root = mkdtempSync(path.join(tmpdir(), 'te-ab-'));

/**
 * Build a fixture run. `spec[task] = {turns, ctx, ops, solved, cost, calls}`.
 * Writes rows.json, turn logs, and an agent-state dir whose OpenCode store is a real
 * sqlite db carrying `ops` fused ss-* operations, so the operations gate is exercised
 * end-to-end through probe-count.mjs rather than stubbed.
 */
function makeRun(name, spec) {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, 'turns'), { recursive: true });
  const rows = [];
  for (const [task, s] of Object.entries(spec)) {
    rows.push({
      taskId: task, arm: 'sweet', rep: 0, resolved: !!s.solved,
      calls: s.calls ?? s.ops, idealCostUsd: s.cost ?? 1,
      idealTurns: s.turns, turnsFile: `results/${name}/turns/${task}-sweet.jsonl`,
    });
    const lines = [JSON.stringify({ kind: 'meta', label: `${task}-sweet`, task,
      arm: 'sweet', harness: 'opencode', source: s.source ?? 'stream', turns: s.turns })];
    for (let t = 1; t <= s.turns; t++) {
      // `in` is the FULL context incl. cached; `cached` is a subset of it.
      lines.push(JSON.stringify({ t, in: s.ctx, cached: Math.floor(s.ctx / 2), out: 100 }));
    }
    writeFileSync(path.join(dir, 'turns', `${task}-sweet.jsonl`), lines.join('\n') + '\n');

    if (s.agentState !== false) {
      const as = path.join(dir, 'agent-state', `${task}-sweet`, 'opencode-data');
      mkdirSync(as, { recursive: true });
      // one bash envelope fusing `ops` ss-* operations, so probe-count must split it
      const cmd = Array.from({ length: s.ops }, (_, i) => `ss-grep A${i}`).join('; ');
      execFileSync('python3', ['-c', `
import sqlite3, json, sys
db, cmd = sys.argv[1], sys.argv[2]
c = sqlite3.connect(db)
c.execute("create table part (id text primary key, message_id text, session_id text, "
          "time_created integer, time_updated integer, data text)")
c.execute("insert into part values (?,?,?,?,?,?)", ("p1", "m1", "s1", 0, 0, json.dumps(
    {"type": "tool", "tool": "bash", "state": {"input": {"command": cmd}}})))
c.commit(); c.close()
`, path.join(as, 'opencode.db'), cmd]);
    }
  }
  writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows, null, 1));
  return dir;
}

function run(a, b, expect) {
  try {
    const out = execFileSync('node', [SCRIPT, a, b, '--json', '--expect', String(expect)],
      { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (e) {
    try { return JSON.parse(e.stdout || '{}'); } catch { return { verdict: 'CRASH', stderr: String(e.stderr).slice(0, 300) }; }
  }
}

const T = (i) => `repo__proj-${i}`;
const base = {};
for (let i = 0; i < 4; i++) base[T(i)] = { turns: 100, ctx: 50000, ops: 3, solved: true, cost: 1 };

// ── 1. a clean win ───────────────────────────────────────────────────────────
{
  const variant = {};
  for (let i = 0; i < 4; i++) variant[T(i)] = { turns: 80, ctx: 50000, ops: 3, solved: true, cost: 0.8 };
  const r = run(makeRun('a1', base), makeRun('b1', variant), 4);
  check('clean win → WIN', r.verdict?.startsWith('WIN'), `got: ${r.verdict}`);
  check('win: turns ratio 0.8', Math.abs(r.turnsRatio.point - 0.8) < 1e-9, JSON.stringify(r.turnsRatio));
  check('win: operations gate evaluated', r.operationsRatio && Number.isFinite(r.operationsRatio.point),
    JSON.stringify(r.operationsRatio));
  check('win: no "pending" language', !/pending/i.test(r.verdict || ''), r.verdict);
}

// ── 2. THE gate that must not be pending: turns drop but probes shotgun ──────
{
  const variant = {};
  for (let i = 0; i < 4; i++) variant[T(i)] = { turns: 80, ctx: 50000, ops: 6, solved: true, cost: 0.8 };
  const r = run(makeRun('a2', base), makeRun('b2', variant), 4);
  check('shotgun probes → REVERT', r.verdict === 'REVERT', `got: ${r.verdict}`);
  check('shotgun: operations trigger fired',
    (r.reverts || []).some(x => x.startsWith('operations')), JSON.stringify(r.reverts));
}

// ── 3. ctx/turn blow-up reverts, and `in` is NOT double-counted ──────────────
{
  const variant = {};
  for (let i = 0; i < 4; i++) variant[T(i)] = { turns: 80, ctx: 100000, ops: 3, solved: true, cost: 0.8 };
  const r = run(makeRun('a3', base), makeRun('b3', variant), 4);
  check('ctx blow-up → REVERT', r.verdict === 'REVERT', `got: ${r.verdict}`);
  check('ctx ratio is 2.0 exactly (in only, cached not added)',
    Math.abs(r.ctxPerTurnRatio.point - 2) < 1e-9, JSON.stringify(r.ctxPerTurnRatio));
}

// ── 4. solve tripwire ────────────────────────────────────────────────────────
{
  const variant = {};
  for (let i = 0; i < 4; i++) variant[T(i)] = { turns: 80, ctx: 50000, ops: 3, solved: i >= 3, cost: 0.8 };
  const r = run(makeRun('a4', base), makeRun('b4', variant), 4);
  check('3 solve losses → REVERT', r.verdict === 'REVERT', `got: ${r.verdict}`);
  check('solve trigger fired', (r.reverts || []).some(x => x.startsWith('solve')), JSON.stringify(r.reverts));
}

// ── 5. ADMISSION: incomplete pairing must never get a verdict ────────────────
{
  const partial = {};
  for (let i = 0; i < 3; i++) partial[T(i)] = { turns: 80, ctx: 50000, ops: 3, solved: true, cost: 0.8 };
  const r = run(makeRun('a5', base), makeRun('b5', partial), 4);
  check('missing task → INVALID', /INVALID/.test(r.verdict || ''), `got: ${r.verdict}`);
  check('INVALID names the missing task',
    (r.admissionFailures || []).some(x => x.includes('only in RUN_A')), JSON.stringify(r.admissionFailures));
}
{
  const variant = {};
  for (let i = 0; i < 4; i++) variant[T(i)] = { turns: 80, ctx: 50000, ops: 3, solved: true, cost: 0.8 };
  const r = run(makeRun('a6', base), makeRun('b6', variant), 36);   // expected 36, got 4
  check('wrong task count → INVALID', /INVALID/.test(r.verdict || ''), `got: ${r.verdict}`);
}
{
  const variant = {};
  for (let i = 0; i < 4; i++) {
    variant[T(i)] = { turns: 80, ctx: 50000, ops: 3, solved: true, cost: 0.8,
      agentState: i === 0 ? false : true };   // one rollout with no agent-state
  }
  const r = run(makeRun('a7', base), makeRun('b7', variant), 4);
  check('missing agent-state → INVALID (operations ungateable)',
    /INVALID/.test(r.verdict || ''), `got: ${r.verdict}`);
}
{
  const variant = {};
  for (let i = 0; i < 4; i++) {
    variant[T(i)] = { turns: 80, ctx: 50000, ops: 3, solved: true, cost: 0.8,
      source: i === 0 ? 'aggregate' : 'stream' };
  }
  const r = run(makeRun('a8', base), makeRun('b8', variant), 4);
  check('aggregate turn log → INVALID (not a turn distribution)',
    /INVALID/.test(r.verdict || ''), `got: ${r.verdict}`);
}

// ── 6. below threshold is not a win ──────────────────────────────────────────
{
  const variant = {};
  for (let i = 0; i < 4; i++) variant[T(i)] = { turns: 94, ctx: 50000, ops: 3, solved: true, cost: 0.95 };
  const r = run(makeRun('a9', base), makeRun('b9', variant), 4);
  check('6% drop → NO CHANGE ADOPTED', /NO CHANGE ADOPTED/.test(r.verdict || ''), `got: ${r.verdict}`);
  check('below-threshold wording is non-causal',
    !/dose/i.test(r.verdict || ''), r.verdict);
}

rmSync(root, { recursive: true, force: true });
console.log(`${n - failures}/${n} assertions passed`);
if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
