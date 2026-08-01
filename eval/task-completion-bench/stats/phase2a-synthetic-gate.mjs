#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { estimateTokens } from '../../../core/search/context-expander.js';
import {
  buildScenarioPrompt, buildCellInstruction, loadSyntheticContract, materializeScenario,
  parseSyntheticOpenCodeStream, serializeSyntheticArtifact, sha256, syntheticArtifactHashes,
} from '../harness/phase2a-synthetic-contract.mjs';
import { costFromTurns, priceFor } from '../harness/ideal-cost.mjs';
import {
  parseSyntheticBatchArgv, syntheticOperationArgv,
} from '../harness/phase2a-synthetic-tools.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const RESULTS = path.join(BENCH, 'results');
const COMMAND_TO_TOOL = Object.freeze({
  'ss-search': 'search', 'ss-grep': 'grep', 'ss-find': 'find', 'ss-read': 'read',
});
const EXPECTED_ROWS = 36;

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finiteTime(value) {
  return Number.isFinite(value) && value >= 0;
}

/** Parse only the narrow, non-mutating shell grammar admitted by this screen. */
export function parseRestrictedShell(command) {
  const source = String(command || '');
  if (!source || source.length > 65_536 || source.includes('\0') || source.includes('`')
      || source.includes('$(') || source.includes('${')) throw new Error('unsafe or empty Bash command');
  const commands = [];
  let tokens = [];
  let token = '';
  let quote = null;
  let escaped = false;
  const pushToken = () => { if (token) { tokens.push(token); token = ''; } };
  const pushCommand = separator => {
    pushToken();
    if (!tokens.length) throw new Error('empty shell segment');
    commands.push({ argv: tokens, separator });
    tokens = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) { token += char; escaped = false; continue; }
    if (quote === "'") {
      if (char === "'") quote = null; else token += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\') escaped = true;
      else if (char === '$') throw new Error('shell expansion is not allowed');
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '$' || char === '#' || char === '|' || char === '<' || char === '>') {
      throw new Error('unsupported shell syntax');
    }
    if (/\s/.test(char)) {
      if (char === '\n' && (token || tokens.length)) pushCommand('newline');
      else pushToken();
      continue;
    }
    if (char === ';' || char === '&') {
      const double = source[index + 1] === char;
      if (double && char === '&') throw new Error('&& is forbidden in the packing screen');
      if (double && char === '&') index += 1;
      pushCommand(double ? '&&' : char);
      continue;
    }
    token += char;
  }
  if (escaped || quote) throw new Error('unterminated shell quote or escape');
  pushToken();
  if (tokens.length) commands.push({ argv: tokens, separator: null });
  else if (commands.length && commands.at(-1).separator === '&&') throw new Error('trailing shell separator');
  if (!commands.length) throw new Error('empty Bash command');
  return commands;
}

function describeCommand(tokens, runtimeScenario) {
  const [command, ...argv] = tokens;
  if (command === 'ss-batch') {
    const parsed = parseSyntheticBatchArgv(argv);
    if (parsed.error) return { error: parsed.error, command, argv, operationIds: [] };
    const operationIds = [];
    for (const operation of parsed.operations) {
      const expected = runtimeScenario.operations.find(candidate => (
        candidate.id === operation.id && candidate.tool === operation.tool
        && sameJson(candidate.args, operation.args)
      ));
      if (!expected) return { error: 'batch contains an unexpected operation', command, argv, operationIds };
      operationIds.push(expected.id);
    }
    return { error: null, command, argv, operationIds, batch: true };
  }
  const tool = COMMAND_TO_TOOL[command];
  const operation = tool && runtimeScenario.operations.find(candidate => (
    candidate.tool === tool && sameJson(syntheticOperationArgv(candidate), argv)
  ));
  if (!operation) return { error: 'Bash command is not an exact scenario operation', command, argv, operationIds: [] };
  return { error: null, command, argv, operationIds: [operation.id], batch: false };
}

