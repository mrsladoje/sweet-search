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
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTask } from './api-task-runner.mjs';

// FIX A (index integrity): FREEZE the incremental maintainer for the whole run so
// the index cannot drift while the agent edits files mid-task. Setting these in
// process.env at the top means EVERY child ss-* spawn (the ss-bin PATH binaries)
// and the indexer inherit them — both arms therefore observe a static, base-commit
// index. SWEET_SEARCH_WATCH=0 disables the fs watcher; SWEET_SEARCH_RECONCILE_SCAN=0
// disables the dirty-scan reconciler; the huge interval is belt-and-suspenders in
// case any reconcile path is still reached.
process.env.SWEET_SEARCH_WATCH = '0';
process.env.SWEET_SEARCH_RECONCILE_SCAN = '0';
process.env.SWEET_SEARCH_RECONCILE_INTERVAL_MS = '2147483647';

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
const INSTANCES = (process.env.INSTANCES || 'pallets__flask-4992').split(',').map(s => s.trim()).filter(Boolean);
const CACHE = path.join(BENCH, 'tasks/_lite-cache.json');
// Checkouts live under $HOME (colima shares $HOME into the VM, NOT /tmp) so the
// swebench image can bind-mount them for run_tests. Still outside our project
// tree → escape isolation preserved.
const EVAL_HOME = path.join(process.env.HOME, '.ss-eval');
// swebench image naming: instance_id `a__b-N` → `a_1776_b-N`, arch x86_64.
const imageNameFor = (id) => `swebench/sweb.eval.x86_64.${id.replace('__', '_1776_')}:latest`;
function ensureImage(id) {
  const img = imageNameFor(id);
  try { execFileSync('docker', ['image', 'inspect', img], { env: { ...process.env, DOCKER_HOST }, stdio: 'ignore' }); return img; }
  catch { /* build below */ }
  // Build the env image by grading an EMPTY prediction for this instance (side-effect: builds + caches the image).
  try {
    const tmp = path.join(BENCH, 'results', '_imgbuild'); mkdirSync(tmp, { recursive: true });
    const pf = path.join(tmp, `${id}.jsonl`); writeFileSync(pf, JSON.stringify({ instance_id: id, model_name_or_path: 'empty', model_patch: '' }) + '\n');
    // FIX B (concurrency): run_id MUST be unique per instance — the worker pool can
    // call ensureImage() for several ids at once, and a shared run_id collides on
    // swebench's per-run_id working dir / run-instance lock. Key it to the id.
    execFileSync(VENV_PY, ['-m', 'swebench.harness.run_evaluation', '--dataset_name', DATASET, '--predictions_path', pf, '--max_workers', '1', '--instance_ids', id, '--run_id', `imgbuild-${id}`, '--cache_level', 'env'], { cwd: tmp, env: { ...process.env, DOCKER_HOST }, stdio: 'ignore', timeout: 1800000 });
  } catch { /* */ }
  return img;
}
// One-shot test runner: pytest in the real env, host checkout bind-mounted (live edits).
function makeRunTests(image, checkoutDir) {
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

// Project-side index cache, keyed by repo@base_commit. The index is
// deterministic for a fixed commit, so it is built ONCE EVER and reused across
// runs/sessions. Lives OUTSIDE the checkout (agent never sees it) and survives
// /tmp clears. Checkouts themselves stay in /tmp/ss-eval (outside our tree) so
// the agent can't escape into our gold/results files.
const IDX_CACHE = path.join(BENCH, '.index-cache');
const cacheKeyFor = (t) => `${t.repo.replace('/', '__')}@${t.base_commit}`;

// Returns { dir, idxMs, source }. source ∈ checkout-cache | index-cache | built.
function prepareCheckout(task) {
  // key the checkout dir by repo@commit (not instance_id) so a cached index's
  // internal paths always match the restore path. Under $HOME so colima can
  // bind-mount it into the test container.
  const dir = path.join(EVAL_HOME, cacheKeyFor(task));
  // 1) persistent checkout already indexed for THIS commit → reuse as-is.
  if (existsSync(`${dir}/.sweet-search/codebase.db`) && existsSync(`${dir}/.git`)) {
    resetCheckout(dir);
    // FIX A: ensure a pristine project-side index cache exists for restoreIndex().
    // A reused checkout's in-place index may have drifted in a prior run, so if the
    // cache is missing (legacy checkout) seed it from THIS index once; restoreIndex
    // (called per-rep) is what guarantees byte-identical arm starts thereafter.
    const pristine = path.join(IDX_CACHE, cacheKeyFor(task), '.sweet-search');
    if (!existsSync(path.join(pristine, 'codebase.db'))) {
      try { mkdirSync(path.join(IDX_CACHE, cacheKeyFor(task)), { recursive: true }); sh(`cp -R ${dir}/.sweet-search ${path.join(IDX_CACHE, cacheKeyFor(task))}/`); } catch { /* */ }
    }
    return { dir, idxMs: 0, source: 'checkout-cache' };
  }
  // fresh clone @ base_commit, drop history (no future-fix-commit leakage)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  sh(`git clone --quiet https://github.com/${task.repo}.git ${dir}`);
  sh(`git -C ${dir} checkout --quiet ${task.base_commit}`);
  sh(`rm -rf ${dir}/.git && git -C ${dir} init -q && printf '.sweet-search/\\n' > ${dir}/.git/info/exclude && git -C ${dir} add -A && git -C ${dir} -c user.email=a@b.c -c user.name=bench commit -q -m base`);
  // 2) project-side index cache for this exact repo@commit → copy it in (FREE).
  const cacheDir = path.join(IDX_CACHE, cacheKeyFor(task), '.sweet-search');
  if (existsSync(path.join(cacheDir, 'codebase.db'))) {
    sh(`mkdir -p ${dir}/.sweet-search && cp -R ${cacheDir}/. ${dir}/.sweet-search/`);
    return { dir, idxMs: 0, source: 'index-cache' };
  }
  // 3) build fresh, then populate the cache for next time.
  const t0 = Date.now();
  execFileSync('node', [INDEXER, '--full', '--sqlite-fast', '--concurrency=1'],
    { env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: dir }, stdio: 'ignore', timeout: 1800000 });
  const idxMs = Date.now() - t0;
  try { mkdirSync(path.join(IDX_CACHE, cacheKeyFor(task)), { recursive: true }); sh(`cp -R ${dir}/.sweet-search ${path.join(IDX_CACHE, cacheKeyFor(task))}/`); } catch { /* */ }
  return { dir, idxMs, source: 'built' };
}

