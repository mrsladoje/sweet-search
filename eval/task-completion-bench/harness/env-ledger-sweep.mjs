#!/usr/bin/env node
// env-ledger-sweep.mjs — gold-grade every task of a bench set under egress lockdown
// and emit an environment-validity ledger.
//
// For each task: apply task-overrides.json (same mutation as run-pilot loadTasks),
// run eval.py --golden-eval with --network none (per-spec _network exceptions kept),
// and record whether the OFFICIAL GOLD PATCH grades FULL offline. A task whose gold
// cannot grade FULL in its own container has a broken environment, not a hard task —
// its rows say nothing about any agent. Classification:
//   gold-valid          — gold grades FULL under lockdown (env honest)
//   needs-warming       — gold fails with a network signature (deps fetched at test time)
//   env-broken-nonnet   — gold fails with no network signature (test/infra defect;
//                         triage individually — unfixable-candidate until diagnosed)
//   infra               — grading machinery failed (no report / missing image / timeout)
//
// Generic by construction: parameterized by tasks file + ids file + overrides; no
// dev-200 hardcoding, so the same sweep is the held-out gold-validation screen.
//
// Resumable: verdicts append to <out>/ledger.jsonl; done tasks are skipped on restart.
// Disk-disciplined: per-batch docker rmi of non-derived images (never derived repair
// images — local-only, not re-pullable).
//
// Usage (on the bench box):
//   node env-ledger-sweep.mjs --tasks <full-specs.json> [--ids <jsonl|json with instance_id per row>]
//        --out <dir> [--batch 4] [--max-workers 2] [--singleton-retry]
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { taskConfigHash, gradeFromReportItem } from './env-ledger.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const BENCH = process.env.BENCH_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SR_EVAL_DIR = process.env.SR_EVAL_DIR || '/root/swe-rebench-tools/SWE-rebench-V2';
const SR_EVAL_RUNNER = path.join(BENCH, 'harness/sr-eval.py');
const VENV_PY = process.env.VENV_PY || path.join(BENCH, '.venv-grade/bin/python');
const TASKS_FILE = arg('tasks');
const IDS_FILE = arg('ids', '');
const OUT = arg('out');
const BATCH = Math.max(1, +arg('batch', 4));
const MAX_WORKERS = Math.max(1, +arg('max-workers', 2));
const BATCH_TIMEOUT_MS = +arg('batch-timeout-ms', 5400000); // 90 min, same as run-pilot grading
if (!TASKS_FILE || !OUT) { console.error('usage: env-ledger-sweep.mjs --tasks <specs.json> --out <dir> [--ids <file>]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const OVERRIDES_PATH = process.env.TASK_OVERRIDES || path.join(BENCH, 'harness/task-overrides.json');
const TASK_OVERRIDES = existsSync(OVERRIDES_PATH) ? JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')) : { tasks: {} };

// ---- load + override-mutate specs (mirrors run-pilot.mjs loadTasks SR branch) ----
let specs = JSON.parse(readFileSync(TASKS_FILE, 'utf8'));
if (IDS_FILE) {
  const raw = readFileSync(IDS_FILE, 'utf8').trim();
  const ids = new Set(raw[0] === '[' ? JSON.parse(raw).map(t => t.instance_id || t)
    : raw.split('\n').map(l => { try { return JSON.parse(l).instance_id; } catch { return l.trim(); } }));
  specs = specs.filter(s => ids.has(s.instance_id));
}
for (const s of specs) {
  const ov = TASK_OVERRIDES.tasks?.[s.instance_id];
  if (ov?.network) s._network = ov.network;
  if (ov?.dockerRunArgs) s._dockerRunArgs = ov.dockerRunArgs;
  if (ov?.testCmd) s.install_config = { ...s.install_config, test_cmd: ov.testCmd };
  if (ov?.image) { s._origImage = s.image_name; s.image_name = ov.image; }
}

// ---- resume state ----
const LEDGER = path.join(OUT, 'ledger.jsonl');
const done = new Set();
if (existsSync(LEDGER)) for (const l of readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean)) {
  try { done.add(JSON.parse(l).instance_id); } catch { /* skip corrupt line */ }
}
let todo = specs.filter(s => !done.has(s.instance_id));
console.log(`[sweep] ${specs.length} tasks in scope, ${done.size} already verdicted, ${todo.length} to run (batch=${BATCH}, workers=${MAX_WORKERS})`);

// Network-failure signatures (checked only on non-FULL gold grades). Specific
// phrases, not bare words — "clone"/"fetch" appear in legitimate test names.
const NET_SIGS = [
  /failed to clone/i, /could not resolve host/i, /temporary failure in name resolution/i,
  /network is unreachable/i, /no such host/i, /dial tcp/i, /connection timed out/i,
  /unable to access 'https:\/\//i, /download(ing|s)? error/i, /error downloading/i,
  /failed to download/i, /could not download/i, /download failed/i,
  /updating crates\.io index/i, /registry `crates-io`/i, /spurious network error/i,
  /clojars/i, /coursier/i, /ivy2? (resolve|download)/i, /gradle.*(could not (get|resolve|download))/i,
  /could not (get|resolve|download).*(https?:|maven|jcenter|gradle)/i,
  /connect(ion refused)?.*(443|:80\b)/i, /proxy(_| )?(error|connect)/i, /ENOTFOUND/, /EAI_AGAIN/,
  /getaddrinfo/i, /SSL certificate problem/i, /tls handshake/i, /npm err!.*(network|registry)/i,
  /go: .*(download|dial|lookup)/i, /pip.*(retrying|new connection error|network)/i,
  /LibGit2/, /download_source/i, /install_git/i, /fatal: unable to (connect|look up)/i,
  /Name or service not known/i, /mix deps\.get/i, /hex.*(fetch|tarball)/i,
];
const classify = (logText) => NET_SIGS.some(r => r.test(logText)) ? 'network' : 'test-failure';

const dockerEnv = { ...process.env };
const gcImages = (batch) => {
  for (const sp of batch) {
    if (sp.image_name && !sp._origImage) {
      try { execFileSync('docker', ['rmi', '-f', sp.image_name], { env: dockerEnv, stdio: 'ignore', timeout: 60000 }); } catch { /* */ }
    }
  }
};
const diskFreeG = () => { try { return execSync("df -BG --output=avail / | tail -1", { encoding: 'utf8' }).trim(); } catch { return '?'; } };

// Every row carries the config fingerprint it was graded under (the green-ledger
// invariant's staleness key — run-pilot pre-flight compares against current state).
// Compute BEFORE image GC so local derived/warm image IDs resolve.
const record = (row, sp) => {
  if (sp && !row.configHash) {
    const ovh = TASK_OVERRIDES.tasks?.[sp.instance_id] || {};
    try { row.configHash = taskConfigHash(sp, { netLockdown: true, excludeP2P: ovh.excludeP2P || [], excludeF2P: ovh.excludeF2P || [] }); } catch { /* hash is best-effort at record time; stampable later */ }
  }
  appendFileSync(LEDGER, JSON.stringify(row) + '\n'); done.add(row.instance_id);
};

async function runPass(tasks, batchSize) {
  for (let i = 0; i < tasks.length; i += batchSize) {
    const chunk = tasks.slice(i, i + batchSize).filter(s => !done.has(s.instance_id));
    if (!chunk.length) continue;
    // derived images must pre-exist locally (never pulled)
    const runnable = [];
    for (const sp of chunk) {
      if (sp._origImage) {
        try { execFileSync('docker', ['image', 'inspect', sp.image_name], { env: dockerEnv, stdio: 'ignore' }); runnable.push(sp); }
        catch { record({ instance_id: sp.instance_id, language: sp.language, status: 'infra', signature: 'derived-image-missing', image: sp.image_name, ts: new Date().toISOString() }); }
      } else runnable.push(sp);
    }
    if (!runnable.length) continue;
    const tag = `b${i}`;
    const tasksPath = path.join(OUT, `tasks-${tag}.json`);
    const reportPath = path.join(OUT, `report-${tag}.json`);
    writeFileSync(tasksPath, JSON.stringify(runnable));
    try { rmSync(reportPath, { force: true }); } catch { /* */ }
    console.log(`[sweep] batch ${tag}: ${runnable.map(s => s.instance_id).join(', ')} (disk free ${diskFreeG()})`);
    let batchErr = '';
    try {
      execFileSync(VENV_PY, [SR_EVAL_RUNNER,
        '--json', tasksPath, '--golden-eval', '--max-workers', String(MAX_WORKERS),
        '--report-json', reportPath, '--network', 'none'],
        { cwd: OUT, env: { ...process.env, SR_EVAL_DIR, PYTHONPATH: path.join(SR_EVAL_DIR, 'lib') }, stdio: ['ignore', 'inherit', 'inherit'], timeout: BATCH_TIMEOUT_MS });
    } catch (e) { batchErr = e.killed ? 'batch-timeout' : ''; /* non-zero exit = some task not FULL: normal */ }
    const items = existsSync(reportPath) ? (JSON.parse(readFileSync(reportPath, 'utf8')).items || []) : [];
    const byId = new Map(items.map(it => [it.instance_id, it]));
    for (const sp of runnable) {
      const it = byId.get(sp.instance_id);
      if (!it) {
        record({ instance_id: sp.instance_id, language: sp.language, status: 'infra', signature: batchErr || 'no-report-item', image: sp.image_name, ts: new Date().toISOString() });
        continue;
      }
      const { f2pFrac, f2pPass, f2pTot, p2pFails, status: grade } = gradeFromReportItem(it, sp, TASK_OVERRIDES.tasks?.[sp.instance_id] || {});
      let logTail = '';
      const lp = it.log_path && path.resolve(OUT, it.log_path);
      if (lp && existsSync(lp)) { const t = readFileSync(lp, 'utf8'); logTail = t.slice(-6000); }
      const row = {
        instance_id: sp.instance_id, language: sp.language, grade,
        f2pFrac: +f2pFrac.toFixed(3), f2pPass, f2pTot, p2pFails: p2pFails.length,
        image: sp.image_name, overridden: !!TASK_OVERRIDES.tasks?.[sp.instance_id],
        evalError: it.error || '', ts: new Date().toISOString(),
      };
      if (grade === 'FULL') { row.status = 'gold-valid'; row.signature = ''; }
      else if (it.error && !logTail) { row.status = 'infra'; row.signature = `eval-error: ${String(it.error).slice(0, 200)}`; }
      else {
        const cls = classify(logTail + '\n' + (it.error || ''));
        row.status = cls === 'network' ? 'needs-warming' : 'env-broken-nonnet';
        row.signature = cls;
        // keep the evidence: the matched line(s)
        const lines = logTail.split('\n');
        row.evidence = lines.filter(l => NET_SIGS.some(r => r.test(l))).slice(0, 3).join(' | ').slice(0, 500)
          || lines.filter(l => /fail|error/i.test(l)).slice(-3).join(' | ').slice(0, 500);
      }
      record(row, sp);
    }
    gcImages(runnable);
    try { rmSync(tasksPath, { force: true }); } catch { /* */ }
    const counts = {};
    for (const l of readFileSync(LEDGER, 'utf8').trim().split('\n')) { try { const r = JSON.parse(l); counts[r.status] = (counts[r.status] || 0) + 1; } catch { /* */ } }
    console.log(`[sweep] progress ${done.size}/${specs.length} — ${JSON.stringify(counts)} (disk free ${diskFreeG()})`);
  }
}

// --bridge-regrade <ids-file|'auto'>: DIAGNOSTIC pass — re-grade tasks WITH network
// (bridge) to discriminate "fails offline because deps fetch at test time" (grades
// FULL with egress → needs-warming, warmable) from "true curation/test defect"
// (still broken WITH network → unfixable-candidate). Verdicts land in the ledger as
// status 'needs-warming' (evidence 'bridge-regrade: FULL with network') or
// 'env-broken-curation'.
const BRIDGE_REGRADE = arg('bridge-regrade', '');
if (BRIDGE_REGRADE) {
  let ids;
  if (BRIDGE_REGRADE === 'auto') {
    const lastVerdict = new Map();
    for (const l of readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean)) {
      try { const r = JSON.parse(l); lastVerdict.set(r.instance_id, r); } catch { /* */ }
    }
    ids = new Set([...lastVerdict.values()].filter(r => r.status === 'env-broken-nonnet').map(r => r.instance_id));
  } else {
    ids = new Set(readFileSync(BRIDGE_REGRADE, 'utf8').trim().split('\n').map(s => s.trim()).filter(Boolean));
  }
  console.log(`[sweep] bridge-regrade diagnostic for ${ids.size} tasks`);
  for (const sp of specs.filter(s => ids.has(s.instance_id))) {
    const bsp = { ...sp, _network: 'bridge' };
    const tag = `bridge-${sp.instance_id.replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
    const tasksPath = path.join(OUT, `tasks-${tag}.json`);
    const reportPath = path.join(OUT, `report-${tag}.json`);
    writeFileSync(tasksPath, JSON.stringify([bsp]));
    try { rmSync(reportPath, { force: true }); } catch { /* */ }
    try {
      execFileSync(VENV_PY, [SR_EVAL_RUNNER,
        '--json', tasksPath, '--golden-eval', '--max-workers', '1',
        '--report-json', reportPath, '--network', 'none'],
        { cwd: OUT, env: { ...process.env, SR_EVAL_DIR, PYTHONPATH: path.join(SR_EVAL_DIR, 'lib') }, stdio: ['ignore', 'inherit', 'inherit'], timeout: BATCH_TIMEOUT_MS });
    } catch { /* non-zero = unresolved, normal */ }
    const it = existsSync(reportPath) ? ((JSON.parse(readFileSync(reportPath, 'utf8')).items || [])[0] || null) : null;
    let row;
    if (!it) row = { instance_id: sp.instance_id, language: sp.language, status: 'infra', signature: 'bridge-regrade-no-report', ts: new Date().toISOString() };
    else {
      const { f2pFrac, f2pPass, f2pTot, p2pFails, status: g } = gradeFromReportItem(it, sp, TASK_OVERRIDES.tasks?.[sp.instance_id] || {});
      const full = g === 'FULL';
      row = {
        instance_id: sp.instance_id, language: sp.language,
        grade: g,
        f2pFrac: +f2pFrac.toFixed(3), f2pPass, f2pTot, p2pFails: p2pFails.length,
        image: sp.image_name, overridden: !!TASK_OVERRIDES.tasks?.[sp.instance_id],
        status: full ? 'needs-warming' : 'env-broken-curation',
        signature: full ? 'network' : 'curation',
        evidence: full ? 'bridge-regrade: gold FULL with network → test-time dep fetch, warmable'
          : `bridge-regrade: still broken WITH network (f2p ${f2pPass}/${f2pTot}, p2pFails ${p2pFails.length}) → curation/test defect`,
        ts: new Date().toISOString(),
      };
    }
    record(row, sp);
    console.log(`[sweep] bridge-regrade ${sp.instance_id}: ${row.status}`);
    gcImages([sp]);
  }
  console.log('[sweep] bridge-regrade DONE');
  process.exit(0);
}

await runPass(todo, BATCH);
// Singleton retry for infra rows (batch-timeout collateral etc.) — one automatic pass.
if (flag('singleton-retry')) {
  const infraIds = new Set();
  for (const l of readFileSync(LEDGER, 'utf8').trim().split('\n')) {
    try { const r = JSON.parse(l); if (r.status === 'infra' && r.signature !== 'derived-image-missing') infraIds.add(r.instance_id); } catch { /* */ }
  }
  if (infraIds.size) {
    console.log(`[sweep] singleton retry for ${infraIds.size} infra rows`);
    for (const id of infraIds) done.delete(id); // retry rows append; last verdict wins downstream
    await runPass(specs.filter(s => infraIds.has(s.instance_id)), 1);
  }
}
console.log('[sweep] DONE');
