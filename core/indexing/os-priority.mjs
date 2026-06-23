/**
 * Best-effort OS background-priority helper for the maintainer daemon child.
 *
 * Implements research-doc §4.A recommendations A.2 (macOS `taskpolicy -b`) and
 * A.3 (Linux `ionice -c3` + `chrt -b`): once the launcher has spawned the
 * detached maintainer, we ask the OS to treat that *child* as background work
 * (CPU + I/O throttle, E-core routing on Apple Silicon). This is purely a
 * scheduling hint — the indexed output is identical; only *when* the kernel
 * grants CPU/IO to the child changes.
 *
 * Design contract:
 *   - `applyBackgroundPriority(pid)` is **best-effort and NEVER throws**. Every
 *     spawn is wrapped so a missing binary (`taskpolicy`/`ionice`/`chrt`), an
 *     EPERM, or any other error is swallowed silently — demotion is an
 *     optimization, not a correctness requirement.
 *   - It runs in the *foreground caller's* process (the launcher), targeting
 *     the child by pid, so the caller's own priority is never affected.
 *   - Unknown platforms are a no-op.
 *
 * The optional native N-API addon (research §4.A A.5/A.6: Windows
 * `PROCESS_MODE_BACKGROUND_BEGIN`, macOS per-thread `QOS_CLASS_BACKGROUND`)
 * slots in via `loadNativePriorityAddon()`. It is published as a per-platform
 * `optionalDependency` (`@sweet-search/bg-priority`), so a failed native build
 * does NOT break `npm install` and the loader simply returns `null` — every
 * code path then falls back to the spawn-based helper below.
 *
 * IMPORTANT semantic difference between the two levers:
 *   - `applyBackgroundPriority(pid)` demotes an *arbitrary child* pid and is
 *     therefore spawn-based only (`taskpolicy`/`ionice`/`chrt` accept a pid).
 *     The native addon CANNOT do this — Windows `SetPriorityClass` /
 *     macOS `pthread_set_qos_class_self_np` only affect the *calling*
 *     process/thread. So `applyBackgroundPriority` is left unchanged.
 *   - `setNativeBackgroundMode(enable)` is the *self*-demotion path: the
 *     maintainer daemon calls it on ITSELF, gated on
 *     `SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY==='1'` AND the addon being
 *     present. When the addon is absent (default), it returns `false` and the
 *     caller keeps its `os.setPriority(PRIORITY_LOW)` / spawn fallback.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Spawn a helper that demotes `pid`, swallowing every failure mode.
 * Detached + unref'd + stdio:'ignore' so it never holds the caller open and
 * never writes to the caller's stdio. A throw from `spawn` itself (e.g. an
 * exotic platform restriction) is caught; an async spawn `error` (e.g. ENOENT
 * for a missing binary) is caught via the `error` listener.
 *
 * @param {string} command
 * @param {string[]} args
 */
function spawnBestEffort(command, args) {
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    // A missing binary surfaces asynchronously as an 'error' event, which would
    // otherwise become an unhandled exception that crashes the process. Swallow.
    child.on('error', () => {});
    child.unref();
  } catch {
    /* never throw — best-effort only */
  }
}

/**
 * Demote the given child process to OS background priority. Best-effort,
 * platform-dispatched, NEVER throws.
 *
 * @param {number} pid The pid of the *spawned child* to demote.
 */
export function applyBackgroundPriority(pid) {
  try {
    if (!Number.isFinite(pid) || pid <= 0) return;
    const pidStr = String(pid);
    switch (process.platform) {
      case 'darwin':
        // taskpolicy -b -p PID → background band: CPU + IOPOL_THROTTLE + E-cores.
        spawnBestEffort('taskpolicy', ['-b', '-p', pidStr]);
        break;
      case 'linux':
        // ionice -c 3 → idle I/O class; chrt -b -p 0 → SCHED_BATCH (no root).
        spawnBestEffort('ionice', ['-c', '3', '-p', pidStr]);
        spawnBestEffort('chrt', ['-b', '-p', '0', pidStr]);
        break;
      default:
        // Windows + others: no spawn-based lever; the native addon (A.5/A.6)
        // covers Windows PROCESS_MODE_BACKGROUND_BEGIN in a later wave.
        break;
    }
  } catch {
    /* never throw — best-effort only */
  }
}

// Memoized addon handle. `undefined` = not yet attempted; `null` = attempted
// and unavailable; otherwise the loaded module. Cached so repeated calls don't
// re-pay the require cost (or re-log a failure).
let _nativeAddon;

/**
 * Best-effort loader for the optional native background-priority N-API addon
 * (`@sweet-search/bg-priority`, research §4.A A.5/A.6). Returns the addon
 * module when the optionalDependency is installed and loads cleanly, else
 * `null`. NEVER throws — a missing/failed native build is expected and the
 * caller falls back to the spawn / `os.setPriority` levers.
 *
 * The module exposes `setBackgroundMode(enable: boolean): boolean` which demotes
 * (or restores) the *calling* process/thread; it returns `true` when a native
 * demotion was applied on this platform.
 *
 * @returns {null|{ setBackgroundMode: (enable: boolean) => boolean }} addon or null.
 */
export function loadNativePriorityAddon() {
  if (_nativeAddon !== undefined) return _nativeAddon;
  try {
    // Use createRequire so this ESM module can load the CJS napi addon. The
    // optionalDependency package name resolves to the per-platform prebuilt
    // binary via the addon's own index.js loader.
    const require = createRequire(import.meta.url);
    const mod = require('@sweet-search/bg-priority');
    _nativeAddon =
      mod && typeof mod.setBackgroundMode === 'function' ? mod : null;
  } catch {
    // optionalDependency absent or failed to build → fall back. Expected.
    _nativeAddon = null;
  }
  return _nativeAddon;
}

/**
 * Self-demotion via the native addon: put the *current* process/thread into
 * (`enable=true`) or out of (`enable=false`) OS background mode
 * (Windows `PROCESS_MODE_BACKGROUND_BEGIN/END`, macOS per-thread
 * `QOS_CLASS_BACKGROUND`/restore). The maintainer daemon calls this on ITSELF.
 *
 * Gated on `SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY==='1'` AND the addon being
 * loaded. When either is false this is a no-op returning `false`, so the caller
 * keeps its existing `os.setPriority(PRIORITY_LOW)` / spawn-based fallback
 * (default behavior, unchanged). Best-effort, NEVER throws.
 *
 * Caveats (documented in the addon): on Windows, BACKGROUND_BEGIN empties the
 * working set — only enable during bulk/idle phases and call `false` before
 * serving latency-sensitive work. On macOS, QoS is per-thread and covers only
 * threads that call it (ORT spins its own threads); NEVER mix raw
 * `setpriority`/`taskpolicy` with QoS on the same thread.
 *
 * @param {boolean} enable true → enter background mode; false → restore.
 * @returns {boolean} true if a native demotion/restoration was applied.
 */
export function setNativeBackgroundMode(enable) {
  try {
    if (process.env.SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY !== '1') return false;
    const addon = loadNativePriorityAddon();
    if (!addon) return false;
    return addon.setBackgroundMode(Boolean(enable)) === true;
  } catch {
    /* never throw — best-effort only */
    return false;
  }
}
