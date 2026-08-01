#!/usr/bin/env node
// Guardian-owned unattended execution contract for the authorized DEV program.
// It can reach CONFIRM-28, but contains no EXPAND-32 or frozen-heldout stage.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statfsSync, statSync,
  readdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveNativeBinary } from '../../../core/infrastructure/native-resolver.js';
import { runEquivalenceGate } from '../stats/ss-batch-equivalence.mjs';
import { adjudicateTurnfix } from '../stats/turnfix-adjudicator.mjs';
import { validateTurnfixArm } from '../stats/turnfix-admission.mjs';
import {
  evaluateAdvisoryBehavior, selectFreshProgressThreshold,
} from '../stats/turnfix-progress-gate.mjs';
import { fetchOpenRouterUsage, SPEND_POLICY } from './openrouter-spend-guardian.mjs';
import { packingTreatmentRowFields } from './agent-runner-shared.mjs';
import { progressRowFields } from './rt-progress-controller.mjs';
import { loadTaskFile } from './task-file-loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const ROOT = path.resolve(BENCH, '../..');
const RESULTS = path.join(BENCH, 'results');
const RUN_PILOT = path.join(HERE, 'run-pilot.mjs');
const SYNTHETIC_RUNNER = path.join(HERE, 'phase2a-synthetic-runner.mjs');
const DISCOVERY = path.join(BENCH, 'select/tasks_turnfix_discovery20.jsonl');
const CONFIRM = path.join(BENCH, 'select/tasks_turnfix_confirm28.jsonl');
const MPP = path.join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md');
const EXPECTED = Object.freeze({
  discoverySha256: '3542da55bbe214bdd2d03882e6ecf790816938879695d21fbef63bc6fa3f26a1',
  confirmSha256: 'b768dc0879f9e2eba45a0d21f4f1f95899ee86efe526604e43320542055e6347',
  equivalenceCohortSha256: 'f46244ba7163ffcceb9c3698167e0222b467bd58462b5247a04b55050c91bd58',
});
const STATIC_PROJECTION_USD = Object.freeze({
  discoverySweet: 11.81, discoveryNative: 10.24, synthetic: 0.25,
  naturalSweet: 11.81, confirmationBoth: 30.88,
});
const FROZEN_FILES = Object.freeze([
  'package.json', 'package-lock.json',
  'core/cli.js', 'core/infrastructure/index.js', 'core/infrastructure/native-resolver.js',
  'core/search/search-batch.js', 'core/search/search-batch-format.js', 'core/search/search-server.js',
  'eval/agent-read-workflows/bin/ss-batch', 'eval/agent-read-workflows/bin/sweet-search',
  'eval/task-completion-bench/harness/agent-jail.mjs',
  'eval/task-completion-bench/harness/agent-runner-shared.mjs',
  'eval/task-completion-bench/harness/codex-task-runner.mjs',
  'eval/task-completion-bench/harness/env-ledger.mjs',
  'eval/task-completion-bench/harness/openrouter-spend-guardian.mjs',
  'eval/task-completion-bench/harness/opencode-task-runner.mjs',
  'eval/task-completion-bench/harness/phase2a-synthetic-cells.json',
  'eval/task-completion-bench/harness/phase2a-synthetic-contract.mjs',
  'eval/task-completion-bench/harness/phase2a-synthetic-runner.mjs',
  'eval/task-completion-bench/harness/phase2a-synthetic-scenarios.json',
  'eval/task-completion-bench/harness/phase2a-synthetic-tool-client.mjs',
  'eval/task-completion-bench/harness/phase2a-synthetic-tools.mjs',
  'eval/task-completion-bench/harness/rt-condense-lib.mjs',
  'eval/task-completion-bench/harness/rt-dedup.mjs',
  'eval/task-completion-bench/harness/rt-progress-controller.mjs',
  'eval/task-completion-bench/harness/rt-shim-runtime.mjs',
  'eval/task-completion-bench/harness/run-pilot.mjs',
  'eval/task-completion-bench/harness/task-file-loader.mjs',
  'eval/task-completion-bench/harness/turnfix-overnight-orchestrator.mjs',
  'eval/task-completion-bench/select/tasks_turnfix_discovery20.jsonl',
  'eval/task-completion-bench/select/tasks_turnfix_confirm28.jsonl',
  'eval/task-completion-bench/stats/phase2a-synthetic-gate.mjs',
  'eval/task-completion-bench/stats/probe-count.mjs',
  'eval/task-completion-bench/stats/ss-batch-equivalence.mjs',
  'eval/task-completion-bench/stats/turnfix-adjudicator.mjs',
  'eval/task-completion-bench/stats/turnfix-admission.mjs',
  'eval/task-completion-bench/stats/turnfix-progress-gate.mjs',
  'crates/sweet-search-cli/Cargo.lock', 'crates/sweet-search-cli/Cargo.toml',
  'crates/sweet-search-cli/src/batch.rs', 'crates/sweet-search-cli/src/batch_transport.rs',
  'crates/sweet-search-cli/src/main.rs',
  'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md',
]);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const forbidden = value => /tasks_heldout2|heldout2|(?:^|[_.\/-])ho2(?:[_.\/-]|$)|expand32/i.test(String(value || ''));
const validRunId = value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || '')) && !forbidden(value);

