// Codex harness for the task-completion bench: runs `codex exec` as the agent loop
// (a real production coding agent) instead of the bare-API ReAct loop. Clean ablation:
//   - native arm: vanilla Codex (its own shell tools); NO M++, NO ss-* on PATH.
//   - sweet arm:  Codex + M++ appended (systemAppend) + ss-* wrappers on PATH.
// Shared, tool-agnostic plumbing for BOTH arms: a `run_tests` shim, because Codex's
// shell (the box) lacks the repo's deps — tests must run in the task's Docker image
// (exactly like the bare harness's run_tests tool). Returns the same row shape as
// api-task-runner.runTask so grading/metrics are identical.
import { spawn } from 'node:child_process';
import { execSync, execFileSync } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync,
  copyFileSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverIdealCost, rolloutFilesForRundir, turnsFromRollout, costFromTurns, priceFor, PRICE as IDEAL_PRICE } from './ideal-cost.mjs';
import { persistTurns } from './turn-log.mjs';
import { runTestsTelemetry } from './rt-inflight.mjs';
import { brokerRequesterSource, directShimSource } from './rt-shim-text.mjs';
// Isolation is imported DIRECTLY (not via agent-runner-shared) because that module
// imports this one — going through it would close an import cycle.
import { ISOLATION_ON, startJail, stopJail, jailArgv, jailEnv, jailDenials, rolloutStateDir } from './agent-jail.mjs';
import { auditRollout, UNAUDITED } from './escape-audit.mjs';
// L3 run_tests dedup: only the cheap path/session helpers are needed here — the shim
// runtime (which pulls in the code-graph repository) is never imported by the harness.
import { RT_DEDUP_ON, dedupLogPathFor, startDedupSession } from './rt-dedup.mjs';
import {
  createProgressRunConfig, progressRowFields, resolveProgressFlags,
} from './rt-progress-controller.mjs';
// Single source of truth for which install steps the GRADER re-applies
// (eval.py --reapply-install-seds). The run_tests shim must apply the same set, or the
// agent and the grader see different environments. Pure helper — no import cycle.
import { installSedCmds } from './env-ledger.mjs';

// Inlined from p7-codex-runner.mjs (kept self-contained so the bench doesn't depend on
// the prompt-optimization context being present/committed on the run host).
export function parseCodexAgentStream(stdout) {
  const toolCalls = []; let answer = ''; let usage = null; const errors = [];
  if (!stdout) return { toolCalls, answer, usage, errors };
  for (const line of stdout.split('\n')) {
    const tl = line.trim();
    if (!tl || tl[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tl); } catch { continue; }
    if (ev.type === 'item.completed' && ev.item) {
      const it = ev.item;
      if (it.type === 'command_execution') {
        toolCalls.push({ name: it.command || 'command', input: { command: it.command, exit_code: it.exit_code }, result: { content: typeof it.aggregated_output === 'string' ? it.aggregated_output : '', isError: (it.exit_code ?? 0) !== 0 } });
      } else if (it.type === 'agent_message' && typeof it.text === 'string' && it.text) {
        answer = it.text;
      }
    } else if (ev.type === 'turn.completed' && ev.usage) {
      usage = ev.usage;
    } else if (ev.type === 'error' || ev.type === 'turn.failed') {
      // Codex --json reports failures as STREAM EVENTS, not on stderr. The 2026-07-09
      // checkpoint lost 9 runs' true cause because these were silently dropped
      // (stderr showed only the benign non-TTY banner, misread as a "stdin bug").
      const msg = ev.message || ev.error?.message || JSON.stringify(ev).slice(0, 300);
      errors.push(`${ev.type}: ${String(msg).slice(0, 300)}`);
    }
  }
  return { toolCalls, answer, usage, errors };
}

// Codex 0.141 prints this banner on stderr in EVERY non-TTY spawn (stdin is already
// /dev/null via stdio 'ignore' — it reads EOF instantly and proceeds; verified live
// 2026-07-09: all 109 clean checkpoint runs carry it too). Strip it from previews so
// it can never again masquerade as a failure cause.
const STDIN_BANNER = /^Reading additional input from stdin\.\.\.\s*/;

// A run that exited non-zero (or "completed" with neither a tool call nor an agent
// message) before doing ANY work is a startup failure — e.g. an empty/errored first
// model response — not agent signal. Worth exactly ONE automatic relaunch.
export function isZeroCallStartFailure({ exitCode, timedOut }, toolCalls, answer) {
  if (timedOut) return false;
  if (toolCalls.length > 0) return false;
  return exitCode !== 0 || !answer;
}

// Realized-cost rates. Re-exported from ideal-cost.mjs so the realized and ideal
// columns can never drift to different numbers for the same model (`cache` there
// is the cache-hit rate this file calls `cacheHit`).
const PRICE = { in: IDEAL_PRICE.in, cacheHit: IDEAL_PRICE.cache, out: IDEAL_PRICE.out };
const DOCKER_HOST = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock';

// Cost levers L1/L2 (2026-07-08). Both are HARNESS-side (apply to BOTH arms) and
// flag-gated for historical comparability:
//   L1 (SS_NO_CMD_CONDENSE=1 → off): a docker PATH-wrapper that condenses oversized
//      `docker run/exec/logs/build` output the agent produces when it distrusts
//      run_tests and re-runs the suite by hand (the gt-783 ~40 KB-log mechanism).
//   L2 (SS_NO_RT_AUTHORITY=1 → off): run_tests gains an authority banner + a
//      baseline-diff (pre-existing vs newly-introduced failures) + a targeted mode.
// The pure logic lives in rt-condense-lib.mjs (unit-tested); the shim runtime in
// rt-shim-runtime.mjs. Both are imported BY ABSOLUTE PATH into the generated shims.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RT_RUNTIME_PATH = path.join(__dirname, 'rt-shim-runtime.mjs');
const RT_LIB_PATH = path.join(__dirname, 'rt-condense-lib.mjs');
const RT_DEDUP_PATH = path.join(__dirname, 'rt-dedup.mjs');
const RT_PROGRESS_PATH = path.join(__dirname, 'rt-progress-controller.mjs');
const RT_INFLIGHT_PATH = path.join(__dirname, 'rt-inflight.mjs');
const L1_CONDENSE = process.env.SS_NO_CMD_CONDENSE !== '1';
const L2_RT_AUTHORITY = process.env.SS_NO_RT_AUTHORITY !== '1';

// Tool-agnostic preamble for BOTH arms: how to run tests in THIS environment.
// Exported so the sibling harness adapters (claude-code / opencode) inject the
// BYTE-IDENTICAL frame — cross-harness comparability requires one source of truth.
export const RUN_TESTS_PREAMBLE =
  'Your shell does NOT have the repository\'s dependencies installed, so running the test runner/build directly (pytest, go test, cargo test, lein test, npm test, …) will fail with dependency/build errors. To run the repo\'s test suite on your current edits, invoke the `run_tests` command (no arguments) — it executes the canonical suite in the prepared environment and reflects your live edits.';

