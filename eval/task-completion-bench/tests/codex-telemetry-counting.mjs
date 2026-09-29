// Codex rows.json telemetry (2026-09-29, Codex phase-4 audit): every row of
// hc-codex-20260929-1* had ranTests=false, toolCounts.test=0 and toolCounts.ss=0 although each
// rollout ran run_tests and ss-*. Codex 0.146 wraps commands as `/bin/zsh -lc ...` and the
// classifier unwrapped only bash/sh. Also: `calls` never counted `wait` / `write_stdin` polls.
// `node tests/codex-telemetry-counting.mjs`
import assert from 'node:assert';
import {
  classifyCodexCommand, unwrapShellCommand, splitShellCommands, codexPollCallsFromRollout,
} from '../harness/codex-task-runner.mjs';
import { runTestsTelemetry } from '../harness/rt-inflight.mjs';

// --- unwrap: the exact command strings from hc-codex-20260929-1618-L2 trajectories ---
assert.equal(unwrapShellCommand('/bin/zsh -lc run_tests'), 'run_tests');
assert.equal(unwrapShellCommand(`/bin/zsh -lc 'ss-grep "NullReporter" -k 20'`), 'ss-grep "NullReporter" -k 20');
assert.equal(unwrapShellCommand(`/bin/bash -lc 'echo '\\''x'\\'''`), "echo 'x'");
assert.equal(unwrapShellCommand('run_tests'), 'run_tests', 'an unwrapped command is unchanged');

// --- call kind: the zsh-wrapped run_tests / ss-* are counted ---
assert.equal(classifyCodexCommand('/bin/zsh -lc run_tests').kind, 'test');
assert.equal(classifyCodexCommand(`/bin/zsh -lc 'ss-grep "NullReporter" -k 20'`).kind, 'ss');
assert.equal(classifyCodexCommand('/usr/bin/bash -lc "sed -n 1,20p a.js"').kind, 'nativeRead', 'bash unwrap unchanged');

// --- joined cells: one call kind, one count per part ---
const joined = classifyCodexCommand(`/bin/zsh -lc 'ss-read lib/reporters.js 1 110; ss-read index.js 1 180'`);
assert.equal(joined.kind, 'ss');
assert.deepEqual(joined.parts, ['ss', 'ss'], 'a `;`-joined cell counts each command');
const withTest = classifyCodexCommand(`/bin/zsh -lc 'ss-search "deprecated imports" -k 8; run_tests'`);
assert.equal(withTest.kind, 'test', 'a cell that runs the tests is a test call (it returns a verdict)');
assert.deepEqual(withTest.parts, ['ss', 'test']);
assert.deepEqual(classifyCodexCommand(`/bin/zsh -lc 'cd /w && run_tests || true'`).parts, ['bash', 'test', 'bash']);
assert.deepEqual(splitShellCommands(`ss-grep "a;b" -k 2; grep -n x f | head`), ['ss-grep "a;b" -k 2', 'grep -n x f | head'],
  'quoted separators and single pipes do not split');
assert.equal(classifyCodexCommand('/bin/zsh -lc /tmp/bin/run_tests').kind, 'test', 'a path-qualified run_tests still counts');

// --- the D-6 row columns now see the launches ---
const tel = runTestsTelemetry([
  { kind: classifyCodexCommand('/bin/zsh -lc run_tests').kind, resultText: 'x\n[run_tests verdict] status=PASS scope=full exit=0\n' },
  { kind: classifyCodexCommand(`/bin/zsh -lc 'ss-read a 1 2'`).kind, resultText: '' },
]);
assert.equal(tel.rtLaunched, 1);
assert.equal(tel.rtVerdicts, 1);

// --- wait / write_stdin polls from the rollout JSONL (real line shapes) ---
const rollout = [
  { type: 'session_meta', payload: {} },
  { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec',
    input: 'const r = await tools.exec_command({cmd:"run_tests",yield_time_ms:300000}); text(r.output); if (r.session_id) text((await tools.write_stdin({session_id:r.session_id,chars:""})).output);\n' } },
  { type: 'response_item', payload: { type: 'function_call', name: 'wait', arguments: '{"cell_id":"1","yield_time_ms":300000}' } },
  { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'const r = await tools.exec_command({cmd:"ss-read a 1 2"}); text(r.output);\n' } },
  { type: 'response_item', payload: { type: 'function_call', name: 'write_stdin', arguments: '{"session_id":3,"chars":""}' } },
  { type: 'response_item', payload: { type: 'function_call', name: 'wait', arguments: '{"cell_id":"2"}' } },
].map(x => JSON.stringify(x)).join('\n') + '\nnot json\n';
assert.deepEqual(codexPollCallsFromRollout(rollout), { wait: 2, writeStdin: 1, writeStdinInCellSource: 1 });
assert.deepEqual(codexPollCallsFromRollout(''), { wait: 0, writeStdin: 0, writeStdinInCellSource: 0 });

console.log('codex-telemetry-counting: all assertions passed');
