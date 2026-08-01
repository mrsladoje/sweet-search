// Focused zero-cost fixtures for the natural-screen and confirmation adjudicator.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  TURNFIX_STATS, adjudicateTurnfix, newcombeMethod10, parseTurnfixArgs,
} from '../stats/turnfix-adjudicator.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'turnfix-adjudicator-'));
const tasks = Array.from({ length: 4 }, (_, i) => `repo__project-${i + 1}`);

function makeDb(file, commands) {
  execFileSync('python3', ['-c', `
import json, sqlite3, sys
db, commands = sys.argv[1], json.loads(sys.argv[2])
c = sqlite3.connect(db)
c.execute("create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text)")
for i, command in enumerate(commands):
    data = {"type":"tool","tool":"bash","state":{"input":{"command":command}}}
    c.execute("insert into part values (?,?,?,?,?,?)", (f"p{i}", f"m{i}", "s1", i, i, json.dumps(data)))
c.commit(); c.close()
`, file, JSON.stringify(commands)]);
}

function operationCommands(operations, envelopes) {
  const commands = [];
  let used = 0;
  for (let envelope = 0; envelope < envelopes; envelope++) {
    const count = Math.floor((operations - used) / (envelopes - envelope));
    commands.push(Array.from({ length: count }, (_, i) => `ss-grep symbol_${used + i}`).join('; '));
    used += count;
  }
  return commands;
}

function makeResult(name, arm, perTask) {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, 'turns'), { recursive: true });
  const rows = [];
  for (const task of tasks) {
    const spec = perTask[task];
    rows.push({
      taskId: task,
      arm,
      rep: 0,
      resolved: spec.resolved ?? true,
      gradeable: true,
      isolated: true,
      escape: 0,
      leak: 0,
      goldTripwire: false,
      shimTampered: false,
      shimReran: false,
      shimExcluded: false,
      shimTamperedFiles: [],
      exitReason: 'model_stopped',
      costRealizedUsd: spec.cost,
      calls: 999,
      idealTurns: 999,
    });
    const turnLines = [JSON.stringify({
      kind: 'meta', task, arm, source: spec.source || 'stream', turns: spec.turns,
    })];
    for (let turn = 1; turn <= spec.turns; turn++) {
      turnLines.push(JSON.stringify({ t: turn, in: spec.contextPerTurn, cached: 0, out: 1 }));
    }
    writeFileSync(path.join(dir, 'turns', `${task}-${arm}.jsonl`), `${turnLines.join('\n')}\n`);
    const state = path.join(dir, 'agent-state', `${task}-${arm}`, 'opencode-data');
    mkdirSync(state, { recursive: true });
    makeDb(path.join(state, 'opencode.db'), operationCommands(spec.operations, spec.envelopes));
  }
  writeFileSync(path.join(dir, 'rows.json'), `${JSON.stringify(rows, null, 2)}\n`);
  return dir;
}

function specs({ costScale = 1, turnScale = 1, operations = 4, envelopes = 2 } = {}) {
  return Object.fromEntries(tasks.map((task, i) => [task, {
    cost: (i + 1) * costScale,
    turns: (i + 1) * 10 * turnScale,
    contextPerTurn: 100,
    operations,
    envelopes,
    resolved: true,
  }]));
}

function cloneWithRows(source, name, mutate) {
  const dir = path.join(root, name);
  cpSync(source, dir, { recursive: true });
  const rowsPath = path.join(dir, 'rows.json');
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
  mutate(rows);
  writeFileSync(rowsPath, `${JSON.stringify(rows, null, 2)}\n`);
  return dir;
}

function options(stage, controlPath, treatmentPath, extra = {}) {
  return {
    stage,
    controlPath,
    treatmentPath,
    controlArm: 'native',
    treatmentArm: 'sweet',
    expected: 4,
    retrievalEquivalence: 'pass',
    completionTripwires: 'pass',
    ...extra,
  };
}

