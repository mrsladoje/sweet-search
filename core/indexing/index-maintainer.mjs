#!/usr/bin/env node
/**
 * Index maintainer daemon: keeps the index current after edits.
 *
 * Runs the reconcile loop (runReconcileV2Main): a file watcher (with a slow backstop
 * walk) queues changed files, each tick reconciles them into every index tier, and
 * maintenance compacts the tiers. One maintainer per state dir (index-maintainer.lock,
 * progress-aware takeover). SWEET_SEARCH_RECONCILE_V2=0 turns automatic maintenance off.
 *
 * Usage:
 *   node index-maintainer.mjs              # Run as daemon
 *   node index-maintainer.mjs --once       # One tick, then exit
 *
 * Started by the search daemon / session hooks through maintainer-launcher.mjs.
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, closeSync, constants, ftruncateSync, fsyncSync, writeSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { startupInterval, tierForHardware, reconcileEnablement, nextInterval, backstopWalkIntervalMs, resolveMaintainerMemoryProfile } from '../incremental-indexing/domain/interval-autotune.mjs';
import { detectHardwareCapability } from '../infrastructure/hardware-capability.js';
import { sweepStaleArtifactTemps, DEFAULT_TMP_SWEEP_MAX_AGE_MS } from '../incremental-indexing/infrastructure/artifact-temp-sweep.mjs';
import {
  hasCompleteBaseIndex,
  WAITING_FOR_INITIAL_INDEX,
  INDEX_REBUILD_REQUIRED,
  CONFIG_FINGERPRINT_MISMATCH,
  LI_FORMAT_OUTDATED,
} from '../incremental-indexing/infrastructure/baseline-readiness.mjs';
import { formatIndexFormatNotice } from '../incremental-indexing/infrastructure/staleness-display.mjs';
import { applyPersistedLiModel } from '../infrastructure/init-config.js';
// Static, not dynamic: the D.5 teardown watchdog must be able to hand off from
// a synchronous callback, so the launcher has to be resolved before any await
// in the shutdown path can wedge.
import { launchMaintainer, pauseHolds } from './maintainer-launcher.mjs';
import { recordSpawn } from '../infrastructure/spawn-ledger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// === Configuration ===
const PROJECT_ROOT = join(__dirname, '../..');

// Timing configuration
const LOCK_REFRESH_INTERVAL = 30000;   // 30 seconds between lock refreshes (M5: was 60s)
const LOCK_STALE_THRESHOLD = 180000;   // 3 minutes (M5: was 5 min, ratio 6:1 with refresh)
// Lifecycle fix v2 — progress-aware takeover. The legacy 3-min pure-timestamp
// takeover ("lock looks stale ⇒ steal it") produced stealth co-owner orphans
// when a busy daemon's heartbeat aged past the threshold; the v1 interim fix
// raised the threshold to 30 min, which traded faster wedge recovery for
// safety. v2 reverts the threshold to 3 min and adds a second signal so we
// keep both: orphan-free AND fast recovery, without false-positives on long
// async work.
//
// The lockfile now carries TWO timestamps:
//   - `timestamp`         — the heartbeat, refreshed every 30 s by setInterval
//                           (event-loop bound, like before).
//   - `progressTimestamp` — refreshed by recordProgress() at known work
//                           checkpoints inside the reconcile loop.
//
// acquireStateLock combines them:
//
//   heartbeat fresh AND progress fresh   → busy + progressing → REFUSE
//   heartbeat fresh AND progress stale   → alive-but-stuck    → SIGTERM + steal
//   heartbeat stale AND progress fresh   → recent progress    → REFUSE (timer lag)
//   heartbeat stale AND progress stale   → genuinely wedged   → SIGTERM + steal
//   dead pid                             → crashed            → immediate takeover
//
// Caveat: progress IS still recorded from the main event loop, so a daemon
// blocked by pure synchronous CPU/native work shows both signals stale and
// will be SIGTERMed at 3 min. With async napi (see
// project_native_metal_inference_status) this case should not arise in
// practice; the natural escalation if it does is a worker_threads-based
// progress beacon — left as future work.
export const WEDGED_KILL_GRACE_MS = 5000;  // SIGTERM grace before declaring takeover complete

// State
let shutdownRequested = false;

// === Logging Helper (L3) ===

/**
 * Structured logging with timestamp and level prefix
 * L3 FIX: Proper log levels instead of console.error for everything
 * @param {'INFO'|'WARN'|'ERROR'|'DEBUG'} level - Log level
 * @param {string} message - Log message
 */
function log(level, message) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.error(`[${timestamp}] [${level}] [index-maintainer] ${message}`);
}

// === Lock File Management ===
// SECURITY INVARIANT: All lock release functions MUST verify ownership before releasing.
// Pattern: read lock file → verify PID matches process.pid → then release
// This prevents Process A from accidentally releasing Process B's lock.

/**
 * Check if a PID is running
 * S3 FIX: Optionally validate process start time to prevent PID reuse attacks
 * @param {number} pid - Process ID to check
 * @param {string|null} expectedStartTime - Expected /proc start time (Linux only)
 * @returns {boolean} true if process is running (and matches start time if provided)
 */
