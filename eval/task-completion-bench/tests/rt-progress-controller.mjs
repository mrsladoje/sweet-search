import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  advisoryGuidance, captureSourceState, classifyProgress, createProgressRunConfig,
  finalizeProgressModelTurns,
  isProtectedCheckpointPath, isSafeRepoRelative, normalizeTestScope,
  progressRowFields, rankCheckpoints, recordProgressInvocation, resolveProgressFlags,
  RT_PROGRESS_VERSION,
} from '../harness/rt-progress-controller.mjs';
import { buildRunTestsFooter } from '../harness/rt-condense-lib.mjs';
import { runTestsWithLevers } from '../harness/rt-shim-runtime.mjs';
import { writeRunTestsShim } from '../harness/codex-task-runner.mjs';
import {
  buildMainOpencodeConfig, parseOpencodeStream, retainOpencodeAttempt,
  validateMainOpencodePreflight,
} from '../harness/opencode-task-runner.mjs';

const roots = [];
const temp = prefix => { const dir = mkdtempSync(path.join(tmpdir(), prefix)); roots.push(dir); return dir; };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const makeRepo = () => {
  const dir = temp('rt-progress-repo-');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'fixture@example.test');
  git(dir, 'config', 'user.name', 'Fixture');
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'src/main.js'), 'export const value = 0;\n');
  git(dir, 'add', 'src/main.js');
  git(dir, 'commit', '-qm', 'base');
  return dir;
};

test.after(() => roots.forEach(dir => rmSync(dir, { recursive: true, force: true })));

test('flags default OFF and T1 requires T0 plus a frozen H', () => {
  assert.deepEqual({ ...resolveProgressFlags({}) }, { telemetry: false, advisory: false, h: null });
  assert.throws(() => resolveProgressFlags({ SS_RT_ADVISORY: '1', SS_RT_H: '2' }), /requires SS_RT_PROGRESS/);
  assert.throws(() => resolveProgressFlags({ SS_RT_PROGRESS: '1', SS_RT_ADVISORY: '1' }), /frozen SS_RT_H/);
  assert.throws(() => resolveProgressFlags({ SS_RT_H: '2' }), /valid only/);
  assert.deepEqual({ ...resolveProgressFlags({ SS_RT_PROGRESS: '1', SS_RT_ADVISORY: '1', SS_RT_H: '3' }) },
    { telemetry: true, advisory: true, h: 3 });
});

test('scope normalization is deterministic and different targets are incomparable', () => {
  assert.equal(normalizeTestScope('full', 'ignored'), 'full');
  assert.equal(normalizeTestScope('targeted', '  test_x   --case  2 '), 'targeted:test_x --case 2');
  assert.notEqual(normalizeTestScope('targeted', 'test_x'), normalizeTestScope('targeted', 'test_y'));
});

test('objective progress, non-progress, infra pause, degradation, and oscillation are explicit', () => {
  const base = {
    executed: true, trustworthy: true, status: 'FAIL', scopeKey: 'full', hasSourceEdit: true,
    sourceStateHash: 'A', failureStateHash: 'F1', introducedFailures: ['one', 'two'],
    rawFailures: ['one', 'two'], issuePass: false, buildStage: 1,
  };
  assert.equal(classifyProgress(base, { ...base, sourceStateHash: 'B', failureStateHash: 'F2', introducedFailures: ['one'] }).kind, 'progress');
  const flat = classifyProgress(base, { ...base, sourceStateHash: 'B', failureStateHash: 'F1' }, [base]);
  assert.equal(flat.kind, 'non-progress');
  assert.equal(flat.oscillation, 'failure-state-repeat');
  const degraded = classifyProgress(base, { ...base, sourceStateHash: 'B', failureStateHash: 'F3', introducedFailures: ['one', 'two', 'three'] });
  assert.equal(degraded.kind, 'non-progress');
  assert.equal(degraded.degradation, true);
  assert.equal(classifyProgress(base, { ...base, executed: false }).kind, 'pause');
  assert.equal(classifyProgress(base, { ...base, status: 'INFRA' }).kind, 'pause');
  const oscillated = classifyProgress(base, { ...base, sourceStateHash: 'A', failureStateHash: 'F1' }, [base, { ...base, sourceStateHash: 'B' }]);
  assert.equal(oscillated.oscillation, 'a-b-repeat');
});

