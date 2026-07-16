#!/usr/bin/env node
// prep-warm.mjs — generic prep-phase dependency warming for bench tasks whose
// environments fetch dependencies at TEST time (and therefore break under the
// egress lockdown: --network none containers + host code-host block).
//
// Mechanism (arms-blind by construction — uses ONLY the task's own test command
// and the OFFICIAL gold patch + test patch; no agent code, nothing arm-specific):
//   1. start the task's container WITH network (--network bridge; the HOST
//      lockdown stays armed — bridge containers carry their own /etc/hosts, so
//      no host toggle is ever needed and agents stay blocked throughout),
//   2. run the task's test_cmd once on the BASE repo (seeds resolver caches),
//   3. apply gold patch + test patch, run test_cmd again (grading adds hidden
//      F2P tests post-patch; warming both paths maximizes cache coverage),
//   4. restore the repo to its base state (reverse-apply patches + checkout;
//      build artifacts and dependency caches are deliberately kept),
//   5. docker commit → swerebenchv2-warm/<name>:<tag>.
// GATE (absolute, per task): the gold patch grades FULL under --network none on
// the warmed image (eval.py --golden-eval). Only gated images are kept + wired
// into task-overrides.json; failures are GC'd immediately.
//
// This is legitimate environment curation (SWE-bench-Verified style), not
// contamination: nothing the agent produces ever touches the warm path.
//
// Usage: node prep-warm.mjs --tasks <specs.json> --id <instance_id> --out <dir>
//        [--no-gate] [--no-wire] [--warm-timeout-sec 3600]
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { taskConfigHash, dockerImageId } from './env-ledger.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);