function isPidRunning(pid, expectedStartTime = null) {
  try {
    process.kill(pid, 0);

    // S3 FIX: Linux-specific validation of process start time
    if (expectedStartTime && process.platform === 'linux') {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
        const fields = stat.split(' ');
        const actualStartTime = fields[21];  // Field 22 (0-indexed: 21) = starttime
        if (actualStartTime !== expectedStartTime) {
          return false;  // PID reused by different process
        }
      } catch {
        // /proc not available or unreadable, skip check
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get process start time for PID reuse detection (Linux only)
 * S3 FIX: Returns /proc starttime for current process
 * @returns {string|null} Start time string or null if unavailable
 */
function getProcessStartTime() {
  if (process.platform !== 'linux') return null;
  try {
    const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf-8');
    const fields = stat.split(' ');
    return fields[21];  // Field 22 (0-indexed: 21) = starttime
  } catch {
    return null;
  }
}

// === Queue Management (Exported for testing) ===

export function isReconcilePaused(stateDir) {
  const pauseFile = join(stateDir, 'reconcile-pause.json');
  try {
    const payload = JSON.parse(readFileSync(pauseFile, 'utf-8'));
    return {
      paused: pauseHolds(payload),
      pausedAt: payload?.pausedAt || null,
      reason: payload?.reason || null,
      filePath: pauseFile,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log('WARN', `Ignoring unreadable reconcile pause state: ${err.message}`);
    }
    return { paused: false, filePath: pauseFile };
  }
}

function reconcileV2Context(env = process.env) {
  const projectRoot = resolve(env.SWEET_SEARCH_PROJECT_ROOT || PROJECT_ROOT);
  const stateDir = resolve(env.SWEET_SEARCH_STATE_DIR || join(projectRoot, '.sweet-search'));
  return { projectRoot, stateDir };
}

/**
 * Resolve the reconcile-v2 tick interval at daemon startup.
 *
 * Delegates to `startupInterval` in the incremental-indexing domain so the
 * daemon path and the domain module share the same env precedence and
 * hardware-tier semantics. The hardware capability is detected lazily and
 * passed in; explicit `tier` overrides via `opts.tier` short-circuit it.
 *
 * @param {{env?:NodeJS.ProcessEnv, hardware?:object, tier?:'low'|'mid'|'high'}} [opts]
 * @returns {{intervalMs:number, pinned:boolean, source:string, tier:string|null}}
 */
export function resolveReconcileV2Interval(opts = {}) {
  const env = opts.env || process.env;
  let hardware = opts.hardware;
  if (hardware === undefined) {
    try {
      hardware = detectHardwareCapability();
    } catch {
      hardware = null;
    }
  }
  const tier = opts.tier || (hardware ? tierForHardware(hardware) : null);
  const result = startupInterval({ tier: tier || undefined, env, hardware });
  return { ...result, tier };
}

function readStateLock(lockFile) {
  try {
    const parsed = JSON.parse(readFileSync(lockFile, 'utf-8'));
    return Number.isInteger(parsed.pid) ? parsed : null;
  } catch {
    return null;
  }
}

// Module-level lockfile state — populated by acquireStateLock on success,
// mutated by writeStateLock (heartbeat tick) AND recordProgress (work
// checkpoint), cleared by releaseStateLock. Both writers share this object
// so a heartbeat write never clobbers progress fields and vice-versa.
let lockState = null;

/**
 * True iff a parsed state lock belongs to this process's current acquisition.
 * The ownerToken closes the same-pid / stale-module-state hole in tests and
 * long-lived hosts; legacy test fixtures without a token still match by pid
 * when this process has no active token.
 */
function lockMatchesCurrentOwner(existing) {
  if (existing?.pid !== process.pid) return false;
  if (lockState?.ownerToken) return existing.ownerToken === lockState.ownerToken;
  return true;
}

function readStateLockFromFd(fd) {
  try {
    const parsed = JSON.parse(readFileSync(fd, 'utf-8'));
    return Number.isInteger(parsed.pid) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Re-validate ownership through an open fd, mutate the in-memory lockState,
 * then write back through that same fd. This deliberately avoids temp+rename:
 * if another daemon unlinks/recreates the path after our open, our write lands
 * on the old unlinked inode, not on the successor's new lockfile.
 */
function persistLockState(lockFile, mutator) {
  if (!lockState) return;
  let fd = null;
  try {
    fd = openSync(lockFile, constants.O_RDWR);
    const existing = readStateLockFromFd(fd);
    if (!lockMatchesCurrentOwner(existing)) return;
    mutator(lockState);
    const payload = JSON.stringify(lockState);
    const bytes = Buffer.from(payload, 'utf-8');
    ftruncateSync(fd, 0);
    writeSync(fd, bytes, 0, bytes.length, 0);
    try { fsyncSync(fd); } catch { /* best-effort durability for heartbeat */ }
  } catch {
    // Missing/corrupt/displaced locks are handled by the main ownership check.
  } finally {
    if (fd != null) {
      try { closeSync(fd); } catch {}
    }
  }
}

function writeStateLock(lockFile) {
  persistLockState(lockFile, (s) => { s.timestamp = Date.now(); });
}

/**
 * Lifecycle fix v2 — record a work-progress checkpoint. Called from the
 * reconcile loop (top of iteration, post-tick, post-drain) so a candidate
 * maintainer in acquireStateLock can tell "alive but stuck on a hung await"
 * from "busy and progressing." One small JSON write per call; the cost is
 * negligible at the call frequencies we use (≈ once per loop iteration).
 *
 * Designed for the main thread (single event loop). If the event loop is
 * fully blocked by synchronous native work, neither this nor writeStateLock
 * fires and both signals stale together — that case is intentionally treated
 * as "wedged" and SIGTERMed (with the queue-based recovery making lost work
 * idempotent). For a fully event-loop-independent signal a worker_threads
 * beacon would be the next step.
 */
export function recordProgress(lockFile) {
  persistLockState(lockFile, (s) => {
    s.progressCounter = (s.progressCounter ?? 0) + 1;
    s.progressTimestamp = Date.now();
  });
}

/**
 * SIGTERM the previous holder and unlink the lockfile, after a bounded grace
 * period. Shared by both takeover branches in acquireStateLock (alive-but-
 * stuck AND fully wedged). The dying holder exits via its SIGTERM handler;
 * if it can't (uninterruptible syscall), its in-loop `stillOwnsLock` check
 * ends it gracefully when it eventually unblocks. Either way: no immortal
 * twin.
 */
async function sigtermAndStealLock(existing, lockFile, reason) {
  log('WARN', `Existing maintainer pid=${existing.pid} appears ${reason}; sending SIGTERM before takeover.`);
  try { process.kill(existing.pid, 'SIGTERM'); } catch { /* ESRCH/EPERM — fine, we'll steal anyway */ }
  const deadline = Date.now() + WEDGED_KILL_GRACE_MS;
  while (Date.now() < deadline && isPidRunning(existing.pid, existing.startTime)) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (isPidRunning(existing.pid, existing.startTime)) {
    log('WARN', `pid=${existing.pid} still alive after SIGTERM+${WEDGED_KILL_GRACE_MS}ms grace; proceeding (it will self-exit at its next loop tick).`);
  }
  // Re-read before unlinking. During the grace above the observed holder may
  // have shut down and been REPLACED by a legitimate successor — an RSS-recycle
  // handoff does exactly that, and so does any normal restart. Unlinking the
  // pathname we originally saw would then delete the SUCCESSOR's lock, letting
  // us start a second writer against the same state. Only remove the lock while
  // it still names the holder we decided to displace.
  const current = readStateLock(lockFile);
  if (!current) return;                       // already gone; nothing to steal
  if (current.pid !== existing.pid
      || (existing.ownerToken != null && current.ownerToken !== existing.ownerToken)
      || (existing.startTime != null && current.startTime != null && current.startTime !== existing.startTime)) {
    log('INFO', `Lock for ${lockFile} now belongs to pid=${current.pid} (was ${existing.pid}); abandoning takeover so we never displace a live successor.`);
    return;
  }
  try { unlinkSync(lockFile); } catch {}
}

/**
 * Acquire the reconcile-v2 state lock atomically.
 *
 * Lifecycle fix v2 — progress-aware single-owner takeover (see the
 * WEDGED_KILL_GRACE_MS block above for the design rationale). Decision
 * matrix on an existing lockfile:
 *
 *   no / unparseable lock                  → unlink + retry create
 *   dead holder                            → unlink + retry create
 *   alive, heartbeat fresh, progress fresh → REFUSE
 *   alive, heartbeat stale, progress fresh → REFUSE (timer-lag tolerance)
 *   alive, heartbeat fresh, progress stale → SIGTERM + steal (alive-but-stuck)
 *   alive, both stale                      → SIGTERM + steal (wedged)
 *
 * Returns { acquired, lockFile }. On successful acquisition, initialises the
 * module-level `lockState` with both heartbeat and progress timestamps so
 * the new owner is never "stale" immediately. Async because the
 * SIGTERM-and-steal path awaits a bounded grace period; the legacy
 * synchronous form had no caller outside runReconcileV2Main (verified by grep).
 */
export async function acquireStateLock(stateDir) {
  mkdirSync(stateDir, { recursive: true });
  const lockFile = join(stateDir, 'index-maintainer.lock');
  // THREE attempts, not two. A takeover can now legitimately spend an attempt
  // WITHOUT clearing the lock: sigtermAndStealLock abandons the steal when the
  // holder was replaced during its grace (an RSS-recycle handoff does exactly
  // that). If that replacement then dies, attempt 2 only gets as far as
  // unlinking its dead lock, and a two-attempt budget would return
  // `acquired:false` having just removed the last lock — leaving ZERO writers.
  // The third attempt is what turns that state back into an acquisition.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      // Initialise the in-memory state. progressTimestamp starts equal to
      // timestamp so a fresh owner is never falsely declared stale on either
      // signal by a candidate maintainer that races our first tick.
      const nowMs = Date.now();
      lockState = {
        pid: process.pid,
        timestamp: nowMs,
        startTime: getProcessStartTime(),
        ownerToken: randomUUID(),
        progressCounter: 0,
        progressTimestamp: nowMs,
      };
      writeFileSync(fd, JSON.stringify(lockState));
      closeSync(fd);
      return { acquired: true, lockFile };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const existing = readStateLock(lockFile);
      if (!existing) {
        // Corrupt / unparseable lock — unlink and retry the O_EXCL create.
        try { unlinkSync(lockFile); } catch {}
        continue;
      }
      const holderAlive = isPidRunning(existing.pid, existing.startTime);
      if (!holderAlive) {
        // Crashed daemon — safe to reclaim. (Preserves the dead-pid contract
        // exercised by tests/indexing/maintainer-launcher.test.js.)
        try { unlinkSync(lockFile); } catch {}
        continue;
      }
      const now = Date.now();
      const heartbeatAge = now - existing.timestamp;
      // Every lock this maintainer writes carries progressTimestamp; one without
      // it shows no progress (stale), so a live holder is SIGTERMed and replaced.
      const progressAge = Number.isFinite(existing.progressTimestamp)
        ? now - existing.progressTimestamp
        : Infinity;
      const heartbeatFresh = heartbeatAge < LOCK_STALE_THRESHOLD;
      const progressFresh = progressAge < LOCK_STALE_THRESHOLD;
      if (heartbeatFresh && progressFresh) {
        // Busy AND progressing — single-owner invariant: refuse takeover.
        return { acquired: false, lockFile };
      }
      if (progressFresh) {
        // Progress recorded recently even though the heartbeat timer lagged
        // (occasional event-loop pause that swallowed a setInterval tick).
        // Actual work IS happening — trust the progress signal, refuse.
        return { acquired: false, lockFile };
      }
      const reason = heartbeatFresh
        ? `alive but not progressing (progress age=${Math.round(progressAge / 1000)}s)`
        : `wedged (heartbeat age=${Math.round(heartbeatAge / 1000)}s, progress age=${Math.round(progressAge / 1000)}s)`;
      await sigtermAndStealLock(existing, lockFile, reason);
    }
  }
  return { acquired: false, lockFile };
}

export function releaseStateLock(lockFile) {
  try {
    const existing = readStateLock(lockFile);
    if (lockMatchesCurrentOwner(existing)) unlinkSync(lockFile);
  } catch {}
  // Reset module-level state so a subsequent acquire (in tests, in long-lived
  // hosts, in respawn paths) starts from a clean slate.
  lockState = null;
}

/**
 * Lifecycle fix. Returns true iff the state lockfile exists AND still names
 * this process. Used by:
 *   - the main reconcile loop, to self-exit when displaced (no immortal
 *     twins after a wedged-backstop takeover), and
 *   - the heartbeat refresh setInterval, so a displaced daemon never
 *     clobbers a successor's lock by rewriting its own pid.
 *
 * Missing/unparseable lockfile is treated as "not ours" — conservatively
 * exits the daemon so the launcher can respawn a clean single owner rather
 * than risk a race during a successor's mid-takeover write.
 */
export function stillOwnsLock(lockFile) {
  const existing = readStateLock(lockFile);
  if (!existing) return false;
  return lockMatchesCurrentOwner(existing);
}

class MaintainerLifecycleAbort extends Error {
  constructor(message) {
    super(message);
    this.name = 'MaintainerLifecycleAbort';
  }
}

function createLifecycleProgress(lockFile) {
  return () => {
    if (shutdownRequested) {
      throw new MaintainerLifecycleAbort('shutdown requested');
    }
    if (!stillOwnsLock(lockFile)) {
      throw new MaintainerLifecycleAbort('lock ownership lost');
    }
    recordProgress(lockFile);
  };
}

// The encoders run in a child process that exits when idle (encoder-client.mjs),
// so the maintainer holds no ONNX session between edits. One per process.
let encoderClient;
// Set once the RSS registry knows this maintainer: the child's memory then
// counts toward this maintainer's fleet entry.
let encoderChildListener = null;
async function maintainerEncoders() {
  if (encoderClient !== undefined) return encoderClient;
  const { createEncoderClient, encoderProcessEnabled, encoderIdleMs } = await import('./encoder-client.mjs');
  encoderClient = encoderProcessEnabled()
    ? createEncoderClient({
      idleMs: encoderIdleMs(),
      log: (level, msg) => log(level, msg),
      onChildChange: (pid) => encoderChildListener?.(pid),
    })
    : null;
  return encoderClient;
}

export async function runReconcileV2Tick(ctx) {
  const onProgress = typeof ctx.onProgress === 'function' ? ctx.onProgress : null;
  const progress = (phase) => { onProgress?.(phase); };
  progress('tick:start');
  // Baseline gate: the incremental reconciler must NEVER be the first index
  // builder for a non-empty repo (product contract). Until the normal full
  // indexing path has produced a complete baseline, stay dormant — skip BOTH
  // the dirty-scan producer (so we don't enqueue the whole tree) AND the
  // reconcile consumer (so we don't create partial codebase.db / code-graph.db
  // / HNSW / LI / sparse artifacts that make search think the repo is indexed).
  // No queue/artifact mutation here; the launcher still spawns the daemon, but
  // each tick is a no-op until `sweet-search index` lands a baseline.
  // Resolve the LI model exactly as the full indexer does (env > persisted
  // `runtime.li.model` in .sweet-search/config.json > default) BEFORE the gate
  // builds its fingerprint and before any LI delta is encoded. Without this the
  // daemon would encode an edge-model repo with the standard model.
  applyPersistedLiModel(ctx.projectRoot);
  // The same gate also holds the daemon dormant when the baseline was built in
  // an older index format (config fingerprint mismatch after an upgrade), so it
  // never writes new-format chunks into an old-format index.
  const baseline = hasCompleteBaseIndex(ctx.stateDir);
  if (!baseline.ready) {
    if (baseline.reason === CONFIG_FINGERPRINT_MISMATCH) {
      log('WARN', `${formatIndexFormatNotice(baseline.changes)} — reconcile dormant`);
      return { skipped: true, reason: INDEX_REBUILD_REQUIRED, baseline: baseline.reason, changes: baseline.changes };
    }
    if (baseline.reason === LI_FORMAT_OUTDATED) {
      log('WARN', 'late-interaction index is in the older single-file format; run "sweet-search index --full" — reconcile dormant');
      return { skipped: true, reason: INDEX_REBUILD_REQUIRED, baseline: baseline.reason };
    }
    log('INFO', `${WAITING_FOR_INITIAL_INDEX}: no complete baseline yet (${baseline.reason}); run "sweet-search index" first — reconcile dormant`);
    return { skipped: true, reason: WAITING_FOR_INITIAL_INDEX, baseline: baseline.reason };
  }

  // Producer step: diff the working tree against merkle-state.json and enqueue
  // add/modify/delete hints, so ordinary edits are reconciled WITHOUT requiring
  // `sweet-search index --add` or an editor hook (release-gate finding C1). Runs
  // before the consume step below; best-effort so a scan failure never blocks
  // reconcile of already-queued work.
  // G6 backstop demotion: when the watcher is the primary producer the daemon
  // sets `ctx.skipFullWalk` on the ticks between backstop walks (it leaves it
  // unset/false on the first tick, on the periodic backstop, and on overflow).
  // The watcher has already fed the queue from filesystem events, so the
  // expensive full stat-walk is redundant on those ticks. When the watcher is
  // inactive `skipFullWalk` is never set ⇒ the walk runs every tick (today's
  // behavior, unchanged).
  // One admission policy per tick: the scan and the reconciler's admission gate
  // share its git listings instead of each running them over every tracked file.
  let admissionPolicy;
  try {
    const { dirtyScanEnabled, scanDirtyAndEnqueue } = await import('../incremental-indexing/application/dirty-scan.mjs');
    if (dirtyScanEnabled() && !ctx.skipFullWalk) {
      const { createAdmissionPolicy } = await import('../indexing/admission-policy.js');
      admissionPolicy = createAdmissionPolicy({ projectRoot: ctx.projectRoot });
      progress('dirty-scan:start');
      const scan = await scanDirtyAndEnqueue({ projectRoot: ctx.projectRoot, stateDir: ctx.stateDir, admissionPolicy, onProgress });
      progress('dirty-scan:done');
      if (scan.enqueued > 0) {
        log('INFO', `Dirty scan enqueued ${scan.enqueued} file(s) (added=${scan.added}, modified=${scan.modified}, deleted=${scan.deleted}, retired=${scan.retired})`);
      }
    }
  } catch (err) {
    if (err instanceof MaintainerLifecycleAbort) throw err;
    log('WARN', `Dirty scan failed (continuing with queued hints): ${err?.message ?? err}`);
  }

  const { runProductionReconcileTick } = await import('../incremental-indexing/application/production-reconciler.mjs');
  const encoders = await maintainerEncoders();
  // A cold encoder process spent 2.4 s loading its models in sequence after the parse;
  // with work queued, load them now, alongside hashing, parsing and graph writes.
  try {
    if (encoders && statSync(join(ctx.stateDir, 'index-maintainer-queue.jsonl')).size > 0) encoders.warm();
  } catch { /* no queue */ }
  const counters = await runProductionReconcileTick({
    projectRoot: ctx.projectRoot,
    stateDir: ctx.stateDir,
    admissionPolicy,
    ...(encoders ? { vectorEncoder: encoders.dense, liEncoder: encoders.li } : {}),
    logger: {
      info: (msg) => log('INFO', msg),
      warn: (msg) => log('WARN', msg),
      error: (msg) => log('ERROR', msg),
    },
    onProgress,
  });
  progress('tick:done');
  log('INFO', `Reconcile v2 tick complete: epoch=${counters.epoch}, processed=${counters.files_processed}, unchanged=${counters.content_unchanged}, dirty=${counters.dirty_paths_seen}, deferred=${counters.dirty_paths_deferred}, budget=${counters.cpu_budget_used_ms}/${counters.cpu_budget_total_ms}ms, tick=${counters.tick_ms}ms`);
  return counters;
}

/**
 * Inline-drain decision for the reconcile daemon.
 *
 * Returns true unless the operator opts out via
 * `SWEET_SEARCH_MAINTENANCE_INLINE=0|false|off`. The daemon owns the only
 * `index-maintainer.lock` for this state dir, so a single inline drain
 * inside the daemon process is the simplest "no two workers racing"
 * topology — no child-process supervisor needed.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function maintenanceInlineEnabled(env = process.env) {
  const raw = env.SWEET_SEARCH_MAINTENANCE_INLINE;
  if (raw == null || raw === '') return true;
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
}

/**
 * Per-tick job cap for the inline drain. When the operator sets
 * `SWEET_SEARCH_MAINTENANCE_MAX_JOBS_PER_TICK` it is honored as a hard
 * ceiling; otherwise the drain is bounded by the wall-clock budget
 * (`maintenanceInlineBudgetMs`) instead of a fixed tiny count, so it can
 * keep pace with a growing backlog. Returns `undefined` (→ no job cap) in
 * the unset case.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
function maintenanceInlineMaxJobs(env = process.env) {
  const raw = Number.parseInt(env.SWEET_SEARCH_MAINTENANCE_MAX_JOBS_PER_TICK || '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return undefined;
}

/**
 * Wall-clock budget (ms) for one inline maintenance drain. Bounds how long
 * the drain may run after a reconcile tick so it never starves reconcile,
 * while still adapting to backlog. Tunable via
 * `SWEET_SEARCH_MAINTENANCE_BUDGET_MS`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
function maintenanceInlineBudgetMs(env = process.env) {
  const raw = Number.parseInt(env.SWEET_SEARCH_MAINTENANCE_BUDGET_MS || '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 1500;
}

function maintenanceInlineMaxAttempts(env = process.env) {
  const raw = Number.parseInt(env.SWEET_SEARCH_MAINTENANCE_MAX_ATTEMPTS || '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 3;
}

/**
 * Grace window for the startup orphan-temp sweep. A staging temp older than
 * this is a crash orphan (the rename that would publish it never happened);
 * a younger one might belong to a concurrent in-flight writer and is left
 * alone. Tunable via `SWEET_SEARCH_TMP_SWEEP_MAX_AGE_MS`; `0` disables the
 * age gate (sweep everything that matches).
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
function tmpSweepMaxAgeMs(env = process.env) {
  const raw = Number.parseInt(env.SWEET_SEARCH_TMP_SWEEP_MAX_AGE_MS || '', 10);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_TMP_SWEEP_MAX_AGE_MS;
}

/**
 * Bounded inline drain of the maintenance queue, intended to be called
 * after a successful reconcile tick. Returns the drain summary, or
 * `{skipped: true, reason}` when inline mode is disabled or the worker
 * call throws (we never let maintenance failures crash the daemon).
 *
 * Exported so tests and the daemon main loop call the same code path.
 *
 * @param {{stateDir:string, env?:NodeJS.ProcessEnv}} ctx
 */
export async function drainMaintenanceInline(ctx) {
  const onProgress = typeof ctx.onProgress === 'function' ? ctx.onProgress : null;
  const env = ctx.env || process.env;
  if (!maintenanceInlineEnabled(env)) {
    return { skipped: true, reason: 'inline-disabled' };
  }
  let processMaintenanceQueue;
  let defaultMaintenanceHandlers;
  try {
    ({ processMaintenanceQueue, defaultMaintenanceHandlers } = await import(
      '../incremental-indexing/application/maintenance-worker.mjs'
    ));
  } catch (err) {
    log('WARN', `Maintenance worker import failed: ${err?.message ?? err}`);
    return { skipped: true, reason: 'import-failed' };
  }
  try {
    const summary = await processMaintenanceQueue(ctx.stateDir, {
      handlers: defaultMaintenanceHandlers(ctx.stateDir),
      maxJobs: maintenanceInlineMaxJobs(env),
      budgetMs: maintenanceInlineBudgetMs(env),
      maxAttempts: maintenanceInlineMaxAttempts(env),
      onProgress,
    });
    if (summary.seen > 0) {
      log('INFO',
        `Maintenance drain: seen=${summary.seen}, succeeded=${summary.succeeded}, ` +
        `deferred=${summary.deferred}, retried=${summary.retried}, ` +
        `deadLettered=${summary.deadLettered}, remaining=${summary.remaining}`);
    }
    return summary;
  } catch (err) {
    if (err instanceof MaintainerLifecycleAbort) throw err;
    log('WARN', `Maintenance drain failed (continuing reconcile): ${err?.message ?? err}`);
    return { skipped: true, reason: 'drain-error', error: err?.message ?? String(err) };
  }
}

// Resolves the inter-tick sleep in progress, if any. A stop request (signal,
// daemon gone) calls it so the maintainer exits now instead of after the rest
// of a sleep slice of up to LOCK_REFRESH_INTERVAL.
let wakeSleep = null;

/** End the current inter-tick sleep at once (no-op when not sleeping). */
export function wakeMaintainerSleep() {
  const wake = wakeSleep;
  wakeSleep = null;
  if (wake) wake();
}

/** The file watcher is on unless SWEET_SEARCH_MAINTAINER_WATCH=0. */
export function maintainerWatchEnabled(env = process.env) {
  return env.SWEET_SEARCH_MAINTAINER_WATCH !== '0';
}

// A burst of saves (an editor writing a temp file and renaming it, a formatter
// touching several files) wakes the sleep once, this long after its first event.
const WATCH_WAKE_DELAY_MS = 200;

/**
 * A trigger for watcher events: the first call ends the inter-tick sleep after
 * `delayMs`, and calls within that window add nothing. Without it a watched edit
 * waited out the whole 10-20 s interval: the pending-events flag was read only
 * between sleep slices of up to 30 s.
 */
export function createWatchWake({ delayMs = WATCH_WAKE_DELAY_MS, wake = wakeMaintainerSleep } = {}) {
  let timer = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; wake(); }, delayMs);
    timer.unref?.();
  };
}

