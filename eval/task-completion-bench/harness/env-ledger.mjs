// env-ledger.mjs — the green-ledger invariant (standing rule, 2026-07-09):
// every bench task is either gold-FULL under the EXACT run config or explicitly
// excluded with evidence. This module is the single source of truth for
//   (a) the per-task config fingerprint ("exact run config"),
//   (b) reading the append-only ledger (last verdict per task wins),
//   (c) the run-pilot pre-flight gate: refuse to launch when any selected task's
//       entry is missing, stale (fingerprint mismatch vs the CURRENT harness/
//       network/image state), or not gold-FULL.
// Env deaths in a run are impossible by construction, not avoided by diligence.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { shimFingerprintSource } from './rt-shim-text.mjs';

// Runtime test-output behavior affects whether a gold verdict transfers to a
// pilot run just as much as image/test configuration does. Keep an ordered,
// versioned manifest of the exact source bytes so sweep rows and run-pilot
// preflight invalidate together whenever that behavior changes.
const RT_HARNESS_SOURCE_NAMES = Object.freeze([
  'rt-condense-lib.mjs',
  'rt-shim-runtime.mjs',
  'rt-dedup.mjs',
  'rt-progress-controller.mjs',
]);

// THE GRADER ITSELF (added 2026-08-12, fingerprint version 3).
//
// D-1 happened because gold validation and rollout grading ran DIFFERENT grader
// configurations for months and no invariant compared them: the sweep always
// passed `--reapply-install-seds`, the rollout grader never did, and 12 rows
// were published as gradeable failures with zero tests executed.
//
// The repair at the time fixed the flag. It did not fix the CLASS: the
// fingerprint still covered only the rt-* runtime, so any later edit to the
// grading logic could again certify gold under one grader and score agents
// under another, silently. That recurred immediately — the 2026-08-12 review
// changed empty-patch handling in eval.py, evidence gating in
// evaluator-runtime.mjs and sr-eval.py, and every gold verdict stayed "fresh".
//
// Hashing the grader's own bytes makes the divergence impossible rather than
// merely discouraged. The cost is a gold re-sweep whenever the grader changes,
// including for cosmetic edits. That is the correct trade: a re-sweep costs
// container time and NO model spend, while a silent divergence costs the
// credibility of every solve number derived under it.
//
// cargo_log_parser.py (added 2026-09-03, fingerprint version 5): the Rust log parser
// sr-eval.py installs over the upstream one. It was outside the fingerprint, so the
// gleam-3458 glued-status fix (`... okLocked!` graded as a PASS_TO_PASS failure) would
// neither have forced a re-sweep nor been noticed by one.
const GRADER_SOURCE_NAMES = Object.freeze([
  'evaluator-runtime.mjs',
  'sr-eval.py',
  'upstream-patches/eval.py',
  'cargo_log_parser.py',
]);

const hashSource = (name) => ({
  name,
  sha256: createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex'),
});

// THE GENERATED SHIM ITSELF (added 2026-08-24, fingerprint version 4).
//
// The list above hashes the modules the shim CALLS. It never hashed the shim, and it never
// hashed the template that assembles it. D2 walked straight through that gap: it changed the
// generated `run_tests` text so that, under the production isolation policy, every call on
// every harness died with ERR_MODULE_NOT_FOUND and no agent ever received a verdict — and the
// two sides of that change compared as LEDGER-IDENTICAL, because neither `rt-inflight.mjs`
// nor `codex-task-runner.mjs` was covered.
//
// Hashing the generated TEXT rather than a file list is what makes this stay closed: it
// covers the inlined in-flight protocol, the template, and any future inlining, in one rule.
// It also avoids the obvious alternative's cost — listing `codex-task-runner.mjs` would stale
// every gold verdict each time an unrelated line of a 58 KB adapter moved.
//
// The text is generated with CANONICAL placeholder paths (see rt-shim-text.mjs), so the hash
// tracks the code and never a per-rollout temp directory. A per-rollout path would make every
// run's fingerprint unique and the ledger permanently stale.
const hashShimText = () => ({
  name: 'generated run_tests shim (canonical)',
  sha256: createHash('sha256').update(shimFingerprintSource()).digest('hex'),
});

