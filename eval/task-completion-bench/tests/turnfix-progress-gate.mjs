import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  evaluateAdvisoryBehavior, selectFreshProgressThreshold,
} from '../stats/turnfix-progress-gate.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'turnfix-progress-gate-'));
const fold = task => Number.parseInt(createHash('sha256')
  .update(`turnfix-live-progress-v1\0${task}`).digest('hex').slice(0, 8), 16) % 5;
const byFold = Array.from({ length: 5 }, () => []);
for (let index = 1; byFold.some(rows => rows.length < 2); index++) {
  const task = `repo__progress-${index}`;
  if (byFold[fold(task)].length < 2) byFold[fold(task)].push(task);
}
const tasks = byFold.flat();
const cohortPath = path.join(root, 'discovery.jsonl');
writeFileSync(cohortPath, `${tasks.map(instance_id => JSON.stringify({ instance_id })).join('\n')}\n`);

function makeDb(file) {
  execFileSync('python3', ['-c', `
import json, sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text)")
for i in range(2):
    data = {"type":"tool","tool":"bash","state":{"input":{"command":f"ss-grep symbol_{i}"}}}
    c.execute("insert into part values (?,?,?,?,?,?)", (f"p{i}", f"m{i}", "s1", i, i, json.dumps(data)))
c.commit(); c.close()
`, file]);
}

