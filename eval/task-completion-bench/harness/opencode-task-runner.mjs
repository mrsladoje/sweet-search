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
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isZeroCallStartFailure } from './codex-task-runner.mjs';
import {
  setupRunner, buildAgentEnv, warmupSweet, issuePrompt, computeNetArgs, writeInstructionFile,
  buildTrajectory, gitDiffPatch, verifyIntegrity, teardownRunner, auditEscape, rolloutStateDir,
  costsFromTurns, spawnWithTimeout, exitReasonFrom, priceFor,
} from './agent-runner-shared.mjs';
import { persistTurns } from './turn-log.mjs';
import { finalizeProgressModelTurns } from './rt-progress-controller.mjs';

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const retainedPath = file => path.relative(BENCH_DIR, file);
export const PINNED_OPENCODE_VERSION = '1.18.4';

export function retainOpencodeAttempt(directory, attempt, result, { secrets = [] } = {}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stdout = path.join(directory, `attempt-${attempt}.stdout.ndjson`);
  const stderr = path.join(directory, `attempt-${attempt}.stderr.txt`);
  const redact = value => {
    let text = String(value || ''), detected = false;
    for (const secret of secrets) if (secret && text.includes(secret)) {
      detected = true; text = text.replaceAll(secret, '[REDACTED]');
    }
    return { text, detected };
  };
  const safeStdout = redact(result?.stdout), safeStderr = redact(result?.stderr);
  writeFileSync(stdout, safeStdout.text, { mode: 0o600 });
  writeFileSync(stderr, safeStderr.text, { mode: 0o600 });
  return {
    stdout: retainedPath(stdout), stderr: retainedPath(stderr),
    secretLeakDetected: safeStdout.detected || safeStderr.detected,
  };
}

function parseResolvedConfig(stdout) {
  const clean = String(stdout || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  try { return JSON.parse(clean); } catch {
    const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error('opencode debug config did not return JSON');
  }
}

function sanitizedConfig(value) {
  if (Array.isArray(value)) return value.map(sanitizedConfig);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /api.?key|token|secret|password|authorization/i.test(key)
      ? '[REDACTED]' : sanitizedConfig(item),
  ]));
}

export function validateMainOpencodePreflight({ version, resolved }) {
  const versionPattern = new RegExp(`(^|\\D)${PINNED_OPENCODE_VERSION.replaceAll('.', '\\.')}($|\\D)`);
  if (!versionPattern.test(String(version || ''))) {
    throw new Error(`pinned OpenCode ${PINNED_OPENCODE_VERSION} is unavailable`);
  }
  if (!resolved || typeof resolved !== 'object' || !Array.isArray(resolved.plugin)
      || resolved.plugin.length !== 0) throw new Error('ambient OpenCode plugin detected');
  return true;
}

// Runner-enforced hard turn budget (EDIT_THRASHING §7). OpenCode's own loop
// stops at agent.build.maxSteps — no model cooperation involved, which is the
// point: Grok-4.5 ignores mid-task behavioral instructions in every channel
// (TURNFIX results doc §12.5), so the only reliable tail cap is one the runner
// owns. Absent/invalid env → config byte-identical to the pre-cap harness.
export function resolveHardTurnCap(env = process.env) {
  const raw = String(env.SS_HARD_TURN_CAP || '').trim();
  if (!raw) return null;
  const cap = Number(raw);
  if (!Number.isInteger(cap) || cap < 5 || cap > 500) {
    throw new Error('SS_HARD_TURN_CAP must be an integer between 5 and 500');
  }
  return cap;
}

export function buildMainOpencodeConfig({ env = process.env } = {}) {
  const cap = resolveHardTurnCap(env);
  return {
    $schema: 'https://opencode.ai/config.json',
    plugin: [],
    provider: { openrouter: { options: { apiKey: '{env:OPENROUTER_API_KEY}' } } },
    permission: { bash: 'allow', edit: 'allow', write: 'allow', read: 'allow', webfetch: 'deny', websearch: 'deny' },
    ...(cap ? { agent: { build: { maxSteps: cap } } } : {}),
  };
}

