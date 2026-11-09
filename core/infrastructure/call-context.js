/**
 * The context of the ss-* call that is running, if any.
 *
 * core/agent-tools/virtual-process.js starts one context per call (the caller's
 * environment, working directory and output buffers). Code below the tool layer reads it
 * here, so it does not depend on the tool host.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const callStorage = new AsyncLocalStorage();

/** The active call ({ env, cwd, pid, ... }) or null outside a call. */
export function currentCall() {
  return callStorage.getStore() ?? null;
}

/**
 * `compute()` once per call for `key`: a file-system fact a call asks for many times (the
 * reconcile manifest was stat'ed ~20 times per ss-grep call, the project root realpath'd ~6
 * times; each probe is several µs, ~10 µs on a Linux VM). One call sees one answer, as if it
 * had read the file system once when it started; the next call asks again. Outside a call
 * (MCP, the human CLI, the maintainer) nothing is kept. A throw is not kept.
 */
export function callMemo(key, compute) {
  const call = callStorage.getStore();
  if (!call) return compute();
  const memo = (call.memo ||= new Map());
  if (memo.has(key)) return memo.get(key);
  const value = compute();
  memo.set(key, value);
  return value;
}
