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
import { createHash } from 'node:crypto';
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
export const PACKING_TREATMENTS = Object.freeze(['off', 'ss-batch', 'parallel-bash']);
const PACKING_INSTRUCTIONS = Object.freeze({
  off: '',
  'ss-batch': [
    '=== Frozen read-only packing treatment: ss-batch-v2 ===',
    `When 2 or 3 ss-* probes are independent and every argument is already known, issue exactly one Bash command of this form: ss-batch '{"version":1,"operations":[{"id":"...","tool":"...","args":{...}}],"maxChars":16000}'.`,
    'Allowed operation tools are search, grep, find, read, semantic, and trace.',
    'Before adding ANY probe to a batch, apply this test: is every argument value already visible in the issue text or an earlier result? If an argument would come from another probe in the same batch — a path, symbol, or line range you have not yet seen — that probe is DEPENDENT: leave it out and run it alone in a later message after its prerequisite result arrives. Batching a dependent probe with a guessed argument is a hard error, never a time saving.',
  ].join('\n'),
  'parallel-bash': [
    '=== Frozen read-only packing treatment: parallel-bash-v2 ===',
    'When 2 or 3 read-only probes are independent and every argument is already known, issue them as separate Bash tool calls in the same assistant message so they can run concurrently.',
    'Do not combine them into one shell command with &, ;, or &&.',
    'Before co-issuing ANY probe, apply this test: is every argument value already visible in the issue text or an earlier result? If an argument would come from another probe in the same message, that probe is DEPENDENT: leave it out and run it alone in a later message after its prerequisite result arrives. Co-issuing a dependent probe with a guessed argument is a hard error, never a time saving.',
  ].join('\n'),
});
export { rolloutStateDir };

export function resolvePackingTreatment(env = process.env) {
  const treatment = String(env.SS_PACKING_TREATMENT || 'off').trim();
  if (!PACKING_TREATMENTS.includes(treatment)) {
    throw new Error('SS_PACKING_TREATMENT must be off, ss-batch, or parallel-bash');
  }
  return treatment;
}

export function packingTreatmentRowFields({ sweet, env = process.env } = {}) {
  const treatment = resolvePackingTreatment(env);
  if (!sweet && treatment !== 'off') throw new Error('packing treatment is valid only for the sweet arm');
  const instruction = sweet ? PACKING_INSTRUCTIONS[treatment] : '';
  return {
    packingTreatment: sweet ? treatment : 'off',
    packingInstructionSha256: createHash('sha256').update(instruction).digest('hex'),
  };
}

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
  label = 'rollout', taskId = null, arm = null, extraBinds = [], extraMasks = [],
  isolate = ISOLATION_ON, requireBins = [], injectedFiles = [], installSeds = [],
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
    stateDir: ipcStateDir, _isAgentFormat: sweet, label, taskId, arm, injectedFiles,
    installSeds,
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
  return {
    runnerStateDir, binDir, runnerFiles, integrity, realDocker, jail, broker,
    dedupLog: shimInfo.dedupLog || null, controller: shimInfo.controller,
    progressConfig: shimInfo.progressConfig,
    integrityStateDir: isolate ? runnerStateDir : undefined,
  };
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
    // With the model cache prewarmed, a cache miss must fail fast — never retry
    // DNS/TLS against the jail's deny-all egress (the 39s-cold-query / polluted
    // escape-counter incident, TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md §7).
    // Symmetric on both arms; harmless where sweet tooling never runs.
    SWEET_SEARCH_OFFLINE: '1',
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

// Frame-level plan/reflect clause (both arms) — the V1 micro-smoke content that
// flipped raml 0/2→2/2, re-homed per the M±-generality rule (bench-specific
// completion discipline belongs in the FRAME, never M±). Env-gated so the
// default frame stays byte-identical; run_tests naming is legitimate here.
export const FRAME_REFLECT_TEXT =
  '\n\nWORK DISCIPLINE: Before each source edit, state in one sentence which file(s) you will ' +
  'change and why. After each `run_tests` result, state in one sentence what it proves before ' +
  'acting again. Extended read-only analysis is not progress — once you have located the cause, ' +
  'commit to a testable edit.';