function privateWrite(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(file, 0o600);
}

function artifactHashes() {
  const expandDirectory = (relativeDir, extensions) => readdirSync(path.join(ROOT, relativeDir), { withFileTypes: true })
    .filter(entry => entry.isFile() && extensions.some(extension => entry.name.endsWith(extension)) && !forbidden(entry.name))
    .map(entry => `${relativeDir}/${entry.name}`);
  const runtimeFiles = [
    ...FROZEN_FILES,
    ...expandDirectory('core/search', ['.js']),
    ...expandDirectory('core/infrastructure', ['.js']),
    ...expandDirectory('eval/task-completion-bench/harness', ['.mjs', '.js', '.json', '.py', '.sh']),
    ...expandDirectory('eval/task-completion-bench/stats', ['.mjs', '.js']),
  ];
  return Object.fromEntries([...new Set(runtimeFiles)].sort().map(relative => {
    const file = path.join(ROOT, relative);
    if (!statSync(file).isFile()) throw new Error(`frozen artifact missing: ${relative}`);
    return [relative, sha256(readFileSync(file))];
  }));
}

function nativeArtifact(expectedSha256) {
  const candidate = resolveNativeBinary();
  if (!candidate) throw new Error('active native binary did not resolve');
  const file = realpathSync(candidate), stat = statSync(file);
  const relative = path.relative(ROOT, file);
  const artifact = {
    path: file, repoRelativePath: relative.split(path.sep).join('/'),
    sha256: sha256(readFileSync(file)), bytes: stat.size,
    platform: process.platform, arch: process.arch,
  };
  if (!stat.isFile() || (stat.mode & 0o111) === 0 || relative.startsWith('..')
      || artifact.platform !== 'linux' || artifact.sha256 !== expectedSha256) {
    throw new Error('active Linux native binary does not match the reviewed pin');
  }
  return artifact;
}

function exactFileHash(file, expected, label) {
  const actual = sha256(readFileSync(file));
  if (actual !== expected) throw new Error(`${label} sha256 drifted: ${actual}`);
  return actual;
}

export function executionTaskFiles(ledgerPath) {
  const directory = path.dirname(ledgerPath);
  const validate = (cohortPath, filename, expected) => {
    const executionPath = path.join(directory, filename);
    const cohort = loadTaskFile(cohortPath), specs = loadTaskFile(executionPath);
    const cohortIds = cohort.map(row => row.instance_id);
    const specIds = specs.map(row => row.instance_id);
    if (specs.length !== expected || JSON.stringify(specIds) !== JSON.stringify(cohortIds)) {
      throw new Error(`${filename} does not exactly match its frozen cohort`);
    }
    for (const spec of specs) {
      if (typeof spec.problem_statement !== 'string' || !spec.problem_statement
          || typeof spec.image_name !== 'string' || !spec.image_name
          || typeof spec.workdir !== 'string' || !spec.workdir
          || typeof spec.patch !== 'string' || typeof spec.test_patch !== 'string'
          || !spec.install_config || typeof spec.install_config !== 'object') {
        throw new Error(`${filename} contains an incomplete full spec: ${spec.instance_id}`);
      }
    }
    return { path: executionPath, sha256: sha256(readFileSync(executionPath)), n: specs.length };
  };
  return {
    discovery: validate(DISCOVERY, 'tasks-discovery20-full.json', 20),
    confirm: validate(CONFIRM, 'tasks-confirm28-full.json', 28),
  };
}

