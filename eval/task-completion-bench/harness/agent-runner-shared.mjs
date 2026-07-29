// Shared, harness-agnostic plumbing for the task-completion bench's agent adapters
// (codex / claude-code / opencode). Everything here is identical across harnesses so the
// only arm asymmetry stays "sweet = + ss-* on PATH + M++". The heavy shim/integrity/
// wrapper machinery is imported (not duplicated) from codex-task-runner.mjs — its
// exported helpers are already unit-proven and Codex-API-free; the frame text is imported
// from there too so all three harnesses inject BYTE-IDENTICAL prompts.
//
// Broker mode follows ISOLATION. Historically it was OFF here: unlike `codex exec`
// (mandatory Linux sandbox that denies unix sockets), Claude Code and opencode run their
// shell tools UNSANDBOXED, so the run_tests shim reached /var/run/docker.sock directly.
// That direct reach IS escape vector V5 — the task images carry the fix commit, and the
// forensics caught `git show <fix-sha>` and `docker cp` of an image tree being used to
// write the gold patch. Under the jail there is no docker socket and no docker client, so
// every harness now goes through the host-side broker: run_tests takes no arguments, so
// the agent cannot pass docker args at all.
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ISOLATION_ON, startJail, stopJail, jailArgv, jailEnv, jailDenials, rolloutStateDir } from './agent-jail.mjs';
import { auditRollout, UNAUDITED } from './escape-audit.mjs';
import {
  FRAME_OPEN, FRAME_CLOSE, ANTI_THRASH_TEXT,
  writeRunTestsShim, installCommandWrappers, shimIntegritySnapshot,
  verifyShimIntegrity, verifyRunnerDirectoryIntegrity,
} from './codex-task-runner.mjs';
import { priceFor, costFromTurns } from './ideal-cost.mjs';

export { FRAME_OPEN, FRAME_CLOSE, priceFor, costFromTurns };

const DOCKER_HOST = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock';
const L1_CONDENSE = process.env.SS_NO_CMD_CONDENSE !== '1';
const L2_RT_AUTHORITY = process.env.SS_NO_RT_AUTHORITY !== '1';
export { rolloutStateDir };

// --network for the run_tests test container (both arms). Identical to codex's compute.
export function computeNetArgs(t) {
  const NET_LOCKDOWN = process.env.SS_BENCH_ALLOW_NET !== '1';
  const extra = (t._dockerRunArgs || []).join(' ');
  if (NET_LOCKDOWN) {
    return `--network ${t._network === 'bridge' ? 'bridge' : 'none'} ${extra}`.trim() + ' ';
  }
  return extra ? extra + ' ' : '';
}

// Set up the per-attempt runner bin dir: the run_tests shim + the L1 docker
// output-condenser wrapper, all integrity-snapshotted, plus (when isolation is on) the
// rollout's jail. Returns everything the adapter needs to run + later verify + tear down.
//
// Under isolation the shim runs in BROKER mode and a long-lived broker process is
// spawned on the host: the agent has no docker socket, so the only way to a test result
// is a parameter-free request through the IPC dir.
export function setupRunner({
  image, workdir, testScript, rundir, testTimeoutSec = 300, netArgs = '', sweet = false,
  label = 'rollout', extraBinds = [], extraMasks = [], isolate = ISOLATION_ON, requireBins = [],
}) {
  const runnerStateDir = mkdtempSync(path.join(tmpdir(), 'sweet-search-runner-'));
  const binDir = path.join(runnerStateDir, 'bin');
  let realDocker = 'docker';
  try { realDocker = execSync('command -v docker', { encoding: 'utf8' }).trim() || 'docker'; } catch { /* bare docker */ }
  // Broker IPC must live in runnerStateDir, NOT binDir: verifyRunnerDirectoryIntegrity
  // treats every unexpected entry in binDir as tampering, so an `_rt_ipc` dir there
  // would mark every rollout SHIM-TAMPERED, force the policy re-run, and then exclude
  // the run. Same placement codex has always used.
  const ipcStateDir = isolate ? runnerStateDir : binDir;
  const shimInfo = writeRunTestsShim(binDir, {
    image, workdir, testScript, rundir, testTimeoutSec,
    netArgs, brokerMode: isolate, dockerBin: realDocker, rtAuthority: L2_RT_AUTHORITY,
    stateDir: ipcStateDir, _isAgentFormat: sweet,
  });
  let wrapperFiles = [];
  if (L1_CONDENSE) {
    try { wrapperFiles = Object.values(installCommandWrappers(binDir, { realDocker })); }
    catch (e) { console.error(`  [L1] wrapper install skipped: ${String(e.message).slice(0, 100)}`); }
  }
  const runnerFiles = [...(shimInfo.files || []), ...wrapperFiles];
  const integrity = shimIntegritySnapshot(runnerFiles);
  // The broker runs OUTSIDE the jail (it needs docker); the agent reaches it only
  // through the bind-mounted IPC dir.
  const broker = (isolate && shimInfo.brokerPath)
    ? spawn(process.execPath, [shimInfo.brokerPath], { stdio: 'ignore' })
    : null;
  const jail = isolate
    ? startJail({ rundir, runnerStateDir, label, extraBinds, extraMasks, requireBins })
    : null;
  // In broker mode the IPC dir is also checked (requests must be fully consumed by exit);
  // without a broker there is no _rt_ipc and the stateDir check is skipped, as before.
  return { runnerStateDir, binDir, runnerFiles, integrity, realDocker, jail, broker, integrityStateDir: isolate ? runnerStateDir : undefined };
}

