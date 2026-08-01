#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import {
  RETIRED_START_MS,
  TURNFIX_OUTPUTS,
  largestRemainder,
  materializeTurnfixCohorts,
  retiredTurnsFromSnapshot,
} from '../select/materialize_turnfix_cohorts.mjs';

const SCRIPT = path.resolve('eval/task-completion-bench/select/materialize_turnfix_cohorts.mjs');
const LANGUAGES = ['go', 'js', 'python', 'rust'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function fixtures() {
  const tasks = Array.from({ length: 200 }, (_, index) => ({
    instance_id: `fixture__task-${String(index).padStart(3, '0')}`,
    repo: `fixture/repo-${index % 8}`,
    language: LANGUAGES[index % LANGUAGES.length],
    base_commit: `commit-${index}`,
  }));
  const historyRows = tasks.map((task, index) => ({
    taskId: task.instance_id,
    nativeTurns: index + 1,
    sweetTurns: index + 2,
    ...(index === 199 ? { nativeValid: false } : {}),
  }));
  const ledgerRows = tasks.map((task) => ({
    instance_id: task.instance_id, status: 'gold-valid', configHash: `hash-${task.instance_id}`,
  }));
  return { tasks, historyRows, ledgerRows };
}

test('Hamilton allocation is exact and has an alphabetical remainder tie-break', () => {
  assert.deepEqual(largestRemainder({ rust: 10, go: 10, js: 10, python: 10 }, 6),
    { go: 2, js: 2, python: 1, rust: 1 });
  assert.deepEqual(largestRemainder({ tail: 40, non_tail: 160, unknown: 0 }, 28),
    { non_tail: 22, tail: 6, unknown: 0 });
  assert.throws(() => largestRemainder({ go: 1 }, 2), /cannot allocate/);
});

test('freezes deterministic disjoint DISCOVERY-20, CONFIRM-28, and next EXPAND-32 cohorts', () => {
  const input = fixtures();
  const first = materializeTurnfixCohorts(input);
  const second = materializeTurnfixCohorts({
    tasks: [...input.tasks].reverse(),
    historyRows: [...input.historyRows].reverse(),
    ledgerRows: [...input.ledgerRows].reverse(),
  });

  assert.deepEqual(first.manifest.stratumCounts, { tail: 40, non_tail: 160, unknown: 0 });
  assert.deepEqual(first.manifest.cohorts.discovery.targets, { tail: 10, non_tail: 10, unknown: 0 });
  assert.deepEqual(first.manifest.cohorts.confirm.targets, { tail: 6, non_tail: 22, unknown: 0 });
  assert.deepEqual(first.manifest.cohorts.expand.targets, { tail: 6, non_tail: 26, unknown: 0 });
  assert.equal(first.manifest.cohorts.expand.execute, false);
  assert.equal(first.manifest.outcomesObserved, false);

  const discovery = new Set(first.manifest.cohorts.discovery.ids);
  const confirm = new Set(first.manifest.cohorts.confirm.ids);
  const expand = new Set(first.manifest.cohorts.expand.ids);
  assert.equal(discovery.size, 20);
  assert.equal(confirm.size, 28);
  assert.equal(expand.size, 32);
  assert.equal([...discovery].filter((id) => confirm.has(id) || expand.has(id)).length, 0);
  assert.equal([...confirm].filter((id) => expand.has(id)).length, 0);
  assert.equal(new Set([...confirm, ...expand]).size, 60);
  assert.ok(first.manifest.historicalTail.ids.includes('fixture__task-199'),
    'one invalid historical arm still uses the valid arm for tail ranking');

  for (const stage of ['discovery', 'confirm', 'expand']) {
    assert.equal(first.files[stage].sha256, sha256(first.files[stage].content));
    assert.equal(first.files[stage].sha256, second.files[stage].sha256);
    assert.deepEqual(first.manifest.cohorts[stage].ids, second.manifest.cohorts[stage].ids);
  }
});

test('last ledger verdict wins; every non-green candidate is replaced and recorded', () => {
  const input = fixtures();
  const baseline = materializeTurnfixCohorts(input);
  const badSameCell = baseline.manifest.cohorts.discovery.ids
    .map((id) => input.tasks.find((task) => task.instance_id === id))
    .find((task) => task.language === 'js').instance_id;
  const nonGreen = input.tasks.filter((task) => task.language === 'go').map((task) => task.instance_id);
  const ledgerRows = [...input.ledgerRows,
    ...nonGreen.map((instance_id) => ({ instance_id, status: 'env-broken-nonnet', configHash: 'stale' })),
    { instance_id: badSameCell, status: 'gold-valid', configHash: 'superseded-green' },
    { instance_id: badSameCell, status: 'needs-warming', configHash: 'latest-non-green' },
  ];
  const result = materializeTurnfixCohorts({ ...input, ledgerRows });
  const chosen = Object.values(result.manifest.cohorts).flatMap(({ ids }) => ids);
  assert.ok(chosen.every((id) => !nonGreen.includes(id) && id !== badSameCell));
  assert.ok(result.manifest.audit.fallbacks.length > 0);
  const excluded = new Set(result.manifest.audit.exclusions.map(({ id }) => id));
  const replaced = new Set(result.manifest.audit.replacements.map(({ rejectedId }) => rejectedId));
  assert.deepEqual(replaced, excluded, 'no encountered non-green exclusion is silent');
  assert.ok(excluded.has(badSameCell));
  assert.ok(nonGreen.every((id) => excluded.has(id)));
  assert.equal(result.manifest.goldLedger.nonGreenOrMissing, nonGreen.length + 1);
});

test('both-invalid historical arms remain an explicit unknown stratum', () => {
  const input = fixtures();
  input.historyRows[0] = {
    taskId: input.tasks[0].instance_id,
    nativeTurns: null, sweetTurns: null, nativeValid: false, sweetValid: false,
  };
  const result = materializeTurnfixCohorts(input);
  assert.equal(result.manifest.stratumCounts.unknown, 1);
  assert.equal(result.manifest.cohorts.discovery.targets.unknown, 0);
  assert.equal(result.manifest.cohorts.confirm.targets.unknown, 0);
  assert.equal(result.manifest.cohorts.expand.targets.unknown, 0);
  assert.equal(result.manifest.stratumWeights.unknown, 1 / 200);
});

test('read-only DB extraction mirrors the retired longest-assistant-session rule', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'turnfix-db-'));
  try {
    const dbPath = path.join(dir, 'snapshot.db');
    const db = new Database(dbPath);
    db.exec('create table session (id text primary key, directory text, time_created integer); create table message (id text primary key, session_id text, data text)');
    const session = db.prepare('insert into session values (?, ?, ?)');
    const message = db.prepare('insert into message values (?, ?, ?)');
    const id = fixtures().tasks[0].instance_id;
    session.run('short', `/tmp/runs/${id}__native__r0__1`, RETIRED_START_MS + 1);
    session.run('long', `/tmp/runs/${id}__native__r0__2`, RETIRED_START_MS + 2);
    session.run('sweet', `/tmp/runs/${id}__sweet__r0__3`, RETIRED_START_MS + 3);
    session.run('late', `/tmp/runs/${id}__sweet__r0__4`, RETIRED_START_MS - 1);
    message.run('m1', 'short', '{"role":"assistant"}');
    for (let index = 0; index < 3; index++) message.run(`m2-${index}`, 'long', '{"role": "assistant"}');
    message.run('m3', 'sweet', '{"role":"assistant"}');
    message.run('m4', 'sweet', '{"role":"user"}');
    message.run('m5', 'late', '{"role":"assistant"}');
    db.close();

    const rows = retiredTurnsFromSnapshot(dbPath, fixtures().tasks);
    assert.equal(rows.length, 400);
    assert.deepEqual(rows.find((row) => row.taskId === id && row.arm === 'native'),
      { taskId: id, arm: 'native', turns: 3, valid: true, sessionId: 'long' });
    assert.deepEqual(rows.find((row) => row.taskId === id && row.arm === 'sweet'),
      { taskId: id, arm: 'sweet', turns: 1, valid: true, sessionId: 'sweet' });
    assert.equal(rows.find((row) => row.taskId === fixtures().tasks[1].instance_id && row.arm === 'native').valid, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI writes exact cohort files and records their byte hashes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'turnfix-cli-'));
  try {
    const input = fixtures();
    const tasks = path.join(dir, 'tasks.jsonl');
    const history = path.join(dir, 'history.json');
    const ledger = path.join(dir, 'ledger.jsonl');
    const out = path.join(dir, 'out');
    writeFileSync(tasks, `${input.tasks.map((row) => JSON.stringify(row)).join('\n')}\n`);
    writeFileSync(history, JSON.stringify(input.historyRows));
    writeFileSync(ledger, `${input.ledgerRows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    const run = spawnSync(process.execPath, [SCRIPT, '--tasks', tasks, '--history', history,
      '--ledger', ledger, '--out-dir', out, '--materialize'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.deepEqual(readdirSync(out).sort(), Object.values(TURNFIX_OUTPUTS).sort());
    const manifest = JSON.parse(readFileSync(path.join(out, TURNFIX_OUTPUTS.manifest), 'utf8'));
    for (const stage of ['discovery', 'confirm', 'expand']) {
      const content = readFileSync(path.join(out, TURNFIX_OUTPUTS[stage]));
      assert.equal(manifest.cohorts[stage].sha256, sha256(content));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