export function authorize(env = process.env) {
  if (env.SS_TURNFIX_EXECUTE !== '1' || env.CONCURRENCY !== '1'
      || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(env.SS_SPEND_GUARD_SESSION || ''))
      || typeof env.OPENROUTER_API_KEY !== 'string' || !env.OPENROUTER_API_KEY
      || !validRunId(env.RUN_ID) || !/^[a-f0-9]{64}$/.test(String(env.SS_TURNFIX_EXPECT_NATIVE_SHA256 || ''))
      || !env.ENV_LEDGER || forbidden(env.ENV_LEDGER)) {
    throw new Error('turn-fix execution requires the guardian, C1, safe run id, ledger, and native SHA pin');
  }
  return {
    runId: env.RUN_ID, sessionId: env.SS_SPEND_GUARD_SESSION,
    expectedNativeSha256: env.SS_TURNFIX_EXPECT_NATIVE_SHA256,
    ledgerPath: path.resolve(env.ENV_LEDGER), apiKey: env.OPENROUTER_API_KEY,
  };
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 128 : (code ?? 1)));
  });
}

async function runNode(file, { env = {}, args = [] } = {}) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd: ROOT, env: { ...process.env, ...env, CONCURRENCY: '1' }, stdio: 'inherit',
  });
  let concurrentPilot = false;
  const monitor = path.resolve(file) === RUN_PILOT ? setInterval(() => {
    if (runPilotCount() > 1) {
      concurrentPilot = true;
      child.kill('SIGTERM');
    }
  }, 1_000) : null;
  monitor?.unref();
  const code = await childExit(child);
  if (monitor) clearInterval(monitor);
  if (concurrentPilot) throw new Error('a second run-pilot appeared during the stage');
  if (code !== 0) throw new Error(`${path.basename(file)} exited ${code}`);
}

export function isExactRunPilotCommand(command) {
  const argv = String(command || '').split('\0').filter(Boolean);
  return /^node(?:js)?$/.test(path.basename(argv[0] || ''))
    && path.basename(argv[1] || '') === 'run-pilot.mjs';
}

function runPilotCount() {
  if (process.platform !== 'linux' || !existsSync('/proc')) throw new Error('Linux /proc is required');
  let count = 0;
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const command = readFileSync(`/proc/${entry.name}/cmdline`, 'utf8');
      if (isExactRunPilotCommand(command)) count++;
    } catch { /* process exited during the scan */ }
  }
  return count;
}

function assertNoRunPilot() {
  const count = runPilotCount();
  if (count !== 0) throw new Error(`another run-pilot process is active (count=${count})`);
}

export function stageId(rootRunId, suffix) {
  const value = `${rootRunId}-${suffix}`;
  if (!validRunId(value)) throw new Error('derived stage id is invalid');
  return value;
}

export function pilotEnv({ runId, tasksPath, arm, ledgerPath, packing = 'off', advisoryH = null, preflight = false }) {
  return {
    RUN_ID: runId, TASKS_FILE: tasksPath, ENV_LEDGER: ledgerPath,
    HARNESS: 'opencode', MODEL: 'x-ai/grok-4.5', PROVIDER: 'openrouter', REASONING: 'standard',
    REPS: '1', ARMS: arm, CONCURRENCY: '1', AGENT_TIMEOUT_MS: '1800000',
    TASK_FRAME: '1', SS_ISOLATION: '1', SS_RUNTESTS_DEDUP: '1', SS_BENCH_ALLOW_NET: '0',
    SS_RT_PROGRESS: '1', SS_PACKING_TREATMENT: packing, MPP,
    DOCKER_HOST: process.env.DOCKER_HOST || 'unix:///var/run/docker.sock',
    ...(advisoryH == null ? {} : { SS_RT_ADVISORY: '1', SS_RT_H: String(advisoryH) }),
    ...(preflight ? { PREFLIGHT_ONLY: '1' } : {}),
  };
}

