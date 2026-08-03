#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  jailArgv, jailDenials, jailEnv, jailPreflight, ROOT, startJail, stopJail,
} from './agent-jail.mjs';
import {
  buildCellInstruction, buildScenarioPrompt, buildSyntheticOpenCodeConfig,
  loadSyntheticContract, materializeScenario, parseSyntheticOpenCodeStream,
  serializeSyntheticArtifact, sha256,
  syntheticArtifactHashes,
} from './phase2a-synthetic-contract.mjs';
import { installSyntheticToolClients, startSyntheticToolBroker } from './phase2a-synthetic-tools.mjs';
import { costFromTurns, priceFor } from './ideal-cost.mjs';
import { evaluateSyntheticScreen } from '../stats/phase2a-synthetic-gate.mjs';
import { resolveNativeBinary } from '../../../core/infrastructure/native-resolver.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const RESULTS = path.join(BENCH, 'results');
const REAL_SS_BIN = path.join(ROOT, 'eval/agent-read-workflows/bin');
const THIS_FILE = fileURLToPath(import.meta.url);
const MAX_RAW_BYTES = 24 * 1024 * 1024;
const MAX_PREFLIGHT_BYTES = 2 * 1024 * 1024;
const AGENT_TIMEOUT_MS = 5 * 60_000;
const PRODUCT_FILES = Object.freeze([
  'eval/agent-read-workflows/bin/ss-batch',
  'eval/agent-read-workflows/bin/sweet-search',
  'core/cli.js',
  'core/search/search-batch.js',
  'core/search/search-batch-format.js',
  'core/search/search-server.js',
  'crates/sweet-search-cli/src/main.rs',
  'crates/sweet-search-cli/src/batch.rs',
  'crates/sweet-search-cli/src/batch_transport.rs',
  'crates/sweet-search-cli/Cargo.toml',
  'crates/sweet-search-cli/Cargo.lock',
]);

function validRunId(runId) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(runId || ''))
    && !/ho2|heldout/i.test(runId);
}

export function assertSyntheticPaidAuthorization(env = process.env) {
  if (env.SS_PHASE2A_EXECUTE !== '1') throw new Error('SS_PHASE2A_EXECUTE=1 is required');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(env.SS_SPEND_GUARD_SESSION || ''))) {
    throw new Error('the OpenRouter spend guardian must own this process');
  }
  if (env.CONCURRENCY !== '1') throw new Error('Phase-2A requires guardian-enforced CONCURRENCY=1');
  if (!validRunId(env.RUN_ID)) throw new Error('RUN_ID is invalid for Phase-2A');
  if (typeof env.OPENROUTER_API_KEY !== 'string' || !env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required only for an authorized run');
  }
  if (!/^[a-f0-9]{64}$/.test(String(env.SS_PHASE2A_EXPECT_NATIVE_SHA256 || ''))) {
    throw new Error('SS_PHASE2A_EXPECT_NATIVE_SHA256 must pin the reviewed Linux binary');
  }
  return {
    runId: env.RUN_ID,
    guardianSession: env.SS_SPEND_GUARD_SESSION,
    expectedNativeSha256: env.SS_PHASE2A_EXPECT_NATIVE_SHA256,
  };
}

function privateWrite(file, content, { exclusive = true } = {}) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { flag: exclusive ? 'wx' : 'w', mode: 0o600 });
  chmodSync(file, 0o600);
}

function productHashes() {
  return Object.fromEntries(PRODUCT_FILES.map(relative => {
    const file = path.join(ROOT, relative);
    if (!statSync(file).isFile()) throw new Error(`required product artifact is missing: ${relative}`);
    return [relative, sha256(readFileSync(file))];
  }));
}

