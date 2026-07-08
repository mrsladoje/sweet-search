// Part-3 baseline-diff DRY RUN in a REAL container (no API spend, docker only).
// Proves the L2 baseline-diff labels correctly in BOTH directions on a live suite:
//   (1) clean checkout, no edit   → every failure is PRE-EXISTING, ZERO new
//   (2) deliberately-broken edit  → the introduced failure is NEW, never pre-existing
//                                    (the ONE kill condition — constraint #2)
// Usage on the box:
//   node tests/baseline-dryrun.mjs <goldenDir> <image> <workdir> '<testScript>'
import { execSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runTestsWithLevers, getBaseline } from '../harness/rt-shim-runtime.mjs';

const [golden, image, workdir, testScript] = process.argv.slice(2);
const DOCKER_HOST = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock';
const realDocker = execSync('command -v docker', { encoding: 'utf8' }).trim();
let ok = true;
const assert = (c, name) => { console.log((c ? '  ✓ ' : '  ✗ ') + name); if (!c) ok = false; };

// isolated run dir (cp the golden so its .git is present for `git diff HEAD`)
const rundir = mkdtempSync(path.join(tmpdir(), 'bdry-')) + '/r';
execFileSync('cp', ['-a', golden, rundir]);
rmSync(path.join(rundir, '.sweet-search'), { recursive: true, force: true });
const binDir = path.join(rundir, '.codex-bin');
execFileSync('mkdir', ['-p', binDir]);

const cfg = {
  image, workdir, testScript, rundir, dockerHost: DOCKER_HOST,
  testTimeoutSec: 600, netArgs: '--network none ', dockerBin: realDocker, binDir, rtAuthority: true,
};

console.log(`\n== baseline (clean checkout) ==`);
const base = getBaseline(cfg);
console.log(`  baseline ok=${base.ok} failures=${base.sigs.size}`);
for (const s of [...base.sigs].slice(0, 8)) console.log(`    · ${s.slice(0, 100)}`);

console.log(`\n== direction 1: clean current (no edit) → all pre-existing, 0 new ==`);
{
  const out = runTestsWithLevers(cfg, {});
  const bd = (out.split('\n').find(l => l.includes('baseline-diff')) || '');
  console.log('  ' + (bd || '(no baseline-diff line — green suite)'));
  assert(!/NEW failure/.test(bd), 'clean current: ZERO new failures labeled (no false-new)');
}

console.log(`\n== direction 2: introduce a NEW failing test that COMPILES → labeled NEW, pre-existing preserved ==`);
{
  // A fresh integration test (cargo auto-discovers tests/*.rs, no mod hook). It COMPILES
  // and RUNS alongside the pre-existing failures, so we see the realistic regression
  // case: baseline failures still present + exactly one genuinely-new failure. The new
  // one must be labeled NEW, never pre-existing (constraint #2, the kill condition).
  const testsDir = path.join(rundir, 'tests');
  execFileSync('mkdir', ['-p', testsDir]);
  writeFileSync(path.join(testsDir, '__bench_regression.rs'),
    '#[test]\nfn __bench_injected_regression() { assert_eq!(2 + 2, 5, "injected regression sentinel"); }\n');
  // git-add so `git diff HEAD` (which excludes UNtracked files) includes it, matching
  // how a tracked-file edit reaches run_tests.
  execFileSync('git', ['-C', rundir, 'add', '-A']);
  console.log('  injected + git-added: tests/__bench_regression.rs (a compiling, failing #[test])');
  const out = runTestsWithLevers(cfg, {});
  const bd = (out.split('\n').find(l => l.includes('baseline-diff')) || '');
  console.log('  ' + (bd.slice(0, 400)));
  const preCount = +(bd.match(/(\d+) PRE-EXISTING/) || [0, 0])[1];
  const newCount = +(bd.match(/(\d+) NEW/) || [0, 0])[1];
  const sentinelIsNew = /injected regression|__bench_injected_regression/.test(bd.split('PRE-EXISTING')[0]);
  assert(newCount >= 1 && sentinelIsNew, 'the injected regression is labeled NEW');
  assert(!/injected regression|__bench_injected_regression/.test((bd.split('PRE-EXISTING')[1] || '')), 'the injected regression is NOT in the pre-existing list (KILL CONDITION)');
  // True invariant: baseline-diff NEVER invents pre-existing labels beyond the baseline
  // set. (cargo default fail-fast can suppress the lib-test failures in a run whose
  // integration test fails, so pre-existing may legitimately show FEWER than baseline —
  // that is a cargo run-order property, not a mislabel.)
  assert(preCount <= base.sigs.size, 'pre-existing count never exceeds the baseline set (no invented pre-existing labels)');
  console.log(`  (baseline=${base.sigs.size}, now pre-existing=${preCount}, new=${newCount})`);
}

rmSync(path.dirname(rundir), { recursive: true, force: true });
console.log(ok ? '\nDRYRUN PASS' : '\nDRYRUN FAIL');
process.exit(ok ? 0 : 1);
