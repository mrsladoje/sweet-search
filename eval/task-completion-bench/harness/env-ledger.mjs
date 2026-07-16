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

// The fingerprint covers exactly what decides whether a gold grade transfers to a
// run: the effective image (and, for LOCAL derived/warm images, the docker image ID
// — a rebuilt image invalidates old verdicts), the effective test command, the
// grading network mode, and the excludeP2P grading exception. Overrides are applied
// by the caller (spec is the post-override spec, same as run-pilot loadTasks).
export function taskConfigHash(spec, { netLockdown = true, excludeP2P = [], excludeF2P = [], imageId = undefined } = {}) {
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
  };
  // added later than excludeP2P — include only when set, so the 200 already-stamped
  // rows (which predate the field) stay valid for tasks that don't use it
  if (excludeF2P.length) fp.excludeF2P = [...excludeF2P].sort();
  return createHash('sha256').update(JSON.stringify(fp)).digest('hex').slice(0, 16);
}

// Shared gold/agent grading arithmetic (single source of truth for run-pilot,
// env-ledger-sweep and prep-warm). Test names are compared with per-run timing
// suffixes ("[1.23 ms]") stripped — some parsers embed them, and they vary per run.
export const normTestName = (n) => String(n).replace(/\s*\[[0-9.]+ ms\]\s*$/, '').trim();
export function gradeFromReportItem(item, spec, ov = {}) {
  const exclF2P = new Set((ov.excludeF2P || []).map(normTestName));
  const exclP2P = new Set((ov.excludeP2P || []).map(normTestName));
  const f2pAll = (spec.FAIL_TO_PASS || []).map(normTestName).filter(n => !exclF2P.has(n));
  const f2pTot = f2pAll.length;
  const f2pPass = (item.from_fail_to_pass || []).map(normTestName).filter(n => !exclF2P.has(n)).length;
  const p2pFails = (item.failed_from_pass_to_pass || []).map(normTestName).filter(n => !exclP2P.has(n));
  const f2pFrac = f2pTot ? f2pPass / f2pTot : 1;
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
    const now = taskConfigHash(s, { netLockdown, excludeP2P: ov.excludeP2P || [], excludeF2P: ov.excludeF2P || [] });
    if (now !== row.configHash) failures.push({ instance_id: s.instance_id, reason: 'stale', detail: `configHash mismatch (ledger ${row.configHash} ≠ current ${now}) — image/testCmd/network/excludeP2P changed since the gold grade; re-sweep` });
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
