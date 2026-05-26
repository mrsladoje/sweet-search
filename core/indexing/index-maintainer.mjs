#!/usr/bin/env node
/**
 * Index Maintainer Daemon v3 - Self-maintaining codebase index
 *
 * Detects ALL file changes (Claude edits + external IDE edits) and runs
 * full incremental indexing every 45 seconds.
 *
 * Features:
 * - Deferred merkle check (7s delay, ZERO startup latency)
 * - 45-second periodic merkle check (mtime/size/inode fast-path)
 * - Full incremental index: FTS5, HNSW, Binary HNSW, Code Graph (full), HCGS
 * - Global lock file prevents race with manual /index-codebase
 * - Soft delete for removed files (handles branch switches, prune after 30d)
 * - HCGS fallback chain: Cerebras → Ollama → Transformers.js → Static
 * - Single-instance via lockfile
 * - Graceful shutdown
 *
 * v3 Fixes (2026-01-02):
 * - C2: Atomic O_EXCL lock acquisition (prevents TOCTOU race)
 * - C3: Non-recursive global lock retry (prevents race between processes)
 * - H1: Reduced global lock stale threshold to 2min (faster SIGKILL recovery)
 * - H5: Atomic queue check+process (prevents peek/acquire race)
 * - M4: Track skipped merkle cycles (no file changes lost on lock contention)
 * - M5: Adjusted lock refresh/stale ratio (30s/3min for better margin)
 * - M8: Cancellable startup timeout (clean shutdown)
 * - L1: Version bump to v3
 * - L3: Structured logging with timestamps and levels
 *
 * Queue file format (JSONL - legacy, still supported for Claude edits):
 *   {"file_path": "/path/to/file.java", "timestamp": 1735670400000}
 *
 * Usage:
 *   node index-maintainer.mjs              # Run as daemon
 *   node index-maintainer.mjs --once       # Process queue once and exit
 *   node index-maintainer.mjs --dry-run    # Show what would be indexed
 *
 * Started by: session-preheat.sh (alongside search infrastructure)
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, appendFileSync, mkdirSync, openSync, closeSync, constants } from 'node:fs';
import fs from 'node:fs/promises';
import { dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { startupInterval, tierForHardware, reconcileEnablement } from '../incremental-indexing/domain/interval-autotune.mjs';
import { detectHardwareCapability } from '../infrastructure/hardware-capability.js';
import { sweepStaleArtifactTemps, DEFAULT_TMP_SWEEP_MAX_AGE_MS } from '../incremental-indexing/infrastructure/artifact-temp-sweep.mjs';
import { hasCompleteBaseIndex, WAITING_FOR_INITIAL_INDEX } from '../incremental-indexing/infrastructure/baseline-readiness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// ENOSPC (DISK FULL) SAFE WRITE UTILITIES
// =============================================================================
// H3 FIX: Handle disk full errors gracefully with atomic temp+rename pattern

/**
 * Safe write with ENOSPC detection and atomic temp+rename pattern.
 * @param {string} filePath - Target file path
 * @param {string} content - Content to write
 * @throws {Error} With clear message on disk full
 */
async function safeWriteFile(filePath, content) {
  const tempPath = `${filePath}.tmp.${process.pid}`;

  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } catch (err) {
    // Always try to clean up temp file
    try { await fs.unlink(tempPath); } catch {}

    if (err.code === 'ENOSPC') {
      throw new Error(`CRITICAL: Disk full, cannot write to ${filePath}. Free up space and retry.`);
    }
    throw err;
  }
}

/**
 * Sync version for lock files (must be synchronous)
 * H3 FIX: Uses atomic temp+rename pattern with ENOSPC detection
 * @param {string} filePath - Target file path
 * @param {string} content - Content to write
 * @throws {Error} With clear message on disk full
 */
function safeWriteFileSync(filePath, content) {
  const tempPath = `${filePath}.tmp.${process.pid}`;

  try {
    writeFileSync(tempPath, content);
    renameSync(tempPath, filePath);
  } catch (err) {
    try { unlinkSync(tempPath); } catch {}

    if (err.code === 'ENOSPC') {
      throw new Error(`CRITICAL: Disk full, cannot write to ${filePath}`);
    }
    throw err;
  }
}

/**
 * Safe append with ENOSPC detection
 * H3 FIX: Wraps appendFileSync with ENOSPC error handling
 * @param {string} filePath - Target file path
 * @param {string} content - Content to append
 * @throws {Error} With clear message on disk full
 */
function safeAppendFileSync(filePath, content) {
  try {
    appendFileSync(filePath, content);
  } catch (err) {
    if (err.code === 'ENOSPC') {
      throw new Error(`CRITICAL: Disk full, cannot append to ${filePath}. Free up space and retry.`);
    }
    throw err;
  }
}

// === Cross-Platform Path Normalization ===

/**
 * Normalize path separators to forward slashes for cross-platform compatibility.
 * Handles Windows paths (C:\Users\...), UNC paths (\\server\share), and WSL paths.
 * @param {string} filePath - Raw file path from queue entry
 * @returns {string} - Normalized path with forward slashes
 */
