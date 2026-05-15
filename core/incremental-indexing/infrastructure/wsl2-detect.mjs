/**
 * WSL2 detection + watcher default policy.
 *
 * Plan § 34.6 / § 37.3.3. The earlier blanket "WSL2 → polling-only" rule
 * over-penalised users on native Linux paths inside WSL2; an earlier
 * draft proposed parsing `df -T` or `/proc/mounts` to detect the actual
 * filesystem type, but the parser was brittle across Linux distros, WSL
 * versions, and mount-point naming.
 *
 * The pragmatic compromise:
 *   1. Detect WSL2 via `/proc/version` containing `microsoft` or `WSL`.
 *   2. If detected, recommend `SWEET_SEARCH_WATCH=0` **as default** (not
 *      forced).
 *   3. If the user explicitly set `SWEET_SEARCH_WATCH=1`, respect it.
 *   4. If the watcher fails at startup (inotify error on a 9p mount),
 *      fall back to polling with a clear remediation message rather
 *      than crashing.
 *
 * This module is read-only — it inspects the host environment and
 * returns a recommendation. The caller (Phase 4 file watcher setup)
 * acts on the recommendation.
 */

import fs from 'node:fs';

let cached = null;

function detectInner() {
  // Containers also typically have inotify problems with bind mounts.
  let kubernetes = false;
  let docker = false;
  try {
    if (process.env.KUBERNETES_SERVICE_HOST) kubernetes = true;
    if (fs.existsSync('/.dockerenv')) docker = true;
    if (!docker && fs.existsSync('/proc/1/cgroup')) {
      const c = fs.readFileSync('/proc/1/cgroup', 'utf-8');
      if (/docker|kubepods|containerd/i.test(c)) docker = true;
    }
  } catch {
    // ignore
  }

  let wsl2 = false;
  try {
    if (fs.existsSync('/proc/version')) {
      const v = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
      if (v.includes('microsoft') || v.includes('wsl')) wsl2 = true;
    }
  } catch {
    // ignore
  }

  return {
    wsl2,
    docker,
    kubernetes,
    container: docker || kubernetes,
    platform: process.platform,
  };
}

export function detectEnvironment() {
  if (cached === null) cached = detectInner();
  return cached;
}

/**
 * Decide the watcher's default-enabled state for this host.
 *
 *   - Explicit env var wins (`SWEET_SEARCH_WATCH=1` or `0`).
 *   - WSL2 → polling default with override available.
 *   - Container → polling default.
 *   - Windows native → polling default (Phase 4 ships node:fs.watch; the
 *     Rust notify binding via `ReadDirectoryChangesW` is Phase 6).
 *   - Otherwise → watcher enabled.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{watcherEnabled:boolean, reason:string}}
 */
export function watcherDefault(env = process.env) {
  const explicit = env.SWEET_SEARCH_WATCH;
  if (explicit === '1' || explicit === 'true' || explicit === 'on') {
    return { watcherEnabled: true, reason: 'env-override-on' };
  }
  if (explicit === '0' || explicit === 'false' || explicit === 'off') {
    return { watcherEnabled: false, reason: 'env-override-off' };
  }
  const detect = detectEnvironment();
  if (detect.wsl2) {
    return {
      watcherEnabled: false,
      reason: 'wsl2-polling-default (set SWEET_SEARCH_WATCH=1 if your project is on native ext4 e.g. /home/user/project)',
    };
  }
  if (detect.container) {
    return { watcherEnabled: false, reason: 'container-polling-default' };
  }
  if (detect.platform === 'win32') {
    return { watcherEnabled: false, reason: 'win32-polling-default (Phase 6 Rust notify binding pending)' };
  }
  return { watcherEnabled: true, reason: 'native-os-watcher' };
}

/**
 * Format the watcher startup message that goes to stderr. Plan § 34.6
 * step 2 specifies the user-facing copy.
 *
 * @param {{watcherEnabled:boolean, reason:string}} decision
 * @returns {string}
 */
export function formatWatcherNotice(decision) {
  return `[sweet-search] file watcher: ${decision.watcherEnabled ? 'on' : 'off'} (${decision.reason})`;
}

export const __testing = { detectInner, resetCache: () => { cached = null; } };
