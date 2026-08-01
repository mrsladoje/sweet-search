import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  authorize, executionTaskFiles, expectedCell, isExactRunPilotCommand, pilotEnv, stageId,
} from '../harness/turnfix-overnight-orchestrator.mjs';
import { loadTaskFile } from '../harness/task-file-loader.mjs';

const safe = {
  SS_TURNFIX_EXECUTE: '1', CONCURRENCY: '1',
  SS_SPEND_GUARD_SESSION: '00000000-0000-0000-0000-000000000000',
  OPENROUTER_API_KEY: 'fixture-only', RUN_ID: 'turnfix-overnight-fixture',
  SS_TURNFIX_EXPECT_NATIVE_SHA256: 'a'.repeat(64), ENV_LEDGER: '/tmp/devret-ledger.jsonl',
};
assert.equal(authorize(safe).runId, safe.RUN_ID);
for (const mutation of [
  { SS_TURNFIX_EXECUTE: '0' }, { CONCURRENCY: '2' }, { SS_SPEND_GUARD_SESSION: '' },
  { OPENROUTER_API_KEY: '' }, { RUN_ID: 'turnfix-ho2' },
  { SS_TURNFIX_EXPECT_NATIVE_SHA256: 'bad' }, { ENV_LEDGER: '/tmp/heldout2-ledger.jsonl' },
]) assert.throws(() => authorize({ ...safe, ...mutation }));

const base = pilotEnv({
  runId: 'turnfix-d20', tasksPath: '/repo/tasks_turnfix_discovery20.jsonl',
  arm: 'sweet', ledgerPath: '/tmp/devret-ledger.jsonl', packing: 'ss-batch', preflight: true,
});
assert.equal(base.CONCURRENCY, '1');
assert.equal(base.ARMS, 'sweet');
assert.equal(base.SS_RT_PROGRESS, '1');
assert.equal(base.SS_PACKING_TREATMENT, 'ss-batch');
assert.equal(base.PREFLIGHT_ONLY, '1');
assert.equal(base.SS_RT_ADVISORY, undefined);
const t1 = pilotEnv({
  runId: 'turnfix-t1', tasksPath: '/repo/tasks_turnfix_discovery20.jsonl',
  arm: 'native', ledgerPath: '/tmp/devret-ledger.jsonl', advisoryH: 3,
});
assert.equal(t1.SS_RT_ADVISORY, '1');
assert.equal(t1.SS_RT_H, '3');
const frozenCell = expectedCell({ arm: 'sweet', packing: 'ss-batch', advisoryH: 3 });
assert.equal(frozenCell.packingTreatment, 'ss-batch');
assert.equal(frozenCell.rtProgressTelemetry, true);
assert.equal(frozenCell.rtProgressAdvisory, true);
assert.equal(frozenCell.rtProgressH, 3);
assert.match(frozenCell.packingInstructionSha256, /^[a-f0-9]{64}$/);
assert.match(frozenCell.rtProgressPolicyHash, /^[a-f0-9]{64}$/);
assert.equal(stageId('turnfix-overnight', 'c28-native'), 'turnfix-overnight-c28-native');
assert.throws(() => stageId('turnfix-overnight', 'expand32'));
assert.throws(() => stageId('turnfix-overnight', 'ho2'));
assert.equal(isExactRunPilotCommand('/usr/bin/node\0/root/bench/run-pilot.mjs\0'), true);
assert.equal(isExactRunPilotCommand('/usr/bin/tmux\0new-session\0bash -lc "node /root/bench/run-pilot.mjs"\0'), false);
assert.equal(isExactRunPilotCommand('/usr/bin/node\0-e\0"run-pilot.mjs"\0'), false);
assert.equal(isExactRunPilotCommand('/usr/bin/node\0/root/bench/not-run-pilot.mjs\0'), false);

const taskFixture = mkdtempSync(path.join(tmpdir(), 'turnfix-task-files-'));
try {
  const full = row => ({
    ...row, problem_statement: 'fixture', workdir: '/repo', patch: '', test_patch: '',
    install_config: {},
  });
  const discovery = loadTaskFile(new URL('../select/tasks_turnfix_discovery20.jsonl', import.meta.url));
  const confirm = loadTaskFile(new URL('../select/tasks_turnfix_confirm28.jsonl', import.meta.url));
  writeFileSync(path.join(taskFixture, 'tasks-discovery20-full.json'), `${JSON.stringify(discovery.map(full))}\n`);
  writeFileSync(path.join(taskFixture, 'tasks-confirm28-full.json'), `${JSON.stringify(confirm.map(full))}\n`);
  const files = executionTaskFiles(path.join(taskFixture, 'ledger.jsonl'));
  assert.equal(files.discovery.n, 20);
  assert.equal(files.confirm.n, 28);
  assert.match(files.discovery.sha256, /^[a-f0-9]{64}$/);
  writeFileSync(path.join(taskFixture, 'tasks-discovery20-full.json'), `${JSON.stringify(discovery.toReversed().map(full))}\n`);
  assert.throws(() => executionTaskFiles(path.join(taskFixture, 'ledger.jsonl')));
} finally {
  rmSync(taskFixture, { recursive: true, force: true });
}

const source = readFileSync(new URL('../harness/turnfix-overnight-orchestrator.mjs', import.meta.url), 'utf8');
assert.equal(source.includes('tasks_turnfix_expand32'), false);
assert.equal(source.includes('select/tasks_heldout2'), false);
assert.equal(source.includes('CONCURRENCY: \'2\''), false);

console.log('turnfix-overnight-orchestrator: all assertions passed');