function resetCheckout(dir) { try { sh(`git -C ${dir} checkout -- . && git -C ${dir} clean -fdq -e .sweet-search`); } catch { /* */ } }

// FIX A (index integrity): resetCheckout restores SOURCE but NOT the index — and
// because the maintainer drifts the index as the agent edits, the two arms would
// otherwise start from DIFFERENT indexes. restoreIndex wipes the checkout's
// .sweet-search and copies the pristine base-commit index back from the project-
// side cache (IDX_CACHE/<cacheKeyFor>/.sweet-search), so every arm/rep begins from
// a byte-identical index. Call it right AFTER resetCheckout at the start of each rep.
function restoreIndex(dir, task) {
  const pristine = path.join(IDX_CACHE, cacheKeyFor(task), '.sweet-search');
  if (!existsSync(path.join(pristine, 'codebase.db'))) return false; // no pristine cache → leave as-is
  try {
    rmSync(path.join(dir, '.sweet-search'), { recursive: true, force: true });
    sh(`mkdir -p ${dir}/.sweet-search && cp -R ${pristine}/. ${dir}/.sweet-search/`);
    return true;
  } catch { return false; }
}

function gradeArm(arm, predictions, runId) {
  const predDir = path.join(BENCH, 'results', runId, arm);
  mkdirSync(predDir, { recursive: true });
  const predPath = path.join(predDir, 'preds.jsonl');
  writeFileSync(predPath, predictions.map(p => JSON.stringify(p)).join('\n') + '\n');
  const ids = predictions.map(p => p.instance_id).join(' ');
  try {
    execFileSync(VENV_PY, ['-m', 'swebench.harness.run_evaluation',
      '--dataset_name', DATASET, '--predictions_path', predPath,
      '--max_workers', '2', '--instance_ids', ...predictions.map(p => p.instance_id),
      '--run_id', `${runId}-${arm}`, '--cache_level', 'env'],
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
const mppText = readFileSync(MPP, 'utf8');
const rows = [];
const predsByArm = { native: [], sweet: [] };

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

// FIX B: per-task work for ONE instance. Both arms run sequentially INSIDE a task
// (native then sweet); the worker pool runs up to CONCURRENCY of THESE concurrently.
// NOTE: no reapServers() here — that would SIGKILL sibling tasks' ss-* servers. We
// reap exactly once after the whole pool drains.
async function runOneTask(id) {
  const t = all.find(x => x.instance_id === id);
  if (!t) { console.error(`task ${id} not in dataset — skip`); return; }
  // Hold the checkout-dir lock for this task's ENTIRE lifecycle (prepare → both
  // arms → checkpoint) so a same-repo@commit sibling can't mutate the shared dir.
  return withCheckoutLock(cacheKeyFor(t), () => runOneTaskLocked(id, t));
}
async function runOneTaskLocked(id, t) {
  try {
    console.log(`\n### ${id} (${t.repo}) — checkout + index`);
    let prep;
    try { prep = prepareCheckout(t); console.log(`  index ${prep.source}${prep.idxMs ? ' in ' + (prep.idxMs / 1000).toFixed(0) + 's' : ' (cached, 0s)'}`); }
    catch (e) { console.error(`  [checkout/index FAILED] ${String(e.message).slice(0, 160)} — skipping task`); return; }
    const dir = prep.dir;
    const image = ensureImage(id);
    const runTests = makeRunTests(image, dir);
    const task = { id, repoCheckout: dir, mppPath: MPP, problem_statement: t.problem_statement };

    for (const arm of ['native', 'sweet']) {
      for (let rep = 0; rep < REPS; rep++) {
        resetCheckout(dir);
        // FIX A: restore the pristine base-commit index AFTER resetCheckout so both
        // arms start from a byte-identical index (resetCheckout only restores source).
        const restored = restoreIndex(dir, t);
        console.log(`  index restored to base for ${arm} rep${rep} (${restored ? 'ok' : 'no-cache'})`);
        const r = await runTask(task, { arm, model: MODEL, apiModel: MODEL, provider: PROVIDER, maxToolCalls: 60, ssBinDir: SS_BIN, mppText, policy: process.env.POLICY, runTests });
        const ranTests = (r.toolCounts?.test || 0) > 0;
        console.log(`  [${arm} rep${rep}] calls=${r.calls} ss=${r.ss} edits=${r.toolCounts.edit} hunks=${r.patchHunks} ranTests=${ranTests} escape=${r.escape} leak=${r.leak} $${r.costRealizedUsd} ${(r.wallMs / 1000).toFixed(0)}s exit=${r.exitReason}`);
        if (rep === 0) predsByArm[arm].push({ instance_id: id, model_name_or_path: arm, model_patch: r.finalPatch || '' });
        rows.push({ runId, taskId: id, repo: t.repo, arm, rep, model: MODEL, predOk: r.patchHunks > 0, ranTests, idxMs: prep.idxMs, idxSource: prep.source, ...stripBig(r) });
        // persist full trajectory for diagnosis (rows strip it for size)
        try { const td = path.join(BENCH, 'results', runId, 'trajectories'); mkdirSync(td, { recursive: true }); writeFileSync(path.join(td, `${id}-${arm}-r${rep}.json`), JSON.stringify({ taskId: id, arm, rep, exitReason: r.exitReason, toolCounts: r.toolCounts, ranTests, escapeExamples: r.escapeExamples, trajectory: r.trajectory }, null, 2)); } catch { /* */ }
      }
    }
    // keep the checkout (+index) for cache reuse; do NOT delete.
  } catch (e) {
    console.error(`### ${id} FAILED: ${String(e.message).slice(0, 200)} — skipping`);
  }
  // checkpoint full snapshot after every task so a crash keeps progress
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

console.log(`\n### running ${INSTANCES.length} task(s) with CONCURRENCY=${CONCURRENCY} provider=${PROVIDER} model=${MODEL}`);
await runPool(INSTANCES, CONCURRENCY);
// reap ss-* daemons ONCE, after the whole pool drains (never mid-pool — would kill
// sibling tasks' live servers).
reapServers();

// Grade both arms (rep 0 predictions) via official swebench Docker harness.
console.log('\n### grading via swebench (Docker, authoritative)');
for (const arm of ['native', 'sweet']) {
  if (!predsByArm[arm].length) continue;
  const report = gradeArm(arm, predsByArm[arm], runId);
  const resolvedIds = new Set(report?.resolved_ids || []);
  const errorIds = new Set(report?.error_ids || []);          // arm64 env-build / harness errors → not gradeable
  for (const row of rows) if (row.arm === arm && row.rep === 0) {
    row.gradeable = !errorIds.has(row.taskId);
    row.resolved = row.gradeable ? resolvedIds.has(row.taskId) : null;
  }
  console.log(`  ${arm}: resolved ${resolvedIds.size}/${predsByArm[arm].length - errorIds.size} gradeable (errors=${errorIds.size})  ids=${[...resolvedIds].join(',') || '(none)'}`);
}

const outDir = path.join(BENCH, 'results', runId);
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'rows.json'), JSON.stringify(rows, null, 2));
console.log('\n=== PILOT SUMMARY ===');
for (const arm of ['native', 'sweet']) {
  const rs = rows.filter(r => r.arm === arm && r.rep === 0);
  const resolved = rs.filter(r => r.resolved).length;
  const calls = (rs.reduce((a, r) => a + r.calls, 0) / rs.length).toFixed(1);
  const cost = rs.reduce((a, r) => a + r.costRealizedUsd, 0).toFixed(3);
  const ss = rs.reduce((a, r) => a + r.ss, 0);
  console.log(`${arm}: resolved ${resolved}/${rs.length}  avgCalls=${calls}  ss=${ss}  $${cost}  escape=${rs.reduce((a, r) => a + r.escape, 0)} leak=${rs.reduce((a, r) => a + r.leak, 0)}`);
}
console.log(`rows → ${path.join(outDir, 'rows.json')}`);
