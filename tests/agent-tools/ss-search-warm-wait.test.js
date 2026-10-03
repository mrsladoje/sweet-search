/**
 * ss-search waits for a daemon that is still loading; it never starts a second one.
 *
 * r282 Codex r1 typedoc (2026-10-03): the repo's daemon was cold-starting while another
 * cell warmed 8 servers. The wrapper's 60 s wait ran out and 5 searches printed "warm
 * server is not ready; refusing cold direct search"; the agents then ran `ps` (49k-177k
 * chars). A /health probe that missed its short timeout also read a busy daemon as absent
 * and spawned a duplicate that raced it for the socket.
 */
import http from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawned = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../core/search/search-server.js', async (importOriginal) => ({
  ...(await importOriginal()),
  autoSpawnServer: async () => { spawned.count++; return false; },
}));

const { runInVirtualProcess } = await import('../../core/agent-tools/virtual-process.js');
const { runAgentTool } = await import('../../eval/agent-read-workflows/bin/_ss-helpers.mjs');

let base;
let root;
let server;

beforeEach(() => {
  spawned.count = 0;
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-search-warm-wait-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(root, '.sweet-search', 'codebase.db'), '');
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  rmSync(base, { recursive: true, force: true });
});

/** A daemon that loads for `loadMs`; while loading it answers /health late (or not at all). */
async function fakeDaemon({ loadMs, silentWhileLoading, failed = false }) {
  const socketPath = path.join(base, 'd.sock');
  const readyAt = Date.now() + loadMs;
  server = http.createServer((req, res) => {
    const ready = Date.now() >= readyAt;
    if (req.url.startsWith('/health')) {
      if (!ready && silentWhileLoading) return; // a busy event loop: the probe times out
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(failed ? { status: 'failed', warm: false } : { status: ready ? 'ready' : 'starting', warm: ready }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: [], serverProjectRoot: root }));
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  return socketPath;
}

async function ssSearch(socketPath) {
  const env = { ...process.env, SWEET_SEARCH_SOCKET_PATH: socketPath, SWEET_SEARCH_PROJECT_ROOT: root };
  return runInVirtualProcess({ env, cwd: root, pid: process.pid }, () => runAgentTool('agent-search', ['settings panel']));
}

describe('ss-search and a daemon that is still loading', () => {
  it('waits past a "starting" daemon instead of refusing', async () => {
    const socketPath = await fakeDaemon({ loadMs: 2500, silentWhileLoading: false });
    const result = await ssSearch(socketPath);
    expect(result.stderr.toString()).not.toContain('warm server is not ready');
    expect(result.code).toBe(0);
    expect(spawned.count).toBe(0);
  }, 20_000);

  it('does not spawn a second daemon while the first one is too busy to answer /health', async () => {
    const socketPath = await fakeDaemon({ loadMs: 3500, silentWhileLoading: true });
    const result = await ssSearch(socketPath);
    expect(result.stderr.toString()).not.toContain('warm server is not ready');
    expect(result.code).toBe(0);
    expect(spawned.count).toBe(0);
  }, 20_000);

  it('replaces a daemon whose init failed once, then refuses with a next step', async () => {
    const socketPath = await fakeDaemon({ loadMs: 0, silentWhileLoading: false, failed: true });
    const result = await ssSearch(socketPath);
    expect(spawned.count).toBe(1);
    expect(result.code).toBe(1);
    expect(result.stderr.toString()).toContain('Run ss-search again, or use ss-grep meanwhile.');
  }, 20_000);
});
