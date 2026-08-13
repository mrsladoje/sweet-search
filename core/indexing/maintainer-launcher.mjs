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
import { closeSync, constants as fsConstants, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileEnablement } from '../incremental-indexing/domain/interval-autotune.mjs';
import { applyBackgroundPriority } from './os-priority.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MAINTAINER_LOCK_FILENAME = 'index-maintainer.lock';

/**
 * Cross-process spawn budget for supervision (see `runSupervisionTick`).
 *
 * The `O_EXCL` state lock is the hard no-duplicate guarantee and this file is
 * NOT a second one. It exists so that the two or three supervisors that watch
 * the same repository — the warm search daemon, the MCP server, a prewarm hook
 * — do not all notice the same absent maintainer in the same second and each
 * spawn a node process that loses the lock race and immediately exits. The
 * lock makes those extra processes harmless; the budget makes them not happen.
 */
export const MAINTAINER_SPAWN_CLAIM_FILENAME = 'maintainer-spawn.claim';

/**
 * How long a spawn claim is honoured before another supervisor may steal it.
 *
 * DELIBERATELY SHORT. The claim is an optimization, not a guarantee — the
 * `O_EXCL` state lock is what actually admits one maintainer — so the two
 * failure directions are not symmetric. Too short costs one wasted node process
 * that loses the lock race and exits. Too long costs FRESHNESS: a claim left
 * over from a spawn that has already happened blocks the next genuine respawn
 * for its whole lifetime, which is the silent-staleness bug all over again. An
 * earlier 30s value did exactly that, and the end-to-end test caught it.
 *
 * Five seconds covers the interval between `spawn` returning and the child
 * writing its lock, which is a node process start.
 */
const SPAWN_CLAIM_TTL_MS = 5_000;

/**
 * Per-process floor between supervision ticks.
 *
 * Supervision is driven by query traffic, so without this a busy daemon would
 * stat the lock on every single request. The check that enforces it is one
 * integer comparison against in-process state, so a request that is inside the
 * window costs no syscalls at all.
 */
const SUPERVISION_MIN_INTERVAL_MS = 15_000;

/**
 * Background-priority gate (research §4.A A.2/A.3). Default ON — this is a
 * Tier-1, output-identical lever (only *when* CPU/IO is granted to the child
 * changes). Honors a canonical off-token (`0`/`false`/`off`) to disable.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function bgPriorityEnabled(env) {
  const raw = env.SWEET_SEARCH_MAINTAINER_BG_PRIORITY;
  if (raw == null || raw === '') return true; // default-on
  const normalized = String(raw).trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false' || normalized === 'off');
}

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
    // `spawn` reports EAGAIN / EMFILE / ENOENT (missing cwd) ASYNCHRONOUSLY, so
    // the try/catch around it never sees them. Without a listener that event is
    // an uncaught exception that would kill this process. Attach one first, then
    // unref: the listener does not keep the event loop alive.
    child.on('error', (err) => {
      log(`maintainer spawn reported an async error (child did not start): ${err?.message || err}`);
    });
    child.unref();
    // Demote the detached child to OS background priority (best-effort, never
    // throws). Runs in this foreground caller, targeting the child by pid, so
    // only the child is demoted. Gate default-on (Tier-1, output-identical).
    if (bgPriorityEnabled(env)) {
      applyBackgroundPriority(child.pid);
    }
    log(`maintainer spawned (pid ${child.pid}, detached)`);
    // `child` is returned so a caller that MUST know the child survived (the
    // RSS-recycle handoff) can watch its 'error'/'exit' events. A pid liveness
    // probe cannot do that job: a child that dies instantly becomes a zombie of
    // this process, and `process.kill(pid, 0)` reports a zombie as alive.
    // Callers that fire-and-forget can ignore this field.
    return { spawned: true, reason: 'spawned', pid: child.pid, stateDir, child };
  } catch (err) {
    log(`maintainer spawn failed (non-fatal): ${err?.message || err}`);
    return { spawned: false, reason: 'error', stateDir, error: err?.message || String(err) };
  }
}

// =============================================================================
// SUPERVISION
// =============================================================================

/**
 * Is automatic reconcile work paused for this state dir?
 *
 * Mirrors `isReconcilePaused` in index-maintainer.mjs, deliberately reimplemented
 * as four lines rather than imported: importing it would pull the whole
 * maintainer module — tree-sitter grammars and all — into the search daemon,
 * which is the one process whose startup time users feel.
 */
function reconcilePaused(stateDir) {
  const pauseFile = join(stateDir, 'reconcile-pause.json');
  if (!existsSync(pauseFile)) return false;
  try {
    return JSON.parse(readFileSync(pauseFile, 'utf-8'))?.paused !== false;
  } catch {
    // Unreadable pause state is not a reason to stop maintaining the index.
    return false;
  }
}

/**
 * Take the cross-process spawn claim, or report who holds it.
 *
 * NOT airtight, and does not need to be. A supervisor that reads a stale claim
 * and unlinks it can, in a window of microseconds, delete a claim a third
 * supervisor has just written, and then both spawn. The `O_EXCL` state lock
 * still admits exactly one maintainer, so the whole cost of losing that race is
 * one node process that starts, fails to take the lock, and exits.
 */
