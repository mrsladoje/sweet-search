// Green-ledger invariant tests: fingerprint stability/sensitivity + the run-pilot
// pre-flight gate semantics (missing / stale / not-gold-FULL / excluded / ok).
import assert from 'node:assert';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { taskConfigHash, loadLedger, preflightEnvLedger } from '../harness/env-ledger.mjs';

const spec = (over = {}) => ({
  instance_id: 'acme__widget-1',
  image_name: 'docker.io/swerebenchv2/acme-widget:1-abc',   // stock → imageId not consulted
  install_config: { test_cmd: 'make test' },
  ...over,
});

// --- fingerprint: stable for same config ---
const h1 = taskConfigHash(spec(), { netLockdown: true });
assert.equal(h1, taskConfigHash(spec(), { netLockdown: true }));
assert.equal(h1.length, 16);

// --- fingerprint: sensitive to every config axis ---
assert.notEqual(h1, taskConfigHash(spec({ image_name: 'docker.io/swerebenchv2/acme-widget:1-DIFFERENT' }), { netLockdown: true }));
assert.notEqual(h1, taskConfigHash(spec({ install_config: { test_cmd: 'make test -j2' } }), { netLockdown: true }));
assert.notEqual(h1, taskConfigHash(spec({ _network: 'bridge' }), { netLockdown: true }));
assert.notEqual(h1, taskConfigHash(spec(), { netLockdown: false }));
assert.notEqual(h1, taskConfigHash(spec(), { netLockdown: true, excludeP2P: ['flaky_test'] }));
// excludeP2P order must not matter
assert.equal(
  taskConfigHash(spec(), { netLockdown: true, excludeP2P: ['b', 'a'] }),
  taskConfigHash(spec(), { netLockdown: true, excludeP2P: ['a', 'b'] }));
// local (derived/warm) images consult the docker image ID; absent image → null, still deterministic
const wspec = spec({ image_name: 'swerebenchv2-warm/acme-widget:1-abc' });
assert.equal(taskConfigHash(wspec, { netLockdown: true }), taskConfigHash(wspec, { netLockdown: true }));
// explicit imageId injection changes the hash (a rebuilt warm image invalidates verdicts)
assert.notEqual(
  taskConfigHash(wspec, { netLockdown: true, imageId: 'sha256:aaa' }),
  taskConfigHash(wspec, { netLockdown: true, imageId: 'sha256:bbb' }));

// --- ledger load: append-only, LAST verdict wins ---
const dir = mkdtempSync(path.join(tmpdir(), 'ledger-'));
const lpath = path.join(dir, 'ledger.jsonl');
const s1 = spec(), s2 = spec({ instance_id: 'acme__widget-2' }), s3 = spec({ instance_id: 'acme__widget-3' }), s4 = spec({ instance_id: 'acme__widget-4' });
const rows = [
  { instance_id: s1.instance_id, status: 'needs-warming', evidence: 'clojars' },              // superseded ↓
  { instance_id: s1.instance_id, status: 'gold-valid', configHash: taskConfigHash(s1, { netLockdown: true }) },
  { instance_id: s2.instance_id, status: 'gold-valid', configHash: 'deadbeefdeadbeef' },      // stale hash
  { instance_id: s3.instance_id, status: 'env-broken-curation', evidence: 'patch does not apply' },
  { instance_id: s4.instance_id, status: 'excluded', evidence: 'curation defect, user-excluded 2026-07-09' },
];
writeFileSync(lpath, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const ledger = loadLedger(lpath);
assert.equal(ledger.get(s1.instance_id).status, 'gold-valid'); // last wins

// --- pre-flight verdicts ---
const { ok, failures } = preflightEnvLedger([s1, s2, s3, s4, spec({ instance_id: 'acme__widget-5' })], ledger, { netLockdown: true });
assert.equal(ok, false);
const byId = Object.fromEntries(failures.map(f => [f.instance_id, f.reason]));
assert.equal(byId[s1.instance_id], undefined);          // fresh gold-FULL → passes
assert.equal(byId[s2.instance_id], 'stale');            // hash mismatch
assert.equal(byId[s3.instance_id], 'not-gold-FULL');    // broken env
assert.equal(byId[s4.instance_id], 'excluded');         // explicit exclusion → must be dropped from INSTANCES
assert.equal(byId['acme__widget-5'], 'missing');        // no entry
assert.equal(failures.length, 4);

// all-green selection → ok
assert.equal(preflightEnvLedger([s1], ledger, { netLockdown: true }).ok, true);
// same task under a DIFFERENT network mode → stale (config changed)
assert.equal(preflightEnvLedger([s1], ledger, { netLockdown: false }).failures[0]?.reason, 'stale');

rmSync(dir, { recursive: true, force: true });
console.log('env-ledger-gate: all assertions passed');