export function frameReflectText(env = process.env) {
  return env.SS_FRAME_REFLECT === '1' ? FRAME_REFLECT_TEXT : '';
}

// Checkpoint clause (both arms) — targets the Coherence-Collapse self-revert:
// agents that reach a passing state then destroy it (py-cov `git checkout` of
// its own fix). Bench-completion content → frame, per the M±-generality rule.
export const FRAME_CHECKPOINT_TEXT =
  '\n\nPROTECT WORKING STATE: once `run_tests` shows the previously-failing test PASSES, you are ' +
  'done — submit. Do not revert, `git checkout`, rewrite, or "improve" a change that already ' +
  'made the target test pass; a later edit that breaks it is a regression, not progress. If you ' +
  'must keep editing, never discard the passing version.';
// V2/V3 target the OBSERVED miss: C's "don't revert" half worked (self-reverts
// 1→0) but the agent kept editing past a green run and the final state failed.
export const FRAME_CHECKPOINT_V2 =
  '\n\nSTOP AT FIRST GREEN: the moment `run_tests` shows the target test PASS, you are finished — ' +
  'your next action must be to submit. Do NOT make another edit. Editing after a passing run is the ' +
  'single most common way agents turn a solved task into a failed one: every extra edit past green ' +
  'can only break what already works. If you believe more is needed, submit anyway and stop.';
export const FRAME_CHECKPOINT_V3 =
  '\n\nWORKING STATE IS FRAGILE: when `run_tests` first shows the target test PASS, treat that exact ' +
  'code state as your answer and submit it. Do not revert it, rewrite it, or keep editing to "improve" ' +
  'it. If a further change truly seems needed, make it ONE minimal edit and re-run tests; if the result ' +
  'is not still green, undo that last edit only — never the fix that first passed.';
const FRAME_CHECKPOINT_VARIANTS = { '1': FRAME_CHECKPOINT_TEXT, v1: FRAME_CHECKPOINT_TEXT, v2: FRAME_CHECKPOINT_V2, v3: FRAME_CHECKPOINT_V3 };
export function frameCheckpointText(env = process.env) {
  const sel = String(env.SS_FRAME_CHECKPOINT || '').trim();
  return FRAME_CHECKPOINT_VARIANTS[sel] || '';
}

// The full agent prompt: completion frame (both arms) + M++ retrieval guidance (sweet
// only, bracketed so completion authority wins) + the issue. Identical assembly to codex.
export function buildPrompt({ sweet, mppText, problemStatement }) {
  const antiThrash = process.env.SS_NO_ANTITHRASH ? '' : ANTI_THRASH_TEXT;
  const packing = packingTreatmentRowFields({ sweet });
  const packingGuidance = sweet && packing.packingTreatment !== 'off'
    ? `\n\n${PACKING_INSTRUCTIONS[packing.packingTreatment]}` : '';
  const sweetGuidance = sweet
    ? `\n\n=== Code-search expertise — use the ss-* commands (ss-search / ss-grep / ss-find / ss-read / ss-semantic / ss-trace) per this guidance; this is your advantage, use it to locate code in fewer, sharper steps ===\n${mppText}${antiThrash}${packingGuidance}`
    : '';
  return `${FRAME_OPEN}${sweetGuidance}\n\n${FRAME_CLOSE}${frameReflectText()}${frameCheckpointText()}\n\n=== ISSUE ===\n${problemStatement || ''}`;
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
      modelTurn: Number.isInteger(tc.modelTurn) ? tc.modelTurn : null,
      messageId: tc.messageId || null,
    });
  });
  return { toolCounts, trajectory, stepsToFirstEdit };
}

