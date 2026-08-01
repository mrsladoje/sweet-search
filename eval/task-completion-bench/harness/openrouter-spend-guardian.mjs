#!/usr/bin/env node
// Cumulative OpenRouter spend guard for one paid task-completion-bench session.
// It owns one detached process group, polls the current key's total usage, and
// never discovers or signals processes by name. The immutable state file keeps
// a later invocation from silently resetting the session baseline.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const RESULTS = path.join(BENCH, 'results');
const DEFAULT_ENTRYPOINT = path.join(HERE, 'run-pilot.mjs');
const THIS_FILE = fileURLToPath(import.meta.url);
const INTERNAL_SUPERVISOR_ARG = '--internal-supervise';
const OPENROUTER_KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';

export const SPEND_POLICY = Object.freeze({
  hardCapUsd: 50,
  operationalStopUsd: 45,
  reserveUsd: 5,
  pollMs: 5_000,
  requestTimeoutMs: 3_000,
  pollRetryAttempts: 12,
  pollRetryMs: 2_000,
  terminateGraceMs: 2_000,
});

const EXIT = Object.freeze({
  usagePollFailed: 71,
  operationalStop: 72,
  stateRefused: 73,
  childFailed: 74,
  interrupted: 75,
});
const MAX_RESPONSE_BYTES = 64 * 1024;
const EPSILON_USD = 1e-9;

export class GuardianError extends Error {
  constructor(code, message, exitCode = EXIT.stateRefused) {
    super(message);
    this.name = 'GuardianError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

function delay(ms, { unref = true } = {}) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    if (unref) timer.unref?.();
  });
}

function money(value) {
  return Number(value).toFixed(6);
}

function validatePositiveNumber(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new GuardianError('invalid-config', `${name} must be a positive number`);
  }
}

function validateOptions({ hardCapUsd, operationalStopUsd, reserveUsd, pollMs, requestTimeoutMs, pollRetryAttempts, pollRetryMs, terminateGraceMs }) {
  for (const [name, value] of Object.entries({ hardCapUsd, operationalStopUsd, reserveUsd, pollMs, requestTimeoutMs, pollRetryAttempts, pollRetryMs, terminateGraceMs })) {
    validatePositiveNumber(name, value);
  }
  if (operationalStopUsd >= hardCapUsd) {
    throw new GuardianError('invalid-config', 'operational stop must be below the hard cap');
  }
  if (Math.abs((hardCapUsd - operationalStopUsd) - reserveUsd) > EPSILON_USD) {
    throw new GuardianError('invalid-config', 'reserve must equal hard cap minus operational stop');
  }
}

export function validateRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(runId || ''))) {
    throw new GuardianError('invalid-run-id', 'RUN_ID must use 1-128 letters, digits, dots, underscores, or dashes');
  }
  return runId;
}

export function validateEntrypoint(candidate) {
  let resolved;
  try {
    resolved = realpathSync(path.resolve(candidate));
  } catch {
    throw new GuardianError('invalid-entrypoint', 'entrypoint does not exist');
  }
  const harnessRoot = realpathSync(HERE);
  if (!resolved.startsWith(`${harnessRoot}${path.sep}`) || path.extname(resolved) !== '.mjs' || !statSync(resolved).isFile()) {
    throw new GuardianError('invalid-entrypoint', 'entrypoint must be an .mjs file inside the bench harness directory');
  }
  return resolved;
}

export function parseUsagePayload(payload) {
  const usage = payload?.data?.usage;
  if (typeof usage !== 'number' || !Number.isFinite(usage) || usage < 0) {
    throw new GuardianError('poll-schema', 'provider usage response did not contain a finite non-negative data.usage', EXIT.usagePollFailed);
  }
  return usage;
}

export async function fetchOpenRouterUsage({
  apiKey,
  endpoint = OPENROUTER_KEY_ENDPOINT,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = SPEND_POLICY.requestTimeoutMs,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey) {
    throw new GuardianError('missing-key', 'OPENROUTER_API_KEY is required', EXIT.usagePollFailed);
  }
  if (typeof fetchImpl !== 'function') {
    throw new GuardianError('missing-fetch', 'this Node runtime does not provide fetch', EXIT.usagePollFailed);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  timeout.unref?.();
  let response;
  let text;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response || response.status !== 200) {
      const status = Number.isInteger(response?.status) ? response.status : 'unknown';
      throw new GuardianError('poll-http', `provider usage poll returned HTTP ${status}`, EXIT.usagePollFailed);
    }
    const declaredBytes = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RESPONSE_BYTES) {
      throw new GuardianError('poll-response-large', 'provider usage response exceeded the size limit', EXIT.usagePollFailed);
    }
    text = await response.text();
  } catch (error) {
    if (error instanceof GuardianError) throw error;
    throw new GuardianError('poll-network', 'provider usage poll failed', EXIT.usagePollFailed);
  } finally {
    clearTimeout(timeout);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new GuardianError('poll-response-large', 'provider usage response exceeded the size limit', EXIT.usagePollFailed);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new GuardianError('poll-json', 'provider usage response was not valid JSON', EXIT.usagePollFailed);
  }
  return parseUsagePayload(payload);
}