test('path validation rejects traversal and protects tests, instructions, benchmark, and state', () => {
  for (const bad of ['', '../x.js', 'src/../../x.js', '/tmp/x.js', 'C:\\x.js', 'src//x.js']) {
    assert.equal(isSafeRepoRelative(bad), false, bad);
  }
  assert.equal(isSafeRepoRelative('src/lib/x.js'), true);
  for (const blocked of ['tests/x.js', 'src/x.test.js', 'AGENTS.md', '.sweet-search/db',
    'eval/task-completion-bench/x.js', '.codex-bin/run_tests', '.claude/rules/sweet-search.md']) {
    assert.equal(isProtectedCheckpointPath(blocked), true, blocked);
  }
  assert.equal(isProtectedCheckpointPath('src/main.js'), false);
});

test('checkpoint capture retains binary patch and validated untracked source outside checkout', () => {
  const repo = makeRepo();
  const store = temp('rt-progress-store-');
  writeFileSync(path.join(repo, 'src/main.js'), 'export const value = 1;\n');
  writeFileSync(path.join(repo, 'src/helper.py'), 'VALUE = 1\n');
  mkdirSync(path.join(repo, 'tests'));
  writeFileSync(path.join(repo, 'tests/forbidden.js'), 'throw new Error();\n');
  symlinkSync('/etc/passwd', path.join(repo, 'src/escape.py'));
  const state = captureSourceState(repo, git(repo, 'diff', 'HEAD'));
  assert.equal(state.hasSourceEdit, true);
  assert(state.prohibitedFiles.includes('tests/forbidden.js'));
  assert(state.untrackedRejected.some(x => x.path === 'src/escape.py' && x.reason === 'not-regular'));
  assert.equal(state.retentionComplete, false, 'unsafe source makes retention fail closed');

  rmSync(path.join(repo, 'src/escape.py'));
  const flags = resolveProgressFlags({ SS_RT_PROGRESS: '1' });
  const cfg = createProgressRunConfig({ flags, controllerDir: store, rundir: repo, taskId: 'fixture', arm: 'native', runId: 'unit' });
  const observed = recordProgressInvocation(cfg, {
    rundir: repo, diffText: git(repo, 'diff', 'HEAD'), rawOutput: '1 failed',
    scope: 'full', status: 'FAIL', verdict: 'FAIL', exitCode: 1,
    trustworthy: true, executed: true, rawFailures: ['failure'],
    introducedFailures: ['failure'], preExistingFailures: [], issuePass: false,
  });
  assert(observed.record.checkpointId);
  const checkpoint = path.join(store, 'checkpoints', observed.record.checkpointId);
  assert(existsSync(path.join(checkpoint, 'binary.patch')));
  assert(existsSync(path.join(checkpoint, 'untracked/src/helper.py')));
  assert(!existsSync(path.join(checkpoint, 'untracked/tests/forbidden.js')));
  const manifest = JSON.parse(readFileSync(path.join(checkpoint, 'manifest.json'), 'utf8'));
  assert(manifest.prohibitedFiles.includes('tests/forbidden.js'));
  assert.equal(observed.record.checkpoint.verified, false, 'test edit prevents verified status');
  assert(!path.resolve(store).startsWith(path.resolve(repo) + path.sep));
});