async function sleepWithProgress(totalMs, lockFile, opts = {}) {
  const deadline = Date.now() + totalMs;
  // Watcher early-wake: when the watcher feeds the queue it sets a `pendingEvents`
  // flag and (createWatchWake) ends the current slice, so the next tick
  // reconciles fresh edits without waiting out the interval. Events that arrived
  // during the previous tick end the sleep before it starts.
  const wokenByWatcher = typeof opts.wokenByWatcher === 'function' ? opts.wokenByWatcher : null;
  while (!shutdownRequested) {
    if (!stillOwnsLock(lockFile)) {
      throw new MaintainerLifecycleAbort('lock ownership lost during sleep');
    }
    if (wokenByWatcher && wokenByWatcher()) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await new Promise((resolveSleep) => {
      const done = () => {
        clearTimeout(timer);
        if (wakeSleep === done) wakeSleep = null;
        resolveSleep();
      };
      const timer = setTimeout(done, Math.min(LOCK_REFRESH_INTERVAL, remaining));
      wakeSleep = done;
    });
    if (!shutdownRequested) createLifecycleProgress(lockFile)();
  }
}

// SWEET_SEARCH_RECONCILE_AUTOTUNE is DEFAULT-ON (disable with =0): the daemon's
// consume-half mirrors the reconciler config-half so the tuned interval is
// actually applied to the sleep loop. Verified recall-neutral + soak == baseline.
// Set to '0' to restore the fixed-interval sleep loop.
// Pause between ticks while files are still queued: long enough to let signal
// handlers and the lock refresh run, short enough not to slow the drain.
const BACKLOG_TICK_GAP_MS = 250;

