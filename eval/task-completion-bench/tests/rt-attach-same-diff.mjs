// RT_ATTACH_REQUIRE_SAME_DIFF=1 — a run_tests call attaches to an in-flight launch only when
// that launch was made on the SAME working tree.
//
// The defect: a baseline launched before an edit and attached to after it returned the
// pre-edit numbers as "Authoritative test result for your CURRENT edits". Asserted against the
// ACTUAL generated shims (direct and broker requester + the real broker) with a fake docker
// that records which patch each suite received. Also pins the switch-OFF shim text to the
// pre-switch template byte for byte. `node tests/rt-attach-same-diff.mjs`
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeRunTestsShim } from '../harness/codex-task-runner.mjs';
import { brokerRequesterSource, directShimSource } from '../harness/rt-shim-text.mjs';
import {
  ATTACH_NOTE, STALE_INFLIGHT_NOTE, RUNNING_BANNER, hasVerdict, newRunId, markInflight, publishVerdict,
  inflightInlineSource, sameDiffAttachInlineSource, attachRequireSameDiffFromEnv,
  workingTreeKey, markInflightKeyed, findInflightForKey, inflightPending,
} from '../harness/rt-inflight.mjs';

let ok = true;
const assert = (c, name) => { console.log((c ? '  ✓ ' : '  ✗ ') + name); if (!c) ok = false; };
const work = mkdtempSync(path.join(tmpdir(), 'rt-same-diff-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// ---------- switch OFF: the generated shims are the pre-switch text, byte for byte ----------
// Frozen copies of the two templates as they were before the switch existed. If a later change
// needs to alter the default shim, it must change these too — deliberately. (2026-09-29: the
// immediate RUNNING banner became startRunningBanner / stopBanner — see rt-inflight.mjs.)
const LEGACY_BROKER = ({ reqDir, testTimeoutSec }) => `${inflightInlineSource()}
const IPC = ${JSON.stringify(reqDir)};
const tSec = ${Number(testTimeoutSec) || 300};
const waitSec = 2 * tSec + 120;                          // baseline + current suite + overhead
const stopBanner = startRunningBanner(RUNNING_BANNER_DELAY_MS);
const attachId = findInflight(IPC, waitSec * 1000);
const id = attachId || newRunId();
if (attachId) process.stdout.write(ATTACH_NOTE);
else {
  markInflight(IPC, id, process.argv.slice(2));
  writeFileSync(IPC + '/req-' + id, JSON.stringify(process.argv.slice(2)));
}
const deadline = Date.now() + waitSec * 1000;
const res = IPC + '/res-' + id;
while (Date.now() < deadline) {
  if (!attachId && existsSync(res)) {
    const text = readFileSync(res, 'utf8');
    try { rmSync(res, { force: true }); } catch {}
    clearInflight(IPC, id);                              // the broker already published it
    await stopBanner();
    process.stdout.write(text);
    process.exit(0);
  }
  if (attachId) {
    const text = readVerdict(IPC, id);
    if (text != null) { await stopBanner(); process.stdout.write(text); process.exit(0); }
  }
  await new Promise(r => setTimeout(r, 400));
}
if (!attachId) clearInflight(IPC, id);
await stopBanner();
process.stdout.write(NO_VERDICT_NOTE(waitSec));
`;
const LEGACY_DIRECT = ({ cfgPath, runtimePath, ipcDir, testTimeoutSec }) => `${inflightInlineSource()}
import { runTestsWithLevers } from ${JSON.stringify(runtimePath)};
const c = JSON.parse(readFileSync(${JSON.stringify(cfgPath)}, 'utf8'));
const IPC = ${JSON.stringify(ipcDir)};
const waitSec = 2 * (${Number(testTimeoutSec) || 300}) + 120;
const stopBanner = startRunningBanner(RUNNING_BANNER_DELAY_MS, { blocking: true });
const attachId = findInflight(IPC, waitSec * 1000);
if (attachId) {
  process.stdout.write(ATTACH_NOTE);
  const deadline = Date.now() + waitSec * 1000;
  while (Date.now() < deadline) {
    const text = readVerdict(IPC, attachId);
    if (text != null) { await stopBanner(); process.stdout.write(text); process.exit(0); }
    await new Promise(r => setTimeout(r, 400));
  }
  await stopBanner();
  process.stdout.write(NO_VERDICT_NOTE(waitSec));
  process.exit(0);
}
const id = newRunId();
markInflight(IPC, id, process.argv.slice(2));
let out;
try { out = runTestsWithLevers(c, { argv: process.argv.slice(2) }); }
catch (e) { out = '[run_tests error] ' + String(e && e.message || e); }
publishVerdict(IPC, id, out);
clearInflight(IPC, id);
await stopBanner();
process.stdout.write(out);
`;

console.log('switch OFF — shim text byte-identical to the pre-switch template');
{
  assert(attachRequireSameDiffFromEnv({}) === false && attachRequireSameDiffFromEnv({ RT_ATTACH_REQUIRE_SAME_DIFF: '1' }) === true,
    'RT_ATTACH_REQUIRE_SAME_DIFF: only "1" turns it on');
  const b = { reqDir: '/R/_rt_ipc', testTimeoutSec: 45 };
  const d = { cfgPath: '/R/cfg.json', runtimePath: '/R/rt.mjs', ipcDir: '/R/_rt_inflight', testTimeoutSec: 45 };
  assert(brokerRequesterSource(b) === LEGACY_BROKER(b), 'broker requester (switch off) === legacy text');
  assert(directShimSource(d) === LEGACY_DIRECT(d), 'direct shim (switch off) === legacy text');
  assert(!inflightInlineSource().includes('SAME-DIFF') && !inflightInlineSource().includes('workingTreeKey'),
    'the default inlined protocol carries none of the switch-on code');

  const rundir = path.join(work, 'repo-off');
  git(work, ['init', '-q', rundir]);
  const binDir = path.join(work, 'bin-off-broker');
  delete process.env.RT_ATTACH_REQUIRE_SAME_DIFF;
  const out = writeRunTestsShim(binDir, {
    image: 'img', workdir: '/w', testScript: 't', rundir, brokerMode: true, testTimeoutSec: 45,
    rtAuthority: false, rtDedup: false, label: 'off', stateDir: binDir,
  });
  assert(readFileSync(path.join(binDir, '_run_tests.mjs'), 'utf8') === LEGACY_BROKER({ reqDir: out.reqDir, testTimeoutSec: 45 }),
    'writeRunTestsShim with the env unset writes the legacy requester');
}

// ---------- switch ON: shim text shape ----------
console.log('\nswitch ON — the requester still imports only node: builtins');
{
  const src = brokerRequesterSource({ reqDir: '/R/_rt_ipc', testTimeoutSec: 45, sameDiff: { rundir: '/R/repo' } });
  const specifiers = [...src.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert(specifiers.length > 0 && specifiers.every(s => s.startsWith('node:')),
    `only node: imports inside the jail (${JSON.stringify(specifiers)})`);
  assert(!/\bexport\s/.test(src), 'no export keyword in the generated text');
  assert(src.includes(sameDiffAttachInlineSource()) && src.includes('workingTreeKey("/R/repo")'),
    'the attach check is inlined and keyed on the rollout rundir');
  const file = path.join(work, 'on-requester.mjs');
  writeFileSync(file, src);
  let parsed = true;
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'ignore' }); } catch { parsed = false; }
  assert(parsed, 'the switch-on requester parses (no duplicate bindings with the inlined protocol)');
  const dfile = path.join(work, 'on-direct.mjs');
  writeFileSync(dfile, directShimSource({ cfgPath: '/R/c.json', runtimePath: '/R/rt.mjs', ipcDir: '/R/i', testTimeoutSec: 45, sameDiff: { rundir: '/R/repo' } }));
  parsed = true;
  try { execFileSync(process.execPath, ['--check', dfile], { stdio: 'ignore' }); } catch { parsed = false; }
  assert(parsed, 'the switch-on direct shim parses');
}