test('verified checkpoint ranking follows the frozen lexicographic policy', () => {
  const checkpoints = [
    { id: 'small-red', verified: true, issuePass: false, introducedCount: 0, buildStage: 2, prohibitedCount: 0, patchBytes: 1 },
    { id: 'pass-big', verified: true, issuePass: true, introducedCount: 0, buildStage: 2, prohibitedCount: 0, patchBytes: 99 },
    { id: 'pass-small', verified: true, issuePass: true, introducedCount: 0, buildStage: 2, prohibitedCount: 0, patchBytes: 5 },
    { id: 'targeted', verified: false, issuePass: true, introducedCount: 0, buildStage: 3, prohibitedCount: 0, patchBytes: 1 },
  ];
  assert.equal(rankCheckpoints(checkpoints)[0].id, 'targeted');
  assert.equal(rankCheckpoints(checkpoints, { verifiedOnly: true })[0].id, 'pass-small');
});

test('harness instruction snapshots are ignored only while their bytes remain unchanged', () => {
  const repo = makeRepo(); const store = temp('rt-injected-store-');
  writeFileSync(path.join(repo, 'AGENTS.md'), 'harness frame\n');
  const flags = resolveProgressFlags({ SS_RT_PROGRESS: '1' });
  const cfg = createProgressRunConfig({
    flags, controllerDir: store, rundir: repo, injectedFiles: ['AGENTS.md'],
  });
  writeFileSync(path.join(repo, 'src/main.js'), 'export const value = 1;\n');
  const input = {
    rundir: repo, rawOutput: 'failure', scope: 'full', status: 'FAIL', verdict: 'FAIL',
    exitCode: 1, trustworthy: true, executed: true, rawFailures: ['x'],
    introducedFailures: ['x'], preExistingFailures: [], issuePass: false,
  };
  const first = recordProgressInvocation(cfg, { ...input, diffText: git(repo, 'diff', 'HEAD') }).record;
  assert(first.ignoredInjectedFiles.includes('AGENTS.md'));
  assert(!first.prohibitedFiles.includes('AGENTS.md'));
  assert.equal(first.checkpoint.verified, true);
  writeFileSync(path.join(repo, 'AGENTS.md'), 'agent changed this\n');
  writeFileSync(path.join(repo, 'src/main.js'), 'export const value = 2;\n');
  const second = recordProgressInvocation(cfg, { ...input, diffText: git(repo, 'diff', 'HEAD') }).record;
  assert(second.prohibitedFiles.includes('AGENTS.md'));
  assert.equal(second.checkpoint.verified, false);
});

test('T0 is byte-inert for both arms and default OFF creates no retention path', () => {
  const offRepo = makeRepo(); const nativeRepo = makeRepo(); const sweetRepo = makeRepo();
  for (const repo of [offRepo, nativeRepo, sweetRepo]) writeFileSync(path.join(repo, 'src/main.js'), 'export const value = 7;\n');
  const suite = (_cfg, diff) => diff ? { out: 'case_x ... FAILED\n1 failed', exitCode: 1 } : { out: '1 passed', exitCode: 0 };
  const baseCfg = repo => ({ rundir: repo, testScript: 'suite', rtAuthority: true, rtDedup: false });
  const offFlags = resolveProgressFlags({});
  const offConfig = createProgressRunConfig({ flags: offFlags, rundir: offRepo });
  assert.equal(progressRowFields(offConfig).rtProgressLog, null);
  const off = runTestsWithLevers({ ...baseCfg(offRepo), rtProgress: offConfig }, { runSuiteFn: suite });
  const flags = resolveProgressFlags({ SS_RT_PROGRESS: '1' });
  const nativeCfg = createProgressRunConfig({ flags, controllerDir: temp('rt-native-store-'), rundir: nativeRepo, taskId: 'x', arm: 'native' });
  const sweetCfg = createProgressRunConfig({ flags, controllerDir: temp('rt-sweet-store-'), rundir: sweetRepo, taskId: 'x', arm: 'sweet' });
  assert.equal(nativeCfg.policyHash, sweetCfg.policyHash, 'controller policy hash is arm-independent');
  const native = runTestsWithLevers({ ...baseCfg(nativeRepo), rtProgress: nativeCfg }, { runSuiteFn: suite });
  const sweet = runTestsWithLevers({ ...baseCfg(sweetRepo), rtProgress: sweetCfg }, { runSuiteFn: suite });
  assert.equal(native, off, 'T0 output equals OFF byte-for-byte');
  assert.equal(sweet, native, 'native and Sweet receive byte-identical output');
  assert.equal(native.trimEnd().split('\n').slice(-3).length, 3);
  assert(readFileSync(nativeCfg.logPath, 'utf8').includes('"kind":"invocation"'));
});

