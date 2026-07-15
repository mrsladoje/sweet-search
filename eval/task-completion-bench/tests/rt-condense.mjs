// Offline unit + replay tests for the L1/L2 cost-lever primitives (rt-condense-lib).
// Standalone (no test runner): `node tests/rt-condense.mjs` — exit 1 on any failure.
// Zero docker / API spend. Fixtures reconstruct the DOCUMENTED shapes of the
// forensics-corpus oversized logs (raw 40 KB logs live on the remote bench box; here
// we rebuild the shapes the readers quoted — botan failing-test names, cargo E-codes,
// go --- FAIL, pytest FAILED, mocha failing) so the H1-regression check is exercised.
import {
  condenseOutput, extractFailureSignatures, diffFailureSets, renderBaselineDiff,
  buildAuthorityBanner, sanitizeTestPattern, applyTestPattern, normalizeFailureSignature,
  buildUnresolvedIdentifierWarning, extractAddedIdentifierReferences,
} from '../harness/rt-condense-lib.mjs';

let ok = true;
const assert = (c, name) => { console.log((c ? '  ✓ ' : '  ✗ ') + name); if (!c) ok = false; };
const rep = (s, n) => Array.from({ length: n }, () => s).join('\n');

// ---------------------------------------------------------------------------
console.log('== L1 condenseOutput: verbatim passthrough for small output ==');
{
  const small = 'line1\nline2\nAssertionError: boom\nline4';
  const r = condenseOutput(small);
  assert(r.condensed === false, 'small output not condensed');
  assert(r.text === small, 'small output returned verbatim');
}

// ---------------------------------------------------------------------------
console.log('== L1 condenseOutput: H1 regression — failing-test names survive (botan shape) ==');
{
  // botan: a huge scroll of PASS lines, the FAILED lines buried in the middle, the
  // "N tests failed" summary at the very end. The old blind tail-60 hid the names.
  const noise = rep('Testing block_cipher_aes ... ok', 400);
  const botan = [
    'Botan test runner starting',
    noise,
    'Test x509_cert ... FAILED: found certificate was nullopt',
    'Test tls_handshake ... FAILED: expected 42 but got 0',
    rep('Testing hash_sha256 ... ok', 400),
    'Tests complete',
    '2 tests failed',
  ].join('\n');
  const r = condenseOutput(botan);
  assert(r.condensed === true, 'large botan output condensed');
  assert(/found certificate was nullopt/.test(r.text), 'botan FAILED line #1 (cert nullopt) survives — the canonical H1 fixture');
  assert(/expected 42 but got 0/.test(r.text), 'botan FAILED line #2 survives');
  assert(/2 tests failed/.test(r.text), 'botan summary "2 tests failed" survives (in tail)');
  assert(/condensed by harness/.test(r.text), 'elision marker present');
  assert(/bytes .* elided/.test(r.text), 'elision marker carries byte count');
  assert(Buffer.byteLength(r.text) < Buffer.byteLength(botan) / 3, 'condensed to < 1/3 original size');
}

// ---------------------------------------------------------------------------
console.log('== L1 condenseOutput: cargo compiler error[Exxxx] + file:line survives ==');
{
  const cargo = [
    rep('   Compiling glam v0.24.0', 5),
    rep('warning: unused variable: `x`', 300),
    'error[E0275]: overflow evaluating the requirement `Vec3: Add`',
    '  --> src/vec3.rs:142:9',
    '   |',
    '142 |         self.x + rhs.x',
    '   |         ^^^^^^^^^^^^^^',
    rep('note: required by a bound', 200),
    'error: could not compile `glam` due to previous error',
  ].join('\n');
  const r = condenseOutput(cargo);
  assert(/error\[E0275\]/.test(r.text), 'cargo error[E0275] code survives');
  assert(/src\/vec3\.rs:142:9/.test(r.text), 'cargo file:line context survives (promoted context line)');
  assert(/could not compile/.test(r.text), 'cargo final error survives (tail)');
}

// ---------------------------------------------------------------------------
console.log('== L1 condenseOutput: go --- FAIL + pytest FAILED survive ==');
{
  const gotest = [rep('=== RUN   TestFoo\n--- PASS: TestFoo (0.00s)', 300),
    '--- FAIL: TestHPA_scaleUp (0.12s)',
    '    hpa_test.go:88: expected 3 replicas, got 1',
    rep('=== RUN   TestBar\n--- PASS: TestBar (0.00s)', 300), 'FAIL', 'exit status 1'].join('\n');
  const rg = condenseOutput(gotest);
  assert(/--- FAIL: TestHPA_scaleUp/.test(rg.text), 'go --- FAIL test name survives');
  assert(/hpa_test\.go:88/.test(rg.text), 'go failure file:line survives');

  const py = [rep('tests/test_a.py::test_ok PASSED', 300),
    'tests/test_schema.py::test_introspection FAILED',
    rep('tests/test_b.py::test_ok PASSED', 300), '=== 1 failed, 600 passed in 12.3s ==='].join('\n');
  const rp = condenseOutput(py);
  assert(/test_introspection FAILED/.test(rp.text), 'pytest FAILED node id survives');
}