export const RT_HARNESS_FINGERPRINT = Object.freeze({
  version: 5,
  sources: Object.freeze(RT_HARNESS_SOURCE_NAMES.map(name => Object.freeze(hashSource(name)))),
  grader: Object.freeze(GRADER_SOURCE_NAMES.map(name => Object.freeze(hashSource(name)))),
  shim: Object.freeze(hashShimText()),
});

// Image-resolution/authentication failures happen before a task's tests can run.
// They are grader infrastructure, never evidence that a task is env-broken.
const IMAGE_PULL_INFRA_RES = Object.freeze([
  /docker: Error response from daemon:.*failed to resolve reference/i,
  /failed to authorize:.*(?:auth\.docker\.io|anonymous token)/i,
  /unexpected status from GET request.*\b5\d\d\b/i,
]);
export function isImagePullInfra(text) {
  return IMAGE_PULL_INFRA_RES.some(pattern => pattern.test(String(text || '')));
}

// The fingerprint covers exactly what decides whether a gold grade transfers to a
// run: the effective image (and, for LOCAL derived/warm images, the docker image ID
// — a rebuilt image invalidates old verdicts), the effective test command, the
// grading network mode, grading exceptions, install sed shims, and runtime harness
// source fingerprint. Overrides are applied by the caller (spec is the post-override
// spec, same as run-pilot loadTasks).
export function taskConfigHash(spec, {
  netLockdown = true,
  excludeP2P = [],
  excludeF2P = [],
  imageId = undefined,
  presedCmds = [],
  rtHarness = RT_HARNESS_FINGERPRINT,
} = {}) {
  const img = spec.image_name || '';
  const local = /^swerebenchv2-(fixed|warm)\//.test(img) || !!spec._origImage;
  const id = imageId !== undefined ? imageId : (local ? dockerImageId(img) : null);
  const fp = {
    instance_id: spec.instance_id,
    image: img,
    imageId: id,                      // null for registry-pulled stock images
    testCmd: [].concat(spec.install_config?.test_cmd || []).join(' && '),
    net: netLockdown ? (spec._network === 'bridge' ? 'bridge' : 'none') : 'legacy-open',
    excludeP2P: [...excludeP2P].sort(),
    rtHarness,
  };
  // added later than excludeP2P — include only when set, so the 200 already-stamped
  // rows (which predate the field) stay valid for tasks that don't use it
  if (excludeF2P.length) fp.excludeF2P = [...excludeF2P].sort();
  // --reapply-install-seds (2026-07-17): grading now re-runs install_config's
  // sed shims post-reset. Include only when the task HAS such seds — their
  // effective grading changed; sed-free tasks keep their existing hashes.
  if (presedCmds.length) fp.presed = [...presedCmds];
  return createHash('sha256').update(JSON.stringify(fp)).digest('hex').slice(0, 16);
}