export function resolvedNativeBinaryArtifact() {
  const candidate = resolveNativeBinary();
  if (!candidate) throw new Error('native sweet-search CLI binary did not resolve');
  const resolvedPath = realpathSync(candidate);
  const stat = statSync(resolvedPath);
  if (!stat.isFile() || (stat.mode & 0o111) === 0) throw new Error('resolved native CLI is not an executable file');
  const relative = path.relative(ROOT, resolvedPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('resolved native CLI is outside the frozen repository');
  }
  return {
    path: resolvedPath,
    repoRelativePath: relative.split(path.sep).join('/'),
    sha256: sha256(readFileSync(resolvedPath)),
    bytes: stat.size,
    platform: process.platform,
    arch: process.arch,
  };
}

export function assertResolvedNativeBinary(expected, { resolver = resolvedNativeBinaryArtifact } = {}) {
  const actual = resolver();
  if (!sameHashes(actual, expected)) throw new Error('resolved native CLI path/hash drifted from the frozen artifact');
  return actual;
}

export function buildSyntheticPreOutcomeManifest({
  runId, guardianSession = '00000000-0000-0000-0000-000000000000',
  nonceFactory = () => randomBytes(8).toString('hex'), contract = loadSyntheticContract(),
  productSha256 = productHashes(), nativeBinary = resolvedNativeBinaryArtifact(),
} = {}) {
  if (!validRunId(runId)) throw new Error('invalid Phase-2A manifest run id');
  const hashes = syntheticArtifactHashes(contract);
  const rows = contract.cells.cells.flatMap(cell => contract.scenarios.scenarios.map(scenario => {
    const nonce = nonceFactory(cell, scenario);
    const runtime = materializeScenario(scenario, { nonce });
    return {
      cellId: cell.id,
      scenarioId: scenario.id,
      scenarioNonce: nonce,
      runtimeScenarioSha256: sha256(serializeSyntheticArtifact(runtime)),
    };
  }));
  if (rows.length !== 36 || new Set(rows.map(row => `${row.cellId}/${row.scenarioId}`)).size !== 36) {
    throw new Error('Phase-2A manifest does not contain exactly 36 unique paired rows');
  }
  return {
    schemaVersion: 1,
    stage: 'phase2a-synthetic-packing',
    runId,
    frozenAt: new Date().toISOString(),
    guardianSessionSha256: sha256(guardianSession),
    concurrency: 1,
    rowOrder: 'status-quo then ss-batch then parallel-bash; scenario-file order within cell',
    model: contract.cells.model,
    provider: contract.cells.provider,
    harness: contract.cells.harness,
    opencodeVersion: contract.cells.opencodeVersion,
    maxSteps: contract.cells.maxSteps,
    maxChars: contract.cells.maxChars,
    ...hashes,
    productSha256,
    nativeBinary,
    selectionRule: contract.cells.selectionRule,
    rows,
  };
}

function safeStageDirectory(runId) {
  const runRoot = path.join(RESULTS, runId);
  const stageDir = path.join(runRoot, 'phase2a-synthetic');
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  if (existsSync(stageDir)) throw new Error('Phase-2A result directory already exists; refusing overwrite/resume');
  mkdirSync(stageDir, { mode: 0o700 });
  return stageDir;
}

function collectBounded(stream, state, field, proc, jail) {
  stream.on('data', chunk => {
    if (state.outputTruncated) return;
    state.bytes += chunk.length;
    if (state.bytes > state.maxBytes) {
      state.outputTruncated = true;
      if (jail) { try { process.kill(jail.initPid, 'SIGKILL'); } catch {} }
      try { proc.kill('SIGTERM'); } catch {}
      return;
    }
    state[field].push(chunk);
  });
}