export const reconcileAutotuneEnabled = (env = process.env) => env.SWEET_SEARCH_RECONCILE_AUTOTUNE !== '0';

/**
 * A.4-consume: recompute the daemon's sleep interval from the just-finished
 * tick. The reconciler config-half (G2) only re-tunes an ephemeral per-tick
 * Reconciler instance, so the daemon MUST recompute the interval in its OWN
 * loop or the autotune is "doubly dead" (flag on but output disconnected).
 *
 * Pure + testable: takes the tick counters snapshot + a measured maintenance
 * backlog and returns the next interval. When the flag is off, returns
 * `currentMs` unchanged (today's behavior). When an explicit interval is pinned
 * via the startup env, the daemon never calls this (the resolver marked it
 * pinned). Windows: `os.loadavg()` returns `[0,0,0]`, so the per-core load is 0
 * and the loosen-under-load signal is naturally skipped (flat interval) — no
 * special-casing needed beyond not treating 0 as "idle headroom" spuriously
 * (0 < 0.2 only nudges down by 0.95, well within the rate-limit, harmless).
 *
 * @param {object} args
 * @param {number} args.currentMs            interval the just-finished tick used
 * @param {object|null} args.counters        runReconcileV2Tick return (snapshot)
 * @param {number} args.maintenanceBacklog   pending maintenance jobs
 * @param {NodeJS.ProcessEnv} [args.env]
 * @param {() => number[]} [args.loadavg]    injectable for tests
 * @param {() => number} [args.cpuCount]     injectable for tests
 * @returns {{ nextMs:number, tuned:boolean, reasons:string[] }}
 */
export function computeNextIntervalMs({
  currentMs,
  counters,
  maintenanceBacklog,
  env = process.env,
  loadavg = () => os.loadavg(),
  cpuCount = () => os.cpus().length,
}) {
  if (!reconcileAutotuneEnabled(env)) {
    return { nextMs: currentMs, tuned: false, reasons: [] };
  }
  // A skipped tick (dormant baseline / paused) has no usable signal — leave the
  // interval untouched rather than feed `nextInterval` zeros that would creep up.
  if (!counters || counters.skipped) {
    return { nextMs: currentMs, tuned: false, reasons: [] };
  }
  let cores = 1;
  try { cores = Math.max(1, cpuCount() || 1); } catch { cores = 1; }
  let load1 = 0;
  try { load1 = (loadavg()?.[0] ?? 0); } catch { load1 = 0; }
  const cpuLoadAvg = load1 / cores; // Windows → 0/N = 0 → loosen-under-load skipped.
  const tuned = nextInterval({
    currentMs,
    lastTickMs: Number(counters.tick_ms) || 0,
    dirtyAtTickStart: Number(counters.dirty_paths_seen) || 0,
    cpuLoadAvg,
    maintenanceBacklog: Number(maintenanceBacklog) || 0,
  });
  return { nextMs: tuned.nextMs, tuned: tuned.nextMs !== currentMs, reasons: tuned.reasons };
}

/**
 * D.1: idle-TTL. Default 0/disabled. Returns the configured wall-clock idle
 * budget (ms) after which an unattended maintainer self-shuts-down so N resident
 * model-loaded daemons collapse to 1–2 (the ~16 GB cross-repo footprint fix).
 * 0 (or invalid / negative) ⇒ disabled (today's "run forever" behavior).
 */
export function maintainerIdleTtlMs(env = process.env, totalMemBytes = os.totalmem()) {
  const rawStr = env.SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS;
  if (rawStr != null) {
    // Explicitly set (incl. '' / invalid / 0 / negative → disabled): the env
    // always wins over the tier default.
    const raw = Number.parseInt(rawStr, 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }
  // Unset → auto from the system-RAM tier (resolveMaintainerMemoryProfile):
  // small-RAM hosts (laptops, the OOM case) get idle-TTL ON; roomy hosts → 0/off.
  return resolveMaintainerMemoryProfile({ totalMemBytes }).idleTtlMs;
}

/**
 * D.1 idle bookkeeping (pure + testable). The maintainer has NO query route, so
 * idle is keyed on consecutive ticks that found NOTHING to do — `dirtyAtTickStart
 * === 0` AND an empty maintenance queue — NOT on the self-heartbeats
 * (recordProgress/writeStateLock always tick). Any indexed change resets the
 * counter and the wall-clock idle anchor.
 *
 * @param {object} state            mutable { idleTicks:number, idleSinceMs:number|null }
 * @param {object} args
 * @param {number} args.dirtyAtTickStart
 * @param {number} args.maintenanceBacklog
 * @param {boolean} [args.skipped]  a dormant/paused tick is NOT activity, but is
 *                                  also not "idle work done" — treat as idle.
 * @param {number} [args.nowMs]
 * @returns {{ idle:boolean }}
 */
export function recordIdleTick(state, { dirtyAtTickStart, maintenanceBacklog, skipped = false, nowMs = Date.now() }) {
  const didWork = !skipped && ((Number(dirtyAtTickStart) || 0) > 0 || (Number(maintenanceBacklog) || 0) > 0);
  if (didWork) {
    state.idleTicks = 0;
    state.idleSinceMs = null;
    return { idle: false };
  }
  state.idleTicks = (state.idleTicks || 0) + 1;
  if (state.idleSinceMs == null) state.idleSinceMs = nowMs;
  return { idle: true };
}

/**
 * D.1: has the maintainer been continuously idle (no indexed change, empty
 * maintenance queue) for at least `ttlMs` wall-clock across consecutive ticks?
 * Requires BOTH at least one consecutive idle tick AND the wall-clock budget to
 * have elapsed since idleness began. ttlMs<=0 ⇒ never (disabled).
 */
export function idleTtlExceeded(state, ttlMs, nowMs = Date.now()) {
  if (!(ttlMs > 0)) return false;
  // Use a null check, NOT truthiness: an idle anchor of exactly 0ms is valid.
  if (state.idleSinceMs == null) return false;
  if ((state.idleTicks || 0) < 1) return false;
  return (nowMs - state.idleSinceMs) >= ttlMs;
}

// Deadline for the whole post-recycle teardown. The watchdog is armed BEFORE
// the teardown awaits, not after: `watcher.close()`, the registry
// `unregister()` and `unloadLocalModel()` are all native and none is
// guaranteed to resolve. A hang there would leave a fat process holding the
// lock and doing no work — the exact state the ceiling exists to prevent.
const RECYCLE_TEARDOWN_DEADLINE_MS = 20_000;

// Per-step bound inside that deadline, so one wedged native close cannot eat
// the whole budget and starve the lock release + handoff that follow it.
const TEARDOWN_STEP_DEADLINE_MS = 5_000;

// Backstop for the watchdog's own handoff, so a wedge there cannot keep the
// process alive indefinitely after we have already decided to leave.
const WATCHDOG_HANDOFF_DEADLINE_MS = 5_000;

// How long to wait before confirming the successor is still alive. `spawn()`
// reports failures like EAGAIN/EMFILE/ENOENT asynchronously, so a synchronous
// return tells us nothing about whether the child survived.
const SUCCESSOR_CONFIRM_MS = 750;

// Chain length at which a repeating recycle stops being routine and starts
// meaning "the ceiling is below this repo's working set".
const RECYCLE_CHAIN_WARN_AT = 3;

/**
 * Run a best-effort teardown step under a hard time bound. A step that hangs
 * is abandoned, never awaited forever; a step that throws is swallowed. Both
 * are already best-effort in this shutdown path — the bound only stops one of
 * them from blocking the lock release and the handoff behind it.
 */
async function runBoundedTeardown(label, fn, ms = TEARDOWN_STEP_DEADLINE_MS, emit = log) {
  let timer = null;
  // The rejection handler is attached to the work promise ITSELF, not to the
  // race. Promise.race does not cancel the loser, so a step that rejects after
  // the timeout has already won would otherwise be an unhandled rejection.
  const work = Promise.resolve()
    .then(fn)
    .then(() => true, (err) => {
      emit('WARN', `${label} failed (non-fatal): ${err?.message ?? err}`);
      return true;
    });
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => { timer = null; resolve(false); }, ms);
  });
  const finished = await Promise.race([work, expiry]);
  if (timer) clearTimeout(timer);
  if (finished === false) {
    emit('WARN', `${label} did not finish within ${ms}ms; abandoning it so shutdown can continue.`);
  }
}

/**
 * Does this shutdown hand off to a successor?
 *
 * An RSS recycle is the ONE exit reason where the work is NOT finished — the
 * maintainer quits mid-backlog purely to hand native memory back to the OS.
 * Every other reason means "stop", and an explicit stop must WIN even when it
 * arrives after the recycle decision: an operator who sends SIGTERM during
 * teardown expects the maintainer to be gone, not replaced.
 */
export function shouldHandOffAfterRecycle({ recycleForRss, stopRequested }) {
  return recycleForRss === true && stopRequested !== true;
}

/**
 * How many RSS recycles this maintainer chain has done, including the one we
 * are about to do. A cold-started maintainer has no generation env var, so its
 * successor is generation 1. Garbage/negative values reset to 0.
 */
export function nextRecycleGeneration(env = process.env) {
  const raw = Number(env.SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION);
  const current = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  return current + 1;
}

