#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseEditReplayArgs, replayCycles, verifyStage1 } from '../stats/edit-thrash-replay.mjs';

const AUTH = '[run_tests] Authoritative test result for your CURRENT edits';
const pass = `${AUTH}\n100 passed`;
const fail = `${AUTH}\n[run_tests baseline-diff] 1 NEW failure(s) introduced by your edits (were passing before): test_x FAILED\ntest_x FAILED`;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

const message = (...calls) => ({ calls, cost: 0.1, inputTokens: 100 });
const edit = () => ({ tool: 'edit', command: '', output: 'Done' });
const run = (output, command = 'run_tests') => ({ tool: 'bash', command, output });

test('cycle 0 seeds comparison but is not an attempted repair', () => {
  const replay = replayCycles([message(run(pass))]);
  assert.equal(replay.cycles.length, 0);
  assert.equal(replay.testExecutions, 1);
});

test('same trustworthy failure state increments the non-improvement streak', () => {
  const replay = replayCycles([
    message(run(fail)),
    message(edit()),
    message(run(fail)),
    message(edit()),
    message(run(fail)),
  ]);
  assert.deepEqual(replay.cycles.map(cycle => [cycle.kind, cycle.streak]), [
    ['failure_state_repeat', 1],
    ['failure_state_repeat', 2],
  ]);
});

test('strict failure-set reduction resets the streak as objective progress', () => {
  const replay = replayCycles([
    message(run(fail)),
    message(edit()),
    message(run(fail)),
    message(edit()),
    message(run(pass)),
  ]);
  assert.equal(replay.cycles[1].kind, 'failure_subset');
  assert.equal(replay.cycles[1].progress, true);
  assert.equal(replay.cycles[1].streak, 0);
});

test('non-executed dedup pauses and does not consume the pending edit', () => {
  const replay = replayCycles([
    message(run(fail)),
    message(edit()),
    message(run('[run_tests dedup] unchanged — suite not re-run')),
    message(run(fail)),
  ]);
  assert.equal(replay.testExecutions, 2);
  assert.equal(replay.cycles.length, 1);
  assert.equal(replay.cycles[0].streak, 1);
});

test('same-message edit and test abstain because OpenCode may execute in parallel', () => {
  const editFirst = replayCycles([
    message(run(pass)),
    message(edit(), run(pass)),
  ]);
  const testFirst = replayCycles([
    message(run(pass)),
    message(run(pass), edit()),
  ]);
  assert.equal(editFirst.cycles.length, 0);
  assert.equal(testFirst.cycles.length, 0);
});

test('different normalized targeted scopes never compare against one another', () => {
  const replay = replayCycles([
    message(edit()),
    message(run(fail, 'run_tests test_x')),
    message(edit()),
    message(run(fail, 'run_tests test_y')),
  ]);
  assert.deepEqual(replay.cycles.map(cycle => cycle.kind), [
    'first_targeted_unranked',
    'first_targeted_unranked',
  ]);
});

test('CLI boundary rejects unknown and valueless options', () => {
  assert.throws(() => parseEditReplayArgs(['--wat']), /unknown option/);
  assert.throws(() => parseEditReplayArgs(['--db', '--c1', 'one']), /missing value/);
});

test('Stage-1 verifier splits retrieval at first edit and counts warning rollouts', () => {
  const result = verifyStage1([{
    task: 'thelounge__thelounge-2538', era: 'post-frame', cell: 'variant',
    messages: [{ calls: [
      run('', 'ss-grep before; ss-read src/a.js'),
      { tool: 'edit', command: '', output: '' },
      run('', 'ss-search after'),
      run('[run_tests diff-check] WARNING: added identifier not found in symbol index: x'),
    ] }],
  }]);
  assert.equal(result.cells.variant.retrievalBeforeFirstEdit, 2);
  assert.equal(result.cells.variant.retrievalAfterFirstEdit, 1);
  assert.equal(result.affectedRollouts, 1);
  assert.equal(result.cells.variant.theloungeTests[0].warning, true);
});

console.log(`1..${passed}`);
