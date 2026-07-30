#!/usr/bin/env node
/**
 * Graded pilot orchestrator: for each SWE-bench task × arm × rep, check out the
 * repo at base_commit (fresh-init → ZERO git-history leakage), build the ss
 * index (sweet arm), run the DeepSeek edit loop, then grade predictions with the
 * OFFICIAL swebench Docker harness (authoritative, publishable). Host-venv
 * grading is a future fast cross-check; Docker is the source of truth.
 *
 * The agent only ever sees `problem_statement` + the repo at base_commit. The
 * gold patch + test_patch live ONLY in the dataset and are applied inside the
 * swebench grading container — never on the agent's filesystem.
 *
 * Usage:
 *   INSTANCES=pallets__flask-4992 MODEL=deepseek-v4-pro \
 *     node eval/task-completion-bench/harness/run-pilot.mjs
 */
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTask } from './api-task-runner.mjs';
import { runCodexTask } from './codex-task-runner.mjs';
import { runClaudeCodeTask } from './claude-code-task-runner.mjs';
import { runOpencodeTask } from './opencode-task-runner.mjs';
import { shimVerdict } from './shim-policy.mjs';
import { gradeFromReportItem, loadLedger, preflightEnvLedger, vaultTarName } from './env-ledger.mjs';
import { createEvaluatorRuntime } from './evaluator-runtime.mjs';
import { ISOLATION_ON, jailPreflight, guardStatus, DENY_LOG } from './agent-jail.mjs';
import { RT_DEDUP_ON } from './rt-dedup.mjs';
import { ensureGuard } from './egress-guard.mjs';
import { scanPredictions } from './gold-tripwire.mjs';
// HARNESS routes the agent loop through a REAL production coding agent (uncapped — runs
// to completion) instead of the bare-API ReAct loop. All share grading/metrics + the
// identical completion frame; native=vanilla agent, sweet=agent + M++ + ss-* on PATH.
//   codex      → `codex exec`   (GPT models, provider=openrouter)
//   claudecode → `claude -p`    (Anthropic models via OpenRouter's Anthropic skin)
//   opencode   → `opencode run` (Grok / Muse / other, provider=openrouter)
//   bareapi    → legacy hand-written OpenAI loop (RETIRED for real runs — has a 60-call cap)
const HARNESS = process.env.HARNESS || 'bareapi';
// Wall-clock hang-guard per rollout (agents run to completion, so this only bounds a stuck
// process, never the agent's own call budget). Shared across harnesses for comparability.
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || process.env.CODEX_TIMEOUT_MS) || 1800000;

// INDEX INTEGRITY via PER-RUN ISOLATION (runner-only — zero changes to the
// sweet-search engine; incremental indexing runs exactly as it ships).
//
// We deliberately DO NOT freeze the maintainer: on a real multi-step task the
// agent edits the repo and must then search the *updated* code — that working-
// tree-tracking freshness is part of sweet-search's value, exactly the thing the
// compounding hypothesis tests. Freezing would undersell it.
//
// Instead, isolation is structural: a read-only GOLDEN template (clean repo +
// clean base index, built once per repo@commit) is `cp`-copied into a UNIQUE dir
// per run. Each run's copy gets its own project-root → its own ss-* socket,
// server, and incremental maintainer (verified: socket = hash(projectRoot)), so
// concurrent runs on the same repo CANNOT poison each other's index, the agent
// sees its own edits (fresh), and the golden is never written (clean baseline
// preserved). The run dir is deleted after grading. Proven on Linux x86:
// two copies, incremental on, each sees only its own edit, golden hash unchanged.
//
// The golden index itself is built with the maintainer off (a clean static
// snapshot); only the per-run COPIES run incremental-on.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BENCH = path.join(ROOT, 'eval/task-completion-bench');
const SS_BIN = path.join(ROOT, 'eval/agent-read-workflows/bin');
const MPP = process.env.MPP || path.join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md');
const ARMS = (process.env.ARMS || 'native,sweet').split(',').map(s => s.trim()).filter(Boolean); // arm filter (e.g. ARMS=sweet) for prompt-variant smokes
const INDEXER = path.join(ROOT, 'core/indexing/index-codebase-v21.js');
const VENV_PY = path.join(BENCH, '.venv-grade/bin/python');
const DOCKER_HOST = process.env.DOCKER_HOST || 'unix:///Users/admin/.colima/default/docker.sock';
const DATASET = 'princeton-nlp/SWE-bench_Lite';
const MODEL = process.env.MODEL || 'deepseek-v4-pro';
const PROVIDER = process.env.PROVIDER || 'deepseek';
const CONCURRENCY = Math.max(1, +(process.env.CONCURRENCY || 4));
const REPS = +(process.env.REPS || 1);
// REASONING: passed through to the model (gpt-5.5 honors low/medium/high). MAX_TOOL_CALLS:
// per-run tool-call ceiling — raise it so strong models FINISH (stop on sufficiency =
// model_stopped) instead of truncating at the old hardcoded 60 (which censored both
// resolution and the cost-to-solve comparison). Still bounds pathological loops.
const REASONING = process.env.REASONING || 'standard';
const MAX_TOOL_CALLS = Math.max(1, +(process.env.MAX_TOOL_CALLS || 60));
// In SR mode, INSTANCES defaults to ALL ids in the materialized task file (set
// after loadTasks); explicit INSTANCES still subsets. Lite mode keeps its default.
let INSTANCES = (process.env.INSTANCES || (process.env.TASKS_FILE ? '' : 'pallets__flask-4992')).split(',').map(s => s.trim()).filter(Boolean);
const CACHE = path.join(BENCH, 'tasks/_lite-cache.json');
// Checkouts live under $HOME (colima shares $HOME into the VM, NOT /tmp) so the
// swebench image can bind-mount them for run_tests. Still outside our project
// tree → escape isolation preserved.
const EVAL_HOME = path.join(process.env.HOME, '.ss-eval');
// swebench image naming: instance_id `a__b-N` → `a_1776_b-N`, arch x86_64.
const imageNameFor = (id) => `swebench/sweb.eval.x86_64.${id.replace('__', '_1776_')}:latest`;
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";  // single-quote for bash -c