test('T1 emits bounded recovery then restore-submit and changes only footer line three', () => {
  const repo = makeRepo(); const store = temp('rt-advisory-store-');
  const flags = resolveProgressFlags({ SS_RT_PROGRESS: '1', SS_RT_ADVISORY: '1', SS_RT_H: '2' });
  const cfg = createProgressRunConfig({ flags, controllerDir: store, rundir: repo, taskId: 'x', arm: 'native' });
  const invoke = value => {
    writeFileSync(path.join(repo, 'src/main.js'), `export const value = ${value};\n`);
    return recordProgressInvocation(cfg, {
      rundir: repo, diffText: git(repo, 'diff', 'HEAD'), rawOutput: 'case_x ... FAILED\n1 failed',
      scope: 'full', status: 'FAIL', verdict: 'FAIL', exitCode: 1,
      trustworthy: true, executed: true, rawFailures: ['case_x'],
      introducedFailures: ['case_x'], preExistingFailures: [], issuePass: false,
    });
  };
  assert.equal(invoke(1).guidance, 'none');
  assert.equal(invoke(2).guidance, 'none');
  const recovery = invoke(3).guidance;
  const restore = invoke(4).guidance;
  assert.match(recovery, /^recovery\.streak-2\./);
  assert.match(restore, /^restore-submit\.streak-3\./);
  assert(recovery.length <= 120 && restore.length <= 120);
  const common = { status: 'FAIL', verdict: 'FAIL', scope: 'full', exitCode: 1,
    baselineDiff: { introduced: ['case_x'], preExisting: [] }, trustworthy: true };
  const off = buildRunTestsFooter({ ...common, guidance: 'none' }).split('\n');
  const on = buildRunTestsFooter({ ...common, guidance: recovery }).split('\n');
  assert.equal(off.length, 3); assert.equal(on.length, 3);
  assert.deepEqual(on.slice(0, 2), off.slice(0, 2));
  assert.notEqual(on[2], off[2]);
  assert.equal(advisoryGuidance({ advisory: true, h: 2, streak: 1, trustworthy: true }), 'none');
  const turnMap = finalizeProgressModelTurns(cfg, [1, 2, 3, 4].map(modelTurn => ({
    kind: 'test', modelTurn, messageId: `m${modelTurn}`,
  })));
  assert.equal(turnMap.complete, true);
  assert.deepEqual(turnMap.mappings.map(row => row.modelTurn), [1, 2, 3, 4]);
  assert.match(readFileSync(cfg.logPath, 'utf8'), /"kind":"model-turn-map"/);
});

test('controller storage refuses a path inside the graded checkout', () => {
  const repo = makeRepo();
  assert.throws(() => createProgressRunConfig({
    flags: resolveProgressFlags({ SS_RT_PROGRESS: '1' }),
    controllerDir: path.join(repo, '.state'), rundir: repo,
  }), /outside the graded workspace/);
  assert.equal(typeof RT_PROGRESS_VERSION, 'string');
});

