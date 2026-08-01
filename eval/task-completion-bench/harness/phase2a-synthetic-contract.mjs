import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCENARIO_FILE = path.join(HERE, 'phase2a-synthetic-scenarios.json');
export const CELL_FILE = path.join(HERE, 'phase2a-synthetic-cells.json');
export const FROZEN_SCENARIO_SHA256 = 'f14bc06fed85f05a311eb12a213549cd48bda017ab52cc3d039d29473fc47144';
export const FROZEN_CELL_SHA256 = '4368c0fd35ddf4235584d5dae03fd1407fb0e72a12e43bfd9e1221d2d0a4d6fd';
export const SYNTHETIC_SCHEMA_VERSION = 1;
export const SYNTHETIC_CELLS = Object.freeze(['status-quo', 'ss-batch', 'parallel-bash']);
const OP_TO_COMMAND = Object.freeze({
  search: 'ss-search', grep: 'ss-grep', find: 'ss-find', read: 'ss-read',
});
const ID_RE = /^[a-z][a-z0-9-]{2,63}$/;
const OP_ID_RE = /^[a-z][a-z0-9_]{2,31}$/;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(message) {
  throw new Error(`invalid Phase-2A synthetic contract: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} fields are ${actual.join(',')}; expected ${wanted.join(',')}`);
  }
}

function assertJsonArgs(args, label) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail(`${label}.args must be an object`);
  const encoded = JSON.stringify(args);
  if (encoded.length > 4096 || encoded.includes('\u0000')) fail(`${label}.args are unsafe or too large`);
}

function validateOperation(operation, label, { dependency = false } = {}) {
  exactKeys(operation, dependency
    ? ['id', 'tool', 'args', 'fact']
    : ['id', 'tool', 'args', 'serialCommand', 'fact'], label);
  if (!OP_ID_RE.test(operation.id)) fail(`${label}.id is invalid`);
  if (!Object.hasOwn(OP_TO_COMMAND, operation.tool)) fail(`${label}.tool is unsupported`);
  assertJsonArgs(operation.args, label);
  if (!dependency && (typeof operation.serialCommand !== 'string'
      || !operation.serialCommand.startsWith(`${OP_TO_COMMAND[operation.tool]} `))) {
    fail(`${label}.serialCommand does not match its tool`);
  }
  if (!/^FACT_[A-Z0-9_]{4,80}$/.test(operation.fact)) fail(`${label}.fact is invalid`);
}

function validateScenarios(document) {
  exactKeys(document, ['schemaVersion', 'seed', 'scenarios'], 'scenario document');
  if (document.schemaVersion !== SYNTHETIC_SCHEMA_VERSION || document.seed !== 20260731) {
    fail('scenario schemaVersion/seed drifted');
  }
  if (!Array.isArray(document.scenarios) || document.scenarios.length !== 12) fail('exactly 12 scenarios are required');
  const scenarioIds = new Set();
  const operationIds = new Set();
  const facts = new Set();
  const counts = { independent2: 0, independent3: 0, dependency: 0 };
  for (const scenario of document.scenarios) {
    const isDependency = scenario.kind === 'dependency';
    exactKeys(scenario, isDependency
      ? ['id', 'kind', 'width', 'leadId', 'dependentId', 'operations']
      : ['id', 'kind', 'width', 'operations'], `scenario ${scenario?.id || '<unknown>'}`);
    if (!ID_RE.test(scenario.id) || scenarioIds.has(scenario.id)) fail(`bad or duplicate scenario id ${scenario.id}`);
    scenarioIds.add(scenario.id);
    if (!Array.isArray(scenario.operations) || scenario.operations.length !== scenario.width
        || ![2, 3].includes(scenario.width)) fail(`${scenario.id} has invalid width`);
    if (isDependency) {
      counts.dependency++;
      if (scenario.width !== 2) fail(`${scenario.id} dependency width must be 2`);
      if (scenario.leadId === scenario.dependentId) fail(`${scenario.id} dependency ids collide`);
    } else if (scenario.kind === 'independent' && scenario.width === 2) counts.independent2++;
    else if (scenario.kind === 'independent' && scenario.width === 3) counts.independent3++;
    else fail(`${scenario.id} kind/width is invalid`);
    for (const operation of scenario.operations) {
      const dependent = isDependency && operation.id === scenario.dependentId;
      validateOperation(operation, `${scenario.id}.${operation.id}`, { dependency: dependent });
      if (operationIds.has(operation.id)) fail(`duplicate operation id ${operation.id}`);
      if (facts.has(operation.fact)) fail(`duplicate FACT token ${operation.fact}`);
      operationIds.add(operation.id);
      facts.add(operation.fact);
      const encoded = JSON.stringify(operation.args);
      if (dependent !== encoded.includes('$lead.path')) fail(`${scenario.id}.${operation.id} dependency placeholder mismatch`);
    }
    if (isDependency) {
      if (!scenario.operations.some(({ id }) => id === scenario.leadId)
          || !scenario.operations.some(({ id }) => id === scenario.dependentId)) {
        fail(`${scenario.id} dependency ids are missing from operations`);
      }
    }
  }
  if (counts.independent2 !== 4 || counts.independent3 !== 4 || counts.dependency !== 4) {
    fail(`scenario strata drifted: ${JSON.stringify(counts)}`);
  }
  return document;
}

