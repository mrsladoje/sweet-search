import { timingSafeEqual } from 'node:crypto';
import {
  chmodSync, copyFileSync, lstatSync, mkdirSync, unlinkSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_FILE = path.join(HERE, 'phase2a-synthetic-tool-client.mjs');
const COMMAND_TO_TOOL = Object.freeze({
  'ss-search': 'search', 'ss-grep': 'grep', 'ss-find': 'find', 'ss-read': 'read',
});
const TOOL_COMMANDS = Object.freeze([...Object.keys(COMMAND_TO_TOOL), 'ss-batch']);
const MAX_REQUEST_BYTES = 64 * 1024;
const COMMON_EVIDENCE = [
  'synthetic_shared_evidence=phase2a_read_only_fixture',
  ...Array.from({ length: 32 }, (_, index) => `shared_context_${String(index + 1).padStart(2, '0')}=stable`),
].join(' ');

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function sameJson(left, right) {
  const a = Buffer.from(JSON.stringify(left));
  const b = Buffer.from(JSON.stringify(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function syntheticOperationArgv(operation) {
  const { tool, args } = operation;
  if (tool === 'search') return [args.query, '-k', String(args.k), '--mode', args.mode];
  if (tool === 'grep') return [args.pattern, ...(args.in ? ['--in', args.in] : []), '-k', String(args.k)];
  if (tool === 'find') return [
    args.query, '--regex', args.regex, ...(args.in ? ['--in', args.in] : []), '-k', String(args.k),
  ];
  if (tool === 'read') return [args.path, String(args.startLine), String(args.endLine)];
  throw new Error(`unsupported synthetic tool ${tool}`);
}

export function parseSyntheticBatchArgv(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || Buffer.byteLength(argv[0]) > MAX_REQUEST_BYTES) {
    return { error: 'ss-batch requires one bounded JSON argument', operations: [] };
  }
  let payload;
  try { payload = JSON.parse(argv[0]); } catch { return { error: 'ss-batch JSON is invalid', operations: [] }; }
  if (!record(payload)) return { error: 'ss-batch request must be an object', operations: [] };
  const fields = Object.keys(payload).sort();
  if (!sameJson(fields, ['maxChars', 'operations', 'version'])) {
    return { error: 'ss-batch request fields drifted', operations: [] };
  }
  if (payload.version !== 1 || payload.maxChars !== 16000
      || !Array.isArray(payload.operations) || ![2, 3].includes(payload.operations.length)) {
    return { error: 'ss-batch version, maxChars, or width is invalid', operations: [] };
  }
  for (const operation of payload.operations) {
    if (!record(operation) || !sameJson(Object.keys(operation).sort(), ['args', 'id', 'tool'])
        || typeof operation.id !== 'string' || typeof operation.tool !== 'string' || !record(operation.args)) {
      return { error: 'ss-batch operation shape is invalid', operations: [] };
    }
  }
  return { error: null, operations: payload.operations };
}

function operationOutput(scenario, operation) {
  const lines = [COMMON_EVIDENCE, `scenario=${scenario.id}`, `operation_id=${operation.id}`, operation.fact];
  if (scenario.kind === 'dependency' && operation.id === scenario.leadId) {
    lines.push(`next_path=${scenario.dynamicPath}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderBatch(leaves) {
  const lines = [
    `[ss-batch] version=1 operation_count=${leaves.length} shared_max_chars=16000 shared_truncated=false`,
    COMMON_EVIDENCE,
  ];
  for (const leaf of leaves) {
    lines.push(`[ss-batch operation] id=${leaf.id} tool=${leaf.tool} status=${leaf.status} truncated=false`);
    if (leaf.status === 'ok') {
      lines.push(...leaf.output.split('\n').filter(line => line && line !== COMMON_EVIDENCE));
    } else {
      lines.push(`error=${leaf.error}`);
    }
  }
  lines.push(`[ss-batch end] operation_count=${leaves.length}`);
  return `${lines.join('\n')}\n`;
}

function safeSocketPath(socketPath) {
  if (!path.isAbsolute(socketPath) || socketPath.includes('\0') || Buffer.byteLength(socketPath) > 100) {
    throw new Error('synthetic broker socket path must be a short absolute path');
  }
  try {
    lstatSync(socketPath);
    throw new Error('synthetic broker refuses to replace an existing socket path');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

/** Install a fixed, secret-free client and five read-only command names. */
export function installSyntheticToolClients(binDir) {
  if (!path.isAbsolute(binDir)) throw new Error('synthetic bin directory must be absolute');
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const client = path.join(binDir, 'phase2a-tool-client.mjs');
  copyFileSync(CLIENT_FILE, client);
  chmodSync(client, 0o700);
  for (const command of TOOL_COMMANDS) {
    const target = path.join(binDir, command);
    copyFileSync(CLIENT_FILE, target);
    chmodSync(target, 0o700);
  }
  return { binDir, client, commands: [...TOOL_COMMANDS] };
}

/**
 * Host-side deterministic tool boundary. Hidden dependency paths remain only in
 * this process until the lead result has been returned to its client.
 */
export async function startSyntheticToolBroker({ runtimeScenario, socketPath, delayMs = 200 } = {}) {
  if (!runtimeScenario?.id || !Array.isArray(runtimeScenario.operations)) throw new Error('runtime scenario is required');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 1000) throw new Error('invalid synthetic delay');
  safeSocketPath(socketPath);
  const audit = [];
  const seen = new Set();
  let nextSequence = 1;
  let leadReturnedAtMs = null;

  const findExpected = (tool, id, args) => runtimeScenario.operations.find(operation => (
    operation.tool === tool && (id == null || operation.id === id) && sameJson(operation.args, args)
  ));

  const executeLeaf = async ({ id, tool, args, envelopeSequence, batched }) => {
    const startedAtMs = Date.now();
    const expected = findExpected(tool, id, args);
    let status = 'ok';
    let error = null;
    let dependencyViolation = false;
    if (!expected) {
      status = 'error'; error = 'unexpected_or_mismatched_operation';
    } else if (seen.has(expected.id)) {
      status = 'error'; error = 'duplicate_operation';
    } else if (runtimeScenario.kind === 'dependency' && expected.id === runtimeScenario.dependentId
        && (batched || leadReturnedAtMs == null)) {
      status = 'error'; error = 'dependency_not_yet_revealed'; dependencyViolation = true;
    }
    if (expected) seen.add(expected.id);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    const completedAtMs = Date.now();
    const output = status === 'ok' ? operationOutput(runtimeScenario, expected) : '';
    return {
      id: expected?.id || String(id || '<unmatched>'), tool, args, envelopeSequence,
      status, error, dependencyViolation, startedAtMs, completedAtMs, output,
    };
  };

  const dispatch = async request => {
    const sequence = nextSequence++;
    const invocation = {
      sequence, command: request.command, argv: request.argv,
      startedAtMs: Date.now(), completedAtMs: null, returnedAtMs: null,
      exitCode: 0, parseError: null, operations: [], stdout: '', stderr: '',
    };
    audit.push(invocation);
    if (request.command === 'ss-batch') {
      const parsed = parseSyntheticBatchArgv(request.argv);
      if (parsed.error) {
        invocation.parseError = parsed.error;
        invocation.exitCode = 2;
        invocation.stderr = `${parsed.error}\n`;
      } else {
        invocation.operations = await Promise.all(parsed.operations.map(operation => executeLeaf({
          ...operation, envelopeSequence: sequence, batched: true,
        })));
        invocation.stdout = renderBatch(invocation.operations);
        // Real ss-batch can exit zero while an individual operation is labeled error.
        // The adjudicator must inspect leaf status rather than trust the envelope.
      }
    } else {
      const tool = COMMAND_TO_TOOL[request.command];
      const operation = tool && runtimeScenario.operations.find(candidate => (
        candidate.tool === tool && sameJson(syntheticOperationArgv(candidate), request.argv)
      ));
      const args = operation?.args || { argv: request.argv };
      const leaf = await executeLeaf({
        id: operation?.id, tool: tool || '<unsupported>', args,
        envelopeSequence: sequence, batched: false,
      });
      invocation.operations = [leaf];
      if (leaf.status === 'ok') invocation.stdout = leaf.output;
      else { invocation.exitCode = 1; invocation.stderr = `${leaf.error}\n`; }
    }
    invocation.completedAtMs = Date.now();
    return invocation;
  };

  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let raw = '';
    let handled = false;
    const respond = async () => {
      if (handled) return;
      handled = true;
      let request;
      try {
        request = JSON.parse(raw.trim());
        if (!record(request) || request.protocol !== 1 || !TOOL_COMMANDS.includes(request.command)
            || !Array.isArray(request.argv) || request.argv.some(arg => typeof arg !== 'string')) {
          throw new Error('invalid request');
        }
      } catch {
        socket.end(JSON.stringify({ stdout: '', stderr: 'invalid synthetic tool request\n', exitCode: 2 }));
        return;
      }
      const invocation = await dispatch(request);
      socket.end(JSON.stringify({
        stdout: invocation.stdout, stderr: invocation.stderr, exitCode: invocation.exitCode,
      }), () => {
        invocation.returnedAtMs = Date.now();
        if (runtimeScenario.kind === 'dependency'
            && invocation.operations.some(leaf => leaf.id === runtimeScenario.leadId && leaf.status === 'ok')) {
          leadReturnedAtMs = invocation.returnedAtMs;
        }
      });
    };
    socket.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) {
        handled = true;
        socket.end(JSON.stringify({ stdout: '', stderr: 'synthetic request too large\n', exitCode: 2 }));
      } else if (raw.includes('\n')) void respond();
    });
    socket.once('end', () => { if (raw && !handled) void respond(); });
    socket.once('error', () => {});
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  chmodSync(socketPath, 0o600);
  return {
    socketPath,
    audit: () => structuredClone(audit),
    close: async () => {
      await new Promise(resolve => server.close(resolve));
      try { unlinkSync(socketPath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    },
  };
}
