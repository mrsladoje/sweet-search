/**
 * Native launcher integration test — proves the Rust CLI → Unix socket → Node server
 * query path works end-to-end on the current platform.
 *
 * Skips when no platform-package native binary is available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '../..');
const NODE = process.execPath;
const SOCKET_PATH = '/tmp/sweet-search.sock';
const INDEX_TIMEOUT_MS = Number(process.env.SWEET_SEARCH_TEST_NATIVE_INDEX_TIMEOUT_MS || 180000);
const SERVER_READY_TIMEOUT_MS = Number(process.env.SWEET_SEARCH_TEST_NATIVE_READY_TIMEOUT_MS || 90000);

// ---------------------------------------------------------------------------
// Resolve platform-package binary (skip dev paths)
// ---------------------------------------------------------------------------

function resolvePackageBinary() {
  try {
    const result = execFileSync(NODE, ['-e', `
      import { getPlatformInfo } from './core/infrastructure/native-resolver.js';
      const info = getPlatformInfo();
      if (!info) { process.exit(0); }
      const dir = 'native-' + info.platform + '-' + info.arch + info.libc;
      const p = './packages/' + dir + '/sweet-search';
      import('fs').then(fs => {
        process.stdout.write(fs.existsSync(p) ? p : '');
      });
    `], { encoding: 'utf8', cwd: ROOT, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return result || null;
  } catch {
    return null;
  }
}

const nativeBinary = resolvePackageBinary();

// Also skip when the TCP port is in use (stale server prevents fresh startup)
function isPortInUse(port) {
  try {
    execFileSync('lsof', ['-i', `:${port}`, '-t'], { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch { return false; }
}

// GitHub Actions: the beforeAll spawns the indexer via execFileSync, and
// the subprocess fails to resolve the locally-staged native addon at
// packages/native-<platform>/sweet-search-native.node despite the parent
// process resolving it correctly (same CI-specific subprocess resolution
// issue we skipped in scripts/smoke-test.js). Real-user install flows are
// unaffected. Override locally with SWEET_SEARCH_FORCE_E2E=1 to debug.
const skipForCI = process.env.CI === 'true' && process.env.SWEET_SEARCH_FORCE_E2E !== '1';
const skip = !nativeBinary || isPortInUse(9876) || skipForCI;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let projectDir;
let serverProcess;
let warmSocketPath;

function cleanSocket(socketPath = SOCKET_PATH) {
  try { unlinkSync(socketPath); } catch { /* ignore */ }
  if (socketPath === SOCKET_PATH) {
    try { unlinkSync('/tmp/search.sock'); } catch { /* ignore */ }
  }
}

function waitForSocket(socketPath = SOCKET_PATH, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return true;
    execFileSync('sleep', ['0.2']);
  }
  return false;
}

function stopServer(socketPath = SOCKET_PATH) {
  // Try stopping via socket
  try {
    execFileSync(NODE, ['-e', `
      import net from 'net';
      const c = net.createConnection(${JSON.stringify(socketPath)});
      c.write('GET /stop HTTP/1.0\\r\\nHost: l\\r\\n\\r\\n');
      c.on('data', () => {});
      c.on('end', () => process.exit(0));
      c.on('error', () => process.exit(0));
      setTimeout(() => process.exit(0), 3000);
    `], { timeout: 5000, stdio: 'pipe' });
  } catch { /* ignore */ }
  if (serverProcess) {
    try { serverProcess.kill(); } catch { /* ignore */ }
    serverProcess = null;
  }
  execFileSync('sleep', ['0.5']);
  cleanSocket(socketPath);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (skip) return;

  // Create and index a temp project
  projectDir = mkdtempSync(join(tmpdir(), 'ss-native-launcher-'));
  warmSocketPath = join(tmpdir(), `sweet-search-warm-${process.pid}.sock`);
  writeFileSync(join(projectDir, 'package.json'), '{"name":"native-test"}');
  mkdirSync(join(projectDir, 'src'));
  writeFileSync(join(projectDir, 'src', 'hello.js'),
    '// Greeting utility\nfunction greetUser(name) {\n  return `Hello, ${name}!`;\n}\nmodule.exports = { greetUser };\n'
  );

  execFileSync(NODE, [join(ROOT, 'core', 'indexing', 'index-codebase-v21.js'), '--project-root', projectDir], {
    timeout: INDEX_TIMEOUT_MS,
    env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectDir },
    stdio: 'pipe',
  });

  // Clean up any existing server
  stopServer();
}, INDEX_TIMEOUT_MS + 60000);