// ---------------------------------------------------------------------------
console.log('== L1 condenseOutput: green run has NO false failure promotion ==');
{
  const green = [rep('ok - test passes', 800), 'test result: ok. 800 passed; 0 failed; 0 ignored'].join('\n');
  const r = condenseOutput(green);
  assert(r.condensed === true, 'large green output still condensed');
  assert(!/failure\/error line\(s\) promoted/.test(r.text), 'no failure lines promoted from a green run (0 failed negative-guarded)');
}

// ---------------------------------------------------------------------------
console.log('== L1 condenseOutput: bounded — pathological short-line firehose stays capped ==');
{
  const firehose = rep('spam warning line that repeats forever', 200000);
  const r = condenseOutput(firehose);
  assert(Buffer.byteLength(r.text) < 12000, 'firehose condensed under soft ceiling (bounded output)');
}

// ---------------------------------------------------------------------------
console.log('== L2 extractFailureSignatures + diff: asymmetric labeling ==');
{
  const baselineOut = ['Test x509_cert ... FAILED: found certificate was nullopt', '1 tests failed'].join('\n');
  const base = extractFailureSignatures(baselineOut);
  assert(base.ok && base.sigs.size >= 1, 'baseline extracts >=1 failure signature');

  // current: the SAME pre-existing failure + one genuinely NEW one from the agent's edit
  const currentOut = [
    'Test x509_cert ... FAILED: found certificate was nullopt',
    'Test new_feature ... FAILED: expected true got false',
    '2 tests failed',
  ].join('\n');
  const cur = extractFailureSignatures(currentOut);
  const diff = diffFailureSets(base, cur);
  assert(diff !== null, 'diff computed with a valid baseline');
  assert(diff.preExisting.length === 1, 'the cert-nullopt failure labeled PRE-EXISTING (in baseline)');
  assert(diff.introduced.length === 1, 'the new_feature failure labeled INTRODUCED (not in baseline)');
  const banner = renderBaselineDiff(diff);
  assert(/PRE-EXISTING/.test(banner) && /found certificate was nullopt/.test(banner), 'banner names the pre-existing failure (small set)');

  // terseness: a LARGE pre-existing set is COUNTED, not listed (glam-rs 43-failure signal)
  const bigBanner = renderBaselineDiff({ preExisting: Array.from({ length: 40 }, (_, i) => `thread panicked at src/f${i}.rs:${i}:9 assertion`), introduced: ['assert failed in NEW_test.rs:1'], baselineCount: 40, currentCount: 41 });
  assert(/40 PRE-EXISTING/.test(bigBanner) && !/src\/f5\.rs/.test(bigBanner), 'LARGE pre-existing set is COUNTED not listed (resident-mass terseness)');
  assert(/NEW_test\.rs/.test(bigBanner), 'the NEW failure is still named even when pre-existing is counted-only');
  assert(/NEW failure/.test(banner) && /new_feature|expected true got false/.test(banner), 'banner names the new failure');
}

// ---------------------------------------------------------------------------
console.log('== L2 KILL-CONDITION: a newly-introduced failure is NEVER labeled pre-existing ==');
{
  // baseline is GREEN (zero failures). Any current failure MUST be "introduced".
  const base = extractFailureSignatures('test result: ok. 500 passed; 0 failed');
  const cur = extractFailureSignatures('--- FAIL: TestRegression (0.01s)\n    foo_test.go:12: boom\nFAIL');
  const diff = diffFailureSets(base, cur);
  assert(diff.preExisting.length === 0, 'green baseline → zero pre-existing');
  assert(diff.introduced.length === 1, 'regression correctly labeled NEW, never pre-existing (the kill condition)');
}

// ---------------------------------------------------------------------------
console.log('== L2 degrade: no baseline / infra-error current → NO labeling (never mislabel) ==');
{
  const cur = extractFailureSignatures('Test a ... FAILED\n1 tests failed');
  assert(diffFailureSets(null, cur) === null, 'null baseline → null diff (degrade)');
  assert(diffFailureSets({ ok: false }, cur) === null, 'unparseable baseline → null diff (degrade)');

  const infra = extractFailureSignatures('[run_tests] NETWORK UNAVAILABLE in the test container\nError: Could not resolve host');
  assert(infra.infra === true, 'infra error detected in current output');
  const base = extractFailureSignatures('test result: ok. 0 failed');
  assert(diffFailureSets(base, infra) === null, 'infra-error current → null diff (those are not real test failures)');
  assert(renderBaselineDiff(null) === '', 'renderBaselineDiff(null) is empty (degrade to no labeling)');
}