// --- SWE-rebench mode --- When TASKS_FILE points to a materialized full-spec
// JSON (select/.cache/tasks_full_*.json), tasks come from SWE-rebench and grading
// uses SWE-rebench's eval.py (20-language parsers) instead of the swebench-Lite
// path. Image = each task's own image_name (docker pull); workdir = the repo dir
// inside the image (V2 = /<basename>, V1 leaderboard = /testbed; stamped per task).
const TASKS_FILE = process.env.TASKS_FILE || '';
const SR_MODE = !!TASKS_FILE;
const SR_EVAL_DIR = process.env.SR_EVAL_DIR || '/root/swe-rebench-tools/SWE-rebench-V2';
const SR_EVAL_RUNNER = path.join(BENCH, 'harness/sr-eval.py');
const taskById = new Map(); // instance_id -> full spec (populated by loadTasks in SR mode)

// --- Per-task harness overrides (bench hygiene, 2026-07-07) ---
// task-overrides.json maps instance_id → { testTimeoutSec, testCmd, image, network,
// dockerRunArgs } for env-broken tasks (see analysis/full200-failure-analysis-2026-07-06.md
// §4.3). Applied ONCE in loadTasks by mutating the in-memory spec, so the agent-phase
// run_tests (bareapi + codex shim), ensureImage, AND grading (gradeArm writes the mutated
// specs into tasks.json for eval.py) all see the same repaired task. The global default
// test timeout stays 300s — only mapped tasks differ. NO_TASK_OVERRIDES=1 → map ignored.
const OVERRIDES_PATH = process.env.TASK_OVERRIDES || path.join(BENCH, 'harness/task-overrides.json');
const TASK_OVERRIDES = (!process.env.NO_TASK_OVERRIDES && existsSync(OVERRIDES_PATH))
  ? JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')) : { defaults: {}, tasks: {} };
const DEFAULT_TEST_TIMEOUT_SEC = Number(TASK_OVERRIDES.defaults?.testTimeoutSec) || 300;
// --- Container egress lockdown (default ON) ---
// Task containers (agent-phase run_tests + grading) run with --network none: external
// egress blocked, container-own loopback preserved (in-repo localhost test servers keep
// working — namespace property, holds under 'none'). Per-task exception: network:"bridge"
// in the override map. SS_BENCH_ALLOW_NET=1 restores historical full-egress behavior
// (no --network flag at all → byte-identical legacy docker commands).
const NET_LOCKDOWN = process.env.SS_BENCH_ALLOW_NET !== '1';
// --- Agent-SHELL egress lockdown (host-level, both arms) ---
// The codex agent runs on the HOST (not in a container), so --network none cannot stop
// it fetching upstream PR diffs (the derive_more leak). Codex's own sandbox was probed
// and rejected (blocks ALL unix sockets → kills ss-* daemons + docker; see design note).
// Mechanism: bench-net-lockdown.sh writes a marker-delimited /etc/hosts block mapping
// code-hosting domains to 0.0.0.0 — symmetric across arms, OpenRouter/docker.io
// untouched. Auto-enabled here for codex runs on Linux; never auto-disabled (operator:
// `bench-net-lockdown.sh off`). While ON, golden clones from github FAIL — warm first.
if (NET_LOCKDOWN && HARNESS === 'codex' && process.platform === 'linux' && !ISOLATION_ON) {
  const lockScript = path.join(BENCH, 'harness/bench-net-lockdown.sh');
  try {
    if (!/ACTIVE/.test(execSync(`bash ${lockScript} status`, { encoding: 'utf8' }))) {
      execSync(`bash ${lockScript} on`, { encoding: 'utf8' });
      console.log('[net-lockdown] agent-shell code-host DNS block ENABLED (bench-net-lockdown.sh off to remove)');
    } else console.log('[net-lockdown] agent-shell code-host DNS block active');
  } catch (e) { console.error(`[net-lockdown] WARNING: could not verify/enable agent-shell egress lockdown: ${String(e.message).slice(0, 120)}`); }
}

