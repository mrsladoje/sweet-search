// Offline tests for two run_tests parsing defects found in the Codex phase-4 audit (2026-09-29).
// Standalone (no test runner): `node tests/rt-runner-shapes.mjs` — exit 1 on any failure.
//
// 1. JEST NAMES (ember-cli__eslint-plugin-ember-551, hc-codex-20260929-1523/1557): "Tests: 4
//    failed" with `● rules setup is correct › should mention all rules in the README` gave
//    verdict=FAIL introduced_failures=0 trustworthy=no — the baseline diff could not name the
//    failure. `●` headers and `✕` lines are now per-test signatures; `● Console` blocks are not.
// 2. USAGE ERRORS (mwouts__jupytext-360, hc-codex-20260929-1618-L3): `run_tests -k pipe` gave
//    "1 NEW failure(s) introduced by your edits: pytest: error: argument -k: expected one
//    argument"; `run_tests tests/test_black.py` ran `pytest -k 'tests/test_black.py'` (0
//    selected). The shim mangled both arguments. A runner usage error or empty selection is
//    status=ERROR with a "command/arguments were wrong" note, never a failure signature.
// Zero docker / API spend: fixtures are the real output shapes; the in-container condenser
// runs under local bash.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  extractFailureSignatures, diffFailureSets, classifyNoTestResult, extractNoResultMarkers,
  applyTestPattern, testPatternFromArgv, renderNoTestResultNote,
} from '../harness/rt-condense-lib.mjs';
import { RT_CONDENSE, runTestsWithLevers, classifySuiteResult } from '../harness/rt-shim-runtime.mjs';

let ok = true;
const assert = (c, name, extra = '') => {
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + String(extra).slice(0, 400)));
  if (!c) ok = false;
};
const work = mkdtempSync(path.join(tmpdir(), 'rt-runner-shapes-'));
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n');

// ---- fixtures (real shapes) ------------------------------------------------------
const JEST_PASS = [
  'PASS tests/lib/rules/no-observers.js', '  no-observers', '    valid',
  '      ✓ export default Controller.extend(); (58ms)',
  'Test Suites: 62 passed, 62 total', 'Tests:       1358 passed, 1358 total', 'Ran all test suites.',
].join('\n') + '\n';
// ember A1 L2: the header of the failing test is the only per-test name in the capture.
const JEST_FAIL = [
  'FAIL tests/rule-setup.js',
  '  rules setup is correct',
  '    ✓ should have a list of rules (5 ms)',
  '    ✕ should mention all rules in the README (7 ms)',
  '',
  '  ● Console',
  '',
  '    console.error',
  '      Error: rule list mismatch (logged, not a failure)',
  '',
  '    console.log',
  '      FAILED to find doc for no-classic-components',
  '',
  '  ● rules setup is correct › should mention all rules in the README',
  '',
  '    assert(received)',
  '',
  '      at tests/rule-setup.js:44:43',
  '',
  'Test Suites: 1 failed, 61 passed, 62 total',
  'Tests:       1 failed, 1357 passed, 1358 total',
  'Ran all test suites.',
].join('\n') + '\n';

// pytest usage errors and empty selections, exactly as the agent received them.
const PY_USAGE = ['ERROR: usage: pytest [options] [file_or_dir] [file_or_dir] [...]',
  'pytest: error: argument -k: expected one argument', ''].join('\n');
const PY_UNRECOGNIZED = ['ERROR: usage: pytest [options] [file_or_dir] [file_or_dir] [...]',
  'pytest: error: unrecognized arguments: --frobnicate', '  inifile: None', ''].join('\n');
const PY_NOT_FOUND = 'ERROR: file or directory not found: tests/test_nope.py\n\n';
const PY_DESELECTED = ['============================= test session starts ==============================',
  'collected 452 items / 452 deselected / 0 selected', '',
  '=========================== 452 deselected in 2.29s ============================', ''].join('\n');
const PY_PASS = ['collected 452 items', 'tests/test_cli.py ....', '===== 440 passed, 12 skipped in 30.1s =====', ''].join('\n');
const PY_TARGETED_PASS = ['collected 452 items / 448 deselected / 4 selected',
  '================= 1 passed, 3 skipped, 448 deselected in 2.47s =================', ''].join('\n');