// Standard SWE-agent-style completion frame (Yang et al. 2024 instance template),
// language-agnostic. IDENTICAL on BOTH arms (tool-agnostic — never names a search
// tool), so the only arm asymmetry is M++ + ss-*. Brackets the sweet-only M++ guidance
// so M++'s "stop once located" recency does not end a FIX run at the locate step.
export const FRAME_OPEN =
  'You are resolving a real software issue by editing the repository SOURCE code in your current working directory. These task-completion rules are AUTHORITATIVE and override any later guidance about efficiency, taking fewer steps, or when to stop — such guidance governs only HOW to locate code, never WHETHER you are done. Standard workflow: (1) find and read the code relevant to the issue; (2) reproduce the failure by running the existing suite via `run_tests`; (3) make the MINIMAL source edit that implements the FULL behavior the issue requires — not just a signature or surface change; (4) re-run `run_tests` and confirm the previously-failing test now PASSES and nothing else broke; (5) consider edge cases. ' + RUN_TESTS_PREAMBLE;
export const FRAME_CLOSE =
  '=== TASK COMPLETION (authoritative — overrides all guidance above) ===\n' +
  'You have NOT finished until (1) you made a SOURCE-code edit AND (2) `run_tests` shows the previously-failing test now PASSES. Locating, understanding, or explaining the bug is NOT completion. Do NOT modify test files — the evaluation supplies its own hidden tests; test edits do not count toward the fix and can break grading. If so far you have only located the cause, your VERY NEXT action must be the source edit.\n\n' +
  'VALIDATION IS AUTHORITATIVE:\n' +
  '- Use `run_tests` for validation. Never inspect, search, read, or modify `.codex-bin`, `_run_tests*`, `_rt_*`, benchmark harness files, baseline files, the env ledger, or task overrides; never reconstruct the suite with Docker or a host test runner.\n' +
  '- After the initial reproduction, re-run `run_tests` only after a source edit. If the source diff is unchanged, the result cannot improve. Use `run_tests <pattern>` for targeted diagnosis when supported.\n' +
  // Auto-await run_tests: launch with a long yield so the complete result returns in ONE call
  // instead of a short-yield launch + repeated write_stdin polls (each re-sending resident
  // context). Default ON (SS_RT_LONGYIELD=0 opts back to the legacy poll instruction). Validated
  // solve-neutral: micro-smoke -62% poll turns, rotation -93%, 18-task screen 23.1%->10.8% poll
  // rate, no clean solve regression either arm (2026-08-07). BENCH-SPECIFIC (names run_tests) →
  // lives in the FRAME, byte-identical on both arms; never in M±.
  (process.env.SS_RT_LONGYIELD === '0'
    ? '- When `run_tests` is still running and no other work is pending, poll it with `write_stdin` using `yield_time_ms=120000`; do not use 30-second heartbeat polls.\n\n'
    : '- `run_tests` runs the whole suite and blocks until it finishes. Launch it with `yield_time_ms=300000` so its complete PASS/FAIL result comes back in ONE call — do NOT launch it with a short yield and then poll. Only if it has still not returned after that full wait, poll ONCE with `write_stdin` using `yield_time_ms=300000`; never use short heartbeat polls.\n\n') +
  'THIS ENVIRONMENT IS OFFLINE:\n' +
  '- Every outbound request will be REFUSED — curl, wget, git fetch/clone/pull, and package installs (pip, npm, go get, cargo, gem, mix) alike. Mirrors, CDNs, proxies and archives are refused too. Do not attempt them and do not retry: everything needed to solve the issue is already in the working directory.\n' +
  '- Solve the issue from the repository source and the issue text. Do not go looking for the upstream fix — not over the network, and not in git history, refs, tags, stashes, or packed objects. A fix copied from a later commit does not count.';

// Experimental anti-thrash appendix (sweet-arm only, gated by SS_NO_ANTITHRASH).
// Exported so the sibling adapters append the identical text under the same gate.
export const ANTI_THRASH_TEXT =
  '\n\nUSE WHAT THE TOOLS ALREADY GAVE YOU (efficiency):\n' +
  '- ss-search and ss-grep return the matching code AT file:line, inline in the result. Once a span has been shown to you, do NOT ss-read or re-grep that same span/symbol again — edit directly from the body you already have; only read a DIFFERENT file, or a range OUTSIDE what was shown.\n' +
  '- One search per target. If the top hit answers your question (especially when the trailer says sufficient=YES), act on it — do not fire multiple keyword/regex variants for the same symbol.\n' +
  '- To find where a symbol is CALLED or what it calls (to trace a value downstream before editing), use `ss-trace <symbol>` — do not re-search by hand.';

// Broker mode (agent sandbox): codex's Linux sandbox blocks unix-socket connects, so a
// sandboxed run_tests cannot reach the docker daemon directly (verified: "permission
// denied ... unix:///var/run/docker.sock" even with /run in writable_roots). Instead the
// sandboxed shim drops a request file into the writable __rt dir and polls for the
// response; an UNSANDBOXED host-side broker (spawned by runCodexTask before codex, killed
// after) watches for requests and runs the exact same git-diff + docker logic outside the
// sandbox. run_tests takes no arguments, so the protocol is parameter-free — the agent
// can no longer inject docker args at all (strictly tighter than the legacy direct shim).
// run_tests shim (H1 condenser + L2 levers) now lives in rt-shim-runtime.mjs +
// rt-condense-lib.mjs (imported by the thin generated shims below). This keeps the
// failure-line preservation + baseline-diff logic in ONE unit-tested place instead of
// two interpolated template strings. cfg carries dockerBin (REAL docker abs path, so
// the shim's own `docker run` bypasses the L1 wrapper), binDir (baseline cache), and
// rtAuthority (L2 gate).
function writeRunTestsBrokerFiles(binDir, cfgPath, stateDir = binDir) {
  const reqDir = path.join(stateDir, '_rt_ipc');
  mkdirSync(reqDir, { recursive: true });
  const brokerPath = path.join(binDir, '_rt_broker.mjs');
  // Host-side broker: reads the (possibly targeted) pattern from the req file, runs the
  // suite + L2 levers via the shared runtime, writes the response atomically.
  writeFileSync(brokerPath, `import { readFileSync, writeFileSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { runTestsWithLevers } from ${JSON.stringify(RT_RUNTIME_PATH)};
import { markUndeliveredResponses } from ${JSON.stringify(RT_DEDUP_PATH)};
import { publishVerdict } from ${JSON.stringify(RT_INFLIGHT_PATH)};
const c = JSON.parse(readFileSync(${JSON.stringify(cfgPath)}, 'utf8'));
const IPC = ${JSON.stringify(reqDir)};
setInterval(() => {
  let reqs = [];
  try { reqs = readdirSync(IPC).filter(f => f.startsWith('req-')); } catch { process.exit(0); }
  // A response still sitting here means its requester died (agent-side tool timeout on a
  // slow suite): the agent never saw that output, so L3 must stop citing it. The file is
  // left in place — an unconsumed response at exit IS the shim-tamper signal.
  if (reqs.length && c.rtDedup && c.dedupLog) { try { markUndeliveredResponses(c.dedupLog, IPC); } catch {} }
  for (const r of reqs) {
    const id = r.slice(4);
    // The request carries the agent's full argv as JSON (legacy: a bare pattern string).
    let argv = []; try { argv = JSON.parse(readFileSync(IPC + '/' + r, 'utf8') || '[]'); } catch { argv = []; }
    if (!Array.isArray(argv)) argv = [String(argv)];
    try { rmSync(IPC + '/' + r, { force: true }); } catch {}
    let out; try { out = runTestsWithLevers(c, { argv, reqId: id }); } catch (e) { out = '[run_tests error] ' + String(e && e.message || e); }
    const tmp = IPC + '/tmp-' + id;
    // D-6: publish the durable verdict copy HERE, not in the requester, so a run whose
    // requester was killed mid-wait can still be resolved by the agent's next run_tests call.
    publishVerdict(IPC, id, out);
    try { writeFileSync(tmp, out); renameSync(tmp, IPC + '/res-' + id); } catch {}
  }
}, 400);
`);
  return { brokerPath, reqDir };
}

