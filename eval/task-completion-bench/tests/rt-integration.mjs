// Docker-free integration tests for the generated L1 wrapper + H2 tamper detection.
// Exercises the ACTUAL artifacts installCommandWrappers/writeRunTestsShim generate,
// against a FAKE docker binary (no daemon, no API spend). `node tests/rt-integration.mjs`.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  installCommandWrappers, writeRunTestsShim, verifyRunnerDirectoryIntegrity, verifyShimIntegrity,
} from '../harness/codex-task-runner.mjs';
import { getBaseline, resolveDiffIdentifierWarning, runTestsWithLevers } from '../harness/rt-shim-runtime.mjs';
import { DEDUP_MARKER, startDedupSession } from '../harness/rt-dedup.mjs';

let ok = true;
const assert = (c, name) => { console.log((c ? '  ✓ ' : '  ✗ ') + name); if (!c) ok = false; };
const work = mkdtempSync(path.join(tmpdir(), 'rt-int-'));

// A fake `docker`: `run` prints a 40 KB-ish log with buried FAILED lines + exits 3;
// `inspect` prints small JSON + exits 0.
const fakeDocker = path.join(work, 'fake-docker');
const dockerCount = path.join(work, 'docker-count.log');
writeFileSync(fakeDocker, `#!/usr/bin/env bash
if [ "$1" = "run" ]; then
  echo run >> ${JSON.stringify(dockerCount)}
  for i in $(seq 1 600); do echo "Testing block_cipher_aes ... ok"; done
  echo "Test x509_cert ... FAILED: found certificate was nullopt"
  echo "Test tls_handshake ... FAILED: expected 42 but got 0"
  for i in $(seq 1 600); do echo "Testing hash_sha256 ... ok"; done
  echo "2 tests failed"
  exit 3
elif [ "$1" = "inspect" ]; then
  echo '{"Id":"deadbeef","State":"running"}'
  exit 0
fi
exit 0
`);
chmodSync(fakeDocker, 0o755);