// Default instruction-file assembly for Codex/OpenCode = frame + M± (sweet) /
// frame only (native), delivered through AGENTS.md. Claude's adapter deliberately
// calls this with sweet:false so CLAUDE.md contains only the benchmark frame and
// writes M± to Claude's auto-loaded project rule instead. Injected instruction
// surfaces are excluded from the graded patch.
export function buildInstructionFile({ sweet, mppText, env = process.env }) {
  const packing = packingTreatmentRowFields({ sweet, env });
  const treatment = packing.packingTreatment === 'off'
    ? '' : `\n\n${PACKING_INSTRUCTIONS[packing.packingTreatment]}`;
  return `${FRAME_OPEN}${sweet ? `\n\n${mppText}${treatment}` : ''}\n\n${FRAME_CLOSE}${frameReflectText(env)}`;
}
export function writeInstructionFile(rundir, fileName, { sweet, mppText, env = process.env }) {
  appendFileSync(path.join(rundir, fileName), `\n\n${buildInstructionFile({ sweet, mppText, env })}\n`);
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

// Costs from per-turn usage. turns = [{in, cached, cacheWrite?, out}] in order, `in` = FULL context at
// that turn (growing prefix), cached tokens included. All columns come from ONE source so
// they can never drift.
//
// THE FOUR COST COLUMNS (PLAN.md §3 B4 — these definitions are now identical in every
// adapter; they were not, and a cross-harness comparison of `costNaiveUsd` produced
// nonsense: codex appeared to have $602 of "content" against $144 realized):
//
//   costNaiveUsd    every input token at the full input rate + output. What the run WOULD
//                   have cost with caching disabled. Charges the re-sent prefix again on
//                   every turn, so naive ≫ realized on any long trajectory.
//   costRealizedUsd what we actually paid: cached tokens at the cache-read rate.
//   idealCostUsd    cache-normalized: ALL re-sent prefix charged at the cache-read rate
//                   regardless of whether the provider cache actually hit. Removes
//                   cache-TTL luck, so A/B deltas reflect trajectory shape.
//   costContentUsd  UNIQUE context only: each input token charged once, at first
//                   appearance, + output. This is `content = ideal − R·cache/1e6` from
//                   §3 B4 — the quantity that isolates "how much new material did this
//                   arm introduce" from "how many times did it re-send it". It is what
//                   the opencode adapter used to publish under the name costNaiveUsd.
//
// Only costContentUsd needs the growing-prefix structure; the other three are per-turn
// sums. An adapter with aggregate-only usage must report costContentUsd as null rather
// than substituting one of the others.
export function costsFromTurns(turns, price) {
  const { idealUsd, realFromTurnsUsd, breakPricedUsd, contextRewrites } = costFromTurns(turns, price);
  let prevIn = 0, naive = 0, content = 0;
  for (const tu of turns) {
    const newIn = Math.max(0, tu.in - prevIn);                 // context first seen this turn
    naive += (tu.in * price.in + tu.out * price.out) / 1e6;     // no cache at all
    content += (newIn * price.in + tu.out * price.out) / 1e6;   // each token charged once
    prevIn = tu.in;
  }
  return {
    costRealizedUsd: +realFromTurnsUsd.toFixed(6),
    idealCostUsd: +idealUsd.toFixed(6),
    realFromTurnsUsd: +realFromTurnsUsd.toFixed(6),
    // breakPriced is the honest column when a lever can break the prefix cache; codex has
    // published it since 2026-08-10 and the default analyzer reads it, so every adapter
    // that has a real turn distribution must publish it too or its rows silently fall back
    // to cache-lucky numbers in a cross-harness table.
    breakPricedCostUsd: +breakPricedUsd.toFixed(6),
    contextRewrites,
    costNaiveUsd: +naive.toFixed(6),
    costContentUsd: +content.toFixed(6),
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
