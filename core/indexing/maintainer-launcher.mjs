/**
 * Shared, idempotent launcher for the reconcile-v2 incremental-index maintainer.
 *
 * This is the single place that knows how to start the maintainer daemon. It is
 * called from every entry point that should keep the index fresh:
 *   - the warm search-server startup (`core/search/search-server.js`) — the
 *     durable, non-MCP guarantee that any normal `sweet-search` use starts the
 *     maintainer;
 *   - the Claude/Codex SessionStart prewarm hook (best-effort convenience);
 *   - the MCP server startup, *only* when MCP is actually enabled/used.
 *
 * Design contract (all required by the durable-startup spec):
 *   - respects the default-on opt-out (`SWEET_SEARCH_RECONCILE_V2=0|false|off`)
 *     via the canonical `reconcileEnablement` policy;
 *   - skips when the project has no `.sweet-search` state dir (nothing to
 *     maintain yet);
 *   - skips when a *live* maintainer already holds `index-maintainer.lock`;
 *   - relies on the daemon's own `O_EXCL` state lock as the HARD no-duplicate
 *     guarantee — the liveness probe here is only an optimization so we don't
 *     spawn a process that would immediately exit;
 *   - spawns fully detached with the right cwd and a pinned
 *     `SWEET_SEARCH_PROJECT_ROOT` (the maintainer's package copy resolves its
 *     own PROJECT_ROOT from `__dirname`, so the env pin is load-bearing);
 *   - returns quickly (a few `fs` stats + a detached spawn);
 *   - is stdout-clean — it NEVER writes to stdout, only to stderr when verbose,
 *     so machine-readable commands that call it stay parseable;
 *   - is safe to call often (repeated calls are cheap no-ops once a maintainer
 *     is up).
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileEnablement } from '../incremental-indexing/domain/interval-autotune.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MAINTAINER_LOCK_FILENAME = 'index-maintainer.lock';

/** Default maintainer entry: the sibling daemon in this same context. */
export function defaultMaintainerEntry() {
  return join(__dirname, 'index-maintainer.mjs');
}

/** Does a process with this pid exist right now? EPERM (alien owner) = alive. */
function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Resolve the reconcile state dir the same way the daemon's v2 context does. */
export function resolveStateDir(env = process.env, cwd = process.cwd()) {
  if (env.SWEET_SEARCH_STATE_DIR) return env.SWEET_SEARCH_STATE_DIR;
  const root = env.SWEET_SEARCH_PROJECT_ROOT || cwd;
  return join(root, '.sweet-search');
}

/** True when a live maintainer already holds the lock for this state dir. */
export function maintainerAlive(stateDir) {
  const lockFile = join(stateDir, MAINTAINER_LOCK_FILENAME);
  if (!existsSync(lockFile)) return false;
  try {
    const { pid } = JSON.parse(readFileSync(lockFile, 'utf-8'));
    return pidAlive(Number(pid));
  } catch {
    // Unreadable/corrupt lock → treat as not-alive; the daemon's O_EXCL
    // acquire + stale-lock reclaim handle the real arbitration on spawn.
    return false;
  }
}

/**
 * Start the maintainer if it should run and isn't already running.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   verbose?: boolean,
 *   maintainerEntry?: string,
 *   log?: (msg: string) => void,
 * }} [options]
 * @returns {{spawned: boolean, reason: 'opted-out'|'entry-missing'|'no-state-dir'|'already-running'|'spawned'|'error', pid?: number, stateDir?: string, error?: string}}
 */
export function launchMaintainer(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const verbose = options.verbose ?? !!env.SWEET_SEARCH_PREWARM_VERBOSE;
  // stdout-clean: log only to stderr, only when verbose.
  const log = options.log
    || ((msg) => { if (verbose) process.stderr.write(`[sweet-search maintainer-launch] ${msg}\n`); });

  const maintainerEntry = options.maintainerEntry
    || env.SWEET_SEARCH_MAINTAINER_ENTRY
    || defaultMaintainerEntry();

  if (!reconcileEnablement(env).enabled) {
    log('disabled via SWEET_SEARCH_RECONCILE_V2 opt-out');
    return { spawned: false, reason: 'opted-out' };
  }
  if (!existsSync(maintainerEntry)) {
    log(`maintainer entry missing: ${maintainerEntry}`);
    return { spawned: false, reason: 'entry-missing' };
  }
  const stateDir = resolveStateDir(env, cwd);
  if (!existsSync(stateDir)) {
    log(`no index state dir (${stateDir}); skipping (run sweet-search index first)`);
    return { spawned: false, reason: 'no-state-dir', stateDir };
  }
  if (maintainerAlive(stateDir)) {
    log('maintainer already running for this state dir');
    return { spawned: false, reason: 'already-running', stateDir };
  }

  try {
    const child = spawn(process.execPath, [maintainerEntry], {
      detached: true,
      stdio: 'ignore',
      cwd,
      env: {
        ...env,
        SWEET_SEARCH_PROJECT_ROOT: env.SWEET_SEARCH_PROJECT_ROOT || cwd,
      },
    });
    child.unref();
    log(`maintainer spawned (pid ${child.pid}, detached)`);
    return { spawned: true, reason: 'spawned', pid: child.pid, stateDir };
  } catch (err) {
    log(`maintainer spawn failed (non-fatal): ${err?.message || err}`);
    return { spawned: false, reason: 'error', stateDir, error: err?.message || String(err) };
  }
}