export function normalizePathSeparators(filePath) {
  if (!filePath) return filePath;

  // Convert all backslashes to forward slashes
  let normalized = filePath.replace(/\\/g, '/');

  // Handle UNC paths: \\server\share -> //server/share
  // (Already handled by the replace above)

  // Handle Windows drive letters: C:/ -> /c/ (lowercase for consistency)
  // This makes C:/Users/foo match patterns like /Users/
  const driveMatch = normalized.match(/^([A-Za-z]):\//);
  if (driveMatch) {
    normalized = '/' + driveMatch[1].toLowerCase() + normalized.slice(2);
  }

  return normalized;
}

// === Configuration ===
const PROJECT_ROOT = join(__dirname, '../..');
const DATA_DIR = join(PROJECT_ROOT, '.sweet-search');
const QUEUE_FILE = join(DATA_DIR, 'index-maintainer-queue.jsonl');
const PROCESSING_FILE = join(DATA_DIR, 'index-maintainer-queue.processing.jsonl');
const LOCK_FILE = join(DATA_DIR, 'index-maintainer.lock');
const DEADLETTER_FILE = join(DATA_DIR, 'index-maintainer-deadletter.jsonl');
const PAUSE_FILE = join(DATA_DIR, 'reconcile-pause.json');

// Export configuration for testing
export const CONFIG = {
  PROJECT_ROOT,
  DATA_DIR,
  QUEUE_FILE,
  PROCESSING_FILE,
  LOCK_FILE,
  DEADLETTER_FILE,
  PAUSE_FILE,
};

// Indexer paths
const INDEXER_PATH = join(PROJECT_ROOT, 'core', 'indexing', 'index-codebase-v21.js');

// === Dynamic Module Loaders (A2 FIX: Improved resilience with multiple strategies) ===

/**
 * Load fast-glob with fallback paths
 * A2 FIX: Try multiple resolution strategies with logging for diagnostics
 */
async function loadFastGlob() {
  const strategies = [
    // 1. Standard require resolution (preferred - works when npm installed globally or locally)
    { name: 'standard import', fn: async () => {
      const fg = await import('fast-glob');
      return fg.default || fg;
    }},
    // 2. Relative to sweet-search (has its own node_modules)
    { name: 'sweet-search node_modules', fn: async () => {
      const fg = await import(join(PROJECT_ROOT, 'node_modules/fast-glob/out/index.js'));
      return fg.default || fg;
    }},
    // 3. Project root node_modules
    { name: 'project root node_modules', fn: async () => {
      const fg = await import(join(PROJECT_ROOT, 'node_modules/fast-glob/out/index.js'));
      return fg.default || fg;
    }},
    // 4. Absolute path from __dirname
    { name: 'absolute from hooks dir', fn: async () => {
      const fg = await import(join(PROJECT_ROOT, 'node_modules/fast-glob/out/index.js'));
      return fg.default || fg;
    }},
  ];

  for (const { name, fn } of strategies) {
    try {
      const mod = await fn();
      log('DEBUG', `Loaded fast-glob via: ${name}`);
      return mod;
    } catch (err) {
      log('DEBUG', `fast-glob strategy failed (${name}): ${err.message}`);
    }
  }

  throw new Error('fast-glob not found after trying all strategies. Run: npm install fast-glob');
}

/**
 * Load better-sqlite3 with fallback paths
 * A2 FIX: Try multiple resolution strategies with logging for diagnostics
 */
async function loadBetterSqlite3() {
  const strategies = [
    // 1. Standard require resolution (preferred - works when npm installed globally or locally)
    { name: 'standard import', fn: async () => {
      const db = await import('better-sqlite3');
      return db.default || db;
    }},
    // 2. Relative to sweet-search (has its own node_modules)
    { name: 'sweet-search node_modules', fn: async () => {
      const db = await import(join(PROJECT_ROOT, 'node_modules/better-sqlite3/lib/index.js'));
      return db.default || db;
    }},
    // 3. Project root node_modules
    { name: 'project root node_modules', fn: async () => {
      const db = await import(join(PROJECT_ROOT, 'node_modules/better-sqlite3/lib/index.js'));
      return db.default || db;
    }},
    // 4. Absolute path from __dirname
    { name: 'absolute from hooks dir', fn: async () => {
      const db = await import(join(PROJECT_ROOT, 'node_modules/better-sqlite3/lib/index.js'));
      return db.default || db;
    }},
  ];

  for (const { name, fn } of strategies) {
    try {
      const mod = await fn();
      log('DEBUG', `Loaded better-sqlite3 via: ${name}`);
      return mod;
    } catch (err) {
      log('DEBUG', `better-sqlite3 strategy failed (${name}): ${err.message}`);
    }
  }

  throw new Error('better-sqlite3 not found after trying all strategies. Run: npm install better-sqlite3');
}

// Timing configuration
const POLL_INTERVAL = 30000;           // 30 seconds between queue checks
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
// Backwards-compat: a lockfile without `progressTimestamp` falls back to
// heartbeat-only (progressAge := heartbeatAge), reverting to classic 3-min
// behaviour. The SIGTERM-before-steal hardening means even this legacy path
// never leaks orphans.
//
// Caveat: progress IS still recorded from the main event loop, so a daemon
// blocked by pure synchronous CPU/native work shows both signals stale and
// will be SIGTERMed at 3 min. With async napi (see
// project_native_metal_inference_status) this case should not arise in
// practice; the natural escalation if it does is a worker_threads-based
// progress beacon — left as future work.
export const WEDGED_KILL_GRACE_MS = 5000;  // SIGTERM grace before declaring takeover complete

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;            // 1 second base delay
const MAX_DELAY_MS = 30000;            // 30 seconds max delay

// Merkle check configuration (v2)
const MERKLE_CHECK_INTERVAL = 45000;   // 45 seconds between merkle checks
const STARTUP_DELAY = 7000;            // 7 seconds deferred first check (zero startup latency)
const INDEXING_TIMEOUT = 5 * 60 * 1000; // 5 minutes timeout

const DEFAULT_INDEXABLE_EXTENSIONS = [
  '**/*.java', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs',
  '**/*.py', '**/*.go', '**/*.rs', '**/*.sql', '**/*.md',
  '**/*.yml', '**/*.yaml', '**/*.json', '**/*.xml', '**/*.properties',
  '**/*.html', '**/*.css', '**/*.scss', '**/*.proto'
];

const DEFAULT_EXCLUDED_DIRS = [
  '**/node_modules/**', '**/target/**', '**/build/**',
  '**/dist/**', '**/.git/**', '**/.sweet-search/**'
];

let INDEXABLE_EXTENSIONS = DEFAULT_INDEXABLE_EXTENSIONS;
let EXCLUDED_DIRS = DEFAULT_EXCLUDED_DIRS;

// Global indexing lock (prevents race with manual /index-codebase)
const GLOBAL_INDEX_LOCK = join(DATA_DIR, 'indexing.lock');

// State
let shutdownRequested = false;
let currentBatch = null;  // Track current batch for graceful shutdown
let startupTimeout = null;  // M8: Store reference for cancellation

// M4: Track files that need checking when lock was contended
const pendingFromSkippedCycle = new Set();

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

/**
 * Load include/exclude patterns from .sweet-search.config.json via shared config loader.
 * Falls back to built-in defaults if config cannot be loaded.
 */
async function loadIndexingPatterns() {
  try {
    const { loadProjectConfig } = await import('../../core/config.js');
    const projectConfig = loadProjectConfig(PROJECT_ROOT);

    if (Array.isArray(projectConfig.include) && projectConfig.include.length > 0) {
      INDEXABLE_EXTENSIONS = projectConfig.include;
    }
    if (Array.isArray(projectConfig.exclude) && projectConfig.exclude.length > 0) {
      EXCLUDED_DIRS = projectConfig.exclude;
    }

    log('INFO', `Loaded indexing config: include=${INDEXABLE_EXTENSIONS.length}, exclude=${EXCLUDED_DIRS.length}`);
  } catch (err) {
    log('WARN', `Failed to load .sweet-search.config.json (using defaults): ${err.message}`);
  }
}

await loadIndexingPatterns();

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
 * Read and parse lock file
 * S3 FIX: Now returns { pid, timestamp, startTime } to validate against PID reuse
 * Returns { pid, timestamp, startTime? } or null if invalid/missing
 */
function readLockFile() {
  try {
    if (!existsSync(LOCK_FILE)) return null;
    const content = readFileSync(LOCK_FILE, 'utf-8').trim();

    // Try JSON format first (new format with startTime)
    try {
      const parsed = JSON.parse(content);
      if (parsed.pid && parsed.timestamp) {
        return {
          pid: parsed.pid,
          timestamp: parsed.timestamp,
          startTime: parsed.startTime || null  // S3: Optional start time
        };
      }
    } catch {
      // Fall back to legacy newline format
      const [pidStr, timestampStr] = content.split('\n');
      const pid = parseInt(pidStr, 10);
      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(pid) || isNaN(timestamp)) return null;
      return { pid, timestamp, startTime: null };
    }
    return null;
  } catch {
    return null;
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

/**
 * Acquire lock - returns true if lock acquired, false if another instance owns it
 * C2 FIX: Uses atomic O_EXCL pattern to prevent TOCTOU race condition
 * S2 FIX: Sets explicit 0o600 permissions (owner read/write only)
 * S3 FIX: Includes process start time to prevent PID reuse attacks
 * P3 FIX: Made async with proper setTimeout sleep instead of busy-wait
 */
async function acquireLock() {
  const MAX_LOCK_RETRIES = 3;
  const RETRY_DELAY = 100; // ms

  for (let attempt = 0; attempt < MAX_LOCK_RETRIES; attempt++) {
    try {
      // S2 FIX: Atomic create with explicit 0o600 permissions (owner read/write only)
      const fd = openSync(LOCK_FILE, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      // S3 FIX: Include process start time for PID reuse detection
      const lockData = JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        startTime: getProcessStartTime()  // S3: Linux-specific start time
      });
      writeFileSync(fd, lockData);
      closeSync(fd);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock exists - check if stale
        const existing = readLockFile();
        if (existing) {
          // S3 FIX: Pass startTime to isPidRunning for PID reuse validation
          const isRunning = isPidRunning(existing.pid, existing.startTime);
          const isStale = (Date.now() - existing.timestamp) > LOCK_STALE_THRESHOLD;

          if (!isRunning || isStale) {
            // Try to remove stale lock
            log('INFO', `Taking over lock (pid=${existing.pid}, running=${isRunning}, stale=${isStale})`);
            try {
              unlinkSync(LOCK_FILE);
              // Don't recurse - continue loop for retry
              continue;
            } catch {
              // Another process removed it, retry
              continue;
            }
          }
        }
        // Lock held by active process
        if (attempt < MAX_LOCK_RETRIES - 1) {
          // P3 FIX: Use async sleep instead of busy-wait
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        return false;
      }
      throw err; // Unexpected error
    }
  }
  return false;
}

/**
 * Write lock file with current PID and timestamp
 * H3 FIX: Uses safeWriteFileSync for ENOSPC detection
 */
function writeLock() {
  safeWriteFileSync(LOCK_FILE, `${process.pid}\n${Date.now()}\n`);
}

/**
 * Release lock on shutdown
 */
function releaseLock() {
  try {
    const existing = readLockFile();
    if (existing && existing.pid === process.pid) {
      unlinkSync(LOCK_FILE);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Refresh lock timestamp periodically to prevent stale detection.
 * SECURITY: Verifies ownership before refresh to prevent lock theft.
 *
 * @returns {boolean} True if lock was refreshed, false if we lost ownership
 */
function refreshLock() {
  try {
    const existing = readLockFile();
    if (existing && existing.pid === process.pid) {
      writeLock();
      return true;
    } else {
      // Lost lock ownership - another process took over
      console.error('[index-maintainer] WARNING: Lost lock ownership, stopping refresh');
      return false;
    }
  } catch (err) {
    console.error(`[index-maintainer] refreshLock error: ${err.message}`);
    return false;
  }
}

// === Queue Management (Exported for testing) ===

/**
 * Ensure the .sweet-search directory exists
 */
export function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function isReconcilePaused(stateDir = DATA_DIR) {
  const pauseFile = join(stateDir, 'reconcile-pause.json');
  try {
    const payload = JSON.parse(readFileSync(pauseFile, 'utf-8'));
    return {
      paused: payload?.paused !== false,
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

/**
 * Full enablement status for the reconcile-v2 incremental indexer. Delegates
 * to the incremental-indexing domain policy (`reconcileEnablement`) so the
 * daemon and the operator `status` surface share one source of truth.
 *
 * Default-on: a missing/empty `SWEET_SEARCH_RECONCILE_V2` means enabled. Opt
 * out with `0` / `false` / `off`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{enabled:boolean, source:string, raw:string|null}}
 */
export function reconcileV2Status(env = process.env) {
  return reconcileEnablement(env);
}

export function reconcileV2Requested(env = process.env) {
  return reconcileEnablement(env).enabled;
}

export function assertReconcileV2NotSilentlyIgnored(env = process.env) {
  if (!reconcileV2Requested(env)) return;
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

function reconcileV2IntervalMs(env = process.env) {
  return resolveReconcileV2Interval({ env }).intervalMs;
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
// so a heartbeat write never clobbers progress fields and vice-versa; every
// persist is a full atomic snapshot via safeWriteFileSync (temp+rename).
let lockState = null;

/**
 * Re-validate ownership, mutate the in-memory lockState, persist. Refuses to
 * write if the lockfile no longer names us so a displaced daemon never
 * overwrites a successor's pid. Shared backend for writeStateLock + recordProgress.
 */
function persistLockState(lockFile, mutator) {
  if (!lockState) return;
  if (!stillOwnsLock(lockFile)) return;
  mutator(lockState);
  safeWriteFileSync(lockFile, JSON.stringify(lockState));
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
  for (let attempt = 0; attempt < 2; attempt++) {
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
      // Backwards-compat: a legacy lockfile without progressTimestamp falls
      // back to heartbeat-only mode. Combined with SIGTERM-before-steal this
      // still avoids orphans even for writers that don't know about progress.
      const progressAge = existing.progressTimestamp != null
        ? now - existing.progressTimestamp
        : heartbeatAge;
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
    if (existing?.pid === process.pid) unlinkSync(lockFile);
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
  return existing.pid === process.pid;
}

export async function runReconcileV2Tick(ctx) {
  // Baseline gate: the incremental reconciler must NEVER be the first index
  // builder for a non-empty repo (product contract). Until the normal full
  // indexing path has produced a complete baseline, stay dormant — skip BOTH
  // the dirty-scan producer (so we don't enqueue the whole tree) AND the
  // reconcile consumer (so we don't create partial codebase.db / code-graph.db
  // / HNSW / LI / sparse artifacts that make search think the repo is indexed).
  // No queue/artifact mutation here; the launcher still spawns the daemon, but
  // each tick is a no-op until `sweet-search index` lands a baseline.
  const baseline = hasCompleteBaseIndex(ctx.stateDir);
  if (!baseline.ready) {
    log('INFO', `${WAITING_FOR_INITIAL_INDEX}: no complete baseline yet (${baseline.reason}); run "sweet-search index" first — reconcile dormant`);
    return { skipped: true, reason: WAITING_FOR_INITIAL_INDEX, baseline: baseline.reason };
  }

  // Producer step: diff the working tree against merkle-state.json and enqueue
  // add/modify/delete hints, so ordinary edits are reconciled WITHOUT requiring
  // `sweet-search index --add` or an editor hook (release-gate finding C1). Runs
  // before the consume step below; best-effort so a scan failure never blocks
  // reconcile of already-queued work.
  try {
    const { dirtyScanEnabled, scanDirtyAndEnqueue } = await import('../incremental-indexing/application/dirty-scan.mjs');
    if (dirtyScanEnabled()) {
      const { createAdmissionPolicy } = await import('../indexing/admission-policy.js');
      const admissionPolicy = createAdmissionPolicy({ projectRoot: ctx.projectRoot });
      const scan = await scanDirtyAndEnqueue({ projectRoot: ctx.projectRoot, stateDir: ctx.stateDir, admissionPolicy });
      if (scan.enqueued > 0) {
        log('INFO', `Dirty scan enqueued ${scan.enqueued} file(s) (added=${scan.added}, modified=${scan.modified}, deleted=${scan.deleted}, retired=${scan.retired})`);
      }
    }
  } catch (err) {
    log('WARN', `Dirty scan failed (continuing with queued hints): ${err?.message ?? err}`);
  }

  const { runProductionReconcileTick } = await import('../incremental-indexing/application/production-reconciler.mjs');
  const counters = await runProductionReconcileTick({
    projectRoot: ctx.projectRoot,
    stateDir: ctx.stateDir,
    logger: {
      info: (msg) => log('INFO', msg),
      warn: (msg) => log('WARN', msg),
      error: (msg) => log('ERROR', msg),
    },
  });
  log('INFO', `Reconcile v2 tick complete: epoch=${counters.epoch}, processed=${counters.files_processed}, unchanged=${counters.content_unchanged}`);
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
    });
    if (summary.seen > 0) {
      log('INFO',
        `Maintenance drain: seen=${summary.seen}, succeeded=${summary.succeeded}, ` +
        `deferred=${summary.deferred}, retried=${summary.retried}, ` +
        `deadLettered=${summary.deadLettered}, remaining=${summary.remaining}`);
    }
    return summary;
  } catch (err) {
    log('WARN', `Maintenance drain failed (continuing reconcile): ${err?.message ?? err}`);
    return { skipped: true, reason: 'drain-error', error: err?.message ?? String(err) };
  }
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
  const intervalMs = resolved.intervalMs;
  log('INFO', `Reconcile v2 interval ${intervalMs}ms (source=${resolved.source}${resolved.tier ? `, tier=${resolved.tier}` : ''})`);
  // Lifecycle fix: only refresh the heartbeat if we still own the lock. If a
  // wedged-backstop takeover stole it, the lockfile now names another pid —
  // we must NOT clobber that successor with our pid. The main loop's
  // ownership check will end this maintainer at the next iteration.
  const refresh = setInterval(() => {
    if (stillOwnsLock(lock.lockFile)) writeStateLock(lock.lockFile);
  }, LOCK_REFRESH_INTERVAL);
  const shutdown = () => { shutdownRequested = true; };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('exit', () => releaseStateLock(lock.lockFile));

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
        shutdownRequested = true;
        break;
      }
      // Lifecycle fix v2: progress checkpoint at the top of each iteration.
      // Combined with the post-tick / post-drain checkpoints below this lets
      // acquireStateLock distinguish a busy-but-progressing daemon from one
      // hung on a never-resolving await — see the WEDGED_KILL_GRACE_MS block.
      recordProgress(lock.lockFile);
      const pause = isReconcilePaused(ctx.stateDir);
      if (pause.paused) {
        log('INFO', `Automatic reconcile v2 work paused${pause.pausedAt ? ` since ${pause.pausedAt}` : ''}`);
      } else {
        try {
          await runReconcileV2Tick(ctx);
          recordProgress(lock.lockFile);  // post-tick checkpoint
          await drainMaintenanceInline(ctx);
          recordProgress(lock.lockFile);  // post-drain checkpoint
        } catch (err) {
          log('ERROR', `Reconcile v2 tick failed: ${err?.message ?? err}`);
        }
      }
      await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs));
    }
  } finally {
    clearInterval(refresh);
    releaseStateLock(lock.lockFile);
    log('INFO', 'Reconcile v2 shutdown complete');
  }
}

/**
 * Normalize file path to project-relative format with cross-platform support.
 * Handles Windows paths (C:\Users\...), UNC paths (\\server\share), and converts
 * to forward slashes for consistent pattern matching and storage.
 *
 * @param {string} filePath - Raw file path (any platform format)
 * @param {string} projectRoot - Project root directory
 * @returns {string} - Normalized, project-relative path with forward slashes
 */
export function normalizePath(filePath, projectRoot = PROJECT_ROOT) {
  if (!filePath) return filePath;

  // First normalize separators (backslash -> forward slash, handle drive letters)
  const normalizedPath = normalizePathSeparators(filePath);
  const normalizedRoot = normalizePathSeparators(projectRoot);

  // Check if path is within project root (using normalized paths)
  if (normalizedPath.startsWith(normalizedRoot + '/')) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  // Also try Node's native handling for POSIX-style absolute paths
  if (isAbsolute(filePath) && filePath.startsWith(projectRoot)) {
    const rel = relative(projectRoot, filePath);
    // Normalize the result too (relative() may return backslashes on Windows)
    return normalizePathSeparators(rel);
  }

  // Return normalized path if outside project (or already relative)
  return normalizedPath;
}

/**
 * Parse and deduplicate queue entries from content string
 * Pure function for testability.
 * @param {string} content - Raw JSONL content
 * @param {string} projectRoot - Project root for path normalization
 * @returns {{ files: Map<string, object>, count: number, malformedCount: number }}
 */
export function parseQueueContent(content, projectRoot = PROJECT_ROOT) {
  const lines = content.split('\n').filter(l => l.trim());
  const files = new Map();
  let malformedCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (!entry.file_path) {
        malformedCount++;
        continue;
      }

      // Normalize to project-relative path
      const normalizedPath = normalizePath(entry.file_path, projectRoot);

      // Deduplicate: keep entry with highest retry count or most recent timestamp
      const existing = files.get(normalizedPath);
      if (!existing) {
        files.set(normalizedPath, { ...entry, file_path: normalizedPath });
      } else {
        // Merge: take max retry count and most recent timestamp
        files.set(normalizedPath, {
          file_path: normalizedPath,
          retry: Math.max(existing.retry || 0, entry.retry || 0),
          timestamp: Math.max(existing.timestamp || 0, entry.timestamp || 0),
          queued_at: entry.queued_at || existing.queued_at,
        });
      }
    } catch (err) {
      console.error(`[index-maintainer] Malformed queue line: ${line.substring(0, 100)}`);
      malformedCount++;
    }
  }

  return { files, count: files.size, malformedCount };
}

