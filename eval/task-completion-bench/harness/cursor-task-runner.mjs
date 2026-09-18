// cursor harness for the task-completion bench: drives `cursor-agent -p` (Cursor's
// production coding agent) routed to whatever model the account's plan exposes. Same
// ablation as codex/claude-code/opencode:
//   - native arm: vanilla cursor-agent (its own shell/read/edit tools); NO M++, NO ss-*.
//   - sweet arm:  cursor-agent + M++ appended + ss-* wrappers on PATH.
//
// SCHEMA (captured from a real 2026.09.15-d2fe57e run, not from docs — the docs do not
// describe the stream at all). `--output-format stream-json` emits one JSON object per line:
//   {"type":"system","subtype":"init","session_id":…,"model":…}
//   {"type":"user","message":{…}}
//   {"type":"tool_call","subtype":"started"|"completed","call_id":…,
//    "tool_call":{"<name>ToolCall":{"args":{…},"result":{"success":{…}}}}}
//   {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":…}]}}
//   {"type":"result","subtype":"success","duration_ms":…,"usage":{inputTokens,outputTokens,
//    cacheReadTokens,cacheWriteTokens}}
//
// TWO THINGS THAT DIFFER FROM THE OTHER THREE, both load-bearing:
//
// 1. USAGE IS A SINGLE TOTAL, NOT PER TURN. opencode publishes `step_finish` per step and
//    codex/claude-code publish per-message usage; cursor reports one aggregate in the final
//    `result` event. Cost is therefore exact but the per-turn array is synthetic (one entry).
//    Anything that wants a per-turn split on this harness has to get it elsewhere.
//
// 2. SEARCH IS SHELL-ROUTED. In the captured run cursor answered "grep the repo" and "list
//    files" with `shellToolCall`, not a dedicated search tool, so classifyShell — the same
//    function codex uses — is what buckets native grep here. A dedicated search tool key is
//    still mapped below in case a future build emits one; anything unrecognised is bucketed
//    as `bash` WITH ITS KEY RECORDED rather than silently dropped, because a tool that
//    vanishes from the counts is an arm-asymmetry waiting to happen.
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isZeroCallStartFailure } from './codex-task-runner.mjs';
import {
  setupRunner, buildAgentEnv, warmupSweet, issuePrompt, computeNetArgs, writeInstructionFile,
  buildTrajectory, gitDiffPatch, verifyIntegrity, teardownRunner, auditEscape, rolloutStateDir,
  costsFromTurns, spawnWithTimeout, exitReasonFrom, priceFor,
} from './agent-runner-shared.mjs';
import { runTestsTelemetry } from './rt-inflight.mjs';
import { installSedCmds } from './env-ledger.mjs';
import { persistTurns } from './turn-log.mjs';
import { finalizeProgressModelTurns } from './rt-progress-controller.mjs';

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const retainedPath = file => path.relative(BENCH_DIR, file);
export const PINNED_CURSOR_VERSION = '2026.09.15-d2fe57e';