function parsedCallDescriptors(parsed, runtimeScenario, failures) {
  const calls = [];
  for (const call of parsed.calls) {
    if (!['bash', 'shell'].includes(call.tool)) {
      failures.push(`non-Bash tool call: ${call.tool || '<unknown>'}`);
      continue;
    }
    let shellCommands;
    try { shellCommands = parseRestrictedShell(call.command); }
    catch (error) { failures.push(`Bash surface violation: ${error.message}`); continue; }
    const descriptors = shellCommands.map(({ argv }) => describeCommand(argv, runtimeScenario));
    for (const descriptor of descriptors) if (descriptor.error) failures.push(descriptor.error);
    calls.push({ ...call, descriptors });
  }
  return calls;
}

function signature(command, argv) {
  return JSON.stringify([command, argv]);
}

function compareInvocationMultisets(calls, audit, failures) {
  const expected = new Map();
  const actual = new Map();
  for (const call of calls) for (const descriptor of call.descriptors) {
    const key = signature(descriptor.command, descriptor.argv);
    expected.set(key, (expected.get(key) || 0) + 1);
  }
  for (const invocation of audit) {
    const key = signature(invocation.command, invocation.argv);
    actual.set(key, (actual.get(key) || 0) + 1);
  }
  if (!sameJson([...expected.entries()].sort(), [...actual.entries()].sort())) {
    failures.push('OpenCode Bash calls do not match broker invocations');
  }
}

function validateAudit(audit, runtimeScenario, failures) {
  if (!Array.isArray(audit)) { failures.push('broker audit is missing'); return; }
  const counts = new Map(runtimeScenario.operations.map(({ id }) => [id, 0]));
  for (const invocation of audit) {
    if (!invocation || !finiteTime(invocation.startedAtMs) || !finiteTime(invocation.completedAtMs)
        || !finiteTime(invocation.returnedAtMs) || invocation.completedAtMs < invocation.startedAtMs
        || invocation.returnedAtMs < invocation.completedAtMs) failures.push('broker timing record is invalid');
    if (invocation.parseError) failures.push(`broker parse error: ${invocation.parseError}`);
    if (!Array.isArray(invocation.operations) || !invocation.operations.length) failures.push('empty broker invocation');
    for (const leaf of invocation.operations || []) {
      const expected = runtimeScenario.operations.find(({ id }) => id === leaf.id);
      if (!expected || leaf.tool !== expected.tool || !sameJson(leaf.args, expected.args)) {
        failures.push(`unexpected broker leaf ${leaf.id}`);
      } else counts.set(leaf.id, (counts.get(leaf.id) || 0) + 1);
    }
  }
  for (const [id, count] of counts) if (count !== 1) failures.push(`operation ${id} executed ${count} times`);
}

function validateUsage(usage, parsed, model, failures) {
  const steps = parsed.steps;
  if (!usage || usage.source !== 'opencode-step-finish' || !sameJson(usage.steps, steps)) {
    failures.push('per-step usage is missing or disagrees with the raw stream');
    return null;
  }
  if (steps.some(step => step.in < 0 || step.cached < 0 || step.out < 0 || step.cached > step.in)) {
    failures.push('per-step usage contains invalid token counts');
  }
  const price = priceFor(model);
  const costs = costFromTurns(steps, price);
  const totals = {
    in: steps.reduce((sum, step) => sum + step.in, 0),
    cached: steps.reduce((sum, step) => sum + step.cached, 0),
    out: steps.reduce((sum, step) => sum + step.out, 0),
  };
  if (!sameJson(usage.price, price) || !sameJson(usage.totals, totals)
      || Math.abs(usage.idealUsd - costs.idealUsd) > 1e-12
      || Math.abs(usage.estimatedRealizedUsd - costs.realFromTurnsUsd) > 1e-12) {
    failures.push('per-step usage cost derivation drifted');
  }
  return { steps, totals, idealUsd: costs.idealUsd, estimatedRealizedUsd: costs.realFromTurnsUsd };
}