// --- P0 ISOLATION GATE (blocking, 2026-07-29) ---
// The held-out run's solve headline is unpublishable because the agent ran on the host
// with six open escape vectors and `escape=0` was a hardcoded literal. Every CLI harness
// now runs each rollout in a jail (agent-jail.mjs). A run that CANNOT isolate must not
// start quietly and produce numbers that look identical to isolated ones — the whole
// failure mode last time was contamination that no column recorded. Emergency override:
// SS_ISOLATION=0, which stamps every row so the result can never be mistaken for clean.
const CLI_HARNESS = ['codex', 'claudecode', 'opencode'].includes(HARNESS);
if (CLI_HARNESS && ISOLATION_ON) {
  const pf = jailPreflight();
  if (!pf.ok) {
    console.error(`[isolation] PRE-FLIGHT FAILED — refusing to launch an unisolated ${HARNESS} run:`);
    for (const r of pf.reasons) console.error(`  - ${r}`);
    console.error('[isolation] Fix the host, or accept contaminated rows explicitly with SS_ISOLATION=0.');
    process.exit(1);
  }
  const g = ensureGuard();
  console.log(`[isolation] ON — per-rollout mount/pid/net jail; egress allowlist: ${g.allow.join(', ')}; denials → ${DENY_LOG}`);
} else if (CLI_HARNESS) {
  console.error('[isolation] *** OFF (SS_ISOLATION=0) — rows from this run carry the documented contamination risk and MUST NOT be published as a clean comparison. ***');
}
// docker-run net/extra args for a task spec (SR mode). 'legacy' → empty (historical).
function dockerNetArgs(t) {
  const extra = (t?._dockerRunArgs || []).join(' ');
  if (!NET_LOCKDOWN) return extra ? extra + ' ' : '';
  const net = t?._network === 'bridge' ? 'bridge' : 'none';
  return `--network ${net} ${extra ? extra + ' ' : ''}`;
}
const { ensureImage, makeRunTests, gradeArm } = createEvaluatorRuntime({
  benchDir: BENCH, dataset: DATASET, defaultTestTimeoutSec: DEFAULT_TEST_TIMEOUT_SEC,
  dockerHost: DOCKER_HOST, dockerNetArgs, gradeReportItem: gradeFromReportItem,
  imageNameFor, netLockdown: NET_LOCKDOWN, shellQuote: shq,
  srEvalDir: SR_EVAL_DIR, srEvalRunner: SR_EVAL_RUNNER, srMode: SR_MODE, taskById,
  taskOverrides: TASK_OVERRIDES, venvPython: VENV_PY,
});
async function loadTasks() {
  if (SR_MODE) {
    const specs = JSON.parse(readFileSync(TASKS_FILE, 'utf8'));
    for (const s of specs) {
      const ov = TASK_OVERRIDES.tasks?.[s.instance_id];
      s._testTimeoutSec = Number(ov?.testTimeoutSec) || DEFAULT_TEST_TIMEOUT_SEC;
      if (ov?.network) s._network = ov.network;
      if (ov?.dockerRunArgs) s._dockerRunArgs = ov.dockerRunArgs;
      if (ov?.testCmd) s.install_config = { ...s.install_config, test_cmd: ov.testCmd };
      if (ov?.image) { s._origImage = s.image_name; s.image_name = ov.image; }
      if (ov) console.log(`[overrides] ${s.instance_id}: ${Object.keys(ov).filter(k => k[0] !== '_').join(', ')}`);
      taskById.set(s.instance_id, s);
    }
    return specs;
  }
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
  let all = [];
  for (let off = 0; off < 300; off += 100) {
    const r = await fetch(`https://datasets-server.huggingface.co/rows?dataset=${DATASET}&config=default&split=test&offset=${off}&length=100`);
    all.push(...(await r.json()).rows.map(x => x.row));
  }
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(all));
  return all;
}

function sh(cmd, opts = {}) { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }); }

// Reap ss-* daemons between tasks so idle per-checkout servers (each holding
// models) don't accumulate and thrash the machine (documented orphan leak).
function reapServers() {
  try {
    const lines = execSync('ps axo pid=,command=', { encoding: 'utf8' }).split('\n');
    for (const ln of lines) {
      const m = ln.match(/^\s*(\d+)\s+(.*)$/); if (!m) continue;
      if (Number(m[1]) === process.pid) continue;
      if (/(search-server\.js|cli\.js\s+--serve|index-maintainer\.mjs)/.test(m[2])) { try { process.kill(Number(m[1]), 'SIGKILL'); } catch { /* */ } }
    }
    for (const e of execSync('ls /tmp 2>/dev/null', { encoding: 'utf8' }).split('\n')) {
      if (/^sweet-search.*\.sock$/.test(e)) { try { rmSync(`/tmp/${e}`, { force: true }); } catch { /* */ } }
    }
  } catch { /* */ }
}

// GOLDEN templates (read-only) + per-run isolated copies, keyed by repo@commit.
// The golden = clean repo @ base_commit + clean base index, built ONCE and never
// written. Runs are `cp` copies in unique dirs under RUNS_DIR, deleted after use.
const GOLDEN_DIR = path.join(EVAL_HOME, 'golden');
const RUNS_DIR = path.join(EVAL_HOME, 'runs');
const cacheKeyFor = (t) => `${t.repo.replace('/', '__')}@${t.base_commit}`;

// Build (once) the read-only golden template for a repo@commit. The CALLER
// serializes same-key builds via withCheckoutLock so concurrent siblings don't
// double-build. The golden index is built with the maintainer OFF (RECONCILE_V2=0)
// — a clean static snapshot; only the per-run COPIES run incremental-on.
function prepareGolden(t) {
  const gdir = path.join(GOLDEN_DIR, cacheKeyFor(t));
  if (existsSync(`${gdir}/.sweet-search/codebase.db`) && existsSync(`${gdir}/.git`)) return { dir: gdir, idxMs: 0, source: 'golden-cache' };
  rmSync(gdir, { recursive: true, force: true }); mkdirSync(gdir, { recursive: true });
  sh(`git clone --quiet https://github.com/${t.repo}.git ${gdir}`);
  sh(`git -C ${gdir} checkout --quiet ${t.base_commit}`);
  // fresh-init: drop history so no future-fix commit/ref is reachable by the agent
  sh(`rm -rf ${gdir}/.git && git -C ${gdir} init -q && printf '.sweet-search/\\n' > ${gdir}/.git/info/exclude && git -C ${gdir} add -A && git -C ${gdir} -c user.email=a@b.c -c user.name=bench commit -q -m base`);
  const t0 = Date.now();
  // 90 min: CPU (no Metal/GPU) index builds of bigger repos can exceed 30 min;
  // a too-tight timeout leaves a partial/corrupt golden index (seen: pylint ETIMEDOUT).
  const idxTimeout = Number(process.env.GOLDEN_TIMEOUT_MS) || 5400000;
  try {
    execFileSync('node', [INDEXER, '--full', '--sqlite-fast', '--concurrency=1'],
      { env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: gdir, SWEET_SEARCH_RECONCILE_V2: '0', SWEET_SEARCH_WATCH: '0' }, stdio: 'ignore', timeout: idxTimeout });
  } catch (e) {
    // drop the partial/corrupt golden so a resume rebuilds it cleanly instead of
    // treating a half-written .sweet-search as a finished golden.
    rmSync(gdir, { recursive: true, force: true });
    throw e;
  }
  return { dir: gdir, idxMs: Date.now() - t0, source: 'built' };
}