const JEST_NONE = 'No tests found, exiting with code 1\nRun with `--passWithNoTests` to exit with code 0\n';
const GO_NONE = '?   \tgithub.com/x/y/cmd\t[no test files]\nok  \tgithub.com/x/y/lib\t0.01s [no tests to run]\n';
const GO_GREEN = '?   \tgithub.com/x/y/cmd\t[no test files]\nok  \tgithub.com/x/y/lib\t0.41s\n';
// A CLI project whose failing test prints the tool's own argparse usage text: still a FAIL.
const CLI_TEST_FAIL = ['tests/test_cli.py::test_bad_flag FAILED',
  'usage: jupytext [-h] [--to TO] notebooks',
  'jupytext: error: unrecognized arguments: --frobnicate',
  '===== 1 failed, 451 passed in 31.0s =====', ''].join('\n');

// ---- 1. jest names --------------------------------------------------------------
console.log('== jest: ● headers and ✕ lines are per-test signatures ==');
{
  const cur = extractFailureSignatures(JEST_FAIL);
  const sigs = [...cur.sigs];
  assert(sigs.includes('rules setup is correct › should mention all rules in the README'),
    'the ● header is a signature (describe › test)', JSON.stringify(sigs));
  assert(!sigs.includes('should mention all rules in the README'),
    'the ✕ line of the same test is folded into its header (one failure, one name)', JSON.stringify(sigs));
  assert(!sigs.some(s => /Console/.test(s)), '`● Console` is not a signature', JSON.stringify(sigs));
  assert(!sigs.some(s => /logged, not a failure|FAILED to find doc/.test(s)),
    'lines inside a `● Console` block are not signatures', JSON.stringify(sigs));
  assert(sigs.includes('tests/rule-setup.js'), 'the file-level `FAIL <path>` line still parses (unchanged)');

  const lone = extractFailureSignatures('  rules\n    ✕ should have a list of rules (12 ms)\nTests: 1 failed, 3 passed, 4 total\n');
  assert(lone.sigs.has('should have a list of rules'), 'a `✕` line with no header still counts, duration stripped', JSON.stringify([...lone.sigs]));

  const warn = extractFailureSignatures('  ● Validation Warning:\n\n  Unknown option "foo"\n  ● Deprecation Warning:\n' + JEST_PASS);
  assert(warn.sigs.size === 0, 'jest config warnings on a green run give no signatures', JSON.stringify([...warn.sigs]));
  assert(extractFailureSignatures(JEST_PASS).sigs.size === 0, 'green jest run: no signatures');

  const d = diffFailureSets(extractFailureSignatures(JEST_PASS), cur);
  assert(d.introduced.includes('rules setup is correct › should mention all rules in the README') && d.preExisting.length === 0,
    'baseline diff labels the ember failure NEW', JSON.stringify(d));
  const pre = diffFailureSets(cur, extractFailureSignatures(JEST_FAIL));
  assert(pre.introduced.length === 0 && pre.preExisting.length === cur.sigs.size, 'the same failure on the baseline is PRE-EXISTING');

  // The in-container condenser promotes the header even when it sits in the elided middle.
  const d0 = path.join(work, 'jc');
  execFileSync('mkdir', ['-p', d0]);
  const long = JEST_FAIL.replace('Test Suites:', rep(80, i => `      ✓ passing test ${i} (1 ms)`) + '\nTest Suites:');
  writeFileSync(d0 + '/out', long); writeFileSync(d0 + '/exit', '1');
  const c = execFileSync('bash', ['-c', RT_CONDENSE.replaceAll('/tmp/__rt_out', d0 + '/out').replaceAll('/tmp/__rt_exit', d0 + '/exit')], { encoding: 'utf8' });
  const promoted = c.slice(0, c.indexOf('--- output tail ---'));
  assert(promoted.includes('● rules setup is correct › should mention all rules in the README') && promoted.includes('✕ should mention'),
    'in-container grep promotes the ● header and ✕ line out of the elided middle', promoted);
  assert(!promoted.includes('● Console'), 'in-container grep does not promote `● Console`', promoted);

  const cls = classifySuiteResult({ out: JEST_FAIL, exitCode: 1 }, cur, d);
  assert(cls.status === 'FAIL' && cls.trustworthy === true, 'ember shape: status=FAIL, trustworthy=yes (was no)', JSON.stringify(cls));
}

