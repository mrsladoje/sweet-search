/**
 * Tests for project-scoped server identity (release-gate C3).
 *
 * Guards that two projects derive different sockets, an explicit override wins
 * (and there is no global/legacy fallback), TCP is opt-in, and the FNV-1a hash
 * agrees byte-for-byte with the native Rust CLI (crates/sweet-search-cli) so
 * both sides connect to the same per-project socket.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

import {
  fnv1a64Hex,
  resolveProjectRoot,
  projectSocketPath,
  projectPidFile,
  tcpPort,
} from '../../core/search/server-identity.js';

let sandbox;

function listen(server, socketPath) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function requestHealth(socketPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: '/health', method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'ss-identity-')));
});

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('fnv1a64Hex', () => {
  it('matches known FNV-1a/64 vectors', () => {
    expect(fnv1a64Hex('')).toBe('cbf29ce484222325'); // offset basis
    expect(fnv1a64Hex('abc')).toBe('e71fa2190541574b');
  });

  it('agrees with the native Rust CLI for sample project roots', () => {
    // These constants are asserted identically in the Rust test
    // (fnv1a64_agrees_with_js_for_project_roots) — keep both in sync.
    expect(fnv1a64Hex('/private/tmp/projA')).toBe('16fc53080a86469a');
    expect(fnv1a64Hex('/private/tmp/projB')).toBe('16fc52080a8644e7');
  });
});

describe('projectSocketPath', () => {
  it('derives a per-project hashed /tmp socket by default', () => {
    const sock = projectSocketPath({}, sandbox);
    expect(sock).toBe(`/tmp/sweet-search-${fnv1a64Hex(sandbox)}.sock`);
    expect(sock).toMatch(/^\/tmp\/sweet-search-[0-9a-f]{16}\.sock$/);
  });

  it('lets SWEET_SEARCH_SOCKET_PATH override win (no legacy fallback)', () => {
    expect(projectSocketPath({ SWEET_SEARCH_SOCKET_PATH: '/tmp/custom.sock' }, sandbox))
      .toBe('/tmp/custom.sock');
  });

  it('gives two different projects two different sockets', () => {
    const a = realpathSync(mkdtempSync(join(tmpdir(), 'ss-A-')));
    const b = realpathSync(mkdtempSync(join(tmpdir(), 'ss-B-')));
    try {
      expect(projectSocketPath({}, a)).not.toBe(projectSocketPath({}, b));
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it('is stable across calls for the same project', () => {
    expect(projectSocketPath({}, sandbox)).toBe(projectSocketPath({}, sandbox));
  });
});

describe('resolveProjectRoot', () => {
  it('walks up to the nearest ancestor holding .sweet-search', () => {
    mkdirSync(join(sandbox, '.sweet-search'), { recursive: true });
    const deep = join(sandbox, 'src', 'deep');
    mkdirSync(deep, { recursive: true });
    expect(resolveProjectRoot({}, deep)).toBe(sandbox);
  });

  it('maps a subdirectory to the same socket as the project root', () => {
    mkdirSync(join(sandbox, '.sweet-search'), { recursive: true });
    const sub = join(sandbox, 'src');
    mkdirSync(sub, { recursive: true });
    expect(projectSocketPath({}, sub)).toBe(projectSocketPath({}, sandbox));
  });

  it('honours an explicit SWEET_SEARCH_PROJECT_ROOT', () => {
    expect(resolveProjectRoot({ SWEET_SEARCH_PROJECT_ROOT: sandbox }, '/elsewhere')).toBe(sandbox);
  });

  it('falls back to the canonical cwd when no .sweet-search exists', () => {
    expect(resolveProjectRoot({}, sandbox)).toBe(sandbox);
  });
});

describe('infrastructure PROJECT_ROOT alignment', () => {
  it('prefers a .sweet-search corpus boundary over an outer package root', () => {
    writeFileSync(join(sandbox, 'package.json'), '{"private":true}\n', 'utf-8');
    const corpus = join(sandbox, 'eval', 'corpus', 'm2crb');
    const deep = join(corpus, 'src', 'nested');
    mkdirSync(join(corpus, '.sweet-search'), { recursive: true });
    mkdirSync(deep, { recursive: true });

    const platformPath = join(process.cwd(), 'core', 'infrastructure', 'config', 'platform.js');
    const script = `
      const { PROJECT_ROOT } = await import(${JSON.stringify(platformPath)});
      process.stdout.write(PROJECT_ROOT);
    `;
    const env = { ...process.env };
    delete env.SWEET_SEARCH_PROJECT_ROOT;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: deep,
      env,
      encoding: 'utf-8',
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(corpus);
  });
});

describe('projectPidFile', () => {
  it('derives a per-project pidfile and honours the override', () => {
    expect(projectPidFile({}, sandbox)).toBe(`/tmp/sweet-search-${fnv1a64Hex(sandbox)}.pid`);
    expect(projectPidFile({ SWEET_SEARCH_PID_FILE: '/tmp/x.pid' }, sandbox)).toBe('/tmp/x.pid');
  });
});

describe('tcpPort', () => {
  it('is off (null) by default — no global TCP port', () => {
    expect(tcpPort({})).toBeNull();
    expect(tcpPort({ SWEET_SEARCH_TCP_PORT: '' })).toBeNull();
  });

  it('parses a valid opt-in port and rejects invalid values', () => {
    expect(tcpPort({ SWEET_SEARCH_TCP_PORT: '9876' })).toBe(9876);
    expect(tcpPort({ SWEET_SEARCH_TCP_PORT: 'nope' })).toBeNull();
    expect(tcpPort({ SWEET_SEARCH_TCP_PORT: '0' })).toBeNull();
    expect(tcpPort({ SWEET_SEARCH_TCP_PORT: '70000' })).toBeNull();
  });
});

describe('startServer idempotency', () => {
  it('reuses a daemon that is listening but still initializing', async () => {
    const socketPath = join(sandbox, 'starting.sock');
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'starting', warm: false, pid: process.pid }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await listen(server, socketPath);

    const oldSocket = process.env.SWEET_SEARCH_SOCKET_PATH;
    process.env.SWEET_SEARCH_SOCKET_PATH = socketPath;

    try {
      const { startServer } = await import('../../core/search/search-server.js');
      await startServer();

      expect(existsSync(socketPath)).toBe(true);
      await expect(requestHealth(socketPath)).resolves.toMatchObject({ status: 'starting' });
    } finally {
      if (oldSocket === undefined) delete process.env.SWEET_SEARCH_SOCKET_PATH;
      else process.env.SWEET_SEARCH_SOCKET_PATH = oldSocket;
      await close(server);
      try { unlinkSync(socketPath); } catch { /* ignore */ }
    }
  });
});