function dependencyViolation(runtimeScenario, calls, audit) {
  if (runtimeScenario.kind !== 'dependency') return false;
  if (audit.some(invocation => invocation.command === 'ss-batch')) return true;
  if (audit.flatMap(invocation => invocation.operations || []).some(leaf => leaf.dependencyViolation)) return true;
  const leadInvocation = audit.find(invocation => invocation.operations?.some(leaf => leaf.id === runtimeScenario.leadId));
  const dependentInvocation = audit.find(invocation => invocation.operations?.some(leaf => leaf.id === runtimeScenario.dependentId));
  if (!leadInvocation || !dependentInvocation || dependentInvocation.startedAtMs < leadInvocation.returnedAtMs) return true;
  const callFor = id => calls.find(call => call.descriptors.some(descriptor => descriptor.operationIds.includes(id)));
  const leadCall = callFor(runtimeScenario.leadId);
  const dependentCall = callFor(runtimeScenario.dependentId);
  return !leadCall?.messageId || !dependentCall?.messageId || leadCall.messageId === dependentCall.messageId;
}

function isPacked(cellId, runtimeScenario, calls, audit) {
  if (runtimeScenario.kind !== 'independent') return false;
  if (cellId === 'ss-batch') {
    return calls.length === 1 && calls[0].descriptors.length === 1
      && calls[0].descriptors[0].batch === true && audit.length === 1
      && audit[0].command === 'ss-batch';
  }
  if (cellId === 'parallel-bash') {
    if (calls.length !== runtimeScenario.width || audit.length !== runtimeScenario.width
        || calls.some(call => call.descriptors.length !== 1 || call.descriptors[0].batch)) return false;
    const messageIds = new Set(calls.map(call => call.messageId).filter(Boolean));
    if (messageIds.size !== 1) return false;
    const latestStart = Math.max(...audit.map(invocation => invocation.startedAtMs));
    const earliestEnd = Math.min(...audit.map(invocation => invocation.completedAtMs));
    return latestStart < earliestEnd;
  }
  return false;
}

/** Strict, fail-closed adjudication for one retained Phase-2A result. */
export function classifySyntheticRow(row, { contract = loadSyntheticContract() } = {}) {
  const failures = [];
  const hashes = syntheticArtifactHashes(contract);
  const scenario = contract.scenarios.scenarios.find(({ id }) => id === row?.scenarioId);
  const cell = contract.cells.cells.find(({ id }) => id === row?.cellId);
  if (!scenario) failures.push('unknown scenario id');
  if (!cell) failures.push('unknown cell id');
  if (row?.schemaVersion !== 1) failures.push('row schemaVersion drifted');
  if (row?.scenarioSha256 !== hashes.scenarioSha256 || row?.cellSha256 !== hashes.cellSha256
      || row?.configSha256 !== hashes.configSha256) failures.push('contract/config hash mismatch');
  if (cell && row?.instructionSha256 !== hashes.instructionSha256ByCell[cell.id]) failures.push('instruction hash mismatch');
  if (scenario && row?.promptSha256 !== hashes.promptSha256ByScenario[scenario.id]) failures.push('prompt hash mismatch');
  if (row?.opencodeVersion !== contract.cells.opencodeVersion || row?.maxSteps !== contract.cells.maxSteps) {
    failures.push('OpenCode version/maxSteps mismatch');
  }
  if (!scenario || !cell) return { scenarioId: row?.scenarioId, cellId: row?.cellId, failures, valid: false };

  let runtimeScenario;
  try { runtimeScenario = materializeScenario(scenario, { nonce: row.scenarioNonce }); }
  catch (error) { failures.push(error.message); }
  if (runtimeScenario && row.runtimeScenarioSha256 !== sha256(serializeSyntheticArtifact(runtimeScenario))) {
    failures.push('runtime scenario hash mismatch');
  }
  const raw = row?.raw || {};
  if (raw.exitCode !== 0 || raw.timedOut === true || raw.outputTruncated === true) failures.push('agent process did not complete cleanly');
  const parsed = parseSyntheticOpenCodeStream(raw.stdout);
  if (parsed.errors.length) failures.push(...parsed.errors.map(error => `OpenCode stream: ${error}`));
  if (parsed.modelSteps < 1 || parsed.modelSteps > contract.cells.maxSteps) failures.push('model step count is out of bounds');
  const calls = runtimeScenario ? parsedCallDescriptors(parsed, runtimeScenario, failures) : [];
  const usage = validateUsage(row?.usage, parsed, contract.cells.model, failures);
  const audit = Array.isArray(row?.audit) ? row.audit : [];
  if (runtimeScenario) validateAudit(audit, runtimeScenario, failures);
  compareInvocationMultisets(calls, audit, failures);
  if (Array.isArray(row?.networkDenials) && row.networkDenials.length) failures.push('network denial/escape attempt observed');
  else if (!Array.isArray(row?.networkDenials)) failures.push('network denial audit is missing');
  if (!Array.isArray(row?.workspaceMutations)) failures.push('workspace mutation audit is missing');
  else if (row.workspaceMutations.length) failures.push('synthetic workspace was mutated');
  if (row?.secretLeakDetected !== false) failures.push('secret-leak audit is missing or nonzero');
  if (row?.preflight?.ssBatch !== true || row?.preflight?.opencodeVersion !== true
      || row?.preflight?.resolvedConfig !== true) failures.push('exact-jail preflight is incomplete');

  const expectedFacts = runtimeScenario.operations.map(({ fact }) => fact);
  const toolResultText = audit.map(invocation => `${invocation.stdout || ''}${invocation.stderr || ''}`).join('\n');
  for (const fact of expectedFacts) {
    if (!toolResultText.includes(fact)) failures.push(`tool results missing ${fact}`);
    if (!parsed.finalText.includes(fact)) failures.push(`final answer missing ${fact}`);
  }
  const hiddenSiblingErrors = audit.flatMap(invocation => invocation.operations || [])
    .filter(leaf => leaf.status !== 'ok').length;
  const hasDependencyViolation = dependencyViolation(runtimeScenario, calls, audit);
  if (hiddenSiblingErrors) failures.push(`${hiddenSiblingErrors} hidden/leaf operation error(s)`);
  if (hasDependencyViolation) failures.push('dependency-order violation');
  if (cell.id === 'status-quo' && audit.some(invocation => invocation.command === 'ss-batch')) {
    failures.push('status-quo cell used the treatment command');
  }

  return {
    scenarioId: scenario.id,
    cellId: cell.id,
    eligible: scenario.kind === 'independent',
    packed: isPacked(cell.id, runtimeScenario, calls, audit),
    dependencyViolation: hasDependencyViolation,
    hiddenSiblingErrors,
    operationCount: audit.reduce((sum, invocation) => sum + (invocation.operations?.length || 0), 0),
    resultTokens: estimateTokens(toolResultText),
    modelSteps: parsed.modelSteps,
    usage,
    failures,
    valid: failures.length === 0,
  };
}