// Copy the golden into a UNIQUE per-run dir → its own project-root → its own
// ss-* socket/server/maintainer (full isolation). withIndex=false (native arm,
// no ss-*) skips the .sweet-search copy to save time/disk.
let __runCounter = 0;
function makeRunDir(goldenDir, runUid, withIndex) {
  const rundir = path.join(RUNS_DIR, `${runUid}__${++__runCounter}`);
  mkdirSync(RUNS_DIR, { recursive: true }); rmSync(rundir, { recursive: true, force: true });
  execFileSync('cp', ['-a', goldenDir, rundir]); // argv form: no shell, safe with any path chars
  if (!withIndex) rmSync(path.join(rundir, '.sweet-search'), { recursive: true, force: true });
  return rundir;
}

// Off-clock warmup: spawn + warm THIS run's ss-* server (models + index loaded)
// so the agent's first ss-* call isn't charged a cold start.
function warmupRun(rundir) {
  try { execFileSync(path.join(SS_BIN, 'ss-search'), ['warmup', '-k', '1'], { cwd: rundir, env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: rundir, PATH: SS_BIN + ':' + process.env.PATH }, stdio: 'ignore', timeout: 120000 }); } catch { /* */ }
}

// Tear down a finished run: SIGKILL exactly THIS run's ss-* server + maintainer,
// matched precisely by SWEET_SEARCH_PROJECT_ROOT in /proc/<pid>/environ (Linux,
// root) — concurrency-safe, never touches a sibling run's procs — then delete it.
function reapRunDir(rundir) {
  try {
    const out = sh(`grep -lZ "SWEET_SEARCH_PROJECT_ROOT=${rundir}" /proc/[0-9]*/environ 2>/dev/null || true`);
    for (const f of out.split('\0').filter(Boolean)) {
      const pid = f.replace('/proc/', '').replace('/environ', '');
      if (/^\d+$/.test(pid)) { try { process.kill(+pid, 'SIGKILL'); } catch { /* */ } }
    }
  } catch { /* */ }
  try { rmSync(rundir, { recursive: true, force: true }); } catch { /* */ }
}

const runId = process.env.RUN_ID || `pilot-${INSTANCES.length}x${REPS}`;
// L3 run_tests output dedup (rt-dedup.mjs): harness-side, BOTH arms, tests always run.
// Stamped on every row like `isolated`, so a run's rows always say which way it ran.
console.log(RT_DEDUP_ON
  ? `[rt-dedup] ON — a repeat run_tests with an identical diff+untracked+argv AND an identical result gets a compact summary (suite still runs); state/audit log → results/${runId}/rt-dedup/<task>-<arm>.jsonl`
  : '[rt-dedup] OFF (SS_RUNTESTS_DEDUP=0) — every run_tests invocation returns the full transcript.');
