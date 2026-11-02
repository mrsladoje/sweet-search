/**
 * Client of the shared query-model server (query-encoder-server.mjs).
 *
 * Same contract as the per-daemon child's client (encoder-client.mjs `request`), so
 * query-encoder.mjs can hand either to the model delegates. Daemons whose model setup
 * has the same key share one server: the key covers everything that changes what the
 * models compute (the late-interaction model choice, the SWEET_SEARCH_/ORT settings, the
 * node binary and this code's version), so two daemons that would load different models
 * never meet on one socket.
 *
 * The first request with no server answering starts one (detached: it serves the other
 * daemons too, and stops on its own after the idle period). A request whose connection
 * fails or drops is retried once on a fresh connection, starting a server if needed; a
 * server silent for `requestTimeoutMs` fails the request.
 *
 * SWEET_SEARCH_SHARED_QUERY_ENCODER=0 keeps one child per daemon.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeFrame, createFrameReader } from './query-encoder-server.mjs';
import { dirTrustworthy, privateRuntimeDir } from './daemon-registry.js';
import { readPersistedLiPolicy, resolveRuntimeLiModel } from '../infrastructure/init-config.js';
import { recordSpawn } from '../infrastructure/spawn-ledger.js';

const SERVER = fileURLToPath(new URL('./query-encoder-server.mjs', import.meta.url));
const OPS = fileURLToPath(new URL('../indexing/encoder-ops.mjs', import.meta.url));
// Unix socket paths are limited to 104 bytes (macOS) / 108 (Linux), the terminator included.
const MAX_SOCKET_PATH = 100;
// Settings that name this daemon's checkout, session, calling process or lifetimes, not
// the models. The daemon inherits the environment of the call that started it
// (SWEET_SEARCH_CHAIN_PID differs per call), so these must not split the key. No model
// setting has such a name (checked against core/embedding, core/ranking,
// core/infrastructure when this was written).
const NOT_MODEL_SETTINGS = new Set([
  'SWEET_SEARCH_ENCODER_ROLE', 'SWEET_SEARCH_MAX_DAEMONS', 'SWEET_SEARCH_PREWARM_VERBOSE',
]);
const NOT_MODEL_SETTING_SHAPE = /(_PID|_PIDS|_ROOT|_DIR|_ID|_MS)$|^SWEET_SEARCH_(MAINTAINER|DAEMON|CHAIN|RECONCILE|WORKTREE)_/;
const MODEL_SETTING = /^(SWEET_SEARCH_|ORT_|OMP_|ONNX|OPENVINO)/;
const isModelSetting = (k) => MODEL_SETTING.test(k) && !NOT_MODEL_SETTINGS.has(k) && !NOT_MODEL_SETTING_SHAPE.test(k);

export function sharedQueryEncoderEnabled(env = process.env, platform = process.platform) {
  return env.SWEET_SEARCH_SHARED_QUERY_ENCODER !== '0' && platform !== 'win32';
}

/** The late-interaction model this checkout's queries use ('none' when off). */
export function resolvedLiModel(projectRoot, env = process.env) {
  let persisted = null;
  try { persisted = readPersistedLiPolicy(projectRoot).liModel ?? null; } catch { persisted = null; }
  const m = resolveRuntimeLiModel(persisted, env, 'lateon-code');
  return m === false ? 'none' : String(m);
}

function fileStamp(file) {
  try { return String(fs.statSync(file).mtimeMs); } catch { return ''; }
}

/** The key two daemons must share to share one server. */
export function queryEncoderKey({ env = process.env, projectRoot, liModel = resolvedLiModel(projectRoot, env) }) {
  const settings = Object.keys(env)
    .filter(isModelSetting)
    .sort()
    .map((k) => [k, env[k]]);
  return createHash('sha1').update(JSON.stringify({
    v: 1,
    node: process.execPath,
    nodeVersion: process.versions.node,
    code: [SERVER, fileStamp(SERVER), fileStamp(OPS)],
    liModel,
    settings,
  })).digest('hex').slice(0, 16);
}

/** The socket for `key`, or null when the runtime dir makes the path too long. */
export function sharedSocketPath(key, env = process.env) {
  const p = path.join(privateRuntimeDir(env), `query-models-${key}.sock`);
  return Buffer.byteLength(p) <= MAX_SOCKET_PATH ? p : null;
}

/**
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {number} opts.idleMs   the server's idle period
 * @param {number} [opts.requestTimeoutMs]
 * @param {number} [opts.startupGraceMs]  how long to wait for a new server to answer
 * @param {(level: string, msg: string) => void} [opts.log]
 * @returns {null | {request: Function, close: Function, socketPath: string, readonly pid: null}}
 *   null when sharing is off or not possible here (the caller uses its own child).
 */