function candidateSummary(cellId, classified, controls) {
  const rows = classified.filter(row => row.cellId === cellId);
  const reasons = [];
  if (rows.length !== 12 || rows.some(row => !row.valid)) reasons.push('one or more candidate rows are invalid');
  if ([...controls.values()].some(row => !row?.valid)) reasons.push('one or more status-quo rows are invalid');
  const eligiblePacked = rows.filter(row => row.eligible && row.packed).length;
  if (eligiblePacked !== 8) reasons.push(`eligible packing is ${eligiblePacked}/8, requires 8/8`);
  const dependencyViolations = rows.filter(row => row.dependencyViolation).length;
  const hiddenSiblingErrors = rows.reduce((sum, row) => sum + row.hiddenSiblingErrors, 0);
  if (dependencyViolations) reasons.push(`${dependencyViolations} dependency-trap violation(s)`);
  if (hiddenSiblingErrors) reasons.push(`${hiddenSiblingErrors} hidden sibling error(s)`);
  const candidateOps = rows.reduce((sum, row) => sum + row.operationCount, 0);
  const controlOps = [...controls.values()].reduce((sum, row) => sum + (row?.operationCount || 0), 0);
  const operationRatio = controlOps ? candidateOps / controlOps : Infinity;
  if (!(operationRatio <= 1.05)) reasons.push(`operation ratio ${operationRatio.toFixed(4)} exceeds 1.05`);
  let candidateTokens = 0;
  let controlTokens = 0;
  let tokenInflationPairs = 0;
  for (const row of rows) {
    const control = controls.get(row.scenarioId);
    candidateTokens += row.resultTokens;
    controlTokens += control?.resultTokens || 0;
    if (!control || row.resultTokens > control.resultTokens) tokenInflationPairs += 1;
  }
  const resultTokenRatio = controlTokens ? candidateTokens / controlTokens : Infinity;
  if (tokenInflationPairs || !(resultTokenRatio <= 1)) reasons.push('result tokens exceed the paired serial union');
  return {
    cellId, verdict: reasons.length ? 'FAIL' : 'PASS', reasons,
    eligiblePacked, eligibleTotal: 8, dependencyViolations, hiddenSiblingErrors,
    operationCount: candidateOps, controlOperationCount: controlOps, operationRatio,
    resultTokens: candidateTokens, controlResultTokens: controlTokens, resultTokenRatio,
    tokenInflationPairs,
  };
}

