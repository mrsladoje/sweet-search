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
import { recoverIdealCost, priceFor, PRICE as IDEAL_PRICE } from './ideal-cost.mjs';
import { persistTurns } from './turn-log.mjs';
// Isolation is imported DIRECTLY (not via agent-runner-shared) because that module
// imports this one — going through it would close an import cycle.
import { ISOLATION_ON, startJail, stopJail, jailArgv, jailEnv, jailDenials, rolloutStateDir } from './agent-jail.mjs';
import { auditRollout, UNAUDITED } from './escape-audit.mjs';
// L3 run_tests dedup: only the cheap path/session helpers are needed here — the shim
// runtime (which pulls in the code-graph repository) is never imported by the harness.
import { RT_DEDUP_ON, dedupLogPathFor, startDedupSession } from './rt-dedup.mjs';

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
  '- When `run_tests` is still running and no other work is pending, poll it with `write_stdin` using `yield_time_ms=120000`; do not use 30-second heartbeat polls.';

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
const c = JSON.parse(readFileSync(${JSON.stringify(cfgPath)}, 'utf8'));
const IPC = ${JSON.stringify(reqDir)};
setInterval(() => {
  let reqs = [];
  try { reqs = readdirSync(IPC).filter(f => f.startsWith('req-')); } catch { process.exit(0); }
  for (const r of reqs) {
    const id = r.slice(4);
    // The request carries the agent's full argv as JSON (legacy: a bare pattern string).
    let argv = []; try { argv = JSON.parse(readFileSync(IPC + '/' + r, 'utf8') || '[]'); } catch { argv = []; }
    if (!Array.isArray(argv)) argv = [String(argv)];
    try { rmSync(IPC + '/' + r, { force: true }); } catch {}
    let out; try { out = runTestsWithLevers(c, { argv }); } catch (e) { out = '[run_tests error] ' + String(e && e.message || e); }
    const tmp = IPC + '/tmp-' + id;
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
  rtDedup = RT_DEDUP_ON,
}) {
  mkdirSync(binDir, { recursive: true });
  // L3 dedup state/audit log: append-only JSONL outside the agent's tree, opened with a
  // session boundary here — writeRunTestsShim runs exactly once per rollout attempt, so
  // that boundary is what resets dedup state between rollouts (see rt-dedup.mjs).
  const dedupLog = rtDedup
    ? startDedupSession(dedupLogPathFor(label, rundir), { label, rundir, brokerMode })
    : null;
  const cfg = path.join(binDir, '_run_tests_cfg.json');
  writeFileSync(cfg, JSON.stringify({
    image, workdir, testScript, rundir, dockerHost: DOCKER_HOST, testTimeoutSec,
    netArgs, dockerBin, binDir, stateDir, rtAuthority, _isAgentFormat,
    rtDedup: rtDedup && !!dedupLog, dedupLog,
  }));
  const mjs = path.join(binDir, '_run_tests.mjs');
  if (brokerMode) {
    const { brokerPath, reqDir } = writeRunTestsBrokerFiles(binDir, cfg, stateDir);
    // requester shim: sandbox-safe (file writes into __rt/_rt_ipc only, no docker).
    // The agent's argv (optional test pattern, optional --ss-full) rides in the req file
    // as JSON — still parameter-free with respect to docker: the broker only ever reads
    // a test pattern and the dedup escape hatch out of it.
    writeFileSync(mjs, `import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
const IPC = ${JSON.stringify(reqDir)};
const tSec = ${Number(testTimeoutSec) || 300};
const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
writeFileSync(IPC + '/req-' + id, JSON.stringify(process.argv.slice(2)));
const deadline = Date.now() + (tSec + 90) * 1000;
const res = IPC + '/res-' + id;
while (Date.now() < deadline) {
  if (existsSync(res)) {
    process.stdout.write(readFileSync(res, 'utf8'));
    try { rmSync(res, { force: true }); } catch {}
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 400));
}
process.stdout.write('[run_tests] no response from test broker within ' + (tSec + 90) + 's');
`);
    const shim = path.join(binDir, 'run_tests');
    writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${mjs} "$@"\n`);
    chmodSync(shim, 0o755);
    const files = [cfg, mjs, shim, brokerPath, RT_RUNTIME_PATH, RT_LIB_PATH, RT_DEDUP_PATH];
    return { binDir, brokerPath, reqDir, files, dedupLog, integrity: shimIntegritySnapshot(files) };
  }
  // Direct shim: run the suite + L2/L3 levers via the shared runtime. argv = optional
  // targeted test pattern and/or --ss-full. Output IS the signal (shim exits 0; PASS/FAIL
  // is in the text).
  writeFileSync(mjs, `import { readFileSync } from 'node:fs';
import { runTestsWithLevers } from ${JSON.stringify(RT_RUNTIME_PATH)};
const c = JSON.parse(readFileSync(${JSON.stringify(cfg)}, 'utf8'));
try { process.stdout.write(runTestsWithLevers(c, { argv: process.argv.slice(2) })); }
catch (e) { process.stdout.write('[run_tests error] ' + String(e && e.message || e)); }
`);
  const shim = path.join(binDir, 'run_tests');
  writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${mjs} "$@"\n`);
  chmodSync(shim, 0o755);
  const files = [cfg, mjs, shim, RT_RUNTIME_PATH, RT_LIB_PATH, RT_DEDUP_PATH];
  return { binDir, files, dedupLog, integrity: shimIntegritySnapshot(files) };
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
      for (const name of readdirSync(ipcDir)) tampered.push(`_rt_ipc/${name} (unexpected)`);
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
  const codexModel = apiModel.includes('/') ? apiModel : `openai/${apiModel}`;
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
  const shimInfo = writeRunTestsShim(binDir, {
    image, workdir, testScript, rundir, testTimeoutSec: t._testTimeoutSec || 300,
    netArgs, brokerMode: true, dockerBin: realDocker, rtAuthority: L2_RT_AUTHORITY,
    stateDir: runnerStateDir, _isAgentFormat: sweet, label: jailLabel,
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
  const instructions = `${FRAME_OPEN}${sweet ? `\n\n${mppText}` : ''}\n\n${FRAME_CLOSE}`;
  appendFileSync(path.join(rundir, 'AGENTS.md'), `\n\n${instructions}\n`);
  const prompt = `=== ISSUE ===\n${task.problem_statement || ''}`;

  // EXPERIMENTAL agent sandbox (see AGENT_SANDBOX above — opt-in, native-arm-only
  // viability): workspace-write with network off; run_tests works via the host-side
  // broker (docker is unreachable from inside — codex seccomp denies unix connects).
  // Production egress control is bench-net-lockdown.sh + --network none containers.
  const sandboxArgs = AGENT_SANDBOX
    ? ['--sandbox', 'workspace-write', '--skip-git-repo-check', '--add-dir', runnerStateDir, '-c', 'approval_policy="never"',
       '-c', 'sandbox_workspace_write.network_access=false']
    : ['--dangerously-bypass-approvals-and-sandbox'];
  const args = ['exec', ...sandboxArgs, '--json',
    '-c', `model_reasoning_effort="${reasoning}"`, '-c', 'model_provider="openrouter"',
    '-m', codexModel, '-C', rundir, prompt];

  const t0 = Date.now();
  // stdin MUST stay 'ignore' (= /dev/null): codex exec blocks forever on an open
  // never-closed stdin pipe (upstream issues #20919/#27019); /dev/null gives EOF
  // instantly. The "Reading additional input from stdin..." banner still prints —
  // it is benign and appears on every non-TTY spawn.
  const [codexBin, codexArgs] = jail ? jailArgv(jail, 'codex', args, rundir) : ['codex', args];
  const spawnOnce = () => new Promise((resolve) => {
    let stdout = '', stderr = '', timedOut = false;
    const proc = spawn(codexBin, codexArgs, { cwd: rundir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    // Killing `nsenter` leaves its in-namespace child alive, so a jailed timeout must
    // also kill the jail's init — the PID namespace death takes the agent with it.
    const timer = setTimeout(() => { timedOut = true; if (jail) { try { process.kill(jail.initPid, 'SIGKILL'); } catch {} } try { proc.kill('SIGTERM'); } catch {} setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 2000).unref(); }, perCallTimeoutMs);
    proc.stdout.on('data', d => stdout += d.toString('utf8'));
    proc.stderr.on('data', d => stderr += d.toString('utf8'));
    proc.on('error', e => { clearTimeout(timer); resolve({ stdout, stderr: stderr + e.message, exitCode: -1, timedOut }); });
    proc.on('exit', code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? 0, timedOut }); });
  });
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
  const wallMs = Date.now() - t0;
  const { toolCalls, answer, usage } = parsed;

  // tool composition + trajectory
  const toolCounts = { ss: 0, nativeGrep: 0, nativeRead: 0, edit: 0, bash: 0, test: 0 };
  const trajectory = []; let stepsToFirstEdit = null;
  toolCalls.forEach((tc, i) => {
    const kind = classify(tc.input?.command);
    toolCounts[kind] = (toolCounts[kind] || 0) + 1;
    if (kind === 'edit' && stepsToFirstEdit === null) stepsToFirstEdit = i + 1;
    trajectory.push({ call: i + 1, name: kind === 'ss' ? 'ss' : kind, kind, input: String(tc.input?.command || '').slice(0, 200), result: String(tc.result?.content || '').slice(0, 600), isError: !!tc.result?.isError });
  });
  // patch from git diff (authoritative — counts even edits not visible as commands)
  let finalPatch = '';
  try { finalPatch = execSync(`git -C ${rundir} diff HEAD -- . ':(exclude).sweet-search' ':(exclude)CLAUDE.md' ':(exclude)AGENTS.md'`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch {}
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
  let costContentUsd = null, turnsFile = null;
  try {
    const ic = recoverIdealCost(rundir, { sinceMs: t0 - 60000, price: _p, sessionsDir: jail ? path.join(codexHome, 'sessions') : undefined });
    ({ idealCostUsd, realFromTurnsUsd, rolloutFile, turns: idealTurns } = ic);
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
  } catch { /* best-effort — keep realized cost as the fallback */ }

  return {
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch, ranTests: toolCounts.test > 0,
    ...escapeAudit,
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0,
    exitReason, usage: u, costNaiveUsd: +costNaive.toFixed(6), costRealizedUsd: +costRealized.toFixed(6),
    costContentUsd, idealCostUsd, realFromTurnsUsd, rolloutFile, idealTurns, turnsFile,
    wallMs, trajectory, finalAssistantText: answer,
    codexErrors: parsed.errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').replace(STDIN_BANNER, '').slice(0, 300),
  };
}