async function fetchUsageWithRetry({ apiKey, endpoint, fetchImpl, policy, logger }) {
  let lastError;
  for (let attempt = 1; attempt <= policy.pollRetryAttempts; attempt += 1) {
    try {
      return await fetchOpenRouterUsage({
        apiKey, endpoint, fetchImpl, requestTimeoutMs: policy.requestTimeoutMs,
      });
    } catch (error) {
      lastError = error;
      if (attempt < policy.pollRetryAttempts) {
        logger(`provider usage poll attempt ${attempt}/${policy.pollRetryAttempts} failed; retrying`);
        await delay(policy.pollRetryMs, { unref: false });
      }
    }
  }
  throw lastError;
}

function childOutcome(child) {
  return new Promise(resolve => {
    let settled = false;
    const finish = outcome => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    child.once('error', () => finish({ kind: 'spawn-error' }));
    child.once('exit', (code, signal) => finish({ kind: 'exit', code, signal }));
  });
}

function abortOutcome(signal) {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve({ kind: 'abort' });
  return new Promise(resolve => signal.addEventListener('abort', () => resolve({ kind: 'abort' }), { once: true }));
}

async function terminateOwnedGroup(child, { terminateGraceMs, killImpl, logger }) {
  if (!Number.isInteger(child?.pid) || child.pid <= 0) return;
  const groupPid = -child.pid;
  try {
    killImpl(groupPid, 'SIGTERM');
    logger(`sent SIGTERM to owned process group ${child.pid}`);
  } catch (error) {
    if (error?.code !== 'ESRCH') logger('could not send SIGTERM to the owned process group');
  }
  await delay(terminateGraceMs, { unref: false });
  try {
    killImpl(groupPid, 'SIGKILL');
    logger(`sent SIGKILL to owned process group ${child.pid}`);
  } catch (error) {
    if (error?.code !== 'ESRCH') logger('could not send SIGKILL to the owned process group');
  }
}