function claimSpawnBudget(stateDir, nowMs, pid) {
  const claimFile = join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME);
  const write = () => {
    const fd = openSync(claimFile, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    try { writeSync(fd, JSON.stringify({ pid, at: nowMs })); } finally { closeSync(fd); }
  };

  try {
    write();
    return { claimed: true, reason: 'claimed' };
  } catch (err) {
    if (err?.code !== 'EEXIST') return { claimed: false, reason: 'claim-error' };
  }

  let heldAt = null;
  try {
    const parsed = Number(JSON.parse(readFileSync(claimFile, 'utf-8'))?.at);
    if (Number.isFinite(parsed)) heldAt = parsed;
  } catch { /* corrupt claim → treat as stale, same as a corrupt lock */ }

  // A claim from the future is a clock change, not a live supervisor. Treating
  // it as held would wedge supervision until the TTL elapsed in real time.
  const age = heldAt == null ? Infinity : nowMs - heldAt;
  if (age >= 0 && age < SPAWN_CLAIM_TTL_MS) return { claimed: false, reason: 'claim-held' };

  try { unlinkSync(claimFile); } catch { /* another supervisor got there first */ }
  try {
    write();
    return { claimed: true, reason: 'claimed-stale' };
  } catch {
    return { claimed: false, reason: 'claim-held' };
  }
}

/**
 * Drop a spent claim once the maintainer it covered is confirmed up.
 *
 * Without this the claim would keep blocking for its full TTL after it had
 * already done its job, so a maintainer that died shortly after starting could
 * not be replaced until the claim aged out. Best-effort: a claim we fail to
 * remove still expires on its own.
 */
function releaseSpawnClaim(stateDir) {
  const claimFile = join(stateDir, MAINTAINER_SPAWN_CLAIM_FILENAME);
  if (!existsSync(claimFile)) return;
  try { unlinkSync(claimFile); } catch { /* another supervisor got there first */ }
}

/**
 * Floor between supervision ticks, overridable for tests and for operators who
 * want a repository picked up faster after a maintainer stops. A value of 0 or
 * garbage falls back to the default rather than disabling the floor — an
 * unthrottled supervisor would stat the lock on every request.
 */
function supervisionIntervalMs(env = process.env) {
  const raw = Number.parseInt(env.SWEET_SEARCH_MAINTAINER_SUPERVISION_INTERVAL_MS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : SUPERVISION_MIN_INTERVAL_MS;
}

/** Per-supervisor state. Plain object so a caller can keep it on a daemon closure. */
export function createSupervisionState() {
  return { lastTickMs: 0, launches: 0, lastReason: null };
}

/**
 * Relaunch the maintainer if this repository has lost the one it should have.
 *
 * WHY THIS EXISTS. On hosts with 24 GiB of RAM or less the maintainer stops
 * itself after 10–30 minutes with nothing to index, so that N model-loaded
 * daemons across N repositories collapse to one or two. Nothing then started it
 * again while a warm search daemon was already up: the three `launchMaintainer`
 * call sites all run at daemon STARTUP. So the sequence "work in a repo, leave
 * it alone over lunch, come back and edit files" left the index frozen with no
 * error anywhere — new files returned zero hits from search and from grep. It
 * is the same silent-staleness failure the RSS-recycle handoff closed, reached
 * by the other exit path.
 *
 * WHY RESPAWN RATHER THAN KEEP IT DORMANT. Unloading the model in a surviving
 * process leaks native memory on every cycle (onnxruntime#25325, and
 * `unloadLocalModel` says so in as many words). Exiting and starting again is
 * the memory-SAFE option: the process boundary reclaims what the ORT session
 * cannot release. A replacement maintainer with nothing to do never loads the
 * model at all — it costs about 50 MB and no measurable CPU — so the respawn is
 * cheap precisely in the case where it happens most often.
 *
 * COST ON THE QUERY PATH: none. Callers drive this from a response that has
 * already been flushed, and a tick inside the rate-limit window returns after a
 * single integer comparison, touching no files.
 *
 * @param {{
 *   state: {lastTickMs:number, launches:number, lastReason:string|null},
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   launch?: typeof launchMaintainer,
 *   now?: number,
 *   minIntervalMs?: number,
 *   log?: (msg: string) => void,
 * }} options
 * @returns {{acted: boolean, reason: string, pid?: number}}
 */
export function runSupervisionTick(options = {}) {
  const {
    state,
    env = process.env,
    cwd = process.cwd(),
    launch = launchMaintainer,
    now = Date.now(),
    minIntervalMs = supervisionIntervalMs(env),
    log = () => {},
  } = options;

  const record = (reason, extra = {}) => {
    if (state) state.lastReason = reason;
    return { acted: false, reason, ...extra };
  };

  // Cheapest possible guard first: no syscalls for a tick inside the window.
  if (state && state.lastTickMs && (now - state.lastTickMs) < minIntervalMs) {
    return { acted: false, reason: 'rate-limited' };
  }
  if (state) state.lastTickMs = now;

  if (!reconcileEnablement(env).enabled) return record('opted-out');

  const stateDir = resolveStateDir(env, cwd);
  if (!existsSync(stateDir)) return record('no-state-dir');

  // A paused repository has a maintainer that would start, find its work
  // switched off, and idle back out. Respawning it every interval would be
  // pure churn, which is the one thing supervision must not introduce.
  if (reconcilePaused(stateDir)) return record('paused');

  if (maintainerAlive(stateDir)) {
    releaseSpawnClaim(stateDir);
    return record('already-running');
  }

  const claim = claimSpawnBudget(stateDir, now, process.pid);
  if (!claim.claimed) return record(claim.reason);

  let result;
  try {
    result = launch({ env, cwd });
  } catch (err) {
    // Supervision runs off a response callback and a timer; it must never be
    // able to take the daemon down.
    log(`maintainer supervision launch threw (non-fatal): ${err?.message || err}`);
    return record('launch-error');
  }

  if (!result?.spawned) return record(result?.reason || 'not-spawned');

  if (state) {
    state.launches += 1;
    state.lastReason = 'spawned';
  }
  log(`maintainer was absent for this repo; supervision started a replacement (pid ${result.pid})`);
  return { acted: true, reason: 'spawned', pid: result.pid };
}