function classifyShell(cmd) {
  const c = String(cmd || '').trim();
  if (/^run_tests\b/.test(c)) return 'test';
  if (/^(ss[-_](search|grep|find|read|semantic|trace|batch)|sweet-search)\b/.test(c)) return 'ss';
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
  const calls = new Map();
  const callOrder = [];
  const turns = [];
  const errors = [];
  let answer = '';
  let sessionID = null;
  if (!stdout) return { toolCalls: [], answer, turns, errors, sessionID };
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
      const callId = String(p.callID || p.callId || st.callID || st.callId || `line-${callOrder.length}`);
      const prior = calls.get(callId);
      if (!prior) callOrder.push(callId);
      calls.set(callId, {
        kind, command,
        resultText: typeof out === 'string' ? out : JSON.stringify(out || '').slice(0, 600),
        isError: status === 'error', modelTurn: prior?.modelTurn ?? (turns.length + 1),
        messageId: p.messageID || p.messageId || p.message_id
          || ev.messageID || ev.messageId || ev.message_id || prior?.messageId || null,
      });
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
  return { toolCalls: callOrder.map(id => calls.get(id)), answer, turns, errors, sessionID };
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
  const retainedRoot = rolloutStateDir(label, 'opencode-retained');
  const retainedSession = path.join(retainedRoot, `session-${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(retainedSession, { recursive: true, mode: 0o700 });
  const ambientConfigDir = path.join(process.env.HOME || '/root', '.config/opencode');
  const extraBinds = [
    { src: path.join(process.env.HOME || '/root', '.cache/opencode'), dst: path.join(process.env.HOME || '/root', '.cache/opencode'), ro: true },
    { src: ocData, dst: path.join(process.env.HOME || '/root', '.local/share/opencode') },
  ];
  // Inject before runner setup so T0 can fingerprint this harness-owned surface and
  // distinguish it from a later agent modification without retaining it in checkpoints.
  writeInstructionFile(rundir, 'AGENTS.md', { sweet, mppText });
  const {
    runnerStateDir, binDir, runnerFiles, integrity, jail, broker, integrityStateDir, controller,
    progressConfig,
  } = setupRunner({
    image, workdir, testScript, rundir, testTimeoutSec: t._testTimeoutSec || 300, netArgs, sweet,
    label, taskId: task.id, arm, extraBinds, extraMasks: [ambientConfigDir], requireBins: ['opencode'],
    injectedFiles: ['AGENTS.md'],
  });
  // Per-run opencode config: OpenRouter provider (key via {env:} substitution) + permissive
  // permissions so the headless agent edits/bashes without prompts (the #13851 write-gap
  // mitigation is `build` agent + explicit allow + --auto), and web tools denied (host
  // /etc/hosts lockdown already blocks egress, this stops opencode's own fetch/search).
  const ocConfig = path.join(runnerStateDir, 'opencode.json');
  const ocConfigValue = buildMainOpencodeConfig();
  const ocConfigText = JSON.stringify(ocConfigValue);
  writeFileSync(ocConfig, ocConfigText);
  const retainedConfig = path.join(retainedSession, 'opencode.generated.json');
  writeFileSync(retainedConfig, ocConfigText + '\n', { mode: 0o600 });

  // PLAN.md §3 B6 (2026-07-30): opencode's bash tool defaults to a 120 s timeout
  // (`bashDefaultTimeoutMs ?? 120000` in the bundle) while the harness gives a suite
  // 300 s and the run_tests requester waits `2*tSec+120` for the broker's baseline+current
  // pair. A 120 s agent-side kill therefore orphans the broker's response on ANY suite over
  // two minutes — which reads as `shimTampered`, forces the policy re-run, and can exclude
  // the task. Raise it above the requester deadline so the harness's own budget is the only
  // thing that can time a test run out. Caller-overridable; opencode ignores the var if a
  // future build drops it, in which case the 120 s default is back and B6 reopens.
  const rtDeadlineSec = 2 * (t._testTimeoutSec || 300) + 120;
  const agentBashTimeoutMs = Number(process.env.SS_AGENT_BASH_TIMEOUT_MS) || (rtDeadlineSec + 60) * 1000;
  const env = buildAgentEnv({
    rundir, binDir, ssBinDir, sweet, jail,
    extraEnv: {
      OPENCODE_CONFIG: ocConfig,
      OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: String(agentBashTimeoutMs),
    },
  });
  let preflight;
  try {
    const versionResult = await spawnWithTimeout('opencode', ['--version'], {
      cwd: rundir, env, timeoutMs: 30_000, jail,
    });
    const configResult = await spawnWithTimeout('opencode', ['debug', 'config'], {
      cwd: rundir, env, timeoutMs: 30_000, jail,
    });
    if (versionResult.exitCode !== 0 || versionResult.timedOut
        || configResult.exitCode !== 0 || configResult.timedOut) {
      throw new Error('OpenCode preflight process failed');
    }
    const resolved = parseResolvedConfig(configResult.stdout);
    validateMainOpencodePreflight({ version: versionResult.stdout, resolved });
    const apiKey = String(process.env.OPENROUTER_API_KEY || '');
    let safeResolved = JSON.stringify(sanitizedConfig(resolved));
    if (apiKey) safeResolved = safeResolved.replaceAll(apiKey, '[REDACTED]');
    const resolvedPath = path.join(retainedSession, 'opencode.resolved.sanitized.json');
    writeFileSync(resolvedPath, safeResolved + '\n', { mode: 0o600 });
    preflight = {
      valid: true, version: PINNED_OPENCODE_VERSION, pluginCount: 0,
      resolvedConfigPath: retainedPath(resolvedPath),
      resolvedConfigSha256: createHash('sha256').update(safeResolved).digest('hex'),
    };
  } catch (error) {
    teardownRunner(runnerStateDir, { jail, broker });
    throw new Error(`OpenCode exact-config preflight failed: ${error.message}`);
  }
  if (sweet && ssBinDir) warmupSweet({ ssBinDir, rundir, env, jail });

  // Prompt = the issue ONLY (both arms). Frame + M± live in AGENTS.md above.
  const prompt = issuePrompt(task.problem_statement);
  const args = ['run', '--format', 'json', '--agent', 'build', '--auto', '--model', openrouterModel, '--dir', rundir, prompt];

  const t0 = Date.now();
  const spawnOnce = () => spawnWithTimeout('opencode', args, { cwd: rundir, env, timeoutMs: perCallTimeoutMs, jail });
  let r = await spawnOnce();
  const retentionOptions = { secrets: [process.env.OPENROUTER_API_KEY] };
  const rawAttempts = [retainOpencodeAttempt(retainedSession, 1, r, retentionOptions)];
  let parsed = parseOpencodeStream(r.stdout);
  let startRetried = false;
  if (isZeroCallStartFailure(r, parsed.toolCalls, parsed.answer)) {
    startRetried = true;
    console.log(`  [opencode-retry ${task.id || ''}] 0-call start failure (exit=${r.exitCode}${parsed.errors[0] ? '; ' + parsed.errors[0] : ''}) — relaunching once`);
    r = await spawnOnce();
    rawAttempts.push(retainOpencodeAttempt(retainedSession, 2, r, retentionOptions));
    parsed = parseOpencodeStream(r.stdout);
  }
  const wallMs = Date.now() - t0;
  const { toolCalls, answer, turns, errors } = parsed;
  const progressTurnMap = finalizeProgressModelTurns(progressConfig, toolCalls);

  const { toolCounts, trajectory, stepsToFirstEdit } = buildTrajectory(toolCalls);
  const { finalPatch, patchHunks, patchFiles } = gitDiffPatch(rundir);
  const apiKeyLeak = String(process.env.OPENROUTER_API_KEY || '');
  const secretLeakDetected = rawAttempts.some(attempt => attempt.secretLeakDetected)
    || (apiKeyLeak && finalPatch.includes(apiKeyLeak));
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
  if (secretLeakDetected) throw new Error('secret-leak tripwire fired; retained text was redacted');

  const calls = toolCalls.length;
  return {
    ...controller,
    rtProgressTurnMapComplete: progressTurnMap.complete,
    openCodePreflight: preflight,
    openCodeConfigPath: retainedPath(retainedConfig),
    openCodeConfigSha256: createHash('sha256').update(ocConfigText).digest('hex'),
    openCodeRawAttempts: rawAttempts,
    openCodeDataDir: retainedPath(ocData),
    secretLeakDetected: false,
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch,
    ...escapeAudit,
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0,
    hardTurnCap: resolveHardTurnCap(),
    budgetExhausted: resolveHardTurnCap() !== null && turns.length >= resolveHardTurnCap(),
    exitReason: exitReasonFrom(r),
    usage: turns.length ? { turns: turns.length } : {},
    ...costs, turnsFile,
    wallMs, trajectory, finalAssistantText: answer,
    agentErrors: errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
