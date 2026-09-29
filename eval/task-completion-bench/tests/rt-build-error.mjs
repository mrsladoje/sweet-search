// Offline tests for the run_tests BUILD/COLLECTION ERROR status (2026-09-29).
// Standalone (no test runner): `node tests/rt-build-error.mjs` — exit 1 on any failure.
//
// Defect: zmap__zlint-299 (hc-claudecode-20260929-0423-L2). `go test` failed to COMPILE
// (`undefined: util.PoisonOID`), exit 2; the shim parsed 0 failures and said
// trustworthy=yes, the dedup repeat said "0 failed (suite green)", and the in-container
// condenser's `tail -45` hid the compiler line. Zero docker / API spend: the real
// in-container condenser runs under local bash against fixture files.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  classifyBuildError, firstErrorLines, extractBuildErrorMarkers, renderBuildErrorNote,
  BUILD_ERROR_MARKER_ERE, FIRST_ERROR_ERE, buildRunTestsFooter,
} from '../harness/rt-condense-lib.mjs';
import {
  RT_CONDENSE, RT_CONDENSE_FIRST_ERRORS, runTestsWithLevers, classifySuiteResult,
} from '../harness/rt-shim-runtime.mjs';
import { summarizeRunTestsResult, buildDedupSummary, startDedupSession, DEDUP_MARKER } from '../harness/rt-dedup.mjs';
import { verdictOf, runTestsTelemetry } from '../harness/rt-inflight.mjs';
import { extractFailureSignatures } from '../harness/rt-condense-lib.mjs';

let ok = true;
const assert = (c, name, extra = '') => {
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + String(extra).slice(0, 400)));
  if (!c) ok = false;
};
const work = mkdtempSync(path.join(tmpdir(), 'rt-build-error-'));
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n');

// Run the REAL in-container condenser under local bash against a fixture output + exit.
let condenseId = 0;
function condense(raw, exit, script = RT_CONDENSE) {
  const d = path.join(work, `c${++condenseId}`);
  execFileSync('mkdir', ['-p', d]);
  writeFileSync(d + '/out', raw);
  writeFileSync(d + '/exit', String(exit));
  const s = script.replaceAll('/tmp/__rt_out', d + '/out').replaceAll('/tmp/__rt_exit', d + '/exit');
  return execFileSync('bash', ['-c', s], { encoding: 'utf8' }).slice(0, 8000);   // runSuite's cap
}
// The condenser exactly as it was before the first-errors block (for byte-stability checks).
const RT_CONDENSE_PREVIOUS = RT_CONDENSE.replace(RT_CONDENSE_FIRST_ERRORS, '');

// ---- fixtures (real shapes) ------------------------------------------------------
// go test -v ./... where one package does not compile: stderr compile lines first, then
// the [build failed] FAIL lines, then >45 lines of a later, passing package.
const GO_PASS_SCROLL = rep(120, i => `=== RUN   TestUtil${i}\n--- PASS: TestUtil${i} (0.00s)`) +
  '\nPASS\nok  \tgithub.com/zmap/zlint/util\t0.161s';
const GO_COMPILE_RAW = [
  '# github.com/zmap/zlint/lints',
  'lints/lint_ct_sct_policy_count_unsatisfied.go:37:63: undefined: util.PoisonOID',
  'FAIL\tgithub.com/zmap/zlint [build failed]',
  'FAIL\tgithub.com/zmap/zlint/lints [build failed]',
  GO_PASS_SCROLL,
].join('\n') + '\n';
const GO_CLEAN_RAW = GO_PASS_SCROLL.replace('ok  \tgithub.com/zmap/zlint/util', 'ok  \tgithub.com/zmap/zlint/lints\t0.5s\nok  \tgithub.com/zmap/zlint/util') + '\n';

