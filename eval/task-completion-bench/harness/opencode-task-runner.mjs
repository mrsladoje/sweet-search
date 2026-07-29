// opencode harness for the task-completion bench: drives `opencode run` (a real
// production coding agent) uncapped, routed to OpenRouter models (Grok 4.5, Muse). Same
// ablation as codex/claude-code:
//   - native arm: vanilla opencode `build` agent (its own bash/edit/read/grep); NO M++, NO ss-*.
//   - sweet arm:  opencode + M++ appended + ss-* wrappers on PATH.
// opencode has NO shell sandbox, so the run_tests shim reaches docker.sock directly and the
// host /etc/hosts net-lockdown governs the agent's egress. Emits the canonical bench row.
//
// NOTE: opencode's `--format json` event schema is not officially documented (reverse-
// engineered). parseOpencodeStream is defensive and is validated/adjusted from a real
// smoke's raw NDJSON before any counted run.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { isZeroCallStartFailure } from './codex-task-runner.mjs';
import {
  setupRunner, buildAgentEnv, warmupSweet, issuePrompt, computeNetArgs, writeInstructionFile,
  buildTrajectory, gitDiffPatch, verifyIntegrity, teardownRunner, auditEscape, rolloutStateDir,
  costsFromTurns, spawnWithTimeout, exitReasonFrom, priceFor,
} from './agent-runner-shared.mjs';
import { persistTurns } from './turn-log.mjs';