export function createSharedQueryEncoderClient({
  projectRoot, env = process.env, idleMs, requestTimeoutMs = 120_000, startupGraceMs = 30_000, log = () => {},
  serverPath = SERVER,
}) {
  if (!sharedQueryEncoderEnabled(env)) return null;
  const liModel = resolvedLiModel(projectRoot, env);
  const key = queryEncoderKey({ env, projectRoot, liModel });
  const socketPath = sharedSocketPath(key, env);
  if (!socketPath) return null;
  const runtimeDir = path.dirname(socketPath);
  // The socket carries query text and returns the vectors search ranks with: only in a
  // directory this user owns and nobody else can write (else a child of this daemon).
  if (!dirTrustworthy(runtimeDir)) return null;

  let conn = null; // { socket, pending: Map }
  let opening = null; // one connect at a time: concurrent first requests share it
  let seq = 0;
  let closed = false;

  function startServer() {
    const child = spawn(process.execPath, [serverPath, `--socket=${socketPath}`, `--idle-ms=${idleMs}`], {
      detached: true,
      stdio: 'ignore',
      cwd: runtimeDir,
      // The server must not depend on this checkout: a worktree can be removed while the
      // server still serves others. Pin the model choice instead of reading it there.
      env: { ...env, SWEET_SEARCH_PROJECT_ROOT: runtimeDir, SWEET_SEARCH_LATE_INTERACTION_MODEL: liModel, SWEET_SEARCH_ENCODER_ROLE: 'query' },
    });
    child.on('error', () => { /* the connect attempts report it */ });
    child.unref();
    recordSpawn({ pid: child.pid, role: 'query-encoder', projectRoot, env });
    log('INFO', `Shared query-model server ${child.pid} started (${path.basename(socketPath)})`);
  }

  function connectOnce() {
    return new Promise((resolve, reject) => {
      const socket = net.connect(socketPath);
      socket.once('connect', () => { socket.removeAllListeners('error'); resolve(socket); });
      socket.once('error', reject);
    });
  }

  async function open() {
    let socket;
    try {
      socket = await connectOnce();
    } catch {
      startServer();
      const deadline = Date.now() + startupGraceMs;
      for (;;) {
        await new Promise((r) => setTimeout(r, 50));
        try { socket = await connectOnce(); break; } catch (err) {
          if (Date.now() > deadline) throw new Error(`shared query-model server did not answer on ${socketPath}: ${err?.message || err}`);
        }
      }
    }
    const c = { socket, pending: new Map() };
    const fail = (reason) => {
      if (conn === c) conn = null;
      for (const p of c.pending.values()) { clearTimeout(p.timer); p.reject(Object.assign(new Error(reason), { retryable: true })); }
      c.pending.clear();
    };
    const reader = createFrameReader((msg) => {
      const p = c.pending.get(msg?.id);
      if (!p) return;
      c.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(`query-model server: ${msg.error}`));
    });
    socket.on('data', (chunk) => {
      try { reader(chunk); } catch (err) { socket.destroy(); fail(`bad reply: ${err?.message || err}`); }
    });
    socket.on('error', () => {});
    socket.on('close', () => fail('query-model server connection closed'));
    socket.unref(); // an idle connection never keeps the daemon alive
    return c;
  }

  async function send(op, texts, options) {
    if (closed) throw new Error('query-model client closed');
    if (!conn) {
      opening ??= open().finally(() => { opening = null; });
      conn = await opening;
    }
    const c = conn;
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!c.pending.delete(id)) return;
        reject(new Error(`query-model server sent nothing for ${requestTimeoutMs} ms`));
        c.socket.destroy();
      }, requestTimeoutMs);
      timer.unref?.();
      c.pending.set(id, { resolve, reject, timer });
      c.socket.ref(); // a request in flight keeps the daemon waiting for it
      c.socket.write(encodeFrame(options ? { id, op, texts, options } : { id, op, texts }));
    }).finally(() => { if (c.pending.size === 0) c.socket.unref(); });
  }

  async function request(op, texts, options) {
    try {
      return await send(op, texts, options);
    } catch (err) {
      // The server went away between requests (idle exit, memory cap): one retry, on a
      // new connection that starts a new server when none answers.
      if (!err?.retryable || closed) throw err;
      return send(op, texts, options);
    }
  }

  return {
    request,
    socketPath,
    close() {
      closed = true;
      // The server is shared: only this daemon's connection goes.
      conn?.socket.destroy();
      conn = null;
    },
    get pid() { return null; },
  };
}