/** Same shell taxonomy the other runners use; cursor routes its search through the shell. */
export function classifyShell(cmd) {
  const c = String(cmd || '').trim();
  if (/^run_tests\b/.test(c)) return 'test';
  if (/^(ss[-_](search|grep|find|read|semantic|trace|batch)|sweet-search)\b/.test(c)) return 'ss';
  if (/\bapply_patch\b/.test(c)) return 'edit';
  if (/^(rg|grep|ag|ack|git grep)\b/.test(c) || /\| *(grep|rg)\b/.test(c)) return 'nativeGrep';
  if (/^(cat|head|tail|nl|bat|less)\b/.test(c) || /^sed\s+(-n|')/.test(c)) return 'nativeRead';
  return 'bash';
}

// cursor tool_call key → bucket. Keys are `<name>ToolCall`; `shell` unwraps to the command.
export function classifyCursorTool(key, args) {
  const name = String(key || '').replace(/ToolCall$/, '').toLowerCase();
  const a = args || {};
  const cmd = a.command || a.cmd || a.script || '';
  if (name === 'shell' || name === 'terminal' || name === 'bash') {
    return { kind: classifyShell(cmd), command: String(cmd) };
  }
  if (name === 'read' || name === 'readfile') return { kind: 'nativeRead', command: `read ${a.path || a.filePath || ''}` };
  if (name === 'edit' || name === 'write' || name === 'multiedit' || name === 'applypatch' || name === 'search_replace' || name === 'searchreplace') {
    return { kind: 'edit', command: `${name} ${a.path || a.filePath || a.file || ''}` };
  }
  if (name === 'grep' || name === 'ripgrep' || name === 'codebasesearch' || name === 'glob' || name === 'list' || name === 'ls' || name === 'search' || name === 'filesearch') {
    return { kind: 'nativeGrep', command: `${name} ${JSON.stringify(a.pattern ?? a.query ?? a.path ?? '')}` };
  }
  // Unrecognised: keep it counted and NAME it, so a schema change shows up as a weird
  // bucket in the trajectory instead of disappearing from the tool-call totals.
  return { kind: 'bash', command: `${key} ${JSON.stringify(a).slice(0, 160)}` };
}

/**
 * Parse `cursor-agent -p --output-format stream-json` NDJSON.
 * Returns { toolCalls, answer, turns, errors, sessionID, usage }.
 */
export function parseCursorStream(stdout) {
  const calls = new Map();
  const callOrder = [];
  const errors = [];
  let answer = '';
  let sessionID = null;
  let usage = null;
  let modelLabel = null;
  if (!stdout) return { toolCalls: [], answer, turns: [], errors, sessionID, usage, modelLabel };

  for (const line of stdout.split('\n')) {
    const tl = line.trim();
    if (!tl || tl[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tl); } catch { continue; }
    sessionID = sessionID || ev.session_id || ev.sessionId || null;
    const type = ev.type;

    if (type === 'system' && ev.subtype === 'init') {
      modelLabel = ev.model || modelLabel;
    } else if (type === 'tool_call') {
      const tc = ev.tool_call || {};
      const key = Object.keys(tc).find(k => k.endsWith('ToolCall'));
      if (!key) continue;
      const body = tc[key] || {};
      const { kind, command } = classifyCursorTool(key, body.args);
      // call_id embeds a newline in the captured schema; normalise so it is a usable key.
      const callId = String(ev.call_id || body.toolCallId || `line-${callOrder.length}`).replace(/\s+/g, '');
      const res = body.result || {};
      const ok = res.success || {};
      const out = typeof ok.content === 'string' ? ok.content : (res.error ? JSON.stringify(res.error) : '');
      const prior = calls.get(callId);
      if (!prior) callOrder.push(callId);
      calls.set(callId, {
        kind, command,
        resultText: String(out).slice(0, 600),
        isError: Boolean(res.error) || ev.subtype === 'error',
        modelTurn: prior?.modelTurn ?? 1,
        messageId: ev.model_call_id || prior?.messageId || null,
      });
    } else if (type === 'assistant') {
      const parts = ev.message?.content || [];
      for (const p of parts) if (p?.type === 'text' && String(p.text || '').trim()) answer = p.text;
    } else if (type === 'result') {
      if (ev.usage) usage = ev.usage;
      if (ev.is_error) errors.push(`result error: ${String(ev.result || '').slice(0, 300)}`);
      if (typeof ev.result === 'string' && ev.result.trim() && !ev.is_error) answer = answer || ev.result;
    } else if (type === 'error') {
      errors.push(`error: ${String(ev.message || ev.error || JSON.stringify(ev)).slice(0, 300)}`);
    }
  }

  // ONE synthetic turn: cursor reports a single aggregate, so a per-turn split would be
  // invented. `in` carries the full context (fresh + cache read + cache write) to match the
  // basis costsFromTurns expects, with cache read/write published separately so the realized
  // column can charge creation at the provider's rate — same shape as opencode's G17 note.
  const turns = [];
  if (usage) {
    const cRead = usage.cacheReadTokens || 0;
    const cWrite = usage.cacheWriteTokens || 0;
    turns.push({
      in: (usage.inputTokens || 0) + cRead + cWrite,
      cached: cRead,
      cacheWrite: cWrite,
      out: (usage.outputTokens || 0) + (usage.reasoningTokens || 0),
    });
  }
  return { toolCalls: callOrder.map(id => calls.get(id)), answer, turns, errors, sessionID, usage, modelLabel };
}

export async function runCursorTask(task, {
  arm, apiModel = 'cursor-grok-4.6-medium', ssBinDir, mppText, image, t, perCallTimeoutMs = 900000,
} = {}) {
  const sweet = arm === 'sweet';
  const rundir = task.repoCheckout;
  const workdir = t.workdir || `/${t.repo.split('/')[1]}`;
  const testScript = [].concat(t.install_config?.test_cmd || []).join(' && ');
  const price = priceFor(apiModel);

  const netArgs = computeNetArgs(t);
  const label = `${task.id || 'task'}-${arm}`;
  // cursor's own state per rollout. $HOME/.cursor holds the login session; it is bound
  // READ-ONLY so a rollout can authenticate but cannot mutate the operator's credentials,
  // and a private state dir absorbs whatever the agent wants to write.
  const curState = rolloutStateDir(label, 'cursor-state');
  const retainedRoot = rolloutStateDir(label, 'cursor-retained');
  const retainedSession = path.join(retainedRoot, `session-${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(retainedSession, { recursive: true, mode: 0o700 });
  const home = process.env.HOME || '/root';
  // cursor-agent installs UNDER $HOME (~/.local/share/cursor-agent/versions/<pin>/, ~557 MB)
  // and ~/.local/bin/cursor-agent is a symlink into it. The jail masks $HOME, so without
  // both of these the binary is simply absent inside — the first probe failed exactly
  // there, loudly, which is the behaviour we want over a silent 0-call rollout.
  // Everything cursor needs is bound READ-ONLY: a rollout must not be able to mutate the
  // operator's install or credentials, and the login session in ~/.cursor is a credential.
  const cursorInstallDir = path.join(home, '.local/share/cursor-agent');
  const cursorBinLink = path.join(home, '.local/bin/cursor-agent');
  // ~/.cursor must be WRITABLE: cursor-agent creates ~/.cursor/projects/<key>/ on start and
  // dies with ENOENT if it cannot (first fix attempt bound it read-only and every rollout
  // exited in 1s). But it also holds the operator's login in cli-config.json, and a rollout
  // must not be able to mutate the real credentials or leak one rollout's session into the
  // next. So do what the codex runner does with ~/.codex: give each rollout a PRIVATE COPY,
  // seeded once from the operator's, and bind that. ~1.4 MB, so the copy is free.
  const cursorHome = rolloutStateDir(label, 'cursor-home');
  const realCursorHome = path.join(home, '.cursor');
  if (existsSync(realCursorHome)) {
    try {
      cpSync(realCursorHome, cursorHome, { recursive: true, dereference: false, force: true });
    } catch (e) {
      throw new Error(`cursor: could not seed a private ~/.cursor from ${realCursorHome}: ${e.message}`);
    }
  } else {
    throw new Error(`cursor: ${realCursorHome} does not exist — run \`cursor-agent login\` on this host first`);
  }
  // THE CREDENTIAL IS NOT IN ~/.cursor. `cursor-agent login` writes the session token to
  // ~/.config/cursor/auth.json; ~/.cursor/cli-config.json only carries identity (email,
  // userId, authId) and no token, which is why seeding ~/.cursor alone still produced
  // "Authentication required" on every rollout. Same private-copy treatment: the rollout
  // gets its own, so it can refresh without touching the operator's session.
  const realCursorConfig = path.join(home, '.config/cursor');
  const cursorConfig = rolloutStateDir(label, 'cursor-config');
  if (!existsSync(path.join(realCursorConfig, 'auth.json'))) {
    throw new Error(`cursor: no session at ${realCursorConfig}/auth.json — run \`cursor-agent login\` on this host first`);
  }
  try {
    cpSync(realCursorConfig, cursorConfig, { recursive: true, dereference: false, force: true });
  } catch (e) {
    throw new Error(`cursor: could not seed a private ~/.config/cursor: ${e.message}`);
  }
  const extraBinds = [
    { src: cursorInstallDir, dst: cursorInstallDir, ro: true },
    { src: cursorBinLink, dst: cursorBinLink, ro: true },
    { src: cursorHome, dst: realCursorHome },
    { src: cursorConfig, dst: realCursorConfig },
    { src: curState, dst: path.join(home, '.local/share/cursor-agent-state') },
  ];

  writeInstructionFile(rundir, 'AGENTS.md', { sweet, mppText });
  const {
    runnerStateDir, binDir, runnerFiles, integrity, jail, broker, integrityStateDir, controller,
    progressConfig,
  } = setupRunner({
    image, workdir, testScript, rundir, testTimeoutSec: t._testTimeoutSec || 300, netArgs, sweet,
    label, taskId: task.id, arm, extraBinds, requireBins: ['cursor-agent'],
    injectedFiles: ['AGENTS.md'], installSeds: installSedCmds(t),
  });

  const env = buildAgentEnv({
    rundir, binDir, ssBinDir, sweet, jail,
    extraEnv: {
      // ss-* gutter form pinned per harness (core/search/gutter-form.js): cursor → `N:`,
      // because its edit is a fuzzy two-model apply that would absorb a stray tab rather
      // than reject it. Pinned so a timed run never pays a process-tree walk.
      SS_READ_GUTTER: process.env.SS_READ_GUTTER ?? 'colon',
      // Never let cursor open a browser or phone home for telemetry from inside a rollout.
      NO_OPEN_BROWSER: '1',
      // Only pass a key when one actually exists: an EMPTY CURSOR_API_KEY reads as "a key
      // was supplied" and can shadow the login session seeded above.
      ...(process.env.CURSOR_API_KEY ? { CURSOR_API_KEY: process.env.CURSOR_API_KEY } : {}),
    },
  });

  let preflight;
  try {
    const versionResult = await spawnWithTimeout('cursor-agent', ['--version'], {
      cwd: rundir, env, timeoutMs: 30_000, jail,
    });
    const version = String(versionResult.stdout || '').trim();
    if (versionResult.exitCode !== 0 || versionResult.timedOut) {
      throw new Error(`cursor-agent --version failed (exit=${versionResult.exitCode})`);
    }
    // A pin mismatch is a SHARED change: nothing may be pooled across it.
    if (version && !version.startsWith(PINNED_CURSOR_VERSION)) {
      throw new Error(`cursor-agent is ${version}, pinned is ${PINNED_CURSOR_VERSION} — refusing to run a mismatched harness`);
    }
    preflight = { valid: true, version };
  } catch (error) {
    teardownRunner(runnerStateDir, { jail, broker });
    throw new Error(`cursor preflight failed: ${error.message}`);
  }
  if (sweet && ssBinDir) warmupSweet({ ssBinDir, rundir, env, jail });

  // Prompt = the issue ONLY (both arms). Frame + M± live in AGENTS.md above.
  const prompt = issuePrompt(task.problem_statement);
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--force',                       // no approval prompts; the jail is the real boundary
    '--sandbox', 'disabled',         // our jail owns isolation; cursor's own sandbox would nest
    '--trust',                       // do not prompt about trusting the workspace
    '--model', apiModel,
    '--workspace', rundir,
    prompt,
  ];

  const t0 = Date.now();
  const spawnOnce = () => spawnWithTimeout('cursor-agent', args, { cwd: rundir, env, timeoutMs: perCallTimeoutMs, jail });
  let r = await spawnOnce();
  writeFileSync(path.join(retainedSession, 'attempt-1.stdout.ndjson'), String(r.stdout || ''), { mode: 0o600 });
  let parsed = parseCursorStream(r.stdout);
  let startRetried = false;
  if (isZeroCallStartFailure(r, parsed.toolCalls, parsed.answer)) {
    startRetried = true;
    console.log(`  [cursor-retry ${task.id || ''}] 0-call start failure (exit=${r.exitCode}${parsed.errors[0] ? '; ' + parsed.errors[0] : ''}) — relaunching once`);
    r = await spawnOnce();
    writeFileSync(path.join(retainedSession, 'attempt-2.stdout.ndjson'), String(r.stdout || ''), { mode: 0o600 });
    parsed = parseCursorStream(r.stdout);
  }
  const wallMs = Date.now() - t0;
  const { toolCalls, answer, turns, errors, usage, modelLabel } = parsed;
  const progressTurnMap = finalizeProgressModelTurns(progressConfig, toolCalls);

  const { toolCounts, trajectory, stepsToFirstEdit } = buildTrajectory(toolCalls);
  const rtTelemetry = runTestsTelemetry(toolCalls);
  const { finalPatch, patchHunks, patchFiles } = gitDiffPatch(rundir);

  const costs = costsFromTurns(turns, price);
  const turnsFile = persistTurns(label, turns, {
    task: task.id, arm, harness: 'cursor', model: apiModel, price, source: 'stream-aggregate',
  });
  const shimTamperedFiles = verifyIntegrity({ integrity, runnerFiles, binDir, integrityStateDir });
  if (shimTamperedFiles.length) console.log(`  [SHIM-TAMPERED ${task.id || ''}] ${shimTamperedFiles.join(', ')} — test signals untrusted`);
  const escapeAudit = auditEscape({ jail, toolCalls, rundir, endMs: Date.now() });
  teardownRunner(runnerStateDir, { jail, broker });

  const calls = toolCalls.length;
  return {
    ...controller,
    rtProgressTurnMapComplete: progressTurnMap.complete,
    cursorPreflight: preflight,
    cursorModelLabel: modelLabel,
    cursorStateDir: retainedPath(curState),
    cursorHomeDir: retainedPath(cursorHome),
    cursorConfigDir: retainedPath(cursorConfig),
    cursorRetainedDir: retainedPath(retainedSession),
    // Cursor reports ONE aggregate usage object, so this is the whole billing record for
    // the rollout — not a per-turn reconstruction. Kept raw for post-hoc repricing.
    cursorUsageRaw: usage,
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch,
    ...escapeAudit,
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0, ...rtTelemetry,
    exitReason: exitReasonFrom(r),
    usage: turns.length ? { turns: turns.length } : {},
    ...costs, turnsFile,
    wallMs, trajectory, finalAssistantText: answer,
    agentErrors: errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