export function spawnSyntheticCommand(bin, args, {
  cwd, env, timeoutMs = 30_000, maxBytes = MAX_PREFLIGHT_BYTES, jail = null,
} = {}) {
  if (jail) [bin, args] = jailArgv(jail, bin, args, cwd);
  return new Promise(resolve => {
    const state = { stdout: [], stderr: [], bytes: 0, maxBytes, outputTruncated: false };
    let settled = false;
    let timedOut = false;
    const proc = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = exitCode => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(state.stdout).toString('utf8'),
        stderr: Buffer.concat(state.stderr).toString('utf8'),
        exitCode, timedOut, outputTruncated: state.outputTruncated,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (jail) { try { process.kill(jail.initPid, 'SIGKILL'); } catch {} }
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 1000).unref();
    }, timeoutMs);
    collectBounded(proc.stdout, state, 'stdout', proc, jail);
    collectBounded(proc.stderr, state, 'stderr', proc, jail);
    proc.once('error', error => { state.stderr.push(Buffer.from(error.message)); finish(-1); });
    proc.once('exit', (code, signal) => finish(Number.isInteger(code) ? code : (signal ? -1 : 0)));
  });
}

function parseResolvedConfig(stdout) {
  const clean = String(stdout || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  try { return JSON.parse(clean); } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error('opencode debug config did not return JSON');
  }
}

export function validateSyntheticResolvedConfig(config, { maxSteps = 4 } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('resolved config is not an object');
  if (!Array.isArray(config.plugin) || config.plugin.length !== 0) throw new Error('ambient OpenCode plugin detected');
  if (config.agent?.build?.maxSteps !== maxSteps) throw new Error('resolved agent.build.maxSteps drifted');
  return true;
}

function sanitizeValue(value, secrets, key = '') {
  if (typeof value === 'string') {
    let output = value;
    for (const secret of secrets) if (secret) output = output.replaceAll(secret, '[REDACTED]');
    if (/api.?key|token|secret|password|authorization/i.test(key)
        && output !== '{env:OPENROUTER_API_KEY}' && output !== '[REDACTED]') return '[REDACTED]';
    return output;
  }
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([childKey, item]) => [childKey, sanitizeValue(item, secrets, childKey)]),
  );
  return value;
}

function redactText(text, secrets) {
  let output = String(text || '');
  let redactions = 0;
  for (const secret of secrets) {
    if (!secret) continue;
    const pieces = output.split(secret);
    redactions += pieces.length - 1;
    output = pieces.join('[REDACTED]');
  }
  return { output, redactions };
}

function usageFromStream(stdout, model) {
  const steps = parseSyntheticOpenCodeStream(stdout).steps;
  if (steps.some(step => Object.values(step).some(value => !Number.isFinite(value) || value < 0))) {
    throw new Error('OpenCode stream contains invalid per-step token usage');
  }
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

function snapshotDirectory(root) {
  const rows = [];
  const walk = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.posix.join(prefix, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) rows.push({ path: relative, type: 'symlink' });
      else if (stat.isDirectory()) { rows.push({ path: relative, type: 'directory' }); walk(absolute, relative); }
      else if (stat.isFile()) rows.push({ path: relative, type: 'file', bytes: stat.size, sha256: sha256(readFileSync(absolute)) });
      else rows.push({ path: relative, type: 'other' });
      if (rows.length > 1000) throw new Error('workspace snapshot exceeded 1000 entries');
    }
  };
  walk(root);
  return rows;
}