/**
 * Atomically acquire queue for processing using rename-before-read pattern.
 * This prevents race conditions where entries appended between read and rename are lost.
 *
 * CRITICAL: This is the ONLY safe way to process the queue.
 * Pattern: rename(queue -> processing) THEN read(processing)
 *
 * @param {string} queueFile - Path to queue file
 * @param {string} processingFile - Path to processing file
 * @returns {{ success: boolean, content: string | null, error?: string }}
 */
export function atomicAcquireQueue(queueFile = QUEUE_FILE, processingFile = PROCESSING_FILE) {
  // Step 1: Check if queue exists
  if (!existsSync(queueFile)) {
    return { success: false, content: null, error: 'queue_empty' };
  }

  // Step 2: Atomically rename queue -> processing FIRST
  // This prevents race: any new appends go to a fresh queue file
  try {
    renameSync(queueFile, processingFile);
  } catch (err) {
    // ENOENT: file was removed/renamed by another process
    if (err.code === 'ENOENT') {
      return { success: false, content: null, error: 'queue_empty' };
    }
    console.error(`[index-maintainer] Failed to rename queue to processing: ${err.message}`);
    return { success: false, content: null, error: err.message };
  }

  // Step 3: Now read the processing file (safe from race)
  // E8 FIX: Restore queue if read fails after rename
  try {
    const content = readFileSync(processingFile, 'utf-8');
    return { success: true, content };
  } catch (err) {
    // E8 FIX: Failed to read - try to restore queue file
    log('ERROR', `Failed to read processing file: ${err.message}`);
    try {
      renameSync(processingFile, queueFile);
      log('INFO', 'Restored queue file after read failure');
    } catch (restoreErr) {
      // If restore fails, log what we lost
      log('ERROR', `Queue read failed AND could not restore: ${restoreErr.message}`);
    }
    return { success: false, content: null, error: err.message };
  }
}