// pytest collection error (import error in a test module), exit 2.
const PY_COLLECT_RAW = [
  '============================= test session starts ==============================',
  'collected 12 items / 1 error',
  '',
  '==================================== ERRORS ====================================',
  '____________________ ERROR collecting tests/test_widget.py _____________________',
  "ImportError while importing test module '/repo/tests/test_widget.py'.",
  'tests/test_widget.py:3: in <module>',
  '    from widget.core import make_widget',
  "E   ModuleNotFoundError: No module named 'widget.core'",
  '=========================== short test summary info ============================',
  'ERROR tests/test_widget.py',
  '!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!',
  '=============================== 1 error in 0.21s ===============================',
].join('\n') + '\n';
const PY_PASS_RAW = ['collected 12 items', rep(12, i => `tests/test_widget.py::test_${i} PASSED`), '12 passed in 0.30s'].join('\n') + '\n';
const PY_FAIL_RAW = ['collected 12 items', rep(11, i => `tests/test_widget.py::test_${i} PASSED`),
  'FAILED tests/test_widget.py::test_size - AssertionError: expected 42 but got 0',
  '1 failed, 11 passed in 0.31s'].join('\n') + '\n';
const PY_FAIL_LONG_RAW = ['collected 300 items', rep(150, i => `tests/test_a.py::test_${i} PASSED`),
  'FAILED tests/test_widget.py::test_size - AssertionError: expected 42 but got 0',
  rep(149, i => `tests/test_b.py::test_${i} PASSED`), '1 failed, 299 passed in 3.1s'].join('\n') + '\n';

// jest: failing test names use U+2715, which the parser does not read → 0 signatures,
// but the summary says tests failed (ember-cli__eslint-plugin-ember-551 shape).
// A failing summary whose per-test names did not survive capture. (Jest's `✕` / `●` name
// lines parse since 2026-09-29 — tests/rt-runner-shapes.mjs — so this fixture carries none.)
const JEST_UNPARSED_RAW = ['  rules setup', '    expect(received).toEqual(expected)',
  'Test Suites: 1 failed, 62 passed, 63 total', 'Tests:       3 failed, 1360 passed, 1363 total',
  'Ran all test suites.'].join('\n') + '\n';

// cargo: an ORDINARY failing test prints "error: test failed" — must stay FAIL, not ERROR.
const CARGO_FAIL_RAW = ['running 3 tests', 'test tests::a ... ok', 'test tests::b ... FAILED',
  "thread 'tests::b' panicked at src/lib.rs:10:5:", 'assertion failed: x == 1',
  'test result: FAILED. 2 passed; 1 failed; 0 ignored', 'error: test failed, to rerun pass `--lib`'].join('\n') + '\n';

// ---- 1. pure classifier ------------------------------------------------------------
console.log('== classifyBuildError: build vs test failure vs pass ==');
{
  const goOld = condense(GO_COMPILE_RAW, 2, RT_CONDENSE_PREVIOUS);   // what the agent actually got
  const sigOld = extractFailureSignatures(goOld);
  assert(sigOld.sigs.size === 0 && !goOld.includes('undefined:'),
    'REPRO: the previous condenser drops the compile line and yields 0 signatures (zlint shape)');
  assert(classifyBuildError({ text: goOld, exitCode: 2, sigCount: 0 }).buildError === true,
    'Go compile failure, exit 2, 0 parsed failures, no failure summary → build error');

  const py = extractFailureSignatures(PY_COLLECT_RAW);
  const pyC = classifyBuildError({ text: PY_COLLECT_RAW, exitCode: 2, sigCount: py.sigs.size });
  assert(pyC.buildError === true && pyC.newMarkers.some(m => /ERROR collecting/.test(m)),
    'pytest collection error (ModuleNotFoundError) → build error even though an Error: line parsed as a signature', JSON.stringify(pyC));

  const pf = extractFailureSignatures(PY_FAIL_RAW);
  assert(classifyBuildError({ text: PY_FAIL_RAW, exitCode: 1, sigCount: pf.sigs.size }).buildError === false,
    'normal failing pytest test → NOT a build error');
  assert(classifyBuildError({ text: PY_PASS_RAW, exitCode: 0, sigCount: 0 }).buildError === false,
    'exit 0 → never a build error');

  const jest = classifyBuildError({ text: JEST_UNPARSED_RAW, exitCode: 1, sigCount: extractFailureSignatures(JEST_UNPARSED_RAW).sigs.size });
  assert(jest.buildError === false && jest.unparsedFailure === true,
    'jest failure with unparsed names but "Tests: 3 failed" → unparsed TEST failure, not build error', JSON.stringify(jest));

  const cargo = classifyBuildError({ text: CARGO_FAIL_RAW, exitCode: 101, sigCount: extractFailureSignatures(CARGO_FAIL_RAW).sigs.size });
  assert(cargo.buildError === false, 'cargo ordinary failure ("error: test failed, to rerun") → NOT a build error');

  // Pre-existing marker (a package that never builds in the image): the sfmc-devtools
  // trap — one pre-existing line must not force every call to ERROR.
  const preMarkers = extractBuildErrorMarkers('FAIL\tgithub.com/x/broken [build failed]\n');
  const withPre = 'FAIL\tgithub.com/x/broken [build failed]\n--- FAIL: TestNew (0.00s)\nFAIL\tgithub.com/x/ok\t0.1s\n';
  const pre = classifyBuildError({ text: withPre, exitCode: 1, sigCount: 2, baselineMarkers: preMarkers });
  assert(pre.buildError === false, 'a build marker already present on the clean baseline stays FAIL (not ERROR)');
  assert(classifyBuildError({ text: withPre, exitCode: 1, sigCount: 2, baselineMarkers: new Set() }).buildError === true,
    'the same marker absent from the baseline → ERROR');

  // Tokens that must NOT be build markers (they appear on normal failing runs).
  for (const line of ['error: test failed, to rerun pass `--lib`', 'AssertionError: boom',
    'FAILED tests/x.py::t - Error: nope', '--- FAIL: TestX (0.00s)', 'Tests: 3 failed']) {
    assert(!new RegExp(BUILD_ERROR_MARKER_ERE).test(line), `not a build marker: ${line}`);
  }
}

