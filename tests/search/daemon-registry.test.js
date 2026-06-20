/**
 * Unit tests for the resident search-daemon registry (footprint LRU cap).
 *
 * Pure logic, no real index: atomic persistence, dead-entry pruning, and
 * least-recently-active eviction selection. Each test points the registry at a
 * throwaway /tmp file via SWEET_SEARCH_DAEMON_REGISTRY so the shared default
 * path is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import {
  registryPath,
  pidAlive,
  readRegistry,
  upsertSelf,
  touchSelf,
  removeSelf,
  pruneAndList,
  selectEvictionTargets,
  socketHealthy,
} from '../../core/search/daemon-registry.js';

let dir;
let env;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ss-registry-'));
  env = { SWEET_SEARCH_DAEMON_REGISTRY: join(dir, 'daemons.json') };
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function entry(pid, lastActivityMs, extra = {}) {
  return { pid, projectRoot: `/p/${pid}`, socketPath: `/tmp/s${pid}.sock`, pidFile: `/tmp/s${pid}.pid`, startedAt: 1, lastActivityMs, ...extra };
}

function fakeHealthServer(socketPath, { status = 200 } = {}) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(status); res.end('{}'); return; }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.off('error', reject); resolve(server); });
  });
}
const closeServer = (s) => new Promise((r) => s.close(() => r()));

describe('registryPath', () => {
  it('honors the SWEET_SEARCH_DAEMON_REGISTRY override and a sane default', () => {
    expect(registryPath(env)).toBe(join(dir, 'daemons.json'));
    expect(registryPath({})).toBe('/tmp/sweet-search-daemons.json');
  });
});

describe('pidAlive', () => {
  it('is true for the current process and false for a dead/invalid pid', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(0x3fffffff)).toBe(false); // almost-certainly-unused high pid
    expect(pidAlive('nope')).toBe(false);
    expect(pidAlive(-1)).toBe(false);
  });
});

describe('upsert / read / touch / remove', () => {
  it('round-trips an entry and leaves valid JSON with no stray tmp file', async () => {
    await upsertSelf(entry(process.pid, 100), env);
    const map = await readRegistry(env);
    expect(map[String(process.pid)]).toMatchObject({ pid: process.pid, lastActivityMs: 100 });

    // Atomic write: a parseable file, and no leftover ".tmp" sibling.
    const raw = readFileSync(registryPath(env), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('touchSelf updates lastActivityMs only for an existing entry', async () => {
    await upsertSelf(entry(process.pid, 100), env);
    expect(await touchSelf(process.pid, 555, env)).toBe(true);
    expect((await readRegistry(env))[String(process.pid)].lastActivityMs).toBe(555);

    // Unknown pid: no-op, returns false, does not create an entry.
    expect(await touchSelf(0x3fffffff, 999, env)).toBe(false);
    expect((await readRegistry(env))[String(0x3fffffff)]).toBeUndefined();
  });

  it('removeSelf deletes its own entry and is idempotent', async () => {
    await upsertSelf(entry(process.pid, 100), env);
    expect(await removeSelf(process.pid, env)).toBe(true);
    expect((await readRegistry(env))[String(process.pid)]).toBeUndefined();
    expect(await removeSelf(process.pid, env)).toBe(false); // already gone
  });

  it('readRegistry tolerates a missing or corrupt file', async () => {
    expect(await readRegistry(env)).toEqual({}); // missing
    const { writeFileSync } = await import('node:fs');
    writeFileSync(registryPath(env), 'not json{', 'utf-8');
    expect(await readRegistry(env)).toEqual({}); // corrupt
  });
});

describe('pruneAndList', () => {
  it('drops dead entries (injected probe), keeps live, and persists the pruned map', async () => {
    await upsertSelf(entry(1, 10), env);
    await upsertSelf(entry(2, 20), env);
    await upsertSelf(entry(3, 30), env);
    // Probe: only pid 2 is "live".
    const live = await pruneAndList({ env, probe: (e) => e.pid === 2 });
    expect(live.map((e) => e.pid)).toEqual([2]);
    // Dead entries were removed from the file, not just filtered in memory.
    expect(Object.keys(await readRegistry(env))).toEqual(['2']);
  });

  it('uses pid+socket health by default: a real listener survives, a dead socket is pruned', async () => {
    const liveSock = join(dir, 'live.sock');
    const server = await fakeHealthServer(liveSock);
    try {
      await upsertSelf(entry(process.pid, 10, { socketPath: liveSock }), env);   // alive pid + live socket
      await upsertSelf(entry(process.pid, 20, { socketPath: join(dir, 'dead.sock') }), env); // overwrites — different test below

      // Re-seed two distinct entries: one healthy, one with a dead socket.
      await upsertSelf(entry(process.pid, 10, { socketPath: liveSock }), env);
      const map = await readRegistry(env);
      map['99999991'] = entry(99999991, 5, { socketPath: join(dir, 'dead.sock') });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(registryPath(env), JSON.stringify({ daemons: map }), 'utf-8');

      // Raise the probe budget well above the default 300ms: under CPU
      // contention from the heavy daemon-lifecycle.integration.test.js the
      // socketHealthy probe intermittently times out, the live self-socket is
      // mis-pruned, and `toContain(process.pid)` flakes. 1500ms keeps the
      // real-listener probe from being starved without weakening the assertion
      // (a live pid+socket must still be retained; a dead socket still pruned).
      const live = await pruneAndList({ env, timeoutMs: 1500 });
      const pids = live.map((e) => e.pid).sort((a, b) => a - b);
      expect(pids).toContain(process.pid);     // alive pid + responsive socket
      expect(pids).not.toContain(99999991);    // dead socket pruned
    } finally {
      await closeServer(server);
    }
  });
});

describe('selectEvictionTargets', () => {
  const live = [entry(10, 300), entry(11, 100), entry(12, 200), entry(13, 400)];

  it('from the newest daemon: sheds the least-recently-active peers first, bounded by count', () => {
    // self = 13 (freshest, 400) — every peer is older, so the surplus is the
    // oldest `count` of them.
    expect(selectEvictionTargets(live, 13, 2).map((e) => e.pid)).toEqual([11, 12]);
    expect(selectEvictionTargets(live, 13, 1).map((e) => e.pid)).toEqual([11]);
  });

  it('only sheds peers LESS-recently-active than self (concurrency convergence)', () => {
    // Oldest daemon (11, activity 100) has no older peers → evicts nothing,
    // even asking for many. This is what stops the oldest from evicting newer
    // peers and over-shooting the cap.
    expect(selectEvictionTargets(live, 11, 5)).toEqual([]);
    // A middle daemon (12, activity 200) only sees 11 as older.
    expect(selectEvictionTargets(live, 12, 5).map((e) => e.pid)).toEqual([11]);
  });

  it('falls back to plain least-recently-active when self is absent', () => {
    expect(selectEvictionTargets(live, 999, 2).map((e) => e.pid)).toEqual([11, 12]);
  });

  it('honors a zero/negative count and a non-array input', () => {
    expect(selectEvictionTargets(live, 13, 0)).toEqual([]);
    expect(selectEvictionTargets(live, 13, -5)).toEqual([]);
    expect(selectEvictionTargets(null, 13, 3)).toEqual([]);
  });
});

describe('socketHealthy', () => {
  it('is true against a 200 /health listener and false otherwise', async () => {
    const sock = join(dir, 'h.sock');
    const server = await fakeHealthServer(sock);
    try {
      expect(await socketHealthy(sock, 300)).toBe(true);
    } finally {
      await closeServer(server);
    }
    expect(await socketHealthy(join(dir, 'nonexistent.sock'), 300)).toBe(false);
  });

  it('is false when /health replies non-200', async () => {
    const sock = join(dir, 'bad.sock');
    const server = await fakeHealthServer(sock, { status: 503 });
    try {
      expect(await socketHealthy(sock, 300)).toBe(false);
    } finally {
      await closeServer(server);
    }
  });
});