/**
 * @deprecated Use atomicCheckAndProcessQueue() instead for atomic operations.
 * D6 FIX: Added deprecation notice
 *
 * Legacy readQueue for backwards compatibility with main loop empty-check.
 * WARNING: Do NOT use this for processing - use atomicAcquireQueue instead.
 *
 * @returns {{ files: Map<string, object>, count: number }} Queue contents (read-only peek)
 */
function peekQueue() {
  if (!existsSync(QUEUE_FILE)) {
    return { files: new Map(), count: 0 };
  }

  try {
    const content = readFileSync(QUEUE_FILE, 'utf-8');
    const { files, count } = parseQueueContent(content);
    return { files, count };
  } catch (err) {
    console.error(`[index-maintainer] Failed to peek queue: ${err.message}`);
    return { files: new Map(), count: 0 };
  }
}

/**
 * Remove processing file after successful processing
 */
export function cleanupProcessingFile(processingFile = PROCESSING_FILE) {
  try {
    if (existsSync(processingFile)) {
      unlinkSync(processingFile);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Restore unprocessed entries to queue (on shutdown or partial failure)
 * H3 FIX: Uses safeAppendFileSync for ENOSPC detection
 */
export function requeueEntries(entries, queueFile = QUEUE_FILE) {
  if (!entries || entries.length === 0) return;

  ensureDataDir();

  for (const entry of entries) {
    try {
      safeAppendFileSync(queueFile, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error(`[index-maintainer] Failed to requeue: ${err.message}`);
      // H3 FIX: If disk is full, stop trying to requeue more entries
      if (err.message.includes('CRITICAL: Disk full')) {
        log('ERROR', 'Disk full - stopping requeue operations');
        break;
      }
    }
  }

  console.error(`[index-maintainer] Requeued ${entries.length} entries for later processing`);
}

/**
 * Add entry to dead letter queue
 * H3 FIX: Uses safeAppendFileSync for ENOSPC detection
 */
function writeToDeadletter(entry, error) {
  ensureDataDir();

  try {
    const deadletterEntry = {
      ...entry,
      error: error.message || String(error),
      dead_at: new Date().toISOString(),
      pid: process.pid,
    };
    safeAppendFileSync(DEADLETTER_FILE, JSON.stringify(deadletterEntry) + '\n');
    console.error(`[index-maintainer] Entry moved to deadletter: ${entry.file_path}`);
  } catch (writeErr) {
    console.error(`[index-maintainer] Failed to write to deadletter: ${writeErr.message}`);
  }
}

// === Indexing ===

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(retryCount) {
  const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * Spawn indexer process with given files.
 * Used by both queue processing and merkle-based indexing.
 * A3 FIX: DRY extraction of common indexer invocation logic (originally M6)
 *
 * @param {string[]} files - Files to index
 * @param {Object} options - { quiet?: boolean, timeout?: number, onProgress?: Function }
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, exitCode?: number, error?: string}>}
 */
async function spawnIndexer(files, options = {}) {
  const { quiet = true, timeout = INDEXING_TIMEOUT } = options;

  if (!existsSync(INDEXER_PATH)) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: 'Indexer not found at ' + INDEXER_PATH,
    };
  }

  const args = [INDEXER_PATH, '--files-from-stdin'];
  if (quiet) args.push('--quiet');

  return new Promise((resolve) => {
    const child = spawn('node', args, {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    if (files.length > 0) {
      child.stdin.write(files.join('\n'));
    }
    child.stdin.end();

    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGTERM');
        resolve({ success: false, stdout, stderr, error: 'Timeout' });
      }
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, stdout, stderr, exitCode: code });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, stdout, stderr, error: err.message });
    });
  });
}

