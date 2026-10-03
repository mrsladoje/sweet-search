/**
 * One ss-* call as a virtual process.
 *
 * The ss-* tool code (eval/agent-read-workflows/bin/_ss-helpers.mjs) was written for a
 * fresh node process per call: it reads `process.env`, `process.cwd()`, writes to
 * `process.stdout` / `process.stderr`, and ends with `process.exit(code)`. The resident
 * daemon now runs that same code warm, many calls at once, for many callers. Each call
 * must still see ITS caller's environment and working directory, and must hand back its
 * own stdout, stderr and exit code — without killing the daemon or leaking into a
 * neighbouring call.
 *
 * The mechanism is an AsyncLocalStorage context per call. Inside a call:
 *   process.env         reads and writes the caller's environment (a private copy)
 *   process.cwd()       returns the caller's working directory
 *   process.stdout/err  writes are captured into the call's buffers
 *   console.log         goes to the call's stderr (the old wrapper's redirect: engine
 *                       load banners must never reach the agent's stdout)
 *   process.exit(n)     ends the call with code n instead of ending the process
 * Outside a call nothing changes: the daemon's own logging, timers and HTTP handlers run
 * against the real process. A request the tool makes back to the daemon over its socket
 * is served OUTSIDE the call's context, so the search pipeline sees the daemon's own
 * environment exactly as it did when the tool ran in a separate process.
 *
 * The same context runs the in-process fallback (core/agent-tools/cli.js), so both
 * paths execute one code path with one output contract.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** Thrown by process.exit inside a call; carries the exit code out of the tool code. */
export class ExitSignal extends Error {
  constructor(code) {
    super(`ss-* call exited with code ${code}`);
    this.name = 'ExitSignal';
    this.exitCode = code;
  }
}

/** The active call ({ env, cwd, pid, ... }) or null outside a call. */
export function currentCall() {
  return storage.getStore() ?? null;
}

let installed = null;

function toBuffer(chunk, encoding) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
}

function captureWrite(original, pick) {
  return function write(chunk, encoding, callback) {
    const call = storage.getStore();
    if (!call) return original.apply(this, arguments);
    pick(call).push(toBuffer(chunk, encoding));
    const cb = typeof encoding === 'function' ? encoding : callback;
    if (typeof cb === 'function') queueMicrotask(cb);
    return true;
  };
}

function envProxy(realEnv) {
  const target = () => storage.getStore()?.env ?? realEnv;
  return new Proxy(realEnv, {
    get(_t, key) {
      const env = target();
      return typeof key === 'symbol' ? Reflect.get(env, key) : env[key];
    },
    set(_t, key, value) {
      // A real environment stores strings only.
      target()[key] = typeof key === 'symbol' ? value : String(value);
      return true;
    },
    has(_t, key) { return key in target(); },
    deleteProperty(_t, key) { delete target()[key]; return true; },
    ownKeys() { return Reflect.ownKeys(target()); },
    getOwnPropertyDescriptor(_t, key) {
      const env = target();
      if (!Object.prototype.hasOwnProperty.call(env, key)) return undefined;
      return { value: env[key], writable: true, enumerable: true, configurable: true };
    },
    defineProperty(_t, key, desc) {
      target()[key] = String(desc.value);
      return true;
    },
  });
}

/**
 * Patch the process once. Idempotent. Nothing changes for code running outside a call.
 */
export function installVirtualProcess() {
  if (installed) return installed;
  const realEnv = process.env;
  const real = {
    env: realEnv,
    cwd: process.cwd,
    exit: process.exit,
    stdoutWrite: process.stdout.write,
    stderrWrite: process.stderr.write,
    consoleLog: console.log,
  };
  process.env = envProxy(realEnv);
  process.cwd = function cwd() {
    const call = storage.getStore();
    return call ? call.cwd : real.cwd.call(process);
  };
  process.exit = function exit(code) {
    const call = storage.getStore();
    if (!call) return real.exit.call(process, code);
    const n = code === undefined || code === null ? (Number(process.exitCode) || 0) : Number(code);
    throw new ExitSignal(Number.isFinite(n) ? n : 1);
  };
  process.stdout.write = captureWrite(real.stdoutWrite, (call) => call.stdout);
  process.stderr.write = captureWrite(real.stderrWrite, (call) => call.stderr);
  console.log = function log(...args) {
    const call = storage.getStore();
    if (!call) return real.consoleLog.apply(console, args);
    call.stderr.push(Buffer.from(args.map(a => (typeof a === 'string' ? a : String(a))).join(' ') + '\n'));
  };
  installed = { real, realEnv };
  return installed;
}

/**
 * Run `fn` as one virtual process.
 *
 * @param {object} opts
 * @param {Record<string,string>} opts.env  the caller's environment; the object itself is
 *   used (writes land in it), so pass a copy unless the real env is meant.
 * @param {string} opts.cwd                 the caller's working directory (absolute)
 * @param {number} [opts.pid]               the caller's pid (harness detection walks up from it)
 * @param {() => Promise<void>} fn
 * @returns {Promise<{code: number, stdout: Buffer, stderr: Buffer}>}
 */
export async function runInVirtualProcess({ env, cwd, pid = process.pid }, fn) {
  installVirtualProcess();
  const call = { env, cwd, pid, stdout: [], stderr: [] };
  let code = 0;
  await storage.run(call, async () => {
    try {
      await fn();
    } catch (err) {
      if (err instanceof ExitSignal) code = err.exitCode;
      else {
        // A named operational failure (the daemon stopped mid-call) is one line; anything
        // else is a bug and keeps its stack.
        const text = err?.userFacing ? `[ss-*] error: ${err.message}` : `[ss-*] crash: ${err?.stack || err?.message || err}`;
        call.stderr.push(Buffer.from(`${text}\n`));
        code = 1;
      }
    }
  });
  return { code, stdout: Buffer.concat(call.stdout), stderr: Buffer.concat(call.stderr) };
}