/**
 * Environment for the successor maintainer.
 *
 * The project root and state dir are pinned to the ALREADY-RESOLVED absolute
 * paths from our own context. Inheriting the raw strings is not safe: they may
 * be relative, and the successor is spawned with a different cwd, so
 * `SWEET_SEARCH_PROJECT_ROOT=repos/app` would re-resolve against the new cwd
 * and point the successor at a different index — leaving the real one with
 * zero writers.
 */
export function successorEnv(ctx, env = process.env) {
  return {
    ...env,
    SWEET_SEARCH_PROJECT_ROOT: ctx.projectRoot,
    SWEET_SEARCH_STATE_DIR: ctx.stateDir,
  };
}

/**
 * Did the freshly spawned successor survive its first `ms`?
 *
 * Watching the child handle's events is the only reliable answer. A pid probe
 * is NOT: a child that exits immediately becomes a zombie of this process until
 * it is reaped, and `process.kill(pid, 0)` reports a zombie as alive — so the
 * probe returns "healthy" in exactly the case the check exists to catch.
 *
 * `error` covers the asynchronous spawn failures (EAGAIN, EMFILE, ENOENT on a
 * missing cwd) that the synchronous try/catch cannot see.
 */
function confirmSuccessor(child, ms) {
  if (!child || typeof child.once !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    let t = null;
    const finish = (alive) => {
      if (settled) return;
      settled = true;
      if (t) clearTimeout(t);
      child.removeListener('error', onDead);
      child.removeListener('exit', onDead);
      resolve(alive);
    };
    const onDead = () => finish(false);
    child.once('error', onDead);
    child.once('exit', onDead);
    // DELIBERATELY REF'D. The child is detached and unref'd, the pending promise
    // holds nothing, and by this point the shutdown path has cleared every
    // interval — so with an unref'd timer Node exits before either the child's
    // `exit` event or this timeout can run, and the confirmation silently never
    // happens. Verified: a parent whose detached child ran `process.exit(1)`
    // exited 0 without the confirmation callback firing at all. A referenced
    // timer keeps the loop alive for exactly this bounded window, which is the
    // whole point; the caller exits immediately afterwards.
    t = setTimeout(() => finish(true), ms);
  });
}

/**
 * Start the successor maintainer after an RSS recycle, and report what
 * happened. Extracted from the shutdown path so the decision logic is testable
 * without spawning a process: `launch` is the injected launcher (defaults to
 * the real `launchMaintainer`).
 *
 * A synchronous `spawn()` return does NOT mean the child is running — Node
 * reports EAGAIN/EMFILE/ENOENT asynchronously — so a confirmed handoff waits
 * briefly and re-checks liveness, retrying once. Without that check the parent
 * can log "successor started", exit, and leave zero writers.
 *
 * Never throws — a failed handoff is logged loudly and reported, because the
 * consequence (a silently frozen index) must not also be a silent crash.
 *
 * @returns {Promise<{generation:number, spawned:boolean, reason:string, confirmed:boolean}>}
 */
export async function handOffAfterRssRecycle({
  cwd,
  env = process.env,
  daemonPidFile = null,
  daemonPid = null,
  launch = null,
  emit = log,
  confirmDelayMs = SUCCESSOR_CONFIRM_MS,
  confirm = confirmSuccessor,
  shouldAbort = () => false,
  attempts = 2,
} = {}) {
  const generation = nextRecycleGeneration(env);
  let outcome = { generation, spawned: false, reason: 'error', confirmed: false };
  try {
    const launcher = launch || launchMaintainer;
    const childEnv = { ...env, SWEET_SEARCH_MAINTAINER_RECYCLE_GENERATION: String(generation) };
    let result = null;
    for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
      // Re-checked before EVERY spawn: an operator stop that arrives between
      // attempts must not be answered with another successor.
      if (shouldAbort()) {
        emit('INFO', 'RSS-recycle handoff abandoned: a stop was requested.');
        return { generation, spawned: false, reason: 'stop-requested', confirmed: false };
      }
      result = launcher({
        cwd,
        env: childEnv,
        ...(daemonPidFile ? { daemonPidFile } : {}),
        ...(daemonPid ? { daemonPid } : {}),
        log: (msg) => emit('INFO', `RSS-recycle handoff: ${msg}`),
      });
      if (result?.spawned !== true) break;
      // `null` ⇒ this launcher gave us no child handle to watch (an injected
      // test double). Trust the synchronous result rather than inventing a
      // liveness signal we do not have.
      const survived = await confirm(result.child, confirmDelayMs);
      // The confirmation window is real wall-clock time, so a SIGTERM can land
      // inside it. The successor is already running by then, so honouring the
      // stop means stopping IT too — otherwise `kill <pid>` silently leaves a
      // replacement behind, which is exactly the round-1 complaint one layer
      // deeper.
      if (shouldAbort()) {
        emit('WARN', `RSS-recycle handoff: stop requested during confirmation; stopping the successor (pid ${result.pid}).`);
        try { result.child?.kill?.('SIGTERM'); } catch { /* best-effort */ }
        return { generation, spawned: false, reason: 'stop-requested', confirmed: false };
      }
      if (survived !== false) {
        outcome = { generation, spawned: true, reason: 'spawned', confirmed: survived === true };
        emit('INFO', `RSS-recycle handoff: successor maintainer ${survived === true ? 'confirmed running' : 'started'} (pid ${result.pid}, generation ${generation})`);
        break;
      }
      emit('WARN', `RSS-recycle handoff: successor pid ${result.pid} did not survive its first ${confirmDelayMs}ms (attempt ${attempt}).`);
      outcome = { generation, spawned: true, reason: 'died-immediately', confirmed: false };
    }
    if (result?.spawned !== true) {
      outcome = { generation, spawned: false, reason: result?.reason ?? 'unknown', confirmed: false };
    }
    if (outcome.spawned && outcome.reason === 'spawned') {
      // Already logged with the pid above.
    } else if (outcome.reason === 'already-running') {
      // Benign: a maintainer already owns the lock for this state dir, so the
      // index has a live writer. Nothing to warn about — this is the O_EXCL
      // guarantee doing its job, e.g. after a takeover raced our shutdown.
      emit('INFO', 'RSS-recycle handoff: a maintainer already holds the lock; no successor needed.');
    } else {
      emit('WARN', `RSS-recycle handoff did NOT start a successor (${outcome.reason}). The index stops converging until the next daemon start.`);
    }
  } catch (err) {
    emit('ERROR', `RSS-recycle handoff failed: ${err?.message ?? err}. The index stops converging until the next daemon start.`);
    outcome = { generation, spawned: false, reason: 'error', confirmed: false };
  }
  // A repeating chain means the ceiling sits below this repo's true resident
  // working set. We deliberately do NOT cap the chain — a capped chain is the
  // silent-staleness bug again, and each generation still does a full minUptime
  // of useful work with RSS bounded by the ceiling. We say so instead, and name
  // the knob.
  if (generation >= RECYCLE_CHAIN_WARN_AT) {
    emit('WARN', `Maintainer has recycled for RSS ${generation} times in a row. The ceiling is probably below this repo's working set; raise SWEET_SEARCH_MAINTAINER_RSS_MAX_MB.`);
  }
  return outcome;
}

/**
 * How long after a stop signal the maintainer may take to finish its current
 * step and tear down before it exits regardless. A tick checks for a stop at
 * every progress checkpoint, but native work between two checkpoints (an ORT
 * batch, a SQLite publish) is not interruptible. A process that has been told
 * to stop must stop: before this deadline existed a maintainer could keep
 * running for minutes after SIGTERM, and operators fell back to SIGKILL.
 * Exiting here is safe: artifacts are published by rename and SQLite rolls an
 * unfinished transaction back; the `exit` handler releases the lock.
 */
export const SIGNAL_EXIT_DEADLINE_MS = 10_000;

/**
 * How long the maintainer keeps running with no live search daemon behind the
 * pid file it was started for. Covers a daemon that is still loading its
 * indexes (it writes the pid file only once loaded) and a daemon restart.
 */
export const DAEMON_ABSENT_GRACE_MS = 120_000;