console.log('== L1 docker wrapper: condenses `run`, preserves failures + exit code ==');
{
  const binDir = path.join(work, 'bin1');
  installCommandWrappers(binDir, { realDocker: fakeDocker });
  const wrap = path.join(binDir, 'docker');
  let out = '', code = 0;
  try { out = execFileSync(wrap, ['run', 'someimage', 'bash', '-c', 'test'], { encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || ''); code = e.status; }
  assert(code === 3, 'exit code 3 preserved through the wrapper');
  assert(/found certificate was nullopt/.test(out), 'buried FAILED line #1 survives condensation (H1 fixture)');
  assert(/expected 42 but got 0/.test(out), 'buried FAILED line #2 survives');
  assert(/2 tests failed/.test(out), 'summary line survives (tail)');
  assert(/condensed by harness/.test(out), 'elision marker present');
  assert(Buffer.byteLength(out) < 8000, 'output condensed well under raw ~30KB');
}

console.log('== L1 docker wrapper: passthrough for query subcommand (inspect) ==');
{
  const binDir = path.join(work, 'bin2');
  installCommandWrappers(binDir, { realDocker: fakeDocker });
  const wrap = path.join(binDir, 'docker');
  const out = execFileSync(wrap, ['inspect', 'x'], { encoding: 'utf8' });
  assert(/"Id":"deadbeef"/.test(out), 'inspect JSON passed through verbatim');
  assert(!/condensed by harness/.test(out), 'query subcommand NOT condensed (no pipeline corruption)');
}

console.log('== H2 tamper detection: still trips on a mutated shim file ==');
{
  const binDir = path.join(work, 'bin3');
  const info = writeRunTestsShim(binDir, {
    image: 'img', workdir: '/w', testScript: 'true', rundir: work,
    testTimeoutSec: 10, netArgs: '--network none ', dockerBin: fakeDocker, rtAuthority: true,
  });
  assert(Array.isArray(info.integrity) && info.integrity.length >= 3, 'integrity snapshot captured shim files');
  assert(verifyShimIntegrity(info.integrity).length === 0, 'no tamper on a pristine shim');
  // Mutate the cfg (the exact glam-rs r2 attack surface: strip --network none)
  const cfgPath = path.join(binDir, '_run_tests_cfg.json');
  appendFileSync(cfgPath, '\n// tampered');
  const trip = verifyShimIntegrity(info.integrity);
  assert(trip.includes('_run_tests_cfg.json'), 'tamper on cfg is DETECTED (shimTampered trips)');
}

console.log('== P3 runner state: out-of-tree broker + in-memory baseline ==');
{
  const taskDir = path.join(work, 'task-tree');
  const stateDir = path.join(work, 'runner-state');
  const binDir = path.join(stateDir, 'bin');
  mkdirSync(taskDir, { recursive: true });
  const info = writeRunTestsShim(binDir, {
    image: 'img', workdir: '/w', testScript: 'true', rundir: taskDir,
    testTimeoutSec: 10, netArgs: '--network none ', brokerMode: true,
    dockerBin: fakeDocker, rtAuthority: true, stateDir, _isAgentFormat: true,
  });
  assert(!binDir.startsWith(taskDir + path.sep), 'runner artifacts live outside the agent task tree');
  const cfg = JSON.parse(readFileSync(path.join(binDir, '_run_tests_cfg.json'), 'utf8'));
  assert(!Object.values(cfg).some(value => /_rt_baseline\.json/.test(String(value))), 'no baseline cache path is exposed in runner config');

  let cleanRuns = 0;
  const baselineCfg = { testScript: 'suite' };
  const runCleanSuite = () => {
    cleanRuns++;
    return { out: 'MigratesAClient ... FAILED\n1 tests failed' };
  };
  const first = getBaseline(baselineCfg, { runCleanSuite });
  // Recreate the exact forged-cache shape beside the shim. It is neither read nor
  // trusted; the broker-owned baseline remains the one computed above.
  writeFileSync(path.join(binDir, '_rt_baseline.json'), JSON.stringify({ ok: true, sigs: ['Build FAILED.'] }));
  const second = getBaseline(baselineCfg, { runCleanSuite });
  assert(cleanRuns === 1, 'one broker config computes the clean baseline exactly once');
  assert([...first.sigs].some(sig => sig.includes('MigratesAClient')) && [...second.sigs].every(sig => !sig.includes('Build FAILED')), 'forged disk cache cannot alter the in-memory baseline');
  const extras = verifyRunnerDirectoryIntegrity({ binDir, expectedFiles: info.files, stateDir });
  assert(extras.includes('_rt_baseline.json (unexpected)'), 'injected legacy baseline file feeds tamper detection');
  writeFileSync(path.join(stateDir, '_rt_cache.json'), '{}');
  const stateExtras = verifyRunnerDirectoryIntegrity({ binDir, expectedFiles: info.files, stateDir });
  assert(stateExtras.includes('_rt_cache.json (unexpected runner state)'), 'injected runner-root state feeds tamper detection');

  // Exercise the generated host broker itself. First invocation runs current+clean
  // (2 docker calls); the second reuses the in-memory clean baseline (1 call).
  const before = readFileSync(dockerCount, 'utf8').trim().split('\n').filter(Boolean).length;
  const broker = spawn('node', [info.brokerPath], { stdio: 'ignore' });
  try {
    execFileSync(path.join(binDir, 'run_tests'), { encoding: 'utf8', timeout: 20_000 });
    execFileSync(path.join(binDir, 'run_tests'), { encoding: 'utf8', timeout: 20_000 });
  } finally {
    broker.kill('SIGKILL');
  }
  const after = readFileSync(dockerCount, 'utf8').trim().split('\n').filter(Boolean).length;
  assert(after - before === 3, 'persistent broker reuses one in-memory baseline across run_tests calls');
}

console.log('== Phase 0a run_tests footer: full status/scope/dedup/fallback fixture matrix ==');
{
  const taskDir = path.join(work, 'footer-task');
  mkdirSync(taskDir, { recursive: true });
  execFileSync('git', ['-C', taskDir, 'init', '-q']);
  execFileSync('git', ['-C', taskDir, 'config', 'user.email', 'bench@example.invalid']);
  execFileSync('git', ['-C', taskDir, 'config', 'user.name', 'bench']);
  writeFileSync(path.join(taskDir, 'example.ts'), 'export const value = 1;\n');
  execFileSync('git', ['-C', taskDir, 'add', '-A']);
  execFileSync('git', ['-C', taskDir, 'commit', '-q', '-m', 'base']);
  writeFileSync(path.join(taskDir, 'example.ts'), [
    'import { RemoteThing as LocalAlias } from "pkg";',
    'const locallyDeclared = Promise.resolve(new AbortSignal());',
    '// MissingInComment', 'const text = "MissingInString";',
    'export const value = LocalAlias.build(locallyDeclared, style.BrightWhite, text);',
  ].join('\n') + '\n');

  const PASS = Array.from({ length: 40 }, (_, i) => `test_${i} PASSED`).join('\n') + '\n40 passed';
  const OLD = 'FAILED tests/test_old.py::test_known - AssertionError: existing\n1 failed';
  const NEW = 'FAILED tests/test_new.py::test_regression - AssertionError: introduced\n1 failed';
  const BOTH = OLD.split('\n')[0] + '\n' + NEW.split('\n')[0] + '\n2 failed';
  const INFRA = '[run_tests exit=70]\nCannot connect to the Docker daemon';
  let fixtureId = 0;
  const makeFixture = ({
    currentOut = PASS, currentExit = 0, baselineOut = PASS, baselineExit = 0,
    testScript = 'pytest -q', rtAuthority = true, rtDedup = false, experimentalWarning = false,
  } = {}) => {
    const dedupLog = rtDedup
      ? startDedupSession(path.join(work, `footer-dedup-${++fixtureId}.jsonl`), { test: true })
      : null;
    const cfg = {
      rundir: taskDir, workdir: '/repo', testScript, image: 'img', dockerBin: 'docker',
      rtAuthority, rtDedup, dedupLog, _isAgentFormat: true,
      rtUnresolvedIdentifierWarning: experimentalWarning,
    };
    const calls = [];
    const runner = (_cfg, diff, cmd) => {
      calls.push({ clean: diff === '', cmd });
      return diff === ''
        ? { out: baselineOut, exitCode: baselineExit }
        : { out: currentOut, exitCode: currentExit };
    };
    return { cfg, calls, run: argv => runTestsWithLevers(cfg, { argv, runSuiteFn: runner }) };
  };
  const finalLines = output => output.split('\n').slice(-3);
  const assertFooter = (output, { status, scope = 'full', exit, verdict, introduced = 0, pre = 0, trust }) => {
    const lines = finalLines(output);
    assert(lines[0] === `[run_tests verdict] status=${status} scope=${scope} exit=${exit}`,
      `${status}/${scope} verdict line agrees with raw exit`);
    assert(lines[1].startsWith(`[run_tests baseline-diff] verdict=${verdict} introduced_failures=${introduced} pre_existing_failures=${pre} trustworthy=${trust} `),
      `${status}/${scope} baseline classification is encoded in the footer`);
    assert(lines[2] === `[run_tests guidance] verdict=${verdict} action=none`,
      `${status}/${scope} guidance is the final line`);
  };

  const pass = makeFixture(); const passOut = pass.run([]);
  const fail = makeFixture({ currentOut: NEW, currentExit: 1, rtAuthority: false }); const failOut = fail.run([]);
  const baselineOnly = makeFixture({ currentOut: OLD, currentExit: 1, baselineOut: OLD, baselineExit: 1 });
  const baselineOnlyOut = baselineOnly.run([]);
  const introduced = makeFixture({ currentOut: BOTH, currentExit: 1, baselineOut: OLD, baselineExit: 1 });
  const introducedOut = introduced.run([]);
  const infra = makeFixture({ currentOut: INFRA, currentExit: 70 }); const infraOut = infra.run([]);
  const targeted = makeFixture(); const targetedOut = targeted.run(['test_widget']);
  const fallback = makeFixture({ testScript: 'pytest -q 2>&1 | tail -50' }); const fallbackOut = fallback.run(['test_widget']);
  const dedup = makeFixture({ rtDedup: true }); const dedupFirst = dedup.run([]); const dedupOut = dedup.run([]);

  assertFooter(passOut, { status: 'PASS', exit: 0, verdict: 'PASS', trust: 'yes' });
  assertFooter(failOut, { status: 'FAIL', exit: 1, verdict: 'FAIL', trust: 'no' });
  assertFooter(baselineOnlyOut, { status: 'FAIL', exit: 1, verdict: 'PASS', pre: 1, trust: 'yes' });
  assertFooter(introducedOut, { status: 'FAIL', exit: 1, verdict: 'FAIL', introduced: 1, pre: 1, trust: 'yes' });
  assertFooter(infraOut, { status: 'INFRA', exit: 70, verdict: 'INFRA', trust: 'no' });
  assertFooter(targetedOut, { status: 'PASS', scope: 'targeted', exit: 0, verdict: 'PASS', trust: 'yes' });
  assertFooter(fallbackOut, { status: 'PASS', exit: 0, verdict: 'PASS', trust: 'yes' });
  assertFooter(dedupOut, { status: 'PASS', exit: 0, verdict: 'PASS', trust: 'yes' });

  const outputs = [passOut, failOut, baselineOnlyOut, introducedOut, infraOut, targetedOut, fallbackOut, dedupFirst, dedupOut];
  assert(outputs.every(out => finalLines(out).length === 3 && finalLines(out)[2].startsWith('[run_tests guidance]')),
    'PASS, FAIL, baseline-only, introduced, INFRA, targeted, fallback, and dedup all end in the footer');
  assert(finalLines(passOut).join('\n') === passOut.split('\n').slice(-3).join('\n'),
    'run_tests | tail -n 3 retains the complete footer');
  assert(passOut.split('\n').slice(-30).join('\n').endsWith(finalLines(passOut).join('\n')),
    'run_tests | tail -n 30 retains the complete footer');
  const rgTail = introducedOut.split('\n').filter(line => /PASS|FAIL/.test(line)).slice(-3);
  assert(rgTail.join('\n') === finalLines(introducedOut).join('\n'),
    'common PASS/FAIL rg + tail filtering retains verdict and baseline counts');
  assert(passOut.includes(PASS) && failOut.includes(NEW) && introducedOut.includes(BOTH),
    'non-deduplicated responses preserve the existing raw/condenser output verbatim');
  assert(targeted.calls[0].cmd.includes("-k 'test_widget'") && fallback.calls[0].cmd === 'pytest -q 2>&1 | tail -50',
    'targeted scope and full-suite fallback reflect the command that actually ran');
  assert(fallbackOut.includes('targeted pattern') && fallbackOut.indexOf('targeted pattern') < fallbackOut.lastIndexOf('[run_tests verdict]'),
    'targeted fallback diagnostic renders above the footer');
  assert(dedupOut.includes(DEDUP_MARKER) && !dedupOut.includes(PASS),
    'dedup response stays compact while retaining the footer');
  assert(passOut.startsWith('[run_tests] Authoritative test result') && !passOut.includes('[run_tests diff-check]'),
    'default-disabled identifier diagnostics neither query nor displace authority or verdict');

  const indexDir = path.join(taskDir, '.sweet-search');
  mkdirSync(indexDir, { recursive: true });
  const db = new Database(path.join(indexDir, 'code-graph.db'));
  db.exec(`CREATE TABLE entities (
    id TEXT PRIMARY KEY, name TEXT, type TEXT, file_path TEXT,
    start_line INTEGER, end_line INTEGER, parent_class TEXT, stale_since INTEGER
  )`);
  db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)')
    .run('style', 'style', 'package', 'style/style.go', 1, 1);
  db.close();
  const warned = makeFixture({ experimentalWarning: true }).run([]);
  assert(warned.startsWith('[run_tests] Authoritative test result') && warned.includes('[run_tests diff-check] WARNING:'),
    'an explicitly enabled experimental warning never displaces authority');
  assert(finalLines(warned)[2] === '[run_tests guidance] verdict=PASS action=none',
    'an optional warning renders above, never after, the final guidance line');

  // Exercise the real shell capture path, not just the injected runner fixtures.
  // This fake docker executes the final container script locally and therefore pins
  // the hidden exit sentinel that survives the unchanged in-container condenser.
  const shellDocker = path.join(work, 'shell-docker');
  const fakeTimeout = path.join(work, 'timeout');
  writeFileSync(fakeTimeout, '#!/usr/bin/env bash\nshift\nexec "$@"\n');
  writeFileSync(shellDocker, '#!/usr/bin/env bash\nbin_dir="${0%/*}"\nexport PATH="$bin_dir:$PATH"\nlast="${@: -1}"\nexec bash -c "$last"\n');
  chmodSync(fakeTimeout, 0o755);
  chmodSync(shellDocker, 0o755);
  const shellDir = path.join(work, 'shell-exit-task');
  mkdirSync(shellDir, { recursive: true });
  execFileSync('git', ['-C', shellDir, 'init', '-q']);
  execFileSync('git', ['-C', shellDir, 'config', 'user.email', 'bench@example.invalid']);
  execFileSync('git', ['-C', shellDir, 'config', 'user.name', 'bench']);
  writeFileSync(path.join(shellDir, 'x.txt'), 'base\n');
  execFileSync('git', ['-C', shellDir, 'add', '-A']);
  execFileSync('git', ['-C', shellDir, 'commit', '-q', '-m', 'base']);
  const capturedExit = runTestsWithLevers({
    rundir: shellDir, workdir: shellDir,
    testScript: 'printf "FAILED test_real_exit - AssertionError\\n"; exit 7',
    image: 'ignored', dockerBin: shellDocker, rtAuthority: false, rtDedup: false,
  });
  assert(finalLines(capturedExit)[0] === '[run_tests verdict] status=FAIL scope=full exit=7',
    'real shell/condenser path preserves the canonical test command exit code');
  assert(capturedExit.includes('FAILED test_real_exit - AssertionError'),
    'real shell/condenser path preserves raw failure evidence before the footer');
}

