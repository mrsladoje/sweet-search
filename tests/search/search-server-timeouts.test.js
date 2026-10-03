/**
 * A slow answer is not cut off; a dead daemon is named.
 *
 * r3-grdb (Codex, 5 calls): the first ss-search on a loaded machine ran past the daemon's 30 s
 * socket idle timeout, the server destroyed the socket, and the agent saw
 * `[ss-*] crash: Error: socket hang up` after 30.4–31.0 s.
 */
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  configureServerTimeouts, queryServer, SEARCH_SERVER_TIMEOUT_MS,
} from '../../core/search/search-server.js';
import { daemonHeapMb, daemonNodeArgs, memoryLimitBytes } from '../../core/search/daemon-heap.js';
import { runInVirtualProcess } from '../../core/agent-tools/virtual-process.js';

describe('configureServerTimeouts', () => {
  it('bounds receiving the request, not computing the answer', () => {
    const server = configureServerTimeouts(http.createServer());
    expect(server.timeout).toBe(0);
    expect(server.requestTimeout).toBe(SEARCH_SERVER_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(SEARCH_SERVER_TIMEOUT_MS + 5_000);
  });
});

describe('queryServer against a daemon that drops the call', () => {
  let dir;
  let server;
  const savedSocket = process.env.SWEET_SEARCH_SOCKET_PATH;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
    if (savedSocket === undefined) delete process.env.SWEET_SEARCH_SOCKET_PATH;
    else process.env.SWEET_SEARCH_SOCKET_PATH = savedSocket;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function listen(handler) {
    dir = mkdtempSync(path.join(tmpdir(), 'ss-server-timeouts-'));
    const socketPath = path.join(dir, 'd.sock');
    server = http.createServer(handler);
    await new Promise((resolve) => server.listen(socketPath, resolve));
    process.env.SWEET_SEARCH_SOCKET_PATH = socketPath;
  }

  it('says the daemon closed the connection instead of "socket hang up"', async () => {
    await listen((req) => req.socket.destroy());
    await expect(queryServer('hasMany', { projectRoot: '/x' }))
      .rejects.toThrow('Sweet Search daemon closed the connection before answering /search');
  });

  it('prints a dropped call as one error line, not a stack trace', async () => {
    await listen((req) => req.socket.destroy());
    const result = await runInVirtualProcess({ env: { ...process.env }, cwd: '/', pid: process.pid }, async () => {
      await queryServer('hasMany', { projectRoot: '/x' });
    });
    const err = result.stderr.toString('utf8');
    expect(result.code).toBe(1);
    expect(err).toBe('[ss-*] error: Sweet Search daemon closed the connection before answering /search (it stopped or restarted); run the call again\n');
  });

  it('still returns an answer that takes its time', async () => {
    await listen((req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results: [], serverProjectRoot: '/x' }));
      }, 200);
    });
    await expect(queryServer('hasMany', { projectRoot: '/x' })).resolves.toEqual({ results: [], serverProjectRoot: '/x' });
  });
});

describe('daemon heap ceiling', () => {
  const gib = 1024 ** 3;
  // r282 grdb: the daemon aborted at V8's ~4 GiB default heap under three concurrent searches.
  it('is a quarter of the limit, at least the V8 default, at most 75% of the limit', () => {
    expect(daemonHeapMb(128 * gib)).toBe(32 * 1024);
    expect(daemonHeapMb(16 * gib)).toBe(4096);
    expect(daemonHeapMb(8 * gib)).toBe(4096);
    expect(daemonHeapMb(4 * gib)).toBe(3072);
    expect(daemonNodeArgs(64 * gib)).toEqual(['--max-old-space-size=16384']);
  });

  it('uses the container limit when one is below physical memory', () => {
    expect(memoryLimitBytes({ constrained: 6 * gib, total: 128 * gib })).toBe(6 * gib);
    expect(memoryLimitBytes({ constrained: 0, total: 128 * gib })).toBe(128 * gib);
    // cgroup "max" reads as a huge number: no constraint.
    expect(memoryLimitBytes({ constrained: 2 ** 63, total: 128 * gib })).toBe(128 * gib);
    expect(daemonHeapMb(memoryLimitBytes({ constrained: 6 * gib, total: 128 * gib }))).toBe(4096);
  });
});
