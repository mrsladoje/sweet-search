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
const MPP = path.join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md');
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
const taskById = new Map(); // instance_id -> full spec (populated by loadTasks in SR mode)

function ensureImage(t) {
  const id = typeof t === 'string' ? t : t.instance_id;
  if (SR_MODE) {
    const img = t.image_name;
    if (!img) throw new Error(`ensureImage: SR task ${id} has no image_name`);
    const ok = () => { try { execFileSync('docker', ['image', 'inspect', img], { env: { ...process.env, DOCKER_HOST }, stdio: 'ignore' }); return true; } catch { return false; } };
    if (!ok()) {
      // Retry transient pull failures (registry blips / network) before giving up —
      // in an unattended 400-run pool a single dropped pull would otherwise skip the
      // WHOLE task (both arms) and silently shrink N. 3 attempts w/ linear backoff.
      let pulled = false;
      for (let attempt = 1; attempt <= 3 && !pulled; attempt++) {
        try { execFileSync('docker', ['pull', img], { env: { ...process.env, DOCKER_HOST }, stdio: 'ignore', timeout: 1800000 }); } catch { /* re-checked below */ }
        pulled = ok();
        if (!pulled && attempt < 3) { try { execFileSync('sleep', [String(5 * attempt)], { stdio: 'ignore' }); } catch { /* */ } }
      }
      if (!pulled) throw new Error(`ensureImage: docker pull failed for ${img} (${id}) after 3 attempts`);
    }
    return img;
  }
  const img = imageNameFor(id);
  const have = () => { try { execFileSync('docker', ['image', 'inspect', img], { env: { ...process.env, DOCKER_HOST }, stdio: 'ignore' }); return true; } catch { return false; } };
  if (have()) return img;
  // Build + PERSIST the instance image by grading the GOLD prediction.
  // swebench 4.x SILENTLY SKIPS empty-patch predictions ("Instances with empty
  // patches: 1" → "No instances to run") so the old empty-patch trick never
  // built anything. Gold is non-empty (and doubles as a gradeability sanity).
  // cache_level 'instance' keeps the sweb.eval.x86_64.<id> image so run_tests
  // (and the final grade) can exec it. run_id is unique per instance so the
  // worker pool doesn't collide on swebench's per-run_id lock.
  try {
    execFileSync(VENV_PY, ['-m', 'swebench.harness.run_evaluation', '--dataset_name', DATASET, '--predictions_path', 'gold', '--max_workers', '1', '--instance_ids', id, '--run_id', `imgbuild-${id}`, '--cache_level', 'instance'], { cwd: path.join(BENCH, 'results'), env: { ...process.env, DOCKER_HOST }, stdio: 'ignore', timeout: 1800000 });
  } catch { /* fall through to the loud check below */ }
  // FAIL LOUD: a swallowed build error here previously masked 4/5 missing images.
  if (!have()) throw new Error(`ensureImage: failed to build ${img} for ${id} (swebench gold build produced no image)`);
  return img;
}
// One-shot test runner: pytest in the real env, host checkout bind-mounted (live edits).
function makeRunTests(image, checkoutDir, t) {
  if (SR_MODE) {
    // Run the repo's canonical suite (install_config.test_cmd) on the agent's
    // LIVE edits: apply the agent's current diff into the image's baked repo
    // (deps preserved) at the SWE-rebench workdir. NO gold test_patch — the
    // hidden FAIL_TO_PASS tests are never exposed to the agent (leakage guard).
    return async () => {
      const workdir = t.workdir || `/${t.repo.split('/')[1]}`;
      const testScript = [].concat(t.install_config?.test_cmd || []).join(' && ');
      if (!testScript) return '[run_tests] no test_cmd for this task';
      let diff = '';
      // NON-destructive: `git diff HEAD` shows the agent's tracked-file edits
      // WITHOUT touching the index. (A prior `git add -A` here STAGED the edits,
      // so the later finalPatch `git diff` (unstaged) came back empty → 0-hunk
      // predictions — matching api-task-runner's finalPatch, which also uses `git diff`.)
      try { diff = execSync(`git -C ${checkoutDir} diff HEAD -- . ':(exclude).sweet-search'`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch { /* */ }
      const pdir = `${checkoutDir}__rt`;
      try {
        rmSync(pdir, { recursive: true, force: true }); mkdirSync(pdir, { recursive: true });
        writeFileSync(path.join(pdir, 'agent.diff'), diff || '');
        const script = `cd ${workdir} && git reset --hard HEAD -q 2>/dev/null; git apply --3way --recount --ignore-space-change --whitespace=nowarn /patch/agent.diff 2>/dev/null || true; timeout 300 bash -c ${shq(testScript)} 2>&1 | tail -60`;
        // NO --network host: at CONCURRENCY>1 multiple test containers would share the
        // host net namespace and collide on any port a test binds (→ flaky failures →
        // corrupted resolved numbers). Default bridge isolates each container (own
        // localhost + port space); self-contained SWE-bench tests don't need host net.
        const out = execSync(`docker run --rm -v ${pdir}:/patch:ro ${image} bash -c ${shq(script)}`, { env: { ...process.env, DOCKER_HOST }, encoding: 'utf8', timeout: 360000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        return out.slice(0, 8000);
      } catch (e) { return `[run_tests exit=${e.status ?? 1}]\n${(e.stdout || e.stderr || e.message || '').slice(0, 6000)}`; }
      finally { try { rmSync(pdir, { recursive: true, force: true }); } catch { /* */ } }
    };
  }
  return async (rawArgs) => {
    const args = String(rawArgs || '').replace(/[;&|`$()<>\n]/g, ' ').slice(0, 300);
    try {
      const out = execSync(`docker run --rm --platform linux/amd64 -v ${checkoutDir}:/testbed ${image} bash -lc "cd /testbed && timeout 300 python -m pytest ${args} -q 2>&1 | tail -50"`,
        { env: { ...process.env, DOCKER_HOST }, encoding: 'utf8', timeout: 360000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      return out.slice(0, 8000);
    } catch (e) { return `[run_tests exit=${e.status ?? 1}]\n${(e.stdout || e.stderr || e.message || '').slice(0, 6000)}`; }
  };
}

async function loadTasks() {
  if (SR_MODE) {
    const specs = JSON.parse(readFileSync(TASKS_FILE, 'utf8'));
    for (const s of specs) taskById.set(s.instance_id, s);
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

function gradeArm(arm, predictions, runId) {
  const predDir = path.join(BENCH, 'results', runId, arm);
  mkdirSync(predDir, { recursive: true });
  if (SR_MODE) {
    // Grade via SWE-rebench eval.py (20-language parsers). tasks.json = full
    // specs (incl gold test_patch); patches.json = agent patches. eval.py pulls
    // the image, git applies prediction + gold test_patch, runs test_cmd, parses
    // per-language. items[].passed_match = resolved (FAIL_TO_PASS flip + PASS_TO_PASS hold).
    // eval.py raises on an empty prediction patch — but an empty patch is simply
    // UNRESOLVED, so grade only the non-empty ones and count the rest as misses
    // (one empty patch must not crash the whole grade batch).
    const nonEmpty = predictions.filter(p => (p.model_patch || '').trim());
    if (!nonEmpty.length) return { resolved_instances: 0, total_instances: predictions.length, resolved_ids: [] };
    // GRADING-PHASE DISK GC (critical for full-200): the agent-phase per-task GC
    // already dropped every image, so eval.py RE-PULLS each task's ~3.5-5.3GB image
    // here and never frees it. Grading 200 distinct images in one shot => ~800GB =>
    // disk full mid-grade. So grade in batches of GRADE_BATCH and `docker rmi` each
    // batch's images immediately after (gated SR_MODE && !NO_IMAGE_GC, same as the
    // agent phase). Scoring is unchanged — SWE-bench-standard, just chunked.
    // Default 6 (not 12): one eval.py call grades a whole batch under a single 90-min
    // timeout, so a hanging/monster-repo task forfeits its batch-mates' grades — fewer
    // tasks per batch = fewer waves under the timeout + less collateral on a stall.
    const BATCH = Math.max(1, +(process.env.GRADE_BATCH || 6));
    const tasksPath = path.join(predDir, 'tasks.json');
    const patchesPath = path.join(predDir, 'patches.json');
    const reportPath = path.join(predDir, 'report.json');
    const score = {}; const resolved_ids = []; let gradedAny = false;
    for (let i = 0; i < nonEmpty.length; i += BATCH) {
      const chunk = nonEmpty.slice(i, i + BATCH);
      const specs = chunk.map(p => taskById.get(p.instance_id)).filter(Boolean);
      if (!specs.length) continue;
      writeFileSync(tasksPath, JSON.stringify(specs));
      // eval.py wants --patches as a LIST of {instance_id, patch}, not a dict.
      writeFileSync(patchesPath, JSON.stringify(chunk.map(p => ({ instance_id: p.instance_id, patch: p.model_patch }))));
      try { rmSync(reportPath, { force: true }); } catch { /* */ }
      try {
        execFileSync(VENV_PY, [path.join(SR_EVAL_DIR, 'scripts', 'eval.py'),
          '--json', tasksPath, '--patches', patchesPath, '--max-workers', '2', '--report-json', reportPath],
          { cwd: SR_EVAL_DIR, env: { ...process.env, DOCKER_HOST, PYTHONPATH: path.join(SR_EVAL_DIR, 'lib') }, stdio: 'inherit', timeout: 5400000 });
      } catch (e) { console.error(`[grade ${arm}] eval.py error (batch @${i}): ${String(e.message).slice(0, 160)}`); }
      if (existsSync(reportPath)) {
        gradedAny = true;
        const items = (JSON.parse(readFileSync(reportPath, 'utf8')).items) || [];
        // SWE-bench-standard resolution (grading.py get_resolution_status): FULL iff
        // ALL named FAIL_TO_PASS pass AND no PASS_TO_PASS regresses; PARTIAL iff some
        // (not all) F2P pass and P2P holds. Do NOT use eval.py's exact-set passed_match
        // (passed == expected_passed) — it spuriously fails when the suite passes extra
        // tests beyond the named set (it wrongly marked native dtolnay__cxx unresolved
        // despite 14/14 F2P + 0 P2P regressions). Also keep f2pFrac for partial credit.
        for (const it of items) {
          const sp = taskById.get(it.instance_id) || {};
          const f2pTot = (sp.FAIL_TO_PASS || []).length;
          const f2pPass = (it.from_fail_to_pass || []).length;
          const p2pOk = (it.failed_from_pass_to_pass || []).length === 0;
          const f2pFrac = f2pTot ? f2pPass / f2pTot : 1;
          const status = (f2pFrac === 1 && p2pOk) ? 'FULL' : (f2pFrac > 0 && p2pOk ? 'PARTIAL' : 'NO');
          score[it.instance_id] = { f2pFrac, p2pOk, status };
          if (status === 'FULL') resolved_ids.push(it.instance_id);
        }
      }
      // reclaim THIS batch's images before the next chunk pulls more
      if (SR_MODE && !process.env.NO_IMAGE_GC) {
        for (const sp of specs) {
          if (sp.image_name) { try { execFileSync('docker', ['rmi', '-f', sp.image_name], { env: { ...process.env, DOCKER_HOST }, stdio: 'ignore', timeout: 60000 }); } catch { /* */ } }
        }
      }
    }
    if (!gradedAny) return null;
    return { resolved_instances: resolved_ids.length, total_instances: predictions.length, resolved_ids, score };
  }
  const predPath = path.join(predDir, 'preds.jsonl');
  writeFileSync(predPath, predictions.map(p => JSON.stringify(p)).join('\n') + '\n');
  const ids = predictions.map(p => p.instance_id).join(' ');
  try {
    execFileSync(VENV_PY, ['-m', 'swebench.harness.run_evaluation',
      '--dataset_name', DATASET, '--predictions_path', predPath,
      '--max_workers', '2', '--instance_ids', ...predictions.map(p => p.instance_id),
      // cache_level 'instance' KEEPS the sweb.eval.x86_64.<id> images so chained
      // runs (e.g. 3 models back-to-back) reuse them instead of rebuilding mid-run
      // (a rebuild during a timed run skews wall-time). Disk is cheap on the box.
      '--run_id', `${runId}-${arm}`, '--cache_level', 'instance'],
      { cwd: predDir, env: { ...process.env, DOCKER_HOST }, stdio: 'inherit', timeout: 1800000 });
  } catch (e) { console.error(`[grade ${arm}] harness error: ${e.message}`); }
  // swebench writes <model>.<run_id>.json in cwd
  const report = path.join(predDir, `${arm}.${runId}-${arm}.json`);
  if (existsSync(report)) return JSON.parse(readFileSync(report, 'utf8'));
  // fallback: find any *.json report
  return null;
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
    for (const arm of ['native', 'sweet']) writeFileSync(path.join(od, `preds-${arm}.jsonl`), predsByArm[arm].map(p => JSON.stringify(p)).join('\n') + '\n');
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
    for (const arm of ['native', 'sweet']) {
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
    if (image && SR_MODE && !process.env.NO_IMAGE_GC) {
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
// gradeArm overwrites results/<runId>/<arm>/report.json each call; we extract resolved_ids
// immediately, so per-rep overwrite is fine. row.resolved/f2pFrac set per (arm, rep).
console.log('\n### grading via swebench (Docker, authoritative) — all reps');
const repsToGrade = Object.keys(predsByRepArm).map(Number).sort((a, b) => a - b);
for (const rep of repsToGrade) {
  for (const arm of ['native', 'sweet']) {
    const preds = predsByRepArm[rep]?.[arm] || [];
    if (!preds.length) continue;
    const report = gradeArm(arm, preds, runId);
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
for (const arm of ['native', 'sweet']) {
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