// ---------------------------------------------------------------------------
console.log('== L2 signature normalization: line-shift → false-new (safe), not false-pre-existing ==');
{
  const a = normalizeFailureSignature('Test Failed at /JuMP.jl/test/foo.jl:42');
  const b = normalizeFailureSignature('Test Failed at /JuMP.jl/test/foo.jl:45');
  assert(a !== b, 'a line-number shift yields a DIFFERENT signature (errs toward false-new, the safe side)');
  const c = normalizeFailureSignature('  12) suite desc: AssertionError (0.03s)');
  const d = normalizeFailureSignature('12) suite desc: AssertionError');
  assert(c === d, 'mocha list-index + duration stripped → same signature (robust to run-to-run noise)');

  const ms1 = normalizeFailureSignature('1>2026-07-15T12:01:02.123Z MigratesAClient ... FAILED');
  const ms2 = normalizeFailureSignature('[12:05:09.900] 7>MigratesAClient ... FAILED');
  assert(ms1 === ms2, 'MSBuild node/timestamp prefixes normalize in either order');
  assert(ms1.includes('MigratesAClient'), 'volatile-prefix normalization preserves the named failure');
  assert(
    normalizeFailureSignature('1>MigratesAClient ... FAILED') !== normalizeFailureSignature('1>InitializesAsync ... FAILED'),
    'different named failures remain distinct after MSBuild normalization',
  );
  const buildOnly = extractFailureSignatures('1>Build FAILED.\n7>Done Building Project "Kiota.Builder.Tests.csproj" -- FAILED.');
  assert(!buildOnly.sigs.has('Build FAILED.'), 'generic Build FAILED aggregate is not a failure signature');
  assert([...buildOnly.sigs].some(sig => sig.includes('Kiota.Builder.Tests.csproj')), 'named failed project remains actionable');
}

// ---------------------------------------------------------------------------
console.log('== P3 diff identifier warning: index-resolved, agent-actionable, low noise ==');
{
  const diff = [
    'diff --git a/internal/shell/zsh/action.go b/internal/shell/zsh/action.go',
    '+++ b/internal/shell/zsh/action.go',
    '+value := style.BrightWhite',
  ].join('\n');
  let calls = 0;
  const warning = buildUnresolvedIdentifierWarning(diff, names => {
    calls++;
    assert(names.includes('BrightWhite') && names.includes('style'), 'qualified leaf + qualifier resolved in one batch');
    return [{ name: 'style', type: 'package' }];
  });
  assert(calls === 1, 'identifier resolver called once');
  assert(/style\.BrightWhite/.test(warning), 'unresolved qualified identifier gets one-line warning');
  assert(!warning.includes('\n'), 'warning is a single line');
  assert(warning.length <= buildAuthorityBanner().length, 'warning fits by replacing the existing authority trailer');

  const resolved = buildUnresolvedIdentifierWarning(diff, () => ([
    { name: 'style', type: 'package' }, { name: 'BrightWhite', type: 'const' },
  ]));
  assert(resolved === '', 'indexed const/variable-style definition suppresses warning');

  const bare = 'diff --git a/base/test_helpers.go b/base/test_helpers.go\n+++ b/base/test_helpers.go\n+return TestResultPath';
  assert(/TestResultPath/.test(buildUnresolvedIdentifierWarning(bare, () => [])), 'unresolved bare identifier gets warning');

  const safe = [
    'diff --git a/x.go b/x.go', '+++ b/x.go',
    '+const BrightWhite = "style.MissingInString"',
    '+// MissingInComment',
    '+value := fmt.Sprintf("%s", BrightWhite)',
    '-return RemovedMissing',
  ].join('\n');
  assert(buildUnresolvedIdentifierWarning(safe, () => []) === '', 'declarations, strings, comments, removed lines, and external qualifiers stay quiet');
  assert(extractAddedIdentifierReferences('not a diff').references.length === 0, 'malformed non-diff input has no candidates');
  assert(extractAddedIdentifierReferences('x'.repeat(1_000_001)).references.length === 0, 'oversize diff fails open without warning');
}

// ---------------------------------------------------------------------------
console.log('== L2 authority banner + targeted mode ==');
{
  assert(/Authoritative test result/.test(buildAuthorityBanner()), 'authority banner present');
  assert(/do NOT reconstruct/i.test(buildAuthorityBanner()), 'banner discourages manual reconstruction');

  assert(sanitizeTestPattern('foo; rm -rf /') === 'foo rm -rf /', 'shell metacharacters stripped from pattern');
  assert(sanitizeTestPattern('Test::Introspection_test') === 'Test::Introspection_test', 'legit test id preserved');

  // simple pytest → filter applied; compound/piped → degrade to full
  const pt = applyTestPattern('python -m pytest -q', 'test_introspection');
  assert(pt.applied && /-k 'test_introspection'/.test(pt.cmd), 'pytest simple command gets -k filter');
  const compound = applyTestPattern('pytest -q 2>&1 | tail -50', 'test_x');
  assert(!compound.applied && compound.cmd === 'pytest -q 2>&1 | tail -50', 'piped command degrades to full suite (unchanged)');
  const cargo = applyTestPattern('cargo test --verbose', 'vec3');
  assert(!cargo.applied, 'cargo (positional filter) degrades to full — never corrupts the command');
  const go = applyTestPattern('go test ./...', 'TestHPA');
  assert(go.applied && /-run 'TestHPA'/.test(go.cmd), 'go test gets -run filter');
}

console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