function classifyShell(cmd) {
  const c = String(cmd || '').trim();
  if (/^run_tests\b/.test(c)) return 'test';
  if (/^(ss[-_](search|grep|find|read|semantic|trace)|sweet-search)\b/.test(c)) return 'ss';
  if (/\bapply_patch\b/.test(c)) return 'edit';
  if (/^(rg|grep|ag|ack|git grep)\b/.test(c) || /\| *(grep|rg)\b/.test(c)) return 'nativeGrep';
  if (/^(cat|head|tail|nl|bat|less)\b/.test(c) || /^sed\s+(-n|')/.test(c)) return 'nativeRead';
  return 'bash';
}

// opencode built-in tool name → bucket. `bash` unwraps to the shell command.
function classifyTool(tool, input) {
  const name = String(tool || '').toLowerCase();
  if (name === 'bash' || name === 'shell') return { kind: classifyShell(input?.command || input?.cmd), command: input?.command || input?.cmd || '' };
  if (name === 'edit' || name === 'write' || name === 'patch' || name === 'multiedit') return { kind: 'edit', command: `${name} ${input?.filePath || input?.path || input?.file_path || ''}` };
  if (name === 'read') return { kind: 'nativeRead', command: `read ${input?.filePath || input?.path || ''}` };
  if (name === 'grep' || name === 'glob' || name === 'list') return { kind: 'nativeGrep', command: `${name} ${JSON.stringify(input?.pattern ?? input?.query ?? '')}` };
  return { kind: 'bash', command: `${name} ${JSON.stringify(input || {}).slice(0, 160)}` };
}

// Parse opencode `run --format json` NDJSON. Defensive: the schema is reverse-engineered,
// so it handles both an envelope-with-`part` and a flat event, and both camel/snake keys.
export function parseOpencodeStream(stdout) {
  const toolCalls = [];
  const turns = [];
  const errors = [];
  let answer = '';
  let sessionID = null;
  if (!stdout) return { toolCalls, answer, turns, errors, sessionID };
  for (const line of stdout.split('\n')) {
    const tl = line.trim();
    if (!tl || tl[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tl); } catch { continue; }
    sessionID = sessionID || ev.sessionID || ev.sessionId || ev.session_id || null;
    const p = ev.part || ev.properties?.part || ev;
    const type = ev.type || p.type;
    if (type === 'tool_use' || type === 'tool' || (p && p.tool && (p.state || p.callID || p.callId))) {
      const st = p.state || {};
      const { kind, command } = classifyTool(p.tool, st.input || p.input);
      const out = st.output || p.output || '';
      const status = st.status || p.status;
      toolCalls.push({ kind, command, resultText: typeof out === 'string' ? out : JSON.stringify(out || '').slice(0, 600), isError: status === 'error' });
    } else if (type === 'step_finish' || type === 'step-finish') {
      const tk = p.tokens || {};
      const cache = tk.cache || {};
      const cRead = cache.read || 0, cWrite = cache.write || 0;
      turns.push({ in: (tk.input || 0) + cRead + cWrite, cached: cRead, out: (tk.output || 0) + (tk.reasoning || 0) });
    } else if (type === 'text') {
      if (typeof p.text === 'string' && p.text.trim()) answer = p.text;
    } else if (type === 'error') {
      errors.push(`error: ${String(p.message || p.error || JSON.stringify(p)).slice(0, 300)}`);
    }
  }
  return { toolCalls, answer, turns, errors, sessionID };
}

export async function runOpencodeTask(task, {
  arm, apiModel = 'x-ai/grok-4.5', ssBinDir, mppText, image, t, perCallTimeoutMs = 900000,
} = {}) {
  const sweet = arm === 'sweet';
  const rundir = task.repoCheckout;
  const workdir = t.workdir || `/${t.repo.split('/')[1]}`;
  const testScript = [].concat(t.install_config?.test_cmd || []).join(' && ');
  const price = priceFor(apiModel);
  const openrouterModel = `openrouter/${apiModel}`;

  const netArgs = computeNetArgs(t);
  const label = `${task.id || 'task'}-${arm}`;
  // opencode's own state, per rollout instead of the shared 1.8 GB store (see
  // rolloutStateDir): config + provider SDKs read-only, session DB private and retained.
  const ocData = rolloutStateDir(label, 'opencode-data');
  const extraBinds = [
    { src: path.join(process.env.HOME || '/root', '.config/opencode'), dst: path.join(process.env.HOME || '/root', '.config/opencode'), ro: true },
    { src: path.join(process.env.HOME || '/root', '.cache/opencode'), dst: path.join(process.env.HOME || '/root', '.cache/opencode'), ro: true },
    { src: ocData, dst: path.join(process.env.HOME || '/root', '.local/share/opencode') },
  ];
  const { runnerStateDir, binDir, runnerFiles, integrity, jail, broker, integrityStateDir } = setupRunner({
    image, workdir, testScript, rundir, testTimeoutSec: t._testTimeoutSec || 300, netArgs, sweet,
    label, extraBinds, requireBins: ['opencode'],
  });

  // Instruction file = frame + M± (sweet) / frame only (native), written into
  // <rundir>/AGENTS.md (the plain project file opencode reads). Excluded from the graded
  // patch by gitDiffPatch.
  writeInstructionFile(rundir, 'AGENTS.md', { sweet, mppText });
  // Per-run opencode config: OpenRouter provider (key via {env:} substitution) + permissive
  // permissions so the headless agent edits/bashes without prompts (the #13851 write-gap
  // mitigation is `build` agent + explicit allow + --auto), and web tools denied (host
  // /etc/hosts lockdown already blocks egress, this stops opencode's own fetch/search).
  const ocConfig = path.join(runnerStateDir, 'opencode.json');
  writeFileSync(ocConfig, JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: { openrouter: { options: { apiKey: '{env:OPENROUTER_API_KEY}' } } },
    permission: { bash: 'allow', edit: 'allow', write: 'allow', read: 'allow', webfetch: 'deny', websearch: 'deny' },
  }));

  const env = buildAgentEnv({ rundir, binDir, ssBinDir, sweet, extraEnv: { OPENCODE_CONFIG: ocConfig }, jail });
  if (sweet && ssBinDir) warmupSweet({ ssBinDir, rundir, env, jail });

  // Prompt = the issue ONLY (both arms). Frame + M± live in AGENTS.md above.
  const prompt = issuePrompt(task.problem_statement);
  const args = ['run', '--format', 'json', '--agent', 'build', '--auto', '--model', openrouterModel, '--dir', rundir, prompt];

  const t0 = Date.now();
  const spawnOnce = () => spawnWithTimeout('opencode', args, { cwd: rundir, env, timeoutMs: perCallTimeoutMs, jail });
  let r = await spawnOnce();
  let parsed = parseOpencodeStream(r.stdout);
  let startRetried = false;
  if (isZeroCallStartFailure(r, parsed.toolCalls, parsed.answer)) {
    startRetried = true;
    console.log(`  [opencode-retry ${task.id || ''}] 0-call start failure (exit=${r.exitCode}${parsed.errors[0] ? '; ' + parsed.errors[0] : ''}) — relaunching once`);
    r = await spawnOnce();
    parsed = parseOpencodeStream(r.stdout);
  }
  const wallMs = Date.now() - t0;
  const { toolCalls, answer, turns, errors } = parsed;

  const { toolCounts, trajectory, stepsToFirstEdit } = buildTrajectory(toolCalls);
  const { finalPatch, patchHunks, patchFiles } = gitDiffPatch(rundir);
  // NO patchFiles backfill into toolCounts.edit (PLAN.md §3 B3): it fired on 9/196 sweet
  // vs 1/197 native rollouts — an asymmetry created by shell-routed edits, not by the
  // arms' actual edit behaviour — and silently made an observed-tool-call counter mean
  // two different things. toolCounts.edit is now strictly "edit-tool calls seen"; every
  // patch-derived metric reads patchFiles/patchHunks here or preds-*.jsonl downstream.

  const costs = costsFromTurns(turns, price);
  // P7: keep the per-turn array (PLAN.md §3 B1). opencode's step_finish events are the
  // exact per-turn split; without this the next forensics pass is algebraic again.
  const turnsFile = persistTurns(label, turns, {
    task: task.id, arm, harness: 'opencode', model: apiModel, price, source: 'stream',
  });
  // opencode.json is this adapter's own generated config and lives in the runner state
  // dir by design; declare it so the tamper check does not read it as an injected file.
  const shimTamperedFiles = verifyIntegrity({ integrity, runnerFiles, binDir, integrityStateDir, allowedStateEntries: ['opencode.json'] });
  if (shimTamperedFiles.length) console.log(`  [SHIM-TAMPERED ${task.id || ''}] ${shimTamperedFiles.join(', ')} — test signals untrusted`);
  // Audit BEFORE teardown: the jail handle carries the wall-clock window that attributes
  // egress denials to this rollout.
  const escapeAudit = auditEscape({ jail, toolCalls, rundir, endMs: Date.now() });
  teardownRunner(runnerStateDir, { jail, broker });

  const calls = toolCalls.length;
  return {
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch,
    ...escapeAudit,
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0,
    exitReason: exitReasonFrom(r),
    usage: turns.length ? { turns: turns.length } : {},
    ...costs, turnsFile,
    wallMs, trajectory, finalAssistantText: answer,
    agentErrors: errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