// ---- 2. usage errors / empty selections ------------------------------------------
console.log('== usage errors and empty selections are ERROR, never a NEW failure ==');
{
  for (const [label, text, exit, kind] of [
    ['pytest -k with no value', PY_USAGE, 4, 'usage'],
    ['pytest unrecognized arguments', PY_UNRECOGNIZED, 4, 'usage'],
    ['pytest file or directory not found', PY_NOT_FOUND, 4, 'usage'],
    ['pytest 0 selected', PY_DESELECTED, 5, 'no-tests'],
    ['jest No tests found', JEST_NONE, 1, 'no-tests'],
    ['go: every package without a test run', GO_NONE, 0, 'no-tests'],
  ]) {
    const sig = extractFailureSignatures(text);
    const r = classifyNoTestResult({ text, exitCode: exit, baselineMarkers: extractNoResultMarkers(PY_PASS) });
    assert(r.kind === kind, `${label}: kind=${kind}`, JSON.stringify(r));
    assert(sig.sigs.size === 0, `${label}: no failure signature`, JSON.stringify([...sig.sigs]));
    const cls = classifySuiteResult({ out: text, exitCode: exit }, sig, diffFailureSets({ ok: true, sigs: new Set() }, sig),
      { noResultMarkers: new Set(), markers: new Set() });
    assert(cls.status === 'ERROR' && cls.verdict === 'ERROR' && cls.trustworthy === false && cls.noResult?.kind === kind,
      `${label}: status=ERROR, trustworthy=no`, JSON.stringify(cls));
  }
  assert(classifyNoTestResult({ text: PY_PASS, exitCode: 0 }).kind === null, 'a normal pytest pass is not a usage error');
  assert(classifyNoTestResult({ text: PY_TARGETED_PASS, exitCode: 0 }).kind === null, 'a targeted run that selected tests is fine');
  assert(classifyNoTestResult({ text: CLI_TEST_FAIL, exitCode: 1 }).kind === null,
    'a failing CLI test that prints its own usage text stays a test failure (a summary shows tests ran)');
  assert(classifyNoTestResult({ text: GO_GREEN, exitCode: 0 }).kind === null, 'green Go module with a test-less package is not "no tests"');
  // Pre-existing: the clean full suite already prints the marker → never ERROR.
  const goBase = extractNoResultMarkers('?   \tgithub.com/x/y/cmd\t[no test files]\n');
  assert(classifyNoTestResult({ text: '?   \tgithub.com/x/y/cmd\t[no test files]\n', exitCode: 0, baselineMarkers: goBase }).kind === null,
    'a no-test marker already on the clean baseline stays pre-existing');
  assert(classifyNoTestResult({ text: PY_USAGE, exitCode: 0 }).kind === null, 'a usage line with exit 0 is not a usage error');
  // zmap__zlint-299 (real capture): a compile failure plus "no tests to run" for the package
  // that did build. The build error is the cause, so the build note wins.
  const zlint = ['# github.com/zmap/zlint/lints',
    'lints/lint_ct_sct_policy_count_unsatisfied.go:35:40: c.IsPrecertificate undefined (type *x509.Certificate has no field or method IsPrecertificate)',
    'FAIL\tgithub.com/zmap/zlint [build failed]', 'FAIL\tgithub.com/zmap/zlint/lints [build failed]',
    'testing: warning: no tests to run', 'PASS', 'ok  \tgithub.com/zmap/zlint/util\t0.137s [no tests to run]', ''].join('\n');
  const zc = classifySuiteResult({ out: zlint, exitCode: 2 }, extractFailureSignatures(zlint), null,
    { markers: new Set(), noResultMarkers: new Set() });
  assert(zc.status === 'ERROR' && zc.noResult === null, 'a NEW build marker outranks "no tests to run" (build note, not usage note)', JSON.stringify(zc));
  const note = renderNoTestResultNote({ kind: 'usage', line: 'pytest: error: argument -k: expected one argument', exitCode: 4 });
  assert(/command\/arguments were wrong/.test(note) && /NOT caused by your edits/.test(note) && !note.includes('\n'),
    'the note says the command/arguments were wrong, on one line');
}

