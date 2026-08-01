import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GuardianError, parseUsagePayload, runSpendGuardian, SPEND_POLICY, validateRunId,
} from '../harness/openrouter-spend-guardian.mjs';

assert.equal(SPEND_POLICY.hardCapUsd, 50);
assert.equal(SPEND_POLICY.operationalStopUsd, 45);
assert.equal(SPEND_POLICY.reserveUsd, 5);

const TEST_KEY = 'fake-secret-that-must-never-be-printed';
const GUARDIAN_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../harness/openrouter-spend-guardian.mjs');
const FAST_POLICY = Object.freeze({
  hardCapUsd: 5,
  operationalStopUsd: 2,
  reserveUsd: 3,
  pollMs: 20,
  requestTimeoutMs: 2_000,
  pollRetryAttempts: 3,
  pollRetryMs: 5,
  // Match production so a loaded Node child gets the same opportunity to run
  // its SIGTERM handler before the owned process group is escalated.
  terminateGraceMs: 2_000,
});

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => child.once('exit', resolve));
}

async function waitForFile(file, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(file) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(existsSync(file), `timed out waiting for ${path.basename(file)}`);
}

async function startUsageServer(sequence) {
  let calls = 0;
  let lastUsage = null;
  const authorizations = [];
  const server = http.createServer(async (req, res) => {
    authorizations.push(req.headers.authorization);
    const item = sequence[Math.min(calls, sequence.length - 1)];
    calls += 1;
    if (req.method !== 'GET' || req.url !== '/api/v1/key') {
      res.writeHead(404).end();
      return;
    }
    if (item?.waitForPath) {
      const deadline = Date.now() + 250;
      while (!existsSync(item.waitForPath) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      // A loaded host may need more than one synthetic 20 ms poll to start the
      // supervised child. Until its ready marker exists, report the last total
      // again instead of manufacturing an early cap crossing.
      if (!existsSync(item.waitForPath)) {
        const body = JSON.stringify({ data: { usage: lastUsage } });
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
        res.end(body);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (item?.hang) return;
    if (item?.status && item.status !== 200) {
      res.writeHead(item.status, { 'content-type': 'application/json' });
      res.end('{"error":"synthetic"}');
      return;
    }
    lastUsage = item?.usage ?? item;
    const body = JSON.stringify({ data: { usage: lastUsage } });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    endpoint: `http://127.0.0.1:${address.port}/api/v1/key`,
    calls: () => calls,
    authorizations,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function makeFakeEntrypoint(dir) {
  const file = path.join(dir, 'fake-paid-entrypoint.mjs');
  writeFileSync(file, `
    import { writeFileSync } from 'node:fs';
    process.on('SIGTERM', () => {
      writeFileSync(process.env.FAKE_TERM, 'terminated');
      process.exit(0);
    });
    // Publish readiness only after the termination handler is installed. The
    // usage fixture keys its cap response to this marker, so a loaded test host
    // cannot race SIGTERM between process startup and handler registration.
    writeFileSync(process.env.FAKE_STARTED, JSON.stringify({
      concurrency: process.env.CONCURRENCY,
      runId: process.env.RUN_ID,
      sessionId: process.env.SS_SPEND_GUARD_SESSION,
    }));
    if (process.env.FAKE_MODE === 'exit') setTimeout(() => process.exit(0), 35);
    else setInterval(() => {}, 1000);
  `);
  chmodSync(file, 0o700);
  return file;
}

function pathsFor(dir, label) {
  const base = path.join(dir, label);
  return {
    statePath: `${base}-state.json`,
    receiptPath: `${base}-receipt.json`,
    startedPath: `${base}-started.json`,
    termPath: `${base}-term.txt`,
  };
}

async function runFake({ dir, label, server, entrypoint, mode = 'hang', policy = FAST_POLICY, cumulativeBaselineUsageUsd = null }) {
  const paths = pathsFor(dir, label);
  const logs = [];
  const result = await runSpendGuardian({
    runId: label,
    entrypoint,
    statePath: paths.statePath,
    receiptPath: paths.receiptPath,
    apiKey: TEST_KEY,
    endpoint: server.endpoint,
    logger: message => logs.push(message),
    policy,
    cumulativeBaselineUsageUsd,
    childEnv: {
      ...process.env,
      FAKE_MODE: mode,
      FAKE_STARTED: paths.startedPath,
      FAKE_TERM: paths.termPath,
    },
  });
  return { result, logs, paths };
}

assert.equal(parseUsagePayload({ data: { usage: 12.5 } }), 12.5);
assert.throws(() => parseUsagePayload({ data: { usage: '12.5' } }), GuardianError);
assert.throws(() => validateRunId('../escape'), GuardianError);

const dir = mkdtempSync(path.join(tmpdir(), 'openrouter-spend-guardian-'));
const entrypoint = makeFakeEntrypoint(dir);
let unrelated;

try {
  // Clean completion: baseline is persisted once, the key stays out of state/logs,
  // and the child is forced to the authorized single-request concurrency.
  const successServer = await startUsageServer([{ usage: 10 }, { usage: 10 }]);
  try {
    const { result, logs, paths } = await runFake({
      dir, label: 'guardian-success', server: successServer, entrypoint, mode: 'exit',
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.reason, 'completed');
    const stateText = readFileSync(paths.statePath, 'utf8');
    const state = JSON.parse(stateText);
    assert.equal(state.baselineUsageUsd, 10);
    assert.equal(state.concurrency, 1);
    assert.equal(state.operationalStopUsd, 2);
    assert.equal(statSync(paths.statePath).mode & 0o777, 0o600);
    const receiptText = readFileSync(paths.receiptPath, 'utf8');
    const receipt = JSON.parse(receiptText);
    assert.equal(receipt.finalTotalUsageUsd, 10);
    assert.equal(receipt.deltaUsd, 0);
    assert.equal(receipt.reason, 'completed');
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.finalPollSucceeded, true);
    assert.equal(statSync(paths.receiptPath).mode & 0o777, 0o600);
    assert.ok(!stateText.includes(TEST_KEY));
    assert.ok(!receiptText.includes(TEST_KEY));
    assert.ok(!logs.join('\n').includes(TEST_KEY));
    const childState = JSON.parse(readFileSync(paths.startedPath, 'utf8'));
    assert.equal(childState.concurrency, '1');
    assert.equal(childState.runId, 'guardian-success');
    assert.equal(childState.sessionId, state.sessionId);

    const callsBeforeReuse = successServer.calls();
    await assert.rejects(
      runSpendGuardian({
        runId: 'guardian-success', entrypoint, statePath: paths.statePath,
        apiKey: TEST_KEY, endpoint: successServer.endpoint, policy: FAST_POLICY,
      }),
      error => error instanceof GuardianError && error.code === 'state-exists',
    );
    assert.equal(successServer.calls(), callsBeforeReuse, 'state reuse must fail before another baseline poll');
  } finally {
    await successServer.close();
  }

  // Operational stop: terminate only the owned group. An unrelated live process
  // remains untouched, and every provider request carried the key without logging it.
  unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const capPaths = pathsFor(dir, 'guardian-cap');
  const capServer = await startUsageServer([
    { usage: 100 }, { usage: 101, waitForPath: capPaths.startedPath },
    { usage: 100.5 }, { usage: 102.25 },
  ]);
  try {
    const { result, logs, paths } = await runFake({
      dir, label: 'guardian-cap', server: capServer, entrypoint,
    });
    assert.equal(result.exitCode, 72);
    assert.equal(result.reason, 'operational-stop');
    assert.ok(existsSync(paths.termPath), 'owned child should receive SIGTERM');
    const receipt = JSON.parse(readFileSync(paths.receiptPath, 'utf8'));
    assert.equal(receipt.reason, 'operational-stop');
    assert.equal(receipt.exitCode, 72);
    assert.equal(receipt.finalTotalUsageUsd, 102.25);
    assert.equal(receipt.deltaUsd, 2.25);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0), 'unrelated process must survive');
    assert.ok(capServer.authorizations.every(value => value === `Bearer ${TEST_KEY}`));
    assert.ok(!logs.join('\n').includes(TEST_KEY));
    assert.ok(logs.some(line => line.includes('retaining the conservative high-water total')));
  } finally {
    await capServer.close();
  }

  // A transient provider failure is retried without killing paid work.
  const retryServer = await startUsageServer([{ usage: 30 }, { status: 503 }, { usage: 30 }]);
  try {
    const { result } = await runFake({
      dir, label: 'guardian-poll-retry', server: retryServer, entrypoint, mode: 'exit',
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.reason, 'completed');
    assert.ok(retryServer.calls() >= 3);
  } finally {
    await retryServer.close();
  }

  // A resumed guardian keeps the original cumulative baseline instead of
  // resetting the user's aggregate cap after a prior session.
  const carryoverServer = await startUsageServer([{ usage: 41 }, { usage: 41 }]);
  try {
    const { result, paths } = await runFake({
      dir, label: 'guardian-carryover', server: carryoverServer, entrypoint, mode: 'exit',
      cumulativeBaselineUsageUsd: 40,
    });
    assert.equal(result.exitCode, 0);
    const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    const receipt = JSON.parse(readFileSync(paths.receiptPath, 'utf8'));
    assert.equal(state.baselineUsageUsd, 40);
    assert.equal(state.observedUsageAtStartUsd, 41);
    assert.equal(state.carryoverUsageUsd, 1);
    assert.equal(receipt.deltaUsd, 1);
  } finally {
    await carryoverServer.close();
  }

  // Polling failure after launch is fail-closed and kills the same owned group.
  const failurePaths = pathsFor(dir, 'guardian-poll-failure');
  const failureServer = await startUsageServer([
    { usage: 200 }, { status: 503, waitForPath: failurePaths.startedPath },
  ]);
  try {
    const { result, paths } = await runFake({
      dir, label: 'guardian-poll-failure', server: failureServer, entrypoint,
    });
    assert.equal(result.exitCode, 71);
    assert.equal(result.reason, 'poll-failed');
    assert.ok(existsSync(paths.termPath), 'poll failure should terminate the owned child');
    const receipt = JSON.parse(readFileSync(paths.receiptPath, 'utf8'));
    assert.equal(receipt.reason, 'poll-failed');
    assert.equal(receipt.finalPollSucceeded, false);
    assert.equal(receipt.finalTotalUsageUsd, 200);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0), 'unrelated process must still survive');
  } finally {
    await failureServer.close();
  }

  // If the polling guardian itself disappears, IPC closes and its internal
  // supervisor kills the paid group rather than leaving unmetered work running.
  const parentDeathPaths = pathsFor(dir, 'guardian-parent-death');
  const supervisor = spawn(process.execPath, [GUARDIAN_FILE, '--internal-supervise', entrypoint], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      ...process.env,
      SS_SPEND_GUARD_SESSION: 'synthetic-parent-death-session',
      CONCURRENCY: '1',
      FAKE_MODE: 'hang',
      FAKE_STARTED: parentDeathPaths.startedPath,
      FAKE_TERM: parentDeathPaths.termPath,
    },
  });
  await waitForFile(parentDeathPaths.startedPath);
  supervisor.disconnect();
  await waitForExit(supervisor);
  assert.ok(existsSync(parentDeathPaths.termPath), 'parent death should terminate the paid child');
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0), 'parent-death cleanup must not touch unrelated processes');

  // A failed initial poll never starts the paid process and leaves no baseline state.
  const baselineFailureServer = await startUsageServer([{ status: 500 }]);
  try {
    const paths = pathsFor(dir, 'guardian-baseline-failure');
    await assert.rejects(
      runSpendGuardian({
        runId: 'guardian-baseline-failure', entrypoint, statePath: paths.statePath,
        apiKey: TEST_KEY, endpoint: baselineFailureServer.endpoint, policy: FAST_POLICY,
        childEnv: {
          ...process.env,
          FAKE_MODE: 'hang', FAKE_STARTED: paths.startedPath, FAKE_TERM: paths.termPath,
        },
      }),
      error => error instanceof GuardianError && error.code === 'poll-http' && error.exitCode === 71,
    );
    assert.equal(existsSync(paths.startedPath), false);
    assert.equal(existsSync(paths.statePath), false);
  } finally {
    await baselineFailureServer.close();
  }

  // A stalled provider response is bounded by the request timeout and also starts nothing.
  const timeoutServer = await startUsageServer([{ hang: true }]);
  try {
    const paths = pathsFor(dir, 'guardian-timeout');
    const shortTimeoutPolicy = { ...FAST_POLICY, requestTimeoutMs: 30 };
    await assert.rejects(
      runSpendGuardian({
        runId: 'guardian-timeout', entrypoint, statePath: paths.statePath,
        apiKey: TEST_KEY, endpoint: timeoutServer.endpoint, policy: shortTimeoutPolicy,
      }),
      error => error instanceof GuardianError && error.code === 'poll-network',
    );
    assert.equal(existsSync(paths.startedPath), false);
  } finally {
    await timeoutServer.close();
  }
} finally {
  if (unrelated) {
    try { unrelated.kill('SIGKILL'); } catch { /* already gone */ }
    await waitForExit(unrelated);
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log('openrouter-spend-guardian: all assertions passed');
