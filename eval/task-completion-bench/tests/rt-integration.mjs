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
import { getBaseline, resolveDiffIdentifierWarning } from '../harness/rt-shim-runtime.mjs';

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

console.log('== P3 diff warning gate: non-agent traffic is byte-stable and query-free ==');
{
  const diff = 'diff --git a/x.go b/x.go\n+++ b/x.go\n+return style.BrightWhite';
  let calls = 0;
  const off = resolveDiffIdentifierWarning({ _isAgentFormat: false }, diff, {
    resolveNames: () => { calls++; return []; },
  });
  assert(off === '' && calls === 0, 'non-agent gate returns no trailer and never queries the index');

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
  const missing = resolveDiffIdentifierWarning({ _isAgentFormat: true, rundir: makeIndex('missing-index', false) }, diff);
  assert(/style\.BrightWhite/.test(missing), 'real symbol index emits warning when the referenced const is absent');
  const present = resolveDiffIdentifierWarning({ _isAgentFormat: true, rundir: makeIndex('present-index', true) }, diff);
  assert(present === '', 'real symbol index suppresses warning when the referenced const exists');
}

console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
