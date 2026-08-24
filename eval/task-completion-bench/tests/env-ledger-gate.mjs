// Green-ledger invariant tests: fingerprint stability/sensitivity + the run-pilot
// pre-flight gate semantics (missing / stale / not-gold-FULL / excluded / ok).
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { writeFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { brokerRequesterSource, shimFingerprintSource } from '../harness/rt-shim-text.mjs';
import { taskConfigHash, loadLedger, preflightEnvLedger, normTestName, gradeFromReportItem, isImagePullInfra, VOLATILE_NAME_RES, vaultTarName, RT_HARNESS_FINGERPRINT } from '../harness/env-ledger.mjs';

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

// Runtime harness fingerprint: exact files, exact bytes, stable ordering/version.
// Version 3 (2026-08-13, commit 7562b42) added the GRADER sources. That commit bumped
// the fingerprint without updating this file, so this test sat red on main for four
// days — the same "nobody checked the grader against itself" shape as D-1. The grader
// assertions below are what make a future silent bump fail here instead.
assert.equal(RT_HARNESS_FINGERPRINT.version, 4);
assert.deepEqual(
  RT_HARNESS_FINGERPRINT.sources.map(({ name }) => name),
  ['rt-condense-lib.mjs', 'rt-shim-runtime.mjs', 'rt-dedup.mjs', 'rt-progress-controller.mjs']);
assert.deepEqual(
  RT_HARNESS_FINGERPRINT.grader.map(({ name }) => name),
  ['evaluator-runtime.mjs', 'sr-eval.py', 'upstream-patches/eval.py']);
for (const { name, sha256 } of [...RT_HARNESS_FINGERPRINT.sources, ...RT_HARNESS_FINGERPRINT.grader]) {
  const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../harness', name);
  assert.equal(sha256, createHash('sha256').update(readFileSync(sourcePath)).digest('hex'));
}
assert.equal(h1, taskConfigHash(spec(), { netLockdown: true, rtHarness: RT_HARNESS_FINGERPRINT }));
const changedRtHarness = {
  ...RT_HARNESS_FINGERPRINT,
  sources: RT_HARNESS_FINGERPRINT.sources.map((source) => source.name === 'rt-dedup.mjs'
    ? { ...source, sha256: '0'.repeat(64) }
    : source),
};
assert.notEqual(h1, taskConfigHash(spec(), { netLockdown: true, rtHarness: changedRtHarness }));

// --- v4: the GENERATED SHIM is fingerprinted, not just the modules it calls ---
// D2 changed the shim so that every run_tests call died inside the jail and no agent ever
// received a verdict, and the two sides compared as ledger-identical because neither
// rt-inflight.mjs nor the shim template was covered. These assertions are what make that
// impossible rather than merely unlikely.
assert.equal(RT_HARNESS_FINGERPRINT.shim.sha256,
  createHash('sha256').update(shimFingerprintSource()).digest('hex'));
// It must hash the REAL generated text, so the in-flight protocol is genuinely inside it.
assert.ok(shimFingerprintSource().includes('RUNNING_BANNER'));
assert.ok(shimFingerprintSource().includes('findInflight'));
// ...and it must be path-independent, or every rollout would produce a unique fingerprint
// and the ledger would be permanently stale rather than merely strict.
assert.ok(!/\/(tmp|var)\/(folders|sweet-search-runner)/.test(shimFingerprintSource()));
const changedShim = { ...RT_HARNESS_FINGERPRINT, shim: { ...RT_HARNESS_FINGERPRINT.shim, sha256: '0'.repeat(64) } };
assert.notEqual(h1, taskConfigHash(spec(), { netLockdown: true, rtHarness: changedShim }));

// THE REGRESSION ITSELF: the production shim variant is the BROKER REQUESTER, it runs inside
// a jail that masks the whole of <repo>/eval, and it must therefore import node: and nothing
// else. Asserted on the canonical text the fingerprint hashes, so the ledger rule and the
// jail rule can never drift apart.
{
  const req = brokerRequesterSource({ reqDir: '/CANON/_rt_ipc', testTimeoutSec: 300 });
  const specifiers = [...req.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.ok(specifiers.length > 0);
  assert.deepEqual(specifiers.filter(x => !x.startsWith('node:')), []);
}

assert.equal(isImagePullInfra(
  'docker: Error response from daemon: unknown: failed to resolve reference; ' +
  'failed to authorize: unexpected status from GET request https://auth.docker.io/token: 502 Bad Gateway'), true);
assert.equal(isImagePullInfra('FAILED test_widget.py::test_value'), false);

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
const s1 = spec(), s2 = spec({ instance_id: 'acme__widget-2' }), s3 = spec({ instance_id: 'acme__widget-3' }), s4 = spec({ instance_id: 'acme__widget-4' }), s6 = spec({ instance_id: 'acme__widget-6' });
const rows = [
  { instance_id: s1.instance_id, status: 'needs-warming', evidence: 'clojars' },              // superseded ↓
  { instance_id: s1.instance_id, status: 'gold-valid', configHash: taskConfigHash(s1, { netLockdown: true }) },
  { instance_id: s2.instance_id, status: 'gold-valid', configHash: 'deadbeefdeadbeef' },      // stale hash
  { instance_id: s3.instance_id, status: 'env-broken-curation', evidence: 'patch does not apply' },
  { instance_id: s4.instance_id, status: 'excluded', evidence: 'curation defect, user-excluded 2026-07-09' },
  { instance_id: s6.instance_id, status: 'gold-valid', configHash: taskConfigHash(s6, { netLockdown: true, rtHarness: changedRtHarness }) },
];
writeFileSync(lpath, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const ledger = loadLedger(lpath);
assert.equal(ledger.get(s1.instance_id).status, 'gold-valid'); // last wins

// --- pre-flight verdicts ---
const { ok, failures } = preflightEnvLedger([s1, s2, s3, s4, spec({ instance_id: 'acme__widget-5' }), s6], ledger, { netLockdown: true });
assert.equal(ok, false);
const byId = Object.fromEntries(failures.map(f => [f.instance_id, f.reason]));
assert.equal(byId[s1.instance_id], undefined);          // fresh gold-FULL → passes
assert.equal(byId[s2.instance_id], 'stale');            // hash mismatch
assert.equal(byId[s3.instance_id], 'not-gold-FULL');    // broken env
assert.equal(byId[s4.instance_id], 'excluded');         // explicit exclusion → must be dropped from INSTANCES
assert.equal(byId['acme__widget-5'], 'missing');        // no entry
assert.equal(byId[s6.instance_id], 'stale');            // runtime harness changed after gold grade
assert.equal(failures.length, 5);

// all-green selection → ok
assert.equal(preflightEnvLedger([s1], ledger, { netLockdown: true }).ok, true);
// same task under a DIFFERENT network mode → stale (config changed)
assert.equal(preflightEnvLedger([s1], ledger, { netLockdown: false }).failures[0]?.reason, 'stale');

rmSync(dir, { recursive: true, force: true });

// --- volatile test-name normalization (held-out ledger triage 2026-07-17) ---
// JVM prints Object.toString() as ClassName@identityHashCode; HotSpot seeds its
// identity-hash RNG deterministically, so most re-runs reproduce the frozen value
// and only a few drift — detekt-7637 matched 96/98 F2P names and failed on 2.
assert.equal(
  normTestName('[1] org.jetbrains.kotlin.resolve.BindingTraceContext$1@d58fa2 (AnnotationSuppressorSpec)'),
  '[1] org.jetbrains.kotlin.resolve.BindingTraceContext$1 (AnnotationSuppressorSpec)');
// detekt-style names stay DISTINCT after stripping (differ by ordinal + class)
assert.notEqual(
  normTestName('[1] org.jetbrains.kotlin.resolve.BindingTraceContext$1@d58fa2 (X)'),
  normTestName('[2] org.jetbrains.kotlin.resolve.BindingContext$1@30cb54e1 (X)'));
// anchored on a preceding word char: bare tokens are NOT hex-stripped
assert.equal(normTestName('serves @cafe menu'), 'serves @cafe menu');
// non-hex scopes (npm package names) are untouched
assert.equal(normTestName('resolves @babel/core import'), 'resolves @babel/core import');
// idempotent — normalizing twice must be a no-op
const _n = normTestName('Foo$1@d58fa2 bar');
assert.equal(normTestName(_n), _n);

// gradeFromReportItem: identity-hash drift no longer zeroes a matched name
const dspec = { instance_id: 'd__d-1', FAIL_TO_PASS: ['[1] Ctx$1@d58fa2 (S)', '[2] Ctx$2@30cb54e1 (S)'] };
assert.equal(
  gradeFromReportItem({ from_fail_to_pass: ['[1] Ctx$1@aaaaaa (S)', '[2] Ctx$2@bbbbbb (S)'], failed_from_pass_to_pass: [] }, dspec).status,
  'FULL');

// gradeFromReportItem: an EMPTY post-exclusion F2P set must never grade FULL —
// excluding every requirement would silently turn a task into a free pass.
// (This is why gradeup__shadow-1177, whose 4 F2P names differ only by volatile
// JVM lambda addresses, is a reserve promotion and not an excludeF2P.)
const eg = gradeFromReportItem({ from_fail_to_pass: [], failed_from_pass_to_pass: [] },
  { instance_id: 'e__e-1', FAIL_TO_PASS: ['only_test'] }, { excludeF2P: ['only_test'] });
assert.notEqual(eg.status, 'FULL');
assert.equal(eg.f2pTot, 0);

// --- vault tar filename encoding (heldout v3 pre-flight, 2026-07-17) ---
// Pinned against a REAL filename produced by warm-heldout.sh's `tr "/:" "__"`,
// which maps each of "/" and ":" to a SINGLE "_". A `.replace(/[/:]/g,'__')`
// here yields double underscores, silently matches no tar, and makes every
// warmed task record `infra/derived-image-missing` — voiding the ledger for
// exactly the tasks warming exists to rescue.
assert.equal(
  (vaultTarName('swerebenchv2-warm/filecoin-project-builtin-actors:1424-fc80851')),
  'swerebenchv2-warm_filecoin-project-builtin-actors_1424-fc80851.tar');
assert.equal(
  (vaultTarName('swerebenchv2-fixed/juliadiff-finitedifferences.jl:197-2e3dd78')),
  'swerebenchv2-fixed_juliadiff-finitedifferences.jl_197-2e3dd78.tar');
assert.ok(!(vaultTarName('a/b:c')).includes('__'), 'no double underscore');

// --- LOCKSTEP GUARD: JS VOLATILE_NAME_RES vs python _TIMING_NORMALIZE_RES ---
// gradeFromReportItem compares JS-normalized spec names against report names that
// eval.py already normalized, so JS must strip everything python strips. If you add
// a pattern to one side, add it to the other or this fires.
const _py = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../harness/upstream-patches/eval.py'), 'utf8');
const _blk = _py.slice(_py.indexOf('_TIMING_NORMALIZE_RES = ['), _py.indexOf('\n]', _py.indexOf('_TIMING_NORMALIZE_RES = [')));
const _pyCount = (_blk.match(/re\.compile\(/g) || []).length;
assert.equal(VOLATILE_NAME_RES.length, _pyCount,
  `normalizer drift: env-ledger.mjs has ${VOLATILE_NAME_RES.length} patterns, eval.py has ${_pyCount}`);

console.log('env-ledger-gate: all assertions passed');