const BENCH = process.env.BENCH_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SR_EVAL_DIR = process.env.SR_EVAL_DIR || '/root/swe-rebench-tools/SWE-rebench-V2';
const SR_EVAL_RUNNER = path.join(BENCH, 'harness/sr-eval.py');
const VENV_PY = process.env.VENV_PY || path.join(BENCH, '.venv-grade/bin/python');
const OVERRIDES_PATH = process.env.TASK_OVERRIDES || path.join(BENCH, 'harness/task-overrides.json');
const TASKS_FILE = arg('tasks');
const ID = arg('id');
const OUT = arg('out', '/root/env-ledger/warm');
const WARM_TIMEOUT_SEC = +arg('warm-timeout-sec', 3600);
if (!TASKS_FILE || !ID) { console.error('usage: prep-warm.mjs --tasks <specs.json> --id <instance_id> [--out dir]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const overrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
const specs = JSON.parse(readFileSync(TASKS_FILE, 'utf8'));
const spec = specs.find(s => s.instance_id === ID);
if (!spec) { console.error(`task ${ID} not found in ${TASKS_FILE}`); process.exit(2); }

// effective spec under current overrides (a task may already have a derived
// swerebenchv2-fixed image — warm on top of the effective image)
const ov = overrides.tasks?.[ID] || {};
if (ov.testCmd) spec.install_config = { ...spec.install_config, test_cmd: ov.testCmd };
let baseImage = ov.image || spec.image_name;
// Re-warm (warm-on-demand): a previously-gated task's override points at its own
// warm tag, which eviction deleted — warm on top of the ORIGINAL base instead.
// (Verified 2026-07-10: no warm-wired task has a swerebenchv2-fixed lineage, so
// spec.image_name is always the right base here.)
if (/^swerebenchv2-warm\//.test(baseImage) && dockerImageId(baseImage) === null) {
  console.log(`[prep-warm] wired warm image ${baseImage} absent (evicted) — re-warming from base ${spec.image_name}`);
  baseImage = spec.image_name;
}
const workdir = spec.workdir || `/${spec.repo.split('/')[1]}`;
const testScript = [].concat(spec.install_config?.test_cmd || []).join(' && ');
if (!testScript) { console.error(`task ${ID} has no test_cmd`); process.exit(2); }

// warm image tag mirrors the stock naming: docker.io/swerebenchv2/x:y → swerebenchv2-warm/x:y
const nameTail = baseImage.replace(/^docker\.io\//, '').replace(/^swerebenchv2(-fixed)?\//, '');
const warmTag = `swerebenchv2-warm/${nameTail}`;
const ctr = `prep-warm-${ID.replace(/[^a-zA-Z0-9_.-]/g, '-')}`.slice(0, 60);
const log = (m) => { const line = `[prep-warm ${new Date().toISOString()}] ${m}`; console.log(line); };

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, ...opts });

// ensure base image present (stock images are pullable; derived must exist)
try { execFileSync('docker', ['image', 'inspect', baseImage], { stdio: 'ignore' }); }
catch {
  // derived tags (fixed/warm) are built locally and can't be pulled; anything else
  // is a registry stock image — pull it (covers the re-warm fallback base too)
  if (/^swerebenchv2-(fixed|warm)\//.test(baseImage)) { console.error(`derived base ${baseImage} not built locally`); process.exit(1); }
  log(`pulling ${baseImage}`);
  execFileSync('docker', ['pull', baseImage], { stdio: 'ignore', timeout: 1800000 });
}

// stage patch files (official artifacts only — the arms-blind guarantee)
const pdir = path.join(OUT, `patches-${ID.replace(/[^a-zA-Z0-9_.-]/g, '-')}`);
rmSync(pdir, { recursive: true, force: true }); mkdirSync(pdir, { recursive: true });
writeFileSync(path.join(pdir, 'gold.patch'), spec.patch || '');
writeFileSync(path.join(pdir, 'test.patch'), spec.test_patch || '');

// Paths ADDED by the patches ("new file mode") must not survive the restore:
// grading re-applies the same patches with git apply, which refuses to create
// a file that already exists.
const addedPaths = [];
for (const patch of [spec.patch || '', spec.test_patch || '']) {
  const blocks = patch.split(/^diff --git /m).slice(1);
  for (const b of blocks) {
    if (/^new file mode /m.test(b)) {
      const m = b.match(/^a\/\S+ b\/(\S+)/);
      if (m) addedPaths.push(m[1]);
    }
  }
}

// The warm script: base run → patched run → restore. Test failures are FINE
// (base F2P are SUPPOSED to fail) — the point is resolver traffic, so `|| true`.
// Restore MUST leave tracked files at base and no patch-added files behind;
// dependency caches + build artifacts are deliberately kept.
// JVM images bake -Djava.net.preferIPv6Addresses=true but the docker bridge has
// no IPv6 route (the kotlin-faker precedent) → prefer IPv4 for the WARM WINDOW
// ONLY (exports don't survive docker commit; the image's own env is unchanged).
// Single-quote-escape for bash -c: JSON.stringify's double quotes let the OUTER
// shell expand $VARS in test_cmd before the command's own exports run (the
// buildtools `mkdir -p $GOCACHE` → `mkdir -p ` hollow-warm bug, found 2026-07-10).
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const warmScript = `set -x
export JAVA_TOOL_OPTIONS="\${JAVA_TOOL_OPTIONS//preferIPv6Addresses=true/preferIPv6Addresses=false}"
export _JAVA_OPTIONS="\${_JAVA_OPTIONS//preferIPv6Addresses=true/preferIPv6Addresses=false}"
cd ${workdir}
timeout ${WARM_TIMEOUT_SEC} bash -c ${shq(testScript)} > /tmp/warm-base.log 2>&1 || true
tail -5 /tmp/warm-base.log
git apply --3way --recount --ignore-space-change --whitespace=nowarn /warm-patches/gold.patch || git apply -p1 /warm-patches/gold.patch || echo GOLD-APPLY-FAILED
git apply --3way --recount --ignore-space-change --whitespace=nowarn /warm-patches/test.patch || git apply -p1 /warm-patches/test.patch || echo TEST-APPLY-FAILED
timeout ${WARM_TIMEOUT_SEC} bash -c ${shq(testScript)} > /tmp/warm-gold.log 2>&1 || true
tail -5 /tmp/warm-gold.log
git apply -R /warm-patches/test.patch 2>/dev/null || true
git apply -R /warm-patches/gold.patch 2>/dev/null || true
git reset -q 2>/dev/null || true
git checkout -- . 2>/dev/null || true
${addedPaths.length ? `rm -f ${addedPaths.map(p => JSON.stringify(p)).join(' ')}` : 'true'}
git status --porcelain | head -20
rm -f /tmp/warm-base.log /tmp/warm-gold.log
echo WARM-SCRIPT-DONE`;
writeFileSync(path.join(pdir, 'warm.sh'), warmScript);

log(`warming ${ID} on ${baseImage} → ${warmTag} (network=bridge, host lockdown stays armed)`);
try { execFileSync('docker', ['rm', '-f', ctr], { stdio: 'ignore' }); } catch { /* */ }
// In-flight disk watchdog: a single warm can balloon >20G (rust/cargo builds — the
// libsql precedent); the between-task guard can't catch that, so poll df while the
// container runs and abort the warm before it can starve co-running workloads.
const MIN_FREE_INFLIGHT_GB = +arg('min-free-inflight-gb', 8);
const freeGb = () => { try { return +execSync("df -BG --output=avail / | tail -1", { encoding: 'utf8' }).replace(/[^0-9]/g, ''); } catch { return 999; } };
let warmOut = '';
{
  const { spawn } = await import('node:child_process');
  warmOut = await new Promise((resolve) => {
    let out = '';
    const proc = spawn('docker', ['run', '--name', ctr, '--network', 'bridge', '-v', `${pdir}:/warm-patches:ro`, baseImage, 'bash', '/warm-patches/warm.sh'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => out += d);
    const deadline = Date.now() + (2 * WARM_TIMEOUT_SEC + 1800) * 1000;
    const watchdog = setInterval(() => {
      const f = freeGb();
      if (f < MIN_FREE_INFLIGHT_GB || Date.now() > deadline) {
        out += `\n[prep-warm watchdog] ABORT: ${f < MIN_FREE_INFLIGHT_GB ? `disk ${f}G < ${MIN_FREE_INFLIGHT_GB}G` : 'timeout'} — killing warm container\n`;
        try { execFileSync('docker', ['rm', '-f', ctr], { stdio: 'ignore' }); } catch { /* */ }
      }
    }, 30000);
    proc.on('close', () => { clearInterval(watchdog); resolve(out); });
    proc.on('error', (e) => { clearInterval(watchdog); resolve(out + String(e.message)); });
  });
}
writeFileSync(path.join(OUT, `warm-${ID}.log`), warmOut);
const tail = warmOut.split('\n').slice(-25).join('\n');
if (!/WARM-SCRIPT-DONE/.test(warmOut)) {
  log(`warm container did NOT complete for ${ID} — tail:\n${tail}`);
  try { execFileSync('docker', ['rm', '-f', ctr], { stdio: 'ignore' }); } catch { /* */ }
  process.exit(1);
}
log(`warm run complete; committing ${warmTag}`);
execFileSync('docker', ['commit', ctr, warmTag], { stdio: 'ignore', timeout: 1200000 });
execFileSync('docker', ['rm', '-f', ctr], { stdio: 'ignore' });
rmSync(pdir, { recursive: true, force: true });

// ---- THE GATE: gold grades FULL under --network none on the warmed image ----
if (!flag('no-gate')) {
  const gateDir = path.join(OUT, `gate-${ID.replace(/[^a-zA-Z0-9_.-]/g, '-')}`);
  mkdirSync(gateDir, { recursive: true });
  const gspec = { ...spec, _origImage: baseImage, image_name: warmTag };
  const tasksPath = path.join(gateDir, 'tasks.json');
  const reportPath = path.join(gateDir, 'report.json');
  writeFileSync(tasksPath, JSON.stringify([gspec]));
  try { rmSync(reportPath, { force: true }); } catch { /* */ }
  log(`gating: eval.py --golden-eval --network none on ${warmTag}`);
  try {
    execFileSync(VENV_PY, [SR_EVAL_RUNNER,
      '--json', tasksPath, '--golden-eval', '--max-workers', '1',
      '--report-json', reportPath, '--network', 'none'],
      { cwd: gateDir, env: { ...process.env, SR_EVAL_DIR, PYTHONPATH: path.join(SR_EVAL_DIR, 'lib') }, stdio: ['ignore', 'inherit', 'inherit'], timeout: 5400000 });
  } catch { /* non-zero on unresolved = normal */ }
  let full = false, detail = 'no-report';
  if (existsSync(reportPath)) {
    const it = (JSON.parse(readFileSync(reportPath, 'utf8')).items || [])[0] || {};
    const { gradeFromReportItem } = await import('./env-ledger.mjs');
    const g = gradeFromReportItem(it, spec, ov);
    full = g.status === 'FULL';
    detail = `f2p ${g.f2pPass}/${g.f2pTot}, p2pFails ${g.p2pFails.length}`;
  }
  if (!full) {
    log(`GATE FAILED for ${ID} (${detail}) — removing ${warmTag}; diagnose ecosystem mechanics before retrying`);
    try { execFileSync('docker', ['rmi', '-f', warmTag], { stdio: 'ignore' }); } catch { /* */ }
    process.exit(3);
  }
  log(`GATE PASSED for ${ID} (${detail})`);
  // Green-ledger invariant: record the gated verdict (with the fingerprint of the
  // WARMED config — new image ID) so run-pilot pre-flight passes for this task.
  const LEDGER = arg('ledger', process.env.ENV_LEDGER || '');
  if (LEDGER) {
    appendFileSync(LEDGER, JSON.stringify({
      instance_id: ID, language: spec.language, grade: 'FULL', status: 'gold-valid',
      f2pFrac: 1, p2pFails: 0, image: warmTag, overridden: true,
      evidence: 'prep-warm gate: gold FULL under --network none on warmed image (arms-blind: task test_cmd + official gold patch only; host lockdown never lowered)',
      configHash: taskConfigHash(gspec, { netLockdown: true, excludeP2P: ov.excludeP2P || [], excludeF2P: ov.excludeF2P || [] }),
      ts: new Date().toISOString(),
    }) + '\n');
    log(`ledger row appended (${LEDGER})`);
  } else log('WARNING: no --ledger/ENV_LEDGER given — gated verdict NOT recorded; run-pilot pre-flight will not know about this warm');
}

// ---- wire into task-overrides.json ----
if (!flag('no-wire')) {
  const fresh = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
  fresh.tasks[ID] = {
    ...(fresh.tasks[ID] || {}),
    _why: `${(fresh.tasks[ID]?._why ? fresh.tasks[ID]._why + ' | ' : '')}prep-phase warmed image (env-ledger ${new Date().toISOString().slice(0, 10)}): test-time dependency fetch dies under egress lockdown; warmed arms-blind (task test_cmd on base + official gold patch, --network bridge container, host lockdown never lowered) and gold-grades FULL offline on the warmed image.`,
    image: warmTag,
  };
  writeFileSync(OVERRIDES_PATH, JSON.stringify(fresh, null, 2) + '\n');
  log(`wired ${ID} → ${warmTag} into ${OVERRIDES_PATH}`);
}
log(`DONE ${ID}`);
