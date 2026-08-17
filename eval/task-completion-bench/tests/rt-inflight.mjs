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
  publishVerdict, readVerdict, hasVerdict, newRunId,
} from '../harness/rt-inflight.mjs';

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

console.log(ok ? '\nD-6: all assertions passed' : '\nD-6: FAILURES');
process.exit(ok ? 0 : 1);
