// The task prompt reaches the agent on stdin, never in argv (2026-09-29, Codex phase-6 audit).
//
// THE DEFECT. Every CLI runner passed the issue text as a command-line argument. argv is
// readable host-wide, and a `ps -eo args` inside one Codex rollout printed another concurrent
// rollout's codex command line — with that task's issue text. These tests lock down:
//   1. the bytes on the agent's stdin are the prompt the argv form delivered, byte for byte
//      (per CLI, including opencode 1.18.4's quote-wrapping of a positional message);
//   2. no argv entry of the spawned agent contains the prompt, checked with a real `ps`;
//   3. an agent that exits without reading stdin does not crash the harness (EPIPE).
// `node tests/prompt-stdin.mjs`
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnWithTimeout, issuePrompt } from '../harness/agent-runner-shared.mjs';
import { codexPromptInvocation, writePromptToStdin } from '../harness/codex-task-runner.mjs';
import { opencodeRunMessage } from '../harness/opencode-task-runner.mjs';
import { buildClaudeCliArgs } from '../harness/claude-code-task-runner.mjs';

let ok = true;
const assert = (c, name, detail = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c || !detail ? '' : `  — ${detail}`)); if (!c) ok = false; };
const work = mkdtempSync(path.join(tmpdir(), 'prompt-stdin-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A prompt with every shape that could be mangled: quotes, backslashes, CR/LF, a leading and
// trailing newline, non-ASCII, a leading dash, and a unique marker to grep for in `ps`.
const MARKER = `LEAKCHECK${process.pid}x${Date.now()}`;
const PROMPT = issuePrompt(`\n-rf "quoted" and 'single' \\back\\slash\r\nnon-ascii: é 漢字 ✓\n${MARKER}\n`);

// A fake agent: records its argv and the exact stdin bytes, then waits `holdMs` so `ps` can
// see it while it runs.
const fakeAgent = path.join(work, 'fake-agent.mjs');
writeFileSync(fakeAgent, `import { writeFileSync } from 'node:fs';
const out = process.env.FAKE_OUT;
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', async () => {
  writeFileSync(out + '.stdin', Buffer.concat(chunks));
  writeFileSync(out + '.argv', JSON.stringify(process.argv.slice(2)));
  await new Promise(r => setTimeout(r, Number(process.env.FAKE_HOLD_MS || 0)));
  process.stdout.write('done');
});
`);

async function runFake(label, args, stdinText, { holdMs = 0, onSpawned = null } = {}) {
  const out = path.join(work, label);
  const env = { ...process.env, FAKE_OUT: out, FAKE_HOLD_MS: String(holdMs) };
  const p = spawnWithTimeout(process.execPath, [fakeAgent, ...args], { cwd: work, env, timeoutMs: 20000, stdinText });
  if (onSpawned) await onSpawned();
  const r = await p;
  return { r, stdin: readFileSync(out + '.stdin'), argv: JSON.parse(readFileSync(out + '.argv', 'utf8')) };
}

// argv of every live process whose command line holds `needle`, from the real process table.
function psLinesWith(needle) {
  const lines = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
  return lines.filter(l => l.includes(needle) && !l.includes('ps -eo'));
}

console.log('codex: `codex exec ... -` with the prompt on stdin');
{
  const base = ['exec', '--json', '-m', 'model', '-C', '/r'];
  const inv = codexPromptInvocation(base, PROMPT);
  assert(JSON.stringify(inv.argv) === JSON.stringify([...base, '-']), 'argv = the base argv + "-" (read the prompt from stdin)');
  assert(!inv.argv.some(a => a.includes(MARKER)), 'argv carries no prompt text');
  assert(inv.stdinText === PROMPT, 'stdin text = the prompt the argv form passed, unchanged');
  const resume = codexPromptInvocation(['exec', 'resume', '0000-sid', '--json'], 'phase 2');
  assert(resume.argv.at(-1) === '-' && resume.argv[2] === '0000-sid' && resume.stdinText === 'phase 2',
    'resume keeps the session id positional and takes the prompt from stdin');

  // The same writer the codex runner uses, on a real child.
  const out = path.join(work, 'codex-direct');
  const proc = spawn(process.execPath, [fakeAgent, ...inv.argv], {
    cwd: work, env: { ...process.env, FAKE_OUT: out }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  writePromptToStdin(proc, inv.stdinText);
  await new Promise(r => proc.on('exit', r));
  assert(readFileSync(out + '.stdin').equals(Buffer.from(PROMPT, 'utf8')), 'the child reads the prompt bytes exactly, then EOF');
}

console.log('\nshared spawnWithTimeout: stdin delivery + `ps` sees no prompt');
{
  let seen = null;
  const res = await runFake('shared', ['--flag', 'x'], PROMPT, {
    holdMs: 1500,
    onSpawned: async () => { await sleep(600); seen = psLinesWith(MARKER); },
  });
  assert(res.stdin.equals(Buffer.from(PROMPT, 'utf8')), 'stdin bytes = the prompt, byte for byte');
  assert(JSON.stringify(res.argv) === JSON.stringify(['--flag', 'x']), 'argv is exactly the flags', JSON.stringify(res.argv));
  assert(Array.isArray(seen) && seen.length === 0, 'a live `ps -eo args` shows no process with the prompt text', JSON.stringify(seen));
  assert(res.r.exitCode === 0 && res.r.stdout === 'done', 'the agent ran to completion');

  // Control: the old argv form IS visible — proves the `ps` check can see a leak.
  const ctlMarker = `${MARKER}ctl`;
  let ctl = null;
  const out = path.join(work, 'control');
  const p = spawnWithTimeout(process.execPath, [fakeAgent, ctlMarker], {
    cwd: work, env: { ...process.env, FAKE_OUT: out, FAKE_HOLD_MS: '1500' }, timeoutMs: 20000, stdinText: '',
  });
  await sleep(600); ctl = psLinesWith(ctlMarker); await p;
  assert(ctl.length >= 1, 'control: a prompt passed in argv IS visible to `ps` (the check is live)');

  const none = await runFake('no-stdin', ['a'], null);
  assert(none.stdin.length === 0, 'stdinText null → stdin is /dev/null (empty), as before');

  // An agent that exits without reading: the write gets EPIPE and must not throw.
  const quitter = path.join(work, 'quitter.mjs');
  writeFileSync(quitter, 'process.exit(3);\n');
  const big = 'x'.repeat(4 * 1024 * 1024);
  const q = await spawnWithTimeout(process.execPath, [quitter], { cwd: work, env: process.env, timeoutMs: 20000, stdinText: big });
  assert(q.exitCode === 3, 'an agent that never reads stdin: its exit code is reported, the harness does not crash');
}

console.log('\nopencode 1.18.4: stdin message = the argv-form message');
{
  // opencode 1.18.4 `run` handler, transcribed from the pinned binary (see opencodeRunMessage).
  const quoteJoin = msgs => msgs.map(g => g.includes(' ') ? `"${g.replace(/"/g, '\\"')}"` : g).join(' ');
  const combine = (j, h) => { if (!j) return h; if (!h) return j; return j + '\n' + h; };
  const argvForm = prompt => combine(quoteJoin([prompt]), '');            // old: positional + /dev/null
  const stdinForm = prompt => combine(quoteJoin([]), opencodeRunMessage(prompt)); // new: no positional + stdin
  for (const p of [PROMPT, issuePrompt('The add function should also accept a third optional argument c.'), 'nospace', 'a "b" c']) {
    assert(stdinForm(p) === argvForm(p), `message identical for ${JSON.stringify(p.slice(0, 24))}…`);
  }
  assert(opencodeRunMessage(issuePrompt('The add function should also accept a third optional argument c.'))
    === '"=== ISSUE ===\nThe add function should also accept a third optional argument c."',
  'matches the captured 1.18.4 request (captures/opencode-1.18.4-request-sweet-trim-off-gpt.json)');
  const src = readFileSync(new URL('../harness/opencode-task-runner.mjs', import.meta.url), 'utf8');
  const argsLine = src.split('\n').find(l => l.includes("const args = ['run', '--format', 'json'"));
  assert(argsLine && !/\bprompt\b/.test(argsLine), 'the `opencode run` argv no longer ends with the prompt', argsLine);
}

console.log('\nclaude 2.1.281: `-p` with no prompt argument reads stdin');
{
  const argv = buildClaudeCliArgs({ prompt: PROMPT, rundir: '/r', sweet: true, claudeModelId: 'm' });
  assert(!argv.some(a => String(a).includes(MARKER)), 'argv carries no prompt text');
  assert(argv[0] === '-p' && argv[1] === '--add-dir', '`-p` (--print, boolean) is followed by the next option, not a prompt');
  // 2.1.281 getInputPrompt: [promptArg, stdin].filter(Boolean).join("\n") — transcribed from the binary.
  const join = (arg, stdin) => [arg, stdin].filter(Boolean).join('\n');
  assert(join(undefined, PROMPT) === join(PROMPT, ''), 'stdin-only prompt = the old argv prompt, byte for byte');
  const src = readFileSync(new URL('../harness/claude-code-task-runner.mjs', import.meta.url), 'utf8');
  assert(/spawnWithTimeout\('claude', args, \{[^}]*stdinText: prompt/.test(src), 'the runner hands the prompt to spawnWithTimeout as stdin');
}

console.log('\ncodex runner wiring');
{
  const src = readFileSync(new URL('../harness/codex-task-runner.mjs', import.meta.url), 'utf8');
  assert(!/\[\.\.\.baseArgs, (prompt|p2|c3Phase1Prompt)\]/.test(src), 'no codex argv is built with a prompt positional');
  assert(/stdio: \[stdinText == null \? 'ignore' : 'pipe', 'pipe', 'pipe'\]/.test(src) && /writePromptToStdin\(proc, stdinText\)/.test(src),
    'codex spawn pipes the prompt on stdin');
}

console.log(ok ? '\nprompt-stdin: all assertions passed' : '\nprompt-stdin: FAILURES');
process.exit(ok ? 0 : 1);