// Shared gold/agent grading arithmetic (single source of truth for run-pilot,
// env-ledger-sweep and prep-warm). Test names are compared with per-run timing
// suffixes ("[1.23 ms]") stripped — some parsers embed them, and they vary per run.
// MUST stay in lockstep with _TIMING_NORMALIZE_RES in
// harness/upstream-patches/eval.py — gradeFromReportItem compares
// JS-normalized spec names against Python-normalized report names, so any
// divergence silently zeroes f2pPass.
export const VOLATILE_NAME_RES = [
  /\s*\[\s*\d+(?:\.\d+)?\s*(?:ms|s)\s*\]\s*$/i,   // "[1.34 ms]"
  /\s+in\s+\d+(?:\.\d+)?\s+(?:msec|sec)\b/i,      // " in 29.08 msec"
  /\s*\(\s*\d+(?:\.\d+)?\s*(?:ms|s)\s*\)\s*$/i,   // " (123ms)"
  /\s+\d+(?:\.\d+)?\s+sec\s*$/i,                  // ctest "   0.58 sec"
  /\s+\d+(?:\.\d+)?\s*ms\s*$/i,                   // bjam ":PASSED  4ms"
  /\s+(?:\(cached\)|\d+(?:\.\d+)?s)\s*$/,         // go "\t0.009s" | "\t(cached)"
  /^\s*\d+\s+(?=\[)/,                             // playwright leading ordinal
  /(?<=127\.0\.0\.1):\d{2,5}\b/,                  // redis live ports
  /(?<=\w)@[0-9a-f]{4,16}\b/g,                    // JVM identity hashCode "Foo$1@d58fa2"
];
export const normTestName = (n) => {
  let s = String(n);
  for (const r of VOLATILE_NAME_RES) s = s.replace(r, '');
  return s.trim();
};

// Vault tar filename encoding — single source of truth, MUST match whatever wrote
// the tars. The vaulting scripts (warm-heldout.sh / rewarm-one.sh) use
// `tr "/:" "__"`, which maps EACH of "/" and ":" to a SINGLE "_" — tr is charwise,
// not a string replace. Encoding this as `.replace(/[/:]/g, '__')` yields DOUBLE
// underscores, matches no tar, and makes every warmed task silently record
// `infra/derived-image-missing` — voiding the ledger for exactly the tasks warming
// exists to rescue (caught pre-v3, 2026-07-17).
export const vaultTarName = (image) => image.replace(/[/:]/g, '_') + '.tar';

// Single source of truth for which install_config steps get re-applied by
// eval.py --reapply-install-seds (and therefore belong in the config hash).
export const installSedCmds = (spec) =>
  [].concat(spec.install_config?.install || [])
    .filter((c) => typeof c === 'string' && c.trim().startsWith('sed -i'))
    .map((c) => c.trim());
export function gradeFromReportItem(item, spec, ov = {}) {
  const exclF2P = new Set((ov.excludeF2P || []).map(normTestName));
  const exclP2P = new Set((ov.excludeP2P || []).map(normTestName));
  // Compare UNIQUE normalized names on both sides. Upstream returns
  // from_fail_to_pass as a deduplicated set-intersection, while raw
  // FAIL_TO_PASS lists can carry duplicate names (parameterized suites that
  // reuse identical test descriptions — redis TCL, PHPUnit testdox). Counting
  // the raw list length guarantees a spurious PARTIAL even when every named
  // test passed (held-out ledger triage 2026-07-17).
  const f2pAll = new Set((spec.FAIL_TO_PASS || []).map(normTestName).filter(n => !exclF2P.has(n)));
  const f2pTot = f2pAll.size;
  const f2pPass = new Set((item.from_fail_to_pass || []).map(normTestName)
    .filter(n => !exclF2P.has(n) && f2pAll.has(n))).size;
  const p2pFails = [...new Set((item.failed_from_pass_to_pass || []).map(normTestName).filter(n => !exclP2P.has(n)))];
  // No gradeable F2P requirement — natively empty, or every name excluded by an
  // override — must never grade FULL. An empty requirement set is a free pass for
  // BOTH arms (run-pilot scores agent runs through this same function), which is
  // exactly the "silent zero" the green-ledger rule forbids. Force the task to an
  // explicit disposition: exclude it, or promote its replacement from the reserve.
  if (f2pTot === 0) return { f2pFrac: 0, f2pPass: 0, f2pTot: 0, p2pFails, p2pOk: p2pFails.length === 0, status: 'NO' };
  const f2pFrac = f2pPass / f2pTot;
  const status = (f2pFrac === 1 && p2pFails.length === 0) ? 'FULL' : (f2pFrac > 0 && p2pFails.length === 0 ? 'PARTIAL' : 'NO');
  return { f2pFrac, f2pPass, f2pTot, p2pFails, p2pOk: p2pFails.length === 0, status };
}

export function dockerImageId(image) {
  try { return execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }               // image not present locally
}

// Append-only ledger → last verdict per instance_id wins.
export function loadLedger(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const l of readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)) {
    try { const r = JSON.parse(l); if (r.instance_id) map.set(r.instance_id, r); } catch { /* skip corrupt line */ }
  }
  return map;
}