/**
 * Run the indexer with specific files
 * Returns { success: boolean, failedFiles: string[], error?: string }
 */
async function runIndexer(filePaths, options = {}) {
  const { dryRun = false } = options;

  if (dryRun) {
    log('INFO', `DRY RUN: Would index ${filePaths.length} files:`);
    for (const fp of filePaths) {
      console.error(`  - ${fp}`);
    }
    return { success: true, failedFiles: [] };
  }

  log('INFO', `Starting incremental index for ${filePaths.length} files...`);
  const startTime = Date.now();

  // P7 FIX: Log small batch hint - spawn overhead may dominate for tiny batches
  if (filePaths.length <= 3) {
    log('DEBUG', `Small batch (${filePaths.length} files) - consider accumulating if frequent`);
  }

  // M6 FIX: Use shared spawnIndexer
  const result = await spawnIndexer(filePaths, { quiet: true });
  const duration = Date.now() - startTime;

  if (result.success) {
    log('INFO', `Indexing complete (${duration}ms, ${filePaths.length} files)`);
    return { success: true, failedFiles: [] };
  } else {
    log('ERROR', `Indexing failed (exit code ${result.exitCode}, ${duration}ms)`);
    if (result.stderr) {
      log('ERROR', `stderr: ${result.stderr.substring(0, 500)}`);
    }
    return {
      success: false,
      failedFiles: filePaths,
      error: result.error || `Exit code ${result.exitCode}: ${result.stderr?.substring(0, 200)}`,
    };
  }
}

// =============================================================================
// MERKLE CHECK AND INCREMENTAL INDEXING (v2)
// =============================================================================

// H1: Reduced from 10 min to 2 min for faster recovery after SIGKILL
const GLOBAL_LOCK_STALE_THRESHOLD = 120000; // 2 minutes

/**
 * Cleanup stale global lock on startup
 * H1 FIX: Check and remove stale locks before daemon starts
 */
function cleanupStaleGlobalLock() {
  try {
    if (existsSync(GLOBAL_INDEX_LOCK)) {
      const content = readFileSync(GLOBAL_INDEX_LOCK, 'utf-8');
      const [pidStr, timestampStr] = content.split('\n');
      const pid = parseInt(pidStr, 10);
      const age = Date.now() - parseInt(timestampStr, 10);

      // Check if process is dead OR lock is very old (2 min)
      let isDead = false;
      try { process.kill(pid, 0); } catch { isDead = true; }

      if (isDead || age > GLOBAL_LOCK_STALE_THRESHOLD) {
        log('INFO', `Removing stale global lock (age: ${age}ms, dead: ${isDead})`);
        unlinkSync(GLOBAL_INDEX_LOCK);
      }
    }
  } catch (err) {
    log('ERROR', `Error checking global lock: ${err.message}`);
  }
}

/**
 * Acquire global index lock (prevents race with manual /index-codebase)
 * C3 FIX: Uses loop pattern instead of recursive calls to prevent race
 * S2 FIX: Sets explicit 0o600 permissions (owner read/write only)
 * @returns {boolean} true if lock acquired
 */
function acquireGlobalIndexLock() {
  const MAX_GLOBAL_LOCK_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_GLOBAL_LOCK_RETRIES; attempt++) {
    try {
      // S2 FIX: Atomic create with O_EXCL and explicit 0o600 permissions
      const fd = openSync(GLOBAL_INDEX_LOCK, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      writeFileSync(fd, `${process.pid}\n${Date.now()}`);
      closeSync(fd);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Check if lock is stale
        try {
          const content = readFileSync(GLOBAL_INDEX_LOCK, 'utf-8');
          const [pidStr, timestampStr] = content.split('\n');
          const pid = parseInt(pidStr, 10);
          const timestamp = parseInt(timestampStr, 10);
          const age = Date.now() - timestamp;

          // H1: Stale after 2 minutes (was 10 min)
          const isStale = age > GLOBAL_LOCK_STALE_THRESHOLD;
          let isDead = false;
          try {
            process.kill(pid, 0);
          } catch {
            isDead = true;
          }

          if (isStale || isDead) {
            try {
              unlinkSync(GLOBAL_INDEX_LOCK);
              continue; // Retry in loop, not recursive
            } catch {
              continue; // Another process removed it
            }
          }
        } catch {
          // Can't read lock file, try to remove
          try { unlinkSync(GLOBAL_INDEX_LOCK); } catch {}
          continue;
        }
        return false; // Lock held by active process
      }
      return false; // Other error
    }
  }
  return false;
}

/**
 * Release global index lock with ownership verification.
 * SECURITY: Only releases if we own the lock (matching PID).
 */
function releaseGlobalIndexLock() {
  try {
    const content = readFileSync(GLOBAL_INDEX_LOCK, 'utf-8');
    const [pidStr] = content.trim().split('\n');
    const lockPid = parseInt(pidStr, 10);

    if (lockPid === process.pid) {
      unlinkSync(GLOBAL_INDEX_LOCK);
    } else {
      console.error(`[index-maintainer] Not releasing global lock - owned by PID ${lockPid}, we are ${process.pid}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[index-maintainer] Error releasing global lock: ${err.message}`);
    }
  }
}

/**
 * Perform merkle-state check for ALL file changes (internal + external).
 * Uses mtime/size/inode fast-path for efficiency (~0.1ms per unchanged file).
 *
 * @returns {Promise<{checked: boolean, toIndex: string[], toRemove: string[], stats: Object}>}
 */