try {
  // Newcombe (1998), Table III, method 10: e=36, f=12, g=2, h=0 gives
  // control-treatment [0.0569, 0.3404] at z=1.96. We report the reversed
  // treatment-control orientation, pinned here independently of run fixtures.
  const published = newcombeMethod10({
    both: 36, controlOnly: 12, treatmentOnly: 2, neither: 0,
  }, 1.959963984540054);
  assert.ok(Math.abs(published.lower95 - (-0.3404)) < 0.00005);
  assert.ok(Math.abs(published.upper95 - (-0.0569)) < 0.00005);
  assert.ok(Math.abs(published.point - (-0.2)) < 1e-12);

  const control = makeResult('control', 'native', specs());
  const treatment = makeResult('treatment', 'sweet', specs({
    costScale: 0.8, turnScale: 0.8, operations: 4, envelopes: 1,
  }));

  const natural = adjudicateTurnfix(options('natural', control, treatment));
  assert.equal(natural.valid, true);
  assert.equal(natural.verdict, 'ADVANCE');
  assert.equal(natural.seed, 20260731);
  assert.equal(natural.resamples, 50_000);
  assert.equal(natural.metrics.operations.point, 1);
  assert.equal(natural.metrics.operations.upper95, 1);
  assert.equal(natural.packing.operationsPerRetrievalEnvelopeRatio, 2);
  assert.equal(natural.packing.operationsPerModelTurnRatio, 1.25);
  assert.equal(natural.gates.operationsPerRetrievalEnvelopeImproved, true);
  assert.equal('operationsLower' in natural.gates, false);

  const confirmation = adjudicateTurnfix(options('confirmation', control, treatment));
  assert.equal(confirmation.valid, true);
  assert.ok(Math.abs(confirmation.metrics.cost.point - 0.8) < 1e-12);
  assert.ok(Math.abs(confirmation.metrics.cost.upper95 - 0.8) < 1e-12);
  assert.ok(Math.abs(confirmation.metrics.turns.point - 0.8) < 1e-12);
  assert.equal(confirmation.metrics.contextPerTurn.point, 1);
  assert.equal(confirmation.solve.treatmentOnlyLosses, 0);
  assert.equal(confirmation.solve.controlOnlyLosses, 0);
  assert.equal(confirmation.solve.nonInferiorityClaimEligible, false,
    'a small clean fixture must not claim the n>=60 -5pp result');
  assert.ok(Math.abs(confirmation.solve.grossTreatmentLossUpper95 -
    (1 - 0.05 ** (1 / 4))) < 1e-10);
  assert.equal(confirmation.bothSolvedCost.tasks, 4);
  assert.ok(Math.abs(confirmation.bothSolvedCost.ratio - 0.8) < 1e-12);
  assert.deepEqual(confirmation.tails.turns.control, { p50: 25, p75: 32.5, p90: 37 });
  assert.deepEqual(confirmation.tails.turns.treatment, { p50: 20, p75: 26, p90: 29.6 });
  assert.equal(confirmation.topFiveCostContribution.control.share, 1);
  assert.ok(Math.abs(confirmation.topFiveSavingsContribution.shareOfNetSavings - 1) < 1e-12);
  assert.ok(Math.abs(confirmation.pairedLogDiagnostics.cost.geometricMeanRatio - 0.8) < 1e-12);
  assert.equal(confirmation.metrics.retrievalOperations.point, 1);
  assert.equal(confirmation.triggers.retrievalEquivalenceAuditRequired, false);
  assert.equal(Object.values(confirmation.gates).every(Boolean), true);
  assert.ok(!JSON.stringify(confirmation).includes('operationsLower'));

  // One plausible treatment-only loss is a predeclared expansion trigger and
  // the exact discordant task is reported rather than hidden in a net count.
  const oneLoss = cloneWithRows(treatment, 'one-loss', rows => { rows[0].resolved = false; });
  const lossReport = adjudicateTurnfix(options('confirmation', control, oneLoss, { lossAdjudication: 'pass' }));
  assert.equal(lossReport.solve.treatmentOnlyLosses, 1);
  assert.deepEqual(lossReport.solve.treatmentOnlyLossTaskIds, [tasks[0]]);
  assert.equal(lossReport.verdict, 'EXPAND-32 — PLAUSIBLE TREATMENT-ONLY LOSS TRIGGER');

  // Point target met but an upper bound crossing 1.00 triggers the one allowed expansion.
  const uncertain = cloneWithRows(treatment, 'cost-uncertain', rows => {
    [0.1, 0.1, 0.1, 8].forEach((cost, i) => { rows[i].costRealizedUsd = cost; });
  });
  const uncertainReport = adjudicateTurnfix(options('confirmation', control, uncertain));
  assert.ok(uncertainReport.metrics.cost.point <= TURNFIX_STATS.costPointTarget);
  assert.ok(uncertainReport.metrics.cost.upper95 >= 1);
  assert.equal(uncertainReport.verdict, 'EXPAND-32 — COST-UNCERTAINTY TRIGGER');

  // The retired prompt experiment's lower-operations gate is deliberately absent.
  const fewerOps = makeResult('fewer-ops', 'sweet', specs({
    costScale: 0.8, turnScale: 0.8, operations: 2, envelopes: 1,
  }));
  const fewerOpsReport = adjudicateTurnfix(options('confirmation', control, fewerOps));
  assert.equal(fewerOpsReport.metrics.operations.point, 0.5);
  assert.equal(fewerOpsReport.gates.operationsUpperAtMost1_05, true);
  assert.equal(fewerOpsReport.triggers.retrievalEquivalenceAuditRequired, true);
  assert.ok(!JSON.stringify(fewerOpsReport).includes('operations lower'));

  // A task with no retrieval/test activity is an observed zero, not missing
  // telemetry. Aggregate denominators remain positive and zero-only bootstrap
  // samples are retried until exactly 50,000 finite paired draws are retained.
  const zeroControlSpec = specs();
  const zeroTreatmentSpec = specs({ costScale: 0.8, turnScale: 0.8, operations: 4, envelopes: 1 });
  for (const spec of [zeroControlSpec[tasks[0]], zeroTreatmentSpec[tasks[0]]]) {
    spec.operations = 0;
    spec.envelopes = 0;
  }
  const zeroControl = makeResult('zero-control', 'native', zeroControlSpec);
  const zeroTreatment = makeResult('zero-treatment', 'sweet', zeroTreatmentSpec);
  const zeroReport = adjudicateTurnfix(options('confirmation', zeroControl, zeroTreatment));
  assert.equal(zeroReport.valid, true);
  assert.ok(zeroReport.metrics.operations.drawsAttempted > 50_000);
  assert.equal(zeroReport.pairedLogDiagnostics.operations.n, 3);

  // Every required row-integrity field fails closed in one focused fixture.
  const badIntegrity = cloneWithRows(treatment, 'bad-integrity', rows => {
    Object.assign(rows[0], {
      resolved: null,
      gradeable: false,
      isolated: false,
      escape: 1,
      leak: 1,
      goldTripwire: true,
      shimTampered: true,
      shimReran: true,
      shimExcluded: true,
      shimTamperedFiles: ['rt-shim-runtime.mjs'],
      exitReason: 'agent_error',
    });
  });
  const invalid = adjudicateTurnfix(options('confirmation', control, badIntegrity));
  assert.equal(invalid.valid, false);
  for (const pattern of [
    /resolved must be boolean/, /gradeable must be true/, /isolated must be true/,
    /escape must equal 0/, /leak must equal 0/, /goldTripwire must be false/,
    /shimTampered must be false/, /shimReran must be false/,
    /shimExcluded must be false/, /shimTamperedFiles must be an empty array/,
    /exitReason is not an admitted/,
  ]) assert.ok(invalid.admissionFailures.some(failure => pattern.test(failure)), String(pattern));

  const aggregateLog = path.join(treatment, 'turns', `${tasks[0]}-sweet.jsonl`);
  const aggregateCopy = path.join(root, 'aggregate-log');
  cpSync(treatment, aggregateCopy, { recursive: true });
  const copiedLog = path.join(aggregateCopy, 'turns', `${tasks[0]}-sweet.jsonl`);
  writeFileSync(copiedLog, readFileSync(aggregateLog, 'utf8').replace('"source":"stream"', '"source":"aggregate"'));
  const aggregateInvalid = adjudicateTurnfix(options('confirmation', control, aggregateCopy));
  assert.equal(aggregateInvalid.valid, false);
  assert.ok(aggregateInvalid.admissionFailures.some(failure => /source:aggregate/.test(failure)));

  const wrongCount = adjudicateTurnfix({ ...options('confirmation', control, treatment), expected: 5 });
  assert.equal(wrongCount.valid, false);
  assert.ok(wrongCount.admissionFailures.some(failure => /expected 5/.test(failure)));

  const parsed = parseTurnfixArgs([
    '--stage', 'natural', '--control', control, '--control-arm', 'native',
    '--treatment', treatment, '--treatment-arm', 'sweet', '--expect', '4',
    '--retrieval-equivalence', 'pass', '--completion-tripwires', 'pass', '--json',
  ]);
  assert.equal(parsed.controlPath, control);
  assert.equal(parsed.treatmentArm, 'sweet');
  assert.throws(() => parseTurnfixArgs([
    '--stage', 'natural', '--control', control, '--control-arm', 'native',
    '--treatment', treatment, '--treatment-arm', 'sweet', '--expect', '4', '--bogus', 'x',
  ]));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('turnfix-adjudicator: all assertions passed');