/** Evaluate all 12 paired rows for all three frozen cells and select deterministically. */
export function evaluateSyntheticScreen(rows, { contract = loadSyntheticContract() } = {}) {
  if (!Array.isArray(rows)) throw new Error('synthetic rows must be an array');
  const identities = rows.map(row => `${row?.cellId}/${row?.scenarioId}`);
  const duplicateIdentities = identities.filter((id, index) => identities.indexOf(id) !== index);
  const classified = rows.map(row => classifySyntheticRow(row, { contract }));
  const controls = new Map(classified.filter(row => row.cellId === 'status-quo').map(row => [row.scenarioId, row]));
  const candidates = ['ss-batch', 'parallel-bash'].map(cellId => candidateSummary(cellId, classified, controls));
  const shapeFailures = [];
  if (rows.length !== EXPECTED_ROWS) shapeFailures.push(`received ${rows.length} rows, requires ${EXPECTED_ROWS}`);
  if (new Set(identities).size !== EXPECTED_ROWS || duplicateIdentities.length) shapeFailures.push('row identities are missing or duplicated');
  const passing = candidates.filter(candidate => candidate.verdict === 'PASS').sort((left, right) => (
    right.eligiblePacked - left.eligiblePacked
    || left.resultTokenRatio - right.resultTokenRatio
    || left.operationRatio - right.operationRatio
    || (left.cellId === 'ss-batch' ? -1 : 1)
  ));
  const stageUsage = classified.reduce((total, row) => ({
    modelSteps: total.modelSteps + (row.usage?.steps.length || 0),
    inputTokens: total.inputTokens + (row.usage?.totals.in || 0),
    cachedInputTokens: total.cachedInputTokens + (row.usage?.totals.cached || 0),
    outputTokens: total.outputTokens + (row.usage?.totals.out || 0),
    idealUsd: total.idealUsd + (row.usage?.idealUsd || 0),
    estimatedRealizedUsd: total.estimatedRealizedUsd + (row.usage?.estimatedRealizedUsd || 0),
  }), {
    modelSteps: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
    idealUsd: 0, estimatedRealizedUsd: 0,
  });
  return {
    schemaVersion: 1,
    stage: 'phase2a-synthetic-packing',
    verdict: shapeFailures.length === 0 && passing.length ? 'PASS' : 'FAIL',
    selectedCell: shapeFailures.length ? null : (passing[0]?.cellId || null),
    shapeFailures,
    stageUsage,
    candidates,
    rows: classified,
  };
}

export function loadSyntheticRows(runId, { contract = loadSyntheticContract() } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(runId || '')) || /ho2|heldout/i.test(runId)) {
    throw new Error('invalid Phase-2A run id');
  }
  const runDir = path.join(RESULTS, runId, 'phase2a-synthetic', 'rows');
  return contract.cells.cells.flatMap(cell => contract.scenarios.scenarios.map(scenario => {
    const file = path.join(runDir, cell.id, scenario.id, 'result.json');
    return JSON.parse(readFileSync(file, 'utf8'));
  }));
}

function parseCli(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  if (argv.length !== 2 || argv[0] !== '--run-id') throw new Error('expected --run-id <phase2a-run-id>');
  return { help: false, runId: argv[1] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) console.log('Usage: node stats/phase2a-synthetic-gate.mjs --run-id <phase2a-run-id>');
    else {
      const report = evaluateSyntheticScreen(loadSyntheticRows(options.runId));
      console.log(serializeSyntheticArtifact(report).trimEnd());
      if (report.verdict !== 'PASS') process.exitCode = 1;
    }
  } catch (error) {
    console.error(`phase2a synthetic gate refused: ${error.message}`);
    process.exitCode = 2;
  }
}