const all = await loadTasks();
if (SR_MODE && !INSTANCES.length) INSTANCES = all.map(t => t.instance_id);
// --- GREEN-LEDGER PRE-FLIGHT (standing rule 2026-07-09, non-negotiable) ---
// Every selected task must be gold-FULL in the env-ledger under the EXACT current
// config (image/imageId/testCmd/network/excludeP2P fingerprint). Missing, stale, or
// non-FULL ⇒ refuse to launch: env deaths are impossible by construction, not
// avoided by diligence. Emergency override: SS_SKIP_ENV_LEDGER=1 (logged loudly).
if (SR_MODE) {

  const LEDGER_PATH = process.env.ENV_LEDGER || path.join(BENCH, 'harness/env-ledger.jsonl');
  const sel = new Set(INSTANCES);
  const selSpecs = all.filter(t => sel.has(t.instance_id));
  const ledgerMap = loadLedger(LEDGER_PATH);
  const pfOpts = { netLockdown: NET_LOCKDOWN, overrides: TASK_OVERRIDES };
  // A warm/fixed task's configHash embeds its local docker image ID, so preflight
  // needs the image present. We can't hold all ~47 warm images at once (100GB+), so
  // load each from the /workspace vault transiently — load → hash-check that one task
  // → rmi — keeping peak disk to one image. The run loop reloads per-task (ensureImage)
  // and GCs per-task, so the whole 200 (153 stock + 47 warm) runs in ONE disk-bounded
  // run-pilot with no pre-staging. Stock tasks hash on image NAME, so they need no load.
  const DERIVED_BK = process.env.SS_DERIVED_BACKUP || '/workspace/docker-derived-backup';
  const imgLoaded = (img) => { try { execFileSync('docker', ['image', 'inspect', img], { env: { ...process.env, DOCKER_HOST }, stdio: 'ignore' }); return true; } catch { return false; } };
  const stockSpecs = selSpecs.filter(s => !s._origImage);
  const warmSpecs = selSpecs.filter(s => s._origImage);
  const failures = [...preflightEnvLedger(stockSpecs, ledgerMap, pfOpts).failures];
  for (const s of warmSpecs) {
    const already = imgLoaded(s.image_name);
    if (!already) {
      const tar = path.join(DERIVED_BK, vaultTarName(s.image_name));
      if (existsSync(tar)) { try { execFileSync('docker', ['load', '-i', tar], { env: { ...process.env, DOCKER_HOST }, stdio: 'ignore', timeout: 900000 }); } catch { /* preflight will flag it */ } }
    }
    failures.push(...preflightEnvLedger([s], ledgerMap, pfOpts).failures);
    if (!already) { try { execFileSync('docker', ['rmi', '-f', s.image_name], { env: { ...process.env, DOCKER_HOST }, stdio: 'ignore' }); } catch { /* */ } }
  }
  const envOk = failures.length === 0;
  // an INSTANCES id absent from the tasks file must fail loudly too (typo guard —
  // it would otherwise skip pre-flight and die mid-run)
  const known = new Set(all.map(t => t.instance_id));
  for (const id of INSTANCES) if (!known.has(id)) failures.push({ instance_id: id, reason: 'unknown-task', detail: `not present in ${TASKS_FILE}` });
  // golden-presence gate: env-ledger validates configHash (image/testCmd/network/excludeP2P)
  // but NOT that the golden checkout is staged. A missing golden silently falls back to
  // `git clone` (fails under lockdown) and the task is SKIPPED mid-run — so a whole run can
  // green the pre-flight yet process a handful of tasks. Require a valid golden per task in
  // a real run (skip when we're the thing that BUILDS goldens: WARM_ONLY / GOLDEN_ONLY).
  if (!process.env.WARM_ONLY && !process.env.GOLDEN_ONLY && process.env.SS_SKIP_GOLDEN_CHECK !== '1') {
    for (const s of selSpecs) {
      const gdir = path.join(GOLDEN_DIR, cacheKeyFor(s));
      if (!existsSync(`${gdir}/.sweet-search/codebase.db`) || !existsSync(`${gdir}/.git`))
        failures.push({ instance_id: s.instance_id, reason: 'golden-missing', detail: `no valid golden at ${gdir} (needs .sweet-search/codebase.db + .git) — stage it before launch (golden-vault push). Override: SS_SKIP_GOLDEN_CHECK=1` });
    }
  }
  const ok = envOk && failures.length === 0;
  if (!ok) {
    if (process.env.SS_SKIP_ENV_LEDGER === '1') {
      console.error(`[env-ledger] WARNING: pre-flight FAILED for ${failures.length} task(s) but SS_SKIP_ENV_LEDGER=1 — launching anyway (emergency override; rows on these tasks carry env risk)`);
      for (const f of failures) console.error(`  [env-ledger] ${f.instance_id}: ${f.reason} — ${f.detail}`);
    } else {
      console.error(`[env-ledger] PRE-FLIGHT FAILED (${LEDGER_PATH}) — refusing to launch. ${failures.length} selected task(s) lack a fresh gold-FULL verdict:`);
      for (const f of failures) console.error(`  ${f.instance_id}: ${f.reason} — ${f.detail}`);
      console.error(`[env-ledger] Fix: env-ledger-sweep.mjs (grade), prep-warm.mjs (warm+gate), or mark excluded with evidence. Emergency override: SS_SKIP_ENV_LEDGER=1.`);
      process.exit(1);
    }
  } else {
    console.log(`[env-ledger] pre-flight OK: ${selSpecs.length}/${selSpecs.length} selected tasks gold-FULL under current config (${LEDGER_PATH})`);
  }
  if (process.env.PREFLIGHT_ONLY === '1') {
    console.log('[env-ledger] PREFLIGHT_ONLY=1 — exiting after pre-flight (no rollouts run).');
    process.exit(ok ? 0 : 1);
  }
}
// Strip the YAML frontmatter (run_id/score_*/vault_* metadata) before feeding
// M++ to the agent — the eval scores must not leak into the system prompt.
const mppText = readFileSync(MPP, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const rows = [];
const predsByArm = { native: [], sweet: [] };   // rep0 only — back-compat preds-*.jsonl
const predsByRepArm = {};                        // { rep: { native:[], sweet:[] } } — grade EVERY rep for power

// --- LIVE PROGRESS counter (no black-box runs) ---
// TOTAL = instances × 2 arms × reps. After EVERY completed run (success or
// error) we print + append one line to results/<runId>/progress.log with the
// running count, valid-patch (predOk) tallies per arm, $ spent, and a wall-clock
// ETA (elapsed/done × remaining — naturally reflects the actual concurrency).
// `tail -f` that file for a live view. (resolve rate needs grading at the end;
// predOk = "produced a non-empty patch" is the live proxy.)
const TOTAL_RUNS = INSTANCES.length * 2 * REPS;
const t0run = Date.now();
const prog = { done: 0, errors: 0, cost: 0, predOk: { native: 0, sweet: 0 }, byArm: { native: 0, sweet: 0 } };
const PROGRESS_LOG = path.join(BENCH, 'results', runId, 'progress.log');
const fmtDur = s => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.max(0, Math.round(s / 60))}m`);
function emitProgress(tag = '') {
  const pct = TOTAL_RUNS ? ((prog.done / TOTAL_RUNS) * 100).toFixed(0) : '0';
  const elapsed = (Date.now() - t0run) / 1000;
  const eta = prog.done > 0 ? (elapsed / prog.done) * (TOTAL_RUNS - prog.done) : 0;
  const line = `[PROGRESS ${runId} ${prog.done}/${TOTAL_RUNS} ${pct}%] predOk n=${prog.predOk.native}/${prog.byArm.native} s=${prog.predOk.sweet}/${prog.byArm.sweet} | $${prog.cost.toFixed(3)} | elapsed ${fmtDur(elapsed)} ETA ${fmtDur(eta)}${prog.errors ? ` | errs ${prog.errors}` : ''}${tag}`;
  console.log(line);
  try { mkdirSync(path.dirname(PROGRESS_LOG), { recursive: true }); appendFileSync(PROGRESS_LOG, line + '\n'); } catch { /* */ }
}

// Checkpoint helper: each call writes a FULL snapshot of rows + per-arm preds, so
// concurrent invocations from sibling tasks can't corrupt a partial file (last
// writer wins on a complete document). Guarded so a write failure never aborts a task.
function checkpoint() {
  try {
    const od = path.join(BENCH, 'results', runId); mkdirSync(od, { recursive: true });
    writeFileSync(path.join(od, 'rows.json'), JSON.stringify(rows, null, 2));
    for (const arm of ARMS) writeFileSync(path.join(od, `preds-${arm}.jsonl`), predsByArm[arm].map(p => JSON.stringify(p)).join('\n') + '\n');
  } catch { /* */ }
}

// FIX B: per-checkout-dir mutex. cacheKeyFor() keys the checkout on repo@base_commit,
// NOT instance_id, so DISTINCT instances that share a repo@commit (SWE-bench Lite has
// a few, e.g. two sympy ids on one commit) resolve to the SAME $HOME/.ss-eval/<key>
// dir. Under the worker pool two such siblings could run concurrently and trample each
// other's live checkout (agent edits + the bind-mounted test container). This serializes
// ONLY same-key tasks; all distinct checkouts still run fully in parallel.
const checkoutLocks = new Map();
async function withCheckoutLock(key, fn) {
  const prev = checkoutLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(r => { release = r; });
  const mine = prev.then(() => gate);   // resolves only after prev done AND we release
  checkoutLocks.set(key, mine);
  await prev.catch(() => {});           // wait our turn; never inherit a sibling's rejection
  try { return await fn(); }
  finally {
    release();
    if (checkoutLocks.get(key) === mine) checkoutLocks.delete(key); // last holder cleans up
  }
}

// Per-task work for ONE instance. Build the golden ONCE (serialized per
// repo@commit), then each arm/rep runs in its OWN isolated cp-copy of the golden
// (own ss-* server/maintainer, incremental ON), deleted after. The worker pool
// runs up to CONCURRENCY of THESE instances concurrently; same-repo runs are safe
// because each has an isolated copy. reapServers() is NOT called here.
async function runOneTask(id) {
  const t = all.find(x => x.instance_id === id);
  if (!t) { console.error(`task ${id} not in dataset — skip`); return; }
  try {
    let golden;
    try { golden = await withCheckoutLock(cacheKeyFor(t), () => prepareGolden(t)); }
    catch (e) { console.error(`### ${id} golden FAILED: ${String(e.message).slice(0, 160)} — skip`); return; }
    console.log(`\n### ${id} (${t.repo}) — golden ${golden.source}${golden.idxMs ? ' in ' + (golden.idxMs / 1000).toFixed(0) + 's' : ' (cached)'}`);
    const image = process.env.GOLDEN_ONLY ? null : ensureImage(SR_MODE ? t : id);
    // WARM_ONLY: pre-build golden (+ swebench image unless GOLDEN_ONLY), then stop
    // (no agent runs). GOLDEN_ONLY skips the multi-GB per-instance image build so a
    // full-200 warm pass stays disk-safe (images are built lazily at grade time).
    if (process.env.WARM_ONLY) { console.log(`  warmed golden${image ? ' + image (' + image + ')' : ' (goldens-only)'} for ${id}`); return; }
    for (const arm of ARMS) {
      for (let rep = 0; rep < REPS; rep++) {
        const sweet = arm === 'sweet';
        // one measured attempt in its own isolated rundir; reaped no matter what.
        const attemptRun = async () => {
          const rundir = makeRunDir(golden.dir, `${id}__${arm}__r${rep}`, sweet);
          try {
            const runTests = makeRunTests(image, rundir, t);
            const task = { id, repoCheckout: rundir, mppPath: MPP, problem_statement: t.problem_statement };
            // Off-clock warm so the measured loop sees no cold start. Under isolation the
            // adapter warms INSIDE the rollout's jail instead — a server warmed out here
            // would sit in a different mount namespace, invisible to the agent.
            if (sweet && !(CLI_HARNESS && ISOLATION_ON)) warmupRun(rundir);
            const agentOpts = { arm, apiModel: MODEL, reasoning: REASONING, provider: PROVIDER, ssBinDir: SS_BIN, mppText, image, t, perCallTimeoutMs: AGENT_TIMEOUT_MS };
            if (HARNESS === 'codex') return await runCodexTask(task, agentOpts);
            if (HARNESS === 'claudecode') return await runClaudeCodeTask(task, agentOpts);
            if (HARNESS === 'opencode') return await runOpencodeTask(task, agentOpts);
            return await runTask(task, { arm, model: MODEL, apiModel: MODEL, provider: PROVIDER, reasoning: REASONING, maxToolCalls: MAX_TOOL_CALLS, ssBinDir: SS_BIN, mppText, policy: process.env.POLICY, runTests });
          } finally {
            reapRunDir(rundir); // kill this run's server/maintainer + delete its copy; golden untouched
          }
        };
        try {
          let r = await attemptRun();
          let attemptCost = Number(r.costRealizedUsd) || 0;      // spend accrues per ATTEMPT (re-run isn't free)
          // shimTampered policy (shim-policy.mjs): a tampered run's PASS/FAIL is
          // untrusted → invalid → automatic re-run ONCE; a second tamper EXCLUDES
          // the run from both arms' scored sets (counted in the report).
          const tamperFlags = [!!r.shimTampered];
          let v = shimVerdict(tamperFlags);
          if (v.needRerun) {
            console.log(`  [${arm} rep${rep}] SHIM-TAMPERED (${(r.shimTamperedFiles || []).join(', ')}) — invalid, automatic re-run (policy)`);
            const r2 = await attemptRun();
            attemptCost += Number(r2.costRealizedUsd) || 0;
            tamperFlags.push(!!r2.shimTampered);
            r = r2;                                              // re-run telemetry supersedes the tampered first run
            v = shimVerdict(tamperFlags);
            if (v.excluded) console.log(`  [${arm} rep${rep}] SHIM-TAMPERED on re-run too — EXCLUDED from scored set (counted in report)`);
          }
          const ranTests = (r.toolCounts?.test || 0) > 0;
          console.log(`  [${arm} rep${rep}] calls=${r.calls} ss=${r.ss} edits=${r.toolCounts.edit} hunks=${r.patchHunks} ranTests=${ranTests} escape=${r.escape} leak=${r.leak} $${r.costRealizedUsd} ideal$${r.idealCostUsd ?? '?'} ${(r.wallMs / 1000).toFixed(0)}s exit=${r.exitReason}${v.excluded ? ' [SHIM-EXCLUDED]' : (v.reran ? ' [shim-reran]' : '')}`);
          const pred = { instance_id: id, model_name_or_path: arm, model_patch: r.finalPatch || '' };
          // EXCLUDED runs never enter the scored prediction sets (both arms).
          if (!v.excluded) {
            if (rep === 0) predsByArm[arm].push(pred);
            (predsByRepArm[rep] = predsByRepArm[rep] || { native: [], sweet: [] })[arm].push(pred);
          }
          rows.push({ runId, taskId: id, repo: t.repo, arm, rep, model: MODEL, predOk: r.patchHunks > 0, ranTests, idxMs: golden.idxMs, idxSource: golden.source, shimReran: v.reran, shimExcluded: v.excluded, isolated: CLI_HARNESS && ISOLATION_ON, rtDedup: RT_DEDUP_ON, ...stripBig(r) });
          try { const td = path.join(BENCH, 'results', runId, 'trajectories'); mkdirSync(td, { recursive: true }); writeFileSync(path.join(td, `${id}-${arm}-r${rep}.json`), JSON.stringify({ taskId: id, arm, rep, exitReason: r.exitReason, toolCounts: r.toolCounts, ranTests, escapeExamples: r.escapeExamples, trajectory: r.trajectory }, null, 2)); } catch { /* */ }
          prog.done++; prog.byArm[arm]++; if (r.patchHunks > 0 && !v.excluded) prog.predOk[arm]++; prog.cost += attemptCost;
          if (v.excluded) prog.shimExcluded = (prog.shimExcluded || 0) + 1;
          emitProgress(`  (${id} ${arm} r${rep}: ${r.calls}c ${r.patchHunks}h ${(r.wallMs / 1000).toFixed(0)}s ${r.exitReason})`);
        } catch (e) {
          console.error(`  [${arm} rep${rep}] run error: ${String(e.message).slice(0, 160)}`);
          prog.done++; prog.errors++; prog.byArm[arm]++; emitProgress(`  (${id} ${arm} r${rep}: ERROR)`);
        }
      }
    }
    // Per-task image GC: all arms × reps for this task are done. Drop ONLY this
    // task's multi-GB SR docker image so a full-200 run stays disk-bounded
    // (~CONCURRENCY images resident at once). This is `docker rmi` of a single
    // image_name — it NEVER touches the indexed goldens under ~/.ss-eval/golden
    // (plain dirs + .sweet-search/codebase.db, separate from docker image storage)
    // and is never a broad `docker system prune`. A later grade pass re-pulls.
    if (image && SR_MODE && !process.env.NO_IMAGE_GC && !t._origImage) {
      try { execFileSync('docker', ['rmi', '-f', image], { env: { ...process.env, DOCKER_HOST }, stdio: 'ignore', timeout: 60000 }); }
      catch { /* image still referenced or already gone — ignore */ }
    }
  } catch (e) {
    console.error(`### ${id} FAILED: ${String(e.message).slice(0, 200)} — skipping`);
  }
  checkpoint();
}