function ownedGroupAlive(child, killImpl) {
  if (!Number.isInteger(child?.pid) || child.pid <= 0) return false;
  try {
    killImpl(-child.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function persistSessionState({ statePath, sessionId, runId, baselineUsageUsd, observedUsageAtStartUsd, policy, entrypoint }) {
  mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  if (existsSync(statePath)) {
    throw new GuardianError('state-exists', 'spend session state already exists; refusing to reset its baseline');
  }
  const commandIdentity = [process.execPath, realpathSync(entrypoint)];
  const state = {
    schemaVersion: 1,
    sessionId,
    runId,
    startedAt: new Date().toISOString(),
    provider: 'openrouter',
    usageEndpoint: '/api/v1/key',
    baselineUsageUsd,
    observedUsageAtStartUsd,
    carryoverUsageUsd: observedUsageAtStartUsd - baselineUsageUsd,
    hardCapUsd: policy.hardCapUsd,
    operationalStopUsd: policy.operationalStopUsd,
    reserveUsd: policy.reserveUsd,
    pollMs: policy.pollMs,
    concurrency: 1,
    entrypoint: path.relative(BENCH, entrypoint),
    commandSha256: createHash('sha256').update(JSON.stringify(commandIdentity)).digest('hex'),
  };
  try {
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new GuardianError('state-exists', 'spend session state already exists; refusing to reset its baseline');
    }
    throw new GuardianError('state-write', 'could not persist immutable spend session state');
  }
  return state;
}

function persistFinalReceipt(receiptPath, receipt) {
  try {
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch {
    throw new GuardianError('receipt-write', 'could not persist final spend receipt');
  }
}

export async function runSpendGuardian({
  runId,
  entrypoint,
  statePath,
  receiptPath = path.join(path.dirname(statePath), 'openrouter-spend-receipt.json'),
  apiKey,
  endpoint = OPENROUTER_KEY_ENDPOINT,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  killImpl = process.kill.bind(process),
  childEnv = process.env,
  logger = message => console.error(`[spend-guardian] ${message}`),
  abortSignal,
  policy = SPEND_POLICY,
  cumulativeBaselineUsageUsd = null,
} = {}) {
  validateRunId(runId);
  validateOptions(policy);
  if (process.platform === 'win32') {
    throw new GuardianError('unsupported-platform', 'the spend guardian requires POSIX process groups');
  }
  if (existsSync(statePath)) {
    throw new GuardianError('state-exists', 'spend session state already exists; refusing to reset its baseline');
  }
  if (existsSync(receiptPath)) {
    throw new GuardianError('receipt-exists', 'spend session receipt already exists; refusing to overwrite it');
  }

  let observedUsageAtStartUsd;
  try {
    observedUsageAtStartUsd = await fetchUsageWithRetry({ apiKey, endpoint, fetchImpl, policy, logger });
  } catch (error) {
    if (error instanceof GuardianError) throw error;
    throw new GuardianError('baseline-poll', 'initial provider usage poll failed', EXIT.usagePollFailed);
  }
  const baselineUsageUsd = cumulativeBaselineUsageUsd == null
    ? observedUsageAtStartUsd : Number(cumulativeBaselineUsageUsd);
  if (!Number.isFinite(baselineUsageUsd) || baselineUsageUsd < 0
      || baselineUsageUsd > observedUsageAtStartUsd + EPSILON_USD) {
    throw new GuardianError('invalid-cumulative-baseline', 'cumulative spend baseline must be finite, non-negative, and no greater than current provider usage');
  }
  if (observedUsageAtStartUsd - baselineUsageUsd + EPSILON_USD >= policy.operationalStopUsd) {
    throw new GuardianError('cap-already-reached', 'cumulative spend already reached the operational stop');
  }

  const sessionId = randomUUID();
  persistSessionState({ statePath, sessionId, runId, baselineUsageUsd, observedUsageAtStartUsd, policy, entrypoint });
  logger(`session ${sessionId} baseline total=$${money(baselineUsageUsd)}; current delta=$${money(observedUsageAtStartUsd - baselineUsageUsd)}; stop at cumulative delta=$${money(policy.operationalStopUsd)} (hard cap $${money(policy.hardCapUsd)}, reserve $${money(policy.reserveUsd)})`);

  // The tiny internal supervisor owns the detached group. Its IPC channel is a
  // parent-death signal: if this polling process disappears, it terminates the
  // group instead of leaving an unmetered paid process behind.
  const child = spawnImpl(process.execPath, [THIS_FILE, INTERNAL_SUPERVISOR_ARG, entrypoint], {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: {
      ...childEnv,
      OPENROUTER_API_KEY: apiKey,
      RUN_ID: runId,
      CONCURRENCY: '1',
      SS_SPEND_GUARD_SESSION: sessionId,
    },
  });
  const exitPromise = childOutcome(child);
  const interruptedPromise = abortOutcome(abortSignal);
  let lastUsageUsd = observedUsageAtStartUsd;
  let lastLoggedUsageUsd = observedUsageAtStartUsd;
  let pollCount = 0;

  const poll = async () => {
    const current = await fetchUsageWithRetry({ apiKey, endpoint, fetchImpl, policy, logger });
    if (current + EPSILON_USD < lastUsageUsd) {
      logger(`provider usage total regressed from $${money(lastUsageUsd)} to $${money(current)}; retaining the conservative high-water total`);
    } else {
      lastUsageUsd = current;
    }
    pollCount += 1;
    const delta = lastUsageUsd - baselineUsageUsd;
    if (lastUsageUsd > lastLoggedUsageUsd + EPSILON_USD || pollCount % 12 === 0) {
      logger(`usage delta=$${money(delta)}; $${money(Math.max(0, policy.operationalStopUsd - delta))} to operational stop`);
      lastLoggedUsageUsd = lastUsageUsd;
    }
    return delta;
  };
  const finish = async (result, refreshUsage = false) => {
    let finalPollSucceeded = !refreshUsage;
    if (refreshUsage) {
      try { await poll(); finalPollSucceeded = true; } catch { /* retain last good total */ }
    }
    persistFinalReceipt(receiptPath, {
      schemaVersion: 1,
      sessionId,
      runId,
      finishedAt: new Date().toISOString(),
      finalTotalUsageUsd: lastUsageUsd,
      deltaUsd: lastUsageUsd - baselineUsageUsd,
      finalPollSucceeded,
      reason: result.reason,
      exitCode: result.exitCode,
    });
    return { ...result, baselineUsageUsd, lastUsageUsd, receiptPath };
  };

  while (true) {
    const event = await Promise.race([
      exitPromise.then(outcome => ({ kind: 'child', outcome })),
      interruptedPromise,
      delay(policy.pollMs).then(() => ({ kind: 'poll' })),
    ]);

    if (event.kind === 'abort') {
      logger('guardian interrupted; failing closed');
      await terminateOwnedGroup(child, { terminateGraceMs: policy.terminateGraceMs, killImpl, logger });
      return finish({ exitCode: EXIT.interrupted, reason: 'guardian-interrupted' }, true);
    }

    if (event.kind === 'child') {
      if (event.outcome.kind === 'spawn-error') {
        logger('owned entrypoint failed to start');
        return finish({ exitCode: EXIT.childFailed, reason: 'child-spawn-error' }, true);
      }
      const descendantsSurvived = ownedGroupAlive(child, killImpl);
      if (descendantsSurvived) {
        logger('owned entrypoint exited while its process group was still live; failing closed');
        await terminateOwnedGroup(child, { terminateGraceMs: policy.terminateGraceMs, killImpl, logger });
      }
      let delta;
      try {
        delta = await poll();
      } catch {
        logger('final provider usage poll failed; session is not accepted');
        return finish({ exitCode: EXIT.usagePollFailed, reason: 'final-poll-failed' }, true);
      }
      if (delta + EPSILON_USD >= policy.operationalStopUsd) {
        logger(`operational stop reached after child exit (delta=$${money(delta)})`);
        return finish({ exitCode: EXIT.operationalStop, reason: 'operational-stop' });
      }
      const exitCode = event.outcome.code === 0 && !descendantsSurvived ? 0 : EXIT.childFailed;
      logger(`owned entrypoint exited; final delta=$${money(delta)}`);
      return finish({ exitCode, reason: exitCode === 0 ? 'completed' : 'child-failed' });
    }

    let delta;
    try {
      delta = await poll();
    } catch {
      logger('provider usage poll failed; failing closed');
      await terminateOwnedGroup(child, { terminateGraceMs: policy.terminateGraceMs, killImpl, logger });
      return finish({ exitCode: EXIT.usagePollFailed, reason: 'poll-failed' }, true);
    }
    if (delta + EPSILON_USD >= policy.operationalStopUsd) {
      logger(`operational stop reached (delta=$${money(delta)}); failing closed`);
      await terminateOwnedGroup(child, { terminateGraceMs: policy.terminateGraceMs, killImpl, logger });
      return finish({ exitCode: EXIT.operationalStop, reason: 'operational-stop' }, true);
    }
  }
}

async function runInternalSupervisor(entrypoint) {
  if (!process.connected || !process.env.SS_SPEND_GUARD_SESSION) process.exit(EXIT.stateRefused);
  let terminating = false;
  // Group SIGTERM must stop the paid entrypoint first while this supervisor
  // remains alive long enough to escalate the same exact group to SIGKILL.
  process.on('SIGTERM', () => {});
  const paidChild = spawn(process.execPath, [entrypoint], {
    detached: false,
    stdio: 'inherit',
    env: process.env,
  });
  const terminate = () => {
    if (terminating) return;
    terminating = true;
    try { process.kill(-process.pid, 'SIGTERM'); } catch { /* group already gone */ }
    setTimeout(() => {
      try { process.kill(-process.pid, 'SIGKILL'); } catch { /* group already gone */ }
    }, SPEND_POLICY.terminateGraceMs);
  };
  process.once('disconnect', terminate);
  paidChild.once('error', () => process.exit(EXIT.childFailed));
  paidChild.once('exit', (code, signal) => {
    if (terminating) return;
    process.exit(signal ? EXIT.childFailed : (code ?? EXIT.childFailed));
  });
}

export function parseCli(argv, env = process.env) {
  let runId = env.RUN_ID || '';
  let entrypoint = DEFAULT_ENTRYPOINT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run-id') runId = argv[++i] || '';
    else if (arg === '--entrypoint') entrypoint = argv[++i] || '';
    else if (arg === '--help') return { help: true };
    else throw new GuardianError('unknown-option', 'unknown or malformed option');
  }
  return { help: false, runId: validateRunId(runId), entrypoint: validateEntrypoint(entrypoint) };
}

async function main() {
  let parsed;
  try {
    parsed = parseCli(process.argv.slice(2));
    if (parsed.help) {
      console.log('Usage: RUN_ID=<unique-id> OPENROUTER_API_KEY=<key> node eval/task-completion-bench/harness/openrouter-spend-guardian.mjs [--entrypoint eval/task-completion-bench/harness/<stage-orchestrator>.mjs]');
      return;
    }
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, onSignal);
    const statePath = path.join(RESULTS, parsed.runId, 'openrouter-spend-session.json');
    const result = await runSpendGuardian({
      runId: parsed.runId,
      entrypoint: parsed.entrypoint,
      statePath,
      apiKey: process.env.OPENROUTER_API_KEY,
      abortSignal: controller.signal,
      cumulativeBaselineUsageUsd: process.env.SS_SPEND_CUMULATIVE_BASELINE_USD,
    });
    process.exitCode = result.exitCode;
  } catch (error) {
    const safeMessage = error instanceof GuardianError ? error.message : 'unexpected guardian failure';
    console.error(`[spend-guardian] REFUSED: ${safeMessage}`);
    process.exitCode = error instanceof GuardianError ? error.exitCode : EXIT.stateRefused;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  if (process.argv[2] === INTERNAL_SUPERVISOR_ARG) await runInternalSupervisor(process.argv[3]);
  else await main();
}
