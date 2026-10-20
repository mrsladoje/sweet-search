/**
 * Runs the maintainer's encoders in a child process (encoder-host.mjs).
 *
 * The maintainer stays at ~150 MB between edits instead of holding both ONNX
 * sessions and their freed activations (565 MB idle after a drain, 1-1.5 GB
 * right after an encode). The child starts on the first encode and stops after
 * `idleMs` without requests, so the memory goes back to the OS; the next edit
 * pays one model load (~2-3 s), well inside the 30 s freshness target.
 *
 * A child that dies fails its pending requests: the tick fails and requeues its
 * files, and the next request starts a new child. A child whose RSS passes
 * `rssMaxBytes` is stopped after its reply and replaced on the next request.
 */

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordEncode } from './inference-provenance.js';

const HOST = fileURLToPath(new URL('./encoder-host.mjs', import.meta.url));

export const DEFAULT_ENCODER_IDLE_MS = 60_000;
export const DEFAULT_ENCODER_RSS_MAX_BYTES = 6 * 1024 ** 3;

/** Child-process encoders unless SWEET_SEARCH_MAINTAINER_ENCODER_PROCESS=0. */
export function encoderProcessEnabled(env = process.env) {
  return env.SWEET_SEARCH_MAINTAINER_ENCODER_PROCESS !== '0';
}

export function encoderIdleMs(env = process.env) {
  const n = Number(env.SWEET_SEARCH_ENCODER_IDLE_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ENCODER_IDLE_MS;
}

/**
 * @param {object} [options]
 * @param {number} [options.idleMs]
 * @param {number} [options.rssMaxBytes]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(level:string, msg:string)=>void} [options.log]
 * @param {string} [options.hostPath]  test seam
 */
export function createEncoderClient(options = {}) {
  const idleMs = options.idleMs ?? DEFAULT_ENCODER_IDLE_MS;
  const rssMaxBytes = options.rssMaxBytes ?? DEFAULT_ENCODER_RSS_MAX_BYTES;
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  const hostPath = options.hostPath ?? HOST;
  let child = null;
  let seq = 0;
  let idleTimer = null;
  let spawns = 0;
  const pending = new Map();

  function failPending(child_, reason) {
    for (const [id, p] of pending) {
      if (p.child !== child_) continue;
      pending.delete(id);
      p.reject(new Error(reason));
    }
  }

  function stop(reason) {
    const c = child;
    if (!c) return;
    child = null;
    log('INFO', `Encoder process ${c.pid} stopping (${reason})`);
    try { c.disconnect(); } catch { /* already gone */ }
    // A child stuck in a native call never sees the disconnect.
    const killTimer = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, 5_000);
    killTimer.unref?.();
    c.once('exit', () => clearTimeout(killTimer));
  }

  function start() {
    const c = fork(hostPath, [], {
      env,
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    spawns += 1;
    c.on('message', (msg) => {
      const p = pending.get(msg?.id);
      if (!p) return;
      if (msg.progress) { p.onProgress?.(); return; }
      pending.delete(msg.id);
      if (msg.ok) {
        for (const [label, n] of Object.entries(msg.provenance?.dense ?? {})) recordEncode('dense', label, n);
        p.resolve(msg.result);
        if (msg.rss > rssMaxBytes && child === c) stop(`rss ${Math.round(msg.rss / 1048576)} MB over the cap`);
      } else {
        p.reject(new Error(`encoder process: ${msg.error}`));
      }
    });
    c.on('error', (err) => log('WARN', `Encoder process error: ${err?.message ?? err}`));
    c.on('exit', (code, signal) => {
      if (child === c) child = null;
      failPending(c, `encoder process exited (code=${code}, signal=${signal})`);
    });
    log('INFO', `Encoder process ${c.pid} started`);
    return c;
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (pending.size === 0) stop('idle'); }, idleMs);
    idleTimer.unref?.();
  }

  function call(op, texts, onProgress) {
    clearTimeout(idleTimer);
    if (!child) child = start();
    const c = child;
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress, child: c });
      try {
        c.send({ id, op, texts });
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    }).finally(() => { if (pending.size === 0) armIdle(); });
  }

  /** Dense vectors, same contract as getEmbeddings(texts, { useCache: false }). */
  const dense = (texts, progressOptions = {}) => call('dense', texts, progressOptions.onProgress);
  /** Late-interaction token matrices, same contract as encodeDocumentsCpu. */
  const li = (texts) => call('li', texts);
  li.countTokens = (texts) => call('count', texts);
  li.provenanceLabel = 'ort/cpu';

  return {
    dense,
    li,
    close: () => { clearTimeout(idleTimer); stop('shutdown'); },
    get pid() { return child?.pid ?? null; },
    get spawns() { return spawns; },
  };
}