// PATH = [binDir, ss-* (sweet only), ...host]; + SWEET_SEARCH_PROJECT_ROOT + DOCKER_HOST.
// extraEnv lets an adapter add provider routing vars (e.g. ANTHROPIC_BASE_URL).
// Under a jail, DOCKER_HOST is stripped: there is no socket to point at.
export function buildAgentEnv({ rundir, binDir, ssBinDir, sweet, extraEnv = {}, jail = null }) {
  const pathDirs = [binDir, sweet ? ssBinDir : null].filter(Boolean);
  const env = {
    ...process.env,
    PATH: [...pathDirs, process.env.PATH].join(':'),
    SWEET_SEARCH_PROJECT_ROOT: rundir,
    DOCKER_HOST,
    ...extraEnv,
  };
  return jail ? jailEnv(env) : env;
}

// Off-clock: arm the sweet arm's per-run ss-* model server before the measured loop, so
// the cold-start model-load banner never lands in the agent's first ss-* stdout.
// This MUST run inside the same jail as the agent — a server warmed on the host lives in
// a different mount namespace, so its socket would be invisible to the agent and the
// sweet arm would silently eat a cold start on every rollout.
export function warmupSweet({ ssBinDir, rundir, env, jail = null }) {
  if (!ssBinDir) return;
  const bin = path.join(ssBinDir, 'ss-search');
  const [b, a] = jail ? jailArgv(jail, bin, ['warmup', '-k', '1'], rundir) : [bin, ['warmup', '-k', '1']];
  try { execSync([b, ...a].map(s => `'${String(s).replace(/'/g, "'\\''")}'`).join(' '), { cwd: rundir, env, stdio: 'ignore', timeout: 120000 }); }
  catch { /* best-effort */ }
}

// The full agent prompt: completion frame (both arms) + M++ retrieval guidance (sweet
// only, bracketed so completion authority wins) + the issue. Identical assembly to codex.
export function buildPrompt({ sweet, mppText, problemStatement }) {
  const antiThrash = process.env.SS_NO_ANTITHRASH ? '' : ANTI_THRASH_TEXT;
  const sweetGuidance = sweet
    ? `\n\n=== Code-search expertise — use the ss-* commands (ss-search / ss-grep / ss-find / ss-read / ss-semantic / ss-trace) per this guidance; this is your advantage, use it to locate code in fewer, sharper steps ===\n${mppText}${antiThrash}`
    : '';
  return `${FRAME_OPEN}${sweetGuidance}\n\n${FRAME_CLOSE}\n\n=== ISSUE ===\n${problemStatement || ''}`;
}

// Aggregate a normalized toolCalls list ([{kind, command, resultText, isError}]) into
// toolCounts + a bounded trajectory + stepsToFirstEdit. classifyFn maps one call → bucket.
export function buildTrajectory(toolCalls) {
  const toolCounts = { ss: 0, nativeGrep: 0, nativeRead: 0, edit: 0, bash: 0, test: 0 };
  const trajectory = [];
  let stepsToFirstEdit = null;
  toolCalls.forEach((tc, i) => {
    const kind = tc.kind || 'bash';
    toolCounts[kind] = (toolCounts[kind] || 0) + 1;
    if (kind === 'edit' && stepsToFirstEdit === null) stepsToFirstEdit = i + 1;
    trajectory.push({
      call: i + 1, name: kind, kind,
      input: String(tc.command || '').slice(0, 200),
      result: String(tc.resultText || '').slice(0, 600),
      isError: !!tc.isError,
    });
  });
  return { toolCounts, trajectory, stepsToFirstEdit };
}

// Default instruction-file assembly for Codex/OpenCode = frame + M± (sweet) /
// frame only (native), delivered through AGENTS.md. Claude's adapter deliberately
// calls this with sweet:false so CLAUDE.md contains only the benchmark frame and
// writes M± to Claude's auto-loaded project rule instead. Injected instruction
// surfaces are excluded from the graded patch.
export function buildInstructionFile({ sweet, mppText }) {
  return `${FRAME_OPEN}${sweet ? `\n\n${mppText}` : ''}\n\n${FRAME_CLOSE}`;
}
export function writeInstructionFile(rundir, fileName, { sweet, mppText }) {
  appendFileSync(path.join(rundir, fileName), `\n\n${buildInstructionFile({ sweet, mppText })}\n`);
}
// The prompt is the issue ONLY (both arms) — the frame lives in the instruction file above.
export function issuePrompt(problemStatement) {
  return `=== ISSUE ===\n${problemStatement || ''}`;
}