async function performMerkleCheck() {
  const startTime = Date.now();
  console.error('[index-maintainer] Running merkle check for file changes...');

  try {
    // Dynamically import incremental tracker
    const { getChangedFiles, updateState } = await import('./incremental-tracker.js');

    // H3 FIX: Use dynamic loader with fallback paths
    const fg = await loadFastGlob();
    const allFiles = await fg(INDEXABLE_EXTENSIONS, {
      cwd: PROJECT_ROOT,
      ignore: EXCLUDED_DIRS,
      onlyFiles: true,
      absolute: false,
    });

    if (allFiles.length === 0) {
      return { checked: true, toIndex: [], toRemove: [], stats: { totalFiles: 0 } };
    }

    // Use incremental tracker to detect changes (mtime/size/inode fast-path)
    const { toIndex, toRemove, currentHashes, fastPathStats } = await getChangedFiles(allFiles, PROJECT_ROOT);

    const duration = Date.now() - startTime;
    const fastPathRatio = allFiles.length > 0 ? ((fastPathStats.hits / allFiles.length) * 100).toFixed(1) : 0;

    console.error(
      `[index-maintainer] Merkle check: ${allFiles.length} files, ` +
      `${fastPathStats.hits} fast-path hits (${fastPathRatio}%), ` +
      `${toIndex.length} changed, ${toRemove.length} removed, ${duration}ms`
    );

    return {
      checked: true,
      toIndex,
      toRemove,
      currentHashes,
      updateState,  // Pass through for state update after indexing
      stats: {
        totalFiles: allFiles.length,
        fastPathHits: fastPathStats.hits,
        fastPathMisses: fastPathStats.misses,
        contentReads: fastPathStats.contentReads,
        duration,
      },
    };
  } catch (err) {
    console.error(`[index-maintainer] Merkle check failed: ${err.message}`);
    return { checked: false, toIndex: [], toRemove: [], stats: { error: err.message } };
  }
}

/**
 * Run full incremental indexing for changed files.
 * Updates: FTS5, HNSW, Binary HNSW, Code Graph (full rebuild), HCGS
 *
 * NOTE: Code graph uses FULL rebuild (safe for cross-file relationships, FREE - no API, ~10s)
 * Vectors/HCGS use incremental update (changed files only)
 *
 * M6 FIX: Uses shared spawnIndexer() function
 * M2 FIX: Logs HCGS regeneration stats
 *
 * @param {string[]} toIndex - Files to index (new or changed)
 * @param {Object} currentHashes - Current file hashes for state update
 * @param {Function} updateStateFn - Function to update merkle state
 * @returns {Promise<{success: boolean, stats: Object}>}
 */
async function runFullIncrementalIndex(toIndex, currentHashes, updateStateFn) {
  const startTime = Date.now();

  if (toIndex.length === 0) {
    return { success: true, stats: { filesProcessed: 0, duration: 0 } };
  }

  log('INFO', `Running full incremental index for ${toIndex.length} files...`);

  try {
    // M6 FIX: Use shared spawnIndexer function
    const result = await spawnIndexer(toIndex, { quiet: true });

    const duration = Date.now() - startTime;

    if (result.success) {
      // Update merkle state
      if (updateStateFn && currentHashes) {
        await updateStateFn(currentHashes, { totalChunks: toIndex.length });
      }

      // M2 FIX: Parse stdout for HCGS stats and include in log
      const hcgsMatch = result.stdout.match(/HCGS: (\d+) summaries/);
      const hcgsCount = hcgsMatch ? parseInt(hcgsMatch[1], 10) : 0;

      log('INFO',
        `Indexed ${toIndex.length} files: FTS5 updated, HNSW vectors updated, ` +
        `Code graph rebuilt, HCGS: ${hcgsCount} summaries regenerated (${duration}ms)`
      );

      return {
        success: true,
        stats: {
          filesIndexed: toIndex.length,
          hcgsSummaries: hcgsCount,
          duration,
        },
      };
    } else {
      log('ERROR', `Full incremental index failed: ${result.error || result.stderr}`);
      return {
        success: false,
        stats: { error: result.error || result.stderr, duration },
      };
    }
  } catch (err) {
    log('ERROR', `Full incremental index error: ${err.message}`);
    return { success: false, stats: { error: err.message } };
  }
}

/**
 * Mark files as stale (soft delete - don't remove from DB).
 * Branch switches will restore them without HCGS regeneration.
 *
 * NOTE: Requires stale_since column in code-graph.db entities table.
 * The column should be added to createGraphSchema() in graph-extractor.js.
 */
async function markFilesAsStale(files) {
  if (files.length === 0) return;

  console.error(`[index-maintainer] Marking ${files.length} files as stale (soft delete)`);

  try {
    const { DB_PATHS } = await import('../../core/config.js');
    // H3 FIX: Use dynamic loader with fallback paths
    const Database = await loadBetterSqlite3();

    if (!existsSync(DB_PATHS.codeGraph)) {
      log('WARN', 'Code graph not found, skipping stale marking');
      return;
    }

    const db = new Database(DB_PATHS.codeGraph);
    const now = Math.floor(Date.now() / 1000);

    // Check if stale_since column exists
    const columns = db.prepare("PRAGMA table_info(entities)").all();
    const hasStaleColumn = columns.some(col => col.name === 'stale_since');

    if (!hasStaleColumn) {
      log('WARN', 'stale_since column not found, skipping soft delete');
      db.close();
      return;
    }

    const updateStmt = db.prepare('UPDATE entities SET stale_since = ? WHERE file_path = ?');
    const updateMany = db.transaction(() => {
      for (const file of files) {
        updateStmt.run(now, file);
      }
    });

    updateMany();
    db.close();

    log('INFO', `Marked ${files.length} files as stale`);
  } catch (err) {
    log('ERROR', `Failed to mark files as stale: ${err.message}`);
  }
}

/**
 * Prune entries that have been stale for more than N days.
 */
async function pruneStaleEntries(maxAgeDays = 30) {
  try {
    const { DB_PATHS } = await import('../../core/config.js');
    // H3 FIX: Use dynamic loader with fallback paths
    const Database = await loadBetterSqlite3();

    if (!existsSync(DB_PATHS.codeGraph)) {
      return;
    }

    const db = new Database(DB_PATHS.codeGraph);

    // Check if stale_since column exists
    const columns = db.prepare("PRAGMA table_info(entities)").all();
    const hasStaleColumn = columns.some(col => col.name === 'stale_since');

    if (!hasStaleColumn) {
      db.close();
      return;
    }

    const cutoff = Math.floor(Date.now() / 1000) - (maxAgeDays * 24 * 60 * 60);

    // Count before pruning
    const countResult = db.prepare(
      'SELECT COUNT(*) as count FROM entities WHERE stale_since IS NOT NULL AND stale_since < ?'
    ).get(cutoff);

    if (countResult.count > 0) {
      db.prepare('DELETE FROM entities WHERE stale_since IS NOT NULL AND stale_since < ?').run(cutoff);
      log('INFO', `Pruned ${countResult.count} stale entries (> ${maxAgeDays} days)`);
    }

    db.close();
  } catch (err) {
    // Non-fatal: pruning failure shouldn't break indexing
    log('ERROR', `Pruning failed: ${err.message}`);
  }
}


/**
 * Run merkle check and full incremental index if changes detected.
 * Acquires global index lock to prevent race with manual /index-codebase.
 * M4 FIX: Tracks skipped cycles to ensure files are not missed when lock contended.
 */
async function runMerkleCheckAndIndex() {
  // Acquire global lock (prevents race with manual /index-codebase)
  if (!acquireGlobalIndexLock()) {
    // M4 FIX: Queue for next cycle instead of silently skipping
    log('WARN', 'Lock held, queueing merkle check for next cycle');
    pendingFromSkippedCycle.add('merkle-check-pending');
    return;
  }

  try {
    // M4 FIX: Force full check if we skipped last time
    const forceFullCheck = pendingFromSkippedCycle.has('merkle-check-pending');
    if (forceFullCheck) {
      pendingFromSkippedCycle.delete('merkle-check-pending');
      log('INFO', 'Running deferred merkle check from skipped cycle');
    }

    const merkleResult = await performMerkleCheck();

    if (merkleResult.checked && (merkleResult.toIndex.length > 0 || merkleResult.toRemove.length > 0)) {
      // PHASE 1: Cleanup pass (soft delete stale files)
      if (merkleResult.toRemove.length > 0) {
        await markFilesAsStale(merkleResult.toRemove);
      }
      await pruneStaleEntries(30); // Prune entries stale > 30 days

      // PHASE 2: Index changed files
      const indexResult = await runFullIncrementalIndex(
        merkleResult.toIndex,
        merkleResult.currentHashes,
        merkleResult.updateState
      );

    }
  } finally {
    releaseGlobalIndexLock();
  }
}