function validateCells(document) {
  exactKeys(document, [
    'schemaVersion', 'model', 'provider', 'harness', 'opencodeVersion', 'maxSteps',
    'maxChars', 'cells', 'selectionRule',
  ], 'cell document');
  if (document.schemaVersion !== SYNTHETIC_SCHEMA_VERSION
      || document.model !== 'x-ai/grok-4.5' || document.provider !== 'openrouter'
      || document.harness !== 'opencode' || document.opencodeVersion !== '1.18.4'
      || document.maxSteps !== 4 || document.maxChars !== 16000) fail('pinned cell configuration drifted');
  if (!Array.isArray(document.cells) || document.cells.length !== 3) fail('exactly three cells are required');
  const ids = document.cells.map((cell, index) => {
    exactKeys(cell, ['id', 'mode', 'instruction'], `cell ${index}`);
    if (!SYNTHETIC_CELLS.includes(cell.id) || typeof cell.instruction !== 'string'
        || cell.instruction.length < 100 || cell.instruction.length > 900) fail(`cell ${index} is invalid`);
    return cell.id;
  });
  if (JSON.stringify(ids) !== JSON.stringify(SYNTHETIC_CELLS)) fail('cell order or identity drifted');
  if (!Array.isArray(document.selectionRule) || document.selectionRule.length !== 5) fail('selection rule drifted');
  return document;
}

/** Load and byte-verify the immutable Phase-2A scenario and cell files. */
export function loadSyntheticContract({
  scenarioFile = SCENARIO_FILE,
  cellFile = CELL_FILE,
  expectedScenarioSha256 = FROZEN_SCENARIO_SHA256,
  expectedCellSha256 = FROZEN_CELL_SHA256,
} = {}) {
  const scenarioRaw = readFileSync(scenarioFile);
  const cellRaw = readFileSync(cellFile);
  const scenarioSha256 = sha256(scenarioRaw);
  const cellSha256 = sha256(cellRaw);
  if (scenarioSha256 !== expectedScenarioSha256) fail(`scenario sha256 ${scenarioSha256} != ${expectedScenarioSha256}`);
  if (cellSha256 !== expectedCellSha256) fail(`cell sha256 ${cellSha256} != ${expectedCellSha256}`);
  let scenarios;
  let cells;
  try {
    scenarios = validateScenarios(JSON.parse(scenarioRaw));
    cells = validateCells(JSON.parse(cellRaw));
  } catch (error) {
    if (String(error.message).startsWith('invalid Phase-2A')) throw error;
    fail(`JSON parse failed: ${error.message}`);
  }
  return { scenarios, cells, scenarioSha256, cellSha256 };
}

