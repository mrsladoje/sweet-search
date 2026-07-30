// Unit tests for the L3 frame-side run_tests anti-loop lever (rt-dedup.mjs +
// its wiring in rt-shim-runtime.runTestsWithLevers). PLAN.md §4.4 → §6 lever L3.
// Standalone, offline, ZERO docker/API spend: the suite runner is injected
// (`runSuiteFn`), so the whole decision path is exercised against real git working
// trees but fake suite output. `node tests/rt-dedup.mjs` — exit 1 on any failure.
//
// The criterion that matters most is ZERO FALSE POSITIVES: a suppression may only
// happen when the diff, the untracked non-ignored file set, AND the argv are all
// byte-identical to an earlier call in the same rollout. Every test below that adds,
// edits, or renames a file exists to pin exactly that.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.RUN_ID = `test-rtdedup-${process.pid}`;

const {
  RT_DEDUP_ON, DEDUP_MARKER, FULL_FLAG,
  parseRunTestsArgv, untrackedFingerprint, computeStateKey, summarizeRunTestsResult,
  replayDedupLog, dedupDecision, dedupLogPathFor, startDedupSession, readDedupState,
  markUndeliveredResponses,
} = await import('../harness/rt-dedup.mjs');
const { runTestsWithLevers } = await import('../harness/rt-shim-runtime.mjs');
const { writeRunTestsShim } = await import('../harness/codex-task-runner.mjs');

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS_DIR = path.join(BENCH_DIR, 'results', process.env.RUN_ID);

let ok = true;
const eqArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assert = (c, name, extra = '') => {
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra));
  if (!c) ok = false;
};