afterAll(() => {
  stopServer();
  if (warmSocketPath) cleanSocket(warmSocketPath);
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
}, 30000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('native launcher integration', () => {
  it.skipIf(skip)('warm path: server start → native binary query → stop', async () => {
    cleanSocket(warmSocketPath);

    // 1. Start server via direct import (reliable async startup)
    serverProcess = spawn(NODE, ['-e', `
      process.env.SWEET_SEARCH_PROJECT_ROOT = ${JSON.stringify(projectDir)};
      const { startServer } = await import('./core/search/search-server.js');
      await startServer();
      // Keep alive — server listens until killed
      setInterval(() => {}, 60000);
    `], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SWEET_SEARCH_PROJECT_ROOT: projectDir,
        SWEET_SEARCH_SOCKET_PATH: warmSocketPath,
        SWEET_SEARCH_RECONCILE_V2: '0',
      },
      detached: true,
    });
    serverProcess.unref();

    // Capture server stderr for debugging
    let serverStderr = '';
    serverProcess.stderr.on('data', (d) => { serverStderr += d.toString(); });

    // 2. Wait for socket
    const socketReady = waitForSocket(warmSocketPath, SERVER_READY_TIMEOUT_MS);
    expect(socketReady, `Socket did not appear. Server stderr:\n${serverStderr}`).toBe(true);

    // 3. Wait for server to finish loading indexes (socket appears before indexes are ready)
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    let serverReady = false;
    while (Date.now() < deadline) {
      try {
        const health = execFileSync(NODE, ['-e', `
          import net from 'net';
          const c = net.createConnection(${JSON.stringify(warmSocketPath)});
          c.write('GET /health HTTP/1.0\\r\\nHost: l\\r\\n\\r\\n');
          const chunks = [];
          c.on('data', d => chunks.push(d));
          c.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            const i = raw.indexOf('\\r\\n\\r\\n');
            const body = i >= 0 ? raw.substring(i + 4) : raw;
            const h = JSON.parse(body);
            process.exit(h.status === 'ok' || h.status === 'ready' ? 0 : 1);
          });
          c.on('error', () => process.exit(1));
          setTimeout(() => process.exit(1), 5000);
        `], { timeout: 8000, cwd: ROOT, stdio: 'pipe' });
        serverReady = true;
        break;
      } catch {
        execFileSync('sleep', ['0.5']);
      }
    }
    expect(serverReady, 'Server health check never returned ok').toBe(true);

    // 5. Query through native binary → socket → server
    const binaryPath = join(ROOT, nativeBinary);
    const output = execFileSync(binaryPath, ['greeting', '--json'], {
      encoding: 'utf8',
      timeout: SERVER_READY_TIMEOUT_MS,
      cwd: ROOT,
      env: {
        ...process.env,
        SWEET_SEARCH_PROJECT_ROOT: projectDir,
        SWEET_SEARCH_SOCKET_PATH: warmSocketPath,
        SWEET_SEARCH_RECONCILE_V2: '0',
      },
    });

    // Parse JSON (native binary outputs body after stripping HTTP headers)
    const jsonStart = output.indexOf('{');
    expect(jsonStart, `No JSON in output: ${output.substring(0, 200)}`).toBeGreaterThanOrEqual(0);

    const parsed = JSON.parse(output.substring(jsonStart));
    expect(parsed.results).toBeDefined();
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0].score).toBeGreaterThan(0);

    const topFile = parsed.results[0].metadata?.file ?? parsed.results[0].file;
    expect(topFile).toContain('hello.js');

    // 6. Stop via native binary
    execFileSync(binaryPath, ['--stop'], {
      encoding: 'utf8',
      timeout: 10000,
      cwd: ROOT,
      env: {
        ...process.env,
        SWEET_SEARCH_SOCKET_PATH: warmSocketPath,
        SWEET_SEARCH_RECONCILE_V2: '0',
      },
    });
    execFileSync('sleep', ['0.5']);
    expect(existsSync(warmSocketPath)).toBe(false);

    serverProcess = null;
  }, SERVER_READY_TIMEOUT_MS * 3);

  it.skipIf(skip)('cold start: native binary auto-starts server and returns results', async () => {
    // Use an isolated socket so this test doesn't collide with the warm-path test
    // or any running server.
    const coldSocketPath = join(tmpdir(), `sweet-search-cold-${process.pid}.sock`);

    // Ensure clean state
    try { unlinkSync(coldSocketPath); } catch { /* ignore */ }

    const binaryPath = join(ROOT, nativeBinary);
    const env = {
      ...process.env,
      SWEET_SEARCH_PROJECT_ROOT: projectDir,
      SWEET_SEARCH_SOCKET_PATH: coldSocketPath,
      SWEET_SEARCH_RECONCILE_V2: '0',
    };

    // First call auto-starts the server. It may return a "starting" response
    // if the server hasn't finished loading indexes yet.
    let output;
    try {
      output = execFileSync(binaryPath, ['greeting', '--json'], {
        encoding: 'utf8',
        timeout: 30000,
        cwd: ROOT,
        env,
      });
    } catch (err) {
      output = err.stdout || '';
      const stderr = err.stderr || '';
      expect.unreachable(
        `Native binary cold start failed (exit ${err.status}, signal ${err.signal}).\n` +
        `stdout: ${output.substring(0, 500)}\n` +
        `stderr: ${stderr.substring(0, 500)}`
      );
    }

    // Server auto-start may return before the daemon has finished binding.
    expect(waitForSocket(coldSocketPath, SERVER_READY_TIMEOUT_MS), 'Cold-start socket was created').toBe(true);

    // Wait for server to finish loading indexes (may take a few seconds)
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    let queryOutput = '';
    while (Date.now() < deadline) {
      try {
        queryOutput = execFileSync(binaryPath, ['greeting', '--json'], {
          encoding: 'utf8',
          timeout: 30000,
          cwd: ROOT,
          env,
        });
        const j = queryOutput.indexOf('{');
        if (j >= 0) {
          const body = JSON.parse(queryOutput.substring(j));
          if (body.results) break;
        }
      } catch { /* ignore */ }
      execFileSync('sleep', ['1']);
    }

    const jsonStart = queryOutput.indexOf('{');
    expect(jsonStart, `No JSON in cold-start output: ${queryOutput.substring(0, 200)}`).toBeGreaterThanOrEqual(0);

    const parsed = JSON.parse(queryOutput.substring(jsonStart));
    expect(parsed.results).toBeDefined();
    expect(parsed.results.length).toBeGreaterThan(0);

    // Clean up: stop server via the cold socket, then remove it
    try {
      execFileSync(binaryPath, ['--stop'], {
        encoding: 'utf8',
        timeout: 10000,
        cwd: ROOT,
        env,
      });
    } catch { /* ignore — server may have already exited */ }
    execFileSync('sleep', ['0.5']);
    try { unlinkSync(coldSocketPath); } catch { /* ignore */ }
  }, SERVER_READY_TIMEOUT_MS * 3);
});