console.log('== P3 diff warning gate: non-agent traffic is byte-stable and query-free ==');
{
  const diff = 'diff --git a/x.go b/x.go\n+++ b/x.go\n+return style.BrightWhite';
  let calls = 0;
  const off = resolveDiffIdentifierWarning({ _isAgentFormat: false }, diff, {
    resolveNames: () => { calls++; return []; },
  });
  assert(off === '' && calls === 0, 'non-agent gate returns no trailer and never queries the index');
  const defaultAgentOff = resolveDiffIdentifierWarning({ _isAgentFormat: true }, diff, {
    resolveNames: () => { calls++; return []; },
  });
  assert(defaultAgentOff === '' && calls === 0, 'agent-format warning is also query-free unless the explicit experimental flag is true');

  const makeIndex = (name, includeMember) => {
    const rundir = path.join(work, name);
    const indexDir = path.join(rundir, '.sweet-search');
    mkdirSync(indexDir, { recursive: true });
    const db = new Database(path.join(indexDir, 'code-graph.db'));
    db.exec(`CREATE TABLE entities (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, file_path TEXT,
      start_line INTEGER, end_line INTEGER, parent_class TEXT, stale_since INTEGER
    )`);
    const insert = db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)');
    insert.run('style', 'style', 'package', 'style/style.go', 1, 1);
    if (includeMember) insert.run('bright', 'BrightWhite', 'const', 'style/style.go', 2, 2);
    db.close();
    return rundir;
  };
  const missing = resolveDiffIdentifierWarning({
    _isAgentFormat: true, rtUnresolvedIdentifierWarning: true,
    rundir: makeIndex('missing-index', false),
  }, diff);
  assert(/style\.BrightWhite/.test(missing), 'real symbol index emits warning when the referenced const is absent');
  const present = resolveDiffIdentifierWarning({
    _isAgentFormat: true, rtUnresolvedIdentifierWarning: true,
    rundir: makeIndex('present-index', true),
  }, diff);
  assert(present === '', 'real symbol index suppresses warning when the referenced const exists');
}

console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