export function writeRunTestsShim(binDir, {
  image, workdir, testScript, rundir, testTimeoutSec = 300, netArgs = '',
  brokerMode = false, dockerBin = 'docker', rtAuthority = true,
  stateDir = binDir, _isAgentFormat = false, label = 'rollout',
  rtDedup = RT_DEDUP_ON, rtProgressFlags = resolveProgressFlags(),
  controllerDir = null, taskId = null, arm = null, injectedFiles = [],
  installSeds = [],
}) {
  mkdirSync(binDir, { recursive: true });
  // L3 dedup state/audit log: append-only JSONL outside the agent's tree, opened with a
  // session boundary here — writeRunTestsShim runs exactly once per rollout attempt, so
  // that boundary is what resets dedup state between rollouts (see rt-dedup.mjs).
  const dedupLog = rtDedup
    ? startDedupSession(dedupLogPathFor(label, rundir), { label, rundir, brokerMode })
    : null;
  const rtProgress = createProgressRunConfig({
    flags: rtProgressFlags,
    controllerDir: rtProgressFlags.telemetry
      ? (controllerDir || rolloutStateDir(label, 'rt-progress'))
      : null,
    rundir, taskId, arm, runId: process.env.RUN_ID || 'adhoc', injectedFiles,
  });
  const cfg = path.join(binDir, '_run_tests_cfg.json');
  writeFileSync(cfg, JSON.stringify({
    image, workdir, testScript, rundir, dockerHost: DOCKER_HOST, testTimeoutSec,
    netArgs, dockerBin, binDir, stateDir, rtAuthority, _isAgentFormat,
    rtDedup: rtDedup && !!dedupLog, dedupLog, rtProgress, installSeds,
  }));
  const mjs = path.join(binDir, '_run_tests.mjs');
  if (brokerMode) {
    const { brokerPath, reqDir } = writeRunTestsBrokerFiles(binDir, cfg, stateDir);
    // requester shim: sandbox-safe (file writes into __rt/_rt_ipc only, no docker).
    // The agent's argv (optional test pattern, optional --ss-full) rides in the req file
    // as JSON — still parameter-free with respect to docker: the broker only ever reads
    // a test pattern and the dedup escape hatch out of it.
    // DEADLINE (PLAN.md §3 B6, 2026-07-30): the FIRST request of a rollout makes the broker
    // run TWO full suites in series — the L2 clean baseline plus the agent's diff — so a
    // `tSec + 90` wait was structurally too short for any suite near its own budget. Wait for
    // both runs plus overhead. The agent-side tool timeout must exceed THIS number, or the
    // requester is killed mid-wait and its response is orphaned (see agentBashTimeoutMs).
    // D-6: the banner is written BEFORE the request, so a yielded cell is never empty; and a
    // call made while an earlier launch is still in flight attaches to it instead of queueing
    // a second suite. See rt-inflight.mjs for why a prompt sentence could not do this.
    // The in-flight protocol is INLINED, never imported. This shim runs INSIDE the jail, and
    // the jail masks the whole of <repo>/eval, so an absolute-path import of any harness
    // module is ERR_MODULE_NOT_FOUND here — see the inline boundary note in rt-inflight.mjs.
    // Its `node:fs` import covers writeFileSync/readFileSync/rmSync/existsSync, so this shim
    // must not declare its own or the duplicate binding is a SyntaxError.
    writeFileSync(mjs, brokerRequesterSource({ reqDir, testTimeoutSec }));
    const shim = path.join(binDir, 'run_tests');
    writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${mjs} "$@"\n`);
    chmodSync(shim, 0o755);
    const files = [cfg, mjs, shim, brokerPath, RT_RUNTIME_PATH, RT_LIB_PATH, RT_DEDUP_PATH, RT_PROGRESS_PATH, RT_INFLIGHT_PATH];
    return {
      binDir, brokerPath, reqDir, files, dedupLog, progressConfig: rtProgress,
      controller: progressRowFields(rtProgress), integrity: shimIntegritySnapshot(files),
    };
  }
  // Direct shim: run the suite + L2/L3 levers via the shared runtime. argv = optional
  // targeted test pattern and/or --ss-full. Output IS the signal (shim exits 0; PASS/FAIL
  // is in the text).
  // D-6: same two properties as the broker requester, without a second process. The banner
  // lands before the suite starts; a call made while an earlier one is still running attaches
  // to it and returns its verdict instead of starting a second suite.
  const directIpc = path.join(stateDir, '_rt_inflight');
  mkdirSync(directIpc, { recursive: true });
  // Inlined for the same reason as the requester above, and for one more: this variant is
  // reached only with isolation OFF, so a jail-resolution bug in it would never surface in a
  // production run and would sit here until someone turned isolation off. The runtime import
  // below stays — it is large, it has its own dependency tree, and it never runs in a jail.
  writeFileSync(mjs, directShimSource({ cfgPath: cfg, runtimePath: RT_RUNTIME_PATH, ipcDir: directIpc, testTimeoutSec }));
  const shim = path.join(binDir, 'run_tests');
  writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${mjs} "$@"\n`);
  chmodSync(shim, 0o755);
  const files = [cfg, mjs, shim, RT_RUNTIME_PATH, RT_LIB_PATH, RT_DEDUP_PATH, RT_PROGRESS_PATH, RT_INFLIGHT_PATH];
  return {
    binDir, files, dedupLog, progressConfig: rtProgress,
    controller: progressRowFields(rtProgress),
    integrity: shimIntegritySnapshot(files),
  };
}

// L1: install a `docker` PATH-wrapper into binDir (FIRST on the agent's PATH) that
// condenses oversized human-facing docker output (run/exec/logs/build/compose/…) and
// passes machine/query subcommands (inspect/ps/images/version/pull) straight through.
// Resolves the REAL docker at call time (host PATH has no binDir → no self-reference).
// Returns the wrapper paths (best-effort; a missing docker binary just skips it).
export function installCommandWrappers(binDir, { realDocker }) {
  mkdirSync(binDir, { recursive: true });
  const condenser = path.join(binDir, '_cmd_condense.mjs');
  // Streaming, BOUNDED capture (8 MB hard cap — the P2 unbounded-capture precedent),
  // then condense via the unit-tested lib. Preserves the child's exit code verbatim.
  writeFileSync(condenser, `import { spawn } from 'node:child_process';
import { condenseOutput } from ${JSON.stringify(RT_LIB_PATH)};
const [real, ...args] = process.argv.slice(2);
const CAP = 8 * 1024 * 1024;
let buf = [], bytes = 0, capped = false;
function collect(d) { if (capped) return; bytes += d.length; if (bytes > CAP) { capped = true; buf.push(Buffer.from('\\n[...output capture truncated at 8MB...]\\n')); } else buf.push(d); }
const child = spawn(real, args, { stdio: ['inherit', 'pipe', 'pipe'] });
child.stdout.on('data', collect);
child.stderr.on('data', collect);
child.on('error', e => { process.stderr.write(String(e && e.message || e)); process.exit(127); });
child.on('close', code => {
  const raw = Buffer.concat(buf).toString('utf8');
  try { process.stdout.write(condenseOutput(raw).text); }
  catch { process.stdout.write(raw.slice(0, 8000)); }   // never lose output on a condenser bug
  process.exit(code == null ? 0 : code);                // preserve exit code
});
`);
  const dockerWrap = path.join(binDir, 'docker');
  writeFileSync(dockerWrap, `#!/usr/bin/env bash
# L1 harness lever: condense human-facing docker execution output so a 40 KB manual
# test-run log does not sit resident in the agent's context. Machine/query subcommands
# pass through untouched (never corrupt JSON/ID output consumed programmatically).
case "$1" in
  run|exec|logs|build|compose|attach|start|create|wait|cp)
    exec node ${JSON.stringify(condenser)} ${JSON.stringify(realDocker)} "$@" ;;
  *)
    exec ${JSON.stringify(realDocker)} "$@" ;;
esac
`);
  chmodSync(dockerWrap, 0o755);
  return { condenser, dockerWrap };
}

