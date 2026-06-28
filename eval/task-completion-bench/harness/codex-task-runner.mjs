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
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
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
  'You have NOT finished until (1) you made a SOURCE-code edit AND (2) `run_tests` shows the previously-failing test now PASSES. Locating, understanding, or explaining the bug is NOT completion. Do NOT modify test files — the evaluation supplies its own hidden tests; test edits do not count toward the fix and can break grading. If so far you have only located the cause, your VERY NEXT action must be the source edit.';

function writeRunTestsShim(binDir, { image, workdir, testScript, rundir }) {
  mkdirSync(binDir, { recursive: true });
  const cfg = path.join(binDir, '_run_tests_cfg.json');
  writeFileSync(cfg, JSON.stringify({ image, workdir, testScript, rundir, dockerHost: DOCKER_HOST }));
  const mjs = path.join(binDir, '_run_tests.mjs');
  writeFileSync(mjs, `import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
const c = JSON.parse(readFileSync(${JSON.stringify(cfg)}, 'utf8'));
const q = s => "'" + String(s).replace(/'/g, "'\\\\''") + "'";
let diff = '';
try { diff = execSync('git -C ' + c.rundir + " diff HEAD -- . ':(exclude).sweet-search'", { encoding: 'utf8', maxBuffer: 16*1024*1024 }); } catch {}
const pdir = c.rundir + '__rt';
try {
  rmSync(pdir, { recursive: true, force: true }); mkdirSync(pdir, { recursive: true });
  writeFileSync(pdir + '/agent.diff', diff || '');
  const script = 'cd ' + c.workdir + ' && git reset --hard HEAD -q 2>/dev/null; git apply --3way --recount --ignore-space-change --whitespace=nowarn /patch/agent.diff 2>/dev/null || true; timeout 300 bash -c ' + q(c.testScript) + ' 2>&1 | tail -60';
  // NO --network host: at CONCURRENCY>1, concurrent test containers sharing the host
  // net namespace collide on any port a test binds (→ flaky failures → corrupted
  // resolved numbers). Default bridge isolates each (own localhost + ports).
  const out = execSync('docker run --rm -v ' + pdir + ':/patch:ro ' + c.image + ' bash -c ' + q(script), { env: { ...process.env, DOCKER_HOST: c.dockerHost }, encoding: 'utf8', timeout: 360000, maxBuffer: 4*1024*1024, stdio: ['ignore','pipe','pipe'] });
  process.stdout.write(out.slice(0, 8000));
} catch (e) { process.stdout.write('[run_tests exit=' + (e.status ?? 1) + ']\\n' + String(e.stdout || e.stderr || e.message || '').slice(0, 6000)); }
finally { try { rmSync(pdir, { recursive: true, force: true }); } catch {} }
`);
  const shim = path.join(binDir, 'run_tests');
  writeFileSync(shim, `#!/usr/bin/env bash\nexec node ${mjs} "$@"\n`);
  chmodSync(shim, 0o755);
  return binDir;
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
  const binDir = path.join(rundir, '.codex-bin');
  writeRunTestsShim(binDir, { image, workdir, testScript, rundir });
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

  const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json',
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
  try { rmSync(binDir, { recursive: true, force: true }); } catch {}

  return {
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch, ranTests: toolCounts.test > 0,
    escape: 0, leak: 0, halluc: 0, escapeExamples: [],            // escape audit TODO for codex shell
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0,
    exitReason, usage: u, costNaiveUsd: +costNaive.toFixed(6), costRealizedUsd: +costRealized.toFixed(6),
    wallMs, trajectory, finalAssistantText: answer,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