async function runPilotStage(options) {
  assertNoRunPilot();
  if (existsSync(path.join(RESULTS, options.runId))) throw new Error(`result path already exists: ${options.runId}`);
  await runNode(RUN_PILOT, { env: pilotEnv({ ...options, runId: `${options.runId}-preflight`, preflight: true }) });
  await runNode(RUN_PILOT, { env: pilotEnv(options) });
  return path.join(RESULTS, options.runId);
}

export function expectedCell({ arm, packing = 'off', advisoryH = null }) {
  const advisory = advisoryH != null;
  const packingFields = packingTreatmentRowFields({
    sweet: arm === 'sweet', env: { SS_PACKING_TREATMENT: packing },
  });
  const progressFields = progressRowFields({ flags: { telemetry: true, advisory, h: advisoryH } });
  return {
    ...packingFields,
    rtProgressVersion: progressFields.rtProgressVersion,
    rtProgressSchema: progressFields.rtProgressSchema,
    rtProgressTelemetry: progressFields.rtProgressTelemetry,
    rtProgressAdvisory: progressFields.rtProgressAdvisory,
    rtProgressH: progressFields.rtProgressH,
    rtProgressPolicyHash: progressFields.rtProgressPolicyHash,
  };
}

function requireAdmission({ resultPath, arm, expected, tasksPath, packing = 'off', advisoryH = null }) {
  const report = validateTurnfixArm({
    resultPath, arm, expected, tasksPath, expectedCell: expectedCell({ arm, packing, advisoryH }),
  });
  if (!report.valid) throw new Error(`${arm} admission failed: ${report.admissionFailures.join('; ')}`);
  return report;
}

async function currentSpend(context, reportedUsd) {
  const state = readJson(path.join(context.rootDir, 'openrouter-spend-session.json'), 'guardian state');
  if (state.sessionId !== context.authorization.sessionId || state.hardCapUsd !== SPEND_POLICY.hardCapUsd) {
    throw new Error('guardian state does not match the orchestrator session');
  }
  const total = await fetchOpenRouterUsage({ apiKey: context.authorization.apiKey });
  const providerDeltaUsd = total - state.baselineUsageUsd;
  if (!Number.isFinite(providerDeltaUsd) || providerDeltaUsd < 0) throw new Error('provider spend delta is invalid');
  return { providerDeltaUsd, reportedUsd, conservativeUsd: Math.max(providerDeltaUsd, reportedUsd) };
}

function readJson(file, label) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`${label} is missing or invalid`); }
}

async function launchRecord(context, name, projectedRemainingUsd, config, reportedUsd) {
  const hashes = artifactHashes();
  if (JSON.stringify(hashes) !== JSON.stringify(context.frozenHashes)) throw new Error('frozen code changed after preregistration');
  const spend = await currentSpend(context, reportedUsd);
  if (spend.conservativeUsd + projectedRemainingUsd > SPEND_POLICY.hardCapUsd + 1e-9) {
    throw new Error(`${name} projection would exceed the $${SPEND_POLICY.hardCapUsd} hard cap`);
  }
  const report = {
    schemaVersion: 1, kind: 'stage-launch-gate', stage: name, writtenAt: new Date().toISOString(),
    verdict: 'GO', spend, projectedRemainingUsd, projectedTotalUsd: spend.conservativeUsd + projectedRemainingUsd,
    hardCapUsd: SPEND_POLICY.hardCapUsd, operationalStopUsd: SPEND_POLICY.operationalStopUsd,
    concurrency: 1, config,
  };
  privateWrite(path.join(context.rootDir, 'gates', `${name}-launch.json`), report);
  return report;
}

function writeGate(context, name, report) {
  privateWrite(path.join(context.rootDir, 'gates', `${name}-result.json`), report);
  if (report.valid === false || ['FAIL', 'DO NOT ADVANCE', 'INVALID — not adjudicated'].includes(report.verdict)) {
    throw new Error(`${name} gate failed: ${report.verdict}`);
  }
  return report;
}