function makeAgentEnv({ binDir, socketPath, configFile, apiKey }) {
  const env = {
    HOME: process.env.HOME || '/root',
    PATH: `${binDir}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
    LANG: process.env.LANG || 'C.UTF-8',
    LC_ALL: process.env.LC_ALL || process.env.LANG || 'C.UTF-8',
    CI: '1', NO_COLOR: '1',
    OPENROUTER_API_KEY: apiKey,
    OPENCODE_CONFIG: configFile,
    OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: '30000',
    SS_PHASE2A_TOOL_SOCKET: socketPath,
  };
  return jailEnv(env);
}

async function exactJailPreflight({ jail, env, workspace, config, contract }) {
  const batch = await spawnSyntheticCommand(path.join(REAL_SS_BIN, 'ss-batch'), ['--help'], {
    cwd: workspace, env, jail,
  });
  if (batch.exitCode !== 0 || batch.timedOut || batch.outputTruncated
      || !batch.stdout.includes('sweet-search-batch-protocol=1')) throw new Error('ss-batch jail preflight failed');
  const version = await spawnSyntheticCommand('opencode', ['--version'], { cwd: workspace, env, jail });
  if (version.exitCode !== 0 || version.timedOut || version.outputTruncated
      || !new RegExp(`(^|\\D)${contract.cells.opencodeVersion.replaceAll('.', '\\.')}($|\\D)`).test(version.stdout)) {
    throw new Error(`pinned OpenCode ${contract.cells.opencodeVersion} is unavailable inside the jail`);
  }
  const debug = await spawnSyntheticCommand('opencode', ['debug', 'config'], { cwd: workspace, env, jail });
  if (debug.exitCode !== 0 || debug.timedOut || debug.outputTruncated) throw new Error('opencode debug config failed');
  const resolved = parseResolvedConfig(debug.stdout);
  validateSyntheticResolvedConfig(resolved, { maxSteps: contract.cells.maxSteps });
  if (sha256(serializeSyntheticArtifact(config)) !== syntheticArtifactHashes(contract).configSha256) {
    throw new Error('generated OpenCode config hash drifted');
  }
  return { batch, version, debug, resolved };
}

async function runSyntheticRowInTemp({
  runId, stageDir, manifestRow, cell, scenario, contract, manifest, apiKey, tempRoot,
}) {
  if (!sameHashes(productHashes(), manifest.productSha256)) throw new Error('product artifacts changed after pre-outcome freeze');
  assertResolvedNativeBinary(manifest.nativeBinary);
  const resultDir = path.join(stageDir, 'rows', cell.id, scenario.id);
  mkdirSync(resultDir, { recursive: true, mode: 0o700 });
  const workspace = path.join(tempRoot, 'workspace');
  const stateDir = path.join(tempRoot, 'state');
  const binDir = path.join(stateDir, 'bin');
  const opencodeData = path.join(resultDir, 'opencode-data');
  for (const directory of [workspace, stateDir, opencodeData]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const instruction = buildCellInstruction(cell);
  const prompt = buildScenarioPrompt(scenario);
  const runtimeScenario = materializeScenario(scenario, { nonce: manifestRow.scenarioNonce });
  const config = buildSyntheticOpenCodeConfig(contract.cells);
  const configText = serializeSyntheticArtifact(config);
  const configFile = path.join(stateDir, 'opencode.json');
  privateWrite(path.join(workspace, 'AGENTS.md'), instruction);
  privateWrite(configFile, configText);
  installSyntheticToolClients(binDir);
  const socketPath = path.join(stateDir, 'tools.sock');
  const env = makeAgentEnv({ binDir, socketPath, configFile, apiKey });
  const before = snapshotDirectory(workspace);
  let jail = null;
  let broker = null;
  let raw = null;
  let preflight = null;
  let audit = [];
  let networkDenials = [];
  try {
    broker = await startSyntheticToolBroker({ runtimeScenario, socketPath });
    const extraBinds = [
      ...(existsSync(path.join(env.HOME, '.cache/opencode')) ? [{
        src: path.join(env.HOME, '.cache/opencode'), dst: path.join(env.HOME, '.cache/opencode'), ro: true,
      }] : []),
      { src: opencodeData, dst: path.join(env.HOME, '.local/share/opencode') },
    ];
    jail = startJail({
      rundir: workspace, runnerStateDir: stateDir,
      label: `phase2a-${cell.id}-${scenario.id}`, extraBinds,
      extraMasks: [path.join(env.HOME, '.config/opencode')], allow: ['openrouter.ai'], requireBins: ['opencode'],
    });
    preflight = await exactJailPreflight({ jail, env, workspace, config, contract });
    const args = [
      'run', '--format', 'json', '--agent', 'build', '--auto',
      '--model', `openrouter/${contract.cells.model}`, '--dir', workspace, prompt,
    ];
    raw = await spawnSyntheticCommand('opencode', args, {
      cwd: workspace, env, jail, timeoutMs: AGENT_TIMEOUT_MS, maxBytes: MAX_RAW_BYTES,
    });
    audit = broker.audit();
    networkDenials = jailDenials(jail);
  } finally {
    if (jail) stopJail(jail);
    if (broker) await broker.close();
  }
  const after = snapshotDirectory(workspace);
  const opencodeStateFiles = snapshotDirectory(opencodeData);
  const workspaceMutations = sameHashes(before, after) ? [] : [{ before, after }];
  const secrets = [apiKey];
  const safeStdout = redactText(raw?.stdout, secrets);
  const safeStderr = redactText(raw?.stderr, secrets);
  const secretLeakDetected = safeStdout.redactions + safeStderr.redactions > 0;
  const safeResolved = sanitizeValue(preflight.resolved, secrets);
  const usage = usageFromStream(raw.stdout, contract.cells.model);
  const row = {
    schemaVersion: 1, runId, scenarioId: scenario.id, cellId: cell.id,
    scenarioNonce: manifestRow.scenarioNonce,
    scenarioSha256: manifest.scenarioSha256, cellSha256: manifest.cellSha256,
    configSha256: manifest.configSha256,
    instructionSha256: manifest.instructionSha256ByCell[cell.id],
    promptSha256: manifest.promptSha256ByScenario[scenario.id],
    runtimeScenarioSha256: manifestRow.runtimeScenarioSha256,
    nativeBinary: manifest.nativeBinary,
    opencodeVersion: contract.cells.opencodeVersion, maxSteps: contract.cells.maxSteps,
    raw: { ...raw, stdout: safeStdout.output, stderr: safeStderr.output },
    audit, networkDenials, workspaceMutations, opencodeStateFiles, secretLeakDetected, usage,
    preflight: { ssBatch: true, opencodeVersion: true, resolvedConfig: true },
  };
  privateWrite(path.join(resultDir, 'prompt.txt'), prompt);
  privateWrite(path.join(resultDir, 'AGENTS.md'), instruction);
  privateWrite(path.join(resultDir, 'opencode.json'), configText);
  privateWrite(path.join(resultDir, 'resolved-config.sanitized.json'), serializeSyntheticArtifact(safeResolved));
  privateWrite(path.join(resultDir, 'ss-batch-help.stdout'), preflight.batch.stdout);
  privateWrite(path.join(resultDir, 'ss-batch-help.stderr'), preflight.batch.stderr);
  privateWrite(path.join(resultDir, 'opencode-version.stdout'), preflight.version.stdout);
  privateWrite(path.join(resultDir, 'opencode-version.stderr'), preflight.version.stderr);
  privateWrite(path.join(resultDir, 'raw.ndjson'), safeStdout.output);
  privateWrite(path.join(resultDir, 'raw.stderr'), safeStderr.output);
  privateWrite(path.join(resultDir, 'broker-audit.json'), serializeSyntheticArtifact(audit));
  privateWrite(path.join(resultDir, 'usage.json'), serializeSyntheticArtifact(usage));
  privateWrite(path.join(resultDir, 'result.json'), serializeSyntheticArtifact(row));
  return row;
}

async function runSyntheticRow(options) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'ss-phase2a-'));
  chmodSync(tempRoot, 0o700);
  try { return await runSyntheticRowInTemp({ ...options, tempRoot }); }
  finally { rmSync(tempRoot, { recursive: true, force: true }); }
}

function sameHashes(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function runSyntheticScreen({ env = process.env } = {}) {
  const authorization = assertSyntheticPaidAuthorization(env);
  const isolation = jailPreflight();
  if (!isolation.ok) throw new Error(`Phase-2A isolation preflight failed: ${isolation.reasons.join('; ')}`);
  const contract = loadSyntheticContract();
  const nativeBinary = resolvedNativeBinaryArtifact();
  if (nativeBinary.sha256 !== authorization.expectedNativeSha256) {
    throw new Error(`resolved native CLI sha256 ${nativeBinary.sha256} does not match the reviewed pin`);
  }
  const manifest = buildSyntheticPreOutcomeManifest({
    runId: authorization.runId, guardianSession: authorization.guardianSession, contract, nativeBinary,
  });
  const stageDir = safeStageDirectory(authorization.runId);
  privateWrite(path.join(stageDir, 'pre-outcome-manifest.json'), serializeSyntheticArtifact(manifest));
  privateWrite(path.join(stageDir, 'opencode.json'), serializeSyntheticArtifact(buildSyntheticOpenCodeConfig(contract.cells)));
  const rows = [];
  for (const manifestRow of manifest.rows) {
    const cell = contract.cells.cells.find(({ id }) => id === manifestRow.cellId);
    const scenario = contract.scenarios.scenarios.find(({ id }) => id === manifestRow.scenarioId);
    console.error(`[phase2a] ${cell.id}/${scenario.id}`);
    const row = await runSyntheticRow({
      runId: authorization.runId, stageDir, manifestRow, cell, scenario, contract, manifest,
      apiKey: env.OPENROUTER_API_KEY,
    });
    rows.push(row);
    // Agent-CLI infrastructure hosts fire on every rollout (OpenCode's model
    // catalogue/telemetry, plus its npm-registry updater ping) and are NOT agent
    // escape attempts — models.dev/telemetry mirror escape-audit.mjs
    // HARNESS_HOSTS. registry.npmjs.org is excluded HERE ONLY: synthetic
    // scenarios have no task repo and no legitimate npm use, unlike the main
    // bench audit where npm stays counted. All denials stay recorded in the
    // row; only non-harness denials stop the screen.
    const agentDenials = row.networkDenials.filter(
      (d) => !/^(models\.dev|.*\.models\.dev|telemetry\..*|.*\.sentry\.io|registry\.npmjs\.org)$/i.test(String(d.host || '')));
    if (row.raw.timedOut || row.raw.outputTruncated || agentDenials.length || row.workspaceMutations.length
        || !row.opencodeStateFiles.some(file => file.type === 'file')
        || row.secretLeakDetected) throw new Error(`integrity stop after ${cell.id}/${scenario.id}`);
  }
  const report = evaluateSyntheticScreen(rows, { contract });
  privateWrite(path.join(stageDir, 'gate-report.json'), serializeSyntheticArtifact(report));
  console.log(JSON.stringify({ verdict: report.verdict, selectedCell: report.selectedCell, resultDir: stageDir }));
  return report;
}

function usage() {
  return [
    'Phase-2A synthetic packing runner (no calls by default).',
    'Manifest only: node harness/phase2a-synthetic-runner.mjs --manifest <run-id>',
    'Paid execution: SS_PHASE2A_EXECUTE=1 SS_PHASE2A_EXPECT_NATIVE_SHA256=<reviewed-linux-sha256> RUN_ID=<id> OPENROUTER_API_KEY=... node eval/task-completion-bench/harness/openrouter-spend-guardian.mjs --entrypoint eval/task-completion-bench/harness/phase2a-synthetic-runner.mjs',
  ].join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--help') { console.log(usage()); return; }
  if (argv.length === 2 && argv[0] === '--manifest') {
    console.log(serializeSyntheticArtifact(buildSyntheticPreOutcomeManifest({ runId: argv[1] })).trimEnd());
    return;
  }
  if (argv.length) throw new Error('unknown Phase-2A runner arguments');
  await runSyntheticScreen();
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  try { await main(); }
  catch (error) { console.error(`phase2a synthetic runner refused: ${error.message}`); process.exitCode = 2; }
}