// ---- fixtures -----------------------------------------------------------------
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'rt-dedup-repo-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'bench@example.invalid');
  git(dir, 'config', 'user.name', 'bench');
  writeFileSync(path.join(dir, 'src.py'), 'def f():\n    return 1\n');
  writeFileSync(path.join(dir, '.gitignore'), 'build/\n*.log\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

// Realistic transcript shapes: a suite transcript is mostly scroll (this is the mass
// the lever stops re-sending), with the actionable failure lines buried in it.
const scroll = (n, s) => Array.from({ length: n }, (_, i) => `${s} ${i} PASSED`).join('\n');
const CLEAN = ['collected 300 items', scroll(120, 'tests/test_ok.py::test'), '300 passed'].join('\n');
const RED = ['collected 300 items', scroll(60, 'tests/test_ok.py::test'),
  'FAILED tests/test_a.py::test_a - AssertionError: expected 42 but got 0',
  'FAILED tests/test_b.py::test_b - AssertionError: nope',
  scroll(60, 'tests/test_more.py::test'), '2 failed, 298 passed'].join('\n');
const RED_OTHER = ['collected 3 items',
  'FAILED tests/test_c.py::test_c - AssertionError: different failure entirely', '1 failed, 2 passed'].join('\n');
const INFRA = '[run_tests exit=1]\nCould not resolve host: pypi.org\nTemporary failure in name resolution';

// A cfg whose suite output is scripted per-call, and which counts executions so a
// suppressed call can be proven to have STILL RUN THE TESTS.
function makeCfg(rundir, { label = 'acme__widget-1-sweet', rtAuthority = false, rtDedup = true } = {}) {
  const dedupLog = rtDedup
    ? startDedupSession(dedupLogPathFor(label, rundir), { label, rundir, test: true })
    : null;
  return {
    rundir, workdir: '/repo', testScript: 'pytest -q', image: 'img', dockerBin: 'docker',
    rtAuthority, rtDedup: rtDedup && !!dedupLog, dedupLog, _isAgentFormat: false,
    _runs: 0, _out: CLEAN,
  };
}
const suiteStub = (cfg) => { cfg._runs++; return { out: cfg._out }; };
const call = (cfg, argv = []) => runTestsWithLevers(cfg, { argv, runSuiteFn: suiteStub });

// ---------------------------------------------------------------------------
console.log('== argv parsing: the --ss-full escape hatch is stripped, never a pattern ==');
{
  assert(parseRunTestsArgv([]).pattern === '' && parseRunTestsArgv([]).full === false, 'no args → no pattern, no flag');
  const p = parseRunTestsArgv(['test_foo', FULL_FLAG]);
  assert(p.full === true, '--ss-full detected');
  assert(p.pattern === 'test_foo' && p.argv.length === 1, '--ss-full stripped from the runner argv/pattern', JSON.stringify(p));
  assert(parseRunTestsArgv([FULL_FLAG]).pattern === '', 'flag alone → full suite, empty pattern');
  assert(parseRunTestsArgv('test_bar').pattern === 'test_bar', 'legacy single-string argv still works');
  // Pre-lever semantics: only argv[2] ever reached the runner. Extra positional args
  // must NOT start filtering tests differently — but they DO change the state key.
  const multi = parseRunTestsArgv(['test_a', 'test_b']);
  assert(multi.pattern === 'test_a', 'only the first positional arg becomes the test pattern (unchanged behaviour)', multi.pattern);
  assert(computeStateKey({ diff: 'd', untracked: { ok: true, entries: [] }, argv: multi.argv })
    !== computeStateKey({ diff: 'd', untracked: { ok: true, entries: [] }, argv: ['test_a'] }),
  'a second positional arg still changes the state key');
  // The key must not distinguish `run_tests X` from `run_tests X --ss-full`.
  const a = computeStateKey({ diff: 'd', untracked: { ok: true, entries: [] }, argv: parseRunTestsArgv(['X']).argv });
  const b = computeStateKey({ diff: 'd', untracked: { ok: true, entries: [] }, argv: parseRunTestsArgv(['X', FULL_FLAG]).argv });
  assert(a === b, '--ss-full is excluded from the state key');
}

// ---------------------------------------------------------------------------
console.log('== state key: stability, untracked sensitivity, argv sensitivity ==');
{
  const dir = makeRepo();
  const keyFor = (argv = []) => computeStateKey({
    diff: git(dir, 'diff', 'HEAD'), untracked: untrackedFingerprint(dir), argv,
  });

  writeFileSync(path.join(dir, 'src.py'), 'def f():\n    return 2\n');
  const k1 = keyFor();
  assert(typeof k1 === 'string' && k1.length === 64, 'key is a sha256 hex');
  assert(keyFor() === k1, 'key STABLE across calls with an unchanged tree (the dedup precondition)');

  // argv sensitivity: targeted and full runs are different keys.
  assert(keyFor(['test_a']) !== k1, 'different argv → different key (targeted ≠ full run)');
  assert(keyFor(['test_a']) !== keyFor(['test_b']), 'different pattern → different key');

  // The tracked-diff component.
  writeFileSync(path.join(dir, 'src.py'), 'def f():\n    return 3\n');
  const k2 = keyFor();
  assert(k2 !== k1, 'edited tracked file → different key');

  // Untracked NEW file: the case that would produce false positives if omitted.
  writeFileSync(path.join(dir, 'helper.py'), 'X = 1\n');
  const k3 = keyFor();
  assert(k3 !== k2, 'NEW untracked file → different key (agents create files)');
  writeFileSync(path.join(dir, 'helper.py'), 'X = 2\n');
  const k4 = keyFor();
  assert(k4 !== k3, 'edited untracked file CONTENT → different key');
  assert(untrackedFingerprint(dir).entries.some(([p]) => p === 'helper.py'), 'untracked file appears in the fingerprint');
  rmSync(path.join(dir, 'helper.py'));
  assert(keyFor() === k2, 'removing the untracked file restores the earlier key');

  // A file in a NEW untracked directory still counts.
  mkdirSync(path.join(dir, 'pkg'), { recursive: true });
  writeFileSync(path.join(dir, 'pkg/mod.py'), 'Y = 1\n');
  assert(keyFor() !== k2, 'file inside a new untracked directory → different key');
  rmSync(path.join(dir, 'pkg'), { recursive: true, force: true });

  // git-ignored build noise and the sweet index must NOT move the key: they are not
  // the agent's source edit, and letting them in would silently disable the lever.
  mkdirSync(path.join(dir, 'build'), { recursive: true });
  writeFileSync(path.join(dir, 'build/out.o'), 'junk');
  writeFileSync(path.join(dir, 'noise.log'), 'junk');
  mkdirSync(path.join(dir, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(dir, '.sweet-search/code-graph.db'), 'index');
  assert(keyFor() === k2, 'gitignored files + .sweet-search/ do not affect the key');

  // Incomplete information must produce a NULL key (→ caller emits full output).
  const bad = { ok: false, reason: 'untracked set too large (9999 files)', entries: [] };
  assert(computeStateKey({ diff: 'x', untracked: bad, argv: [] }) === null, 'unhashable untracked set → null key (never dedup)');
  writeFileSync(path.join(dir, 'scratch.py'), 'Z = 1\n');
  const capped = untrackedFingerprint(dir, { maxFiles: 0 });
  assert(capped.ok === false && /too large/.test(capped.reason), 'maxFiles cap reports ok:false with a reason', JSON.stringify(capped));
  const bigFile = untrackedFingerprint(dir, { maxBytesPerFile: 1 });
  assert(bigFile.ok === false && /too large/.test(bigFile.reason), 'oversized untracked file → ok:false', JSON.stringify(bigFile));
  rmSync(path.join(dir, 'scratch.py'));
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('== result summary + decision ==');
{
  const red = summarizeRunTestsResult(RED);
  assert(red.failureCount === 2, 'two failures extracted', String(red.failureCount));
  assert(/expected 42 but got 0/.test(red.firstFailure), 'first-failure excerpt carries test name + assertion', red.firstFailure);
  assert(summarizeRunTestsResult(RED).digest === red.digest, 'identical output → identical digest');
  assert(summarizeRunTestsResult(RED + '\n').digest === red.digest, 'trailing-newline noise does not change the digest');
  assert(summarizeRunTestsResult(RED_OTHER).digest !== red.digest, 'different failure set → different digest');
  assert(summarizeRunTestsResult(CLEAN).digest !== red.digest, 'green ≠ red');
  assert(summarizeRunTestsResult(INFRA).infra === true, 'infra error flagged');
  assert(summarizeRunTestsResult(INFRA).exitCode === 1, 'exit marker parsed');

  const state = replayDedupLog([
    JSON.stringify({ kind: 'session' }),
    JSON.stringify({ call: 1, key: 'K', digest: 'D1' }),
    JSON.stringify({ call: 2, key: 'K', digest: 'D1' }),
    JSON.stringify({ call: 3, key: 'K', digest: 'D2' }),
    '{ truncated tai',
  ].join('\n'));
  assert(state.calls === 3, 'replay counts calls, tolerating a torn tail', String(state.calls));
  assert(dedupDecision(state, 'OTHER', 'D1').mode === 'first', 'unseen key → first');
  assert(dedupDecision(state, 'K', 'D1').citeCall === 1, 'repeat cites the call where key+result was FIRST seen');
  assert(dedupDecision(state, 'K', 'D2').citeCall === 3, 'repeat of the later result cites call 3');
  assert(dedupDecision(state, 'K', 'D3').mode === 'changed', 'same key, unseen result → changed');

  // A response the agent never received must not be citable. Observed in the wild:
  // a slow C++ suite outran the agent-side tool timeout, the requester died, and the
  // NEXT identical call was told "identical to call #1" for a transcript that never
  // reached the model.
  const undel = replayDedupLog([
    JSON.stringify({ kind: 'session' }),
    JSON.stringify({ call: 1, key: 'K', digest: 'D1', reqId: 'r1' }),
    JSON.stringify({ kind: 'undelivered', reqIds: ['r1'] }),
  ].join('\n'));
  assert(undel.calls === 1, 'an undelivered call still counts for CALL NUMBERING', String(undel.calls));
  assert(dedupDecision(undel, 'K', 'D1').mode === 'first', 'an undelivered result is not citable → next call is full output');
  const mixed = replayDedupLog([
    JSON.stringify({ kind: 'session' }),
    JSON.stringify({ call: 1, key: 'K', digest: 'D1', reqId: 'r1' }),
    JSON.stringify({ call: 2, key: 'K', digest: 'D1', reqId: 'r2' }),
    JSON.stringify({ kind: 'undelivered', reqIds: ['r1'] }),
  ].join('\n'));
  assert(dedupDecision(mixed, 'K', 'D1').citeCall === 2, 'citation moves to the DELIVERED call', JSON.stringify(dedupDecision(mixed, 'K', 'D1')));
}

// ---------------------------------------------------------------------------
console.log('== undelivered-response detection (broker side) ==');
{
  const ipc = mkdtempSync(path.join(tmpdir(), 'rt-dedup-ipc-'));
  const log = path.join(ipc, 'log.jsonl');
  writeFileSync(path.join(ipc, 'res-abc'), 'stale output');
  writeFileSync(path.join(ipc, 'res-fresh'), 'just written');
  writeFileSync(path.join(ipc, 'req-xyz'), '[]');
  // The clock is injected rather than slept on: `now` in the past-relative sense keeps
  // a just-written response out of the marker, `now` far ahead makes both stale.
  const none = markUndeliveredResponses(log, ipc, { staleMs: 60_000 });
  assert(none.length === 0, 'a just-written response is NOT marked undelivered', JSON.stringify(none));
  const all = markUndeliveredResponses(log, ipc, { staleMs: 5_000, now: Date.now() + 60_000 }).sort();
  assert(eqArr(all, ['abc', 'fresh']), 'stale responses are marked by request id', JSON.stringify(all));
  assert(existsSync(path.join(ipc, 'res-abc')), 'the response file is LEFT IN PLACE (it is the shim-tamper signal)');
  const state = readDedupState(log);
  assert(state.calls === 0, 'markers alone add no calls');
  assert(readFileSync(log, 'utf8').includes('"kind":"undelivered"'), 'marker appended to the dedup log');
  assert(markUndeliveredResponses(log, path.join(ipc, 'nope')).length === 0, 'a missing IPC dir is a no-op');
  assert(markUndeliveredResponses(null, ipc).length === 0, 'no dedup log → no-op');
  rmSync(ipc, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('== end-to-end: condense on repeat, passthrough on change, tests always run ==');
{
  const dir = makeRepo();
  const cfg = makeCfg(dir);
  writeFileSync(path.join(dir, 'src.py'), 'def f():\n    return 2\n');
  cfg._out = RED;

  const c1 = call(cfg);
  assert(c1 === RED, 'call #1 output is BYTE-IDENTICAL to the pre-lever shim output');
  assert(!c1.includes(DEDUP_MARKER), 'call #1 carries no dedup marker');

  const c2 = call(cfg);
  assert(c2.includes(DEDUP_MARKER), 'call #2 (identical diff+argv+result) IS condensed');
  assert(/identical source diff \+ command as call #1; result unchanged: exit 0, 2 failed, first failure: /.test(c2),
    'summary matches the specified format', c2);
  // The escape hatch is UNDOCUMENTED to the agent (K1 decision 2026-07-30): advertising
  // it made the model spend 20 of 84 smoke calls re-requesting a transcript it already
  // had. The flag keeps working; the summary must not mention it.
  assert(!c2.includes(FULL_FLAG) && !/ss.?full/i.test(c2), 'summary does NOT advertise the escape hatch', c2);
  assert(c2.includes('Change the code before re-running.'), 'summary keeps the change-the-code line', c2);
  assert(Buffer.byteLength(c2) < 500 && Buffer.byteLength(c2) < Buffer.byteLength(RED) / 4,
    'summary is bounded and much smaller than the transcript it replaced', `${Buffer.byteLength(c2)} vs ${Buffer.byteLength(RED)}`);
  assert(cfg._runs === 2, 'THE SUITE STILL RAN on the suppressed call (never skipped)', String(cfg._runs));

  // Same diff, different RESULT → full output + a flakiness note, never suppression.
  cfg._out = RED_OTHER;
  const c3 = call(cfg);
  assert(c3.includes('result CHANGED under an identical source diff'), 'changed result → flakiness note');
  assert(c3.includes(RED_OTHER), 'changed result → FULL output preserved');
  assert(cfg._runs === 3, 'suite ran again');

  // Changed source → first sighting of a new key → byte-identical passthrough.
  writeFileSync(path.join(dir, 'src.py'), 'def f():\n    return 3\n');
  cfg._out = CLEAN;
  const c4 = call(cfg, []);
  assert(c4 === CLEAN, 'changed-diff call is BYTE-IDENTICAL to the pre-lever output');

  // Repeat after the edit condenses again, and cites the post-edit call.
  const c5 = call(cfg, []);
  assert(/as call #4; result unchanged: exit 0, 0 failed \(suite green\)/.test(c5), 'green repeat condensed, cites call #4', c5);

  // A NEW untracked file breaks the key even though the tracked diff and the result
  // are unchanged — the false-positive guard.
  writeFileSync(path.join(dir, 'repro.py'), 'print(1)\n');
  const c6 = call(cfg, []);
  assert(c6 === CLEAN, 'new untracked file → NOT condensed (key changed)');
  const c7 = call(cfg, []);
  assert(c7.includes(DEDUP_MARKER) && /as call #6/.test(c7), 'the following repeat condenses against call #6', c7);

  // Different argv is a different key even with an identical tree + result.
  const c8 = call(cfg, ['test_a']);
  assert(c8 === CLEAN, 'targeted run is a different key → NOT condensed');

  // --ss-full bypasses condensation for that call only.
  const c9 = call(cfg, [FULL_FLAG]);
  assert(c9 === CLEAN, '--ss-full returns the complete output');
  assert(!c9.includes(DEDUP_MARKER), '--ss-full response carries no dedup marker');
  const c10 = call(cfg, []);
  assert(c10.includes(DEDUP_MARKER), 'the NEXT plain call condenses again (flag is per-call)');

  // An infra error is never condensed away, even under an identical key.
  cfg._out = INFRA;
  const i1 = call(cfg, []);
  const i2 = call(cfg, []);
  assert(i1.includes('Could not resolve') && i2.includes('Could not resolve'), 'infra errors always pass through in full');
  assert(!i2.includes(DEDUP_MARKER), 'infra repeat is not condensed');

  // The audit log records every call with its key components.
  const log = readFileSync(cfg.dedupLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const recs = log.filter(r => r.kind !== 'session');
  assert(recs.length === cfg._runs, 'one audit record per invocation', `${recs.length} vs ${cfg._runs}`);
  const sup = recs.filter(r => r.suppressed);
  assert(sup.length >= 3, 'suppressions recorded', String(sup.length));
  assert(sup.every(r => r.key && r.diffSha && Array.isArray(r.untracked) && Array.isArray(r.argv)),
    'every suppression record carries key + diffSha + untracked set + argv (hand-auditable)');
  assert(recs.some(r => r.decision === 'ss-full'), 'the --ss-full call is logged as an abstention');
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('== L2 levers unchanged: banner present on non-suppressed calls ==');
{
  const dir = makeRepo();
  const cfg = makeCfg(dir, { label: 'acme__widget-2-sweet', rtAuthority: true });
  writeFileSync(path.join(dir, 'src.py'), 'def f():\n    return 9\n');
  cfg._out = RED;
  const c1 = call(cfg);
  assert(/^\[run_tests\] Authoritative test result/.test(c1), 'L2 authority banner still leads call #1', c1.slice(0, 60));
  assert(c1.includes(RED), 'call #1 keeps the whole transcript');
  const c2 = call(cfg);
  assert(c2.startsWith(DEDUP_MARKER), 'suppressed call is just the compact summary (the repeated banner is what we are removing)');
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('== per-rollout state reset ==');
{
  const dir = makeRepo();
  writeFileSync(path.join(dir, 'src.py'), 'def f():\n    return 5\n');
  const label = 'acme__widget-3-sweet';
  const cfgA = makeCfg(dir, { label });
  cfgA._out = RED;
  call(cfgA); const a2 = call(cfgA);
  assert(a2.includes(DEDUP_MARKER), 'rollout A: second call condensed (precondition)');

  // A new rollout (or the shimTampered re-run of the same one) opens a new session on
  // the same log path: state must NOT carry over, or a fresh rollout's FIRST run_tests
  // would come back condensed.
  const cfgB = makeCfg(dir, { label });
  cfgB._out = RED;
  const b1 = call(cfgB);
  assert(b1 === RED, 'rollout B: first call is full output despite an identical key in rollout A');
  assert(readDedupState(cfgB.dedupLog).calls === 1, 'replay after the session marker sees only this rollout', String(readDedupState(cfgB.dedupLog).calls));
  const raw = readFileSync(cfgB.dedupLog, 'utf8');
  assert(raw.split('\n').filter(l => l.includes('"kind":"session"')).length === 2, 'both session markers retained (audit trail of the earlier attempt survives)');
  const b2 = call(cfgB);
  assert(b2.includes(DEDUP_MARKER) && /as call #1/.test(b2), 'rollout B numbering restarts at 1', b2);
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('== kill-switch: SS_RUNTESTS_DEDUP=0 ==');
{
  // (a) cfg-level (what writeRunTestsShim emits when the env var is 0).
  const dir = makeRepo();
  writeFileSync(path.join(dir, 'src.py'), 'def f():\n    return 7\n');
  const cfg = makeCfg(dir, { label: 'acme__widget-4-sweet', rtDedup: false });
  cfg._out = RED;
  assert(cfg.dedupLog === null, 'no dedup log when the lever is off');
  const o1 = call(cfg), o2 = call(cfg), o3 = call(cfg);
  assert(o1 === RED && o2 === RED && o3 === RED, 'lever off → every call returns the full transcript');
  assert(cfg._runs === 3, 'tests still ran three times');
  rmSync(dir, { recursive: true, force: true });

  // (b) env-level, in a child process (the flag is read at module load).
  const probe = (env) => execFileSync(process.execPath, ['-e',
    `const m = await import(${JSON.stringify(path.join(BENCH_DIR, 'harness/rt-dedup.mjs'))});
     process.stdout.write(String(m.RT_DEDUP_ON));`],
  { encoding: 'utf8', env: { ...process.env, ...env } }).trim();
  assert(probe({ SS_RUNTESTS_DEDUP: '0' }) === 'false', 'SS_RUNTESTS_DEDUP=0 → RT_DEDUP_ON false');
  assert(probe({ SS_RUNTESTS_DEDUP: '1' }) === 'true', 'SS_RUNTESTS_DEDUP=1 → RT_DEDUP_ON true');
  assert(probe({ SS_RUNTESTS_DEDUP: '' }) === 'true', 'default (unset) → ON');
  assert(RT_DEDUP_ON === true, 'this test process runs with the lever ON');
}

// ---------------------------------------------------------------------------
console.log('== generated shim wiring ==');
{
  const dir = makeRepo();
  const binDir = path.join(mkdtempSync(path.join(tmpdir(), 'rt-dedup-bin-')), 'bin');
  const info = writeRunTestsShim(binDir, {
    image: 'img', workdir: '/repo', testScript: 'pytest -q', rundir: dir,
    brokerMode: true, stateDir: path.dirname(binDir), label: 'acme__widget-5-native',
  });
  const cfg = JSON.parse(readFileSync(path.join(binDir, '_run_tests_cfg.json'), 'utf8'));
  assert(cfg.rtDedup === true && typeof cfg.dedupLog === 'string', 'cfg carries rtDedup + dedupLog', JSON.stringify({ d: cfg.rtDedup, l: cfg.dedupLog }));
  assert(existsSync(cfg.dedupLog), 'the session marker was written at shim-generation time');
  assert(info.files.some(f => f.endsWith('rt-dedup.mjs')), 'rt-dedup.mjs is inside the tamper-detection file set');
  assert(info.integrity.some(e => e.file.endsWith('rt-dedup.mjs') && e.sha), 'rt-dedup.mjs is hashed by the integrity snapshot');
  const requester = readFileSync(path.join(binDir, '_run_tests.mjs'), 'utf8');
  assert(/JSON.stringify\(process\.argv\.slice\(2\)\)/.test(requester), 'the requester shim forwards the full argv (so --ss-full reaches the broker)');
  const broker = readFileSync(path.join(binDir, '_rt_broker.mjs'), 'utf8');
  assert(/runTestsWithLevers\(c, \{ argv, reqId: id \}\)/.test(broker), 'the broker passes argv + the request id through');
  assert(/markUndeliveredResponses\(c\.dedupLog, IPC\)/.test(broker), 'the broker marks unconsumed responses undelivered before serving a new request');
  rmSync(dir, { recursive: true, force: true });
  rmSync(path.dirname(binDir), { recursive: true, force: true });
}

try { rmSync(RESULTS_DIR, { recursive: true, force: true }); } catch { /* */ }
console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