test('generated broker cfg and integrity snapshot carry T0 policy and retention paths', () => {
  const repo = makeRepo(); const state = temp('rt-generated-state-');
  const bin = path.join(state, 'bin'); const controllerDir = temp('rt-generated-controller-');
  writeFileSync(path.join(repo, 'AGENTS.md'), 'frame\n');
  const info = writeRunTestsShim(bin, {
    image: 'fixture', workdir: '/repo', testScript: 'true', rundir: repo,
    brokerMode: true, stateDir: state, rtDedup: false,
    rtProgressFlags: resolveProgressFlags({ SS_RT_PROGRESS: '1' }), controllerDir,
    taskId: 'fixture', arm: 'sweet', injectedFiles: ['AGENTS.md'],
  });
  const cfg = JSON.parse(readFileSync(path.join(bin, '_run_tests_cfg.json'), 'utf8'));
  assert.equal(cfg.rtProgress.flags.telemetry, true);
  assert.equal(cfg.rtProgress.flags.advisory, false);
  assert.equal(cfg.rtProgress.taskId, 'fixture');
  assert.equal(cfg.rtProgress.arm, 'sweet');
  assert.equal(info.controller.rtProgressLog.endsWith('/cycles.jsonl'), true);
  assert(info.files.some(file => file.endsWith('rt-progress-controller.mjs')));
  assert(info.integrity.some(item => item.file.endsWith('rt-progress-controller.mjs') && item.sha));
});

test('raw OpenCode NDJSON and stderr are retained byte-for-byte per attempt', () => {
  const dir = temp('rt-opencode-raw-');
  const raw = [
    JSON.stringify({ type: 'tool', part: { tool: 'bash', callID: 'c1', messageID: 'm1', state: { input: { command: 'run_tests' }, status: 'running' } } }),
    JSON.stringify({ type: 'tool', part: { tool: 'bash', callID: 'c1', messageID: 'm1', state: { input: { command: 'run_tests' }, status: 'completed', output: 'done' } } }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 2 } } }),
  ].join('\n') + '\n';
  const paths = retainOpencodeAttempt(dir, 2, { stdout: raw, stderr: 'warning\n' });
  const parsed = parseOpencodeStream(raw);
  assert.equal(parsed.toolCalls.length, 1, 'stream updates for one call are deduplicated');
  assert.equal(parsed.toolCalls[0].modelTurn, 1);
  assert.equal(parsed.toolCalls[0].messageId, 'm1');
  assert.equal(readFileSync(path.join(dir, 'attempt-2.stdout.ndjson'), 'utf8'), raw);
  assert.equal(readFileSync(path.join(dir, 'attempt-2.stderr.txt'), 'utf8'), 'warning\n');
  assert.match(paths.stdout, /attempt-2\.stdout\.ndjson$/);
  assert.match(paths.stderr, /attempt-2\.stderr\.txt$/);
  const leaked = retainOpencodeAttempt(dir, 3, { stdout: 'token=fake-key', stderr: '' }, { secrets: ['fake-key'] });
  assert.equal(leaked.secretLeakDetected, true);
  assert.equal(readFileSync(path.join(dir, 'attempt-3.stdout.ndjson'), 'utf8'), 'token=[REDACTED]');
});

// F1 / register G17. opencode's step_finish reports cache creation separately from cache
// reads. The parser folds it into `in` so the context size stays right AND publishes it as
// `cacheWrite`, which is what puts opencode on the same 1.25x cache-write ledger as
// claude-code. Dropping the separate field silently returns opencode to the cheaper basis
// and shifts its published gap by 0.79 points.
test('parseOpencodeStream publishes cache.write separately from cache.read', () => {
  const raw = [
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 40, output: 5, reasoning: 2, cache: { read: 0, write: 960 } } } }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 3, cache: { read: 900, write: 300 } } } }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 7, output: 1 } } }),
  ].join('\n') + '\n';
  const { turns } = parseOpencodeStream(raw);
  assert.equal(turns.length, 3);
  // `in` is the full prompt: fresh input + cache reads + cache writes.
  assert.deepEqual(turns[0], { in: 1000, cached: 0, cacheWrite: 960, out: 7 });
  assert.deepEqual(turns[1], { in: 1210, cached: 900, cacheWrite: 300, out: 3 });
  // No cache block at all → 0, never undefined; an undefined reads as NaN downstream.
  assert.deepEqual(turns[2], { in: 7, cached: 0, cacheWrite: 0, out: 1 });
});