// ---- 2. condenser: first-error excerpt under the cap ---------------------------------
console.log('== in-container condenser: first-error lines survive the cap ==');
{
  const goNew = condense(GO_COMPILE_RAW, 2);
  assert(goNew.includes('--- first error lines (exit 2) ---'), 'Go compile failure: excerpt header printed');
  assert(goNew.includes('undefined: util.PoisonOID'), 'Go compile failure: the `undefined:` compiler line is retained');
  assert(goNew.indexOf('undefined: util.PoisonOID') < goNew.indexOf('--- output tail ---'),
    'excerpt precedes the tail (so it also survives the 8000-char capture cap)');

  // Capped: huge output, the compile error far from the tail, one line longer than 240 chars.
  const longLine = 'src/app.ts(3,5): error TS2304: Cannot find name ' + "'x'".repeat(200);
  const capped = [longLine, rep(3000, i => `  noise line ${i} ${'.'.repeat(60)}`),
    rep(12, i => `pkg/m${i}.go:${i + 1}:2: undefined: Foo${i}`), rep(200, i => `tail ${i}`)].join('\n') + '\n';
  const c = condense(capped, 1);
  const block = c.slice(c.indexOf('--- first error lines'), c.indexOf('--- output tail ---'));
  const excerptLines = block.split('\n').slice(1).filter(l => l && !l.startsWith('---'));
  assert(c.length <= 8000, 'capped output within the 8000-char capture cap');
  assert(excerptLines[0].startsWith('src/app.ts(3,5): error TS2304') && excerptLines[0].length <= 240,
    'first excerpt line is the FIRST error, cut to 240 chars', excerptLines[0]?.length);
  assert(excerptLines.filter(l => /undefined: Foo/.test(l)).length === 7 && excerptLines.length <= 16,
    'excerpt is bounded (first 8 matches) — later errors are not all dumped', excerptLines.length);
  assert(firstErrorLines(c)[0].startsWith('src/app.ts(3,5): error TS2304'), 'firstErrorLines reads the excerpt back in order');

  // Byte-stability: exit 0, or output that fits in the tail, or a normal failing run with no
  // error-vocabulary lines → identical to the previous condenser.
  assert(condense(PY_PASS_RAW, 0) === condense(PY_PASS_RAW, 0, RT_CONDENSE_PREVIOUS), 'normal pass: byte-identical output');
  assert(condense(PY_FAIL_RAW, 1) === condense(PY_FAIL_RAW, 1, RT_CONDENSE_PREVIOUS), 'normal short failure: byte-identical output');
  assert(condense(PY_FAIL_LONG_RAW, 1) === condense(PY_FAIL_LONG_RAW, 1, RT_CONDENSE_PREVIOUS), 'normal long failure: byte-identical output');
  assert(condense(GO_CLEAN_RAW, 0) === condense(GO_CLEAN_RAW, 0, RT_CONDENSE_PREVIOUS), 'long passing Go suite (exit 0): byte-identical output');
  assert(condense(PY_COLLECT_RAW, 2) === condense(PY_COLLECT_RAW, 2, RT_CONDENSE_PREVIOUS),
    'short pytest collection error (fits the tail): byte-identical, nothing hidden');

  // ERE-safe against a real `grep -E` (the shim uses grep, not the JS engine).
  const grepHit = (ere, line) => { try { execFileSync('grep', ['-qaE', ere], { input: line + '\n' }); return true; } catch { return false; } };
  assert(!/\(\?[:=!]/.test(FIRST_ERROR_ERE), 'FIRST_ERROR_ERE is ERE-safe (no non-capturing groups)');
  for (const line of ['x.go:1:2: undefined: Foo', "E   ModuleNotFoundError: No module named 'a'", 'SyntaxError: invalid syntax',
    'ImportError: cannot import name x', 'error[E0425]: cannot find value `x`', 'panic: runtime error: index out of range',
    'Error: Cannot find module \'./x\'', 'src/a.c:1:2: error: unknown type', '[ERROR] COMPILATION ERROR :', 'FAIL\tpkg [build failed]']) {
    assert(grepHit(FIRST_ERROR_ERE, line) && new RegExp(FIRST_ERROR_ERE).test(line), `grep -E and JS agree: ${line}`);
  }
}

// ---- 3. end-to-end through runTestsWithLevers (footer + dedup) -----------------------
console.log('== runTestsWithLevers: footer status / trustworthy / dedup text ==');
{
  const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  let n = 0;
  const run = ({ current, currentExit, baseline = PY_PASS_RAW, baselineExit = 0, dedup = true }) => {
    const dir = path.join(work, `repo${++n}`);
    execFileSync('mkdir', ['-p', dir]);
    git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 'b@e.invalid'); git(dir, 'config', 'user.name', 'b');
    writeFileSync(path.join(dir, 'a.txt'), 'base\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'b');
    writeFileSync(path.join(dir, 'a.txt'), 'edited\n');
    const dedupLog = dedup ? startDedupSession(path.join(work, `dedup${n}.jsonl`), { test: true }) : null;
    const cfg = { rundir: dir, workdir: '/repo', testScript: 'pytest -q', image: 'img', dockerBin: 'docker',
      rtAuthority: true, rtDedup: dedup, dedupLog, _isAgentFormat: true };
    const suite = (_c, diff) => diff === '' ? { out: baseline, exitCode: baselineExit } : { out: current, exitCode: currentExit };
    const first = runTestsWithLevers(cfg, { argv: [], runSuiteFn: suite });
    const second = runTestsWithLevers(cfg, { argv: [], runSuiteFn: suite });
    return { first, second };
  };
  const foot = t => t.split('\n').slice(-3);

  // Go compile failure — both the old capture (no excerpt) and the new condenser output.
  for (const [label, current] of [['old capture', condense(GO_COMPILE_RAW, 2, RT_CONDENSE_PREVIOUS)], ['new condenser', condense(GO_COMPILE_RAW, 2)]]) {
    const { first, second } = run({ current, currentExit: 2, baseline: condense(GO_CLEAN_RAW, 0), baselineExit: 0 });
    assert(foot(first)[0] === '[run_tests verdict] status=ERROR scope=full exit=2', `Go compile (${label}): status=ERROR`, foot(first)[0]);
    assert(/verdict=ERROR .* trustworthy=no /.test(foot(first)[1]), `Go compile (${label}): trustworthy=no`, foot(first)[1]);
    assert(first.includes('[run_tests] BUILD/COLLECTION ERROR: exit 2'), `Go compile (${label}): error note above the footer`);
    assert(second.includes(DEDUP_MARKER) && second.includes('BUILD/COLLECTION ERROR') && !second.includes('suite green'),
      `Go compile (${label}): dedup repeat says BUILD/COLLECTION ERROR, never "suite green"`, second.split('\n')[0]);
    if (label === 'new condenser') {
      assert(first.split('\n').slice(-15).join('\n').includes('undefined: util.PoisonOID'),
        'Go compile: `run_tests | tail -15` now shows the compiler line');
      assert(second.includes('first error: lints/lint_ct_sct_policy_count_unsatisfied.go:37:63: undefined: util.PoisonOID'),
        'Go compile: dedup repeat cites the first compiler error');
    }
  }

  const py = run({ current: PY_COLLECT_RAW, currentExit: 2 });
  assert(foot(py.first)[0] === '[run_tests verdict] status=ERROR scope=full exit=2' && /trustworthy=no/.test(foot(py.first)[1]),
    'pytest collection error: status=ERROR, trustworthy=no', foot(py.first).join(' / '));
  assert(!py.second.includes('suite green') && py.second.includes('BUILD/COLLECTION ERROR'), 'pytest collection error: dedup never says suite green');

  const fail = run({ current: PY_FAIL_RAW, currentExit: 1 });
  assert(foot(fail.first)[0] === '[run_tests verdict] status=FAIL scope=full exit=1', 'normal failing test: status=FAIL (unchanged)');
  assert(/verdict=FAIL introduced_failures=1 pre_existing_failures=0 trustworthy=yes /.test(foot(fail.first)[1]),
    'normal failing test: introduced=1, trustworthy=yes (unchanged)', foot(fail.first)[1]);
  assert(!fail.first.includes('BUILD/COLLECTION ERROR'), 'normal failing test: no build-error note');
  assert(/1 failed, first failure: .*test_size/.test(fail.second), 'normal failing test: dedup names the failure (unchanged)');

  const pass = run({ current: PY_PASS_RAW, currentExit: 0 });
  assert(foot(pass.first)[0] === '[run_tests verdict] status=PASS scope=full exit=0' && /verdict=PASS .*trustworthy=yes/.test(foot(pass.first)[1]),
    'normal pass: status=PASS, trustworthy=yes (unchanged)');
  assert(pass.second.includes('exit 0, 0 failed (suite green)'), 'normal pass: dedup still says suite green');

  const jest = run({ current: JEST_UNPARSED_RAW, currentExit: 1 });
  assert(foot(jest.first)[0] === '[run_tests verdict] status=FAIL scope=full exit=1' && /trustworthy=no/.test(foot(jest.first)[1]),
    'jest unparsed failure: status=FAIL but trustworthy=no (an empty introduced set proves nothing)', foot(jest.first).join(' / '));
  assert(!jest.second.includes('suite green') && jest.second.includes('NOT green'), 'jest unparsed failure: dedup never says suite green');

  // Classifier directly: INFRA keeps precedence over ERROR.
  const infra = classifySuiteResult({ out: 'x', exitCode: 124 }, { sigs: new Set(), infra: false }, null);
  assert(infra.status === 'INFRA', 'timeout (124) stays INFRA, not ERROR');
}

// ---- 4. dedup text + footer + telemetry ------------------------------------------
console.log('== dedup summary, footer, verdictOf, rows telemetry ==');
{
  const r = summarizeRunTestsResult('noise\n', { exitCode: 2 });
  assert(!buildDedupSummary({ citeCall: 1, result: r }).includes('suite green'),
    'defensive: exit≠0 with 0 failures never renders "suite green" even without a status');
  const footer = buildRunTestsFooter({ status: 'ERROR', verdict: 'ERROR', exitCode: 2, baselineDiff: { introduced: [], preExisting: [] }, trustworthy: false });
  assert(footer.startsWith('[run_tests verdict] status=ERROR scope=full exit=2'), 'footer renders status=ERROR (not normalized to INFRA)');
  const v = verdictOf('out\n' + footer);
  assert(v?.status === 'ERROR' && v.trustworthy === false, 'verdictOf parses status=ERROR');
  const t = runTestsTelemetry([{ kind: 'test', resultText: footer }, { kind: 'test', resultText: 'x\n' + buildRunTestsFooter({ status: 'PASS', exitCode: 0, baselineDiff: { introduced: [], preExisting: [] }, trustworthy: true }) }]);
  assert(t.rtVerdicts === 2 && t.rtError === 1 && t.rtInfra === 0 && t.rtTrustworthy === 1, 'rows telemetry counts rtError separately from rtInfra', JSON.stringify(t));
  assert(renderBuildErrorNote({ exitCode: 2, firstErrors: ['a.go:1:2: undefined: X'] }).includes('NOT green'), 'note says NOT green');
}

rmSync(work, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
