// Codex harness for the task-completion bench: runs `codex exec` as the agent loop
// (a real production coding agent) instead of the bare-API ReAct loop. Clean ablation:
//   - native arm: vanilla Codex (its own shell tools); NO M++, NO ss-* on PATH.
//   - sweet arm:  Codex + M++ appended (systemAppend) + ss-* wrappers on PATH.
// Shared, tool-agnostic plumbing for BOTH arms: a `run_tests` shim, because Codex's
// shell (the box) lacks the repo's deps — tests must run in the task's Docker image
// (exactly like the bare harness's run_tests tool). Returns the same row shape as
// api-task-runner.runTask so grading/metrics are identical.
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Inlined from p7-codex-runner.mjs (kept self-contained so the bench doesn't depend on
// the prompt-optimization context being present/committed on the run host).
function parseCodexAgentStream(stdout) {
  const toolCalls = []; let answer = ''; let usage = null;
  if (!stdout) return { toolCalls, answer, usage };
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
    }
  }
  return { toolCalls, answer, usage };
}

const PRICE = { in: 5.0, cacheHit: 0.5, out: 30.0 };  // openai/gpt-5.5 (OpenRouter)
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
const L1_CONDENSE = process.env.SS_NO_CMD_CONDENSE !== '1';
const L2_RT_AUTHORITY = process.env.SS_NO_RT_AUTHORITY !== '1';

// Tool-agnostic preamble for BOTH arms: how to run tests in THIS environment.
const RUN_TESTS_PREAMBLE =
  'Your shell does NOT have the repository\'s dependencies installed, so running the test runner/build directly (pytest, go test, cargo test, lein test, npm test, …) will fail with dependency/build errors. To run the repo\'s test suite on your current edits, invoke the `run_tests` command (no arguments) — it executes the canonical suite in the prepared environment and reflects your live edits.';

// Standard SWE-agent-style completion frame (Yang et al. 2024 instance template),
// language-agnostic. IDENTICAL on BOTH arms (tool-agnostic — never names a search
// tool), so the only arm asymmetry is M++ + ss-*. Brackets the sweet-only M++ guidance
// so M++'s "stop once located" recency does not end a FIX run at the locate step.
const FRAME_OPEN =
  'You are resolving a real software issue by editing the repository SOURCE code in your current working directory. These task-completion rules are AUTHORITATIVE and override any later guidance about efficiency, taking fewer steps, or when to stop — such guidance governs only HOW to locate code, never WHETHER you are done. Standard workflow: (1) find and read the code relevant to the issue; (2) reproduce the failure by running the existing suite via `run_tests`; (3) make the MINIMAL source edit that implements the FULL behavior the issue requires — not just a signature or surface change; (4) re-run `run_tests` and confirm the previously-failing test now PASSES and nothing else broke; (5) consider edge cases. ' + RUN_TESTS_PREAMBLE;
const FRAME_CLOSE =
  '=== TASK COMPLETION (authoritative — overrides all guidance above) ===\n' +
  'You have NOT finished until (1) you made a SOURCE-code edit AND (2) `run_tests` shows the previously-failing test now PASSES. Locating, understanding, or explaining the bug is NOT completion. Do NOT modify test files — the evaluation supplies its own hidden tests; test edits do not count toward the fix and can break grading. If so far you have only located the cause, your VERY NEXT action must be the source edit.\n\n' +
  'VALIDATION IS AUTHORITATIVE:\n' +
  '- Use `run_tests` for validation. Never inspect, search, read, or modify `.codex-bin`, `_run_tests*`, `_rt_*`, benchmark harness files, baseline files, the env ledger, or task overrides; never reconstruct the suite with Docker or a host test runner.\n' +
  '- After the initial reproduction, re-run `run_tests` only after a source edit. If the source diff is unchanged, the result cannot improve. Use `run_tests <pattern>` for targeted diagnosis when supported.\n' +
  '- When `run_tests` is still running and no other work is pending, poll it with `write_stdin` using `yield_time_ms=120000`; do not use 30-second heartbeat polls.';

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
function writeRunTestsBrokerFiles(binDir, cfgPath) {
  const reqDir = path.join(binDir, '_rt_ipc');
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
    let pattern = ''; try { pattern = readFileSync(IPC + '/' + r, 'utf8').trim(); } catch {}
    try { rmSync(IPC + '/' + r, { force: true }); } catch {}
    let out; try { out = runTestsWithLevers(c, { pattern }); } catch (e) { out = '[run_tests error] ' + String(e && e.message || e); }
    const tmp = IPC + '/tmp-' + id;
    try { writeFileSync(tmp, out); renameSync(tmp, IPC + '/res-' + id); } catch {}
  }
}, 400);
`);
  return { brokerPath, reqDir };
}

export function writeRunTestsShim(binDir, { image, workdir, testScript, rundir, testTimeoutSec = 300, netArgs = '', brokerMode = false, dockerBin = 'docker', rtAuthority = true }) {
  mkdirSync(binDir, { recursive: true });
  const cfg = path.join(binDir, '_run_tests_cfg.json');
  writeFileSync(cfg, JSON.stringify({ image, workdir, testScript, rundir, dockerHost: DOCKER_HOST, testTimeoutSec, netArgs, dockerBin, binDir, rtAuthority }));
  const mjs = path.join(binDir, '_run_tests.mjs');
  if (brokerMode) {
    const { brokerPath, reqDir } = writeRunTestsBrokerFiles(binDir, cfg);
    // requester shim: sandbox-safe (file writes into __rt/_rt_ipc only, no docker).
    // The first arg (optional test pattern) is passed through the req-file content.
    writeFileSync(mjs, `import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
