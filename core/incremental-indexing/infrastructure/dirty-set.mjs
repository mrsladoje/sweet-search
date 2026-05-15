/**
 * In-memory dirty path set.
 *
 * Plan § 6.1, § 9.1-§ 9.5. The watcher and polling backstop both push
 * paths into this set; the reconcile tick drains it at every tick start.
 *
 * Guarantees:
 *   - Paths are normalised to forward-slash form (cross-platform).
 *   - Duplicate inserts are coalesced (Set semantics).
 *   - Insertion order is preserved on drain for deterministic tests.
 *   - A bounded-size policy guards against burst overflow (50 k events
 *     from `git checkout` in <1 s — plan § 11). Past the cap, the set
 *     keeps the most recent entries and emits a `dropped` count via the
 *     callback so the next polling backstop sweep can re-discover them.
 *
 * The set is pure JS — no I/O, no global state, suitable for testing.
 */

import path from 'node:path';

const DEFAULT_MAX = 100_000;

function normalise(p) {
  if (typeof p !== 'string') return null;
  return p.replace(/\\/g, '/');
}

export class DirtySet {
  /**
   * @param {object} [options]
   * @param {number} [options.maxSize]            Hard cap on entries.
   * @param {(payload:{dropped:number})=>void} [options.onOverflow]
   */
  constructor({ maxSize = DEFAULT_MAX, onOverflow } = {}) {
    this._set = new Map(); // path → { addedAt, source, meta }
    this._maxSize = maxSize;
    this._onOverflow = onOverflow;
    this._totalEnqueued = 0;
    this._totalDropped = 0;
  }

  get size() {
    return this._set.size;
  }

  get maxSize() {
    return this._maxSize;
  }

  /**
   * Enqueue a path. `source` is one of:
   *   - 'watcher'   - notify / FSEvents / inotify
   *   - 'polling'   - mtime backstop sweep
   *   - 'cli'       - explicit `sweet-search index --add <path>` hint
   *   - 'queue'     - drained from index-maintainer-queue.jsonl
   *
   * @param {string} filePath
   * @param {string} [source='watcher']
   * @param {object} [meta]
   * @returns {boolean}   true if newly inserted (or refreshed), false on drop.
   */
  add(filePath, source = 'watcher', meta) {
    const p = normalise(filePath);
    if (!p) return false;
    this._totalEnqueued += 1;
    if (this._set.has(p)) {
      const entry = this._set.get(p);
      entry.lastSource = source;
      entry.lastSeenAt = Date.now();
      if (meta) entry.meta = { ...entry.meta, ...meta };
      return true;
    }
    if (this._set.size >= this._maxSize) {
      // Drop the oldest entry to keep the most recent — those reflect the
      // current edit pattern best. The dropped path will be re-discovered
      // by the next polling backstop sweep.
      const firstKey = this._set.keys().next().value;
      if (firstKey !== undefined) {
        this._set.delete(firstKey);
        this._totalDropped += 1;
        if (this._onOverflow) this._onOverflow({ dropped: 1, droppedTotal: this._totalDropped });
      }
    }
    this._set.set(p, {
      addedAt: Date.now(),
      lastSeenAt: Date.now(),
      firstSource: source,
      lastSource: source,
      meta: meta || null,
    });
    return true;
  }

  /**
   * Bulk-add an iterable of paths. Useful when polling identifies a
   * batch of dirty paths in one syscall pass.
   *
   * @param {Iterable<string>} paths
   * @param {string} [source]
   */
  addMany(paths, source = 'polling') {
    let added = 0;
    for (const p of paths) {
      if (this.add(p, source)) added += 1;
    }
    return added;
  }

  has(filePath) {
    return this._set.has(normalise(filePath));
  }

  /**
   * Drain the set into a sorted array. Returns the snapshot the caller
   * should process this tick; subsequent inserts go into the next tick.
   *
   * @returns {Array<{path:string, firstSource:string, lastSource:string, addedAt:number, lastSeenAt:number, meta:object|null}>}
   */
  drain() {
    const out = [];
    for (const [p, entry] of this._set.entries()) {
      out.push({ path: p, ...entry });
    }
    this._set.clear();
    return out;
  }

  /**
   * Peek without draining — primarily for tests / debug.
   *
   * @returns {string[]}
   */
  peek() {
    return Array.from(this._set.keys());
  }

  /**
   * Remove a single path without draining the rest.
   *
   * @param {string} filePath
   */
  remove(filePath) {
    return this._set.delete(normalise(filePath));
  }

  /**
   * Diagnostic counters for the operator dashboard (plan § 20.2).
   *
   * @returns {{size:number, maxSize:number, totalEnqueued:number, totalDropped:number}}
   */
  stats() {
    return {
      size: this._set.size,
      maxSize: this._maxSize,
      totalEnqueued: this._totalEnqueued,
      totalDropped: this._totalDropped,
    };
  }
}

/**
 * Resolve a path to its canonical absolute form within a project root.
 * Plan § 22.1 / § 22.4: canonicalise to drop case-insensitive collisions
 * and to anchor paths inside the indexed tree.
 *
 * @param {string} projectRoot
 * @param {string} relativeOrAbsolute
 * @returns {string|null}     null if the path escapes projectRoot.
 */
export function canonicaliseInsideRoot(projectRoot, relativeOrAbsolute) {
  if (typeof relativeOrAbsolute !== 'string') return null;
  const abs = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(projectRoot, relativeOrAbsolute);
  const resolved = path.resolve(abs);
  const root = path.resolve(projectRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved.replace(/\\/g, '/');
}
