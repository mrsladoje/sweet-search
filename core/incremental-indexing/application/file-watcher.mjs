/**
 * File-watcher abstraction.
 *
 * Plan § 9.1-9.5. Two sources push paths into the dirty set:
 *   1. Watcher (Rust notify via FSEvents/inotify/ReadDirectoryChangesW).
 *   2. Polling backstop: walk the tracked roots and compare
 *      `(mtime, size, inode)` tuples against `merkle-state.json`.
 *
 * Phase 4 ships the JS side with `node:fs.watch` as the baseline watcher
 * (sufficient for unit tests + cross-platform parity). Phase 6 plugs in
 * the Rust binding via `crates/sweet-search-native`. The interface stays
 * stable: a constructor receives the `DirtySet`, `path-filter`, and
 * project root; `start()` and `stop()` are async lifecycle calls.
 *
 * ENOSPC handling: if `inotify_add_watch` fails with ENOSPC (Linux
 * default 524 288 watches exhausted), the watcher emits a single WARN,
 * marks the subtree as "polling-only", and never crashes. The polling
 * backstop is the correctness mechanism even when the watcher dies.
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DEBOUNCE_MS = 200;

export class FileWatcher {
  /**
   * @param {object} options
   * @param {string} options.projectRoot
   * @param {import('../infrastructure/dirty-set.mjs').DirtySet} options.dirtySet
   * @param {(rel:string)=>boolean} [options.isExcluded]
   * @param {number} [options.debounceMs]
   * @param {{warn:Function, error:Function, info:Function}} [options.logger]
   */
  constructor({ projectRoot, dirtySet, isExcluded, debounceMs = DEFAULT_DEBOUNCE_MS, logger = console }) {
    if (!projectRoot) throw new Error('FileWatcher: projectRoot is required');
    if (!dirtySet) throw new Error('FileWatcher: dirtySet is required');
    this.projectRoot = projectRoot;
    this.dirtySet = dirtySet;
    this.isExcluded = isExcluded || (() => false);
    this.debounceMs = debounceMs;
    this.logger = logger;
    this._watchers = new Set();
    this._pending = new Map(); // path → timer
    this._enospcSeen = false;
    this._stopped = false;
  }

  /**
   * Start watching the project root. Returns immediately; errors are
   * surfaced via the logger and never thrown after the initial call.
   */
  async start() {
    this._stopped = false;
    try {
      const w = fs.watch(this.projectRoot, { recursive: true, persistent: false });
      w.on('change', (eventType, filename) => {
        if (!filename || this._stopped) return;
        this._handleEvent(filename);
      });
      w.on('error', (err) => {
        if (err && err.code === 'ENOSPC') this._handleEnospc(err);
        else this.logger.warn?.(`[file-watcher] error: ${err.message}`);
      });
      this._watchers.add(w);
    } catch (err) {
      if (err && err.code === 'ENOSPC') this._handleEnospc(err);
      else if (err && err.code === 'ENOENT') {
        this.logger.warn?.(`[file-watcher] projectRoot missing: ${this.projectRoot}`);
      } else {
        this.logger.warn?.(`[file-watcher] start failed: ${err?.message ?? err}`);
      }
    }
  }

  async stop() {
    this._stopped = true;
    for (const w of this._watchers) {
      try { w.close(); } catch {}
    }
    this._watchers.clear();
    for (const [, timer] of this._pending) clearTimeout(timer);
    this._pending.clear();
  }

  _handleEnospc(err) {
    if (this._enospcSeen) return;
    this._enospcSeen = true;
    this.logger.warn?.(
      '[file-watcher] inotify watch limit exhausted (ENOSPC). Falling back to polling. ' +
      'Remediation: `sudo sysctl fs.inotify.max_user_watches=524288` or higher. ' +
      `Detail: ${err.message}`,
    );
  }

  _handleEvent(filename) {
    const norm = filename.replace(/\\/g, '/');
    if (this.isExcluded(norm)) return;
    const abs = path.resolve(this.projectRoot, filename);

    // Debounce: editor "atomic save" patterns emit CREATE/WRITE/RENAME
    // bursts. Coalesce within `debounceMs` then push once.
    const existing = this._pending.get(abs);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this._pending.delete(abs);
      if (this._stopped) return;
      // Suppress temp/swp paths created by editor atomic-save flows.
      if (this._isTempFile(norm)) return;
      this.dirtySet.add(abs, 'watcher', { eventTime: Date.now() });
    }, this.debounceMs);
    this._pending.set(abs, timer);
  }

  _isTempFile(relPath) {
    const base = path.basename(relPath);
    if (/\.swp$/.test(base)) return true;
    if (/\.tmp$/.test(base)) return true;
    if (/^\.#/.test(base)) return true; // emacs lockfiles
    if (/^~/.test(base)) return true;
    if (/~$/.test(base)) return true;   // gedit backup
    return false;
  }

  /**
   * Diagnostic: how many native watchers are active and whether the
   * ENOSPC fallback has fired.
   */
  status() {
    return {
      watchers: this._watchers.size,
      pending: this._pending.size,
      enospcFallback: this._enospcSeen,
      stopped: this._stopped,
    };
  }
}

/**
 * Polling backstop. Plan § 9.1: every reconcile-interval seconds, walk
 * the tracked roots and re-discover any dirty file the watcher missed.
 *
 * The backstop is a function, not a class — it's stateless and the
 * caller (Reconciler) schedules it on the same timer as the tick.
 *
 * @param {string} projectRoot
 * @param {(rel:string)=>boolean} isExcluded
 * @param {import('../infrastructure/dirty-set.mjs').DirtySet} dirtySet
 * @returns {Promise<{filesSeen:number, filesEnqueued:number}>}
 */
export async function pollingBackstopSweep(projectRoot, isExcluded, dirtySet) {
  let filesSeen = 0;
  let filesEnqueued = 0;
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (isExcluded(childRel)) continue;
      const childAbs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      filesSeen += 1;
      // The reconcile tick decides via `metadataMatches` whether the file
      // is truly dirty; here we just enqueue the candidate. The watcher
      // path already filtered; the polling path catches anything the
      // watcher missed.
      if (!dirtySet.has(childAbs)) {
        dirtySet.add(childAbs, 'polling');
        filesEnqueued += 1;
      }
    }
  }
  await walk(projectRoot, '');
  return { filesSeen, filesEnqueued };
}