function replaceLeadPath(value, dynamicPath) {
  if (typeof value === 'string') return value.replaceAll('$lead.path', dynamicPath);
  if (Array.isArray(value)) return value.map(item => replaceLeadPath(item, dynamicPath));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, replaceLeadPath(item, dynamicPath)]),
  );
  return value;
}

/** Instantiate a scenario without leaking the dependency target into model-visible text. */
export function materializeScenario(scenario, { nonce } = {}) {
  if (!/^[a-f0-9]{16}$/.test(String(nonce || ''))) throw new Error('scenario nonce must be 16 lowercase hex characters');
  const dynamicPath = `.phase2a-hidden/${scenario.id}-${nonce}.txt`;
  const operations = scenario.operations.map(operation => ({
    ...structuredClone(operation), args: replaceLeadPath(operation.args, dynamicPath),
  }));
  return {
    schemaVersion: SYNTHETIC_SCHEMA_VERSION,
    id: scenario.id,
    kind: scenario.kind,
    width: scenario.width,
    ...(scenario.kind === 'dependency' ? {
      leadId: scenario.leadId, dependentId: scenario.dependentId, dynamicPath,
    } : {}),
    operations,
  };
}

function operationLine(operation) {
  return `- ${operation.id}: tool=${operation.tool}; args=${JSON.stringify(operation.args)}; serial Bash form: ${operation.serialCommand}`;
}

/** Scenario prompt is byte-identical across the three cells. */
export function buildScenarioPrompt(scenario) {
  const lines = [
    `Synthetic read-only scenario ${scenario.id}.`,
    'Execute every operation exactly once with the specified ids and arguments, then answer with every FACT token actually returned.',
  ];
  if (scenario.kind === 'independent') {
    lines.push('All operations below are independent; every argument is already known.');
    lines.push(...scenario.operations.map(operationLine));
  } else {
    const lead = scenario.operations.find(({ id }) => id === scenario.leadId);
    const dependent = scenario.operations.find(({ id }) => id === scenario.dependentId);
    lines.push(`First execute ${lead.id}: ${lead.serialCommand}.`);
    lines.push(`Its output will reveal next_path. Only after observing that result, execute ${dependent.id} with tool=read, path=<the exact next_path>, startLine=${dependent.args.startLine}, endLine=${dependent.args.endLine}.`);
    lines.push('The dependent path is intentionally unknowable before the first result. Do not guess it, batch it, or co-issue it.');
  }
  return `${lines.join('\n')}\n`;
}

export function buildCellInstruction(cell) {
  return `# Phase-2A synthetic packing screen v1\n\n${cell.instruction}\n`;
}