// H2 (2026-07-08 trace audit): shim files live in the agent's writable tree, and
// a real trajectory (glam-rs r2) perl-patched _run_tests_cfg.json to strip
// `--network none` — silently undoing the egress lockdown. We cannot make the
// files truly immutable for a same-uid agent, so we DETECT: hash every shim
// file at write time, re-hash after the agent run, and flag the row. A flagged
// row's test/grade signals are untrusted for cost/accuracy claims.
export function shimIntegritySnapshot(files) {
  return files.map(f => ({ file: f, sha: sha256File(f) }));
}
function sha256File(f) {
  try { return createHash('sha256').update(readFileSync(f)).digest('hex'); }
  catch { return null; }
}
export function verifyShimIntegrity(integrity) {
  const tampered = [];
  for (const { file, sha } of integrity || []) {
    const now = sha256File(file);
    if (now !== sha) tampered.push(path.basename(file) + (now === null ? ' (deleted)' : ''));
  }
  return tampered;
}

// The hash snapshot covers expected files; this closes the complementary gap where
// an agent creates a replacement cache/state file that did not exist at snapshot
// time (the forged `_rt_baseline.json` attack). Dynamic request/response files live
// in stateDir/_rt_ipc and must be fully consumed when the agent process exits.
// allowedStateEntries: adapter-owned files that legitimately live in stateDir (e.g.
// opencode's generated config). Declared, not inferred — anything undeclared still flags.
export function verifyRunnerDirectoryIntegrity({ binDir, expectedFiles = [], stateDir, allowedStateEntries = [] } = {}) {
  const tampered = [];
  const expected = new Set(expectedFiles
    .filter(file => path.dirname(file) === binDir)
    .map(file => path.basename(file)));
  try {
    for (const name of readdirSync(binDir)) {
      if (!expected.has(name)) tampered.push(`${name} (unexpected)`);
    }
  } catch {
    tampered.push(`${path.basename(binDir || 'runner-bin')} (deleted)`);
  }
  if (stateDir) {
    try {
      const allowed = new Set([path.basename(binDir), '_rt_ipc', ...allowedStateEntries]);
      for (const name of readdirSync(stateDir)) {
        if (!allowed.has(name)) tampered.push(`${name} (unexpected runner state)`);
      }
    } catch {
      tampered.push(`${path.basename(stateDir)} (deleted)`);
    }
    const ipcDir = path.join(stateDir, '_rt_ipc');
    try {
      for (const name of readdirSync(ipcDir)) {
        // D-6 leaves two kinds of marker here BY DESIGN, and they are harness-written, not
        // agent-written, so they are not tamper evidence:
        //   verdict-<id>   a durable copy of a completed run's output, deliberately retained
        //                  so a later run_tests call can attach to a run whose requester was
        //                  killed mid-wait and still be given the answer;
        //   inflight-<id>  ownership of a run still going, swept by ttl.
        // Whitelisting them keeps the property this check exists for: an unconsumed req-,
        // res- or tmp- file still means the agent never received an answer it asked for,
        // and still flags. This was found by the FIRST live rollout after the D2 repair —
        // every rollout came back SHIM-TAMPERED with four verdict- entries. Preflight was
        // green for that too; it does not run the shim.
        if (/^(verdict|inflight)-/.test(name)) continue;
        tampered.push(`_rt_ipc/${name} (unexpected)`);
      }
    } catch {
      tampered.push('_rt_ipc (deleted)');
    }
  }
  return tampered;
}

