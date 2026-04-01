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
const skip = !nativeBinary;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let projectDir;
let serverProcess;

function cleanSocket() {
  try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
  try { unlinkSync('/tmp/search.sock'); } catch { /* ignore */ }
}

function waitForSocket(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(SOCKET_PATH)) return true;
    execFileSync('sleep', ['0.2']);
  }
  return false;
}

function stopServer() {
  // Try stopping via socket
  try {
    execFileSync(NODE, ['-e', `
      import net from 'net';
      const c = net.createConnection('/tmp/sweet-search.sock');
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
  cleanSocket();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (skip) return;

  // Create and index a temp project
  projectDir = mkdtempSync(join(tmpdir(), 'ss-native-launcher-'));
  writeFileSync(join(projectDir, 'package.json'), '{"name":"native-test"}');
  mkdirSync(join(projectDir, 'src'));
  writeFileSync(join(projectDir, 'src', 'hello.js'),
    '// Greeting utility\nfunction greetUser(name) {\n  return `Hello, ${name}!`;\n}\nmodule.exports = { greetUser };\n'
  );

  execFileSync(NODE, [join(ROOT, 'core', 'indexing', 'index-codebase-v21.js'), '--project-root', projectDir], {
    timeout: 60000,
    env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectDir },
    stdio: 'pipe',
  });

  // Clean up any existing server
  stopServer();
}, 120000);

afterAll(() => {
  stopServer();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
}, 30000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('native launcher integration', () => {
  it.skipIf(skip)('warm path: server start → native binary query → stop', async () => {
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
      detached: true,
    });
    serverProcess.unref();

    // Capture server stderr for debugging
    let serverStderr = '';
    serverProcess.stderr.on('data', (d) => { serverStderr += d.toString(); });

    // 2. Wait for socket
    const socketReady = waitForSocket(20000);
    expect(socketReady, `Socket did not appear. Server stderr:\n${serverStderr}`).toBe(true);

    // 3. Wait for server to finish loading indexes (socket appears before indexes are ready)
    const deadline = Date.now() + 30000;
    let serverReady = false;
    while (Date.now() < deadline) {
      try {
        const health = execFileSync(NODE, ['-e', `
          import net from 'net';
          const c = net.createConnection('/tmp/sweet-search.sock');
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
      timeout: 30000,
      cwd: ROOT,
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectDir },
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
    });
    execFileSync('sleep', ['0.5']);
    expect(existsSync(SOCKET_PATH)).toBe(false);

    serverProcess = null;
  }, 120000);

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

    // Server auto-started — socket should exist now
    expect(existsSync(coldSocketPath), 'Cold-start socket was created').toBe(true);

    // Wait for server to finish loading indexes (may take a few seconds)
    const deadline = Date.now() + 30000;
    let queryOutput = '';
    while (Date.now() < deadline) {
      try {
        queryOutput = execFileSync(binaryPath, ['greeting', '--json'], {
          encoding: 'utf8',
          timeout: 15000,
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
  }, 120000);
});
