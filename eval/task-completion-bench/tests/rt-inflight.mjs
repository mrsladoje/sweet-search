// D-6 regression: the run_tests verdict must be TERMINAL.
//
// The defect this locks down: a yielded `run_tests` cell returned EMPTY output to the model,
// which read it as "tests completed successfully" (14 codex task-arm cells across 8 tasks).
// Two properties are asserted against the ACTUAL generated shim, not a mock:
//   1. stdout is non-empty and says "no verdict yet" BEFORE the suite finishes;
//   2. a second call made while the first is in flight ATTACHES to it — it returns the same
//      verdict and does not start a second suite.
// `node tests/rt-inflight.mjs`
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeRunTestsShim } from '../harness/codex-task-runner.mjs';
import {
  RUNNING_BANNER, ATTACH_NOTE, findInflight, markInflight, clearInflight,
  publishVerdict, readVerdict, hasVerdict, newRunId, inflightInlineSource,
  verdictOf, runTestsTelemetry,
} from '../harness/rt-inflight.mjs';
import { buildRunTestsFooter } from '../harness/rt-condense-lib.mjs';

let ok = true;
const assert = (c, name) => { console.log((c ? '  ✓ ' : '  ✗ ') + name); if (!c) ok = false; };
const work = mkdtempSync(path.join(tmpdir(), 'rt-inflight-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- unit: the in-flight registry ----------
console.log('in-flight registry');
{
  const ipc = path.join(work, 'ipc-unit');
  assert(findInflight(ipc, 60000) === null, 'no in-flight run in an empty directory');
  const id = newRunId();
  markInflight(ipc, id, ['--pattern']);
  assert(findInflight(ipc, 60000) === id, 'a fresh marker is found');
  publishVerdict(ipc, id, 'x\n[run_tests verdict] status=PASS scope=full exit=0\n');
  assert(findInflight(ipc, 60000) === null, 'a run whose verdict landed is no longer in flight');
  assert(hasVerdict(readVerdict(ipc, id)), 'the published verdict carries the machine verdict line');
  clearInflight(ipc, id);
  const stale = newRunId();
  markInflight(ipc, stale);
  // `now` is supplied so the assertion tests the ttl rule, not the filesystem clock.
  assert(findInflight(ipc, 1000, { now: Date.now() + 10_000 }) === null,
    'a marker older than the ttl is swept, never attached to');
  assert(!existsSync(path.join(ipc, `inflight-${stale}`)), 'the stale marker is removed, not just ignored');
  assert(!hasVerdict('[run_tests] RUNNING — the suite has been launched'), 'a running banner is not a verdict');
}

// ---------- integration: the real generated direct shim ----------
console.log('\ngenerated shim — banner before the suite finishes');
{
  const rundir = path.join(work, 'repo');
  execFileSync('git', ['init', '-q', rundir], { stdio: 'ignore' });
  writeFileSync(path.join(rundir, 'a.txt'), 'hello\n');
  execFileSync('git', ['-C', rundir, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', rundir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { stdio: 'ignore' });

  // A fake docker whose `run` sleeps, so the shim is still working when we look at stdout.
  const fakeDocker = path.join(work, 'slow-docker');
  const runLog = path.join(work, 'run-count.log');
  writeFileSync(fakeDocker, `#!/usr/bin/env bash
if [ "$1" = "run" ]; then echo run >> ${JSON.stringify(runLog)}; sleep 4; echo "1 passed"; exit 0; fi
exit 0
`);
  chmodSync(fakeDocker, 0o755);

  const binDir = path.join(work, 'bin');
  const out = writeRunTestsShim(binDir, {
    image: 'img', workdir: '/w', testScript: 'pytest', rundir,
    testTimeoutSec: 20, dockerBin: fakeDocker, rtAuthority: false, rtDedup: false,
    label: 'd6-test',
  });
  assert(out.files.some(f => f.endsWith('rt-inflight.mjs')), 'rt-inflight.mjs is covered by shim integrity');

  const first = spawn(path.join(binDir, 'run_tests'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
  let firstOut = '';
  first.stdout.on('data', d => { firstOut += d; });
  await sleep(1500);                                   // the suite is still running here

  assert(firstOut.length > 0, 'stdout is NOT empty while the suite is still running');
  assert(firstOut.startsWith(RUNNING_BANNER), 'the running banner is the first thing written');
  assert(!hasVerdict(firstOut), 'no verdict line exists yet — the in-flight text cannot be read as a result');
  assert(/NOT a result/.test(firstOut), 'the in-flight text says in the tool output that it is not a result');

  // second call, made while the first is still in flight — must attach, not relaunch
  const second = execFileSync(path.join(binDir, 'run_tests'), [], { encoding: 'utf8', timeout: 60000 });
  assert(second.includes(ATTACH_NOTE), 'a concurrent call attaches to the run already in flight');
  assert(hasVerdict(second), 'the attaching call returns the verdict of the run it attached to');

  const firstText = await new Promise(res => { first.on('close', () => res(firstOut)); });
  assert(hasVerdict(firstText), 'the original call still receives its own complete verdict');

  const runs = existsSync(runLog) ? readFileSync(runLog, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  assert(runs === 1, `exactly ONE suite ran for two overlapping calls (saw ${runs})`);
}

// ---------- integration: a later call, after the verdict landed, runs again ----------
console.log('\ngenerated shim — a call after the verdict is a fresh run, not a stale replay');
{
  const ipcDirs = readdirSync(path.join(work, 'bin')).length;
  assert(ipcDirs > 0, 'shim artifacts were generated');
  const binDir = path.join(work, 'bin');
  const third = execFileSync(path.join(binDir, 'run_tests'), [], { encoding: 'utf8', timeout: 60000 });
  assert(!third.includes(ATTACH_NOTE), 'nothing is in flight, so the call does not attach');
  assert(hasVerdict(third), 'the fresh run produces its own verdict');
}

// ---------- THE BROKER REQUESTER: the variant that actually runs in production ----------
//
// This section exists because its absence let a silent, total breakage ship. `setupRunner`
// passes `brokerMode: ISOLATION_ON`, so under the production policy the shim the agent calls
// is the REQUESTER, and every test above exercises only the DIRECT variant. D2's first
// deployment gave the requester an absolute-path import of a harness module; the jail masks
// the whole of <repo>/eval, so every run_tests call on every harness died with
// ERR_MODULE_NOT_FOUND and the agents simply never received a verdict. Preflight was green
// throughout — it never executes the shim.
console.log('\nbroker requester — imports nothing the jail can hide');
{
  const binDir = path.join(work, 'bin-broker');
  const rundir = path.join(work, 'repo');
  // Its own fake docker and run log, so the suite count below is independent of the
  // direct-shim block above.
  const fakeDocker = path.join(work, 'slow-docker-broker');
  const runLog = path.join(work, 'run-count-broker.log');
  writeFileSync(fakeDocker, `#!/usr/bin/env bash
if [ "$1" = "run" ]; then echo run >> ${JSON.stringify(runLog)}; sleep 4; echo "1 passed"; exit 0; fi
exit 0
`);
  chmodSync(fakeDocker, 0o755);
  const out = writeRunTestsShim(binDir, {
    image: 'img', workdir: '/w', testScript: 'pytest', rundir, brokerMode: true,
    testTimeoutSec: 20, dockerBin: fakeDocker, rtAuthority: false, rtDedup: false,
    label: 'd6-broker', stateDir: binDir,
  });
  const src = readFileSync(path.join(binDir, '_run_tests.mjs'), 'utf8');
  const specifiers = [...src.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map(m => m[1]);
  const nonBuiltin = specifiers.filter(x => !x.startsWith('node:'));
  // THE regression. Anything but a node: builtin here is ENOENT inside the jail.
  assert(nonBuiltin.length === 0,
    `the requester imports only node: builtins (found ${JSON.stringify(nonBuiltin)})`);
  assert(specifiers.length > 0, 'the requester still declares its node: imports');
  assert(src.includes('RUNNING_BANNER') && src.includes('findInflight'),
    'the in-flight protocol is present in the requester — inlined, not imported');
  assert(!/\bexport\s/.test(src), 'the inlined source carries no export keyword');

  // And it must actually run — against the REAL host-side broker, spawned the way
  // setupRunner spawns it. A stand-in inside this process cannot work: execFileSync below
  // blocks the event loop, so an in-process broker's timers would never fire.
  const broker = spawn(process.execPath, [out.brokerPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  let brokerErr = '';
  broker.stderr.on('data', d => { brokerErr += d; });

  const first = spawn(path.join(binDir, 'run_tests'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
  let firstOut = '', firstErr = '';
  first.stdout.on('data', d => { firstOut += d; });
  first.stderr.on('data', d => { firstErr += d; });
  await sleep(1500);                                   // the suite is still running here
  assert(firstErr === '', `the requester starts cleanly under node (stderr: ${firstErr.slice(0, 200)})`);
  assert(firstOut.startsWith(RUNNING_BANNER), 'the requester writes the running banner before anything else');
  assert(!hasVerdict(firstOut), 'the yielded requester output cannot be read as a result');

  const second = execFileSync(path.join(binDir, 'run_tests'), [], { encoding: 'utf8', timeout: 90000 });
  assert(second.includes(ATTACH_NOTE), 'a concurrent requester call attaches to the in-flight request');
  assert(hasVerdict(second), 'the attaching requester call returns the verdict');

  const firstText = await new Promise(res => { first.on('close', () => res(firstOut)); });
  assert(hasVerdict(firstText), 'the original requester call receives its own verdict');
  assert(brokerErr === '', `the broker itself ran clean (stderr: ${brokerErr.slice(0, 200)})`);
  const runs = existsSync(runLog) ? readFileSync(runLog, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  assert(runs === 1, `exactly ONE suite ran for two overlapping requester calls (saw ${runs})`);
  try { broker.kill('SIGKILL'); } catch { /* already gone */ }
}


// ---------------------------------------------------------------------------
// F5 / slate C §4.2 — rtTrustworthy and rtInfra row counters.
//
// The four D-6 columns count whether a verdict ARRIVED and never what it said, so a rollout
// in which every verdict was untrustworthy looked exactly like one in which every verdict
// passed. accenture__sfmc-devtools-1974 ran 104 run_tests calls across 44 rollouts without a
// single trustworthy answer and rows.json could not show it.
console.log('\n== F5: verdict-status row counters ==');
{
  // Real footers from the real builder, so a change to the footer format breaks this test
  // rather than silently zeroing the counters in production.
  const foot = (status, trustworthy) => buildRunTestsFooter({
    status, scope: 'full', exitCode: status === 'PASS' ? 0 : 1,
    baselineDiff: { introduced: [], preExisting: [] }, trustworthy,
  });

  assert(verdictOf(`suite output\n${foot('PASS', true)}`)?.trustworthy === true, 'verdictOf reads trustworthy=yes');
  assert(verdictOf(`suite output\n${foot('FAIL', false)}`)?.trustworthy === false, 'verdictOf reads trustworthy=no');
  assert(verdictOf(`x\n${foot('INFRA', false)}`)?.status === 'INFRA', 'verdictOf reads status=INFRA');
  assert(verdictOf('launched, still running') === null, 'a result with no footer has no verdict');

  // A PASS can be untrustworthy: no clean baseline was captured, so the diff is unusable.
  // Collapsing those two into one counter is exactly the blindness being fixed.
  const untrustedPass = buildRunTestsFooter({ status: 'PASS', baselineDiff: null, trustworthy: true });
  assert(verdictOf(untrustedPass)?.status === 'PASS' && verdictOf(untrustedPass)?.trustworthy === false,
    'a PASS with no baseline is counted as NOT trustworthy');

  // The accenture shape: every verdict present, every one INFRA, none trustworthy. This is
  // the rollout that used to be indistinguishable from an all-PASS one.
  const allUntrusted = runTestsTelemetry(
    Array.from({ length: 4 }, () => ({ kind: 'test', resultText: `mocha output\n${foot('INFRA', false)}` })));
  assert(allUntrusted.rtLaunched === 4 && allUntrusted.rtVerdicts === 4, 'all-untrusted rollout: 4 launches, 4 verdicts');
  assert(allUntrusted.rtTrustworthy === 0 && allUntrusted.rtInfra === 4, 'all-untrusted rollout: rtTrustworthy=0, rtInfra=N');
  const allGreen = runTestsTelemetry(
    Array.from({ length: 4 }, () => ({ kind: 'test', resultText: `ok\n${foot('PASS', true)}` })));
  assert(allGreen.rtTrustworthy === 4 && allGreen.rtInfra === 0, 'all-PASS rollout: rtTrustworthy=N, rtInfra=0');
  assert(allUntrusted.rtVerdicts === allGreen.rtVerdicts && allUntrusted.rtTrustworthy !== allGreen.rtTrustworthy,
    'the two rollouts are identical on the OLD columns and separated by the new ones');

  // Appendix B trap 3: opencode and claude-code transcripts store each tool result twice, and
  // a call that attaches to an in-flight run replays that run's verdict before its own. Both
  // produce two footers in ONE result. Counting per call, taking the LAST footer, keeps these
  // columns summing to rtLaunched instead of to a transcript-duplication artefact.
  const doubled = `${foot('INFRA', false)}\n--- repeated tool result ---\n${foot('INFRA', false)}`;
  const dup = runTestsTelemetry([{ kind: 'test', resultText: doubled }]);
  assert(dup.rtLaunched === 1 && dup.rtVerdicts === 1 && dup.rtInfra === 1,
    'a duplicated tool result counts ONE verdict, not two', JSON.stringify(dup));
  // Attach case: the replayed verdict comes first, this call's own verdict last.
  const attached = `${ATTACH_NOTE}${foot('INFRA', false)}\n${foot('PASS', true)}`;
  const att = runTestsTelemetry([{ kind: 'test', resultText: attached }]);
  assert(att.rtVerdicts === 1 && att.rtTrustworthy === 1 && att.rtInfra === 0,
    'when a result holds two footers the LAST (terminal) one is the verdict', JSON.stringify(att));

  // Non-test calls never contribute, and a rollout that never tested reports zeros.
  const mixed = runTestsTelemetry([
    { kind: 'read', resultText: foot('PASS', true) },
    { kind: 'test', resultText: foot('FAIL', true) },
  ]);
  assert(mixed.rtLaunched === 1 && mixed.rtTrustworthy === 1, 'only kind=test calls are counted');
  const none = runTestsTelemetry([]);
  assert(none.rtLaunched === 0 && none.rtTrustworthy === 0 && none.rtInfra === 0 && none.rtEndedUnverified === false,
    'a rollout that never ran the tests reports zeros, not a false untrusted flag');

  // The counters live host-side; the shim must not grow by them.
  assert(!inflightInlineSource().includes('function verdictOf'), 'verdictOf stays OUT of the generated shim');
}

console.log(ok ? '\nD-6: all assertions passed' : '\nD-6: FAILURES');
process.exit(ok ? 0 : 1);