// =============================================================================
// LEGACY QUEUE PROCESSING (for Claude edits via event-queue-drainer)
// =============================================================================

/**
 * Process the queue and run indexing
 * Uses atomic rename-before-read pattern to prevent race conditions.
 */
async function processQueue(options = {}) {
  const { dryRun = false } = options;

  // CRITICAL: Atomic acquire - rename THEN read (prevents race condition)
  const acquired = atomicAcquireQueue();

  if (!acquired.success) {
    // Queue empty or already being processed
    return { processed: 0, failed: 0, requeued: 0 };
  }

  // Parse and deduplicate the acquired content
  const { files, count, malformedCount } = parseQueueContent(acquired.content);

  if (malformedCount > 0) {
    console.error(`[index-maintainer] Skipped ${malformedCount} malformed queue entries`);
  }

  if (count === 0) {
    // All entries were malformed, clean up
    cleanupProcessingFile();
    return { processed: 0, failed: 0, requeued: 0 };
  }

  console.error(`[index-maintainer] Processing ${count} queued files...`);

  // Separate files by retry status
  const toProcess = [];
  const toRequeue = [];
  const toDead = [];

  for (const [filePath, entry] of files) {
    if (shutdownRequested) {
      toRequeue.push(entry);
      continue;
    }

    const retryCount = entry.retry || 0;

    if (retryCount >= MAX_RETRIES) {
      // Max retries exceeded - move to dead letter
      toDead.push(entry);
    } else {
      toProcess.push(entry);
    }
  }

  // Move exceeded retries to dead letter
  for (const entry of toDead) {
    writeToDeadletter(entry, new Error(`Max retries (${MAX_RETRIES}) exceeded`));
  }

  // Track current batch for graceful shutdown
  currentBatch = toProcess;

  if (toProcess.length === 0) {
    cleanupProcessingFile();
    return { processed: 0, failed: toDead.length, requeued: toRequeue.length };
  }

  // Extract file paths for indexing
  const filePaths = toProcess.map(e => e.file_path);

  // Run indexer
  const result = await runIndexer(filePaths, { dryRun });

  currentBatch = null;

  if (result.success) {
    // All files processed successfully
    cleanupProcessingFile();

    // Handle any files that need requeuing (from shutdown)
    if (toRequeue.length > 0) {
      requeueEntries(toRequeue);
    }

    return {
      processed: filePaths.length,
      failed: toDead.length,
      requeued: toRequeue.length
    };
  } else {
    // Indexing failed - requeue with incremented retry count and backoff
    const failedEntries = toProcess.map(entry => ({
      ...entry,
      retry: (entry.retry || 0) + 1,
      last_error: result.error?.substring(0, 200),
      last_attempt: new Date().toISOString(),
    }));

    // Calculate backoff delay for logging
    const nextRetry = failedEntries[0]?.retry || 1;
    const delay = getRetryDelay(nextRetry - 1);

    console.error(`[index-maintainer] Requeuing ${failedEntries.length} files for retry #${nextRetry} (next attempt in ${delay}ms)`);

    // Clean up processing file first
    cleanupProcessingFile();

    // Requeue failed entries
    requeueEntries([...failedEntries, ...toRequeue]);

    return {
      processed: 0,
      failed: toDead.length,
      requeued: failedEntries.length + toRequeue.length
    };
  }
}

/**
 * Atomic check and process queue - combines peek and process in one atomic operation
 * H5 FIX: Prevents race where entries are added between peek and process
 * @param {Object} options - { dryRun: boolean }
 * @returns {Promise<{ processed: number, failed: number, requeued: number, empty: boolean }>}
 */
async function atomicCheckAndProcessQueue(options = {}) {
  const { dryRun = false } = options;

  // Atomic acquire returns entries or null if empty
  const acquired = atomicAcquireQueue();

  if (!acquired.success) {
    // Queue empty or already being processed
    return { processed: 0, failed: 0, requeued: 0, empty: true };
  }

  // Parse and deduplicate the acquired content
  const { files, count, malformedCount } = parseQueueContent(acquired.content);

  if (malformedCount > 0) {
    log('WARN', `Skipped ${malformedCount} malformed queue entries`);
  }

  if (count === 0) {
    // All entries were malformed, clean up
    cleanupProcessingFile();
    return { processed: 0, failed: 0, requeued: 0, empty: true };
  }

  log('INFO', `Processing ${count} queued files...`);

  // Separate files by retry status
  const toProcess = [];
  const toRequeue = [];
  const toDead = [];

  for (const [filePath, entry] of files) {
    if (shutdownRequested) {
      toRequeue.push(entry);
      continue;
    }

    const retryCount = entry.retry || 0;

    if (retryCount >= MAX_RETRIES) {
      // Max retries exceeded - move to dead letter
      toDead.push(entry);
    } else {
      toProcess.push(entry);
    }
  }

  // Move exceeded retries to dead letter
  for (const entry of toDead) {
    writeToDeadletter(entry, new Error(`Max retries (${MAX_RETRIES}) exceeded`));
  }

  // Track current batch for graceful shutdown
  currentBatch = toProcess;

  if (toProcess.length === 0) {
    cleanupProcessingFile();
    return { processed: 0, failed: toDead.length, requeued: toRequeue.length, empty: false };
  }

  // Extract file paths for indexing
  const filePaths = toProcess.map(e => e.file_path);

  // Run indexer
  const result = await runIndexer(filePaths, { dryRun });

  currentBatch = null;

  if (result.success) {
    // All files processed successfully
    cleanupProcessingFile();

    // Handle any files that need requeuing (from shutdown)
    if (toRequeue.length > 0) {
      requeueEntries(toRequeue);
    }

    return {
      processed: filePaths.length,
      failed: toDead.length,
      requeued: toRequeue.length,
      empty: false
    };
  } else {
    // Indexing failed - requeue with incremented retry count and backoff
    const failedEntries = toProcess.map(entry => ({
      ...entry,
      retry: (entry.retry || 0) + 1,
      last_error: result.error?.substring(0, 200),
      last_attempt: new Date().toISOString(),
    }));

    // Calculate backoff delay for logging
    const nextRetry = failedEntries[0]?.retry || 1;
    const delay = getRetryDelay(nextRetry - 1);

    log('WARN', `Requeuing ${failedEntries.length} files for retry #${nextRetry} (next attempt in ${delay}ms)`);

    // Clean up processing file first
    cleanupProcessingFile();

    // Requeue failed entries
    requeueEntries([...failedEntries, ...toRequeue]);

    return {
      processed: 0,
      failed: toDead.length,
      requeued: failedEntries.length + toRequeue.length,
      empty: false
    };
  }
}

/**
 * Recover from a previous crash (processing file left behind)
 * E5 FIX: Differentiate recovery success from failure with structured return
 * @returns {{ recovered: boolean, count?: number, reason: string }}
 */
