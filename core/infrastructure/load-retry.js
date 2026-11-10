/**
 * A lazy load keeps its promise so that concurrent first callers share one load. When the load
 * FAILS, that promise must not stay the answer for the life of the process: one failed
 * download (network down) or one failed session create (memory pressure) then failed every
 * later call, in a daemon or in the query-model server shared by all worktrees, until the
 * process was restarted.
 *
 * `forgetFailedLoad` drops a failed load after a delay. During the delay callers get the same
 * error at once (no storm of loads against a model that cannot load); after it the next call
 * loads again. See docs/STATE_MACHINES.md, "Lazy model load".
 */

export const LOAD_RETRY_MS = 30_000;

/**
 * When `promise` rejects, call `forget()` after `delayMs`. `forget` must clear the cached
 * promise only if it is still this one (a newer load may have replaced it).
 */
export function forgetFailedLoad(promise, forget, delayMs = LOAD_RETRY_MS) {
  promise.then(null, () => {
    const timer = setTimeout(forget, delayMs);
    timer.unref?.();
  });
  return promise;
}
