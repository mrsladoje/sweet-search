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
 * files, and the next request starts a new child. A child that sends nothing
 * for `requestTimeoutMs` (hung in a native call) is killed the same way. A
 * child whose RSS passes `rssMaxBytes` is stopped after its reply and replaced
 * on the next request. The child is killed, not drained, on close and when the
 * maintainer exits: encoder work is always safe to throw away.
 */

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordEncode } from './inference-provenance.js';

const HOST = fileURLToPath(new URL('./encoder-host.mjs', import.meta.url));

export const DEFAULT_ENCODER_IDLE_MS = 60_000;
// Cap of the adaptive idle period (maxIdleMs): see armIdle.
export const DEFAULT_ENCODER_IDLE_MAX_MS = 10 * 60_000;
export const DEFAULT_ENCODER_RSS_MAX_BYTES = 6 * 1024 ** 3;
// Longest silence from a busy child (no progress, no reply). One LI batch is at
// most ~4k tokens; even 2 threads on a slow laptop finish it far sooner.
export const DEFAULT_ENCODER_REQUEST_TIMEOUT_MS = 120_000;

export function encoderIdleMs(env = process.env) {
  const n = Number(env.SWEET_SEARCH_ENCODER_IDLE_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ENCODER_IDLE_MS;
}

export function encoderIdleMaxMs(env = process.env) {
  const n = Number(env.SWEET_SEARCH_ENCODER_IDLE_MAX_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ENCODER_IDLE_MAX_MS;
}

/**
 * @param {object} [options]
 * @param {number} [options.idleMs]
 * @param {number} [options.maxIdleMs]  adaptive cap (default: idleMs, i.e. fixed)
 * @param {number} [options.rssMaxBytes]
 * @param {number} [options.requestTimeoutMs]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(level:string, msg:string)=>void} [options.log]
 * @param {string} [options.hostPath]  test seam
 * @param {string} [options.execPath]  test seam (node binary for the child)
 * @param {(pid:number|null)=>void} [options.onChildChange]  the child started (pid) or is gone (null)
 */
export function createEncoderClient(options = {}) {
  const idleMs = options.idleMs ?? DEFAULT_ENCODER_IDLE_MS;
  const maxIdleMs = Math.max(idleMs, options.maxIdleMs ?? idleMs);
  // Adaptive idle: a process needed again within maxIdleMs of its idle exit doubles the
  // next idle period (up to maxIdleMs), so an editing session keeps the models loaded
  // instead of paying a cold start (seconds, more under load) every minute. After a
  // longer quiet spell it starts again from idleMs.
  let currentIdleMs = idleMs;
  let lastIdleExitAt = null;
  const rssMaxBytes = options.rssMaxBytes ?? DEFAULT_ENCODER_RSS_MAX_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_ENCODER_REQUEST_TIMEOUT_MS;
  // Silence allowed before a new child's first message (process start, module load).
  // Defaults to the request timeout; never shorter than it.
  const startupGraceMs = Math.max(requestTimeoutMs, options.startupGraceMs ?? requestTimeoutMs);
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  const hostPath = options.hostPath ?? HOST;
  const execPath = options.execPath ?? process.execPath;
  const onChildChange = options.onChildChange ?? (() => {});
  // Where the child's stdout goes: inherited, or 2 = this process's stderr (an MCP server's
  // stdout is its protocol channel, and model loading logs).
  const childStdout = options.childStdout ?? 'inherit';
  const announce = (pid) => { try { onChildChange(pid); } catch { /* best-effort */ } };
  let child = null;
  let seq = 0;
  let idleTimer = null;
  let silenceTimer = null;
  let spawns = 0;
  const pending = new Map();
  const killOnExit = () => { try { child?.kill('SIGKILL'); } catch { /* gone */ } };
  process.once('exit', killOnExit);

  // Any message from the child proves it is alive; silence while requests are
  // pending means it hung.
  function armSilence(c) {
    clearTimeout(silenceTimer);
    if (pending.size === 0) return;
    const limitMs = c.spoke ? requestTimeoutMs : startupGraceMs;
    silenceTimer = setTimeout(() => {
      if (child !== c || pending.size === 0) return;
      log('WARN', `Encoder process ${c.pid} sent nothing for ${limitMs} ms; killing it`);
      child = null;
      try { c.kill('SIGKILL'); } catch { /* gone */ }
      failPending(c, `encoder process timed out after ${limitMs} ms`);
    }, limitMs);
    silenceTimer.unref?.();
  }

  function failPending(child_, reason) {
    for (const [id, p] of pending) {
      if (p.child !== child_) continue;
      pending.delete(id);
      p.reject(new Error(reason));
    }
  }

  function stop(reason, { kill = false } = {}) {
    const c = child;
    if (!c) return;
    child = null;
    log('INFO', `Encoder process ${c.pid} stopping (${reason})`);
    if (kill) {
      try { c.kill('SIGKILL'); } catch { /* gone */ }
      return;
    }
    try { c.disconnect(); } catch { /* already gone */ }
    // A child stuck in a native call never sees the disconnect.
    const killTimer = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, 5_000);
    killTimer.unref?.();
    c.once('exit', () => clearTimeout(killTimer));
  }

  function start() {
    const now = Date.now();
    currentIdleMs = lastIdleExitAt !== null && now - lastIdleExitAt < maxIdleMs
      ? Math.min(maxIdleMs, currentIdleMs * 2)
      : idleMs;
    const c = fork(hostPath, [], {
      env,
      execPath,
      serialization: 'advanced',
      stdio: ['ignore', childStdout, 'inherit', 'ipc'],
    });
    spawns += 1;
    // A dead or unreachable child fails its requests at once: node does not
    // promise an 'exit' after an 'error' (e.g. spawn ENOENT, EPIPE on send).
    const abandon = (reason) => {
      if (child === c) child = null;
      try { c.kill('SIGKILL'); } catch { /* gone */ }
      failPending(c, reason);
    };
    c.on('message', (msg) => {
      c.spoke = true;
      if (child === c) armSilence(c);
      const p = pending.get(msg?.id);
      if (!p) return;
      if (msg.progress) {
        // The maintainer's progress callback throws to cancel (shutdown, lost
        // lock). Turn that into this request's rejection instead of an
        // exception escaping the IPC handler.
        try {
          p.onProgress?.();
        } catch (err) {
          pending.delete(msg.id);
          p.reject(err);
          abandon('cancelled');
        }
        return;
      }
      pending.delete(msg.id);
      if (msg.ok) {
        for (const [label, n] of Object.entries(msg.provenance?.dense ?? {})) recordEncode('dense', label, n);
        p.resolve(msg.result);
      } else {
        p.reject(new Error(`encoder process: ${msg.error}`));
      }
      if (msg.rss > rssMaxBytes && child === c) stop(`rss ${Math.round(msg.rss / 1048576)} MB over the cap`);
    });
    c.on('error', (err) => {
      log('WARN', `Encoder process error: ${err?.message ?? err}`);
      abandon(`encoder process error: ${err?.message ?? err}`);
    });
    c.on('disconnect', () => abandon('encoder process disconnected'));
    c.on('exit', (code, signal) => {
      if (child === c) child = null;
      if (!child) announce(null);
      failPending(c, `encoder process exited (code=${code}, signal=${signal})`);
    });
    log('INFO', `Encoder process ${c.pid} started`);
    announce(c.pid);
    return c;
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (pending.size !== 0) return;
      lastIdleExitAt = Date.now();
      stop('idle');
    }, currentIdleMs);
    idleTimer.unref?.();
  }

  function call(op, texts, onProgress, options) {
    clearTimeout(idleTimer);
    if (!child) child = start();
    const c = child;
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress, child: c });
      armSilence(c);
      try {
        c.send(options ? { id, op, texts, options } : { id, op, texts }, (err) => {
          if (err && pending.has(id)) {
            pending.delete(id);
            reject(err);
          }
        });
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    }).finally(() => {
      if (pending.size === 0) { clearTimeout(silenceTimer); armIdle(); }
    });
  }

  /** Dense vectors, same contract as getEmbeddings(texts, { useCache: false }). */
  const dense = (texts, progressOptions = {}) => call('dense', texts, progressOptions.onProgress);
  /** Late-interaction token matrices, same contract as encodeDocumentsCpu. */
  const li = (texts) => call('li', texts);
  li.countTokens = (texts) => call('count', texts);
  li.provenanceLabel = 'ort/cpu';
  /** Start the process and load both models without waiting (the first edit after idle). */
  const warm = () => { if (!child) call('warm', []).catch(() => {}); };
  /** A request by op name, for the query role (see encoder-host.mjs). */
  const request = (op, texts, options) => call(op, texts, undefined, options);

  return {
    dense,
    li,
    warm,
    request,
    close: () => {
      clearTimeout(idleTimer);
      clearTimeout(silenceTimer);
      stop('shutdown', { kill: true });
      process.removeListener('exit', killOnExit);
    },
    get pid() { return child?.pid ?? null; },
    get spawns() { return spawns; },
    get idleMs() { return currentIdleMs; },
  };
}