async function recoverProcessingFile() {
  if (!existsSync(PROCESSING_FILE)) {
    return { recovered: false, reason: 'no_processing_file' };
  }

  log('INFO', 'Found .processing file from previous crash, recovering...');

  try {
    const content = readFileSync(PROCESSING_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const entries = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.file_path) {
          entries.push(entry);
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      // Clean up empty/invalid processing file
      try { unlinkSync(PROCESSING_FILE); } catch {}
      return { recovered: false, reason: 'empty_processing_file' };
    }

    // Requeue recovered entries (they may have been partially processed)
    requeueEntries(entries);

    // Clean up processing file
    unlinkSync(PROCESSING_FILE);

    log('INFO', `Recovery complete: ${entries.length} entries requeued`);
    return { recovered: true, count: entries.length, reason: 'success' };
  } catch (err) {
    log('ERROR', `Recovery failed: ${err.message}`);
    // Try to clean up the corrupt processing file
    try { unlinkSync(PROCESSING_FILE); } catch {}
    return { recovered: false, reason: err.message };
  }
}

// === Main Loop ===

async function main() {
  const runOnce = process.argv.includes('--once');
  const dryRun = process.argv.includes('--dry-run');
  const merkleOnce = process.argv.includes('--merkle-once');

  // L1 FIX: Updated version to v3
  log('INFO', 'Starting index maintainer daemon v3...');
  const v2 = reconcileV2Status();
  if (v2.enabled) {
    if (v2.source === 'env-enabled') {
      log('INFO', 'SWEET_SEARCH_RECONCILE_V2 enabled; using production Reconciler adapters');
    } else if (v2.source === 'env-enabled-permissive') {
      log('WARN', `SWEET_SEARCH_RECONCILE_V2="${v2.raw}" not recognized; treating as enabled (use 0/false/off to disable). Using production Reconciler adapters`);
    } else {
      log('INFO', 'Incremental reconcile v2 enabled by default (opt out with SWEET_SEARCH_RECONCILE_V2=0); using production Reconciler adapters');
    }
    await runReconcileV2Main({ runOnce, merkleOnce });
    return;
  }
  log('INFO', 'Incremental reconcile v2 disabled via SWEET_SEARCH_RECONCILE_V2; using legacy queue/merkle path');

  // Ensure .sweet-search directory exists
  ensureDataDir();

  // H1 FIX: Clean up potentially stale global lock on startup
  cleanupStaleGlobalLock();

  // Acquire lock (skip for --once mode)
  // P3 FIX: acquireLock is now async
  if (!runOnce && !merkleOnce) {
    if (!(await acquireLock())) {
      log('INFO', 'Another instance is running, exiting.');
      process.exit(0);  // Exit cleanly, not an error
    }
    log('INFO', `Lock acquired (PID: ${process.pid})`);
  }

  // Recover from previous crash
  // E5 FIX: Use structured return to differentiate success from failure
  const recovery = await recoverProcessingFile();
  if (recovery.recovered) {
    log('INFO', `Recovered ${recovery.count} entries from previous crash`);
  }

  // --merkle-once: Run a single merkle check and exit (for testing)
  if (merkleOnce) {
    log('INFO', 'Running single merkle check (--merkle-once)...');
    await runMerkleCheckAndIndex();
    log('INFO', 'Merkle check complete');
    process.exit(0);
  }

  if (runOnce) {
    const result = await processQueue({ dryRun });
    log('INFO', `Processed: ${result.processed}, Failed: ${result.failed}, Requeued: ${result.requeued} (--once mode)`);
    process.exit(0);
  }

  // Graceful shutdown handlers
  // M8 FIX: Clear startupTimeout on shutdown
  const shutdown = () => {
    log('INFO', 'Shutdown requested...');
    shutdownRequested = true;
    // M8 FIX: Cancel deferred startup timeout if pending
    if (startupTimeout) {
      clearTimeout(startupTimeout);
      startupTimeout = null;
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Clean up lock on exit
  process.on('exit', () => {
    releaseLock();
    log('INFO', 'Lock released, goodbye.');
  });

  let pauseLogged = false;
  const automaticWorkPaused = () => {
    const pause = isReconcilePaused();
    if (pause.paused) {
      if (!pauseLogged) {
        log('INFO', `Automatic reconcile work paused${pause.pausedAt ? ` since ${pause.pausedAt}` : ''}`);
        pauseLogged = true;
      }
      return true;
    }
    if (pauseLogged) {
      log('INFO', 'Automatic reconcile work resumed');
      pauseLogged = false;
    }
    return false;
  };

  // Refresh lock periodically to prevent stale detection
  const lockRefreshInterval = setInterval(() => {
    if (!shutdownRequested) {
      if (!refreshLock()) {
        // Lost lock ownership - initiate graceful shutdown
        console.error('[index-maintainer] Lost lock, initiating shutdown');
        process.exit(1);
      }
    }
  }, LOCK_REFRESH_INTERVAL);

  // === DEFERRED FIRST MERKLE CHECK (v3) ===
  // Wait STARTUP_DELAY before first merkle check to avoid blocking session startup
  // This ensures zero latency for Claude Code operations during warm-up
  // M8 FIX: Store timeout reference for cancellation on shutdown
  // E1 FIX: Wrap async callback in try-catch to prevent unhandled promise rejections
  startupTimeout = setTimeout(async () => {
    try {
      if (shutdownRequested) return;
      startupTimeout = null;  // Clear reference after execution
      if (automaticWorkPaused()) return;
      log('INFO', `Running deferred first merkle check (after ${STARTUP_DELAY}ms delay)...`);
      await runMerkleCheckAndIndex();
    } catch (err) {
      log('ERROR', `Deferred merkle check failed: ${err.message}`);
    }
  }, STARTUP_DELAY);

  // === PERIODIC MERKLE CHECK (v3) ===
  // Every MERKLE_CHECK_INTERVAL, scan filesystem for external changes (IDE edits, git operations)
  // This is separate from the queue-based processing of Claude Code edits
  // E1 FIX: Wrap async callback in try-catch to prevent unhandled promise rejections
  const merkleCheckInterval = setInterval(async () => {
    try {
      if (shutdownRequested) return;
      if (automaticWorkPaused()) return;
      log('INFO', 'Running periodic merkle check...');
      await runMerkleCheckAndIndex();
    } catch (err) {
      log('ERROR', `Periodic merkle check failed: ${err.message}`);
    }
  }, MERKLE_CHECK_INTERVAL);

  // Main loop: poll queue every POLL_INTERVAL (for Claude Code edits via hook)
  // H5 FIX: Use atomicCheckAndProcessQueue instead of separate peek+process
  let consecutiveEmptyPolls = 0;

  while (!shutdownRequested) {
    if (automaticWorkPaused()) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // H5 FIX: Atomic queue check and process (prevents race between peek and acquire)
    const result = await atomicCheckAndProcessQueue({ dryRun });

    if (result.empty) {
      consecutiveEmptyPolls++;

      // Log occasionally when idle
      if (consecutiveEmptyPolls === 1 || consecutiveEmptyPolls % 10 === 0) {
        log('DEBUG', `Queue empty, sleeping (poll #${consecutiveEmptyPolls})`);
      }
    } else {
      consecutiveEmptyPolls = 0;

      if (result.processed > 0 || result.failed > 0 || result.requeued > 0) {
        log('INFO', `Batch complete - Processed: ${result.processed}, Failed: ${result.failed}, Requeued: ${result.requeued}`);
      }
    }

    // Wait before next poll
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Graceful shutdown: preserve any in-flight batch
  if (currentBatch && currentBatch.length > 0) {
    log('WARN', `Preserving ${currentBatch.length} in-flight entries`);
    requeueEntries(currentBatch);
  }

  // Cleanup
  clearInterval(lockRefreshInterval);
  clearInterval(merkleCheckInterval);
  log('INFO', 'Shutdown complete');
}

// Only run main() when executed directly (not when imported for testing)
// This allows the exported functions to be tested without starting the daemon
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
                     process.argv[1]?.endsWith('index-maintainer.mjs');

if (isMainModule) {
  main().catch(err => {
    console.error(`[index-maintainer] Fatal error: ${err.message}`);
    releaseLock();
    process.exit(1);
  });
}
