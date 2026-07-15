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
import { createEvaluatorRuntime } from './evaluator-runtime.mjs';
// HARNESS=codex routes the agent loop through `codex exec` (real production agent)
// instead of the bare-API ReAct loop. Same grading/metrics; native=vanilla Codex,
// sweet=Codex + M++ + ss-* on PATH.
const HARNESS = process.env.HARNESS || 'bareapi';

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
if (NET_LOCKDOWN && HARNESS === 'codex' && process.platform === 'linux') {
  const lockScript = path.join(BENCH, 'harness/bench-net-lockdown.sh');
  try {
    if (!/ACTIVE/.test(execSync(`bash ${lockScript} status`, { encoding: 'utf8' }))) {
      execSync(`bash ${lockScript} on`, { encoding: 'utf8' });
      console.log('[net-lockdown] agent-shell code-host DNS block ENABLED (bench-net-lockdown.sh off to remove)');
    } else console.log('[net-lockdown] agent-shell code-host DNS block active');
  } catch (e) { console.error(`[net-lockdown] WARNING: could not verify/enable agent-shell egress lockdown: ${String(e.message).slice(0, 120)}`); }
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
  dockerHost: DOCKER_HOST, dockerNetArgs, imageNameFor, netLockdown: NET_LOCKDOWN, shellQuote: shq,
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
const all = await loadTasks();
if (SR_MODE && !INSTANCES.length) INSTANCES = all.map(t => t.instance_id);
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
        const rundir = makeRunDir(golden.dir, `${id}__${arm}__r${rep}`, sweet);
        try {
          const runTests = makeRunTests(image, rundir, t);
          const task = { id, repoCheckout: rundir, mppPath: MPP, problem_statement: t.problem_statement };
          if (sweet) warmupRun(rundir); // off-clock: warm this run's server so the measured loop sees no cold start
          const r = HARNESS === 'codex'
            ? await runCodexTask(task, { arm, apiModel: MODEL, reasoning: REASONING, ssBinDir: SS_BIN, mppText, image, t, perCallTimeoutMs: Number(process.env.CODEX_TIMEOUT_MS) || 900000 })
            : await runTask(task, { arm, model: MODEL, apiModel: MODEL, provider: PROVIDER, reasoning: REASONING, maxToolCalls: MAX_TOOL_CALLS, ssBinDir: SS_BIN, mppText, policy: process.env.POLICY, runTests });
          const ranTests = (r.toolCounts?.test || 0) > 0;
          console.log(`  [${arm} rep${rep}] calls=${r.calls} ss=${r.ss} edits=${r.toolCounts.edit} hunks=${r.patchHunks} ranTests=${ranTests} escape=${r.escape} leak=${r.leak} $${r.costRealizedUsd} ${(r.wallMs / 1000).toFixed(0)}s exit=${r.exitReason}`);
          const pred = { instance_id: id, model_name_or_path: arm, model_patch: r.finalPatch || '' };
          if (rep === 0) predsByArm[arm].push(pred);
          (predsByRepArm[rep] = predsByRepArm[rep] || { native: [], sweet: [] })[arm].push(pred);
          rows.push({ runId, taskId: id, repo: t.repo, arm, rep, model: MODEL, predOk: r.patchHunks > 0, ranTests, idxMs: golden.idxMs, idxSource: golden.source, ...stripBig(r) });
          try { const td = path.join(BENCH, 'results', runId, 'trajectories'); mkdirSync(td, { recursive: true }); writeFileSync(path.join(td, `${id}-${arm}-r${rep}.json`), JSON.stringify({ taskId: id, arm, rep, exitReason: r.exitReason, toolCounts: r.toolCounts, ranTests, escapeExamples: r.escapeExamples, trajectory: r.trajectory }, null, 2)); } catch { /* */ }
          prog.done++; prog.byArm[arm]++; if (r.patchHunks > 0) prog.predOk[arm]++; prog.cost += Number(r.costRealizedUsd) || 0;
          emitProgress(`  (${id} ${arm} r${rep}: ${r.calls}c ${r.patchHunks}h ${(r.wallMs / 1000).toFixed(0)}s ${r.exitReason})`);
        } catch (e) {
          console.error(`  [${arm} rep${rep}] run error: ${String(e.message).slice(0, 160)}`);
          prog.done++; prog.errors++; prog.byArm[arm]++; emitProgress(`  (${id} ${arm} r${rep}: ERROR)`);
        } finally {
          reapRunDir(rundir); // kill this run's server/maintainer + delete its copy; golden untouched
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
writeFileSync(path.join(outDir, 'rows.json'), JSON.stringify(rows, null, 2));
console.log('\n=== PILOT SUMMARY (aggregated over all reps) ===');
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