// classify a Codex shell command into a tool bucket. Codex wraps commands as
// `/bin/bash -lc '<inner>'`, so unwrap to the inner command before matching.
function classify(cmd) {
  let c = String(cmd || '').trim();
  const m = c.match(/^(?:\/usr\/bin\/|\/bin\/)?(?:ba)?sh\s+-[a-z]*c\s+([\s\S]*)$/);
  if (m) {
    let inner = m[1].trim();
    const q = inner[0];
    if ((q === "'" || q === '"') && inner[inner.length - 1] === q) inner = inner.slice(1, -1);
    c = inner.trim();
  }
  if (/^run_tests\b/.test(c)) return 'test';
  if (/^(ss[-_](search|grep|find|read|semantic|trace)|sweet-search)\b/.test(c)) return 'ss';
  if (/\bapply_patch\b/.test(c)) return 'edit';
  if (/^(rg|grep|ag|ack|git grep)\b/.test(c) || /\| *(grep|rg)\b/.test(c)) return 'nativeGrep';
  if (/^(cat|head|tail|nl|bat|less)\b/.test(c) || /^sed\s+(-n|')/.test(c)) return 'nativeRead';
  return 'bash';
}

export async function runCodexTask(task, { arm, apiModel = 'openai/gpt-5.5', reasoning = 'medium', ssBinDir, mppText, image, t, perCallTimeoutMs = 600000 } = {}) {
  const sweet = arm === 'sweet';
  const rundir = task.repoCheckout;
  // CODEX_SUBSCRIPTION=1 routes through a ChatGPT (Max/Pro) login instead of the
  // openrouter API key: bare model id + codex's built-in provider (auth.json carries
  // the ChatGPT OAuth token). Default path is byte-identical to before (openrouter).
  const codexSubscription = process.env.CODEX_SUBSCRIPTION === '1';
  const codexModel = codexSubscription
    ? apiModel.replace(/^openai\//, '')
    : (apiModel.includes('/') ? apiModel : `openai/${apiModel}`);
  // Price by the actual model (OpenRouter rate). gpt-5.5 resolves to the same numbers as
  // the legacy module PRICE, so existing gpt-5.5 runs are byte-identical; other models
  // (e.g. gpt-5.6-luna) are now priced correctly instead of at gpt-5.5's rate.
  const _p = priceFor(apiModel);
  const price = { in: _p.in, cacheHit: _p.cache, out: _p.out };
  const workdir = t.workdir || `/${t.repo.split('/')[1]}`;
  const testScript = [].concat(t.install_config?.test_cmd || []).join(' && ');

  // run_tests shim (both arms) + ss-* (sweet only) on PATH
  const NET_LOCKDOWN = process.env.SS_BENCH_ALLOW_NET !== '1';
  // EXPERIMENTAL opt-in ONLY (SS_AGENT_SANDBOX=1): codex's Linux sandbox denies ALL
  // unix-socket connects (probed 2026-07-07: /tmp socket, writable-root socket, and
  // docker.sock all refuse under both network_access settings; --allow-unix-socket
  // doesn't exist on `exec` 0.141), which kills the sweet arm's ss-* daemon sockets —
  // and sandboxing only one arm would confound the A/B. The run_tests broker below
  // makes docker work under the sandbox, but ss-* cannot; production egress control
  // is the host-level /etc/hosts code-host block (bench-net-lockdown.sh, both arms)
  // plus --network none task containers.
  const AGENT_SANDBOX = process.env.SS_AGENT_SANDBOX === '1';
  const netArgs = NET_LOCKDOWN
    ? `--network ${t._network === 'bridge' ? 'bridge' : 'none'} ${(t._dockerRunArgs || []).join(' ')}`.trim() + ' '
    : ((t._dockerRunArgs || []).join(' ') ? (t._dockerRunArgs || []).join(' ') + ' ' : '');
  // Runner-owned artifacts must not share the agent-writable task tree. The clean
  // baseline is retained only in the persistent broker process (see
  // rt-shim-runtime.mjs); request/response state and generated shims live in this
  // unique per-attempt directory and are removed before returning.
  const runnerStateDir = mkdtempSync(path.join(tmpdir(), 'sweet-search-runner-'));
  const binDir = path.join(runnerStateDir, 'bin');
  const jailLabel = `${task.id || 'task'}-${arm}`;
  // Codex writes its rollout jsonl (the per-turn token_count events idealCost is
  // recovered from) under ~/.codex/sessions. $HOME is masked in the jail, so that
  // directory is bound to a per-rollout host dir and read back from there — otherwise
  // the cost columns would silently go null under isolation.
  const codexHome = rolloutStateDir(jailLabel, 'codex-home');
  // ...but the SAME directory holds config.toml, which is where the `openrouter` provider
  // (base_url + env_key) is defined. Handing codex an empty ~/.codex made it exit
  // instantly with "No such file or directory (os error 2)" and record calls=0 — a
  // failure that looks exactly like a provider outage in the rows. Seed the config in;
  // only the session/log state stays per-rollout.
  for (const f of ['config.toml', 'auth.json', 'installation_id']) {
    const src = path.join(process.env.HOME || '/root', '.codex', f);
    const dst = path.join(codexHome, f);
    try { if (existsSync(src) && !existsSync(dst)) copyFileSync(src, dst); } catch { /* codex will report it */ }
  }
  const jailBinds = [{ src: codexHome, dst: path.join(process.env.HOME || '/root', '.codex') }];
  // Resolve the REAL docker binary from the HARNESS PATH (no binDir → no self-ref), so
  // both the run_tests shim (cfg.dockerBin) and the L1 wrapper invoke it directly.
  let realDocker = 'docker';
  try { realDocker = execSync('command -v docker', { encoding: 'utf8' }).trim() || 'docker'; } catch { /* fall back to bare 'docker' */ }
  // Inject before shim generation so telemetry fingerprints these harness-owned
  // bytes; a later agent modification is still reported as a prohibited change.
  const instructions = `${FRAME_OPEN}${sweet ? `\n\n${mppText}` : ''}\n\n${FRAME_CLOSE}`;
  appendFileSync(path.join(rundir, 'AGENTS.md'), `\n\n${instructions}\n`);
  const shimInfo = writeRunTestsShim(binDir, {
    image, workdir, testScript, rundir, testTimeoutSec: t._testTimeoutSec || 300,
    netArgs, brokerMode: true, dockerBin: realDocker, rtAuthority: L2_RT_AUTHORITY,
    stateDir: runnerStateDir, _isAgentFormat: sweet, label: jailLabel,
    taskId: task.id, arm, injectedFiles: ['AGENTS.md'],
    installSeds: installSedCmds(t),
  });
  // L1: install the docker output-condenser wrapper (both arms). Flag-gated; a run
  // with SS_NO_CMD_CONDENSE=1 leaves the agent's docker == real docker (legacy).
  let wrapperFiles = [];
  if (L1_CONDENSE) {
    try { wrapperFiles = Object.values(installCommandWrappers(binDir, { realDocker })); }
    catch (e) { console.error(`  [L1] wrapper install skipped: ${String(e.message).slice(0, 100)}`); }
  }
  const runnerFiles = [...(shimInfo.files || []), ...wrapperFiles];
  // Re-snapshot after every generated runner file exists. This includes the L1
  // docker wrapper, which was previously outside the tamper verdict.
  shimInfo.integrity = shimIntegritySnapshot(runnerFiles);
  // The host-side broker is now always on: one long-lived process owns the clean
  // baseline in memory across all run_tests invocations for this attempt.
  const broker = shimInfo?.brokerPath
    ? spawn('node', [shimInfo.brokerPath], { stdio: 'ignore' })
    : null;
  const jail = ISOLATION_ON ? startJail({ rundir, runnerStateDir, label: jailLabel, extraBinds: jailBinds, requireBins: ['codex'] }) : null;
  const pathDirs = [binDir, sweet ? ssBinDir : null].filter(Boolean);
  let env = { ...process.env, PATH: [...pathDirs, process.env.PATH].join(':'), SWEET_SEARCH_PROJECT_ROOT: rundir, DOCKER_HOST };
  if (jail) env = jailEnv(env);

  // Off-clock warmup (sweet arm) — arm the per-run ss-* server's models BEFORE the
  // measured agent loop. Without this, the cold-start model-load banner (a console.log
  // in late-interaction-index.js: "LateInteraction: Loaded N documents…") lands in the
  // agent's FIRST ss-grep/ss-find stdout and crowds out the actual hits → the agent gets
  // noise, distrusts ss-*, and falls back to native rg/sed (diagnosed root cause of the
  // sweet≈native tie). The bare-API harness already does this (run-pilot warmupRun).
  // Warmup must happen INSIDE the jail: a server warmed on the host lives in another
  // mount namespace, so the agent could not see its socket and would pay a cold start.
  if (sweet && ssBinDir) {
    const wBin = path.join(ssBinDir, 'ss-search');
    const [wb, wa] = jail ? jailArgv(jail, wBin, ['warmup', '-k', '1'], rundir) : [wBin, ['warmup', '-k', '1']];
    try { execFileSync(wb, wa, { cwd: rundir, env, stdio: 'ignore', timeout: 120000 }); } catch { /* warmup is best-effort */ }
  }

  // Both arms get the standard completion frame; sweet additionally gets M++ (the
  // ss-* retrieval guidance), bracketed by FRAME_OPEN/FRAME_CLOSE so completion wins.
  // Experimental anti-thrash appendix (A/B candidate for promotion into canonical M++).
  // Targets the diagnosed sweet-arm waste: redundant re-reads of already-returned spans,
  // search-variant reformulation, and under-use of ss-trace for downstream/caller lookup.
  // Instruction file = frame + M± (sweet) / frame only (native), written into
  // <rundir>/AGENTS.md (the plain project file codex reads), NOT the prompt. M± is BRACKETED
  // by the frame (FRAME_OPEN + M± + FRAME_CLOSE) so FRAME_CLOSE's task-completion authority
  // overrides M±'s stop-early guidance. Excluded from the graded patch below. Prompt = issue only.
  // ---- R-1 turn-0 dossier (SS_R1), default OFF ---------------------------------------
  // SLATE-A-RESIDUE §3.B re-checks R-1, which was killed on a fixed-trajectory replay at
  // +0.41% to +1.82%. Its claim is that orienting the agent before it starts removes early
  // retrieval calls. Two shapes, both delivered in the turn-0 user message so the dossier is
  // billed once and then cached — the cheapest possible delivery, chosen to FAVOUR the lever:
  //
  //   map   repo map only: top-level entries with file counts and the dominant extensions.
  //         Deterministic, built from the tree, costs nothing to produce.
  //   map5  the map plus the top 5 files ss-search returns for the issue text.
  //
  // TWO ASSUMPTIONS ARE DELIBERATELY GENEROUS AND BOTH MUST BE DISCLOSED WITH ANY RESULT:
  // the retrieval that builds the top-5 list is run off-clock and charged to nobody, and the
  // dossier is placed where prompt caching is cheapest. A real deployment pays for both. If
  // the lever loses under assumptions this favourable, it loses by more in production.
  const R1 = (process.env.SS_R1 || '').toLowerCase();
  const R1_ON = R1 === 'map' || R1 === 'map5';
  let r1 = null;
  function buildDossier() {
    const lines = [];
    try {
      const ents = readdirSync(rundir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules');
      const counted = [];
      for (const e of ents) {
        if (!e.isDirectory()) { counted.push(`${e.name}  (file)`); continue; }
        let n = 0; const ext = new Map();
        const walk = (d, depth) => {
          if (depth > 4 || n > 4000) return;
          let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
          for (const c of es) {
            if (c.name.startsWith('.') || c.name === 'node_modules') continue;
            if (c.isDirectory()) walk(path.join(d, c.name), depth + 1);
            else { n++; const x = path.extname(c.name); if (x) ext.set(x, (ext.get(x) || 0) + 1); }
          }
        };
        walk(path.join(rundir, e.name), 0);
        const top = [...ext].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}×${v}`).join(' ');
        counted.push(`${e.name}/  ${n} files  ${top}`);
      }
      lines.push('REPOSITORY MAP', ...counted.slice(0, 40));
    } catch { /* a map we cannot build is simply absent */ }
    if (R1 === 'map5' && sweet && ssBinDir) {
      try {
        const q = String(task.problem_statement || '').replace(/\s+/g, ' ').slice(0, 200);
        const wBin = path.join(ssBinDir, 'ss-search');
        const [b, a] = jail ? jailArgv(jail, wBin, [q, '-k', '5'], rundir) : [wBin, [q, '-k', '5']];
        const out = execFileSync(b, a, { cwd: rundir, env, encoding: 'utf8', timeout: 120000 });
        lines.push('', 'FILES MOST RELEVANT TO THE ISSUE (retrieval, top 5)', String(out).slice(0, 4000));
      } catch { /* no list is better than a wrong one */ }
    }
    return lines.join('\n');
  }
  const dossier = R1_ON ? buildDossier() : '';
  if (R1_ON) r1 = { mode: R1, dossierChars: dossier.length, inert: !dossier.trim() };
  if (R1_ON && !dossier.trim()) console.log(`  [R-1 ${R1} ${task.id || ''}] dossier is EMPTY — cell is inert, do not read it as a null`);
  const prompt = `=== ISSUE ===\n${task.problem_statement || ''}`
    + (dossier.trim() ? `\n\n=== ORIENTATION (provided; you do not need to rediscover this) ===\n${dossier}` : '');

  // EXPERIMENTAL agent sandbox (see AGENT_SANDBOX above — opt-in, native-arm-only
  // viability): workspace-write with network off; run_tests works via the host-side
  // broker (docker is unreachable from inside — codex seccomp denies unix connects).
  // Production egress control is bench-net-lockdown.sh + --network none containers.
  const sandboxArgs = AGENT_SANDBOX
    ? ['--sandbox', 'workspace-write', '--skip-git-repo-check', '--add-dir', runnerStateDir, '-c', 'approval_policy="never"',
       '-c', 'sandbox_workspace_write.network_access=false']
    : ['--dangerously-bypass-approvals-and-sandbox'];
  // Subscription mode omits the openrouter provider override so codex uses its built-in
  // ChatGPT backend (selected by the seeded auth.json); the openrouter path is unchanged.
  const providerArgs = codexSubscription ? [] : ['-c', 'model_provider="openrouter"'];
  const baseArgs = ['exec', ...sandboxArgs, '--json',
    '-c', `model_reasoning_effort="${reasoning}"`, ...providerArgs,
    '-m', codexModel, '-C', rundir];
  const args = [...baseArgs, prompt];

  // ---- C-3 two-phase context handoff (SS_C3), default OFF ----------------------------
  // SLATE-A-RESIDUE §3.A re-opens C-3 as a LIVE A/B, because §0 established that a
  // fixed-trajectory replay predicts BEHAVIOUR well and COST badly. The two shapes below are
  // identical in everything except whether the diagnosis context SURVIVES, which is exactly
  // the isolate §3.A asks for:
  //
  //   v1  RESET   phase 2 is a FRESH `codex exec`. Diagnosis context is gone; only the typed
  //               handoff crosses the boundary. This is the lever.
  //   v5  APPEND  phase 2 is `codex exec resume --last`. The identical handoff is appended and
  //               NOTHING is deleted. This is the control that decides whether C-3 is a
  //               topology change or merely a structured-summary prompt.
  //
  // Both phases get a byte-identical phase-2 prompt, so any difference between v1 and v5 is
  // attributable to context deletion alone.
  const C3 = (process.env.SS_C3 || '').toLowerCase();
  const C3_ON = C3 === 'v1' || C3 === 'v5';
  const C3_HANDOFF_FILE = '.c3-handoff.md';
  const c3Phase1Prompt = `${prompt}

=== PHASE 1 OF 2 — DIAGNOSE ONLY ===
Localise this issue. Read whatever you need. DO NOT edit, patch or write any source file yet,
and do not run the tests yet.

When you know what the fix must be, write ${C3_HANDOFF_FILE} in the repository root with exactly
these five sections, then stop and say DIAGNOSIS COMPLETE:

## CAUSAL CHAIN
What is wrong, and the chain from symptom to cause.
## SOURCE ANCHORS
file:line for every location that must change, plus the exact current text at each.
## LIVE UNCERTAINTIES
What you are still unsure of, and what would settle it.
## FALSIFYING COMMAND
The single command that proves the fix worked or failed.
## EDIT CONSTRAINT
What must NOT change, and any convention the patch has to follow.

A later session will receive only this file. Anything you leave out is lost.`;
  const c3Phase2Prompt = ho => `${prompt}

=== PHASE 2 OF 2 — APPLY AND PROVE ===
The diagnosis below was produced for this exact repository. Apply the fix and prove it.

${ho}`;
  // ------------------------------------------------------------------------------------

  const t0 = Date.now();
  // stdin MUST stay 'ignore' (= /dev/null): codex exec blocks forever on an open
  // never-closed stdin pipe (upstream issues #20919/#27019); /dev/null gives EOF
  // instantly. The "Reading additional input from stdin..." banner still prints —
  // it is benign and appears on every non-TTY spawn.
  const spawnArgv = argv => (jail ? jailArgv(jail, 'codex', argv, rundir) : ['codex', argv]);
  const spawnWith = argv => new Promise((resolve) => {
    const [bin, a] = spawnArgv(argv);
    let stdout = '', stderr = '', timedOut = false;
    const proc = spawn(bin, a, { cwd: rundir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    // Killing `nsenter` leaves its in-namespace child alive, so a jailed timeout must
    // also kill the jail's init — the PID namespace death takes the agent with it.
    const timer = setTimeout(() => { timedOut = true; if (jail) { try { process.kill(jail.initPid, 'SIGKILL'); } catch {} } try { proc.kill('SIGTERM'); } catch {} setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 2000).unref(); }, perCallTimeoutMs);
    proc.stdout.on('data', d => stdout += d.toString('utf8'));
    proc.stderr.on('data', d => stderr += d.toString('utf8'));
    proc.on('error', e => { clearTimeout(timer); resolve({ stdout, stderr: stderr + e.message, exitCode: -1, timedOut }); });
    proc.on('exit', code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? 0, timedOut }); });
  });
  const spawnOnce = () => spawnWith(C3_ON ? [...baseArgs, c3Phase1Prompt] : args);
  let r = await spawnOnce();
  let parsed = parseCodexAgentStream(r.stdout);
  let startRetried = false;
  // 4/118 checkpoint runs died at 0 calls (codex "completed" a 7s turn with no model
  // output, exit≠0 — a startup/API blip, zero agent signal). One relaunch, logged;
  // spend accrues per-attempt (the failed start's usage is ~one prompt).
  if (isZeroCallStartFailure(r, parsed.toolCalls, parsed.answer)) {
    startRetried = true;
    console.log(`  [codex-retry ${task.id || ''}] 0-call start failure (exit=${r.exitCode}${parsed.errors.length ? '; ' + parsed.errors[0] : ''}) — relaunching once`);
    r = await spawnOnce();
    parsed = parseCodexAgentStream(r.stdout);
  }
  // C-3 phase 2. The handoff is read from the file the agent was told to write; if it did not
  // write one, its closing message is used instead and the fallback is COUNTED, because a cell
  // where the trigger never fired is inert and must not be read as a null result (/microsmoke
  // Gate 0). c3.handoffTokens is recorded so the carrying cost is visible in the row.
  const c3 = C3_ON ? { mode: C3, phase1Calls: parsed.toolCalls.length, handoffFromFile: false, handoffChars: 0, fallback: false } : null;
  if (C3_ON) {
    let ho = '';
    try { ho = readFileSync(path.join(rundir, C3_HANDOFF_FILE), 'utf8'); c3.handoffFromFile = true; } catch { /* fall back below */ }
    if (!ho.trim()) { ho = String(parsed.answer || '').trim(); c3.fallback = true; }
    c3.handoffChars = ho.length;
    if (!ho.trim()) {
      console.log(`  [C-3 ${C3} ${task.id || ''}] phase 1 produced NO handoff — cell is inert, phase 2 skipped`);
      c3.inert = true;
    } else {
      const p2 = c3Phase2Prompt(ho);
      // v1 starts a fresh session (context deleted); v5 resumes the same one (nothing deleted).
      //
      // `codex exec resume` takes a DIFFERENT option set from `codex exec`: no `-C` and no
      // `--sandbox` (checked against `codex exec resume --help` on 0.146.1 — it accepts only
      // -c/-m/--json/--last/--dangerously-bypass-*/--skip-git-repo-check/-i/-o).
      //
      // Its signature is `resume [OPTIONS] [SESSION_ID] [PROMPT]`, and THAT is the trap: with
      // `--last` and a single positional, codex binds the positional to SESSION_ID, not PROMPT,
      // so the whole handoff is parsed as a session identifier and the invocation dies. Two
      // attempts were lost to this and to the `-C`/`--sandbox` difference above, and both times
      // the cell looked like "the treatment destroyed the agent" rather than a broken argv.
      //
      // So pass the session id EXPLICITLY. Codex names each rollout file
      // `rollout-<timestamp>-<uuid>.jsonl` and the uuid is the session id, so phase 1's own file
      // gives it to us with no ambiguity and no dependency on what "most recent" means when
      // rollouts run concurrently.
      const p1File = rolloutFilesForRundir(rundir, {
        sinceMs: t0 - 60000, sessionsDir: jail ? path.join(codexHome, 'sessions') : undefined,
      }).pop();
      const sid = /rollout-[\dT-]+-([0-9a-f-]{36})\.jsonl$/.exec(p1File || '')?.[1] || null;
      const argv2 = C3 === 'v5'
        ? (sid ? ['exec', 'resume', sid, '--dangerously-bypass-approvals-and-sandbox', '--json',
          '-c', `model_reasoning_effort="${reasoning}"`, ...providerArgs, '-m', codexModel, p2] : null)
        : [...baseArgs, p2];
      if (!argv2) {
        // Refuse to spawn a malformed resume rather than emit a cell that looks like a result.
        console.log(`  [C-3 v5 ${task.id || ''}] phase-1 session id not recoverable from ${p1File || '(no rollout file)'} — INERT, not a null result`);
        c3.inert = true;
      }
      const r2 = argv2 ? await spawnWith(argv2) : { stdout: '', stderr: '', exitCode: -1, timedOut: false };
      const parsed2 = parseCodexAgentStream(r2.stdout);
      c3.phase2Calls = parsed2.toolCalls.length;
      // Merge: tool calls concatenate in trajectory order; usage sums across BOTH contexts.
      // Summing per context is the same rule the cost contract uses for sidechains — a
      // merged token sequence would make the prefix diff meaningless.
      const u1 = parsed.usage || {}, u2 = parsed2.usage || {};
      const sum = k => (u1[k] || 0) + (u2[k] || 0);
      parsed = {
        ...parsed2,
        toolCalls: [...parsed.toolCalls, ...parsed2.toolCalls],
        errors: [...(parsed.errors || []), ...(parsed2.errors || [])],
        usage: { input_tokens: sum('input_tokens'), cached_input_tokens: sum('cached_input_tokens'),
          output_tokens: sum('output_tokens'), reasoning_output_tokens: sum('reasoning_output_tokens') },
      };
      r = { ...r2, stdout: r.stdout + r2.stdout };
    }
    // The handoff file is a runner artifact, not a patch. It is excluded from the graded diff
    // below and removed here so it cannot leak into preds-*.jsonl.
    try { rmSync(path.join(rundir, C3_HANDOFF_FILE), { force: true }); } catch { /* best effort */ }
  }
  const wallMs = Date.now() - t0;
  const { toolCalls, answer, usage } = parsed;

  // tool composition + trajectory
  const toolCounts = { ss: 0, nativeGrep: 0, nativeRead: 0, edit: 0, bash: 0, test: 0 };
  const trajectory = []; let stepsToFirstEdit = null;
  // D-6 telemetry is computed from the UNTRUNCATED results, before buildTrajectory-style
  // truncation, because the verdict footer is the last line a completed run writes.
  const rtTelemetry = runTestsTelemetry(toolCalls.map(tc => ({
    kind: classify(tc.input?.command), resultText: String(tc.result?.content ?? ''),
  })));
  toolCalls.forEach((tc, i) => {
    const kind = classify(tc.input?.command);
    toolCounts[kind] = (toolCounts[kind] || 0) + 1;
    if (kind === 'edit' && stepsToFirstEdit === null) stepsToFirstEdit = i + 1;
    trajectory.push({ call: i + 1, name: kind === 'ss' ? 'ss' : kind, kind, input: String(tc.input?.command || '').slice(0, 200), result: String(tc.result?.content || '').slice(0, 600), isError: !!tc.result?.isError });
  });
  // patch from git diff (authoritative — counts even edits not visible as commands)
  let finalPatch = '';
  try { finalPatch = execSync(`git -C ${rundir} diff HEAD -- . ':(exclude).sweet-search' ':(exclude)CLAUDE.md' ':(exclude)AGENTS.md' ':(exclude).c3-handoff.md'`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch {}
  const patchHunks = (finalPatch.match(/^@@ /gm) || []).length;
  const patchFiles = (finalPatch.match(/^diff --git /gm) || []).length;
  // NO patchFiles backfill into toolCounts.edit (PLAN.md §3 B3) — it made an
  // observed-tool-call counter mean "or else, files touched", asymmetrically between
  // arms. Patch-derived metrics use patchFiles/patchHunks or preds-*.jsonl.

  // cost (realized = cache-aware) from the codex usage. costNaiveUsd here is already the
  // unified "no cache at all" definition (§3 B4): `input_tokens` is the sum of every
  // turn's full prompt, so the re-sent prefix is charged again on each turn.
  const u = usage || {};
  const inTok = u.input_tokens || 0, cached = u.cached_input_tokens || 0, out = (u.output_tokens || 0) + (u.reasoning_output_tokens || 0);
  const costRealized = ((inTok - cached) * price.in + cached * price.cacheHit + out * price.out) / 1e6;
  const costNaive = (inTok * price.in + out * price.out) / 1e6;

  const calls = toolCalls.length;
  const exitReason = r.timedOut ? 'timeout' : (r.exitCode !== 0 ? 'codex_error' : 'model_stopped');
  if (broker) { try { broker.kill('SIGKILL'); } catch {} }
  // H2: detect mutations AND injected runner/cache files. The latter catches the
  // forged `_rt_baseline.json` class even though no baseline file is legitimate now.
  const shimTamperedFiles = [
    ...verifyShimIntegrity(shimInfo?.integrity),
    ...verifyRunnerDirectoryIntegrity({
      binDir, expectedFiles: runnerFiles, stateDir: runnerStateDir,
    }),
  ];
  if (shimTamperedFiles.length) {
    console.log(`  [SHIM-TAMPERED ${task.id || ''}] agent modified: ${shimTamperedFiles.join(', ')} — test signals untrusted`);
  }
  // Audit before the jail dies: its handle carries the window that attributes egress
  // denials to this rollout.
  const escapeAudit = jail
    ? auditRollout({ toolCalls: trajectory.map(x => ({ command: x.input, resultText: x.result })), rundir, denials: jailDenials(jail) })
    : { ...UNAUDITED };
  stopJail(jail);
  try { rmSync(runnerStateDir, { recursive: true, force: true }); } catch {}

  // idealCost: cache-normalized cost recovered from this run's codex rollout
  // (per-turn token_count events) — a first-class column so cost A/B analysis no
  // longer depends on a post-hoc script. sinceMs slack of 60s guards clock skew;
  // the exact rundir cwd match keeps it unambiguous. Never throws → nulls if the
  // rollout can't be located (falls back to the realized column downstream).
  let idealCostUsd = null, realFromTurnsUsd = null, rolloutFile = null, idealTurns = 0;
  let breakPricedCostUsd = null, contextRewrites = 0;
  let costContentUsd = null, turnsFile = null;
  try {
    const sessionsDir = jail ? path.join(codexHome, 'sessions') : undefined;
    // C-3 invokes the agent twice, so there are two rollout files and the cost columns must be
    // combined according to how many prompt-cache CONTEXTS those files represent:
    //   v1 RESET  → two independent growing prefixes. Sum the columns PER FILE. This is the
    //               same rule the cost contract uses for sidechains; re-deriving over a merged
    //               token sequence would make the prefix diff meaningless.
    //   v5 APPEND → `resume` continues ONE conversation, so the phase-2 turns already carry the
    //               phase-1 prefix and it is still cache-valid. Concatenate the turns in time
    //               order and price them as a SINGLE context, or the resumed session's first
    //               turn is charged full input rate for a prefix that never left the cache.
    const files = C3_ON
      ? rolloutFilesForRundir(rundir, { sinceMs: t0 - 60000, sessionsDir })
      : [];
    if (C3_ON && files.length > 1) {
      const per = files.map(f => ({ f, turns: turnsFromRollout(f) })).filter(x => x.turns.length);
      const merged = per.flatMap(x => x.turns);
      let cost;
      if (C3 === 'v5') cost = costFromTurns(merged, _p);
      else {
        cost = per.map(x => costFromTurns(x.turns, _p))
          .reduce((a, c) => ({ idealUsd: a.idealUsd + c.idealUsd, realFromTurnsUsd: a.realFromTurnsUsd + c.realFromTurnsUsd,
            breakPricedUsd: a.breakPricedUsd + c.breakPricedUsd, contextRewrites: a.contextRewrites + c.contextRewrites }),
          { idealUsd: 0, realFromTurnsUsd: 0, breakPricedUsd: 0, contextRewrites: 0 });
      }
      idealCostUsd = +cost.idealUsd.toFixed(6); realFromTurnsUsd = +cost.realFromTurnsUsd.toFixed(6);
      breakPricedCostUsd = +cost.breakPricedUsd.toFixed(6); contextRewrites = cost.contextRewrites;
      rolloutFile = files.join(','); idealTurns = merged.length;
      if (c3) { c3.contexts = C3 === 'v5' ? 1 : per.length; c3.rolloutFiles = per.length; }
      // costContentUsd + the persisted turn list follow the same merge, so downstream
      // analysis sees one ordered trajectory for the rollout.
      let prevIn = 0, content = 0;
      for (const tu of merged) { content += (Math.max(0, tu.in - prevIn) * _p.in + tu.out * _p.out) / 1e6; prevIn = tu.in; }
      costContentUsd = +content.toFixed(6);
      turnsFile = persistTurns(jailLabel, merged, {
        task: task.id, arm, harness: 'codex', model: apiModel, price: _p,
        source: `rollout-jsonl(c3-${C3},${per.length}-context)`,
      });
    } else {
      const ic = recoverIdealCost(rundir, { sinceMs: t0 - 60000, price: _p, sessionsDir });
      ({ idealCostUsd, realFromTurnsUsd, breakPricedCostUsd, contextRewrites, rolloutFile, turns: idealTurns } = ic);
      // P7 (PLAN.md §3 B1): the rollout jsonl lives in the per-rollout codex home, which is
      // torn down with the run — persist the per-turn array now or lose it. costContentUsd
      // (unique context charged once + output) needs the same growing-prefix structure and
      // is computed here rather than imported: agent-runner-shared imports FROM this module,
      // so a helper import back would be circular.
      if (ic.turnList?.length) {
        let prevIn = 0, content = 0;
        for (const tu of ic.turnList) {
          content += (Math.max(0, tu.in - prevIn) * _p.in + tu.out * _p.out) / 1e6;
          prevIn = tu.in;
        }
        costContentUsd = +content.toFixed(6);
        turnsFile = persistTurns(jailLabel, ic.turnList, {
          task: task.id, arm, harness: 'codex', model: apiModel, price: _p, source: 'rollout-jsonl',
        });
      }
    }
  } catch { /* best-effort — keep realized cost as the fallback */ }

  return {
    ...shimInfo.controller,
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch, ranTests: toolCounts.test > 0,
    ...escapeAudit,
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0,
    exitReason, usage: u, costNaiveUsd: +costNaive.toFixed(6), costRealizedUsd: +costRealized.toFixed(6),
    costContentUsd, idealCostUsd, realFromTurnsUsd, breakPricedCostUsd, contextRewrites, rolloutFile, idealTurns, turnsFile,
    wallMs, trajectory, finalAssistantText: answer, c3, r1, ...rtTelemetry,
    codexErrors: parsed.errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').replace(STDIN_BANNER, '').slice(0, 300),
  };
}