// FIX B: minimal dependency-free async worker pool — N workers each pull the next
// index off a shared cursor until the queue drains. Each task is fully isolated by
// runOneTask's own try/catch, so one failure can't abort the pool.
async function runPool(ids, concurrency) {
  let next = 0;
  const worker = async () => { while (next < ids.length) { const i = next++; await runOneTask(ids[i]); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
}

function stripBig(r) { const { finalPatch, trajectory, ...rest } = r; return rest; }

console.log(`\n### running ${INSTANCES.length} task(s) × 2 arms × ${REPS} reps = ${TOTAL_RUNS} runs | CONCURRENCY=${CONCURRENCY} provider=${PROVIDER} model=${MODEL} frame=${process.env.TASK_FRAME !== '0' ? 'ON' : 'OFF'}`);
emitProgress(' (start)');
await runPool(INSTANCES, CONCURRENCY);
// reap ss-* daemons ONCE, after the whole pool drains (never mid-pool — would kill
// sibling tasks' live servers).
reapServers();

// Grade EVERY rep × arm via the swebench/SR Docker harness (multi-rep = variance power).
// Each arm/rep keeps task-merged report/patch artifacts; row resolution is also
// set per (arm, rep).
console.log('\n### grading via swebench (Docker, authoritative) — all reps');
const repsToGrade = process.env.GRADE === '0' ? [] : Object.keys(predsByRepArm).map(Number).sort((a, b) => a - b);
if (process.env.GRADE === '0') console.log('### grading SKIPPED (GRADE=0)');
for (const rep of repsToGrade) {
  for (const arm of ARMS) {
    const preds = predsByRepArm[rep]?.[arm] || [];
    if (!preds.length) continue;
    const report = gradeArm(arm, preds, runId, rep);
    const resolvedIds = new Set(report?.resolved_ids || []);
    const errorIds = new Set(report?.error_ids || []);
    const score = report?.score || {};
    for (const row of rows) if (row.arm === arm && row.rep === rep) {
      row.gradeable = !errorIds.has(row.taskId);
      row.resolved = row.gradeable ? resolvedIds.has(row.taskId) : null;
      row.f2pFrac = row.gradeable ? (score[row.taskId]?.f2pFrac ?? null) : null;
      row.resolveStatus = row.gradeable ? (score[row.taskId]?.status ?? null) : null;
    }
    console.log(`  ${arm} rep${rep}: resolved ${resolvedIds.size}/${preds.length - errorIds.size} gradeable  ids=${[...resolvedIds].join(',') || '(none)'}`);
  }
}

const outDir = path.join(BENCH, 'results', runId);
mkdirSync(outDir, { recursive: true });

// --- GOLD TRIPWIRE (P0 item 6) --- detector of last resort behind the jail: a patch
// that is a near-verbatim copy of gold means the answer was obtained, not derived.
// Reports only; a hit needs a human because some minimal fixes legitimately converge
// on the gold text. Ledger written even when empty, so "we checked" is on the record.
if (SR_MODE) {
  try {
    const goldFor = (id) => taskById.get(id)?.patch || '';
    const scan = { runId, threshold: 0.95, arms: {} };
    for (const arm of ARMS) {
      const res = scanPredictions(predsByArm[arm], goldFor);
      scan.arms[arm] = res.rows;
      const byId = new Map(res.rows.map(r => [r.instance_id, r]));
      for (const row of rows) if (row.arm === arm && row.rep === 0 && byId.has(row.taskId)) {
        const s = byId.get(row.taskId);
        row.goldSimilarity = s.score; row.goldTripwire = s.flagged;
      }
      if (res.flagged.length) {
        console.log(`\n*** GOLD TRIPWIRE [${arm}] ${res.flagged.length} patch(es) ≥95% identical to gold — inspect before using this run ***`);
        for (const f of res.flagged) console.log(`    ${f.instance_id}: ${f.reason}`);
      } else console.log(`[tripwire] ${arm}: 0/${res.rows.length} patches near-identical to gold`);
    }
    writeFileSync(path.join(outDir, 'gold-tripwire.json'), JSON.stringify(scan, null, 2));
  } catch (e) { console.error(`[tripwire] scan failed (non-fatal): ${String(e.message).slice(0, 160)}`); }
}

writeFileSync(path.join(outDir, 'rows.json'), JSON.stringify(rows, null, 2));
console.log('\n=== PILOT SUMMARY (aggregated over all reps) ===');
if (CLI_HARNESS) {
  const esc = rows.reduce((a, r) => a + (r.escape || 0), 0);
  const leaks = rows.reduce((a, r) => a + (r.leak || 0), 0);
  const net = rows.reduce((a, r) => a + (r.escapeNetDenied || 0), 0);
  // All three are ATTEMPT counters (see escape-audit.mjs) — under the jail the probes
  // hit empty tmpfs and the connections are refused. They measure how hard agents hunt,
  // which is exactly what the last run could not report at all.
  console.log(`isolation: ${ISOLATION_ON ? 'ON' : '*** OFF ***'} | infra+net escape attempts ${esc} (of which network denials ${net}) | answer-shaped command attempts ${leaks} — all blocked by construction; see gold-tripwire.json for whether any answer actually landed`);
}
const NREPS = Math.max(1, REPS);
for (const arm of ARMS) {
  const rs = rows.filter(r => r.arm === arm);                 // ALL reps
  const resolved = rs.filter(r => r.resolved).length;         // task×rep resolutions
  const partialMacro = rs.length ? rs.reduce((a, r) => a + (r.f2pFrac ?? 0), 0) / rs.length : 0;
  const calls = (rs.reduce((a, r) => a + r.calls, 0) / rs.length).toFixed(1);
  const costN = rs.reduce((a, r) => a + r.costRealizedUsd, 0);
  const solveCost = rs.filter(r => r.resolved).reduce((a, r) => a + r.costRealizedUsd, 0);
  const ss = rs.reduce((a, r) => a + r.ss, 0);
  const cps = resolved ? '$' + (solveCost / resolved).toFixed(3) : 'n/a';
  // per-task pass@rep (k of NREPS reps solved) — the variance-aware view
  const byTask = {}; rs.forEach(r => { (byTask[r.taskId] = byTask[r.taskId] || []).push(r.resolved ? 1 : 0); });
  const perTask = Object.entries(byTask).map(([t, v]) => `${t.split('__')[1] || t}:${v.reduce((a, b) => a + b, 0)}/${v.length}`).join(' ');
  console.log(`${arm}: resolved ${resolved}/${rs.length} task×rep (rate ${(100 * resolved / rs.length).toFixed(0)}%, partial-macro ${partialMacro.toFixed(3)})  avgCalls=${calls}  ss=${ss}  realized$${costN.toFixed(3)}  CPS=${cps}`);
  console.log(`   per-task (reps solved): ${perTask}`);
}
console.log(`rows → ${path.join(outDir, 'rows.json')}`);
// Force exit: lingering ss-* server sockets/handles can keep Node's event loop
// alive after all work is done (seen hanging the pre-warm). All results are
// already flushed above, so a clean explicit exit is safe (and lets the smoke
// chain model runs back-to-back without a hang).
process.exit(0);