// ---------- unit: the tree key ----------
console.log('\nworkingTreeKey');
function freshRepo(name) {
  const dir = path.join(work, name);
  mkdirSync(dir, { recursive: true });
  git(work, ['init', '-q', dir]);
  writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  git(dir, ['add', '.']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  return dir;
}
{
  const dir = freshRepo('repo-key');
  const k0 = workingTreeKey(dir);
  assert(typeof k0 === 'string' && k0.length === 64 && workingTreeKey(dir) === k0, 'a stable sha256 for an unchanged tree');
  writeFileSync(path.join(dir, 'a.txt'), 'hello world\n');
  const k1 = workingTreeKey(dir);
  assert(k1 !== k0, 'a tracked edit changes the key');
  writeFileSync(path.join(dir, 'new.js'), 'x\n');
  const k2 = workingTreeKey(dir);
  assert(k2 !== k1, 'creating an untracked file changes the key');
  writeFileSync(path.join(dir, 'new.js'), 'y\n');
  const k3 = workingTreeKey(dir);
  assert(k3 !== k2, 'editing an untracked file changes the key');
  mkdirSync(path.join(dir, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(dir, '.sweet-search', 'idx'), 'i\n');
  writeFileSync(path.join(dir, 'CLAUDE.md'), 'frame\n');
  mkdirSync(path.join(dir, '.claude'), { recursive: true });
  writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{}\n');
  assert(workingTreeKey(dir) === k3, 'index churn and harness files do not change the key');
  assert(workingTreeKey(path.join(work, 'no-such-dir')) === null, 'git failure → null key');
}

// ---------- unit: keyed in-flight lookup ----------
console.log('\nfindInflightForKey');
{
  const ipc = path.join(work, 'ipc-keyed');
  const a = newRunId(); markInflightKeyed(ipc, a, [], 'KEY-A');
  let r = findInflightForKey(ipc, 60000, 'KEY-A');
  assert(r.match === a && r.other === null, 'same key → match');
  r = findInflightForKey(ipc, 60000, 'KEY-B');
  assert(r.match === null && r.other === a, 'different key → no match, the live run is reported as other');
  r = findInflightForKey(ipc, 60000, null);
  assert(r.match === null && r.other === a, 'a null key never matches');
  const u = newRunId(); markInflight(ipc, u, []);         // an unkeyed (pre-switch) marker
  r = findInflightForKey(ipc, 60000, 'KEY-A');
  assert(r.match === a, 'an unkeyed marker never matches, even beside a keyed one');
  assert(inflightPending(ipc, a), 'a run with no verdict is pending');
  publishVerdict(ipc, a, 'x\n[run_tests verdict] status=PASS scope=full exit=0\n');
  assert(!inflightPending(ipc, a) && findInflightForKey(ipc, 60000, 'KEY-A').match === null, 'an answered run is no longer attachable');
  r = findInflightForKey(ipc, 1000, 'KEY-A', { now: Date.now() + 10_000 });
  assert(r.match === null && r.other === null && !existsSync(path.join(ipc, `inflight-${u}`)), 'stale markers are swept, as findInflight sweeps them');
}

// ---------- integration: the real generated shims ----------
// A fake docker whose `run` sleeps and records the patch it was handed, plus start/end
// times, so the test can see WHICH tree each suite tested and whether two ever overlapped.
function fakeDocker(name) {
  const bin = path.join(work, `docker-${name}`);
  const log = path.join(work, `docker-${name}.log`);
  writeFileSync(bin, `#!/usr/bin/env bash
if [ "$1" = "run" ]; then
  pdir=""; prev=""
  for a in "$@"; do if [ "$prev" = "-v" ]; then pdir="\${a%%:*}"; fi; prev="$a"; done
  tag=$(grep -c 'EDITED' "$pdir/agent.diff" 2>/dev/null)
  echo "start $(node -e 'process.stdout.write(String(Date.now()))') edited=$tag" >> ${JSON.stringify(log)}
  sleep 3
  echo "end $(node -e 'process.stdout.write(String(Date.now()))')" >> ${JSON.stringify(log)}
  echo "1 passed"; exit 0
fi
exit 0
`);
  chmodSync(bin, 0o755);
  return { bin, log };
}
function runsOf(log) {
  const lines = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  const starts = lines.filter(l => l.startsWith('start')).map(l => ({ t: Number(l.split(' ')[1]), edited: l.endsWith('edited=1') }));
  const ends = lines.filter(l => l.startsWith('end')).map(l => Number(l.split(' ')[1]));
  return { starts, ends };
}
const collect = child => new Promise(res => { let o = ''; child.stdout.on('data', d => { o += d; }); child.on('close', () => res(o)); });

async function scenario({ label, brokerMode }) {
  console.log(`\n${label}`);
  const rundir = freshRepo(`repo-${brokerMode ? 'broker' : 'direct'}`);
  const binDir = path.join(work, `bin-${brokerMode ? 'broker' : 'direct'}`);
  const { bin, log } = fakeDocker(brokerMode ? 'broker' : 'direct');
  const shim = writeRunTestsShim(binDir, {
    image: 'img', workdir: '/w', testScript: 'pytest', rundir, brokerMode, testTimeoutSec: 20,
    dockerBin: bin, rtAuthority: false, rtDedup: false, label: `same-diff-${label}`,
    stateDir: binDir, attachRequireSameDiff: true,
  });
  const broker = brokerMode ? spawn(process.execPath, [shim.brokerPath], { stdio: 'ignore' }) : null;
  const call = () => spawn(path.join(binDir, 'run_tests'), [], { stdio: ['ignore', 'pipe', 'pipe'] });

  // 1. Same tree while in flight → attach (unchanged wording), ONE suite.
  const p1 = collect(call());
  await sleep(1200);
  const same = await collect(call());
  const first = await p1;
  // It completes inside RUNNING_BANNER_DELAY_MS, so the ATTACH note is its first line (no banner).
  assert(same.startsWith(ATTACH_NOTE) && !same.includes(RUNNING_BANNER) && !same.includes(STALE_INFLIGHT_NOTE),
    'same tree while in flight → attaches, with the unchanged ATTACH note');
  assert(hasVerdict(same) && hasVerdict(first), 'both calls receive a verdict');
  assert(runsOf(log).starts.length === 1, `one suite for two same-tree calls (saw ${runsOf(log).starts.length})`);

  // 2. THE DEFECT: launched before an edit, called again after it.
  const p2 = collect(call());
  await sleep(1200);
  writeFileSync(path.join(rundir, 'a.txt'), 'EDITED\n');
  const after = await collect(call());
  const before = await p2;
  assert(!after.includes(ATTACH_NOTE), 'after an edit the call does NOT attach to the pre-edit launch');
  assert(after.includes(STALE_INFLIGHT_NOTE), 'it says why, in the tool output');
  assert(hasVerdict(after) && hasVerdict(before), 'the fresh call and the stale launch each get their own verdict');
  const { starts, ends } = runsOf(log);
  assert(starts.length === 3, `a fresh suite ran for the post-edit call (suites=${starts.length})`);
  assert(starts[1] && !starts[1].edited && starts[2] && starts[2].edited,
    'the stale suite tested the pre-edit tree and the fresh suite tested the EDITED tree');
  assert(starts[2] && ends[1] && starts[2].t >= ends[1],
    'the fresh suite started only after the stale one ended (no two suites at once)');

  // 3. A later same-tree call with nothing in flight runs normally.
  const later = await collect(call());
  assert(!later.includes(ATTACH_NOTE) && !later.includes(STALE_INFLIGHT_NOTE) && hasVerdict(later),
    'nothing in flight → a plain fresh run');
  if (broker) { try { broker.kill('SIGKILL'); } catch { /* gone */ } }
}

// CONTROL: with the switch OFF the same sequence reproduces the defect, which is what shows
// the scenario above can see it at all.
console.log('\ncontrol — switch OFF reproduces the stale attach');
{
  const rundir = freshRepo('repo-control');
  const binDir = path.join(work, 'bin-control');
  const { bin, log } = fakeDocker('control');
  writeRunTestsShim(binDir, {
    image: 'img', workdir: '/w', testScript: 'pytest', rundir, testTimeoutSec: 20,
    dockerBin: bin, rtAuthority: false, rtDedup: false, label: 'same-diff-control', stateDir: binDir,
  });
  const p = collect(spawn(path.join(binDir, 'run_tests'), [], { stdio: ['ignore', 'pipe', 'pipe'] }));
  await sleep(1200);
  writeFileSync(path.join(rundir, 'a.txt'), 'EDITED\n');
  const after = await collect(spawn(path.join(binDir, 'run_tests'), [], { stdio: ['ignore', 'pipe', 'pipe'] }));
  await p;
  const { starts } = runsOf(log);
  assert(after.includes(ATTACH_NOTE) && starts.length === 1 && !starts[0].edited,
    'OFF: the post-edit call attaches and is handed the PRE-edit suite result (the defect)');
}

await scenario({ label: 'direct shim (unjailed path)', brokerMode: false });
await scenario({ label: 'broker requester + real broker (jailed path)', brokerMode: true });

console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
