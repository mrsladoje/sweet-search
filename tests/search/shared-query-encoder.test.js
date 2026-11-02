/**
 * The shared query-model server (core/search/query-encoder-server.mjs) and its client
 * (core/search/shared-query-encoder.mjs), with a fake model module: the transport, the
 * key, sharing between daemons, idle exit and the restart after it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSharedQueryEncoderClient, queryEncoderKey, sharedQueryEncoderEnabled, sharedSocketPath,
} from '../../core/search/shared-query-encoder.mjs';
import { encodeFrame, createFrameReader } from '../../core/search/query-encoder-server.mjs';

const FAKE_OPS = fileURLToPath(new URL('../__test_fixtures__/query-encoder/fake-encoder-ops.mjs', import.meta.url));

let runtimeDir;
let clients;
const env = () => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  SWEET_SEARCH_RUNTIME_DIR: runtimeDir,
  SWEET_SEARCH_QUERY_ENCODER_OPS: FAKE_OPS,
});
const client = (extra = {}, opts = {}) => {
  const c = createSharedQueryEncoderClient({ projectRoot: runtimeDir, env: { ...env(), ...extra }, idleMs: 60_000, ...opts });
  clients.push(c);
  return c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssqe-'));
  clients = [];
});

afterEach(async () => {
  // Stop the servers this test started: a request that makes the server exit.
  for (const c of clients) {
    try { await c.request('exit', []); } catch { /* already gone */ }
    c.close();
  }
  await sleep(50);
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

describe('frames', () => {
  it('round-trips values with typed arrays across chunk boundaries', () => {
    const got = [];
    const read = createFrameReader((v) => got.push(v));
    const bytes = Buffer.concat([encodeFrame({ id: 1, result: [Float32Array.from([1.5, 2])] }), encodeFrame({ id: 2, ok: false })]);
    for (let i = 0; i < bytes.length; i += 3) read(bytes.subarray(i, i + 3));
    expect(got).toHaveLength(2);
    expect(got[0].result[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(got[0].result[0])).toEqual([1.5, 2]);
    expect(got[1]).toEqual({ id: 2, ok: false });
  });
});

describe('queryEncoderKey', () => {
  it('ignores the settings that name a checkout, a session or a calling process', () => {
    const base = { SWEET_SEARCH_INTRA_OP_THREADS: '8' };
    const a = queryEncoderKey({ env: { ...base, SWEET_SEARCH_CHAIN_PID: '1', SWEET_SEARCH_PROJECT_ROOT: '/a', SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS: '1' }, liModel: 'lateon-code' });
    const b = queryEncoderKey({ env: { ...base, SWEET_SEARCH_CHAIN_PID: '2', SWEET_SEARCH_PROJECT_ROOT: '/b', SWEET_SEARCH_SESSION_ID: 'x' }, liModel: 'lateon-code' });
    expect(a).toBe(b);
  });

  it('separates daemons whose models would differ', () => {
    const k = (env, liModel = 'lateon-code') => queryEncoderKey({ env, liModel });
    const base = k({ SWEET_SEARCH_INTRA_OP_THREADS: '8' });
    expect(k({ SWEET_SEARCH_INTRA_OP_THREADS: '4' })).not.toBe(base);
    expect(k({ SWEET_SEARCH_INTRA_OP_THREADS: '8', SWEET_SEARCH_EMBED_USE_CPU: '1' })).not.toBe(base);
    expect(k({ SWEET_SEARCH_INTRA_OP_THREADS: '8' }, 'lateon-code-edge')).not.toBe(base);
  });

  it('is off when switched off, on Windows, or when the socket path would be too long', () => {
    expect(sharedQueryEncoderEnabled({ SWEET_SEARCH_SHARED_QUERY_ENCODER: '0' })).toBe(false);
    expect(sharedQueryEncoderEnabled({}, 'win32')).toBe(false);
    expect(sharedQueryEncoderEnabled({}, 'darwin')).toBe(true);
    expect(sharedSocketPath('k', { SWEET_SEARCH_RUNTIME_DIR: `/tmp/${'x'.repeat(120)}` })).toBe(null);
  });
});

describe('shared server', () => {
  it('serves several daemons from one process', async () => {
    const a = client({ SWEET_SEARCH_CHAIN_PID: '1' });
    const b = client({ SWEET_SEARCH_CHAIN_PID: '2' });
    expect(a.socketPath).toBe(b.socketPath);
    // Concurrent first requests from both: still one server.
    const [pa, pb] = await Promise.all([a.request('pid', []), b.request('pid', [])]);
    expect(pa).toBe(pb);
    expect(pa).not.toBe(process.pid);
    const v = await a.request('echo', ['abc', 'de'], { scale: 3 });
    expect(v.map((x) => Array.from(x))).toEqual([[3, 3], [2, 3]]);
  });

  it('pins the model choice and does not depend on the checkout that started it', async () => {
    const a = client();
    expect(await a.request('env', ['SWEET_SEARCH_LATE_INTERACTION_MODEL'])).toBe('lateon-code');
    expect(await a.request('env', ['SWEET_SEARCH_PROJECT_ROOT'])).toBe(path.dirname(a.socketPath));
  });

  it('reports a model error without dropping the connection', async () => {
    const a = client();
    await expect(a.request('fail', [])).rejects.toThrow(/fake failure/);
    expect(typeof (await a.request('pid', []))).toBe('number');
  });

  it('exits when idle, and the next request starts a new server', async () => {
    const a = client({}, { idleMs: 300 });
    const first = await a.request('pid', []);
    for (let i = 0; i < 100 && fs.existsSync(a.socketPath); i++) await sleep(50);
    expect(fs.existsSync(a.socketPath)).toBe(false);
    const second = await a.request('pid', []);
    expect(second).not.toBe(first);
  }, 20_000);

  it('retries once when the server goes away between requests', async () => {
    const a = client();
    const first = await a.request('pid', []);
    process.kill(first, 'SIGKILL');
    await sleep(100);
    const second = await a.request('pid', []);
    expect(second).not.toBe(first);
  }, 20_000);

  it('takes over a start lock left by a server that died, even when its pid is alive again', async () => {
    const a = client();
    // A lock older than a start can take, naming a live process (pid reuse): stale.
    fs.writeFileSync(`${a.socketPath}.start`, String(process.pid));
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(`${a.socketPath}.start`, old, old);
    expect(typeof (await a.request('pid', []))).toBe('number');
  }, 20_000);

  it('marks a server that never answers as unavailable (the daemon then uses its own child)', async () => {
    const never = path.join(runtimeDir, 'never.mjs');
    fs.writeFileSync(never, 'process.exit(0);\n');
    const a = client({}, { serverPath: never, startupGraceMs: 300 });
    const err = await a.request('pid', []).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.sharedUnavailable).toBe(true);
  }, 20_000);
});

