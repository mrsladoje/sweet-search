// Docker-free integration tests for the generated L1 wrapper + H2 tamper detection.
// Exercises the ACTUAL artifacts installCommandWrappers/writeRunTestsShim generate,
// against a FAKE docker binary (no daemon, no API spend). `node tests/rt-integration.mjs`.
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  installCommandWrappers, writeRunTestsShim, verifyShimIntegrity,
} from '../harness/codex-task-runner.mjs';

let ok = true;
const assert = (c, name) => { console.log((c ? '  ✓ ' : '  ✗ ') + name); if (!c) ok = false; };
const work = mkdtempSync(path.join(tmpdir(), 'rt-int-'));

// A fake `docker`: `run` prints a 40 KB-ish log with buried FAILED lines + exits 3;
// `inspect` prints small JSON + exits 0.
const fakeDocker = path.join(work, 'fake-docker');
writeFileSync(fakeDocker, `#!/usr/bin/env bash
if [ "$1" = "run" ]; then
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

console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