const IPC = ${JSON.stringify(reqDir)};
const tSec = ${Number(testTimeoutSec) || 300};
const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
writeFileSync(IPC + '/req-' + id, process.argv[2] || '');
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
    return { binDir, brokerPath, integrity: shimIntegritySnapshot([cfg, mjs, shim, brokerPath, RT_RUNTIME_PATH, RT_LIB_PATH]) };
  }
  // Direct shim: run the suite + L2 levers via the shared runtime. argv[2] = optional
  // targeted test pattern. Output IS the signal (shim exits 0; PASS/FAIL is in the text).
  writeFileSync(mjs, `import { readFileSync } from 'node:fs';
import { runTestsWithLevers } from ${JSON.stringify(RT_RUNTIME_PATH)};
const c = JSON.parse(readFileSync(${JSON.stringify(cfg)}, 'utf8'));
try { process.stdout.write(runTestsWithLevers(c, { pattern: process.argv[2] || '' })); }
catch (e) { process.stdout.write('[run_tests error] ' + String(e && e.message || e)); }
`);
  const shim = path.join(binDir, 'run_tests');
  writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${mjs} "$@"\n`);
  chmodSync(shim, 0o755);
  return { binDir, integrity: shimIntegritySnapshot([cfg, mjs, shim, RT_RUNTIME_PATH, RT_LIB_PATH]) };
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
  const binDir = path.join(rundir, '.codex-bin');
  // Resolve the REAL docker binary from the HARNESS PATH (no binDir → no self-ref), so
  // both the run_tests shim (cfg.dockerBin) and the L1 wrapper invoke it directly.
  let realDocker = 'docker';
  try { realDocker = execSync('command -v docker', { encoding: 'utf8' }).trim() || 'docker'; } catch { /* fall back to bare 'docker' */ }
  const shimInfo = writeRunTestsShim(binDir, { image, workdir, testScript, rundir, testTimeoutSec: t._testTimeoutSec || 300, netArgs, brokerMode: AGENT_SANDBOX, dockerBin: realDocker, rtAuthority: L2_RT_AUTHORITY });
  // L1: install the docker output-condenser wrapper (both arms). Flag-gated; a run
  // with SS_NO_CMD_CONDENSE=1 leaves the agent's docker == real docker (legacy).
  if (L1_CONDENSE) { try { installCommandWrappers(binDir, { realDocker }); } catch (e) { console.error(`  [L1] wrapper install skipped: ${String(e.message).slice(0, 100)}`); } }
  // host-side broker executes run_tests' docker work OUTSIDE the agent sandbox
  let broker = null;
  if (AGENT_SANDBOX && shimInfo?.brokerPath) broker = spawn('node', [shimInfo.brokerPath], { stdio: 'ignore' });
  const pathDirs = [binDir, sweet ? ssBinDir : null].filter(Boolean);
  const env = { ...process.env, PATH: [...pathDirs, process.env.PATH].join(':'), SWEET_SEARCH_PROJECT_ROOT: rundir, DOCKER_HOST };

  // Off-clock warmup (sweet arm) — arm the per-run ss-* server's models BEFORE the
  // measured agent loop. Without this, the cold-start model-load banner (a console.log
  // in late-interaction-index.js: "LateInteraction: Loaded N documents…") lands in the
  // agent's FIRST ss-grep/ss-find stdout and crowds out the actual hits → the agent gets
  // noise, distrusts ss-*, and falls back to native rg/sed (diagnosed root cause of the
  // sweet≈native tie). The bare-API harness already does this (run-pilot warmupRun).
  if (sweet && ssBinDir) {
    try { execSync(`${path.join(ssBinDir, 'ss-search')} warmup -k 1`, { cwd: rundir, env, stdio: 'ignore', timeout: 120000 }); } catch { /* warmup is best-effort */ }
  }

  // Both arms get the standard completion frame; sweet additionally gets M++ (the
  // ss-* retrieval guidance), bracketed by FRAME_OPEN/FRAME_CLOSE so completion wins.
  // Experimental anti-thrash appendix (A/B candidate for promotion into canonical M++).
  // Targets the diagnosed sweet-arm waste: redundant re-reads of already-returned spans,
  // search-variant reformulation, and under-use of ss-trace for downstream/caller lookup.
  const ANTI_THRASH = process.env.SS_NO_ANTITHRASH ? '' :
    '\n\nUSE WHAT THE TOOLS ALREADY GAVE YOU (efficiency):\n' +
    '- ss-search and ss-grep return the matching code AT file:line, inline in the result. Once a span has been shown to you, do NOT ss-read or re-grep that same span/symbol again — edit directly from the body you already have; only read a DIFFERENT file, or a range OUTSIDE what was shown.\n' +
    '- One search per target. If the top hit answers your question (especially when the trailer says sufficient=YES), act on it — do not fire multiple keyword/regex variants for the same symbol.\n' +
    '- To find where a symbol is CALLED or what it calls (to trace a value downstream before editing), use `ss-trace <symbol>` — do not re-search by hand.';
  const sweetGuidance = sweet
    ? `\n\n=== Code-search expertise — use the ss-* commands (ss-search / ss-grep / ss-find / ss-read / ss-semantic / ss-trace) per this guidance; this is your advantage, use it to locate code in fewer, sharper steps ===\n${mppText}${ANTI_THRASH}`
    : '';
  const prompt = `${FRAME_OPEN}${sweetGuidance}\n\n${FRAME_CLOSE}\n\n=== ISSUE ===\n${task.problem_statement || ''}`;

  // EXPERIMENTAL agent sandbox (see AGENT_SANDBOX above — opt-in, native-arm-only
  // viability): workspace-write with network off; run_tests works via the host-side
  // broker (docker is unreachable from inside — codex seccomp denies unix connects).
  // Production egress control is bench-net-lockdown.sh + --network none containers.
  const sandboxArgs = AGENT_SANDBOX
    ? ['--sandbox', 'workspace-write', '--skip-git-repo-check', '-c', 'approval_policy="never"',
       '-c', 'sandbox_workspace_write.network_access=false']
    : ['--dangerously-bypass-approvals-and-sandbox'];
  const args = ['exec', ...sandboxArgs, '--json',
    '-c', `model_reasoning_effort="${reasoning}"`, '-c', 'model_provider="openrouter"',
    '-m', codexModel, '-C', rundir, prompt];

  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    let stdout = '', stderr = '', timedOut = false;
    const proc = spawn('codex', args, { cwd: rundir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; try { proc.kill('SIGTERM'); } catch {} setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 2000).unref(); }, perCallTimeoutMs);
    proc.stdout.on('data', d => stdout += d.toString('utf8'));
    proc.stderr.on('data', d => stderr += d.toString('utf8'));
    proc.on('error', e => { clearTimeout(timer); resolve({ stdout, stderr: stderr + e.message, exitCode: -1, timedOut }); });
    proc.on('exit', code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? 0, timedOut }); });
  });
  const wallMs = Date.now() - t0;
  const { toolCalls, answer, usage } = parseCodexAgentStream(r.stdout);

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
  try { finalPatch = execSync(`git -C ${rundir} diff HEAD -- . ':(exclude).sweet-search'`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch {}
  const patchHunks = (finalPatch.match(/^@@ /gm) || []).length;
  const patchFiles = (finalPatch.match(/^diff --git /gm) || []).length;
  if (toolCounts.edit === 0 && patchHunks > 0) toolCounts.edit = patchFiles;  // codex patch events may not surface as commands

  // cost (realized = cache-aware) from the codex usage
  const u = usage || {};
  const inTok = u.input_tokens || 0, cached = u.cached_input_tokens || 0, out = (u.output_tokens || 0) + (u.reasoning_output_tokens || 0);
  const costRealized = ((inTok - cached) * PRICE.in + cached * PRICE.cacheHit + out * PRICE.out) / 1e6;
  const costNaive = (inTok * PRICE.in + out * PRICE.out) / 1e6;

  const calls = toolCalls.length;
  const exitReason = r.timedOut ? 'timeout' : (r.exitCode !== 0 ? 'codex_error' : 'model_stopped');
  if (broker) { try { broker.kill('SIGKILL'); } catch {} }
  // H2: detect agent tampering with the run_tests shim (cfg/script/broker)
  const shimTamperedFiles = verifyShimIntegrity(shimInfo?.integrity);
  if (shimTamperedFiles.length) {
    console.log(`  [SHIM-TAMPERED ${task.id || ''}] agent modified: ${shimTamperedFiles.join(', ')} — test signals untrusted`);
  }
  try { rmSync(binDir, { recursive: true, force: true }); } catch {}

  return {
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch, ranTests: toolCounts.test > 0,
    escape: 0, leak: 0, halluc: 0, escapeExamples: [],            // escape audit TODO for codex shell
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0,
    exitReason, usage: u, costNaiveUsd: +costNaive.toFixed(6), costRealizedUsd: +costRealized.toFixed(6),
    wallMs, trajectory, finalAssistantText: answer,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