/** Grace before a maintainer stops with its daemon (timing override for tests). */
function daemonAbsentGraceMs(env = process.env) {
  const raw = Number.parseInt(env.SWEET_SEARCH_MAINTAINER_DAEMON_GRACE_MS ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DAEMON_ABSENT_GRACE_MS;
}

/** How often the daemon is looked for; same cadence knob as the idle check. */
function daemonCheckIntervalMs(env = process.env) {
  const raw = Number.parseInt(env.SWEET_SEARCH_MAINTAINER_IDLE_CHECK_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, LOCK_REFRESH_INTERVAL) : LOCK_REFRESH_INTERVAL;
}

/** `--daemon-pid-file=<path>` from the maintainer's argv, or null. */
export function daemonPidFileFromArgv(argv = process.argv) {
  const prefix = '--daemon-pid-file=';
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  const value = arg ? arg.slice(prefix.length) : '';
  return value || null;
}

/** `--daemon-pid=<n>` from the maintainer's argv, or null. */
export function daemonPidFromArgv(argv = process.argv) {
  const prefix = '--daemon-pid=';
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  const pid = arg ? Number.parseInt(arg.slice(prefix.length), 10) : NaN;
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** True when a process with this pid exists (EPERM = alive, owned by another user). */
function pidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/** True when the pid file names a running process. Missing/garbage file → false. */
export function daemonPidFileLive(pidFile) {
  let pid;
  try {
    pid = Number.parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
  } catch {
    return false;
  }
  if (!Number.isFinite(pid) || pid <= 0) return false;
  return pidRunning(pid);
}

/**
 * Decide whether a maintainer started for a search daemon should stop because
 * that daemon is gone. Pure: `state` carries the time the daemon was first seen
 * missing. Returns true once it has been missing for `graceMs` without a break.
 */
export function daemonGoneLongEnough(state, { live, nowMs, graceMs = DAEMON_ABSENT_GRACE_MS }) {
  if (live) {
    state.absentSinceMs = null;
    return false;
  }
  if (state.absentSinceMs == null) state.absentSinceMs = nowMs;
  return nowMs - state.absentSinceMs >= graceMs;
}

async function runReconcileV2Main({ runOnce, merkleOnce }) {
  const ctx = reconcileV2Context();
  mkdirSync(ctx.stateDir, { recursive: true });
  if (runOnce || merkleOnce) {
    await runReconcileV2Tick(ctx);
    await drainMaintenanceInline(ctx);
    return;
  }

  const lock = await acquireStateLock(ctx.stateDir);
  if (!lock.acquired) {
    log('INFO', `Another reconcile v2 maintainer is running for ${ctx.stateDir}, exiting.`);
    return;
  }
  log('INFO', `Reconcile v2 lock acquired (PID: ${process.pid})`);

  // Crash-orphan sweep. We hold the exclusive state lock, so any staging
  // temp left over (`*.tmp.<pid>`, `*.compacting.tmp`, `*.json.tmp`,
  // `*.bin.tmp`, `*.selfheal.tmp`) is from a writer that died before its
  // rename. Age-gated; never touches canonical artifacts, queues, WAL, or
  // the lockfile (see artifact-temp-sweep.mjs). Best-effort: never let
  // cleanup failure stop the daemon from starting.
  try {
    const sweep = sweepStaleArtifactTemps(ctx.stateDir, { maxAgeMs: tmpSweepMaxAgeMs() });
    if (sweep.removed > 0) {
      log('INFO', `Swept ${sweep.removed} orphaned staging temp(s) (${sweep.bytesReclaimed} bytes) from ${ctx.stateDir}`);
    }
  } catch (err) {
    log('WARN', `Artifact temp sweep failed (continuing startup): ${err?.message ?? err}`);
  }

  const resolved = resolveReconcileV2Interval();
  // A.4-consume: the sleep interval is now mutable so the autotune can move it
  // each iteration. When the operator pins an explicit interval, the resolver
  // marks it `pinned` and the autotune never fires (parity with the reconciler
  // config's `pinnedIntervalMs` short-circuit).
  let intervalMs = resolved.intervalMs;
  const autotunePinned = resolved.pinned === true;
  log('INFO', `Reconcile v2 interval ${intervalMs}ms (source=${resolved.source}${resolved.tier ? `, tier=${resolved.tier}` : ''})`);

  // G3 arming: configure the BACKGROUND/maintainer ORT profile BEFORE the first
  // tick embeds. The ONNX session singleton is built once on first encode;
  // configuring after is a silent no-op (mirrors indexer-phases.js:491).
  //
  // MAINTAINER-SCOPED DEFAULT-ON (disable with SWEET_SEARCH_ORT_BACKGROUND=0):
  // arm the background ORT profile (force_spinning_stop + arena-off + 2–6
  // intra-op threads) by default, but ONLY in this maintainer daemon process. We
  // arm it explicitly here via configureLocalModelRuntime({ background: true }),
  // which sets the process-local runtime config — it does NOT touch
  // buildLocalSessionOptions / isBackgroundOrtProfile's env fallback, so every
  // OTHER process (the latency-critical search/query embedding path) stays on the
  // FOREGROUND profile. Verified ORT embeddings byte-identical. Set
  // SWEET_SEARCH_ORT_BACKGROUND=0 to keep even the maintainer on foreground.
  // Best-effort — never block startup on the embedding module.
  if (process.env.SWEET_SEARCH_ORT_BACKGROUND !== '0') {
    try {
      // Arms BOTH resident CPU sessions (dense + late-interaction) — the LI
      // session previously stayed on the foreground profile (arena ON +
      // allow_spinning) inside the daemon; measured consequence: 354 × 128MB
      // arena extensions (~34GB RSS) after one edit-heavy day plus ~40% idle
      // CPU from spinning workers.
      const { armBackgroundOrtProfiles } = await import('./model-pool.js');
      armBackgroundOrtProfiles();
      log('INFO', 'ORT background profile armed for maintainer daemon (dense + LI: force_spinning_stop + arena-off + bg threads)');
    } catch (err) {
      log('WARN', `ORT background profile arming failed (continuing on foreground profile): ${err?.message ?? err}`);
    }
  }

  // File watcher: the primary dirty-set producer. It feeds the queue from
  // filesystem events and wakes the inter-tick sleep, and the producer block
  // demotes the full stat-walk to a periodic backstop. Where it cannot start
  // (no native binding, inotify watch limit), the full walk runs every tick.
  const watcherState = { active: false, pendingEvents: false, forceBackstopWalk: false, lastBackstopWalkMs: 0, handle: null };
  const backstopMs = backstopWalkIntervalMs().intervalMs;
  if (maintainerWatchEnabled()) {
    const wake = createWatchWake();
    try {
      const mod = await import('./maintainer-watcher.mjs');
      const { createAdmissionPolicy } = await import('../indexing/admission-policy.js');
      watcherState.handle = await mod.startWatcher({
        stateDir: ctx.stateDir,
        projectRoot: ctx.projectRoot,
        admissionPolicy: createAdmissionPolicy({ projectRoot: ctx.projectRoot }),
        createAdmissionPolicy,
        onEvent: () => { watcherState.pendingEvents = true; wake(); },
        onOverflow: () => { watcherState.forceBackstopWalk = true; watcherState.pendingEvents = true; wake(); },
      });
      watcherState.active = !!watcherState.handle;
      if (watcherState.active) log('INFO', `Maintainer file watcher active (backstop walk every ${backstopMs}ms)`);
      else log('WARN', 'Maintainer file watcher could not start; the full walk runs every tick');
    } catch (err) {
      log('WARN', `Maintainer file watcher could not start (${err?.message ?? err}); the full walk runs every tick`);
    }
  }

  // G7 RSS-budget registry hook (integration seam; module owned by G7).
  // Registers when the soft cap is enabled — which is now tier-aware:
  // `isEnabled()` is true when SWEET_SEARCH_RSS_BUDGET_FRACTION is set OR the
  // system-RAM tier auto-enables a cap (small-RAM hosts). Best-effort, guarded
  // so a missing module is a no-op.
  let rssRegistration = null;
  // D.5 per-process recycle ceiling: fleet-budget eviction only sheds the
  // longest-IDLE daemon, so an active maintainer needs its own line. Resolved
  // once; checked at tick boundaries below. 0 ⇒ disabled.
  let rssCeiling = { ceilingBytes: 0, minUptimeMs: 0, shouldRecycleForRss: null };
  // Set ONLY by the D.5 ceiling trip below. It selects the successor handoff in
  // the `finally` — see the comment there for why no other exit reason qualifies.
  let recycleForRss = false;
  // Set by every exit reason that means "stop, and stay stopped": SIGTERM,
  // SIGINT, idle-TTL, a lost lock, a lifecycle abort. It DOMINATES
  // recycleForRss, so a signal that arrives after the ceiling trip still
  // cancels the handoff — `kill <pid>` must never be answered with a successor.
  let stopRequested = false;
  try {
    const mod = await import('./rss-budget.mjs');
    if (typeof mod.isEnabled === 'function' && mod.isEnabled()
        && typeof mod.registerDaemon === 'function') {
      rssRegistration = await mod.registerDaemon({ pid: process.pid, stateDir: ctx.stateDir, kind: 'maintainer' });
      const registration = rssRegistration;
      encoderChildListener = (pid) => { Promise.resolve(registration.setChildren?.(pid ? [pid] : [])).catch(() => {}); };
    }
    if (typeof mod.maintainerRssCeilingBytes === 'function') {
      rssCeiling = {
        ceilingBytes: mod.maintainerRssCeilingBytes(),
        minUptimeMs: mod.maintainerRssMinUptimeMs(),
        shouldRecycleForRss: mod.shouldRecycleForRss,
      };
      if (rssCeiling.ceilingBytes > 0) {
        log('INFO', `Maintainer RSS recycle ceiling armed: ${(rssCeiling.ceilingBytes / 1048576).toFixed(0)}MB (min uptime ${rssCeiling.minUptimeMs}ms; override SWEET_SEARCH_MAINTAINER_RSS_MAX_MB)`);
        // Advisory only — the operator's explicit value is never overridden.
        // Below the measured steady resident set the maintainer cannot stay
        // under the line, so it will recycle and hand off on every minUptime.
        // That is bounded and it keeps the index converging, but it is worth
        // saying out loud rather than leaving as a mystery restart loop.
        const floor = mod.MAINTAINER_RSS_RESIDENT_FLOOR_BYTES;
        if (Number.isFinite(floor) && rssCeiling.ceilingBytes < floor) {
          log('WARN', `That ceiling is below the measured steady resident set (~${(floor / 1073741824).toFixed(0)}GiB). Expect a recycle + handoff roughly every ${Math.round(rssCeiling.minUptimeMs / 60000)} minutes.`);
        }
      }
    }
  } catch (err) {
    log('WARN', `RSS-budget registry unavailable (no soft cap on this daemon): ${err?.message ?? err}`);
  }
  let completedTicks = 0;

  // D.1 idle-TTL: an unattended maintainer self-shuts-down after the configured
  // wall-clock idle budget so N resident model-loaded daemons collapse to 1–2
  // (the ~16 GB cross-repo footprint fix). Default 0/disabled ⇒ run forever
  // (today's behavior). Idle is keyed on consecutive ticks that found nothing to
  // do (dirtyAtTickStart===0 AND empty maintenance queue), NEVER on the
  // self-heartbeats. NOTE: the search-server daemon has its own idle-TTL+LRU,
  // but it never enumerates/registers the maintainer (search-server.js:918), so
  // there is no double-mechanism here.
  const idleTtl = maintainerIdleTtlMs();
  const idleState = { idleTicks: 0, idleSinceMs: null };
  // Unref'd idle timer mirrors search-server.js:907–913 — it never keeps the
  // event loop alive on its own and only REQUESTS shutdown (it does NOT
  // process.exit); the main loop drains the current tick to `finally`.
  const idleTimer = idleTtl > 0
    ? setInterval(() => {
        if (idleTtlExceeded(idleState, idleTtl)) {
          log('INFO', `Maintainer idle for ≥${idleTtl}ms with no indexed change; requesting clean shutdown for on-demand respawn`);
          // Idle means there is nothing left to index, so this exit must NOT
          // hand off — a successor would immediately idle out again.
          stopRequested = true;
          shutdownRequested = true;
        }
      }, Number(process.env.SWEET_SEARCH_MAINTAINER_IDLE_CHECK_MS ?? 60_000))
    : null;
  if (idleTimer?.unref) idleTimer.unref();

  // Lifecycle fix: only refresh the heartbeat if we still own the lock. If a
  // wedged-backstop takeover stole it, the lockfile now names another pid —
  // we must NOT clobber that successor with our pid. The main loop's
  // ownership check will end this maintainer at the next iteration.
  const refresh = setInterval(() => {
    if (stillOwnsLock(lock.lockFile)) writeStateLock(lock.lockFile);
  }, LOCK_REFRESH_INTERVAL);
  // A stop signal ends the sleep at once, aborts the tick at its next progress
  // checkpoint, and — if teardown still has not finished after
  // SIGNAL_EXIT_DEADLINE_MS — exits anyway. A second signal exits at once.
  let signalsSeen = 0;
  const shutdown = (signal) => {
    stopRequested = true;
    shutdownRequested = true;
    signalsSeen += 1;
    if (signalsSeen > 1) {
      log('WARN', `${signal} received again; exiting now.`);
      process.exit(0);
    }
    log('INFO', `${signal} received; stopping.`);
    wakeMaintainerSleep();
    const deadline = setTimeout(() => {
      log('WARN', `Stop did not finish within ${SIGNAL_EXIT_DEADLINE_MS}ms of ${signal}; exiting now.`);
      process.exit(0);
    }, SIGNAL_EXIT_DEADLINE_MS);
    deadline.unref?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('exit', () => releaseStateLock(lock.lockFile));

  // A maintainer started for a search daemon lives as long as that daemon. The
  // daemon starts (and supervises) the maintainer, so once no daemon has served
  // this repository for DAEMON_ABSENT_GRACE_MS nothing queries the index, and the
  // next daemon to start launches a fresh maintainer whose first tick catches up.
  const daemonPidFile = daemonPidFileFromArgv();
  const daemonPid = daemonPidFromArgv();
  const daemonLabel = daemonPidFile || `pid ${daemonPid}`;
  const daemonFollow = { absentSinceMs: null };
  const daemonCheck = (daemonPidFile || daemonPid)
    ? setInterval(() => {
        if (shutdownRequested) return;
        const live = daemonPidFile ? daemonPidFileLive(daemonPidFile) : pidRunning(daemonPid);
        if (daemonGoneLongEnough(daemonFollow, { live, nowMs: Date.now(), graceMs: daemonAbsentGraceMs() })) {
          log('INFO', `No search daemon behind ${daemonLabel} for ${daemonAbsentGraceMs()}ms; stopping with it.`);
          // Nothing left to serve, so no successor either.
          stopRequested = true;
          shutdownRequested = true;
          wakeMaintainerSleep();
        }
      }, daemonCheckIntervalMs())
    : null;
  daemonCheck?.unref?.();

  try {
    while (!shutdownRequested) {
      // Lifecycle fix: bail out if the lock no longer names us. This is the
      // backstop that ensures any displacement path (wedged-takeover,
      // alive-but-stuck takeover, manual unlink) never leaves an immortal
      // twin maintainer behind — the displaced daemon self-exits at the
      // next loop iteration instead of looping forever as a PPID=1 orphan.
      // Checked BEFORE the tick (not after) so a displaced daemon never
      // starts new work while another maintainer owns the lock.
      if (!stillOwnsLock(lock.lockFile)) {
        log('WARN', `Lock no longer owned by pid=${process.pid}; another maintainer has taken over. Exiting cleanly.`);
        // A successor already exists — never start a second one.
        stopRequested = true;
        shutdownRequested = true;
        break;
      }
      // Lifecycle fix v2: progress checkpoint at the top of each iteration.
      // Combined with the post-tick / post-drain checkpoints below this lets
      // acquireStateLock distinguish a busy-but-progressing daemon from one
      // hung on a never-resolving await — see the WEDGED_KILL_GRACE_MS block.
      recordProgress(lock.lockFile);
      // G6: the watcher already fed the queue from filesystem events, so the
      // expensive full stat-walk producer is demoted to a periodic backstop.
      // We pass the demotion decision into the tick via ctx so the producer
      // block (index-maintainer.mjs ~:907) can skip the walk when appropriate.
      // When the watcher is inactive this is always `false` ⇒ today's behavior.
      let runFullWalk = true;
      if (watcherState.active) {
        const nowMs = Date.now();
        const dueForBackstop = (nowMs - (watcherState.lastBackstopWalkMs || 0)) >= backstopMs;
        const firstTick = !watcherState.lastBackstopWalkMs;
        runFullWalk = firstTick || dueForBackstop || watcherState.forceBackstopWalk;
        if (runFullWalk) {
          watcherState.lastBackstopWalkMs = nowMs;
          watcherState.forceBackstopWalk = false;
        }
      }
      // Consume any pending watcher events for THIS tick (the queue already
      // holds them); clear so early-wake doesn't immediately re-fire post-sleep.
      watcherState.pendingEvents = false;
      // Files the tick could not reach stay queued; the next tick starts at
      // once instead of after the interval, so a backlog drains at the speed of
      // the encoder and a fresh edit is never parked behind a sleep.
      let backlogLeft = false;
      const pause = isReconcilePaused(ctx.stateDir);
      if (pause.paused) {
        // A paused index has nothing for this process to do, and the paused
        // branch never counted toward the idle TTL, so the maintainer used to
        // sit here for good. Stop instead: no launcher starts one while the
        // pause holds, and `reconcile resume` + the next query start a fresh one.
        log('INFO', `Automatic reconcile v2 work paused${pause.pausedAt ? ` since ${pause.pausedAt}` : ''}${pause.reason ? ` (${pause.reason})` : ''}; stopping.`);
        stopRequested = true;
        shutdownRequested = true;
        break;
      } else {
        try {
          const onProgress = createLifecycleProgress(lock.lockFile);
          const tickCounters = await runReconcileV2Tick({ ...ctx, onProgress, skipFullWalk: watcherState.active && !runFullWalk });
          onProgress('tick:post');  // post-tick checkpoint
          await drainMaintenanceInline({ ...ctx, onProgress });
          onProgress('drain:post');  // post-drain checkpoint

          // A.4-consume + D.1 idle bookkeeping. Read the maintenance backlog
          // AFTER the drain (it reflects what remains, not what was queued).
          let backlog = 0;
          try {
            const { readMaintenanceQueue } = await import('../incremental-indexing/application/maintenance-worker.mjs');
            backlog = readMaintenanceQueue(ctx.stateDir).length;
          } catch { backlog = 0; }
          const dirtySeen = Number(tickCounters?.dirty_paths_seen) || 0;
          backlogLeft = (Number(tickCounters?.dirty_paths_deferred) || 0) > 0;
          if (!autotunePinned) {
            const tuned = computeNextIntervalMs({
              currentMs: intervalMs,
              counters: tickCounters,
              maintenanceBacklog: backlog,
            });
            if (tuned.tuned) {
              log('INFO', `Reconcile v2 interval ${intervalMs}ms → ${tuned.nextMs}ms (${tuned.reasons.join(',')})`);
              intervalMs = tuned.nextMs;
            }
          }
          const idleTick = recordIdleTick(idleState, {
            dirtyAtTickStart: dirtySeen,
            maintenanceBacklog: backlog,
            skipped: tickCounters?.skipped === true,
          });

          // FLEET-EVICTION FAIRNESS. The RSS coordinator sheds the daemon with
          // the OLDEST lastActivityMs. We registered with that field set once,
          // at startup, and never touched it again — so among maintainers the
          // stamp was really "when did this process start", and the victim was
          // always the earliest-started one. That is the repository you have had
          // open all day: the coordinator would have hunted your main repo,
          // supervision would have restarted it because that repo is being
          // queried, and it would be evicted again.
          //
          // Refreshing on ticks that did real work makes "longest idle" mean
          // what it says. It also makes the busy-maintainer preference fall out
          // for free: a maintainer that is indexing keeps its stamp fresh, so it
          // is automatically the last thing eviction reaches for.
          if (!idleTick.idle && rssRegistration && typeof rssRegistration.touch === 'function') {
            // Best-effort and deliberately not awaited: this is a shared-file
            // read-modify-write, and a slow one must never delay the next tick.
            Promise.resolve(rssRegistration.touch()).catch(() => {});
          }
          // D.5: per-process RSS recycle check — tick boundary only (the tick
          // above has published; a recycle here can never tear an artifact).
          completedTicks += 1;
          if (rssCeiling.ceilingBytes > 0 && typeof rssCeiling.shouldRecycleForRss === 'function') {
            const rssNow = process.memoryUsage.rss();
            const verdict = rssCeiling.shouldRecycleForRss({
              rssBytes: rssNow,
              ceilingBytes: rssCeiling.ceilingBytes,
              uptimeMs: process.uptime() * 1000,
              minUptimeMs: rssCeiling.minUptimeMs,
              ticksCompleted: completedTicks,
            });
            if (verdict.recycle) {
              log('WARN', `Maintainer RSS ${(rssNow / 1048576).toFixed(0)}MB exceeds recycle ceiling ${(rssCeiling.ceilingBytes / 1048576).toFixed(0)}MB; shutting down and handing off to a fresh maintainer. If this repeats right after startup, raise SWEET_SEARCH_MAINTAINER_RSS_MAX_MB.`);
              recycleForRss = true;
              shutdownRequested = true;
            }
          }
        } catch (err) {
          if (err instanceof MaintainerLifecycleAbort) {
            log('WARN', `Reconcile v2 lifecycle abort: ${err.message}. Cleaning up cancellation-orphaned temps and exiting cleanly.`);
            // Caveat-1 fix: on cancellation, immediately remove our own
            // staging temps so they don't sit on disk waiting for the next
            // daemon startup to sweep them. Safe to use maxAgeMs=0 here
            // because (a) sweepStaleArtifactTemps uses a strict allowlist
            // of staging-temp suffixes — it never touches canonical
            // artifacts, queues, WAL, or the lockfile — and (b) maintenance
            // handlers run sequentially via processMaintenanceQueue, so no
            // concurrent writer is mid-rename when this fires.
            try {
              const sweep = sweepStaleArtifactTemps(ctx.stateDir, { maxAgeMs: 0 });
              if (sweep.removed > 0) {
                log('INFO', `Cancellation cleanup swept ${sweep.removed} orphaned staging temp(s) (${sweep.bytesReclaimed} bytes)`);
              }
            } catch (sweepErr) {
              log('WARN', `Cancellation cleanup sweep failed (non-fatal): ${sweepErr?.message ?? sweepErr}`);
            }
            // A cancellation is a stop, not a recycle — no successor.
            stopRequested = true;
            shutdownRequested = true;
            break;
          }
          log('ERROR', `Reconcile v2 tick failed: ${err?.message ?? err}`);
        }
      }
      // Skip the sleep when a shutdown was requested during this iteration
      // (idle-TTL, signal, or D.5 RSS recycle) — exit promptly instead of
      // waiting out one more interval.
      if (shutdownRequested) break;
      await sleepWithProgress(backlogLeft ? BACKLOG_TICK_GAP_MS : intervalMs, lock.lockFile, {
        // G6 early-wake: break the sleep the instant the watcher reports new
        // events so a fresh edit is reconciled without waiting out the interval.
        // No watcher ⇒ this is never truthy ⇒ today's full-interval sleep.
        wokenByWatcher: watcherState.active ? () => watcherState.pendingEvents : null,
      });
    }
  } finally {
    clearInterval(refresh);
    if (idleTimer) clearInterval(idleTimer);
    if (daemonCheck) clearInterval(daemonCheck);

    // D.5 teardown watchdog — armed BEFORE the awaits below, not after them.
    // `watcher.close()`, the registry `unregister()` and `unloadLocalModel()`
    // are all native and none is guaranteed to resolve. If one wedges we would
    // otherwise sit here forever: lock still held, no ticks running, full RSS
    // still resident — silent staleness with none of the memory reclaimed.
    //
    // The watchdog only ever fires from a timer callback, which means the event
    // loop is alive; a synchronously blocked loop would stop the watchdog too,
    // and nothing in-process can help there. Because the loop IS alive we can
    // use the SAME confirmed handoff as the normal path instead of a
    // fire-and-forget spawn: `spawn()` reports EAGAIN/EMFILE/ENOENT
    // asynchronously, so exiting immediately after a synchronous "spawned"
    // would report a successor that never existed.
    let teardownFinished = false;
    // Exit ownership latch. `teardownFinished` alone is not enough: it only
    // stops a watchdog callback that has NOT started. Once the watchdog IS
    // running, a teardown await can settle underneath it and the normal path
    // would race ahead — releasing the lock again, launching a second
    // successor, and calling process.exit(0) while the watchdog's confirmation
    // is still pending, which kills the retry. Exactly one of the two paths
    // owns shutdown from here on.
    let watchdogEngaged = false;
    const watchdog = recycleForRss ? setTimeout(() => {
      if (teardownFinished) return;
      watchdogEngaged = true;
      log('WARN', `Post-recycle teardown did not finish within ${RECYCLE_TEARDOWN_DEADLINE_MS}ms; releasing the lock and handing off from the watchdog.`);
      try { releaseStateLock(lock.lockFile); } catch { /* best-effort */ }
      // Hard backstop in case the handoff itself wedges. Referenced on purpose:
      // an unref'd timer here would let the process exit before the handoff
      // resolves, which is the very failure this block exists to avoid.
      const hardExit = setTimeout(() => {
        log('WARN', 'Watchdog handoff did not resolve; exiting anyway.');
        process.exit(0);
      }, WATCHDOG_HANDOFF_DEADLINE_MS);
      const done = () => { clearTimeout(hardExit); process.exit(0); };
      if (stopRequested) { done(); return; }
      handOffAfterRssRecycle({
        cwd: ctx.projectRoot,
        env: successorEnv(ctx, process.env),
        daemonPidFile,
        daemonPid,
        shouldAbort: () => stopRequested,
        emit: (level, msg) => log(level, `[watchdog] ${msg}`),
      }).then(done, done);
    }, RECYCLE_TEARDOWN_DEADLINE_MS) : null;
    watchdog?.unref?.();

    // G6 watcher teardown — best-effort, never throw and never hang. Safe to
    // abandon on timeout: closing a watcher only touches parent-local state.
    if (watcherState.handle && typeof watcherState.handle.close === 'function') {
      await runBoundedTeardown('Watcher close', () => watcherState.handle.close());
    }
    // G7 RSS registry teardown — SKIPPED ENTIRELY when we are handing off.
    //
    // `unregister` is an async read-modify-rename over a registry file SHARED
    // with every other daemon on the host. On a handoff that is a hazard with
    // no upside: if the rename stalls and lands after the successor has
    // registered itself, it restores a snapshot taken before the successor
    // existed and erases its entry — the successor is then invisible to fleet
    // RSS accounting for as long as it lives. Bounding the call does not help,
    // because abandoning it does not cancel the pending write.
    //
    // Not unregistering costs nothing: `pruneRegistry` drops entries whose pid
    // is gone on every eviction tick, so our row disappears on its own once
    // this process exits. On a non-handoff shutdown there is no successor to
    // erase, so we still unregister promptly and keep SIGTERM snappy.
    if (rssRegistration && typeof rssRegistration.unregister === 'function' && !recycleForRss) {
      await runBoundedTeardown('RSS registry unregister', () => rssRegistration.unregister());
    }
    // D.1: release the ORT session in order on a clean (idle-TTL or signal)
    // shutdown so a respawned daemon starts from a clean slate. This canNOT go
    // in the process.on('exit') handler (synchronous, no async). releaseStateLock
    // below unlinks the O_EXCL lock so the next launchMaintainer respawns cleanly
    // (reconcile-before-serve via the new daemon's t=0 tick).
    await runBoundedTeardown('Local model unload', async () => {
      encoderClient?.close();
      const { unloadLocalModel } = await import('../embedding/embedding-local-model.js');
      await unloadLocalModel();
    });
    teardownFinished = true;
    // The watchdog got here first and owns shutdown: it has already released
    // the lock and is mid-handoff, with its own referenced backstop timer
    // keeping this process alive until it finishes. Doing ANYTHING more here —
    // releasing again, launching a second successor, or exiting — would cut its
    // confirmation and retry short. Stand down.
    if (watchdogEngaged) return;
    if (watchdog) clearTimeout(watchdog);
    releaseStateLock(lock.lockFile);
    log('INFO', 'Reconcile v2 shutdown complete');
    // D.5 successor handoff. An RSS recycle is the ONE exit reason where the
    // work is NOT finished — the maintainer quits mid-backlog purely to hand
    // native (ORT arena / sqlite) memory back to the OS. Every other exit
    // reason means "stop": SIGTERM/SIGINT is an operator asking us to go away,
    // idle-TTL means there is nothing left to index, a lost lock means a
    // successor already exists, and a lifecycle abort is a cancellation. So
    // only this path hands off.
    //
    // Without the handoff the index silently stops converging. All three
    // launchMaintainer call sites (search-server, session prewarm, MCP server)
    // are COLD starts, so after a recycle nothing would restart the maintainer
    // until the next daemon boot — new files return zero hits from search and
    // grep, with no error anywhere.
    //
    // Ordering is load-bearing: the spawn happens AFTER releaseStateLock, so
    // the successor's O_EXCL acquire succeeds on its first attempt. The
    // successor is detached, so it outlives this process. Our own
    // process.on('exit') release is pid+token matched, so it can never unlink
    // the successor's lock, and a takeover that raced us re-checks ownership
    // before unlinking (see sigtermAndStealLock).
    if (shouldHandOffAfterRecycle({ recycleForRss, stopRequested })) {
      await handOffAfterRssRecycle({
        cwd: ctx.projectRoot,
        env: successorEnv(ctx, process.env),
        daemonPidFile,
        daemonPid,
        // Re-read live, not captured: a signal can land during the spawn and
        // the confirmation wait, long after the predicate above was evaluated.
        shouldAbort: () => stopRequested,
      });
      // Exit NOW rather than waiting for the event loop to drain. The successor
      // is already running, so every extra millisecond here is a millisecond
      // where two model-loaded processes are resident — the opposite of what a
      // recycle is for. Everything that had to happen has happened: the tick
      // published, the lock is released, the successor is confirmed.
      process.exit(0);
    }
    // Every other exit reason is a stop. Exit explicitly: waiting for the event
    // loop to drain leaves the process alive for as long as any native handle
    // (an ORT thread pool, a SQLite connection, a watcher) keeps the loop busy,
    // which looked to operators like a maintainer that ignored SIGTERM.
    process.exit(0);
  }
}

async function main() {
  const runOnce = process.argv.includes('--once');
  const merkleOnce = process.argv.includes('--merkle-once');

  // Name the resident daemon so ps/Activity Monitor shows what it is instead
  // of an anonymous `node`. Cosmetic-only: all liveness/takeover checks are
  // lock/pid-based, never command-line matching.
  try { process.title = 'sweet-search-maintainer'; } catch { /* best-effort */ }
  // Bench-only pid ledger (no-op unless SWEET_SEARCH_SPAWN_LEDGER_DIR is set).
  recordSpawn({ pid: process.pid, role: 'maintainer-self' });

  // A.1 (Tier-1, UNGATED): demote the maintainer daemon to low OS priority so
  // the foreground (editor / git / shell) never feels the background indexer's
  // CPU. Identical index output — only *when* CPU is granted changes.
  // Best-effort: a platform that rejects it must not crash the daemon.
  try { os.setPriority(os.constants.priority.PRIORITY_LOW); } catch { /* best-effort */ }

  // E.4 (global half): set the process-global SQLite `soft_heap_limit` ONCE,
  // before any tier connection opens. SQLite's `soft_heap_limit` is a
  // PROCESS-WIDE setting (sqlite3_soft_heap_limit64), not per-connection — so
  // running the pragma on a single throwaway in-memory connection at startup
  // caps the page-cache heap for EVERY subsequent better-sqlite3 connection in
  // this process (128 MiB). This is the process-wide lever that pairs with G2's
  // per-connection `cache_size` / `shrink_memory`. (better-sqlite3 exposes no
  // static global setter, so the throwaway-conn pragma is the documented path.)
  // Guarded + best-effort: a packaging without better-sqlite3 degrades to a
  // no-op and never crashes the daemon.
  try {
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const probe = new BetterSqlite3(':memory:');
    try { probe.pragma('soft_heap_limit = 134217728'); } finally { probe.close(); }
  } catch { /* best-effort: soft_heap_limit is an optimisation, never required */ }

  log('INFO', 'Starting index maintainer daemon v3...');
  // The one opt-out of automatic maintenance: the launchers do not start a maintainer
  // with it, and one started by hand exits.
  if (!reconcileEnablement().enabled) {
    log('INFO', 'Automatic index maintenance is off (SWEET_SEARCH_RECONCILE_V2=0); exiting.');
    return;
  }
  await runReconcileV2Main({ runOnce, merkleOnce });
}

// Only run main() when executed directly (not when imported for testing)
// This allows the exported functions to be tested without starting the daemon
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
                     process.argv[1]?.endsWith('index-maintainer.mjs');

if (isMainModule) {
  main().catch(err => {
    console.error(`[index-maintainer] Fatal error: ${err.message}`);
    process.exit(1);
  });
}