// ---- 3. argv → pattern: the shim no longer mangles the agent's arguments ------------
console.log('== argv → pattern → runner command ==');
{
  assert(testPatternFromArgv(['-k', 'pipe']).pattern === 'pipe', '`-k pipe` targets `pipe`, not `-k`');
  assert(testPatternFromArgv(['--grep=foo bar']).pattern === 'foo bar', '`--grep=foo bar` targets `foo bar`');
  assert(testPatternFromArgv(['test_x']).pattern === 'test_x', 'a bare pattern is unchanged');
  const opt = testPatternFromArgv(['-x']);
  assert(opt.pattern === '' && opt.ignored === '-x', 'another runner option is dropped, not passed as a pattern');
  assert(testPatternFromArgv([]).pattern === '', 'no argv → full suite');

  const pyFile = applyTestPattern('pytest -rA tests', 'tests/test_black.py');
  assert(pyFile.applied && pyFile.cmd === "pytest -rA tests -k 'test_black'", 'pytest file path → -k <module stem>', pyFile.cmd);
  const pyNode = applyTestPattern('pytest -rA tests', 'tests/test_cli.py::test_set_kernel');
  assert(pyNode.applied && pyNode.cmd.endsWith("-k 'test_set_kernel'"), 'pytest node id → -k <test name>', pyNode.cmd);
  const jestFile = applyTestPattern('npx jest --ci', 'tests/rule-setup.js');
  assert(jestFile.applied && jestFile.cmd === "npx jest --ci 'tests/rule-setup.js'", 'jest file path → positional test-path pattern', jestFile.cmd);
  const goFile = applyTestPattern('go test ./...', 'lints/foo_test.go');
  assert(!goFile.applied && goFile.cmd === 'go test ./...', 'go file path → full suite (-run would select nothing and exit 0)');
  assert(applyTestPattern('pytest -rA tests', 'pipe').cmd === "pytest -rA tests -k 'pipe'", 'a name pattern is unchanged');

  // End to end through runTestsWithLevers: which command reached the suite, and what the agent saw.
  const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const dir = path.join(work, 'repo');
  execFileSync('mkdir', ['-p', dir]);
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 'b@e.invalid'); git(dir, 'config', 'user.name', 'b');
  writeFileSync(path.join(dir, 'a.txt'), 'base\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'b');
  writeFileSync(path.join(dir, 'a.txt'), 'edited\n');
  const cmds = [];
  const suite = (_c, diff, cmd) => {
    if (diff === '') return { out: PY_PASS, exitCode: 0 };
    cmds.push(cmd);
    if (/-k '-k'/.test(cmd)) return { out: PY_USAGE, exitCode: 4 };
    if (/-k 'tests\/test_black.py'/.test(cmd)) return { out: PY_DESELECTED, exitCode: 5 };
    if (/--frobnicate/.test(cmd)) return { out: PY_UNRECOGNIZED, exitCode: 4 };
    return { out: PY_TARGETED_PASS, exitCode: 0 };
  };
  const cfg = { rundir: dir, workdir: '/repo', testScript: 'pytest -rA tests', image: 'img', dockerBin: 'docker',
    rtAuthority: true, rtDedup: false, _isAgentFormat: true };
  const foot = t => t.split('\n').slice(-3);
  const k = runTestsWithLevers(cfg, { argv: ['-k', 'pipe'], runSuiteFn: suite });
  assert(cmds.at(-1) === "pytest -rA tests -k 'pipe'" && foot(k)[0] === '[run_tests verdict] status=PASS scope=targeted exit=0',
    '`run_tests -k pipe` runs `-k pipe` and passes', `${cmds.at(-1)} / ${foot(k)[0]}`);
  const f = runTestsWithLevers(cfg, { argv: ['tests/test_black.py'], runSuiteFn: suite });
  assert(cmds.at(-1) === "pytest -rA tests -k 'test_black'" && foot(f)[0].includes('status=PASS scope=targeted'),
    '`run_tests tests/test_black.py` selects the module\'s tests', `${cmds.at(-1)} / ${foot(f)[0]}`);

  // A usage error that does reach the runner (simulated): ERROR + note, no NEW failure.
  const usageSuite = (_c, diff) => diff === '' ? { out: PY_PASS, exitCode: 0 } : { out: PY_USAGE, exitCode: 4 };
  const u = runTestsWithLevers(cfg, { argv: [], runSuiteFn: usageSuite });
  assert(foot(u)[0] === '[run_tests verdict] status=ERROR scope=full exit=4', 'usage error: status=ERROR', foot(u)[0]);
  assert(/introduced_failures=0 .*trustworthy=no/.test(foot(u)[1]), 'usage error: introduced_failures=0, trustworthy=no', foot(u)[1]);
  assert(!u.includes('NEW failure'), 'usage error: never "NEW failure(s) introduced by your edits"');
  assert(u.includes('[run_tests] NO TEST RAN: exit 4') && !u.includes('BUILD/COLLECTION ERROR'),
    'usage error: the note says the command was wrong, not a build error');
  const dsSuite = (_c, diff) => diff === '' ? { out: PY_PASS, exitCode: 0 } : { out: PY_DESELECTED, exitCode: 5 };
  const ds = runTestsWithLevers(cfg, { argv: ['nomatch'], runSuiteFn: dsSuite });
  assert(foot(ds)[0] === '[run_tests verdict] status=ERROR scope=targeted exit=5' && ds.includes('the command selected no test'),
    'empty selection: status=ERROR with the no-test note', foot(ds)[0]);
  const opt2 = runTestsWithLevers(cfg, { argv: ['--frobnicate'], runSuiteFn: suite });
  assert(cmds.at(-1) === 'pytest -rA tests' && opt2.includes("option '--frobnicate' ignored"),
    'an unknown option is not passed to the runner; the full suite runs with a note', cmds.at(-1));
}

rmSync(work, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
