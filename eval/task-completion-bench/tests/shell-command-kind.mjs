// Coverage for the shared shell classifier (shell-command-kind.mjs, 2026-10-03): an ss-* tool
// inside a compound shell command counts as ss-* in every runner, and its output survives.
// Standalone, zero spend: `node eval/task-completion-bench/tests/shell-command-kind.mjs`.
import assert from 'node:assert/strict';
import { classifyShellCommand, classifyShellPart, TOOL_KIND_VERSION } from '../harness/shell-command-kind.mjs';
import { parseClaudeStream } from '../harness/claude-code-task-runner.mjs';
import { classifyCodexCommand } from '../harness/codex-task-runner.mjs';
import { classifyShell as cursorClassifyShell } from '../harness/cursor-task-runner.mjs';

// 1. The shapes Claude Code used in the 2026-10-02 full-line A/B.
const CD = 'cd /Users/admin/.ss-eval/r282-repos/cc-opus55-medium-obs-fl-B-r1/eval__repos__r3-typedoc';
assert.equal(classifyShellCommand(`${CD}; ss-grep "class Filter"`).kind, 'ss', 'cd …; ss-grep');
assert.equal(classifyShellCommand(`${CD} && ss-read src/a.ts 1 80`).kind, 'ss', 'cd … && ss-read');
assert.deepEqual(classifyShellCommand(`${CD}; ss-read a 1 2; ss-grep x`).parts, ['bash', 'ss', 'ss']);
assert.equal(classifyShellCommand('ss-grep foo | head -20').kind, 'ss', 'a pipe stays inside its part');
assert.equal(classifyShellCommand('SS_READ_GUTTER=none ss-read a.ts 1 9').kind, 'ss', 'leading env assignment');
assert.equal(classifyShellCommand('ss-batch <<EOF\nss-grep x\nEOF').kind, 'ss', 'ss-batch is ss-*');
assert.equal(classifyShellCommand(`${CD}; grep -rn foo src`).kind, 'nativeGrep', 'cd …; grep stays native');
assert.equal(classifyShellCommand(`${CD}; cat a.ts`).kind, 'nativeRead');
assert.equal(classifyShellCommand('cd /w && run_tests').kind, 'test', 'test outranks everything');
assert.equal(classifyShellCommand('echo "x; ss-grep y"').kind, 'bash', 'a quoted ; does not split');
assert.equal(classifyShellPart('FOO="a b" ss-search q'), 'ss');
assert.equal(TOOL_KIND_VERSION, 2);
// Every runner uses the same buckets.
for (const cmd of [`${CD}; ss-grep x`, 'cat a', 'ls', 'cd w && run_tests']) {
  assert.equal(classifyCodexCommand(cmd).kind, classifyShellCommand(cmd).kind, `codex: ${cmd}`);
  assert.equal(cursorClassifyShell(cmd), classifyShellCommand(cmd).kind, `cursor: ${cmd}`);
}

// 2. A recorded Claude Code stream (obs-fl-B-r1, r3-typedoc; output shortened): the compound call
//    is an ss call and its output is kept.
const command = `${CD}; ss-read src/lib/utils/options/sources/typedoc.ts 640 680; ss-grep "class Filter" ; ss-grep "filter" --in src/frontend/typedoc/components/Filter.ts`;
const output = '# ss-read src/lib/utils/options/sources/typedoc.ts (lines 640-680 of 1008)\n```typescript\n640\t        help: () => i18n.help_includeHierarchySummary(),\n```\n# ss-grep "class Filter"\nsrc/frontend/typedoc/components/Filter.ts\n';
const stream = [
  { type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command, description: 'Read files' } }], usage: { output_tokens: 90 } } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: output }] }] } },
  { type: 'assistant', message: { id: 'm2', role: 'assistant', content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: `${CD}; ls src` } }], usage: { output_tokens: 20 } } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'lib\nfrontend\n' }] } },
  { type: 'result', subtype: 'success', result: 'src/frontend/typedoc/components/Filter.ts', usage: { output_tokens: 110 } },
].map(e => JSON.stringify(e)).join('\n');
const p = parseClaudeStream(stream);
assert.equal(p.toolCalls.length, 2);
assert.equal(p.toolCalls[0].kind, 'ss', 'the compound ss-* call is counted as ss');
assert.equal(p.toolCalls[0].command, command, 'the original command text is kept');
assert.equal(p.toolCalls[0].resultText, output, 'its output is kept');
assert.equal(p.toolCalls[1].kind, 'bash', 'cd …; ls stays bash');
// The capture row shape of retrieval-bench-282 (calls[].text since capture version 2).
const cap = p.toolCalls.map(c => ({ kind: c.kind, command: c.command, isError: c.isError, textChars: c.resultText.length, text: c.resultText }));
assert.equal(cap[0].text, output);
assert.equal(cap.filter(c => c.kind === 'ss').length, 1, 'ssCalls = 1');

console.log('shell-command-kind: ALL PASS');
