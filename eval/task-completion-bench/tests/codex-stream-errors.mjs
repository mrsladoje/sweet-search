// Tests for the codex startup-failure taxonomy (2026-07-09 checkpoint forensics):
//  - error / turn.failed stream events must surface (they were silently dropped,
//    which let the benign non-TTY stdin banner masquerade as the failure cause)
//  - isZeroCallStartFailure gates exactly ONE automatic relaunch
import assert from 'node:assert';
import { parseCodexAgentStream, isZeroCallStartFailure } from '../harness/codex-task-runner.mjs';

// --- parseCodexAgentStream: error events surface ---
{
  const stream = [
    '{"type":"thread.started","thread_id":"t1"}',
    '{"type":"turn.started"}',
    '{"type":"error","message":"unexpected status 429 Too Many Requests"}',
    '{"type":"turn.failed","error":{"message":"stream disconnected before completion"}}',
  ].join('\n');
  const { toolCalls, errors } = parseCodexAgentStream(stream);
  assert.equal(toolCalls.length, 0);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^error: unexpected status 429/);
  assert.match(errors[1], /^turn\.failed: stream disconnected/);
}

// --- parseCodexAgentStream: clean stream still parses, errors empty ---
{
  const stream = [
    '{"type":"item.completed","item":{"type":"command_execution","command":"ls","exit_code":0,"aggregated_output":"a"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
  ].join('\n');
  const { toolCalls, answer, usage, errors } = parseCodexAgentStream(stream);
  assert.equal(toolCalls.length, 1);
  assert.equal(answer, 'done');
  assert.equal(usage.input_tokens, 10);
  assert.deepEqual(errors, []);
}

// --- isZeroCallStartFailure ---
const tc = [{ name: 'x' }];
// the checkpoint shape: exit≠0, 0 calls, no answer → retry
assert.equal(isZeroCallStartFailure({ exitCode: 1, timedOut: false }, [], ''), true);
// "completed" with no output at all (task_complete, last_agent_message null) → retry
assert.equal(isZeroCallStartFailure({ exitCode: 0, timedOut: false }, [], ''), true);
// produced an answer with no tool calls (legit trivial completion) → no retry
assert.equal(isZeroCallStartFailure({ exitCode: 0, timedOut: false }, [], 'OK'), false);
// did real work then failed mid-run → NOT a start failure (no retry)
assert.equal(isZeroCallStartFailure({ exitCode: 1, timedOut: false }, tc, ''), false);
// timeout is its own category, never retried here
assert.equal(isZeroCallStartFailure({ exitCode: 1, timedOut: true }, [], ''), false);

console.log('codex-stream-errors: all assertions passed');