function controllerLog({ task, arm, advisory, h, totalTurns, logPath }) {
  const policyHash = createHash('sha256').update(advisory ? `policy-on-${h}` : 'policy-off').digest('hex');
  const sessionId = `${task}-${arm}-session`;
  const rows = [{
    kind: 'session', schema: 1, version: 'rt-progress-v1', policyHash, sessionId,
    task, arm, run: 'fixture', flags: { telemetry: true, advisory, h: advisory ? h : null },
  }];
  for (let call = 1; call <= 5; call++) {
    const triggerCount = Math.max(0, call - 1);
    rows.push({
      kind: 'invocation', schema: 1, version: 'rt-progress-v1', policyHash,
      sessionId, task, arm, call, executed: true, trustworthy: true, status: 'FAIL',
      triggerCount, issuePass: false,
      advisory: advisory && triggerCount === h
        ? `recovery.streak-${h}.current-cp.best-cp.allowance-1`
        : (advisory && triggerCount > h ? `restore-submit.streak-${triggerCount}.best-cp` : 'none'),
    });
  }
  rows.push({
    kind: 'model-turn-map', schema: 1, version: 'rt-progress-v1', policyHash,
    sessionId, task, arm, run: 'fixture', source: 'raw-ndjson-posthoc',
    invocationCount: 5, testToolCount: 5, complete: true,
    mappings: Array.from({ length: 5 }, (_, index) => ({
      call: index + 1, modelTurn: index + 1, messageId: `m${index + 1}`,
    })),
  });
  writeFileSync(logPath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
  return policyHash;
}

function makeResult(name, arm, { advisory = false, h = null, totalTurns = 8, action = 'edit' } = {}) {
  const result = path.join(root, name);
  mkdirSync(path.join(result, 'turns'), { recursive: true });
  mkdirSync(path.join(result, 'trajectories'), { recursive: true });
  const rows = [];
  for (const task of tasks) {
    const state = path.join(result, 'agent-state', `${task}-${arm}`);
    const data = path.join(state, 'opencode-data');
    const progress = path.join(state, 'rt-progress');
    mkdirSync(data, { recursive: true }); mkdirSync(progress, { recursive: true });
    makeDb(path.join(data, 'opencode.db'));
    const logPath = path.join(progress, 'cycles.jsonl');
    const policyHash = controllerLog({ task, arm, advisory, h, totalTurns, logPath });
    rows.push({
      taskId: task, arm, rep: 0, resolved: false, gradeable: true, isolated: true,
      escape: 0, leak: 0, goldTripwire: false, shimTampered: false,
      shimReran: false, shimExcluded: false, shimTamperedFiles: [],
      exitReason: 'model_stopped', costRealizedUsd: 1,
      model: 'x-ai/grok-4.5', provider: 'openrouter', harness: 'opencode', reasoning: 'standard',
      envConfigHash: 'a'.repeat(16),
      openCodePreflight: {
        valid: true, version: '1.18.4', pluginCount: 0, resolvedConfigSha256: 'b'.repeat(64),
      },
      secretLeakDetected: false,
      rtProgressVersion: 'rt-progress-v1', rtProgressSchema: 1,
      rtProgressTelemetry: true, rtProgressAdvisory: advisory,
      rtProgressH: advisory ? h : null, rtProgressPolicyHash: policyHash,
      rtProgressLog: logPath, rtProgressTurnMapComplete: true,
      packingTreatment: 'off', packingInstructionSha256: 'c'.repeat(64),
    });
    const turns = [JSON.stringify({ kind: 'meta', task, arm, source: 'stream', turns: totalTurns })];
    for (let turn = 1; turn <= totalTurns; turn++) turns.push(JSON.stringify({ t: turn, in: 100, cached: 0, out: 1 }));
    writeFileSync(path.join(result, 'turns', `${task}-${arm}.jsonl`), `${turns.join('\n')}\n`);
    writeFileSync(path.join(result, 'trajectories', `${task}-${arm}-r0.json`), JSON.stringify({
      taskId: task, arm, trajectory: [
        { call: 1, kind: 'test', input: 'run_tests', modelTurn: 3 },
        {
          call: 2,
          kind: action === 'edit' ? 'edit' : (action === 'recovery' ? 'nativeRead' : 'bash'),
          input: action === 'edit' ? 'edit src/x.js' : (action === 'recovery' ? 'read src/x.js' : 'echo unrelated'),
          modelTurn: 4,
        },
      ],
    }));
  }
  writeFileSync(path.join(result, 'rows.json'), `${JSON.stringify(rows, null, 2)}\n`);
  return result;
}

try {
  const native = makeResult('native-t0', 'native');
  const sweet = makeResult('sweet-t0', 'sweet');
  const selection = selectFreshProgressThreshold({
    nativePath: native, sweetPath: sweet, tasksPath: cohortPath, expected: tasks.length,
  });
  assert.equal(selection.valid, true);
  assert.equal(selection.verdict, 'ELIGIBLE');
  assert.equal(selection.advisoryThreshold, 2);
  assert.deepEqual(selection.selections, [2, 2, 2, 2, 2]);
  assert.equal(selection.enoughExposure, true);

  const treatment = makeResult('sweet-t1', 'sweet', {
    advisory: true, h: 2, totalTurns: 6, action: 'recovery',
  });
  const behavior = evaluateAdvisoryBehavior({
    controlPath: sweet, treatmentPath: treatment, arm: 'sweet',
    tasksPath: cohortPath, expected: tasks.length, h: 2,
  });
  assert.equal(behavior.valid, true);
  assert.equal(behavior.verdict, 'ADVANCE');
  assert.equal(behavior.treatment.goodNextActionRate, 1);
  assert.equal(behavior.treatment.blindEditCycles, 0);
  assert.equal(behavior.control.blindEditCycles, tasks.length);

  for (const task of tasks.slice(0, 3)) {
    const trajectory = path.join(treatment, 'trajectories', `${task}-sweet-r0.json`);
    const value = JSON.parse(readFileSync(trajectory, 'utf8'));
    value.trajectory[1].kind = 'edit'; value.trajectory[1].input = 'edit src/x.js';
    writeFileSync(trajectory, JSON.stringify(value));
  }
  const failed = evaluateAdvisoryBehavior({
    controlPath: sweet, treatmentPath: treatment, arm: 'sweet',
    tasksPath: cohortPath, expected: tasks.length, h: 2,
  });
  assert.equal(failed.verdict, 'DO NOT ADVANCE');

  const unrelated = makeResult('sweet-t1-unrelated', 'sweet', {
    advisory: true, h: 2, totalTurns: 6, action: 'unrelated',
  });
  const unrelatedReport = evaluateAdvisoryBehavior({
    controlPath: sweet, treatmentPath: unrelated, arm: 'sweet',
    tasksPath: cohortPath, expected: tasks.length, h: 2,
  });
  assert.equal(unrelatedReport.treatment.goodNextActionRate, 0);
  assert.equal(unrelatedReport.verdict, 'DO NOT ADVANCE');

  assert.equal(selectFreshProgressThreshold({
    nativePath: native, sweetPath: sweet, tasksPath: 'tasks_turnfix_expand32.jsonl', expected: tasks.length,
  }).valid, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('turnfix-progress-gate: all assertions passed');