export function serializeSyntheticArtifact(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Generated config is secret-free and identical across all scenarios/cells. */
export function buildSyntheticOpenCodeConfig(cellDocument) {
  return {
    $schema: 'https://opencode.ai/config.json',
    plugin: [],
    provider: { openrouter: { options: { apiKey: '{env:OPENROUTER_API_KEY}' } } },
    agent: { build: { maxSteps: cellDocument.maxSteps } },
    permission: {
      bash: 'allow', edit: 'deny', write: 'deny', read: 'deny',
      webfetch: 'deny', websearch: 'deny',
    },
  };
}

/** Expected immutable/configuration hashes recorded on every result row. */
export function syntheticArtifactHashes(contract = loadSyntheticContract()) {
  const configText = serializeSyntheticArtifact(buildSyntheticOpenCodeConfig(contract.cells));
  return {
    scenarioSha256: contract.scenarioSha256,
    cellSha256: contract.cellSha256,
    configSha256: sha256(configText),
    instructionSha256ByCell: Object.fromEntries(contract.cells.cells.map(cell => (
      [cell.id, sha256(buildCellInstruction(cell))]
    ))),
    promptSha256ByScenario: Object.fromEntries(contract.scenarios.scenarios.map(scenario => (
      [scenario.id, sha256(buildScenarioPrompt(scenario))]
    ))),
  };
}

function eventPart(event) {
  return event?.part || event?.properties?.part || event;
}

/** Parse retained OpenCode NDJSON without truncating tool evidence. */
export function parseSyntheticOpenCodeStream(stdout) {
  const calls = new Map();
  const order = [];
  const text = [];
  const errors = [];
  const steps = [];
  let sessionId = null;
  let modelSteps = 0;
  for (const [lineIndex, line] of String(stdout || '').split('\n').entries()) {
    if (!line.trim().startsWith('{')) continue;
    let event;
    try { event = JSON.parse(line); } catch { errors.push(`invalid JSON line ${lineIndex + 1}`); continue; }
    const part = eventPart(event);
    sessionId ||= event.sessionID || event.sessionId || event.session_id
      || part?.sessionID || part?.sessionId || part?.session_id || null;
    const type = event.type || part?.type;
    if (type === 'step_finish' || type === 'step-finish') {
      modelSteps++;
      const tokens = part?.tokens || {};
      const cache = tokens.cache || {};
      const cached = Number(cache.read) || 0;
      const cacheWrite = Number(cache.write) || 0;
      steps.push({
        in: (Number(tokens.input) || 0) + cached + cacheWrite,
        cached,
        out: (Number(tokens.output) || 0) + (Number(tokens.reasoning) || 0),
      });
    }
    if (type === 'text' && typeof part?.text === 'string' && part.text.trim()) text.push(part.text);
    if (type === 'error') errors.push(String(part?.message || part?.error || JSON.stringify(part)).slice(0, 1000));
    if (!(type === 'tool_use' || type === 'tool' || (part?.tool && (part.state || part.callID || part.callId)))) continue;
    const state = part.state || {};
    const callId = String(part.callID || part.callId || state.callID || state.callId || `line-${lineIndex}`);
    if (!calls.has(callId)) order.push(callId);
    const input = state.input || part.input || {};
    const output = state.output ?? part.output ?? '';
    calls.set(callId, {
      callId,
      tool: String(part.tool || '').toLowerCase(),
      command: String(input.command || input.cmd || ''),
      messageId: part.messageID || part.messageId || part.message_id
        || event.messageID || event.messageId || event.message_id || null,
      status: state.status || part.status || null,
      output: typeof output === 'string' ? output : JSON.stringify(output),
      isError: (state.status || part.status) === 'error',
      lineIndex,
    });
  }
  return {
    sessionId, modelSteps, calls: order.map(id => calls.get(id)),
    finalText: text.join('\n'), errors, steps,
  };
}

function operationNeedle(operation) {
  if (operation.tool === 'search' || operation.tool === 'find') return operation.args.query;
  if (operation.tool === 'grep') return operation.args.pattern;
  if (operation.tool === 'read') return operation.args.path;
  return operation.id;
}

export function matchCommandOperations(command, runtimeScenario) {
  const text = String(command || '');
  return runtimeScenario.operations
    .filter(operation => text.includes(operation.id) || text.includes(operationNeedle(operation)))
    .map(operation => operation.id);
}

export function syntheticContractSummary(contract = loadSyntheticContract()) {
  return {
    schemaVersion: SYNTHETIC_SCHEMA_VERSION,
    scenarioSha256: contract.scenarioSha256,
    cellSha256: contract.cellSha256,
    scenarios: contract.scenarios.scenarios.length,
    cells: contract.cells.cells.map(({ id }) => id),
    model: contract.cells.model,
    provider: contract.cells.provider,
    harness: contract.cells.harness,
    opencodeVersion: contract.cells.opencodeVersion,
    maxSteps: contract.cells.maxSteps,
    maxChars: contract.cells.maxChars,
  };
}
