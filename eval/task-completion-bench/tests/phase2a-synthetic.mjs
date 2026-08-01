#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildCellInstruction, buildScenarioPrompt, loadSyntheticContract, materializeScenario,
  parseSyntheticOpenCodeStream, serializeSyntheticArtifact, sha256, syntheticArtifactHashes,
} from '../harness/phase2a-synthetic-contract.mjs';
import {
  installSyntheticToolClients, startSyntheticToolBroker, syntheticOperationArgv,
} from '../harness/phase2a-synthetic-tools.mjs';
import {
  assertResolvedNativeBinary, assertSyntheticPaidAuthorization, buildSyntheticPreOutcomeManifest,
  validateSyntheticResolvedConfig,
} from '../harness/phase2a-synthetic-runner.mjs';
import {
  evaluateSyntheticScreen, parseRestrictedShell,
} from '../stats/phase2a-synthetic-gate.mjs';
import { costFromTurns, priceFor } from '../harness/ideal-cost.mjs';

let passed = 0;
const FIXTURE_NATIVE = Object.freeze({
  path: '/workspace/packages/native-linux-x64-gnu/sweet-search',
  repoRelativePath: 'packages/native-linux-x64-gnu/sweet-search',
  sha256: 'a'.repeat(64), bytes: 123456, platform: 'linux', arch: 'x64',
});
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function runClient(file, args, socketPath) {
  return new Promise(resolve => {
    const child = spawn(file, args, {
      env: { ...process.env, SS_PHASE2A_TOOL_SOCKET: socketPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => resolve({ exitCode: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.once('exit', code => resolve({ exitCode: code ?? -1, stdout, stderr }));
  });
}

function batchPayload(runtimeScenario) {
  return JSON.stringify({
    version: 1,
    operations: runtimeScenario.operations.map(({ id, tool, args }) => ({ id, tool, args })),
    maxChars: 16000,
  });
}

function shellCommand(operation) {
  return `${{ search: 'ss-search', grep: 'ss-grep', find: 'ss-find', read: 'ss-read' }[operation.tool]} ${
    syntheticOperationArgv(operation).map(arg => JSON.stringify(arg)).join(' ')
  }`;
}

function streamEvent(call, index) {
  return JSON.stringify({
    type: 'tool',
    part: {
      type: 'tool', tool: 'bash', callID: `call-${index}`, messageID: call.messageId,
      state: { status: 'completed', input: { command: call.command }, output: call.output },
    },
  });
}

function usageFor(steps, model) {
  const price = priceFor(model);
  const costs = costFromTurns(steps, price);
  return {
    source: 'opencode-step-finish', price, steps,
    totals: {
      in: steps.reduce((sum, step) => sum + step.in, 0),
      cached: steps.reduce((sum, step) => sum + step.cached, 0),
      out: steps.reduce((sum, step) => sum + step.out, 0),
    },
    idealUsd: costs.idealUsd,
    estimatedRealizedUsd: costs.realFromTurnsUsd,
  };
}

function makeIdealRow(contract, cell, scenario, ordinal) {
  const hashes = syntheticArtifactHashes(contract);
  const nonce = ordinal.toString(16).padStart(16, '0');
  const runtime = materializeScenario(scenario, { nonce });
  const common = `shared_serial_union=${'x'.repeat(700)}`;
  const serialOutputs = Object.fromEntries(runtime.operations.map(operation => [
    operation.id,
    `${common}\noperation_id=${operation.id}\n${operation.fact}\n${
      scenario.kind === 'dependency' && operation.id === scenario.leadId ? `next_path=${runtime.dynamicPath}\n` : ''
    }`,
  ]));
  const calls = [];
  const audit = [];
  if (cell.id === 'ss-batch' && scenario.kind === 'independent') {
    const command = `ss-batch '${batchPayload(runtime)}'`;
    const output = `batch_shared=${'x'.repeat(700)}\n${runtime.operations.map(op => `${op.id} ${op.fact}`).join('\n')}\n`;
    calls.push({ command, messageId: `m-${cell.id}-${scenario.id}`, output });
    const [, ...argv] = parseRestrictedShell(command)[0].argv;
    audit.push({
      sequence: 1, command: 'ss-batch', argv, startedAtMs: 10, completedAtMs: 30,
      returnedAtMs: 31, exitCode: 0, parseError: null, stdout: output, stderr: '',
      operations: runtime.operations.map(operation => ({
        id: operation.id, tool: operation.tool, args: operation.args, status: 'ok', error: null,
        dependencyViolation: false, startedAtMs: 10, completedAtMs: 30, output: serialOutputs[operation.id],
      })),
    });
  } else {
    runtime.operations.forEach((operation, index) => {
      const parallel = cell.id === 'parallel-bash' && scenario.kind === 'independent';
      const messageId = parallel ? `m-${cell.id}-${scenario.id}` : `m-${cell.id}-${scenario.id}-${index}`;
      const command = shellCommand(operation);
      calls.push({ command, messageId, output: serialOutputs[operation.id] });
      const [parsed] = parseRestrictedShell(command);
      const start = parallel ? 10 : 10 + index * 30;
      audit.push({
        sequence: index + 1, command: parsed.argv[0], argv: parsed.argv.slice(1),
        startedAtMs: start, completedAtMs: start + 20, returnedAtMs: start + 21,
        exitCode: 0, parseError: null, stdout: serialOutputs[operation.id], stderr: '',
        operations: [{
          id: operation.id, tool: operation.tool, args: operation.args, status: 'ok', error: null,
          dependencyViolation: false, startedAtMs: start, completedAtMs: start + 20,
          output: serialOutputs[operation.id],
        }],
      });
    });
  }
  const stepCount = new Set(calls.map(call => call.messageId)).size;
  const stepLines = Array.from({ length: stepCount }, (_, index) => JSON.stringify({
    type: 'step_finish',
    part: { type: 'step_finish', tokens: { input: 90 + index, output: 20, reasoning: 2, cache: { read: 10, write: 0 } } },
  }));
  const finalText = runtime.operations.map(({ fact }) => fact).join(' ');
  const stdout = [
    ...calls.map(streamEvent), ...stepLines,
    JSON.stringify({ type: 'text', part: { type: 'text', text: finalText } }),
  ].join('\n');
  const steps = parseSyntheticOpenCodeStream(stdout).steps;
  return {
    schemaVersion: 1, runId: 'phase2a-test', scenarioId: scenario.id, cellId: cell.id,
    scenarioNonce: nonce, scenarioSha256: hashes.scenarioSha256, cellSha256: hashes.cellSha256,
    configSha256: hashes.configSha256,
    instructionSha256: sha256(buildCellInstruction(cell)),
    promptSha256: sha256(buildScenarioPrompt(scenario)),
    runtimeScenarioSha256: sha256(serializeSyntheticArtifact(runtime)),
    nativeBinary: FIXTURE_NATIVE,
    opencodeVersion: contract.cells.opencodeVersion, maxSteps: contract.cells.maxSteps,
    raw: { stdout, stderr: '', exitCode: 0, timedOut: false, outputTruncated: false },
    audit, networkDenials: [], workspaceMutations: [],
    opencodeStateFiles: [{ path: 'opencode.db', type: 'file', bytes: 64, sha256: 'b'.repeat(64) }],
    secretLeakDetected: false,
    preflight: { ssBatch: true, opencodeVersion: true, resolvedConfig: true },
    usage: usageFor(steps, contract.cells.model),
  };
}

function idealRows(contract) {
  let ordinal = 1;
  return contract.cells.cells.flatMap(cell => contract.scenarios.scenarios.map(scenario => (
    makeIdealRow(contract, cell, scenario, ordinal++)
  )));
}

await test('frozen contract has exactly 4+4 eligible scenarios and 4 dependency traps', () => {
  const contract = loadSyntheticContract();
  assert.equal(contract.scenarios.scenarios.length, 12);
  assert.deepEqual(contract.scenarios.scenarios.reduce((counts, scenario) => {
    counts[`${scenario.kind}${scenario.width}`] = (counts[`${scenario.kind}${scenario.width}`] || 0) + 1;
    return counts;
  }, {}), { independent2: 4, independent3: 4, dependency2: 4 });
  assert.deepEqual(contract.cells.cells.map(({ id }) => id), ['status-quo', 'ss-batch', 'parallel-bash']);
  assert.equal(contract.cells.maxSteps, 4);
});

await test('pre-outcome manifest freezes all 36 rows and refuses paid execution without its guardian', () => {
  let nonce = 1;
  const manifest = buildSyntheticPreOutcomeManifest({
    runId: 'phase2a-fixture',
    guardianSession: '12345678-1234-1234-1234-123456789abc',
    nonceFactory: () => (nonce++).toString(16).padStart(16, '0'),
    productSha256: { fixture: 'a'.repeat(64) },
    nativeBinary: FIXTURE_NATIVE,
  });
  assert.equal(manifest.rows.length, 36);
  assert.equal(new Set(manifest.rows.map(row => `${row.cellId}/${row.scenarioId}`)).size, 36);
  assert.throws(() => assertSyntheticPaidAuthorization({}), /SS_PHASE2A_EXECUTE/);
  assert.throws(() => assertSyntheticPaidAuthorization({ SS_PHASE2A_EXECUTE: '1' }), /spend guardian/);
  assert.deepEqual(assertSyntheticPaidAuthorization({
    SS_PHASE2A_EXECUTE: '1', SS_SPEND_GUARD_SESSION: '12345678-1234-1234-1234-123456789abc',
    CONCURRENCY: '1', RUN_ID: 'phase2a-fixture', OPENROUTER_API_KEY: 'fixture-only',
    SS_PHASE2A_EXPECT_NATIVE_SHA256: 'a'.repeat(64),
  }), {
    runId: 'phase2a-fixture', guardianSession: '12345678-1234-1234-1234-123456789abc',
    expectedNativeSha256: 'a'.repeat(64),
  });
});

await test('resolved OpenCode config requires maxSteps=4 and no ambient plugin', () => {
  assert.equal(validateSyntheticResolvedConfig({ plugin: [], agent: { build: { maxSteps: 4 } } }), true);
  assert.throws(() => validateSyntheticResolvedConfig({ plugin: ['ambient'], agent: { build: { maxSteps: 4 } } }), /ambient/);
  assert.throws(() => validateSyntheticResolvedConfig({ plugin: [], agent: { build: { maxSteps: 5 } } }), /maxSteps/);
});

await test('resolved native binary path and hash are frozen and any drift fails closed', () => {
  assert.deepEqual(assertResolvedNativeBinary(FIXTURE_NATIVE, { resolver: () => FIXTURE_NATIVE }), FIXTURE_NATIVE);
  assert.throws(() => assertResolvedNativeBinary(FIXTURE_NATIVE, {
    resolver: () => ({ ...FIXTURE_NATIVE, sha256: 'b'.repeat(64) }),
  }), /path\/hash drifted/);
  assert.throws(() => assertResolvedNativeBinary(FIXTURE_NATIVE, {
    resolver: () => ({ ...FIXTURE_NATIVE, path: '/workspace/other/sweet-search' }),
  }), /path\/hash drifted/);
});

await test('restricted Bash surface rejects &&, expansion, pipes, and non-scenario commands', () => {
  assert.throws(() => parseRestrictedShell('ss-search x -k 5 --mode auto && ss-grep y -k 8'), /forbidden/);
  assert.throws(() => parseRestrictedShell('ss-read "$(pwd)/x" 1 2'), /unsafe/);
  assert.throws(() => parseRestrictedShell('ss-search x -k 5 --mode auto | cat'), /unsupported/);
  assert.deepEqual(parseRestrictedShell("ss-search 'known query' -k 5 --mode hybrid")[0].argv,
    ['ss-search', 'known query', '-k', '5', '--mode', 'hybrid']);
});

await test('broker executes independent serial calls concurrently and deduplicates batch evidence', async () => {
  const contract = loadSyntheticContract();
  const scenario = contract.scenarios.scenarios[0];
  const runtime = materializeScenario(scenario, { nonce: '00000000000000aa' });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'phase2a-tools-'));
  try {
    const { binDir } = installSyntheticToolClients(path.join(dir, 'bin'));
    const serialBroker = await startSyntheticToolBroker({
      runtimeScenario: runtime, socketPath: path.join(dir, 'serial.sock'), delayMs: 1000,
    });
    const serial = await Promise.all(runtime.operations.map(operation => runClient(
      path.join(binDir, `ss-${operation.tool}`), syntheticOperationArgv(operation), serialBroker.socketPath,
    )));
    const serialAudit = serialBroker.audit();
    await serialBroker.close();
    assert.ok(serial.every(result => result.exitCode === 0), JSON.stringify(serial));
    assert.ok(Math.max(...serialAudit.map(row => row.startedAtMs)) < Math.min(...serialAudit.map(row => row.completedAtMs)));

    const batchBroker = await startSyntheticToolBroker({ runtimeScenario: runtime, socketPath: path.join(dir, 'batch.sock') });
    const batch = await runClient(path.join(binDir, 'ss-batch'), [batchPayload(runtime)], batchBroker.socketPath);
    const batchAudit = batchBroker.audit();
    await batchBroker.close();
    assert.equal(batch.exitCode, 0);
    assert.equal(batchAudit[0].operations.length, 2);
    assert.ok(batchAudit[0].operations.every(operation => operation.status === 'ok'));
    assert.ok(batch.stdout.length <= serial.reduce((sum, result) => sum + result.stdout.length, 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('dependency target is unavailable until the lead response and a batch error stays visible', async () => {
  const contract = loadSyntheticContract();
  const scenario = contract.scenarios.scenarios.find(({ kind }) => kind === 'dependency');
  const runtime = materializeScenario(scenario, { nonce: '00000000000000bb' });
  const [lead, dependent] = runtime.operations;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'phase2a-trap-'));
  try {
    const { binDir } = installSyntheticToolClients(path.join(dir, 'bin'));
    const earlyBroker = await startSyntheticToolBroker({ runtimeScenario: runtime, socketPath: path.join(dir, 'early.sock') });
    const earlyDependent = await runClient(
      path.join(binDir, `ss-${dependent.tool}`), syntheticOperationArgv(dependent), earlyBroker.socketPath,
    );
    await runClient(path.join(binDir, `ss-${lead.tool}`), syntheticOperationArgv(lead), earlyBroker.socketPath);
    assert.notEqual(earlyDependent.exitCode, 0);
    assert.ok(earlyBroker.audit().flatMap(row => row.operations).some(operation => operation.dependencyViolation));
    await earlyBroker.close();

    const orderedBroker = await startSyntheticToolBroker({ runtimeScenario: runtime, socketPath: path.join(dir, 'ordered.sock') });
    const leadResult = await runClient(path.join(binDir, `ss-${lead.tool}`), syntheticOperationArgv(lead), orderedBroker.socketPath);
    const dependentResult = await runClient(path.join(binDir, `ss-${dependent.tool}`), syntheticOperationArgv(dependent), orderedBroker.socketPath);
    assert.equal(leadResult.exitCode, 0);
    assert.equal(dependentResult.exitCode, 0);
    await orderedBroker.close();

    const batchBroker = await startSyntheticToolBroker({ runtimeScenario: runtime, socketPath: path.join(dir, 'trap-batch.sock') });
    const batch = await runClient(path.join(binDir, 'ss-batch'), [batchPayload(runtime)], batchBroker.socketPath);
    assert.equal(batch.exitCode, 0, 'outer envelope deliberately succeeds');
    assert.ok(batchBroker.audit()[0].operations.some(operation => operation.status === 'error'));
    await batchBroker.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('ideal 36-row screen passes all hard gates and selects ss-batch by frozen rule', () => {
  const report = evaluateSyntheticScreen(idealRows(loadSyntheticContract()));
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.selectedCell, 'ss-batch');
  assert.ok(report.candidates.every(candidate => candidate.verdict === 'PASS'));
  assert.ok(report.candidates.every(candidate => candidate.eligiblePacked === 8));
  assert.equal(report.stageUsage.modelSteps > 0, true);
});

await test('gate fails closed on hidden sibling errors, dependency violations, inflation, text-only, and hash drift', () => {
  const contract = loadSyntheticContract();
  const base = idealRows(contract);
  const hidden = structuredClone(base);
  const hiddenRow = hidden.find(row => row.cellId === 'ss-batch' && row.scenarioId === 'independent-2-auth');
  hiddenRow.audit[0].operations[1].status = 'error';
  assert.equal(evaluateSyntheticScreen(hidden).candidates.find(({ cellId }) => cellId === 'ss-batch').verdict, 'FAIL');

  const dependency = structuredClone(base);
  const dependencyRow = dependency.find(row => row.cellId === 'parallel-bash' && row.scenarioId === 'dependency-route');
  dependencyRow.audit[1].startedAtMs = dependencyRow.audit[0].returnedAtMs - 1;
  assert.equal(evaluateSyntheticScreen(dependency).candidates.find(({ cellId }) => cellId === 'parallel-bash').verdict, 'FAIL');

  const inflation = structuredClone(base);
  const inflationRow = inflation.find(row => row.cellId === 'ss-batch' && row.scenarioId === 'independent-2-auth');
  inflationRow.audit[0].stdout += 'z'.repeat(5000);
  assert.equal(evaluateSyntheticScreen(inflation).candidates.find(({ cellId }) => cellId === 'ss-batch').verdict, 'FAIL');

  const extraOps = structuredClone(base);
  for (const scenarioId of ['independent-2-auth', 'independent-2-transport']) {
    const row = extraOps.find(candidate => candidate.cellId === 'ss-batch' && candidate.scenarioId === scenarioId);
    row.audit.push(structuredClone(row.audit[0]));
  }
  const extraOpsVerdict = evaluateSyntheticScreen(extraOps).candidates.find(({ cellId }) => cellId === 'ss-batch');
  assert.ok(extraOpsVerdict.operationRatio > 1.05);
  assert.ok(extraOpsVerdict.reasons.some(reason => reason.includes('operation ratio')));

  const textOnly = structuredClone(base);
  const textRow = textOnly.find(row => row.cellId === 'parallel-bash' && row.scenarioId === 'independent-2-auth');
  textRow.audit = [];
  textRow.raw.stdout = textRow.raw.stdout.split('\n').filter(line => !line.includes('"type":"tool"')).join('\n');
  textRow.usage = usageFor(parseSyntheticOpenCodeStream(textRow.raw.stdout).steps, contract.cells.model);
  assert.equal(evaluateSyntheticScreen(textOnly).candidates.find(({ cellId }) => cellId === 'parallel-bash').verdict, 'FAIL');

  const drift = structuredClone(base);
  drift[0].configSha256 = '0'.repeat(64);
  assert.equal(evaluateSyntheticScreen(drift).verdict, 'FAIL');
});

console.log(`1..${passed}`);