// Pre-flight gate. specs = post-override specs selected for the run.
// Returns { ok, failures: [{instance_id, reason, detail}] }.
export function preflightEnvLedger(specs, ledger, { netLockdown = true, overrides = {} } = {}) {
  const failures = [];
  for (const s of specs) {
    const row = ledger.get(s.instance_id);
    if (!row) { failures.push({ instance_id: s.instance_id, reason: 'missing', detail: 'no ledger entry — run env-ledger-sweep for this task' }); continue; }
    if (row.status === 'excluded') { failures.push({ instance_id: s.instance_id, reason: 'excluded', detail: `explicitly excluded: ${row.evidence || row.signature || ''} — remove it from INSTANCES` }); continue; }
    if (row.status !== 'gold-valid') { failures.push({ instance_id: s.instance_id, reason: 'not-gold-FULL', detail: `ledger status=${row.status} (${(row.evidence || row.signature || '').slice(0, 120)})` }); continue; }
    if (!row.configHash) { failures.push({ instance_id: s.instance_id, reason: 'stale', detail: 'ledger entry has no configHash — re-sweep (or backfill) under the current harness' }); continue; }
    const ov = overrides.tasks?.[s.instance_id] || {};
    const now = taskConfigHash(s, { netLockdown, excludeP2P: ov.excludeP2P || [], excludeF2P: ov.excludeF2P || [], presedCmds: installSedCmds(s) });
    if (now !== row.configHash) failures.push({ instance_id: s.instance_id, reason: 'stale', detail: `configHash mismatch (ledger ${row.configHash} ≠ current ${now}) — image/testCmd/network/grading exceptions/runtime harness changed since the gold grade; re-sweep` });
  }
  return { ok: failures.length === 0, failures };
}

// CLI: node env-ledger.mjs stamp --ledger <ledger.jsonl> --tasks <specs.json> [--no-lockdown]
//   Backfills configHash onto rows that lack it (valid when the ledger was produced
//   under the CURRENT config, e.g. immediately after a sweep on this host).
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
  if (process.argv[2] === 'stamp') {
    const { writeFileSync } = await import('node:fs');
    const path = await import('node:path');
    const ledgerPath = arg('ledger'); const tasksPath = arg('tasks');
    const OVERRIDES_PATH = process.env.TASK_OVERRIDES || path.join(path.dirname(new URL(import.meta.url).pathname), 'task-overrides.json');
    const overrides = existsSync(OVERRIDES_PATH) ? JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')) : { tasks: {} };
    const specs = new Map(JSON.parse(readFileSync(tasksPath, 'utf8')).map(s => [s.instance_id, s]));
    const netLockdown = !process.argv.includes('--no-lockdown');
    const out = [];
    let stamped = 0;
    for (const l of readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean)) {
      let r; try { r = JSON.parse(l); } catch { continue; }
      if (!r.configHash && r.instance_id && specs.has(r.instance_id)) {
        const s = { ...specs.get(r.instance_id) };
        const ov = overrides.tasks?.[s.instance_id] || {};
        if (ov.testCmd) s.install_config = { ...s.install_config, test_cmd: ov.testCmd };
        if (ov.network) s._network = ov.network;
        if (ov.image) { s._origImage = s.image_name; s.image_name = ov.image; }
        r.configHash = taskConfigHash(s, { netLockdown, excludeP2P: ov.excludeP2P || [], excludeF2P: ov.excludeF2P || [] });
        stamped++;
      }
      out.push(JSON.stringify(r));
    }
    writeFileSync(ledgerPath, out.join('\n') + '\n');
    console.log(`stamped configHash on ${stamped} rows of ${out.length} in ${ledgerPath}`);
  }
}