// Authoritative patch from git diff (counts edits even if not visible as tool calls).
// Excludes the sweet-search index and every benchmark instruction surface so
// neither arm's injected frame/policy appears in the graded patch.
export function gitDiffPatch(rundir) {
  let finalPatch = '';
  try {
    finalPatch = execSync(
      `git -C ${rundir} diff HEAD -- . ':(exclude).sweet-search' ':(exclude)CLAUDE.md' `
      + `':(exclude)AGENTS.md' ':(exclude).claude/rules/sweet-search.md'`,
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {}
  const patchHunks = (finalPatch.match(/^@@ /gm) || []).length;
  const patchFiles = (finalPatch.match(/^diff --git /gm) || []).length;
  return { finalPatch, patchHunks, patchFiles };
}

// Tamper detection: shim mutation + injected runner/cache files (non-broker: no _rt_ipc,
// so stateDir is intentionally omitted from the directory check).
export function verifyIntegrity({ integrity, runnerFiles, binDir, integrityStateDir, allowedStateEntries = [] }) {
  return [
    ...verifyShimIntegrity(integrity),
    ...verifyRunnerDirectoryIntegrity({ binDir, expectedFiles: runnerFiles, stateDir: integrityStateDir, allowedStateEntries }),
  ];
}

// Tear down in dependency order: the jail first (its PID namespace death takes every
// ss-* server and index maintainer with it — no orphan can outlive its rollout), then
// the broker, then the state dir the two shared.
export function teardownRunner(runnerStateDir, { jail = null, broker = null } = {}) {
  try { stopJail(jail); } catch {}
  if (broker) { try { broker.kill('SIGKILL'); } catch {} }
  try { rmSync(runnerStateDir, { recursive: true, force: true }); } catch {}
}

// The escape audit every CLI adapter returns instead of the old hardcoded `escape: 0`.
export function auditEscape({ jail, toolCalls, rundir, endMs }) {
  if (!jail) return { ...UNAUDITED };
  return auditRollout({ toolCalls, rundir, denials: jailDenials(jail, endMs) });
}

// Costs from per-turn usage. turns = [{in, cached, out}] in order, `in` = FULL context at
// that turn (growing prefix). Realized = actual cache; ideal = cache-normalized; naive =
// no cache. All three columns from ONE source so they can never drift.
export function costsFromTurns(turns, price) {
  const { idealUsd, realFromTurnsUsd } = costFromTurns(turns, price);
  let prevIn = 0, naive = 0;
  for (const tu of turns) {
    const newIn = Math.max(0, tu.in - prevIn);
    naive += (newIn * price.in + tu.out * price.out) / 1e6;   // no-cache: charge only fresh input
    prevIn = tu.in;
  }
  return {
    costRealizedUsd: +realFromTurnsUsd.toFixed(6),
    idealCostUsd: +idealUsd.toFixed(6),
    realFromTurnsUsd: +realFromTurnsUsd.toFixed(6),
    costNaiveUsd: +naive.toFixed(6),
    idealTurns: turns.length,
  };
}

// Generic single-process CLI lifecycle with a wall-clock timeout (SIGTERM → SIGKILL 2s).
// Every adapter's agent is one CLI spawn (like `codex exec`), so this is shared verbatim.
//
// With a jail, the spawned process is `nsenter`, whose in-namespace child is NOT killed
// by signalling the wrapper. So the timeout path also kills the jail's init: the PID
// namespace dies and the agent goes with it. Without that, a timed-out agent would keep
// editing the checkout while we were computing its final patch.
export function spawnWithTimeout(bin, args, { cwd, env, timeoutMs, jail = null }) {
  if (jail) [bin, args] = jailArgv(jail, bin, args, cwd);
  return new Promise((resolve) => {
    let stdout = '', stderr = '', timedOut = false;
    const proc = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      if (jail) { try { process.kill(jail.initPid, 'SIGKILL'); } catch {} }
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 2000).unref();
    }, timeoutMs);
    proc.stdout.on('data', d => stdout += d.toString('utf8'));
    proc.stderr.on('data', d => stderr += d.toString('utf8'));
    proc.on('error', e => { clearTimeout(timer); resolve({ stdout, stderr: stderr + e.message, exitCode: -1, timedOut }); });
    proc.on('exit', code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? 0, timedOut }); });
  });
}

// Canonical exit-reason mapping shared by adapters.
export function exitReasonFrom({ timedOut, exitCode }) {
  if (timedOut) return 'timeout';
  if (exitCode !== 0) return 'agent_error';
  return 'model_stopped';
}