async function main() {
  const authorization = authorize();
  const rootDir = path.join(RESULTS, authorization.runId);
  const initialProjectionUsd = Object.values(STATIC_PROJECTION_USD).reduce((sum, value) => sum + value, 0);
  const minimumScreenProjectionUsd = STATIC_PROJECTION_USD.discoverySweet
    + STATIC_PROJECTION_USD.discoveryNative + STATIC_PROJECTION_USD.synthetic
    + STATIC_PROJECTION_USD.naturalSweet;
  const disk = statfsSync(ROOT); const freeBytes = disk.bavail * disk.bsize;
  if (freeBytes < 20 * 1024 ** 3) throw new Error('less than 20 GiB free before launch');
  const discoverySha256 = exactFileHash(DISCOVERY, EXPECTED.discoverySha256, 'DISCOVERY-20');
  const confirmSha256 = exactFileHash(CONFIRM, EXPECTED.confirmSha256, 'CONFIRM-28');
  const executionTasks = executionTaskFiles(authorization.ledgerPath);
  const frozenHashes = artifactHashes();
  const native = nativeArtifact(authorization.expectedNativeSha256);
  const context = { authorization, rootDir, frozenHashes };
  privateWrite(path.join(rootDir, 'pre-outcome-contract.json'), {
    schemaVersion: 1, program: 'turnfix-overnight-through-confirm28', frozenAt: new Date().toISOString(),
    runId: authorization.runId, guardianSessionSha256: sha256(authorization.sessionId),
    userAuthorization: {
      hardCapUsd: SPEND_POLICY.hardCapUsd,
      operationalStopUsd: SPEND_POLICY.operationalStopUsd,
      noExpand32: true, noHo2: true, stopOnFailedGate: true,
    },
    model: 'x-ai/grok-4.5', provider: 'openrouter', harness: 'opencode', opencodeVersion: '1.18.4',
    concurrency: 1, cohorts: {
      discovery: {
        selectionPath: DISCOVERY, selectionSha256: discoverySha256,
        executionPath: executionTasks.discovery.path,
        executionSha256: executionTasks.discovery.sha256, n: executionTasks.discovery.n,
      },
      confirm: {
        selectionPath: CONFIRM, selectionSha256: confirmSha256,
        executionPath: executionTasks.confirm.path,
        executionSha256: executionTasks.confirm.sha256, n: executionTasks.confirm.n,
      },
    },
    t2: { verdict: 'NO-GO', reason: 'pinned OpenCode 1.18.4 has no per-request hook' },
    t3: { verdict: 'SKIPPED-BY-DEFAULT' }, hardRestore: false,
    nativeBinary: native, ledgerPath: authorization.ledgerPath,
    frozenArtifactSha256: frozenHashes, staticProjectionUsd: STATIC_PROJECTION_USD,
    initialProjectionUsd, minimumScreenProjectionUsd,
    budgetRule: 'stop before the first stage whose conservative projection exceeds the hard cap',
    sequence: ['discovery-sweet', 'discovery-native', 'synthetic', 'natural', 'eligible-T1-or-packing-only', 'confirm28'],
  });
  await launchRecord(context, 'zero-cost-equivalence', minimumScreenProjectionUsd, { cohortSha256: EXPECTED.equivalenceCohortSha256 }, 0);
  const equivalence = await runEquivalenceGate({ expectedCohortSha256: EXPECTED.equivalenceCohortSha256 });
  if (equivalence.verdict !== 'PASS' || equivalence.selectedBudget !== 16_000) throw new Error('offline retrieval equivalence failed');
  writeGate(context, 'zero-cost-equivalence', { valid: true, ...equivalence });

  let reportedUsd = 0;
  await launchRecord(context, 'discovery-sweet', minimumScreenProjectionUsd, { arm: 'sweet', packing: 'off', telemetry: true }, reportedUsd);
  const discoverySweetId = stageId(authorization.runId, 'd20-sweet-t0');
  const discoverySweet = await runPilotStage({ runId: discoverySweetId, tasksPath: executionTasks.discovery.path, arm: 'sweet', ledgerPath: authorization.ledgerPath });
  const sweetAdmission = requireAdmission({ resultPath: discoverySweet, arm: 'sweet', expected: 20, tasksPath: executionTasks.discovery.path });
  reportedUsd += sweetAdmission.summary.totals.cost;
  writeGate(context, 'discovery-sweet', sweetAdmission);

  const remainingAfterSweet = STATIC_PROJECTION_USD.discoveryNative + STATIC_PROJECTION_USD.synthetic
    + STATIC_PROJECTION_USD.naturalSweet;
  await launchRecord(context, 'discovery-native', remainingAfterSweet, { arm: 'native', packing: 'off', telemetry: true }, reportedUsd);
  const discoveryNativeId = stageId(authorization.runId, 'd20-native-t0');
  const discoveryNative = await runPilotStage({ runId: discoveryNativeId, tasksPath: executionTasks.discovery.path, arm: 'native', ledgerPath: authorization.ledgerPath });
  const nativeAdmission = requireAdmission({ resultPath: discoveryNative, arm: 'native', expected: 20, tasksPath: executionTasks.discovery.path });
  reportedUsd += nativeAdmission.summary.totals.cost;
  writeGate(context, 'discovery-native', nativeAdmission);

  const threshold = selectFreshProgressThreshold({ nativePath: discoveryNative, sweetPath: discoverySweet, tasksPath: executionTasks.discovery.path, expected: 20 });
  writeGate(context, 'fresh-progress-threshold', threshold);

  await launchRecord(context, 'synthetic', STATIC_PROJECTION_USD.synthetic + sweetAdmission.summary.totals.cost, { cells: 3, scenarios: 12, maxSteps: 4 }, reportedUsd);
  const syntheticId = stageId(authorization.runId, 'synthetic');
  await runNode(SYNTHETIC_RUNNER, { env: {
    RUN_ID: syntheticId, SS_PHASE2A_EXECUTE: '1',
    SS_PHASE2A_EXPECT_NATIVE_SHA256: authorization.expectedNativeSha256,
  } });
  const synthetic = readJson(path.join(RESULTS, syntheticId, 'phase2a-synthetic/gate-report.json'), 'synthetic gate');
  if (synthetic.verdict !== 'PASS' || !['ss-batch', 'parallel-bash'].includes(synthetic.selectedCell)) throw new Error('synthetic packing gate failed');
  reportedUsd += Number(synthetic.stageUsage?.estimatedRealizedUsd) || 0;
  writeGate(context, 'synthetic', { valid: true, ...synthetic });

  await launchRecord(context, 'natural', sweetAdmission.summary.totals.cost, { arm: 'sweet', packing: synthetic.selectedCell, telemetry: true }, reportedUsd);
  const naturalId = stageId(authorization.runId, `d20-${synthetic.selectedCell}`);
  const naturalPath = await runPilotStage({ runId: naturalId, tasksPath: executionTasks.discovery.path, arm: 'sweet', ledgerPath: authorization.ledgerPath, packing: synthetic.selectedCell });
  const naturalAdmission = requireAdmission({
    resultPath: naturalPath, arm: 'sweet', expected: 20, tasksPath: executionTasks.discovery.path,
    packing: synthetic.selectedCell,
  });
  reportedUsd += naturalAdmission.summary.totals.cost;
  writeGate(context, 'natural-admission', naturalAdmission);
  const natural = adjudicateTurnfix({
    stage: 'natural', controlPath: discoverySweet, treatmentPath: naturalPath,
    controlArm: 'sweet', treatmentArm: 'sweet', expected: 20, tasksPath: executionTasks.discovery.path,
    retrievalEquivalence: 'pass', completionTripwires: 'pass',
  });
  writeGate(context, 'natural', natural);
  if (natural.verdict !== 'ADVANCE') throw new Error(`natural packing stopped: ${natural.verdict}`);

  const controllerH = threshold.advisoryThreshold;
  let headlineNativeCost = nativeAdmission.summary.totals.cost;
  let headlineSweetCost = naturalAdmission.summary.totals.cost;
  if (controllerH != null) {
    const controllerRemaining = sweetAdmission.summary.totals.cost + nativeAdmission.summary.totals.cost
      + naturalAdmission.summary.totals.cost
      + 1.4 * (nativeAdmission.summary.totals.cost + naturalAdmission.summary.totals.cost);
    await launchRecord(context, 't1-sweet', controllerRemaining, { arm: 'sweet', packing: 'off', advisoryH: controllerH }, reportedUsd);
    const t1SweetId = stageId(authorization.runId, `d20-sweet-t1-h${controllerH}`);
    const t1Sweet = await runPilotStage({ runId: t1SweetId, tasksPath: executionTasks.discovery.path, arm: 'sweet', ledgerPath: authorization.ledgerPath, advisoryH: controllerH });
    const t1SweetAdmission = requireAdmission({
      resultPath: t1Sweet, arm: 'sweet', expected: 20, tasksPath: executionTasks.discovery.path,
      advisoryH: controllerH,
    });
    reportedUsd += t1SweetAdmission.summary.totals.cost;
    writeGate(context, 't1-sweet-admission', t1SweetAdmission);
    const behavior = evaluateAdvisoryBehavior({ controlPath: discoverySweet, treatmentPath: t1Sweet, arm: 'sweet', tasksPath: executionTasks.discovery.path, expected: 20, h: controllerH });
    writeGate(context, 't1-sweet', behavior);
    if (behavior.verdict !== 'ADVANCE') throw new Error('T1 Sweet behavior gate failed');

    const afterT1Sweet = nativeAdmission.summary.totals.cost + naturalAdmission.summary.totals.cost
      + 1.4 * (nativeAdmission.summary.totals.cost + naturalAdmission.summary.totals.cost);
    await launchRecord(context, 't1-native', afterT1Sweet, { arm: 'native', packing: 'off', advisoryH: controllerH }, reportedUsd);
    const t1NativeId = stageId(authorization.runId, `d20-native-t1-h${controllerH}`);
    const t1Native = await runPilotStage({ runId: t1NativeId, tasksPath: executionTasks.discovery.path, arm: 'native', ledgerPath: authorization.ledgerPath, advisoryH: controllerH });
    const t1NativeAdmission = requireAdmission({
      resultPath: t1Native, arm: 'native', expected: 20, tasksPath: executionTasks.discovery.path,
      advisoryH: controllerH,
    });
    reportedUsd += t1NativeAdmission.summary.totals.cost;
    writeGate(context, 't1-native-admission', t1NativeAdmission);
    const nativeBehavior = evaluateAdvisoryBehavior({ controlPath: discoveryNative, treatmentPath: t1Native, arm: 'native', tasksPath: executionTasks.discovery.path, expected: 20, h: controllerH });
    writeGate(context, 't1-native', nativeBehavior);
    if (nativeBehavior.verdict !== 'ADVANCE') throw new Error('T1 native behavior gate failed');

    const combinedRemaining = naturalAdmission.summary.totals.cost
      + 1.4 * (t1NativeAdmission.summary.totals.cost + naturalAdmission.summary.totals.cost);
    await launchRecord(context, 't4-sweet-on', combinedRemaining, { arm: 'sweet', packing: synthetic.selectedCell, advisoryH: controllerH }, reportedUsd);
    const t4SweetId = stageId(authorization.runId, `d20-${synthetic.selectedCell}-t1-h${controllerH}`);
    const t4Sweet = await runPilotStage({ runId: t4SweetId, tasksPath: executionTasks.discovery.path, arm: 'sweet', ledgerPath: authorization.ledgerPath, packing: synthetic.selectedCell, advisoryH: controllerH });
    const t4SweetAdmission = requireAdmission({
      resultPath: t4Sweet, arm: 'sweet', expected: 20, tasksPath: executionTasks.discovery.path,
      packing: synthetic.selectedCell, advisoryH: controllerH,
    });
    reportedUsd += t4SweetAdmission.summary.totals.cost;
    writeGate(context, 't4-sweet-on-admission', t4SweetAdmission);
    const combinedBehavior = evaluateAdvisoryBehavior({
      controlPath: naturalPath, treatmentPath: t4Sweet, arm: 'sweet', tasksPath: executionTasks.discovery.path,
      expected: 20, h: controllerH, packing: synthetic.selectedCell,
    });
    writeGate(context, 't4-sweet-on-behavior', combinedBehavior);
    if (combinedBehavior.verdict !== 'ADVANCE') throw new Error('combined Sweet controller behavior gate failed');

    const offSurface = adjudicateTurnfix({
      stage: 'natural', controlPath: discoveryNative, treatmentPath: naturalPath,
      controlArm: 'native', treatmentArm: 'sweet', expected: 20, tasksPath: executionTasks.discovery.path,
      retrievalEquivalence: 'pass', completionTripwires: 'pass',
    });
    const onSurface = adjudicateTurnfix({
      stage: 'natural', controlPath: t1Native, treatmentPath: t4Sweet,
      controlArm: 'native', treatmentArm: 'sweet', expected: 20, tasksPath: executionTasks.discovery.path,
      retrievalEquivalence: 'pass', completionTripwires: 'pass',
    });
    writeGate(context, 't4-off-surface', offSurface);
    writeGate(context, 't4-on-surface', onSurface);
    if (offSurface.verdict !== 'ADVANCE' || onSurface.verdict !== 'ADVANCE') throw new Error('T4 2x2 surface gate failed');
    writeGate(context, 't4-interaction', {
      valid: true, verdict: 'ADVANCE', h: controllerH,
      cells: { nativeOff: discoveryNative, sweetOff: naturalPath, nativeOn: t1Native, sweetOn: t4Sweet },
      ratioOfRatios: Object.fromEntries(['cost', 'turns', 'operations', 'contextTokens'].map(key => [
        key, onSurface.metrics[key].point / offSurface.metrics[key].point,
      ])),
    });
    headlineNativeCost = t1NativeAdmission.summary.totals.cost;
    headlineSweetCost = t4SweetAdmission.summary.totals.cost;
  }

  const confirmProjection = 1.4 * (headlineNativeCost + headlineSweetCost);
  await launchRecord(context, 'confirm-sweet', confirmProjection, { cohort: 'CONFIRM-28', arm: 'sweet', packing: synthetic.selectedCell, controllerH }, reportedUsd);
  const confirmSweetId = stageId(authorization.runId, `c28-${synthetic.selectedCell}${controllerH == null ? '' : `-h${controllerH}`}`);
  const confirmSweet = await runPilotStage({ runId: confirmSweetId, tasksPath: executionTasks.confirm.path, arm: 'sweet', ledgerPath: authorization.ledgerPath, packing: synthetic.selectedCell, advisoryH: controllerH });
  const confirmSweetAdmission = requireAdmission({
    resultPath: confirmSweet, arm: 'sweet', expected: 28, tasksPath: executionTasks.confirm.path,
    packing: synthetic.selectedCell, advisoryH: controllerH,
  });
  reportedUsd += confirmSweetAdmission.summary.totals.cost;
  writeGate(context, 'confirm-sweet', confirmSweetAdmission);

  await launchRecord(context, 'confirm-native', 1.4 * headlineNativeCost, { cohort: 'CONFIRM-28', arm: 'native', packing: 'off', controllerH }, reportedUsd);
  const confirmNativeId = stageId(authorization.runId, `c28-native${controllerH == null ? '' : `-h${controllerH}`}`);
  const confirmNative = await runPilotStage({ runId: confirmNativeId, tasksPath: executionTasks.confirm.path, arm: 'native', ledgerPath: authorization.ledgerPath, advisoryH: controllerH });
  const confirmNativeAdmission = requireAdmission({
    resultPath: confirmNative, arm: 'native', expected: 28, tasksPath: executionTasks.confirm.path,
    advisoryH: controllerH,
  });
  reportedUsd += confirmNativeAdmission.summary.totals.cost;
  writeGate(context, 'confirm-native', confirmNativeAdmission);
  const confirmation = adjudicateTurnfix({
    stage: 'confirmation', controlPath: confirmNative, treatmentPath: confirmSweet,
    controlArm: 'native', treatmentArm: 'sweet', expected: 28, tasksPath: executionTasks.confirm.path,
    retrievalEquivalence: 'pass', completionTripwires: 'pass',
  });
  writeGate(context, 'confirmation', confirmation);
  if (confirmation.verdict !== 'PASS — STOP AT CONFIRM-28') {
    throw new Error(`CONFIRM-28 terminal verdict ${confirmation.verdict}; EXPAND-32 is not authorized`);
  }
  const spend = await currentSpend(context, reportedUsd);
  privateWrite(path.join(rootDir, 'terminal.json'), {
    schemaVersion: 1, verdict: 'COMPLETED THROUGH CONFIRM-28', spend,
    confirmationVerdict: confirmation.verdict, expand32Run: false, ho2Run: false,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(`[turnfix-overnight] STOP: ${error.message}`); process.exitCode = 1; }
}