test('main OpenCode config pins the version surface and rejects ambient plugins', () => {
  const config = buildMainOpencodeConfig();
  assert.deepEqual(config.plugin, []);
  assert.equal(config.provider.openrouter.options.apiKey, '{env:OPENROUTER_API_KEY}');
  assert.equal(validateMainOpencodePreflight({ version: '1.18.4\n', resolved: config }), true);
  assert.throws(() => validateMainOpencodePreflight({ version: '1.18.5', resolved: config }), /1\.18\.4/);
  assert.throws(() => validateMainOpencodePreflight({ version: '1.18.4', resolved: { ...config, plugin: ['ambient'] } }), /ambient/);
});

test('count-summary fallback unblinds name-resistant suites (the moq case)', async () => {
  const { extractFailureCountSummary } = await import('../harness/rt-progress-controller.mjs');
  const dotnet = 'Results File: /moq/tests/x.trx\n\nTest Run Failed.\nTotal tests: 1684\n     Failed: 2\n    Skipped: 4\n';
  assert.deepEqual(extractFailureCountSummary(dotnet), { failed: 2, total: 1684 });
  const maven = 'Tests run: 120, Failures: 3, Errors: 0, Skipped: 1\n';
  assert.deepEqual(extractFailureCountSummary(maven), { failed: 3, total: 120 });
  assert.equal(extractFailureCountSummary('all good, nothing here'), null);
});

test('green streak fires review-then-submit from the second trusted PASS (the bfgroup case)', () => {
  const base = { advisory: true, h: 2, streak: 0, currentId: 'c1', verifiedBestId: 'c1', trustworthy: true };
  assert.equal(advisoryGuidance({ ...base, status: 'PASS', greenStreak: 1 }), 'none');
  assert.equal(advisoryGuidance({ ...base, status: 'PASS', greenStreak: 2 }), 'green.streak-2.review-then-submit');
  assert.equal(advisoryGuidance({ ...base, status: 'PASS', greenStreak: 5 }), 'green.streak-5.review-then-submit');
  assert.equal(advisoryGuidance({ ...base, status: 'FAIL', greenStreak: 0, streak: 2 }),
    'recovery.streak-2.current-c1.best-c1.allowance-1');
});

test('counts-level trust advances streaks but never creates checkpoint candidates', () => {
  const untrustedNamed = { executed: true, trustworthy: false, status: 'FAIL', failureStateHash: 'x' };
  assert.equal(classifyProgress(null, untrustedNamed).kind, 'pause');
  const countsTrusted = { executed: true, trustworthy: true, status: 'FAIL', scopeKey: 'full', hasSourceEdit: true, sourceStateHash: 'a', failureStateHash: 'h1' };
  assert.notEqual(classifyProgress(null, countsTrusted).kind, 'pause');
});

test('hard turn cap is env-gated, bounded, and absent by default', async () => {
  const { resolveHardTurnCap, buildMainOpencodeConfig: build } = await import('../harness/opencode-task-runner.mjs');
  assert.equal(resolveHardTurnCap({}), null);
  assert.equal(resolveHardTurnCap({ SS_HARD_TURN_CAP: '38' }), 38);
  assert.throws(() => resolveHardTurnCap({ SS_HARD_TURN_CAP: '2' }));
  assert.throws(() => resolveHardTurnCap({ SS_HARD_TURN_CAP: 'lots' }));
  assert.equal(build({ env: {} }).agent, undefined);
  assert.equal(build({ env: { SS_HARD_TURN_CAP: '38' } }).agent.build.maxSteps, 38);
});
